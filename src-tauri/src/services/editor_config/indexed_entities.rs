use crate::{
    domain::config::validate_config_id,
    errors::{AppError, AppResult},
    io::{
        FileChangeSetBuilder, FsRootBoundary, JsonWriteBatch, acquire_root_write_lock,
        read_csv_data,
    },
    models::{
        EntityEditTarget, EntityFileLocation, EntityIdentityChange, EntityKind, EntityLinkedRecord,
        EntityTargetState, IndexedEntityRefresh, JsonWriteOptions, ResourceSource, WriteResult,
    },
    parsers::render_csv_text,
};
use serde_json::{Map, Value};
use std::path::Path;

const MISSION_INDEX: &str = "data/missions/mission_list.csv";
fn mission_row_id(row: &Map<String, Value>) -> Option<&str> {
    row.get("mission").and_then(Value::as_str).map(str::trim)
}

pub struct MissionSaveInput<'a> {
    pub index_row: Map<String, Value>,
    pub entity_data: Value,
    pub json_write: JsonWriteOptions,
    pub ordered_json: Option<&'a str>,
}

pub fn save_mission_with_json(
    root: &str,
    previous_id: Option<&str>,
    next_id: &str,
    input: MissionSaveInput<'_>,
) -> AppResult<WriteResult<Value>> {
    let lease = acquire_root_write_lock(Path::new(root))?;
    let boundary = FsRootBoundary::new(Path::new(root), "mission root")?;
    let next_id = validate_config_id(next_id, "无效战役 ID")?;
    if let Some(previous) = previous_id {
        validate_config_id(previous, "无效战役 ID")?;
    }
    let mut index = read_csv_data(&boundary.resolve_relative(MISSION_INDEX, "mission index")?)?;
    if index.header.is_empty() {
        index.header.push("mission".to_string());
    }
    let previous_position = previous_id.and_then(|id| {
        index
            .rows
            .iter()
            .position(|row| mission_row_id(row) == Some(id))
    });
    if let Some(previous_id) = previous_id
        && previous_position.is_none()
    {
        return Err(AppError::message(
            "config.index_missing",
            format!("战役索引不存在: {}", previous_id),
        ));
    }
    if index
        .rows
        .iter()
        .any(|row| mission_row_id(row) == Some(next_id))
        && previous_id != Some(next_id)
    {
        return Err(AppError::message(
            "config.entity_exists",
            format!("战役已存在: {next_id}"),
        ));
    }
    let source_id = previous_id.unwrap_or(next_id);
    let before_rel = format!("data/missions/{source_id}");
    let after_rel = format!("data/missions/{next_id}");
    let source = boundary.resolve_relative(&before_rel, "mission source")?;
    let target = boundary.resolve_relative(&after_rel, "mission target")?;
    if target.exists()
        && previous_id != Some(next_id)
        && (previous_id.is_none() || !crate::io::same_physical_path(&source, &target))
    {
        return Err(AppError::message(
            "config.target_exists",
            format!("战役目标已存在: {after_rel}"),
        ));
    }
    let mut row = previous_position
        .map(|position| index.rows[position].clone())
        .unwrap_or_default();
    row.extend(input.index_row);
    row.insert("mission".to_string(), Value::String(next_id.to_string()));
    for key in row.keys() {
        if !index.header.contains(key) {
            index.header.push(key.clone());
        }
    }
    let next_position = previous_position.unwrap_or(index.rows.len());
    if let Some(position) = previous_position {
        index.rows[position] = row;
    } else {
        index.rows.push(row);
    }
    let descriptor = input.entity_data.get("descriptor").ok_or_else(|| {
        AppError::message(
            "config.missing_mission_descriptor",
            "missing mission descriptor data",
        )
    })?;
    let text = input
        .entity_data
        .get("text")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::message("config.missing_mission_text", "missing mission text data")
        })?;
    let mut json = JsonWriteBatch::new(input.json_write);
    let rendered = json.render(
        &source.join("descriptor.json"),
        descriptor,
        input.ordered_json,
    )?;
    json.finish()?;
    let mut builder = FileChangeSetBuilder::new_with_lock(boundary.root(), lease)?;
    builder.text_file(
        MISSION_INDEX,
        Some(render_csv_text(
            &index.header,
            &index.rows.iter().collect::<Vec<_>>(),
        )?),
    )?;
    let rename = previous_id.is_some() && source_id != next_id;
    if rename {
        let mut files = builder.directory_files(&before_rel)?;
        for (relative, content) in [
            ("descriptor.json", rendered),
            ("mission_text.txt", text.to_string()),
        ] {
            files.retain(|file| file.rel_path != relative);
            files.push(crate::models::FileSnapshot {
                rel_path: relative.to_string(),
                text: Some(content),
                data_base64: None,
            });
        }
        files.sort_by(|left, right| left.rel_path.cmp(&right.rel_path));
        builder.rename_directory(&before_rel, &after_rel, files)?;
    } else {
        builder.text_file(format!("{after_rel}/descriptor.json"), Some(rendered))?;
        builder.text_file(
            format!("{after_rel}/mission_text.txt"),
            Some(text.to_string()),
        )?;
    }
    let changes = builder.apply()?;
    let root = boundary.root().to_string_lossy().to_string();
    let location = |rel: &str| EntityFileLocation {
        source: ResourceSource::Mod,
        root: root.clone(),
        rel_path: rel.to_string(),
        path: boundary.root().join(rel).to_string_lossy().to_string(),
    };
    let before_location = location(&before_rel);
    let after_location = location(&after_rel);
    let before = EntityEditTarget {
        kind: EntityKind::Mission,
        id: source_id.to_string(),
        source: previous_id.map(|_| before_location.clone()),
        write: before_location,
        state: if previous_id.is_some() {
            EntityTargetState::Existing
        } else {
            EntityTargetState::Create
        },
        linked_record: previous_position.map(|row_index| EntityLinkedRecord::Index {
            path: MISSION_INDEX.to_string(),
            row_index,
        }),
    };
    let after = EntityEditTarget {
        kind: EntityKind::Mission,
        id: next_id.to_string(),
        source: Some(after_location.clone()),
        write: after_location,
        state: EntityTargetState::Existing,
        linked_record: Some(EntityLinkedRecord::Index {
            path: MISSION_INDEX.to_string(),
            row_index: next_position,
        }),
    };
    let mut result = WriteResult::from_refreshed_entity(
        changes,
        serde_json::to_value(IndexedEntityRefresh {
            entity_id: next_id.to_string(),
            index_path: MISSION_INDEX.to_string(),
            index_header: index.header,
            index_rows: index.rows,
            entity_data: input.entity_data,
        })?,
    );
    result
        .identity_changes
        .push(EntityIdentityChange { before, after });
    Ok(result)
}

pub fn create_mission_entity(
    root: &str,
    next_id: &str,
    index_row: Map<String, Value>,
    entity_data: Value,
) -> AppResult<WriteResult<Value>> {
    save_mission_with_json(
        root,
        None,
        next_id,
        MissionSaveInput {
            index_row,
            entity_data,
            json_write: Default::default(),
            ordered_json: None,
        },
    )
}

pub fn delete_mission_entity(
    root: &str,
    id: &str,
    delete_target: bool,
) -> AppResult<WriteResult<Value>> {
    let lease = acquire_root_write_lock(Path::new(root))?;
    validate_config_id(id, "无效战役 ID")?;
    let boundary = FsRootBoundary::new(Path::new(root), "mission root")?;
    let mut index = read_csv_data(&boundary.resolve_relative(MISSION_INDEX, "mission index")?)?;
    let position = index
        .rows
        .iter()
        .position(|row| row.get("mission").and_then(Value::as_str).map(str::trim) == Some(id))
        .ok_or_else(|| {
            AppError::message("config.index_missing", format!("战役索引不存在: {id}"))
        })?;
    index.rows.remove(position);
    let mut builder = FileChangeSetBuilder::new_with_lock(boundary.root(), lease)?;
    builder.text_file(
        MISSION_INDEX,
        Some(render_csv_text(
            &index.header,
            &index.rows.iter().collect::<Vec<_>>(),
        )?),
    )?;
    if delete_target {
        builder.delete_directory(format!("data/missions/{id}"))?;
    }
    Ok(WriteResult::from_refreshed_entity(
        builder.apply()?,
        serde_json::to_value(IndexedEntityRefresh {
            entity_id: id.to_string(),
            index_path: MISSION_INDEX.to_string(),
            index_header: index.header,
            index_rows: index.rows,
            entity_data: Value::Null,
        })?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::IndexedConfigKind;

    struct IndexedSaveInput<'a> {
        index_row: Map<String, Value>,
        entity_data: Value,
        json_write: JsonWriteOptions,
        ordered_json: Option<&'a str>,
    }

    fn with_session<T>(
        root: &str,
        action: impl FnOnce(&crate::models::ProjectManifest) -> AppResult<T>,
    ) -> AppResult<T> {
        let mut trace = crate::services::project::PerformanceTrace::new("project.openSession");
        let manifest = crate::services::project::open_project_session_traced(
            Path::new(root),
            None,
            &mut trace,
        )?;
        let result = action(&manifest);
        crate::services::project::close_project_session(manifest.session_id)?;
        result
    }

    fn save_indexed_config_with_json(
        root: &str,
        kind: IndexedConfigKind,
        previous: Option<&str>,
        next: &str,
        input: IndexedSaveInput<'_>,
    ) -> AppResult<WriteResult<Value>> {
        with_session(root, |manifest| {
            let entity_kind = if kind == IndexedConfigKind::Faction {
                EntityKind::Faction
            } else {
                EntityKind::Mission
            };
            let info = crate::services::project::query_entity_edit_target(
                &manifest.session_id,
                entity_kind,
                previous.unwrap_or(next),
            )?;
            crate::commands::save_indexed_config_entity(
                crate::models::command_payloads::IndexedConfigEntityPayload {
                    session_id: manifest.session_id.clone(),
                    mod_root: manifest.mod_root.clone(),
                    base_versions: info.base_versions,
                    kind,
                    previous_id: previous.map(str::to_string),
                    next_id: next.to_string(),
                    index_row: input.index_row,
                    entity_data: input.entity_data,
                    json_write: input.json_write,
                    ordered_json: input.ordered_json.map(str::to_string),
                },
            )
        })
    }

    fn save_indexed_config_entity(
        root: &str,
        kind: IndexedConfigKind,
        previous: Option<&str>,
        next: &str,
        index_row: Map<String, Value>,
        entity_data: Value,
        _delete_previous_target: bool,
    ) -> AppResult<WriteResult<Value>> {
        save_indexed_config_with_json(
            root,
            kind,
            previous,
            next,
            IndexedSaveInput {
                index_row,
                entity_data,
                json_write: Default::default(),
                ordered_json: None,
            },
        )
    }

    fn delete_indexed_config_entity(
        root: &str,
        kind: IndexedConfigKind,
        id: &str,
        delete_target: bool,
    ) -> AppResult<WriteResult<Value>> {
        with_session(root, |manifest| {
            let entity_kind = if kind == IndexedConfigKind::Faction {
                EntityKind::Faction
            } else {
                EntityKind::Mission
            };
            let info = crate::services::project::query_entity_edit_target(
                &manifest.session_id,
                entity_kind,
                id,
            )?;
            crate::commands::delete_indexed_config_entity(
                crate::models::command_payloads::DeleteIndexedConfigEntityPayload {
                    session_id: manifest.session_id.clone(),
                    mod_root: manifest.mod_root.clone(),
                    base_versions: info.base_versions,
                    kind,
                    id: id.to_string(),
                    delete_target,
                },
            )
        })
    }
    use crate::testutil::temp_dir;
    use crate::{
        io::{read_utf8_no_bom, write_utf8_no_bom},
        models::FileChangeReplayDirection,
        services::file_changes::apply_file_change_set,
    };
    use std::fs;

    #[test]
    fn faction_save_preserves_spec_comments_and_order() {
        let root = temp_dir("indexed_faction_preserves_json");
        let dir = root.join("data/world/factions");
        fs::create_dir_all(&dir).unwrap();
        write_utf8_no_bom(
            &dir.join("factions.csv"),
            "faction\ndata/world/factions/demo.faction\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &dir.join("demo.faction"),
            "{\n  # note\n  displayName: 'Old',\n  id: 'demo'\n}\n",
        )
        .unwrap();
        let result = save_indexed_config_with_json(
            &root.to_string_lossy(),
            IndexedConfigKind::Faction,
            Some("demo"),
            "demo",
            IndexedSaveInput {
                index_row: Map::new(),
                entity_data: serde_json::json!({"file":{"displayName":"New","id":"demo"}}),
                json_write: JsonWriteOptions {
                    preserve_original_json: true,
                    confirmed_sources: Vec::new(),
                },
                ordered_json: Some(r#"{"displayName":"New","id":"demo"}"#),
            },
        )
        .unwrap();
        let text = read_utf8_no_bom(&dir.join("demo.faction")).unwrap();
        assert_eq!(result.changes.len(), 2);
        assert!(text.contains("# note"));
        assert!(text.find("displayName").unwrap() < text.find("id:").unwrap());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn faction_save_can_rename_file_and_index_with_undo_redo() {
        let root = temp_dir("indexed_faction_rename");
        let dir = root.join("data/world/factions");
        fs::create_dir_all(&dir).unwrap();
        write_utf8_no_bom(
            &dir.join("factions.csv"),
            "faction\ndata/world/factions/old.faction\n",
        )
        .unwrap();
        write_utf8_no_bom(&dir.join("old.faction"), r#"{"id":"old"}"#).unwrap();

        let mut index_row = Map::new();
        index_row.insert(
            "faction".to_string(),
            Value::String("data/world/factions/new.faction".to_string()),
        );
        let result = save_indexed_config_entity(
            &root.to_string_lossy(),
            IndexedConfigKind::Faction,
            Some("old"),
            "new",
            index_row,
            serde_json::json!({"file": {"id": "new", "displayName": "New"}}),
            true,
        )
        .unwrap();

        assert!(!dir.join("old.faction").exists());
        assert!(dir.join("new.faction").exists());
        assert_eq!(
            read_utf8_no_bom(&dir.join("factions.csv")).unwrap(),
            "faction\ndata/world/factions/new.faction\n"
        );

        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Undo,
            result.changes.clone(),
        )
        .unwrap();
        assert!(dir.join("old.faction").exists());
        assert!(!dir.join("new.faction").exists());

        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            result.changes,
        )
        .unwrap();
        let new_text = read_utf8_no_bom(&dir.join("new.faction")).unwrap();
        let _ = fs::remove_dir_all(root);
        assert!(new_text.contains("\"id\": \"new\""));
    }

    #[test]
    fn faction_save_keeps_single_column_game_format_on_same_id_save() {
        let root = temp_dir("indexed_faction_same_id");
        let dir = root.join("data/world/factions");
        fs::create_dir_all(&dir).unwrap();
        write_utf8_no_bom(
            &dir.join("factions.csv"),
            "faction\ndata/world/factions/demo.faction\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &dir.join("demo.faction"),
            r#"{"id":"demo","displayName":"Demo"}"#,
        )
        .unwrap();

        let mut index_row = Map::new();
        index_row.insert(
            "faction".to_string(),
            Value::String("data/world/factions/demo.faction".to_string()),
        );
        let result = save_indexed_config_entity(
            &root.to_string_lossy(),
            IndexedConfigKind::Faction,
            Some("demo"),
            "demo",
            index_row,
            serde_json::json!({"file": {"id": "demo", "displayName": "Demo"}}),
            false,
        )
        .unwrap();

        assert_eq!(
            read_utf8_no_bom(&dir.join("factions.csv")).unwrap(),
            "faction\ndata/world/factions/demo.faction\n"
        );
        assert_eq!(result.changes.len(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn indexed_entity_rejects_duplicate_id() {
        let root = temp_dir("indexed_duplicate_id");
        let dir = root.join("data/world/factions");
        fs::create_dir_all(&dir).unwrap();
        write_utf8_no_bom(
            &dir.join("factions.csv"),
            "faction\r\ndata/world/factions/new.faction\r\n",
        )
        .unwrap();

        let mut index_row = Map::new();
        index_row.insert(
            "faction".to_string(),
            Value::String("data/world/factions/new.faction".to_string()),
        );
        let result = save_indexed_config_entity(
            &root.to_string_lossy(),
            IndexedConfigKind::Faction,
            Some("old"),
            "new",
            index_row,
            serde_json::json!({"file": {"id": "new"}}),
            false,
        );

        let _ = fs::remove_dir_all(root);
        assert!(result.is_err());
    }

    #[test]
    fn indexed_entity_save_requires_previous_index_row() {
        let root = temp_dir("indexed_missing_previous");
        fs::create_dir_all(root.join("data/world/factions")).unwrap();
        write_utf8_no_bom(
            &root.join("data/world/factions/factions.csv"),
            "id,file\r\n",
        )
        .unwrap();

        let error = save_indexed_config_entity(
            &root.to_string_lossy(),
            IndexedConfigKind::Faction,
            Some("missing"),
            "next",
            {
                let mut row = Map::new();
                row.insert("id".to_string(), Value::String("next".to_string()));
                row
            },
            serde_json::json!({"file": {"id": "next"}}),
            false,
        )
        .unwrap_err()
        .to_string();

        let _ = fs::remove_dir_all(root);
        assert!(error.contains("势力索引不存在: missing"));
    }

    #[test]
    fn indexed_entity_delete_requires_index_row() {
        let root = temp_dir("indexed_delete_missing");
        fs::create_dir_all(root.join("data/missions")).unwrap();
        write_utf8_no_bom(&root.join("data/missions/mission_list.csv"), "mission\r\n").unwrap();

        let error = delete_indexed_config_entity(
            &root.to_string_lossy(),
            IndexedConfigKind::Mission,
            "missing",
            false,
        )
        .unwrap_err()
        .to_string();

        let _ = fs::remove_dir_all(root);
        assert!(error.contains("战役索引不存在: missing"));
    }

    #[test]
    fn mission_delete_expands_directory_invalidation_paths() {
        let root = temp_dir("mission_delete_expands_invalidation_paths");
        fs::create_dir_all(root.join("data/missions/demo")).unwrap();
        write_utf8_no_bom(
            &root.join("data/missions/mission_list.csv"),
            "mission\r\ndemo\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/missions/demo/descriptor.json"),
            r#"{"title":"Demo"}"#,
        )
        .unwrap();
        write_utf8_no_bom(&root.join("data/missions/demo/mission_text.txt"), "Demo").unwrap();

        let result = delete_indexed_config_entity(
            &root.to_string_lossy(),
            IndexedConfigKind::Mission,
            "demo",
            true,
        )
        .unwrap();

        let _ = fs::remove_dir_all(root);
        assert!(result.invalidation.paths.iter().any(|path| {
            path.replace('\\', "/")
                .ends_with("data/missions/demo/descriptor.json")
        }));
        assert!(result.invalidation.paths.iter().any(|path| {
            path.replace('\\', "/")
                .ends_with("data/missions/demo/mission_text.txt")
        }));
    }
}
