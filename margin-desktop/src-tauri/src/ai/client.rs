use crate::dto::AiMessage;
use crate::error::AppError;
use serde_json::json;

pub struct AiConfig {
    pub enabled: bool,
    pub api_key: Option<String>,
    pub base_url: String,
    pub model: String,
}

pub struct AiStream {
    fallback_chunks: Vec<String>,
    fallback_cursor: usize,
    remote_response: Option<reqwest::Response>,
    pending_text: String,
    finished: bool,
}

impl AiConfig {
    pub fn from_request(
        enabled: Option<bool>,
        api_key: Option<String>,
        base_url: Option<String>,
        model: Option<String>,
    ) -> Self {
        let env_key = std::env::var("MARGIN_API_KEY").ok();
        let env_base_url = std::env::var("MARGIN_API_BASE_URL").ok();
        let env_model = std::env::var("MARGIN_API_MODEL").ok();

        Self {
            enabled: enabled.unwrap_or(true),
            api_key: api_key.filter(|key| !key.trim().is_empty()).or(env_key),
            base_url: base_url
                .filter(|url| !url.trim().is_empty())
                .or(env_base_url)
                .unwrap_or_else(|| "https://api.deepseek.com/v1".to_string()),
            model: model
                .filter(|model| !model.trim().is_empty())
                .or(env_model)
                .unwrap_or_else(|| "deepseek-chat".to_string()),
        }
    }
}

pub async fn stream_chat(messages: Vec<AiMessage>, config: AiConfig) -> Result<AiStream, AppError> {
    if !config.enabled {
        return Ok(AiStream::fallback("AI 回复已关闭。"));
    }

    let Some(api_key) = config.api_key else {
        return Ok(AiStream::fallback("未配置 API Key，无法调用大模型。"));
    };

    let endpoint = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));
    let response = reqwest::Client::new()
        .post(endpoint)
        .bearer_auth(api_key)
        .json(&json!({
            "model": config.model,
            "messages": messages,
            "stream": true,
            "temperature": 0.75,
            "max_tokens": 1600
        }))
        .send()
        .await
        .map_err(|error| AppError::new("ai_request_failed", error.to_string()))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::new(
            "ai_response_failed",
            format!("大模型接口返回异常：{} {}", status, body),
        ));
    }

    Ok(AiStream {
        fallback_chunks: Vec::new(),
        fallback_cursor: 0,
        remote_response: Some(response),
        pending_text: String::new(),
        finished: false,
    })
}

impl AiStream {
    fn fallback(message: &str) -> Self {
        Self {
            fallback_chunks: message
                .chars()
                .map(|character| character.to_string())
                .collect(),
            fallback_cursor: 0,
            remote_response: None,
            pending_text: String::new(),
            finished: false,
        }
    }

    pub async fn next_delta(&mut self) -> Result<Option<String>, AppError> {
        if self.fallback_cursor < self.fallback_chunks.len() {
            let delta = self.fallback_chunks[self.fallback_cursor].clone();
            self.fallback_cursor += 1;
            return Ok(Some(delta));
        }

        if self.finished {
            return Ok(None);
        }

        loop {
            if let Some(delta) = self.pop_next_sse_delta() {
                return Ok(Some(delta));
            }

            if self.finished {
                return Ok(None);
            }

            let Some(response) = self.remote_response.as_mut() else {
                return Ok(None);
            };
            let Some(chunk) = response
                .chunk()
                .await
                .map_err(|error| AppError::new("ai_stream_failed", error.to_string()))?
            else {
                self.finished = true;
                return Ok(None);
            };
            self.pending_text.push_str(&String::from_utf8_lossy(&chunk));
        }
    }

    fn pop_next_sse_delta(&mut self) -> Option<String> {
        loop {
            let boundary = self
                .pending_text
                .find("\n\n")
                .or_else(|| self.pending_text.find("\r\n\r\n"))?;
            let frame = self.pending_text[..boundary].to_string();
            let drain_to = if self.pending_text[boundary..].starts_with("\r\n\r\n") {
                boundary + 4
            } else {
                boundary + 2
            };
            self.pending_text.drain(..drain_to);

            for line in frame.lines() {
                let line = line.trim();
                if !line.starts_with("data:") {
                    continue;
                }
                let data = line.trim_start_matches("data:").trim();
                if data == "[DONE]" {
                    self.finished = true;
                    return None;
                }
                let Ok(value) = serde_json::from_str::<serde_json::Value>(data) else {
                    continue;
                };
                if let Some(reason) = value["choices"][0]["finish_reason"].as_str() {
                    if reason != "null" && !reason.is_empty() {
                        self.finished = true;
                    }
                }
                if let Some(content) = value["choices"][0]["delta"]["content"].as_str() {
                    if !content.is_empty() {
                        return Some(content.to_string());
                    }
                }
            }
        }
    }
}
