use crate::dto::{BookSummary, ReadChapterRequest, ReadChapterResponse};
use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
pub async fn list_books(state: tauri::State<'_, AppState>) -> Result<Vec<BookSummary>, AppError> {
    state.db.list_books().await
}

#[tauri::command]
pub async fn read_chapter(
    payload: ReadChapterRequest,
    state: tauri::State<'_, AppState>,
) -> Result<ReadChapterResponse, AppError> {
    state.db.read_chapter(&payload).await
}
