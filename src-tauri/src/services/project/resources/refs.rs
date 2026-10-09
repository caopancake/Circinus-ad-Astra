use super::super::cache::{lock_registry, lock_session, media, session_handle};
use super::super::model::string_field;
use super::sprites;
use crate::errors::{AppError, AppResult};
use crate::models::{LoadedSpecRecord, ResourceOwnerKind, ResourceRef, ResourceSource, SkinFile};
use serde_json::json;
use std::collections::BTreeMap;
use std::path::PathBuf;

/// The session-owned inputs to sprite loading, cloned out of the session under
/// a short lock so batch loading never holds the session (or registry) lock.
pub(in crate::services::project) struct SpriteSourceContext {
    session_id: String,
    mod_root: String,
    starsector_root: Option<String>,
}

pub(in crate::services::project) fn sprite_source_context(
    session_id: &str,
) -> AppResult<SpriteSourceContext> {
    let handle = session_handle(session_id)?;
    let session = lock_session(&handle)?;
    Ok(SpriteSourceContext {
        session_id: session_id.to_string(),
        mod_root: session.manifest.mod_root.clone(),
        starsector_root: session.manifest.starsector_root.clone(),
    })
}

pub(in crate::services::project) struct SpriteResourceBytes {
    pub(in crate::services::project) data_url: Option<String>,
}

pub(in crate::services::project) fn sprite_resource_bytes(
    context: &SpriteSourceContext,
    resource: &ResourceRef,
) -> AppResult<SpriteResourceBytes> {
    let cache_key = resource_cache_key(resource);
    if let Some(data_url) = media::lookup_data_url(&context.session_id, &cache_key) {
        return Ok(SpriteResourceBytes {
            data_url: Some(data_url),
        });
    }
    let loaded = match resource.source {
        ResourceSource::Core => {
            let root = context
                .starsector_root
                .as_ref()
                .map(|root| PathBuf::from(root).join("starsector-core"))
                .ok_or_else(|| {
                    AppError::message(
                        "resource.core_root_required",
                        "core resource requires starsector root",
                    )
                })?;
            sprites::load_sprite_bytes_from_root(&root, &resource.rel_path)?
        }
        ResourceSource::Mod => {
            let mod_root = PathBuf::from(&context.mod_root);
            let core_dir = context
                .starsector_root
                .as_ref()
                .map(|root| PathBuf::from(root).join("starsector-core"));
            sprites::load_sprite_bytes(&mod_root, core_dir.as_deref(), &resource.rel_path)?
        }
    };
    let data_url = loaded.as_ref().map(|bytes| bytes.data_url.clone());
    if let Some(bytes) = loaded {
        let registry = lock_registry()?;
        if registry.contains_key(&context.session_id) {
            media::insert_entry(
                &context.session_id,
                &cache_key,
                bytes.resolved_path,
                bytes.modified,
                bytes.length,
                bytes.data_url,
            );
        }
    }
    Ok(SpriteResourceBytes { data_url })
}

pub(in crate::services::project) fn resource_cache_key(resource: &ResourceRef) -> String {
    json!([
        resource.source.as_str(),
        resource.rel_path,
        resource.owner_kind,
        resource.owner_id,
        resource.key
    ])
    .to_string()
}

pub(in crate::services::project) fn skin_resource_ref(
    source: ResourceSource,
    ship_files: &BTreeMap<String, LoadedSpecRecord>,
    skin: &SkinFile,
) -> Option<ResourceRef> {
    string_field(&skin.data, "spriteName")
        .map(|sprite| {
            resource_ref(
                source,
                &sprite,
                ResourceOwnerKind::Skin,
                &skin.skin_hull_id,
                "thumbnail",
            )
        })
        .or_else(|| {
            ship_files
                .get(&skin.base_hull_id)
                .and_then(|ship| string_field(&ship.data, "spriteName"))
                .map(|sprite| {
                    resource_ref(
                        source,
                        &sprite,
                        ResourceOwnerKind::Skin,
                        &skin.skin_hull_id,
                        "thumbnail",
                    )
                })
        })
}

pub(in crate::services::project) fn resource_ref(
    source: ResourceSource,
    rel_path: &str,
    owner_kind: ResourceOwnerKind,
    owner_id: &str,
    key: &str,
) -> ResourceRef {
    ResourceRef {
        source,
        rel_path: rel_path.replace('\\', "/"),
        owner_kind,
        owner_id: owner_id.to_string(),
        key: key.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::project::definitions::table_definitions;
    use serde_json::{Map, Value};

    #[test]
    fn resource_cache_key_uses_complete_resource_identity() {
        let ship = resource_ref(
            ResourceSource::Mod,
            "graphics/shared/icon.png",
            ResourceOwnerKind::Ship,
            "ship",
            "icon",
        );
        let weapon = resource_ref(
            ResourceSource::Mod,
            "graphics/shared/icon.png",
            ResourceOwnerKind::Weapon,
            "weapon",
            "icon",
        );

        assert_ne!(resource_cache_key(&ship), resource_cache_key(&weapon));
    }

    #[test]
    fn resource_cache_key_preserves_structured_field_boundaries() {
        let left = resource_ref(
            ResourceSource::Mod,
            "graphics/shared/icon.png",
            ResourceOwnerKind::Ship,
            "owner:with",
            "separator",
        );
        let right = resource_ref(
            ResourceSource::Mod,
            "graphics/shared/icon.png",
            ResourceOwnerKind::Ship,
            "owner",
            "with:separator",
        );

        assert_ne!(resource_cache_key(&left), resource_cache_key(&right));
    }

    #[test]
    fn row_icon_resource_ref_requires_owner_id() {
        let mut row = Map::new();
        row.insert(
            "icon".to_string(),
            Value::String("graphics/icons/skill.png".to_string()),
        );

        let resource = table_definitions::csv_table_icon_resource_ref(
            ResourceSource::Mod,
            crate::models::CsvTableKey::Skills,
            &row,
        );

        assert!(resource.is_none());
    }
}
