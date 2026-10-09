use super::super::cache::{
    ensure_registered_table_rows, loaded_registered_csv_rows, lock_session,
    registered_session_table, registered_session_table_mut, session_handle,
};
use super::super::definitions::entity_definitions::associated_spec_definition;
use super::super::model::SessionCsvRow;
use crate::domain::spec_construction::{create_associated_spec, validate_weapon_spec_class};
use crate::{
    errors::{AppError, AppResult},
    io::{FileChangeSetBuilder, JsonWriteBatch, acquire_root_write_lock, read_json_file},
    models::{
        AssociatedSpecChange, AssociatedSpecCreateParams, AssociatedSpecWrite, CsvRowKeyMapping,
        CsvRowPatch, CsvRowPatchAction, CsvTableKey, WriteResult,
    },
    parsers::render_csv_text,
};
use serde_json::{Map, Value};
use std::path::Path;

#[cfg(test)]
pub fn save_csv_patch(
    session_id: &str,
    table: CsvTableKey,
    patches: Vec<CsvRowPatch>,
    associated_specs: Vec<AssociatedSpecChange>,
) -> AppResult<WriteResult> {
    save_csv_patch_with_json_options(
        session_id,
        table,
        patches,
        associated_specs,
        crate::models::JsonWriteOptions::default(),
    )
}

#[cfg(test)]
pub fn save_csv_patch_with_json_options(
    session_id: &str,
    table: CsvTableKey,
    patches: Vec<CsvRowPatch>,
    associated_specs: Vec<AssociatedSpecChange>,
    options: crate::models::JsonWriteOptions,
) -> AppResult<WriteResult> {
    let definition = associated_spec_definition(table);
    let associated = associated_specs
        .into_iter()
        .map(|change| {
            let definition = definition.expect("associated table has format");
            let id = match &change {
                AssociatedSpecChange::Rename { previous_id, .. } => previous_id.as_str(),
                _ => change.id(),
            };
            let info = super::super::query::query_entity_edit_target(
                session_id,
                definition.entity_kind,
                id,
            )?;
            Ok(AssociatedSpecWrite {
                change,
                target: info.target,
            })
        })
        .collect::<AppResult<Vec<_>>>()?;
    save_csv_patch_snapshot(session_id, table, patches, associated, options)
}

pub fn save_csv_patch_snapshot(
    session_id: &str,
    table: CsvTableKey,
    patches: Vec<CsvRowPatch>,
    associated_specs: Vec<AssociatedSpecWrite>,
    options: crate::models::JsonWriteOptions,
) -> AppResult<WriteResult> {
    let handle = session_handle(session_id)?;
    let root = lock_session(&handle)?.manifest.mod_root.clone();
    // Acquire the root before retaining session state throughout the write.
    let write_lock = acquire_root_write_lock(Path::new(&root))?;
    let mut session = lock_session(&handle)?;
    ensure_registered_table_rows(&mut session, table)?;
    let (mod_root, rel_path, header, mut rows, mut next_row_seq) = {
        let table_data = registered_session_table(&session, table)?;
        (
            session.manifest.mod_root.clone(),
            table_data.path.clone(),
            table_data.header.clone(),
            loaded_registered_csv_rows(&session, table)?.to_vec(),
            table_data.next_row_seq,
        )
    };
    let key_map = apply_csv_row_patches(table, &mut rows, &mut next_row_seq, patches)?;
    let row_values: Vec<&Map<String, Value>> = rows.iter().map(|row| &row.data).collect();
    let csv_text = render_csv_text(&header, &row_values)?;
    let mut builder = FileChangeSetBuilder::new_with_lock(Path::new(&mod_root), write_lock)?;
    let mut json = JsonWriteBatch::new(options);
    builder.text_file(&rel_path, Some(csv_text.clone()))?;
    for spec in &associated_specs {
        let current = super::super::query::entity_targets::describe_entity_target(
            &mut session,
            spec.target.kind,
            &spec.target.id,
        )?;
        if current.target != spec.target {
            return Err(AppError::message(
                "spec.target_changed",
                "关联规格目标已变化",
            ));
        }
        add_associated_spec_change(&mut builder, table, &spec.change, &spec.target, &mut json)?;
    }
    json.finish()?;
    let changes = builder.apply()?;
    {
        let table_data = registered_session_table_mut(&mut session, table)?;
        table_data.rows = Some(rows);
        table_data.header = header;
        table_data.next_row_seq = next_row_seq;
        table_data.saved_text = Some(csv_text);
    }
    super::super::cache::refresh_faction_annotations(&mut session);
    let mut write_result: WriteResult<()> = WriteResult::new(changes, key_map, None);
    for spec in &associated_specs {
        let definition = associated_spec_definition(table).expect("associated format exists");
        let mut next = spec.target.clone();
        next.id = spec.change.id().to_string();
        next.write.rel_path = if spec.target.state == crate::models::EntityTargetState::Existing
            && matches!(spec.change, AssociatedSpecChange::Rename { .. })
        {
            crate::io::forward_slash_path(
                &Path::new(&spec.target.write.rel_path)
                    .with_file_name(format!("{}{}", next.id, definition.extension)),
            )
        } else if matches!(spec.change, AssociatedSpecChange::Delete { .. }) {
            spec.target.write.rel_path.clone()
        } else {
            definition.default_rel_path(&next.id)
        };
        next.write.path = Path::new(&mod_root)
            .join(&next.write.rel_path)
            .to_string_lossy()
            .to_string();
        next.state = if matches!(spec.change, AssociatedSpecChange::Delete { .. }) {
            crate::models::EntityTargetState::Create
        } else {
            crate::models::EntityTargetState::Existing
        };
        next.source =
            (next.state == crate::models::EntityTargetState::Existing).then(|| next.write.clone());
        next.linked_record = loaded_registered_csv_rows(&session, table)?
            .iter()
            .find(|row| row.data.get("id").and_then(Value::as_str) == Some(&next.id))
            .map(|row| crate::models::EntityLinkedRecord::Csv {
                table,
                row_key: row.row_key.clone(),
            });
        write_result
            .identity_changes
            .push(crate::models::EntityIdentityChange {
                before: spec.target.clone(),
                after: next,
            });
    }
    debug_assert!(
        write_result
            .invalidation
            .paths
            .iter()
            .all(|path| !path.is_empty())
    );
    debug_assert!(write_result.refreshed_entity().is_none());
    Ok(write_result)
}

fn apply_csv_row_patches(
    table: CsvTableKey,
    rows: &mut Vec<SessionCsvRow>,
    next_row_seq: &mut u64,
    patches: Vec<CsvRowPatch>,
) -> AppResult<Vec<CsvRowKeyMapping>> {
    let table_key = table.as_str();
    let mut key_map = Vec::new();
    for patch in patches {
        match patch.action {
            CsvRowPatchAction::Delete => {
                let index = rows
                    .iter()
                    .position(|row| row.row_key == patch.row_key)
                    .ok_or_else(|| {
                        AppError::message(
                            "table.row_key_unknown",
                            format!("CSV delete row key does not exist: {}", patch.row_key),
                        )
                    })?;
                rows.remove(index);
            }
            CsvRowPatchAction::Upsert => {
                if let Some(row) = rows.iter_mut().find(|row| row.row_key == patch.row_key) {
                    row.data = patch.row;
                } else if is_new_csv_row_key(table_key, &patch.row_key) {
                    let next_key = format!("{table_key}:row:{next_row_seq}");
                    *next_row_seq += 1;
                    key_map.push(CsvRowKeyMapping {
                        previous_key: patch.row_key,
                        next_key: next_key.clone(),
                        row_index: patch.insert_at.unwrap_or(rows.len()),
                    });
                    let index = patch.insert_at.unwrap_or(rows.len());
                    if index > rows.len() {
                        return Err(AppError::message(
                            "table.insert_position_invalid",
                            "CSV insertion position exceeds the current table",
                        ));
                    }
                    rows.insert(
                        index,
                        SessionCsvRow {
                            row_key: next_key,
                            data: patch.row,
                            faction_id: None,
                        },
                    );
                } else {
                    return Err(AppError::message(
                        "table.row_key_unknown",
                        format!("CSV upsert row key does not exist: {}", patch.row_key),
                    ));
                }
            }
        }
    }
    for mapping in &mut key_map {
        mapping.row_index = rows
            .iter()
            .position(|row| row.row_key == mapping.next_key)
            .expect("inserted row survives the submitted patch");
    }
    Ok(key_map)
}

fn is_new_csv_row_key(table_key: &str, row_key: &str) -> bool {
    let Some(rest) = row_key.strip_prefix(&format!("{table_key}:new:")) else {
        return false;
    };
    !rest.is_empty() && !rest.contains(':')
}

fn add_associated_spec_change(
    builder: &mut FileChangeSetBuilder,
    table: CsvTableKey,
    change: &AssociatedSpecChange,
    target: &crate::models::EntityEditTarget,
    json: &mut JsonWriteBatch,
) -> AppResult<()> {
    let definition = associated_spec_definition(table).ok_or_else(|| {
        AppError::message(
            "table.no_associated_spec",
            format!("CSV 表没有关联 spec 定义: {}", table.as_str()),
        )
    })?;
    let id = change.id();
    let id = crate::domain::config::validate_config_id(id, definition.invalid_id_message)?;
    if target.kind != definition.entity_kind {
        return Err(AppError::message(
            "table.associated_spec_kind_mismatch",
            "关联规格目标种类不属于本表",
        ));
    }
    let rel_path = if matches!(change, AssociatedSpecChange::Rename { .. }) {
        if target.state == crate::models::EntityTargetState::Existing {
            crate::io::forward_slash_path(
                &Path::new(&target.write.rel_path)
                    .with_file_name(format!("{id}{}", definition.extension)),
            )
        } else {
            definition.default_rel_path(id)
        }
    } else {
        target.write.rel_path.clone()
    };
    match change {
        AssociatedSpecChange::Create { create } => {
            if target.id != id || target.state != crate::models::EntityTargetState::Create {
                return Err(AppError::message("spec.target_exists", "关联规格已存在"));
            }
            if builder.root().join(&rel_path).exists() {
                return Err(AppError::message(
                    "spec.target_exists",
                    format!("关联文件已存在: {rel_path}"),
                ));
            }
            builder.text_file(rel_path, Some(default_associated_spec_text(table, create)?))?;
        }
        AssociatedSpecChange::Delete { .. } => {
            builder.text_file(&target.write.rel_path, None)?;
        }
        AssociatedSpecChange::Rename {
            previous_id,
            create,
        } => {
            if builder.root().join(&rel_path).exists()
                && !crate::io::same_physical_path(
                    &builder.root().join(&target.write.rel_path),
                    &builder.root().join(&rel_path),
                )
            {
                return Err(AppError::message(
                    "spec.target_exists",
                    format!("关联目标已存在: {rel_path}"),
                ));
            }
            let previous_id = crate::domain::config::validate_config_id(
                previous_id,
                definition.invalid_id_message,
            )?;
            if target.id != previous_id {
                return Err(AppError::message(
                    "spec.path_id_mismatch",
                    "关联规格源身份不一致",
                ));
            }
            let previous_rel_path = target.write.rel_path.clone();
            let previous_full = builder.root().join(&previous_rel_path);
            let content = if previous_full.exists() {
                rewrite_associated_spec_id(
                    table,
                    definition.id_field,
                    &previous_full,
                    previous_id,
                    id,
                    json,
                )?
            } else {
                default_associated_spec_text(table, create)?
            };
            if previous_full.exists() {
                builder.rename_text_file(&previous_rel_path, &rel_path, content)?;
            } else {
                builder.text_file(definition.default_rel_path(id), Some(content))?;
            }
        }
    }
    Ok(())
}

fn default_associated_spec_text(
    table: CsvTableKey,
    params: &AssociatedSpecCreateParams,
) -> AppResult<String> {
    if params.table() != table {
        return Err(AppError::message(
            "table.associated_spec_kind_mismatch",
            "associated spec create parameters must belong to the saved CSV table",
        ));
    }
    serde_json::to_string_pretty(&create_associated_spec(params)).map_err(AppError::from)
}

fn rewrite_associated_spec_id(
    table: CsvTableKey,
    id_field: &str,
    path: &Path,
    previous_id: &str,
    new_id: &str,
    json: &mut JsonWriteBatch,
) -> AppResult<String> {
    let mut value = read_json_file(path)?;
    if value.get(id_field).and_then(Value::as_str) != Some(previous_id) {
        return Err(AppError::message(
            "spec.path_id_mismatch",
            format!("关联规格源 ID 已变化: {}", path.display()),
        ));
    }
    let Some(object) = value.as_object_mut() else {
        return Err(AppError::message(
            "spec.file_not_object",
            format!("关联 spec 文件不是 JSON object: {}", path.display()),
        ));
    };
    object.insert(id_field.to_string(), Value::String(new_id.to_string()));
    if table == CsvTableKey::Weapons {
        validate_weapon_spec_class(&value, path)?;
    }
    json.render(path, &value, None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;

    #[test]
    fn all_associated_formats_save_and_replay_with_business_columns_preserved() {
        use crate::models::{FileChangeReplayDirection, WeaponSpecClass};
        let cases = [
            AssociatedSpecCreateParams::Ship {
                id: "ship".into(),
                hull_name: "Ship".into(),
            },
            AssociatedSpecCreateParams::Weapon {
                id: "projectile".into(),
                spec_class: WeaponSpecClass::Projectile,
            },
            AssociatedSpecCreateParams::Weapon {
                id: "beam".into(),
                spec_class: WeaponSpecClass::Beam,
            },
            AssociatedSpecCreateParams::System {
                id: "system".into(),
            },
            AssociatedSpecCreateParams::Skill { id: "skill".into() },
        ];
        for create in cases {
            let root = temp_dir("associated_format_business_replay");
            let table = create.table();
            let definition = associated_spec_definition(table).unwrap();
            let csv_rel = super::super::super::model::csv_table_spec(table).rel_path;
            let csv_path = root.join(csv_rel);
            std::fs::create_dir_all(csv_path.parent().unwrap()).unwrap();
            let before = "id,name,_rowKey,_faction,_insertAt,_sourceRowIndex\n";
            write_utf8_no_bom(&csv_path, before).unwrap();
            let mut trace =
                crate::services::project::performance::PerformanceTrace::new("project.openSession");
            let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
            let content = serde_json::json!({"id":create.id(),"name":"Name","_rowKey":"business-key","_faction":"business-faction","_insertAt":"001","_sourceRowIndex":"02"});
            let expected = create_associated_spec(&create);
            let spec_path = root.join(definition.default_rel_path(create.id()));
            let saved = save_csv_patch(
                &manifest.session_id,
                table,
                vec![CsvRowPatch {
                    insert_at: None,
                    row_key: format!("{}:new:1", table.as_str()),
                    action: CsvRowPatchAction::Upsert,
                    row: content.as_object().unwrap().clone(),
                }],
                vec![AssociatedSpecChange::Create { create }],
            )
            .unwrap();
            assert_eq!(saved.changes.len(), 2);
            assert_eq!(read_json_file(&spec_path).unwrap(), expected);
            let window = query_csv_table_window(
                &manifest.session_id,
                table,
                0,
                10,
                None,
                CsvFactionFilter::All,
            )
            .unwrap();
            assert_eq!(window.rows[0].data, *content.as_object().unwrap());
            assert_ne!(window.rows[0].row_key, "business-key");
            let csv = read_utf8_no_bom(&csv_path).unwrap();
            crate::services::file_changes::apply_file_change_set(
                &root.to_string_lossy(),
                FileChangeReplayDirection::Undo,
                saved.changes.clone(),
            )
            .unwrap();
            assert_eq!(read_utf8_no_bom(&csv_path).unwrap(), before);
            assert!(!spec_path.exists());
            crate::services::file_changes::apply_file_change_set(
                &root.to_string_lossy(),
                FileChangeReplayDirection::Redo,
                saved.changes,
            )
            .unwrap();
            assert_eq!(read_utf8_no_bom(&csv_path).unwrap(), csv);
            assert_eq!(read_json_file(&spec_path).unwrap(), expected);
            close_project_session(manifest.session_id).unwrap();
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn command_renames_nested_associated_targets_and_replays_case_only_names() {
        use crate::models::{EntityKind, FileChangeReplayDirection, WeaponSpecClass};
        use crate::services::{project, write_transactions};
        for next_id in ["Next", "demo"] {
            let root = temp_dir("csv_nested_identity_command");
            let directory = root.join("data/weapons/nested");
            std::fs::create_dir_all(&directory).unwrap();
            let csv_path = root.join("data/weapons/weapon_data.csv");
            write_utf8_no_bom(&csv_path, "id,custom\nDemo,keep\n").unwrap();
            write_utf8_no_bom(
                &directory.join("Demo.wpn"),
                "{id:'Demo',specClass:'projectile',custom:{'_key':1}}\n",
            )
            .unwrap();
            let mut trace = project::PerformanceTrace::new("project.openSession");
            let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
            let info =
                project::query_entity_edit_target(&manifest.session_id, EntityKind::Weapon, "Demo")
                    .unwrap();
            let intent =
                project::query_entity_identity_intent(&manifest.session_id, &info.target, next_id)
                    .unwrap();
            let window = query_csv_table_window(
                &manifest.session_id,
                CsvTableKey::Weapons,
                0,
                10,
                None,
                CsvFactionFilter::All,
            )
            .unwrap();
            let mut row = window.rows[0].data.clone();
            row.insert("id".into(), Value::String(next_id.to_string()));
            let mut base_versions = info.base_versions;
            if !base_versions.iter().any(|version| {
                crate::io::same_physical_path(
                    Path::new(&version.path),
                    Path::new(&intent.destination_version.path),
                )
            }) {
                base_versions.push(intent.destination_version);
            }
            let saved = crate::commands::save_csv_patch(
                crate::models::command_payloads::SaveCsvPatchPayload {
                    session_id: manifest.session_id.clone(),
                    mod_root: manifest.mod_root.clone(),
                    base_versions,
                    table: CsvTableKey::Weapons,
                    patches: vec![CsvRowPatch {
                        row_key: window.rows[0].row_key.clone(),
                        insert_at: None,
                        action: CsvRowPatchAction::Upsert,
                        row,
                    }],
                    associated_specs: vec![AssociatedSpecWrite {
                        target: info.target,
                        change: AssociatedSpecChange::Rename {
                            previous_id: "Demo".into(),
                            create: AssociatedSpecCreateParams::Weapon {
                                id: next_id.into(),
                                spec_class: WeaponSpecClass::Projectile,
                            },
                        },
                    }],
                    json_write: Default::default(),
                },
            )
            .unwrap();
            let actual_name = || {
                std::fs::read_dir(&directory)
                    .unwrap()
                    .next()
                    .unwrap()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .to_string()
            };
            assert_eq!(actual_name(), format!("{next_id}.wpn"));
            assert_eq!(
                read_json_file(&directory.join(format!("{next_id}.wpn"))).unwrap()["custom"]["_key"],
                1
            );
            assert_eq!(
                crate::io::read_csv_data(&csv_path).unwrap().rows[0]["custom"],
                "keep"
            );
            let next = project::query_entity_edit_target(
                &manifest.session_id,
                EntityKind::Weapon,
                next_id,
            )
            .unwrap();
            assert_eq!(saved.base_versions, next.base_versions);
            assert_eq!(saved.identity_changes[0].after, next.target);
            let undone = write_transactions::replay(
                &manifest.session_id,
                &manifest.mod_root,
                FileChangeReplayDirection::Undo,
                saved.history.undo_stack[0].id,
                saved.history.revision,
            )
            .unwrap();
            assert_eq!(actual_name(), "Demo.wpn");
            assert_eq!(
                crate::io::read_csv_data(&csv_path).unwrap().rows[0]["id"],
                "Demo"
            );
            write_transactions::replay(
                &manifest.session_id,
                &manifest.mod_root,
                FileChangeReplayDirection::Redo,
                undone.history.redo_stack[0].id,
                undone.history.revision,
            )
            .unwrap();
            assert_eq!(actual_name(), format!("{next_id}.wpn"));
            close_project_session(manifest.session_id).unwrap();
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn pulse_associated_rename_rejects_the_whole_csv_changeset() {
        let root = temp_dir("pulse_associated_rename");
        std::fs::create_dir_all(root.join("data/weapons")).unwrap();
        let csv_path = root.join("data/weapons/weapon_data.csv");
        let spec_path = root.join("data/weapons/old.wpn");
        let csv = "id,name\nold,Old\n";
        let spec = r#"{"id":"old","specClass":"pulse","nested":{"_field":1}}"#;
        write_utf8_no_bom(&csv_path, csv).unwrap();
        write_utf8_no_bom(&spec_path, spec).unwrap();
        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let window = query_csv_table_window(
            &manifest.session_id,
            CsvTableKey::Weapons,
            0,
            10,
            None,
            CsvFactionFilter::All,
        )
        .unwrap();
        let error = save_csv_patch(
            &manifest.session_id,
            CsvTableKey::Weapons,
            vec![CsvRowPatch {
                insert_at: None,
                row_key: window.rows[0].row_key.clone(),
                action: CsvRowPatchAction::Upsert,
                row: row_with_id("id", "new"),
            }],
            vec![AssociatedSpecChange::Rename {
                previous_id: "old".into(),
                create: AssociatedSpecCreateParams::Weapon {
                    id: "new".into(),
                    spec_class: crate::models::WeaponSpecClass::Beam,
                },
            }],
        )
        .unwrap_err();
        assert_eq!(error.code(), "spec.weapon_class_unsupported");
        assert_eq!(read_utf8_no_bom(&csv_path).unwrap(), csv);
        assert_eq!(read_utf8_no_bom(&spec_path).unwrap(), spec);
        assert!(!root.join("data/weapons/new.wpn").exists());
        close_project_session(manifest.session_id).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
    use crate::{
        io::{read_utf8_no_bom, write_utf8_no_bom},
        models::{
            AssociatedSpecChange, AssociatedSpecCreateParams, CsvFactionFilter, CsvRowPatch,
            CsvRowPatchAction, FileChangeKind,
        },
        services::project::{
            query::query_csv_table_window,
            session::{close_project_session, open_project_session_traced},
        },
    };
    use serde_json::{Map, Value};
    use std::path::Path;

    #[test]
    fn save_csv_patch_creates_associated_spec_in_one_changeset() {
        let root = temp_dir("save_csv_patch_create_assoc");
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();
        write_utf8_no_bom(&root.join("data/hulls/ship_data.csv"), "id,name\r\n").unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let mut row = Map::new();
        row.insert("id".to_string(), Value::String("new_ship".to_string()));
        row.insert("name".to_string(), Value::String("New Ship".to_string()));
        let session_id = manifest.session_id.clone();
        let result = save_csv_patch(
            &session_id,
            CsvTableKey::Ships,
            vec![CsvRowPatch {
                insert_at: None,
                row_key: "ships:new:1".to_string(),
                action: CsvRowPatchAction::Upsert,
                row: row.clone(),
            }],
            vec![AssociatedSpecChange::Create {
                create: AssociatedSpecCreateParams::Ship {
                    id: "new_ship".to_string(),
                    hull_name: "New Ship".to_string(),
                },
            }],
        )
        .unwrap();

        let csv = read_utf8_no_bom(&root.join("data/hulls/ship_data.csv")).unwrap();
        let spec = read_utf8_no_bom(&root.join("data/hulls/new_ship.ship")).unwrap();
        let expected_paths = [
            path_string(root.join("data/hulls/ship_data.csv")),
            path_string(root.join("data/hulls/new_ship.ship")),
        ];

        let _ = close_project_session(session_id);
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(change_paths(&result.changes), expected_paths);
        assert_eq!(result.invalidation.paths, change_paths(&result.changes));
        assert!(matches!(result.changes[0].kind, FileChangeKind::File));
        assert!(matches!(result.changes[1].kind, FileChangeKind::File));
        assert_eq!(result.key_map[0].previous_key, "ships:new:1");
        assert!(csv.contains("new_ship,New Ship"));
        assert!(spec.contains("\"hullId\": \"new_ship\""));
    }

    #[test]
    fn save_refresh_preserves_surviving_and_new_row_keys_across_followup_saves() {
        let root = temp_dir("csv_save_refresh_row_keys");
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/ship_data.csv"),
            "id,name\na,A\nb,B\nc,C\n#note,Keep\n,No ID\nb,Duplicate\n",
        )
        .unwrap();
        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let window = query_csv_table_window(
            &manifest.session_id,
            CsvTableKey::Ships,
            0,
            20,
            None,
            CsvFactionFilter::All,
        )
        .unwrap();
        let survivor_key = window.rows[1].row_key.clone();
        let comment_key = window.rows[3].row_key.clone();
        let empty_id_key = window.rows[4].row_key.clone();
        let duplicate_key = window.rows[5].row_key.clone();
        let result = save_csv_patch(
            &manifest.session_id,
            CsvTableKey::Ships,
            vec![
                CsvRowPatch {
                    insert_at: None,
                    row_key: window.rows[0].row_key.clone(),
                    action: CsvRowPatchAction::Delete,
                    row: Map::new(),
                },
                CsvRowPatch {
                    insert_at: None,
                    row_key: "ships:new:0".to_string(),
                    action: CsvRowPatchAction::Upsert,
                    row: row_with_id("id", "d"),
                },
            ],
            Vec::new(),
        )
        .unwrap();
        let new_key = result.key_map[0].next_key.clone();
        crate::services::project::session::invalidate_project_session(
            &manifest.session_id,
            result.changes,
        )
        .unwrap();
        let window = query_csv_table_window(
            &manifest.session_id,
            CsvTableKey::Ships,
            0,
            20,
            None,
            CsvFactionFilter::All,
        )
        .unwrap();
        assert_eq!(window.rows[0].row_key, survivor_key);
        assert_eq!(window.rows[2].row_key, comment_key);
        assert_eq!(window.rows[3].row_key, empty_id_key);
        assert_eq!(window.rows[4].row_key, duplicate_key);
        assert_eq!(window.rows[5].row_key, new_key);
        let result = save_csv_patch(
            &manifest.session_id,
            CsvTableKey::Ships,
            vec![CsvRowPatch {
                insert_at: None,
                row_key: survivor_key,
                action: CsvRowPatchAction::Upsert,
                row: row_with_id("id", "b2"),
            }],
            Vec::new(),
        )
        .unwrap();
        crate::services::project::session::invalidate_project_session(
            &manifest.session_id,
            result.changes,
        )
        .unwrap();
        let window = query_csv_table_window(
            &manifest.session_id,
            CsvTableKey::Ships,
            0,
            20,
            None,
            CsvFactionFilter::All,
        )
        .unwrap();
        assert_eq!(window.rows[0].data["id"], "b2");
        assert_eq!(window.rows[1].data["id"], "c");
        assert_eq!(window.rows[4].data["id"], "b");
        assert_eq!(window.rows[4].row_key, duplicate_key);
        assert_eq!(window.rows[5].row_key, new_key);
        close_project_session(manifest.session_id).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn save_csv_patch_deletes_associated_spec_in_one_changeset() {
        let root = temp_dir("save_csv_patch_delete_assoc");
        std::fs::create_dir_all(root.join("data/weapons")).unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/weapon_data.csv"),
            "id,name\r\nold_weapon,Old Weapon\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/old_weapon.wpn"),
            "{\r\n  \"id\": \"old_weapon\"\r\n}",
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let window = query_csv_table_window(
            &manifest.session_id,
            CsvTableKey::Weapons,
            0,
            10,
            None,
            CsvFactionFilter::All,
        )
        .unwrap();
        let result = save_csv_patch(
            &manifest.session_id,
            CsvTableKey::Weapons,
            vec![CsvRowPatch {
                insert_at: None,
                row_key: window.rows[0].row_key.clone(),
                action: CsvRowPatchAction::Delete,
                row: Map::new(),
            }],
            vec![AssociatedSpecChange::Delete {
                id: "old_weapon".to_string(),
            }],
        )
        .unwrap();

        let csv = read_utf8_no_bom(&root.join("data/weapons/weapon_data.csv")).unwrap();
        let spec_exists = root.join("data/weapons/old_weapon.wpn").exists();
        let expected_paths = [
            path_string(root.join("data/weapons/weapon_data.csv")),
            path_string(root.join("data/weapons/old_weapon.wpn")),
        ];

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(change_paths(&result.changes), expected_paths);
        assert_eq!(result.invalidation.paths, change_paths(&result.changes));
        assert!(!result.changes[1].after_exists);
        assert!(!csv.contains("old_weapon,Old Weapon"));
        assert!(!spec_exists);
    }

    #[test]
    fn save_csv_patch_renames_associated_spec_through_json_parser() {
        let root = temp_dir("save_csv_patch_rename_assoc_parser");
        std::fs::create_dir_all(root.join("data/weapons")).unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/weapon_data.csv"),
            "id,name\r\nold_weapon,Old Weapon\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/old_weapon.wpn"),
            "{\r\n  specClass: projectile, id: 'old_weapon',\r\n  weaponType: BALLISTIC,\r\n}\r\n",
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let window = query_csv_table_window(
            &manifest.session_id,
            CsvTableKey::Weapons,
            0,
            10,
            None,
            CsvFactionFilter::All,
        )
        .unwrap();
        let mut row = window.rows[0].data.clone();
        row.insert("id".to_string(), Value::String("new_weapon".to_string()));
        let result = save_csv_patch(
            &manifest.session_id,
            CsvTableKey::Weapons,
            vec![CsvRowPatch {
                insert_at: None,
                row_key: window.rows[0].row_key.clone(),
                action: CsvRowPatchAction::Upsert,
                row,
            }],
            vec![AssociatedSpecChange::Rename {
                previous_id: "old_weapon".to_string(),
                create: AssociatedSpecCreateParams::Weapon {
                    id: "new_weapon".to_string(),
                    spec_class: crate::models::WeaponSpecClass::Projectile,
                },
            }],
        )
        .unwrap();

        let renamed = read_utf8_no_bom(&root.join("data/weapons/new_weapon.wpn")).unwrap();
        let expected_paths = [
            path_string(root.join("data/weapons/weapon_data.csv")),
            path_string(root.join("data/weapons/old_weapon.wpn")),
            path_string(root.join("data/weapons/new_weapon.wpn")),
        ];

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(change_paths(&result.changes), expected_paths);
        assert_eq!(result.invalidation.paths, change_paths(&result.changes));
        assert!(result.changes[1].before_exists);
        assert!(result.changes[1].after_exists);
        assert!(!renamed.contains("old_weapon"));
        assert!(renamed.contains("\"id\": \"new_weapon\""));
        assert!(renamed.contains("\"weaponType\": \"BALLISTIC\""));
    }

    #[test]
    fn csv_associated_rename_preserves_spec_comments() {
        let root = temp_dir("csv_associated_rename_preserves_json");
        std::fs::create_dir_all(root.join("data/weapons")).unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/weapon_data.csv"),
            "id,name\nold_weapon,Old Weapon\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/old_weapon.wpn"),
            "{\n  # note\n  weaponType: BALLISTIC,\n  specClass: projectile, id: 'old_weapon'\n}\n",
        )
        .unwrap();
        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let window = query_csv_table_window(
            &manifest.session_id,
            CsvTableKey::Weapons,
            0,
            10,
            None,
            CsvFactionFilter::All,
        )
        .unwrap();
        let mut row = window.rows[0].data.clone();
        row.insert("id".to_string(), Value::String("new_weapon".to_string()));
        let result = save_csv_patch_with_json_options(
            &manifest.session_id,
            CsvTableKey::Weapons,
            vec![CsvRowPatch {
                insert_at: None,
                row_key: window.rows[0].row_key.clone(),
                action: CsvRowPatchAction::Upsert,
                row,
            }],
            vec![AssociatedSpecChange::Rename {
                previous_id: "old_weapon".to_string(),
                create: AssociatedSpecCreateParams::Weapon {
                    id: "new_weapon".to_string(),
                    spec_class: crate::models::WeaponSpecClass::Projectile,
                },
            }],
            crate::models::JsonWriteOptions {
                preserve_original_json: true,
                confirmed_sources: Vec::new(),
            },
        )
        .unwrap();
        let renamed = read_utf8_no_bom(&root.join("data/weapons/new_weapon.wpn")).unwrap();
        assert_eq!(result.changes.len(), 2);
        assert!(renamed.contains("# note"));
        assert!(renamed.find("weaponType").unwrap() < renamed.find("id:").unwrap());
        assert!(!root.join("data/weapons/old_weapon.wpn").exists());
        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn csv_and_spec_remain_unchanged_before_rewrite_confirmation() {
        let root = temp_dir("csv_spec_rewrite_confirmation");
        std::fs::create_dir_all(root.join("data/weapons")).unwrap();
        let csv_path = root.join("data/weapons/weapon_data.csv");
        let spec_path = root.join("data/weapons/old_weapon.wpn");
        let csv_before = "id,name\nold_weapon,Old Weapon\n";
        let spec_before = "{id:'old_weapon', specClass:projectile, arr:[1,,2]}\n";
        write_utf8_no_bom(&csv_path, csv_before).unwrap();
        write_utf8_no_bom(&spec_path, spec_before).unwrap();
        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let window = query_csv_table_window(
            &manifest.session_id,
            CsvTableKey::Weapons,
            0,
            10,
            None,
            CsvFactionFilter::All,
        )
        .unwrap();
        let mut row = window.rows[0].data.clone();
        row.insert("id".to_string(), Value::String("new_weapon".to_string()));
        let result = save_csv_patch_with_json_options(
            &manifest.session_id,
            CsvTableKey::Weapons,
            vec![CsvRowPatch {
                insert_at: None,
                row_key: window.rows[0].row_key.clone(),
                action: CsvRowPatchAction::Upsert,
                row,
            }],
            vec![AssociatedSpecChange::Rename {
                previous_id: "old_weapon".to_string(),
                create: AssociatedSpecCreateParams::Weapon {
                    id: "new_weapon".to_string(),
                    spec_class: crate::models::WeaponSpecClass::Projectile,
                },
            }],
            crate::models::JsonWriteOptions {
                preserve_original_json: true,
                confirmed_sources: Vec::new(),
            },
        );
        assert!(matches!(result, Err(AppError::JsonRewriteRequired { .. })));
        assert_eq!(read_utf8_no_bom(&csv_path).unwrap(), csv_before);
        assert_eq!(read_utf8_no_bom(&spec_path).unwrap(), spec_before);
        assert!(!root.join("data/weapons/new_weapon.wpn").exists());
        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn save_csv_patch_rename_missing_source_uses_registered_default_spec() {
        let root = temp_dir("save_csv_patch_rename_missing_content");
        std::fs::create_dir_all(root.join("data/weapons")).unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/weapon_data.csv"),
            "id,name\r\nold_weapon,Old Weapon\r\n",
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let window = query_csv_table_window(
            &manifest.session_id,
            CsvTableKey::Weapons,
            0,
            10,
            None,
            CsvFactionFilter::All,
        )
        .unwrap();
        let mut row = window.rows[0].data.clone();
        row.insert("id".to_string(), Value::String("new_weapon".to_string()));
        let result = save_csv_patch(
            &manifest.session_id,
            CsvTableKey::Weapons,
            vec![CsvRowPatch {
                insert_at: None,
                row_key: window.rows[0].row_key.clone(),
                action: CsvRowPatchAction::Upsert,
                row,
            }],
            vec![AssociatedSpecChange::Rename {
                previous_id: "missing".to_string(),
                create: AssociatedSpecCreateParams::Weapon {
                    id: "new_weapon".to_string(),
                    spec_class: crate::models::WeaponSpecClass::Projectile,
                },
            }],
        )
        .unwrap();
        let created = read_utf8_no_bom(&root.join("data/weapons/new_weapon.wpn")).unwrap();
        let expected_paths = [
            path_string(root.join("data/weapons/weapon_data.csv")),
            path_string(root.join("data/weapons/new_weapon.wpn")),
        ];

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(change_paths(&result.changes), expected_paths);
        assert_eq!(result.invalidation.paths, change_paths(&result.changes));
        assert!(!result.changes[1].before_exists);
        assert!(result.changes[1].after_exists);
        assert!(created.contains("\"id\": \"new_weapon\""));
    }

    #[test]
    fn save_csv_patch_rejects_unknown_non_new_row_key() {
        let root = temp_dir("save_csv_patch_unknown_row_key");
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();
        write_utf8_no_bom(&root.join("data/hulls/ship_data.csv"), "id,name\r\n").unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let mut row = Map::new();
        row.insert("id".to_string(), Value::String("new_ship".to_string()));
        let error = save_csv_patch(
            &manifest.session_id,
            CsvTableKey::Ships,
            vec![CsvRowPatch {
                insert_at: None,
                row_key: "ships:row:missing:new:1".to_string(),
                action: CsvRowPatchAction::Upsert,
                row,
            }],
            Vec::new(),
        )
        .unwrap_err()
        .to_string();

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(root);
        assert!(error.contains("CSV upsert row key does not exist"));
    }

    #[test]
    fn apply_csv_row_patches_allocates_uncolliding_key_after_delete() {
        let mut rows = vec![
            SessionCsvRow {
                row_key: "ships:row:0".to_string(),
                data: row_with_id("id", "a"),
                faction_id: None,
            },
            SessionCsvRow {
                row_key: "ships:row:1".to_string(),
                data: row_with_id("id", "b"),
                faction_id: None,
            },
        ];
        let mut next_row_seq = 2;

        let key_map = apply_csv_row_patches(
            CsvTableKey::Ships,
            &mut rows,
            &mut next_row_seq,
            vec![
                CsvRowPatch {
                    insert_at: None,
                    row_key: "ships:row:0".to_string(),
                    action: CsvRowPatchAction::Delete,
                    row: Map::new(),
                },
                CsvRowPatch {
                    insert_at: None,
                    row_key: "ships:new:1".to_string(),
                    action: CsvRowPatchAction::Upsert,
                    row: row_with_id("id", "c"),
                },
            ],
        )
        .unwrap();

        assert_eq!(key_map.len(), 1);
        assert_eq!(key_map[0].previous_key, "ships:new:1");
        assert_eq!(key_map[0].next_key, "ships:row:2");
        assert_eq!(row_keys(&rows), vec!["ships:row:1", "ships:row:2"]);
        assert_eq!(next_row_seq, 3);
    }

    #[test]
    fn apply_csv_row_patches_updates_surviving_row_after_delete_without_new_keys() {
        let mut rows = vec![
            SessionCsvRow {
                row_key: "ships:row:0".to_string(),
                data: row_with_id("id", "a"),
                faction_id: None,
            },
            SessionCsvRow {
                row_key: "ships:row:1".to_string(),
                data: row_with_id("id", "b"),
                faction_id: None,
            },
        ];
        let mut next_row_seq = 2;

        let key_map = apply_csv_row_patches(
            CsvTableKey::Ships,
            &mut rows,
            &mut next_row_seq,
            vec![
                CsvRowPatch {
                    insert_at: None,
                    row_key: "ships:row:0".to_string(),
                    action: CsvRowPatchAction::Delete,
                    row: Map::new(),
                },
                CsvRowPatch {
                    insert_at: None,
                    row_key: "ships:row:1".to_string(),
                    action: CsvRowPatchAction::Upsert,
                    row: row_with_id("id", "b2"),
                },
            ],
        )
        .unwrap();

        assert!(key_map.is_empty());
        assert_eq!(next_row_seq, 2);
        assert_eq!(row_keys(&rows), vec!["ships:row:1"]);
        assert_eq!(rows[0].data["id"], "b2");
    }

    #[test]
    fn apply_csv_row_patches_keeps_keys_unique_across_interleaved_patches() {
        let mut rows = vec![
            SessionCsvRow {
                row_key: "ships:row:0".to_string(),
                data: row_with_id("id", "a"),
                faction_id: None,
            },
            SessionCsvRow {
                row_key: "ships:row:1".to_string(),
                data: row_with_id("id", "b"),
                faction_id: None,
            },
        ];
        let mut next_row_seq = 2;

        let key_map = apply_csv_row_patches(
            CsvTableKey::Ships,
            &mut rows,
            &mut next_row_seq,
            vec![
                CsvRowPatch {
                    insert_at: None,
                    row_key: "ships:new:1".to_string(),
                    action: CsvRowPatchAction::Upsert,
                    row: row_with_id("id", "c"),
                },
                CsvRowPatch {
                    insert_at: None,
                    row_key: "ships:row:1".to_string(),
                    action: CsvRowPatchAction::Delete,
                    row: Map::new(),
                },
                CsvRowPatch {
                    insert_at: None,
                    row_key: "ships:new:2".to_string(),
                    action: CsvRowPatchAction::Upsert,
                    row: row_with_id("id", "d"),
                },
            ],
        )
        .unwrap();

        let allocated: Vec<&str> = key_map
            .iter()
            .map(|mapping| mapping.next_key.as_str())
            .collect();
        assert_eq!(allocated, vec!["ships:row:2", "ships:row:3"]);
        let mut all_keys = row_keys(&rows);
        all_keys.sort_unstable();
        assert_eq!(all_keys, vec!["ships:row:0", "ships:row:2", "ships:row:3"]);
    }

    #[test]
    fn apply_csv_row_patches_does_not_reset_keys_after_full_table_delete() {
        let mut rows = vec![
            SessionCsvRow {
                row_key: "ships:row:0".to_string(),
                data: row_with_id("id", "a"),
                faction_id: None,
            },
            SessionCsvRow {
                row_key: "ships:row:1".to_string(),
                data: row_with_id("id", "b"),
                faction_id: None,
            },
        ];
        let mut next_row_seq = 2;

        let key_map = apply_csv_row_patches(
            CsvTableKey::Ships,
            &mut rows,
            &mut next_row_seq,
            vec![
                CsvRowPatch {
                    insert_at: None,
                    row_key: "ships:row:0".to_string(),
                    action: CsvRowPatchAction::Delete,
                    row: Map::new(),
                },
                CsvRowPatch {
                    insert_at: None,
                    row_key: "ships:row:1".to_string(),
                    action: CsvRowPatchAction::Delete,
                    row: Map::new(),
                },
                CsvRowPatch {
                    insert_at: None,
                    row_key: "ships:new:1".to_string(),
                    action: CsvRowPatchAction::Upsert,
                    row: row_with_id("id", "c"),
                },
                CsvRowPatch {
                    insert_at: None,
                    row_key: "ships:new:2".to_string(),
                    action: CsvRowPatchAction::Upsert,
                    row: row_with_id("id", "d"),
                },
            ],
        )
        .unwrap();

        let allocated: Vec<&str> = key_map
            .iter()
            .map(|mapping| mapping.next_key.as_str())
            .collect();
        assert_eq!(allocated, vec!["ships:row:2", "ships:row:3"]);
        assert_eq!(row_keys(&rows), vec!["ships:row:2", "ships:row:3"]);
        assert_eq!(next_row_seq, 4);
    }

    fn row_keys(rows: &[SessionCsvRow]) -> Vec<&str> {
        rows.iter().map(|row| row.row_key.as_str()).collect()
    }

    fn row_with_id(field: &str, id: &str) -> Map<String, Value> {
        let mut row = Map::new();
        row.insert(field.to_string(), Value::String(id.to_string()));
        row
    }

    fn change_paths(changes: &[crate::models::FileChangeRecord]) -> Vec<String> {
        let mut paths = Vec::new();
        for change in changes {
            for path in [&change.before_path, &change.after_path] {
                if !paths.contains(path) {
                    paths.push(path.clone());
                }
            }
        }
        paths
    }

    fn path_string(path: impl AsRef<Path>) -> String {
        let path = path.as_ref();
        if let Ok(canonical) = path.canonicalize() {
            return canonical.to_string_lossy().to_string();
        }
        if let (Some(parent), Some(name)) = (path.parent(), path.file_name())
            && let Ok(canonical_parent) = parent.canonicalize()
        {
            return canonical_parent.join(name).to_string_lossy().to_string();
        }
        path.to_string_lossy().to_string()
    }
}
