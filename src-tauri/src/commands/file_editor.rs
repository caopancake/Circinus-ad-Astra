use super::ensure_session_mod_scope;
use crate::{
    errors::AppError,
    models::command_payloads::{
        LoadEditableFilePayload, SaveTextFilePayload, TranscodeFilePayload,
    },
    models::{EditableFileData, WriteResult},
    services,
};

#[tauri::command(async)]
pub fn load_editable_file(payload: LoadEditableFilePayload) -> Result<EditableFileData, AppError> {
    ensure_session_mod_scope(&payload)?;
    services::file_editor::load_editable_file(&payload.mod_root, payload.path)
}

#[tauri::command(async)]
pub fn save_text_file(payload: SaveTextFilePayload) -> Result<WriteResult, AppError> {
    let transaction = services::write_transactions::begin(&payload, &payload.base_versions)?;
    let result =
        services::file_editor::save_text_file(&payload.mod_root, &payload.path, payload.text)?;
    transaction.commit(result, "保存文本")
}

#[tauri::command(async)]
pub fn transcode_file_to_utf8(payload: TranscodeFilePayload) -> Result<WriteResult, AppError> {
    let transaction = services::write_transactions::begin(&payload, &payload.base_versions)?;
    let result = services::file_editor::transcode_file_to_utf8(
        &payload.mod_root,
        &payload.path,
        &payload.encoding,
    )?;
    transaction.commit(result, "转换文本编码")
}
