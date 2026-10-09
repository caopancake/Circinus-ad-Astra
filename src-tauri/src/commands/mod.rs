mod app_feedback_log;
mod app_settings;
mod assets;
mod directory_opening;
mod editor_config;
mod file_changes;
mod file_editor;
mod mod_creation;
mod project;
mod tables;
mod windows;
mod workspace_persistence;

use crate::{errors::AppResult, models::SessionModScope, services};

pub use app_feedback_log::*;
pub use app_settings::*;
pub use assets::*;
pub use directory_opening::*;
pub use editor_config::*;
pub use file_changes::*;
pub use file_editor::*;
pub use mod_creation::*;
pub use project::*;
pub use tables::*;
pub use windows::*;
pub use workspace_persistence::*;

/// The single ownership guard for every command payload carrying
/// `sessionId + modRoot`; payloads with an optional session (recovery editor)
/// skip the check when no session is attached.
pub(crate) fn ensure_session_mod_scope<T: SessionModScope>(payload: &T) -> AppResult<()> {
    if let Some(session_id) = payload.session_id() {
        services::project::ensure_project_session_mod_root(session_id, payload.mod_root())?;
    }
    Ok(())
}
