use crate::dto::{
    AnalyzeQuoteRequest, BookSummary, ChapterSummary, ImportBookRequest, ImportBookResponse,
    ImportStatus, PromptContext, ReadChapterRequest, ReadChapterResponse,
};
use crate::error::AppError;
use crate::parser::ParsedBook;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

pub mod books;
pub mod chapters;
pub mod quotes;
pub mod schema;

#[derive(Clone)]
pub struct Database {
    inner: Arc<DatabaseInner>,
}

struct DatabaseInner {
    store_path: PathBuf,
    store: Mutex<Store>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Store {
    books: Vec<StoredBook>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredBook {
    id: String,
    title: String,
    author: Option<String>,
    file_name: String,
    file_type: String,
    cover_path: Option<String>,
    global_background: Option<String>,
    current_chapter_id: Option<String>,
    chapters: Vec<StoredChapter>,
    quotes: Vec<StoredQuote>,
    annotations: Vec<StoredAnnotation>,
    created_at: u128,
    updated_at: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredChapter {
    id: String,
    title: String,
    chapter_index: usize,
    plain_text: String,
    html_content: Option<String>,
    char_count: usize,
    created_at: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredQuote {
    id: String,
    book_id: String,
    chapter_id: String,
    quote_text: String,
    start_offset: usize,
    end_offset: usize,
    created_at: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredAnnotation {
    id: String,
    quote_id: String,
    book_id: String,
    chapter_id: String,
    user_prompt: Option<String>,
    ai_response: String,
    model: Option<String>,
    created_at: u128,
}

impl Database {
    pub fn new() -> Self {
        let store_path = default_store_path();
        if let Some(parent) = store_path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        let store = fs::read_to_string(&store_path)
            .ok()
            .and_then(|content| serde_json::from_str::<Store>(&content).ok())
            .unwrap_or_default();

        Self {
            inner: Arc::new(DatabaseInner {
                store_path,
                store: Mutex::new(store),
            }),
        }
    }

    pub async fn migrate(&self) -> Result<(), AppError> {
        let _schema_sql = schema::SQLITE_SCHEMA;
        self.persist()
    }

    pub async fn insert_imported_book(
        &self,
        payload: &ImportBookRequest,
        parsed: &ParsedBook,
    ) -> Result<ImportBookResponse, AppError> {
        let now = now_millis();
        let book_id = new_id("book");
        let title = parsed
            .title
            .clone()
            .or_else(|| payload.title.clone())
            .unwrap_or_else(|| title_from_file_name(&payload.file_name));
        let author = parsed.author.clone().or_else(|| payload.author.clone());

        let chapters = parsed
            .chapters
            .iter()
            .enumerate()
            .map(|(index, chapter)| StoredChapter {
                id: format!("{}_chapter_{}", book_id, index + 1),
                title: chapter.title.clone(),
                chapter_index: index,
                plain_text: chapter.plain_text.clone(),
                html_content: chapter.html_content.clone(),
                char_count: chapter.plain_text.chars().count(),
                created_at: now,
            })
            .collect::<Vec<_>>();

        let summaries = chapters.iter().map(chapter_summary).collect::<Vec<_>>();
        let current_chapter_id = chapters.first().map(|chapter| chapter.id.clone());
        let chapter_count = chapters.len();

        let book = StoredBook {
            id: book_id.clone(),
            title: title.clone(),
            author: author.clone(),
            file_name: payload.file_name.clone(),
            file_type: payload.file_type.clone(),
            cover_path: parsed.cover_path.clone(),
            global_background: Some(build_global_background(&title, &author, &chapters)),
            current_chapter_id,
            chapters,
            quotes: Vec::new(),
            annotations: Vec::new(),
            created_at: now,
            updated_at: now,
        };

        {
            let mut store = self.lock_store()?;
            store.books.push(book);
        }
        self.persist()?;

        Ok(ImportBookResponse {
            book_id,
            title,
            author,
            chapter_count,
            status: ImportStatus::Imported,
            chapters: summaries,
        })
    }

    pub async fn list_books(&self) -> Result<Vec<BookSummary>, AppError> {
        let store = self.lock_store()?;
        Ok(store.books.iter().map(book_summary).collect())
    }

    pub async fn read_chapter(
        &self,
        payload: &ReadChapterRequest,
    ) -> Result<ReadChapterResponse, AppError> {
        let mut store = self.lock_store()?;
        let book = store
            .books
            .iter_mut()
            .find(|book| book.id == payload.book_id)
            .ok_or_else(|| AppError::new("book_not_found", "Book not found"))?;
        let total_chapters = book.chapters.len();
        let chapter = book
            .chapters
            .iter()
            .find(|chapter| chapter.id == payload.chapter_id)
            .ok_or_else(|| AppError::new("chapter_not_found", "Chapter not found"))?
            .clone();

        book.current_chapter_id = Some(chapter.id.clone());
        book.updated_at = now_millis();
        drop(store);
        self.persist()?;

        Ok(ReadChapterResponse {
            book_id: payload.book_id.clone(),
            chapter_id: chapter.id,
            title: chapter.title,
            chapter_index: chapter.chapter_index,
            plain_text: chapter.plain_text,
            html_content: chapter.html_content,
            char_count: chapter.char_count,
            total_chapters,
        })
    }

    pub async fn insert_quote_request(
        &self,
        payload: &AnalyzeQuoteRequest,
    ) -> Result<(), AppError> {
        if payload.quote_text.trim().is_empty() {
            return Err(AppError::new("empty_quote", "Quote text cannot be empty"));
        }
        if payload.end_offset < payload.start_offset {
            return Err(AppError::new("invalid_quote_range", "Invalid quote range"));
        }

        let now = now_millis();
        let mut store = self.lock_store()?;
        let book = store
            .books
            .iter_mut()
            .find(|book| book.id == payload.book_id)
            .ok_or_else(|| AppError::new("book_not_found", "Book not found"))?;
        if !book
            .chapters
            .iter()
            .any(|chapter| chapter.id == payload.chapter_id)
        {
            return Err(AppError::new("chapter_not_found", "Chapter not found"));
        }

        if let Some(existing) = book
            .quotes
            .iter_mut()
            .find(|quote| quote.id == payload.quote_id)
        {
            existing.quote_text = payload.quote_text.clone();
            existing.start_offset = payload.start_offset;
            existing.end_offset = payload.end_offset;
        } else {
            book.quotes.push(StoredQuote {
                id: payload.quote_id.clone(),
                book_id: payload.book_id.clone(),
                chapter_id: payload.chapter_id.clone(),
                quote_text: payload.quote_text.clone(),
                start_offset: payload.start_offset,
                end_offset: payload.end_offset,
                created_at: now,
            });
        }
        book.updated_at = now;
        drop(store);
        self.persist()
    }

    pub async fn build_safe_prompt_context(
        &self,
        payload: &AnalyzeQuoteRequest,
    ) -> Result<PromptContext, AppError> {
        let store = self.lock_store()?;
        let book = store
            .books
            .iter()
            .find(|book| book.id == payload.book_id)
            .ok_or_else(|| AppError::new("book_not_found", "Book not found"))?;
        let chapter = book
            .chapters
            .iter()
            .find(|chapter| chapter.id == payload.chapter_id)
            .ok_or_else(|| AppError::new("chapter_not_found", "Chapter not found"))?;

        validate_quote_position(chapter, payload)?;

        let safe_previous_text = chapter
            .plain_text
            .chars()
            .take(payload.start_offset)
            .collect::<String>();
        let spoiler_level = payload.ai_spoiler_level.unwrap_or(0).min(100);
        let safe_following_text = build_safe_following_text(
            book,
            chapter.chapter_index,
            payload.end_offset,
            spoiler_level,
        );

        Ok(PromptContext {
            book_title: book.title.clone(),
            author: book.author.clone(),
            global_background: book.global_background.clone(),
            safe_previous_text,
            safe_following_text,
            quote_text: payload.quote_text.clone(),
            user_message: payload.user_message.clone(),
            long_answer: payload.ai_long_answer.unwrap_or(false),
            academic_answer: payload.ai_academic_answer.unwrap_or(false),
            reply_style: payload
                .ai_reply_style
                .clone()
                .filter(|style| !style.trim().is_empty() && style.trim() != "\u{9ed8}\u{8ba4}"),
            spoiler_level,
            search_mode: payload.ai_search_mode.unwrap_or(false),
            conversation_history: payload.conversation_history.clone().unwrap_or_default(),
        })
    }

    pub async fn save_annotation(
        &self,
        payload: &AnalyzeQuoteRequest,
        response: &str,
    ) -> Result<(), AppError> {
        let mut store = self.lock_store()?;
        let book = store
            .books
            .iter_mut()
            .find(|book| book.id == payload.book_id)
            .ok_or_else(|| AppError::new("book_not_found", "Book not found"))?;
        book.annotations.push(StoredAnnotation {
            id: new_id("annotation"),
            quote_id: payload.quote_id.clone(),
            book_id: payload.book_id.clone(),
            chapter_id: payload.chapter_id.clone(),
            user_prompt: payload.user_message.clone(),
            ai_response: response.to_string(),
            model: payload.api_model.clone(),
            created_at: now_millis(),
        });
        book.updated_at = now_millis();
        drop(store);
        self.persist()
    }

    fn lock_store(&self) -> Result<std::sync::MutexGuard<'_, Store>, AppError> {
        self.inner
            .store
            .lock()
            .map_err(|_| AppError::new("store_locked", "Local store is locked"))
    }

    fn persist(&self) -> Result<(), AppError> {
        let store = self.lock_store()?;
        let content = serde_json::to_string_pretty(&*store)
            .map_err(|error| AppError::new("store_serialize_failed", error.to_string()))?;
        fs::write(&self.inner.store_path, content)
            .map_err(|error| AppError::new("store_write_failed", error.to_string()))
    }
}

fn build_safe_following_text(
    book: &StoredBook,
    chapter_index: usize,
    end_offset: usize,
    spoiler_level: u8,
) -> String {
    if spoiler_level == 0 {
        return String::new();
    }

    let mut remaining = match spoiler_level {
        1..=25 => 800,
        26..=50 => 2_500,
        51..=75 => 6_000,
        _ => 16_000,
    };
    let include_next_chapters = spoiler_level > 50;
    let mut collected = String::new();

    for chapter in book
        .chapters
        .iter()
        .filter(|chapter| chapter.chapter_index >= chapter_index)
    {
        let chapter_text = if chapter.chapter_index == chapter_index {
            chapter
                .plain_text
                .chars()
                .skip(end_offset)
                .collect::<String>()
        } else if include_next_chapters {
            format!("\n\n[{}]\n{}", chapter.title, chapter.plain_text)
        } else {
            break;
        };

        if chapter_text.is_empty() {
            continue;
        }

        let slice = chapter_text.chars().take(remaining).collect::<String>();
        remaining = remaining.saturating_sub(slice.chars().count());
        collected.push_str(&slice);
        if remaining == 0 {
            break;
        }
    }

    collected
}

fn validate_quote_position(
    chapter: &StoredChapter,
    payload: &AnalyzeQuoteRequest,
) -> Result<(), AppError> {
    let total_chars = chapter.plain_text.chars().count();
    if payload.end_offset > total_chars {
        return Err(AppError::new("quote_out_of_range", "Quote is out of range"));
    }

    let extracted = chapter
        .plain_text
        .chars()
        .skip(payload.start_offset)
        .take(payload.end_offset - payload.start_offset)
        .collect::<String>();

    if normalize_text(&extracted) != normalize_text(&payload.quote_text) {
        return Err(AppError::new(
            "quote_position_mismatch",
            "Quote text does not match chapter position",
        ));
    }
    Ok(())
}

fn normalize_text(text: &str) -> String {
    text.chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}

fn default_store_path() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(std::env::temp_dir);
    base.join("Margin").join("reader-store").join("store.json")
}

fn book_summary(book: &StoredBook) -> BookSummary {
    BookSummary {
        id: book.id.clone(),
        title: book.title.clone(),
        author: book.author.clone(),
        file_name: book.file_name.clone(),
        file_type: book.file_type.clone(),
        chapter_count: book.chapters.len(),
        current_chapter_id: book.current_chapter_id.clone(),
        global_background: book.global_background.clone(),
        created_at: book.created_at,
        updated_at: book.updated_at,
    }
}

fn chapter_summary(chapter: &StoredChapter) -> ChapterSummary {
    ChapterSummary {
        id: chapter.id.clone(),
        title: chapter.title.clone(),
        chapter_index: chapter.chapter_index,
        char_count: chapter.char_count,
    }
}

fn build_global_background(
    title: &str,
    author: &Option<String>,
    chapters: &[StoredChapter],
) -> String {
    let author = author.as_deref().unwrap_or("Unknown author");
    let chapter_titles = chapters
        .iter()
        .take(8)
        .map(|chapter| chapter.title.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "Title: {}. Author: {}. Parsed chapters: {}. This background contains metadata and chapter titles, not a plot summary.",
        title, author, chapter_titles
    )
}

fn title_from_file_name(file_name: &str) -> String {
    file_name
        .rsplit_once('.')
        .map(|(name, _)| name)
        .unwrap_or(file_name)
        .to_string()
}

fn new_id(prefix: &str) -> String {
    format!("{}_{}", prefix, now_millis())
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}
