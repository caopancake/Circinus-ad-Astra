use crate::{
    errors::AppError,
    models::command_payloads::{
        CloseProjectSessionPayload, CsvRowPreviewPayload, CsvSourceOptionsPayload,
        CsvTableWindowPayload, EditorDraftResourcesPayload, HullReferencesPayload,
        InvalidateCoreCachePayload, InvalidateProjectSessionPayload, QueryEntityListPayload,
        QueryEntityPayload, ResourceDataUrlBatchPayload,
    },
    models::{
        CsvRowPreview, CsvTableWindow, EntityData, HullReferencesResult,
        ProjectSessionInvalidationResult, ResourceDataUrlBatchResult, SourceOptionGroup,
    },
    services,
};

#[tauri::command(async)]
pub fn close_project_session(payload: CloseProjectSessionPayload) -> Result<(), AppError> {
    services::project::close_project_session(payload.session_id)
}

#[tauri::command(async)]
pub fn query_csv_table_window(payload: CsvTableWindowPayload) -> Result<CsvTableWindow, AppError> {
    services::project::query_csv_table_window(
        &payload.session_id,
        payload.table,
        payload.start,
        payload.count,
        payload.search,
        payload.faction,
    )
}

#[tauri::command(async)]
pub fn query_csv_source_options(
    payload: CsvSourceOptionsPayload,
) -> Result<Vec<SourceOptionGroup>, AppError> {
    services::project::query_csv_source_options(&payload.session_id, &payload.source)
}

#[tauri::command(async)]
pub fn query_csv_row_preview(payload: CsvRowPreviewPayload) -> Result<CsvRowPreview, AppError> {
    services::project::query_csv_row_preview(&payload.session_id, payload.table, &payload.row_key)
}

#[tauri::command(async)]
pub fn query_hull_references(
    payload: HullReferencesPayload,
) -> Result<HullReferencesResult, AppError> {
    services::project::query_hull_references(&payload.session_id, &payload.reference_ids)
}

#[tauri::command(async)]
pub fn query_entity(payload: QueryEntityPayload) -> Result<Option<EntityData>, AppError> {
    services::project::query_entity(&payload.session_id, payload.kind, &payload.id)
}

#[tauri::command(async)]
pub fn query_entity_base_versions(
    payload: QueryEntityPayload,
) -> Result<Vec<crate::models::FileVersion>, AppError> {
    services::project::query_entity_base_versions(&payload.session_id, payload.kind, &payload.id)
}

#[tauri::command(async)]
pub fn query_entity_list(payload: QueryEntityListPayload) -> Result<Vec<EntityData>, AppError> {
    services::project::query_entity_list(&payload.session_id, payload.kind)
}

#[tauri::command(async)]
pub fn query_editor_draft_resources(
    payload: EditorDraftResourcesPayload,
) -> Result<std::collections::BTreeMap<String, crate::models::ResourceRef>, AppError> {
    services::project::query_editor_draft_resources(
        &payload.session_id,
        payload.kind,
        &payload.id,
        &payload.draft,
    )
}

#[tauri::command(async)]
pub fn query_resource_data_urls(
    payload: ResourceDataUrlBatchPayload,
) -> Result<ResourceDataUrlBatchResult, AppError> {
    services::project::query_resource_data_urls(&payload.session_id, payload.resources)
}

#[tauri::command(async)]
pub fn invalidate_project_session(
    payload: InvalidateProjectSessionPayload,
) -> Result<ProjectSessionInvalidationResult, AppError> {
    services::project::invalidate_project_session(&payload.session_id, payload.changes)
}

#[tauri::command(async)]
pub fn invalidate_core_cache(payload: InvalidateCoreCachePayload) -> Result<(), AppError> {
    services::project::invalidate_core_cache(&payload.starsector_root)
}
