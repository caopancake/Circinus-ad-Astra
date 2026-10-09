use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpenDirectoryResult {
    pub kind: OpenDirectoryKind,
    pub selected_path: String,
    pub starsector_root: Option<String>,
    pub mod_root: Option<String>,
    pub overview: Option<GameOverviewData>,
    pub warnings: Vec<GameScanWarning>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum OpenDirectoryKind {
    GameRoot,
    ModInGame,
    ExternalMod,
    Unknown,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GameOverviewData {
    pub starsector_root: String,
    pub core_available: bool,
    pub mods_dir: String,
    pub mods: Vec<GameModSummary>,
    pub warnings: Vec<GameScanWarning>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GameModSummary {
    pub mod_root: String,
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub has_mod_info: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GameScanWarning {
    pub path: String,
    pub message: String,
    pub code: String,
    pub location: Option<crate::errors::ErrorLocation>,
    #[serde(default)]
    pub edit_target: Option<GameWarningEditTarget>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GameWarningEditTarget {
    pub mod_root: String,
    pub path: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_directory_result_roundtrips_kebab_kind_and_camel_fields() {
        let result = OpenDirectoryResult {
            kind: OpenDirectoryKind::ModInGame,
            selected_path: "D:/game/mods/x".to_string(),
            starsector_root: Some("D:/game".to_string()),
            mod_root: Some("D:/game/mods/x".to_string()),
            overview: None,
            warnings: vec![GameScanWarning {
                code: "parse.json".to_string(),
                location: None,
                path: "D:/game/mods/x/mod_info.json".to_string(),
                message: "broken".to_string(),
                edit_target: Some(GameWarningEditTarget {
                    mod_root: "D:/game/mods/x".to_string(),
                    path: "D:/game/mods/x/mod_info.json".to_string(),
                }),
            }],
        };
        let json = serde_json::to_value(&result).expect("serializable");
        assert_eq!(json["kind"], "mod-in-game");
        assert_eq!(json["selectedPath"], "D:/game/mods/x");
        assert_eq!(
            json["warnings"][0]["editTarget"]["modRoot"],
            "D:/game/mods/x"
        );

        let back: OpenDirectoryResult = serde_json::from_value(json).expect("deserializable");
        assert!(matches!(back.kind, OpenDirectoryKind::ModInGame));
    }

    #[test]
    fn game_mod_summary_defaults_has_mod_info_through_warning_shape() {
        let warning = GameScanWarning {
            code: "scan.warning".to_string(),
            location: None,
            path: "p".to_string(),
            message: "m".to_string(),
            edit_target: None,
        };
        let json = serde_json::to_value(&warning).expect("serializable");
        assert!(json["editTarget"].is_null());
    }
}
