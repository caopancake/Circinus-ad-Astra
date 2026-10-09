use crate::{
    errors::AppError,
    models::command_payloads::{
        EditorDraftResourcesPayload, EntityIdentityIntentPayload, QueryEntityListPayload,
        QueryEntityPayload,
    },
    models::{EntityData, EntityEditInfo, EntityIdentityIntent, ResourceRef},
    services,
};
use std::collections::BTreeMap;

#[tauri::command(async)]
pub fn query_entity(payload: QueryEntityPayload) -> Result<Option<EntityData>, AppError> {
    services::project::query_entity(&payload.session_id, payload.kind, &payload.id)
}

#[tauri::command(async)]
pub fn query_entity_list(payload: QueryEntityListPayload) -> Result<Vec<EntityData>, AppError> {
    services::project::query_entity_list(&payload.session_id, payload.kind)
}

#[tauri::command(async)]
pub fn query_entity_edit_target(payload: QueryEntityPayload) -> Result<EntityEditInfo, AppError> {
    services::project::query_entity_edit_target(&payload.session_id, payload.kind, &payload.id)
}

#[tauri::command(async)]
pub fn query_entity_identity_intent(
    payload: EntityIdentityIntentPayload,
) -> Result<EntityIdentityIntent, AppError> {
    services::project::query_entity_identity_intent(
        &payload.session_id,
        &payload.source,
        &payload.next_id,
    )
}

#[tauri::command(async)]
pub fn query_editor_draft_resources(
    payload: EditorDraftResourcesPayload,
) -> Result<BTreeMap<String, ResourceRef>, AppError> {
    services::project::query_editor_draft_resources(
        &payload.session_id,
        payload.kind,
        &payload.id,
        &payload.draft,
    )
}
