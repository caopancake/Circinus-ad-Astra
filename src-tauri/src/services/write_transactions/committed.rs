use crate::{
    errors::{AppError, AppResult},
    models::{CommittedProjection, CommittedSessionUpdate, FileChangeRecord},
};
use std::{
    collections::BTreeMap,
    sync::{LazyLock, Mutex},
};

struct CommitEntry {
    changes: Vec<FileChangeRecord>,
    update: CommittedSessionUpdate,
}

#[derive(Default)]
struct RootCommits {
    sequence: u64,
    entries: BTreeMap<(String, u64), CommitEntry>,
}

static COMMITS: LazyLock<Mutex<BTreeMap<String, RootCommits>>> =
    LazyLock::new(|| Mutex::new(BTreeMap::new()));

fn commits() -> AppResult<std::sync::MutexGuard<'static, BTreeMap<String, RootCommits>>> {
    COMMITS
        .lock()
        .map_err(|_| AppError::message("write.sync_lock_poisoned", "提交同步登记不可用"))
}

pub(super) fn next_commit(root: &str) -> AppResult<u64> {
    let mut states = commits()?;
    let state = states.entry(root.to_string()).or_default();
    state.sequence += 1;
    Ok(state.sequence)
}

pub(super) fn project_commit(
    root: &str,
    commit_id: u64,
    session_id: Option<&str>,
    changes: &[FileChangeRecord],
) -> AppResult<Vec<CommittedSessionUpdate>> {
    let affected = if changes.is_empty() {
        session_id
            .map(|id| {
                crate::services::project::current_projection(id)
                    .map(|projection| vec![(id.to_string(), projection.manifest.mod_root)])
            })
            .transpose()?
            .unwrap_or_default()
    } else {
        crate::services::project::affected_session_ids(changes)?
    };
    let mut updates = Vec::new();
    for (session_id, mod_root) in affected {
        let result = if changes.is_empty() {
            crate::services::project::current_projection(&session_id)
        } else {
            crate::services::project::invalidate_project_session(&session_id, changes.to_vec())
        };
        let projection = match result {
            Ok(projection) => CommittedProjection::Ready {
                projection: std::sync::Arc::new(projection),
            },
            Err(error) => {
                crate::services::project::mark_projection_pending(&session_id)?;
                CommittedProjection::Pending {
                    error: error.diagnostic(),
                }
            }
        };
        let update = CommittedSessionUpdate {
            session_id: session_id.clone(),
            mod_root,
            commit_id,
            projection,
        };
        let mut states = commits()?;
        let state = states.entry(root.to_string()).or_default();
        let pending_changes = if matches!(update.projection, CommittedProjection::Pending { .. }) {
            changes.to_vec()
        } else {
            Vec::new()
        };
        state.entries.insert(
            (session_id, commit_id),
            CommitEntry {
                changes: pending_changes,
                update: update.clone(),
            },
        );
        updates.push(update);
    }
    Ok(updates)
}

pub(super) fn synchronize(
    root: &str,
    session_id: &str,
    commit_id: u64,
) -> AppResult<CommittedSessionUpdate> {
    let saved = {
        let states = commits()?;
        let state = states
            .get(root)
            .ok_or_else(|| AppError::message("write.commit_unknown", "提交同步记录不存在"))?;
        state
            .entries
            .get(&(session_id.to_string(), commit_id))
            .map(|entry| (entry.changes.clone(), entry.update.clone()))
            .ok_or_else(|| {
                AppError::message("write.commit_unknown", "所属会话提交同步记录不存在")
            })?
    };
    if let CommittedProjection::Ready { .. } = saved.1.projection {
        return Ok(saved.1);
    }
    let projection =
        crate::services::project::invalidate_project_session(session_id, saved.0.clone())?;
    let mut update = saved.1;
    update.projection = CommittedProjection::Ready {
        projection: std::sync::Arc::new(projection),
    };
    let mut states = commits()?;
    let entry = states
        .get_mut(root)
        .expect("synchronized root remains registered")
        .entries
        .get_mut(&(session_id.to_string(), commit_id))
        .expect("synchronized commit remains registered");
    entry.update = update.clone();
    entry.changes.clear();
    Ok(update)
}

pub(super) fn synchronize_pending(root: &str) -> AppResult<()> {
    let pending = commits()?
        .get(root)
        .map(|state| {
            state
                .entries
                .iter()
                .filter(|(_, entry)| {
                    matches!(entry.update.projection, CommittedProjection::Pending { .. })
                })
                .map(|((session, id), _)| (session.clone(), *id))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for (session, id) in pending {
        synchronize(root, &session, id)?;
    }
    Ok(())
}

pub(super) fn release(session_id: &str) -> AppResult<()> {
    for state in commits()?.values_mut() {
        state
            .entries
            .retain(|(session, _), _| session != session_id);
    }
    Ok(())
}
