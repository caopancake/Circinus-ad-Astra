use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use super::directory_opening::{GameModSummary, GameScanWarning};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PersistedWorkspace {
    #[serde(default)]
    pub mods: Vec<PersistedMod>,
    pub starsector_root: Option<String>,
    #[serde(default)]
    pub game_mods: Vec<GameModSummary>,
    #[serde(default)]
    pub game_warnings: Vec<GameScanWarning>,
    #[serde(default)]
    pub column_widths: BTreeMap<String, BTreeMap<String, BTreeMap<String, f64>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedMod {
    pub mod_root: String,
    pub display_name: String,
    #[serde(default)]
    pub version: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persisted_workspace_uses_camel_case_and_defaults_collections() {
        let json = serde_json::json!({
            "mods": [{ "modRoot": "C:/mods/a", "displayName": "A" }],
            "starsectorRoot": "D:/games/starsector"
        });
        let workspace: PersistedWorkspace = serde_json::from_value(json).expect("deserializable");
        assert_eq!(workspace.mods.len(), 1);
        assert_eq!(workspace.mods[0].mod_root, "C:/mods/a");
        assert!(workspace.mods[0].version.is_empty());
        assert!(workspace.game_mods.is_empty());
        assert!(workspace.game_warnings.is_empty());
        assert!(workspace.column_widths.is_empty());
    }

    #[test]
    fn persisted_mod_keeps_optional_version() {
        let json = serde_json::json!({ "modRoot": "M:/x", "displayName": "X", "version": "1.2" });
        let persisted: PersistedMod = serde_json::from_value(json).expect("deserializable");
        assert_eq!(persisted.version, "1.2");
    }
}
