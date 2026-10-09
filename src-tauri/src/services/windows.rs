use crate::{
    errors::{AppError, AppResult},
    models::{ManagedWindowOpened, ManagedWindowRequest, ManagedWindowStatus, WindowIdentity},
};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Condvar, LazyLock, Mutex, mpsc},
};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Default)]
struct WindowRegistry {
    sequence: u64,
    identities: BTreeMap<WindowIdentity, String>,
    instances: BTreeMap<String, WindowInstance>,
    reservations: BTreeMap<WindowIdentity, String>,
    close_requests: BTreeMap<u64, CloseRequest>,
    closing_sessions: BTreeSet<String>,
}

struct CloseRequest {
    session_id: Option<String>,
    labels: BTreeSet<String>,
    sender: mpsc::Sender<bool>,
}

struct WindowInstance {
    identity: WindowIdentity,
    creating: bool,
    guard_ready: bool,
    status: ManagedWindowStatus,
}

impl WindowRegistry {
    fn register(&mut self, identity: WindowIdentity) -> String {
        self.sequence += 1;
        let label = format!("managed-{}", self.sequence);
        self.identities
            .insert(identity.comparison_key(), label.clone());
        self.instances.insert(
            label.clone(),
            WindowInstance {
                identity,
                creating: true,
                guard_ready: false,
                status: Default::default(),
            },
        );
        label
    }
    fn release(&mut self, label: &str) {
        if let Some(instance) = self.instances.remove(label) {
            self.identities.remove(&instance.identity.comparison_key());
        }
        self.reservations.retain(|_, owner| owner != label);
        let completed = self
            .close_requests
            .iter_mut()
            .filter_map(|(id, request)| {
                request.labels.remove(label);
                request.labels.is_empty().then_some(*id)
            })
            .collect::<Vec<_>>();
        for id in completed {
            let _ = self
                .close_requests
                .remove(&id)
                .expect("completed close request")
                .sender
                .send(true);
        }
    }
    fn conflict(&self, label: &str, identities: &[WindowIdentity]) -> Option<String> {
        identities.iter().find_map(|identity| {
            let key = identity.comparison_key();
            self.reservations
                .get(&key)
                .filter(|owner| owner.as_str() != label)
                .cloned()
                .or_else(|| {
                    self.identities
                        .get(&key)
                        .filter(|owner| owner.as_str() != label)
                        .filter(|owner| {
                            self.instances.get(*owner).is_some_and(|instance| {
                                instance.status.dirty || instance.status.saving || instance.creating
                            })
                        })
                        .cloned()
                })
        })
    }
    fn reserve(&mut self, label: &str, identities: &[WindowIdentity]) -> Result<(), String> {
        if let Some(conflict) = self.conflict(label, identities) {
            return Err(conflict);
        }
        for identity in identities {
            self.reservations
                .insert(identity.comparison_key(), label.to_string());
        }
        Ok(())
    }
    fn retarget(&mut self, label: &str, identity: WindowIdentity) {
        let instance = self
            .instances
            .get_mut(label)
            .expect("retargeted window is registered");
        self.identities.remove(&instance.identity.comparison_key());
        instance.identity = identity;
        self.identities
            .insert(instance.identity.comparison_key(), label.to_string());
    }
}

static REGISTRY: LazyLock<(Mutex<WindowRegistry>, Condvar)> =
    LazyLock::new(|| (Mutex::new(WindowRegistry::default()), Condvar::new()));
fn registry() -> AppResult<std::sync::MutexGuard<'static, WindowRegistry>> {
    REGISTRY
        .0
        .lock()
        .map_err(|_| AppError::message("window.registry_poisoned", "窗口登记状态不可用"))
}

pub fn open_managed_window(
    app: &tauri::AppHandle,
    request: ManagedWindowRequest,
) -> AppResult<ManagedWindowOpened> {
    if let WindowIdentity::Spec {
        session_id,
        mod_root,
        ..
    }
    | WindowIdentity::File {
        session_id,
        mod_root,
        ..
    } = &request.identity
    {
        super::project::ensure_project_session_mod_root(session_id, mod_root)?;
    }
    let key = request.identity.comparison_key();
    let label = {
        let mut state = registry()?;
        loop {
            if request
                .identity
                .session_id()
                .is_some_and(|session| state.closing_sessions.contains(session))
            {
                return Err(AppError::message(
                    "window.session_closing",
                    "所属会话正在关闭",
                ));
            }
            if let Some(owner) = state.reservations.get(&key) {
                return Err(AppError::message(
                    "window.identity_reserved",
                    format!("目标正在保存: {owner}"),
                ));
            }
            if let Some(label) = state.identities.get(&key).cloned() {
                if state.instances[&label].creating {
                    state = REGISTRY.1.wait(state).map_err(|_| {
                        AppError::message("window.registry_poisoned", "窗口登记状态不可用")
                    })?;
                    continue;
                }
                drop(state);
                if let Some(window) = app.get_webview_window(&label) {
                    window.show()?;
                    window.set_focus()?;
                }
                return Ok(ManagedWindowOpened {
                    label,
                    reused: true,
                });
            }
            break state.register(request.identity);
        }
    };
    let built = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(request.url.into()))
        .title(request.title)
        .visible(false)
        .inner_size(request.width, request.height)
        .min_inner_size(request.min_width, request.min_height)
        .build();
    let mut state = registry()?;
    let close_after_creation = state
        .close_requests
        .values()
        .any(|request| request.labels.contains(&label));
    match built {
        Ok(window) => {
            if let Some(instance) = state.instances.get_mut(&label) {
                instance.creating = false;
            } else {
                return Err(AppError::message(
                    "window.session_closing",
                    "窗口创建期间所属生命周期已结束",
                ));
            }
            REGISTRY.1.notify_all();
            if close_after_creation {
                drop(state);
                window.destroy()?;
                return Err(AppError::message(
                    "window.session_closing",
                    "所属会话正在关闭",
                ));
            }
        }
        Err(error) => {
            state.release(&label);
            REGISTRY.1.notify_all();
            return Err(error.into());
        }
    }
    REGISTRY.1.notify_all();
    Ok(ManagedWindowOpened {
        label,
        reused: false,
    })
}

pub fn release_window(label: &str) -> AppResult<()> {
    registry()?.release(label);
    REGISTRY.1.notify_all();
    Ok(())
}

pub fn update_status(label: &str, status: ManagedWindowStatus) -> AppResult<()> {
    if let Some(instance) = registry()?.instances.get_mut(label) {
        instance.status = status;
        instance.guard_ready = true;
    }
    Ok(())
}

pub fn reserve_targets(
    app: &tauri::AppHandle,
    label: &str,
    identities: Vec<WindowIdentity>,
) -> AppResult<()> {
    let displaced = {
        let mut state = registry()?;
        if let Err(conflict) = state.reserve(label, &identities) {
            drop(state);
            if let Some(window) = app.get_webview_window(&conflict) {
                window.show()?;
                window.set_focus()?;
            }
            return Err(AppError::message(
                "window.target_unsaved",
                "目标窗口有待保存内容，请先完成该窗口的编辑",
            ));
        }
        identities
            .iter()
            .filter_map(|identity| state.identities.get(&identity.comparison_key()))
            .filter(|owner| owner.as_str() != label)
            .cloned()
            .collect::<BTreeSet<_>>()
    };
    if !displaced.is_empty() {
        let waiting = match request_close(app, displaced.clone(), true, None) {
            Ok(waiting) => waiting,
            Err(error) => {
                release_targets(label)?;
                return Err(error);
            }
        };
        if !waiting
            .recv()
            .map_err(|error| AppError::message("window.lifecycle_wait", error.to_string()))?
        {
            release_targets(label)?;
            if let Some(conflict) = displaced.iter().next()
                && let Some(window) = app.get_webview_window(conflict)
            {
                window.show()?;
                window.set_focus()?;
            }
            return Err(AppError::message(
                "window.target_unsaved",
                "目标窗口有待保存内容，请先完成该窗口的编辑",
            ));
        }
    }
    Ok(())
}

fn request_close(
    app: &tauri::AppHandle,
    labels: BTreeSet<String>,
    only_if_clean: bool,
    session_id: Option<String>,
) -> AppResult<mpsc::Receiver<bool>> {
    let (sender, receiver) = mpsc::channel();
    let (intent, unready) = {
        let mut state = registry()?;
        let labels = labels
            .into_iter()
            .filter(|label| state.instances.contains_key(label))
            .collect::<BTreeSet<_>>();
        if labels.is_empty() {
            let _ = sender.send(true);
            return Ok(receiver);
        }
        let unready = labels
            .iter()
            .filter(|label| !state.instances[*label].guard_ready)
            .cloned()
            .collect::<Vec<_>>();
        state.sequence += 1;
        let id = state.sequence;
        let intent = crate::models::WindowCloseIntent {
            request_id: id,
            labels: labels.iter().cloned().collect(),
            only_if_clean,
        };
        state.close_requests.insert(
            id,
            CloseRequest {
                labels,
                sender,
                session_id,
            },
        );
        (intent, unready)
    };
    if let Err(error) = app.emit("window-lifecycle-close-requested", &intent) {
        cancel_request(&mut *registry()?, intent.request_id);
        return Err(error.into());
    }
    for label in unready {
        if let Some(window) = app.get_webview_window(&label)
            && let Err(error) = window.destroy()
        {
            cancel_request(&mut *registry()?, intent.request_id);
            return Err(error.into());
        }
    }
    Ok(receiver)
}

pub fn request_session_close(
    app: &tauri::AppHandle,
    session_id: &str,
) -> AppResult<mpsc::Receiver<bool>> {
    let labels = {
        let mut state = registry()?;
        state.closing_sessions.insert(session_id.to_string());
        state
            .instances
            .iter()
            .filter(|(_, instance)| instance.identity.session_id() == Some(session_id))
            .map(|(label, _)| label.clone())
            .collect::<BTreeSet<_>>()
    };
    let result = request_close(app, labels, false, Some(session_id.to_string()));
    if result.is_err() {
        registry()?.closing_sessions.remove(session_id);
    }
    result
}

pub fn release_session(session_id: &str) -> AppResult<()> {
    let mut state = registry()?;
    state.closing_sessions.remove(session_id);
    state
        .reservations
        .retain(|identity, _| identity.session_id() != Some(session_id));
    Ok(())
}

pub fn cancel_close_request(label: &str, request_id: u64) -> AppResult<()> {
    let mut state = registry()?;
    if state
        .close_requests
        .get(&request_id)
        .is_some_and(|request| request.labels.contains(label))
    {
        cancel_request(&mut state, request_id);
    }
    Ok(())
}

fn cancel_request(state: &mut WindowRegistry, request_id: u64) {
    if let Some(request) = state.close_requests.remove(&request_id) {
        if let Some(session) = request.session_id {
            state.closing_sessions.remove(&session);
        }
        let _ = request.sender.send(false);
    }
}

pub fn release_targets(label: &str) -> AppResult<()> {
    registry()?.reservations.retain(|_, owner| owner != label);
    Ok(())
}

pub fn retarget_window(
    app: &tauri::AppHandle,
    label: &str,
    identity: WindowIdentity,
    title: &str,
) -> AppResult<()> {
    let displaced = {
        let mut state = registry()?;
        if let Some(conflict) = state.conflict(label, std::slice::from_ref(&identity)) {
            return Err(AppError::message(
                "window.target_unsaved",
                format!("目标窗口正在编辑: {conflict}"),
            ));
        }
        let displaced = state
            .identities
            .get(&identity.comparison_key())
            .filter(|owner| owner.as_str() != label)
            .cloned();
        if let Some(displaced) = &displaced {
            state.release(displaced);
        }
        state.retarget(label, identity);
        displaced
    };
    if let Some(displaced) = displaced
        && let Some(window) = app.get_webview_window(&displaced)
    {
        window.destroy()?;
    }
    if let Some(window) = app.get_webview_window(label) {
        window.set_title(title)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn identity(id: &str, root: &str, session: &str) -> WindowIdentity {
        WindowIdentity::Spec {
            session_id: session.into(),
            kind: "weapon".into(),
            mod_root: root.into(),
            id: id.into(),
        }
    }
    #[test]
    fn lifecycle_cancel_releases_creation_gate_and_destroy_completes_waiting_intent() {
        let mut state = WindowRegistry::default();
        let label = state.register(identity("creating", "D:/Mod", "s"));
        state.closing_sessions.insert("s".to_string());
        let (sent, received) = mpsc::channel();
        state.close_requests.insert(
            1,
            CloseRequest {
                session_id: Some("s".into()),
                labels: BTreeSet::from([label.clone()]),
                sender: sent,
            },
        );
        assert!(state.close_requests[&1].labels.contains(&label));
        cancel_request(&mut state, 1);
        assert!(!received.recv().unwrap());
        assert!(!state.closing_sessions.contains("s"));
        let (sent, received) = mpsc::channel();
        state.close_requests.insert(
            2,
            CloseRequest {
                session_id: Some("s".into()),
                labels: BTreeSet::from([label.clone()]),
                sender: sent,
            },
        );
        state.release(&label);
        assert!(received.recv().unwrap());
        assert!(state.close_requests.is_empty());
        assert!(state.instances.is_empty());
    }
    #[test]
    fn comparison_keeps_entity_and_session_case_and_normalizes_paths() {
        assert_eq!(
            crate::models::windows_path_key(r"\\?\UNC\Server\Share\Mod\"),
            "//server/share/mod"
        );
        assert_eq!(
            crate::models::windows_path_key("D:/Mod//nested/"),
            "d:/mod/nested"
        );
        assert_ne!(
            identity("Demo", "D:/Mod", "s").comparison_key(),
            identity("demo", "D:/Mod", "s").comparison_key()
        );
        assert_ne!(
            identity("Demo", "D:/Mod", "S").comparison_key(),
            identity("Demo", "D:/Mod", "s").comparison_key()
        );
        assert_eq!(
            identity("Demo", "D:/Mod/", "s").comparison_key(),
            identity("Demo", r"\\?\d:\mod", "s").comparison_key()
        );
    }
    #[test]
    fn reservation_and_retarget_keep_instance_and_release_occupancy() {
        let mut state = WindowRegistry::default();
        let old = state.register(identity("old", "D:/Mod", "s"));
        state.instances.get_mut(&old).unwrap().creating = false;
        let occupied = state.register(identity("next", "D:/Mod", "s"));
        state.instances.get_mut(&occupied).unwrap().creating = false;
        state.instances.get_mut(&occupied).unwrap().status.dirty = true;
        let next = identity("next", "D:/Mod", "s");
        assert_eq!(
            state.reserve(&old, std::slice::from_ref(&next)),
            Err(occupied.clone())
        );
        state.release(&occupied);
        state.reserve(&old, std::slice::from_ref(&next)).unwrap();
        state.retarget(&old, next.clone());
        assert_eq!(state.identities[&next.comparison_key()], old);
        state.release(&old);
        assert!(state.reservations.is_empty());
        assert!(state.identities.is_empty());
    }
}
