use crate::{
    errors::AppError,
    models::{WriteResult, command_payloads::SaveCsvPatchPayload},
    services,
};

#[tauri::command(async)]
pub fn save_csv_patch(payload: SaveCsvPatchPayload) -> Result<WriteResult, AppError> {
    let transaction = services::write_transactions::begin(&payload, &payload.base_versions)?;
    let result = services::project::save_csv_patch_with_json_options(
        &payload.session_id,
        payload.table,
        payload.patches,
        payload.associated_specs,
        payload.json_write,
    )?;
    transaction.commit(result, "保存 CSV")
}
