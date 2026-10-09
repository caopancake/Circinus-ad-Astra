use crate::{
    errors::AppError,
    models::{HullReferencesResult, command_payloads::HullReferencesPayload},
    services,
};

#[tauri::command(async)]
pub fn query_hull_references(
    payload: HullReferencesPayload,
) -> Result<HullReferencesResult, AppError> {
    services::project::query_hull_references(&payload.session_id, &payload.reference_ids)
}
