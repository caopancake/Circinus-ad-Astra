use super::super::{
    cache::{lock_session, session_handle},
    definitions::entity_definitions::entity_definition,
    query::entity_targets::describe_entity_target,
};
use crate::{
    domain::{config::validate_config_id, editor_config_definitions::entity_spec_definition},
    errors::{AppError, AppResult},
    io::{FileChangeSetBuilder, FsRootBoundary, JsonWriteBatch, read_json_file},
    models::{
        EntityEditTarget, EntityIdentityChange, EntityKind, EntityLinkedRecord, EntityTargetState,
        JsonWriteOptions, WriteResult,
    },
    parsers::render_csv_text,
};
use serde_json::Value;
use std::path::Path;

pub fn save_entity_spec(
    session_id: &str,
    target: &EntityEditTarget,
    data: Value,
    options: JsonWriteOptions,
    ordered_json: Option<&str>,
) -> AppResult<WriteResult<Value>> {
    save_entity_content(session_id, target, data, options, ordered_json, None)
}

pub fn save_entity_text(
    session_id: &str,
    target: &EntityEditTarget,
    text: String,
) -> AppResult<WriteResult<Value>> {
    let data = crate::parsers::parse_starsector_json(&text).map_err(|error| {
        AppError::context(format!("解析 JSON 文件失败 ({})", target.write.path), error)
    })?;
    let definition =
        entity_spec_definition(target.kind).expect("recognized text has a format definition");
    let raw_id = data
        .get(definition.id_field)
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::message("spec.id_missing", format!("缺少 {}", definition.id_field))
        })?;
    let id = validate_config_id(raw_id, definition.invalid_id_message)?;
    let text = if raw_id == id {
        text
    } else {
        crate::parsers::replace_root_string(&text, definition.id_field, id)?
    };
    let result = save_entity_content(
        session_id,
        target,
        data,
        Default::default(),
        None,
        Some(&text),
    )?;
    Ok(result.with_refreshed_entity(serde_json::json!({"text":text})))
}

fn save_entity_content(
    session_id: &str,
    target: &EntityEditTarget,
    mut data: Value,
    options: JsonWriteOptions,
    ordered_json: Option<&str>,
    raw_text: Option<&str>,
) -> AppResult<WriteResult<Value>> {
    let handle = session_handle(session_id)?;
    let root = lock_session(&handle)?.manifest.mod_root.clone();
    let _write_lock = crate::io::acquire_root_write_lock(Path::new(&root))?;
    let mut session = lock_session(&handle)?;
    (entity_definition(target.kind)?.prepare)(&mut session)?;
    let current = describe_entity_target(&mut session, target.kind, &target.id)?;
    if current.target != *target {
        return Err(AppError::message(
            "spec.target_changed",
            "实体目标已变化，请载入外部版本",
        ));
    }
    let definition = entity_spec_definition(target.kind)
        .ok_or_else(|| AppError::message("spec.kind_unknown", "实体规格格式不存在"))?;
    let next_id = data
        .get(definition.id_field)
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::message("spec.id_missing", format!("缺少 {}", definition.id_field))
        })?;
    let next_id = validate_config_id(next_id, definition.invalid_id_message)?.to_string();
    data[definition.id_field] = Value::String(next_id.clone());
    let boundary = FsRootBoundary::new(Path::new(&session.manifest.mod_root), "entity write root")?;
    let source = boundary.resolve_relative(&target.write.rel_path, "entity source")?;
    if target.state == EntityTargetState::Existing
        && read_json_file(&source)?
            .get(definition.id_field)
            .and_then(Value::as_str)
            != Some(&target.id)
    {
        return Err(AppError::message(
            "spec.path_id_mismatch",
            "实体源文件 ID 与加载身份不一致",
        ));
    }
    let next_rel = if target.state == EntityTargetState::Create {
        definition.default_rel_path(&next_id)
    } else if next_id != target.id {
        crate::io::forward_slash_path(
            &Path::new(&target.write.rel_path)
                .with_file_name(format!("{next_id}{}", definition.extension)),
        )
    } else {
        target.write.rel_path.clone()
    };
    let destination = boundary.resolve_relative(&next_rel, "entity target")?;
    match target.kind {
        EntityKind::Variant => {
            crate::domain::config::build_variant_file(boundary.root(), &next_rel, &data)?;
        }
        EntityKind::Skin => {
            crate::domain::config::build_skin_file(boundary.root(), &next_rel, &data)?;
        }
        _ => {}
    }
    if target.state == EntityTargetState::Create || next_id != target.id {
        crate::io::require_rename_target(&source, &destination)?;
        if target.state == EntityTargetState::Create && destination.exists() {
            return Err(AppError::message(
                "spec.target_exists",
                format!("实体目标已存在: {next_rel}"),
            ));
        }
        let next_target = describe_entity_target(&mut session, target.kind, &next_id)?.target;
        if next_id != target.id && next_target.state == EntityTargetState::Existing {
            return Err(AppError::message(
                "spec.target_exists",
                format!("实体 ID 已存在: {next_id}"),
            ));
        }
    }
    if target.kind == EntityKind::Weapon {
        crate::domain::spec_construction::validate_weapon_spec_class(&data, &destination)?;
    }
    let mut json = JsonWriteBatch::new(options);
    let text = if let Some(text) = raw_text {
        text.to_string()
    } else {
        json.render(&source, &data, ordered_json)?
    };
    json.finish()?;
    let mut builder = FileChangeSetBuilder::new(boundary.root())?;
    if target.state == EntityTargetState::Existing && next_rel != target.write.rel_path {
        builder.rename_text_file(&target.write.rel_path, &next_rel, text)?;
    } else if !source.exists() || crate::io::read_utf8_no_bom(&source)? != text {
        builder.text_file(&next_rel, Some(text))?;
    }
    let mut saved_csv = None;
    if next_id != target.id
        && let Some(EntityLinkedRecord::Csv { table, row_key }) = &target.linked_record
    {
        let state = &session.csv_tables[table.as_str()];
        let mut rows = state.rows.clone().expect("linked table is loaded");
        let row = rows
            .iter_mut()
            .find(|row| row.row_key == *row_key)
            .ok_or_else(|| AppError::message("table.row_key_unknown", "关联 CSV 行已变化"))?;
        row.data.insert("id".into(), Value::String(next_id.clone()));
        let text = render_csv_text(
            &state.header,
            &rows.iter().map(|row| &row.data).collect::<Vec<_>>(),
        )?;
        builder.text_file(&state.path, Some(text.clone()))?;
        saved_csv = Some((*table, rows, text));
    }
    if target.kind == EntityKind::Faction {
        let index_rel = "data/world/factions/factions.csv";
        let index_path = boundary.resolve_relative(index_rel, "faction index")?;
        let mut index = crate::io::read_csv_data(&index_path)?;
        if let Some(EntityLinkedRecord::Index { row_index, .. }) = &target.linked_record {
            let entries = crate::io::read_faction_index(boundary.root())?;
            let entry = entries
                .iter()
                .find(|entry| entry.row_index == *row_index)
                .expect("loaded faction index entry");
            crate::parsers::update_faction_index_row(
                &mut index.rows[*row_index],
                entry,
                &next_id,
                &next_rel,
            );
        } else {
            if index.header.is_empty() {
                index.header = vec!["faction".into()];
            }
            let field = index
                .header
                .iter()
                .find(|field| field.eq_ignore_ascii_case("faction"))
                .or_else(|| {
                    index
                        .header
                        .iter()
                        .find(|field| field.eq_ignore_ascii_case("id"))
                })
                .unwrap_or(&index.header[0]);
            let mut row = serde_json::Map::new();
            if field.eq_ignore_ascii_case("id") {
                row.insert(field.clone(), Value::String(next_id.clone()));
                if let Some(file) = index
                    .header
                    .iter()
                    .find(|field| field.eq_ignore_ascii_case("file"))
                {
                    row.insert(file.clone(), Value::String(next_rel.clone()));
                }
            } else {
                row.insert(field.clone(), Value::String(next_rel.clone()));
            }
            index.rows.push(row);
        }
        let text = render_csv_text(&index.header, &index.rows.iter().collect::<Vec<_>>())?;
        builder.text_file(index_rel, Some(text))?;
    }
    let changes = builder.apply()?;
    if let Some((table, rows, text)) = saved_csv {
        let state = session
            .csv_tables
            .get_mut(table.as_str())
            .expect("linked table exists");
        state.rows = Some(rows);
        state.saved_text = Some(text);
    }
    let mut next = target.clone();
    next.id = next_id;
    next.write.rel_path = next_rel;
    next.write.path = destination.to_string_lossy().to_string();
    next.source = Some(next.write.clone());
    next.state = EntityTargetState::Existing;
    let mut result = WriteResult::from_refreshed_entity(changes, data);
    result.identity_changes.push(EntityIdentityChange {
        before: target.clone(),
        after: next,
    });
    Ok(result)
}

#[cfg(test)]
mod tests {
    use crate::{
        models::{CsvFactionFilter, CsvTableKey, EntityKind, FileChangeReplayDirection},
        services::project,
        testutil::temp_dir,
    };
    use serde_json::json;

    #[test]
    fn loaded_nested_target_renames_with_its_csv_row_and_replays_identity() {
        let root = temp_dir("identity_spec_csv");
        std::fs::create_dir_all(root.join("data/hulls/nested")).unwrap();
        std::fs::write(
            root.join("data/hulls/nested/filename.ship"),
            r#"{"hullId":"old","hullName":"Loaded"}"#,
        )
        .unwrap();
        std::fs::write(
            root.join("data/hulls/ship_data.csv"),
            "id,name,custom\nold,Loaded,keep\nother,Other,value\n",
        )
        .unwrap();
        let mut trace = project::PerformanceTrace::new("project.openSession");
        let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let info = project::query_entity_edit_target(&manifest.session_id, EntityKind::Ship, "old")
            .unwrap();
        let detail = project::query_entity(&manifest.session_id, EntityKind::Ship, "old")
            .unwrap()
            .unwrap();
        let list = project::query_entity_list(&manifest.session_id, EntityKind::Ship).unwrap();
        assert_eq!(info.target, detail.target);
        assert_eq!(info.base_versions, detail.base_versions);
        assert_eq!(info.base_versions, list[0].base_versions);
        assert_eq!(info.base_versions.len(), 2);
        assert_eq!(
            info.target.write.rel_path,
            "data/hulls/nested/filename.ship"
        );
        let before = project::query_csv_table_window(
            &manifest.session_id,
            CsvTableKey::Ships,
            0,
            20,
            None,
            CsvFactionFilter::All,
        )
        .unwrap();
        let result = crate::commands::save_editor_spec(
            crate::models::command_payloads::SaveEditorSpecPayload {
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                target: info.target,
                base_versions: info.base_versions,
                data: json!({"hullId":"new","hullName":"Saved"}),
                json_write: Default::default(),
                ordered_json: None,
            },
        )
        .unwrap();
        assert!(!root.join("data/hulls/nested/filename.ship").exists());
        assert!(root.join("data/hulls/nested/new.ship").is_file());
        assert_eq!(result.changes.len(), 2);
        assert_eq!(result.identity_changes[0].after.id, "new");
        let current = project::query_csv_table_window(
            &manifest.session_id,
            CsvTableKey::Ships,
            0,
            20,
            None,
            CsvFactionFilter::All,
        )
        .unwrap();
        assert_eq!(before.rows[0].row_key, current.rows[0].row_key);
        assert_eq!(current.rows[0].data["id"], "new");
        assert_eq!(current.rows[0].data["custom"], "keep");
        assert_eq!(current.rows[1].data["id"], "other");
        let next = project::query_entity_edit_target(&manifest.session_id, EntityKind::Ship, "new")
            .unwrap();
        assert_eq!(result.base_versions, next.base_versions);
        let undo = crate::services::write_transactions::replay(
            &manifest.session_id,
            &manifest.mod_root,
            FileChangeReplayDirection::Undo,
            result.history.undo_stack[0].id,
            result.history.revision,
        )
        .unwrap();
        assert_eq!(undo.identity_changes[0].after.id, "old");
        assert!(root.join("data/hulls/nested/filename.ship").is_file());
        crate::services::write_transactions::replay(
            &manifest.session_id,
            &manifest.mod_root,
            FileChangeReplayDirection::Redo,
            undo.history.redo_stack[0].id,
            undo.history.revision,
        )
        .unwrap();
        assert!(root.join("data/hulls/nested/new.ship").is_file());
        project::close_project_session(manifest.session_id).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn missing_spec_import_uses_content_identity() {
        let root = temp_dir("identity_missing_import");
        let mut trace = project::PerformanceTrace::new("project.openSession");
        let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let info =
            project::query_entity_edit_target(&manifest.session_id, EntityKind::Ship, "missing")
                .unwrap();
        let result = crate::commands::save_editor_spec(
            crate::models::command_payloads::SaveEditorSpecPayload {
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                target: info.target,
                base_versions: info.base_versions,
                data: json!({"hullId":"imported"}),
                json_write: Default::default(),
                ordered_json: None,
            },
        )
        .unwrap();
        assert_eq!(result.identity_changes[0].after.id, "imported");
        assert!(root.join("data/hulls/imported.ship").exists());
        project::close_project_session(manifest.session_id).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn text_identity_save_preserves_source_and_updates_linked_row() {
        let root = temp_dir("text_identity_source");
        std::fs::create_dir_all(root.join("data/hulls/nested")).unwrap();
        let old = root.join("data/hulls/nested/filename.ship");
        std::fs::write(&old, "{hullId:'old', # keep\n hullName:'Old'}\n").unwrap();
        std::fs::write(
            root.join("data/hulls/ship_data.csv"),
            "id,name,custom\nold,Old,keep\n",
        )
        .unwrap();
        let mut trace = project::PerformanceTrace::new("project.openSession");
        let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let loaded = crate::services::file_editor::load_project_editable_file(
            Some(&manifest.session_id),
            &manifest.mod_root,
            old.to_string_lossy().to_string(),
        )
        .unwrap();
        assert_eq!(loaded.entity.as_ref().unwrap().target.id, "old");
        assert_eq!(loaded.base_versions.len(), 2);
        let text = "{hullId:'new', # keep\n hullName:'Edited', extra:{'_key':1}}\n";
        let saved =
            crate::commands::save_text_file(crate::models::command_payloads::SaveTextFilePayload {
                session_id: Some(manifest.session_id.clone()),
                mod_root: manifest.mod_root.clone(),
                path: loaded.path,
                text: text.to_string(),
                base_versions: loaded.base_versions,
            })
            .unwrap();
        assert_eq!(saved.refreshed_entity.unwrap()["text"], text);
        assert_eq!(
            std::fs::read_to_string(root.join("data/hulls/nested/new.ship")).unwrap(),
            text
        );
        assert!(!old.exists());
        assert_eq!(
            crate::io::read_csv_data(&root.join("data/hulls/ship_data.csv"))
                .unwrap()
                .rows[0]["id"],
            "new"
        );
        project::close_project_session(manifest.session_id).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn core_projectile_saves_to_mod_override_and_keeps_core_source() {
        let game = temp_dir("identity_core_projectile");
        let root = game.join("mods/demo");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(game.join("starsector-core/data/weapons/proj/nested")).unwrap();
        let core = game.join("starsector-core/data/weapons/proj/nested/filename.proj");
        std::fs::write(&core, r#"{"id":"core","width":4}"#).unwrap();
        let mut trace = project::PerformanceTrace::new("project.openSession");
        let manifest =
            project::open_project_session_traced(&root, Some(&game), &mut trace).unwrap();
        let info =
            project::query_entity_edit_target(&manifest.session_id, EntityKind::Projectile, "core")
                .unwrap();
        assert_eq!(
            info.target.source.as_ref().unwrap().source,
            crate::models::ResourceSource::Core
        );
        assert_eq!(
            info.target.source.as_ref().unwrap().rel_path,
            "data/weapons/proj/nested/filename.proj"
        );
        assert_eq!(info.target.write.rel_path, "data/weapons/proj/core.proj");
        assert_eq!(info.base_versions[0].fingerprint, None);
        let saved = crate::commands::save_editor_spec(
            crate::models::command_payloads::SaveEditorSpecPayload {
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                target: info.target,
                base_versions: info.base_versions,
                data: json!({"id":"core","width":8}),
                json_write: Default::default(),
                ordered_json: None,
            },
        )
        .unwrap();
        assert_eq!(crate::io::read_json_file(&core).unwrap()["width"], 4);
        assert_eq!(
            crate::io::read_json_file(&root.join("data/weapons/proj/core.proj")).unwrap()["width"],
            8
        );
        let next =
            project::query_entity_edit_target(&manifest.session_id, EntityKind::Projectile, "core")
                .unwrap();
        assert_eq!(saved.base_versions, next.base_versions);
        assert_eq!(
            next.target.state,
            crate::models::EntityTargetState::Existing
        );
        project::close_project_session(manifest.session_id).unwrap();
        std::fs::remove_dir_all(game).unwrap();
    }

    #[test]
    fn linked_csv_version_conflict_keeps_loaded_spec_and_history() {
        let root = temp_dir("identity_csv_conflict");
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();
        let file = root.join("data/hulls/demo.ship");
        std::fs::write(&file, r#"{"hullId":"demo"}"#).unwrap();
        std::fs::write(root.join("data/hulls/ship_data.csv"), "id,name\ndemo,Old\n").unwrap();
        let mut trace = project::PerformanceTrace::new("project.openSession");
        let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let info =
            project::query_entity_edit_target(&manifest.session_id, EntityKind::Ship, "demo")
                .unwrap();
        std::fs::write(
            root.join("data/hulls/ship_data.csv"),
            "id,name\ndemo,External\n",
        )
        .unwrap();
        let failed = crate::commands::save_editor_spec(
            crate::models::command_payloads::SaveEditorSpecPayload {
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                target: info.target,
                base_versions: info.base_versions,
                data: json!({"hullId":"next"}),
                json_write: Default::default(),
                ordered_json: None,
            },
        )
        .unwrap_err();
        assert_eq!(failed.code(), "write.version_conflict");
        assert_eq!(crate::io::read_json_file(&file).unwrap()["hullId"], "demo");
        assert!(
            crate::services::write_transactions::query_history(
                &manifest.session_id,
                &manifest.mod_root
            )
            .unwrap()
            .undo_stack
            .is_empty()
        );
        project::close_project_session(manifest.session_id).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn spec_save_requires_the_complete_loaded_version_scope() {
        let root = temp_dir("identity_required_scope");
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();
        let path = root.join("data/hulls/demo.ship");
        std::fs::write(&path, r#"{"hullId":"demo"}"#).unwrap();
        std::fs::write(root.join("data/hulls/ship_data.csv"), "id,name\ndemo,Old\n").unwrap();
        let mut trace = project::PerformanceTrace::new("project.openSession");
        let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let info =
            project::query_entity_edit_target(&manifest.session_id, EntityKind::Ship, "demo")
                .unwrap();
        for versions in [
            vec![],
            vec![info.base_versions[0].clone()],
            vec![info.base_versions[1].clone()],
        ] {
            let error = crate::commands::save_editor_spec(
                crate::models::command_payloads::SaveEditorSpecPayload {
                    session_id: manifest.session_id.clone(),
                    mod_root: manifest.mod_root.clone(),
                    target: info.target.clone(),
                    base_versions: versions,
                    data: json!({"hullId":"next"}),
                    json_write: Default::default(),
                    ordered_json: None,
                },
            )
            .unwrap_err();
            assert_eq!(error.code(), "write.version_scope_missing");
            assert_eq!(crate::io::read_json_file(&path).unwrap()["hullId"], "demo");
        }
        assert!(
            crate::services::write_transactions::query_history(
                &manifest.session_id,
                &manifest.mod_root
            )
            .unwrap()
            .undo_stack
            .is_empty()
        );
        project::close_project_session(manifest.session_id).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn text_identity_normalization_changes_only_the_root_id_value() {
        let root = temp_dir("text_identity_normalized");
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();
        let path = root.join("data/hulls/demo.ship");
        std::fs::write(&path, "{hullId:'demo'}").unwrap();
        std::fs::write(root.join("data/hulls/ship_data.csv"), "id,name\ndemo,Old\n").unwrap();
        let mut trace = project::PerformanceTrace::new("project.openSession");
        let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let info =
            project::query_entity_edit_target(&manifest.session_id, EntityKind::Ship, "demo")
                .unwrap();
        let text = "{hullId:' next ', # keep\n extra:{hullId:' untouched '}}\n";
        let saved =
            crate::commands::save_text_file(crate::models::command_payloads::SaveTextFilePayload {
                session_id: Some(manifest.session_id.clone()),
                mod_root: manifest.mod_root.clone(),
                path: path.to_string_lossy().to_string(),
                text: text.to_string(),
                base_versions: info.base_versions,
            })
            .unwrap();
        let expected = "{hullId:\"next\", # keep\n extra:{hullId:' untouched '}}\n";
        assert_eq!(saved.refreshed_entity.unwrap()["text"], expected);
        assert_eq!(
            std::fs::read_to_string(root.join("data/hulls/next.ship")).unwrap(),
            expected
        );
        assert_eq!(saved.identity_changes[0].after.id, "next");
        project::close_project_session(manifest.session_id).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}
