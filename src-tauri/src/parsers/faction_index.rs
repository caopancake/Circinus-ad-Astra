use crate::{
    errors::{AppError, AppResult},
    models::{CsvTable, FactionIndexEntry, FactionIndexRow},
};
use serde_json::{Map, Value};
use std::path::Path;

pub fn parse_faction_index(table: &CsvTable) -> AppResult<Vec<FactionIndexRow>> {
    let Some(id_column) = column(&table.header, &["id", "faction", "factionId"])
        .or_else(|| table.header.first().cloned())
    else {
        return Ok(Vec::new());
    };
    let file_column = column(&table.header, &["file", "path", "filename", "factionFile"]);
    let mut rows = Vec::new();
    for (row_index, row) in table.rows.iter().enumerate() {
        if row
            .get(&table.header[0])
            .and_then(Value::as_str)
            .is_some_and(|text| text.trim_start().starts_with('#'))
            || row
                .values()
                .all(|value| value.as_str().is_none_or(|text| text.trim().is_empty()))
        {
            continue;
        }
        let parsed =
            parse_row(row, &id_column, file_column.as_deref(), row_index).map_err(|error| {
                AppError::context(
                    format!("解析 factions.csv 失败: row {}", row_index + 2),
                    error,
                )
                .at_path(&table.path)
            })?;
        rows.push(parsed);
    }
    Ok(rows)
}

fn column(header: &[String], candidates: &[&str]) -> Option<String> {
    candidates.iter().find_map(|candidate| {
        header
            .iter()
            .find(|field| field.eq_ignore_ascii_case(candidate))
            .cloned()
    })
}

fn parse_row(
    row: &Map<String, Value>,
    id_column: &str,
    file_column: Option<&str>,
    row_index: usize,
) -> AppResult<FactionIndexRow> {
    let raw_id = row
        .get(id_column)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .ok_or_else(|| AppError::message("faction.id_missing", "missing faction id"))?;
    let file = file_column
        .and_then(|field| row.get(field))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .or_else(|| is_file_reference(raw_id).then_some(raw_id));
    let reference = file
        .map(str::to_string)
        .unwrap_or_else(|| format!("{raw_id}.faction"));
    Ok(FactionIndexRow {
        reference,
        row_index,
        id_column: id_column.to_string(),
        file_column: file_column.map(str::to_string),
    })
}

fn is_file_reference(text: &str) -> bool {
    text.ends_with(".faction") || text.contains(['/', '\\'])
}

pub fn update_faction_index_row(
    row: &mut Map<String, Value>,
    entry: &FactionIndexEntry,
    id: &str,
    rel_path: &str,
) {
    let reference = |field: &str| {
        let original = row.get(field).and_then(Value::as_str).unwrap_or_default();
        if original.contains(['/', '\\']) {
            rel_path.to_string()
        } else {
            Path::new(rel_path)
                .file_name()
                .expect("faction path is a file")
                .to_string_lossy()
                .to_string()
        }
    };
    let id_value = if row
        .get(&entry.id_column)
        .and_then(Value::as_str)
        .is_some_and(is_file_reference)
    {
        reference(&entry.id_column)
    } else {
        id.to_string()
    };
    let file_value = entry
        .file_column
        .as_ref()
        .map(|column| (column.clone(), reference(column)));
    row.insert(entry.id_column.clone(), Value::String(id_value));
    if let Some((column, value)) = file_value {
        row.insert(column, Value::String(value));
    }
}
