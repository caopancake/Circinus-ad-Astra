use crate::{
    errors::AppError,
    models::{
        CsvRowPreview, CsvTableWindow, WriteResult,
        command_payloads::{CsvRowPreviewPayload, CsvTableWindowPayload, SaveCsvPatchPayload},
    },
    services,
};

#[tauri::command(async)]
pub fn query_csv_table_window(payload: CsvTableWindowPayload) -> Result<CsvTableWindow, AppError> {
    services::project::query_csv_table_window(
        &payload.session_id,
        payload.table,
        payload.start,
        payload.count,
        payload.search,
        payload.faction,
    )
}

#[tauri::command(async)]
pub fn query_csv_row_preview(payload: CsvRowPreviewPayload) -> Result<CsvRowPreview, AppError> {
    services::project::query_csv_row_preview(&payload.session_id, payload.table, &payload.row_key)
}

#[tauri::command(async)]
pub fn save_csv_patch(payload: SaveCsvPatchPayload) -> Result<WriteResult, AppError> {
    let transaction = services::write_transactions::begin(&payload, &payload.base_versions)?;
    services::project::require_csv_version_scope(
        &payload.session_id,
        payload.table,
        &payload.base_versions,
    )?;
    for spec in &payload.associated_specs {
        services::project::require_entity_version_scope(
            &payload.session_id,
            spec.target.kind,
            &spec.target.id,
            &payload.base_versions,
        )?;
    }
    let result = services::project::save_csv_patch_snapshot(
        &payload.session_id,
        payload.table,
        payload.patches,
        payload.associated_specs,
        payload.json_write,
    )?;
    transaction.commit(result, "保存 CSV")
}
