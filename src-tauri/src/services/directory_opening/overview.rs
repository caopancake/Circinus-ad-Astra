use crate::{
    errors::{AppError, AppResult},
    io::{FsRootBoundary, read_json_file, validate_walk_entry},
    models::{GameModSummary, GameOverviewData, GameScanWarning, GameWarningEditTarget},
};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

/// A malformed root is an error; per-Mod problems stay in the overview's
/// warnings so one broken Mod never hides the rest of the game.
pub fn scan_game_overview(starsector_root: &Path) -> AppResult<GameOverviewData> {
    let boundary = FsRootBoundary::new(starsector_root, "starsector root")?;
    Ok(scan_game_overview_root(boundary.root()))
}

fn scan_game_overview_root(starsector_root: &Path) -> GameOverviewData {
    let mods_dir = starsector_root.join("mods");
    let mut warnings = Vec::new();
    let mut mods = Vec::new();

    if !starsector_root.join("starsector-core").exists() {
        warnings.push(GameScanWarning {
            code: "scan.core_missing".to_string(),
            location: None,
            path: starsector_root
                .join("starsector-core")
                .to_string_lossy()
                .to_string(),
            message: "缺少 starsector-core，原版资源回退不可用".to_string(),
            edit_target: None,
        });
    } else {
        let core_dir = starsector_root.join("starsector-core");
        mods.push(GameModSummary {
            mod_root: core_dir.to_string_lossy().to_string(),
            id: "starsector-core".to_string(),
            name: "Starsector Core".to_string(),
            version: String::new(),
            description: "原版游戏核心数据".to_string(),
            has_mod_info: false,
        });
    }

    match fs::read_dir(&mods_dir) {
        Ok(entries) => {
            for entry in entries {
                let entry = match entry {
                    Ok(entry) => entry,
                    Err(error) => {
                        warnings.push(GameScanWarning {
                            code: "io.unexpected".to_string(),
                            location: None,
                            path: mods_dir.to_string_lossy().to_string(),
                            message: format!("读取 mods 目录项失败: {error}"),
                            edit_target: None,
                        });
                        continue;
                    }
                };
                let mod_root = entry.path();
                if let Err(error) = validate_walk_entry(&mod_root, "mods directory") {
                    warnings.push(GameScanWarning {
                        code: error.code().to_string(),
                        location: error.location().cloned(),
                        path: mod_root.to_string_lossy().to_string(),
                        message: format!("Mod 路径使用链接或不可读取，已跳过: {error}"),
                        edit_target: None,
                    });
                    continue;
                }
                if !mod_root.is_dir() {
                    continue;
                }
                let mod_info_path = mod_root.join("mod_info.json");
                if !mod_info_path.exists() {
                    warnings.push(GameScanWarning {
                        code: "scan.mod_info_missing".to_string(),
                        location: None,
                        path: mod_root.to_string_lossy().to_string(),
                        message: "缺少 mod_info.json，已跳过".to_string(),
                        edit_target: None,
                    });
                    continue;
                }
                match read_json_file(&mod_info_path) {
                    Ok(info) => mods.push(summary_from_mod_info(&mod_root, &info)),
                    Err(error) => warnings.push(GameScanWarning {
                        code: error.code().to_string(),
                        location: error.location().cloned(),
                        path: mod_info_path.to_string_lossy().to_string(),
                        message: format!("读取 mod_info.json 失败: {error}"),
                        edit_target: Some(GameWarningEditTarget {
                            mod_root: mod_root.to_string_lossy().to_string(),
                            path: mod_info_path.to_string_lossy().to_string(),
                        }),
                    }),
                }
            }
        }
        Err(_) if !mods_dir.exists() => {
            warnings.push(GameScanWarning {
                code: "scan.mods_missing".to_string(),
                location: None,
                path: mods_dir.to_string_lossy().to_string(),
                message: "缺少 mods 目录".to_string(),
                edit_target: None,
            });
        }
        Err(error) => {
            warnings.push(GameScanWarning {
                code: "io.unexpected".to_string(),
                location: None,
                path: mods_dir.to_string_lossy().to_string(),
                message: format!("无法读取 mods 目录: {error}"),
                edit_target: None,
            });
        }
    }

    mods.sort_by_key(|summary| summary.name.to_lowercase());
    append_duplicate_id_warnings(&mods, &mut warnings);

    GameOverviewData {
        starsector_root: starsector_root.to_string_lossy().to_string(),
        core_available: starsector_root.join("starsector-core").exists(),
        mods_dir: mods_dir.to_string_lossy().to_string(),
        mods,
        warnings,
    }
}

pub fn is_game_root(path: &Path) -> bool {
    path.join("starsector-core").is_dir() && path.join("mods").is_dir()
}

pub fn resolve_game_mods_directory(starsector_root: &Path) -> AppResult<(PathBuf, PathBuf)> {
    let boundary = FsRootBoundary::new(starsector_root, "starsector root")?;
    let canonical_root = boundary.root().to_path_buf();
    if !is_game_root(&canonical_root) {
        return Err(AppError::message(
            "detect.not_game_root",
            format!(
                "不是有效的 Starsector 游戏目录: {}",
                canonical_root.display()
            ),
        ));
    }
    let mods_dir = FsRootBoundary::new(&canonical_root.join("mods"), "Starsector mods 目录")?
        .root()
        .to_path_buf();
    Ok((canonical_root, mods_dir))
}

pub fn is_mod_root(path: &Path) -> bool {
    path.join("mod_info.json").is_file()
}

pub fn infer_starsector_root(mod_root: &Path) -> Option<PathBuf> {
    let candidate = mod_root.parent()?.parent()?;
    is_game_root(candidate).then(|| candidate.to_path_buf())
}

fn summary_from_mod_info(mod_root: &Path, info: &Value) -> GameModSummary {
    let folder_name = mod_root
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Mod")
        .to_string();
    GameModSummary {
        mod_root: mod_root.to_string_lossy().to_string(),
        id: value_string(info.get("id")).unwrap_or_else(|| folder_name.clone()),
        name: value_string(info.get("name")).unwrap_or(folder_name),
        version: version_string(info.get("version")).unwrap_or_default(),
        description: value_string(info.get("description")).unwrap_or_default(),
        has_mod_info: true,
    }
}

fn version_string(value: Option<&Value>) -> Option<String> {
    let Some(Value::Object(obj)) = value else {
        return value_string(value);
    };
    let major = version_part(obj.get("major"))?;
    let minor = version_part(obj.get("minor"))?;
    let patch = version_part(obj.get("patch"))?;
    Some(format!("{major}.{minor}.{patch}"))
}

fn version_part(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::Number(number)) => Some(number.to_string()),
        Some(Value::String(text)) if !text.trim().is_empty() => Some(text.trim().to_string()),
        _ => None,
    }
}

fn value_string(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(text)) => Some(text.clone()),
        Some(Value::Number(number)) => Some(number.to_string()),
        Some(Value::Bool(flag)) => Some(flag.to_string()),
        Some(other) => serde_json::to_string(other).ok(),
        None => None,
    }
}

fn append_duplicate_id_warnings(mods: &[GameModSummary], warnings: &mut Vec<GameScanWarning>) {
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for summary in mods {
        *counts.entry(summary.id.as_str()).or_default() += 1;
    }
    for summary in mods {
        if counts.get(summary.id.as_str()).copied().unwrap_or_default() > 1 {
            warnings.push(GameScanWarning {
                code: "scan.mod_id_duplicate".to_string(),
                location: None,
                path: summary.mod_root.clone(),
                message: format!("重复 Mod id: {}", summary.id),
                edit_target: None,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::write_utf8_no_bom;
    use crate::testutil::temp_dir;
    use std::{fs, path::Path};

    #[test]
    fn scan_game_overview_reads_mod_summaries_only() {
        let root = temp_dir("game_overview");
        fs::create_dir_all(root.join("starsector-core")).unwrap();
        fs::create_dir_all(root.join("mods/demo")).unwrap();
        fs::create_dir_all(root.join("mods/demo/data/hulls")).unwrap();
        write_utf8_no_bom(
            &root.join("mods/demo/mod_info.json"),
            r#"{"id":"demo","name":"Demo Mod","version":{"major":1,"minor":2,"patch":3}}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("mods/demo/data/hulls/ship_data.csv"),
            "id,name\r\nship,Ship\r\n",
        )
        .unwrap();

        let overview = scan_game_overview(&root).unwrap();

        let _ = fs::remove_dir_all(&root);
        assert!(overview.core_available);
        assert_eq!(overview.mods.len(), 2);
        assert_eq!(overview.mods[0].id, "demo");
        assert_eq!(overview.mods[0].version, "1.2.3");
        assert_eq!(overview.mods[1].id, "starsector-core");
        assert!(!overview.mods[1].has_mod_info);
        assert!(overview.warnings.is_empty());
    }

    #[test]
    fn scan_game_overview_uses_canonical_root() {
        let root = temp_dir("game_overview_canonical");
        fs::create_dir_all(root.join("starsector-core")).unwrap();
        fs::create_dir_all(root.join("mods")).unwrap();

        let overview = scan_game_overview(&root.join(".")).unwrap();

        let expected_root = path_string(&root);
        let _ = fs::remove_dir_all(&root);
        assert_eq!(overview.starsector_root, expected_root);
    }

    #[test]
    fn scan_game_overview_rejects_parent_dir_root() {
        let root = temp_dir("game_overview_parent_dir");

        let error = scan_game_overview(&root.join(".."))
            .unwrap_err()
            .to_string();

        let _ = fs::remove_dir_all(root);
        assert!(error.contains("invalid starsector root path"));
    }

    #[test]
    fn scan_game_overview_warns_duplicate_ids_and_missing_core() {
        let root = temp_dir("game_warnings");
        fs::create_dir_all(root.join("mods/a")).unwrap();
        fs::create_dir_all(root.join("mods/b")).unwrap();
        fs::create_dir_all(root.join("mods/no_info")).unwrap();
        write_utf8_no_bom(&root.join("mods/a/mod_info.json"), r#"{"id":"dup"}"#).unwrap();
        write_utf8_no_bom(&root.join("mods/b/mod_info.json"), r#"{"id":"dup"}"#).unwrap();

        let overview = scan_game_overview(&root).unwrap();

        let _ = fs::remove_dir_all(root);
        assert!(!overview.core_available);
        assert!(
            overview
                .warnings
                .iter()
                .any(|w| w.message.contains("starsector-core"))
        );
        assert!(
            overview
                .warnings
                .iter()
                .any(|w| w.message.contains("缺少 mod_info.json"))
        );
        assert!(
            overview
                .warnings
                .iter()
                .any(|w| w.message.contains("重复 Mod id"))
        );
    }

    #[test]
    fn scan_game_overview_authorizes_invalid_mod_info_for_recovery_editing() {
        let root = temp_dir("game_invalid_mod_info_edit_target");
        let mod_root = root.join("mods/broken");
        let mod_info_path = mod_root.join("mod_info.json");
        fs::create_dir_all(root.join("starsector-core")).unwrap();
        fs::create_dir_all(&mod_root).unwrap();
        write_utf8_no_bom(
            &mod_info_path,
            "{\n  \"id\": \"broken\"\n  \"name\": \"Broken\"\n}",
        )
        .unwrap();

        let overview = scan_game_overview(&root).unwrap();

        let warning = overview
            .warnings
            .iter()
            .find(|warning| warning.edit_target.is_some())
            .unwrap();
        let target = warning.edit_target.as_ref().unwrap();
        let expected_mod_root = path_string(&mod_root);
        let expected_path = path_string(&mod_info_path);
        let _ = fs::remove_dir_all(root);
        assert_eq!(target.mod_root, expected_mod_root);
        assert_eq!(target.path, expected_path);
        assert_eq!(warning.path, expected_path);
        assert!(warning.message.contains("line 3 column"));
    }

    #[test]
    fn scan_game_overview_reports_unreadable_mods_path_reason() {
        let root = temp_dir("game_mods_path_error");
        fs::create_dir_all(root.join("starsector-core")).unwrap();
        fs::write(root.join("mods"), "not a directory").unwrap();

        let overview = scan_game_overview(&root).unwrap();

        let _ = fs::remove_dir_all(root);
        assert!(
            overview
                .warnings
                .iter()
                .any(|w| w.message.contains("无法读取 mods 目录:"))
        );
    }

    fn path_string(path: &Path) -> String {
        let path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        path.to_string_lossy().to_string()
    }
}
