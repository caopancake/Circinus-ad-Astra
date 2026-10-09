use crate::{
    errors::{AppError, AppResult},
    io::FsRootBoundary,
    models::FileVersion,
};
use base64::{Engine as _, engine::general_purpose};
use std::path::Path;

pub fn file_version(path: &Path) -> AppResult<FileVersion> {
    let fingerprint = if path.is_file() {
        let bytes = std::fs::read(path)?;
        Some(fingerprint(&bytes))
    } else if path.is_dir() {
        let mut files = Vec::new();
        for entry in walkdir::WalkDir::new(path) {
            let entry =
                entry.map_err(|error| AppError::message("io.walk_failed", error.to_string()))?;
            crate::io::validate_walk_entry(entry.path(), "versioned directory")?;
            if entry.file_type().is_file() {
                files.push((
                    crate::io::forward_slash_path(
                        entry
                            .path()
                            .strip_prefix(path)
                            .expect("walk entry belongs to root"),
                    ),
                    std::fs::read(entry.path())?,
                ));
            }
        }
        files.sort_by(|left, right| left.0.cmp(&right.0));
        Some(fingerprint(&serde_json::to_vec(&files)?))
    } else {
        None
    };
    Ok(FileVersion {
        path: path.to_string_lossy().to_string(),
        fingerprint,
    })
}

pub fn version_after_change(change: &crate::models::FileChangeRecord) -> AppResult<FileVersion> {
    let content = if !change.after_exists {
        None
    } else {
        Some(match change.kind {
            crate::models::FileChangeKind::File => fingerprint(&snapshot_bytes(
                change.after_text.as_deref(),
                change.after_data_base64.as_deref(),
            )?),
            crate::models::FileChangeKind::Directory => {
                let mut files = change
                    .after_files
                    .iter()
                    .map(|file| {
                        Ok((
                            file.rel_path.replace('\\', "/"),
                            snapshot_bytes(file.text.as_deref(), file.data_base64.as_deref())?,
                        ))
                    })
                    .collect::<AppResult<Vec<_>>>()?;
                files.sort_by(|left, right| left.0.cmp(&right.0));
                fingerprint(&serde_json::to_vec(&files)?)
            }
        })
    };
    Ok(FileVersion {
        path: change.after_path.clone(),
        fingerprint: content,
    })
}

fn snapshot_bytes(text: Option<&str>, binary: Option<&str>) -> AppResult<Vec<u8>> {
    if let Some(text) = text {
        return Ok(text.as_bytes().to_vec());
    }
    general_purpose::STANDARD
        .decode(binary.expect("applied snapshot has content"))
        .map_err(|error| AppError::message("changeset.invalid_data", error.to_string()))
}

fn fingerprint(bytes: &[u8]) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes {
        hash = (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3);
    }
    format!("{}:{hash:016x}", bytes.len())
}

pub fn verify_versions(root: &str, versions: &[FileVersion]) -> AppResult<()> {
    let boundary = FsRootBoundary::new(Path::new(root), "version root")?;
    for expected in versions {
        let path = boundary.resolve_absolute(Path::new(&expected.path), "versioned file")?;
        if file_version(&path)?.fingerprint != expected.fingerprint {
            return Err(AppError::message(
                "write.version_conflict",
                format!("文件已被修改，请载入外部版本后重新保存: {}", path.display()),
            ));
        }
    }
    Ok(())
}
