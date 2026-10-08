use crate::{
    errors::{AppError, AppResult},
    io::{FsRootBoundary, read_json_file, validate_walk_entry},
    models::{DiscoveredField, DiscoveredFieldType, ResourceSource},
};
use serde_json::Value;
use std::{collections::BTreeMap, path::Path};
use walkdir::WalkDir;

/// Scan starsector-core files and discover field names + inferred types.
/// Returns a map: fileType -> Vec<DiscoveredField>
pub fn scan_core_fields(
    starsector_root: &str,
) -> AppResult<BTreeMap<String, Vec<DiscoveredField>>> {
    let mut result = BTreeMap::new();
    let starsector_root = FsRootBoundary::new(Path::new(starsector_root), "starsector root")?;
    let core_dir = starsector_root.root().join("starsector-core");
    if !core_dir.exists() {
        return Ok(result);
    }

    let faction_fields = scan_json_fields(&core_dir.join("data/world/factions"), "faction")?;
    if !faction_fields.is_empty() {
        result.insert("faction".to_string(), faction_fields);
    }

    let ship_fields = scan_json_fields(&core_dir.join("data/hulls"), "ship")?;
    if !ship_fields.is_empty() {
        result.insert("ship".to_string(), ship_fields);
    }

    let wpn_fields = scan_json_fields(&core_dir.join("data/weapons"), "wpn")?;
    if !wpn_fields.is_empty() {
        result.insert("weapon".to_string(), wpn_fields);
    }

    Ok(result)
}

fn scan_json_fields(dir: &Path, ext: &str) -> AppResult<Vec<DiscoveredField>> {
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut field_map: BTreeMap<String, DiscoveredFieldType> = BTreeMap::new();

    for entry in WalkDir::new(dir).max_depth(2) {
        let entry = entry.map_err(|error| {
            AppError::message("io.walk_failed", format!("遍历原版字段目录失败: {error}"))
        })?;
        validate_walk_entry(entry.path(), "core fields")?;
        if entry.path().extension().and_then(|s| s.to_str()) != Some(ext) {
            continue;
        }
        let value = read_json_file(entry.path())?;
        let Value::Object(obj) = value else {
            return Err(AppError::message(
                "schema.field_source_not_object",
                format!(
                    "core field source must be a JSON object: {}",
                    entry.path().display()
                ),
            ));
        };
        for (key, value) in &obj {
            field_map
                .entry(key.clone())
                .or_insert_with(|| infer_type(value));
        }
    }

    Ok(field_map
        .into_iter()
        .map(|(key, field_type)| DiscoveredField {
            key,
            field_type,
            origin: ResourceSource::Core,
        })
        .collect())
}

fn infer_type(value: &Value) -> DiscoveredFieldType {
    match value {
        Value::Bool(_) => DiscoveredFieldType::Boolean,
        Value::Number(n) => {
            if n.is_i64() || n.is_u64() {
                DiscoveredFieldType::Integer
            } else {
                DiscoveredFieldType::Float
            }
        }
        Value::String(s) => {
            if s.starts_with("graphics/") {
                DiscoveredFieldType::PathImage
            } else {
                DiscoveredFieldType::String
            }
        }
        Value::Array(arr) => {
            if arr.is_empty() {
                return DiscoveredFieldType::StringArray;
            }
            if (arr.len() == 3 || arr.len() == 4) && arr.iter().all(|v| v.is_i64() || v.is_u64()) {
                let all_in_range = arr
                    .iter()
                    .all(|v| v.as_i64().is_some_and(|n| (0..=255).contains(&n)));
                if all_in_range {
                    return DiscoveredFieldType::ColorRgba;
                }
            }
            if arr.iter().all(Value::is_string) {
                DiscoveredFieldType::StringArray
            } else if arr.iter().all(Value::is_object) {
                DiscoveredFieldType::ArrayOfObject
            } else {
                DiscoveredFieldType::StringArray
            }
        }
        Value::Object(obj) => {
            if let Some(Value::Array(_)) = obj.get("tags") {
                DiscoveredFieldType::TagSelect
            } else {
                DiscoveredFieldType::Object
            }
        }
        Value::Null => DiscoveredFieldType::String,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{temp_dir, temp_linked_dir};
    use std::fs;

    #[test]
    fn core_field_scan_reports_broken_json() {
        let root = temp_dir("core_field_scan_broken_json");
        fs::create_dir_all(root.join("starsector-core/data/weapons")).unwrap();
        crate::io::write_utf8_no_bom(&root.join("starsector-core/data/weapons/bad.wpn"), "{")
            .unwrap();

        let error = scan_core_fields(&root.to_string_lossy())
            .unwrap_err()
            .to_string();

        let _ = fs::remove_dir_all(root);
        assert!(error.contains("bad.wpn"));
    }

    #[test]
    fn core_field_scan_rejects_non_object_json_sources() {
        let root = temp_dir("core_field_scan_non_object");
        fs::create_dir_all(root.join("starsector-core/data/weapons")).unwrap();
        crate::io::write_utf8_no_bom(&root.join("starsector-core/data/weapons/list.wpn"), "[]")
            .unwrap();

        let error = scan_core_fields(&root.to_string_lossy())
            .unwrap_err()
            .to_string();

        let _ = fs::remove_dir_all(root);
        // A non-object root is rejected by the parser per the game's
        // new JSONObject; read_json_file adds the file path.
        assert!(error.contains("list.wpn"));
        assert!(error.contains("must begin with '{'"));
    }

    #[test]
    fn core_field_scan_rejects_parent_dir_root() {
        let root = temp_dir("core_field_scan_parent_dir_root");
        let escaped = root.join("..");

        let error = scan_core_fields(&escaped.to_string_lossy())
            .unwrap_err()
            .to_string();

        let _ = fs::remove_dir_all(root);
        assert!(error.contains("invalid starsector root path"));
    }

    #[test]
    fn core_field_scan_rejects_link_entry() {
        let Some((root, outside, _linked)) = temp_linked_dir(
            "core_fields_link_entry",
            "starsector-core/data/weapons/linked",
        ) else {
            return;
        };
        crate::io::write_utf8_no_bom(&outside.join("outside.wpn"), r#"{"id":"outside"}"#).unwrap();

        let result = scan_core_fields(&root.to_string_lossy());

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
        assert!(result.is_err());
    }
}
