use crate::models::{
    CsvTableKey, EntitySummaries, GameScanWarning, LoadedSpecRecord, ProjectManifest, SkinFile,
    VariantFile,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

pub(super) const MISSION_LIST_TABLE_KEY: &str = "missions";

pub(super) struct EntityProjection {
    pub kind: crate::models::EntityKind,
    pub id: String,
    pub data: Value,
    pub resource_refs: BTreeMap<String, crate::models::ResourceRef>,
}
pub(super) const MISSION_LIST_REL_PATH: &str = "data/missions/mission_list.csv";

/// The missions index table has a single fixed column.
pub(super) fn mission_list_default_header() -> Vec<String> {
    vec!["mission".to_string()]
}

pub(super) const WEAPON_SPRITE_FIELDS: [&str; 8] = [
    "turretSprite",
    "hardpointSprite",
    "turretUnderSprite",
    "hardpointUnderSprite",
    "turretGunSprite",
    "hardpointGunSprite",
    "turretGlowSprite",
    "hardpointGlowSprite",
];

/// Pure per-table metadata shared by every project layer; extraction behavior
/// stays in `table_definitions` and joins onto these specs.
#[derive(Clone, Copy)]
pub(super) struct CoreSourceRequirements {
    pub ships: bool,
    pub weapons: bool,
    pub variants: bool,
}

#[derive(Clone, Copy)]
pub(super) struct CsvTableSpec {
    pub key: CsvTableKey,
    pub rel_path: &'static str,
    pub entity_id_field: &'static str,
    pub entity_summary: Option<fn(&EntitySummaries) -> usize>,
    pub supports_faction_filter: bool,
    pub core_source_requirements: CoreSourceRequirements,
}

pub(super) const SHIPS_SPEC: CsvTableSpec = CsvTableSpec {
    key: CsvTableKey::Ships,
    rel_path: "data/hulls/ship_data.csv",
    entity_id_field: "id",
    entity_summary: Some(|summaries| summaries.ships),
    supports_faction_filter: true,
    core_source_requirements: CoreSourceRequirements {
        ships: true,
        weapons: false,
        variants: false,
    },
};

pub(super) const WEAPONS_SPEC: CsvTableSpec = CsvTableSpec {
    key: CsvTableKey::Weapons,
    rel_path: "data/weapons/weapon_data.csv",
    entity_id_field: "id",
    entity_summary: Some(|summaries| summaries.weapons),
    supports_faction_filter: true,
    core_source_requirements: CoreSourceRequirements {
        ships: false,
        weapons: true,
        variants: false,
    },
};

pub(super) const WINGS_SPEC: CsvTableSpec = CsvTableSpec {
    key: CsvTableKey::Wings,
    rel_path: "data/hulls/wing_data.csv",
    entity_id_field: "id",
    entity_summary: None,
    supports_faction_filter: false,
    core_source_requirements: CoreSourceRequirements {
        ships: true,
        weapons: false,
        variants: true,
    },
};

pub(super) const HULLMODS_SPEC: CsvTableSpec = CsvTableSpec {
    key: CsvTableKey::Hullmods,
    rel_path: "data/hullmods/hull_mods.csv",
    entity_id_field: "id",
    entity_summary: None,
    supports_faction_filter: false,
    core_source_requirements: CoreSourceRequirements {
        ships: false,
        weapons: false,
        variants: false,
    },
};

pub(super) const SHIP_SYSTEMS_SPEC: CsvTableSpec = CsvTableSpec {
    key: CsvTableKey::ShipSystems,
    rel_path: "data/shipsystems/ship_systems.csv",
    entity_id_field: "id",
    entity_summary: Some(|summaries| summaries.systems),
    supports_faction_filter: false,
    core_source_requirements: CoreSourceRequirements {
        ships: false,
        weapons: false,
        variants: false,
    },
};

pub(super) const INDUSTRIES_SPEC: CsvTableSpec = CsvTableSpec {
    key: CsvTableKey::Industries,
    rel_path: "data/campaign/industries.csv",
    entity_id_field: "id",
    entity_summary: None,
    supports_faction_filter: false,
    core_source_requirements: CoreSourceRequirements {
        ships: false,
        weapons: false,
        variants: false,
    },
};

pub(super) const SKILLS_SPEC: CsvTableSpec = CsvTableSpec {
    key: CsvTableKey::Skills,
    rel_path: "data/characters/skills/skill_data.csv",
    entity_id_field: "id",
    entity_summary: Some(|summaries| summaries.skills),
    supports_faction_filter: false,
    core_source_requirements: CoreSourceRequirements {
        ships: false,
        weapons: false,
        variants: false,
    },
};

pub(super) const ABILITIES_SPEC: CsvTableSpec = CsvTableSpec {
    key: CsvTableKey::Abilities,
    rel_path: "data/campaign/abilities.csv",
    entity_id_field: "id",
    entity_summary: None,
    supports_faction_filter: false,
    core_source_requirements: CoreSourceRequirements {
        ships: false,
        weapons: false,
        variants: false,
    },
};

pub(super) const COMMODITIES_SPEC: CsvTableSpec = CsvTableSpec {
    key: CsvTableKey::Commodities,
    rel_path: "data/campaign/commodities.csv",
    entity_id_field: "id",
    entity_summary: None,
    supports_faction_filter: false,
    core_source_requirements: CoreSourceRequirements {
        ships: false,
        weapons: false,
        variants: false,
    },
};

pub(super) const SPECIAL_ITEMS_SPEC: CsvTableSpec = CsvTableSpec {
    key: CsvTableKey::SpecialItems,
    rel_path: "data/campaign/special_items.csv",
    entity_id_field: "id",
    entity_summary: None,
    supports_faction_filter: false,
    core_source_requirements: CoreSourceRequirements {
        ships: false,
        weapons: false,
        variants: false,
    },
};

pub(super) const SUBMARKETS_SPEC: CsvTableSpec = CsvTableSpec {
    key: CsvTableKey::Submarkets,
    rel_path: "data/campaign/submarkets.csv",
    entity_id_field: "id",
    entity_summary: None,
    supports_faction_filter: false,
    core_source_requirements: CoreSourceRequirements {
        ships: false,
        weapons: false,
        variants: false,
    },
};

pub(super) const MARKET_CONDITIONS_SPEC: CsvTableSpec = CsvTableSpec {
    key: CsvTableKey::MarketConditions,
    rel_path: "data/campaign/market_conditions.csv",
    entity_id_field: "id",
    entity_summary: None,
    supports_faction_filter: false,
    core_source_requirements: CoreSourceRequirements {
        ships: false,
        weapons: false,
        variants: false,
    },
};

pub(super) const SIM_OPPONENTS_SPEC: CsvTableSpec = CsvTableSpec {
    key: CsvTableKey::SimOpponents,
    rel_path: "data/campaign/sim_opponents.csv",
    entity_id_field: "variant id",
    entity_summary: None,
    supports_faction_filter: false,
    core_source_requirements: CoreSourceRequirements {
        ships: false,
        weapons: false,
        variants: false,
    },
};

pub(super) const DESCRIPTIONS_SPEC: CsvTableSpec = CsvTableSpec {
    key: CsvTableKey::Descriptions,
    rel_path: "data/strings/descriptions.csv",
    entity_id_field: "id",
    entity_summary: None,
    supports_faction_filter: false,
    core_source_requirements: CoreSourceRequirements {
        ships: false,
        weapons: false,
        variants: false,
    },
};

pub(super) fn csv_table_spec(table: CsvTableKey) -> &'static CsvTableSpec {
    match table {
        CsvTableKey::Ships => &SHIPS_SPEC,
        CsvTableKey::Weapons => &WEAPONS_SPEC,
        CsvTableKey::Wings => &WINGS_SPEC,
        CsvTableKey::Hullmods => &HULLMODS_SPEC,
        CsvTableKey::ShipSystems => &SHIP_SYSTEMS_SPEC,
        CsvTableKey::Industries => &INDUSTRIES_SPEC,
        CsvTableKey::Skills => &SKILLS_SPEC,
        CsvTableKey::Abilities => &ABILITIES_SPEC,
        CsvTableKey::Commodities => &COMMODITIES_SPEC,
        CsvTableKey::SpecialItems => &SPECIAL_ITEMS_SPEC,
        CsvTableKey::Submarkets => &SUBMARKETS_SPEC,
        CsvTableKey::MarketConditions => &MARKET_CONDITIONS_SPEC,
        CsvTableKey::SimOpponents => &SIM_OPPONENTS_SPEC,
        CsvTableKey::Descriptions => &DESCRIPTIONS_SPEC,
    }
}

pub(super) fn csv_table_specs() -> &'static [CsvTableSpec] {
    &[
        SHIPS_SPEC,
        WEAPONS_SPEC,
        WINGS_SPEC,
        HULLMODS_SPEC,
        SHIP_SYSTEMS_SPEC,
        INDUSTRIES_SPEC,
        SKILLS_SPEC,
        ABILITIES_SPEC,
        COMMODITIES_SPEC,
        SPECIAL_ITEMS_SPEC,
        SUBMARKETS_SPEC,
        MARKET_CONDITIONS_SPEC,
        SIM_OPPONENTS_SPEC,
        DESCRIPTIONS_SPEC,
    ]
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct SpecBundle {
    pub ship_files: BTreeMap<String, LoadedSpecRecord>,
    pub variant_files: Vec<VariantFile>,
    pub skin_files: Vec<SkinFile>,
    pub weapon_specs: BTreeMap<String, LoadedSpecRecord>,
    pub projectile_specs: BTreeMap<String, LoadedSpecRecord>,
    pub system_files: BTreeMap<String, LoadedSpecRecord>,
    pub skill_files: BTreeMap<String, LoadedSpecRecord>,
    pub variant_warnings: Vec<GameScanWarning>,
    pub skin_warnings: Vec<GameScanWarning>,
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct SessionCsvTable {
    pub header: Vec<String>,
    pub path: String,
    pub rows: Option<Vec<SessionCsvRow>>,
    /// Sole allocator state for `{table}:row:{seq}` keys; survives refresh of
    /// the table's own save so deletes cannot recycle surviving row identities.
    pub next_row_seq: u64,
    pub saved_text: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct SessionCsvRow {
    pub row_key: String,
    pub data: Map<String, Value>,
    pub faction_id: Option<String>,
}

pub(super) struct ProjectSession {
    pub projection_revision: u64,
    pub projection_pending: bool,
    pub source_versions: BTreeMap<String, crate::models::FileVersion>,
    pub manifest: ProjectManifest,
    pub faction_files: BTreeMap<String, LoadedSpecRecord>,
    pub tag_map: HashMap<String, String>,
    pub csv_tables: BTreeMap<String, SessionCsvTable>,
    pub ship_files: BTreeMap<String, LoadedSpecRecord>,
    pub variant_files: Vec<VariantFile>,
    pub skin_files: Vec<SkinFile>,
    pub variant_warnings: Vec<GameScanWarning>,
    pub skin_warnings: Vec<GameScanWarning>,
    pub weapon_specs: BTreeMap<String, LoadedSpecRecord>,
    pub projectile_specs: BTreeMap<String, LoadedSpecRecord>,
    pub system_files: BTreeMap<String, LoadedSpecRecord>,
    pub skill_files: BTreeMap<String, LoadedSpecRecord>,
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct CoreCache {
    pub csv_tables: BTreeMap<String, Arc<SessionCsvTable>>,
    pub ship_files: Option<Arc<BTreeMap<String, LoadedSpecRecord>>>,
    pub variant_files: Option<Arc<Vec<VariantFile>>>,
    pub skin_files: Option<Arc<Vec<SkinFile>>>,
    pub weapon_specs: Option<Arc<BTreeMap<String, LoadedSpecRecord>>>,
    pub projectile_specs: Option<Arc<BTreeMap<String, LoadedSpecRecord>>>,
}

impl CoreCache {
    pub(super) fn empty() -> Self {
        Self {
            csv_tables: BTreeMap::new(),
            ship_files: None,
            variant_files: None,
            skin_files: None,
            weapon_specs: None,
            projectile_specs: None,
        }
    }
}

#[derive(Clone, Default)]
pub(super) struct CoreSourceData {
    pub ship_files: Arc<BTreeMap<String, LoadedSpecRecord>>,
    pub variant_files: Arc<Vec<VariantFile>>,
    pub weapon_specs: Arc<BTreeMap<String, LoadedSpecRecord>>,
}

pub(super) fn string_from_row(row: &Map<String, Value>, key: &str) -> Option<String> {
    row.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

pub(super) fn string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

pub(super) fn weapon_sprite_path(weapon: &Value) -> Option<String> {
    WEAPON_SPRITE_FIELDS
        .iter()
        .find_map(|key| string_field(weapon, key))
}

pub(super) fn is_comment_row(row: &Map<String, Value>) -> bool {
    row.values()
        .filter_map(Value::as_str)
        .find(|value| !value.trim().is_empty())
        .is_some_and(|value| value.trim_start().starts_with('#'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn row(entries: &[(&str, &str)]) -> Map<String, Value> {
        entries
            .iter()
            .map(|(key, value)| (key.to_string(), Value::String(value.to_string())))
            .collect()
    }

    #[test]
    fn is_comment_row_flags_rows_whose_first_value_starts_with_hash() {
        assert!(is_comment_row(&row(&[("id", " #disabled")])));
        assert!(is_comment_row(&row(&[("name", ""), ("id", "#x")])));
        assert!(!is_comment_row(&row(&[("id", "active")])));
        assert!(!is_comment_row(&row(&[("id", "C#not-a-comment")])));
    }

    #[test]
    fn string_from_row_reads_string_values_only() {
        let mut data = row(&[("id", "xy")]);
        data.insert("hp".to_string(), json!(12));
        assert_eq!(string_from_row(&data, "id").as_deref(), Some("xy"));
        assert_eq!(string_from_row(&data, "hp"), None);
        assert_eq!(string_from_row(&data, "missing"), None);
    }

    #[test]
    fn string_field_reads_top_level_object_keys() {
        let value = json!({ "spec": { "id": "inner" } });
        assert_eq!(string_field(&value, "spec"), None);
        assert_eq!(
            string_field(&json!({ "id": "inner" }), "id").as_deref(),
            Some("inner")
        );
        assert_eq!(string_field(&value, "missing"), None);
    }

    #[test]
    fn weapon_sprite_path_picks_the_first_declared_sprite_field() {
        let weapon = json!({ "turretGunSprite": "graphics/gun.png" });
        assert_eq!(
            weapon_sprite_path(&weapon).as_deref(),
            Some("graphics/gun.png")
        );
        assert_eq!(weapon_sprite_path(&json!({})), None);
    }

    #[test]
    fn csv_table_spec_covers_every_table_key() {
        for spec in csv_table_specs() {
            assert_eq!(csv_table_spec(spec.key).key, spec.key);
        }
    }

    #[test]
    fn mission_list_default_header_is_the_mission_column() {
        assert_eq!(mission_list_default_header(), vec!["mission".to_string()]);
    }
}
