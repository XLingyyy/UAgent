use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, Write};
use uagent_lib::mcp::{post_streamable_http, McpHttpRequestInput, McpHttpRequestResult};

const MAX_STDIN_BYTES: u64 = 4 * 1024 * 1024;
const D0_TOOLSET_NAME: &str = "UAgentAssetTools.UAgentAssetToolsD0Toolset";
const D0_TOOL_NAME: &str = "Probe";
const D0_QUALIFIED_TOOL_NAME: &str = "UAgentAssetTools.UAgentAssetToolsD0Toolset.Probe";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BridgeRequest {
    request_id: Option<Value>,
    command: String,
    input: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeResponse {
    request_id: Option<Value>,
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
}

fn main() {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout().lock();
    for encoded in stdin.lock().lines() {
        let response = match encoded {
            Ok(encoded) => handle_line(encoded.as_bytes()),
            Err(_) => BridgeResponse {
                request_id: None,
                ok: false,
                result: None,
                error: Some("bridge_stdin_read_failed".to_string()),
            },
        };
        if serde_json::to_writer(&mut stdout, &response).is_err()
            || stdout.write_all(b"\n").is_err()
            || stdout.flush().is_err()
        {
            std::process::exit(1);
        }
    }
}

fn handle_line(encoded: &[u8]) -> BridgeResponse {
    if encoded.len() as u64 > MAX_STDIN_BYTES {
        return BridgeResponse {
            request_id: None,
            ok: false,
            result: None,
            error: Some("bridge_request_too_large".to_string()),
        };
    }
    let request: BridgeRequest = match serde_json::from_slice(encoded) {
        Ok(request) => request,
        Err(_) => {
            return BridgeResponse {
                request_id: None,
                ok: false,
                result: None,
                error: Some("bridge_request_invalid".to_string()),
            }
        }
    };
    let request_id = request.request_id.clone();
    dispatch(request)
        .map(|result| BridgeResponse {
            request_id: request_id.clone(),
            ok: true,
            result: Some(result),
            error: None,
        })
        .unwrap_or_else(|error| BridgeResponse {
            request_id,
            ok: false,
            result: None,
            error: Some(error),
        })
}

fn dispatch(request: BridgeRequest) -> Result<Value, String> {
    if request.command == "mcp_streamable_http_request" {
        let input: McpHttpRequestInput = serde_json::from_value(request.input)
            .map_err(|_| "bridge_native_input_invalid".to_string())?;
        validate_mutation_incapable_request(&input.body)?;
        return post_streamable_http(input).and_then(|result: McpHttpRequestResult| {
            serde_json::to_value(result).map_err(|_| "bridge_native_result_invalid".to_string())
        });
    }
    uagent_lib::mvp15d_task_native_invoke(&request.command, request.input)
}

fn validate_mutation_incapable_request(body: &str) -> Result<(), String> {
    let request: Value =
        serde_json::from_str(body).map_err(|_| "bridge_jsonrpc_invalid".to_string())?;
    let record = request
        .as_object()
        .ok_or_else(|| "bridge_jsonrpc_invalid".to_string())?;
    let method = record
        .get("method")
        .and_then(Value::as_str)
        .ok_or_else(|| "bridge_jsonrpc_method_required".to_string())?;
    match method {
        "initialize"
        | "notifications/initialized"
        | "ping"
        | "tools/list"
        | "resources/list"
        | "prompts/list" => Ok(()),
        "tools/call" => validate_task_noop_call(record.get("params")),
        _ => Err("bridge_jsonrpc_method_not_allowed".to_string()),
    }
}

fn validate_task_noop_call(params: Option<&Value>) -> Result<(), String> {
    let params = params
        .and_then(Value::as_object)
        .ok_or_else(|| "bridge_tool_call_invalid".to_string())?;
    if params.len() != 2 {
        return Err("bridge_tool_call_invalid".to_string());
    }
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| "bridge_tool_call_invalid".to_string())?;
    let arguments = params
        .get("arguments")
        .and_then(Value::as_object)
        .ok_or_else(|| "bridge_tool_call_invalid".to_string())?;
    match name {
        "uagent.d0.probe" | "list_toolsets" if arguments.is_empty() => Ok(()),
        qualified_probe if arguments.is_empty() && qualified_probe == D0_QUALIFIED_TOOL_NAME => {
            Ok(())
        }
        "describe_toolset"
            if arguments.len() == 1
                && arguments.get("toolset_name").and_then(Value::as_str)
                    == Some(D0_TOOLSET_NAME) =>
        {
            Ok(())
        }
        "call_tool"
            if arguments.len() == 3
                && arguments.get("toolset_name").and_then(Value::as_str)
                    == Some(D0_TOOLSET_NAME)
                && arguments.get("tool_name").and_then(Value::as_str) == Some(D0_TOOL_NAME)
                && arguments
                    .get("arguments")
                    .and_then(Value::as_object)
                    .is_some_and(serde_json::Map::is_empty) =>
        {
            Ok(())
        }
        _ => Err("bridge_tool_call_not_allowed".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_allows_only_discovery_and_task_noop_calls() {
        for body in [
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#,
            r#"{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}"#,
            r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"uagent.d0.probe","arguments":{}}}"#,
            r#"{"jsonrpc":"2.0","id":31,"method":"tools/call","params":{"name":"UAgentAssetTools.UAgentAssetToolsD0Toolset.Probe","arguments":{}}}"#,
            r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"describe_toolset","arguments":{"toolset_name":"UAgentAssetTools.UAgentAssetToolsD0Toolset"}}}"#,
            r#"{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"call_tool","arguments":{"toolset_name":"UAgentAssetTools.UAgentAssetToolsD0Toolset","tool_name":"Probe","arguments":{}}}}"#,
        ] {
            assert_eq!(validate_mutation_incapable_request(body), Ok(()));
        }
        for body in [
            r#"{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"ue.asset.save","arguments":{}}}"#,
            r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"describe_toolset","arguments":{"toolset_name":"ForeignToolset"}}}"#,
            r#"{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"call_tool","arguments":{"toolset_name":"UAgentAssetToolsD0Toolset","tool_name":"Save","arguments":{}}}}"#,
            r#"{"jsonrpc":"2.0","id":9,"method":"resources/read","params":{}}"#,
            r#"{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"call_tool","arguments":{"toolset_name":"ForeignToolset","tool_name":"Probe","arguments":{}}}}"#,
            r#"{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"Probe","arguments":{}}}"#,
            r#"{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"Prefix.UAgentAssetTools.UAgentAssetToolsD0Toolset.Probe","arguments":{}}}"#,
            r#"{"jsonrpc":"2.0","id":13,"method":"tools/call","params":{"name":"UAgentAssetTools.UAgentAssetToolsD0Toolset.Probe.Suffix","arguments":{}}}"#,
            r#"{"jsonrpc":"2.0","id":14,"method":"tools/call","params":{"name":"uagentassettools.uagentassettoolsd0toolset.probe","arguments":{}}}"#,
            r#"{"jsonrpc":"2.0","id":15,"method":"tools/call","params":{"name":"describe_toolset","arguments":{"toolset_name":"Prefix.UAgentAssetTools.UAgentAssetToolsD0Toolset"}}}"#,
            r#"{"jsonrpc":"2.0","id":16,"method":"tools/call","params":{"name":"describe_toolset","arguments":{"toolset_name":"UAgentAssetTools.UAgentAssetToolsD0Toolset.Suffix"}}}"#,
            r#"{"jsonrpc":"2.0","id":17,"method":"tools/call","params":{"name":"call_tool","arguments":{"toolset_name":"Prefix.UAgentAssetTools.UAgentAssetToolsD0Toolset","tool_name":"Probe","arguments":{}}}}"#,
            r#"{"jsonrpc":"2.0","id":18,"method":"tools/call","params":{"name":"call_tool","arguments":{"toolset_name":"UAgentAssetTools.UAgentAssetToolsD0Toolset.Suffix","tool_name":"Probe","arguments":{}}}}"#,
            r#"{"jsonrpc":"2.0","id":19,"method":"tools/call","params":{"name":"call_tool","arguments":{"toolset_name":"UAgentAssetTools.UAgentAssetToolsD0Toolset","tool_name":"UAgentAssetTools.UAgentAssetToolsD0Toolset.Probe","arguments":{}}}}"#,
            r#"{"jsonrpc":"2.0","id":20,"method":"tools/call","params":{"name":"call_tool","arguments":{"toolset_name":"UAgentAssetTools.UAgentAssetToolsD0Toolset","tool_name":"Save","arguments":{}}}}"#,
            r#"{"jsonrpc":"2.0","id":21,"method":"tools/call","params":{"name":"call_tool","arguments":{"toolset_name":"UAgentAssetTools.UAgentAssetToolsD0Toolset","tool_name":"Probe.Suffix","arguments":{}}}}"#,
            r#"{"jsonrpc":"2.0","id":22,"method":"tools/call","params":{"name":"call_tool","arguments":{"toolset_name":"UAgentAssetTools.UAgentAssetToolsD0Toolset","tool_name":"probe","arguments":{}}}}"#,
        ] {
            assert!(validate_mutation_incapable_request(body).is_err());
        }
    }

    #[test]
    fn persistent_envelope_preserves_request_identity_and_rejects_unknown_commands() {
        let response = handle_line(
            br#"{"requestId":"bridge-test-1","command":"execute_asset_mutation","input":{}}"#,
        );
        assert!(!response.ok);
        assert_eq!(
            response.request_id,
            Some(Value::String("bridge-test-1".to_string()))
        );
        assert!(response.result.is_none());
        assert_eq!(
            response.error.as_deref(),
            Some("bridge_native_command_not_allowed")
        );
    }
}
