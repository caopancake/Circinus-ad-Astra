use crate::{
    errors::{AppError, AppResult},
    io::{read_utf8_no_bom, validate_walk_entry},
    parsers::parse_starsector_json,
};
use serde_json::{Map, Value};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};
use walkdir::WalkDir;

pub fn read_json_file(path: &Path) -> AppResult<Value> {
    let text = read_utf8_no_bom(path)?;
    parse_starsector_json(&text).map_err(|error| {
        AppError::context(format!("解析 JSON 文件失败 ({})", path.display()), error)
    })
}

pub fn load_json_dir_by_id(
    dir: &Path,
    ext: &str,
    id_key: &str,
) -> AppResult<BTreeMap<String, Value>> {
    let mut result = BTreeMap::new();
    for (_, value) in walk_json_dir(dir, ext, "JSON")? {
        if let Some(id) = value.get(id_key).and_then(Value::as_str) {
            result.insert(id.to_string(), value);
        }
    }
    Ok(result)
}

pub fn load_json_dir(dir: &Path, ext: &str) -> AppResult<Vec<Value>> {
    Ok(walk_json_dir(dir, ext, "JSON")?
        .into_iter()
        .map(|(_, value)| value)
        .collect())
}

/// The single directory-walk entry for loose spec JSON: every JSON directory
/// scan shares this error context, link validation and exact-match extension
/// filter (case-sensitive, no dot).
pub fn walk_json_dir(dir: &Path, ext: &str, label: &str) -> AppResult<Vec<(PathBuf, Value)>> {
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut files = Vec::new();
    for entry in WalkDir::new(dir).into_iter() {
        let entry = entry.map_err(|error| {
            AppError::context(
                format!("遍历 {label} 目录失败 ({})", dir.display()),
                AppError::message("io.walk_failed", error.to_string()),
            )
        })?;
        validate_walk_entry(entry.path(), &format!("{label} directory"))?;
        if entry.path().extension().and_then(|s| s.to_str()) != Some(ext) {
            continue;
        }
        let path = entry.path().to_path_buf();
        files.push((path.clone(), read_json_file(&path)?));
    }
    Ok(files)
}

pub fn strip_internal_fields(value: &Value) -> Value {
    match value {
        Value::Object(obj) => {
            let mut clean = Map::new();
            for (key, val) in obj {
                if !key.starts_with('_') {
                    clean.insert(key.clone(), strip_internal_fields(val));
                }
            }
            Value::Object(clean)
        }
        Value::Array(items) => Value::Array(items.iter().map(strip_internal_fields).collect()),
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_internal_fields_recursively() {
        let value = serde_json::json!({"id":"x","_source":"mod","nested":{"_temp":1,"ok":2}});
        let clean = strip_internal_fields(&value);
        assert!(clean.get("_source").is_none());
        assert_eq!(clean["nested"]["ok"], 2);
        assert!(clean["nested"].get("_temp").is_none());
    }
}

/// Real-mod semantic replay fixtures (sanitised subset of a third-party mod).
/// The contract under test: read a supported JSON spec into memory, write it
/// back through the production serialisation (internal-field strip plus
/// pretty print), and read it again — the initial and final in-memory values
/// must be equal. Byte identity of the rewritten file is explicitly not
/// required: pretty printing and key ordering are product normalisations.
#[cfg(test)]
mod fixture_replay_tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn fixture_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("testdata/json")
    }

    #[test]
    fn collected_real_json_fixtures_round_trip_in_memory() {
        let dir = fixture_dir();
        let mut checked = 0;
        for entry in fs::read_dir(&dir).expect("testdata/json must exist") {
            let path = entry.expect("readable entry").path();
            if path.is_dir() {
                continue;
            }
            let first = read_json_file(&path)
                .unwrap_or_else(|error| panic!("{} must parse: {error}", path.display()));
            let clean = strip_internal_fields(&first);
            let text = serde_json::to_string_pretty(&clean).expect("serialisation must succeed");
            let second = parse_starsector_json(&text)
                .unwrap_or_else(|error| panic!("rewritten {} must parse: {error}", path.display()));
            assert_eq!(first, second, "semantic replay drift in {}", path.display());
            checked += 1;
        }
        assert!(
            checked >= 21,
            "expected the full collected fixture set, saw {checked}"
        );
    }
}
