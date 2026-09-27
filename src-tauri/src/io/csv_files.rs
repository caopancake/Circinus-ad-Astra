use crate::{errors::AppResult, models::CsvTable};
use std::path::Path;

use super::read_text_bytes_no_bom;

pub fn read_csv_data(path: &Path) -> AppResult<CsvTable> {
    if !path.exists() {
        return Ok(CsvTable {
            header: vec![],
            rows: vec![],
            path: path.to_string_lossy().to_string(),
        });
    }
    let bytes = read_text_bytes_no_bom(path)?;
    crate::parsers::parse_csv_bytes(&path.to_string_lossy(), &bytes)
}

pub fn parse_csv_text(path_label: &str, text: &str) -> AppResult<CsvTable> {
    crate::parsers::parse_csv_bytes(path_label, text.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_csv_data_returns_an_empty_table_for_missing_files() {
        let missing = std::path::Path::new("definitely/missing/table.csv");
        let table = read_csv_data(missing).expect("empty table");
        assert!(table.header.is_empty());
        assert!(table.rows.is_empty());
    }

    #[test]
    fn parse_csv_text_reads_headers_and_rows_like_the_game_parser() {
        let text = "id,name\nxy,Ruler\n";
        let table = parse_csv_text("test.csv", text).expect("parsed");
        assert_eq!(table.header, vec!["id".to_string(), "name".to_string()]);
        assert_eq!(table.rows.len(), 1);
        assert_eq!(
            table.rows[0].get("name").and_then(|value| value.as_str()),
            Some("Ruler")
        );
    }
}
