use super::{FsRootBoundary, read_csv_data};
use crate::{errors::AppResult, models::FactionIndexEntry, parsers::parse_faction_index};
use std::path::Path;

#[cfg(test)]
thread_local! { static INDEX_READS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }

#[cfg(test)]
pub(crate) fn take_faction_index_reads() -> usize {
    INDEX_READS.with(|count| count.replace(0))
}

pub fn read_faction_index(root: &Path) -> AppResult<Vec<FactionIndexEntry>> {
    #[cfg(test)]
    INDEX_READS.with(|count| count.set(count.get() + 1));
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
