use super::ensure_session_mod_scope;
use crate::{errors::AppError, models::command_payloads::ResolveModRelativePathPayload, services};

#[tauri::command(async)]
pub fn resolve_mod_relative_path(
    payload: ResolveModRelativePathPayload,
) -> Result<String, AppError> {
    ensure_session_mod_scope(&payload)?;
    services::project::resolve_mod_relative_path(&payload.mod_root, &payload.absolute_path)
}
