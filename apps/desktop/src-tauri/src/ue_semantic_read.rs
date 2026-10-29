//! Pure native read-policy adapter. The host supplies verified root/peer scope; no grant is minted here.
use serde::Serialize;
use serde_json::{Map, Value};
const READS: [&str; 4] = [
    "uagent.v2.blueprint.describe",
    "uagent.v2.world.describe",
    "uagent.v2.selection.describe",
    "uagent.v2.asset.references",
];
#[derive(Debug)]
pub struct SemanticReadScope {
    project_key: String,
    instance_id: String,
    root_object_id: String,
    read_roots: Vec<String>,
}
impl SemanticReadScope {
    /// Call only after the native host validates its open root identity and owned editor endpoint.
    /// Input from a model, tool result, or deserialized IPC request cannot establish this scope.
    pub fn from_verified_host(
        project_key: String,
        instance_id: String,
        root_object_id: String,
        read_roots: Vec<String>,
    ) -> Result<Self, String> {
        if project_key.is_empty()
            || instance_id.is_empty()
            || root_object_id.is_empty()
            || read_roots.is_empty()
            || read_roots.len() > 32
            || !read_roots.iter().all(|root| package(root))
        {
            return Err("invalid_verified_scope".into());
        }
        Ok(Self {
            project_key,
            instance_id,
            root_object_id,
            read_roots,
        })
    }
    pub fn root_object_id(&self) -> &str {
        &self.root_object_id
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatedSemanticRead {
    pub tool_name: String,
    pub arguments: Value,
    pub expected_mutation: &'static str,
}
fn package(value: &str) -> bool {
    value.starts_with("/Game/")
        && value.len() <= 1024
        && value
            .split('/')
            .skip(1)
            .all(|part| !part.is_empty() && part.chars().all(|c| c.is_alphanumeric() || c == '_'))
}
fn only_keys(value: &Map<String, Value>, allowed: &[&str]) -> bool {
    value.keys().all(|key| allowed.contains(&key.as_str()))
}
/// Unwrap call_tool and check the actual operation. Wrapper names/annotations confer no permission.
pub fn validate_semantic_read(
    scope: &SemanticReadScope,
    call: &Value,
) -> Result<ValidatedSemanticRead, String> {
    let outer = call.as_object().ok_or("invalid_call")?;
    if !only_keys(outer, &["name", "arguments"]) {
        return Err("unknown_call_field".into());
    }
    let mut name = outer
        .get("name")
        .and_then(Value::as_str)
        .ok_or("tool_name_required")?;
    let mut args = outer
        .get("arguments")
        .and_then(Value::as_object)
        .ok_or("arguments_required")?;
    if name == "call_tool" {
        if !only_keys(args, &["tool_name", "arguments"]) {
            return Err("unsupported_toolset_wrapper".into());
        }
        name = args
            .get("tool_name")
            .and_then(Value::as_str)
            .ok_or("inner_tool_required")?;
        args = args
            .get("arguments")
            .and_then(Value::as_object)
            .ok_or("inner_arguments_required")?;
    }
    if !READS.contains(&name) {
        return Err("semantic_read_tool_not_allowed".into());
    }
    if args.get("protocolVersion").and_then(Value::as_u64) != Some(2)
        || args.get("expectedProjectKey").and_then(Value::as_str)
            != Some(scope.project_key.as_str())
        || args.get("expectedInstanceId").and_then(Value::as_str)
            != Some(scope.instance_id.as_str())
    {
        return Err("stale_or_cross_project_request".into());
    }
    let mut keys = vec![
        "protocolVersion",
        "expectedProjectKey",
        "expectedInstanceId",
        "limit",
    ];
    {
        let target = if name == READS[1] || name == READS[2] {
            "expectedWorldPackage"
        } else {
            "packageName"
        };
        keys.push(target);
        let path = args
            .get(target)
            .and_then(Value::as_str)
            .ok_or("package_required")?;
        if !package(path)
            || !scope
                .read_roots
                .iter()
                .any(|root| path == root || path.starts_with(&(root.clone() + "/")))
        {
            return Err("package_outside_read_scope".into());
        }
    }
    if name == READS[0] {
        keys.push("expectedRevision");
    }
    if !only_keys(args, &keys) {
        return Err("unknown_argument".into());
    }
    if let Some(limit) = args.get("limit") {
        if limit.as_u64().filter(|n| (1..=256).contains(n)).is_none() {
            return Err("invalid_limit".into());
        }
    }
    if let Some(revision) = args.get("expectedRevision") {
        if revision
            .as_str()
            .filter(|s| {
                s.len() == 32
                    && s.bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            })
            .is_none()
        {
            return Err("invalid_revision".into());
        }
    }
    Ok(ValidatedSemanticRead {
        tool_name: name.into(),
        arguments: Value::Object(args.clone()),
        expected_mutation: "none",
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn scope() -> SemanticReadScope {
        SemanticReadScope::from_verified_host(
            "project-a".into(),
            "instance-a".into(),
            "volume:file-id".into(),
            vec!["/Game/Allowed".into()],
        )
        .unwrap()
    }
    fn call() -> Value {
        json!({"name":READS[0],"arguments":{"protocolVersion":2,"expectedProjectKey":"project-a","expectedInstanceId":"instance-a","packageName":"/Game/Allowed/BP_Test"}})
    }
    #[test]
    fn accepts_exact_direct_and_wrapped_read() {
        let scope = scope();
        let direct = call();
        assert_eq!(
            validate_semantic_read(&scope, &direct)
                .unwrap()
                .expected_mutation,
            "none"
        );
        let wrapped = json!({"name":"call_tool","arguments":{"tool_name":READS[0],"arguments":direct["arguments"]}});
        assert_eq!(
            validate_semantic_read(&scope, &wrapped).unwrap().tool_name,
            READS[0]
        );
    }
    #[test]
    fn rejects_v1_writes_and_nested_or_ambiguous_wrappers() {
        let scope = scope();
        let mut input = call();
        input["name"] = json!("ue.asset.save");
        assert!(validate_semantic_read(&scope, &input).is_err());
        let wrapped =
            json!({"name":"call_tool","arguments":{"tool_name":"call_tool","arguments":call()}});
        assert!(validate_semantic_read(&scope, &wrapped).is_err());
        let wrapped = json!({"name":"call_tool","arguments":{"tool_name":READS[0],"toolset_name":"arbitrary","arguments":call()["arguments"]}});
        assert!(validate_semantic_read(&scope, &wrapped).is_err());
    }
    #[test]
    fn rejects_scope_traversal_cross_project_and_extra_execution_fields() {
        for path in [
            "/Game/AllowedOther/BP_Test",
            "/Game/Allowed/../Other",
            "/Engine/EngineCube",
            "/Game/Allowed/BP_Test.BP_Test",
        ] {
            let mut input = call();
            input["arguments"]["packageName"] = json!(path);
            assert!(validate_semantic_read(&scope(), &input).is_err());
        }
        let mut input = call();
        input["arguments"]["expectedProjectKey"] = json!("project-b");
        assert!(validate_semantic_read(&scope(), &input).is_err());
        let mut input = call();
        input["arguments"]["execute"] = json!(true);
        assert!(validate_semantic_read(&scope(), &input).is_err());
    }
    #[test]
    fn binds_world_and_selection_to_a_scoped_expected_package() {
        for name in [READS[1], READS[2]] {
            let mut input = call();
            input["name"] = json!(name);
            input["arguments"]
                .as_object_mut()
                .unwrap()
                .remove("packageName");
            assert!(validate_semantic_read(&scope(), &input).is_err());
            input["arguments"]["expectedWorldPackage"] = json!("/Game/Allowed/L_Test");
            assert!(validate_semantic_read(&scope(), &input).is_ok());
            input["arguments"]["expectedWorldPackage"] = json!("/Game/AllowedSibling/L_Test");
            assert!(validate_semantic_read(&scope(), &input).is_err());
        }
    }
    #[test]
    fn rejects_old_instance_protocol_and_unbounded_limits() {
        for (key, value) in [
            ("expectedInstanceId", json!("old")),
            ("protocolVersion", json!(1)),
            ("limit", json!(257)),
            ("limit", json!(1.5)),
        ] {
            let mut input = call();
            input["arguments"][key] = value;
            assert!(validate_semantic_read(&scope(), &input).is_err());
        }
    }
}
