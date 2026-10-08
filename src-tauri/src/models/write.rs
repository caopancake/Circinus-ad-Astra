use crate::models::{ProjectInvalidation, push_unique_all, required_nullable};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::Path;

pub trait SessionModScope {
    fn session_id(&self) -> Option<&crate::models::ProjectSessionId>;
    fn mod_root(&self) -> &str;
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvRowPatch {
    #[serde(default)]
    pub insert_at: Option<usize>,
    pub row_key: String,
    pub action: CsvRowPatchAction,
    pub row: Map<String, Value>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CsvRowPatchAction {
    Upsert,
    Delete,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvRowKeyMapping {
    pub previous_key: String,
    pub next_key: String,
    pub row_index: usize,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssociatedFileChange {
    pub rel_path: String,
    #[serde(deserialize_with = "required_nullable")]
    pub after_text: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub after_data_base64: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonWriteOptions {
    #[serde(default)]
    pub preserve_original_json: bool,
    #[serde(default)]
    pub confirmed_sources: Vec<JsonSourceConfirmation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonSourceConfirmation {
    pub path: String,
    pub source_fingerprint: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WeaponSpecClass {
    Projectile,
    Beam,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AssociatedSpecCreateParams {
    Ship {
        id: String,
        hull_name: String,
    },
    Weapon {
        id: String,
        spec_class: WeaponSpecClass,
    },
    System {
        id: String,
    },
    Skill {
        id: String,
    },
}

impl AssociatedSpecCreateParams {
    pub fn id(&self) -> &str {
        match self {
            Self::Ship { id, .. }
            | Self::Weapon { id, .. }
            | Self::System { id }
            | Self::Skill { id } => id,
        }
    }
    pub fn table(&self) -> super::CsvTableKey {
        match self {
            Self::Ship { .. } => super::CsvTableKey::Ships,
            Self::Weapon { .. } => super::CsvTableKey::Weapons,
            Self::System { .. } => super::CsvTableKey::ShipSystems,
            Self::Skill { .. } => super::CsvTableKey::Skills,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AssociatedSpecChange {
    Create {
        create: AssociatedSpecCreateParams,
    },
    Delete {
        id: String,
    },
    Rename {
        previous_id: String,
        create: AssociatedSpecCreateParams,
    },
}

impl AssociatedSpecChange {
    pub fn id(&self) -> &str {
        match self {
            Self::Create { create } | Self::Rename { create, .. } => create.id(),
            Self::Delete { id } => id,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditableFileData {
    pub path: String,
    pub text: String,
    pub base_versions: Vec<FileVersion>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileVersion {
    pub path: String,
    pub fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHistorySummary {
    pub id: u64,
    pub label: String,
    pub timestamp: i64,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHistorySnapshot {
    pub revision: u64,
    pub undo_stack: Vec<FileHistorySummary>,
    pub redo_stack: Vec<FileHistorySummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeRecord {
    pub kind: FileChangeKind,
    pub path: String,
    pub before_exists: bool,
    #[serde(deserialize_with = "required_nullable")]
    pub before_text: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub before_data_base64: Option<String>,
    pub before_files: Vec<FileSnapshot>,
    pub after_exists: bool,
    #[serde(deserialize_with = "required_nullable")]
    pub after_text: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub after_data_base64: Option<String>,
    pub after_files: Vec<FileSnapshot>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FileChangeKind {
    File,
    Directory,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileChangeReplayDirection {
    Undo,
    Redo,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EditorSpecKind {
    Ship,
    Weapon,
    Projectile,
    System,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum IndexedConfigKind {
    Faction,
    Mission,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileSnapshot {
    pub rel_path: String,
    #[serde(deserialize_with = "required_nullable")]
    pub text: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub data_base64: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult<T = ()> {
    pub changes: Vec<FileChangeRecord>,
    pub invalidation: ProjectInvalidation,
    pub key_map: Vec<CsvRowKeyMapping>,
    pub refreshed_entity: Option<T>,
    pub commit_id: u64,
    pub base_versions: Vec<FileVersion>,
    pub history: FileHistorySnapshot,
}

/// Refreshed-entity payload of the indexed config chains (faction, mission):
/// the changed index table plus the entity content, returned as the typed
/// `refreshedEntity` of a `WriteResult`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedEntityRefresh {
    pub entity_id: String,
    pub index_path: String,
    pub index_header: Vec<String>,
    pub index_rows: Vec<Map<String, Value>>,
    pub entity_data: Value,
}

impl<T> WriteResult<T> {
    pub fn new(
        changes: Vec<FileChangeRecord>,
        key_map: Vec<CsvRowKeyMapping>,
        refreshed_entity: Option<T>,
    ) -> Self {
        let invalidation = ProjectInvalidation {
            paths: changed_paths_for_changes(&changes),
            ..ProjectInvalidation::default()
        };
        Self {
            changes,
            invalidation,
            key_map,
            refreshed_entity,
            commit_id: 0,
            base_versions: Vec::new(),
            history: FileHistorySnapshot::default(),
        }
    }

    pub fn refreshed_entity(&self) -> Option<&T> {
        self.refreshed_entity.as_ref()
    }
}

impl WriteResult<()> {
    pub fn from_changes(changes: Vec<FileChangeRecord>) -> Self {
        Self::new(changes, Vec::new(), None)
    }
}

impl<T> WriteResult<T> {
    pub fn from_refreshed_entity(changes: Vec<FileChangeRecord>, refreshed_entity: T) -> Self {
        Self::new(changes, Vec::new(), Some(refreshed_entity))
    }
}

fn changed_paths_for_changes(changes: &[FileChangeRecord]) -> Vec<String> {
    let mut paths = Vec::new();
    for change in changes {
        push_unique_all(&mut paths, vec![change.path.clone()]);
        for file in change.before_files.iter().chain(change.after_files.iter()) {
            push_unique_all(
                &mut paths,
                vec![
                    Path::new(&change.path)
                        .join(&file.rel_path)
                        .to_string_lossy()
                        .to_string(),
                ],
            );
        }
    }
    paths
}

#[cfg(test)]
mod tests {
    use super::{
        AssociatedFileChange, AssociatedSpecChange, FileChangeRecord, FileSnapshot, WriteResult,
    };
    use serde_json::json;

    #[test]
    fn associated_spec_wire_uses_action_and_format_owned_create_parameters() {
        let seeds = [
            json!({"kind":"ship","id":"ship","hullName":"Ship"}),
            json!({"kind":"weapon","id":"weapon","specClass":"beam"}),
            json!({"kind":"system","id":"system"}),
            json!({"kind":"skill","id":"skill"}),
        ];
        for create in seeds {
            for action in [
                json!({"action":"create","create":create}),
                json!({"action":"rename","previousId":"old","create":create}),
            ] {
                let decoded: AssociatedSpecChange = serde_json::from_value(action.clone()).unwrap();
                assert_eq!(serde_json::to_value(decoded).unwrap(), action);
            }
        }
        let delete = json!({"action":"delete","id":"entity"});
        let decoded: AssociatedSpecChange = serde_json::from_value(delete.clone()).unwrap();
        assert_eq!(serde_json::to_value(decoded).unwrap(), delete);
    }

    #[test]
    fn associated_file_change_requires_explicit_nullable_content_fields() {
        let result = serde_json::from_value::<AssociatedFileChange>(json!({
            "relPath": "data/config/demo.json",
            "afterText": "{}"
        }));

        assert!(result.is_err());
    }

    #[test]
    fn file_change_record_requires_explicit_nullable_and_collection_fields() {
        let result = serde_json::from_value::<FileChangeRecord>(json!({
            "kind": "file",
            "path": "D:/mods/demo/data/config/demo.json",
            "beforeExists": false,
            "beforeText": null,
            "afterExists": true,
            "afterText": "{}",
            "afterDataBase64": null,
            "afterFiles": []
        }));

        assert!(result.is_err());
    }

    #[test]
    fn file_snapshot_requires_explicit_nullable_content_fields() {
        let result = serde_json::from_value::<FileSnapshot>(json!({
            "relPath": "data/config/demo.json",
            "text": "{}"
        }));

        assert!(result.is_err());
    }

    #[test]
    fn write_result_serializes_current_model_shape() {
        let result: WriteResult<()> = WriteResult::new(Vec::new(), Vec::new(), None);
        let serialized = serde_json::to_value(&result).unwrap();
        let object = serialized.as_object().unwrap();
        let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "baseVersions",
                "changes",
                "commitId",
                "history",
                "invalidation",
                "keyMap",
                "refreshedEntity"
            ]
        );
        assert!(serialized.get("invalidation").is_some());
        assert_eq!(result.invalidation.paths, [] as [&str; 0]);
        assert!(result.refreshed_entity().is_none());
    }
}
