use crate::commands::import::{handle_import_book_content, handle_sync_selected_quote};
use crate::dto::{ImportBookContentRequest, SelectionSyncPayload};
use crate::state::AppState;
use serde::Serialize;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use tauri::AppHandle;

const BRIDGE_ADDR: &str = "127.0.0.1:37521";

pub fn start_bridge_server(app: AppHandle, state: AppState) {
    thread::spawn(move || {
        let listener = match TcpListener::bind(BRIDGE_ADDR) {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("Margin bridge failed to bind {BRIDGE_ADDR}: {error}");
                return;
            }
        };

        for stream in listener.incoming().flatten() {
            let app = app.clone();
            let state = state.clone();
            thread::spawn(move || handle_stream(stream, app, state));
        }
    });
}

fn handle_stream(mut stream: TcpStream, app: AppHandle, state: AppState) {
    let mut buffer = Vec::new();
    let mut temp = [0_u8; 4096];
    let mut header_end = None;
    let mut content_length = 0_usize;

    loop {
        let Ok(read_count) = stream.read(&mut temp) else {
            return;
        };
        if read_count == 0 {
            break;
        }
        buffer.extend_from_slice(&temp[..read_count]);

        if header_end.is_none() {
            header_end = find_header_end(&buffer);
            if let Some(end) = header_end {
                let header = String::from_utf8_lossy(&buffer[..end]);
                content_length = parse_content_length(&header).unwrap_or(0);
            }
        }

        if let Some(end) = header_end {
            if buffer.len() >= end + content_length {
                break;
            }
        }
    }

    let Some(header_end) = header_end else {
        write_error(&mut stream, 400, "bad_request", "请求格式不完整");
        return;
    };

    let header = String::from_utf8_lossy(&buffer[..header_end]);
    let request_line = header.lines().next().unwrap_or_default();
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default();
    let path = request_parts.next().unwrap_or_default();

    if method == "OPTIONS" {
        write_json(&mut stream, 200, &serde_json::json!({ "ok": true }));
        return;
    }

    if method != "POST" {
        write_error(&mut stream, 405, "method_not_allowed", "只支持 POST");
        return;
    }

    let body = &buffer[header_end..buffer.len().min(header_end + content_length)];
    match path {
        "/import_book_content" => {
            let payload = match serde_json::from_slice::<ImportBookContentRequest>(body) {
                Ok(payload) => payload,
                Err(error) => {
                    write_error(&mut stream, 400, "invalid_json", &error.to_string());
                    return;
                }
            };
            match tauri::async_runtime::block_on(handle_import_book_content(payload, &state)) {
                Ok(response) => write_json(&mut stream, 200, &response),
                Err(error) => write_error(&mut stream, 500, &error.code, &error.message),
            }
        }
        "/sync_selected_quote" => {
            let payload = match serde_json::from_slice::<SelectionSyncPayload>(body) {
                Ok(payload) => payload,
                Err(error) => {
                    write_error(&mut stream, 400, "invalid_json", &error.to_string());
                    return;
                }
            };
            match handle_sync_selected_quote(payload, &app) {
                Ok(event_name) => write_json(
                    &mut stream,
                    200,
                    &serde_json::json!({ "event": event_name }),
                ),
                Err(error) => write_error(&mut stream, 500, &error.code, &error.message),
            }
        }
        "/health" => write_json(&mut stream, 200, &serde_json::json!({ "ok": true })),
        _ => write_error(&mut stream, 404, "not_found", "未知桥接接口"),
    }
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| index + 4)
}

fn parse_content_length(header: &str) -> Option<usize> {
    header.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if name.eq_ignore_ascii_case("content-length") {
            value.trim().parse().ok()
        } else {
            None
        }
    })
}

fn write_json<T: Serialize>(stream: &mut TcpStream, status: u16, payload: &T) {
    let body = serde_json::to_string(payload).unwrap_or_else(|_| "{}".to_string());
    let response = format!(
        "HTTP/1.1 {status} OK\r\nContent-Type: application/json; charset=utf-8\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.as_bytes().len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
}

fn write_error(stream: &mut TcpStream, status: u16, code: &str, message: &str) {
    write_json(
        stream,
        status,
        &serde_json::json!({
            "error": {
                "code": code,
                "message": message
            }
        }),
    );
}
