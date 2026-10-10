use super::super::{
    cache::{
        ensure_registered_table_rows, ensure_session_table_rows, load_core_variant_files,
        loaded_csv_rows, loaded_registered_csv_rows,
        spec_files::{load_skin_files, load_variant_files},
    },
    model::{
        EntityProjection, MISSION_LIST_REL_PATH, MISSION_LIST_TABLE_KEY, ProjectSession,
        SessionCsvRow, string_from_row,
    },
    resources::resource_ref,
    root,
};
use super::{
    entity_resources::{
        faction_resource_refs, mission_resource_refs, projectile_resource_refs, ship_resource_refs,
        skin_entity_resource_refs, system_resource_refs, variant_resource_refs,
        weapon_resource_refs,
    },
    factions,
    table_definitions::csv_table_icon_resource_ref,
};
use crate::{
    domain::config::{path_affects_target, path_is_or_in_dir},
    domain::editor_config_definitions::{
        EntitySpecDefinition, FACTION_SPEC_DEFINITION, PROJECTILE_SPEC_DEFINITION,
        SHIP_SPEC_DEFINITION, SKILL_SPEC_DEFINITION, SKIN_SPEC_DEFINITION, SYSTEM_SPEC_DEFINITION,
        VARIANT_SPEC_DEFINITION, WEAPON_SPEC_DEFINITION,
        associated_spec_definition as domain_associated_spec_definition,
        associated_spec_tables as domain_associated_spec_tables,
    },
    errors::{AppError, AppResult},
    io::read_json_file,
    models::{
        CsvTableKey, EntityKind, InvalidatedQueryKind, ResourceOwnerKind, ResourceRef,
        ResourceSource, SkinFile, VariantFile,
    },
};
use serde_json::{Map, Value};
use std::{collections::BTreeMap, path::Path};

type EntityListLoader = fn(&mut ProjectSession) -> AppResult<Vec<EntityProjection>>;
type EntityCoreListLoader = fn(&ProjectSession) -> AppResult<Vec<EntityProjection>>;

pub(in crate::services::project) struct ProjectEntityDefinition {
    pub kind: EntityKind,
    pub spec: Option<&'static EntitySpecDefinition>,
    pub csv_table: Option<CsvTableKey>,
    pub source_options: &'static [&'static str],
    pub path_matches: fn(&ProjectEntityDefinition, &str) -> bool,
    pub query_impacts: &'static [InvalidatedQueryKind],
    pub prepare: fn(&mut ProjectSession) -> AppResult<()>,
    pub detail: fn(&mut ProjectSession, &str) -> AppResult<Option<Value>>,
    pub list: EntityListLoader,
    pub core_list: Option<EntityCoreListLoader>,
    pub resources: fn(&ProjectSession, &str, &Value) -> BTreeMap<String, ResourceRef>,
    pub refresh: fn(&ProjectSession) -> AppResult<EntityRefresh>,
}

pub(in crate::services::project) fn entity_definition(
    kind: EntityKind,
) -> AppResult<&'static ProjectEntityDefinition> {
    PROJECT_ENTITY_DEFINITIONS
        .iter()
        .find(|definition| definition.kind == kind)
        .ok_or_else(|| {
            AppError::message("entity.kind_unknown", format!("未注册的实体种类: {kind:?}"))
        })
}

pub(in crate::services::project) fn entity_definitions() -> &'static [ProjectEntityDefinition] {
    &PROJECT_ENTITY_DEFINITIONS
}

pub(in crate::services::project) fn associated_spec_definition(
    table: CsvTableKey,
) -> Option<&'static EntitySpecDefinition> {
    domain_associated_spec_definition(table)
}

pub(in crate::services::project) fn associated_spec_tables() -> Vec<CsvTableKey> {
    domain_associated_spec_tables()
}

const PROJECT_ENTITY_DEFINITIONS: [ProjectEntityDefinition; 9] = [
    ProjectEntityDefinition {
        kind: EntityKind::Ship,
        spec: Some(&SHIP_SPEC_DEFINITION),
        csv_table: Some(CsvTableKey::Ships),
        source_options: &["ships.id", "wings.id"],
        path_matches: spec_path_matches,
        query_impacts: &[InvalidatedQueryKind::HullReferences],
        prepare: prepare_none,
        detail: ship_detail,
        list: ship_list,
        core_list: None,
        resources: ship_resources,
        refresh: refresh_ship,
    },
    ProjectEntityDefinition {
        kind: EntityKind::Weapon,
        spec: Some(&WEAPON_SPEC_DEFINITION),
        csv_table: Some(CsvTableKey::Weapons),
        source_options: &["weapons.id"],
        path_matches: spec_path_matches,
        query_impacts: &[],
        prepare: prepare_weapon,
        detail: weapon_detail,
        list: weapon_list,
        core_list: None,
        resources: weapon_entity_resources,
        refresh: refresh_weapon,
    },
    ProjectEntityDefinition {
        kind: EntityKind::Projectile,
        spec: Some(&PROJECTILE_SPEC_DEFINITION),
        csv_table: None,
        source_options: &[],
        path_matches: spec_path_matches,
        query_impacts: &[],
        prepare: prepare_none,
        detail: projectile_detail,
        list: projectile_list,
        core_list: None,
        resources: projectile_resources,
        refresh: refresh_projectile,
    },
    ProjectEntityDefinition {
        kind: EntityKind::System,
        spec: Some(&SYSTEM_SPEC_DEFINITION),
        csv_table: Some(CsvTableKey::ShipSystems),
        source_options: &[],
        path_matches: spec_path_matches,
        query_impacts: &[],
        prepare: prepare_none,
        detail: system_detail,
        list: system_list,
        core_list: None,
        resources: system_resources,
        refresh: refresh_system,
    },
    ProjectEntityDefinition {
        kind: EntityKind::Skill,
        spec: Some(&SKILL_SPEC_DEFINITION),
        csv_table: Some(CsvTableKey::Skills),
        source_options: &[],
        path_matches: spec_path_matches,
        query_impacts: &[],
        prepare: prepare_skill,
        detail: skill_detail,
        list: skill_list,
        core_list: None,
        resources: skill_resources,
        refresh: refresh_skill,
    },
    ProjectEntityDefinition {
        kind: EntityKind::Faction,
        spec: Some(&FACTION_SPEC_DEFINITION),
        csv_table: None,
        source_options: &["ships.tags", "weapons.tags", "wings.tags"],
        path_matches: faction_path_matches,
        query_impacts: &[],
        prepare: prepare_none,
        detail: faction_detail,
        list: faction_list,
        core_list: None,
        resources: faction_resources,
        refresh: refresh_faction,
    },
    ProjectEntityDefinition {
        kind: EntityKind::Mission,
        spec: None,
        csv_table: None,
        source_options: &[],
        path_matches: mission_path_matches,
        query_impacts: &[],
        prepare: prepare_mission,
        detail: mission_detail,
        list: mission_list,
        core_list: None,
        resources: mission_resources,
        refresh: refresh_mission,
    },
    ProjectEntityDefinition {
        kind: EntityKind::Variant,
        spec: Some(&VARIANT_SPEC_DEFINITION),
        csv_table: None,
        source_options: &["wings.id", "variants.variantId"],
        path_matches: spec_path_matches,
        query_impacts: &[],
        prepare: prepare_none,
        detail: variant_detail,
        list: variant_list,
        core_list: Some(variant_core_list),
        resources: variant_resources,
        refresh: refresh_variant,
    },
    ProjectEntityDefinition {
        kind: EntityKind::Skin,
        spec: Some(&SKIN_SPEC_DEFINITION),
        csv_table: None,
        source_options: &["ships.id", "wings.id"],
        path_matches: spec_path_matches,
        query_impacts: &[InvalidatedQueryKind::HullReferences],
        prepare: prepare_none,
        detail: skin_detail,
        list: skin_list,
        core_list: None,
        resources: skin_resources,
        refresh: refresh_skin,
    },
];

fn prepare_none(_session: &mut ProjectSession) -> AppResult<()> {
    Ok(())
}

fn spec_path_matches(definition: &ProjectEntityDefinition, path: &str) -> bool {
    definition.spec.is_some_and(|spec| spec.path_matches(path))
}

fn faction_path_matches(_definition: &ProjectEntityDefinition, path: &str) -> bool {
    path_is_or_in_dir(path, "data/world/factions") || path.ends_with(".faction")
}

fn mission_path_matches(_definition: &ProjectEntityDefinition, path: &str) -> bool {
    path_is_or_in_dir(path, "data/missions") || path_affects_target(path, MISSION_LIST_REL_PATH)
}

fn prepare_weapon(session: &mut ProjectSession) -> AppResult<()> {
    ensure_registered_table_rows(session, CsvTableKey::Weapons)
}

fn prepare_skill(session: &mut ProjectSession) -> AppResult<()> {
    ensure_registered_table_rows(session, CsvTableKey::Skills)
}

fn prepare_mission(session: &mut ProjectSession) -> AppResult<()> {
    ensure_session_table_rows(session, MISSION_LIST_TABLE_KEY)
}

fn ship_detail(session: &mut ProjectSession, id: &str) -> AppResult<Option<Value>> {
    Ok(session.ship_files.get(id).map(|record| record.data.clone()))
}

fn weapon_detail(session: &mut ProjectSession, id: &str) -> AppResult<Option<Value>> {
    build_weapon_entity_data(session, id)
}

fn projectile_detail(session: &mut ProjectSession, id: &str) -> AppResult<Option<Value>> {
    Ok(session
        .projectile_specs
        .get(id)
        .map(|record| record.data.clone()))
}

fn system_detail(session: &mut ProjectSession, id: &str) -> AppResult<Option<Value>> {
    Ok(session
        .system_files
        .get(id)
        .map(|record| record.data.clone()))
}

fn skill_detail(session: &mut ProjectSession, id: &str) -> AppResult<Option<Value>> {
    build_skill_entity_data(session, id)
}

fn faction_detail(session: &mut ProjectSession, id: &str) -> AppResult<Option<Value>> {
    Ok(session
        .faction_files
        .get(id)
        .map(|record| record.data.clone()))
}

fn mission_detail(session: &mut ProjectSession, id: &str) -> AppResult<Option<Value>> {
    build_mission_entity(session, id)
}

fn variant_detail(session: &mut ProjectSession, id: &str) -> AppResult<Option<Value>> {
    session
        .variant_files
        .iter()
        .find(|item| item.variant_id == id)
        .map(variant_file_data)
        .transpose()
}

fn skin_detail(session: &mut ProjectSession, id: &str) -> AppResult<Option<Value>> {
    session
        .skin_files
        .iter()
        .find(|item| item.skin_hull_id == id)
        .map(skin_file_data)
        .transpose()
}

fn ship_list(session: &mut ProjectSession) -> AppResult<Vec<EntityProjection>> {
    session
        .ship_files
        .iter()
        .map(|(id, data)| plain_entity(session, EntityKind::Ship, id, data.data.clone()))
        .collect()
}

fn weapon_list(session: &mut ProjectSession) -> AppResult<Vec<EntityProjection>> {
    registered_weapon_rows(session)?
        .into_iter()
        .map(|entry| build_weapon_list_entity(session, EntityKind::Weapon, &entry.id, entry.data))
        .collect()
}

fn projectile_list(session: &mut ProjectSession) -> AppResult<Vec<EntityProjection>> {
    session
        .projectile_specs
        .iter()
        .map(|(id, data)| plain_entity(session, EntityKind::Projectile, id, data.data.clone()))
        .collect()
}

fn system_list(session: &mut ProjectSession) -> AppResult<Vec<EntityProjection>> {
    session
        .system_files
        .iter()
        .map(|(id, data)| plain_entity(session, EntityKind::System, id, data.data.clone()))
        .collect()
}

fn skill_list(session: &mut ProjectSession) -> AppResult<Vec<EntityProjection>> {
    registered_skill_rows(session)?
        .into_iter()
        .map(|entry| build_skill_list_entity(session, EntityKind::Skill, &entry.id, entry.data))
        .collect()
}

fn faction_list(session: &mut ProjectSession) -> AppResult<Vec<EntityProjection>> {
    session
        .faction_files
        .iter()
        .map(|(id, data)| plain_entity(session, EntityKind::Faction, id, data.data.clone()))
        .collect()
}

fn mission_list(session: &mut ProjectSession) -> AppResult<Vec<EntityProjection>> {
    registered_mission_rows(session)?
        .into_iter()
        .map(|entry| build_mission_list_entity(session, EntityKind::Mission, &entry.id, entry.data))
        .collect()
}

fn variant_list(session: &mut ProjectSession) -> AppResult<Vec<EntityProjection>> {
    variant_entities(session, ResourceSource::Mod)
}

/// Core-only variant entities: the complement a variant reference domain
/// offers on top of the Mod's own list when a Starsector root is configured.
fn variant_core_list(session: &ProjectSession) -> AppResult<Vec<EntityProjection>> {
    variant_entities(session, ResourceSource::Core)
}

fn variant_entities(
    session: &ProjectSession,
    origin: ResourceSource,
) -> AppResult<Vec<EntityProjection>> {
    match origin {
        ResourceSource::Mod => session
            .variant_files
            .iter()
            .map(|item| variant_entity(session, origin, item))
            .collect(),
        ResourceSource::Core => {
            let Some(root) = session.manifest.starsector_root.as_ref() else {
                return Ok(Vec::new());
            };
            load_core_variant_files(root)?
                .iter()
                .map(|item| variant_entity(session, origin, item))
                .collect()
        }
    }
}

fn variant_entity(
    session: &ProjectSession,
    origin: ResourceSource,
    item: &VariantFile,
) -> AppResult<EntityProjection> {
    let data = variant_file_data(item)?;
    Ok(EntityProjection {
        kind: EntityKind::Variant,
        id: item.variant_id.clone(),
        resource_refs: variant_resource_refs(session, origin, &data),
        data,
    })
}

fn skin_list(session: &mut ProjectSession) -> AppResult<Vec<EntityProjection>> {
    session
        .skin_files
        .iter()
        .map(|item| build_skin_entity(session, EntityKind::Skin, item))
        .collect()
}

fn plain_entity(
    session: &ProjectSession,
    kind: EntityKind,
    id: &str,
    data: Value,
) -> AppResult<EntityProjection> {
    let definition = entity_definition(kind)?;
    Ok(EntityProjection {
        kind,
        id: id.to_string(),
        resource_refs: (definition.resources)(session, id, &data),
        data,
    })
}

fn weapon_entity_resources(
    _session: &ProjectSession,
    id: &str,
    data: &Value,
) -> BTreeMap<String, ResourceRef> {
    data.get("spec")
        .map(|spec| weapon_resource_refs(id, spec))
        .unwrap_or_default()
}

fn ship_resources(
    _session: &ProjectSession,
    id: &str,
    data: &Value,
) -> BTreeMap<String, ResourceRef> {
    ship_resource_refs(id, data)
}

fn projectile_resources(
    _session: &ProjectSession,
    id: &str,
    data: &Value,
) -> BTreeMap<String, ResourceRef> {
    projectile_resource_refs(id, data)
}

fn system_resources(
    _session: &ProjectSession,
    id: &str,
    data: &Value,
) -> BTreeMap<String, ResourceRef> {
    system_resource_refs(id, data)
}

fn skill_resources(
    _session: &ProjectSession,
    _id: &str,
    data: &Value,
) -> BTreeMap<String, ResourceRef> {
    data.get("csvRow")
        .and_then(Value::as_object)
        .and_then(|row| csv_table_icon_resource_ref(ResourceSource::Mod, CsvTableKey::Skills, row))
        .map(|resource| BTreeMap::from([("icon".to_string(), resource)]))
        .unwrap_or_default()
}

fn faction_resources(
    _session: &ProjectSession,
    id: &str,
    data: &Value,
) -> BTreeMap<String, ResourceRef> {
    faction_resource_refs(id, data)
}

fn mission_resources(
    _session: &ProjectSession,
    id: &str,
    data: &Value,
) -> BTreeMap<String, ResourceRef> {
    mission_resource_refs(id, data)
}

fn variant_resources(
    session: &ProjectSession,
    _id: &str,
    data: &Value,
) -> BTreeMap<String, ResourceRef> {
    variant_resource_refs(session, ResourceSource::Mod, data)
}

fn skin_resources(
    session: &ProjectSession,
    id: &str,
    _data: &Value,
) -> BTreeMap<String, ResourceRef> {
    session
        .skin_files
        .iter()
        .find(|skin| skin.skin_hull_id == id)
        .map(|skin| skin_entity_resource_refs(session, skin))
        .unwrap_or_default()
}

fn build_skin_entity(
    session: &ProjectSession,
    kind: EntityKind,
    item: &SkinFile,
) -> AppResult<EntityProjection> {
    let data = skin_file_data(item)?;
    Ok(EntityProjection {
        kind,
        id: item.skin_hull_id.clone(),
        resource_refs: skin_entity_resource_refs(session, item),
        data,
    })
}

fn variant_file_data(item: &VariantFile) -> AppResult<Value> {
    Ok(item.data.clone())
}

fn skin_file_data(item: &SkinFile) -> AppResult<Value> {
    Ok(item.data.clone())
}

#[derive(Debug)]
pub(in crate::services::project) struct RegisteredCsvEntityRow {
    id: String,
    data: Map<String, Value>,
}

pub(in crate::services::project) fn registered_mission_rows(
    session: &ProjectSession,
) -> AppResult<Vec<RegisteredCsvEntityRow>> {
    let table = session
        .csv_tables
        .get(MISSION_LIST_TABLE_KEY)
        .ok_or_else(|| {
            AppError::message(
                "table.unknown",
                format!("unknown table: {MISSION_LIST_TABLE_KEY}"),
            )
        })?;
    Ok(registered_entity_rows(
        loaded_csv_rows(table, MISSION_LIST_TABLE_KEY)?,
        "mission",
    ))
}

fn registered_weapon_rows(session: &ProjectSession) -> AppResult<Vec<RegisteredCsvEntityRow>> {
    Ok(registered_entity_rows(
        loaded_registered_csv_rows(session, CsvTableKey::Weapons)?,
        "id",
    ))
}

fn registered_skill_rows(session: &ProjectSession) -> AppResult<Vec<RegisteredCsvEntityRow>> {
    Ok(registered_entity_rows(
        loaded_registered_csv_rows(session, CsvTableKey::Skills)?,
        "id",
    ))
}

fn registered_entity_rows(rows: &[SessionCsvRow], id_column: &str) -> Vec<RegisteredCsvEntityRow> {
    rows.iter()
        .filter(|row| !row.is_comment)
        .filter_map(|row| {
            let id = string_from_row(&row.data, id_column)?;
            Some(RegisteredCsvEntityRow {
                id,
                data: row.data.clone(),
            })
        })
        .collect()
}

fn build_weapon_list_entity(
    session: &ProjectSession,
    kind: EntityKind,
    id: &str,
    row: Map<String, Value>,
) -> AppResult<EntityProjection> {
    let spec = session
        .weapon_specs
        .get(id)
        .map(|record| record.data.clone())
        .unwrap_or_else(|| Value::Object(Map::new()));
    let mut data = Map::new();
    data.insert("spec".to_string(), spec.clone());
    data.insert("csvRow".to_string(), Value::Object(row));
    Ok(EntityProjection {
        kind,
        id: id.to_string(),
        resource_refs: weapon_resource_refs(id, &spec),
        data: Value::Object(data),
    })
}

fn build_weapon_entity_data(session: &mut ProjectSession, id: &str) -> AppResult<Option<Value>> {
    ensure_registered_table_rows(session, CsvTableKey::Weapons)?;
    let Some(csv_row) = registered_weapon_rows(session)?
        .into_iter()
        .find(|row| row.id == id)
        .map(|row| Value::Object(row.data))
    else {
        return Ok(None);
    };
    let spec = session
        .weapon_specs
        .get(id)
        .map(|record| record.data.clone())
        .unwrap_or_else(|| Value::Object(Map::new()));
    let mut data = Map::new();
    data.insert("spec".to_string(), spec);
    data.insert("csvRow".to_string(), csv_row);
    Ok(Some(Value::Object(data)))
}

fn build_skill_list_entity(
    session: &ProjectSession,
    kind: EntityKind,
    id: &str,
    row: Map<String, Value>,
) -> AppResult<EntityProjection> {
    let spec = session
        .skill_files
        .get(id)
        .map(|record| record.data.clone())
        .unwrap_or_else(|| Value::Object(Map::new()));
    let mut data = Map::new();
    data.insert("spec".to_string(), spec);
    data.insert("csvRow".to_string(), Value::Object(row));
    let data = Value::Object(data);
    Ok(EntityProjection {
        kind,
        id: id.to_string(),
        resource_refs: skill_resources(session, id, &data),
        data,
    })
}

fn build_skill_entity_data(session: &mut ProjectSession, id: &str) -> AppResult<Option<Value>> {
    ensure_registered_table_rows(session, CsvTableKey::Skills)?;
    let Some(csv_row) = registered_skill_rows(session)?
        .into_iter()
        .find(|row| row.id == id)
        .map(|row| Value::Object(row.data))
    else {
        return Ok(None);
    };
    let spec = session
        .skill_files
        .get(id)
        .map(|record| record.data.clone())
        .unwrap_or_else(|| Value::Object(Map::new()));
    let mut data = Map::new();
    data.insert("spec".to_string(), spec);
    data.insert("csvRow".to_string(), csv_row);
    Ok(Some(Value::Object(data)))
}

fn build_mission_list_entity(
    session: &ProjectSession,
    kind: EntityKind,
    id: &str,
    row: Map<String, Value>,
) -> AppResult<EntityProjection> {
    let mut data = Map::new();
    data.insert("list".to_string(), Value::Object(row));
    let resource_refs = mission_icon_resource_ref(session, id)?
        .map(|resource| BTreeMap::from([("icon".to_string(), resource)]))
        .unwrap_or_default();
    Ok(EntityProjection {
        kind,
        id: id.to_string(),
        resource_refs,
        data: Value::Object(data),
    })
}

fn build_mission_entity(session: &ProjectSession, id: &str) -> AppResult<Option<Value>> {
    let Some(row) = registered_mission_rows(session)?
        .into_iter()
        .find(|row| row.id == id)
        .map(|row| row.data)
    else {
        return Ok(None);
    };
    let clean = crate::domain::config::validate_config_id(id, "无效战役 ID")?;
    let dir = Path::new(&session.manifest.mod_root)
        .join("data/missions")
        .join(clean);
    let descriptor_path = dir.join("descriptor.json");
    let descriptor = if descriptor_path.exists() {
        read_json_file(&descriptor_path)?
    } else {
        Value::Object(Map::new())
    };
    let text_path = dir.join("mission_text.txt");
    let text = if text_path.exists() {
        crate::io::read_utf8_no_bom(&text_path)?
    } else {
        String::new()
    };
    let mut data = Map::new();
    data.insert("list".to_string(), Value::Object(row));
    data.insert("descriptor".to_string(), descriptor);
    data.insert("text".to_string(), Value::String(text));
    data.insert(
        "relPath".to_string(),
        Value::String(format!("data/missions/{clean}")),
    );
    Ok(Some(Value::Object(data)))
}

fn mission_icon_resource_ref(session: &ProjectSession, id: &str) -> AppResult<Option<ResourceRef>> {
    let clean = crate::domain::config::validate_config_id(id, "无效战役 ID")?;
    let descriptor_path = Path::new(&session.manifest.mod_root)
        .join("data/missions")
        .join(clean)
        .join("descriptor.json");
    if !descriptor_path.exists() {
        return Ok(None);
    }
    let descriptor = read_json_file(&descriptor_path)?;
    let Some(icon) = descriptor.get("icon").and_then(Value::as_str) else {
        return Ok(None);
    };
    Ok(Some(resource_ref(
        ResourceSource::Mod,
        &format!("data/missions/{clean}/{icon}"),
        ResourceOwnerKind::Mission,
        id,
        "icon",
    )))
}

pub(in crate::services::project) enum EntityRefresh {
    Specs {
        kind: EntityKind,
        records: BTreeMap<String, crate::models::LoadedSpecRecord>,
    },
    Variant {
        files: Vec<VariantFile>,
        warnings: Vec<crate::models::GameScanWarning>,
    },
    Skin {
        files: Vec<SkinFile>,
        warnings: Vec<crate::models::GameScanWarning>,
    },
    Faction {
        files: BTreeMap<String, crate::models::LoadedSpecRecord>,
        tags: std::collections::HashMap<String, String>,
    },
    Mission(usize),
}

impl EntityRefresh {
    pub fn update_summary(&self, summary: &mut crate::models::EntitySummaries) {
        match self {
            Self::Specs { kind, records } => match kind {
                EntityKind::Ship => summary.ships = records.len(),
                EntityKind::Weapon => summary.weapons = records.len(),
                EntityKind::Projectile => summary.projectiles = records.len(),
                EntityKind::System => summary.systems = records.len(),
                EntityKind::Skill => summary.skills = records.len(),
                _ => unreachable!("spec refresh kinds have a record map"),
            },
            Self::Variant { files, .. } => summary.variants = files.len(),
            Self::Skin { files, .. } => summary.skins = files.len(),
            Self::Faction { files, .. } => summary.factions = files.len(),
            Self::Mission(count) => summary.missions = *count,
        }
    }
    pub fn apply(self, session: &mut ProjectSession) {
        self.update_summary(&mut session.manifest.entity_summaries);
        match self {
            Self::Specs { kind, records } => match kind {
                EntityKind::Ship => session.ship_files = records,
                EntityKind::Weapon => session.weapon_specs = records,
                EntityKind::Projectile => session.projectile_specs = records,
                EntityKind::System => session.system_files = records,
                EntityKind::Skill => session.skill_files = records,
                _ => unreachable!("spec refresh kinds have a record map"),
            },
            Self::Variant { files, warnings } => {
                session.variant_files = files;
                session.variant_warnings = warnings;
            }
            Self::Skin { files, warnings } => {
                session.skin_files = files;
                session.skin_warnings = warnings;
            }
            Self::Faction { files, tags } => {
                session.faction_files = files;
                session.tag_map = tags;
            }
            Self::Mission(_) => {}
        }
    }
}

fn refresh_spec_records(
    session: &ProjectSession,
    kind: EntityKind,
    directory: &str,
    extension: &str,
    id_field: &str,
) -> AppResult<EntityRefresh> {
    Ok(EntityRefresh::Specs {
        kind,
        records: super::super::cache::load_spec_records(
            Path::new(&session.manifest.mod_root),
            directory,
            extension,
            id_field,
            ResourceSource::Mod,
        )?,
    })
}
fn refresh_ship(session: &ProjectSession) -> AppResult<EntityRefresh> {
    refresh_spec_records(session, EntityKind::Ship, "data/hulls", "ship", "hullId")
}
fn refresh_weapon(session: &ProjectSession) -> AppResult<EntityRefresh> {
    refresh_spec_records(session, EntityKind::Weapon, "data/weapons", "wpn", "id")
}
fn refresh_projectile(session: &ProjectSession) -> AppResult<EntityRefresh> {
    let core = session
        .manifest
        .starsector_root
        .as_deref()
        .map(super::super::cache::load_core_projectile_specs)
        .transpose()?;
    let records = super::projectiles::load_projectile_specs(
        Path::new(&session.manifest.mod_root),
        core.as_deref(),
    )?;
    Ok(EntityRefresh::Specs {
        kind: EntityKind::Projectile,
        records,
    })
}
fn refresh_system(session: &ProjectSession) -> AppResult<EntityRefresh> {
    refresh_spec_records(
        session,
        EntityKind::System,
        "data/shipsystems",
        "system",
        "id",
    )
}
fn refresh_skill(session: &ProjectSession) -> AppResult<EntityRefresh> {
    refresh_spec_records(
        session,
        EntityKind::Skill,
        "data/characters/skills",
        "skill",
        "id",
    )
}
fn refresh_faction(session: &ProjectSession) -> AppResult<EntityRefresh> {
    let root = Path::new(&session.manifest.mod_root);
    let files = factions::load_faction_files(root)?;
    let tags = factions::discover_factions(root)?.1;
    Ok(EntityRefresh::Faction { files, tags })
}
fn refresh_mission(session: &ProjectSession) -> AppResult<EntityRefresh> {
    Ok(EntityRefresh::Mission(root::count_mission_list_entries(
        Path::new(&session.manifest.mod_root),
    )?))
}
fn refresh_variant(session: &ProjectSession) -> AppResult<EntityRefresh> {
    let (files, warnings) = load_variant_files(Path::new(&session.manifest.mod_root))?;
    Ok(EntityRefresh::Variant { files, warnings })
}
fn refresh_skin(session: &ProjectSession) -> AppResult<EntityRefresh> {
    let (files, warnings) = load_skin_files(Path::new(&session.manifest.mod_root))?;
    Ok(EntityRefresh::Skin { files, warnings })
}

pub(in crate::services::project) fn source_option_origin_scopes(
    definition: &ProjectEntityDefinition,
) -> impl Iterator<Item = String> + '_ {
    definition
        .source_options
        .iter()
        .flat_map(|source| [(*source).to_string(), format!("csv:{source}")])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn faction_source_option_scopes_include_fighter_tags() {
        let definition = entity_definition(EntityKind::Faction).unwrap();
        let scopes = source_option_origin_scopes(definition).collect::<Vec<_>>();

        assert!(scopes.contains(&"wings.tags".to_string()));
        assert!(scopes.contains(&"csv:wings.tags".to_string()));
    }
}
