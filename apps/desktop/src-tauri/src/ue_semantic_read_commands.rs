//! T11 integration boundary inspection, not a semantic-query implementation.
//! Existing native process observations do not provide an owned T11 MCP connection.
//! Do not construct SemanticReadScope from an IPC project/instance/root assertion,
//! copy the v1 exact-six authority, or dispatch through the generic MCP endpoint.
//! Only inspect_ue_semantic_read_availability is an IPC command in this module.
//!
//! Minimum future native host port (not implemented or registered here): resolve
//! the live selected root -> acquire an OS-verified editor process + owned peer
//! connection with current generations -> obtain an exact semantic read grant ->
//! intersect it with exact v2 discovery roots and schemas -> create SemanticReadScope
//! inside that host -> validate the original request -> serialized final lease gate
//! -> bounded dispatch -> validate the actual result against that request and retain
//! provenance. No JSON scope, endpoint, PID or peer self-assertion supplies this port.
#![cfg(windows)]
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InspectSemanticReadInput {
    pub project_id: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SemanticReadAvailability {
    schema_version: u32,
    project_id: String,
    observed_at_ms: u64,
    status: &'static str,
    reason: &'static str,
    trusted_root_current: bool,
    observation_only: bool,
    scope_established: bool,
    read_enabled: bool,
    query_dispatched: bool,
    semantic_data_returned: bool,
    prerequisites: [Prerequisite; 4],
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Prerequisite {
    id: &'static str,
    status: &'static str,
}
fn prerequisites() -> [Prerequisite; 4] {
    [
        Prerequisite { id: "owned_editor_connection", status: "not_integrated" },
        Prerequisite { id: "native_semantic_read_grant", status: "not_integrated" },
        Prerequisite { id: "exact_v2_negotiation", status: "not_checked" },
        Prerequisite { id: "request_bound_result_provenance", status: "not_integrated" },
    ]
}
fn valid_project_id(value: &str) -> bool {
    value.strip_prefix("root:").is_some_and(|tail|
        !tail.is_empty() && tail.len() <= 64 && tail.bytes().all(|b| b.is_ascii_hexdigit()))
}
static INSPECTION_BUSY: AtomicBool = AtomicBool::new(false);
struct InspectionPermit;
impl InspectionPermit {
    fn acquire() -> Result<Self, String> {
        INSPECTION_BUSY.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "ue_semantic_inspection_busy".to_string())?;
        Ok(Self)
    }
}
impl Drop for InspectionPermit {
    fn drop(&mut self) { INSPECTION_BUSY.store(false, Ordering::Release); }
}
fn inspect(input: InspectSemanticReadInput, _permit: InspectionPermit) -> Result<SemanticReadAvailability, String> {
    let held = crate::resolve_trusted_root_handle_by_id(&input.project_id)
        .map_err(|_| "ue_semantic_trusted_root_unavailable".to_string())?;
    held.check_current().map_err(|_| "ue_semantic_trusted_root_changed")?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|_| "ue_semantic_clock_unavailable")?.as_millis();
    let observed_at_ms = u64::try_from(now).map_err(|_| "ue_semantic_clock_unavailable")?;
    // This only checks the existing root lease. It neither looks up/renews an
    // editor observation nor opens a transport, discovers tools or grants access.
    let current = crate::resolve_trusted_root_handle_by_id(&input.project_id)
        .map_err(|_| "ue_semantic_trusted_root_unavailable".to_string())?;
    if !Arc::ptr_eq(&held, &current) {
        return Err("ue_semantic_trusted_root_changed".into());
    }
    held.check_current().map_err(|_| "ue_semantic_trusted_root_changed")?;
    Ok(SemanticReadAvailability {
        schema_version: 1,
        project_id: input.project_id,
        observed_at_ms,
        status: "blocked",
        reason: "native_verified_editor_read_host_missing",
        trusted_root_current: true,
        observation_only: true,
        scope_established: false,
        read_enabled: false,
        query_dispatched: false,
        semantic_data_returned: false,
        prerequisites: prerequisites(),
    })
}
#[tauri::command]
pub(crate) async fn inspect_ue_semantic_read_availability(input: InspectSemanticReadInput) -> Result<SemanticReadAvailability, String> {
    if !valid_project_id(&input.project_id) {
        return Err("ue_semantic_trusted_project_required".into());
    }
    let permit = InspectionPermit::acquire()?;
    tauri::async_runtime::spawn_blocking(move || inspect(input, permit))
        .await.map_err(|_| "ue_semantic_inspection_worker_unavailable".to_string())?
}

/// Untrusted request DATA for the future host port. No IPC accepts this draft yet.
/// Shape validation does not authorize a package, open a session or create a scope.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SemanticReadOperation {
    BlueprintDescribe,
    AssetReferences,
}
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SemanticReadIntent {
    pub operation: SemanticReadOperation,
    pub package_name: String,
    pub limit: u16,
    pub expected_revision: Option<String>,
}
#[allow(dead_code)]
impl SemanticReadIntent {
    pub(crate) fn tool_name(&self) -> &'static str {
        match self.operation {
            SemanticReadOperation::BlueprintDescribe => "uagent.v2.blueprint.describe",
            SemanticReadOperation::AssetReferences => "uagent.v2.asset.references",
        }
    }
    pub(crate) fn validate_untrusted_shape(&self) -> Result<(), &'static str> {
        let package = &self.package_name;
        if !package.starts_with("/Game/") || package.len() > 1024 ||
            !package.split('/').skip(1).all(|part| !part.is_empty() && part.chars().all(|c| c.is_alphanumeric() || c == '_')) {
            return Err("ue_semantic_invalid_package");
        }
        if !(1..=256).contains(&self.limit) { return Err("ue_semantic_invalid_limit"); }
        if let Some(revision) = &self.expected_revision {
            if !matches!(self.operation, SemanticReadOperation::BlueprintDescribe) ||
                revision.len() != 32 || !revision.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
                return Err("ue_semantic_invalid_revision");
            }
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn inspection_rejects_scope_peer_and_transport_assertions() {
        let mut input = json!({"projectId":"root:a123"});
        for (key, value) in [("projectKey", json!("peer")), ("instanceId", json!("peer")),
            ("rootObjectId", json!("forged")), ("readRoots", json!(["/Game/Any"])),
            ("endpoint", json!("http://127.0.0.1:8080/mcp")), ("pid", json!(123))] {
            input[key] = value;
            assert!(serde_json::from_value::<InspectSemanticReadInput>(input.clone()).is_err());
            input.as_object_mut().unwrap().remove(key);
        }
    }
    #[test]
    fn unregistered_intent_has_only_two_exact_read_shapes() {
        let mut value = json!({"operation":"blueprint_describe","packageName":"/Game/Allowed/BP_Test","limit":128});
        let intent: SemanticReadIntent = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(intent.tool_name(), "uagent.v2.blueprint.describe");
        assert!(intent.validate_untrusted_shape().is_ok());
        value["operation"] = json!("asset_references");
        let intent: SemanticReadIntent = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(intent.tool_name(), "uagent.v2.asset.references");
        value["expectedProjectKey"] = json!("forged");
        assert!(serde_json::from_value::<SemanticReadIntent>(value).is_err());
    }
    #[test]
    fn revisions_are_only_accepted_for_blueprint_request_data() {
        let mut value = json!({"operation":"blueprint_describe","packageName":"/Game/A","limit":1,"expectedRevision":"0123456789abcdef0123456789abcdef"});
        let intent: SemanticReadIntent = serde_json::from_value(value.clone()).unwrap();
        assert!(intent.validate_untrusted_shape().is_ok());
        value["operation"] = json!("asset_references");
        let intent: SemanticReadIntent = serde_json::from_value(value.clone()).unwrap();
        assert!(intent.validate_untrusted_shape().is_err());
        value["operation"] = json!("blueprint_describe");
        value["expectedRevision"] = json!("not-a-revision");
        let intent: SemanticReadIntent = serde_json::from_value(value).unwrap();
        assert!(intent.validate_untrusted_shape().is_err());
    }
    #[test]
    fn shape_validation_rejects_cold_preparation_writes_and_bad_targets() {
        for operation in ["load_asset", "compile_blueprint", "save_asset", "world_describe"] {
            assert!(serde_json::from_value::<SemanticReadIntent>(json!({"operation":operation,"packageName":"/Game/A","limit":1})).is_err());
        }
        for package in ["/Game", "/Engine/A", "/Game/A/../B", "/Game/A.B", "/Game/A//B"] {
            let intent: SemanticReadIntent = serde_json::from_value(json!({"operation":"blueprint_describe","packageName":package,"limit":1})).unwrap();
            assert!(intent.validate_untrusted_shape().is_err());
        }
        let intent: SemanticReadIntent = serde_json::from_value(json!({"operation":"asset_references","packageName":"/Game/A","limit":257})).unwrap();
        assert!(intent.validate_untrusted_shape().is_err());
    }
}
