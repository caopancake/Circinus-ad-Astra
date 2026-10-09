use crate::{
    errors::{AppError, AppResult},
    io::{
        FsRootBoundary, ensure_file_appendable, path_belongs_to_root, read_utf8_no_bom,
        validate_safe_absolute_path, write_utf8_no_bom,
    },
    models::{AppSettings, LOG_FILE},
    services::{app_paths, workspace_persistence},
};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

const SETTINGS_FILE: &str = "settings.json";
static ALLOW_CORE_EDITING: AtomicBool = AtomicBool::new(false);
static SETTINGS_WRITE_LOCK: Mutex<()> = Mutex::new(());

pub fn load_app_settings(app_handle: tauri::AppHandle) -> AppResult<AppSettings> {
    let app_data = app_paths::app_data_dir(app_handle)?;
    let settings = load_settings(&app_data)?;
    ALLOW_CORE_EDITING.store(settings.allow_core_editing, Ordering::Release);
    super::file_history::set_history_limit(settings.history_limit as usize)?;
    Ok(settings)
}

pub fn save_app_settings(
    app_handle: tauri::AppHandle,
    mut settings: AppSettings,
) -> AppResult<AppSettings> {
    let _guard = SETTINGS_WRITE_LOCK
        .lock()
        .map_err(|_| AppError::message("settings.lock_poisoned", "settings write lock poisoned"))?;
    let app_data = app_paths::app_data_dir(app_handle)?;
    fs::create_dir_all(&app_data).map_err(|error| {
        AppError::context(
            format!("创建配置目录失败 ({})", app_data.display()),
            error.into(),
        )
    })?;
    prepare_log_directory(&app_data, &mut settings)?;
    save_settings(&app_data, &settings)?;
    ALLOW_CORE_EDITING.store(settings.allow_core_editing, Ordering::Release);
    super::file_history::set_history_limit(settings.history_limit as usize)?;
    Ok(settings)
}

pub fn ensure_core_editing_allowed(mod_root: &str) -> AppResult<()> {
    let boundary = FsRootBoundary::new(Path::new(mod_root), "mod root")?;
    let is_core = boundary.root().ancestors().any(|root| {
        root.file_name()
            .is_some_and(|name| name.eq_ignore_ascii_case("starsector-core"))
            && root
                .parent()
                .is_some_and(|parent| parent.join("mods").is_dir())
    });
    if is_core && !ALLOW_CORE_EDITING.load(Ordering::Acquire) {
        return Err(AppError::message(
            "core.editing_disabled",
            "原版内容编辑权限已关闭",
        ));
    }
    Ok(())
}

pub fn load_settings(app_data_dir: &Path) -> AppResult<AppSettings> {
    let path = settings_path(app_data_dir);
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let text = read_utf8_no_bom(&path)?;
    crate::parsers::parse_persisted_json::<AppSettings>(&text).map_err(|error| {
        AppError::context(format!("解析配置文件失败 ({})", path.display()), error).at_path(&path)
    })
}

pub fn save_settings(app_data_dir: &Path, settings: &AppSettings) -> AppResult<()> {
    fs::create_dir_all(app_data_dir).map_err(|error| {
        AppError::context(
            format!("创建配置目录失败 ({})", app_data_dir.display()),
            error.into(),
        )
    })?;
    let path = settings_path(app_data_dir);
    let text = serde_json::to_string_pretty(settings)
        .map_err(|error| AppError::context("序列化配置文件失败".to_string(), error.into()))?;
    write_utf8_no_bom(&path, &text)?;
    Ok(())
}

pub fn log_output_directory(app_data_dir: &Path, settings: &AppSettings) -> AppResult<PathBuf> {
    match &settings.log_directory {
        Some(directory) => resolve_saved_log_directory(app_data_dir, directory),
        None => Ok(app_data_dir.to_path_buf()),
    }
}

fn prepare_log_directory(app_data_dir: &Path, settings: &mut AppSettings) -> AppResult<()> {
    let Some(directory) = settings.log_directory.as_deref() else {
        return Ok(());
    };
    let canonical = prepare_log_directory_for_save(app_data_dir, directory)?;
    settings.log_directory = Some(canonical.to_string_lossy().to_string());
    Ok(())
}

fn prepare_log_directory_for_save(app_data_dir: &Path, directory: &str) -> AppResult<PathBuf> {
    let (requested, _) = check_log_directory_boundary(app_data_dir, directory)?;
    fs::create_dir_all(&requested).map_err(|error| {
        AppError::context(
            format!("创建日志目录失败 ({})", requested.display()),
            error.into(),
        )
    })?;
    let canonical = FsRootBoundary::new(&requested, "log directory")?
        .root()
        .to_path_buf();
    reject_log_directory_boundary(app_data_dir, &canonical)?;
    ensure_file_appendable(&canonical.join(LOG_FILE))?;
    Ok(canonical)
}

fn resolve_saved_log_directory(app_data_dir: &Path, directory: &str) -> AppResult<PathBuf> {
    let (requested, _) = check_log_directory_boundary(app_data_dir, directory)?;
    if !requested.is_dir() {
        return Err(AppError::message(
            "log.dir_unavailable",
            format!(
                "configured log directory is unavailable: {}",
                requested.display()
            ),
        ));
    }
    let canonical = FsRootBoundary::new(&requested, "log directory")?
        .root()
        .to_path_buf();
    reject_log_directory_boundary(app_data_dir, &canonical)?;
    Ok(canonical)
}

fn check_log_directory_boundary(
    app_data_dir: &Path,
    directory: &str,
) -> AppResult<(PathBuf, PathBuf)> {
    let requested = Path::new(directory);
    validate_safe_absolute_path(requested, "log directory")?;
    if requested
        .file_name()
        .is_some_and(|name| name.eq_ignore_ascii_case(LOG_FILE))
    {
        return Err(AppError::message(
            "log.dir_is_log_file",
            format!("log directory must not include the log file name: {directory}"),
        ));
    }
    let existing_parent = requested
        .ancestors()
        .find(|candidate| candidate.exists())
        .ok_or_else(|| {
            AppError::message(
                "log.dir_no_existing_parent",
                format!("log directory has no existing parent: {directory}"),
            )
        })?;
    let parent_boundary = FsRootBoundary::new(existing_parent, "log directory")?;
    let suffix = requested.strip_prefix(existing_parent).map_err(|error| {
        AppError::message(
            "path.relative_failed",
            format!(
                "log directory cannot be related to existing parent ({}): {error}",
                requested.display()
            ),
        )
    })?;
    let canonical = parent_boundary.root().join(suffix);
    reject_log_directory_boundary(app_data_dir, &canonical)?;
    Ok((requested.to_path_buf(), canonical))
}

fn reject_log_directory_boundary(app_data_dir: &Path, canonical: &Path) -> AppResult<()> {
    let app_data = FsRootBoundary::new(app_data_dir, "app data directory")?
        .root()
        .to_path_buf();
    if path_belongs_to_root(canonical, &app_data) {
        return Err(AppError::message(
            "log.dir_inside_app_data",
            format!(
                "custom log directory must not be inside app data: {}",
                canonical.display()
            ),
        ));
    }
    workspace_persistence::reject_mod_or_workspace_directory(app_data_dir, canonical)
}

pub fn settings_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(SETTINGS_FILE)
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::testutil::temp_dir;

    #[test]
    fn load_settings_returns_default_when_missing() {
        let dir = temp_dir("settings_missing");
        let settings = load_settings(&dir).unwrap();
        let _ = fs::remove_dir_all(dir);
        assert_eq!(settings, AppSettings::default());
    }

    #[test]
    fn save_and_load_settings_roundtrip() {
        let dir = temp_dir("settings_roundtrip");
        let settings: AppSettings = serde_json::from_str(
            r##"{
  "theme": "dark",
  "accent": "custom",
  "customAccent": "#16a34a",
  "historyLimit": 42,
            "editMode": "plain",
  "starsectorRoot": null,
  "logDirectory": null
}"##,
        )
        .unwrap();
        save_settings(&dir, &settings).unwrap();
        let loaded = load_settings(&dir).unwrap();
        let _ = fs::remove_dir_all(dir);
        assert_eq!(loaded, settings);
    }

    #[test]
    fn custom_log_directory_is_created_and_canonicalized() {
        let app_data = temp_dir("settings_log_app_data");
        let app_data_name = app_data.file_name().unwrap().to_string_lossy();
        let log_directory = app_data
            .parent()
            .unwrap()
            .join(format!("{app_data_name}_custom_logs"));
        let mut settings = AppSettings {
            log_directory: Some(log_directory.to_string_lossy().to_string()),
            ..AppSettings::default()
        };

        prepare_log_directory(&app_data, &mut settings).unwrap();
        let configured = Path::new(settings.log_directory.as_deref().unwrap());
        let _ = fs::remove_dir_all(&app_data);
        let _ = fs::remove_dir_all(&log_directory);
        assert!(configured.is_absolute());
    }

    #[test]
    fn custom_log_directory_rejects_mod_and_app_data_locations() {
        let app_data = temp_dir("settings_log_reject_app_data");
        let mod_root = app_data.parent().unwrap().join("settings_log_reject_mod");
        fs::create_dir_all(&mod_root).unwrap();
        write_utf8_no_bom(&mod_root.join("mod_info.json"), "{}").unwrap();

        let mod_error =
            prepare_log_directory_for_save(&app_data, &mod_root.join("logs").to_string_lossy())
                .unwrap_err();
        let app_data_error =
            prepare_log_directory_for_save(&app_data, &app_data.join("logs").to_string_lossy())
                .unwrap_err();

        assert!(!mod_root.join("logs").exists());
        let _ = fs::remove_dir_all(&app_data);
        let _ = fs::remove_dir_all(&mod_root);
        assert!(mod_error.to_string().contains("inside a Mod"));
        assert!(app_data_error.to_string().contains("inside app data"));
    }

    #[test]
    fn configured_custom_log_directory_does_not_recreate_a_missing_directory() {
        let app_data = temp_dir("settings_log_missing_app_data");
        let app_data_name = app_data.file_name().unwrap().to_string_lossy();
        let log_directory = app_data
            .parent()
            .unwrap()
            .join(format!("{app_data_name}_missing_logs"));
        let mut settings = AppSettings {
            log_directory: Some(log_directory.to_string_lossy().to_string()),
            ..AppSettings::default()
        };

        prepare_log_directory(&app_data, &mut settings).unwrap();
        fs::remove_dir_all(&log_directory).unwrap();
        let result = log_output_directory(&app_data, &settings);

        let _ = fs::remove_dir_all(&app_data);
        assert!(result.is_err());
        assert!(!log_directory.exists());
    }

    #[test]
    fn custom_log_directory_rejects_a_complete_log_file_path() {
        let app_data = temp_dir("settings_log_file_path_app_data");
        let file_path = app_data.parent().unwrap().join(LOG_FILE);
        let result = prepare_log_directory_for_save(&app_data, &file_path.to_string_lossy());

        let _ = fs::remove_dir_all(&app_data);
        assert!(result.is_err());
        assert!(!file_path.exists());
    }
}
