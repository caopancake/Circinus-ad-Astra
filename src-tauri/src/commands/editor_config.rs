use super::ensure_write_scope;
use crate::{
    errors::AppError,
    models::command_payloads::{
        DeleteIndexedConfigEntityPayload, DeleteSkinEntityPayload, DeleteVariantEntityPayload,
        IndexedConfigEntityPayload, LoadImportedEditorSpecPayload, SaveEditorSpecPayload,
        SkinEntityPayload, VariantEntityPayload,
    },
    models::{EntityKind, WriteResult},
    services,
};
use serde_json::Value;

fn spec_save_context(
    session_id: &str,
    kind: EntityKind,
    previous_id: Option<&str>,
    next_id: &str,
    source_rel_path: Option<&str>,
) -> Result<bool, AppError> {
    let target_exists = services::project::query_entity(session_id, kind, next_id)?.is_some();
    if let Some(source_rel_path) = source_rel_path {
        let source_id = previous_id.unwrap_or(next_id);
        let entity =
            services::project::query_entity(session_id, kind, source_id)?.ok_or_else(|| {
                AppError::message(
                    "spec.path_id_mismatch",
                    format!("会话索引中找不到源实体: {source_id}"),
                )
            })?;
        let indexed_rel_path = entity
            .data
            .get("relPath")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::message("spec.path_id_mismatch", "会话索引缺少实体路径"))?;
        if indexed_rel_path != source_rel_path {
            return Err(AppError::message(
                "spec.path_id_mismatch",
                format!("实体路径与会话索引不匹配: {source_rel_path} ({source_id})"),
            ));
        }
    }
    Ok(target_exists)
}

#[tauri::command(async)]
pub fn load_imported_editor_spec_file(
    payload: LoadImportedEditorSpecPayload,
) -> Result<Value, AppError> {
    services::editor_config::load_imported_editor_spec_file(payload.kind, payload.path)
}

#[tauri::command(async)]
pub fn save_editor_spec(payload: SaveEditorSpecPayload) -> Result<WriteResult, AppError> {
    ensure_write_scope(&payload)?;
    services::editor_config::save_editor_spec_with_json_options(
        &payload.mod_root,
        payload.kind,
        &payload.id,
        payload.data,
        payload.json_write,
        payload.ordered_json.as_deref(),
    )
}

#[tauri::command(async)]
pub fn save_indexed_config_entity(
    payload: IndexedConfigEntityPayload,
) -> Result<WriteResult<Value>, AppError> {
    ensure_write_scope(&payload)?;
    services::editor_config::save_indexed_config_with_json(
        &payload.mod_root,
        payload.kind,
        payload.previous_id.as_deref(),
        &payload.next_id,
        services::editor_config::IndexedSaveInput {
            index_row: payload.index_row,
            entity_data: payload.entity_data,
            delete_previous_target: payload.delete_previous_target,
            json_write: payload.json_write,
            ordered_json: payload.ordered_json.as_deref(),
        },
    )
}

#[tauri::command(async)]
pub fn create_indexed_config_entity(
    payload: IndexedConfigEntityPayload,
) -> Result<WriteResult<Value>, AppError> {
    ensure_write_scope(&payload)?;
    services::editor_config::create_indexed_config_entity(
        &payload.mod_root,
        payload.kind,
        &payload.next_id,
        payload.index_row,
        payload.entity_data,
    )
}

#[tauri::command(async)]
pub fn delete_indexed_config_entity(
    payload: DeleteIndexedConfigEntityPayload,
) -> Result<WriteResult<Value>, AppError> {
    ensure_write_scope(&payload)?;
    services::editor_config::delete_indexed_config_entity(
        &payload.mod_root,
        payload.kind,
        &payload.id,
        payload.delete_target,
    )
}

#[tauri::command(async)]
pub fn save_variant_entity(payload: VariantEntityPayload) -> Result<WriteResult<Value>, AppError> {
    ensure_write_scope(&payload)?;
    let target_exists = spec_save_context(
        &payload.session_id,
        EntityKind::Variant,
        payload.previous_id.as_deref(),
        &payload.next_id,
        payload.rel_path.as_deref(),
    )?;
    services::editor_config::save_spec_entity_with_json_options(
        &payload.mod_root,
        EntityKind::Variant,
        payload.previous_id.as_deref(),
        &payload.next_id,
        services::editor_config::SpecSaveInput {
            source_rel_path: payload.rel_path.as_deref(),
            target_exists_in_index: target_exists,
            data: payload.data,
            json_write: payload.json_write,
            ordered_json: payload.ordered_json.as_deref(),
        },
    )
}

#[tauri::command(async)]
pub fn create_variant_entity(
    payload: VariantEntityPayload,
) -> Result<WriteResult<Value>, AppError> {
    ensure_write_scope(&payload)?;
    let target_exists = services::project::query_entity(
        &payload.session_id,
        EntityKind::Variant,
        &payload.next_id,
    )?
    .is_some();
    services::editor_config::create_spec_entity(
        &payload.mod_root,
        EntityKind::Variant,
        &payload.next_id,
        payload.data,
        target_exists,
    )
}

#[tauri::command(async)]
pub fn delete_variant_entity(payload: DeleteVariantEntityPayload) -> Result<WriteResult, AppError> {
    ensure_write_scope(&payload)?;
    spec_save_context(
        &payload.session_id,
        EntityKind::Variant,
        Some(&payload.entity_id),
        &payload.entity_id,
        Some(&payload.rel_path),
    )?;
    services::editor_config::delete_spec_entity(
        &payload.mod_root,
        EntityKind::Variant,
        &payload.entity_id,
        &payload.rel_path,
    )
}

#[tauri::command(async)]
pub fn save_skin_entity(payload: SkinEntityPayload) -> Result<WriteResult<Value>, AppError> {
    ensure_write_scope(&payload)?;
    let target_exists = spec_save_context(
        &payload.session_id,
        EntityKind::Skin,
        payload.previous_id.as_deref(),
        &payload.next_id,
        payload.rel_path.as_deref(),
    )?;
    services::editor_config::save_spec_entity_with_json_options(
        &payload.mod_root,
        EntityKind::Skin,
        payload.previous_id.as_deref(),
        &payload.next_id,
        services::editor_config::SpecSaveInput {
            source_rel_path: payload.rel_path.as_deref(),
            target_exists_in_index: target_exists,
            data: payload.data,
            json_write: payload.json_write,
            ordered_json: payload.ordered_json.as_deref(),
        },
    )
}

#[tauri::command(async)]
pub fn create_skin_entity(payload: SkinEntityPayload) -> Result<WriteResult<Value>, AppError> {
    ensure_write_scope(&payload)?;
    let target_exists =
        services::project::query_entity(&payload.session_id, EntityKind::Skin, &payload.next_id)?
            .is_some();
    services::editor_config::create_spec_entity(
        &payload.mod_root,
        EntityKind::Skin,
        &payload.next_id,
        payload.data,
        target_exists,
    )
}

#[tauri::command(async)]
pub fn delete_skin_entity(payload: DeleteSkinEntityPayload) -> Result<WriteResult, AppError> {
    ensure_write_scope(&payload)?;
    spec_save_context(
        &payload.session_id,
        EntityKind::Skin,
        Some(&payload.entity_id),
        &payload.entity_id,
        Some(&payload.rel_path),
    )?;
    services::editor_config::delete_spec_entity(
        &payload.mod_root,
        EntityKind::Skin,
        &payload.entity_id,
        &payload.rel_path,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{io::write_utf8_no_bom, testutil::temp_dir};

    #[test]
    fn spec_save_scope_matches_indexed_filename_without_previous_id() {
        for (kind, dir, extension, id_field, companion) in [
            (
                EntityKind::Variant,
                "data/variants",
                "variant",
                "variantId",
                "hullId",
            ),
            (
                EntityKind::Skin,
                "data/hulls/skins",
                "skin",
                "skinHullId",
                "baseHullId",
            ),
        ] {
            let root = temp_dir(&format!("spec_scope_{extension}"));
            std::fs::create_dir_all(root.join(dir)).unwrap();
            let indexed = format!("{dir}/filename.{extension}");
            write_utf8_no_bom(
                &root.join(&indexed),
                &format!("{{\"{id_field}\":\"old\",\"{companion}\":\"hull\"}}"),
            )
            .unwrap();
            let mut trace = services::project::PerformanceTrace::new("project.openSession");
            let manifest =
                services::project::open_project_session_traced(&root, None, &mut trace).unwrap();
            let unindexed = format!("{dir}/other.{extension}");
            write_utf8_no_bom(
                &root.join(&unindexed),
                &format!("{{\"{id_field}\":\"old\",\"{companion}\":\"hull\"}}"),
            )
            .unwrap();
            assert!(
                spec_save_context(&manifest.session_id, kind, None, "old", Some(&indexed)).unwrap()
            );
            assert!(
                spec_save_context(&manifest.session_id, kind, None, "old", Some(&unindexed))
                    .is_err()
            );
            assert!(
                spec_save_context(
                    &manifest.session_id,
                    kind,
                    Some("missing"),
                    "new",
                    Some(&indexed)
                )
                .is_err()
            );
            assert!(!spec_save_context(&manifest.session_id, kind, None, "new", None).unwrap());
            services::project::close_project_session(manifest.session_id).unwrap();
            std::fs::remove_dir_all(root).unwrap();
        }
    }
}
