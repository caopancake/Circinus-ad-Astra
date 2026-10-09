use crate::{
    errors::AppResult,
    models::{LoadedSpecRecord, ResourceSource},
};
use std::{collections::BTreeMap, path::Path};

/// Merges Mod projectile specs over core fallbacks; a Mod spec with the same
/// id always wins, core-only specs fill the rest.
pub(in crate::services::project) fn load_projectile_specs(
    mod_root: &Path,
    core_projectiles: Option<&BTreeMap<String, LoadedSpecRecord>>,
) -> AppResult<BTreeMap<String, LoadedSpecRecord>> {
    let mut result = BTreeMap::new();
    insert_projectiles(&mut result, mod_root)?;
    if let Some(core_projectiles) = core_projectiles {
        for (id, value) in core_projectiles {
            result.entry(id.clone()).or_insert_with(|| value.clone());
        }
    }
    Ok(result)
}

fn insert_projectiles(
    result: &mut BTreeMap<String, LoadedSpecRecord>,
    root: &Path,
) -> AppResult<()> {
    result.extend(super::super::cache::load_spec_records(
        root,
        "data/weapons/proj",
        "proj",
        "id",
        ResourceSource::Mod,
    )?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::write_utf8_no_bom;
    use crate::testutil::temp_dir;
    use std::fs;

    #[test]
    fn mod_projectile_overrides_core_fallback() {
        let root = temp_dir("projectile_fallback");
        let mod_proj = root.join("mod/data/weapons/proj");
        let core_proj = root.join("core/starsector-core/data/weapons/proj");
        fs::create_dir_all(&mod_proj).unwrap();
        fs::create_dir_all(&core_proj).unwrap();
        write_utf8_no_bom(&mod_proj.join("same.proj"), r#"{"id":"same","damage":2}"#).unwrap();
        write_utf8_no_bom(&core_proj.join("same.proj"), r#"{"id":"same","damage":1}"#).unwrap();
        write_utf8_no_bom(&core_proj.join("core_only.proj"), r#"{"id":"core_only"}"#).unwrap();

        let core_projectiles = super::super::super::cache::load_spec_records(
            &root.join("core/starsector-core"),
            "data/weapons/proj",
            "proj",
            "id",
            ResourceSource::Core,
        )
        .unwrap();
        let loaded = load_projectile_specs(&root.join("mod"), Some(&core_projectiles)).unwrap();

        let _ = fs::remove_dir_all(root);
        assert_eq!(loaded["same"].data["damage"], 2);
        assert!(loaded["core_only"].data.is_object());
    }
}
