use crate::{
    errors::AppResult,
    io::{FsRootBoundary, load_json_dir_by_id, read_csv_data},
    models::{CsvTableKey, SkinFile, VariantFile},
};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    sync::{Arc, LazyLock, Mutex},
};

use super::super::model::{
    CoreCache, CoreSourceData, SessionCsvRow, SessionCsvTable, csv_table_spec,
};
use super::{
    lock_core_caches, persistent,
    spec_files::{load_skin_files, load_variant_files},
};

static CORE_CACHE_DIRTY: LazyLock<Mutex<BTreeSet<String>>> =
    LazyLock::new(|| Mutex::new(BTreeSet::new()));

fn mark_core_cache_dirty(cache_key: &str) {
    if let Ok(mut guard) = CORE_CACHE_DIRTY.lock() {
        guard.insert(cache_key.to_string());
    }
}

/// Persists the in-memory core cache once, and only when something loaded
/// since the last flush; a save failure is recorded and never propagated.
pub(crate) fn flush_core_cache(starsector_root: &str) -> AppResult<()> {
    let cache_key = core_cache_key(starsector_root)?;
    let dirty = CORE_CACHE_DIRTY
        .lock()
        .map(|mut guard| guard.remove(cache_key.as_str()))
        .unwrap_or(false);
    if !dirty {
        return Ok(());
    }
    let Some(cache) = lock_core_caches()?.get(&cache_key).cloned() else {
        return Ok(());
    };
    if let Err(error) = persistent::save_core_cache(starsector_root, &cache) {
        crate::diagnostics::record(format!("core cache save failed: {error}"));
    }
    Ok(())
}

pub(crate) fn core_cache_snapshot(starsector_root: &str) -> AppResult<Arc<CoreCache>> {
    let cache_key = core_cache_key(starsector_root)?;
    if let Some(cache) = lock_core_caches()?.get(&cache_key).cloned() {
        return Ok(cache);
    }
    let cache = persistent::load_core_cache(starsector_root)?.unwrap_or_else(CoreCache::empty);
    let cache = Arc::new(cache);
    lock_core_caches()?
        .entry(cache_key)
        .or_insert_with(|| cache.clone());
    Ok(cache)
}

fn store_core_cache(starsector_root: &str, cache: CoreCache) {
    let Ok(cache_key) = core_cache_key(starsector_root) else {
        return;
    };
    mark_core_cache_dirty(&cache_key);
    if let Err(error) = lock_core_caches().map(|mut guard| guard.insert(cache_key, Arc::new(cache)))
    {
        crate::diagnostics::record(format!("core cache store failed: {error}"));
    }
}

/// Hit path clones the `Arc` (no deep copy); a miss loads the asset from disk,
/// stores an `Arc` into the in-memory cache and marks it dirty for the next
/// flush. Persistence never happens inside a query.
fn get_or_load_core<T, G, S, L>(
    starsector_root: &str,
    get: G,
    store: S,
    load: L,
) -> AppResult<Arc<T>>
where
    G: Fn(&CoreCache) -> Option<&Arc<T>>,
    S: Fn(&mut CoreCache, Arc<T>),
    L: FnOnce(&Path) -> AppResult<T>,
{
    let cache = core_cache_snapshot(starsector_root)?;
    if let Some(value) = get(&cache) {
        return Ok(value.clone());
    }
    let core_dir = core_dir(starsector_root)?;
    let value = Arc::new(load(&core_dir)?);
    let mut updated = CoreCache::clone(&cache);
    store(&mut updated, value.clone());
    store_core_cache(starsector_root, updated);
    Ok(value)
}

pub(super) fn core_cache_key(starsector_root: &str) -> AppResult<String> {
    let root = FsRootBoundary::new(Path::new(starsector_root), "starsector root")?;
    Ok(root
        .root()
        .to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase())
}

pub(crate) fn core_dir(starsector_root: &str) -> AppResult<PathBuf> {
    let root = FsRootBoundary::new(Path::new(starsector_root), "starsector root")?;
    Ok(root.root().join("starsector-core"))
}

pub(crate) fn load_core_csv_table(
    starsector_root: &str,
    table: CsvTableKey,
) -> AppResult<Option<Arc<SessionCsvTable>>> {
    let table_key = table.as_str();
    let cache = core_cache_snapshot(starsector_root)?;
    if let Some(csv) = cache.csv_tables.get(table_key) {
        return Ok(Some(csv.clone()));
    }
    let rel = csv_table_spec(table).rel_path;
    let core_dir = core_dir(starsector_root)?;
    if !core_dir.exists() {
        return Ok(None);
    }
    let csv = read_csv_data(&core_dir.join(rel))?;
    let rows: Vec<SessionCsvRow> = csv
        .rows
        .into_iter()
        .enumerate()
        .map(|(index, row)| SessionCsvRow {
            row_key: format!("core:{table_key}:row:{index}"),
            row,
        })
        .collect();
    let next_row_seq = rows.len() as u64;
    let table_state = Arc::new(SessionCsvTable {
        header: csv.header,
        path: rel.to_string(),
        rows: Some(rows),
        next_row_seq,
        saved_text: None,
    });
    let mut updated = CoreCache::clone(&cache);
    updated
        .csv_tables
        .insert(table_key.to_string(), table_state.clone());
    store_core_cache(starsector_root, updated);
    Ok(Some(table_state))
}

pub(crate) fn load_core_ship_files(
    starsector_root: &str,
) -> AppResult<Arc<BTreeMap<String, Value>>> {
    get_or_load_core(
        starsector_root,
        |cache| cache.ship_files.as_ref(),
        |cache, files| cache.ship_files = Some(files),
        |core_dir| load_json_dir_by_id(&core_dir.join("data/hulls"), "ship", "hullId"),
    )
}

pub(crate) fn load_core_weapon_specs(
    starsector_root: &str,
) -> AppResult<Arc<BTreeMap<String, Value>>> {
    get_or_load_core(
        starsector_root,
        |cache| cache.weapon_specs.as_ref(),
        |cache, specs| cache.weapon_specs = Some(specs),
        |core_dir| load_json_dir_by_id(&core_dir.join("data/weapons"), "wpn", "id"),
    )
}

pub(crate) fn load_core_projectile_specs(
    starsector_root: &str,
) -> AppResult<Arc<BTreeMap<String, Value>>> {
    get_or_load_core(
        starsector_root,
        |cache| cache.projectile_specs.as_ref(),
        |cache, specs| cache.projectile_specs = Some(specs),
        |core_dir| load_json_dir_by_id(&core_dir.join("data/weapons/proj"), "proj", "id"),
    )
}

pub(crate) fn load_core_variant_files(starsector_root: &str) -> AppResult<Arc<Vec<VariantFile>>> {
    get_or_load_core(
        starsector_root,
        |cache| cache.variant_files.as_ref(),
        |cache, files| cache.variant_files = Some(files),
        |core_dir| Ok(load_variant_files(core_dir)?.0),
    )
}

pub(crate) fn load_core_skin_files(starsector_root: &str) -> AppResult<Arc<Vec<SkinFile>>> {
    get_or_load_core(
        starsector_root,
        |cache| cache.skin_files.as_ref(),
        |cache, files| cache.skin_files = Some(files),
        |core_dir| Ok(load_skin_files(core_dir)?.0),
    )
}

pub(crate) fn load_core_source_data(
    starsector_root: &str,
    table: CsvTableKey,
) -> AppResult<CoreSourceData> {
    let mut data = CoreSourceData::default();
    let requirements = csv_table_spec(table).core_source_requirements;
    if requirements.ships {
        data.ship_files = load_core_ship_files(starsector_root)?;
    }
    if requirements.weapons {
        data.weapon_specs = load_core_weapon_specs(starsector_root)?;
    }
    if requirements.variants {
        data.variant_files = load_core_variant_files(starsector_root)?;
    }
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;
    use std::fs;

    #[test]
    fn core_cache_rejects_parent_dir_root() {
        let root = temp_dir("core_cache_parent_dir_root");
        let escaped = root.join("..");

        let error = load_core_ship_files(&escaped.to_string_lossy())
            .unwrap_err()
            .to_string();

        let _ = fs::remove_dir_all(root);
        assert!(error.contains("invalid starsector root path"));
    }

    #[test]
    fn core_cache_key_normalizes_root_identity() {
        let root = temp_dir("core_cache_key");
        let left = core_cache_key(&root.to_string_lossy()).unwrap();
        let right = core_cache_key(&root.join(".").to_string_lossy()).unwrap();

        let _ = fs::remove_dir_all(root);
        assert_eq!(left, right);
    }

    #[test]
    fn persistent_core_cache_rejects_changed_source_content() {
        let root = temp_dir("persistent_core_cache");
        let cache_root = temp_dir("persistent_core_cache_root");
        let hull_dir = root.join("starsector-core/data/hulls");
        fs::create_dir_all(&hull_dir).unwrap();
        crate::io::write_utf8_no_bom(
            &hull_dir.join("demo.ship"),
            r#"{"hullId":"demo","spriteName":"before"}"#,
        )
        .unwrap();
        persistent::configure_persistent_index_cache(&cache_root).unwrap();

        let loaded = load_core_ship_files(&root.to_string_lossy()).unwrap();
        // Loads only dirty the in-memory cache; the flush (open/close path)
        // is what lands the build on disk.
        flush_core_cache(&root.to_string_lossy()).unwrap();
        let persisted = persistent::load_core_cache(&root.to_string_lossy()).unwrap();
        crate::io::write_utf8_no_bom(
            &hull_dir.join("demo.ship"),
            r#"{"hullId":"demo","spriteName":"after"}"#,
        )
        .unwrap();
        super::super::invalidate_core_cache(&root.to_string_lossy()).unwrap();
        let changed = load_core_ship_files(&root.to_string_lossy()).unwrap();

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(cache_root);
        assert_eq!(loaded["demo"]["spriteName"], "before");
        assert!(persisted.and_then(|cache| cache.ship_files).is_some());
        assert_eq!(changed["demo"]["spriteName"], "after");
    }
}
