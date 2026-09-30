use super::ensure_session_mod_scope;
use crate::{
    errors::AppError,
    models::{WriteResult, command_payloads::SaveCsvPatchPayload},
    services,
};

#[tauri::command(async)]
pub fn save_csv_patch(payload: SaveCsvPatchPayload) -> Result<WriteResult, AppError> {
    ensure_session_mod_scope(&payload)?;
    services::project::save_csv_patch_with_json_options(
        &payload.session_id,
        payload.table,
        payload.patches,
        payload.associated_specs,
        payload.json_write,
    )
}
