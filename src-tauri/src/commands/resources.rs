use super::ensure_session_mod_scope;
use crate::{
    errors::AppError,
    models::{
        ResourceDataUrlBatchResult,
        command_payloads::{ResolveModRelativePathPayload, ResourceDataUrlBatchPayload},
    },
    services,
};

#[tauri::command(async)]
pub fn query_resource_data_urls(
    payload: ResourceDataUrlBatchPayload,
) -> Result<ResourceDataUrlBatchResult, AppError> {
    services::project::query_resource_data_urls(&payload.session_id, payload.resources)
}

#[tauri::command(async)]
pub fn resolve_mod_relative_path(
    payload: ResolveModRelativePathPayload,
) -> Result<String, AppError> {
    ensure_session_mod_scope(&payload)?;
    services::project::resolve_mod_relative_path(&payload.mod_root, &payload.absolute_path)
}
