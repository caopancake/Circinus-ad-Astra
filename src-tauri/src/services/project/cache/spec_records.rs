use crate::{
    errors::AppResult,
    io::{FsRootBoundary, forward_slash_path, walk_json_dir},
    models::{EntityFileLocation, LoadedSpecRecord, ResourceSource},
};
use std::{collections::BTreeMap, path::Path};

pub(crate) fn load_spec_records(
    root: &Path,
    directory: &str,
    extension: &str,
    id_field: &str,
    source: ResourceSource,
) -> AppResult<BTreeMap<String, LoadedSpecRecord>> {
    let boundary = FsRootBoundary::new(root, "spec root")?;
    let mut records = BTreeMap::new();
    let spec_directory = boundary.resolve_relative(directory, "spec directory")?;
    let mut files = walk_json_dir(&spec_directory, extension, "spec")?;
    files.sort_by(|left, right| left.0.cmp(&right.0));
    for (path, data) in files {
        if let Some(id) = data.get(id_field).and_then(serde_json::Value::as_str) {
            let id = id.to_string();
            let rel_path = forward_slash_path(
                path.strip_prefix(boundary.root())
                    .expect("loaded spec belongs to its root"),
            );
            records.insert(
                id.clone(),
                LoadedSpecRecord {
                    id,
                    location: EntityFileLocation {
                        source,
                        root: boundary.root().to_string_lossy().to_string(),
                        rel_path,
                        path: path.to_string_lossy().to_string(),
                    },
                    data,
                },
            );
        }
    }
    Ok(records)
}
