use crate::domain::editor_config_definitions::{EntitySpecDefinition, editor_spec_definition};
#[cfg(test)]
use crate::{
    domain::config::validate_config_id,
    models::{JsonWriteOptions, WriteResult},
};
use crate::{
    errors::{AppError, AppResult},
    io::{read_json_file, validate_safe_absolute_path, validate_walk_entry},
    models::EditorSpecKind,
};
use serde_json::Value;
use std::path::Path;

#[cfg(test)]
pub fn save_editor_spec(
    mod_root: &str,
    kind: EditorSpecKind,
    id: &str,
    data: Value,
) -> AppResult<WriteResult<Value>> {
    save_editor_spec_with_json_options(mod_root, kind, id, data, JsonWriteOptions::default(), None)
}

#[cfg(test)]
pub fn save_editor_spec_with_json_options(
    mod_root: &str,
    kind: EditorSpecKind,
    id: &str,
    data: Value,
    options: JsonWriteOptions,
    ordered_json: Option<&str>,
) -> AppResult<WriteResult<Value>> {
    let definition = editor_spec_definition(kind)?;
    validate_config_id(id, definition.invalid_id_message)?;
    let mut trace = crate::services::project::PerformanceTrace::new("project.openSession");
    let manifest = crate::services::project::open_project_session_traced(
        Path::new(mod_root),
        None,
        &mut trace,
    )?;
    let result = (|| {
        let info = crate::services::project::query_entity_edit_target(
            &manifest.session_id,
            definition.entity_kind,
            id,
        )?;
        crate::commands::save_editor_spec(crate::models::command_payloads::SaveEditorSpecPayload {
            session_id: manifest.session_id.clone(),
            mod_root: manifest.mod_root.clone(),
            target: info.target,
            base_versions: info.base_versions,
            data,
            json_write: options,
            ordered_json: ordered_json.map(str::to_string),
        })
    })();
    crate::services::project::close_project_session(manifest.session_id)?;
    result
}

pub fn load_imported_editor_spec_file(kind: EditorSpecKind, path: String) -> AppResult<Value> {
    let path = Path::new(&path);
    validate_imported_editor_spec_path(editor_spec_definition(kind)?, path)?;
    read_json_file(path)
}

fn validate_imported_editor_spec_path(
    definition: &EntitySpecDefinition,
    path: &Path,
) -> AppResult<()> {
    validate_safe_absolute_path(path, "imported editor spec")?;
    validate_walk_entry(path, "imported editor spec")?;
    let extension = definition.extension_without_dot();
    if path.extension().and_then(|value| value.to_str()) != Some(extension) {
        return Err(AppError::message(
            "spec.extension_invalid",
            format!(
                "imported editor spec extension must be .{}: {}",
                extension,
                path.display()
            ),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::{read_utf8_no_bom, write_utf8_no_bom};
    use crate::testutil::{temp_dir, temp_linked_file};
    use std::{fs, path::PathBuf};

    #[test]
    fn pulse_import_can_be_read_and_corrected_before_structured_save() {
        let root = temp_dir("pulse_editor_read_correct_save");
        fs::create_dir_all(root.join("data/weapons")).unwrap();
        let path = root.join("data/weapons/demo.wpn");
        let original = r#"{"id":"demo","specClass":"pulse","builtInWeapons":{"_slot":"w"},"array":[{"_field":1}]}"#;
        write_utf8_no_bom(&path, original).unwrap();
        let mut content =
            load_imported_editor_spec_file(EditorSpecKind::Weapon, path.to_string_lossy().into())
                .unwrap();
        let error = save_editor_spec(
            &root.to_string_lossy(),
            EditorSpecKind::Weapon,
            "demo",
            content.clone(),
        )
        .unwrap_err();
        assert_eq!(error.code(), "spec.weapon_class_unsupported");
        assert_eq!(read_utf8_no_bom(&path).unwrap(), original);
        content["specClass"] = Value::String("projectile".into());
        let saved = save_editor_spec(
            &root.to_string_lossy(),
            EditorSpecKind::Weapon,
            "demo",
            content.clone(),
        )
        .unwrap();
        assert_eq!(read_json_file(&path).unwrap(), content);
        assert_eq!(saved.refreshed_entity, Some(content));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn editor_spec_receipts_match_persisted_content_and_preserved_noops() {
        for kind in [
            EditorSpecKind::Ship,
            EditorSpecKind::Weapon,
            EditorSpecKind::Projectile,
            EditorSpecKind::System,
        ] {
            let definition = editor_spec_definition(kind).unwrap();
            let root = temp_dir(&format!(
                "spec_receipt_{}",
                definition.extension_without_dot()
            ));
            fs::create_dir_all(root.join(definition.dir)).unwrap();
            let target = root
                .join(definition.dir)
                .join(format!("demo.{}", definition.extension_without_dot()));
            let mut data = serde_json::json!({definition.id_field: "demo", "nested": {"_slot": 2}, "_tool": true});
            if kind == EditorSpecKind::Weapon {
                data["specClass"] = Value::String("projectile".to_string());
            }
            let result = save_editor_spec(&root.to_string_lossy(), kind, "demo", data).unwrap();
            let persisted = read_json_file(&target).unwrap();
            assert_eq!(result.refreshed_entity, Some(persisted.clone()));
            let noop = save_editor_spec_with_json_options(
                &root.to_string_lossy(),
                kind,
                "demo",
                persisted.clone(),
                JsonWriteOptions {
                    preserve_original_json: true,
                    confirmed_sources: Vec::new(),
                },
                None,
            )
            .unwrap();
            assert!(noop.changes.is_empty());
            assert_eq!(noop.refreshed_entity, Some(persisted));
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn save_editor_spec_uses_fixed_weapon_target_boundary() {
        let root = temp_dir("save_editor_weapon_spec");
        fs::create_dir_all(root.join("data/weapons/nested")).unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/nested/demo.wpn"),
            r#"{"id":"demo","weaponType":"BALLISTIC"}"#,
        )
        .unwrap();

        let result = save_editor_spec(
            &root.to_string_lossy(),
            EditorSpecKind::Weapon,
            "demo",
            serde_json::json!({"id": "demo", "specClass":"projectile", "weaponType": "ENERGY"}),
        )
        .unwrap();

        let target = root
            .join("data/weapons/nested/demo.wpn")
            .canonicalize()
            .unwrap();
        let text = read_utf8_no_bom(&target).unwrap();
        let _ = fs::remove_dir_all(root);
        assert_eq!(invalidation_paths(&result), [target]);
        assert!(text.contains("\"weaponType\": \"ENERGY\""));
    }

    #[test]
    fn editor_spec_save_preserves_existing_comments_and_normalizing_mode_rewrites() {
        let root = temp_dir("save_editor_spec_json_modes");
        fs::create_dir_all(root.join("data/weapons")).unwrap();
        let target = root.join("data/weapons/demo.wpn");
        write_utf8_no_bom(
            &target,
            "{\n  # important\n  weaponType: BALLISTIC,\n  id: 'demo'\n}\n",
        )
        .unwrap();
        let saved = save_editor_spec_with_json_options(
            &root.to_string_lossy(),
            EditorSpecKind::Weapon,
            "demo",
            serde_json::json!({"id":"demo","specClass":"projectile","weaponType":"ENERGY"}),
            JsonWriteOptions {
                preserve_original_json: true,
                confirmed_sources: Vec::new(),
            },
            Some(r#"{"weaponType":"ENERGY","id":"demo"}"#),
        )
        .unwrap();
        let preserved = read_utf8_no_bom(&target).unwrap();
        assert_eq!(saved.changes.len(), 1);
        assert!(preserved.contains("# important"));
        assert!(preserved.find("weaponType").unwrap() < preserved.find("id:").unwrap());
        let normalized = save_editor_spec_with_json_options(
            &root.to_string_lossy(),
            EditorSpecKind::Weapon,
            "demo",
            serde_json::json!({"id":"demo","specClass":"projectile","weaponType":"ENERGY"}),
            JsonWriteOptions::default(),
            None,
        )
        .unwrap();
        assert_eq!(normalized.changes.len(), 1);
        assert!(!read_utf8_no_bom(&target).unwrap().contains("# important"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn save_editor_spec_uses_fixed_ship_target_boundary() {
        let root = temp_dir("save_editor_unknown_spec");
        fs::create_dir_all(root.join("data/hulls")).unwrap();

        let result = save_editor_spec(
            &root.to_string_lossy(),
            EditorSpecKind::Ship,
            "demo",
            serde_json::json!({"hullId": "demo"}),
        )
        .unwrap();

        let target = root.join("data/hulls/demo.ship").canonicalize().unwrap();
        let text = read_utf8_no_bom(&target).unwrap();
        let _ = fs::remove_dir_all(root);
        assert_eq!(invalidation_paths(&result), [target]);
        assert!(text.contains("\"hullId\": \"demo\""));
    }

    #[test]
    fn save_editor_spec_does_not_skip_broken_target_candidates() {
        let root = temp_dir("save_editor_broken_candidate");
        fs::create_dir_all(root.join("data/weapons")).unwrap();
        write_utf8_no_bom(&root.join("data/weapons/broken.wpn"), "{").unwrap();

        let error = save_editor_spec(
            &root.to_string_lossy(),
            EditorSpecKind::Weapon,
            "demo",
            serde_json::json!({"id": "demo", "specClass":"projectile", "weaponType": "ENERGY"}),
        )
        .unwrap_err()
        .to_string();
        let default_target_exists = root.join("data/weapons/demo.wpn").exists();

        let _ = fs::remove_dir_all(root);
        assert!(error.contains("broken.wpn"));
        assert!(!default_target_exists);
    }

    #[test]
    fn save_editor_spec_rejects_non_directory_candidate_root() {
        let root = temp_dir("save_editor_non_directory_root");
        fs::create_dir_all(root.join("data")).unwrap();
        write_utf8_no_bom(&root.join("data/weapons"), "not a directory").unwrap();

        let error = save_editor_spec(
            &root.to_string_lossy(),
            EditorSpecKind::Weapon,
            "demo",
            serde_json::json!({"id": "demo", "specClass":"projectile", "weaponType": "ENERGY"}),
        )
        .unwrap_err()
        .to_string();
        let default_target_exists = root.join("data/weapons/demo.wpn").exists();

        let _ = fs::remove_dir_all(root);
        assert!(error.contains("JSON 目录不是目录"));
        assert!(!default_target_exists);
    }

    #[test]
    fn save_editor_spec_rejects_invalid_id_before_candidate_scan() {
        let root = temp_dir("save_editor_invalid_id_before_scan");
        fs::create_dir_all(root.join("data/weapons")).unwrap();
        write_utf8_no_bom(&root.join("data/weapons/broken.wpn"), "{").unwrap();

        let error = save_editor_spec(
            &root.to_string_lossy(),
            EditorSpecKind::Weapon,
            "../outside",
            serde_json::json!({"id": "../outside", "weaponType": "ENERGY"}),
        )
        .unwrap_err()
        .to_string();
        let outside_target_exists = root.join("data/outside.wpn").exists();

        let _ = fs::remove_dir_all(root);
        assert!(error.contains("无效武器 ID"));
        assert!(!outside_target_exists);
    }

    #[test]
    fn load_imported_editor_spec_file_requires_matching_extension() {
        let root = temp_dir("load_imported_spec_extension");
        let path = root.join("demo.ship");
        write_utf8_no_bom(&path, r#"{"hullId":"demo"}"#).unwrap();

        let error = load_imported_editor_spec_file(
            EditorSpecKind::Weapon,
            path.to_string_lossy().to_string(),
        )
        .unwrap_err()
        .to_string();

        let _ = fs::remove_dir_all(root);
        assert!(error.contains("imported editor spec extension must be .wpn"));
    }

    #[test]
    fn load_imported_editor_spec_file_rejects_parent_dir_path() {
        let root = temp_dir("load_imported_spec_parent_dir");
        let path = root.join("..").join("demo.wpn");

        let error = load_imported_editor_spec_file(
            EditorSpecKind::Weapon,
            path.to_string_lossy().to_string(),
        )
        .unwrap_err()
        .to_string();

        let _ = fs::remove_dir_all(root);
        assert!(error.contains("invalid imported editor spec path"));
    }

    #[test]
    fn load_imported_editor_spec_file_rejects_link_file() {
        let Some((root, outside, link)) = temp_linked_file("load_imported_spec_link", "demo.wpn")
        else {
            return;
        };
        write_utf8_no_bom(&outside, r#"{"id":"demo","weaponType":"ENERGY"}"#).unwrap();

        let result = load_imported_editor_spec_file(
            EditorSpecKind::Weapon,
            link.to_string_lossy().to_string(),
        );

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_file(outside);
        assert!(result.is_err());
    }

    #[test]
    fn load_imported_editor_spec_file_reads_matching_spec() {
        let root = temp_dir("load_imported_spec_reads");
        let path = root.join("demo.wpn");
        write_utf8_no_bom(&path, r#"{"id":"demo","weaponType":"ENERGY"}"#).unwrap();

        let value = load_imported_editor_spec_file(
            EditorSpecKind::Weapon,
            path.to_string_lossy().to_string(),
        )
        .unwrap();

        let _ = fs::remove_dir_all(root);
        assert_eq!(value.get("id").and_then(Value::as_str), Some("demo"));
    }

    fn invalidation_paths(result: &WriteResult<Value>) -> Vec<PathBuf> {
        result
            .invalidation
            .paths
            .iter()
            .map(PathBuf::from)
            .collect()
    }
}
