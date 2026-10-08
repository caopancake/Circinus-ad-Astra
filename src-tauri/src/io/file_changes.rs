use crate::{
    errors::{AppError, AppResult},
    io::{
        FsRootBoundary, read_utf8_no_bom, validate_safe_relative_path, validate_walk_entry,
        write_utf8_no_bom,
    },
    models::{FileChangeKind, FileChangeRecord, FileSnapshot},
};
use base64::{Engine as _, engine::general_purpose};
use std::{
    cell::RefCell,
    collections::BTreeMap,
    fs,
    path::Path,
    sync::{Arc, Condvar, LazyLock, Mutex, Weak},
};
use walkdir::WalkDir;

static ROOT_WRITE_COORDINATORS: LazyLock<Mutex<BTreeMap<String, Weak<RootWriteCoordinator>>>> =
    LazyLock::new(|| Mutex::new(BTreeMap::new()));

struct RootWriteCoordinator {
    tickets: Mutex<(u64, u64)>,
    released: Condvar,
}

thread_local! {
    static ACTIVE_WRITES: RefCell<BTreeMap<String, Weak<RootWriteLease>>> = const { RefCell::new(BTreeMap::new()) };
}

struct RootWriteLease {
    coordinator: Arc<RootWriteCoordinator>,
}

pub struct RootWriteLock {
    _lease: Arc<RootWriteLease>,
}

impl Drop for RootWriteLease {
    fn drop(&mut self) {
        if let Ok(mut tickets) = self.coordinator.tickets.lock() {
            tickets.1 += 1;
            self.coordinator.released.notify_all();
        }
    }
}

pub fn acquire_root_write_lock(root: &Path) -> AppResult<RootWriteLock> {
    let canonical_root = FsRootBoundary::new(root, "write root")?
        .root()
        .to_string_lossy()
        .to_string();
    #[cfg(windows)]
    let canonical_root = canonical_root.to_lowercase();
    // Nested synchronous services share the transaction's lease.
    if let Some(lease) =
        ACTIVE_WRITES.with(|active| active.borrow().get(&canonical_root).and_then(Weak::upgrade))
    {
        return Ok(RootWriteLock { _lease: lease });
    }
    let coordinator = {
        let mut coordinators = ROOT_WRITE_COORDINATORS.lock().map_err(|_| {
            AppError::message("write.lock_poisoned", "write coordinator lock poisoned")
        })?;
        coordinators.retain(|_, coordinator| coordinator.strong_count() > 0);
        if let Some(coordinator) = coordinators.get(&canonical_root).and_then(Weak::upgrade) {
            coordinator
        } else {
            let coordinator = Arc::new(RootWriteCoordinator {
                tickets: Mutex::new((0, 0)),
                released: Condvar::new(),
            });
            coordinators.insert(canonical_root.clone(), Arc::downgrade(&coordinator));
            coordinator
        }
    };
    let mut tickets = coordinator
        .tickets
        .lock()
        .map_err(|_| AppError::message("write.lock_poisoned", "write coordinator lock poisoned"))?;
    let ticket = tickets.0;
    tickets.0 += 1;
    while tickets.1 != ticket {
        tickets = coordinator.released.wait(tickets).map_err(|_| {
            AppError::message("write.lock_poisoned", "write coordinator lock poisoned")
        })?;
    }
    drop(tickets);
    let lease = Arc::new(RootWriteLease { coordinator });
    ACTIVE_WRITES.with(|active| {
        let mut active = active.borrow_mut();
        active.retain(|_, lease| lease.strong_count() > 0);
        active.insert(canonical_root, Arc::downgrade(&lease));
    });
    Ok(RootWriteLock { _lease: lease })
}

pub struct FileChangeSetBuilder {
    boundary: FsRootBoundary,
    changes: Vec<FileChangeRecord>,
    _write_lock: RootWriteLock,
}

impl FileChangeSetBuilder {
    pub fn new(root: &Path) -> AppResult<Self> {
        let boundary = FsRootBoundary::new(root, "changeset root")?;
        let write_lock = acquire_root_write_lock(boundary.root())?;
        Ok(Self {
            boundary,
            changes: Vec::new(),
            _write_lock: write_lock,
        })
    }

    pub fn new_with_lock(root: &Path, write_lock: RootWriteLock) -> AppResult<Self> {
        Ok(Self {
            boundary: FsRootBoundary::new(root, "changeset root")?,
            changes: Vec::new(),
            _write_lock: write_lock,
        })
    }

    pub fn root(&self) -> &Path {
        self.boundary.root()
    }

    pub fn text_file(
        &mut self,
        rel_path: impl AsRef<str>,
        after_text: Option<String>,
    ) -> AppResult<&mut Self> {
        self.file(rel_path, after_text, None)
    }

    pub fn file(
        &mut self,
        rel_path: impl AsRef<str>,
        after_text: Option<String>,
        after_data_base64: Option<String>,
    ) -> AppResult<&mut Self> {
        let target = self
            .boundary
            .resolve_relative(rel_path.as_ref(), "relative file")?;
        self.changes
            .push(build_file_change(&target, after_text, after_data_base64)?);
        Ok(self)
    }

    pub fn root_text_file(
        &mut self,
        rel_path: impl AsRef<str>,
        after_text: Option<String>,
    ) -> AppResult<&mut Self> {
        let target = self
            .boundary
            .resolve_relative(rel_path.as_ref(), "relative file")?;
        self.changes.push(build_text_change(&target, after_text)?);
        Ok(self)
    }

    pub fn delete_directory(&mut self, rel_path: impl AsRef<str>) -> AppResult<&mut Self> {
        let target = self
            .boundary
            .resolve_relative(rel_path.as_ref(), "relative directory")?;
        self.changes.push(build_directory_delete_change(&target)?);
        Ok(self)
    }

    pub fn copy_directory(
        &mut self,
        source_rel_path: impl AsRef<str>,
        target_rel_path: impl AsRef<str>,
    ) -> AppResult<&mut Self> {
        let source = self
            .boundary
            .resolve_relative(source_rel_path.as_ref(), "source directory")?;
        let target = self
            .boundary
            .resolve_relative(target_rel_path.as_ref(), "target directory")?;
        let after_files = if source.exists() {
            snapshot_directory(&source)?
        } else {
            vec![]
        };
        self.changes
            .push(build_directory_replace_change(&target, after_files)?);
        Ok(self)
    }

    pub fn apply(self) -> AppResult<Vec<FileChangeRecord>> {
        apply_changes(&self.changes, ChangeDirection::Redo)?;
        Ok(self.changes)
    }
}

#[derive(Clone, Copy)]
pub enum ChangeDirection {
    Undo,
    Redo,
}

pub fn build_text_change(path: &Path, after_text: Option<String>) -> AppResult<FileChangeRecord> {
    build_file_change(path, after_text, None)
}

pub fn build_file_change(
    path: &Path,
    after_text: Option<String>,
    after_data_base64: Option<String>,
) -> AppResult<FileChangeRecord> {
    if path.exists() {
        validate_walk_entry(path, "file change")?;
    }
    let before_exists = path.exists();
    let (before_text, before_data_base64) = if before_exists {
        snapshot_file_content(path)?
    } else {
        (None, None)
    };
    if let Some(data) = &after_data_base64 {
        general_purpose::STANDARD.decode(data).map_err(|e| {
            AppError::context(format!("解码文件数据失败 ({})", path.display()), e.into())
        })?;
    }
    Ok(FileChangeRecord {
        kind: FileChangeKind::File,
        path: path.to_string_lossy().to_string(),
        before_exists,
        before_text,
        before_data_base64,
        before_files: vec![],
        after_exists: after_text.is_some() || after_data_base64.is_some(),
        after_text,
        after_data_base64,
        after_files: vec![],
    })
}

pub fn build_directory_delete_change(path: &Path) -> AppResult<FileChangeRecord> {
    if path.exists() {
        validate_walk_entry(path, "directory change")?;
    }
    let before_exists = path.exists();
    let before_files = if before_exists {
        snapshot_directory(path)?
    } else {
        vec![]
    };
    Ok(FileChangeRecord {
        kind: FileChangeKind::Directory,
        path: path.to_string_lossy().to_string(),
        before_exists,
        before_text: None,
        before_data_base64: None,
        before_files,
        after_exists: false,
        after_text: None,
        after_data_base64: None,
        after_files: vec![],
    })
}

pub fn build_directory_replace_change(
    path: &Path,
    after_files: Vec<FileSnapshot>,
) -> AppResult<FileChangeRecord> {
    if path.exists() {
        validate_walk_entry(path, "directory change")?;
    }
    let before_exists = path.exists();
    let before_files = if before_exists {
        snapshot_directory(path)?
    } else {
        vec![]
    };
    Ok(FileChangeRecord {
        kind: FileChangeKind::Directory,
        path: path.to_string_lossy().to_string(),
        before_exists,
        before_text: None,
        before_data_base64: None,
        before_files,
        after_exists: true,
        after_text: None,
        after_data_base64: None,
        after_files,
    })
}

pub fn apply_changes(changes: &[FileChangeRecord], direction: ChangeDirection) -> AppResult<()> {
    let rollback = changes
        .iter()
        .map(|change| build_current_state(Path::new(&change.path)))
        .collect::<AppResult<Vec<_>>>()?;
    for (index, change) in changes.iter().enumerate() {
        if let Err(error) = apply_one(change, direction) {
            return Err(changeset_apply_error(
                error,
                rollback_changes(&rollback[..=index]),
            ));
        }
    }
    Ok(())
}

fn validate_relative_path(path: &str) -> AppResult<&Path> {
    validate_safe_relative_path(Path::new(path), "relative file")
}

fn apply_one(change: &FileChangeRecord, direction: ChangeDirection) -> AppResult<()> {
    match change.kind {
        FileChangeKind::File => apply_file_change(change, direction),
        FileChangeKind::Directory => apply_directory_change(change, direction),
    }
}

fn apply_file_change(change: &FileChangeRecord, direction: ChangeDirection) -> AppResult<()> {
    let (exists, text, data_base64) = match direction {
        ChangeDirection::Undo => (
            change.before_exists,
            change.before_text.as_deref(),
            change.before_data_base64.as_deref(),
        ),
        ChangeDirection::Redo => (
            change.after_exists,
            change.after_text.as_deref(),
            change.after_data_base64.as_deref(),
        ),
    };
    let path = Path::new(&change.path);
    if path.exists() {
        validate_walk_entry(path, "file change")?;
    }
    if exists {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        if let Some(text) = text {
            write_utf8_no_bom(path, text)?;
        } else if let Some(data) = data_base64 {
            let bytes = general_purpose::STANDARD.decode(data).map_err(|e| {
                AppError::context(format!("解码文件数据失败 ({})", path.display()), e.into())
            })?;
            fs::write(path, bytes)?;
        } else {
            return Err(AppError::message(
                "changeset.missing_content",
                "changeset missing file content",
            ));
        }
    } else if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn apply_directory_change(change: &FileChangeRecord, direction: ChangeDirection) -> AppResult<()> {
    let (exists, files) = match direction {
        ChangeDirection::Undo => (change.before_exists, &change.before_files),
        ChangeDirection::Redo => (change.after_exists, &change.after_files),
    };
    let path = Path::new(&change.path);
    if path.exists() {
        validate_walk_entry(path, "directory change")?;
        fs::remove_dir_all(path)?;
    }
    if exists {
        fs::create_dir_all(path)?;
        for file in files {
            let rel = validate_relative_path(&file.rel_path)?;
            let target = path.join(rel);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            restore_snapshot_file(&target, file)?;
        }
    }
    Ok(())
}

fn build_current_state(path: &Path) -> AppResult<FileChangeRecord> {
    if path.exists() {
        validate_walk_entry(path, "current changeset state")?;
    }
    if path.is_dir() {
        // before and after are the same current state; walk once.
        let files = snapshot_directory(path)?;
        return Ok(FileChangeRecord {
            kind: FileChangeKind::Directory,
            path: path.to_string_lossy().to_string(),
            before_exists: true,
            before_text: None,
            before_data_base64: None,
            before_files: files.clone(),
            after_exists: true,
            after_text: None,
            after_data_base64: None,
            after_files: files,
        });
    }
    let exists = path.exists();
    let (text, data_base64) = if exists {
        snapshot_file_content(path)?
    } else {
        (None, None)
    };
    Ok(FileChangeRecord {
        kind: FileChangeKind::File,
        path: path.to_string_lossy().to_string(),
        before_exists: exists,
        before_text: text.clone(),
        before_data_base64: data_base64.clone(),
        before_files: vec![],
        after_exists: exists,
        after_text: text,
        after_data_base64: data_base64,
        after_files: vec![],
    })
}

fn rollback_changes(changes: &[FileChangeRecord]) -> Vec<String> {
    let mut errors = Vec::new();
    for change in changes.iter().rev() {
        if let Err(error) = apply_one(change, ChangeDirection::Redo) {
            errors.push(format!("{}: {}", change.path, error));
        }
    }
    errors
}

fn changeset_apply_error(apply_error: AppError, rollback_errors: Vec<String>) -> AppError {
    if rollback_errors.is_empty() {
        return apply_error;
    }
    AppError::context(
        format!(
            "changeset apply failed and rollback failed; disk state may be partially changed; rollback errors: {}",
            rollback_errors.join(" | ")
        ),
        apply_error,
    )
}

fn snapshot_directory(path: &Path) -> AppResult<Vec<FileSnapshot>> {
    let mut files = Vec::new();
    for entry in WalkDir::new(path).into_iter() {
        let entry = entry.map_err(|error| {
            AppError::context(
                format!("遍历目录失败 ({})", path.display()),
                AppError::message("io.walk_failed", error.to_string()),
            )
        })?;
        validate_walk_entry(entry.path(), "directory snapshot")?;
        if !entry.file_type().is_file() {
            continue;
        }
        let rel_path = entry
            .path()
            .strip_prefix(path)
            .map_err(|error| AppError::message("path.relative_failed", error.to_string()))?
            .to_string_lossy()
            .replace('\\', "/");
        files.push(snapshot_file(entry.path(), rel_path)?);
    }
    files.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    Ok(files)
}

fn snapshot_file(path: &Path, rel_path: String) -> AppResult<FileSnapshot> {
    let (text, data_base64) = snapshot_file_content(path)?;
    Ok(FileSnapshot {
        rel_path,
        text,
        data_base64,
    })
}

fn snapshot_file_content(path: &Path) -> AppResult<(Option<String>, Option<String>)> {
    match read_utf8_no_bom(path) {
        Ok(text) => Ok((Some(text), None)),
        // Only text-semantics failures degrade to a binary snapshot; IO and
        // permission errors are real failures and must surface.
        Err(error) if matches!(error.code(), "text.invalid_utf8" | "text.bom") => {
            let bytes = fs::read(path)?;
            Ok((None, Some(general_purpose::STANDARD.encode(bytes))))
        }
        Err(error) => Err(error),
    }
}

fn restore_snapshot_file(path: &Path, file: &FileSnapshot) -> AppResult<()> {
    if let Some(text) = &file.text {
        write_utf8_no_bom(path, text)?;
        return Ok(());
    }
    let data = file.data_base64.as_deref().ok_or_else(|| {
        AppError::message(
            "changeset.missing_snapshot_data",
            "directory snapshot missing file data",
        )
    })?;
    let bytes = general_purpose::STANDARD.decode(data).map_err(|e| {
        AppError::context(format!("解码文件数据失败 ({})", path.display()), e.into())
    })?;
    fs::write(path, bytes)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;
    use std::{fs, sync::mpsc, thread, time::Duration};

    #[test]
    fn root_queue_is_fifo_and_reentrant() {
        let root = temp_dir("fifo_root_queue");
        let held = acquire_root_write_lock(&root).unwrap();
        let nested = acquire_root_write_lock(&root).unwrap();
        let (sent, received) = mpsc::channel();
        let mut workers = Vec::new();
        for index in 1..=2 {
            let worker_root = root.clone();
            let sent = sent.clone();
            workers.push(thread::spawn(move || {
                let _lease = acquire_root_write_lock(&worker_root).unwrap();
                sent.send(index).unwrap();
            }));
            let start = std::time::Instant::now();
            while held._lease.coordinator.tickets.lock().unwrap().0 < index + 1 {
                assert!(start.elapsed() < Duration::from_secs(3));
                thread::yield_now();
            }
        }
        drop(nested);
        assert!(received.recv_timeout(Duration::from_millis(30)).is_err());
        drop(held);
        assert_eq!(received.recv_timeout(Duration::from_secs(3)).unwrap(), 1);
        assert_eq!(received.recv_timeout(Duration::from_secs(3)).unwrap(), 2);
        for worker in workers {
            worker.join().unwrap();
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn root_write_lock_serializes_same_canonical_root() {
        let root = temp_dir("root_write_lock_serializes");
        let held = acquire_root_write_lock(&root).unwrap();
        let (started_tx, started_rx) = mpsc::channel();
        let (released_tx, released_rx) = mpsc::channel();
        let thread_root = root.clone();
        let worker = thread::spawn(move || {
            started_tx.send(()).unwrap();
            let _lock = acquire_root_write_lock(&thread_root).unwrap();
            released_tx.send(()).unwrap();
        });
        started_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(released_rx.recv_timeout(Duration::from_millis(50)).is_err());
        drop(held);
        released_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        worker.join().unwrap();
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn later_snapshot_failure_keeps_all_earlier_targets_unchanged() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = temp_dir("snapshot_preflight");
        let first = root.join("first.txt");
        let second = root.join("second.txt");
        fs::write(&first, "first before").unwrap();
        fs::write(&second, "second before").unwrap();
        let changes = [
            build_text_change(&first, Some("first after".to_string())).unwrap(),
            build_text_change(&second, Some("second after".to_string())).unwrap(),
        ];
        let locked = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&second)
            .unwrap();
        let result = apply_changes(&changes, ChangeDirection::Redo);
        let first_after = fs::read_to_string(&first).unwrap();
        drop(locked);
        fs::remove_dir_all(root).unwrap();
        assert!(result.is_err());
        assert_eq!(first_after, "first before");
    }

    #[test]
    fn rollback_changes_reports_restore_errors() {
        let root = temp_dir("rollback_reports_restore_errors");
        fs::create_dir_all(&root).unwrap();
        let change = FileChangeRecord {
            kind: FileChangeKind::File,
            path: root.to_string_lossy().to_string(),
            before_exists: true,
            before_text: Some("before".to_string()),
            before_data_base64: None,
            before_files: vec![],
            after_exists: true,
            after_text: Some("before".to_string()),
            after_data_base64: None,
            after_files: vec![],
        };

        let errors = rollback_changes(&[change]);

        let _ = fs::remove_dir_all(root);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("rollback_reports_restore_errors"));
    }

    #[test]
    fn changeset_apply_error_includes_apply_and_rollback_errors() {
        let error = changeset_apply_error(
            AppError::message("changeset.apply_failed", "apply failed"),
            vec![
                "first rollback failed".to_string(),
                "second rollback failed".to_string(),
            ],
        )
        .to_string();

        assert!(error.contains("changeset apply failed and rollback failed"));
        assert!(error.contains("apply failed"));
        assert!(error.contains("first rollback failed"));
        assert!(error.contains("second rollback failed"));
    }
}
