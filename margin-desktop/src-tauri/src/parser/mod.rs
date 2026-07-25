use crate::dto::{ImportBookContentRequest, ImportBookRequest};
use crate::error::AppError;
use std::fs;

#[derive(Debug, Clone)]
pub struct ParsedBook {
    pub title: Option<String>,
    pub author: Option<String>,
    pub cover_path: Option<String>,
    pub chapters: Vec<ParsedChapter>,
}

#[derive(Debug, Clone)]
pub struct ParsedChapter {
    pub title: String,
    pub plain_text: String,
    pub html_content: Option<String>,
}

pub async fn parse_book_metadata(payload: &ImportBookRequest) -> Result<ParsedBook, AppError> {
    let bytes = fs::read(&payload.file_path)
        .map_err(|error| AppError::new("file_read_failed", error.to_string()))?;
    let file_type = payload.file_type.trim().to_ascii_lowercase();

    if file_type.contains("docx") || payload.file_name.to_ascii_lowercase().ends_with(".docx") {
        return Err(AppError::new(
            "unsupported_docx_backend",
            "åŽç«¯æš‚æœªæŽ¥å…¥ docx è§£åŒ…è§£æžï¼Œè¯·å…ˆç”±å‰ç«¯ convertToHtml åŽå†ä¼ å…¥çº¯æ–‡æœ¬/HTMLï¼Œæˆ–ä¸‹ä¸€æ­¥æŽ¥å…¥ zip+xml è§£æžå™¨",
        ));
    }

    let raw_text = decode_text(&bytes);
    let (plain_text, html_content) = if looks_like_html(&file_type, &payload.file_name, &raw_text) {
        let plain = html_to_plain_text(&raw_text);
        let html = Some(sanitize_html_for_reader(&raw_text));
        (plain, html)
    } else {
        let plain = normalize_plain_text(&raw_text);
        let html = Some(text_to_html(&plain));
        (plain, html)
    };

    let title = payload
        .title
        .clone()
        .or_else(|| {
            payload
                .file_name
                .rsplit_once('.')
                .map(|(name, _)| name.to_string())
        })
        .or_else(|| Some(payload.file_name.clone()));
    let chapters = split_into_chapters(&plain_text, html_content.as_deref());

    Ok(ParsedBook {
        title,
        author: payload.author.clone(),
        cover_path: None,
        chapters,
    })
}

pub fn parse_frontend_book_content(
    payload: &ImportBookContentRequest,
) -> Result<ParsedBook, AppError> {
    let chapters = payload
        .chapters
        .iter()
        .enumerate()
        .filter_map(|(index, chapter)| {
            let plain_text = normalize_plain_text(&chapter.plain_text);
            if plain_text.trim().is_empty() {
                return None;
            }
            Some(ParsedChapter {
                title: if chapter.title.trim().is_empty() {
                    format!("第 {} 页", index + 1)
                } else {
                    chapter.title.clone()
                },
                html_content: chapter
                    .html_content
                    .clone()
                    .or_else(|| Some(text_to_html(&plain_text))),
                plain_text,
            })
        })
        .collect::<Vec<_>>();

    if chapters.is_empty() {
        return Err(AppError::new(
            "empty_book_content",
            "没有可注册到后端的书籍内容",
        ));
    }

    Ok(ParsedBook {
        title: Some(payload.title.clone()),
        author: payload.author.clone(),
        cover_path: None,
        chapters,
    })
}
fn decode_text(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xff, 0xfe]) {
        let units = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect::<Vec<_>>();
        return String::from_utf16_lossy(&units);
    }
    if bytes.starts_with(&[0xfe, 0xff]) {
        let units = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
            .collect::<Vec<_>>();
        return String::from_utf16_lossy(&units);
    }
    String::from_utf8_lossy(bytes).to_string()
}

fn looks_like_html(file_type: &str, file_name: &str, text: &str) -> bool {
    let name = file_name.to_ascii_lowercase();
    file_type.contains("html")
        || name.ends_with(".html")
        || name.ends_with(".htm")
        || text.trim_start().starts_with("<!DOCTYPE html")
        || text.trim_start().starts_with("<html")
}

fn normalize_plain_text(text: &str) -> String {
    text.replace("\r\n", "\n")
        .replace('\r', "\n")
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
}

fn html_to_plain_text(html: &str) -> String {
    let mut output = String::new();
    let mut in_tag = false;
    let mut tag = String::new();

    for character in html.chars() {
        match character {
            '<' => {
                in_tag = true;
                tag.clear();
            }
            '>' => {
                in_tag = false;
                let lower = tag.trim().to_ascii_lowercase();
                if lower.starts_with('p')
                    || lower.starts_with("/p")
                    || lower.starts_with("br")
                    || lower.starts_with("/h")
                    || lower.starts_with("/div")
                    || lower.starts_with("/li")
                {
                    output.push('\n');
                }
            }
            _ if in_tag => tag.push(character),
            _ => output.push(character),
        }
    }

    decode_html_entities(&normalize_plain_text(&output))
}

fn sanitize_html_for_reader(html: &str) -> String {
    // å½“å‰å…ˆä¿ç•™å‰ç«¯ convertToHtml çš„åŸºç¡€ç»“æž„ï¼›è„šæœ¬å’Œæ ·å¼æ ‡ç­¾åšæœ€å°ç§»é™¤ã€‚
    let mut output = String::new();
    let mut skip_until: Option<&'static str> = None;
    let mut index = 0;
    let lower = html.to_ascii_lowercase();

    while index < html.len() {
        if let Some(end_tag) = skip_until {
            if lower[index..].starts_with(end_tag) {
                index += end_tag.len();
                skip_until = None;
            } else {
                index += 1;
            }
            continue;
        }

        if lower[index..].starts_with("<script") {
            skip_until = Some("</script>");
            index += 7;
            continue;
        }
        if lower[index..].starts_with("<style") {
            skip_until = Some("</style>");
            index += 6;
            continue;
        }

        if let Some(character) = html[index..].chars().next() {
            output.push(character);
            index += character.len_utf8();
        } else {
            break;
        }
    }

    output
}

fn text_to_html(text: &str) -> String {
    text.split("\n\n")
        .map(str::trim)
        .filter(|paragraph| !paragraph.is_empty())
        .map(|paragraph| format!("<p>{}</p>", escape_html(paragraph).replace('\n', "<br>")))
        .collect::<Vec<_>>()
        .join("\n")
}

fn split_into_chapters(plain_text: &str, html_content: Option<&str>) -> Vec<ParsedChapter> {
    let mut chapters = split_by_heading(plain_text);
    if chapters.is_empty() {
        chapters = split_by_size(plain_text, 4200);
    }

    if chapters.is_empty() {
        chapters.push(ParsedChapter {
            title: "æ­£æ–‡".to_string(),
            plain_text: plain_text.to_string(),
            html_content: html_content
                .map(str::to_string)
                .or_else(|| Some(text_to_html(plain_text))),
        });
    }

    chapters
}

fn split_by_heading(text: &str) -> Vec<ParsedChapter> {
    let mut chapters = Vec::new();
    let mut current_title = String::new();
    let mut current_lines: Vec<String> = Vec::new();

    for line in text.lines() {
        let trimmed = line.trim();
        if is_chapter_heading(trimmed) {
            if !current_lines.is_empty() {
                let body = current_lines.join("\n").trim().to_string();
                chapters.push(ParsedChapter {
                    title: if current_title.is_empty() {
                        format!("ç¬¬ {} èŠ‚", chapters.len() + 1)
                    } else {
                        current_title.clone()
                    },
                    html_content: Some(text_to_html(&body)),
                    plain_text: body,
                });
                current_lines.clear();
            }
            current_title = trimmed.trim_start_matches('#').trim().to_string();
        }
        current_lines.push(line.to_string());
    }

    if !current_lines.is_empty() {
        let body = current_lines.join("\n").trim().to_string();
        chapters.push(ParsedChapter {
            title: if current_title.is_empty() {
                format!("ç¬¬ {} èŠ‚", chapters.len() + 1)
            } else {
                current_title
            },
            html_content: Some(text_to_html(&body)),
            plain_text: body,
        });
    }

    if chapters.len() <= 1 {
        Vec::new()
    } else {
        chapters
    }
}

fn split_by_size(text: &str, target_chars: usize) -> Vec<ParsedChapter> {
    let mut chapters = Vec::new();
    let mut buffer = String::new();

    for paragraph in text.split("\n\n") {
        if buffer.chars().count() + paragraph.chars().count() > target_chars
            && !buffer.trim().is_empty()
        {
            let body = buffer.trim().to_string();
            chapters.push(ParsedChapter {
                title: format!("ç¬¬ {} èŠ‚", chapters.len() + 1),
                html_content: Some(text_to_html(&body)),
                plain_text: body,
            });
            buffer.clear();
        }
        buffer.push_str(paragraph);
        buffer.push_str("\n\n");
    }

    if !buffer.trim().is_empty() {
        let body = buffer.trim().to_string();
        chapters.push(ParsedChapter {
            title: format!("ç¬¬ {} èŠ‚", chapters.len() + 1),
            html_content: Some(text_to_html(&body)),
            plain_text: body,
        });
    }

    chapters
}

fn is_chapter_heading(line: &str) -> bool {
    let line = line.trim();
    if line.len() > 80 || line.is_empty() {
        return false;
    }
    line.starts_with("# ")
        || line.starts_with("## ")
        || (line.starts_with('\u{7b2c}')
            && (line.contains('\u{7ae0}')
                || line.contains('\u{8282}')
                || line.contains('\u{56de}')))
        || line.to_ascii_lowercase().starts_with("chapter ")
}

fn decode_html_entities(text: &str) -> String {
    text.replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
}

fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
