use crate::{
    errors::{AppError, AppResult},
    models::{FileChangeRecord, FileHistorySnapshot, FileHistorySummary},
};
use std::{
    collections::BTreeMap,
    sync::{LazyLock, Mutex},
};

#[derive(Default)]
pub(crate) struct HistoryState {
    pub(crate) revision: u64,
    pub(crate) undo: Vec<HistoryEntry>,
    pub(crate) redo: Vec<HistoryEntry>,
}

#[derive(Clone)]
pub(crate) struct HistoryEntry {
    pub(crate) summary: FileHistorySummary,
    pub(crate) changes: Vec<FileChangeRecord>,
}

static HISTORIES: LazyLock<Mutex<BTreeMap<String, HistoryState>>> =
    LazyLock::new(|| Mutex::new(BTreeMap::new()));
static HISTORY_LIMIT: Mutex<usize> = Mutex::new(100);

pub fn release_history(root: &str) -> AppResult<()> {
    let root = root.to_lowercase();
    lock_histories()?.remove(&root);
    Ok(())
}

pub fn set_history_limit(limit: usize) -> AppResult<()> {
    *HISTORY_LIMIT.lock().map_err(|_| history_error())? = limit;
    for history in lock_histories()?.values_mut() {
        if history.undo.len() > limit {
            trim_history(history, limit);
            history.revision += 1;
        }
    }
    Ok(())
}

pub(crate) fn snapshot(history: &HistoryState) -> FileHistorySnapshot {
    FileHistorySnapshot {
        revision: history.revision,
        undo_stack: history
            .undo
            .iter()
            .map(|entry| entry.summary.clone())
            .collect(),
        redo_stack: history
            .redo
            .iter()
            .map(|entry| entry.summary.clone())
            .collect(),
    }
}

pub(crate) fn trim_history(history: &mut HistoryState, limit: usize) {
    let remove = history.undo.len().saturating_sub(limit);
    history.undo.drain(..remove);
}

pub(crate) fn history_limit() -> AppResult<usize> {
    HISTORY_LIMIT
        .lock()
        .map(|limit| *limit)
        .map_err(|_| history_error())
}
pub(crate) fn lock_histories()
-> AppResult<std::sync::MutexGuard<'static, BTreeMap<String, HistoryState>>> {
    HISTORIES.lock().map_err(|_| history_error())
}
fn history_error() -> AppError {
    AppError::message("history.lock_poisoned", "file history lock poisoned")
}
