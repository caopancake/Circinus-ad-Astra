use super::super::cache::{
    ensure_registered_table_rows, loaded_registered_csv_rows, lock_session,
    registered_session_table, registered_session_table_mut, session_handle,
};
use super::super::definitions::entity_definitions::associated_spec_definition;
use super::super::model::SessionCsvRow;
use crate::{
    errors::{AppError, AppResult},
    io::{FileChangeSetBuilder, JsonWriteBatch, read_json_file, strip_internal_fields},
    models::{
        AssociatedSpecChange, AssociatedSpecChangeAction, CsvRowKeyMapping, CsvRowPatch,
        CsvRowPatchAction, CsvTableKey, WriteResult,
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

pub fn save_csv_patch_with_json_options(
    session_id: &str,
    table: CsvTableKey,
    patches: Vec<CsvRowPatch>,
    associated_specs: Vec<AssociatedSpecChange>,
    options: crate::models::JsonWriteOptions,
) -> AppResult<WriteResult> {
    let handle = session_handle(session_id)?;
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
    let row_values: Vec<&Map<String, Value>> = rows.iter().map(|row| &row.row).collect();
    let csv_text = render_csv_text(&header, &row_values)?;
    let mut builder = FileChangeSetBuilder::new(Path::new(&mod_root))?;
    let mut json = JsonWriteBatch::new(options);
    builder.text_file(&rel_path, Some(csv_text))?;
    for spec in &associated_specs {
        add_associated_spec_change(&mut builder, table, spec, &mut json)?;
    }
    json.finish()?;
    let changes = builder.apply()?;
    {
        let table_data = registered_session_table_mut(&mut session, table)?;
        table_data.rows = Some(rows);
        table_data.header = header;
        table_data.next_row_seq = next_row_seq;
    }
    let write_result: WriteResult<()> = WriteResult::new(changes, key_map, None);
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
            CsvRowPatchAction::Delete => rows.retain(|row| row.row_key != patch.row_key),
            CsvRowPatchAction::Upsert => {
                if let Some(row) = rows.iter_mut().find(|row| row.row_key == patch.row_key) {
                    row.row = patch.row;
                } else if is_new_csv_row_key(table_key, &patch.row_key) {
                    let next_key = format!("{table_key}:row:{next_row_seq}");
                    *next_row_seq += 1;
                    key_map.push(CsvRowKeyMapping {
                        previous_key: patch.row_key,
                        next_key: next_key.clone(),
                    });
                    rows.push(SessionCsvRow {
                        row_key: next_key,
                        row: patch.row,
                    });
                } else {
                    return Err(AppError::message(
                        "table.row_key_unknown",
                        format!("CSV upsert row key does not exist: {}", patch.row_key),
                    ));
                }
            }
        }
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
    json: &mut JsonWriteBatch,
) -> AppResult<()> {
    let definition = associated_spec_definition(table).ok_or_else(|| {
        AppError::message(
            "table.no_associated_spec",
            format!("CSV 表没有关联 spec 定义: {}", table.as_str()),
        )
    })?;
    let rel_path = definition.default_rel_path(&change.id);
    match change.action {
        AssociatedSpecChangeAction::Create => {
            builder.text_file(
                rel_path,
                Some(default_associated_spec_text(
                    definition.id_field,
                    &change.id,
                    &change.row,
                )?),
            )?;
        }
        AssociatedSpecChangeAction::Delete => {
            builder.text_file(rel_path, None)?;
        }
        AssociatedSpecChangeAction::Rename => {
            let previous_id = change.previous_id.as_deref().ok_or_else(|| {
                AppError::message(
                    "spec.rename_missing_previous_id",
                    format!("关联 spec 重命名缺少旧 ID: {}", change.id),
                )
            })?;
            let previous_rel_path = definition.default_rel_path(previous_id);
            let previous_full = builder.root().join(&previous_rel_path);
            let content = if previous_full.exists() {
                rewrite_associated_spec_id(definition.id_field, &previous_full, &change.id, json)?
            } else {
                default_associated_spec_text(definition.id_field, &change.id, &change.row)?
            };
            builder.text_file(previous_rel_path, None)?;
            builder.text_file(rel_path, Some(content))?;
        }
    }
    Ok(())
}

fn default_associated_spec_text(
    id_field: &str,
    id: &str,
    row: &Map<String, Value>,
) -> AppResult<String> {
    let mut value = strip_internal_fields(&Value::Object(row.clone()));
    let Some(object) = value.as_object_mut() else {
        return Err(AppError::message(
            "spec.default_data_not_object",
            "关联 spec 默认数据不是 JSON object",
        ));
    };
    object.insert(id_field.to_string(), Value::String(id.to_string()));
    serde_json::to_string_pretty(&value).map_err(AppError::from)
}

fn rewrite_associated_spec_id(
    id_field: &str,
    path: &Path,
    new_id: &str,
    json: &mut JsonWriteBatch,
) -> AppResult<String> {
    let mut value = strip_internal_fields(&read_json_file(path)?);
    let Some(object) = value.as_object_mut() else {
        return Err(AppError::message(
            "spec.file_not_object",
            format!("关联 spec 文件不是 JSON object: {}", path.display()),
        ));
    };
    object.insert(id_field.to_string(), Value::String(new_id.to_string()));
    json.render(path, &value, None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;
    use crate::{
        io::{read_utf8_no_bom, write_utf8_no_bom},
        models::{
            AssociatedSpecChange, AssociatedSpecChangeAction, CsvFactionFilter, CsvRowPatch,
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
                row_key: "ships:new:1".to_string(),
                action: CsvRowPatchAction::Upsert,
                row: row.clone(),
            }],
            vec![AssociatedSpecChange {
                action: AssociatedSpecChangeAction::Create,
                id: "new_ship".to_string(),
                previous_id: None,
                row: row_with_id("id", "new_ship"),
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
                row_key: window.rows[0].row_key.clone(),
                action: CsvRowPatchAction::Delete,
                row: Map::new(),
            }],
            vec![AssociatedSpecChange {
                action: AssociatedSpecChangeAction::Delete,
                id: "old_weapon".to_string(),
                previous_id: None,
                row: Map::new(),
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
            "{\r\n  id: 'old_weapon',\r\n  weaponType: BALLISTIC,\r\n}\r\n",
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
        let mut row = window.rows[0].row.clone();
        row.insert("id".to_string(), Value::String("new_weapon".to_string()));
        let result = save_csv_patch(
            &manifest.session_id,
            CsvTableKey::Weapons,
            vec![CsvRowPatch {
                row_key: window.rows[0].row_key.clone(),
                action: CsvRowPatchAction::Upsert,
                row,
            }],
            vec![AssociatedSpecChange {
                action: AssociatedSpecChangeAction::Rename,
                id: "new_weapon".to_string(),
                previous_id: Some("old_weapon".to_string()),
                row: row_with_id("id", "new_weapon"),
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
        assert!(!result.changes[1].after_exists);
        assert!(result.changes[2].after_exists);
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
            "{\n  # note\n  weaponType: BALLISTIC,\n  id: 'old_weapon'\n}\n",
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
        let mut row = window.rows[0].row.clone();
        row.insert("id".to_string(), Value::String("new_weapon".to_string()));
        let result = save_csv_patch_with_json_options(
            &manifest.session_id,
            CsvTableKey::Weapons,
            vec![CsvRowPatch {
                row_key: window.rows[0].row_key.clone(),
                action: CsvRowPatchAction::Upsert,
                row,
            }],
            vec![AssociatedSpecChange {
                action: AssociatedSpecChangeAction::Rename,
                id: "new_weapon".to_string(),
                previous_id: Some("old_weapon".to_string()),
                row: row_with_id("id", "new_weapon"),
            }],
            crate::models::JsonWriteOptions {
                preserve_original_json: true,
                confirmed_sources: Vec::new(),
            },
        )
        .unwrap();
        let renamed = read_utf8_no_bom(&root.join("data/weapons/new_weapon.wpn")).unwrap();
        assert_eq!(result.changes.len(), 3);
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
        let spec_before = "{id:'old_weapon', arr:[1,,2]}\n";
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
        let mut row = window.rows[0].row.clone();
        row.insert("id".to_string(), Value::String("new_weapon".to_string()));
        let result = save_csv_patch_with_json_options(
            &manifest.session_id,
            CsvTableKey::Weapons,
            vec![CsvRowPatch {
                row_key: window.rows[0].row_key.clone(),
                action: CsvRowPatchAction::Upsert,
                row,
            }],
            vec![AssociatedSpecChange {
                action: AssociatedSpecChangeAction::Rename,
                id: "new_weapon".to_string(),
                previous_id: Some("old_weapon".to_string()),
                row: row_with_id("id", "new_weapon"),
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
        let mut row = window.rows[0].row.clone();
        row.insert("id".to_string(), Value::String("new_weapon".to_string()));
        let result = save_csv_patch(
            &manifest.session_id,
            CsvTableKey::Weapons,
            vec![CsvRowPatch {
                row_key: window.rows[0].row_key.clone(),
                action: CsvRowPatchAction::Upsert,
                row,
            }],
            vec![AssociatedSpecChange {
                action: AssociatedSpecChangeAction::Rename,
                id: "new_weapon".to_string(),
                previous_id: Some("missing".to_string()),
                row: row_with_id("id", "new_weapon"),
            }],
        )
        .unwrap();
        let created = read_utf8_no_bom(&root.join("data/weapons/new_weapon.wpn")).unwrap();
        let expected_paths = [
            path_string(root.join("data/weapons/weapon_data.csv")),
            path_string(root.join("data/weapons/missing.wpn")),
            path_string(root.join("data/weapons/new_weapon.wpn")),
        ];

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(change_paths(&result.changes), expected_paths);
        assert_eq!(result.invalidation.paths, change_paths(&result.changes));
        assert!(!result.changes[1].after_exists);
        assert!(result.changes[2].after_exists);
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
                row: row_with_id("id", "a"),
            },
            SessionCsvRow {
                row_key: "ships:row:1".to_string(),
                row: row_with_id("id", "b"),
            },
        ];
        let mut next_row_seq = 2;

        let key_map = apply_csv_row_patches(
            CsvTableKey::Ships,
            &mut rows,
            &mut next_row_seq,
            vec![
                CsvRowPatch {
                    row_key: "ships:row:0".to_string(),
                    action: CsvRowPatchAction::Delete,
                    row: Map::new(),
                },
                CsvRowPatch {
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
                row: row_with_id("id", "a"),
            },
            SessionCsvRow {
                row_key: "ships:row:1".to_string(),
                row: row_with_id("id", "b"),
            },
        ];
        let mut next_row_seq = 2;

        let key_map = apply_csv_row_patches(
            CsvTableKey::Ships,
            &mut rows,
            &mut next_row_seq,
            vec![
                CsvRowPatch {
                    row_key: "ships:row:0".to_string(),
                    action: CsvRowPatchAction::Delete,
                    row: Map::new(),
                },
                CsvRowPatch {
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
        assert_eq!(rows[0].row["id"], "b2");
    }

    #[test]
    fn apply_csv_row_patches_keeps_keys_unique_across_interleaved_patches() {
        let mut rows = vec![
            SessionCsvRow {
                row_key: "ships:row:0".to_string(),
                row: row_with_id("id", "a"),
            },
            SessionCsvRow {
                row_key: "ships:row:1".to_string(),
                row: row_with_id("id", "b"),
            },
        ];
        let mut next_row_seq = 2;

        let key_map = apply_csv_row_patches(
            CsvTableKey::Ships,
            &mut rows,
            &mut next_row_seq,
            vec![
                CsvRowPatch {
                    row_key: "ships:new:1".to_string(),
                    action: CsvRowPatchAction::Upsert,
                    row: row_with_id("id", "c"),
                },
                CsvRowPatch {
                    row_key: "ships:row:1".to_string(),
                    action: CsvRowPatchAction::Delete,
                    row: Map::new(),
                },
                CsvRowPatch {
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
                row: row_with_id("id", "a"),
            },
            SessionCsvRow {
                row_key: "ships:row:1".to_string(),
                row: row_with_id("id", "b"),
            },
        ];
        let mut next_row_seq = 2;

        let key_map = apply_csv_row_patches(
            CsvTableKey::Ships,
            &mut rows,
            &mut next_row_seq,
            vec![
                CsvRowPatch {
                    row_key: "ships:row:0".to_string(),
                    action: CsvRowPatchAction::Delete,
                    row: Map::new(),
                },
                CsvRowPatch {
                    row_key: "ships:row:1".to_string(),
                    action: CsvRowPatchAction::Delete,
                    row: Map::new(),
                },
                CsvRowPatch {
                    row_key: "ships:new:1".to_string(),
                    action: CsvRowPatchAction::Upsert,
                    row: row_with_id("id", "c"),
                },
                CsvRowPatch {
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
        changes.iter().map(|change| change.path.clone()).collect()
    }

    fn path_string(path: impl AsRef<Path>) -> String {
        let path = path.as_ref();
        if let Ok(canonical) = path.canonicalize() {
            return canonical.to_string_lossy().to_string();
        }
        if let (Some(parent), Some(name)) = (path.parent(), path.file_name()) {
            if let Ok(canonical_parent) = parent.canonicalize() {
                return canonical_parent.join(name).to_string_lossy().to_string();
            }
        }
        path.to_string_lossy().to_string()
    }
}
