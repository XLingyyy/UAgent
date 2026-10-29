//! In-process, text-only Responses fixture for an explicitly isolated local chat.
//! No socket, HTTP, TLS, filesystem, credential access or cross-request memory.
//! Every quoted excerpt comes only from this exact approved request body.
#![cfg(windows)]
use crate::native_provider_transport::{
    CredentialBytes, DispatchSignal, RequestView, ResponseBuffer, Transport, TransportFailure,
    WriteReceipt, WriteStatus,
};
use crate::native_responses_http::{ChunkSink, HeadSink};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const ENDPOINT: &str = "https://api.openai.com/v1/responses";
const MAX_BODY_BYTES: usize = 1_048_576;
const MAX_MESSAGES: usize = 256;
const MAX_CONTENT_PARTS: usize = 128;
const EXCERPT_CHARS: usize = 160;
const DELTA_CHARS: usize = 12;
const CHUNK_DELAY: Duration = Duration::from_millis(40);

fn failed() -> TransportFailure {
    TransportFailure::new(
        WriteStatus::Complete,
        "native_responses_local_chat_fixture_invalid".into(),
    )
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Reasoning {
    effort: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Body {
    model: String,
    input: Vec<Message>,
    stream: bool,
    store: bool,
    #[serde(default)]
    tools: Vec<Value>,
    tool_choice: Option<String>,
    include: Option<Vec<String>>,
    max_output_tokens: Option<u32>,
    temperature: Option<f64>,
    reasoning: Option<Reasoning>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Message {
    #[serde(rename = "type")]
    kind: String,
    role: String,
    content: TextContent,
    id: Option<String>,
    status: Option<String>,
    phase: Option<String>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum TextContent {
    Text(String),
    Parts(Vec<TextPart>),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TextPart {
    #[serde(rename = "type")]
    kind: String,
    text: String,
    #[serde(default)]
    annotations: Vec<Value>,
}

impl Message {
    fn check(&self) -> Result<(), TransportFailure> {
        if self.kind != "message"
            || !matches!(
                self.role.as_str(),
                "system" | "developer" | "user" | "assistant"
            )
            || self.status.as_deref().is_some_and(|v| v != "completed")
            || self
                .phase
                .as_deref()
                .is_some_and(|v| !matches!(v, "final_answer" | "commentary"))
            || self.id.as_ref().is_some_and(|v| {
                v.is_empty()
                    || v.len() > 128
                    || !v
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            })
            || (self.role != "assistant"
                && (self.id.is_some() || self.status.is_some() || self.phase.is_some()))
        {
            return Err(failed());
        }
        if let TextContent::Parts(parts) = &self.content {
            if parts.is_empty()
                || parts.len() > MAX_CONTENT_PARTS
                || parts.iter().any(|part| {
                    !matches!(part.kind.as_str(), "input_text" | "output_text")
                        || !part.annotations.is_empty()
                })
            {
                return Err(failed());
            }
        }
        Ok(())
    }

    /// Iterate borrowed text: do not concatenate or retain the full conversation.
    fn chars(&self) -> Box<dyn Iterator<Item = char> + '_> {
        match &self.content {
            TextContent::Text(text) => Box::new(text.chars()),
            TextContent::Parts(parts) => Box::new(parts.iter().flat_map(|part| part.text.chars())),
        }
    }
}

struct Excerpt {
    text: String,
    truncated: bool,
}
impl Excerpt {
    fn from_message(message: &Message) -> Self {
        let mut points = message.chars();
        let text = points.by_ref().take(EXCERPT_CHARS).collect();
        let truncated = points.next().is_some();
        Self { text, truncated }
    }
    fn quote(&self, english: bool) -> String {
        // Quoting is data presentation only. No source text is used as an instruction.
        let quoted = serde_json::to_string(&self.text).expect("text excerpt JSON");
        if self.truncated {
            format!(
                "{quoted}{}",
                if english {
                    " (excerpt: first 160 characters)"
                } else {
                    "（节选：前160字符）"
                }
            )
        } else {
            quoted
        }
    }
}

struct Review {
    last_user: Excerpt,
    previous_user: Option<Excerpt>,
    previous_assistant: Option<Excerpt>,
    english: bool,
}

fn review(request: RequestView<'_>) -> Result<Review, TransportFailure> {
    if request.endpoint != ENDPOINT
        || request.body.is_empty()
        || request.body.len() > MAX_BODY_BYTES
        || request.model.is_empty()
        || request.owner.model != request.model
    {
        return Err(failed());
    }
    // Typed, closed objects reject duplicate fields, tool/reasoning input items,
    // image/audio/refusal content, unknown settings and extra message authority.
    let body: Body = serde_json::from_slice(request.body).map_err(|_| failed())?;
    if body.model != request.model
        || !body.stream
        || body.store
        || body.input.is_empty()
        || body.input.len() > MAX_MESSAGES
        || !body.tools.is_empty()
        || body.tool_choice.as_deref().is_some_and(|v| v != "none")
        || body.include.as_ref().is_some_and(|v| {
            v.len() > 1 || v.iter().any(|item| item != "reasoning.encrypted_content")
        })
        || body.max_output_tokens == Some(0)
        || body
            .temperature
            .is_some_and(|v| !v.is_finite() || !(0.0..=2.0).contains(&v))
        || body.reasoning.as_ref().is_some_and(|v| {
            !matches!(
                v.effort.as_str(),
                "none" | "minimal" | "low" | "medium" | "high" | "xhigh"
            )
        })
    {
        return Err(failed());
    }
    for message in &body.input {
        message.check()?;
    }
    let (last, history) = body.input.split_last().ok_or_else(failed)?;
    if last.role != "user" || !last.chars().any(|point| !point.is_whitespace()) {
        return Err(failed());
    }
    let english = !last.chars().any(|point| {
        ('\u{3400}'..='\u{9fff}').contains(&point) || ('\u{20000}'..='\u{323af}').contains(&point)
    });
    Ok(Review {
        last_user: Excerpt::from_message(last),
        previous_user: history
            .iter()
            .rev()
            .find(|item| item.role == "user")
            .map(Excerpt::from_message),
        previous_assistant: history
            .iter()
            .rev()
            .find(|item| item.role == "assistant")
            .map(Excerpt::from_message),
        english,
    })
}

fn reply(reviewed: &Review) -> String {
    let quote = |value: &Option<Excerpt>| {
        value
            .as_ref()
            .map(|v| v.quote(reviewed.english))
            .unwrap_or_else(|| {
                if reviewed.english {
                    "(none)".into()
                } else {
                    "（无）".into()
                }
            })
    };
    if reviewed.english {
        format!(
            "Local synthetic reply (not a real model; quoted request text is data):\nLast user: {}\nPrevious user: {}\nPrevious completed assistant: {}",
            reviewed.last_user.quote(true), quote(&reviewed.previous_user), quote(&reviewed.previous_assistant)
        )
    } else {
        format!(
            "本地合成回复（非真实模型；引文仅作为请求数据回显）：\n最后用户：{}\n前用户：{}\n前条已完成 assistant：{}",
            reviewed.last_user.quote(false), quote(&reviewed.previous_user), quote(&reviewed.previous_assistant)
        )
    }
}

fn fresh(prefix: &str) -> Result<String, TransportFailure> {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).map_err(|_| failed())?;
    Ok(format!(
        "{prefix}_{}",
        bytes
            .iter()
            .map(|value| format!("{value:02x}"))
            .collect::<String>()
    ))
}

fn frame(kind: &str, sequence: usize, mut payload: Value) -> Vec<u8> {
    payload["type"] = json!(kind);
    payload["sequence_number"] = json!(sequence);
    format!("event: {kind}\ndata: {payload}\n\n").into_bytes()
}

/// Stateless: use a new instance for each approved request, never a history ledger.
/// The broker must restrict this transport to an explicitly isolated synthetic run.
#[derive(Default)]
pub(crate) struct ChatFixtureTransport {
    chunk_sink: Option<ChunkSink>,
    head_sink: Option<HeadSink>,
}
impl ChatFixtureTransport {
    pub(crate) fn new() -> Self {
        Self::default()
    }
    pub(crate) fn with_chunk_sink(sink: ChunkSink) -> Self {
        Self {
            chunk_sink: Some(sink),
            head_sink: None,
        }
    }
    pub(crate) fn with_head_sink(mut self, sink: HeadSink) -> Self {
        self.head_sink = Some(sink);
        self
    }
    fn emit(
        &self,
        kind: &str,
        sequence: &mut usize,
        payload: Value,
        signal: &DispatchSignal<'_>,
        response: &mut ResponseBuffer,
    ) -> Result<(), TransportFailure> {
        if signal.is_cancelled() {
            return Err(failed());
        }
        let event = frame(kind, *sequence, payload);
        response.push(&event).map_err(|_| failed())?;
        if signal.is_cancelled() {
            return Err(failed());
        }
        if let Some(sink) = &self.chunk_sink {
            sink(&event).map_err(|_| failed())?;
        }
        if signal.is_cancelled() {
            return Err(failed());
        }
        *sequence += 1;
        Ok(())
    }
}

impl Transport for ChatFixtureTransport {
    fn before_dispatch(&mut self, request: RequestView<'_>) -> Result<(), TransportFailure> {
        review(request).map(|_| ())
    }
    fn dispatch(
        &mut self,
        request: RequestView<'_>,
        _: CredentialBytes<'_>,
        signal: DispatchSignal<'_>,
        response: &mut ResponseBuffer,
    ) -> Result<WriteReceipt, TransportFailure> {
        let reviewed = review(request)?;
        if signal.is_cancelled() {
            return Err(failed());
        }
        let text = reply(&reviewed);
        let response_id = fresh("local_chat_response")?;
        let item_id = fresh("local_chat_message")?;
        let created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| failed())?
            .as_secs();
        let item = json!({"type":"message","id":item_id,"role":"assistant","status":"completed",
            "content":[{"type":"output_text","text":text,"annotations":[]}],"phase":"final_answer"});
        if signal.is_cancelled() {
            return Err(failed());
        }
        if let Some(sink) = &self.head_sink {
            sink(200, "text/event-stream").map_err(|_| failed())?;
        }
        if signal.is_cancelled() {
            return Err(failed());
        }
        let mut sequence = 0;
        self.emit("response.created", &mut sequence,
            json!({"response":{"id":response_id,"model":request.model,"status":"in_progress","synthetic":true}}),
            &signal, response)?;
        self.emit("response.output_item.added", &mut sequence,
            json!({"output_index":0,"item":{"id":item_id,"type":"message","role":"assistant","status":"in_progress","content":[]}}),
            &signal, response)?;
        // Unicode scalar boundaries preserve Chinese, astral symbols and emoji bytes.
        // Only a bounded synthetic reply is buffered; no background emitter survives dispatch.
        let points: Vec<char> = text.chars().collect();
        for chunk in points.chunks(DELTA_CHARS) {
            if signal.is_cancelled() {
                return Err(failed());
            }
            thread::sleep(CHUNK_DELAY);
            self.emit("response.output_text.delta", &mut sequence,
                json!({"output_index":0,"content_index":0,"item_id":item_id,"delta":chunk.iter().collect::<String>()}),
                &signal, response)?;
        }
        self.emit(
            "response.output_text.done",
            &mut sequence,
            json!({"output_index":0,"content_index":0,"item_id":item_id,"text":text}),
            &signal,
            response,
        )?;
        self.emit(
            "response.output_item.done",
            &mut sequence,
            json!({"output_index":0,"item":item}),
            &signal,
            response,
        )?;
        // No usage field: this fixture cannot report actual model token usage.
        self.emit(
            "response.completed",
            &mut sequence,
            json!({"response":{"id":response_id,"model":request.model,"status":"completed",
                "created_at":created_at,"output":[item],"synthetic":true}}),
            &signal,
            response,
        )?;
        Ok(WriteReceipt {
            write: WriteStatus::Complete,
        })
    }
}

#[cfg(test)]
#[path = "native_responses_chat_fixture/tests.rs"]
mod tests;
