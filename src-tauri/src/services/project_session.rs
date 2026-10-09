use crate::{
    errors::AppResult,
    io::FsRootBoundary,
    models::{AppLogEntry, AppLogLevel, ProjectManifest},
    services::{
        app_log, app_paths,
        project::{
            PerformanceTrace, configure_persistent_index_cache, open_project_session_traced,
        },
    },
};
use std::collections::BTreeMap;
use std::path::Path;

pub fn open_project_session_with_root(
    app_handle: tauri::AppHandle,
    mod_root: String,
    starsector_root: Option<String>,
) -> AppResult<ProjectManifest> {
    if let Ok(app_data_dir) = app_paths::app_data_dir(app_handle.clone())
        && let Err(error) = configure_persistent_index_cache(&app_data_dir)
    {
        crate::diagnostics::record(format!("persistent index cache configure failed: {error}"));
    }
    let mut trace = PerformanceTrace::new("project.openSession");
    let mod_root_boundary = FsRootBoundary::new(Path::new(&mod_root), "mod root")?;
    let mod_root_path = mod_root_boundary.root();
    let starsector_root = match starsector_root.as_deref() {
        Some(root) => Some(
            FsRootBoundary::new(Path::new(root), "starsector root")?
                .root()
                .to_path_buf(),
        ),
        None => crate::services::directory_opening::infer_starsector_root(mod_root_path),
    };
    let result = open_project_session_traced(mod_root_path, starsector_root.as_deref(), &mut trace);
    if result.is_ok() {
        write_performance_trace(app_handle, &trace, &[("modRoot", mod_root)]);
    }
    result
}

fn write_performance_trace(
    app_handle: tauri::AppHandle,
    trace: &PerformanceTrace,
    root_fields: &[(&str, String)],
) {
    for entry in trace.log_entries(root_fields) {
        let mut fields = BTreeMap::new();
        fields.insert("stage".to_string(), entry.stage);
        fields.insert("ms".to_string(), entry.ms.to_string());
        for (key, value) in entry.fields {
            fields.insert(key, value);
        }
        let _ = app_log::append_app_log(
            app_handle.clone(),
            AppLogEntry {
                level: AppLogLevel::Debug,
                code: Some("perf".to_string()),
                message: Some(format!("PERF {}", trace.name())),
                path: None,
                line: None,
                fields: Some(fields),
            },
        );
    }
}
