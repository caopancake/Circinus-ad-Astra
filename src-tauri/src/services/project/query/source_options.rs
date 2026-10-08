use super::super::{
    cache::{
        ensure_registered_table_rows, load_core_csv_table, load_core_source_data, loaded_csv_rows,
        loaded_registered_csv_rows, lock_session, session_handle,
    },
    definitions::{
        entity_definitions::entity_definitions,
        table_definitions::{csv_table_source_display_name, csv_table_source_resource_ref},
    },
    model::{CoreSourceData, ProjectSession, SessionCsvRow, is_comment_row, string_from_row},
};
use crate::{
    domain::well_known_labels::{
        WellKnownLabelEntry, well_known_hint_labels, well_known_tag_labels,
    },
    errors::{AppError, AppResult},
    models::{CsvTableKey, EntityData, ResourceSource, SourceOptionGroup},
};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap};

struct SourceOptionRowsContext<'a> {
    core_data: Option<&'a CoreSourceData>,
    resource_context: SourceOptionResourceContext<'a>,
    seen: &'a mut BTreeSet<String>,
}

#[derive(Clone, Copy)]
struct SourceOptionResourceContext<'a> {
    metadata_catalog: Option<&'a SourceTokenMetadataCatalog>,
    session: &'a ProjectSession,
    table: CsvTableKey,
}

pub fn query_csv_source_options(
    session_id: &str,
    source: &str,
) -> AppResult<Vec<SourceOptionGroup>> {
    let handle = session_handle(session_id)?;
    let mut session = lock_session(&handle)?;
    if let Some(groups) = entity_source_option_groups(&mut session, source)? {
        return Ok(groups);
    }
    let (table, column) = parse_csv_source(source)?;
    let table_key = table.as_str();
    ensure_registered_table_rows(&mut session, table)?;
    {
        let csv = session.csv_tables.get(table_key).ok_or_else(|| {
            AppError::message("table.unknown", format!("unknown table: {table_key}"))
        })?;
        ensure_source_column(&csv.header, table_key, column)?;
    }
    let metadata_catalog = source_token_metadata_catalog(column, &mut session)?;
    let csv = session
        .csv_tables
        .get(table_key)
        .ok_or_else(|| AppError::message("table.unknown", format!("unknown table: {table_key}")))?;
    let rows = loaded_csv_rows(csv, table_key)?;
    let starsector_root = session.manifest.starsector_root.clone();
    let core_csv = if let Some(root) = starsector_root.as_ref() {
        load_core_csv_table(root, table)?
    } else {
        None
    };
    let core_rows = core_csv
        .as_ref()
        .map(|csv| {
            ensure_source_column(&csv.header, table_key, column)?;
            loaded_csv_rows(csv, table_key)
        })
        .transpose()?;
    let core_data = if core_rows.is_some() {
        let root = starsector_root.as_ref().ok_or_else(|| {
            AppError::message(
                "resource.core_root_required",
                "core CSV requires a Starsector root",
            )
        })?;
        Some(load_core_source_data(root, table)?)
    } else {
        None
    };
    let resource_context = SourceOptionResourceContext {
        metadata_catalog: metadata_catalog.as_ref(),
        session: &session,
        table,
    };
    let mut seen = BTreeSet::new();
    let mut groups = Vec::new();
    let options = source_options_from_rows(
        ResourceSource::Mod,
        rows,
        column,
        SourceOptionRowsContext {
            core_data: None,
            resource_context,
            seen: &mut seen,
        },
    )?;
    if !options.is_empty() {
        groups.push(SourceOptionGroup {
            origin: ResourceSource::Mod,
            options,
        });
    }
    if let (Some(core_rows), Some(core_data)) = (core_rows, core_data.as_ref()) {
        let options = source_options_from_rows(
            ResourceSource::Core,
            core_rows,
            column,
            SourceOptionRowsContext {
                core_data: Some(core_data),
                resource_context,
                seen: &mut seen,
            },
        )?;
        if !options.is_empty() {
            groups.push(SourceOptionGroup {
                origin: ResourceSource::Core,
                options,
            });
        }
    }
    Ok(groups)
}

/// Sources declared by an entity (its `source_options`) resolve to the entity
/// list as the value domain — e.g. `variants.variantId` enumerates variant
/// entities, Mod first then core-only entries, mirroring the CSV column flow.
/// Registered CSV tables keep the column path; the entity path only serves
/// domains no CSV table provides.
fn entity_source_option_groups(
    session: &mut ProjectSession,
    source: &str,
) -> AppResult<Option<Vec<SourceOptionGroup>>> {
    let key = source.strip_prefix("csv:").unwrap_or(source);
    if key
        .split_once('.')
        .and_then(|(table, _)| CsvTableKey::from_key(table))
        .is_some()
    {
        return Ok(None);
    }
    let Some(definition) = entity_definitions()
        .iter()
        .find(|definition| definition.source_options.contains(&key))
    else {
        return Ok(None);
    };
    (definition.prepare)(session)?;
    let mut seen = BTreeSet::new();
    let mut groups = Vec::new();
    let options =
        entity_source_options(ResourceSource::Mod, (definition.list)(session)?, &mut seen);
    if !options.is_empty() {
        groups.push(SourceOptionGroup {
            origin: ResourceSource::Mod,
            options,
        });
    }
    if let Some(core_list) = definition.core_list {
        let options = entity_source_options(ResourceSource::Core, core_list(session)?, &mut seen);
        if !options.is_empty() {
            groups.push(SourceOptionGroup {
                origin: ResourceSource::Core,
                options,
            });
        }
    }
    Ok(Some(groups))
}

fn entity_source_options(
    origin: ResourceSource,
    entities: Vec<EntityData>,
    seen: &mut BTreeSet<String>,
) -> Vec<crate::models::SourceOption> {
    let mut options = Vec::new();
    for entity in entities {
        if !seen.insert(entity.id.clone()) {
            continue;
        }
        options.push(crate::models::SourceOption {
            label: entity_source_option_label(&entity),
            value: entity.id.clone(),
            description: None,
            resource_ref: entity.resource_refs.values().next().cloned(),
            origin,
        });
    }
    options
}

fn entity_source_option_label(entity: &EntityData) -> String {
    let display_name = entity
        .data
        .get("data")
        .and_then(|data| data.get("displayName"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    if display_name.trim().is_empty() || display_name == entity.id {
        entity.id.clone()
    } else {
        format!("{display_name} ({})", entity.id)
    }
}

fn parse_csv_source(source: &str) -> AppResult<(CsvTableKey, &str)> {
    let trimmed = source.strip_prefix("csv:").unwrap_or(source);
    let (table, column) = trimmed.split_once('.').ok_or_else(|| {
        AppError::message("source.invalid", format!("invalid csv source: {source}"))
    })?;
    let table = CsvTableKey::from_key(table).ok_or_else(|| {
        AppError::message(
            "source.table_unknown",
            format!("unknown csv source table: {table}"),
        )
    })?;
    Ok((table, column))
}

fn ensure_source_column(header: &[String], table: &str, column: &str) -> AppResult<()> {
    if header.iter().any(|field| field == column) {
        return Ok(());
    }
    Err(AppError::message(
        "source.column_unknown",
        format!("csv source column does not exist: {table}.{column}"),
    ))
}

fn source_options_from_rows(
    resource_source: ResourceSource,
    rows: &[SessionCsvRow],
    column: &str,
    context: SourceOptionRowsContext<'_>,
) -> AppResult<Vec<crate::models::SourceOption>> {
    let is_id_column = column == "id";
    let mut options = Vec::new();
    for row in rows.iter().filter(|row| !is_comment_row(&row.data)) {
        let Some(cell_value) = row.data.get(column).and_then(serde_json::Value::as_str) else {
            continue;
        };
        if cell_value.trim().is_empty() {
            continue;
        }
        let values: Vec<&str> = if is_id_column {
            vec![cell_value]
        } else {
            cell_value
                .split(',')
                .map(|v| v.trim())
                .filter(|v| !v.is_empty())
                .collect()
        };
        for value in values {
            if !context.seen.insert(value.to_string()) {
                continue;
            }
            options.push(source_option_from_row(
                resource_source,
                row,
                column,
                value,
                context.core_data,
                context.resource_context,
            )?);
        }
    }
    Ok(options)
}

fn source_option_from_row(
    resource_source: ResourceSource,
    row: &SessionCsvRow,
    column: &str,
    value: &str,
    core_data: Option<&CoreSourceData>,
    context: SourceOptionResourceContext<'_>,
) -> AppResult<crate::models::SourceOption> {
    let resource_ref = if column == "id" {
        csv_table_source_resource_ref(
            resource_source,
            context.table,
            value,
            &row.data,
            core_data,
            context.session,
        )?
    } else {
        None
    };
    Ok(crate::models::SourceOption {
        label: source_option_label_for_row(
            resource_source,
            row,
            column,
            value,
            core_data,
            context,
        )?,
        value: value.to_string(),
        description: source_option_description(value, context.metadata_catalog),
        resource_ref,
        origin: resource_source,
    })
}

fn source_option_label_for_row(
    resource_source: ResourceSource,
    row: &SessionCsvRow,
    column: &str,
    value: &str,
    core_data: Option<&CoreSourceData>,
    context: SourceOptionResourceContext<'_>,
) -> AppResult<String> {
    if column == "id" {
        if let Some(display_name) = csv_table_source_display_name(
            resource_source,
            context.table,
            value,
            &row.data,
            core_data,
            context.session,
        )? && display_name != value
        {
            return Ok(format!("{display_name} ({value})"));
        }
        let name = row
            .data
            .get("name")
            .or_else(|| row.data.get("displayName"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        if name.trim().is_empty() || name == value {
            Ok(value.to_string())
        } else {
            Ok(format!("{name} ({value})"))
        }
    } else {
        Ok(source_option_label_for_value(
            column,
            value,
            context.metadata_catalog,
        ))
    }
}

fn source_option_description(
    value: &str,
    metadata_catalog: Option<&SourceTokenMetadataCatalog>,
) -> Option<String> {
    metadata_catalog
        .and_then(|metadata_catalog| metadata_catalog.find(value))
        .and_then(|metadata| metadata.description)
}

fn source_option_label_for_value(
    column: &str,
    value: &str,
    metadata_catalog: Option<&SourceTokenMetadataCatalog>,
) -> String {
    if column == "id" {
        return value.to_string();
    }
    if let Some(metadata) =
        metadata_catalog.and_then(|metadata_catalog| metadata_catalog.find(value))
    {
        format!("{value} ({})", metadata.label)
    } else {
        value.to_string()
    }
}

fn source_token_metadata_catalog(
    column: &str,
    session: &mut super::super::model::ProjectSession,
) -> AppResult<Option<SourceTokenMetadataCatalog>> {
    match column {
        "tags" => Ok(Some(build_tag_metadata_catalog(session)?)),
        "hints" => Ok(Some(build_hint_metadata_catalog())),
        _ => Ok(None),
    }
}

#[derive(Clone)]
struct SourceTokenMetadata {
    label: String,
    description: Option<String>,
}

struct SourceTokenMetadataCatalog {
    values: HashMap<String, SourceTokenMetadata>,
    generated: Option<fn(&str) -> Option<SourceTokenMetadata>>,
}

impl SourceTokenMetadataCatalog {
    fn find(&self, value: &str) -> Option<SourceTokenMetadata> {
        self.values
            .get(value)
            .cloned()
            .or_else(|| self.generated.and_then(|generated| generated(value)))
    }
}

fn build_tag_metadata_catalog(
    session: &mut super::super::model::ProjectSession,
) -> AppResult<SourceTokenMetadataCatalog> {
    let mut metadata = well_known_metadata_map(well_known_tag_labels());
    add_core_blueprint_package_metadata(&mut metadata, session)?;
    add_mod_blueprint_package_metadata(&mut metadata, session)?;
    add_faction_blueprint_metadata(&mut metadata, session);
    Ok(SourceTokenMetadataCatalog {
        values: metadata,
        generated: Some(generated_tag_metadata),
    })
}

fn build_hint_metadata_catalog() -> SourceTokenMetadataCatalog {
    SourceTokenMetadataCatalog {
        values: well_known_metadata_map(well_known_hint_labels()),
        generated: None,
    }
}

fn add_core_blueprint_package_metadata(
    metadata: &mut HashMap<String, SourceTokenMetadata>,
    session: &super::super::model::ProjectSession,
) -> AppResult<()> {
    let Some(root) = session.manifest.starsector_root.as_ref() else {
        return Ok(());
    };
    let Some(table) = load_core_csv_table(root, CsvTableKey::SpecialItems)? else {
        return Ok(());
    };
    let Some(rows) = table.rows.as_ref() else {
        return Ok(());
    };
    for row in rows {
        add_blueprint_package_metadata(metadata, &row.data);
    }
    Ok(())
}

fn add_mod_blueprint_package_metadata(
    metadata: &mut HashMap<String, SourceTokenMetadata>,
    session: &mut super::super::model::ProjectSession,
) -> AppResult<()> {
    ensure_registered_table_rows(session, CsvTableKey::SpecialItems)?;
    for row in loaded_registered_csv_rows(session, CsvTableKey::SpecialItems)? {
        add_blueprint_package_metadata(metadata, &row.data);
    }
    Ok(())
}

fn add_blueprint_package_metadata(
    metadata: &mut HashMap<String, SourceTokenMetadata>,
    row: &Map<String, Value>,
) {
    if !row_has_tag(row, "package_bp") {
        return;
    }
    let Some(tag) = string_from_row(row, "plugin params") else {
        return;
    };
    let Some(name) = string_from_row(row, "name") else {
        return;
    };
    metadata.insert(
        tag,
        SourceTokenMetadata {
            label: name,
            description: string_from_row(row, "desc"),
        },
    );
}

fn row_has_tag(row: &Map<String, Value>, expected: &str) -> bool {
    row.get("tags")
        .and_then(Value::as_str)
        .is_some_and(|tags| tags.split(',').map(str::trim).any(|tag| tag == expected))
}

fn add_faction_blueprint_metadata(
    metadata: &mut HashMap<String, SourceTokenMetadata>,
    session: &super::super::model::ProjectSession,
) {
    for (tag, faction_id) in &session.tag_map {
        if metadata.contains_key(tag) {
            continue;
        }
        let faction_name = session
            .faction_files
            .get(faction_id)
            .and_then(|v| v.get("displayName"))
            .or_else(|| {
                session
                    .faction_files
                    .get(faction_id)
                    .and_then(|v| v.get("displayNameLong"))
            })
            .and_then(serde_json::Value::as_str)
            .unwrap_or(faction_id);
        metadata.insert(
            tag.clone(),
            SourceTokenMetadata {
                label: format!("{faction_name}蓝图"),
                description: Some(format!("由势力 {faction_name} 推导的蓝图标签。")),
            },
        );
    }
}

fn well_known_metadata_map(
    labels: &BTreeMap<String, WellKnownLabelEntry>,
) -> HashMap<String, SourceTokenMetadata> {
    labels
        .iter()
        .map(|(value, entry)| {
            (
                value.clone(),
                SourceTokenMetadata {
                    label: entry.label.clone(),
                    description: Some(entry.description.clone()),
                },
            )
        })
        .collect()
}

fn generated_tag_metadata(value: &str) -> Option<SourceTokenMetadata> {
    let (prefix, index) = split_numeric_suffix(value)?;
    let (label, description) = GENERATED_TAG_PATTERNS.iter().find_map(|pattern| {
        (pattern.prefix == prefix).then_some((pattern.label, pattern.description))
    })?;
    Some(SourceTokenMetadata {
        label: format!("{label} {index}"),
        description: Some(description.to_string()),
    })
}

fn split_numeric_suffix(value: &str) -> Option<(&str, u32)> {
    let split_at = value
        .char_indices()
        .rev()
        .find_map(|(index, ch)| (!ch.is_ascii_digit()).then_some(index + ch.len_utf8()))?;
    if split_at == value.len() || split_at == 0 {
        return None;
    }
    let number = value[split_at..].parse::<u32>().ok()?;
    Some((&value[..split_at], number))
}

struct GeneratedTagPattern {
    prefix: &'static str,
    label: &'static str,
    description: &'static str,
}

static GENERATED_TAG_PATTERNS: &[GeneratedTagPattern] = &[
    GeneratedTagPattern {
        prefix: "kinetic",
        label: "动能武器强度",
        description: "仅适用于武器。动能武器强度排序标签。",
    },
    GeneratedTagPattern {
        prefix: "he",
        label: "高爆武器强度",
        description: "仅适用于武器。高爆武器强度排序标签。",
    },
    GeneratedTagPattern {
        prefix: "energy",
        label: "能量武器强度",
        description: "仅适用于武器。能量武器强度排序标签。",
    },
    GeneratedTagPattern {
        prefix: "missile",
        label: "导弹武器强度",
        description: "仅适用于武器。导弹武器强度排序标签。",
    },
    GeneratedTagPattern {
        prefix: "beam",
        label: "光束武器强度",
        description: "仅适用于武器。光束武器强度排序标签。",
    },
    GeneratedTagPattern {
        prefix: "pd",
        label: "点防御武器强度",
        description: "仅适用于武器。点防御武器强度排序标签。",
    },
    GeneratedTagPattern {
        prefix: "strike",
        label: "打击武器强度",
        description: "仅适用于武器。打击武器强度排序标签。",
    },
    GeneratedTagPattern {
        prefix: "rocket",
        label: "火箭武器强度",
        description: "仅适用于武器。火箭武器强度排序标签。",
    },
    GeneratedTagPattern {
        prefix: "utility",
        label: "功能武器强度",
        description: "仅适用于武器。功能武器强度排序标签。",
    },
    GeneratedTagPattern {
        prefix: "fighter",
        label: "战斗机强度",
        description: "仅适用于战机联队。战斗机强度排序标签。",
    },
    GeneratedTagPattern {
        prefix: "interceptor",
        label: "截击机强度",
        description: "仅适用于战机联队。截击机强度排序标签。",
    },
    GeneratedTagPattern {
        prefix: "bomber",
        label: "轰炸机强度",
        description: "仅适用于战机联队。轰炸机强度排序标签。",
    },
    GeneratedTagPattern {
        prefix: "support",
        label: "支援机强度",
        description: "仅适用于战机联队。支援机强度排序标签。",
    },
    GeneratedTagPattern {
        prefix: "substrate_",
        label: "渊幕底物武器强度",
        description: "仅适用于武器。渊幕底物武器强度排序标签。",
    },
];

#[cfg(test)]
mod tests {
    use super::super::super::session::{close_project_session, open_project_session_traced};
    use super::*;
    use crate::io::write_utf8_no_bom;

    use crate::testutil::temp_dir;

    #[test]
    fn source_options_return_resource_refs_without_data_urls() {
        let root = temp_dir("source_resource_refs");
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/ship_data.csv"),
            "id,name\r\nship_a,Ship A\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/ship_a.ship"),
            r#"{"hullId":"ship_a","hullName":"Spec Ship A","spriteName":"graphics/ships/ship_a.png"}"#,
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let groups = query_csv_source_options(&manifest.session_id, "csv:ships.id").unwrap();

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(root);
        let option = groups
            .iter()
            .flat_map(|group| group.options.iter())
            .find(|option| option.value == "ship_a")
            .unwrap();
        assert_eq!(
            option
                .resource_ref
                .as_ref()
                .map(|resource| resource.rel_path.as_str()),
            Some("graphics/ships/ship_a.png")
        );
    }

    #[test]
    fn source_options_return_complete_stable_mod_then_core_catalog() {
        let root = temp_dir("source_complete_catalog");
        let mod_root = root.join("mods/demo");
        std::fs::create_dir_all(mod_root.join("data/campaign")).unwrap();
        std::fs::create_dir_all(root.join("starsector-core/data/campaign")).unwrap();

        let mut mod_csv = String::from("id,name\r\n");
        for index in 0..501 {
            mod_csv.push_str(&format!("mod_{index:03},Mod {index:03}\r\n"));
        }
        let mut core_csv = String::from("id,name\r\nmod_250,Core Duplicate\r\n");
        for index in 0..501 {
            core_csv.push_str(&format!("core_{index:03},Core {index:03}\r\n"));
        }
        write_utf8_no_bom(&mod_root.join("data/campaign/commodities.csv"), &mod_csv).unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/campaign/commodities.csv"),
            &core_csv,
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&mod_root, Some(&root), &mut trace).unwrap();
        let groups = query_csv_source_options(&manifest.session_id, "csv:commodities.id").unwrap();

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(root);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].origin, ResourceSource::Mod);
        assert_eq!(groups[0].options.len(), 501);
        assert_eq!(groups[1].origin, ResourceSource::Core);
        assert_eq!(groups[1].options.len(), 501);
        assert_eq!(
            groups
                .iter()
                .map(|group| group.options.len())
                .sum::<usize>(),
            1002
        );
        assert_eq!(
            groups[0]
                .options
                .first()
                .map(|option| option.value.as_str()),
            Some("mod_000")
        );
        assert_eq!(
            groups[0].options.last().map(|option| option.value.as_str()),
            Some("mod_500")
        );
        assert_eq!(
            groups[1]
                .options
                .first()
                .map(|option| option.value.as_str()),
            Some("core_000")
        );
        assert_eq!(
            groups[1].options.last().map(|option| option.value.as_str()),
            Some("core_500")
        );
        assert!(
            groups[0]
                .options
                .iter()
                .all(|option| option.origin == ResourceSource::Mod)
        );
        assert!(
            groups[1]
                .options
                .iter()
                .all(|option| option.origin == ResourceSource::Core)
        );
    }

    #[test]
    fn mod_id_source_options_include_csv_metadata_and_resource() {
        let root = temp_dir("current_source_resource_refs");
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/ship_data.csv"),
            "id,name\r\nship_a,Ship A\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/ship_a.ship"),
            r#"{"hullId":"ship_a","hullName":"Spec Ship A","spriteName":"graphics/ships/ship_a.png"}"#,
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let groups = query_csv_source_options(&manifest.session_id, "csv:ships.id").unwrap();

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(root);
        let option = groups
            .iter()
            .find(|group| group.origin == ResourceSource::Mod)
            .and_then(|group| group.options.first())
            .unwrap();
        assert_eq!(option.label, "Ship A (ship_a)");
        assert_eq!(option.origin, ResourceSource::Mod);
        assert_eq!(
            option
                .resource_ref
                .as_ref()
                .map(|resource| resource.rel_path.as_str()),
            Some("graphics/ships/ship_a.png")
        );
    }

    #[test]
    fn core_id_source_options_include_csv_metadata_and_resource() {
        let root = temp_dir("current_core_source_resource_refs");
        let mod_root = root.join("mods/demo");
        std::fs::create_dir_all(mod_root.join("data/hulls")).unwrap();
        std::fs::create_dir_all(root.join("starsector-core/data/hulls")).unwrap();
        write_utf8_no_bom(&mod_root.join("data/hulls/ship_data.csv"), "id,name\r\n").unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/hulls/ship_data.csv"),
            "id,name\r\ncore_ship,Core Ship\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/hulls/core_ship.ship"),
            r#"{"hullId":"core_ship","hullName":"Spec Core Ship","spriteName":"graphics/ships/core_ship.png"}"#,
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&mod_root, Some(&root), &mut trace).unwrap();
        let groups = query_csv_source_options(&manifest.session_id, "csv:ships.id").unwrap();

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(root);
        let option = groups
            .iter()
            .find(|group| group.origin == ResourceSource::Core)
            .and_then(|group| group.options.first())
            .unwrap();
        assert_eq!(option.label, "Core Ship (core_ship)");
        assert_eq!(option.origin, ResourceSource::Core);
        assert_eq!(
            option
                .resource_ref
                .as_ref()
                .map(|resource| resource.rel_path.as_str()),
            Some("graphics/ships/core_ship.png")
        );
    }

    #[test]
    fn ship_source_options_use_hull_name_only_when_csv_name_is_missing() {
        let root = temp_dir("ship_source_name_fallback");
        let mod_root = root.join("mods/demo");
        std::fs::create_dir_all(mod_root.join("data/hulls")).unwrap();
        std::fs::create_dir_all(root.join("starsector-core/data/hulls")).unwrap();
        write_utf8_no_bom(
            &mod_root.join("data/hulls/ship_data.csv"),
            "id,name\r\nmod_ship,\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &mod_root.join("data/hulls/mod_ship.ship"),
            r#"{"hullId":"mod_ship","hullName":"Mod Fallback"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/hulls/ship_data.csv"),
            "id,name\r\ncore_ship,\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/hulls/core_ship.ship"),
            r#"{"hullId":"core_ship","hullName":"Core Fallback"}"#,
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&mod_root, Some(&root), &mut trace).unwrap();
        let groups = query_csv_source_options(&manifest.session_id, "csv:ships.id").unwrap();

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(root);
        assert_eq!(
            source_option_label_from_groups(&groups, "mod_ship").as_deref(),
            Some("Mod Fallback (mod_ship)")
        );
        assert_eq!(
            source_option_label_from_groups(&groups, "core_ship").as_deref(),
            Some("Core Fallback (core_ship)")
        );
    }

    #[test]
    fn wing_source_options_support_fighter_ids_and_tags() {
        let root = temp_dir("wing_source_options");
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();
        std::fs::create_dir_all(root.join("data/variants/fighters")).unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/wing_data.csv"),
            "id,variant,tags\r\ntalon_wing,talon_Interceptor,hegemony\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/variants/fighters/talon_Interceptor.variant"),
            r#"{"variantId":"talon_Interceptor","hullId":"talon","displayName":"截击机"}"#,
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let id_groups = query_csv_source_options(&manifest.session_id, "csv:wings.id").unwrap();
        let tag_groups = query_csv_source_options(&manifest.session_id, "csv:wings.tags").unwrap();

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(root);
        assert_eq!(
            source_option_label_from_groups(&id_groups, "talon_wing").as_deref(),
            Some("截击机 (talon_wing)")
        );
        assert_eq!(
            source_option_label_from_groups(&tag_groups, "hegemony").as_deref(),
            Some("hegemony")
        );
    }

    #[test]
    fn core_wing_source_options_fail_when_skin_index_fails() {
        let root = temp_dir("core_wing_source_ref_skin_error");
        let mod_root = root.join("mods/demo");
        std::fs::create_dir_all(&mod_root).unwrap();
        std::fs::create_dir_all(root.join("starsector-core/data/hulls/skins")).unwrap();
        std::fs::create_dir_all(root.join("starsector-core/data/variants")).unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/hulls/wing_data.csv"),
            "id,variant\r\ncore_wing,core_variant\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/variants/core_variant.variant"),
            r#"{"variantId":"core_variant","hullId":"skin_hull"}"#,
        )
        .unwrap();
        write_utf8_no_bom(&root.join("starsector-core/data/hulls/skins/bad.skin"), "{").unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&mod_root, Some(&root), &mut trace).unwrap();
        let error = query_csv_source_options(&manifest.session_id, "csv:wings.id")
            .unwrap_err()
            .to_string();

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(root);
        assert!(error.contains("bad.skin"));
    }

    #[test]
    fn core_wing_source_options_do_not_use_mod_variants_for_resource_refs() {
        let root = temp_dir("core_wing_source_ref_uses_core_variants_only");
        let mod_root = root.join("mods/demo");
        std::fs::create_dir_all(mod_root.join("data/variants")).unwrap();
        std::fs::create_dir_all(root.join("starsector-core/data/hulls")).unwrap();
        std::fs::create_dir_all(root.join("starsector-core/data/variants")).unwrap();
        write_utf8_no_bom(
            &mod_root.join("data/variants/shared_variant.variant"),
            r#"{"variantId":"shared_variant","hullId":"core_hull"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/hulls/wing_data.csv"),
            "id,variant\r\ncore_wing,shared_variant\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/hulls/core_hull.ship"),
            r#"{"hullId":"core_hull","spriteName":"graphics/ships/core_hull.png"}"#,
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&mod_root, Some(&root), &mut trace).unwrap();
        let groups = query_csv_source_options(&manifest.session_id, "csv:wings.id").unwrap();

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(root);
        let option = groups
            .iter()
            .find(|group| group.origin == ResourceSource::Core)
            .and_then(|group| {
                group
                    .options
                    .iter()
                    .find(|option| option.value == "core_wing")
            })
            .unwrap();
        assert_eq!(option.origin, ResourceSource::Core);
        assert!(option.resource_ref.is_none());
    }

    #[test]
    fn variant_id_source_options_combine_mod_and_core_entities() {
        let root = temp_dir("variant_id_source_options");
        let mod_root = root.join("mods/demo");
        std::fs::create_dir_all(mod_root.join("data/variants")).unwrap();
        std::fs::create_dir_all(root.join("starsector-core/data/hulls")).unwrap();
        std::fs::create_dir_all(root.join("starsector-core/data/variants")).unwrap();
        write_utf8_no_bom(
            &mod_root.join("data/variants/mod_fighter.variant"),
            r#"{"variantId":"mod_fighter","hullId":"core_hull","displayName":"Mod 僚机"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/variants/core_fighter.variant"),
            r#"{"variantId":"core_fighter","hullId":"core_hull","displayName":"Core 僚机"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/hulls/core_hull.ship"),
            r#"{"hullId":"core_hull","spriteName":"graphics/ships/core_hull.png"}"#,
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&mod_root, Some(&root), &mut trace).unwrap();
        let groups =
            query_csv_source_options(&manifest.session_id, "csv:variants.variantId").unwrap();

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(root);

        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].origin, ResourceSource::Mod);
        assert_eq!(
            groups[0]
                .options
                .iter()
                .map(|option| option.value.as_str())
                .collect::<Vec<_>>(),
            vec!["mod_fighter"]
        );
        assert_eq!(groups[1].origin, ResourceSource::Core);
        assert_eq!(
            groups[1]
                .options
                .iter()
                .map(|option| option.value.as_str())
                .collect::<Vec<_>>(),
            vec!["core_fighter"]
        );
        assert_eq!(
            source_option_label_from_groups(&groups, "mod_fighter").as_deref(),
            Some("Mod 僚机 (mod_fighter)")
        );
        let core_option = groups[1].options.first().unwrap();
        assert!(core_option.resource_ref.is_some());
    }

    #[test]
    fn unknown_entity_source_still_fails_as_unknown_table() {
        let root = temp_dir("unknown_entity_source");
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let error =
            query_csv_source_options(&manifest.session_id, "csv:nonexistent.foo").unwrap_err();

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(root);
        assert!(matches!(
            error,
            crate::errors::AppError::Message {
                code: "source.table_unknown",
                ..
            }
        ));
    }

    #[test]
    fn core_weapon_source_options_do_not_use_mod_weapon_specs_for_resource_refs() {
        let root = temp_dir("core_weapon_source_ref_uses_core_specs_only");
        let mod_root = root.join("mods/demo");
        std::fs::create_dir_all(mod_root.join("data/weapons")).unwrap();
        std::fs::create_dir_all(root.join("starsector-core/data/weapons")).unwrap();
        write_utf8_no_bom(
            &mod_root.join("data/weapons/weapon_data.csv"),
            "id,name\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &mod_root.join("data/weapons/shared_weapon.wpn"),
            r#"{"id":"shared_weapon","turretSprite":"graphics/weapons/mod_shared.png"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/weapons/weapon_data.csv"),
            "id,name\r\nshared_weapon,Shared Weapon\r\n",
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&mod_root, Some(&root), &mut trace).unwrap();
        let groups = query_csv_source_options(&manifest.session_id, "csv:weapons.id").unwrap();

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(root);
        let option = groups
            .iter()
            .find(|group| group.origin == ResourceSource::Core)
            .and_then(|group| {
                group
                    .options
                    .iter()
                    .find(|option| option.value == "shared_weapon")
            })
            .unwrap();
        assert_eq!(option.origin, ResourceSource::Core);
        assert!(option.resource_ref.is_none());
    }

    #[test]
    fn csv_source_parser_requires_registered_table_key() {
        let result = parse_csv_source("csv:missions.id");

        assert!(result.is_err());
    }

    #[test]
    fn csv_source_options_reject_missing_source_column() {
        let root = temp_dir("source_missing_column");
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/ship_data.csv"),
            "id,name\r\nship_a,Ship A\r\n",
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let error = query_csv_source_options(&manifest.session_id, "csv:ships.missing")
            .unwrap_err()
            .to_string();

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(root);
        assert!(error.contains("csv source column does not exist: ships.missing"));
    }

    #[test]
    fn non_id_csv_source_options_do_not_inherit_row_resources() {
        let root = temp_dir("source_non_id_no_resource");
        std::fs::create_dir_all(root.join("data/campaign")).unwrap();
        write_utf8_no_bom(
            &root.join("data/campaign/commodities.csv"),
            "id,name,tags,icon\r\nore,Ore,bulk,graphics/icons/cargo/ore.png\r\n",
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let groups =
            query_csv_source_options(&manifest.session_id, "csv:commodities.tags").unwrap();

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(root);
        let option = groups
            .iter()
            .flat_map(|group| group.options.iter())
            .find(|option| option.value == "bulk")
            .unwrap();
        assert!(option.resource_ref.is_none());
    }

    #[test]
    fn tag_and_hint_source_options_use_separate_known_labels() {
        let root = temp_dir("source_separate_tag_hint_labels");
        std::fs::create_dir_all(root.join("data/weapons")).unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/weapon_data.csv"),
            "id,name,tags,hints\r\nweapon,Weapon,no_drop,PD\r\n",
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let tag_groups =
            query_csv_source_options(&manifest.session_id, "csv:weapons.tags").unwrap();
        let hint_groups =
            query_csv_source_options(&manifest.session_id, "csv:weapons.hints").unwrap();

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(root);
        let tag_label = source_option_label_from_groups(&tag_groups, "no_drop");
        let hint_label = source_option_label_from_groups(&hint_groups, "PD");
        assert_eq!(tag_label.as_deref(), Some("no_drop (不可掉落)"));
        assert_eq!(hint_label.as_deref(), Some("PD (点防御)"));
    }

    #[test]
    fn tag_source_options_label_blueprint_package_tags_from_core_special_items() {
        let root = temp_dir("source_core_blueprint_package_tag_labels");
        let mod_root = root.join("mods/demo");
        std::fs::create_dir_all(mod_root.join("data/campaign")).unwrap();
        std::fs::create_dir_all(root.join("starsector-core/data/campaign")).unwrap();
        write_utf8_no_bom(
            &mod_root.join("data/campaign/commodities.csv"),
            "id,name,tags\r\ncommodity,Commodity,lowtech_bp\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/campaign/special_items.csv"),
            "name,id,tags,plugin params,desc\r\nLow Tech Blueprint Package,low_tech_package,\"package_bp, codex_unlockable\",lowtech_bp,Unlocks low tech blueprints.\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/campaign/commodities.csv"),
            "id,name,tags\r\n",
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&mod_root, Some(&root), &mut trace).unwrap();
        let groups =
            query_csv_source_options(&manifest.session_id, "csv:commodities.tags").unwrap();

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(root);
        let tag_label = source_option_label_from_groups(&groups, "lowtech_bp");
        let tag_description = source_option_description_from_groups(&groups, "lowtech_bp");
        assert_eq!(
            tag_label.as_deref(),
            Some("lowtech_bp (Low Tech Blueprint Package)")
        );
        assert_eq!(
            tag_description.as_deref(),
            Some("Unlocks low tech blueprints.")
        );
    }

    #[test]
    fn tag_source_options_read_mod_blueprint_package_metadata_from_session_rows() {
        let root = temp_dir("source_mod_blueprint_package_session_rows");
        std::fs::create_dir_all(root.join("data/campaign")).unwrap();
        write_utf8_no_bom(
            &root.join("data/campaign/special_items.csv"),
            "name,id,tags,plugin params,desc\r\nOld Package,old_package,package_bp,demo_bp,Old description.\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/campaign/commodities.csv"),
            "id,name,tags\r\ncommodity,Commodity,demo_bp\r\n",
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        query_csv_source_options(&manifest.session_id, "csv:specialItems.tags").unwrap();
        write_utf8_no_bom(
            &root.join("data/campaign/special_items.csv"),
            "name,id,tags,plugin params,desc\r\nNew Package,new_package,package_bp,demo_bp,New description.\r\n",
        )
        .unwrap();
        let groups =
            query_csv_source_options(&manifest.session_id, "csv:commodities.tags").unwrap();

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(root);
        let tag_label = source_option_label_from_groups(&groups, "demo_bp");
        let tag_description = source_option_description_from_groups(&groups, "demo_bp");
        assert_eq!(tag_label.as_deref(), Some("demo_bp (Old Package)"));
        assert_eq!(tag_description.as_deref(), Some("Old description."));
    }

    #[test]
    fn source_options_label_core_tag_and_hint_metadata() {
        let root = temp_dir("source_core_tag_hint_metadata");
        std::fs::create_dir_all(root.join("data/weapons")).unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/weapon_data.csv"),
            "id,name,tags,hints\r\nweapon,Weapon,codex_unlockable,CONSERVE_5\r\nbeam,Beam,beam999,DIRECT_AIM\r\nbad,Bad,energy123,\"CONSERVE_999, beam999\"\r\n",
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let tag_groups =
            query_csv_source_options(&manifest.session_id, "csv:weapons.tags").unwrap();
        let hint_groups =
            query_csv_source_options(&manifest.session_id, "csv:weapons.hints").unwrap();

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(root);
        assert_eq!(
            source_option_label_from_groups(&tag_groups, "codex_unlockable").as_deref(),
            Some("codex_unlockable (百科可解锁)")
        );
        assert_eq!(
            source_option_label_from_groups(&tag_groups, "beam999").as_deref(),
            Some("beam999 (光束武器强度 999)")
        );
        assert_eq!(
            source_option_label_from_groups(&hint_groups, "DIRECT_AIM").as_deref(),
            Some("DIRECT_AIM (直接瞄准)")
        );
        assert_eq!(
            source_option_label_from_groups(&hint_groups, "CONSERVE_5").as_deref(),
            Some("CONSERVE_5 (节省弹药 5)")
        );
        assert_eq!(
            source_option_label_from_groups(&tag_groups, "energy123").as_deref(),
            Some("energy123 (能量武器强度 123)")
        );
        assert_eq!(
            source_option_label_from_groups(&hint_groups, "CONSERVE_999").as_deref(),
            Some("CONSERVE_999")
        );
        assert_eq!(
            source_option_label_from_groups(&hint_groups, "beam999").as_deref(),
            Some("beam999")
        );
    }

    fn source_option_label_from_groups(
        groups: &[SourceOptionGroup],
        value: &str,
    ) -> Option<String> {
        groups
            .iter()
            .flat_map(|group| group.options.iter())
            .find(|option| option.value == value)
            .map(|option| option.label.clone())
    }

    fn source_option_description_from_groups(
        groups: &[SourceOptionGroup],
        value: &str,
    ) -> Option<String> {
        groups
            .iter()
            .flat_map(|group| group.options.iter())
            .find(|option| option.value == value)
            .and_then(|option| option.description.clone())
    }
}
