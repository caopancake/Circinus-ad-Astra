use crate::{
    errors::{AppError, AppResult},
    io::read_csv_data,
    models::{CSV_FACTION_FIELD, CsvTable, CsvTableKey},
};
use serde_json::Value;
use std::path::Path;

use super::super::model::{
    MISSION_LIST_TABLE_KEY, ProjectSession, SessionCsvRow, SessionCsvTable, csv_table_spec,
    is_comment_row, mission_list_default_header,
};
use super::core::load_core_csv_table;

pub(crate) fn session_table<'a>(
    session: &'a ProjectSession,
    table: &str,
) -> AppResult<&'a SessionCsvTable> {
    session
        .csv_tables
        .get(table)
        .ok_or_else(|| AppError::message("table.unknown", format!("unknown table: {table}")))
}

pub(crate) fn registered_session_table(
    session: &ProjectSession,
    table: CsvTableKey,
) -> AppResult<&SessionCsvTable> {
    session_table(session, table.as_str())
}

pub(crate) fn loaded_csv_rows<'a>(
    table: &'a SessionCsvTable,
    table_label: &str,
) -> AppResult<&'a [SessionCsvRow]> {
    table.rows.as_deref().ok_or_else(|| {
        AppError::message(
            "table.rows_not_loaded",
            format!("CSV rows are not loaded: {table_label}"),
        )
    })
}

pub(crate) fn loaded_registered_csv_rows(
    session: &ProjectSession,
    table: CsvTableKey,
) -> AppResult<&[SessionCsvRow]> {
    loaded_csv_rows(registered_session_table(session, table)?, table.as_str())
}

pub(crate) fn session_table_mut<'a>(
    session: &'a mut ProjectSession,
    table: &str,
) -> AppResult<&'a mut SessionCsvTable> {
    session
        .csv_tables
        .get_mut(table)
        .ok_or_else(|| AppError::message("table.unknown", format!("unknown table: {table}")))
}

pub(crate) fn registered_session_table_mut(
    session: &mut ProjectSession,
    table: CsvTableKey,
) -> AppResult<&mut SessionCsvTable> {
    session_table_mut(session, table.as_str())
}

pub(crate) fn ensure_session_table_rows(
    session: &mut ProjectSession,
    table: &str,
) -> AppResult<()> {
    let needs_load = session_table(session, table)?.rows.is_none();
    if !needs_load {
        return Ok(());
    }
    let rel_path = session_table(session, table)?.path.clone();
    let path = Path::new(&session.manifest.mod_root).join(&rel_path);
    let mut csv = if path.exists() {
        read_csv_data(&path)?
    } else {
        CsvTable {
            header: if table == MISSION_LIST_TABLE_KEY {
                mission_list_default_header()
            } else {
                Vec::new()
            },
            rows: Vec::new(),
            path: rel_path.clone(),
        }
    };
    if csv.header.is_empty() {
        if let Some(root) = session.manifest.starsector_root.as_ref() {
            if let Some(table_key) = CsvTableKey::from_key(table) {
                if let Some(core_table) = load_core_csv_table(root, table_key)? {
                    csv.header = core_table.header.clone();
                }
            } else if table == MISSION_LIST_TABLE_KEY {
                csv.header = mission_list_default_header();
            }
        } else if table == MISSION_LIST_TABLE_KEY {
            csv.header = mission_list_default_header();
        }
    }
    if CsvTableKey::from_key(table).is_some_and(|key| csv_table_spec(key).supports_faction_filter) {
        annotate_faction_rows(&mut csv.rows, &session.tag_map);
    }
    let row_sequence = session_table(session, table)?.next_row_seq;
    let rows: Vec<SessionCsvRow> = csv
        .rows
        .into_iter()
        .enumerate()
        .map(|(index, row)| SessionCsvRow {
            row_key: format!("{table}:row:{}", row_sequence + index as u64),
            row,
        })
        .collect();
    let next_row_seq = row_sequence + rows.len() as u64;
    let table_state = session_table_mut(session, table)?;
    if table_state.header.is_empty() {
        table_state.header = csv.header;
    }
    table_state.rows = Some(rows);
    table_state.next_row_seq = next_row_seq;
    table_state.saved_text = None;
    session
        .source_versions
        .insert(rel_path, crate::io::file_version(&path)?);
    Ok(())
}

pub(crate) fn ensure_registered_table_rows(
    session: &mut ProjectSession,
    table: CsvTableKey,
) -> AppResult<()> {
    ensure_session_table_rows(session, table.as_str())
}

pub(crate) fn refresh_faction_annotations(session: &mut ProjectSession) {
    for (key, table) in &mut session.csv_tables {
        if CsvTableKey::from_key(key).is_some_and(|key| csv_table_spec(key).supports_faction_filter)
            && let Some(rows) = &mut table.rows
        {
            for row in rows {
                annotate_faction_rows(std::slice::from_mut(&mut row.row), &session.tag_map);
            }
        }
    }
}

fn annotate_faction_rows(
    rows: &mut [serde_json::Map<String, Value>],
    tag_map: &std::collections::HashMap<String, String>,
) {
    for row in rows {
        if is_faction_padding_row(row) {
            continue;
        }
        let id = row
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        let tags = row
            .get("tags")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        if id.is_empty() && tags.is_empty() {
            continue;
        }
        row.insert(
            CSV_FACTION_FIELD.to_string(),
            Value::String(crate::domain::faction_annotation::detect_faction(
                tags, tag_map,
            )),
        );
    }
}

fn is_faction_padding_row(row: &serde_json::Map<String, Value>) -> bool {
    is_comment_row(row)
        || row
            .values()
            .all(|value| value.as_str().is_none_or(|text| text.trim().is_empty()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;
    use crate::{
        io::write_utf8_no_bom,
        models::{EntitySummaries, ProjectManifest},
    };
    use serde_json::{Map, Value};
    use std::{
        collections::{BTreeMap, HashMap},
        fs,
    };

    #[test]
    fn ensure_session_table_rows_rejects_unknown_table() {
        let mut session = ProjectSession {
            source_entities: BTreeMap::new(),
            source_versions: BTreeMap::new(),
            manifest: ProjectManifest {
                base_versions: Vec::new(),
                session_id: "test".to_string(),
                mod_root: "mod".to_string(),
                starsector_root: None,
                core_available: false,
                associated_spec_tables: Vec::new(),
                mod_info: Some(Value::Object(Map::new())),
                table_summaries: BTreeMap::new(),
                table_entity_summaries: BTreeMap::new(),
                entity_summaries: EntitySummaries::default(),
                warnings: Vec::new(),
            },
            faction_files: BTreeMap::new(),
            tag_map: HashMap::new(),
            csv_tables: BTreeMap::new(),
            ship_files: BTreeMap::new(),
            variant_files: Vec::new(),
            skin_files: Vec::new(),
            weapon_specs: BTreeMap::new(),
            projectile_specs: BTreeMap::new(),
            system_files: BTreeMap::new(),
            skill_files: BTreeMap::new(),
        };

        let error = ensure_session_table_rows(&mut session, "missing")
            .unwrap_err()
            .to_string();

        assert!(error.contains("unknown table: missing"));
    }

    #[test]
    fn ensure_session_table_rows_only_adds_faction_field_to_supported_data_rows() {
        let root = temp_dir("csv_faction_annotation_boundary");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        fs::create_dir_all(root.join("data/characters/skills")).unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/ship_data.csv"),
            "id,tags\r\nship,demo_bp\r\n#comment,\r\n,\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/characters/skills/skill_data.csv"),
            "id,name\r\nskill,Skill\r\n",
        )
        .unwrap();
        let mut session = ProjectSession {
            source_entities: BTreeMap::new(),
            source_versions: BTreeMap::new(),
            manifest: ProjectManifest {
                base_versions: Vec::new(),
                session_id: "test".to_string(),
                mod_root: root.to_string_lossy().to_string(),
                starsector_root: None,
                core_available: false,
                associated_spec_tables: Vec::new(),
                mod_info: Some(Value::Object(Map::new())),
                table_summaries: BTreeMap::new(),
                table_entity_summaries: BTreeMap::new(),
                entity_summaries: EntitySummaries::default(),
                warnings: Vec::new(),
            },
            faction_files: BTreeMap::new(),
            tag_map: HashMap::from([("demo_bp".to_string(), "demo".to_string())]),
            csv_tables: BTreeMap::from([
                (
                    CsvTableKey::Ships.as_str().to_string(),
                    SessionCsvTable {
                        header: Vec::new(),
                        path: "data/hulls/ship_data.csv".to_string(),
                        rows: None,
                        next_row_seq: 0,
                        saved_text: None,
                    },
                ),
                (
                    CsvTableKey::Skills.as_str().to_string(),
                    SessionCsvTable {
                        header: Vec::new(),
                        path: "data/characters/skills/skill_data.csv".to_string(),
                        rows: None,
                        next_row_seq: 0,
                        saved_text: None,
                    },
                ),
            ]),
            ship_files: BTreeMap::new(),
            variant_files: Vec::new(),
            skin_files: Vec::new(),
            weapon_specs: BTreeMap::new(),
            projectile_specs: BTreeMap::new(),
            system_files: BTreeMap::new(),
            skill_files: BTreeMap::new(),
        };

        ensure_session_table_rows(&mut session, CsvTableKey::Ships.as_str()).unwrap();
        ensure_session_table_rows(&mut session, CsvTableKey::Skills.as_str()).unwrap();

        let ships = loaded_registered_csv_rows(&session, CsvTableKey::Ships).unwrap();
        let skills = loaded_registered_csv_rows(&session, CsvTableKey::Skills).unwrap();
        let _ = fs::remove_dir_all(root);
        assert_eq!(
            ships[0].row.get(CSV_FACTION_FIELD),
            Some(&Value::String("demo".to_string()))
        );
        assert!(!ships[1].row.contains_key(CSV_FACTION_FIELD));
        assert!(!ships[2].row.contains_key(CSV_FACTION_FIELD));
        assert!(!skills[0].row.contains_key(CSV_FACTION_FIELD));
    }
}
