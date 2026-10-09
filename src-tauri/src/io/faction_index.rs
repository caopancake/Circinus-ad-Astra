use super::{FsRootBoundary, read_csv_data};
use crate::{errors::AppResult, models::FactionIndexEntry, parsers::parse_faction_index};
use std::path::Path;

pub fn read_faction_index(root: &Path) -> AppResult<Vec<FactionIndexEntry>> {
    let boundary = FsRootBoundary::new(root, "faction root")?;
    let table = read_csv_data(
        &boundary.resolve_relative("data/world/factions/factions.csv", "faction index")?,
    )?;
    parse_faction_index(&table)?
        .into_iter()
        .map(|row| {
            let reference = row.reference.replace('\\', "/");
            let file = if reference.ends_with(".faction") {
                reference
            } else {
                format!("{reference}.faction")
            };
            let relative = if file.contains('/') {
                file
            } else {
                format!("data/world/factions/{file}")
            };
            Ok(FactionIndexEntry {
                path: boundary.resolve_relative(&relative, "faction index target")?,
                row_index: row.row_index,
                id_column: row.id_column,
                file_column: row.file_column,
            })
        })
        .collect()
}
