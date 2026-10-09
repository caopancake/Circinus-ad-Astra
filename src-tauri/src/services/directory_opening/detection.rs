use super::overview::{infer_starsector_root, is_game_root, is_mod_root, scan_game_overview};
use crate::{
    errors::AppResult,
    io::FsRootBoundary,
    models::{GameScanWarning, OpenDirectoryKind, OpenDirectoryResult},
};
use std::path::{Path, PathBuf};

/// Detection failures (path boundary violations) are errors; an unrecognized
/// directory is the typed `Unknown` outcome and never a synthetic warning.
pub fn detect_directory(
    path: &Path,
    known_starsector_root: Option<&str>,
) -> AppResult<OpenDirectoryResult> {
    let selected = path.to_string_lossy().to_string();
    let boundary = FsRootBoundary::new(path, "selected root")?;
    let canonical = boundary.root();
    if is_game_root(canonical) {
        let overview = scan_game_overview(canonical)?;
        return Ok(OpenDirectoryResult {
            kind: OpenDirectoryKind::GameRoot,
            selected_path: selected,
            starsector_root: Some(canonical.to_string_lossy().to_string()),
            mod_root: None,
            warnings: overview.warnings.clone(),
            overview: Some(overview),
        });
    }

    if is_mod_root(canonical) {
        return detected_mod_directory(&selected, canonical, known_starsector_root);
    }

    Ok(OpenDirectoryResult {
        kind: OpenDirectoryKind::Unknown,
        selected_path: selected,
        starsector_root: None,
        mod_root: None,
        overview: None,
        warnings: Vec::new(),
    })
}

fn detected_mod_directory(
    selected: &str,
    mod_root: &Path,
    known_starsector_root: Option<&str>,
) -> AppResult<OpenDirectoryResult> {
    let inferred = infer_starsector_root(mod_root);
    let overview = inferred.as_deref().map(scan_game_overview).transpose()?;
    let (known_root, mut warnings) = resolve_known_root(known_starsector_root);
    let starsector_root = inferred.clone().or(known_root);
    Ok(OpenDirectoryResult {
        kind: if inferred.is_some() {
            OpenDirectoryKind::ModInGame
        } else {
            OpenDirectoryKind::ExternalMod
        },
        selected_path: selected.to_string(),
        starsector_root: starsector_root.map(|p| p.to_string_lossy().to_string()),
        mod_root: Some(mod_root.to_string_lossy().to_string()),
        overview,
        warnings: std::mem::take(&mut warnings),
    })
}

fn resolve_known_root(
    known_starsector_root: Option<&str>,
) -> (Option<PathBuf>, Vec<GameScanWarning>) {
    let Some(root) = known_starsector_root.filter(|root| !root.trim().is_empty()) else {
        return (None, Vec::new());
    };
    match FsRootBoundary::new(Path::new(root), "starsector root") {
        Ok(boundary) => (Some(boundary.root().to_path_buf()), Vec::new()),
        Err(error) => (
            None,
            vec![GameScanWarning {
                code: error.code().to_string(),
                location: error.location().cloned(),
                path: root.to_string(),
                message: format!("已忽略无效 Starsector 根目录: {error}"),
                edit_target: None,
            }],
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::write_utf8_no_bom;
    use crate::testutil::temp_dir;
    use std::fs;

    #[test]
    fn detect_game_root_returns_overview() {
        let root = temp_dir("detect_game_root");
        fs::create_dir_all(root.join("starsector-core")).unwrap();
        fs::create_dir_all(root.join("mods")).unwrap();

        let detected = detect_directory(&root, None).unwrap();

        let expected_root = path_string(&root);
        let _ = fs::remove_dir_all(root);
        assert_eq!(detected.kind, OpenDirectoryKind::GameRoot);
        assert_eq!(
            detected.starsector_root.as_deref(),
            Some(expected_root.as_str())
        );
        assert!(detected.overview.is_some());
    }

    #[test]
    fn detect_mod_in_game_uses_inferred_game_root() {
        let root = temp_dir("detect_mod_in_game");
        fs::create_dir_all(root.join("starsector-core")).unwrap();
        fs::create_dir_all(root.join("mods/demo")).unwrap();
        write_utf8_no_bom(&root.join("mods/demo/mod_info.json"), r#"{"id":"demo"}"#).unwrap();

        let detected = detect_directory(&root.join("mods/demo"), None).unwrap();

        let expected_root = path_string(&root);
        let expected_mod = path_string(&root.join("mods/demo"));
        let _ = fs::remove_dir_all(root);
        assert_eq!(detected.kind, OpenDirectoryKind::ModInGame);
        assert_eq!(
            detected.starsector_root.as_deref(),
            Some(expected_root.as_str())
        );
        assert_eq!(detected.mod_root.as_deref(), Some(expected_mod.as_str()));
        assert!(detected.overview.is_some());
    }

    #[test]
    fn detect_external_mod_uses_valid_known_root() {
        let game_root = temp_dir("detect_known_game");
        let mod_root = temp_dir("detect_external_mod");
        fs::create_dir_all(game_root.join("starsector-core")).unwrap();
        fs::create_dir_all(game_root.join("mods")).unwrap();
        write_utf8_no_bom(&mod_root.join("mod_info.json"), r#"{"id":"external"}"#).unwrap();

        let detected = detect_directory(&mod_root, Some(&game_root.to_string_lossy())).unwrap();

        let expected_root = path_string(&game_root);
        let expected_mod = path_string(&mod_root);
        let _ = fs::remove_dir_all(game_root);
        let _ = fs::remove_dir_all(mod_root);
        assert_eq!(detected.kind, OpenDirectoryKind::ExternalMod);
        assert_eq!(
            detected.starsector_root.as_deref(),
            Some(expected_root.as_str())
        );
        assert_eq!(detected.mod_root.as_deref(), Some(expected_mod.as_str()));
        assert!(detected.warnings.is_empty());
    }

    #[test]
    fn detect_external_mod_warns_invalid_known_root() {
        let mod_root = temp_dir("detect_invalid_known");
        write_utf8_no_bom(&mod_root.join("mod_info.json"), r#"{"id":"external"}"#).unwrap();
        let known_root = mod_root.join("..");

        let detected = detect_directory(&mod_root, Some(&known_root.to_string_lossy())).unwrap();

        let expected_mod = path_string(&mod_root);
        let _ = fs::remove_dir_all(mod_root);
        assert_eq!(detected.kind, OpenDirectoryKind::ExternalMod);
        assert_eq!(detected.starsector_root, None);
        assert_eq!(detected.mod_root.as_deref(), Some(expected_mod.as_str()));
        assert!(
            detected
                .warnings
                .iter()
                .any(|warning| warning.message.contains("已忽略无效 Starsector 根目录"))
        );
    }

    #[test]
    fn detect_unknown_directory_is_typed_unknown_without_warning() {
        let root = temp_dir("detect_unknown");

        let detected = detect_directory(&root, None).unwrap();

        let _ = fs::remove_dir_all(root);
        assert_eq!(detected.kind, OpenDirectoryKind::Unknown);
        assert!(detected.warnings.is_empty());
    }

    fn path_string(path: &Path) -> String {
        path.canonicalize().unwrap().to_string_lossy().to_string()
    }
}
