use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

fn unique_suffix() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos()
}

pub(crate) fn temp_path(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("circinus_ad_astra_{name}_{}", unique_suffix()))
}

pub(crate) fn temp_dir(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("circinus_ad_astra_{name}_{}", unique_suffix()));
    std::fs::create_dir_all(&path).unwrap();
    path
}

/// Creates a temp root with a directory link at `root.join(rel_link)` pointing
/// to a sibling temp dir; returns `(root, outside, link)`, or None (after
/// cleanup) when the platform or environment forbids creating links.
pub(crate) fn temp_linked_dir(name: &str, rel_link: &str) -> Option<(PathBuf, PathBuf, PathBuf)> {
    let root = temp_dir(&format!("{name}_root"));
    let outside = temp_dir(&format!("{name}_outside"));
    let link = root.join(rel_link);
    std::fs::create_dir_all(link.parent().unwrap()).unwrap();
    if create_dir_link(&outside, &link).is_err() {
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
        return None;
    }
    Some((root, outside, link))
}

#[cfg(windows)]
pub(crate) fn temp_junction_dir(name: &str, rel_link: &str) -> (PathBuf, PathBuf, PathBuf) {
    let root = temp_dir(&format!("{name}_root"));
    let outside = temp_dir(&format!("{name}_outside"));
    let link = root.join(rel_link);
    std::fs::create_dir_all(link.parent().unwrap()).unwrap();
    let output = std::process::Command::new("cmd")
        .args(["/c", "mklink", "/J"])
        .arg(link.to_string_lossy().replace('/', "\\"))
        .arg(outside.to_string_lossy().replace('/', "\\"))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "junction fixture: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    (root, outside, link)
}

/// Creates a temp root with a file link at `root.join(rel_link)` pointing to a
/// temp file path; returns `(root, outside, link)`, or None (after cleanup)
/// when the platform or environment forbids creating links.
pub(crate) fn temp_linked_file(name: &str, rel_link: &str) -> Option<(PathBuf, PathBuf, PathBuf)> {
    let root = temp_dir(&format!("{name}_root"));
    let outside = temp_path(&format!("{name}_outside"));
    let link = root.join(rel_link);
    std::fs::create_dir_all(link.parent().unwrap()).unwrap();
    if create_file_link(&outside, &link).is_err() {
        let _ = std::fs::remove_dir_all(&root);
        return None;
    }
    Some((root, outside, link))
}

#[cfg(windows)]
fn create_dir_link(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_dir(target, link)
}

#[cfg(unix)]
fn create_dir_link(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(not(any(windows, unix)))]
fn create_dir_link(_target: &Path, _link: &Path) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "directory links are unsupported on this platform",
    ))
}

#[cfg(windows)]
fn create_file_link(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_file(target, link)
}

#[cfg(unix)]
fn create_file_link(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(not(any(windows, unix)))]
fn create_file_link(_target: &Path, _link: &Path) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "file links are unsupported on this platform",
    ))
}
