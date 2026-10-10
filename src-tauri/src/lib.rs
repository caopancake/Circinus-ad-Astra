mod commands;
mod diagnostics;
mod domain;
mod errors;
mod io;
mod models;
mod parsers;
mod services;

#[cfg(test)]
pub(crate) mod testutil;

use models::{AppLogEntry, AppLogLevel};
use tauri::{Emitter, Manager};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed)
                && let Err(error) = services::windows::release_window(window.label())
            {
                diagnostics::record(format!("release window registration: {error}"));
            }
            if matches!(event, tauri::WindowEvent::Destroyed)
                && let Err(error) = window.app_handle().emit(
                    "managed-window-released",
                    serde_json::json!({"label": window.label()}),
                )
            {
                diagnostics::record(format!("notify window release: {error}"));
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            diagnostics::install(Box::new(move |message| {
                let _ = services::app_log::append_app_log(
                    handle.clone(),
                    AppLogEntry {
                        level: AppLogLevel::Warning,
                        code: Some("diagnostics".to_string()),
                        message: Some(message.to_string()),
                        path: None,
                        line: None,
                        fields: None,
                    },
                );
            }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_managed_window,
            commands::focus_managed_window,
            commands::request_session_window_close,
            commands::cancel_window_close_request,
            commands::update_managed_window_status,
            commands::reserve_window_targets,
            commands::release_window_targets,
            commands::retarget_managed_window,
            commands::query_file_history,
            commands::query_entity_edit_target,
            commands::query_entity_identity_intent,
            commands::clear_file_history,
            commands::open_project_session,
            commands::close_project_session,
            commands::query_csv_table_window,
            commands::query_csv_source_options,
            commands::query_csv_row_preview,
            commands::query_hull_references,
            commands::query_entity,
            commands::query_entity_list,
            commands::query_editor_draft_resources,
            commands::query_resource_data_urls,
            commands::invalidate_project_session,
            commands::synchronize_committed_write,
            commands::invalidate_core_cache,
            commands::detect_directory,
            commands::scan_game_overview,
            commands::create_mod,
            commands::save_csv_patch,
            commands::resolve_mod_relative_path,
            commands::load_workspace,
            commands::save_workspace,
            commands::append_app_log,
            commands::get_app_log_status,
            commands::open_config_dir,
            commands::open_app_log_file,
            commands::clear_config_files,
            commands::clear_app_log_file,
            commands::load_app_settings,
            commands::save_app_settings,
            commands::save_indexed_config_entity,
            commands::create_indexed_config_entity,
            commands::delete_indexed_config_entity,
            commands::save_variant_entity,
            commands::create_variant_entity,
            commands::delete_variant_entity,
            commands::save_skin_entity,
            commands::create_skin_entity,
            commands::delete_skin_entity,
            commands::scan_core_fields,
            commands::scan_core_graphics,
            commands::load_editable_file,
            commands::query_text_identity_intent,
            commands::follow_text_identity,
            commands::load_imported_editor_spec_file,
            commands::save_text_file,
            commands::transcode_file_to_utf8,
            commands::save_editor_spec,
            commands::save_mod_files,
            commands::save_mod_info,
            commands::apply_file_change_set,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
