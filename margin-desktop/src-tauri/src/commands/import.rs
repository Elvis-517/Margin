use crate::dto::{
    ImportBookContentRequest, ImportBookRequest, ImportBookResponse, SelectionSyncPayload,
};
use crate::error::AppError;
use crate::events::{emit_selection_changed, SELECTION_CHANGED_EVENT};
use crate::parser;
use crate::state::AppState;
use tauri::AppHandle;

#[tauri::command]
pub async fn import_book(
    payload: ImportBookRequest,
    state: tauri::State<'_, AppState>,
) -> Result<ImportBookResponse, AppError> {
    let parsed_book = parser::parse_book_metadata(&payload).await?;
    state.db.insert_imported_book(&payload, &parsed_book).await
}

#[tauri::command]
pub async fn import_book_content(
    payload: ImportBookContentRequest,
    state: tauri::State<'_, AppState>,
) -> Result<ImportBookResponse, AppError> {
    handle_import_book_content(payload, state.inner()).await
}

pub async fn handle_import_book_content(
    payload: ImportBookContentRequest,
    state: &AppState,
) -> Result<ImportBookResponse, AppError> {
    let parsed_book = parser::parse_frontend_book_content(&payload)?;
    let file_payload = ImportBookRequest {
        file_name: payload.file_name,
        file_type: payload.file_type,
        file_path: String::new(),
        title: Some(payload.title),
        author: payload.author,
    };
    state
        .db
        .insert_imported_book(&file_payload, &parsed_book)
        .await
}

#[tauri::command]
pub async fn sync_selected_quote(
    payload: SelectionSyncPayload,
    app: AppHandle,
) -> Result<String, AppError> {
    handle_sync_selected_quote(payload, &app)
}

pub fn handle_sync_selected_quote(
    payload: SelectionSyncPayload,
    app: &AppHandle,
) -> Result<String, AppError> {
    emit_selection_changed(app, payload)?;
    Ok(SELECTION_CHANGED_EVENT.to_string())
}
