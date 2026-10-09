use super::{CsvTableKey, EntityKind, FileVersion, ResourceSource};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EntityFileLocation {
    pub source: ResourceSource,
    pub root: String,
    pub rel_path: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedSpecRecord {
    pub id: String,
    pub location: EntityFileLocation,
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum EntityLinkedRecord {
    Csv { table: CsvTableKey, row_key: String },
    Index { path: String, row_index: usize },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EntityTargetState {
    Existing,
    Create,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EntityEditTarget {
    pub kind: EntityKind,
    pub id: String,
    #[serde(deserialize_with = "super::required_nullable")]
    pub source: Option<EntityFileLocation>,
    pub write: EntityFileLocation,
    pub state: EntityTargetState,
    #[serde(deserialize_with = "super::required_nullable")]
    pub linked_record: Option<EntityLinkedRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityEditInfo {
    pub target: EntityEditTarget,
    pub base_versions: Vec<FileVersion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityIdentityIntent {
    pub source: EntityEditTarget,
    pub next_id: String,
    pub next_write: EntityFileLocation,
    pub destination_version: FileVersion,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityIdentityChange {
    pub before: EntityEditTarget,
    pub after: EntityEditTarget,
}

#[derive(Debug)]
pub struct FactionIndexRow {
    pub reference: String,
    pub row_index: usize,
    pub id_column: String,
    pub file_column: Option<String>,
}

#[derive(Debug)]
pub struct FactionIndexEntry {
    pub path: std::path::PathBuf,
    pub row_index: usize,
    pub id_column: String,
    pub file_column: Option<String>,
}
