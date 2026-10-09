use crate::{
    errors::{AppError, AppResult, JsonRewriteFile},
    io::{read_utf8_no_bom, validate_walk_entry},
    models::JsonWriteOptions,
    parsers::{PreserveResult, json_root_tail, parse_starsector_json, preserve_json_text},
};
use serde_json::Value;
use std::{
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
};
use walkdir::WalkDir;

pub fn read_json_file(path: &Path) -> AppResult<Value> {
    let text = read_utf8_no_bom(path)?;
    parse_starsector_json(&text).map_err(|error| {
        AppError::context(format!("解析 JSON 文件失败 ({})", path.display()), error).at_path(path)
    })
}

pub struct JsonWriteBatch {
    options: JsonWriteOptions,
    pending: Vec<JsonRewriteFile>,
}

impl JsonWriteBatch {
    pub fn new(options: JsonWriteOptions) -> Self {
        Self {
            options,
            pending: Vec::new(),
        }
    }

    pub fn render(
        &mut self,
        source_path: &Path,
        value: &Value,
        ordered_json: Option<&str>,
    ) -> AppResult<String> {
        let normalized = serde_json::to_string_pretty(value)?;
        if !self.options.preserve_original_json || !source_path.exists() {
            return Ok(normalized);
        }
        let source = read_utf8_no_bom(source_path)?;
        match preserve_json_text(&source, value, ordered_json).map_err(|error| {
            AppError::context(
                format!("解析 JSON 文件失败 ({})", source_path.display()),
                error,
            )
            .at_path(source_path)
        })? {
            PreserveResult::Preserved(text) => Ok(text),
            PreserveResult::NeedsRewrite(reason) => {
                let path = source_path.to_string_lossy().to_string();
                let source_fingerprint = fingerprint(&std::fs::read(source_path)?);
                let confirmed =
                    self.options.confirmed_sources.iter().any(|item| {
                        item.path == path && item.source_fingerprint == source_fingerprint
                    });
                if !confirmed {
                    self.pending.push(JsonRewriteFile {
                        path,
                        reason: reason.to_string(),
                        source_fingerprint,
                    });
                }
                let tail = json_root_tail(&source).ok_or_else(|| {
                    AppError::message(
                        "json.root_tail_unknown",
                        format!("无法确定 JSON 根对象结束位置: {}", source_path.display()),
                    )
                })?;
                let rewritten = format!("{normalized}{tail}");
                if parse_starsector_json(&rewritten).ok().as_ref() != Some(value) {
                    return Err(AppError::message(
                        "json.rewrite_invalid",
                        format!("JSON 重排结果核验失败: {}", source_path.display()),
                    ));
                }
                Ok(rewritten)
            }
        }
    }

    pub fn finish(self) -> AppResult<()> {
        if self.pending.is_empty() {
            Ok(())
        } else {
            Err(AppError::JsonRewriteRequired {
                files: self.pending,
            })
        }
    }
}

fn fingerprint(bytes: &[u8]) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// The single directory-walk entry for loose spec JSON: every JSON directory
/// scan shares this error context, link validation and exact-match extension
/// filter (case-sensitive, no dot).
pub fn walk_json_dir(dir: &Path, ext: &str, label: &str) -> AppResult<Vec<(PathBuf, Value)>> {
    if !dir.exists() {
        return Ok(vec![]);
    }
    if !dir.is_dir() {
        return Err(AppError::message(
            "json.dir_not_directory",
            format!("JSON 目录不是目录: {}", dir.display()),
        ));
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::JsonSourceConfirmation;
    use crate::testutil::temp_dir;
    use std::fs;

    #[test]
    fn json_read_attaches_actual_path_to_parser_position() {
        let dir = temp_dir("json_error_location");
        let path = dir.join("nested.skin");
        crate::io::write_utf8_no_bom(&path, "{\n\"id\":1,\"id\":2}").unwrap();
        let error = read_json_file(&path).unwrap_err();
        assert_eq!(error.code(), "json.duplicate_key");
        assert_eq!(
            error.location().unwrap().path.as_deref(),
            Some(path.to_str().unwrap())
        );
        assert_eq!(error.location().unwrap().line, Some(2));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn json_write_preserves_all_business_dictionary_keys() {
        let content = serde_json::json!({"_source":"business","nested":{"_slot":"weapon"},"array":[{"_tool":1}]});
        let mut batch = JsonWriteBatch::new(JsonWriteOptions::default());
        let text = batch
            .render(Path::new("business.json"), &content, None)
            .unwrap();
        batch.finish().unwrap();
        assert_eq!(parse_starsector_json(&text).unwrap(), content);
    }

    #[test]
    fn preserves_existing_json_and_rejects_unconfirmed_rewrite() {
        let dir = temp_dir("json_write_batch_confirmation");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("demo.json");
        crate::io::write_utf8_no_bom(&path, "{a:[1,,2], # keep\n b:3}\nEND").unwrap();
        let mut batch = JsonWriteBatch::new(JsonWriteOptions {
            preserve_original_json: true,
            confirmed_sources: Vec::new(),
        });
        let value = serde_json::json!({"a":[1,null,2],"b":4});
        let _ = batch.render(&path, &value, None).unwrap();
        let files = match batch.finish().unwrap_err() {
            AppError::JsonRewriteRequired { files } => files,
            error => panic!("unexpected error: {error}"),
        };
        assert_eq!(files.len(), 1);
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "{a:[1,,2], # keep\n b:3}\nEND"
        );

        let mut confirmed = JsonWriteBatch::new(JsonWriteOptions {
            preserve_original_json: true,
            confirmed_sources: vec![JsonSourceConfirmation {
                path: files[0].path.clone(),
                source_fingerprint: files[0].source_fingerprint.clone(),
            }],
        });
        let rendered = confirmed.render(&path, &value, None).unwrap();
        confirmed.finish().unwrap();
        assert_eq!(parse_starsector_json(&rendered).unwrap(), value);
        assert!(rendered.ends_with("\nEND"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn confirmation_is_rejected_after_source_changes() {
        let dir = temp_dir("json_write_batch_changed_source");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("demo.json");
        crate::io::write_utf8_no_bom(&path, "{a:[1,,2]}").unwrap();
        let value = serde_json::json!({"a":[1,null,3]});
        let mut batch = JsonWriteBatch::new(JsonWriteOptions {
            preserve_original_json: true,
            confirmed_sources: Vec::new(),
        });
        batch.render(&path, &value, None).unwrap();
        let files = match batch.finish().unwrap_err() {
            AppError::JsonRewriteRequired { files } => files,
            error => panic!("unexpected error: {error}"),
        };
        crate::io::write_utf8_no_bom(&path, "{a:[1,,2], b:4}").unwrap();
        let mut retry = JsonWriteBatch::new(JsonWriteOptions {
            preserve_original_json: true,
            confirmed_sources: vec![JsonSourceConfirmation {
                path: files[0].path.clone(),
                source_fingerprint: files[0].source_fingerprint.clone(),
            }],
        });
        retry.render(&path, &value, None).unwrap();
        assert!(matches!(
            retry.finish(),
            Err(AppError::JsonRewriteRequired { .. })
        ));
        let _ = fs::remove_dir_all(dir);
    }
}

/// Real-mod semantic replay fixtures (sanitised subset of a third-party mod).
/// The contract under test: read a supported JSON spec into memory, write it
/// back through the production JSON serialisation, and read it again — the initial and final in-memory values
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
            let text = serde_json::to_string_pretty(&first).expect("serialisation must succeed");
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
