use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::str::FromStr;
use std::time::Duration;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHttpRequestInput {
    pub endpoint: String,
    pub body: String,
    pub protocol_version: Option<String>,
    pub session_id: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHttpRequestResult {
    pub status: u16,
    pub body: String,
    pub content_type: Option<String>,
    pub session_id: Option<String>,
}

#[tauri::command]
pub fn mcp_streamable_http_request(
    input: McpHttpRequestInput,
) -> Result<McpHttpRequestResult, String> {
    post_streamable_http(input)
}

fn post_streamable_http(input: McpHttpRequestInput) -> Result<McpHttpRequestResult, String> {
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

    let mut request = agent
        .post(&input.endpoint)
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .set("MCP-Protocol-Version", protocol_version);

    if let Some(session_id) = input.session_id.as_deref().filter(|value| !value.is_empty()) {
        request = request.set("Mcp-Session-Id", session_id);
    }

    match request.send_string(&input.body) {
        Ok(response) => response_to_result(response),
        Err(ureq::Error::Status(_, response)) => response_to_result(response),
        Err(error) => Err(format!("mcp_http_request_failed:{error}")),
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
    let host = parsed.host_str().ok_or_else(|| "host_required".to_string())?;
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

fn response_to_result(response: ureq::Response) -> Result<McpHttpRequestResult, String> {
    let status = response.status();
    let content_type = response.header("Content-Type").map(ToString::to_string);
    let session_id = response.header("Mcp-Session-Id").map(ToString::to_string);
    let body = response
        .into_string()
        .map_err(|error| format!("mcp_http_response_read_failed:{error}"))?;

    Ok(McpHttpRequestResult {
        status,
        body,
        content_type,
        session_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
