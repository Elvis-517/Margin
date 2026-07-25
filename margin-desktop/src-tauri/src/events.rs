use crate::dto::{QuoteStreamEvent, SelectionSyncPayload};
use crate::error::AppError;
use tauri::{AppHandle, Emitter};

pub const QUOTE_STREAM_EVENT: &str = "ai://quote-stream";
pub const SELECTION_CHANGED_EVENT: &str = "margin://selection-changed";

pub fn emit_quote_stream(app: &AppHandle, payload: QuoteStreamEvent) -> Result<(), AppError> {
    app.emit(QUOTE_STREAM_EVENT, payload)
        .map_err(AppError::from)
}

pub fn emit_selection_changed(
    app: &AppHandle,
    payload: SelectionSyncPayload,
) -> Result<(), AppError> {
    app.emit(SELECTION_CHANGED_EVENT, payload)
        .map_err(AppError::from)
}
