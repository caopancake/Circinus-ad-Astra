use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum WindowIdentity {
    Spec {
        session_id: String,
        kind: String,
        mod_root: String,
        id: String,
    },
    File {
        session_id: String,
        mod_root: String,
        path: String,
    },
    Recovery {
        mod_root: Option<String>,
        path: String,
    },
}

impl WindowIdentity {
    pub fn comparison_key(&self) -> Self {
        match self {
            Self::Spec {
                session_id,
                kind,
                mod_root,
                id,
            } => Self::Spec {
                session_id: session_id.clone(),
                kind: kind.clone(),
                mod_root: windows_path_key(mod_root),
                id: id.clone(),
            },
            Self::File {
                session_id,
                mod_root,
                path,
            } => Self::File {
                session_id: session_id.clone(),
                mod_root: windows_path_key(mod_root),
                path: windows_path_key(path),
            },
            Self::Recovery { mod_root, path } => Self::Recovery {
                mod_root: mod_root.as_deref().map(windows_path_key),
                path: windows_path_key(path),
            },
        }
    }
    pub fn session_id(&self) -> Option<&str> {
        match self {
            Self::Spec { session_id, .. } | Self::File { session_id, .. } => Some(session_id),
            Self::Recovery { .. } => None,
        }
    }
}

pub fn windows_path_key(path: &str) -> String {
    let normalized = path.replace('\\', "/").to_lowercase();
    let normalized = if let Some(unc) = normalized.strip_prefix("//?/unc/") {
        format!("//{unc}")
    } else {
        normalized
            .strip_prefix("//?/")
            .unwrap_or(&normalized)
            .to_string()
    };
    let prefix = if normalized.starts_with("//") {
        "//"
    } else if normalized.starts_with('/') {
        "/"
    } else {
        ""
    };
    format!(
        "{prefix}{}",
        normalized
            .split('/')
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join("/")
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedWindowRequest {
    pub identity: WindowIdentity,
    pub title: String,
    pub url: String,
    pub width: f64,
    pub height: f64,
    pub min_width: f64,
    pub min_height: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedWindowOpened {
    pub label: String,
    pub reused: bool,
}

#[derive(Debug, Default, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedWindowStatus {
    pub dirty: bool,
    pub saving: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowCloseIntent {
    pub request_id: u64,
    pub labels: Vec<String>,
    pub only_if_clean: bool,
}
