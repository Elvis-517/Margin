use crate::error::AppError;
use tauri::menu::{ContextMenu, MenuBuilder};
use tauri::{AppHandle, Window};

#[tauri::command]
pub async fn show_floating_native_menu(app: AppHandle, window: Window) -> Result<(), AppError> {
    let menu = MenuBuilder::new(&app)
        .text("floating_hide", "\u{5173}\u{95ed}\u{ff08}\u{9690}\u{85cf}\u{5230}\u{4efb}\u{52a1}\u{680f}\u{4e0d}\u{9000}\u{51fa}\u{ff09}")
        .separator()
        .text("floating_quit", "\u{9000}\u{51fa}")
        .build()
        .map_err(AppError::from)?;
    menu.popup(window).map_err(AppError::from)
}
