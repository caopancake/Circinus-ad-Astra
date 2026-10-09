use crate::{
    errors::{AppError, AppResult},
    io::{FsRootBoundary, path_belongs_to_root, read_utf8_no_bom, write_utf8_no_bom},
    models::PersistedWorkspace,
    services::app_paths,
};
use std::{fs, path::Path};

const WORKSPACE_FILE: &str = "workspace.json";

/// Rejects directories that would place tool-private files inside a Mod or a
/// tracked workspace root; the tracked-root knowledge lives here because this
/// module owns the persisted workspace state.
pub fn reject_mod_or_workspace_directory(app_data_dir: &Path, directory: &Path) -> AppResult<()> {
    if directory
        .ancestors()
        .any(|ancestor| ancestor.join("mod_info.json").is_file())
    {
        return Err(AppError::message(
            "workspace.dir_inside_mod",
            format!(
                "directory must not be inside a Mod: {}",
                directory.display()
            ),
        ));
    }
    let workspace = load_workspace(app_data_dir)?;
    for root in workspace
        .mods
        .iter()
        .map(|mod_entry| mod_entry.mod_root.as_str())
        .chain(workspace.starsector_root.iter().map(String::as_str))
    {
        let path = Path::new(root);
        if path.is_dir() {
            let canonical_root = FsRootBoundary::new(path, "workspace directory")?
                .root()
                .to_path_buf();
            if path_belongs_to_root(directory, &canonical_root) {
                return Err(AppError::message(
                    "workspace.dir_inside_tracked_root",
                    format!(
                        "directory must not be inside a workspace directory: {}",
                        directory.display()
                    ),
                ));
            }
        }
    }
    Ok(())
}

pub fn load_app_workspace(app_handle: tauri::AppHandle) -> AppResult<PersistedWorkspace> {
    let app_data = app_paths::app_data_dir(app_handle)?;
    load_workspace(&app_data)
}

pub fn save_app_workspace(
    app_handle: tauri::AppHandle,
    state: PersistedWorkspace,
) -> AppResult<()> {
    let app_data = app_paths::app_data_dir(app_handle)?;
    save_workspace(&app_data, &state)
}

pub fn load_workspace(app_data_dir: &Path) -> AppResult<PersistedWorkspace> {
    let path = app_data_dir.join(WORKSPACE_FILE);
    if !path.exists() {
        return Ok(PersistedWorkspace::default());
    }
    let text = read_utf8_no_bom(&path)?;
    crate::parsers::parse_persisted_json::<PersistedWorkspace>(&text).map_err(|error| {
        AppError::context(
            format!("解析工作区状态文件失败 ({})", path.display()),
            error,
        )
        .at_path(&path)
    })
}

pub fn save_workspace(app_data_dir: &Path, state: &PersistedWorkspace) -> AppResult<()> {
    fs::create_dir_all(app_data_dir).map_err(|error| {
        AppError::context(
            format!("创建工作区状态目录失败 ({})", app_data_dir.display()),
            error.into(),
        )
    })?;
    let path = app_data_dir.join(WORKSPACE_FILE);
    let json = serde_json::to_string_pretty(state)?;
    write_utf8_no_bom(&path, &json)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{io::write_utf8_no_bom, models::PersistedMod};
    use std::collections::BTreeMap;

    use crate::testutil::temp_dir;

    #[test]
    fn load_returns_default_when_file_missing() {
        let dir = temp_dir("ws_missing");
        let result = load_workspace(&dir).unwrap();
        let _ = fs::remove_dir_all(&dir);
        assert!(result.mods.is_empty());
    }

    #[test]
    fn save_then_load_roundtrips() {
        let dir = temp_dir("ws_roundtrip");
        let state = PersistedWorkspace {
            mods: vec![PersistedMod {
                mod_root: "D:/mods/test".to_string(),
                display_name: "Test Mod".to_string(),
                version: "1.0".to_string(),
            }],
            starsector_root: Some("D:/Starsector".to_string()),
            game_mods: vec![],
            game_warnings: vec![],
            column_widths: BTreeMap::from([(
                "D:/mods/test".to_string(),
                BTreeMap::from([(
                    "ships".to_string(),
                    BTreeMap::from([("id".to_string(), 120.0)]),
                )]),
            )]),
        };
        save_workspace(&dir, &state).unwrap();
        let loaded = load_workspace(&dir).unwrap();
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(loaded.mods.len(), 1);
        assert_eq!(loaded.mods[0].display_name, "Test Mod");
        assert_eq!(loaded.column_widths["D:/mods/test"]["ships"]["id"], 120.0);
    }

    #[test]
    fn load_ignores_removed_navigation_fields() {
        let dir = temp_dir("ws_legacy_navigation");
        let workspace_path = dir.join(WORKSPACE_FILE);
        write_utf8_no_bom(
            &workspace_path,
            r#"{
  "mods": [],
  "activeModRoot": "D:/mods/test",
  "currentView": "table",
  "expandedMods": ["D:/mods/test"],
  "starsectorRoot": null,
  "gameMods": [],
  "gameWarnings": [],
  "columnWidths": {}
}"#,
        )
        .unwrap();

        let loaded = load_workspace(&dir).unwrap();
        let _ = fs::remove_dir_all(&dir);
        assert!(loaded.mods.is_empty());
        assert!(loaded.starsector_root.is_none());
    }

    #[test]
    fn load_reports_corrupted_json() {
        let dir = temp_dir("ws_corrupted");
        fs::create_dir_all(&dir).unwrap();
        write_utf8_no_bom(&dir.join("workspace.json"), "not valid json{{{").unwrap();
        let result = load_workspace(&dir);
        let _ = fs::remove_dir_all(&dir);
        assert!(result.is_err());
    }
}
