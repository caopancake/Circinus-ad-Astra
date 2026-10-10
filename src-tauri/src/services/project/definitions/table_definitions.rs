use super::super::{
    cache::{load_core_ship_files, load_core_skin_files},
    model::{
        ABILITIES_SPEC, COMMODITIES_SPEC, CoreSourceData, CsvTableSpec, DESCRIPTIONS_SPEC,
        HULLMODS_SPEC, INDUSTRIES_SPEC, MARKET_CONDITIONS_SPEC, ProjectSession, SHIP_SYSTEMS_SPEC,
        SHIPS_SPEC, SIM_OPPONENTS_SPEC, SKILLS_SPEC, SPECIAL_ITEMS_SPEC, SUBMARKETS_SPEC,
        WEAPONS_SPEC, WINGS_SPEC, csv_table_spec, string_field, string_from_row,
        weapon_sprite_path,
    },
    resources::{resource_ref, skin_resource_ref},
};
use crate::{
    errors::AppResult,
    io::read_csv_data,
    models::{CsvTableKey, EntitySummaries, ResourceOwnerKind, ResourceRef, ResourceSource},
};
use serde_json::{Map, Value};
use std::{collections::BTreeMap, path::Path};

type CsvRowResourceExtractor = fn(
    &ProjectSession,
    ResourceSource,
    CsvTableKey,
    &Map<String, Value>,
) -> AppResult<Option<ResourceRef>>;
type CsvSourceResourceExtractor = fn(
    ResourceSource,
    CsvTableKey,
    &str,
    &Map<String, Value>,
    Option<&CoreSourceData>,
    &ProjectSession,
) -> AppResult<Option<ResourceRef>>;
type CsvSourceDisplayNameExtractor = fn(
    ResourceSource,
    CsvTableKey,
    &str,
    &Map<String, Value>,
    Option<&CoreSourceData>,
    &ProjectSession,
) -> AppResult<Option<String>>;

pub(in crate::services::project) struct ProjectCsvTableDefinition {
    pub spec: &'static CsvTableSpec,
    pub resource_owner: Option<ResourceOwnerKind>,
    pub icon_field: Option<&'static str>,
    pub row_resource: CsvRowResourceExtractor,
    pub source_resource: CsvSourceResourceExtractor,
    pub source_display_name: CsvSourceDisplayNameExtractor,
}

pub(in crate::services::project) fn csv_table_definitions() -> &'static [ProjectCsvTableDefinition]
{
    &CSV_TABLE_DEFINITIONS
}

pub(in crate::services::project) fn csv_table_definition(
    table: CsvTableKey,
) -> &'static ProjectCsvTableDefinition {
    match table {
        CsvTableKey::Ships => &SHIPS_TABLE,
        CsvTableKey::Weapons => &WEAPONS_TABLE,
        CsvTableKey::Wings => &WINGS_TABLE,
        CsvTableKey::Hullmods => &HULLMODS_TABLE,
        CsvTableKey::ShipSystems => &SHIP_SYSTEMS_TABLE,
        CsvTableKey::Industries => &INDUSTRIES_TABLE,
        CsvTableKey::Skills => &SKILLS_TABLE,
        CsvTableKey::Abilities => &ABILITIES_TABLE,
        CsvTableKey::Commodities => &COMMODITIES_TABLE,
        CsvTableKey::SpecialItems => &SPECIAL_ITEMS_TABLE,
        CsvTableKey::Submarkets => &SUBMARKETS_TABLE,
        CsvTableKey::MarketConditions => &MARKET_CONDITIONS_TABLE,
        CsvTableKey::SimOpponents => &SIM_OPPONENTS_TABLE,
        CsvTableKey::Descriptions => &DESCRIPTIONS_TABLE,
    }
}

pub(in crate::services::project) fn csv_table_definition_by_key(
    table: &str,
) -> Option<&'static ProjectCsvTableDefinition> {
    csv_table_definitions()
        .iter()
        .find(|definition| definition.spec.key.as_str() == table)
}

pub(in crate::services::project) fn csv_table_entity_id_field(table: CsvTableKey) -> &'static str {
    csv_table_spec(table).entity_id_field
}

pub(in crate::services::project) fn csv_table_entity_summary(
    table: CsvTableKey,
    summaries: &EntitySummaries,
) -> Option<usize> {
    csv_table_spec(table)
        .entity_summary
        .map(|summary| summary(summaries))
}

pub(in crate::services::project) fn build_table_entity_summaries(
    mod_root: &Path,
    entity_summaries: &EntitySummaries,
) -> AppResult<BTreeMap<CsvTableKey, usize>> {
    csv_table_definitions()
        .iter()
        .map(|definition| {
            let count = if let Some(count) =
                csv_table_entity_summary(definition.spec.key, entity_summaries)
            {
                count
            } else {
                count_valid_csv_entities(mod_root, definition.spec.key, definition.spec.rel_path)?
            };
            Ok((definition.spec.key, count))
        })
        .collect()
}

pub(in crate::services::project) fn count_valid_csv_entities(
    mod_root: &Path,
    table: CsvTableKey,
    rel_path: &str,
) -> AppResult<usize> {
    let id_field = csv_table_spec(table).entity_id_field;
    let csv = read_csv_data(&mod_root.join(rel_path))?;
    Ok(csv
        .rows
        .iter()
        .filter(|row| !row.is_comment)
        .filter(|row| string_from_row(&row.data, id_field).is_some())
        .count())
}

pub(in crate::services::project) fn csv_table_row_resource_ref(
    session: &ProjectSession,
    table: CsvTableKey,
    row: &Map<String, Value>,
) -> Option<ResourceRef> {
    (csv_table_definition(table).row_resource)(session, ResourceSource::Mod, table, row)
        .ok()
        .flatten()
}

pub(in crate::services::project) fn csv_table_source_resource_ref(
    source: ResourceSource,
    table: CsvTableKey,
    value: &str,
    row: &Map<String, Value>,
    core_data: Option<&CoreSourceData>,
    session: &ProjectSession,
) -> AppResult<Option<ResourceRef>> {
    (csv_table_definition(table).source_resource)(source, table, value, row, core_data, session)
}

pub(in crate::services::project) fn csv_table_source_display_name(
    source: ResourceSource,
    table: CsvTableKey,
    value: &str,
    row: &Map<String, Value>,
    core_data: Option<&CoreSourceData>,
    session: &ProjectSession,
) -> AppResult<Option<String>> {
    (csv_table_definition(table).source_display_name)(source, table, value, row, core_data, session)
}

pub(in crate::services::project) fn csv_table_icon_resource_ref(
    source: ResourceSource,
    table: CsvTableKey,
    row: &Map<String, Value>,
) -> Option<ResourceRef> {
    let definition = csv_table_definition(table);
    let owner = definition.resource_owner?;
    let id = string_from_row(row, definition.spec.entity_id_field)?;
    let rel_path = string_from_row(row, definition.icon_field?)?;
    Some(resource_ref(source, &rel_path, owner, &id, "icon"))
}

const SHIPS_TABLE: ProjectCsvTableDefinition = ProjectCsvTableDefinition {
    spec: &SHIPS_SPEC,
    resource_owner: Some(ResourceOwnerKind::Ship),
    icon_field: None,
    row_resource: ship_row_resource,
    source_resource: ship_source_resource,
    source_display_name: ship_source_display_name,
};

const WEAPONS_TABLE: ProjectCsvTableDefinition = ProjectCsvTableDefinition {
    spec: &WEAPONS_SPEC,
    resource_owner: Some(ResourceOwnerKind::Weapon),
    icon_field: None,
    row_resource: weapon_row_resource,
    source_resource: weapon_source_resource,
    source_display_name: no_source_display_name,
};

const WINGS_TABLE: ProjectCsvTableDefinition = ProjectCsvTableDefinition {
    spec: &WINGS_SPEC,
    resource_owner: Some(ResourceOwnerKind::Variant),
    icon_field: None,
    row_resource: wing_row_resource,
    source_resource: wing_source_resource,
    source_display_name: wing_source_display_name,
};

const HULLMODS_TABLE: ProjectCsvTableDefinition = ProjectCsvTableDefinition {
    spec: &HULLMODS_SPEC,
    resource_owner: Some(ResourceOwnerKind::Hullmods),
    icon_field: Some("sprite"),
    row_resource: icon_row_resource,
    source_resource: icon_source_resource,
    source_display_name: no_source_display_name,
};

const SHIP_SYSTEMS_TABLE: ProjectCsvTableDefinition = ProjectCsvTableDefinition {
    spec: &SHIP_SYSTEMS_SPEC,
    resource_owner: Some(ResourceOwnerKind::ShipSystems),
    icon_field: Some("icon"),
    row_resource: icon_row_resource,
    source_resource: icon_source_resource,
    source_display_name: no_source_display_name,
};

const INDUSTRIES_TABLE: ProjectCsvTableDefinition = ProjectCsvTableDefinition {
    spec: &INDUSTRIES_SPEC,
    resource_owner: Some(ResourceOwnerKind::Industries),
    icon_field: Some("image"),
    row_resource: icon_row_resource,
    source_resource: icon_source_resource,
    source_display_name: no_source_display_name,
};

const SKILLS_TABLE: ProjectCsvTableDefinition = ProjectCsvTableDefinition {
    spec: &SKILLS_SPEC,
    resource_owner: Some(ResourceOwnerKind::Skills),
    icon_field: Some("icon"),
    row_resource: icon_row_resource,
    source_resource: icon_source_resource,
    source_display_name: no_source_display_name,
};

const ABILITIES_TABLE: ProjectCsvTableDefinition = ProjectCsvTableDefinition {
    spec: &ABILITIES_SPEC,
    resource_owner: Some(ResourceOwnerKind::Abilities),
    icon_field: Some("icon"),
    row_resource: icon_row_resource,
    source_resource: icon_source_resource,
    source_display_name: no_source_display_name,
};

const COMMODITIES_TABLE: ProjectCsvTableDefinition = ProjectCsvTableDefinition {
    spec: &COMMODITIES_SPEC,
    resource_owner: Some(ResourceOwnerKind::Commodities),
    icon_field: Some("icon"),
    row_resource: icon_row_resource,
    source_resource: icon_source_resource,
    source_display_name: no_source_display_name,
};

const SPECIAL_ITEMS_TABLE: ProjectCsvTableDefinition = ProjectCsvTableDefinition {
    spec: &SPECIAL_ITEMS_SPEC,
    resource_owner: Some(ResourceOwnerKind::SpecialItems),
    icon_field: Some("icon"),
    row_resource: icon_row_resource,
    source_resource: icon_source_resource,
    source_display_name: no_source_display_name,
};

const SUBMARKETS_TABLE: ProjectCsvTableDefinition = ProjectCsvTableDefinition {
    spec: &SUBMARKETS_SPEC,
    resource_owner: Some(ResourceOwnerKind::Submarkets),
    icon_field: Some("icon"),
    row_resource: icon_row_resource,
    source_resource: icon_source_resource,
    source_display_name: no_source_display_name,
};

const MARKET_CONDITIONS_TABLE: ProjectCsvTableDefinition = ProjectCsvTableDefinition {
    spec: &MARKET_CONDITIONS_SPEC,
    resource_owner: Some(ResourceOwnerKind::MarketConditions),
    icon_field: Some("icon"),
    row_resource: icon_row_resource,
    source_resource: icon_source_resource,
    source_display_name: no_source_display_name,
};

const SIM_OPPONENTS_TABLE: ProjectCsvTableDefinition = ProjectCsvTableDefinition {
    spec: &SIM_OPPONENTS_SPEC,
    resource_owner: None,
    icon_field: None,
    row_resource: no_row_resource,
    source_resource: no_source_resource,
    source_display_name: no_source_display_name,
};

const DESCRIPTIONS_TABLE: ProjectCsvTableDefinition = ProjectCsvTableDefinition {
    spec: &DESCRIPTIONS_SPEC,
    resource_owner: None,
    icon_field: None,
    row_resource: no_row_resource,
    source_resource: no_source_resource,
    source_display_name: no_source_display_name,
};

const CSV_TABLE_DEFINITIONS: [ProjectCsvTableDefinition; 14] = [
    SHIPS_TABLE,
    WEAPONS_TABLE,
    WINGS_TABLE,
    HULLMODS_TABLE,
    SHIP_SYSTEMS_TABLE,
    INDUSTRIES_TABLE,
    SKILLS_TABLE,
    ABILITIES_TABLE,
    COMMODITIES_TABLE,
    SPECIAL_ITEMS_TABLE,
    SUBMARKETS_TABLE,
    MARKET_CONDITIONS_TABLE,
    SIM_OPPONENTS_TABLE,
    DESCRIPTIONS_TABLE,
];

fn ship_row_resource(
    session: &ProjectSession,
    source: ResourceSource,
    _table: CsvTableKey,
    row: &Map<String, Value>,
) -> AppResult<Option<ResourceRef>> {
    let Some(id) = string_from_row(row, "id") else {
        return Ok(None);
    };
    hull_resource_ref(session, source, &id)
}

fn weapon_row_resource(
    session: &ProjectSession,
    source: ResourceSource,
    _table: CsvTableKey,
    row: &Map<String, Value>,
) -> AppResult<Option<ResourceRef>> {
    let Some(id) = string_from_row(row, "id") else {
        return Ok(None);
    };
    Ok(session
        .weapon_specs
        .get(&id)
        .and_then(|record| weapon_sprite_path(&record.data))
        .map(|path| resource_ref(source, &path, ResourceOwnerKind::Weapon, &id, "sprite")))
}

fn wing_row_resource(
    session: &ProjectSession,
    source: ResourceSource,
    _table: CsvTableKey,
    row: &Map<String, Value>,
) -> AppResult<Option<ResourceRef>> {
    let Some(variant_id) = string_from_row(row, "variant") else {
        return Ok(None);
    };
    let Some(variant) = session
        .variant_files
        .iter()
        .find(|variant| variant.variant_id == variant_id)
    else {
        return Ok(None);
    };
    hull_resource_ref(session, source, &variant.hull_id)
}

fn icon_row_resource(
    _session: &ProjectSession,
    source: ResourceSource,
    table: CsvTableKey,
    row: &Map<String, Value>,
) -> AppResult<Option<ResourceRef>> {
    Ok(csv_table_icon_resource_ref(source, table, row))
}

fn no_row_resource(
    _session: &ProjectSession,
    _source: ResourceSource,
    _table: CsvTableKey,
    _row: &Map<String, Value>,
) -> AppResult<Option<ResourceRef>> {
    Ok(None)
}

fn ship_source_resource(
    source: ResourceSource,
    _table: CsvTableKey,
    value: &str,
    _row: &Map<String, Value>,
    core_data: Option<&CoreSourceData>,
    session: &ProjectSession,
) -> AppResult<Option<ResourceRef>> {
    if let Some(resource) = hull_resource_ref(session, source, value)? {
        return Ok(Some(resource));
    }
    Ok(core_data
        .and_then(|core_data| {
            core_data
                .ship_files
                .get(value)
                .and_then(|ship| string_field(&ship.data, "spriteName"))
        })
        .map(|path| resource_ref(source, &path, ResourceOwnerKind::Ship, value, "sprite")))
}

fn ship_source_display_name(
    source: ResourceSource,
    _table: CsvTableKey,
    value: &str,
    row: &Map<String, Value>,
    core_data: Option<&CoreSourceData>,
    session: &ProjectSession,
) -> AppResult<Option<String>> {
    if let Some(name) = string_from_row(row, "name") {
        return Ok(Some(name));
    }
    let ship = match source {
        ResourceSource::Core => core_data.and_then(|data| data.ship_files.get(value)),
        ResourceSource::Mod => session.ship_files.get(value),
    };
    Ok(ship.and_then(|ship| string_field(&ship.data, "hullName")))
}

fn weapon_source_resource(
    source: ResourceSource,
    _table: CsvTableKey,
    value: &str,
    _row: &Map<String, Value>,
    core_data: Option<&CoreSourceData>,
    session: &ProjectSession,
) -> AppResult<Option<ResourceRef>> {
    let sprite_path = match source {
        ResourceSource::Core => core_data.and_then(|core_data| {
            core_data
                .weapon_specs
                .get(value)
                .and_then(|record| weapon_sprite_path(&record.data))
        }),
        ResourceSource::Mod => session
            .weapon_specs
            .get(value)
            .and_then(|record| weapon_sprite_path(&record.data)),
    };
    Ok(sprite_path
        .map(|path| resource_ref(source, &path, ResourceOwnerKind::Weapon, value, "sprite")))
}

fn wing_source_resource(
    source: ResourceSource,
    _table: CsvTableKey,
    _value: &str,
    row: &Map<String, Value>,
    core_data: Option<&CoreSourceData>,
    session: &ProjectSession,
) -> AppResult<Option<ResourceRef>> {
    let Some(variant_id) = string_from_row(row, "variant") else {
        return Ok(None);
    };
    let hull_id = match source {
        ResourceSource::Core => core_data.and_then(|core_data| {
            core_data
                .variant_files
                .iter()
                .find(|variant| variant.variant_id == variant_id)
                .map(|variant| variant.hull_id.as_str())
        }),
        ResourceSource::Mod => session
            .variant_files
            .iter()
            .find(|variant| variant.variant_id == variant_id)
            .map(|variant| variant.hull_id.as_str()),
    };
    match hull_id {
        Some(hull_id) => hull_resource_ref(session, source, hull_id),
        None => Ok(None),
    }
}

fn wing_source_display_name(
    source: ResourceSource,
    _table: CsvTableKey,
    _value: &str,
    row: &Map<String, Value>,
    core_data: Option<&CoreSourceData>,
    session: &ProjectSession,
) -> AppResult<Option<String>> {
    let Some(variant_id) = string_from_row(row, "variant") else {
        return Ok(None);
    };
    let variant = match source {
        ResourceSource::Core => core_data.and_then(|data| {
            data.variant_files
                .iter()
                .find(|variant| variant.variant_id == variant_id)
        }),
        ResourceSource::Mod => session
            .variant_files
            .iter()
            .find(|variant| variant.variant_id == variant_id),
    };
    Ok(variant.and_then(|variant| string_field(&variant.data, "displayName")))
}

fn icon_source_resource(
    source: ResourceSource,
    table: CsvTableKey,
    _value: &str,
    row: &Map<String, Value>,
    _core_data: Option<&CoreSourceData>,
    _session: &ProjectSession,
) -> AppResult<Option<ResourceRef>> {
    Ok(csv_table_icon_resource_ref(source, table, row))
}

fn no_source_resource(
    _source: ResourceSource,
    _table: CsvTableKey,
    _value: &str,
    _row: &Map<String, Value>,
    _core_data: Option<&CoreSourceData>,
    _session: &ProjectSession,
) -> AppResult<Option<ResourceRef>> {
    Ok(None)
}

fn no_source_display_name(
    _source: ResourceSource,
    _table: CsvTableKey,
    _value: &str,
    _row: &Map<String, Value>,
    _core_data: Option<&CoreSourceData>,
    _session: &ProjectSession,
) -> AppResult<Option<String>> {
    Ok(None)
}

pub(in crate::services::project) fn hull_resource_ref(
    session: &ProjectSession,
    source: ResourceSource,
    hull_id: &str,
) -> AppResult<Option<ResourceRef>> {
    if source == ResourceSource::Core {
        let root = session.manifest.starsector_root.as_ref().ok_or_else(|| {
            crate::errors::AppError::message(
                "resource.core_root_required",
                "core resource reference requires starsector root",
            )
        })?;
        let ships = load_core_ship_files(root)?;
        if let Some(ship) = ships.get(hull_id) {
            return Ok(string_field(&ship.data, "spriteName").map(|path| {
                resource_ref(
                    ResourceSource::Core,
                    &path,
                    ResourceOwnerKind::Ship,
                    hull_id,
                    "sprite",
                )
            }));
        }
        let skins = load_core_skin_files(root)?;
        Ok(skins
            .iter()
            .find(|skin| skin.skin_hull_id == hull_id)
            .and_then(|skin| skin_resource_ref(source, &ships, skin)))
    } else {
        Ok(mod_hull_resource_ref(session, hull_id))
    }
}

fn mod_hull_resource_ref(session: &ProjectSession, hull_id: &str) -> Option<ResourceRef> {
    if let Some(ship) = session.ship_files.get(hull_id) {
        string_field(&ship.data, "spriteName").map(|path| {
            resource_ref(
                ResourceSource::Mod,
                &path,
                ResourceOwnerKind::Ship,
                hull_id,
                "sprite",
            )
        })
    } else {
        session
            .skin_files
            .iter()
            .find(|skin| skin.skin_hull_id == hull_id)
            .and_then(|skin| skin_resource_ref(ResourceSource::Mod, &session.ship_files, skin))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::CsvTableKey;

    #[test]
    fn definition_lookup_resolves_every_table_key() {
        for key in [
            CsvTableKey::Ships,
            CsvTableKey::Weapons,
            CsvTableKey::Wings,
            CsvTableKey::Hullmods,
            CsvTableKey::ShipSystems,
            CsvTableKey::Industries,
            CsvTableKey::Skills,
            CsvTableKey::Abilities,
            CsvTableKey::Commodities,
            CsvTableKey::SpecialItems,
            CsvTableKey::Submarkets,
            CsvTableKey::MarketConditions,
            CsvTableKey::SimOpponents,
            CsvTableKey::Descriptions,
        ] {
            let definition = csv_table_definition(key);
            assert_eq!(definition.spec.key, key);
            assert!(csv_table_definition_by_key(definition.spec.key.as_str()).is_some());
        }
    }

    #[test]
    fn unknown_table_keys_do_not_resolve() {
        assert!(csv_table_definition_by_key("not-a-table").is_none());
    }

    #[test]
    fn entity_id_fields_follow_the_table_convention() {
        assert_eq!(csv_table_entity_id_field(CsvTableKey::Ships), "id");
        assert_eq!(csv_table_entity_id_field(CsvTableKey::Weapons), "id");
    }
}
