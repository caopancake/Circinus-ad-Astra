mod cache;
mod definitions;
mod invalidation;
mod model;
mod performance;
mod query;
mod resources;
mod root;
mod session;
mod versions;
mod write;

pub(crate) use cache::persistent::configure_persistent_index_cache;
pub(crate) use performance::PerformanceTrace;
pub use query::query_entity_identity_intent;
pub use query::query_file_entity_target;
pub use query::require_csv_version_scope;
pub use query::require_entity_version_scope;
pub use query::{
    query_csv_row_preview, query_csv_source_options, query_csv_table_window,
    query_editor_draft_resources, query_entity, query_entity_edit_target, query_entity_list,
    query_hull_references, query_resource_data_urls,
};
pub use resources::{resolve_mod_relative_path, scan_core_graphics};
pub(crate) use session::open_project_session_traced;
pub use session::{
    close_project_session, ensure_project_session_mod_root, invalidate_core_cache,
    invalidate_project_session,
};
pub use write::save_csv_patch_snapshot;
pub use write::save_entity_spec;
pub use write::save_entity_text;
pub use write::{delete_faction_entity, save_faction_entity};
