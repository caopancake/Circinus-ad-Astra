use super::super::{
    cache::{
        ensure_registered_table_rows, loaded_registered_csv_rows, lock_session,
        registered_session_table, session_handle,
    },
    definitions::table_definitions::{
        csv_table_row_resource_ref, csv_table_supports_faction_filter,
    },
    model::SessionCsvRow,
};
use crate::{
    errors::AppResult,
    models::{
        CSV_FACTION_FIELD, CsvFactionFilter, CsvRowPreview, CsvTableKey, CsvTableWindow,
        CsvWindowRow,
    },
};

pub fn query_csv_table_window(
    session_id: &str,
    table: CsvTableKey,
    start: usize,
    count: usize,
    search: Option<String>,
    faction: CsvFactionFilter,
) -> AppResult<CsvTableWindow> {
    let handle = session_handle(session_id)?;
    let mut session = lock_session(&handle)?;
    ensure_registered_table_rows(&mut session, table)?;
    let table_data = registered_session_table(&session, table)?;
    let rows_ref = loaded_registered_csv_rows(&session, table)?;
    let search = search.unwrap_or_default().trim().to_lowercase();
    let filtered: Vec<(usize, &SessionCsvRow)> = rows_ref
        .iter()
        .enumerate()
        .filter(|(_, row)| csv_row_matches(row, &search, &faction, table))
        .collect();
    let rows = filtered
        .iter()
        .skip(start)
        .take(count)
        .map(|(index, row)| CsvWindowRow {
            row_key: row.row_key.clone(),
            row_index: *index,
            row: row.row.clone(),
        })
        .collect();
    Ok(CsvTableWindow {
        table,
        header: table_data.header.clone(),
        total_rows: rows_ref.len(),
        filtered_rows: filtered.len(),
        start,
        rows,
    })
}

pub fn query_csv_row_preview(
    session_id: &str,
    table: CsvTableKey,
    row_key: &str,
) -> AppResult<CsvRowPreview> {
    let handle = session_handle(session_id)?;
    let mut session = lock_session(&handle)?;
    ensure_registered_table_rows(&mut session, table)?;
    let row = loaded_registered_csv_rows(&session, table)?
        .iter()
        .find(|row| row.row_key == row_key);
    Ok(CsvRowPreview {
        resource_ref: row.and_then(|row| csv_table_row_resource_ref(&session, table, &row.row)),
    })
}

fn csv_row_matches(
    row: &SessionCsvRow,
    search: &str,
    faction: &CsvFactionFilter,
    table: CsvTableKey,
) -> bool {
    if let Some(faction_id) = faction
        .faction_id()
        .filter(|_| csv_table_supports_faction_filter(table))
    {
        let row_faction = row
            .row
            .get(CSV_FACTION_FIELD)
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        if row_faction != faction_id {
            return false;
        }
    }
    if search.is_empty() {
        return true;
    }
    row.row
        .values()
        .filter_map(serde_json::Value::as_str)
        .any(|value| value.to_lowercase().contains(search))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Map, json};

    fn session_row(key: &str, entries: &[(&str, &str)]) -> SessionCsvRow {
        let mut row = Map::new();
        for (field, value) in entries {
            row.insert(field.to_string(), json!(value));
        }
        SessionCsvRow {
            row_key: key.to_string(),
            row,
        }
    }

    #[test]
    fn search_matches_any_cell_value_case_insensitively() {
        let row = session_row("k", &[("id", "XY"), ("name", "Ruler of Mars")]);
        assert!(csv_row_matches(
            &row,
            "ruler of",
            &CsvFactionFilter::All,
            CsvTableKey::Ships
        ));
        assert!(!csv_row_matches(
            &row,
            "venus",
            &CsvFactionFilter::All,
            CsvTableKey::Ships
        ));
    }

    #[test]
    fn empty_search_matches_everything() {
        let row = session_row("k", &[("id", "XY")]);
        assert!(csv_row_matches(
            &row,
            "",
            &CsvFactionFilter::All,
            CsvTableKey::Ships
        ));
        assert!(!csv_row_matches(
            &row,
            "xy",
            &CsvFactionFilter::Faction {
                faction_id: "hegemony".to_string()
            },
            CsvTableKey::Ships
        ));
    }

    #[test]
    fn faction_filter_scopes_rows_for_tables_that_support_it() {
        let mut row = Map::new();
        row.insert("id".to_string(), json!("XY"));
        row.insert(CSV_FACTION_FIELD.to_string(), json!("tritachyon"));
        let entry = SessionCsvRow {
            row_key: "k".to_string(),
            row,
        };

        let filter = CsvFactionFilter::Faction {
            faction_id: "tritachyon".to_string(),
        };
        assert!(csv_row_matches(&entry, "", &filter, CsvTableKey::Ships));

        let other = CsvFactionFilter::Faction {
            faction_id: "hegemony".to_string(),
        };
        assert!(!csv_row_matches(&entry, "", &other, CsvTableKey::Ships));
    }

    #[test]
    fn faction_filter_is_ignored_for_tables_without_faction_support() {
        let row = session_row("k", &[("id", "XY")]);
        let filter = CsvFactionFilter::Faction {
            faction_id: "hegemony".to_string(),
        };
        assert!(csv_row_matches(
            &row,
            "",
            &filter,
            CsvTableKey::Descriptions
        ));
    }

    #[test]
    fn faction_filter_ignores_rows_without_a_faction_field() {
        let row = session_row("k", &[("id", "XY")]);
        let filter = CsvFactionFilter::Faction {
            faction_id: "hegemony".to_string(),
        };
        assert!(!csv_row_matches(&row, "", &filter, CsvTableKey::Ships));
    }
}
