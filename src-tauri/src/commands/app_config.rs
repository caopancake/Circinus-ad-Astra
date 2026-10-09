use crate::{errors::AppError, services};

#[tauri::command(async)]
pub fn open_config_dir(app_handle: tauri::AppHandle) -> Result<(), AppError> {
    services::app_config::open_config_dir(app_handle)
}

#[tauri::command(async)]
pub fn clear_config_files(app_handle: tauri::AppHandle) -> Result<(), AppError> {
    services::app_config::clear_app_config_files(app_handle)
}
