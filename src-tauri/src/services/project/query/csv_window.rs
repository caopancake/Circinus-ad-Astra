use super::super::{
    cache::{
        ensure_registered_table_rows, loaded_registered_csv_rows, lock_ready_session,
        registered_session_table, session_handle,
    },
    definitions::table_definitions::{
        csv_table_row_resource_ref, csv_table_supports_faction_filter,
    },
    model::SessionCsvRow,
};
use crate::{
    errors::AppResult,
    models::{CsvFactionFilter, CsvRowPreview, CsvTableKey, CsvTableWindow, CsvWindowRow},
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
    let mut session = lock_ready_session(&handle)?;
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
            source_row_index: *index,
            data: row.data.clone(),
            faction_id: row.faction_id.clone(),
        })
        .collect();
    let mut base_versions = vec![super::super::versions::version_for_path(
        &session,
        &table_data.path,
    )];
    if let Some(spec) = crate::domain::editor_config_definitions::associated_spec_definition(table)
    {
        base_versions.extend(
            session
                .source_versions
                .iter()
                .filter(|(path, _)| {
                    path.starts_with(&format!("{}/", spec.dir)) && path.ends_with(spec.extension)
                })
                .map(|(_, version)| version.clone()),
        );
    }
    Ok(CsvTableWindow {
        base_versions,
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
    let mut session = lock_ready_session(&handle)?;
    ensure_registered_table_rows(&mut session, table)?;
    let row = loaded_registered_csv_rows(&session, table)?
        .iter()
        .find(|row| row.row_key == row_key);
    Ok(CsvRowPreview {
        resource_ref: row.and_then(|row| csv_table_row_resource_ref(&session, table, &row.data)),
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
        && row.faction_id.as_deref() != Some(faction_id)
    {
        return false;
    }
    if search.is_empty() {
        return true;
    }
    row.data
        .values()
        .filter_map(serde_json::Value::as_str)
        .chain(row.faction_id.as_deref())
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
            data: row,
            faction_id: None,
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
        row.insert("_faction".to_string(), json!("business-faction"));
        let entry = SessionCsvRow {
            row_key: "k".to_string(),
            data: row,
            faction_id: Some("tritachyon".to_string()),
        };

        let filter = CsvFactionFilter::Faction {
            faction_id: "tritachyon".to_string(),
        };
        assert!(csv_row_matches(&entry, "", &filter, CsvTableKey::Ships));
        assert!(csv_row_matches(
            &entry,
            "business-faction",
            &CsvFactionFilter::All,
            CsvTableKey::Ships
        ));
        assert!(csv_row_matches(
            &entry,
            "tritachyon",
            &CsvFactionFilter::All,
            CsvTableKey::Ships
        ));

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
