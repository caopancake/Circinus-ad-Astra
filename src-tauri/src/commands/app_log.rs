use crate::{
    errors::AppError,
    models::{AppLogStatus, command_payloads::AppendAppLogPayload},
    services,
};

#[tauri::command(async)]
pub fn append_app_log(
    app_handle: tauri::AppHandle,
    payload: AppendAppLogPayload,
) -> Result<(), AppError> {
    services::app_log::append_app_log(app_handle, payload.entry)
}

#[tauri::command(async)]
pub fn get_app_log_status(app_handle: tauri::AppHandle) -> Result<AppLogStatus, AppError> {
    services::app_log::app_log_status(app_handle)
}

#[tauri::command(async)]
pub fn open_app_log_file(app_handle: tauri::AppHandle) -> Result<(), AppError> {
    services::app_log::open_app_log_file(app_handle)
}

#[tauri::command(async)]
pub fn clear_app_log_file(app_handle: tauri::AppHandle) -> Result<AppLogStatus, AppError> {
    services::app_log::clear_app_log_file(app_handle)
}
