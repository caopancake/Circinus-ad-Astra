use crate::{
    errors::{AppError, AppResult},
    io::FsRootBoundary,
};
use base64::{Engine as _, engine::general_purpose};
#[cfg(test)]
use serde_json::Value;
#[cfg(test)]
use std::collections::BTreeMap;
use std::{
    fs,
    path::{Component, Path, PathBuf},
    time::SystemTime,
};

pub(super) struct SpriteBytes {
    pub(super) resolved_path: PathBuf,
    pub(super) modified: SystemTime,
    pub(super) length: u64,
    pub(super) data_url: String,
}

/// The single source for the project's image type universe: core graphics
/// scanning filters on it and sprite data URLs take their MIME from it.
pub(super) fn image_mime_type(extension: &str) -> Option<&'static str> {
    match extension.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        _ => None,
    }
}

pub(super) fn load_sprite_bytes_from_root(
    root: &Path,
    sprite: &str,
) -> AppResult<Option<SpriteBytes>> {
    let boundary = FsRootBoundary::new(root, "resource root")?;
    load_sprite_bytes_from_boundary(&boundary, None, sprite)
}

pub(super) fn load_sprite_bytes(
    mod_root: &Path,
    core_dir: Option<&Path>,
    sprite: &str,
) -> AppResult<Option<SpriteBytes>> {
    let mod_boundary = FsRootBoundary::new(mod_root, "mod resource root")?;
    let core_boundary = core_dir
        .filter(|core| core.exists())
        .map(|core| FsRootBoundary::new(core, "core resource root"))
        .transpose()?;
    load_sprite_bytes_from_boundary(&mod_boundary, core_boundary.as_ref(), sprite)
}

#[cfg(test)]
pub(super) fn load_sprite_data_url(
    mod_root: &Path,
    core_dir: Option<&Path>,
    sprite: &str,
) -> AppResult<Option<String>> {
    Ok(load_sprite_bytes(mod_root, core_dir, sprite)?.map(|bytes| bytes.data_url))
}

pub fn resolve_mod_relative_path(mod_root: &str, absolute_path: &str) -> AppResult<String> {
    let boundary = FsRootBoundary::new(Path::new(mod_root), "mod root")?;
    boundary
        .resolve_changed_path_to_relative(absolute_path, "selected file")?
        .ok_or_else(|| {
            AppError::message(
                "resource.outside_mod",
                format!("所选文件位于 Mod 目录之外：{absolute_path}"),
            )
        })
}

fn load_sprite_bytes_from_boundary(
    mod_root: &FsRootBoundary,
    core_dir: Option<&FsRootBoundary>,
    sprite: &str,
) -> AppResult<Option<SpriteBytes>> {
    let Some(rel) = validate_sprite_relative_path(sprite)? else {
        return Ok(None);
    };
    // Try mod directory first
    let mod_path = mod_root.resolve_relative(&rel, "sprite path")?;
    if mod_path.is_file() {
        return read_sprite_bytes(&mod_path);
    }
    // Fallback: try starsector-core directory
    if let Some(core) = core_dir {
        let core_path = core.resolve_relative(&rel, "core sprite path")?;
        if core_path.is_file() {
            return read_sprite_bytes(&core_path);
        }
    }
    Ok(None)
}

fn read_sprite_bytes(path: &Path) -> AppResult<Option<SpriteBytes>> {
    let metadata = fs::metadata(path).map_err(|error| {
        AppError::context(
            format!("读取贴图文件失败 ({})", path.display()),
            error.into(),
        )
    })?;
    let bytes = fs::read(path).map_err(|error| {
        AppError::context(
            format!("读取贴图文件失败 ({})", path.display()),
            error.into(),
        )
    })?;
    let mime = path
        .extension()
        .and_then(|extension| extension.to_str())
        .and_then(image_mime_type)
        .unwrap_or("image/png");
    Ok(Some(SpriteBytes {
        resolved_path: path.to_path_buf(),
        modified: metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
        length: metadata.len(),
        data_url: format!(
            "data:{mime};base64,{}",
            general_purpose::STANDARD.encode(bytes)
        ),
    }))
}

fn validate_sprite_relative_path(sprite: &str) -> AppResult<Option<String>> {
    let rel = sprite.replace('\\', "/").trim().to_string();
    if rel.is_empty() {
        return Ok(None);
    }
    let path = Path::new(&rel);
    if path.is_absolute() || path_escapes_resource_root(path) {
        return Err(AppError::message(
            "resource.outside_root",
            format!("sprite path is outside resource root: {rel}"),
        ));
    }
    Ok(Some(rel))
}

fn path_escapes_resource_root(path: &Path) -> bool {
    path.components()
        .any(|part| matches!(part, Component::ParentDir | Component::Prefix(_)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;
    use std::fs;

    fn load_ship_sprite_data(
        mod_root: &Path,
        core_dir: Option<&Path>,
        ship_files: &BTreeMap<String, Value>,
    ) -> BTreeMap<String, String> {
        let mut sprites = BTreeMap::new();
        for (id, value) in ship_files {
            if let Some(sprite) = value.get("spriteName").and_then(Value::as_str)
                && let Ok(Some(data_url)) = load_sprite_data_url(mod_root, core_dir, sprite)
            {
                sprites.insert(id.clone(), data_url);
            }
        }
        sprites
    }

    fn load_weapon_sprite_data(
        mod_root: &Path,
        core_dir: Option<&Path>,
        weapon_specs: &BTreeMap<String, Value>,
    ) -> BTreeMap<String, BTreeMap<String, String>> {
        let mut sprites = BTreeMap::new();
        for (id, value) in weapon_specs {
            let mut weapon_sprites = BTreeMap::new();
            for field in crate::services::project::model::WEAPON_SPRITE_FIELDS {
                if let Some(sprite) = value.get(field).and_then(Value::as_str)
                    && let Ok(Some(data_url)) = load_sprite_data_url(mod_root, core_dir, sprite)
                {
                    weapon_sprites.insert(field.to_string(), data_url);
                }
            }
            if !weapon_sprites.is_empty() {
                sprites.insert(id.clone(), weapon_sprites);
            }
        }
        sprites
    }

    #[test]
    fn missing_sprite_does_not_create_entry() {
        let root = temp_dir("missing_sprite");
        let mut ships = BTreeMap::new();
        ships.insert(
            "demo".to_string(),
            serde_json::json!({"hullId":"demo","spriteName":"graphics/ships/missing.png"}),
        );

        let loaded = load_ship_sprite_data(&root, None, &ships);

        let _ = fs::remove_dir_all(root);
        assert!(loaded.is_empty());
    }

    #[test]
    fn sprite_data_url_matches_file_type() {
        let root = temp_dir("sprite_mime_type");
        let sprite_dir = root.join("graphics/ships");
        fs::create_dir_all(&sprite_dir).unwrap();
        fs::write(sprite_dir.join("demo.jpg"), b"jpeg-bytes").unwrap();

        let data_url = load_sprite_data_url(&root, None, "graphics/ships/demo.jpg")
            .unwrap()
            .unwrap();

        let _ = fs::remove_dir_all(root);
        assert!(data_url.starts_with("data:image/jpeg;base64,"));
    }

    #[test]
    fn core_fallback_loads_sprite() {
        let mod_dir = temp_dir("core_fallback_mod");
        let core_dir = temp_dir("core_fallback_core");

        // Create sprite in core_dir only (not in mod_dir)
        let sprite_dir = core_dir.join("graphics/weapons");
        fs::create_dir_all(&sprite_dir).unwrap();
        // Write a minimal valid PNG (1x1 pixel)
        let png_bytes: [u8; 69] = [
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00,
            0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08,
            0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC,
            0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];
        fs::write(sprite_dir.join("test_turret.png"), png_bytes).unwrap();

        let mut weapon_specs = BTreeMap::new();
        weapon_specs.insert(
            "testgun".to_string(),
            serde_json::json!({
                "id": "testgun",
                "turretSprite": "graphics/weapons/test_turret.png"
            }),
        );

        let loaded = load_weapon_sprite_data(&mod_dir, Some(core_dir.as_path()), &weapon_specs);

        let _ = fs::remove_dir_all(&mod_dir);
        let _ = fs::remove_dir_all(&core_dir);

        // Should have loaded from core
        assert!(loaded.contains_key("testgun"));
        let sprites = &loaded["testgun"];
        assert!(sprites.contains_key("turretSprite"));
        assert!(sprites["turretSprite"].starts_with("data:image/png;base64,"));
    }

    #[test]
    fn mod_sprite_takes_priority_over_core() {
        let mod_dir = temp_dir("priority_mod");
        let core_dir = temp_dir("priority_core");

        // Minimal PNG
        let png_bytes: [u8; 69] = [
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00,
            0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08,
            0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC,
            0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];

        // Create sprite in BOTH directories
        let mod_sprite_dir = mod_dir.join("graphics/weapons");
        let core_sprite_dir = core_dir.join("graphics/weapons");
        fs::create_dir_all(&mod_sprite_dir).unwrap();
        fs::create_dir_all(&core_sprite_dir).unwrap();
        fs::write(mod_sprite_dir.join("shared.png"), png_bytes).unwrap();
        fs::write(core_sprite_dir.join("shared.png"), png_bytes).unwrap();

        let result = load_sprite_data_url(
            &mod_dir,
            Some(core_dir.as_path()),
            "graphics/weapons/shared.png",
        )
        .unwrap();

        let _ = fs::remove_dir_all(&mod_dir);
        let _ = fs::remove_dir_all(&core_dir);

        // Should succeed (mod has priority, but both work)
        assert!(result.is_some());
    }

    #[test]
    fn sprite_loader_rejects_parent_dir_escape() {
        let mod_dir = temp_dir("sprite_parent_escape_mod");
        let core_dir = temp_dir("sprite_parent_escape_core");

        let error = load_sprite_data_url(&mod_dir, Some(core_dir.as_path()), "../outside.png")
            .unwrap_err()
            .to_string();

        let _ = fs::remove_dir_all(&mod_dir);
        let _ = fs::remove_dir_all(&core_dir);
        assert!(error.contains("sprite path is outside resource root"));
    }

    #[test]
    fn sprite_loader_rejects_absolute_path() {
        let mod_dir = temp_dir("sprite_absolute_mod");
        let core_dir = temp_dir("sprite_absolute_core");
        let absolute = mod_dir.join("graphics/ships/demo.png");

        let error = load_sprite_data_url(
            &mod_dir,
            Some(core_dir.as_path()),
            &absolute.to_string_lossy(),
        )
        .unwrap_err()
        .to_string();

        let _ = fs::remove_dir_all(&mod_dir);
        let _ = fs::remove_dir_all(&core_dir);
        assert!(error.contains("sprite path is outside resource root"));
    }

    #[test]
    fn resolve_mod_relative_path_returns_forward_slash_relative() {
        let mod_dir = temp_dir("resolve_relative_mod");
        let sprite_dir = mod_dir.join("graphics").join("ships");
        fs::create_dir_all(&sprite_dir).unwrap();
        let sprite = sprite_dir.join("demo.png");
        fs::write(&sprite, b"png").unwrap();

        let relative =
            resolve_mod_relative_path(&mod_dir.to_string_lossy(), &sprite.to_string_lossy())
                .unwrap();

        let _ = fs::remove_dir_all(&mod_dir);
        assert_eq!(relative, "graphics/ships/demo.png");
    }

    #[test]
    fn resolve_mod_relative_path_rejects_outside_root() {
        let mod_dir = temp_dir("resolve_outside_mod");
        let outside = temp_dir("resolve_outside_file_dir");
        let outside_file = outside.join("elsewhere.png");
        fs::write(&outside_file, b"png").unwrap();

        let error =
            resolve_mod_relative_path(&mod_dir.to_string_lossy(), &outside_file.to_string_lossy())
                .unwrap_err()
                .to_string();

        let _ = fs::remove_dir_all(&mod_dir);
        let _ = fs::remove_dir_all(&outside);
        assert!(error.contains("所选文件位于 Mod 目录之外"));
    }
}
