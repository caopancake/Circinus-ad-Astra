pub(super) mod core;
pub(super) mod csv;
pub(super) mod media;
pub(super) mod persistent;
pub(super) mod spec_files;
pub(super) mod spec_records;
pub(crate) use spec_records::load_spec_records;

use crate::{
    errors::{AppError, AppResult},
    models::ProjectSessionId,
};
use std::{
    collections::BTreeMap,
    sync::{Arc, LazyLock, Mutex},
};

use super::model::{CoreCache, ProjectSession};

pub(crate) use core::{
    flush_core_cache, load_core_csv_table, load_core_projectile_specs, load_core_ship_files,
    load_core_skin_files, load_core_source_data, load_core_variant_files,
};
pub(crate) use csv::{
    ensure_registered_table_rows, ensure_session_table_rows, loaded_csv_rows,
    loaded_registered_csv_rows, refresh_faction_annotations, registered_session_table,
    registered_session_table_mut,
};
pub(super) use media::clear_sprite_media_for_session;

static PROJECT_SESSIONS: LazyLock<Mutex<BTreeMap<ProjectSessionId, Arc<Mutex<ProjectSession>>>>> =
    LazyLock::new(|| Mutex::new(BTreeMap::new()));
static CORE_CACHES: LazyLock<Mutex<BTreeMap<String, Arc<CoreCache>>>> =
    LazyLock::new(|| Mutex::new(BTreeMap::new()));

pub(crate) fn sessions() -> &'static Mutex<BTreeMap<ProjectSessionId, Arc<Mutex<ProjectSession>>>> {
    &PROJECT_SESSIONS
}

/// Lock the session registry; poison maps to the shared AppError form. The
/// registry lock is only ever held for map insert/remove/get plus Arc clones.
pub(crate) fn lock_registry()
-> AppResult<std::sync::MutexGuard<'static, BTreeMap<ProjectSessionId, Arc<Mutex<ProjectSession>>>>>
{
    sessions()
        .lock()
        .map_err(|_| AppError::message("session.lock_poisoned", "project session lock poisoned"))
}

/// Lock the core-cache registry; poison maps to the shared AppError form.
pub(crate) fn lock_core_caches()
-> AppResult<std::sync::MutexGuard<'static, BTreeMap<String, Arc<CoreCache>>>> {
    core_caches()
        .lock()
        .map_err(|_| AppError::message("cache.lock_poisoned", "core cache lock poisoned"))
}

pub(crate) fn core_caches() -> &'static Mutex<BTreeMap<String, Arc<CoreCache>>> {
    &CORE_CACHES
}

/// The registry lock is only ever held for map insert/remove/get plus the Arc
/// clone returned here; all session work — including disk IO — happens on the
/// per-session lock so one session can never block another.
pub(crate) fn session_handle(session_id: &str) -> AppResult<Arc<Mutex<ProjectSession>>> {
    lock_registry()?.get(session_id).cloned().ok_or_else(|| {
        AppError::message(
            "session.unknown",
            format!("unknown project session: {session_id}"),
        )
    })
}

/// Lock a session handle, mapping poisoning to the shared AppError form.
pub(crate) fn lock_session(
    handle: &Mutex<ProjectSession>,
) -> AppResult<std::sync::MutexGuard<'_, ProjectSession>> {
    handle
        .lock()
        .map_err(|_| AppError::message("session.lock_poisoned", "project session lock poisoned"))
}

pub(super) fn invalidate_core_cache(starsector_root: &str) -> AppResult<()> {
    let cache_key = core::core_cache_key(starsector_root)?;
    // Persist what was built in memory before dropping, so the next open
    // reuses it (the content fingerprint still guards against stale sources).
    if let Err(error) = core::flush_core_cache(starsector_root) {
        crate::diagnostics::record(format!("core cache flush failed: {error}"));
    }
    lock_core_caches()?.remove(&cache_key);
    persistent::invalidate_core_fingerprint(&cache_key)
}
