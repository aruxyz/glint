pub mod commands;
pub mod db;
pub mod discovery;
pub mod error;
pub mod exporter;
pub mod media;
pub mod models;
pub mod paths;
pub mod streamer;
pub mod win;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WebviewWindowBuilder, WindowEvent};
use tokio::sync::Semaphore;
use tracing_subscriber::EnvFilter;

use crate::commands::AppState;
use crate::db::Db;
use crate::discovery::{run_scan_task, ClipWatcher};
use crate::exporter::ExportManager;
use crate::paths::AppPaths;

fn open_or_recreate_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    } else if let Some(win_config) = app.config().app.windows.first() {
        if let Ok(builder) = WebviewWindowBuilder::from_config(app, win_config) {
            if let Ok(window) = builder.build() {
                win::apply_mica_backdrop(&window);
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    }

    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app_clone.state::<AppState>();
        let _ = state.watcher.flush_pending(app_clone.clone()).await;
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .try_init();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let paths = AppPaths::from_system()?;
            let db = Db::open(&paths.db_path)?;
            let capabilities = media::detect_ffmpeg_capabilities();
            let thumb_sem = Arc::new(Semaphore::new(3));

            let (streamer_base_url, streamer_token) =
                streamer::start_streamer(db.clone(), paths.clone(), thumb_sem.clone())?;

            let watcher = Arc::new(ClipWatcher::new(
                db.clone(),
                paths.clone(),
                thumb_sem.clone(),
            ));
            if let Ok(folders) = db.list_watch_folders() {
                let _ = watcher.reload(app.handle().clone(), folders);
            }

            let quitting = Arc::new(AtomicBool::new(false));

            app.manage(AppState {
                db,
                paths,
                streamer_base_url,
                streamer_token,
                capabilities,
                thumb_sem,
                watcher,
                exporter: ExportManager::new(),
                quitting,
            });

            if let Some(window) = app.get_webview_window("main") {
                win::apply_mica_backdrop(&window);
            }

            let open_item = MenuItem::with_id(app, "open_glint", "Open Glint", true, None::<&str>)?;
            let scan_item = MenuItem::with_id(app, "scan_now", "Scan Now", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit_glint", "Quit Glint", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &scan_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Glint")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open_glint" => {
                        open_or_recreate_main_window(app);
                    }
                    "scan_now" => {
                        let state = app.state::<AppState>();
                        if let Ok(folders) = state.db.list_watch_folders() {
                            let app_clone = app.clone();
                            let db = state.db.clone();
                            let paths = state.paths.clone();
                            let thumb_sem = state.thumb_sem.clone();
                            tauri::async_runtime::spawn(async move {
                                run_scan_task(app_clone, db, paths, thumb_sem, folders).await;
                            });
                        }
                    }
                    "quit_glint" => {
                        let state = app.state::<AppState>();
                        state.quitting.store(true, Ordering::SeqCst);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        open_or_recreate_main_window(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            tray_builder.build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::Focused(true) = event {
                    let app = window.app_handle().clone();
                    tauri::async_runtime::spawn(async move {
                        let state = app.state::<AppState>();
                        let _ = state.watcher.flush_pending(app.clone()).await;
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_bootstrap_state,
            commands::detect_nvidia_folder,
            commands::detect_obs_folder,
            commands::detect_steam_recordings_folder,
            commands::detect_all_recorders,
            commands::flush_pending_clips,
            commands::add_watch_folder,
            commands::remove_watch_folder,
            commands::toggle_watch_folder,
            commands::scan_watch_folders,
            commands::list_games,
            commands::list_tags,
            commands::list_clips,
            commands::get_clip_detail,
            commands::update_clip_meta,
            commands::delete_clips,
            commands::list_collections,
            commands::create_collection,
            commands::update_collection,
            commands::delete_collection,
            commands::modify_collection_clips,
            commands::export_collection_hardlinks,
            commands::start_export,
            commands::cancel_export,
            commands::save_trimmed_clip,
            commands::merge_clips,
            commands::start_editor_export,
            commands::list_editor_projects,
            commands::save_editor_project,
            commands::load_editor_project,
            commands::delete_editor_project,
            commands::pick_audio_file,
            commands::probe_audio_file,
            commands::list_clip_markers,
            commands::create_clip_marker,
            commands::update_clip_marker,
            commands::delete_clip_marker,
            commands::list_custom_presets,
            commands::create_custom_preset,
            commands::update_custom_preset,
            commands::delete_custom_preset,
            commands::start_batch_export,
            commands::cancel_batch_export,
            commands::set_clip_thumbnail,
            commands::capture_frame_snapshot,
            commands::copy_file_to_clipboard,
            commands::open_in_explorer,
            commands::get_storage_cleanup_preview,
            commands::run_storage_cleanup,
            commands::get_settings,
            commands::update_settings,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Glint");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { api, code, .. } = event {
            let state = app_handle.state::<AppState>();
            let quitting = state.quitting.load(Ordering::SeqCst);
            let minimize_to_tray = state
                .db
                .get_settings(&state.paths.default_settings())
                .map(|s| s.minimize_to_tray)
                .unwrap_or(false);

            if code.is_none() && !quitting && minimize_to_tray {
                api.prevent_exit();
            }
        }
    });
}
