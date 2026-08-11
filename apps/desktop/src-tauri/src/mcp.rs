use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::Read;
use std::net::IpAddr;
use std::str::FromStr;
use std::time::Duration;

const NATIVE_REQUEST_FAILED: &str = "native_request_failed";
const NATIVE_RESPONSE_READ_FAILED: &str = "native_response_read_failed";
const SSE_RESPONSE_MAX_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum McpHttpMethod {
    Post,
    Delete,
}

impl Default for McpHttpMethod {
    fn default() -> Self {
        Self::Post
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpObservationIntent {
    pub schema_version: String,
    pub task_id: String,
    pub phase: String,
    pub phase_session_id: String,
    pub phase_generation: u64,
    pub connection_generation: u64,
    pub tool_search_mode: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpHttpRequestInput {
    pub endpoint: String,
    #[serde(default)]
    pub method: McpHttpMethod,
    pub body: String,
    pub protocol_version: Option<String>,
    pub session_id: Option<String>,
    pub timeout_ms: Option<u64>,
    pub observation: Option<McpObservationIntent>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHttpRequestResult {
    pub method: McpHttpMethod,
    pub status: u16,
    pub body: String,
    pub content_type: Option<String>,
    pub session_id: Option<String>,
    pub protocol_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observation_request: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observation_receipts: Option<HashMap<String, String>>,
}

#[tauri::command]
pub fn mcp_streamable_http_request(
    input: McpHttpRequestInput,
) -> Result<McpHttpRequestResult, String> {
    post_streamable_http(input)
}

pub fn post_streamable_http(input: McpHttpRequestInput) -> Result<McpHttpRequestResult, String> {
    validate_local_mcp_endpoint(&input.endpoint)?;

    let protocol_version = input
        .protocol_version
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("2025-06-18");
    let timeout_ms = input.timeout_ms.unwrap_or(5_000).clamp(500, 30_000);
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_millis(timeout_ms))
        .build();

    if input.method == McpHttpMethod::Delete
        && input.session_id.as_deref().map_or(true, str::is_empty)
    {
        return Err("session_id_required".to_string());
    }
    if input.method == McpHttpMethod::Delete && !input.body.is_empty() {
        return Err("delete_body_not_allowed".to_string());
    }

    let mut request = match input.method {
        McpHttpMethod::Post => agent.post(&input.endpoint),
        McpHttpMethod::Delete => agent.delete(&input.endpoint),
    }
    .set("Accept", "application/json, text/event-stream")
    .set("MCP-Protocol-Version", protocol_version);
    if input.method == McpHttpMethod::Post {
        request = request.set("Content-Type", "application/json");
    }

    if let Some(session_id) = input
        .session_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        request = request.set("Mcp-Session-Id", session_id);
    }

    let response = match input.method {
        McpHttpMethod::Post => request.send_string(&input.body),
        McpHttpMethod::Delete => request.call(),
    };
    let outcome = match response {
        Ok(response) => response_to_result(response, input.method),
        Err(ureq::Error::Status(_, response)) => response_to_result(response, input.method),
        Err(_) => Err(NATIVE_REQUEST_FAILED.to_string()),
    };
    match outcome {
        Ok(mut result) => {
            crate::mvp15d_runtime_bridge::attach_native_mcp_transport_observation(
                &input,
                &mut result,
            )?;
            Ok(result)
        }
        Err(error) => {
            crate::mvp15d_runtime_bridge::record_native_mcp_transport_failure(&input, &error);
            Err(error)
        }
    }
}

pub(crate) fn validate_local_mcp_endpoint(endpoint: &str) -> Result<(), String> {
    let parsed = tauri::Url::parse(endpoint).map_err(|_| "invalid_url".to_string())?;
    if parsed.scheme() != "http" {
        return Err("scheme_not_allowed".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("credentials_not_allowed".to_string());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "host_required".to_string())?;
    if host.eq_ignore_ascii_case("localhost") {
        return Ok(());
    }
    let host_for_ip = host.trim_start_matches('[').trim_end_matches(']');
    let ip = IpAddr::from_str(host_for_ip).map_err(|_| "non_loopback_host".to_string())?;
    if ip.is_loopback() {
        Ok(())
    } else {
        Err("non_loopback_host".to_string())
    }
}

fn response_to_result(
    response: ureq::Response,
    method: McpHttpMethod,
) -> Result<McpHttpRequestResult, String> {
    let status = response.status();
    let content_type = response.header("Content-Type").map(ToString::to_string);
    let session_id = response.header("Mcp-Session-Id").map(ToString::to_string);
    let protocol_version = response
        .header("MCP-Protocol-Version")
        .map(ToString::to_string);
    let body =
        if method == McpHttpMethod::Post && is_event_stream_content_type(content_type.as_deref()) {
            read_sse_body_until_completed_data_event(response)?
        } else {
            response
                .into_string()
                .map_err(|_| NATIVE_RESPONSE_READ_FAILED.to_string())?
        };

    Ok(McpHttpRequestResult {
        method,
        status,
        body,
        content_type,
        session_id,
        protocol_version,
        observation_request: None,
        observation_receipts: None,
    })
}

fn is_event_stream_content_type(content_type: Option<&str>) -> bool {
    content_type
        .and_then(|value| value.split(';').next())
        .is_some_and(|media_type| media_type.trim().eq_ignore_ascii_case("text/event-stream"))
}

fn read_sse_body_until_completed_data_event(response: ureq::Response) -> Result<String, String> {
    let mut reader = response.into_reader();
    let mut body = Vec::new();
    let mut detector = SseEventDetector::default();
    let mut chunk = [0_u8; 8 * 1024];

    loop {
        let bytes_read = reader
            .read(&mut chunk)
            .map_err(|_| NATIVE_RESPONSE_READ_FAILED.to_string())?;
        if bytes_read == 0 {
            return Err(NATIVE_RESPONSE_READ_FAILED.to_string());
        }

        let remaining_capacity = SSE_RESPONSE_MAX_BYTES.saturating_sub(body.len());
        let bytes_to_append = bytes_read.min(remaining_capacity);
        body.extend_from_slice(&chunk[..bytes_to_append]);

        if let Some(event_end) = detector.completed_data_event_end(&body) {
            return String::from_utf8(body[..event_end].to_vec())
                .map_err(|_| NATIVE_RESPONSE_READ_FAILED.to_string());
        }

        if bytes_to_append != bytes_read {
            return Err(NATIVE_RESPONSE_READ_FAILED.to_string());
        }
    }
}

#[derive(Default)]
struct SseEventDetector {
    line_start: usize,
    scan_index: usize,
    current_event_has_data: bool,
}

impl SseEventDetector {
    fn completed_data_event_end(&mut self, body: &[u8]) -> Option<usize> {
        while self.scan_index < body.len() {
            if body[self.scan_index] != b'\n' {
                self.scan_index += 1;
                continue;
            }

            let mut line = &body[self.line_start..self.scan_index];
            if line.ends_with(b"\r") {
                line = &line[..line.len() - 1];
            }

            self.scan_index += 1;
            self.line_start = self.scan_index;

            if line.is_empty() {
                if self.current_event_has_data {
                    return Some(self.scan_index);
                }
                self.current_event_has_data = false;
            } else if line.starts_with(b"data:") {
                self.current_event_has_data = true;
            }
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::thread;
    use std::time::Instant;

    fn request_input(endpoint: String, timeout_ms: u64) -> McpHttpRequestInput {
        McpHttpRequestInput {
            endpoint,
            method: McpHttpMethod::Post,
            body: r#"{"jsonrpc":"2.0","id":1,"method":"tools/call"}"#.to_string(),
            protocol_version: Some("2025-06-18".to_string()),
            session_id: Some("sensitive-session".to_string()),
            timeout_ms: Some(timeout_ms),
            observation: None,
        }
    }

    fn read_loopback_request(stream: &mut TcpStream) -> String {
        let mut request = Vec::new();
        let mut read_buffer = [0_u8; 1024];
        let mut expected_request_length = None;

        loop {
            let bytes_read = stream.read(&mut read_buffer).unwrap();
            assert!(bytes_read > 0);
            request.extend_from_slice(&read_buffer[..bytes_read]);

            if expected_request_length.is_none() {
                let header_end = request
                    .windows(4)
                    .position(|window| window == b"\r\n\r\n")
                    .map(|index| index + 4);
                if let Some(header_end) = header_end {
                    let headers = std::str::from_utf8(&request[..header_end]).unwrap();
                    let content_length = headers
                        .lines()
                        .find_map(|line| {
                            line.strip_prefix("Content-Length: ")
                                .or_else(|| line.strip_prefix("content-length: "))
                        })
                        .map(|value| value.parse::<usize>().unwrap())
                        .unwrap_or(0);
                    expected_request_length = Some(header_end + content_length);
                }
            }

            if expected_request_length.is_some_and(|length| request.len() >= length) {
                return String::from_utf8(request).unwrap();
            }
        }
    }

    fn spawn_loopback_server(
        respond: impl FnOnce(&mut TcpStream) + Send + 'static,
    ) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/mcp", listener.local_addr().unwrap());
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(1)))
                .unwrap();
            read_loopback_request(&mut stream);
            respond(&mut stream);
        });
        (endpoint, handle)
    }

    #[test]
    fn mcp_endpoint_validation_allows_http_loopback_without_credentials() {
        assert!(validate_local_mcp_endpoint("http://127.0.0.1:8000/mcp").is_ok());
        assert!(validate_local_mcp_endpoint("http://127.12.34.56:8000/mcp").is_ok());
        assert!(validate_local_mcp_endpoint("http://localhost:8000/mcp").is_ok());
        assert!(validate_local_mcp_endpoint("http://[::1]:8000/mcp").is_ok());
    }

    #[test]
    fn mcp_endpoint_validation_rejects_remote_https_and_credentials() {
        assert_eq!(
            validate_local_mcp_endpoint("https://localhost:8000/mcp").unwrap_err(),
            "scheme_not_allowed"
        );
        assert_eq!(
            validate_local_mcp_endpoint("http://example.com:8000/mcp").unwrap_err(),
            "non_loopback_host"
        );
        assert_eq!(
            validate_local_mcp_endpoint("http://user:pass@127.0.0.1:8000/mcp").unwrap_err(),
            "credentials_not_allowed"
        );
    }

    #[test]
    fn mcp_observation_envelope_is_optional_for_ordinary_calls_and_strict_when_present() {
        let ordinary = serde_json::json!({
            "endpoint": "http://127.0.0.1:8000/mcp",
            "body": "{}",
            "protocolVersion": "2025-06-18",
            "sessionId": null,
            "timeoutMs": 5000
        });
        assert!(serde_json::from_value::<McpHttpRequestInput>(ordinary)
            .unwrap()
            .observation
            .is_none());
        assert_eq!(
            serde_json::from_value::<McpHttpRequestInput>(serde_json::json!({
                "endpoint": "http://127.0.0.1:8000/mcp",
                "method": "DELETE",
                "body": "",
                "sessionId": "safe-session"
            }))
            .unwrap()
            .method,
            McpHttpMethod::Delete
        );
        assert!(
            serde_json::from_value::<McpHttpRequestInput>(serde_json::json!({
                "endpoint": "http://127.0.0.1:8000/mcp",
                "method": "PATCH",
                "body": ""
            }))
            .is_err()
        );
        let unknown_intent_field = serde_json::json!({
            "endpoint": "http://127.0.0.1:8000/mcp",
            "body": "{}",
            "observation": {
                "schemaVersion": "uagent.mvp15d.mcp-observation-intent.v1",
                "taskId": "TASK-MVP15D",
                "phase": "product-capture",
                "phaseSessionId": "session-0001",
                "phaseGeneration": 1,
                "connectionGeneration": 1,
                "toolSearchMode": "off",
                "rendererResponse": { "status": 200 }
            }
        });
        assert!(serde_json::from_value::<McpHttpRequestInput>(unknown_intent_field).is_err());
        let unknown_request_field = serde_json::json!({
            "endpoint": "http://127.0.0.1:8000/mcp",
            "body": "{}",
            "rendererResponse": { "status": 200 }
        });
        assert!(serde_json::from_value::<McpHttpRequestInput>(unknown_request_field).is_err());
    }

    #[test]
    fn post_streamable_http_reads_terminal_sse_after_an_empty_initial_frame() {
        let initial_frame = ": keepalive\n\n";
        let terminal_frame =
            "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"ok\":true}}\n\n";
        let body = format!("{initial_frame}{terminal_frame}");
        let headers = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nMcp-Session-Id: safe-session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let (endpoint, handle) = spawn_loopback_server(move |stream| {
            stream.write_all(headers.as_bytes()).unwrap();
            stream.write_all(initial_frame.as_bytes()).unwrap();
            stream.flush().unwrap();
            thread::sleep(Duration::from_millis(10));
            stream.write_all(terminal_frame.as_bytes()).unwrap();
        });

        let result = post_streamable_http(request_input(endpoint, 500)).unwrap();

        handle.join().unwrap();
        assert_eq!(result.status, 200);
        assert_eq!(result.content_type.as_deref(), Some("text/event-stream"));
        assert_eq!(result.session_id.as_deref(), Some("safe-session"));
        assert_eq!(result.body, body);
        assert!(result.observation_request.is_none());
        assert!(result.observation_receipts.is_none());
    }

    #[test]
    fn delete_terminates_the_exact_session_with_protocol_headers_and_observes_405() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/mcp", listener.local_addr().unwrap());
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(1)))
                .unwrap();
            let request = read_loopback_request(&mut stream);
            assert!(request.starts_with("DELETE /mcp HTTP/1.1\r\n"));
            assert!(request
                .to_ascii_lowercase()
                .contains("mcp-session-id: sensitive-session\r\n"));
            assert!(request
                .to_ascii_lowercase()
                .contains("mcp-protocol-version: 2025-06-18\r\n"));
            assert!(request
                .to_ascii_lowercase()
                .contains("accept: application/json, text/event-stream\r\n"));
            stream
                .write_all(b"HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                .unwrap();
        });
        let mut input = request_input(endpoint, 500);
        input.method = McpHttpMethod::Delete;
        input.body.clear();

        let result = post_streamable_http(input).unwrap();

        handle.join().unwrap();
        assert_eq!(result.method, McpHttpMethod::Delete);
        assert_eq!(result.status, 405);
        assert_eq!(result.body, "");
    }

    #[test]
    fn delete_requires_a_session_and_rejects_a_body() {
        let mut missing_session = request_input("http://127.0.0.1:8765/mcp".to_string(), 500);
        missing_session.method = McpHttpMethod::Delete;
        missing_session.body.clear();
        missing_session.session_id = None;
        assert_eq!(
            post_streamable_http(missing_session).unwrap_err(),
            "session_id_required"
        );

        let mut body = request_input("http://127.0.0.1:8765/mcp".to_string(), 500);
        body.method = McpHttpMethod::Delete;
        assert_eq!(
            post_streamable_http(body).unwrap_err(),
            "delete_body_not_allowed"
        );
    }

    #[test]
    fn post_streamable_http_returns_completed_sse_frame_without_waiting_for_connection_close() {
        let initial_frame = ": keepalive\r\n\r\n";
        let terminal_frame =
            "event: message\r\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"ok\":true}}\r\n\r\n";
        let body = format!("{initial_frame}{terminal_frame}");
        let headers = "HTTP/1.1 200 OK\r\nContent-Type: TEXT/EVENT-STREAM; charset=utf-8\r\nContent-Length: 4096\r\nConnection: keep-alive\r\n\r\n";
        let (endpoint, handle) = spawn_loopback_server(move |stream| {
            stream.write_all(headers.as_bytes()).unwrap();
            stream.write_all(initial_frame.as_bytes()).unwrap();
            stream
                .write_all(b"event: message\r\ndata: {\"jsonrpc\":\"2.0\",")
                .unwrap();
            stream.flush().unwrap();
            thread::sleep(Duration::from_millis(10));
            stream
                .write_all(b"\"id\":1,\"result\":{\"ok\":true}}\r\n\r\n")
                .unwrap();
            stream.flush().unwrap();
            thread::sleep(Duration::from_millis(750));
        });

        let started_at = Instant::now();
        let result = post_streamable_http(request_input(endpoint, 500)).unwrap();

        assert!(started_at.elapsed() < Duration::from_millis(500));
        handle.join().unwrap();
        assert_eq!(result.status, 200);
        assert_eq!(
            result.content_type.as_deref(),
            Some("TEXT/EVENT-STREAM; charset=utf-8")
        );
        assert_eq!(result.body, body);
    }

    #[test]
    fn post_streamable_http_rejects_incomplete_sse_data_frames() {
        let body = "data: {\"jsonrpc\":\"2.0\"}\n";
        let headers = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let (endpoint, handle) = spawn_loopback_server(move |stream| {
            stream.write_all(headers.as_bytes()).unwrap();
            stream.write_all(body.as_bytes()).unwrap();
        });

        let error = post_streamable_http(request_input(endpoint, 500)).unwrap_err();

        handle.join().unwrap();
        assert_eq!(error, "native_response_read_failed");
    }

    #[test]
    fn post_streamable_http_rejects_sse_bodies_larger_than_four_mebibytes() {
        let body = vec![b':'; 4 * 1024 * 1024 + 1];
        let headers = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let (endpoint, handle) = spawn_loopback_server(move |stream| {
            stream.write_all(headers.as_bytes()).unwrap();
            stream.write_all(&body).unwrap();
        });

        let error = post_streamable_http(request_input(endpoint, 500)).unwrap_err();

        handle.join().unwrap();
        assert_eq!(error, "native_response_read_failed");
    }

    #[test]
    fn post_streamable_http_rejects_invalid_utf8_sse() {
        let body = b"data: \xff\n\n";
        let headers = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let (endpoint, handle) = spawn_loopback_server(move |stream| {
            stream.write_all(headers.as_bytes()).unwrap();
            stream.write_all(body).unwrap();
        });

        let error = post_streamable_http(request_input(endpoint, 500)).unwrap_err();

        handle.join().unwrap();
        assert_eq!(error, "native_response_read_failed");
    }

    #[test]
    fn post_streamable_http_preserves_non_sse_response_metadata_and_body() {
        let body = r#"{"jsonrpc":"2.0","id":1,"result":{"ok":true}}"#;
        assert!(!is_event_stream_content_type(Some("application/json")));
        let headers = format!(
            "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nMcp-Session-Id: safe-session\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let (endpoint, handle) = spawn_loopback_server(move |stream| {
            stream.write_all(headers.as_bytes()).unwrap();
            stream.write_all(body.as_bytes()).unwrap();
        });

        let result = post_streamable_http(request_input(endpoint, 500)).unwrap();

        handle.join().unwrap();
        assert_eq!(result.status, 201);
        assert_eq!(result.content_type.as_deref(), Some("application/json"));
        assert_eq!(result.session_id.as_deref(), Some("safe-session"));
        assert_eq!(result.body, body);
    }

    #[test]
    fn post_streamable_http_sanitizes_connection_failures_to_a_stable_request_code() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/mcp", listener.local_addr().unwrap());
        drop(listener);

        let error = post_streamable_http(request_input(endpoint, 500)).unwrap_err();

        assert_eq!(error, "native_request_failed");
    }

    #[test]
    fn post_streamable_http_sanitizes_terminal_read_timeouts_to_a_distinct_response_code() {
        let partial_body = ": keepalive\n\n";
        let headers = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: 4096\r\nConnection: close\r\n\r\n"
        );
        let (endpoint, handle) = spawn_loopback_server(move |stream| {
            stream.write_all(headers.as_bytes()).unwrap();
            stream.write_all(partial_body.as_bytes()).unwrap();
            stream.flush().unwrap();
            thread::sleep(Duration::from_millis(750));
        });

        let error = post_streamable_http(request_input(endpoint, 500)).unwrap_err();

        handle.join().unwrap();
        assert_eq!(error, "native_response_read_failed");
    }
}
