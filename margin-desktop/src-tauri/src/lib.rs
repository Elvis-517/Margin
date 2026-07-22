// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod ai;
mod bridge;
mod commands;
mod db;
mod dto;
mod error;
mod events;
mod parser;
mod state;

use state::AppState;
use tauri::{Emitter, Manager};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState::new();
    if let Err(error) = tauri::async_runtime::block_on(app_state.db.migrate()) {
        eprintln!("failed to initialize local reader store: {error}");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .setup(|app| {
            let state = app.state::<AppState>().inner().clone();
            bridge::start_bridge_server(app.handle().clone(), state);
            app.handle()
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "floating_hide" => {
                        let _ = app.emit("margin://floating-menu-action", "hide_to_taskbar");
                    }
                    "floating_quit" => app.exit(0),
                    _ => {}
                });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::import::import_book,
            commands::import::import_book_content,
            commands::import::sync_selected_quote,
            commands::window::show_floating_native_menu,
            commands::analyze::analyze_quote_stream,
            commands::books::list_books,
            commands::books::read_chapter
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
