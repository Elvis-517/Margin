use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportBookRequest {
    pub file_name: String,
    pub file_type: String,
    pub file_path: String,
    pub title: Option<String>,
    pub author: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportBookContentRequest {
    pub file_name: String,
    pub file_type: String,
    pub title: String,
    pub author: Option<String>,
    pub chapters: Vec<FrontendChapterContent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontendChapterContent {
    pub title: String,
    pub plain_text: String,
    pub html_content: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportBookResponse {
    pub book_id: String,
    pub title: String,
    pub author: Option<String>,
    pub chapter_count: usize,
    pub status: ImportStatus,
    pub chapters: Vec<ChapterSummary>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportStatus {
    Pending,
    Parsing,
    Imported,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectionSyncPayload {
    pub quote_id: String,
    pub book_id: Option<String>,
    pub chapter_id: Option<String>,
    pub book_name: String,
    pub chapter_name: String,
    pub quote_text: String,
    pub start_offset: Option<usize>,
    pub end_offset: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyzeQuoteRequest {
    pub quote_id: String,
    pub book_id: String,
    pub chapter_id: String,
    pub quote_text: String,
    pub start_offset: usize,
    pub end_offset: usize,
    pub user_message: Option<String>,
    pub api_enabled: Option<bool>,
    pub api_key: Option<String>,
    pub api_base_url: Option<String>,
    pub api_model: Option<String>,
    pub ai_long_answer: Option<bool>,
    pub ai_academic_answer: Option<bool>,
    pub ai_reply_style: Option<String>,
    pub ai_spoiler_level: Option<u8>,
    pub ai_search_mode: Option<bool>,
    pub conversation_history: Option<Vec<AiMessage>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AnalyzeQuoteAccepted {
    pub quote_id: String,
    pub accepted: bool,
    pub stream_event: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadChapterRequest {
    pub book_id: String,
    pub chapter_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReadChapterResponse {
    pub book_id: String,
    pub chapter_id: String,
    pub title: String,
    pub chapter_index: usize,
    pub plain_text: String,
    pub html_content: Option<String>,
    pub char_count: usize,
    pub total_chapters: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct BookSummary {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub file_name: String,
    pub file_type: String,
    pub chapter_count: usize,
    pub current_chapter_id: Option<String>,
    pub global_background: Option<String>,
    pub created_at: u128,
    pub updated_at: u128,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChapterSummary {
    pub id: String,
    pub title: String,
    pub chapter_index: usize,
    pub char_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct QuoteStreamEvent {
    pub quote_id: String,
    pub book_id: String,
    pub chapter_id: String,
    pub event: StreamEventKind,
    pub delta: Option<String>,
    pub done: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StreamEventKind {
    Start,
    Delta,
    Done,
    Error,
}

#[derive(Debug, Clone)]
pub struct PromptContext {
    pub book_title: String,
    pub author: Option<String>,
    pub global_background: Option<String>,
    pub safe_previous_text: String,
    pub safe_following_text: String,
    pub quote_text: String,
    pub user_message: Option<String>,
    pub long_answer: bool,
    pub academic_answer: bool,
    pub reply_style: Option<String>,
    pub spoiler_level: u8,
    pub search_mode: bool,
    pub conversation_history: Vec<AiMessage>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiMessage {
    pub role: String,
    pub content: String,
}
