use crate::{
    domain::config::validate_config_id,
    domain::editor_config_definitions::{EntitySpecDefinition, entity_spec_definition},
    errors::{AppError, AppResult},
    io::{
        FileChangeSetBuilder, FsRootBoundary, JsonWriteBatch, acquire_root_write_lock,
        read_json_file,
    },
    models::{EntityKind, JsonWriteOptions, WriteResult},
};
use serde_json::Value;
use std::path::Path;

pub struct SpecSaveInput<'a> {
    pub source_rel_path: Option<&'a str>,
    pub target_exists_in_index: bool,
    pub data: Value,
    pub json_write: JsonWriteOptions,
    pub ordered_json: Option<&'a str>,
}

pub fn save_spec_entity_with_json_options(
    mod_root: &str,
    kind: EntityKind,
    previous_id: Option<&str>,
    next_id: &str,
    input: SpecSaveInput<'_>,
) -> AppResult<WriteResult<Value>> {
    let write_lock = acquire_root_write_lock(Path::new(mod_root))?;
    let SpecSaveInput {
        source_rel_path,
        target_exists_in_index,
        data,
        json_write,
        ordered_json,
    } = input;
    let definition = spec_entity_definition(kind)?;
    let next_id = validate_config_id(next_id, definition.invalid_id_message)?.to_string();
    let mod_root = Path::new(mod_root);
    let previous_id = previous_id
        .filter(|value| !value.trim().is_empty())
        .map(|value| validate_config_id(value, definition.invalid_id_message).map(str::to_string))
        .transpose()?;
    let renamed = previous_id.as_deref().is_some_and(|id| id != next_id);
    let next_rel_path = if let Some(source) = source_rel_path {
        let source_id = previous_id.as_deref().unwrap_or(&next_id);
        require_spec_file_target(mod_root, definition, kind, source_id, source)?;
        if renamed {
            crate::io::forward_slash_path(
                &Path::new(source).with_file_name(format!("{next_id}{}", definition.extension)),
            )
        } else {
            source.to_string()
        }
    } else {
        if previous_id.is_some() {
            return Err(AppError::message(
                "spec.source_path_required",
                "编辑实体缺少选中文件路径",
            ));
        }
        definition.default_rel_path(&next_id)
    };
    let target = mod_root.join(&next_rel_path);
    if (renamed || source_rel_path.is_none()) && (target.exists() || target_exists_in_index) {
        return Err(AppError::message(
            "spec.target_exists",
            format!("{}目标已存在: {next_rel_path}", definition.display_name),
        ));
    }

    let (entity_id, refreshed) = build_spec_file(kind, mod_root, &next_rel_path, &data)?;
    if entity_id != next_id {
        return Err(AppError::message(
            "spec.id_mismatch",
            format!(
                "{}数据 {} 与保存目标不一致: {entity_id}",
                definition.display_name, definition.id_field
            ),
        ));
    }

    let source_rel_path = source_rel_path.unwrap_or(&next_rel_path);
    let boundary = FsRootBoundary::new(mod_root, "mod root")?;
    let source_path = boundary.resolve_relative(source_rel_path, "实体源路径")?;
    let preserve_original_json = json_write.preserve_original_json;
    let mut json = JsonWriteBatch::new(json_write);
    let rendered = json.render(&source_path, &data, ordered_json)?;
    json.finish()?;
    if preserve_original_json
        && source_rel_path == next_rel_path
        && source_path.exists()
        && crate::io::read_utf8_no_bom(&source_path)? == rendered
    {
        return Ok(WriteResult::from_refreshed_entity(Vec::new(), refreshed));
    }
    let mut builder = FileChangeSetBuilder::new_with_lock(mod_root, write_lock)?;
    if renamed {
        builder.text_file(source_rel_path, None)?;
    }
    builder.text_file(&next_rel_path, Some(rendered))?;
    let changes = builder.apply()?;

    Ok(WriteResult::from_refreshed_entity(changes, refreshed))
}

pub fn create_spec_entity(
    mod_root: &str,
    kind: EntityKind,
    next_id: &str,
    data: Value,
    target_exists_in_index: bool,
) -> AppResult<WriteResult<Value>> {
    save_spec_entity_with_json_options(
        mod_root,
        kind,
        None,
        next_id,
        SpecSaveInput {
            source_rel_path: None,
            target_exists_in_index,
            data,
            json_write: JsonWriteOptions::default(),
            ordered_json: None,
        },
    )
}

pub fn delete_spec_entity(
    mod_root: &str,
    kind: EntityKind,
    id: &str,
    rel_path: &str,
) -> AppResult<WriteResult> {
    let write_lock = acquire_root_write_lock(Path::new(mod_root))?;
    let definition = spec_entity_definition(kind)?;
    validate_config_id(id, definition.invalid_id_message)?;
    require_spec_file_target(Path::new(mod_root), definition, kind, id, rel_path)?;
    let mut builder = FileChangeSetBuilder::new_with_lock(Path::new(mod_root), write_lock)?;
    builder.text_file(rel_path, None)?;
    let changes = builder.apply()?;
    Ok(WriteResult::from_changes(changes))
}

fn spec_entity_definition(kind: EntityKind) -> AppResult<&'static EntitySpecDefinition> {
    let definition = entity_spec_definition(kind).ok_or_else(|| {
        AppError::message("spec.kind_unknown", format!("spec 定义不存在: {kind:?}"))
    })?;
    match definition.entity_kind {
        EntityKind::Variant | EntityKind::Skin => Ok(definition),
        _ => Err(AppError::message(
            "spec.not_single_file",
            format!("{} 不是单文件 spec 实体", definition.display_name),
        )),
    }
}

fn require_spec_file_target(
    mod_root: &Path,
    definition: &EntitySpecDefinition,
    kind: EntityKind,
    id: &str,
    rel_path: &str,
) -> AppResult<()> {
    definition.validate_rel_path(rel_path, &format!("{}路径无效", definition.display_name))?;
    let boundary = FsRootBoundary::new(mod_root, "mod root")?;
    let data = read_json_file(&boundary.resolve_relative(rel_path, "实体源路径")?)?;
    let (entity_id, _) = build_spec_file(kind, mod_root, rel_path, &data)?;
    if entity_id != id {
        return Err(AppError::message(
            "spec.path_id_mismatch",
            format!(
                "{}路径与实体 ID 不匹配: {rel_path}",
                definition.display_name
            ),
        ));
    }
    Ok(())
}

/// Variant and skin are the two spec kinds stored as one writable file per
/// entity; the merged save/delete flow exists for exactly these two.
fn build_spec_file(
    kind: EntityKind,
    mod_root: &Path,
    rel_path: &str,
    data: &Value,
) -> AppResult<(String, Value)> {
    match kind {
        EntityKind::Variant => {
            let file = crate::domain::config::build_variant_file(mod_root, rel_path, data)?;
            let entity_id = file.variant_id.clone();
            Ok((entity_id, serde_json::to_value(file)?))
        }
        EntityKind::Skin => {
            let file = crate::domain::config::build_skin_file(mod_root, rel_path, data)?;
            let entity_id = file.skin_hull_id.clone();
            Ok((entity_id, serde_json::to_value(file)?))
        }
        other => Err(AppError::message(
            "spec.not_single_file",
            format!("{other:?} 不是单文件 spec 实体"),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;
    use crate::{
        io::{read_utf8_no_bom, write_utf8_no_bom},
        models::FileChangeReplayDirection,
        services::file_changes::apply_file_change_set,
    };
    use serde_json::json;
    use std::fs;

    fn save_input<'a>(rel_path: Option<&'a str>, data: Value) -> SpecSaveInput<'a> {
        SpecSaveInput {
            source_rel_path: rel_path,
            target_exists_in_index: false,
            data,
            json_write: JsonWriteOptions::default(),
            ordered_json: None,
        }
    }

    #[test]
    fn variant_rename_preserves_old_file_comments_and_key_order() {
        let root = temp_dir("variant_rename_preserves_json");
        fs::create_dir_all(root.join("data/variants")).unwrap();
        let old = root.join("data/variants/old.variant");
        write_utf8_no_bom(
            &old,
            "{\n  # author note\n  hullId: 'demo',\n  variantId: 'old'\n}\n",
        )
        .unwrap();
        let result = save_spec_entity_with_json_options(
            &root.to_string_lossy(),
            EntityKind::Variant,
            Some("old"),
            "new",
            SpecSaveInput {
                source_rel_path: Some("data/variants/old.variant"),
                target_exists_in_index: false,
                data: json!({"hullId":"demo","variantId":"new"}),
                json_write: JsonWriteOptions {
                    preserve_original_json: true,
                    confirmed_sources: Vec::new(),
                },
                ordered_json: Some(r#"{"hullId":"demo","variantId":"new"}"#),
            },
        )
        .unwrap();
        let text = read_utf8_no_bom(&root.join("data/variants/new.variant")).unwrap();
        assert_eq!(result.changes.len(), 2);
        assert!(!old.exists());
        assert!(text.contains("# author note"));
        assert!(text.find("hullId").unwrap() < text.find("variantId").unwrap());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn variant_save_rename_keeps_the_selected_source_directory() {
        let root = temp_dir("variant_nested_source_directory");
        fs::create_dir_all(root.join("data/variants/nested")).unwrap();
        let old = root.join("data/variants/nested/old.variant");
        write_utf8_no_bom(&old, r#"{"hullId":"demo","variantId":"old"}"#).unwrap();
        let result = save_spec_entity_with_json_options(
            &root.to_string_lossy(),
            EntityKind::Variant,
            Some("old"),
            "new",
            save_input(
                Some("data/variants/nested/old.variant"),
                json!({"hullId":"demo","variantId":"new"}),
            ),
        )
        .unwrap();
        assert!(root.join("data/variants/nested/new.variant").exists());
        assert!(!root.join("data/variants/new.variant").exists());
        assert_eq!(result.changes.len(), 2);
        let _ = fs::remove_dir_all(root);
    }

    struct SpecCase {
        kind: EntityKind,
        dir: &'static str,
        ext: &'static str,
        id_field: &'static str,
        companion_field: &'static str,
        companion_value: &'static str,
    }

    const VARIANT_CASE: SpecCase = SpecCase {
        kind: EntityKind::Variant,
        dir: "data/variants",
        ext: "variant",
        id_field: "variantId",
        companion_field: "hullId",
        companion_value: "hull",
    };

    const SKIN_CASE: SpecCase = SpecCase {
        kind: EntityKind::Skin,
        dir: "data/hulls/skins",
        ext: "skin",
        id_field: "skinHullId",
        companion_field: "baseHullId",
        companion_value: "base",
    };

    fn entity_json(case: &SpecCase, id: &str) -> Value {
        json!({ case.id_field: id, case.companion_field: case.companion_value })
    }

    fn entity_file_json(case: &SpecCase, id: &str) -> String {
        format!(
            "{{\"{}\":\"{id}\",\"{}\":\"{}\"}}",
            case.id_field, case.companion_field, case.companion_value
        )
    }

    fn rename_with_undo_redo(case: &SpecCase) {
        let root = temp_dir(&format!("spec_entity_{}_rename", case.ext));
        fs::create_dir_all(root.join(case.dir)).unwrap();
        write_utf8_no_bom(
            &root.join(format!("{}/old.{ext}", case.dir, ext = case.ext)),
            &entity_file_json(case, "old"),
        )
        .unwrap();

        let mut data = entity_json(case, "new");
        data[case.companion_field] = json!(case.companion_value);
        match case.kind {
            EntityKind::Variant => data["weaponGroups"] = json!([{}]),
            EntityKind::Skin => data["builtInWeapons"] = json!({"WS 001": "demo_weapon"}),
            _ => unreachable!(),
        }
        let source = format!("{}/old.{}", case.dir, case.ext);
        let result = save_spec_entity_with_json_options(
            &root.to_string_lossy(),
            case.kind,
            Some("old"),
            "new",
            save_input(Some(&source), data),
        )
        .unwrap();
        let refreshed = result.refreshed_entity.clone().unwrap();

        assert!(
            !root
                .join(format!("{}/old.{ext}", case.dir, ext = case.ext))
                .exists()
        );
        assert!(
            root.join(format!("{}/new.{ext}", case.dir, ext = case.ext))
                .exists()
        );
        assert_eq!(refreshed[case.id_field], "new");
        match case.kind {
            EntityKind::Variant => assert_eq!(refreshed["weaponGroupCount"], 1),
            EntityKind::Skin => assert_eq!(refreshed["builtInWeaponCount"], 1),
            _ => unreachable!(),
        }

        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Undo,
            result.changes.clone(),
        )
        .unwrap();
        assert!(
            root.join(format!("{}/old.{ext}", case.dir, ext = case.ext))
                .exists()
        );
        assert!(
            !root
                .join(format!("{}/new.{ext}", case.dir, ext = case.ext))
                .exists()
        );

        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            result.changes,
        )
        .unwrap();
        let text = read_utf8_no_bom(&root.join(format!("{}/new.{ext}", case.dir, ext = case.ext)))
            .unwrap();
        let _ = fs::remove_dir_all(root);
        assert!(text.contains(&format!("\"{}\": \"new\"", case.id_field)));
    }

    fn delete_returns_replayable_changeset(case: &SpecCase) {
        let root = temp_dir(&format!("spec_entity_{}_delete", case.ext));
        fs::create_dir_all(root.join(case.dir)).unwrap();
        write_utf8_no_bom(
            &root.join(format!("{}/demo.{ext}", case.dir, ext = case.ext)),
            &entity_file_json(case, "demo"),
        )
        .unwrap();

        let result = delete_spec_entity(
            &root.to_string_lossy(),
            case.kind,
            "demo",
            &format!("{}/demo.{ext}", case.dir, ext = case.ext),
        )
        .unwrap();

        assert!(
            !root
                .join(format!("{}/demo.{ext}", case.dir, ext = case.ext))
                .exists()
        );
        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Undo,
            result.changes,
        )
        .unwrap();
        let text = read_utf8_no_bom(&root.join(format!("{}/demo.{ext}", case.dir, ext = case.ext)))
            .unwrap();
        let _ = fs::remove_dir_all(root);
        assert!(text.contains(&format!("\"{}\":\"demo\"", case.id_field)));
    }

    fn delete_rejects_rel_path_outside_directory(case: &SpecCase) {
        let root = temp_dir(&format!("spec_entity_{}_external_rel_path", case.ext));
        write_utf8_no_bom(&root.join("mod_info.json"), "{}").unwrap();

        let result =
            delete_spec_entity(&root.to_string_lossy(), case.kind, "demo", "mod_info.json");

        let text = read_utf8_no_bom(&root.join("mod_info.json")).unwrap();
        let _ = fs::remove_dir_all(root);
        assert!(result.is_err());
        assert_eq!(text, "{}");
    }

    fn delete_requires_rel_path_entity_match(case: &SpecCase) {
        let root = temp_dir(&format!("spec_entity_{}_matching_id", case.ext));
        fs::create_dir_all(root.join(case.dir)).unwrap();
        write_utf8_no_bom(
            &root.join(format!("{}/other.{ext}", case.dir, ext = case.ext)),
            &entity_file_json(case, "other"),
        )
        .unwrap();

        let result = delete_spec_entity(
            &root.to_string_lossy(),
            case.kind,
            "demo",
            &format!("{}/other.{ext}", case.dir, ext = case.ext),
        );

        let text =
            read_utf8_no_bom(&root.join(format!("{}/other.{ext}", case.dir, ext = case.ext)))
                .unwrap();
        let _ = fs::remove_dir_all(root);
        assert!(result.is_err());
        assert!(text.contains(&format!("\"{}\":\"other\"", case.id_field)));
    }

    fn save_requires_data_id_to_match_target_id(case: &SpecCase) {
        let root = temp_dir(&format!("spec_entity_{}_mismatched_data_id", case.ext));
        let result = save_spec_entity_with_json_options(
            &root.to_string_lossy(),
            case.kind,
            None,
            "new",
            save_input(None, entity_json(case, "other")),
        );

        let target_exists = root
            .join(format!("{}/new.{ext}", case.dir, ext = case.ext))
            .exists();
        let _ = fs::remove_dir_all(root);
        assert!(result.is_err());
        assert!(!target_exists);
    }

    #[test]
    fn spec_edits_preserve_selected_filename_and_rename_with_replay() {
        for case in [&VARIANT_CASE, &SKIN_CASE] {
            let root = temp_dir(&format!("spec_selected_path_{}", case.ext));
            let source = format!("{}/nested/filename.{}", case.dir, case.ext);
            fs::create_dir_all(root.join(case.dir).join("nested")).unwrap();
            let original = format!(
                "{{\n# author\n{}: 'old',\n{}: '{}'\n}}\n",
                case.id_field, case.companion_field, case.companion_value
            );
            write_utf8_no_bom(&root.join(&source), &original).unwrap();
            let save = save_spec_entity_with_json_options(
                &root.to_string_lossy(),
                case.kind,
                None,
                "old",
                SpecSaveInput {
                    json_write: JsonWriteOptions {
                        preserve_original_json: true,
                        confirmed_sources: Vec::new(),
                    },
                    ..save_input(Some(&source), entity_json(case, "old"))
                },
            )
            .unwrap();
            assert!(save.changes.is_empty());
            assert_eq!(save.refreshed_entity.unwrap()["relPath"], source);
            assert_eq!(read_utf8_no_bom(&root.join(&source)).unwrap(), original);
            let renamed = format!("{}/nested/new.{}", case.dir, case.ext);
            let result = save_spec_entity_with_json_options(
                &root.to_string_lossy(),
                case.kind,
                Some("old"),
                "new",
                SpecSaveInput {
                    json_write: JsonWriteOptions {
                        preserve_original_json: true,
                        confirmed_sources: Vec::new(),
                    },
                    ..save_input(Some(&source), entity_json(case, "new"))
                },
            )
            .unwrap();
            assert_eq!(result.changes.len(), 2);
            assert_eq!(
                Path::new(
                    result.refreshed_entity.as_ref().unwrap()["relPath"]
                        .as_str()
                        .unwrap()
                ),
                Path::new(&renamed)
            );
            assert!(!root.join(&source).exists());
            assert!(
                read_utf8_no_bom(&root.join(&renamed))
                    .unwrap()
                    .contains("# author")
            );
            apply_file_change_set(
                &root.to_string_lossy(),
                FileChangeReplayDirection::Undo,
                result.changes.clone(),
            )
            .unwrap();
            assert_eq!(read_utf8_no_bom(&root.join(&source)).unwrap(), original);
            assert!(!root.join(&renamed).exists());
            apply_file_change_set(
                &root.to_string_lossy(),
                FileChangeReplayDirection::Redo,
                result.changes,
            )
            .unwrap();
            assert!(!root.join(&source).exists());
            assert_eq!(
                read_json_file(&root.join(&renamed)).unwrap()[case.id_field],
                "new"
            );
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn spec_save_validates_disk_id_without_previous_id() {
        for case in [&VARIANT_CASE, &SKIN_CASE] {
            let root = temp_dir(&format!("spec_source_owner_{}", case.ext));
            fs::create_dir_all(root.join(case.dir)).unwrap();
            let source = format!("{}/filename.{}", case.dir, case.ext);
            write_utf8_no_bom(&root.join(&source), &entity_file_json(case, "old")).unwrap();
            let outside_index = format!("{}/unindexed.{}", case.dir, case.ext);
            write_utf8_no_bom(&root.join(&outside_index), &entity_file_json(case, "old")).unwrap();
            write_utf8_no_bom(&root.join(&source), &entity_file_json(case, "other")).unwrap();
            let result = save_spec_entity_with_json_options(
                &root.to_string_lossy(),
                case.kind,
                None,
                "old",
                save_input(Some(&source), entity_json(case, "old")),
            );
            assert!(matches!(result, Err(AppError::Message { .. })));
            assert_eq!(
                read_json_file(&root.join(&source)).unwrap()[case.id_field],
                "other"
            );
            assert_eq!(
                read_json_file(&root.join(&outside_index)).unwrap()[case.id_field],
                "old"
            );
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn spec_create_rejects_existing_id_in_another_filename() {
        for case in [&VARIANT_CASE, &SKIN_CASE] {
            let root = temp_dir(&format!("spec_create_conflict_{}", case.ext));
            fs::create_dir_all(root.join(case.dir)).unwrap();
            let source = format!("{}/filename.{}", case.dir, case.ext);
            write_utf8_no_bom(&root.join(&source), &entity_file_json(case, "old")).unwrap();
            assert!(
                create_spec_entity(
                    &root.to_string_lossy(),
                    case.kind,
                    "old",
                    entity_json(case, "old"),
                    true,
                )
                .is_err()
            );
            let created = create_spec_entity(
                &root.to_string_lossy(),
                case.kind,
                "new",
                entity_json(case, "new"),
                false,
            )
            .unwrap();
            assert_eq!(
                created.refreshed_entity.unwrap()["relPath"],
                format!("{}/new.{}", case.dir, case.ext)
            );
            assert_eq!(
                read_json_file(&root.join(&source)).unwrap()[case.id_field],
                "old"
            );
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn variant_save_can_rename_file_with_undo_redo() {
        rename_with_undo_redo(&VARIANT_CASE);
    }

    #[test]
    fn skin_save_can_rename_file_with_undo_redo() {
        rename_with_undo_redo(&SKIN_CASE);
    }

    #[test]
    fn variant_delete_returns_replayable_changeset() {
        delete_returns_replayable_changeset(&VARIANT_CASE);
    }

    #[test]
    fn skin_delete_returns_replayable_changeset() {
        delete_returns_replayable_changeset(&SKIN_CASE);
    }

    #[test]
    fn variant_delete_rejects_rel_path_outside_variant_directory() {
        delete_rejects_rel_path_outside_directory(&VARIANT_CASE);
    }

    #[test]
    fn skin_delete_rejects_rel_path_outside_skin_directory() {
        delete_rejects_rel_path_outside_directory(&SKIN_CASE);
    }

    #[test]
    fn variant_delete_requires_rel_path_entity_match() {
        delete_requires_rel_path_entity_match(&VARIANT_CASE);
    }

    #[test]
    fn skin_delete_requires_rel_path_entity_match() {
        delete_requires_rel_path_entity_match(&SKIN_CASE);
    }

    #[test]
    fn variant_save_requires_data_id_to_match_target_id() {
        save_requires_data_id_to_match_target_id(&VARIANT_CASE);
    }

    #[test]
    fn skin_save_requires_data_id_to_match_target_id() {
        save_requires_data_id_to_match_target_id(&SKIN_CASE);
    }
}
