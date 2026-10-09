use super::file_history::{HistoryEntry, history_limit, lock_histories, snapshot, trim_history};
use crate::io::{verify_versions, version_after_change};
use crate::{
    errors::{AppError, AppResult},
    io::{FsRootBoundary, RootWriteLock, acquire_root_write_lock},
    models::SessionModScope,
    models::{
        FileChangeRecord, FileChangeReplayDirection, FileHistorySnapshot, FileHistorySummary,
        FileVersion, WriteResult,
    },
};
use std::path::Path;

pub struct WriteTransaction {
    root: String,
    session_id: Option<String>,
    base_versions: Vec<FileVersion>,
    _lease: RootWriteLock,
}

pub fn begin(payload: &impl SessionModScope, base: &[FileVersion]) -> AppResult<WriteTransaction> {
    let mut transaction = acquire(payload.mod_root(), payload.session_id().map(String::as_str))?;
    verify_versions(&transaction.root, base)?;
    transaction.base_versions = base.to_vec();
    Ok(transaction)
}

fn acquire(root: &str, session_id: Option<&str>) -> AppResult<WriteTransaction> {
    let lease = acquire_root_write_lock(Path::new(root))?;
    if let Some(session_id) = session_id {
        super::project::ensure_project_session_mod_root(session_id, root)?;
    }
    super::app_settings::ensure_core_editing_allowed(root)?;
    let root = FsRootBoundary::new(Path::new(root), "write root")?
        .root()
        .to_string_lossy()
        .to_lowercase();
    Ok(WriteTransaction {
        root,
        session_id: session_id.map(str::to_string),
        base_versions: Vec::new(),
        _lease: lease,
    })
}

impl WriteTransaction {
    pub fn commit<T>(self, mut result: WriteResult<T>, label: &str) -> AppResult<WriteResult<T>> {
        let mut versions = self.base_versions.clone();
        for identity in &result.identity_changes {
            if identity.before.write.path != identity.after.write.path {
                versions.retain(|version| {
                    !crate::io::same_physical_path(
                        Path::new(&version.path),
                        Path::new(&identity.before.write.path),
                    )
                });
            }
        }
        for change in &result.changes {
            if change.before_path != change.after_path {
                versions.retain(|version| {
                    !crate::io::same_physical_path(
                        Path::new(&version.path),
                        Path::new(&change.before_path),
                    )
                });
            }
        }
        for version in versions_for_changes(&result.changes)? {
            versions.retain(|previous| !previous.path.eq_ignore_ascii_case(&version.path));
            versions.push(version);
        }
        for version in &mut versions {
            if Path::new(&version.path).is_dir()
                && result
                    .changes
                    .iter()
                    .any(|change| Path::new(&change.after_path).starts_with(&version.path))
            {
                match crate::io::file_version(Path::new(&version.path)) {
                    Ok(current) => *version = current,
                    Err(error) => crate::diagnostics::record(format!(
                        "committed directory version awaits refresh: {error}"
                    )),
                }
            }
        }
        versions.sort_by(|left, right| left.path.cmp(&right.path));
        result.base_versions = versions;
        if self.session_id.is_some() {
            let mut histories = lock_histories()?;
            let history = histories.entry(self.root.clone()).or_default();
            if !result.changes.is_empty() {
                history.revision += 1;
                history.undo.push(HistoryEntry {
                    identity_changes: result.identity_changes.clone(),
                    summary: FileHistorySummary {
                        id: history.revision,
                        label: label.to_string(),
                        timestamp: chrono::Utc::now().timestamp_millis(),
                        paths: result
                            .changes
                            .iter()
                            .flat_map(|change| {
                                [change.before_path.clone(), change.after_path.clone()]
                            })
                            .collect::<std::collections::BTreeSet<_>>()
                            .into_iter()
                            .collect(),
                    },
                    changes: history_changes(&result.changes),
                });
                history.redo.clear();
                trim_history(history, history_limit()?);
            }
            result.commit_id = history.revision;
            result.history = snapshot(history);
        }
        if let Some(session_id) = &self.session_id
            && !result.changes.is_empty()
            && let Err(error) =
                super::project::invalidate_project_session(session_id, result.changes.clone())
        {
            crate::diagnostics::record(format!("committed write awaits refresh: {error}"));
        }
        if let Some(session_id) = &self.session_id
            && !result.identity_changes.is_empty()
        {
            let mut versions = Vec::new();
            for identity in &result.identity_changes {
                match super::project::query_entity_edit_target(
                    session_id,
                    identity.after.kind,
                    &identity.after.id,
                ) {
                    Ok(info) => crate::models::push_unique_all(&mut versions, info.base_versions),
                    Err(error) => crate::diagnostics::record(format!(
                        "committed target versions await refresh: {error}"
                    )),
                }
            }
            if !versions.is_empty() {
                versions.sort_by(|left, right| left.path.cmp(&right.path));
                result.base_versions = versions;
            }
        }
        Ok(result)
    }
}

pub fn query_history(session_id: &str, root: &str) -> AppResult<FileHistorySnapshot> {
    super::project::ensure_project_session_mod_root(session_id, root)?;
    let root = FsRootBoundary::new(Path::new(root), "history root")?
        .root()
        .to_string_lossy()
        .to_lowercase();
    Ok(lock_histories()?
        .get(&root)
        .map(snapshot)
        .unwrap_or_default())
}

pub fn clear_history(session_id: &str, root: &str) -> AppResult<FileHistorySnapshot> {
    let transaction = acquire(root, Some(session_id))?;
    let mut histories = lock_histories()?;
    let history = histories.entry(transaction.root.clone()).or_default();
    history.revision += 1;
    history.undo.clear();
    history.redo.clear();
    Ok(snapshot(history))
}

pub fn replay(
    session_id: &str,
    root: &str,
    direction: FileChangeReplayDirection,
    entry_id: u64,
    revision: u64,
) -> AppResult<WriteResult> {
    let transaction = acquire(root, Some(session_id))?;
    let entry = {
        let histories = lock_histories()?;
        let history = histories
            .get(&transaction.root)
            .ok_or_else(history_conflict)?;
        let stack = match direction {
            FileChangeReplayDirection::Undo => &history.undo,
            FileChangeReplayDirection::Redo => &history.redo,
        };
        let entry = stack
            .last()
            .filter(|entry| entry.summary.id == entry_id && history.revision == revision)
            .ok_or_else(history_conflict)?;
        entry.clone()
    };
    let mut changes = entry.changes.clone();
    if matches!(direction, FileChangeReplayDirection::Undo) {
        changes.reverse();
        changes = changes.iter().map(FileChangeRecord::reversed).collect();
    }
    for change in &changes {
        if change.before_path != change.after_path {
            crate::io::require_rename_target(
                Path::new(&change.before_path),
                Path::new(&change.after_path),
            )?;
        }
        let current = match change.kind {
            crate::models::FileChangeKind::File => {
                crate::io::build_text_change(Path::new(&change.before_path), None)?
            }
            crate::models::FileChangeKind::Directory => {
                crate::io::build_directory_delete_change(Path::new(&change.before_path))?
            }
        };
        if current.before_exists != change.before_exists
            || current.before_text != change.before_text
            || current.before_data_base64 != change.before_data_base64
            || current.before_files != change.before_files
        {
            return Err(AppError::message(
                "write.version_conflict",
                format!("回放目标已被修改: {}", change.after_path),
            ));
        }
    }
    let mut result =
        super::file_changes::apply_file_change_set(root, FileChangeReplayDirection::Redo, changes)?;
    result.base_versions = versions_for_changes(&result.changes)?;
    result.identity_changes = entry
        .identity_changes
        .iter()
        .map(|identity| match direction {
            FileChangeReplayDirection::Redo => identity.clone(),
            FileChangeReplayDirection::Undo => crate::models::EntityIdentityChange {
                before: identity.after.clone(),
                after: identity.before.clone(),
            },
        })
        .collect();
    let mut histories = lock_histories()?;
    let history = histories
        .get_mut(&transaction.root)
        .expect("queued history remains registered");
    match direction {
        FileChangeReplayDirection::Undo => {
            history.undo.pop();
            history.redo.push(entry);
        }
        FileChangeReplayDirection::Redo => {
            history.redo.pop();
            history.undo.push(entry);
        }
    }
    history.revision += 1;
    trim_history(history, history_limit()?);
    result.commit_id = history.revision;
    result.history = snapshot(history);
    drop(histories);
    if let Err(error) =
        super::project::invalidate_project_session(session_id, result.changes.clone())
    {
        crate::diagnostics::record(format!("committed replay awaits refresh: {error}"));
    }
    if !result.identity_changes.is_empty() {
        let mut versions = Vec::new();
        for identity in &result.identity_changes {
            match super::project::query_entity_edit_target(
                session_id,
                identity.after.kind,
                &identity.after.id,
            ) {
                Ok(info) => crate::models::push_unique_all(&mut versions, info.base_versions),
                Err(error) => crate::diagnostics::record(format!(
                    "committed replay target versions await refresh: {error}"
                )),
            }
        }
        versions.sort_by(|left, right| left.path.cmp(&right.path));
        if !versions.is_empty() {
            result.base_versions = versions;
        }
    }
    Ok(result)
}

fn versions_for_changes(changes: &[FileChangeRecord]) -> AppResult<Vec<FileVersion>> {
    changes.iter().map(version_after_change).collect()
}

fn history_changes(changes: &[FileChangeRecord]) -> Vec<FileChangeRecord> {
    let mut normalized = Vec::new();
    for change in changes {
        if changes.iter().any(|parent| {
            matches!(parent.kind, crate::models::FileChangeKind::Directory)
                && parent.after_path != change.after_path
                && Path::new(&change.after_path).starts_with(&parent.after_path)
        }) {
            continue;
        }
        let mut combined = change.clone();
        if matches!(combined.kind, crate::models::FileChangeKind::Directory)
            && combined.after_exists
        {
            for child in changes {
                if matches!(child.kind, crate::models::FileChangeKind::File)
                    && let Ok(relative) =
                        Path::new(&child.after_path).strip_prefix(&combined.after_path)
                {
                    let relative = crate::io::forward_slash_path(relative);
                    combined
                        .after_files
                        .retain(|file| file.rel_path != relative);
                    if child.after_exists {
                        combined.after_files.push(crate::models::FileSnapshot {
                            rel_path: relative,
                            text: child.after_text.clone(),
                            data_base64: child.after_data_base64.clone(),
                        });
                    }
                }
            }
            combined
                .after_files
                .sort_by(|left, right| left.rel_path.cmp(&right.rel_path));
        }
        normalized.push(combined);
    }
    normalized
}

fn history_conflict() -> AppError {
    AppError::message("history.version_conflict", "文件历史已更新，请重新确认回放")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::file_version;
    use crate::{models::command_payloads::SaveTextFilePayload, testutil::temp_dir};

    #[test]
    fn mission_rename_history_combines_directory_and_nested_writes() {
        assert_mission_rename_replay("new");
    }

    #[test]
    fn mission_case_only_rename_replays_actual_directory_names() {
        assert_mission_rename_replay("Old");
    }

    fn assert_mission_rename_replay(next_id: &str) {
        let root = temp_dir("transaction_mission_rename");
        std::fs::create_dir_all(root.join("data/missions/old")).unwrap();
        std::fs::write(
            root.join("data/missions/mission_list.csv"),
            "mission,custom\nold,keep\n",
        )
        .unwrap();
        std::fs::write(
            root.join("data/missions/old/descriptor.json"),
            r#"{"title":"Old"}"#,
        )
        .unwrap();
        std::fs::write(root.join("data/missions/old/mission_text.txt"), "old text").unwrap();
        std::fs::write(root.join("data/missions/old/extra.bin"), [0, 255, 128]).unwrap();
        let mut trace = super::super::project::PerformanceTrace::new("project.openSession");
        let manifest =
            super::super::project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let base = super::super::project::query_entity_edit_target(
            &manifest.session_id,
            crate::models::EntityKind::Mission,
            "old",
        )
        .unwrap()
        .base_versions;
        let saved = crate::commands::save_indexed_config_entity(
            crate::models::command_payloads::IndexedConfigEntityPayload {
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                base_versions: base,
                kind: crate::models::IndexedConfigKind::Mission,
                previous_id: Some("old".to_string()),
                next_id: next_id.to_string(),
                index_row: serde_json::from_value(serde_json::json!({"mission":next_id})).unwrap(),
                entity_data: serde_json::json!({"descriptor":{"title":"New"},"text":"new text"}),
                json_write: Default::default(),
                ordered_json: None,
            },
        )
        .unwrap();
        let directory_name = || {
            std::fs::read_dir(root.join("data/missions"))
                .unwrap()
                .map(|entry| entry.unwrap())
                .find(|entry| entry.file_type().unwrap().is_dir())
                .unwrap()
                .file_name()
                .to_string_lossy()
                .to_string()
        };
        assert_eq!(directory_name(), next_id);
        let info = super::super::project::query_entity_edit_target(
            &manifest.session_id,
            crate::models::EntityKind::Mission,
            next_id,
        )
        .unwrap();
        assert_eq!(saved.base_versions, info.base_versions);
        assert_eq!(saved.identity_changes[0].after.id, next_id);
        assert_eq!(
            crate::io::read_csv_data(&root.join("data/missions/mission_list.csv"))
                .unwrap()
                .rows[0]["custom"],
            "keep"
        );
        let undone = replay(
            &manifest.session_id,
            &manifest.mod_root,
            FileChangeReplayDirection::Undo,
            saved.history.undo_stack[0].id,
            saved.history.revision,
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("data/missions/old/mission_text.txt")).unwrap(),
            "old text"
        );
        assert_eq!(directory_name(), "old");
        assert_eq!(
            std::fs::read(root.join("data/missions/old/extra.bin")).unwrap(),
            [0, 255, 128]
        );
        replay(
            &manifest.session_id,
            &manifest.mod_root,
            FileChangeReplayDirection::Redo,
            undone.history.redo_stack[0].id,
            undone.history.revision,
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join(format!("data/missions/{next_id}/mission_text.txt")))
                .unwrap(),
            "new text"
        );
        assert_eq!(directory_name(), next_id);
        assert_eq!(
            std::fs::read(root.join(format!("data/missions/{next_id}/extra.bin"))).unwrap(),
            [0, 255, 128]
        );
        super::super::project::close_project_session(manifest.session_id).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn committed_history_and_replay_follow_disk_direction() {
        let root = temp_dir("transaction_history_direction");
        let path = root.join("notes.txt");
        std::fs::write(&path, "A").unwrap();
        let mut trace = super::super::project::PerformanceTrace::new("project.openSession");
        let manifest =
            super::super::project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let payload = SaveTextFilePayload {
            session_id: Some(manifest.session_id.clone()),
            mod_root: manifest.mod_root.clone(),
            path: path.to_string_lossy().to_string(),
            text: "B".to_string(),
            base_versions: vec![file_version(&path).unwrap()],
        };
        let transaction = begin(&payload, &payload.base_versions).unwrap();
        let result = super::super::file_editor::save_text_file(
            &payload.mod_root,
            &payload.path,
            payload.text.clone(),
        )
        .unwrap();
        let saved = transaction.commit(result, "save notes").unwrap();
        assert_eq!(saved.history.undo_stack.len(), 1);
        assert!(begin(&payload, &payload.base_versions).is_err());
        let undone = replay(
            &manifest.session_id,
            &manifest.mod_root,
            FileChangeReplayDirection::Undo,
            saved.history.undo_stack[0].id,
            saved.history.revision,
        )
        .unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "A");
        assert_eq!(undone.changes[0].before_text.as_deref(), Some("B"));
        assert_eq!(undone.changes[0].after_text.as_deref(), Some("A"));
        assert!(undone.history.undo_stack.is_empty());
        let redone = replay(
            &manifest.session_id,
            &manifest.mod_root,
            FileChangeReplayDirection::Redo,
            undone.history.redo_stack[0].id,
            undone.history.revision,
        )
        .unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "B");
        assert_eq!(redone.changes[0].after_text.as_deref(), Some("B"));
        assert!(
            replay(
                &manifest.session_id,
                &manifest.mod_root,
                FileChangeReplayDirection::Undo,
                saved.history.undo_stack[0].id,
                saved.history.revision
            )
            .is_err()
        );
        super::super::project::close_project_session(manifest.session_id).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_operation_releases_queue_without_advancing_history() {
        let root = temp_dir("transaction_failure");
        let path = root.join("notes.txt");
        std::fs::write(&path, "A").unwrap();
        let mut trace = super::super::project::PerformanceTrace::new("project.openSession");
        let manifest =
            super::super::project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let payload = SaveTextFilePayload {
            session_id: Some(manifest.session_id.clone()),
            mod_root: manifest.mod_root.clone(),
            path: path.to_string_lossy().to_string(),
            text: "B".to_string(),
            base_versions: vec![file_version(&path).unwrap()],
        };
        {
            let _transaction = begin(&payload, &payload.base_versions).unwrap();
        }
        assert!(
            query_history(&manifest.session_id, &manifest.mod_root)
                .unwrap()
                .undo_stack
                .is_empty()
        );
        let transaction = begin(&payload, &payload.base_versions).unwrap();
        let result = super::super::file_editor::save_text_file(
            &payload.mod_root,
            &payload.path,
            payload.text.clone(),
        )
        .unwrap();
        assert_eq!(
            transaction
                .commit(result, "saved")
                .unwrap()
                .history
                .undo_stack
                .len(),
            1
        );
        super::super::project::close_project_session(manifest.session_id).unwrap();
        assert!(begin(&payload, &payload.base_versions).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn csv_undo_queries_actual_disk_state() {
        use crate::models::command_payloads::SaveCsvPatchPayload;
        use crate::models::{CsvFactionFilter, CsvRowPatch, CsvRowPatchAction, CsvTableKey};
        let root = temp_dir("csv_history_actual_direction");
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();
        let path = root.join("data/hulls/ship_data.csv");
        std::fs::write(&path, "id,name\na,A\nb,B\n").unwrap();
        let mut trace = super::super::project::PerformanceTrace::new("project.openSession");
        let manifest =
            super::super::project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let query = || {
            super::super::project::query_csv_table_window(
                &manifest.session_id,
                CsvTableKey::Ships,
                0,
                20,
                None,
                CsvFactionFilter::All,
            )
            .unwrap()
        };
        let original = query();
        let payload = SaveCsvPatchPayload {
            session_id: manifest.session_id.clone(),
            mod_root: manifest.mod_root.clone(),
            table: CsvTableKey::Ships,
            patches: vec![CsvRowPatch {
                insert_at: None,
                row_key: original.rows[0].row_key.clone(),
                action: CsvRowPatchAction::Upsert,
                row: serde_json::from_value(serde_json::json!({"id":"a","name":"Saved"})).unwrap(),
            }],
            associated_specs: Vec::new(),
            json_write: Default::default(),
            base_versions: original.base_versions,
        };
        let saved = crate::commands::save_csv_patch(payload).unwrap();
        assert_eq!(query().rows[0].data["name"], "Saved");
        let undone = replay(
            &manifest.session_id,
            &manifest.mod_root,
            FileChangeReplayDirection::Undo,
            saved.history.undo_stack[0].id,
            saved.history.revision,
        )
        .unwrap();
        assert_eq!(query().rows[0].data["name"], "A");
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "id,name\na,A\nb,B\n"
        );
        assert_eq!(
            undone.changes[0].after_text.as_deref(),
            Some("id,name\na,A\nb,B\n")
        );
        std::fs::write(&path, "id,name\na,External\nb,B\n").unwrap();
        assert!(
            replay(
                &manifest.session_id,
                &manifest.mod_root,
                FileChangeReplayDirection::Redo,
                undone.history.redo_stack[0].id,
                undone.history.revision
            )
            .is_err()
        );
        assert_eq!(
            query_history(&manifest.session_id, &manifest.mod_root)
                .unwrap()
                .revision,
            undone.history.revision
        );
        super::super::project::close_project_session(manifest.session_id).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}
