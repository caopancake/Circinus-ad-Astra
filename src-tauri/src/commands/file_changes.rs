use super::ensure_write_scope;
use crate::{
    errors::AppError,
    models::WriteResult,
    models::command_payloads::{
        ApplyFileChangeSetPayload, SaveModFilesPayload, SaveModInfoPayload,
    },
    services,
};

#[tauri::command(async)]
pub fn save_mod_files(payload: SaveModFilesPayload) -> Result<WriteResult, AppError> {
    ensure_write_scope(&payload)?;
    services::file_changes::save_mod_files(&payload.mod_root, payload.files)
}

#[tauri::command(async)]
pub fn save_mod_info(payload: SaveModInfoPayload) -> Result<WriteResult, AppError> {
    ensure_write_scope(&payload)?;
    services::file_changes::save_mod_info(
        &payload.mod_root,
        payload.data,
        payload.json_write,
        payload.ordered_json.as_deref(),
    )
}

#[tauri::command(async)]
pub fn apply_file_change_set(payload: ApplyFileChangeSetPayload) -> Result<WriteResult, AppError> {
    ensure_write_scope(&payload)?;
    services::file_changes::apply_file_change_set(
        &payload.mod_root,
        payload.direction,
        payload.changes,
    )
}
