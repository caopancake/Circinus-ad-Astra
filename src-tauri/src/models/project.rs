use super::directory_opening::GameScanWarning;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum CsvTableKey {
    Ships,
    Weapons,
    Wings,
    Hullmods,
    ShipSystems,
    Industries,
    Skills,
    Abilities,
    Commodities,
    SpecialItems,
    Submarkets,
    MarketConditions,
    SimOpponents,
    Descriptions,
}

pub const CSV_DEFAULT_FACTION_ID: &str = "other";
/// Frozen on-disk log file name; every writer and validator must share it.
pub const LOG_FILE: &str = "circinus-ad-astra.log";

impl CsvTableKey {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ships => "ships",
            Self::Weapons => "weapons",
            Self::Wings => "wings",
            Self::Hullmods => "hullmods",
            Self::ShipSystems => "shipSystems",
            Self::Industries => "industries",
            Self::Skills => "skills",
            Self::Abilities => "abilities",
            Self::Commodities => "commodities",
            Self::SpecialItems => "specialItems",
            Self::Submarkets => "submarkets",
            Self::MarketConditions => "marketConditions",
            Self::SimOpponents => "simOpponents",
            Self::Descriptions => "descriptions",
        }
    }

    pub fn from_key(value: &str) -> Option<Self> {
        match value {
            "ships" => Some(Self::Ships),
            "weapons" => Some(Self::Weapons),
            "wings" => Some(Self::Wings),
            "hullmods" => Some(Self::Hullmods),
            "shipSystems" => Some(Self::ShipSystems),
            "industries" => Some(Self::Industries),
            "skills" => Some(Self::Skills),
            "abilities" => Some(Self::Abilities),
            "commodities" => Some(Self::Commodities),
            "specialItems" => Some(Self::SpecialItems),
            "submarkets" => Some(Self::Submarkets),
            "marketConditions" => Some(Self::MarketConditions),
            "simOpponents" => Some(Self::SimOpponents),
            "descriptions" => Some(Self::Descriptions),
            _ => None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CsvFactionFilter {
    All,
    Faction {
        #[serde(rename = "factionId")]
        faction_id: String,
    },
}

impl CsvFactionFilter {
    pub fn faction_id(&self) -> Option<&str> {
        match self {
            Self::All => None,
            Self::Faction { faction_id } => Some(faction_id.as_str()),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CsvTable {
    pub header: Vec<String>,
    pub rows: Vec<Map<String, Value>>,
    pub path: String,
}

pub type ProjectSessionId = String;

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EditorResourceKind {
    Ship,
    Weapon,
    Projectile,
    System,
    Faction,
    Mission,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectManifest {
    pub base_versions: Vec<crate::models::FileVersion>,
    pub session_id: ProjectSessionId,
    pub mod_root: String,
    pub starsector_root: Option<String>,
    pub core_available: bool,
    pub associated_spec_tables: Vec<CsvTableKey>,
    pub mod_info: Option<Value>,
    pub table_summaries: BTreeMap<CsvTableKey, TableSummary>,
    pub table_entity_summaries: BTreeMap<CsvTableKey, usize>,
    pub entity_summaries: EntitySummaries,
    pub warnings: Vec<GameScanWarning>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInvalidation {
    pub paths: Vec<String>,
    pub tables: Vec<CsvTableKey>,
    pub entities: Vec<InvalidatedEntityRef>,
    pub resources: Vec<InvalidatedResourceScope>,
    pub query_scopes: Vec<InvalidatedQueryScope>,
    pub session: bool,
}

impl ProjectInvalidation {
    pub fn merge(&mut self, other: Self) {
        push_unique_all(&mut self.paths, other.paths);
        push_unique_all(&mut self.tables, other.tables);
        push_unique_all(&mut self.entities, other.entities);
        push_unique_all(&mut self.resources, other.resources);
        push_unique_all(&mut self.query_scopes, other.query_scopes);
        self.session |= other.session;
    }
}

pub(crate) fn push_unique_all<T: PartialEq>(target: &mut Vec<T>, values: Vec<T>) {
    for value in values {
        if !target.contains(&value) {
            target.push(value);
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSessionInvalidationResult {
    pub manifest: ProjectManifest,
    pub invalidation: ProjectInvalidation,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvalidatedEntityRef {
    pub kind: EntityKind,
    pub id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvalidatedResourceScope {
    pub source: ResourceSource,
    pub rel_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvalidatedQueryScope {
    pub kind: InvalidatedQueryKind,
    pub table: Option<CsvTableKey>,
    pub source: Option<String>,
    pub entity: Option<InvalidatedEntityRef>,
    pub resource: Option<InvalidatedResourceScope>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum InvalidatedQueryKind {
    CsvTableWindow,
    CsvSourceOptions,
    CsvRowPreview,
    HullReferences,
    EntityDetail,
    EntityList,
    ResourceDataUrls,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TableSummary {
    pub path: String,
    pub header: Vec<String>,
    pub available: bool,
    pub total_rows: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct EntitySummaries {
    pub factions: usize,
    pub missions: usize,
    pub ships: usize,
    pub weapons: usize,
    pub projectiles: usize,
    pub variants: usize,
    pub skins: usize,
    pub systems: usize,
    pub skills: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CsvTableWindow {
    pub base_versions: Vec<crate::models::FileVersion>,
    pub table: CsvTableKey,
    pub header: Vec<String>,
    pub total_rows: usize,
    pub filtered_rows: usize,
    pub start: usize,
    pub rows: Vec<CsvWindowRow>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CsvWindowRow {
    pub row_key: String,
    pub source_row_index: usize,
    pub data: Map<String, Value>,
    pub faction_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredField {
    pub key: String,
    #[serde(rename = "type")]
    pub field_type: DiscoveredFieldType,
    pub origin: ResourceSource,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DiscoveredFieldType {
    Boolean,
    Integer,
    Float,
    String,
    PathImage,
    StringArray,
    ColorRgba,
    ArrayOfObject,
    TagSelect,
    Object,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CsvRowPreview {
    pub resource_ref: Option<ResourceRef>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SourceOptionGroup {
    pub origin: ResourceSource,
    pub options: Vec<SourceOption>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SourceOption {
    pub label: String,
    pub value: String,
    pub description: Option<String>,
    pub resource_ref: Option<ResourceRef>,
    pub origin: ResourceSource,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum EntityKind {
    Ship,
    Weapon,
    Projectile,
    System,
    Skill,
    Faction,
    Mission,
    Variant,
    Skin,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EntityData {
    pub target: crate::models::EntityEditTarget,
    pub base_versions: Vec<crate::models::FileVersion>,
    pub kind: EntityKind,
    pub id: String,
    pub data: Value,
    pub resource_refs: BTreeMap<String, ResourceRef>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum ResourceSource {
    Mod,
    Core,
}

impl ResourceSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Mod => "mod",
            Self::Core => "core",
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum ResourceOwnerKind {
    Ship,
    Weapon,
    Variant,
    Skin,
    Faction,
    Mission,
    Hullmods,
    ShipSystems,
    Industries,
    Skills,
    Abilities,
    Commodities,
    SpecialItems,
    Submarkets,
    MarketConditions,
}

impl From<EntityKind> for ResourceOwnerKind {
    fn from(kind: EntityKind) -> Self {
        match kind {
            EntityKind::Ship => Self::Ship,
            EntityKind::Weapon => Self::Weapon,
            EntityKind::Variant => Self::Variant,
            EntityKind::Skin => Self::Skin,
            EntityKind::Faction => Self::Faction,
            EntityKind::Mission => Self::Mission,
            EntityKind::Skill => Self::Skills,
            EntityKind::System => Self::ShipSystems,
            EntityKind::Projectile => Self::Weapon,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResourceRef {
    pub source: ResourceSource,
    pub rel_path: String,
    pub owner_kind: ResourceOwnerKind,
    pub owner_id: String,
    pub key: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResourceDataUrlBatchEntry {
    pub key: String,
    pub source: ResourceSource,
    pub rel_path: String,
    pub owner_kind: ResourceOwnerKind,
    pub owner_id: String,
    pub data_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResourceDataUrlBatchResult {
    pub entries: Vec<ResourceDataUrlBatchEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HullReferenceOption {
    pub label: String,
    pub value: String,
    pub origin: ResourceSource,
    pub kind: HullReferenceKind,
    pub resource_ref: Option<ResourceRef>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum HullReferenceKind {
    Ship,
    Skin,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HullReferenceGroup {
    pub origin: ResourceSource,
    pub kind: HullReferenceKind,
    pub options: Vec<HullReferenceOption>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HullReferencesResult {
    pub groups: Vec<HullReferenceGroup>,
    pub hull_names: BTreeMap<String, String>,
    pub sprites: BTreeMap<String, ResourceRef>,
    pub built_in_weapon_slots: BTreeMap<String, Vec<HullWeaponSlot>>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HullWeaponSlot {
    pub id: String,
    pub origin: ResourceSource,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VariantFile {
    pub variant_id: String,
    pub hull_id: String,
    pub path: String,
    pub rel_path: String,
    pub data: Value,
    pub weapon_group_count: usize,
    pub hull_mod_count: usize,
    pub perma_mod_count: usize,
    pub wing_count: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkinFile {
    pub skin_hull_id: String,
    pub base_hull_id: String,
    pub path: String,
    pub rel_path: String,
    pub data: Value,
    pub built_in_mod_count: usize,
    pub built_in_weapon_count: usize,
    pub built_in_wing_count: usize,
    pub weapon_slot_change_count: usize,
    pub engine_slot_change_count: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FactionMeta {
    pub name: String,
    pub color: String,
}

#[cfg(test)]
mod tests {
    use super::{EntityData, EntityKind};
    use serde_json::{Map, Value, json};
    use std::collections::BTreeMap;

    #[test]
    fn entity_data_serializes_empty_resource_refs_explicitly() {
        let entity = EntityData {
            target: crate::models::EntityEditTarget {
                kind: EntityKind::Projectile,
                id: "demo_projectile".to_string(),
                source: None,
                write: crate::models::EntityFileLocation {
                    source: super::ResourceSource::Mod,
                    root: "mod".to_string(),
                    rel_path: "data/weapons/proj/demo_projectile.proj".to_string(),
                    path: "mod/data/weapons/proj/demo_projectile.proj".to_string(),
                },
                state: crate::models::EntityTargetState::Create,
                linked_record: None,
            },
            base_versions: Vec::new(),
            kind: EntityKind::Projectile,
            id: "demo_projectile".to_string(),
            data: Value::Object(Map::new()),
            resource_refs: BTreeMap::new(),
        };

        let target = serde_json::to_value(&entity.target).unwrap();
        let value = serde_json::to_value(entity).unwrap();

        assert_eq!(
            value,
            json!({
                "target": target,
                "kind": "projectile",
                "id": "demo_projectile",
                "data": {},
                "resourceRefs": {}, "baseVersions": []
            })
        );
    }
}
