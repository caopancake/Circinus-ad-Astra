use crate::{
    errors::AppError,
    models::command_payloads::{
        CsvRowPreviewPayload, CsvSourceOptionsPayload, CsvTableWindowPayload,
        EditorDraftResourcesPayload, HullReferencesPayload, QueryEntityListPayload,
        QueryEntityPayload, ResourceDataUrlBatchPayload,
    },
    models::{
        CsvRowPreview, CsvTableWindow, EntityData, HullReferencesResult,
        ResourceDataUrlBatchResult, SourceOptionGroup,
    },
    services,
};

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
pub fn query_entity_edit_target(
    payload: QueryEntityPayload,
) -> Result<crate::models::EntityEditInfo, AppError> {
    services::project::query_entity_edit_target(&payload.session_id, payload.kind, &payload.id)
}

#[tauri::command(async)]
pub fn query_entity_identity_intent(
    payload: crate::models::command_payloads::EntityIdentityIntentPayload,
) -> Result<crate::models::EntityIdentityIntent, AppError> {
    services::project::query_entity_identity_intent(
        &payload.session_id,
        &payload.source,
        &payload.next_id,
    )
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
