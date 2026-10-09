use crate::{
    errors::AppResult,
    models::{
        GameOverviewData, OpenDirectoryResult,
        command_payloads::{DetectDirectoryPayload, ScanGameOverviewPayload},
    },
    services,
};

#[tauri::command(async)]
pub fn detect_directory(payload: DetectDirectoryPayload) -> AppResult<OpenDirectoryResult> {
    services::directory_opening::detect_directory(
        std::path::Path::new(&payload.path),
        payload.known_starsector_root.as_deref(),
    )
}

#[tauri::command(async)]
pub fn scan_game_overview(payload: ScanGameOverviewPayload) -> AppResult<GameOverviewData> {
    services::directory_opening::scan_game_overview(std::path::Path::new(&payload.starsector_root))
}
