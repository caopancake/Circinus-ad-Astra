use super::model::{
    MISSION_LIST_REL_PATH, MISSION_LIST_TABLE_KEY, ProjectSession, SessionCsvTable, SpecBundle,
};
use super::{
    cache::{
        self, lock_session, session_handle,
        spec_files::{load_skin_files, load_variant_files},
    },
    definitions::{factions, projectiles, table_definitions},
    performance::PerformanceTrace,
    root,
};
use crate::{
    errors::{AppError, AppResult},
    io::FsRootBoundary,
    models::{EntitySummaries, ProjectManifest, TableSummary},
    models::{FileChangeRecord, ProjectInvalidation, ProjectSessionInvalidationResult},
};
use std::{
    collections::BTreeMap,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
    sync::{Arc, Mutex},
};

pub fn close_project_session(session_id: String) -> AppResult<()> {
    let removed = cache::lock_registry()?.remove(&session_id);
    if let Some(handle) = removed {
        let root = cache::lock_session(&handle)?.manifest.mod_root.clone();
        let _lease = crate::io::acquire_root_write_lock(Path::new(&root))?;
        let remaining = cache::lock_registry()?
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut same_root = false;
        for session in remaining {
            same_root |= cache::lock_session(&session)?.manifest.mod_root == root;
        }
        if !same_root {
            crate::services::file_history::release_history(&root)?;
        }
    }
    cache::clear_sprite_media_for_session(&session_id);
    Ok(())
}

pub fn ensure_project_session_mod_root(session_id: &str, mod_root: &str) -> AppResult<()> {
    let handle = session_handle(session_id)?;
    let session = lock_session(&handle)?;
    let expected_root = FsRootBoundary::new(Path::new(&session.manifest.mod_root), "mod root")?;
    let actual_root = FsRootBoundary::new(Path::new(mod_root), "mod root")?;
    if expected_root.root() != actual_root.root() {
        return Err(AppError::message(
            "session.mod_root_mismatch",
            format!("project session {session_id} does not own mod root: {mod_root}"),
        ));
    }
    Ok(())
}

pub fn invalidate_project_session(
    session_id: &str,
    changes: Vec<FileChangeRecord>,
) -> AppResult<ProjectSessionInvalidationResult> {
    let handle = session_handle(session_id)?;
    let mut session = lock_session(&handle)?;
    let mut invalidation = ProjectInvalidation::default();
    invalidation.merge(super::invalidation::invalidate_session_changes(
        &mut session,
        &changes,
    )?);
    super::versions::refresh_versions(&mut session, &changes)?;
    Ok(ProjectSessionInvalidationResult {
        manifest: session.manifest.clone(),
        invalidation,
    })
}

pub fn invalidate_core_cache(starsector_root: &str) -> AppResult<()> {
    cache::invalidate_core_cache(starsector_root)
}

pub(crate) fn open_project_session_traced(
    mod_root: &Path,
    starsector_root_override: Option<&Path>,
    trace: &mut PerformanceTrace,
) -> AppResult<ProjectManifest> {
    let session = build_project_session(mod_root, starsector_root_override, trace)?;
    let manifest = session.manifest.clone();
    let mut guard = cache::lock_registry()?;
    guard.insert(manifest.session_id.clone(), Arc::new(Mutex::new(session)));
    drop(guard);
    // Open concentrated cold loads of core assets; persist them once here so
    // the dump never runs inside a query.
    if let Some(root) = &manifest.starsector_root
        && let Err(error) = cache::flush_core_cache(root)
    {
        crate::diagnostics::record(format!("core cache flush failed: {error}"));
    }
    Ok(manifest)
}

pub(super) fn build_project_session(
    mod_root: &Path,
    starsector_root_override: Option<&Path>,
    trace: &mut PerformanceTrace,
) -> AppResult<ProjectSession> {
    let mod_root_boundary = FsRootBoundary::new(mod_root, "mod root")?;
    let mod_root = mod_root_boundary.root();
    let _lease = crate::io::acquire_root_write_lock(mod_root)?;
    let source_versions = super::versions::capture_versions(mod_root)?;
    let session_id = new_session_id();
    let starsector_root = starsector_root_override.map(Path::to_path_buf);
    let starsector_root = starsector_root
        .as_deref()
        .map(|root| {
            FsRootBoundary::new(root, "starsector root")
                .map(|boundary| boundary.root().to_path_buf())
        })
        .transpose()?;
    let core_available = starsector_root
        .as_ref()
        .is_some_and(|root| root.join("starsector-core").exists());
    let timer = trace.timer();
    let cached_index = cache::persistent::load_project_index(mod_root, starsector_root.as_deref())?;
    trace.record_stage(
        "persistent_index",
        timer,
        [(
            "result",
            if cached_index.is_some() {
                "hit"
            } else {
                "miss"
            }
            .to_string(),
        )],
    );
    let timer = trace.timer();
    let csv_tables = build_registered_session_csv_tables();
    trace.record_stage(
        "csv_index",
        timer,
        [("tables", csv_tables.len().to_string())],
    );
    let cached_index = match cached_index {
        Some(index) => index,
        None => build_project_index(mod_root, starsector_root.as_deref(), trace)?,
    };
    let super::cache::persistent::ProjectIndex {
        mod_info,
        faction_files,
        tag_map,
        mission_count,
        spec_bundle,
        table_entity_summaries,
    } = cached_index;
    let table_summaries = super::definitions::table_definitions::csv_table_definitions()
        .iter()
        .map(|definition| {
            let table = csv_tables
                .get(definition.spec.key.as_str())
                .ok_or_else(|| {
                    AppError::message(
                        "table.unknown",
                        format!(
                            "missing registered CSV table: {}",
                            definition.spec.key.as_str()
                        ),
                    )
                })?;
            Ok((
                definition.spec.key,
                TableSummary {
                    path: table.path.clone(),
                    header: table.header.clone(),
                    available: mod_root.join(&table.path).exists(),
                    total_rows: None,
                },
            ))
        })
        .collect::<AppResult<BTreeMap<_, _>>>()?;
    let entity_summaries = EntitySummaries {
        factions: faction_files.len(),
        missions: mission_count,
        ships: spec_bundle.ship_files.len(),
        weapons: spec_bundle.weapon_specs.len(),
        projectiles: spec_bundle.projectile_specs.len(),
        variants: spec_bundle.variant_files.len(),
        skins: spec_bundle.skin_files.len(),
        systems: spec_bundle.system_files.len(),
        skills: spec_bundle.skill_files.len(),
    };
    let manifest = ProjectManifest {
        base_versions: vec![crate::io::file_version(&mod_root.join("mod_info.json"))?],
        session_id,
        mod_root: mod_root.to_string_lossy().to_string(),
        starsector_root: starsector_root.map(|path| path.to_string_lossy().to_string()),
        core_available,
        associated_spec_tables: super::definitions::entity_definitions::associated_spec_tables(),
        mod_info,
        table_summaries,
        table_entity_summaries,
        entity_summaries,
        warnings: spec_bundle.warnings.clone(),
    };
    Ok(ProjectSession {
        source_versions,
        manifest,
        faction_files,
        tag_map,
        csv_tables,
        ship_files: spec_bundle.ship_files,
        variant_files: spec_bundle.variant_files,
        skin_files: spec_bundle.skin_files,
        weapon_specs: spec_bundle.weapon_specs,
        projectile_specs: spec_bundle.projectile_specs,
        system_files: spec_bundle.system_files,
        skill_files: spec_bundle.skill_files,
    })
}

fn build_project_index(
    mod_root: &Path,
    starsector_root: Option<&Path>,
    trace: &mut PerformanceTrace,
) -> AppResult<super::cache::persistent::ProjectIndex> {
    let timer = trace.timer();
    let mod_info = root::read_mod_info(mod_root)?;
    trace.record_stage(
        "mod_info",
        timer,
        [(
            "path",
            mod_root.join("mod_info.json").to_string_lossy().to_string(),
        )],
    );
    let timer = trace.timer();
    let (_, tag_map) = factions::discover_factions(mod_root)?;
    let faction_files = factions::load_faction_files(mod_root)?;
    trace.record_stage(
        "factions",
        timer,
        [
            ("factionFiles", faction_files.len().to_string()),
            ("tags", tag_map.len().to_string()),
        ],
    );
    let timer = trace.timer();
    let mission_count = root::count_mission_list_entries(mod_root)?;
    trace.record_stage(
        "mission_count",
        timer,
        [("missions", mission_count.to_string())],
    );
    let spec_bundle = load_spec_bundle(mod_root, starsector_root, trace)?;
    let entity_summaries = EntitySummaries {
        factions: faction_files.len(),
        missions: mission_count,
        ships: spec_bundle.ship_files.len(),
        weapons: spec_bundle.weapon_specs.len(),
        projectiles: spec_bundle.projectile_specs.len(),
        variants: spec_bundle.variant_files.len(),
        skins: spec_bundle.skin_files.len(),
        systems: spec_bundle.system_files.len(),
        skills: spec_bundle.skill_files.len(),
    };
    let table_entity_summaries =
        table_definitions::build_table_entity_summaries(mod_root, &entity_summaries)?;
    let index = super::cache::persistent::ProjectIndex {
        mod_info,
        faction_files,
        tag_map,
        mission_count,
        spec_bundle,
        table_entity_summaries,
    };
    if let Err(error) =
        cache::persistent::save_project_index(mod_root, starsector_root, index.clone())
    {
        crate::diagnostics::record(format!("persistent index save failed: {error}"));
    }
    Ok(index)
}

pub(super) fn build_registered_session_csv_tables() -> BTreeMap<String, SessionCsvTable> {
    let mut tables: BTreeMap<String, SessionCsvTable> =
        super::definitions::table_definitions::csv_table_definitions()
            .iter()
            .map(|definition| {
                (
                    definition.spec.key.as_str().to_string(),
                    SessionCsvTable {
                        header: Vec::new(),
                        path: definition.spec.rel_path.to_string(),
                        rows: None,
                        next_row_seq: 0,
                        saved_text: None,
                    },
                )
            })
            .collect();
    tables.insert(
        MISSION_LIST_TABLE_KEY.to_string(),
        SessionCsvTable {
            header: super::model::mission_list_default_header(),
            path: MISSION_LIST_REL_PATH.to_string(),
            rows: None,
            next_row_seq: 0,
            saved_text: None,
        },
    );
    tables
}

pub(super) fn new_session_id() -> String {
    static SESSION_SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let sequence = SESSION_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("session-{sequence:020}")
}

pub(super) fn load_spec_bundle(
    mod_root: &Path,
    starsector_root: Option<&Path>,
    trace: &mut PerformanceTrace,
) -> AppResult<SpecBundle> {
    let total_timer = trace.timer();
    let timer = trace.timer();
    let ship_files = cache::load_spec_records(
        mod_root,
        "data/hulls",
        "ship",
        "hullId",
        crate::models::ResourceSource::Mod,
    )?;
    trace.record_stage(
        "spec.ship_files",
        timer,
        [("files", ship_files.len().to_string())],
    );
    let timer = trace.timer();
    let weapon_specs = cache::load_spec_records(
        mod_root,
        "data/weapons",
        "wpn",
        "id",
        crate::models::ResourceSource::Mod,
    )?;
    trace.record_stage(
        "spec.weapon_specs",
        timer,
        [("files", weapon_specs.len().to_string())],
    );
    let timer = trace.timer();
    let (variant_files, variant_warnings) = load_variant_files(mod_root)?;
    trace.record_stage(
        "spec.variant_files",
        timer,
        [
            ("files", variant_files.len().to_string()),
            ("warnings", variant_warnings.len().to_string()),
        ],
    );
    let timer = trace.timer();
    let (skin_files, skin_warnings) = load_skin_files(mod_root)?;
    trace.record_stage(
        "spec.skin_files",
        timer,
        [
            ("files", skin_files.len().to_string()),
            ("warnings", skin_warnings.len().to_string()),
        ],
    );
    let warnings = variant_warnings.into_iter().chain(skin_warnings).collect();
    let timer = trace.timer();
    let core_projectiles = starsector_root
        .map(|root| cache::load_core_projectile_specs(&root.to_string_lossy()))
        .transpose()?;
    let projectile_specs =
        projectiles::load_projectile_specs(mod_root, core_projectiles.as_deref())?;
    trace.record_stage(
        "spec.projectile_specs",
        timer,
        [("files", projectile_specs.len().to_string())],
    );
    let timer = trace.timer();
    let system_files = cache::load_spec_records(
        mod_root,
        "data/shipsystems",
        "system",
        "id",
        crate::models::ResourceSource::Mod,
    )?;
    trace.record_stage(
        "spec.system_files",
        timer,
        [("files", system_files.len().to_string())],
    );
    let timer = trace.timer();
    let skill_files = cache::load_spec_records(
        mod_root,
        "data/characters/skills",
        "skill",
        "id",
        crate::models::ResourceSource::Mod,
    )?;
    trace.record_stage(
        "spec.skill_files",
        timer,
        [("files", skill_files.len().to_string())],
    );
    let bundle = SpecBundle {
        ship_files,
        variant_files,
        skin_files,
        weapon_specs,
        projectile_specs,
        system_files,
        skill_files,
        warnings,
    };
    trace.record_stage(
        "spec_bundle",
        total_timer,
        [
            ("shipFiles", bundle.ship_files.len().to_string()),
            ("weaponSpecs", bundle.weapon_specs.len().to_string()),
            ("projectileSpecs", bundle.projectile_specs.len().to_string()),
            ("systemFiles", bundle.system_files.len().to_string()),
            ("skillFiles", bundle.skill_files.len().to_string()),
            ("variantFiles", bundle.variant_files.len().to_string()),
            ("skinFiles", bundle.skin_files.len().to_string()),
        ],
    );
    Ok(bundle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::write_utf8_no_bom;
    use crate::testutil::temp_dir;

    #[test]
    fn opened_sessions_remain_registered_until_explicit_close() {
        let root = temp_dir("session_explicit_close");
        let manifests = (0..40)
            .map(|_| {
                let mut trace = PerformanceTrace::new("project.openSession");
                open_project_session_traced(&root, None, &mut trace).unwrap()
            })
            .collect::<Vec<_>>();
        for manifest in &manifests {
            ensure_project_session_mod_root(&manifest.session_id, &manifest.mod_root).unwrap();
        }
        let handle = session_handle(&manifests[0].session_id).unwrap();
        for manifest in &manifests {
            close_project_session(manifest.session_id.clone()).unwrap();
            assert!(session_handle(&manifest.session_id).is_err());
        }
        assert_eq!(
            lock_session(&handle).unwrap().manifest.session_id,
            manifests[0].session_id
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn open_project_session_rejects_variant_missing_required_ids() {
        let root = temp_dir("variant_missing_ids");
        std::fs::create_dir_all(root.join("data/variants")).unwrap();
        write_utf8_no_bom(
            &root.join("data/variants/bad.variant"),
            r#"{"variantId":"bad"}"#,
        )
        .unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let error = open_project_session_traced(&root, None, &mut trace)
            .unwrap_err()
            .to_string();

        let _ = std::fs::remove_dir_all(root);
        assert!(error.contains("bad.variant"));
        assert!(error.contains("hullId"));
    }

    #[test]
    fn open_project_session_rejects_corrupted_mod_info() {
        let root = temp_dir("mod_info_corrupted");
        write_utf8_no_bom(&root.join("mod_info.json"), "{").unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let error = open_project_session_traced(&root, None, &mut trace)
            .unwrap_err()
            .to_string();

        let _ = std::fs::remove_dir_all(root);
        assert!(error.contains("mod_info.json"));
    }

    #[test]
    fn open_project_session_rejects_corrupted_mission_list() {
        let root = temp_dir("mission_list_corrupted");
        std::fs::create_dir_all(root.join("data/missions")).unwrap();
        // Long rows are tolerated now; a real defect must still fail session open.
        write_utf8_no_bom(
            &root.join("data/missions/mission_list.csv"),
            "mission\r\n\"bad\r\n",
        )
        .unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let error = open_project_session_traced(&root, None, &mut trace)
            .unwrap_err()
            .to_string();

        let _ = std::fs::remove_dir_all(root);
        assert!(error.contains("mission_list.csv"));
    }

    #[test]
    fn open_project_session_rejects_parent_dir_starsector_root() {
        let root = temp_dir("session_parent_dir_starsector_root");
        let escaped = root.join("..");

        let mut trace = PerformanceTrace::new("project.openSession");
        let error = open_project_session_traced(&root, Some(&escaped), &mut trace)
            .unwrap_err()
            .to_string();

        let _ = std::fs::remove_dir_all(root);
        assert!(error.contains("invalid starsector root path"));
    }

    #[test]
    fn session_mod_root_validation_rejects_wrong_root() {
        let left = temp_dir("session_mod_root_left");
        let right = temp_dir("session_mod_root_right");
        write_utf8_no_bom(&left.join("mod_info.json"), r#"{"id":"left"}"#).unwrap();
        write_utf8_no_bom(&right.join("mod_info.json"), r#"{"id":"right"}"#).unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&left, None, &mut trace).unwrap();

        ensure_project_session_mod_root(&manifest.session_id, &left.to_string_lossy()).unwrap();
        let error = ensure_project_session_mod_root(&manifest.session_id, &right.to_string_lossy())
            .unwrap_err()
            .to_string();

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(left);
        let _ = std::fs::remove_dir_all(right);
        assert!(error.contains("does not own mod root"));
    }

    #[test]
    fn open_project_session_manifest_summaries_only_include_public_csv_tables() {
        let root = temp_dir("manifest_public_csv_tables");
        std::fs::create_dir_all(root.join("data/missions")).unwrap();
        write_utf8_no_bom(
            &root.join("data/missions/mission_list.csv"),
            "mission\r\ndemo\r\n",
        )
        .unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let manifest_json = serde_json::to_value(&manifest).unwrap();

        let _ = std::fs::remove_dir_all(root);
        assert_eq!(manifest.entity_summaries.missions, 1);
        assert!(
            !manifest_json["tableSummaries"]
                .as_object()
                .unwrap()
                .contains_key(MISSION_LIST_TABLE_KEY)
        );
    }

    #[test]
    fn open_project_session_manifest_counts_valid_table_entities() {
        let root = temp_dir("manifest_table_entity_counts");
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();
        std::fs::create_dir_all(root.join("data/campaign")).unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/wing_data.csv"),
            "id,variant\r\nwing_a,var_a\r\n,\r\n#comment,\r\nwing_b,var_b\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/campaign/sim_opponents.csv"),
            "variant id\r\nvar_a\r\n\r\n#comment\r\nvar_b\r\n",
        )
        .unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let loaded = open_project_session_traced(&root, None, &mut trace).unwrap();

        let _ = std::fs::remove_dir_all(root);
        assert_eq!(
            loaded.table_entity_summaries[&crate::models::CsvTableKey::Wings],
            2
        );
        assert_eq!(
            loaded.table_entity_summaries[&crate::models::CsvTableKey::SimOpponents],
            2
        );
        assert_eq!(
            loaded.table_summaries[&crate::models::CsvTableKey::Wings].total_rows,
            None
        );
    }

    #[test]
    fn open_project_session_warns_and_keeps_first_duplicate_variant_id() {
        let root = temp_dir("variant_duplicate_id");
        std::fs::create_dir_all(root.join("data/variants/a")).unwrap();
        std::fs::create_dir_all(root.join("data/variants/b")).unwrap();
        write_utf8_no_bom(
            &root.join("data/variants/a/one.variant"),
            r#"{"variantId":"dup","hullId":"hull_a"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/variants/b/two.variant"),
            r#"{"variantId":"dup","hullId":"hull_b"}"#,
        )
        .unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let loaded = open_project_session_traced(&root, None, &mut trace).unwrap();

        let _ = std::fs::remove_dir_all(root);
        assert_eq!(loaded.entity_summaries.variants, 1);
        assert!(
            loaded
                .warnings
                .iter()
                .any(|warning| warning.message.contains("重复 variantId dup")
                    && warning.path.contains("two.variant"))
        );
    }

    #[test]
    fn open_project_session_rejects_skin_missing_required_ids() {
        let root = temp_dir("skin_missing_ids");
        std::fs::create_dir_all(root.join("data/hulls/skins")).unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/skins/bad.skin"),
            r#"{"skinHullId":"bad"}"#,
        )
        .unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let error = open_project_session_traced(&root, None, &mut trace)
            .unwrap_err()
            .to_string();

        let _ = std::fs::remove_dir_all(root);
        assert!(error.contains("bad.skin"));
        assert!(error.contains("baseHullId"));
    }

    #[test]
    fn open_project_session_warns_and_keeps_first_duplicate_skin_hull_id() {
        let root = temp_dir("skin_duplicate_id");
        std::fs::create_dir_all(root.join("data/hulls/skins/a")).unwrap();
        std::fs::create_dir_all(root.join("data/hulls/skins/b")).unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/skins/a/one.skin"),
            r#"{"skinHullId":"dup","baseHullId":"hull_a"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/skins/b/two.skin"),
            r#"{"skinHullId":"dup","baseHullId":"hull_b"}"#,
        )
        .unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let loaded = open_project_session_traced(&root, None, &mut trace).unwrap();

        let _ = std::fs::remove_dir_all(root);
        assert_eq!(loaded.entity_summaries.skins, 1);
        assert!(
            loaded
                .warnings
                .iter()
                .any(|warning| warning.message.contains("重复 skinHullId dup")
                    && warning.path.contains("two.skin"))
        );
    }

    #[test]
    fn persistent_project_index_reuses_matching_sources_and_rebuilds_changed_sources() {
        let root = temp_dir("persistent_project_index");
        let cache_root = temp_dir("persistent_project_index_cache");
        std::fs::create_dir_all(root.join("data/variants")).unwrap();
        write_utf8_no_bom(
            &root.join("data/variants/demo.variant"),
            r#"{"variantId":"before","hullId":"hull"}"#,
        )
        .unwrap();
        super::cache::persistent::configure_persistent_index_cache(&cache_root).unwrap();

        let mut initial_trace = PerformanceTrace::new("project.openSession");
        let _ = build_project_session(&root, None, &mut initial_trace).unwrap();
        let mut cached_trace = PerformanceTrace::new("project.openSession");
        let cached = build_project_session(&root, None, &mut cached_trace).unwrap();

        write_utf8_no_bom(
            &root.join("data/variants/demo.variant"),
            r#"{"variantId":"after","hullId":"hull"}"#,
        )
        .unwrap();
        let mut changed_trace = PerformanceTrace::new("project.openSession");
        let changed = build_project_session(&root, None, &mut changed_trace).unwrap();

        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(cache_root);
        assert!(
            cached
                .variant_files
                .iter()
                .any(|file| file.variant_id == "before")
        );
        assert!(
            changed
                .variant_files
                .iter()
                .any(|file| file.variant_id == "after")
        );
        assert!(cached_trace.log_entries(&[]).iter().any(|entry| {
            entry.stage == "persistent_index"
                && entry
                    .fields
                    .iter()
                    .any(|(key, value)| key == "result" && value == "hit")
        }));
        assert!(changed_trace.log_entries(&[]).iter().any(|entry| {
            entry.stage == "persistent_index"
                && entry
                    .fields
                    .iter()
                    .any(|(key, value)| key == "result" && value == "miss")
        }));
    }

    #[test]
    fn concurrent_threads_on_separate_sessions_run_without_blocking_or_corruption() {
        use crate::models::{CsvFactionFilter, CsvRowPatch, CsvRowPatchAction, CsvTableKey};
        use crate::services::project::{query::query_csv_table_window, write::save_csv_patch};
        use serde_json::{Map, Value};
        use std::sync::{Arc, Barrier};

        const THREADS: usize = 4;
        const ROUNDS: usize = 4;
        const SESSIONS: usize = 2;
        const WRITES_PER_SESSION: usize = THREADS * ROUNDS / SESSIONS;

        let roots: Vec<_> = (0..SESSIONS)
            .map(|index| {
                let root = temp_dir(&format!("session_concurrency_{index}"));
                std::fs::create_dir_all(root.join("data/hulls")).unwrap();
                write_utf8_no_bom(
                    &root.join("data/hulls/ship_data.csv"),
                    "id,name\r\nbase_ship,Base Ship\r\n",
                )
                .unwrap();
                root
            })
            .collect();
        let session_ids: Vec<String> = roots
            .iter()
            .map(|root| {
                let mut trace = PerformanceTrace::new("project.openSession");
                open_project_session_traced(root, None, &mut trace)
                    .unwrap()
                    .session_id
            })
            .collect();

        let barrier = Arc::new(Barrier::new(THREADS));
        let mut handles = Vec::new();
        for thread_index in 0..THREADS {
            let barrier = barrier.clone();
            let session_id = session_ids[thread_index % SESSIONS].clone();
            handles.push(std::thread::spawn(move || {
                barrier.wait();
                for round in 0..ROUNDS {
                    let window = query_csv_table_window(
                        &session_id,
                        CsvTableKey::Ships,
                        0,
                        200,
                        None,
                        CsvFactionFilter::All,
                    )
                    .unwrap();
                    assert!(window.total_rows >= 1);
                    let mut row = Map::new();
                    row.insert(
                        "id".to_string(),
                        Value::String(format!("thread_{thread_index}_row_{round}")),
                    );
                    row.insert("name".to_string(), Value::String("Concurrent".to_string()));
                    save_csv_patch(
                        &session_id,
                        CsvTableKey::Ships,
                        vec![CsvRowPatch {
                            insert_at: None,
                            row_key: format!("ships:new:{thread_index}-{round}"),
                            action: CsvRowPatchAction::Upsert,
                            row,
                        }],
                        Vec::new(),
                    )
                    .unwrap();
                    invalidate_project_session(&session_id, Vec::new()).unwrap();
                }
            }));
        }
        for handle in handles {
            handle.join().unwrap();
        }

        for (session_index, session_id) in session_ids.iter().enumerate() {
            let window = query_csv_table_window(
                session_id,
                CsvTableKey::Ships,
                0,
                200,
                None,
                CsvFactionFilter::All,
            )
            .unwrap();
            assert_eq!(window.total_rows, 1 + WRITES_PER_SESSION);
            let _ = close_project_session(session_id.clone());
            let _ = std::fs::remove_dir_all(&roots[session_index]);
        }
    }
}
