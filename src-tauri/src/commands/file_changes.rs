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
    let transaction = services::write_transactions::begin(&payload, &payload.base_versions)?;
    let result = services::file_changes::save_mod_files(&payload.mod_root, payload.files)?;
    transaction.commit(result, "保存文件")
}

#[tauri::command(async)]
pub fn save_mod_info(
    payload: SaveModInfoPayload,
) -> Result<WriteResult<serde_json::Value>, AppError> {
    let transaction = services::write_transactions::begin(&payload, &payload.base_versions)?;
    let result = services::file_changes::save_mod_info(
        &payload.mod_root,
        payload.data,
        payload.json_write,
        payload.ordered_json.as_deref(),
    )?;
    transaction.commit(result, "保存 Mod 信息")
}

#[tauri::command(async)]
pub fn apply_file_change_set(payload: ApplyFileChangeSetPayload) -> Result<WriteResult, AppError> {
    services::write_transactions::replay(
        &payload.session_id,
        &payload.mod_root,
        payload.direction,
        payload.entry_id,
        payload.revision,
    )
}

#[tauri::command(async)]
pub fn query_file_history(
    payload: crate::models::command_payloads::FileHistoryPayload,
) -> Result<crate::models::FileHistorySnapshot, AppError> {
    services::write_transactions::query_history(&payload.session_id, &payload.mod_root)
}

#[tauri::command(async)]
pub fn clear_file_history(
    payload: crate::models::command_payloads::FileHistoryPayload,
) -> Result<crate::models::FileHistorySnapshot, AppError> {
    services::write_transactions::clear_history(&payload.session_id, &payload.mod_root)
}
