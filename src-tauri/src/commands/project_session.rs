use crate::{
    errors::AppError,
    models::{
        CommittedSessionUpdate, ProjectManifest, ProjectSessionInvalidationResult,
        command_payloads::{
            CloseProjectSessionPayload, InvalidateProjectSessionPayload, OpenProjectSessionPayload,
            SynchronizeCommittedWritePayload,
        },
    },
    services,
};

#[tauri::command(async)]
pub fn open_project_session(
    app_handle: tauri::AppHandle,
    payload: OpenProjectSessionPayload,
) -> Result<ProjectManifest, AppError> {
    services::project_session::open_project_session_with_root(
        app_handle,
        payload.mod_root,
        payload.starsector_root,
    )
}

#[tauri::command(async)]
pub fn close_project_session(payload: CloseProjectSessionPayload) -> Result<(), AppError> {
    services::write_transactions::release_session_commits(&payload.session_id)?;
    services::project::close_project_session(payload.session_id.clone())?;
    services::windows::release_session(&payload.session_id)
}

#[tauri::command(async)]
pub fn invalidate_project_session(
    payload: InvalidateProjectSessionPayload,
) -> Result<ProjectSessionInvalidationResult, AppError> {
    services::project::invalidate_project_session(&payload.session_id, payload.changes)
}

#[tauri::command(async)]
pub fn synchronize_committed_write(
    payload: SynchronizeCommittedWritePayload,
) -> Result<CommittedSessionUpdate, AppError> {
    services::write_transactions::synchronize_committed_write(
        &payload.session_id,
        &payload.mod_root,
        payload.commit_id,
    )
}
