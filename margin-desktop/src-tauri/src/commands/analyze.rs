use crate::ai;
use crate::dto::{AnalyzeQuoteAccepted, AnalyzeQuoteRequest, QuoteStreamEvent, StreamEventKind};
use crate::error::AppError;
use crate::events::{emit_quote_stream, QUOTE_STREAM_EVENT};
use crate::state::AppState;
use tauri::AppHandle;

#[tauri::command]
pub async fn analyze_quote_stream(
    payload: AnalyzeQuoteRequest,
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<AnalyzeQuoteAccepted, AppError> {
    let quote_id = payload.quote_id.clone();
    let app_state = state.inner().clone();
    let app_handle = app.clone();

    tauri::async_runtime::spawn(async move {
        if let Err(error) = run_quote_analysis(payload.clone(), app_handle.clone(), app_state).await
        {
            let _ = emit_quote_stream(
                &app_handle,
                QuoteStreamEvent {
                    quote_id: payload.quote_id,
                    book_id: payload.book_id,
                    chapter_id: payload.chapter_id,
                    event: StreamEventKind::Error,
                    delta: None,
                    done: true,
                    error: Some(error.to_string()),
                },
            );
        }
    });

    Ok(AnalyzeQuoteAccepted {
        quote_id,
        accepted: true,
        stream_event: QUOTE_STREAM_EVENT.to_string(),
    })
}

async fn run_quote_analysis(
    payload: AnalyzeQuoteRequest,
    app: AppHandle,
    state: AppState,
) -> Result<(), AppError> {
    emit_quote_stream(
        &app,
        QuoteStreamEvent {
            quote_id: payload.quote_id.clone(),
            book_id: payload.book_id.clone(),
            chapter_id: payload.chapter_id.clone(),
            event: StreamEventKind::Start,
            delta: None,
            done: false,
            error: None,
        },
    )?;

    state.db.insert_quote_request(&payload).await?;
    let prompt_context = state.db.build_safe_prompt_context(&payload).await?;
    let messages = ai::prompt::build_quote_prompt(prompt_context);
    let ai_config = ai::client::AiConfig::from_request(
        payload.api_enabled,
        payload.api_key.clone(),
        payload.api_base_url.clone(),
        payload.api_model.clone(),
    );
    let mut stream = ai::client::stream_chat(messages, ai_config).await?;
    let mut full_response = String::new();

    while let Some(delta) = stream.next_delta().await? {
        full_response.push_str(&delta);
        emit_quote_stream(
            &app,
            QuoteStreamEvent {
                quote_id: payload.quote_id.clone(),
                book_id: payload.book_id.clone(),
                chapter_id: payload.chapter_id.clone(),
                event: StreamEventKind::Delta,
                delta: Some(delta),
                done: false,
                error: None,
            },
        )?;
    }

    state.db.save_annotation(&payload, &full_response).await?;

    emit_quote_stream(
        &app,
        QuoteStreamEvent {
            quote_id: payload.quote_id,
            book_id: payload.book_id,
            chapter_id: payload.chapter_id,
            event: StreamEventKind::Done,
            delta: None,
            done: true,
            error: None,
        },
    )
}
