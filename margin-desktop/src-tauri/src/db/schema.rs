#[allow(dead_code)]
pub const SQLITE_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT,
    cover_path TEXT,
    file_name TEXT,
    file_type TEXT,
    language TEXT,
    global_background TEXT,
    import_status TEXT NOT NULL DEFAULT 'pending',
    analyze_status TEXT NOT NULL DEFAULT 'none',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chapters (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    title TEXT NOT NULL,
    chapter_index INTEGER NOT NULL,
    plain_text TEXT NOT NULL,
    html_content TEXT,
    char_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS book_outline (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    chapter_id TEXT,
    outline_index INTEGER NOT NULL,
    title TEXT NOT NULL,
    background_until_here TEXT,
    FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE,
    FOREIGN KEY(chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    quote_text TEXT NOT NULL,
    start_offset INTEGER NOT NULL,
    end_offset INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE,
    FOREIGN KEY(chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_annotations (
    id TEXT PRIMARY KEY,
    quote_id TEXT NOT NULL,
    book_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    user_prompt TEXT,
    ai_response TEXT NOT NULL,
    model TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(quote_id) REFERENCES quotes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chapters_book_order ON chapters(book_id, chapter_index);
CREATE INDEX IF NOT EXISTS idx_quotes_book_chapter ON quotes(book_id, chapter_id);
CREATE INDEX IF NOT EXISTS idx_annotations_quote ON ai_annotations(quote_id);
"#;
