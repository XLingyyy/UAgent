//! Fixed official DeepSeek transport and credential-safe, incremental SSE projection.
//! No raw provider metadata, headers, error body or tool arguments leave this module.
#![cfg(windows)]
use crate::native_provider_transport::{
    CredentialBytes, DispatchSignal, RequestView, ResponseBuffer, Transport, TransportFailure,
    WriteReceipt,
};
use crate::native_responses_http::{ChunkSink, HeadSink, WinHttpResponsesTransport};
use serde_json::{json, Value};

pub(crate) struct WinHttpDeepSeekTransport(WinHttpResponsesTransport);
impl WinHttpDeepSeekTransport {
    pub(crate) fn with_sinks(chunk: ChunkSink, head: HeadSink) -> Self {
        Self(WinHttpResponsesTransport::deepseek(chunk).with_head_sink(head))
    }
}
impl Transport for WinHttpDeepSeekTransport {
    fn before_dispatch(&mut self, request: RequestView<'_>) -> Result<(), TransportFailure> {
        self.0.before_dispatch(request)
    }
    fn dispatch(
        &mut self,
        request: RequestView<'_>,
        credential: CredentialBytes<'_>,
        signal: DispatchSignal<'_>,
        response: &mut ResponseBuffer,
    ) -> Result<WriteReceipt, TransportFailure> {
        self.0.dispatch(request, credential, signal, response)
    }
}

pub(crate) struct SecretBytes(pub Vec<u8>);
impl Drop for SecretBytes {
    fn drop(&mut self) {
        self.0.fill(0);
    }
}
/// JSON decoding occurs before checks, including JSON nested in string values.
pub(crate) fn contains_secret(value: &Value, key: &[u8], depth: usize) -> bool {
    if depth > 16 {
        return true;
    }
    match value {
        Value::String(s) => {
            if s.as_bytes().windows(key.len().max(1)).any(|w| w == key) {
                return true;
            }
            if s.len() < 65536 {
                if let Ok(nested) = serde_json::from_str::<Value>(s) {
                    return contains_secret(&nested, key, depth + 1);
                }
            }
            false
        }
        Value::Array(items) => items.iter().any(|v| contains_secret(v, key, depth + 1)),
        Value::Object(map) => map.iter().any(|(k, v)| {
            contains_secret(&Value::String(k.clone()), key, depth + 1)
                || contains_secret(v, key, depth + 1)
        }),
        _ => false,
    }
}
/// Retain every suffix that could become a credential on a later delta. No
/// prefix of a subsequently completed credential has already escaped to IPC.
pub(crate) fn safe_text_delta(
    held: &mut String,
    key: &[u8],
    text: &str,
    flush: bool,
) -> Result<String, ()> {
    if key.is_empty()
        || held
            .len()
            .checked_add(text.len())
            .map_or(true, |n| n > 1_048_576)
    {
        return Err(());
    }
    held.push_str(text);
    if held.as_bytes().windows(key.len()).any(|w| w == key) {
        return Err(());
    }
    let retained = if flush {
        0
    } else {
        (1..key.len())
            .rev()
            .find(|n| held.as_bytes().ends_with(&key[..*n]))
            .unwrap_or(0)
    };
    let cut = held.len() - retained;
    let released = held[..cut].to_owned();
    *held = held[cut..].to_owned();
    Ok(released)
}
pub(crate) struct SafeSse {
    key: SecretBytes,
    raw: Vec<u8>,
    held: String,
    output_bytes: usize,
    raw_bytes: usize,
    finished: bool,
    done: bool,
}
impl SafeSse {
    pub(crate) fn new(key: Vec<u8>) -> Result<Self, ()> {
        if key.len() < 8 || key.len() > 16384 || key.iter().any(|b| !(0x21..=0x7e).contains(b)) {
            return Err(());
        }
        Ok(Self {
            key: SecretBytes(key),
            raw: vec![],
            held: String::new(),
            output_bytes: 0,
            raw_bytes: 0,
            finished: false,
            done: false,
        })
    }
    fn content(&mut self, text: &str, flush: bool) -> Result<String, ()> {
        self.output_bytes = self.output_bytes.checked_add(text.len()).ok_or(())?;
        if self.output_bytes > 16384 {
            return Err(());
        }
        safe_text_delta(&mut self.held, &self.key.0, text, flush)
    }
    fn frame(&mut self, frame: &str) -> Result<Vec<Vec<u8>>, ()> {
        let lines: Vec<&str> = frame.lines().collect();
        let mut data = Vec::new();
        for line in lines {
            if let Some(value) = line.strip_prefix("data:") {
                data.push(value.trim_start());
            } else if line.starts_with(':') || line.is_empty() {
                continue;
            } else {
                return Err(());
            }
        }
        if data.is_empty() {
            return Ok(vec![]);
        }
        let data = data.join("\n");
        if data == "[DONE]" {
            if !self.finished || self.done || !self.held.is_empty() {
                return Err(());
            }
            self.done = true;
            return Ok(vec![b"data: [DONE]\n\n".to_vec()]);
        }
        if self.done {
            return Err(());
        }
        let v: Value = serde_json::from_str(&data).map_err(|_| ())?;
        if contains_secret(&v, &self.key.0, 0) {
            return Err(());
        }
        // Projecting a whitelist must not erase a provider failure or turn an
        // invalid model identity into a successful DeepSeek frame.
        if v.get("error").is_some_and(|error| !error.is_null())
            || v.get("model")
                .is_some_and(|model| model.as_str() != Some("deepseek-flash"))
        {
            return Err(());
        }
        let choices = v.get("choices").and_then(Value::as_array).ok_or(())?;
        let mut output = Vec::new();
        if !choices.is_empty() {
            if choices.len() != 1 || self.finished {
                return Err(());
            }
            let choice = &choices[0];
            let delta = choice.get("delta").and_then(Value::as_object).ok_or(())?;
            if delta.contains_key("tool_calls")
                || delta.contains_key("function_call")
                || delta
                    .get("role")
                    .and_then(Value::as_str)
                    .is_some_and(|s| s != "assistant")
            {
                return Err(());
            }
            let content = match delta.get("content") {
                None | Some(Value::Null) => "",
                Some(Value::String(s)) => s,
                _ => return Err(()),
            };
            let finish = match choice.get("finish_reason") {
                None | Some(Value::Null) => None,
                Some(Value::String(s)) if s == "stop" || s == "length" => Some(s.clone()),
                _ => return Err(()),
            };
            let safe = self.content(content, finish.is_some())?;
            if finish.is_some() {
                self.finished = true;
            }
            // Reconstruct only the known public protocol. Unknown response keys, IDs,
            // reasoning and nested encoded metadata are never forwarded to the renderer.
            let event = json!({"model":"deepseek-flash","choices":[{"index":0,"delta":{"role":"assistant","content":safe},"finish_reason":finish}]});
            output.push(format!("data: {}\n\n", event).into_bytes());
        }
        if let Some(usage) = v.get("usage").filter(|v| !v.is_null()) {
            let input = usage
                .get("prompt_tokens")
                .and_then(Value::as_u64)
                .ok_or(())?;
            let answer = usage
                .get("completion_tokens")
                .and_then(Value::as_u64)
                .ok_or(())?;
            let total = usage
                .get("total_tokens")
                .and_then(Value::as_u64)
                .ok_or(())?;
            if input.checked_add(answer) != Some(total) || total > 9_007_199_254_740_991 {
                return Err(());
            }
            output.push(format!("data: {}\n\n",json!({"model":"deepseek-flash","choices":[],"usage":{"prompt_tokens":input,"completion_tokens":answer,"total_tokens":total}})).into_bytes());
        }
        Ok(output)
    }
    pub(crate) fn push(&mut self, bytes: &[u8]) -> Result<Vec<Vec<u8>>, ()> {
        self.raw_bytes = self.raw_bytes.checked_add(bytes.len()).ok_or(())?;
        if self.raw_bytes > 1_048_576
            || self
                .raw
                .len()
                .checked_add(bytes.len())
                .map_or(true, |n| n > 131072)
        {
            return Err(());
        }
        self.raw.extend_from_slice(bytes);
        let mut result = Vec::new();
        loop {
            let boundary = [
                self.raw
                    .windows(2)
                    .position(|w| w == b"\n\n")
                    .map(|p| (p, 2)),
                self.raw
                    .windows(4)
                    .position(|w| w == b"\r\n\r\n")
                    .map(|p| (p, 4)),
            ]
            .into_iter()
            .flatten()
            .min_by_key(|x| x.0);
            let Some((end, skip)) = boundary else { break };
            let frame = String::from_utf8(self.raw[..end].to_vec()).map_err(|_| ())?;
            self.raw.drain(..end + skip);
            result.extend(self.frame(&frame)?);
        }
        Ok(result)
    }
    pub(crate) fn finish(&self) -> Result<(), ()> {
        if self.done && self.raw.iter().all(u8::is_ascii_whitespace) && self.held.is_empty() {
            Ok(())
        } else {
            Err(())
        }
    }
}
impl Drop for SafeSse {
    fn drop(&mut self) {
        self.raw.fill(0);
        self.held.clear();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    const KEY: &str = "synthetic-native-sse-key";
    fn frame(text: &str) -> Vec<u8> {
        format!("data: {}\n\n",json!({"model":"deepseek-flash","choices":[{"delta":{"content":text},"finish_reason":null}]})).into_bytes()
    }
    #[test]
    fn decoded_key_and_nested_json_never_release() {
        for raw in [
            r#"{"content":"synthetic-native-sse-key"}"#,
            r#"{"\u0073ynthetic-native-sse-key":"x"}"#,
            r#"{"arguments":"{\"value\":\"synthetic-native-sse-key\"}"}"#,
        ] {
            assert!(contains_secret(
                &serde_json::from_str(raw).unwrap(),
                KEY.as_bytes(),
                0
            ));
        }
        let mut filter = SafeSse::new(KEY.as_bytes().to_vec()).unwrap();
        assert!(filter.push(&frame(KEY)).is_err());
    }
    #[test]
    fn split_content_key_prefix_is_withheld_until_rejected() {
        for split in 1..KEY.len() {
            let mut filter = SafeSse::new(KEY.as_bytes().to_vec()).unwrap();
            let released = filter
                .push(&frame(&format!("safe: {}", &KEY[..split])))
                .unwrap();
            let joined = String::from_utf8(released.concat()).unwrap();
            let value: Value =
                serde_json::from_str(joined.trim().strip_prefix("data: ").unwrap()).unwrap();
            assert_eq!(value["choices"][0]["delta"]["content"], "safe: ");
            assert!(filter.push(&frame(&KEY[split..])).is_err());
        }
    }
    #[test]
    fn raw_byte_splits_unicode_and_normal_incremental_projection() {
        let text = String::from_utf8(frame("hello 中文")).unwrap();
        let mut filter = SafeSse::new(KEY.as_bytes().to_vec()).unwrap();
        let mut released = vec![];
        for byte in text.bytes() {
            released.extend(filter.push(&[byte]).unwrap());
        }
        let s = String::from_utf8(released.concat()).unwrap();
        assert!(s.contains("hello 中文"));
        assert!(!s.contains("untrusted_metadata"));
        let end = format!(
            "data: {}\n\ndata: [DONE]\n\n",
            json!({"model":"deepseek-flash","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}})
        );
        filter.push(end.as_bytes()).unwrap();
        filter.finish().unwrap();
    }
    #[test]
    fn provider_error_with_choices_never_becomes_successful_output() {
        for error in [
            json!({"message":"synthetic provider failure"}),
            json!("failure"),
            json!(false),
            json!(0),
        ] {
            let mut filter = SafeSse::new(KEY.as_bytes().to_vec()).unwrap();
            let event = json!({"model":"deepseek-flash","error":error,"choices":[{"delta":{"content":"must not be delivered"},"finish_reason":"stop"}]});
            assert!(filter
                .push(format!("data: {}\n\n", event).as_bytes())
                .is_err());
        }
    }
    #[test]
    fn present_nonstring_or_unexpected_model_is_rejected() {
        for model in [
            json!(true),
            json!(1),
            json!({}),
            json!([]),
            Value::Null,
            json!("other-model"),
        ] {
            let mut filter = SafeSse::new(KEY.as_bytes().to_vec()).unwrap();
            let event = json!({"model":model,"choices":[{"delta":{"content":"must not be delivered"},"finish_reason":"stop"}]});
            assert!(filter
                .push(format!("data: {}\n\n", event).as_bytes())
                .is_err());
        }
    }
    #[test]
    fn missing_model_with_null_error_preserves_legacy_valid_frames() {
        let mut filter = SafeSse::new(KEY.as_bytes().to_vec()).unwrap();
        let event = json!({"error":null,"choices":[{"delta":{"content":"legitimate reply"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}});
        let output = filter
            .push(format!("data: {}\n\ndata: [DONE]\n\n", event).as_bytes())
            .unwrap();
        assert!(String::from_utf8(output.concat())
            .unwrap()
            .contains("legitimate reply"));
        filter.finish().unwrap();
    }
    #[test]
    fn tool_frames_or_invalid_usage_fail_closed() {
        for value in [
            json!({"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"x"}}]},"finish_reason":"tool_calls"}]}),
            json!({"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":4}}),
        ] {
            let mut filter = SafeSse::new(KEY.as_bytes().to_vec()).unwrap();
            assert!(filter
                .push(format!("data: {}\n\n", value).as_bytes())
                .is_err());
        }
    }
}
