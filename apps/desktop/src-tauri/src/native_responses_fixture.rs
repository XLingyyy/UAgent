//! Deterministic, in-process Responses fixture. No socket, HTTP, TLS or file I/O.
//! The broker must gate construction to its explicit isolated offline-demo run.
//! Tool outputs are data: only this fresh sequence's issued IDs advance it.
#![cfg(windows)]
use crate::native_provider_transport::{
    CredentialBytes, DispatchSignal, Owner, RequestView, ResponseBuffer, Transport,
    TransportFailure, WriteReceipt, WriteStatus,
};
use crate::native_responses_http::{ChunkSink, HeadSink};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

const ENDPOINT: &str = "https://api.openai.com/v1/responses";
const TOOLS: [&str; 3] = [
    "project_list_files",
    "project_find_files",
    "project_read_file",
];
const TOOL_IDS: [&str; 3] = [
    "project.list_files",
    "project.find_files",
    "project.read_file",
];
const FILE: &str = "Source/Main.cpp";
const CHUNK_DELAY: Duration = Duration::from_millis(40);
fn failed() -> TransportFailure {
    TransportFailure::new(
        WriteStatus::Complete,
        "native_responses_synthetic_fixture_invalid".into(),
    )
}
fn fresh(prefix: &str) -> Result<String, TransportFailure> {
    let mut bytes = [0; 16];
    getrandom::getrandom(&mut bytes).map_err(|_| failed())?;
    Ok(format!(
        "{prefix}_{}",
        bytes.iter().map(|v| format!("{v:02x}")).collect::<String>()
    ))
}
fn args(stage: usize) -> Value {
    match stage {
        0 => json!({"prefix":"Source","limit":10}),
        1 => json!({"prefix":"Source","query":"Main","limit":10}),
        _ => json!({"path":FILE}),
    }
}
#[derive(Clone)]
struct Issued {
    id: String,
    item_id: String,
    stage: usize,
    result_hash: Option<[u8; 32]>,
}
#[derive(Default)]
struct State {
    owner: Option<Owner>,
    issued: Vec<Issued>,
    busy: bool,
    finished: bool,
    poisoned: bool,
}
/// One fresh native run owns one ledger. It is never serialized or restored.
#[derive(Default)]
pub(crate) struct FixtureSequence {
    state: Mutex<State>,
}
impl FixtureSequence {
    pub(crate) fn new() -> Self {
        Self::default()
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Function {
    #[serde(rename = "type")]
    kind: String,
    name: String,
    description: Option<String>,
    parameters: Value,
    strict: Option<bool>,
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
    input: Vec<Value>,
    stream: bool,
    store: bool,
    tools: Vec<Function>,
    tool_choice: String,
    include: Option<Vec<String>>,
    max_output_tokens: Option<u32>,
    temperature: Option<f64>,
    reasoning: Option<Reasoning>,
}
struct Review {
    stage: usize,
    hashes: Vec<[u8; 32]>,
    english: bool,
    excerpt: String,
    truncated: bool,
}
fn as_text<'a>(value: &'a Value, field: &str) -> Result<&'a str, TransportFailure> {
    value.get(field).and_then(Value::as_str).ok_or_else(failed)
}
fn check_result(value: &Value, issued: &Issued, owner: &Owner) -> Result<(), TransportFailure> {
    if value.get("callId").and_then(Value::as_str) != Some(&issued.id)
        || value.get("toolId").and_then(Value::as_str) != Some(TOOL_IDS[issued.stage])
        || value.get("status").and_then(Value::as_str) != Some("completed")
        || value.get("effectState").and_then(Value::as_str) != Some("not_started")
        || !value.get("truncated").is_some_and(Value::is_boolean)
        || !value.get("output").is_some_and(Value::is_object)
    {
        return Err(failed());
    }
    let expected_kind = if issued.stage < 2 {
        "index_query"
    } else {
        "file_preview"
    };
    let expected_path = if issued.stage < 2 { "Source" } else { FILE };
    let sources = value
        .get("sources")
        .and_then(Value::as_array)
        .ok_or_else(failed)?;
    if !sources.iter().any(|source| {
        source.get("projectId").and_then(Value::as_str) == Some(&owner.project)
            && source.get("path").and_then(Value::as_str) == Some(expected_path)
            && source.get("kind").and_then(Value::as_str) == Some(expected_kind)
            && source
                .get("version")
                .and_then(Value::as_str)
                .is_some_and(|v| !v.is_empty())
    }) {
        return Err(failed());
    }
    let output = &value["output"];
    if issued.stage < 2 {
        let files = output
            .get("files")
            .and_then(Value::as_array)
            .ok_or_else(failed)?;
        if !files
            .iter()
            .any(|file| file.get("path").and_then(Value::as_str) == Some(FILE))
        {
            return Err(failed());
        }
    } else if output.get("path").and_then(Value::as_str) != Some(FILE)
        || output.get("text").and_then(Value::as_str).is_none()
    {
        return Err(failed());
    }
    Ok(())
}
fn review(request: RequestView<'_>, state: &State) -> Result<Review, TransportFailure> {
    if request.endpoint != ENDPOINT
        || request.body.len() > 1_048_576
        || request.owner.model != request.model
        || state.busy
        || state.finished
        || state.poisoned
        || state
            .owner
            .as_ref()
            .is_some_and(|owner| owner != request.owner)
    {
        return Err(failed());
    }
    let body: Body = serde_json::from_slice(request.body).map_err(|_| failed())?;
    if body.model != request.model
        || !body.stream
        || body.store
        || body.tool_choice != "auto"
        || body.input.is_empty()
        || body.input.len() > 128
        || body.tools.len() != 3
        || body.max_output_tokens.is_some_and(|v| v == 0 || v > 16_384)
        || body
            .temperature
            .is_some_and(|v| !v.is_finite() || !(0.0..=2.0).contains(&v))
        || body
            .include
            .as_ref()
            .is_some_and(|v| v.len() > 1 || v.iter().any(|s| s != "reasoning.encrypted_content"))
        || body.reasoning.as_ref().is_some_and(|v| {
            !["none", "minimal", "low", "medium", "high", "xhigh"].contains(&v.effort.as_str())
        })
    {
        return Err(failed());
    }
    let mut names = std::collections::HashSet::new();
    for tool in body.tools {
        if tool.kind != "function"
            || !TOOLS.contains(&tool.name.as_str())
            || !names.insert(tool.name)
            || tool.parameters.get("type").and_then(Value::as_str) != Some("object")
            || tool.description.as_ref().is_some_and(|v| v.len() > 8192)
            || tool.strict == Some(true)
        {
            return Err(failed());
        }
    }
    let mut pending: Option<&Issued> = None;
    let mut hashes = Vec::new();
    let mut user_text = String::new();
    let mut excerpt = String::new();
    let mut truncated = false;
    for item in body.input {
        match item.get("type").and_then(Value::as_str) {
            Some("message") => {
                if pending.is_some()
                    || !["system", "developer", "user", "assistant"]
                        .contains(&as_text(&item, "role")?)
                {
                    return Err(failed());
                }
                let content = item.get("content").ok_or_else(failed)?;
                let mut texts = Vec::new();
                if let Some(text) = content.as_str() {
                    texts.push(text);
                } else if let Some(parts) = content.as_array() {
                    for part in parts {
                        if !["input_text", "output_text"].contains(&as_text(part, "type")?) {
                            return Err(failed());
                        }
                        texts.push(as_text(part, "text")?);
                    }
                } else {
                    return Err(failed());
                }
                if item["role"] == "user" {
                    for text in texts {
                        user_text.push_str(text);
                        user_text.push('\n');
                    }
                }
            }
            Some("function_call") => {
                if pending.is_some() {
                    return Err(failed());
                }
                let issued = state.issued.get(hashes.len()).ok_or_else(failed)?;
                if as_text(&item, "call_id")? != issued.id
                    || as_text(&item, "name")? != TOOLS[issued.stage]
                    || item
                        .get("id")
                        .is_some_and(|value| value.as_str() != Some(&issued.item_id))
                    || item
                        .get("status")
                        .is_some_and(|value| value.as_str() != Some("completed"))
                {
                    return Err(failed());
                }
                let arguments: Value =
                    serde_json::from_str(as_text(&item, "arguments")?).map_err(|_| failed())?;
                if arguments != args(issued.stage) {
                    return Err(failed());
                }
                pending = Some(issued);
            }
            Some("function_call_output") => {
                let issued = pending.take().ok_or_else(failed)?;
                if as_text(&item, "call_id")? != issued.id {
                    return Err(failed());
                }
                let text = as_text(&item, "output")?;
                if text.len() > 16_384 {
                    return Err(failed());
                }
                let value: Value = serde_json::from_str(text).map_err(|_| failed())?;
                check_result(&value, issued, request.owner)?;
                let hash: [u8; 32] = Sha256::digest(text.as_bytes()).into();
                if issued.result_hash.is_some_and(|known| known != hash) {
                    return Err(failed());
                }
                hashes.push(hash);
                truncated |=
                    value["truncated"] == true || value["output"]["lineCountComplete"] == false;
                if issued.stage == 2 {
                    excerpt = value["output"]["text"]
                        .as_str()
                        .unwrap()
                        .chars()
                        .take(64)
                        .collect();
                }
            }
            _ => return Err(failed()),
        }
    }
    if pending.is_some() || hashes.len() != state.issued.len() || user_text.trim().is_empty() {
        return Err(failed());
    }
    let lower = user_text.to_ascii_lowercase();
    let has_cjk = user_text
        .chars()
        .any(|c| ('\u{3400}'..='\u{9fff}').contains(&c));
    let english = lower.contains("english")
        || user_text.contains("英文")
        || (!has_cjk && user_text.bytes().any(|v| v.is_ascii_alphabetic()));
    Ok(Review {
        stage: state.issued.len(),
        hashes,
        english,
        excerpt,
        truncated,
    })
}
struct Flight {
    sequence: Arc<FixtureSequence>,
    success: bool,
}
impl Drop for Flight {
    fn drop(&mut self) {
        if let Ok(mut state) = self.sequence.state.lock() {
            state.busy = false;
            if !self.success {
                state.poisoned = true;
            }
        }
    }
}
pub(crate) struct FixtureResponsesTransport {
    sequence: Option<Arc<FixtureSequence>>,
    chunk_sink: Option<ChunkSink>,
    head_sink: Option<HeadSink>,
}
impl FixtureResponsesTransport {
    pub(crate) fn new() -> Self {
        Self {
            sequence: None,
            chunk_sink: None,
            head_sink: None,
        }
    }
    pub(crate) fn with_chunk_sink(sink: ChunkSink) -> Self {
        Self {
            sequence: None,
            chunk_sink: Some(sink),
            head_sink: None,
        }
    }
    pub(crate) fn with_head_sink(mut self, sink: HeadSink) -> Self {
        self.head_sink = Some(sink);
        self
    }
    pub(crate) fn with_sequence(mut self, sequence: Arc<FixtureSequence>) -> Self {
        self.sequence = Some(sequence);
        self
    }
}
fn frame(kind: &str, sequence: usize, mut payload: Value) -> Vec<u8> {
    payload["type"] = json!(kind);
    payload["sequence_number"] = json!(sequence);
    format!(
        "event: {kind}\ndata: {}\n\n",
        serde_json::to_string(&payload).expect("fixture JSON")
    )
    .into_bytes()
}
fn frames(
    model: &str,
    reviewed: &Review,
    issued: Option<&Issued>,
) -> Result<Vec<Vec<u8>>, TransportFailure> {
    let response_id = fresh("fixture_response")?;
    let mut events = Vec::new();
    let mut add = |kind: &str, value: Value| {
        events.push(frame(kind, events.len(), value));
    };
    add(
        "response.created",
        json!({"response":{"id":response_id,"model":model,"status":"in_progress"}}),
    );
    let output = if let Some(issued) = issued {
        let arguments = serde_json::to_string(&args(issued.stage)).map_err(|_| failed())?;
        let item = json!({"type":"function_call","id":issued.item_id,"call_id":issued.id,
            "name":TOOLS[issued.stage],"arguments":arguments,"status":"completed"});
        let mut started = item.clone();
        started["arguments"] = json!("");
        started["status"] = json!("in_progress");
        add(
            "response.output_item.added",
            json!({"output_index":0,"item":started}),
        );
        for part in arguments.as_bytes().chunks(16) {
            add(
                "response.function_call_arguments.delta",
                json!({"output_index":0,"item_id":issued.item_id,
                "delta":std::str::from_utf8(part).map_err(|_| failed())?}),
            );
        }
        add(
            "response.function_call_arguments.done",
            json!({"output_index":0,"item_id":issued.item_id,"arguments":arguments}),
        );
        add(
            "response.output_item.done",
            json!({"output_index":0,"item":item}),
        );
        vec![item]
    } else {
        let excerpt = serde_json::to_string(&reviewed.excerpt).map_err(|_| failed())?;
        let text = if reviewed.english {
            format!("Local synthetic verification: three real local tools listed, found and read {FILE}. This verifies the tool round-trip, not model understanding or a verified provider connection.\nFile excerpt: {excerpt}{}",
                if reviewed.truncated { " (returned text is truncated)" } else { "" })
        } else {
            format!("本地合成验证：已通过列出、查找、读取三个真实本地工具读取 {FILE}。仅验证工具往返，不代表真实模型理解或连接已验证。\n文件片段：{excerpt}{}",
                if reviewed.truncated { "（返回内容有截断）" } else { "" })
        };
        let id = fresh("fixture_message")?;
        let item = json!({"type":"message","id":id,"role":"assistant","status":"completed",
            "content":[{"type":"output_text","text":text,"annotations":[]}],"phase":"final_answer"});
        add(
            "response.output_item.added",
            json!({"output_index":0,
            "item":{"id":id,"type":"message","role":"assistant","status":"in_progress","content":[]}}),
        );
        let points: Vec<char> = text.chars().collect();
        for chunk in points.chunks(24) {
            add(
                "response.output_text.delta",
                json!({"output_index":0,"content_index":0,"item_id":id,
                "delta":chunk.iter().collect::<String>()}),
            );
        }
        add(
            "response.output_text.done",
            json!({"output_index":0,"content_index":0,"item_id":id,"text":text}),
        );
        add(
            "response.output_item.done",
            json!({"output_index":0,"item":item}),
        );
        vec![item]
    };
    add(
        "response.completed",
        json!({"response":{"id":response_id,"model":model,"status":"completed",
        "created_at":1_700_000_000,"output":output,"synthetic":true}}),
    );
    Ok(events)
}
impl Transport for FixtureResponsesTransport {
    fn before_dispatch(&mut self, request: RequestView<'_>) -> Result<(), TransportFailure> {
        let sequence = self.sequence.as_ref().ok_or_else(failed)?;
        let state = sequence.state.lock().map_err(|_| failed())?;
        review(request, &state).map(|_| ())
    }
    fn dispatch(
        &mut self,
        request: RequestView<'_>,
        _: CredentialBytes<'_>,
        signal: DispatchSignal<'_>,
        response: &mut ResponseBuffer,
    ) -> Result<WriteReceipt, TransportFailure> {
        let sequence = self.sequence.as_ref().ok_or_else(failed)?.clone();
        let reviewed = {
            let mut state = sequence.state.lock().map_err(|_| failed())?;
            let reviewed = review(request, &state)?;
            if signal.is_cancelled() {
                return Err(failed());
            }
            state.owner = Some(request.owner.clone());
            state.busy = true;
            reviewed
        };
        let mut flight = Flight {
            sequence: sequence.clone(),
            success: false,
        };
        let issued = if reviewed.stage < 3 {
            Some(Issued {
                id: fresh("fixture_call")?,
                item_id: fresh("fixture_function")?,
                stage: reviewed.stage,
                result_hash: None,
            })
        } else {
            None
        };
        let events = frames(request.model, &reviewed, issued.as_ref())?;
        if signal.is_cancelled() {
            return Err(failed());
        }
        if let Some(sink) = &self.head_sink {
            sink(200, "text/event-stream").map_err(|_| failed())?;
        }
        for event in events {
            thread::sleep(CHUNK_DELAY);
            if signal.is_cancelled() {
                return Err(failed());
            }
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
        }
        {
            let mut state = sequence.state.lock().map_err(|_| failed())?;
            for (issued, hash) in state.issued.iter_mut().zip(reviewed.hashes) {
                issued.result_hash = Some(hash);
            }
            if let Some(issued) = issued {
                state.issued.push(issued);
            } else {
                state.finished = true;
            }
        }
        flight.success = true;
        Ok(WriteReceipt {
            write: WriteStatus::Complete,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_provider_transport::{
        ConfigVersion, DispatchStatus, FailureCode, MonotonicClock, NativeSession,
        SourceCheckFailure, SourceChecker, SourcePhase, SourceSnapshot,
    };
    struct Sources;
    impl SourceChecker for Sources {
        fn check(
            &self,
            value: &SourceSnapshot,
            _: SourcePhase,
        ) -> Result<SourceSnapshot, SourceCheckFailure> {
            Ok(value.clone())
        }
    }
    fn owner() -> Owner {
        Owner {
            project: "fixture-project".into(),
            epoch: 1,
            run: "fixture-run".into(),
            conversation: "fixture-conversation".into(),
            provider: "fixture-provider".into(),
            model: "dynamic-fixture-model".into(),
        }
    }
    fn make_session(owner: Owner) -> NativeSession {
        let session = NativeSession::new(
            owner,
            ConfigVersion {
                generation: "fixture-generation".into(),
                revision: 1,
            },
            [1; 32],
            Arc::new(MonotonicClock::new()),
        );
        session
            .install_credential(b"synthetic-only".to_vec(), 60_000)
            .unwrap();
        session
    }
    fn body(input: Vec<Value>) -> Value {
        json!({"model":"dynamic-fixture-model","input":input,"stream":true,"store":false,"tool_choice":"auto",
            "tools":TOOLS.iter().map(|name|json!({"type":"function","name":name,"parameters":{"type":"object"},"strict":false})).collect::<Vec<_>>()})
    }
    fn goal(english: bool) -> Value {
        json!({"type":"message","role":"user","content":[{"type":"input_text","text":if english{"Please inspect Source in English."}else{"请检查 Source。"}}]})
    }
    fn execute(
        session: &NativeSession,
        sequence: Arc<FixtureSequence>,
        body: &Value,
        sink: Option<ChunkSink>,
    ) -> crate::native_provider_transport::DispatchOutcome {
        let lease = session.capture_lease(30_000).unwrap();
        let prepared = session
            .prepare(
                &lease,
                "https://api.openai.com/v1",
                serde_json::to_vec(body).unwrap(),
                &Sources,
            )
            .unwrap();
        let grant = session.approve(&prepared, &lease, &Sources).unwrap();
        let mut transport = match sink {
            Some(sink) => FixtureResponsesTransport::with_chunk_sink(sink),
            None => FixtureResponsesTransport::new(),
        }
        .with_sequence(sequence);
        session.dispatch(&prepared, &lease, &grant, &Sources, &mut transport)
    }
    fn terminal(raw: &[u8]) -> Value {
        std::str::from_utf8(raw)
            .unwrap()
            .lines()
            .filter_map(|line| line.strip_prefix("data: "))
            .map(|text| serde_json::from_str::<Value>(text).unwrap())
            .find(|event| event["type"] == "response.completed")
            .unwrap()["response"]
            .clone()
    }
    fn output(issued: &Value, stage: usize) -> Value {
        let path = if stage < 2 { "Source" } else { FILE };
        let output = if stage < 2 {
            json!({"files":[{"path":FILE,"bytes":27,"extension":"cpp"}]})
        } else {
            json!({"path":FILE,"text":"int main() { return 42; }","lineCountComplete":true})
        };
        json!({"type":"function_call_output","call_id":issued["call_id"],"output":serde_json::to_string(&json!({
            "callId":issued["call_id"],"toolId":TOOL_IDS[stage],"status":"completed","effectState":"not_started",
            "output":output,"sources":[{"projectId":"fixture-project","path":path,"version":"fixture-version",
                "kind":if stage<2{"index_query"}else{"file_preview"}}],"truncated":false
        })).unwrap()})
    }
    #[test]
    fn four_requests_use_real_paired_results_and_emit_incremental_unknown_usage_in_both_languages()
    {
        let mut samples = Vec::new();
        for english in [false, true] {
            let session = make_session(owner());
            let sequence = Arc::new(FixtureSequence::new());
            let mut input = vec![goal(english)];
            for stage in 0..4 {
                let observed = Arc::new(Mutex::new(Vec::<Vec<u8>>::new()));
                let chunks = observed.clone();
                let sink: ChunkSink = Arc::new(move |bytes| {
                    chunks.lock().unwrap().push(bytes.to_vec());
                    Ok(())
                });
                let result = execute(&session, sequence.clone(), &body(input.clone()), Some(sink));
                assert_eq!(result.status, DispatchStatus::Sent);
                assert_eq!(result.error, None);
                let raw = result.response.unwrap();
                assert_eq!(observed.lock().unwrap().concat(), raw.bytes());
                samples.push(json!({"request":body(input.clone()),"sse":std::str::from_utf8(raw.bytes()).unwrap()}));
                let terminal = terminal(raw.bytes());
                assert_eq!(terminal["model"], "dynamic-fixture-model");
                assert!(terminal.get("usage").is_none());
                if stage < 3 {
                    let call = terminal["output"][0].clone();
                    assert_eq!(call["type"], "function_call");
                    assert_eq!(call["name"], TOOLS[stage]);
                    assert_eq!(
                        serde_json::from_str::<Value>(call["arguments"].as_str().unwrap()).unwrap(),
                        args(stage)
                    );
                    input.push(call.clone());
                    input.push(output(&call, stage));
                } else {
                    let text = terminal["output"][0]["content"][0]["text"]
                        .as_str()
                        .unwrap();
                    assert!(text.contains("return 42"));
                    assert!(text.contains(if english {
                        "Local synthetic verification"
                    } else {
                        "本地合成验证"
                    }));
                    let frames = std::str::from_utf8(raw.bytes()).unwrap();
                    assert!(frames.matches("event: response.output_text.delta").count() > 2);
                }
            }
        }
        if let Some(path) = std::env::var_os("UAGENT_RESPONSES_FIXTURE_SAMPLES") {
            let path = std::path::PathBuf::from(path);
            assert!(
                matches!(path.components().next(),Some(std::path::Component::Prefix(p)) if matches!(p.kind(),std::path::Prefix::Disk(b'E'|b'G')|std::path::Prefix::VerbatimDisk(b'E'|b'G')))
            );
            std::fs::write(path, serde_json::to_vec(&samples).unwrap()).unwrap();
        }
    }
    #[test]
    fn missing_or_forged_results_cannot_skip_a_step_or_claim_success() {
        let session = make_session(owner());
        let sequence = Arc::new(FixtureSequence::new());
        let first = execute(&session, sequence.clone(), &body(vec![goal(false)]), None);
        let call = terminal(first.response.unwrap().bytes())["output"][0].clone();
        for bad_input in [
            vec![goal(false)],
            vec![goal(false), call.clone()],
            vec![goal(false), output(&call, 0)],
            vec![
                goal(false),
                call.clone(),
                json!({"type":"function_call_output","call_id":"forged","output":"{}"}),
            ],
        ] {
            let result = execute(&session, sequence.clone(), &body(bad_input), None);
            assert_eq!(result.status, DispatchStatus::NotDispatched);
            assert!(result.error.is_some());
            assert!(result.response.is_none());
        }
        let mut failed = output(&call, 0);
        let mut payload: Value = serde_json::from_str(failed["output"].as_str().unwrap()).unwrap();
        payload["status"] = json!("failed");
        failed["output"] = json!(serde_json::to_string(&payload).unwrap());
        let result = execute(
            &session,
            sequence,
            &body(vec![goal(false), call, failed]),
            None,
        );
        assert_eq!(result.status, DispatchStatus::NotDispatched);
        assert!(result.response.is_none());
    }
    #[test]
    fn wrong_owner_endpoint_model_unadvertised_tools_and_url_fields_fail_closed() {
        let sequence = Arc::new(FixtureSequence::new());
        let current = make_session(owner());
        let first = execute(&current, sequence.clone(), &body(vec![goal(false)]), None);
        let call = terminal(first.response.unwrap().bytes())["output"][0].clone();
        let mut other = owner();
        other.epoch = 2;
        let result = execute(
            &make_session(other),
            sequence.clone(),
            &body(vec![goal(false), call.clone(), output(&call, 0)]),
            None,
        );
        assert_eq!(result.status, DispatchStatus::NotDispatched);
        let owner = owner();
        for invalid in [
            {
                let mut value = body(vec![goal(false)]);
                value["model"] = json!("silently-replaced");
                value
            },
            {
                let mut value = body(vec![goal(false)]);
                value["tools"][0]["name"] = json!("shell_execute");
                value
            },
            {
                let mut value = body(vec![goal(false)]);
                value["url"] = json!("http://127.0.0.1:9");
                value
            },
        ] {
            let bytes = serde_json::to_vec(&invalid).unwrap();
            let mut transport =
                FixtureResponsesTransport::new().with_sequence(Arc::new(FixtureSequence::new()));
            let baseline = serde_json::to_vec(&body(vec![goal(false)])).unwrap();
            assert!(transport
                .before_dispatch(RequestView {
                    endpoint: ENDPOINT,
                    model: &owner.model,
                    owner: &owner,
                    body: &baseline
                })
                .is_ok());
            assert!(transport
                .before_dispatch(RequestView {
                    endpoint: ENDPOINT,
                    model: &owner.model,
                    owner: &owner,
                    body: &bytes
                })
                .is_err());
        }
        let bytes = serde_json::to_vec(&body(vec![goal(false)])).unwrap();
        let mut transport =
            FixtureResponsesTransport::new().with_sequence(Arc::new(FixtureSequence::new()));
        assert!(transport
            .before_dispatch(RequestView {
                endpoint: "http://127.0.0.1:9",
                model: &owner.model,
                owner: &owner,
                body: &bytes
            })
            .is_err());
    }
    #[test]
    fn cancellation_between_chunks_poisoned_sequence_never_issues_an_executable_terminal() {
        let session = make_session(owner());
        let sequence = Arc::new(FixtureSequence::new());
        let cancel = session.clone();
        let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let seen = count.clone();
        let sink: ChunkSink = Arc::new(move |_| {
            seen.fetch_add(1, std::sync::atomic::Ordering::AcqRel);
            cancel.revoke_all().unwrap();
            Ok(())
        });
        let result = execute(
            &session,
            sequence.clone(),
            &body(vec![goal(false)]),
            Some(sink),
        );
        assert!(result.error.is_some());
        assert!(result.response.is_none());
        assert_eq!(count.load(std::sync::atomic::Ordering::Acquire), 1);
        assert!(sequence.state.lock().unwrap().poisoned);
        assert!(sequence.state.lock().unwrap().issued.is_empty());
        let retry = execute(
            &make_session(owner()),
            sequence,
            &body(vec![goal(false)]),
            None,
        );
        assert_eq!(retry.status, DispatchStatus::NotDispatched);
    }
    #[test]
    fn previous_tool_result_mutation_or_new_sequence_cannot_reuse_old_call_authority() {
        let current = make_session(owner());
        let sequence = Arc::new(FixtureSequence::new());
        let first = execute(&current, sequence.clone(), &body(vec![goal(false)]), None);
        let call = terminal(first.response.unwrap().bytes())["output"][0].clone();
        let input = vec![goal(false), call.clone(), output(&call, 0)];
        let second = execute(&current, sequence.clone(), &body(input.clone()), None);
        let call2 = terminal(second.response.unwrap().bytes())["output"][0].clone();
        let mut mutated = input.clone();
        let mut payload: Value =
            serde_json::from_str(mutated[2]["output"].as_str().unwrap()).unwrap();
        payload["truncated"] = json!(true);
        mutated[2]["output"] = json!(serde_json::to_string(&payload).unwrap());
        mutated.push(call2.clone());
        mutated.push(output(&call2, 1));
        let invalid = execute(&current, sequence, &body(mutated), None);
        assert_eq!(invalid.status, DispatchStatus::NotDispatched);
        let invalid = execute(
            &current,
            Arc::new(FixtureSequence::new()),
            &body(input),
            None,
        );
        assert_eq!(invalid.status, DispatchStatus::NotDispatched);
    }
    #[test]
    fn missing_sequence_and_sink_failure_do_not_complete_or_advance_the_fixture() {
        let owner = owner();
        let bytes = serde_json::to_vec(&body(vec![goal(false)])).unwrap();
        assert!(FixtureResponsesTransport::new()
            .before_dispatch(RequestView {
                endpoint: ENDPOINT,
                model: &owner.model,
                owner: &owner,
                body: &bytes
            })
            .is_err());
        let sequence = Arc::new(FixtureSequence::new());
        let sink: ChunkSink = Arc::new(|_| Err(()));
        let result = execute(
            &make_session(owner),
            sequence.clone(),
            &body(vec![goal(false)]),
            Some(sink),
        );
        assert!(result.error.is_some());
        assert!(result.response.is_none());
        assert!(sequence.state.lock().unwrap().issued.is_empty());
        assert!(sequence.state.lock().unwrap().poisoned);
        let _: Option<FailureCode> = result.error;
    }
}
