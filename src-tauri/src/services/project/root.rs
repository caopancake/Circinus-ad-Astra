use crate::{
    errors::AppResult,
    io::{read_csv_data, read_json_file},
};
use serde_json::Value;
use std::path::Path;

/// `None` models a Mod opened without `mod_info.json` — the same state the
/// game-overview scan reports as skipped, never fabricated defaults.
pub(super) fn read_mod_info(mod_root: &Path) -> AppResult<Option<Value>> {
    let path = mod_root.join("mod_info.json");
    if path.exists() {
        return read_json_file(&path).map(Some);
    }
    Ok(None)
}

pub(super) fn count_mission_list_entries(mod_root: &Path) -> AppResult<usize> {
    let path = mod_root.join("data/missions/mission_list.csv");
    read_csv_data(&path).map(|table| {
        table
            .rows
            .iter()
            .filter(|row| {
                if row.is_comment {
                    return false;
                }
                row.data
                    .get("mission")
                    .and_then(Value::as_str)
                    .is_some_and(|mission| !mission.trim().is_empty())
            })
            .count()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::write_utf8_no_bom;
    use crate::testutil::temp_dir;
    use std::fs;

    #[test]
    fn mission_count_ignores_comment_rows() {
        let root = temp_dir("mission_count_comments");
        fs::create_dir_all(root.join("data/missions")).unwrap();
        write_utf8_no_bom(
            &root.join("data/missions/mission_list.csv"),
            "mission,name\r\n#comment,Hidden\r\ndemo,Demo\r\n",
        )
        .unwrap();

        let count = count_mission_list_entries(&root).unwrap();

        let _ = fs::remove_dir_all(root);
        assert_eq!(count, 1);
    }
}
