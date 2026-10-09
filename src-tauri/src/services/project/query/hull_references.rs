use super::super::cache::{
    ensure_registered_table_rows, load_core_csv_table, loaded_csv_rows, loaded_registered_csv_rows,
    lock_session, session_handle,
};
use super::super::resources::{resource_ref, skin_resource_ref};
use super::super::{
    cache::{load_core_ship_files, load_core_skin_files},
    model::{ProjectSession, SessionCsvRow, is_comment_row, string_field, string_from_row},
};
use crate::{
    errors::AppResult,
    models::{
        CsvTableKey, HullReferenceGroup, HullReferenceKind, HullReferenceOption,
        HullReferencesResult, ResourceOwnerKind, ResourceSource,
    },
};
use std::collections::{BTreeMap, BTreeSet};

pub fn query_hull_references(
    session_id: &str,
    reference_ids: &[String],
) -> AppResult<HullReferencesResult> {
    let handle = session_handle(session_id)?;
    let mut session = lock_session(&handle)?;
    build_hull_references(&mut session, reference_ids)
}

fn build_hull_references(
    session: &mut ProjectSession,
    requested_reference_ids: &[String],
) -> AppResult<HullReferencesResult> {
    if !requested_reference_ids.is_empty() {
        return Ok(HullReferencesResult {
            groups: Vec::new(),
            hull_names: resolve_requested_hull_names(session, requested_reference_ids)?,
            sprites: resolve_requested_hull_sprites(session, requested_reference_ids)?,
            built_in_weapon_slots: resolve_built_in_weapon_slots(session, requested_reference_ids)?,
        });
    }

    ensure_registered_table_rows(session, CsvTableKey::Ships)?;
    let mod_hull_names =
        all_ship_names_from_rows(loaded_registered_csv_rows(session, CsvTableKey::Ships)?);
    let mut groups = Vec::new();
    let mut seen = BTreeSet::new();
    let ship_options: Vec<HullReferenceOption> = session
        .ship_files
        .iter()
        .map(|(hull_id, ship)| {
            seen.insert(hull_id.clone());
            let label = hull_reference_label(hull_id, mod_hull_names.get(hull_id), Some(ship));
            let resource_ref = string_field(&ship.data, "spriteName").map(|sprite| {
                resource_ref(
                    ResourceSource::Mod,
                    &sprite,
                    ResourceOwnerKind::Ship,
                    hull_id,
                    "thumbnail",
                )
            });
            HullReferenceOption {
                label,
                value: hull_id.clone(),
                origin: ResourceSource::Mod,
                kind: HullReferenceKind::Ship,
                resource_ref,
            }
        })
        .collect();
    if !ship_options.is_empty() {
        push_non_empty_group(
            &mut groups,
            ResourceSource::Mod,
            HullReferenceKind::Ship,
            ship_options,
        );
    }

    let skin_options: Vec<HullReferenceOption> = session
        .skin_files
        .iter()
        .map(|skin| {
            seen.insert(skin.skin_hull_id.clone());
            let resource_ref = skin_resource_ref(ResourceSource::Mod, &session.ship_files, skin);
            HullReferenceOption {
                label: hull_reference_label(
                    &skin.skin_hull_id,
                    mod_hull_names.get(&skin.skin_hull_id),
                    session.ship_files.get(&skin.skin_hull_id),
                ),
                value: skin.skin_hull_id.clone(),
                origin: ResourceSource::Mod,
                kind: HullReferenceKind::Skin,
                resource_ref,
            }
        })
        .collect();
    if !skin_options.is_empty() {
        push_non_empty_group(
            &mut groups,
            ResourceSource::Mod,
            HullReferenceKind::Skin,
            skin_options,
        );
    }

    if let Some(root) = session.manifest.starsector_root.as_ref() {
        let core_ship_files = load_core_ship_files(root)?;
        let core_skin_files = load_core_skin_files(root)?;
        let core_hull_names = load_core_csv_table(root, CsvTableKey::Ships)?
            .as_ref()
            .map(|table| loaded_csv_rows(table, CsvTableKey::Ships.as_str()))
            .transpose()?
            .map(all_ship_names_from_rows)
            .unwrap_or_default();

        let mut core_ship_options = Vec::new();
        for (hull_id, ship) in core_ship_files.iter() {
            if seen.contains(hull_id) {
                continue;
            }
            seen.insert(hull_id.clone());
            let label = hull_reference_label(hull_id, core_hull_names.get(hull_id), Some(ship));
            let resource_ref = string_field(&ship.data, "spriteName").map(|sprite| {
                resource_ref(
                    ResourceSource::Core,
                    &sprite,
                    ResourceOwnerKind::Ship,
                    hull_id,
                    "thumbnail",
                )
            });
            core_ship_options.push(HullReferenceOption {
                label,
                value: hull_id.clone(),
                origin: ResourceSource::Core,
                kind: HullReferenceKind::Ship,
                resource_ref,
            });
        }
        if !core_ship_options.is_empty() {
            push_non_empty_group(
                &mut groups,
                ResourceSource::Core,
                HullReferenceKind::Ship,
                core_ship_options,
            );
        }

        let mut core_skin_options = Vec::new();
        for skin in core_skin_files.iter() {
            if seen.contains(&skin.skin_hull_id) {
                continue;
            }
            seen.insert(skin.skin_hull_id.clone());
            let resource_ref = skin_resource_ref(ResourceSource::Core, &core_ship_files, skin);
            core_skin_options.push(HullReferenceOption {
                label: hull_reference_label(
                    &skin.skin_hull_id,
                    core_hull_names.get(&skin.skin_hull_id),
                    core_ship_files.get(&skin.skin_hull_id),
                ),
                value: skin.skin_hull_id.clone(),
                origin: ResourceSource::Core,
                kind: HullReferenceKind::Skin,
                resource_ref,
            });
        }
        if !core_skin_options.is_empty() {
            push_non_empty_group(
                &mut groups,
                ResourceSource::Core,
                HullReferenceKind::Skin,
                core_skin_options,
            );
        }
    }

    Ok(HullReferencesResult {
        groups,
        hull_names: BTreeMap::new(),
        sprites: BTreeMap::new(),
        built_in_weapon_slots: BTreeMap::new(),
    })
}

fn resolve_built_in_weapon_slots(
    session: &ProjectSession,
    reference_ids: &[String],
) -> AppResult<BTreeMap<String, Vec<crate::models::HullWeaponSlot>>> {
    let core_ships = session
        .manifest
        .starsector_root
        .as_ref()
        .map(|root| load_core_ship_files(root))
        .transpose()?;
    let core_skins = session
        .manifest
        .starsector_root
        .as_ref()
        .map(|root| load_core_skin_files(root))
        .transpose()?;
    reference_ids
        .iter()
        .map(|id| {
            let mut chain = Vec::new();
            let mut current = id.as_str();
            let mut seen = BTreeSet::new();
            while let Some(skin) = session
                .skin_files
                .iter()
                .find(|skin| skin.skin_hull_id == current)
                .or_else(|| {
                    core_skins
                        .as_ref()
                        .and_then(|skins| skins.iter().find(|skin| skin.skin_hull_id == current))
                })
            {
                if !seen.insert(current) {
                    return Err(crate::errors::AppError::message(
                        "skin.base_cycle",
                        format!("循环舰体皮肤引用: {id}"),
                    ));
                }
                let origin = if session
                    .skin_files
                    .iter()
                    .any(|candidate| std::ptr::eq(candidate, skin))
                {
                    ResourceSource::Mod
                } else {
                    ResourceSource::Core
                };
                chain.push((&skin.data, origin));
                current = &skin.base_hull_id;
            }
            let base_origin = if session.ship_files.contains_key(current) {
                ResourceSource::Mod
            } else {
                ResourceSource::Core
            };
            let mut slots: BTreeMap<String, ResourceSource> = session
                .ship_files
                .get(current)
                .or_else(|| core_ships.as_ref().and_then(|ships| ships.get(current)))
                .and_then(|ship| ship.data.get("builtInWeapons"))
                .and_then(serde_json::Value::as_object)
                .map(|weapons| {
                    weapons
                        .keys()
                        .map(|key| (key.clone(), base_origin))
                        .collect()
                })
                .unwrap_or_default();
            for (skin, origin) in chain.into_iter().rev() {
                if let Some(removed) = skin
                    .get("removeBuiltInWeapons")
                    .and_then(serde_json::Value::as_array)
                {
                    for slot in removed.iter().filter_map(serde_json::Value::as_str) {
                        slots.remove(slot);
                    }
                }
                if let Some(added) = skin
                    .get("builtInWeapons")
                    .and_then(serde_json::Value::as_object)
                {
                    slots.extend(added.keys().map(|key| (key.clone(), origin)));
                }
            }
            Ok((
                id.clone(),
                slots
                    .into_iter()
                    .map(|(id, origin)| crate::models::HullWeaponSlot { id, origin })
                    .collect(),
            ))
        })
        .collect()
}

fn resolve_requested_hull_names(
    session: &mut ProjectSession,
    requested_reference_ids: &[String],
) -> AppResult<BTreeMap<String, String>> {
    let requested_ids = requested_reference_ids
        .iter()
        .filter(|id| !id.trim().is_empty())
        .cloned()
        .collect::<BTreeSet<_>>();
    if requested_ids.is_empty() {
        return Ok(BTreeMap::new());
    }

    ensure_registered_table_rows(session, CsvTableKey::Ships)?;
    let mut hull_names = {
        let rows = loaded_registered_csv_rows(session, CsvTableKey::Ships)?;
        ship_names_from_rows(rows, &requested_ids)
    };
    extend_ship_hull_name_fallbacks(&mut hull_names, &session.ship_files, &requested_ids);
    let unresolved_ids = unresolved_hull_ids(&requested_ids, &hull_names);
    let Some(starsector_root) = session.manifest.starsector_root.as_ref() else {
        return Ok(hull_names);
    };
    if unresolved_ids.is_empty() {
        return Ok(hull_names);
    }
    if let Some(core_table) = load_core_csv_table(starsector_root, CsvTableKey::Ships)? {
        let core_rows = loaded_csv_rows(&core_table, CsvTableKey::Ships.as_str())?;
        hull_names.extend(ship_names_from_rows(core_rows, &unresolved_ids));
    }
    let unresolved_ids = unresolved_hull_ids(&requested_ids, &hull_names);
    if !unresolved_ids.is_empty() {
        let core_ship_files = load_core_ship_files(starsector_root)?;
        extend_ship_hull_name_fallbacks(&mut hull_names, &core_ship_files, &unresolved_ids);
    }
    Ok(hull_names)
}

fn unresolved_hull_ids(
    requested_ids: &BTreeSet<String>,
    hull_names: &BTreeMap<String, String>,
) -> BTreeSet<String> {
    requested_ids
        .iter()
        .filter(|id| !hull_names.contains_key(id.as_str()))
        .cloned()
        .collect()
}

fn extend_ship_hull_name_fallbacks(
    hull_names: &mut BTreeMap<String, String>,
    ship_files: &BTreeMap<String, crate::models::LoadedSpecRecord>,
    requested_ids: &BTreeSet<String>,
) {
    for hull_id in requested_ids {
        if hull_names.contains_key(hull_id) {
            continue;
        }
        if let Some(name) = ship_files
            .get(hull_id)
            .and_then(|ship| string_field(&ship.data, "hullName"))
        {
            hull_names.insert(hull_id.clone(), name);
        }
    }
}

fn ship_names_from_rows(
    rows: &[SessionCsvRow],
    requested_ids: &BTreeSet<String>,
) -> BTreeMap<String, String> {
    all_ship_names_from_rows(rows)
        .into_iter()
        .filter(|(id, _)| requested_ids.contains(id))
        .collect()
}

fn all_ship_names_from_rows(rows: &[SessionCsvRow]) -> BTreeMap<String, String> {
    rows.iter()
        .filter(|row| !is_comment_row(&row.data))
        .filter_map(|row| {
            let id = string_from_row(&row.data, "id")?;
            let name = string_from_row(&row.data, "name")?;
            Some((id, name))
        })
        .collect()
}

fn resolve_requested_hull_sprites(
    session: &ProjectSession,
    requested_reference_ids: &[String],
) -> AppResult<BTreeMap<String, crate::models::ResourceRef>> {
    let mut sprites = BTreeMap::new();
    for reference_id in requested_reference_ids {
        if let Some(resource) = resolve_mod_hull_sprite(session, reference_id) {
            sprites.insert(reference_id.clone(), resource);
        }
    }
    let unresolved: BTreeSet<String> = requested_reference_ids
        .iter()
        .filter(|reference_id| !sprites.contains_key(reference_id.as_str()))
        .cloned()
        .collect::<BTreeSet<_>>();
    if unresolved.is_empty() {
        return Ok(sprites);
    }
    let Some(root) = session.manifest.starsector_root.as_ref() else {
        return Ok(sprites);
    };
    let core_ship_files = load_core_ship_files(root)?;
    let core_skin_files = load_core_skin_files(root)?;
    for reference_id in unresolved {
        if let Some(resource) =
            resolve_core_hull_sprite(&core_ship_files, &core_skin_files, &reference_id)
        {
            sprites.insert(reference_id, resource);
        }
    }
    Ok(sprites)
}

fn resolve_mod_hull_sprite(
    session: &ProjectSession,
    reference_id: &str,
) -> Option<crate::models::ResourceRef> {
    session
        .skin_files
        .iter()
        .find(|skin| skin.skin_hull_id == reference_id)
        .and_then(|skin| skin_resource_ref(ResourceSource::Mod, &session.ship_files, skin))
        .or_else(|| {
            session
                .ship_files
                .get(reference_id)
                .and_then(|ship| string_field(&ship.data, "spriteName"))
                .map(|sprite| {
                    resource_ref(
                        ResourceSource::Mod,
                        &sprite,
                        ResourceOwnerKind::Ship,
                        reference_id,
                        "thumbnail",
                    )
                })
        })
}

fn resolve_core_hull_sprite(
    core_ship_files: &BTreeMap<String, crate::models::LoadedSpecRecord>,
    core_skin_files: &[crate::models::SkinFile],
    reference_id: &str,
) -> Option<crate::models::ResourceRef> {
    core_skin_files
        .iter()
        .find(|skin| skin.skin_hull_id == reference_id)
        .and_then(|skin| skin_resource_ref(ResourceSource::Core, core_ship_files, skin))
        .or_else(|| {
            core_ship_files
                .get(reference_id)
                .and_then(|ship| string_field(&ship.data, "spriteName"))
                .map(|sprite| {
                    resource_ref(
                        ResourceSource::Core,
                        &sprite,
                        ResourceOwnerKind::Ship,
                        reference_id,
                        "thumbnail",
                    )
                })
        })
}

/// Group identity is structured (origin + kind); the frontend composes its
/// own display label, so no chrome strings live here.
fn push_non_empty_group(
    groups: &mut Vec<HullReferenceGroup>,
    origin: ResourceSource,
    kind: HullReferenceKind,
    options: Vec<HullReferenceOption>,
) {
    if options.is_empty() {
        return;
    }
    groups.push(HullReferenceGroup {
        origin,
        kind,
        options,
    });
}

fn hull_reference_label(
    hull_id: &str,
    csv_name: Option<&String>,
    ship: Option<&crate::models::LoadedSpecRecord>,
) -> String {
    let hull_name = ship.and_then(|ship| string_field(&ship.data, "hullName"));
    let name = csv_name
        .map(String::as_str)
        .or(hull_name.as_deref())
        .unwrap_or_default();
    if name.trim().is_empty() || name == hull_id {
        hull_id.to_string()
    } else {
        format!("{name} ({hull_id})")
    }
}

#[cfg(test)]
mod tests {
    use super::super::super::session::{close_project_session, open_project_session_traced};
    use super::*;
    use crate::io::write_utf8_no_bom;

    use crate::testutil::temp_dir;

    #[test]
    fn hull_reference_query_returns_mod_and_core_ship_and_skin_refs() {
        let root = temp_dir("hull_reference_query");
        let mod_root = root.join("mods/demo");
        std::fs::create_dir_all(mod_root.join("data/hulls/skins")).unwrap();
        std::fs::create_dir_all(root.join("starsector-core/data/hulls/skins")).unwrap();
        write_utf8_no_bom(
            &mod_root.join("data/hulls/mod_ship.ship"),
            r#"{"hullId":"mod_ship","hullName":"Mod Ship","spriteName":"graphics/ships/mod_ship.png","builtInWeapons":{"WS001":"weapon_a","WS002":"weapon_a"}}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &mod_root.join("data/hulls/mod_fallback.ship"),
            r#"{"hullId":"mod_fallback","hullName":"Mod Fallback","spriteName":"graphics/ships/mod_fallback.png"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &mod_root.join("data/hulls/skins/mod_skin.skin"),
            r#"{"skinHullId":"mod_skin","baseHullId":"mod_ship","removeBuiltInWeapons":["WS001"],"builtInWeapons":{"WS003":"weapon_b"}}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/hulls/core_ship.ship"),
            r#"{"hullId":"core_ship","hullName":"Core Ship","spriteName":"graphics/ships/core_ship.png","builtInWeapons":{"CORE_SLOT":"core_weapon"}}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/hulls/core_fallback.ship"),
            r#"{"hullId":"core_fallback","hullName":"Core Fallback","spriteName":"graphics/ships/core_fallback.png"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &mod_root.join("data/hulls/ship_data.csv"),
            "id,name\r\nmod_ship,Mod CSV Ship\r\nmod_fallback,\r\nmod_skin,Mod CSV Skin\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/hulls/ship_data.csv"),
            "id,name\r\ncore_ship,Core CSV Ship\r\ncore_fallback,\r\ncore_skin,Core CSV Skin\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/hulls/skins/core_skin.skin"),
            r#"{"skinHullId":"core_skin","baseHullId":"core_ship"}"#,
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        write_utf8_no_bom(&mod_root.join("data/hulls/skins/mod_core.skin"), r#"{"skinHullId":"mod_core","baseHullId":"core_ship","builtInWeapons":{"MOD_SLOT":"mod_weapon"}}"#).unwrap();
        write_utf8_no_bom(&mod_root.join("data/hulls/skins/mod_override.skin"), r#"{"skinHullId":"mod_override","baseHullId":"core_ship","builtInWeapons":{"CORE_SLOT":"mod_weapon"}}"#).unwrap();
        let manifest = open_project_session_traced(&mod_root, Some(&root), &mut trace).unwrap();
        let catalog = query_hull_references(&manifest.session_id, &[]).unwrap();
        let previews = query_hull_references(
            &manifest.session_id,
            &[
                "mod_ship".to_string(),
                "mod_fallback".to_string(),
                "mod_skin".to_string(),
                "core_ship".to_string(),
                "core_fallback".to_string(),
                "core_skin".to_string(),
            ],
        )
        .unwrap();

        let values: Vec<String> = catalog
            .groups
            .iter()
            .flat_map(|group| group.options.iter().map(|option| option.value.clone()))
            .collect();
        assert!(values.contains(&"mod_ship".to_string()));
        assert!(values.contains(&"mod_fallback".to_string()));
        assert!(values.contains(&"mod_skin".to_string()));
        assert!(values.contains(&"core_ship".to_string()));
        assert!(values.contains(&"core_fallback".to_string()));
        assert!(values.contains(&"core_skin".to_string()));
        assert_eq!(
            catalog
                .groups
                .iter()
                .flat_map(|group| group.options.iter())
                .find(|option| option.value == "mod_ship")
                .map(|option| option.label.as_str()),
            Some("Mod CSV Ship (mod_ship)")
        );
        assert_eq!(
            catalog
                .groups
                .iter()
                .flat_map(|group| group.options.iter())
                .find(|option| option.value == "core_ship")
                .map(|option| option.label.as_str()),
            Some("Core CSV Ship (core_ship)")
        );
        assert_eq!(
            catalog
                .groups
                .iter()
                .flat_map(|group| group.options.iter())
                .find(|option| option.value == "mod_skin")
                .map(|option| option.label.as_str()),
            Some("Mod CSV Skin (mod_skin)")
        );
        assert_eq!(
            catalog
                .groups
                .iter()
                .flat_map(|group| group.options.iter())
                .find(|option| option.value == "core_skin")
                .map(|option| option.label.as_str()),
            Some("Core CSV Skin (core_skin)")
        );
        assert_eq!(
            catalog
                .groups
                .iter()
                .flat_map(|group| group.options.iter())
                .find(|option| option.value == "mod_fallback")
                .map(|option| option.label.as_str()),
            Some("Mod Fallback (mod_fallback)")
        );
        assert_eq!(
            catalog
                .groups
                .iter()
                .flat_map(|group| group.options.iter())
                .find(|option| option.value == "core_fallback")
                .map(|option| option.label.as_str()),
            Some("Core Fallback (core_fallback)")
        );
        assert!(catalog.sprites.is_empty());
        assert!(catalog.hull_names.is_empty());
        assert!(catalog.built_in_weapon_slots.is_empty());
        assert_eq!(
            previews.built_in_weapon_slots["mod_ship"]
                .iter()
                .map(|slot| slot.id.as_str())
                .collect::<Vec<_>>(),
            vec!["WS001", "WS002"]
        );
        assert_eq!(
            previews.built_in_weapon_slots["mod_skin"]
                .iter()
                .map(|slot| slot.id.as_str())
                .collect::<Vec<_>>(),
            vec!["WS002", "WS003"]
        );
        assert_eq!(
            previews.built_in_weapon_slots["core_skin"]
                .iter()
                .map(|slot| slot.id.as_str())
                .collect::<Vec<_>>(),
            vec!["CORE_SLOT"]
        );
        assert!(previews.groups.is_empty());
        let inherited = query_hull_references(
            &manifest.session_id,
            &["mod_core".to_string(), "mod_override".to_string()],
        )
        .unwrap();
        assert_eq!(
            inherited.built_in_weapon_slots["mod_core"]
                .iter()
                .map(|slot| (slot.id.as_str(), slot.origin))
                .collect::<Vec<_>>(),
            vec![
                ("CORE_SLOT", ResourceSource::Core),
                ("MOD_SLOT", ResourceSource::Mod)
            ]
        );
        assert_eq!(
            inherited.built_in_weapon_slots["mod_override"][0].origin,
            ResourceSource::Mod
        );
        assert_eq!(previews.sprites.len(), 6);
        assert_eq!(
            previews.hull_names.get("mod_ship"),
            Some(&"Mod CSV Ship".to_string())
        );
        assert_eq!(
            previews.hull_names.get("core_ship"),
            Some(&"Core CSV Ship".to_string())
        );
        assert_eq!(
            previews.hull_names.get("mod_fallback"),
            Some(&"Mod Fallback".to_string())
        );
        assert_eq!(
            previews.hull_names.get("core_fallback"),
            Some(&"Core Fallback".to_string())
        );
        assert_eq!(
            previews
                .sprites
                .get("core_skin")
                .map(|resource| resource.source.as_str()),
            Some("core")
        );
        assert_eq!(
            previews
                .sprites
                .get("mod_skin")
                .map(|resource| resource.rel_path.as_str()),
            Some("graphics/ships/mod_ship.png")
        );
        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(root);
    }
}
