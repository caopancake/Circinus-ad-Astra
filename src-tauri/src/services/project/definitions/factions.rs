use crate::{
    errors::{AppError, AppResult},
    io::{FsRootBoundary, forward_slash_path, read_faction_index, read_json_file},
    models::{EntityFileLocation, FactionIndexEntry, LoadedSpecRecord, ResourceSource},
};
use serde_json::{Map, Value};
use std::{
    collections::{BTreeMap, HashMap},
    path::Path,
};

pub(in crate::services::project) fn faction_blueprint_tags(
    files: &BTreeMap<String, LoadedSpecRecord>,
) -> HashMap<String, String> {
    let mut tags_by_faction = HashMap::new();
    for (id, record) in files {
        let obj = &record.data;
        if obj
            .get("displayName")
            .or_else(|| obj.get("displayNameLong"))
            .and_then(Value::as_str)
            .is_none()
        {
            continue;
        }
        for section in ["knownShips", "knownWeapons", "knownFighters"] {
            if let Some(tags) = obj
                .get(section)
                .and_then(|value| value.get("tags"))
                .and_then(Value::as_array)
            {
                for tag in tags.iter().filter_map(Value::as_str) {
                    if is_owned_faction_blueprint_tag(tag, id) {
                        tags_by_faction.insert(tag.to_string(), id.clone());
                    }
                }
            }
        }
    }
    tags_by_faction
}

pub(in crate::services::project) fn load_faction_files(
    mod_root: &Path,
) -> AppResult<BTreeMap<String, LoadedSpecRecord>> {
    let mut defs = BTreeMap::new();
    for entry in read_faction_index(mod_root)? {
        let (id, obj) = read_faction_object(&entry)?;
        let boundary = FsRootBoundary::new(mod_root, "faction root")?;
        let rel_path = forward_slash_path(
            entry
                .path
                .strip_prefix(boundary.root())
                .expect("faction belongs to authorized root"),
        );
        defs.insert(
            id.clone(),
            LoadedSpecRecord {
                id,
                location: EntityFileLocation {
                    source: ResourceSource::Mod,
                    root: boundary.root().to_string_lossy().to_string(),
                    rel_path,
                    path: entry.path.to_string_lossy().to_string(),
                },
                data: Value::Object(obj),
            },
        );
    }
    Ok(defs)
}

fn read_faction_object(entry: &FactionIndexEntry) -> AppResult<(String, Map<String, Value>)> {
    match read_json_file(&entry.path)? {
        Value::Object(obj) => {
            let id = obj
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    AppError::message(
                        "faction.id_missing",
                        format!("势力文件缺少字符串 id: {}", entry.path.display()),
                    )
                })?
                .to_string();
            Ok((id, obj))
        }
        _ => Err(AppError::message(
            "faction.file_not_object",
            format!(
                "faction file must be a JSON object: {}",
                entry.path.display()
            ),
        )),
    }
}

fn is_owned_faction_blueprint_tag(tag: &str, faction_id: &str) -> bool {
    let faction_id = faction_id.trim().to_ascii_lowercase();
    if faction_id.is_empty() {
        return false;
    }
    let tag = tag.trim().to_ascii_lowercase();
    tag == format!("{faction_id}_bp")
        || (tag.starts_with(&format!("{faction_id}_")) && tag.ends_with("_bp"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::write_utf8_no_bom;
    use crate::testutil::temp_dir;
    use serde_json::json;
    use std::fs;

    #[test]
    fn accepts_only_blueprint_tags_derived_from_current_faction_id() {
        assert!(is_owned_faction_blueprint_tag("demo_bp", "demo"));
        assert!(is_owned_faction_blueprint_tag("demo_aux_bp", "demo"));
        assert!(!is_owned_faction_blueprint_tag("base_bp", "demo"));
        assert!(!is_owned_faction_blueprint_tag("custom_bp", "demo"));
        assert!(!is_owned_faction_blueprint_tag("demo_bp_extra", "demo"));
    }

    #[test]
    fn faction_blueprint_tags_preserve_owned_tags() {
        let root = temp_dir("faction_foreign_blueprint_tags");
        let dir = root.join("data/world/factions");
        fs::create_dir_all(&dir).unwrap();
        write_utf8_no_bom(
            &dir.join("factions.csv"),
            "id,file\r\ndemo,demo.faction\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &dir.join("demo.faction"),
            r#"{"id":"demo","displayName":"Demo","knownShips":{"tags":["demo_bp","custom_bp","base_bp"]}}"#,
        )
        .unwrap();

        let faction_blueprint_tags = faction_blueprint_tags(&load_faction_files(&root).unwrap());

        let _ = fs::remove_dir_all(root);
        assert_eq!(
            faction_blueprint_tags.get("demo_bp"),
            Some(&"demo".to_string())
        );
        assert!(!faction_blueprint_tags.contains_key("custom_bp"));
        assert!(!faction_blueprint_tags.contains_key("base_bp"));
    }

    #[test]
    fn loads_factions_from_faction_path_csv() {
        let root = temp_dir("faction_path_csv");
        let dir = root.join("data/world/factions");
        fs::create_dir_all(&dir).unwrap();
        write_utf8_no_bom(
            &dir.join("factions.csv"),
            "faction\r\ndata/world/factions/plsp.faction\r\ndata/world/factions/celestite.faction\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &dir.join("plsp.faction"),
            &json!({"id":"plsp","displayName":"Polaris","color":[1,2,3,255]}).to_string(),
        )
        .unwrap();
        write_utf8_no_bom(
            &dir.join("celestite.faction"),
            &json!({"id":"celestite","displayName":"Celestite","color":[4,5,6,255]}).to_string(),
        )
        .unwrap();
        write_utf8_no_bom(
            &dir.join("mercenary.faction"),
            &json!({"id":"mercenary","displayName":"Mercenary"}).to_string(),
        )
        .unwrap();

        let files = load_faction_files(&root).unwrap();

        let _ = fs::remove_dir_all(root);
        assert!(files.contains_key("plsp"));
        assert!(files.contains_key("celestite"));
        assert!(!files.contains_key("mercenary"));
        assert_eq!(files["plsp"].data["displayName"], "Polaris");
    }

    #[test]
    fn reports_faction_index_csv_path() {
        let root = temp_dir("faction_bad_csv");
        let dir = root.join("data/world/factions");
        fs::create_dir_all(&dir).unwrap();
        // Short rows are tolerated now; a real defect must still surface the CSV path.
        write_utf8_no_bom(&dir.join("factions.csv"), "id,file\r\n\"bad\r\n").unwrap();

        let error = load_faction_files(&root).unwrap_err().to_string();

        let _ = fs::remove_dir_all(root);
        assert!(error.contains("解析 CSV 失败"));
        assert!(error.contains("factions.csv"));
    }

    #[test]
    fn faction_index_reports_non_comment_row_without_id() {
        let root = temp_dir("faction_missing_id");
        let dir = root.join("data/world/factions");
        fs::create_dir_all(&dir).unwrap();
        write_utf8_no_bom(
            &dir.join("factions.csv"),
            "id,file\r\n,demo.faction\r\n#comment,\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &dir.join("demo.faction"),
            &json!({"id":"demo","displayName":"Demo"}).to_string(),
        )
        .unwrap();

        let error = load_faction_files(&root).unwrap_err().to_string();

        let _ = fs::remove_dir_all(root);
        assert!(error.contains("factions.csv"));
        assert!(error.contains("row 2"));
        assert!(error.contains("missing faction id"));
    }

    #[test]
    fn indexed_faction_file_parse_errors_are_not_hidden() {
        let root = temp_dir("faction_bad_file");
        let dir = root.join("data/world/factions");
        fs::create_dir_all(&dir).unwrap();
        write_utf8_no_bom(
            &dir.join("factions.csv"),
            "id,file\r\ndemo,demo.faction\r\n",
        )
        .unwrap();
        write_utf8_no_bom(&dir.join("demo.faction"), "{").unwrap();

        let load_error = load_faction_files(&root).unwrap_err().to_string();

        let _ = fs::remove_dir_all(root);
        assert!(load_error.contains("demo.faction"));
    }

    #[test]
    fn indexed_faction_file_must_be_object() {
        let root = temp_dir("faction_non_object_file");
        let dir = root.join("data/world/factions");
        fs::create_dir_all(&dir).unwrap();
        write_utf8_no_bom(
            &dir.join("factions.csv"),
            "id,file\r\ndemo,demo.faction\r\n",
        )
        .unwrap();
        write_utf8_no_bom(&dir.join("demo.faction"), "[]").unwrap();

        let load_error = load_faction_files(&root).unwrap_err().to_string();

        let _ = fs::remove_dir_all(root);
        // A non-object root is rejected by the parser per the game's
        // new JSONObject; read_json_file adds the file path.
        assert!(load_error.contains("demo.faction"));
        assert!(load_error.contains("must begin with '{'"));
    }
}
