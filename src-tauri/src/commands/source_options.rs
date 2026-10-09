use crate::{
    errors::AppError,
    models::{SourceOptionGroup, command_payloads::CsvSourceOptionsPayload},
    services,
};

#[tauri::command(async)]
pub fn query_csv_source_options(
    payload: CsvSourceOptionsPayload,
) -> Result<Vec<SourceOptionGroup>, AppError> {
    services::project::query_csv_source_options(&payload.session_id, &payload.source)
}
