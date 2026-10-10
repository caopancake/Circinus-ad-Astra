use crate::{
    errors::{AppError, AppResult},
    io::{FsRootBoundary, read_csv_data},
    models::{CsvTableKey, LoadedSpecRecord, ResourceSource, SkinFile, VariantFile},
};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
};

use super::super::model::{
    CoreCache, CoreSourceData, SessionCsvRow, SessionCsvTable, csv_table_spec,
};
use super::{
    CoreCacheEntry, lock_core_caches, persistent,
    spec_files::{load_skin_files, load_variant_files},
};

/// Persists the in-memory core cache once, and only when something loaded
/// since the last flush; a save failure is recorded and never propagated.
pub(crate) fn flush_core_cache(starsector_root: &str) -> AppResult<()> {
    let cache_key = core_cache_key(starsector_root)?;
    let Some(cache) = lock_core_caches()?.get(&cache_key).cloned() else {
        return Ok(());
    };
    let mut entry = lock_core_cache(&cache)?;
    if entry.dirty {
        match persistent::save_core_cache(starsector_root, &entry.data) {
            Ok(()) => entry.dirty = false,
            Err(error) => crate::diagnostics::record(format!("core cache save failed: {error}")),
        }
    }
    Ok(())
}

fn core_cache_handle(starsector_root: &str) -> AppResult<Arc<Mutex<CoreCacheEntry>>> {
    let cache_key = core_cache_key(starsector_root)?;
    if let Some(cache) = lock_core_caches()?.get(&cache_key).cloned() {
        return Ok(cache);
    }
    let cache = persistent::load_core_cache(starsector_root)?.unwrap_or_else(CoreCache::empty);
    let cache = Arc::new(Mutex::new(CoreCacheEntry {
        data: cache,
        dirty: false,
    }));
    Ok(lock_core_caches()?
        .entry(cache_key)
        .or_insert(cache)
        .clone())
}

fn lock_core_cache(handle: &Mutex<CoreCacheEntry>) -> AppResult<MutexGuard<'_, CoreCacheEntry>> {
    handle
        .lock()
        .map_err(|_| AppError::message("cache.lock_poisoned", "core cache lock poisoned"))
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
    let cache = core_cache_handle(starsector_root)?;
    if let Some(value) = get(&lock_core_cache(&cache)?.data) {
        return Ok(value.clone());
    }
    let core_dir = core_dir(starsector_root)?;
    let value = Arc::new(load(&core_dir)?);
    let mut entry = lock_core_cache(&cache)?;
    store(&mut entry.data, value.clone());
    entry.dirty = true;
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
    let rel = csv_table_spec(table).rel_path;
    let core_dir = core_dir(starsector_root)?;
    if !core_dir.exists() {
        return Ok(None);
    }
    get_or_load_core(
        starsector_root,
        |cache| cache.csv_tables.get(table_key),
        |cache, csv| {
            cache.csv_tables.insert(table_key.to_string(), csv);
        },
        |core_dir| {
            let csv = read_csv_data(&core_dir.join(rel))?;
            let rows: Vec<SessionCsvRow> = csv
                .rows
                .into_iter()
                .enumerate()
                .map(|(index, row)| SessionCsvRow {
                    row_key: format!("core:{table_key}:row:{index}"),
                    data: row.data,
                    is_comment: row.is_comment,
                    faction_id: None,
                })
                .collect();
            let next_row_seq = rows.len() as u64;
            Ok(SessionCsvTable {
                header: csv.header,
                path: rel.to_string(),
                rows: Some(rows),
                next_row_seq,
                saved_text: None,
            })
        },
    )
    .map(Some)
}

pub(crate) fn load_core_ship_files(
    starsector_root: &str,
) -> AppResult<Arc<BTreeMap<String, LoadedSpecRecord>>> {
    get_or_load_core(
        starsector_root,
        |cache| cache.ship_files.as_ref(),
        |cache, files| cache.ship_files = Some(files),
        |core_dir| {
            super::load_spec_records(
                core_dir,
                "data/hulls",
                "ship",
                "hullId",
                ResourceSource::Core,
            )
        },
    )
}

pub(crate) fn load_core_weapon_specs(
    starsector_root: &str,
) -> AppResult<Arc<BTreeMap<String, LoadedSpecRecord>>> {
    get_or_load_core(
        starsector_root,
        |cache| cache.weapon_specs.as_ref(),
        |cache, specs| cache.weapon_specs = Some(specs),
        |core_dir| {
            super::load_spec_records(core_dir, "data/weapons", "wpn", "id", ResourceSource::Core)
        },
    )
}

pub(crate) fn load_core_projectile_specs(
    starsector_root: &str,
) -> AppResult<Arc<BTreeMap<String, LoadedSpecRecord>>> {
    get_or_load_core(
        starsector_root,
        |cache| cache.projectile_specs.as_ref(),
        |cache, specs| cache.projectile_specs = Some(specs),
        |core_dir| {
            super::load_spec_records(
                core_dir,
                "data/weapons/proj",
                "proj",
                "id",
                ResourceSource::Core,
            )
        },
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
    fn overlapping_family_loads_preserve_each_loaded_catalog() {
        let root = temp_dir("core_overlapping_catalogs");
        let projectile_dir = root.join("starsector-core/data/weapons/proj");
        fs::create_dir_all(&projectile_dir).unwrap();
        fs::write(projectile_dir.join("demo.proj"), r#"{"id":"demo"}"#).unwrap();
        let root_text = root.to_string_lossy();
        let ships = get_or_load_core(
            &root_text,
            |cache| cache.ship_files.as_ref(),
            |cache, files| cache.ship_files = Some(files),
            |_| {
                load_core_projectile_specs(&root_text)?;
                Ok(BTreeMap::<String, LoadedSpecRecord>::new())
            },
        )
        .unwrap();
        let handle = core_cache_handle(&root_text).unwrap();
        {
            let snapshot = lock_core_cache(&handle).unwrap();
            assert!(
                snapshot
                    .data
                    .ship_files
                    .as_ref()
                    .is_some_and(|value| Arc::ptr_eq(value, &ships))
            );
            assert!(
                snapshot
                    .data
                    .projectile_specs
                    .as_ref()
                    .is_some_and(|value| value.contains_key("demo"))
            );
        }
        super::super::invalidate_core_cache(&root_text).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn released_catalog_does_not_publish_into_a_reopened_root() {
        let root = temp_dir("core_released_catalog");
        fs::create_dir_all(root.join("starsector-core")).unwrap();
        let root_text = root.to_string_lossy();
        get_or_load_core(
            &root_text,
            |cache| cache.ship_files.as_ref(),
            |cache, files| cache.ship_files = Some(files),
            |_| {
                super::super::invalidate_core_cache(&root_text)?;
                load_core_projectile_specs(&root_text)?;
                Ok(BTreeMap::<String, LoadedSpecRecord>::new())
            },
        )
        .unwrap();
        let handle = core_cache_handle(&root_text).unwrap();
        {
            let snapshot = lock_core_cache(&handle).unwrap();
            assert!(snapshot.data.ship_files.is_none());
            assert!(snapshot.data.projectile_specs.is_some());
        }
        super::super::invalidate_core_cache(&root_text).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

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
        crate::io::write_utf8_no_bom(
            &hull_dir.join("ship_data.csv"),
            "name,id\n#disabled,demo\n\"#quoted\",demo\n #space,space\n",
        )
        .unwrap();

        let loaded = load_core_ship_files(&root.to_string_lossy()).unwrap();
        let table = load_core_csv_table(&root.to_string_lossy(), CsvTableKey::Ships)
            .unwrap()
            .unwrap();
        assert_eq!(
            table
                .rows
                .as_ref()
                .unwrap()
                .iter()
                .map(|row| row.is_comment)
                .collect::<Vec<_>>(),
            [true, false, false]
        );
        // Loads only dirty the in-memory cache; the flush (open/close path)
        // is what lands the build on disk.
        flush_core_cache(&root.to_string_lossy()).unwrap();
        let persisted = persistent::load_core_cache(&root.to_string_lossy()).unwrap();
        let stored_table = &persisted.as_ref().unwrap().csv_tables["ships"];
        assert_eq!(
            stored_table.rows.as_ref().unwrap()[1].data["name"],
            "#quoted"
        );
        assert!(!stored_table.rows.as_ref().unwrap()[1].is_comment);
        super::super::invalidate_core_cache(&root.to_string_lossy()).unwrap();
        let restored = load_core_csv_table(&root.to_string_lossy(), CsvTableKey::Ships)
            .unwrap()
            .unwrap();
        assert_eq!(
            restored
                .rows
                .as_ref()
                .unwrap()
                .iter()
                .map(|row| row.is_comment)
                .collect::<Vec<_>>(),
            [true, false, false]
        );
        crate::io::write_utf8_no_bom(
            &hull_dir.join("demo.ship"),
            r#"{"hullId":"demo","spriteName":"after"}"#,
        )
        .unwrap();
        super::super::invalidate_core_cache(&root.to_string_lossy()).unwrap();
        let changed = load_core_ship_files(&root.to_string_lossy()).unwrap();

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(cache_root);
        assert_eq!(loaded["demo"].data["spriteName"], "before");
        assert!(persisted.and_then(|cache| cache.ship_files).is_some());
        assert_eq!(changed["demo"].data["spriteName"], "after");
    }
}
