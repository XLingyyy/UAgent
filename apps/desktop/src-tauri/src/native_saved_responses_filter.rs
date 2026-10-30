//! Credential-echo firewall for saved-key ordinary Responses conversations.
//!
//! Every released SSE frame is byte-for-byte the received frame. Potential
//! credential-prefix text keeps that frame and all following frames private
//! until it can be ruled out. No synthetic events or sequence numbers are made.
//! This is not a protocol/permission grant; the existing Responses parser still
//! validates response/model/item identity. Function calls are not enabled here.
#![cfg(windows)]

use serde_json::Value;
use std::{
    collections::HashMap,
    sync::atomic::{compiler_fence, Ordering},
};

const MAX_BODY: usize = 4_194_304;
// A terminal SSE event can contain the whole reply. Preserve the existing
// total-body bound while keeping each returned IPC chunk at 64 KiB.
const MAX_FRAME: usize = MAX_BODY;
const MAX_CHUNK: usize = 65_536;
const MAX_FRAMES: usize = 20_000;
const MAX_PARTS: usize = 512;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

fn zero(bytes: &mut [u8]) {
    for byte in bytes {
        unsafe { std::ptr::write_volatile(byte, 0) };
    }
    compiler_fence(Ordering::SeqCst);
}
fn erase(text: &mut String) {
    // The mutable bytes are only zeroed, so UTF-8 validity is preserved.
    unsafe { zero(text.as_bytes_mut()) };
    text.clear();
}
struct Secret(Vec<u8>);
impl Drop for Secret {
    fn drop(&mut self) {
        zero(&mut self.0);
    }
}
fn includes(bytes: &[u8], key: &[u8]) -> bool {
    !key.is_empty() && bytes.windows(key.len()).any(|part| part == key)
}
fn contains_secret(value: &Value, key: &[u8], depth: usize) -> bool {
    if depth > 32 {
        return true;
    }
    match value {
        Value::String(value) => {
            if includes(value.as_bytes(), key) {
                return true;
            }
            // JSON embedded in a string is parsed again before it can enter
            // renderer/native-output archives, including encoded object keys.
            serde_json::from_str::<Value>(value)
                .is_ok_and(|nested| contains_secret(&nested, key, depth + 1))
        }
        Value::Array(values) => values
            .iter()
            .any(|value| contains_secret(value, key, depth + 1)),
        Value::Object(values) => values.iter().any(|(name, value)| {
            contains_secret(&Value::String(name.clone()), key, depth + 1)
                || contains_secret(value, key, depth + 1)
        }),
        _ => false,
    }
}
fn frame_end(bytes: &[u8], eof: bool) -> Option<usize> {
    let mut line_start = 0;
    let mut cursor = 0;
    while cursor < bytes.len() {
        let byte = bytes[cursor];
        if byte != b'\n' && byte != b'\r' {
            cursor += 1;
            continue;
        }
        if byte == b'\r' && cursor + 1 == bytes.len() && !eof {
            return None;
        }
        let width = if byte == b'\r' && bytes.get(cursor + 1) == Some(&b'\n') {
            2
        } else {
            1
        };
        if cursor == line_start {
            return Some(cursor + width);
        }
        cursor += width;
        line_start = cursor;
    }
    None
}
struct TextPart {
    value: String,
    kind: &'static str,
    done: bool,
}
impl Drop for TextPart {
    fn drop(&mut self) {
        erase(&mut self.value);
    }
}

/// Holds no filesystem, vault, network or renderer capability.
pub(crate) struct SavedResponsesFilter {
    key: Secret,
    raw: Vec<u8>,
    queued: Vec<Vec<u8>>,
    queued_bytes: usize,
    raw_bytes: usize,
    frames: usize,
    sequence: Option<u64>,
    parts: HashMap<(u64, u64), TextPart>,
    visible: String,
    tails: HashMap<String, String>,
    terminal: bool,
    finished: bool,
    poisoned: bool,
}
impl SavedResponsesFilter {
    pub(crate) fn new(mut key: Vec<u8>) -> Result<Self, ()> {
        if !(8..=2048).contains(&key.len()) || key.iter().any(|byte| !(0x21..=0x7e).contains(byte))
        {
            zero(&mut key);
            return Err(());
        }
        Ok(Self {
            key: Secret(key),
            raw: vec![],
            queued: vec![],
            queued_bytes: 0,
            raw_bytes: 0,
            frames: 0,
            sequence: None,
            parts: HashMap::new(),
            visible: String::new(),
            tails: HashMap::new(),
            terminal: false,
            finished: false,
            poisoned: false,
        })
    }
    fn reject<T>(&mut self) -> Result<T, ()> {
        self.poisoned = true;
        zero(&mut self.raw);
        self.raw.clear();
        for frame in &mut self.queued {
            zero(frame);
        }
        self.queued.clear();
        self.queued_bytes = 0;
        erase(&mut self.visible);
        for tail in self.tails.values_mut() {
            erase(tail);
        }
        self.tails.clear();
        self.parts.clear();
        Err(())
    }
    fn track(&mut self, name: String, text: &str) -> Result<(), ()> {
        if self.tails.len() >= MAX_PARTS && !self.tails.contains_key(&name) {
            return Err(());
        }
        let mut tail = self.tails.remove(&name).unwrap_or_default();
        if tail
            .len()
            .checked_add(text.len())
            .map_or(true, |bytes| bytes > MAX_BODY)
        {
            return Err(());
        }
        tail.push_str(text);
        if includes(tail.as_bytes(), &self.key.0) {
            erase(&mut tail);
            return Err(());
        }
        let retained = (1..self.key.0.len())
            .rev()
            .find(|length| tail.as_bytes().ends_with(&self.key.0[..*length]))
            .unwrap_or(0);
        if retained == 0 {
            erase(&mut tail);
        } else {
            let keep = tail[tail.len() - retained..].to_owned();
            erase(&mut tail);
            self.tails.insert(name, keep);
        }
        Ok(())
    }
    fn index(value: &Value, field: &str) -> Result<u64, ()> {
        value
            .get(field)
            .and_then(Value::as_u64)
            .filter(|n| *n <= 255)
            .ok_or(())
    }
    fn visible_delta(&mut self, event: &Value, kind: &'static str, done: bool) -> Result<(), ()> {
        let index = (
            Self::index(event, "output_index")?,
            Self::index(event, "content_index")?,
        );
        if self.parts.len() >= MAX_PARTS && !self.parts.contains_key(&index) {
            return Err(());
        }
        let part = self.parts.entry(index).or_insert_with(|| TextPart {
            value: String::new(),
            kind,
            done: false,
        });
        if part.done || part.kind != kind {
            return Err(());
        }
        let source = if done { kind } else { "delta" };
        let text = event.get(source).and_then(Value::as_str).ok_or(())?;
        let delta = if done {
            text.strip_prefix(part.value.as_str()).ok_or(())?
        } else {
            text
        };
        if part
            .value
            .len()
            .checked_add(delta.len())
            .map_or(true, |n| n > MAX_BODY)
            || self
                .visible
                .len()
                .checked_add(delta.len())
                .map_or(true, |n| n > MAX_BODY)
        {
            return Err(());
        }
        part.value.push_str(delta);
        part.done = done;
        self.visible.push_str(delta);
        if includes(self.visible.as_bytes(), &self.key.0) {
            return Err(());
        }
        self.track("visible".into(), delta)?;
        self.track(format!("part:{}:{}", index.0, index.1), delta)?;
        self.track("all-deltas".into(), delta)?;
        if done {
            self.tails.remove(&format!("part:{}:{}", index.0, index.1));
        }
        Ok(())
    }
    fn terminal_text(&self, response: &Value) -> Result<String, ()> {
        let output = response
            .get("output")
            .and_then(Value::as_array)
            .filter(|v| v.len() <= 256)
            .ok_or(())?;
        let mut result = String::new();
        for item in output {
            match item.get("type").and_then(Value::as_str).ok_or(())? {
                "message" => {
                    if item.get("role").and_then(Value::as_str) != Some("assistant") {
                        return Err(());
                    }
                    for part in item
                        .get("content")
                        .and_then(Value::as_array)
                        .filter(|v| v.len() <= MAX_PARTS)
                        .ok_or(())?
                    {
                        let field = match part.get("type").and_then(Value::as_str).ok_or(())? {
                            "output_text" => "text",
                            "refusal" => "refusal",
                            _ => return Err(()),
                        };
                        let text = part.get(field).and_then(Value::as_str).ok_or(())?;
                        if result
                            .len()
                            .checked_add(text.len())
                            .map_or(true, |n| n > MAX_BODY)
                        {
                            return Err(());
                        }
                        result.push_str(text);
                    }
                }
                "reasoning" => {}
                // Saved ordinary chat does not advertise executable functions.
                _ => return Err(()),
            }
        }
        if includes(result.as_bytes(), &self.key.0) {
            return Err(());
        }
        Ok(result)
    }
    fn event(&mut self, value: &Value, event_name: Option<&str>) -> Result<(), ()> {
        if self.terminal {
            return Err(());
        }
        if contains_secret(value, &self.key.0, 0) {
            return Err(());
        }
        let kind = value.get("type").and_then(Value::as_str).ok_or(())?;
        if event_name.is_some_and(|name| name != "message" && name != kind) {
            return Err(());
        }
        if let Some(sequence) = value.get("sequence_number") {
            let number = sequence
                .as_u64()
                .filter(|n| *n <= MAX_SAFE_INTEGER)
                .ok_or(())?;
            if self.sequence.is_some_and(|previous| number <= previous) {
                return Err(());
            }
            self.sequence = Some(number);
        }
        if kind.starts_with("response.function_call")
            || value
                .get("item")
                .and_then(|item| item.get("type"))
                .and_then(Value::as_str)
                == Some("function_call")
        {
            return Err(());
        }
        match kind {
            "response.output_text.delta" => self.visible_delta(value, "text", false)?,
            "response.output_text.done" => self.visible_delta(value, "text", true)?,
            "response.refusal.delta" => self.visible_delta(value, "refusal", false)?,
            "response.refusal.done" => self.visible_delta(value, "refusal", true)?,
            "error" | "response.failed" | "response.cancelled" => return Err(()),
            "response.completed" | "response.incomplete" => {
                let response = value.get("response").ok_or(())?;
                if response.get("status").and_then(Value::as_str) != kind.strip_prefix("response.")
                {
                    return Err(());
                }
                if kind == "response.incomplete"
                    && response
                        .pointer("/incomplete_details/reason")
                        .and_then(Value::as_str)
                        != Some("max_output_tokens")
                {
                    return Err(());
                }
                let mut final_text = self.terminal_text(response)?;
                if !final_text.starts_with(&self.visible) {
                    erase(&mut final_text);
                    return Err(());
                }
                self.track("visible".into(), &final_text[self.visible.len()..])?;
                erase(&mut final_text);
                // A verified full terminal response proves these retained prefixes
                // never became a complete credential. Preserve the original frames.
                for tail in self.tails.values_mut() {
                    erase(tail);
                }
                self.tails.clear();
                self.terminal = true;
            }
            _ => {
                // Reasoning/summary text is not main-body output, but raw native
                // records must not reconstruct a key across those deltas either.
                if kind.ends_with(".delta") {
                    if let Some(text) = value.get("delta").and_then(Value::as_str) {
                        let channel = format!(
                            "other:{kind}:{}:{}:{}",
                            value.get("item_id").and_then(Value::as_str).unwrap_or(""),
                            value
                                .get("output_index")
                                .and_then(Value::as_u64)
                                .unwrap_or(0),
                            value
                                .get("summary_index")
                                .and_then(Value::as_u64)
                                .unwrap_or(0)
                        );
                        self.track(channel, text)?;
                        self.track("all-deltas".into(), text)?;
                    }
                }
            }
        }
        Ok(())
    }
    fn frame(&mut self, frame: Vec<u8>) -> Result<Vec<Vec<u8>>, ()> {
        if frame.len() > MAX_FRAME || includes(&frame, &self.key.0) {
            return Err(());
        }
        self.frames = self.frames.checked_add(1).ok_or(())?;
        if self.frames > MAX_FRAMES {
            return Err(());
        }
        let text = std::str::from_utf8(&frame).map_err(|_| ())?;
        let text = if self.frames == 1 {
            text.strip_prefix('\u{feff}').unwrap_or(text)
        } else {
            text
        };
        let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
        let mut data = Vec::new();
        let mut event_name = None;
        for line in normalized.lines() {
            if line.is_empty() || line.starts_with(':') {
                continue;
            }
            let (field, content) = line.split_once(':').unwrap_or((line, ""));
            let content = content.strip_prefix(' ').unwrap_or(content);
            if field == "data" {
                data.push(content);
            } else if field == "event" {
                event_name = Some(content);
            }
        }
        if !data.is_empty() {
            let value: Value = serde_json::from_str(&data.join("\n")).map_err(|_| ())?;
            self.event(&value, event_name)?;
        }
        self.queued_bytes = self.queued_bytes.checked_add(frame.len()).ok_or(())?;
        if self.queued_bytes > MAX_BODY {
            return Err(());
        }
        self.queued.push(frame);
        if self.tails.is_empty() {
            self.queued_bytes = 0;
            let mut output = Vec::new();
            for frame in std::mem::take(&mut self.queued) {
                if frame.len() <= MAX_CHUNK {
                    output.push(frame);
                } else {
                    output.extend(frame.chunks(MAX_CHUNK).map(<[u8]>::to_vec));
                }
            }
            Ok(output)
        } else {
            Ok(vec![])
        }
    }
    fn drain(&mut self, eof: bool) -> Result<Vec<Vec<u8>>, ()> {
        let mut output = Vec::new();
        while let Some(end) = frame_end(&self.raw, eof) {
            if end > MAX_FRAME {
                return Err(());
            }
            let frame = self.raw.drain(..end).collect();
            output.extend(self.frame(frame)?);
        }
        if self.raw.len() > MAX_FRAME {
            return Err(());
        }
        Ok(output)
    }
    pub(crate) fn push(&mut self, bytes: &[u8]) -> Result<Vec<Vec<u8>>, ()> {
        if self.poisoned || self.finished || bytes.len() > MAX_CHUNK {
            return self.reject();
        }
        let Some(total) = self.raw_bytes.checked_add(bytes.len()) else {
            return self.reject();
        };
        if total > MAX_BODY {
            return self.reject();
        }
        self.raw_bytes = total;
        self.raw.extend_from_slice(bytes);
        match self.drain(false) {
            Ok(output) => Ok(output),
            Err(()) => self.reject(),
        }
    }
    pub(crate) fn finish(&mut self) -> Result<Vec<Vec<u8>>, ()> {
        if self.poisoned || self.finished {
            return self.reject();
        }
        let output = match self.drain(true) {
            Ok(output) => output,
            Err(()) => return self.reject(),
        };
        if !self.terminal
            || !self.raw.is_empty()
            || !self.queued.is_empty()
            || !self.tails.is_empty()
        {
            return self.reject();
        }
        self.finished = true;
        Ok(output)
    }
}
impl Drop for SavedResponsesFilter {
    fn drop(&mut self) {
        zero(&mut self.raw);
        for frame in &mut self.queued {
            zero(frame);
        }
        erase(&mut self.visible);
        for tail in self.tails.values_mut() {
            erase(tail);
        }
    }
}
#[cfg(test)]
#[path = "native_saved_responses_filter/tests.rs"]
mod tests;
