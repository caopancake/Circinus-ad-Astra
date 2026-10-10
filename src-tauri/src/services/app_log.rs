use crate::{
    errors::{AppError, AppResult},
    io::{ensure_file_appendable, write_utf8_no_bom},
    models::{AppLogEntry, AppLogStatus, LOG_FILE},
    services::{app_paths, app_settings, system_open},
};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

pub fn append_app_log(app_handle: tauri::AppHandle, entry: AppLogEntry) -> AppResult<()> {
    let app_data = app_paths::app_data_dir(app_handle)?;
    let settings = app_settings::load_settings(&app_data)?;
    if entry.level < settings.log_level {
        return Ok(());
    }
    if settings.log_directory.is_none() {
        fs::create_dir_all(&app_data).map_err(|error| {
            AppError::context(
                format!("创建日志目录失败 ({})", app_data.display()),
                error.into(),
            )
        })?;
    }
    let log_directory = app_settings::log_output_directory(&app_data, &settings)?;
    append_log(&log_directory, &entry)
}

pub fn app_log_status(app_handle: tauri::AppHandle) -> AppResult<AppLogStatus> {
    let app_data = app_paths::app_data_dir(app_handle)?;
    let log_directory = configured_log_directory(&app_data)?;
    log_status(&log_directory)
}

pub fn open_app_log_file(app_handle: tauri::AppHandle) -> AppResult<()> {
    let app_data = app_paths::app_data_dir(app_handle)?;
    let log_directory = configured_log_directory(&app_data)?;
    ensure_log_file(&log_directory)?;
    system_open::open_path(&log_path(&log_directory))
}

pub fn clear_app_log_file(app_handle: tauri::AppHandle) -> AppResult<AppLogStatus> {
    let app_data = app_paths::app_data_dir(app_handle)?;
    let log_directory = configured_log_directory(&app_data)?;
    clear_log_file(&log_directory)?;
    log_status(&log_directory)
}

fn configured_log_directory(app_data_dir: &Path) -> AppResult<PathBuf> {
    let settings = app_settings::load_settings(app_data_dir)?;
    if settings.log_directory.is_none() {
        fs::create_dir_all(app_data_dir).map_err(|error| {
            AppError::context(
                format!("创建日志目录失败 ({})", app_data_dir.display()),
                error.into(),
            )
        })?;
    }
    app_settings::log_output_directory(app_data_dir, &settings)
}

pub fn append_log(app_data_dir: &Path, entry: &AppLogEntry) -> AppResult<()> {
    ensure_log_directory_writable(app_data_dir)?;
    rotate_log_file(app_data_dir);
    let path = log_path(app_data_dir);
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| {
            AppError::context(
                format!("打开日志文件失败 ({})", path.display()),
                error.into(),
            )
        })?;
    file.write_all(render_log_entry(entry).as_bytes())
        .map_err(|error| {
            AppError::context(
                format!("写入日志文件失败 ({})", path.display()),
                error.into(),
            )
        })?;
    Ok(())
}

pub fn log_status(app_data_dir: &Path) -> AppResult<AppLogStatus> {
    let path = log_path(app_data_dir);
    let size_bytes = match fs::metadata(&path) {
        Ok(metadata) => metadata.len(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => 0,
        Err(error) => {
            return Err(AppError::context(
                format!("读取日志文件状态失败 ({})", path.display()),
                error.into(),
            ));
        }
    };
    Ok(AppLogStatus {
        path: path.to_string_lossy().to_string(),
        size_bytes,
    })
}

pub fn clear_log_file(app_data_dir: &Path) -> AppResult<()> {
    ensure_log_directory_writable(app_data_dir)?;
    let path = log_path(app_data_dir);
    write_utf8_no_bom(&path, "").map_err(|error| {
        AppError::context(format!("清除日志文件失败 ({})", path.display()), error)
    })?;
    Ok(())
}

pub fn log_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(LOG_FILE)
}

fn ensure_log_file(app_data_dir: &Path) -> AppResult<()> {
    ensure_log_directory_writable(app_data_dir)
}

fn ensure_log_directory_writable(app_data_dir: &Path) -> AppResult<()> {
    if !app_data_dir.is_dir() {
        return Err(AppError::message(
            "log.dir_unavailable",
            format!("日志目录不可用 ({})", app_data_dir.display()),
        ));
    }
    ensure_file_appendable(&log_path(app_data_dir))
}

fn render_log_entry(entry: &AppLogEntry) -> String {
    let mut line = format!("[{}] [{}]", local_timestamp(), entry.level.as_str());
    if let Some(code) = &entry.code {
        line.push_str(&format!(" [{code}]"));
    }
    if let Some(message) = &entry.message {
        line.push(' ');
        line.push_str(message);
    }
    if let Some(path) = &entry.path {
        line.push_str(" | path=");
        line.push_str(path);
    }
    if let Some(line_number) = entry.line {
        line.push_str(" | line=");
        line.push_str(&line_number.to_string());
    }
    if let Some(fields) = &entry.fields {
        for (key, value) in fields {
            line.push(' ');
            line.push_str(key);
            line.push('=');
            line.push_str(&sanitize_log_value(value));
        }
    }
    line.push_str("\r\n");
    line
}

fn sanitize_log_value(value: &str) -> String {
    value.replace(['\r', '\n', '\t'], " ").trim().to_string()
}

fn local_timestamp() -> String {
    chrono::Local::now()
        .format("%Y-%m-%d %H:%M:%S%.3f")
        .to_string()
}

const MAX_LOG_SIZE_BYTES: u64 = 5 * 1024 * 1024;

/// Single-backup rotation: the current file becomes `.log.1` once it reaches
/// the size cap, discarding the previous `.log.1`.
fn rotate_log_file(log_directory: &Path) {
    let path = log_path(log_directory);
    let Ok(metadata) = fs::metadata(&path) else {
        return;
    };
    if metadata.len() < MAX_LOG_SIZE_BYTES {
        return;
    }
    let rotated = log_directory.join(format!("{LOG_FILE}.1"));
    let _ = fs::remove_file(&rotated);
    let _ = fs::rename(&path, &rotated);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::read_utf8_no_bom;
    use crate::testutil::temp_dir;
    use std::collections::BTreeMap;

    #[test]
    fn append_log_and_status_roundtrip() {
        let dir = temp_dir("log_roundtrip");
        append_log(
            &dir,
            &AppLogEntry {
                level: crate::models::AppLogLevel::Warning,
                code: Some("test.code".to_string()),
                message: Some("测试 warning".to_string()),
                path: Some("D:/test/file.csv".to_string()),
                line: Some(3),
                fields: None,
            },
        )
        .unwrap();
        let status = log_status(&dir).unwrap();
        let text = read_utf8_no_bom(&dir.join(LOG_FILE)).unwrap();
        let _ = fs::remove_dir_all(dir);
        assert!(status.size_bytes > 0);
        assert!(text.contains("[warning] [test.code] 测试 warning"));
        assert!(text.contains("path=D:/test/file.csv"));
        assert!(text.contains("line=3"));
    }

    #[test]
    fn append_log_renders_fields_in_key_order_and_sanitizes_values() {
        let dir = temp_dir("log_fields");
        let fields = BTreeMap::from([
            ("zeta".to_string(), " last ".to_string()),
            ("alpha".to_string(), "a\r\nb".to_string()),
        ]);
        append_log(
            &dir,
            &AppLogEntry {
                level: crate::models::AppLogLevel::Info,
                code: Some("test.fields".to_string()),
                message: Some("with fields".to_string()),
                path: None,
                line: None,
                fields: Some(fields),
            },
        )
        .unwrap();
        let text = read_utf8_no_bom(&dir.join(LOG_FILE)).unwrap();
        let _ = fs::remove_dir_all(dir);
        assert!(text.contains("alpha=a  b zeta=last"));
        assert!(text.find("alpha=").unwrap() < text.find("zeta=").unwrap());
    }

    #[test]
    fn append_log_rotates_file_at_size_cap() {
        let dir = temp_dir("log_rotate");
        let filler = "x".repeat(5 * 1024 * 1024);
        crate::io::write_utf8_no_bom(&log_path(&dir), &filler).unwrap();
        append_log(
            &dir,
            &AppLogEntry {
                level: crate::models::AppLogLevel::Info,
                code: None,
                message: Some("after rotation".to_string()),
                path: None,
                line: None,
                fields: None,
            },
        )
        .unwrap();

        let rotated = fs::read_to_string(dir.join(format!("{LOG_FILE}.1"))).unwrap();
        let current = fs::read_to_string(log_path(&dir)).unwrap();
        assert_eq!(rotated.len(), 5 * 1024 * 1024);
        assert!(current.contains("after rotation"));
        assert!(!current.contains("xxxx"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn clear_log_file_keeps_empty_file() {
        let dir = temp_dir("log_clear");
        append_log(
            &dir,
            &AppLogEntry {
                level: crate::models::AppLogLevel::Info,
                code: None,
                message: Some("hello".to_string()),
                path: None,
                line: None,
                fields: None,
            },
        )
        .unwrap();
        clear_log_file(&dir).unwrap();
        let status = log_status(&dir).unwrap();
        let _ = fs::remove_dir_all(dir);
        assert_eq!(status.size_bytes, 0);
    }
}
