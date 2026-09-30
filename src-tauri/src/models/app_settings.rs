use crate::models::{AppLogLevel, optional_non_empty_string};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AppTheme {
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AccentPreset {
    Blue,
    Orange,
    Green,
    Cyan,
    Pink,
    Purple,
    Gray,
    Custom,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EditMode {
    Plain,
    Smart,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_theme")]
    pub theme: AppTheme,
    #[serde(default = "default_accent")]
    pub accent: AccentPreset,
    #[serde(default = "default_custom_accent")]
    pub custom_accent: String,
    #[serde(default = "default_history_limit")]
    pub history_limit: u32,
    #[serde(default = "default_edit_mode")]
    pub edit_mode: EditMode,
    #[serde(default = "default_preserve_original_json")]
    pub preserve_original_json: bool,
    #[serde(default, deserialize_with = "optional_non_empty_string")]
    pub starsector_root: Option<String>,
    #[serde(default, deserialize_with = "optional_non_empty_string")]
    pub log_directory: Option<String>,
    #[serde(default = "default_log_level")]
    pub log_level: AppLogLevel,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            accent: default_accent(),
            custom_accent: default_custom_accent(),
            history_limit: default_history_limit(),
            edit_mode: default_edit_mode(),
            preserve_original_json: default_preserve_original_json(),
            starsector_root: None,
            log_directory: None,
            log_level: default_log_level(),
        }
    }
}

fn default_theme() -> AppTheme {
    AppTheme::Light
}

fn default_accent() -> AccentPreset {
    AccentPreset::Blue
}

fn default_custom_accent() -> String {
    "#2563eb".to_string()
}

fn default_history_limit() -> u32 {
    20
}

fn default_edit_mode() -> EditMode {
    EditMode::Smart
}

fn default_preserve_original_json() -> bool {
    true
}

fn default_log_level() -> AppLogLevel {
    AppLogLevel::Info
}

#[cfg(test)]
mod tests {
    use super::AppSettings;
    use serde_json::json;

    #[test]
    fn app_settings_uses_nullable_starsector_root() {
        let settings = serde_json::from_value::<AppSettings>(json!({
            "theme": "light",
            "accent": "blue",
            "customAccent": "#2563eb",
            "historyLimit": 20,
            "editMode": "smart",
            "starsectorRoot": null,
            "logDirectory": null
        }))
        .unwrap();

        assert_eq!(settings.starsector_root, None);
    }

    #[test]
    fn app_settings_treats_blank_starsector_root_as_missing() {
        let settings = serde_json::from_value::<AppSettings>(json!({
            "theme": "light",
            "accent": "blue",
            "customAccent": "#2563eb",
            "historyLimit": 20,
            "editMode": "smart",
            "starsectorRoot": "",
            "logDirectory": null
        }))
        .unwrap();

        assert_eq!(settings.starsector_root, None);
    }

    #[test]
    fn preserve_original_json_defaults_true_for_existing_settings() {
        let old: AppSettings = serde_json::from_value(json!({"theme":"light"})).unwrap();
        assert!(old.preserve_original_json);
        let disabled: AppSettings =
            serde_json::from_value(json!({"preserveOriginalJson":false})).unwrap();
        assert!(!disabled.preserve_original_json);
    }
}
