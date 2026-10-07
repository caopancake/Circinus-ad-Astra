use crate::{
    errors::{AppError, AppResult},
    io::{
        FsRootBoundary, RootWriteLock, acquire_root_write_lock, build_text_change,
        read_text_bytes_no_bom, read_utf8_no_bom,
    },
    models::{EditableFileData, FileChangeReplayDirection, WriteResult},
    services::file_changes::apply_file_change_set_with_lock,
};
use std::path::Path;

pub fn save_text_file(mod_root: &str, path: &str, text: String) -> AppResult<WriteResult> {
    let write_lock = acquire_root_write_lock(Path::new(mod_root))?;
    save_text_file_with_lock(mod_root, path, text, write_lock)
}

fn save_text_file_with_lock(
    mod_root: &str,
    path: &str,
    text: String,
    write_lock: RootWriteLock,
) -> AppResult<WriteResult> {
    let path = Path::new(path);
    let boundary = FsRootBoundary::new(Path::new(mod_root), "mod root")?;
    let path = boundary.resolve_absolute(path, "file path")?;
    let change = build_text_change(&path, Some(text))?;
    apply_file_change_set_with_lock(
        mod_root,
        FileChangeReplayDirection::Redo,
        vec![change.clone()],
        write_lock,
    )?;
    Ok(WriteResult::from_changes(vec![change]))
}

pub fn load_editable_file(mod_root: &str, path: String) -> AppResult<EditableFileData> {
    let target = Path::new(&path);
    let boundary = FsRootBoundary::new(Path::new(mod_root), "mod root")?;
    let target = boundary.resolve_absolute(target, "file path")?;
    read_utf8_no_bom(&target).map(|text| EditableFileData {
        path: target.display().to_string(),
        text,
    })
}

/// Converts a legacy-encoded file to UTF-8 through the sanctioned text-write
/// changeset. Decoding follows the user-chosen source encoding only — there is
/// no automatic detection — and a file that is already valid UTF-8 is refused
/// so a repeated click cannot re-mangle the converted content.
pub fn transcode_file_to_utf8(
    mod_root: &str,
    path: &str,
    encoding: &str,
) -> AppResult<WriteResult> {
    let write_lock = acquire_root_write_lock(Path::new(mod_root))?;
    let target = Path::new(path);
    let boundary = FsRootBoundary::new(Path::new(mod_root), "mod root")?;
    let target = boundary.resolve_absolute(target, "file path")?;
    let bytes = read_text_bytes_no_bom(&target)?;
    if std::str::from_utf8(&bytes).is_ok() {
        return Err(AppError::message(
            "text.transcode_not_needed",
            format!("{} is already valid UTF-8", target.display()),
        ));
    }
    let encoding = encoding_rs::Encoding::for_label(encoding.as_bytes()).ok_or_else(|| {
        AppError::message(
            "text.transcode_encoding_unknown",
            format!("unknown source encoding: {encoding}"),
        )
    })?;
    let (text, _, had_errors) = encoding.decode(&bytes);
    if had_errors {
        return Err(AppError::message(
            "text.transcode_undecodable",
            format!(
                "{} cannot be fully decoded as {}",
                target.display(),
                encoding.name()
            ),
        ));
    }
    save_text_file_with_lock(mod_root, path, text.into_owned(), write_lock)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::write_utf8_no_bom;
    use crate::testutil::{temp_dir, temp_linked_dir};
    use std::fs;

    #[test]
    fn recovery_editor_loads_file_inside_mod_root() {
        let root = temp_dir("recovery_editor_loads_inside_root");
        let target = root.join("mod_info.json");
        write_utf8_no_bom(&target, "{\"id\":\"demo\"}").unwrap();

        let loaded = load_editable_file(
            &root.to_string_lossy(),
            target.to_string_lossy().to_string(),
        )
        .unwrap();

        let _ = fs::remove_dir_all(root);
        assert_eq!(loaded.text, "{\"id\":\"demo\"}");
    }

    #[test]
    fn recovery_editor_saves_file_inside_mod_root() {
        let root = temp_dir("recovery_editor_saves_inside_root");
        let target = root.join("mod_info.json");
        write_utf8_no_bom(&target, "{").unwrap();

        let result = save_text_file(
            &root.to_string_lossy(),
            &target.to_string_lossy(),
            "{}".to_string(),
        )
        .unwrap();
        let saved = std::fs::read_to_string(&target).unwrap();

        let _ = fs::remove_dir_all(root);
        assert_eq!(saved, "{}");
        assert_eq!(result.changes.len(), 1);
    }

    #[test]
    fn save_text_file_rejects_path_outside_mod_root() {
        let root = temp_dir("save_text_file_rejects_external_root");
        let outside = temp_dir("save_text_file_rejects_external_outside");

        let result = save_text_file(
            &root.to_string_lossy(),
            &outside.join("outside.txt").to_string_lossy(),
            "bad".to_string(),
        );

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
        assert!(result.is_err());
    }

    #[test]
    fn save_text_file_rejects_parent_dir_escape() {
        let root = temp_dir("save_text_file_rejects_parent_dir_escape");
        let escaped = root.join("..").join("outside.txt");

        let result = save_text_file(
            &root.to_string_lossy(),
            &escaped.to_string_lossy(),
            "bad".to_string(),
        );

        let _ = fs::remove_dir_all(root);
        assert!(result.is_err());
    }

    #[test]
    fn load_editable_file_rejects_path_outside_mod_root() {
        let root = temp_dir("load_editable_file_rejects_external_root");
        let outside = temp_dir("load_editable_file_rejects_external_outside");
        let outside_file = outside.join("outside.txt");
        write_utf8_no_bom(&outside_file, "bad").unwrap();

        let result = load_editable_file(
            &root.to_string_lossy(),
            outside_file.to_string_lossy().to_string(),
        );

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
        assert!(result.is_err());
    }

    #[test]
    fn load_editable_file_rejects_parent_dir_escape() {
        let root = temp_dir("load_editable_file_rejects_parent_dir_escape");
        let escaped = root.join("..").join("outside.txt");

        let result = load_editable_file(
            &root.to_string_lossy(),
            escaped.to_string_lossy().to_string(),
        );

        let _ = fs::remove_dir_all(root);
        assert!(result.is_err());
    }

    #[test]
    fn save_text_file_rejects_link_parent_escape() {
        let Some((root, outside, linked)) = temp_linked_dir("save_text_link_escape", "linked")
        else {
            return;
        };

        let result = save_text_file(
            &root.to_string_lossy(),
            &linked.join("outside.txt").to_string_lossy(),
            "bad".to_string(),
        );

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
        assert!(result.is_err());
    }

    #[test]
    fn load_editable_file_rejects_link_parent_escape() {
        let Some((root, outside, linked)) = temp_linked_dir("load_text_link_escape", "linked")
        else {
            return;
        };
        write_utf8_no_bom(&outside.join("outside.txt"), "bad").unwrap();

        let result = load_editable_file(
            &root.to_string_lossy(),
            linked.join("outside.txt").to_string_lossy().to_string(),
        );

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
        assert!(result.is_err());
    }

    #[test]
    fn transcodes_legacy_encoding_to_utf8() {
        let root = temp_dir("transcode_legacy_to_utf8");
        let target = root.join("notes.txt");
        let (encoded, _, _) = encoding_rs::GB18030.encode("舰船注释");
        fs::write(&target, encoded).unwrap();

        let result = transcode_file_to_utf8(
            &root.to_string_lossy(),
            &target.to_string_lossy(),
            "gb18030",
        )
        .unwrap();
        let saved = fs::read(&target).unwrap();

        let _ = fs::remove_dir_all(root);
        assert_eq!(String::from_utf8(saved).unwrap(), "舰船注释");
        assert_eq!(result.changes.len(), 1);
    }

    #[test]
    fn transcode_refuses_already_utf8_file() {
        let root = temp_dir("transcode_refuses_utf8");
        let target = root.join("notes.txt");
        write_utf8_no_bom(&target, "已是 UTF-8").unwrap();

        let result = transcode_file_to_utf8(
            &root.to_string_lossy(),
            &target.to_string_lossy(),
            "gb18030",
        );

        let _ = fs::remove_dir_all(root);
        assert!(result.is_err());
    }

    #[test]
    fn transcode_refuses_undecodable_bytes() {
        let root = temp_dir("transcode_undecodable");
        let target = root.join("notes.txt");
        // A lone 0x81 is an incomplete GB18030 sequence. Windows-1252 is a
        // total mapping and never reports errors; GB18030 does.
        fs::write(&target, [0x81u8]).unwrap();

        let result = transcode_file_to_utf8(
            &root.to_string_lossy(),
            &target.to_string_lossy(),
            "gb18030",
        );

        let _ = fs::remove_dir_all(root);
        assert!(result.is_err());
    }

    #[test]
    fn transcode_rejects_path_outside_mod_root() {
        let root = temp_dir("transcode_rejects_external_root");
        let outside = temp_dir("transcode_rejects_external_outside");
        let outside_file = outside.join("notes.txt");
        fs::write(&outside_file, [0x81u8]).unwrap();

        let result = transcode_file_to_utf8(
            &root.to_string_lossy(),
            &outside_file.to_string_lossy(),
            "gb18030",
        );

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
        assert!(result.is_err());
    }
}
