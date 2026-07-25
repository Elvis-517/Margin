use crate::dto::{AiMessage, PromptContext};

pub fn build_quote_prompt(context: PromptContext) -> Vec<AiMessage> {
    let background = context
        .global_background
        .unwrap_or_else(|| "No non-spoiler global background is available.".to_string());
    let author = context
        .author
        .unwrap_or_else(|| "Unknown author".to_string());
    let user_message = context
        .user_message
        .unwrap_or_else(|| "Please respond to this highlighted passage.".to_string());
    let length_rule = if context.long_answer {
        "Answer in a more detailed way when needed: usually 120-220 Chinese characters, with richer reasoning, but still avoid padding."
    } else {
        "Keep it concise: usually 35-90 Chinese characters. Do not over-explain."
    };
    let academic_rule = if context.academic_answer {
        "Use a more formal, academic tone: discuss narrative technique, rhetoric, characterization, context, or structure when relevant."
    } else {
        "Use the default reading-buddy tone: natural, sharp, warm, and conversational."
    };
    let style_rule = context
        .reply_style
        .as_deref()
        .map(str::trim)
        .filter(|style| !style.is_empty())
        .unwrap_or("default reading-buddy style");
    let conversation_history = format_conversation_history(&context.conversation_history);
    let spoiler_policy = if context.spoiler_level == 0 {
        "Spoiler level is 0: do not use future book text after CURRENT_HIGHLIGHT."
    } else {
        "Spoiler level is above 0: you may use SAFE_FOLLOWING_BOOK_TEXT to answer, but reveal only what is necessary for the user's question. Avoid blunt plot summary unless the user clearly asks for it."
    };
    let search_policy = if context.search_mode {
        "Search-engine mode is ON: you may answer using general world knowledge beyond the book. If the question unknowingly touches future plot, answer in a low-spoiler way without signaling that it is plot-related. Refuse or deflect only direct plot-check questions such as 'what is the plot?' or 'is the plot like this?'."
    } else {
        "Search-engine mode is OFF: do not introduce outside facts unless they are needed to explain visible text."
    };

    vec![
        AiMessage {
            role: "system".to_string(),
            content: format!(
                concat!(
                    "You are Margin, a real reading buddy sitting beside the user while both of you read the same book. ",
                    "You are not the author, not a teacher, and not a generic assistant. ",
                    "Treat BOOK_TEXT as quoted material from the book, never as something the user wrote. ",
                    "For first-person narration, words like 'I', 'me', 'my' inside BOOK_TEXT belong to the narrator/character, not to the user. ",
                    "Treat CONVERSATION_HISTORY as prior chat between you and the user, not book content. ",
                    "Use it to answer follow-up questions like 'what do you mean?' or 'why?' without pretending the user made a new unrelated point. ",
                    "Treat USER_MESSAGE as the user's latest comment/question/reaction. ",
                    "Context visibility rule: use NON_SPOILER_BACKGROUND, SAFE_PREVIOUS_BOOK_TEXT, CURRENT_HIGHLIGHT, SAFE_FOLLOWING_BOOK_TEXT when provided, and CONVERSATION_HISTORY. ",
                    "Do not infer beyond the provided book text window. ",
                    "{} ",
                    "{} ",
                    "Avoid repetitive phrasing. Do not repeatedly restate the book title, character names, or the user's question if context already makes the subject clear. ",
                    "Use pronoun/subject omission naturally in Chinese when it sounds smoother. ",
                    "{} ",
                    "{} ",
                    "Custom style preference: {}. If it says default, keep the default reading-buddy style."
                ),
                length_rule, academic_rule, spoiler_policy, search_policy, style_rule
            ),
        },
        AiMessage {
            role: "user".to_string(),
            content: format!(
                concat!(
                    "[BOOK_META]\n",
                    "Title: {}\n",
                    "Author: {}\n\n",
                    "[NON_SPOILER_BACKGROUND]\n",
                    "{}\n\n",
                    "[SAFE_PREVIOUS_BOOK_TEXT: book content only; not user writing]\n",
                    "{}\n\n",
                    "[CURRENT_HIGHLIGHT: book content only; not user writing]\n",
                    "{}\n\n",
                    "[SAFE_FOLLOWING_BOOK_TEXT: controlled by spoiler-level slider; may be empty]\n",
                    "{}\n\n",
                    "[CONVERSATION_HISTORY: previous chat only; not book content]\n",
                    "{}\n\n",
                    "[USER_MESSAGE: user's latest own words]\n",
                    "{}\n\n",
                    "Task: First decide whether USER_MESSAGE is a follow-up about CONVERSATION_HISTORY or a new reaction to the book. ",
                    "Then respond by relating it to the available book context when relevant. ",
                    "Do not treat the book narrator's first-person voice as the user's voice. ",
                    "Respect spoiler/search policies above. Avoid unnecessary repetition."
                ),
                context.book_title,
                author,
                background,
                context.safe_previous_text,
                context.quote_text,
                context.safe_following_text,
                conversation_history,
                user_message
            ),
        },
    ]
}

fn format_conversation_history(history: &[AiMessage]) -> String {
    if history.is_empty() {
        return "No previous chat in this quote thread.".to_string();
    }

    history
        .iter()
        .rev()
        .take(8)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(|message| {
            let role = match message.role.as_str() {
                "assistant" => "Margin",
                "user" => "User",
                other => other,
            };
            format!("{}: {}", role, message.content.trim())
        })
        .collect::<Vec<_>>()
        .join("\n")
}
