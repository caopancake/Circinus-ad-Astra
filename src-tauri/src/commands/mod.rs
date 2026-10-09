mod app_config;
mod app_log;
mod app_settings;
mod core_assets;
mod directory_opening;
mod editor_config;
mod entity_query;
mod file_changes;
mod file_editor;
mod hull_reference;
mod mod_creation;
mod project_session;
mod resources;
mod source_options;
mod tables;
mod windows;
mod workspace_persistence;

use crate::{errors::AppResult, models::SessionModScope, services};

pub use app_config::*;
pub use app_log::*;
pub use app_settings::*;
pub use core_assets::*;
pub use directory_opening::*;
pub use editor_config::*;
pub use entity_query::*;
pub use file_changes::*;
pub use file_editor::*;
pub use hull_reference::*;
pub use mod_creation::*;
pub use project_session::*;
pub use resources::*;
pub use source_options::*;
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
