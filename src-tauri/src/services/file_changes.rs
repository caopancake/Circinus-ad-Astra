use crate::{
    errors::AppResult,
    io::{
        ChangeDirection, FileChangeSetBuilder, FsRootBoundary, JsonWriteBatch, RootWriteLock,
        acquire_root_write_lock, apply_changes, validate_safe_relative_path,
    },
    models::{
        AssociatedFileChange, FileChangeRecord, FileChangeReplayDirection, JsonWriteOptions,
        WriteResult,
    },
};
use serde_json::Value;
use std::path::Path;

pub fn save_mod_files(mod_root: &str, files: Vec<AssociatedFileChange>) -> AppResult<WriteResult> {
    let mut builder = FileChangeSetBuilder::new(Path::new(mod_root))?;
    for file in files {
        builder.file(&file.rel_path, file.after_text, file.after_data_base64)?;
    }
    builder.apply().map(write_result)
}

pub fn save_mod_info(
    mod_root: &str,
    data: Value,
    options: JsonWriteOptions,
    ordered_json: Option<&str>,
) -> AppResult<WriteResult> {
    let mut builder = FileChangeSetBuilder::new(Path::new(mod_root))?;
    let mut json = JsonWriteBatch::new(options);
    let target = builder.root().join("mod_info.json");
    let text = json.render(&target, &data, ordered_json)?;
    json.finish()?;
    if target.exists() && crate::io::read_utf8_no_bom(&target)? == text {
        return Ok(WriteResult::from_changes(Vec::new()));
    }
    builder.text_file("mod_info.json", Some(text))?;
    builder.apply().map(write_result)
}

pub fn apply_file_change_set(
    mod_root: &str,
    direction: FileChangeReplayDirection,
    changes: Vec<FileChangeRecord>,
) -> AppResult<WriteResult> {
    let write_lock = acquire_root_write_lock(Path::new(mod_root))?;
    apply_file_change_set_with_lock(mod_root, direction, changes, write_lock)
}

pub(crate) fn apply_file_change_set_with_lock(
    mod_root: &str,
    direction: FileChangeReplayDirection,
    changes: Vec<FileChangeRecord>,
    _write_lock: RootWriteLock,
) -> AppResult<WriteResult> {
    validate_changeset_paths(mod_root, &changes)?;
    apply_changes(&changes, change_direction(direction))?;
    Ok(write_result(changes))
}

fn change_direction(direction: FileChangeReplayDirection) -> ChangeDirection {
    match direction {
        FileChangeReplayDirection::Undo => ChangeDirection::Undo,
        FileChangeReplayDirection::Redo => ChangeDirection::Redo,
    }
}

fn write_result(changes: Vec<FileChangeRecord>) -> WriteResult {
    WriteResult::from_changes(changes)
}

fn validate_changeset_paths(mod_root: &str, changes: &[FileChangeRecord]) -> AppResult<()> {
    let boundary = FsRootBoundary::new(Path::new(mod_root), "mod root")?;
    for change in changes {
        boundary.resolve_absolute(Path::new(&change.path), "changeset path")?;
        for file in change.before_files.iter().chain(change.after_files.iter()) {
            validate_snapshot_relative_path(&file.rel_path)?;
        }
    }
    Ok(())
}

fn validate_snapshot_relative_path(path: &str) -> AppResult<()> {
    validate_safe_relative_path(Path::new(path), "file snapshot").map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::testutil::{temp_dir, temp_linked_dir};
    use crate::{
        io::{
            build_directory_delete_change, build_file_change, read_utf8_no_bom, write_utf8_no_bom,
        },
        models::{AssociatedFileChange, FileChangeKind, FileChangeReplayDirection, FileSnapshot},
    };
    use base64::{Engine as _, engine::general_purpose};
    use std::fs;

    #[test]
    fn mod_info_save_keeps_source_when_semantics_are_unchanged() {
        let root = temp_dir("save_mod_info_preserve");
        let path = root.join("mod_info.json");
        write_utf8_no_bom(&path, "{\n  # note\n  id: 'demo'\n}\n").unwrap();
        let result = save_mod_info(
            &root.to_string_lossy(),
            serde_json::json!({"id":"demo"}),
            JsonWriteOptions {
                preserve_original_json: true,
                confirmed_sources: Vec::new(),
            },
            Some(r#"{"id":"demo"}"#),
        )
        .unwrap();
        assert!(result.changes.is_empty());
        assert_eq!(
            read_utf8_no_bom(&path).unwrap(),
            "{\n  # note\n  id: 'demo'\n}\n"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn save_mod_files_writes_multiple_files_in_one_changeset() {
        let root = temp_dir("save_mod_files_changeset");
        write_utf8_no_bom(&root.join("mod_info.json"), "{\"id\":\"old\"}").unwrap();

        let result = save_mod_files(
            &root.to_string_lossy(),
            vec![
                AssociatedFileChange {
                    rel_path: "mod_info.json".to_string(),
                    after_text: Some("{\"id\":\"new\"}".to_string()),
                    after_data_base64: None,
                },
                AssociatedFileChange {
                    rel_path: "data/missions/demo/mission_text.txt".to_string(),
                    after_text: Some("text".to_string()),
                    after_data_base64: None,
                },
            ],
        )
        .unwrap();

        let mod_info = read_utf8_no_bom(&root.join("mod_info.json")).unwrap();
        let mission_text =
            read_utf8_no_bom(&root.join("data/missions/demo/mission_text.txt")).unwrap();
        let expected_paths = [
            path_string(root.join("mod_info.json")),
            path_string(root.join("data/missions/demo/mission_text.txt")),
        ];

        let _ = fs::remove_dir_all(&root);
        assert_eq!(change_paths(&result.changes), expected_paths);
        assert_eq!(result.invalidation.paths, change_paths(&result.changes));
        assert_eq!(mod_info, "{\"id\":\"new\"}");
        assert_eq!(mission_text, "text");
    }

    #[test]
    fn save_mod_files_rejects_path_traversal() {
        let root = temp_dir("save_mod_files_rejects_path");

        let result = save_mod_files(
            &root.to_string_lossy(),
            vec![AssociatedFileChange {
                rel_path: "../outside.txt".to_string(),
                after_text: Some("bad".to_string()),
                after_data_base64: None,
            }],
        );

        let _ = fs::remove_dir_all(root);
        assert!(result.is_err());
    }

    #[test]
    fn save_mod_files_rejects_non_file_relative_paths() {
        let root = temp_dir("save_mod_files_rejects_non_file_relative_paths");

        for rel_path in ["", ".", "data/./demo.txt", "C:outside.txt"] {
            let result = save_mod_files(
                &root.to_string_lossy(),
                vec![AssociatedFileChange {
                    rel_path: rel_path.to_string(),
                    after_text: Some("bad".to_string()),
                    after_data_base64: None,
                }],
            );

            assert!(result.is_err(), "{rel_path}");
        }

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn save_mod_files_rejects_link_parent_escape() {
        let Some((root, outside, _linked)) =
            temp_linked_dir("save_mod_files_link_escape", "linked")
        else {
            return;
        };

        let result = save_mod_files(
            &root.to_string_lossy(),
            vec![AssociatedFileChange {
                rel_path: "linked/outside.txt".to_string(),
                after_text: Some("bad".to_string()),
                after_data_base64: None,
            }],
        );

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
        assert!(result.is_err());
    }

    #[test]
    fn write_result_expands_directory_change_invalidation_paths() {
        let root = temp_dir("directory_invalidation_paths");
        let dir = root.join("data/variants/nested");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("demo.variant"), "{}").unwrap();

        let change = build_directory_delete_change(&dir).unwrap();
        let result = write_result(vec![change]);

        let _ = fs::remove_dir_all(root);
        assert!(
            result
                .invalidation
                .paths
                .iter()
                .any(|path| path_string(path) == path_string(&dir))
        );
        assert!(
            result
                .invalidation
                .paths
                .iter()
                .any(|path| { path_string(path) == path_string(dir.join("demo.variant")) })
        );
    }

    #[test]
    fn directory_delete_change_roundtrips_text_snapshot() {
        let root = temp_dir("directory_delete_roundtrip");
        let dir = root.join("data/missions/demo");
        fs::create_dir_all(dir.join("nested")).unwrap();
        write_utf8_no_bom(&dir.join("descriptor.json"), "{\"title\":\"Demo\"}").unwrap();
        write_utf8_no_bom(&dir.join("nested/readme.txt"), "details").unwrap();
        fs::write(dir.join("icon.bin"), [0, 159, 146, 150]).unwrap();

        let change = build_directory_delete_change(&dir).unwrap();
        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            vec![change.clone()],
        )
        .unwrap();
        assert!(!dir.exists());

        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Undo,
            vec![change],
        )
        .unwrap();

        let descriptor = read_utf8_no_bom(&dir.join("descriptor.json")).unwrap();
        let nested = read_utf8_no_bom(&dir.join("nested/readme.txt")).unwrap();
        let icon = fs::read(dir.join("icon.bin")).unwrap();
        let _ = fs::remove_dir_all(root);
        assert_eq!(descriptor, "{\"title\":\"Demo\"}");
        assert_eq!(nested, "details");
        assert_eq!(icon, vec![0, 159, 146, 150]);
    }

    #[test]
    fn binary_file_change_can_create_undo_and_redo() {
        let root = temp_dir("binary_file_create_history");
        let path = root.join("graphics/ships/demo.png");
        let change = build_file_change(
            &path,
            None,
            Some(general_purpose::STANDARD.encode([1, 2, 3])),
        )
        .unwrap();

        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            vec![change.clone()],
        )
        .unwrap();
        assert_eq!(fs::read(&path).unwrap(), vec![1, 2, 3]);

        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Undo,
            vec![change.clone()],
        )
        .unwrap();
        assert!(!path.exists());

        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            vec![change],
        )
        .unwrap();
        let bytes = fs::read(&path).unwrap();
        let _ = fs::remove_dir_all(root);
        assert_eq!(bytes, vec![1, 2, 3]);
    }

    #[test]
    fn binary_file_change_can_overwrite_and_restore() {
        let root = temp_dir("binary_file_overwrite_history");
        let path = root.join("graphics/ships/demo.png");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, [9, 8, 7]).unwrap();
        let change = build_file_change(
            &path,
            None,
            Some(general_purpose::STANDARD.encode([1, 2, 3])),
        )
        .unwrap();

        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            vec![change.clone()],
        )
        .unwrap();
        assert_eq!(fs::read(&path).unwrap(), vec![1, 2, 3]);

        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Undo,
            vec![change.clone()],
        )
        .unwrap();
        assert_eq!(fs::read(&path).unwrap(), vec![9, 8, 7]);

        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            vec![change],
        )
        .unwrap();
        let bytes = fs::read(&path).unwrap();
        let _ = fs::remove_dir_all(root);
        assert_eq!(bytes, vec![1, 2, 3]);
    }

    #[test]
    fn binary_file_change_can_delete_and_restore() {
        let root = temp_dir("binary_file_delete_history");
        let path = root.join("graphics/ships/demo.png");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, [9, 8, 7]).unwrap();
        let change = build_file_change(&path, None, None).unwrap();

        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            vec![change.clone()],
        )
        .unwrap();
        assert!(!path.exists());

        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Undo,
            vec![change],
        )
        .unwrap();
        let bytes = fs::read(&path).unwrap();
        let _ = fs::remove_dir_all(root);
        assert_eq!(bytes, vec![9, 8, 7]);
    }

    #[test]
    fn replay_rejects_changeset_path_outside_mod_root() {
        let root = temp_dir("changeset_rejects_external_path");
        let outside = temp_dir("changeset_rejects_external_outside");
        let change =
            build_file_change(&outside.join("outside.txt"), Some("bad".to_string()), None).unwrap();

        let result = apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            vec![change],
        );

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
        assert!(result.is_err());
    }

    #[test]
    fn replay_rejects_parent_dir_escape() {
        let root = temp_dir("changeset_rejects_parent_dir_escape");
        let change = build_file_change(
            &root.join("..").join("outside.txt"),
            Some("bad".to_string()),
            None,
        )
        .unwrap();

        let result = apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            vec![change],
        );

        let _ = fs::remove_dir_all(root);
        assert!(result.is_err());
    }

    #[test]
    fn replay_rejects_link_parent_escape() {
        let Some((root, outside, linked)) = temp_linked_dir("replay_link_escape", "linked") else {
            return;
        };
        let change = FileChangeRecord {
            kind: FileChangeKind::File,
            path: linked.join("outside.txt").to_string_lossy().to_string(),
            before_exists: false,
            before_text: None,
            before_data_base64: None,
            before_files: vec![],
            after_exists: true,
            after_text: Some("bad".to_string()),
            after_data_base64: None,
            after_files: vec![],
        };

        let result = apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            vec![change],
        );

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
        assert!(result.is_err());
    }

    #[test]
    fn replay_rejects_link_directory_delete() {
        let Some((root, outside, linked)) =
            temp_linked_dir("replay_link_directory_delete", "linked")
        else {
            return;
        };
        let change = FileChangeRecord {
            kind: FileChangeKind::Directory,
            path: linked.to_string_lossy().to_string(),
            before_exists: true,
            before_text: None,
            before_data_base64: None,
            before_files: vec![],
            after_exists: false,
            after_text: None,
            after_data_base64: None,
            after_files: vec![],
        };

        let result = apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            vec![change],
        );

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
        assert!(result.is_err());
    }

    #[test]
    fn replay_rejects_directory_snapshot_parent_dir_before_apply() {
        let root = temp_dir("changeset_rejects_snapshot_parent_dir");
        let dir = root.join("data/missions/demo");
        fs::create_dir_all(&dir).unwrap();
        write_utf8_no_bom(&dir.join("mission_text.txt"), "keep").unwrap();
        let change = FileChangeRecord {
            kind: FileChangeKind::Directory,
            path: dir.to_string_lossy().to_string(),
            before_exists: true,
            before_text: None,
            before_data_base64: None,
            before_files: vec![],
            after_exists: true,
            after_text: None,
            after_data_base64: None,
            after_files: vec![FileSnapshot {
                rel_path: "../outside.txt".to_string(),
                text: Some("bad".to_string()),
                data_base64: None,
            }],
        };

        let result = apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            vec![change],
        );
        let text = read_utf8_no_bom(&dir.join("mission_text.txt")).unwrap();

        let _ = fs::remove_dir_all(root);
        assert!(result.is_err());
        assert_eq!(text, "keep");
    }

    #[test]
    fn replay_rejects_invalid_directory_snapshot_relative_paths_before_apply() {
        let root = temp_dir("changeset_rejects_invalid_snapshot_rel_path");
        let dir = root.join("data/missions/demo");
        fs::create_dir_all(&dir).unwrap();
        write_utf8_no_bom(&dir.join("mission_text.txt"), "keep").unwrap();

        for rel_path in ["", ".", "nested/./bad.txt", "C:outside.txt"] {
            let change = FileChangeRecord {
                kind: FileChangeKind::Directory,
                path: dir.to_string_lossy().to_string(),
                before_exists: true,
                before_text: None,
                before_data_base64: None,
                before_files: vec![],
                after_exists: true,
                after_text: None,
                after_data_base64: None,
                after_files: vec![FileSnapshot {
                    rel_path: rel_path.to_string(),
                    text: Some("bad".to_string()),
                    data_base64: None,
                }],
            };

            let result = apply_file_change_set(
                &root.to_string_lossy(),
                FileChangeReplayDirection::Redo,
                vec![change],
            );
            let text = read_utf8_no_bom(&dir.join("mission_text.txt")).unwrap();

            assert!(result.is_err(), "{rel_path}");
            assert_eq!(text, "keep", "{rel_path}");
        }

        let _ = fs::remove_dir_all(root);
    }

    fn change_paths(changes: &[crate::models::FileChangeRecord]) -> Vec<String> {
        changes.iter().map(|change| change.path.clone()).collect()
    }

    fn path_string(path: impl AsRef<Path>) -> String {
        path.as_ref()
            .canonicalize()
            .unwrap_or_else(|_| path.as_ref().to_path_buf())
            .to_string_lossy()
            .to_string()
    }
}
