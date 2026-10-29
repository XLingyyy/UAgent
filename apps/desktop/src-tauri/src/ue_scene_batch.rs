//! T14 isolated-Lab, current-process/current-editor scene policy. No IPC or production grant is installed.
//! Host scopes, session generations and permits are deliberately not Deserialize. They must come from
//! a live owned-editor/root lease plus exact-plan approval; model JSON cannot construct authority.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;

pub const CONTRACT: &str = "2.2.0-scene-batch-current-run";
pub const ROOT: &str = "/Game/UAgentBuildLab/Scene_T14";
pub const MATERIAL: &str = "/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial";
pub const TOOLS: [&str; 6] = [
    "uagent.v2.scene.prepare",
    "uagent.v2.scene.execute",
    "uagent.v2.scene.cancel",
    "uagent.v2.scene.query",
    "uagent.v2.scene.resume",
    "uagent.v2.scene.save",
];
const MESHES: [&str; 3] = [
    "/Engine/BasicShapes/Cube.Cube",
    "/Engine/BasicShapes/Sphere.Sphere",
    "/Engine/BasicShapes/Cylinder.Cylinder",
];
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SceneVector {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SceneRotation {
    pub pitch: f64,
    pub yaw: f64,
    pub roll: f64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SceneTransform {
    pub location: SceneVector,
    pub rotation: SceneRotation,
    pub scale: SceneVector,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SceneBatchItem {
    pub item_id: String,
    pub object_name: String,
    pub mesh: String,
    pub material: String,
    pub transform: SceneTransform,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SceneBatchPlan {
    pub operation_id: String,
    pub target_map: String,
    pub expected_disk_state: String,
    pub items: Vec<SceneBatchItem>,
}
fn guid(s: &str) -> bool {
    s.len() == 36
        && s != "00000000-0000-0000-0000-000000000000"
        && s.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
            }
        })
}
fn hash(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn word(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}
fn bounded(v: f64, min: f64, max: f64) -> bool {
    v.is_finite() && v >= min && v <= max
}
impl SceneRotation {
    // UE5.8 Core/Private/Math/UnrealMath.cpp, FRotator3d::Quaternion scalar formula.
    fn ue_quaternion(&self) -> [f64; 4] {
        let half_degrees_to_radians = std::f64::consts::PI / 360.0;
        let sp = (self.pitch * half_degrees_to_radians).sin();
        let cp = (self.pitch * half_degrees_to_radians).cos();
        let sy = (self.yaw * half_degrees_to_radians).sin();
        let cy = (self.yaw * half_degrees_to_radians).cos();
        let sr = (self.roll * half_degrees_to_radians).sin();
        let cr = (self.roll * half_degrees_to_radians).cos();
        let mut q = [
            cr * sp * sy - sr * cp * cy,
            -cr * sp * cy - sr * cp * sy,
            cr * cp * sy - sr * sp * cy,
            cr * cp * cy + sr * sp * sy,
        ];
        let norm = q.iter().map(|value| value * value).sum::<f64>().sqrt();
        for value in &mut q {
            *value /= norm;
        }
        q
    }
    fn orientation_matches(&self, expected: &Self) -> bool {
        let a = self.ue_quaternion();
        let b = expected.ue_quaternion();
        let dot = a.iter().zip(b).map(|(a, b)| a * b).sum::<f64>();
        let sign = if dot < 0.0 { -1.0 } else { 1.0 };
        let mut difference_squared = 0.0;
        let mut sum_squared = 0.0;
        for i in 0..4 {
            let aligned = sign * b[i];
            let difference = a[i] - aligned;
            let sum = a[i] + aligned;
            difference_squared += difference * difference;
            sum_squared += sum * sum;
        }
        // q and -q describe one pose. For aligned unit quaternions this is the shortest
        // physical orientation angle: 4*atan2(|a-b|, |a+b|). Tolerance is 0.001 degrees
        // for the whole orientation, not 0.001 per Euler axis; approval stays value-exact.
        let angle_degrees = 4.0 * difference_squared.sqrt().atan2(sum_squared.sqrt()) * 180.0
            / std::f64::consts::PI;
        angle_degrees <= 0.001
    }
}
impl SceneTransform {
    fn valid(&self) -> bool {
        [self.location.x, self.location.y, self.location.z]
            .iter()
            .all(|v| bounded(*v, -10000.0, 10000.0))
            && [self.rotation.pitch, self.rotation.yaw, self.rotation.roll]
                .iter()
                .all(|v| bounded(*v, -180.0, 180.0))
            && [self.scale.x, self.scale.y, self.scale.z]
                .iter()
                .all(|v| bounded(*v, 0.1, 10.0))
    }
    fn matches(&self, expected: &Self) -> bool {
        let close = |a: f64, b: f64| (a - b).abs() <= 0.001;

        self.valid()
            && close(self.location.x, expected.location.x)
            && close(self.location.y, expected.location.y)
            && close(self.location.z, expected.location.z)
            && close(self.scale.x, expected.scale.x)
            && close(self.scale.y, expected.scale.y)
            && close(self.scale.z, expected.scale.z)
            && self.rotation.orientation_matches(&expected.rotation)
    }
}
impl SceneBatchPlan {
    pub fn validate(&self) -> Result<(), String> {
        let name = self
            .target_map
            .strip_prefix(&format!("{ROOT}/"))
            .ok_or("target_outside_fixed_lab_scope")?;
        if !guid(&self.operation_id)
            || !name.starts_with("L_")
            || !word(name, 80)
            || self.expected_disk_state != "absent"
            || self.items.len() != 20
        {
            return Err("invalid_fixed_scene_plan".into());
        }
        let mut ids = HashSet::new();
        let mut names = HashSet::new();
        for item in &self.items {
            if !word(&item.item_id, 64)
                || !word(&item.object_name, 64)
                || !item.object_name.starts_with("UA14_")
                || !MESHES.contains(&item.mesh.as_str())
                || item.material != MATERIAL
                || !item.transform.valid()
                || !ids.insert(item.item_id.clone())
                || !names.insert(item.object_name.to_ascii_lowercase())
            {
                return Err("invalid_or_duplicate_scene_item".into());
            }
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SceneItemReceipt {
    pub item_id: String,
    pub object_name: String,
    pub status: String,
    pub reason: String,
    pub owned: bool,
    pub actor_guid: String,
    pub object_path: String,
    pub mesh: String,
    pub material: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transform: Option<SceneTransform>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SceneBatchData {
    pub state: String,
    pub target_map: String,
    pub current_world_matches: bool,
    pub package_dirty: bool,
    pub saved: bool,
    pub disk_exists: bool,
    pub disk_hash: String,
    pub conflict: bool,
    pub cancel_is_rollback: bool,
    pub items: Vec<SceneItemReceipt>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query_token: Option<String>,
    pub applied_count: usize,
    pub conflict_reason: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SceneResult {
    schema_version: String,
    contract_version: String,
    project_key: String,
    instance_id: String,
    root_object_id: String,
    run_id: String,
    operation: String,
    plan: SceneBatchPlan,
    plan_hash: String,
    data: SceneBatchData,
}
pub struct SceneHostScope {
    project_key: String,
    instance_id: String,
    root_object_id: String,
    run_id: String,
    host_session_id: String,
    plan: SceneBatchPlan,
}
impl SceneHostScope {
    /// TRUSTED HOST ONLY: the caller has verified the actual owned editor, held root lease and
    /// exact plan approval. Rotate host_session_id on any editor/root/run/process replacement.
    /// Never accept these constructor arguments through a model-facing deserialization route.
    pub fn from_verified_owned_editor(
        project_key: String,
        instance_id: String,
        root_object_id: String,
        run_id: String,
        host_session_id: String,
        approved_plan: SceneBatchPlan,
    ) -> Result<Self, String> {
        approved_plan.validate()?;
        if project_key.is_empty()
            || project_key.len() > 4096
            || root_object_id.is_empty()
            || root_object_id.len() > 4096
            || !guid(&instance_id)
            || !guid(&run_id)
            || !guid(&host_session_id)
        {
            return Err("verified_current_host_identity_required".into());
        }
        Ok(Self {
            project_key,
            instance_id,
            root_object_id,
            run_id,
            host_session_id,
            plan: approved_plan,
        })
    }
    fn verify_result(&self, tool: &str, value: &Value) -> Result<SceneBatchData, String> {
        // Optional fields may be omitted, never supplied as JSON null.
        let raw = value.get("data").ok_or("result_data_required")?;
        if raw.get("queryToken").is_some_and(Value::is_null)
            || raw.get("appliedCount").is_some_and(Value::is_null)
            || raw
                .get("items")
                .and_then(Value::as_array)
                .is_some_and(|items| {
                    items
                        .iter()
                        .any(|item| item.get("transform").is_some_and(Value::is_null))
                })
        {
            return Err("null_optional_result_field".into());
        }
        let result: SceneResult =
            serde_json::from_value(value.clone()).map_err(|_| "invalid_scene_result_schema")?;
        result.plan.validate()?;
        if !TOOLS.contains(&tool)
            || result.schema_version != "uagent.scene.result.v2"
            || result.contract_version != CONTRACT
            || result.project_key != self.project_key
            || result.instance_id != self.instance_id
            || result.root_object_id != self.root_object_id
            || result.run_id != self.run_id
            || result.operation != tool
            || result.plan != self.plan
            || !hash(&result.plan_hash)
        {
            return Err("scene_result_binding_mismatch".into());
        }
        self.verify_data(tool, &result.data)?;
        Ok(result.data)
    }
    fn verify_data(&self, tool: &str, data: &SceneBatchData) -> Result<(), String> {
        let states = [
            "not_started",
            "prepared",
            "running",
            "paused_for_test_cancel",
            "cancelled",
            "completed",
            "saved",
            "conflicted",
            "failed",
        ];
        if !states.contains(&data.state.as_str())
            || data.target_map != self.plan.target_map
            || data.cancel_is_rollback
            || (!data.conflict && !data.conflict_reason.is_empty())
            || data.items.len() != 20
            || (if data.disk_exists {
                !hash(&data.disk_hash)
            } else {
                !data.disk_hash.is_empty()
            })
            || data.query_token.as_ref().is_some_and(|s| !guid(s))
        {
            return Err("invalid_scene_result_data".into());
        }
        let mut actor_guids = HashSet::new();
        let mut actor_paths = HashSet::new();
        let map_name = self
            .plan
            .target_map
            .rsplit('/')
            .next()
            .ok_or("invalid_target_map")?;
        for (item, expected) in data.items.iter().zip(&self.plan.items) {
            if item.item_id != expected.item_id
                || item.object_name != expected.object_name
                || !["not_started", "applied", "unknown", "failed"].contains(&item.status.as_str())
            {
                return Err("invalid_scene_item_receipt".into());
            }
            if item.status == "applied" {
                let path = format!(
                    "{}.{}:PersistentLevel.{}",
                    self.plan.target_map, map_name, expected.object_name
                );
                if !item.owned
                    || !guid(&item.actor_guid)
                    || item.object_path != path
                    || item.mesh != expected.mesh
                    || item.material != expected.material
                    || !item
                        .transform
                        .as_ref()
                        .is_some_and(|t| t.matches(&expected.transform))
                    || !actor_guids.insert(item.actor_guid.clone())
                    || !actor_paths.insert(item.object_path.clone())
                {
                    return Err("applied_scene_item_not_verified".into());
                }
            } else if item.owned
                || !item.actor_guid.is_empty()
                || !item.object_path.is_empty()
                || item.transform.is_some()
                || (!item.mesh.is_empty() && item.mesh != expected.mesh)
                || (!item.material.is_empty() && item.material != expected.material)
            {
                return Err("unapplied_scene_item_claims_observation".into());
            }
        }
        let applied = data
            .items
            .iter()
            .filter(|item| item.status == "applied")
            .count();
        if data.applied_count != applied {
            return Err("incorrect_applied_count".into());
        }
        if ["completed", "saved"].contains(&data.state.as_str())
            && (applied != 20 || !data.current_world_matches || data.conflict)
        {
            return Err("scene_completion_not_verified".into());
        }
        if ["not_started", "prepared"].contains(&data.state.as_str())
            && data.items.iter().any(|item| item.status != "not_started")
        {
            return Err("invalid_scene_preparation_state".into());
        }
        if data.state == "prepared"
            && (!data.current_world_matches || data.saved || data.disk_exists || data.conflict)
        {
            return Err("invalid_scene_preparation_state".into());
        }
        if (data.saved && (data.state != "saved" || !data.disk_exists || data.package_dirty))
            || (data.state == "saved" && !data.saved)
            || (data.state == "conflicted" && !data.conflict)
            || (data.conflict && !["conflicted", "failed"].contains(&data.state.as_str()))
        {
            return Err("inconsistent_scene_result_state".into());
        }
        if tool == TOOLS[5] && data.state != "saved" {
            return Err("scene_save_not_verified".into());
        }
        Ok(())
    }
}
/// Explicit per-purpose host grants. Absence of save means no disk write was approved.
pub struct SceneHostPermits {
    pub prepare: String,
    pub execute: String,
    pub cancel: String,
    pub resume: String,
    pub save: Option<String>,
}
struct QueryCheckpoint {
    token: String,
    resumable: bool,
    saveable: bool,
}
pub struct SceneHostAuthorization {
    scope: SceneHostScope,
    permits: [Option<String>; 5],
    consumed: [bool; 5],
    revoked: bool,
    prepared_observed: bool,
    query_pending: bool,
    checkpoint: Option<QueryCheckpoint>,
    seen_query_tokens: HashSet<String>,
}
impl SceneHostAuthorization {
    pub fn new_for_verified_owned_editor(
        scope: SceneHostScope,
        permits: SceneHostPermits,
    ) -> Result<Self, String> {
        let permits = [
            Some(permits.prepare),
            Some(permits.execute),
            Some(permits.cancel),
            Some(permits.resume),
            permits.save,
        ];
        let mut seen = HashSet::new();
        if permits
            .iter()
            .flatten()
            .any(|s| !guid(s) || !seen.insert(s.clone()))
        {
            return Err("distinct_scene_host_permits_required".into());
        }
        Ok(Self {
            scope,
            permits,
            consumed: [false; 5],
            revoked: false,
            prepared_observed: false,
            query_pending: false,
            checkpoint: None,
            seen_query_tokens: HashSet::new(),
        })
    }
    pub fn revoke(&mut self) {
        self.revoked = true;
        self.checkpoint = None;
        self.query_pending = false;
    }
    fn active(&mut self, host_session_id: &str) -> Result<(), String> {
        if self.revoked {
            return Err("scene_scope_revoked".into());
        }
        if self.scope.host_session_id != host_session_id {
            self.revoke();
            return Err("scene_current_host_session_changed".into());
        }
        Ok(())
    }
    /// TRUSTED TRANSPORT ONLY: inspect the actual response received from this scope's live owned editor.
    /// Serialization must not expose this method as an approval endpoint. A result never mints a permit.
    pub fn observe_owned_editor_result(
        &mut self,
        active_host_session_id: &str,
        tool: &str,
        value: &Value,
    ) -> Result<SceneBatchData, String> {
        self.active(active_host_session_id)?;
        if tool == TOOLS[3] {
            return self.bind_owned_editor_query(active_host_session_id, value);
        }
        let index = mutation_index(tool).ok_or("scene_tool_not_allowed")?;
        if !self.consumed[index] {
            return Err("scene_result_without_host_send".into());
        }
        let data = self.scope.verify_result(tool, value)?;
        if tool == TOOLS[0] {
            self.prepared_observed = data.state == "prepared";
        }
        Ok(data)
    }
    /// Bind only a fresh serialized query response from the owned transport, after ALL item checks.
    /// Invalid, absent, unknown, failed, conflicted or non-resumable tokens cannot authorize resume.
    /// A failed bind clears the old checkpoint. Queries themselves remain repeatable and permit-free.
    pub fn bind_owned_editor_query(
        &mut self,
        active_host_session_id: &str,
        value: &Value,
    ) -> Result<SceneBatchData, String> {
        self.active(active_host_session_id)?;
        self.checkpoint = None;
        if !self.query_pending {
            return Err("owned_editor_query_send_required".into());
        }
        self.query_pending = false;
        let data = self.scope.verify_result(TOOLS[3], value)?;
        if let Some(token) = &data.query_token {
            if !self.seen_query_tokens.insert(token.clone()) {
                return Err("scene_query_token_replayed".into());
            }
            let safe = data.current_world_matches
                && !data.conflict
                && !data.saved
                && !data.disk_exists
                && data
                    .items
                    .iter()
                    .all(|item| ["applied", "not_started"].contains(&item.status.as_str()));
            let resumable = safe
                && ["cancelled", "paused_for_test_cancel"].contains(&data.state.as_str())
                && data.items.iter().any(|item| item.status == "not_started");
            let saveable = safe
                && data.state == "completed"
                && data.items.iter().all(|item| item.status == "applied");
            if resumable || saveable {
                self.checkpoint = Some(QueryCheckpoint {
                    token: token.clone(),
                    resumable,
                    saveable,
                });
            }
        }
        Ok(data)
    }
    /// Consumes the purpose-specific permit BEFORE transport. An uncertain outcome must be queried;
    /// never replay a mutation. active_host_session_id is read from the live host lease, never JSON.
    pub fn authorize(
        &mut self,
        active_host_session_id: &str,
        input: &Value,
    ) -> Result<Value, String> {
        self.active(active_host_session_id)?;
        let call = input.as_object().ok_or("scene_call_required")?;
        if call.len() != 2 {
            return Err("unknown_scene_call_field".into());
        }
        let mut name = call
            .get("name")
            .and_then(Value::as_str)
            .ok_or("scene_name_required")?;
        let mut args = call
            .get("arguments")
            .and_then(Value::as_object)
            .ok_or("scene_arguments_required")?;
        if name == "call_tool" {
            if args.len() != 2 {
                return Err("exact_scene_wrapper_required".into());
            }
            name = args
                .get("tool_name")
                .and_then(Value::as_str)
                .ok_or("scene_inner_name_required")?;
            args = args
                .get("arguments")
                .and_then(Value::as_object)
                .ok_or("scene_inner_arguments_required")?;
        }
        if !TOOLS.contains(&name) {
            return Err("scene_tool_not_allowed".into());
        }
        let token_required = [TOOLS[4], TOOLS[5]].contains(&name);
        let allowed = [
            "protocolVersion",
            "contractVersion",
            "expectedProjectKey",
            "expectedInstanceId",
            "expectedRootObjectId",
            "runId",
            "plan",
            "queryToken",
        ];
        if args.keys().any(|key| !allowed.contains(&key.as_str())) {
            return Err("model_host_permit_or_unknown_scene_argument_rejected".into());
        }
        if args.len() != if token_required { 8 } else { 7 }
            || (!token_required && args.contains_key("queryToken"))
            || args.get("protocolVersion") != Some(&json!(2))
            || args.get("contractVersion").and_then(Value::as_str) != Some(CONTRACT)
            || args.get("expectedProjectKey").and_then(Value::as_str)
                != Some(self.scope.project_key.as_str())
            || args.get("expectedInstanceId").and_then(Value::as_str)
                != Some(self.scope.instance_id.as_str())
            || args.get("expectedRootObjectId").and_then(Value::as_str)
                != Some(self.scope.root_object_id.as_str())
            || args.get("runId").and_then(Value::as_str) != Some(self.scope.run_id.as_str())
        {
            return Err("stale_scene_scope_or_contract".into());
        }
        let plan: SceneBatchPlan =
            serde_json::from_value(args.get("plan").ok_or("scene_plan_required")?.clone())
                .map_err(|_| "invalid_scene_plan_schema")?;
        plan.validate()?;
        if plan != self.scope.plan {
            return Err("scene_plan_differs_from_exact_host_approval".into());
        }
        if name == TOOLS[3] {
            self.checkpoint = None;
            self.query_pending = true;
            return Ok(json!({"name":name,"arguments":args}));
        }
        let index = mutation_index(name).ok_or("scene_tool_not_allowed")?;
        if token_required {
            let supplied = args
                .get("queryToken")
                .and_then(Value::as_str)
                .filter(|token| guid(token));
            let checkpoint = self
                .checkpoint
                .as_ref()
                .ok_or("owned_editor_query_checkpoint_required")?;
            if supplied != Some(checkpoint.token.as_str())
                || (name == TOOLS[4] && !checkpoint.resumable)
                || (name == TOOLS[5] && !checkpoint.saveable)
            {
                return Err("owned_editor_query_checkpoint_required".into());
            }
        }
        if name == TOOLS[1] && !self.prepared_observed {
            return Err("owned_editor_preparation_observation_required".into());
        }
        if self.consumed[index] {
            return Err("one_use_scene_permit_consumed_query_before_retry".into());
        }
        let permit = self.permits[index]
            .as_ref()
            .ok_or("explicit_scene_purpose_approval_required")?
            .clone();
        let mut actual = args.clone();
        self.consumed[index] = true; // Burn before handing the call to the transport.
        self.checkpoint = None;
        self.query_pending = false;
        actual.insert("hostPermit".into(), json!(permit));
        Ok(json!({"name":name,"arguments":actual}))
    }
}
fn mutation_index(tool: &str) -> Option<usize> {
    [TOOLS[0], TOOLS[1], TOOLS[2], TOOLS[4], TOOLS[5]]
        .iter()
        .position(|name| *name == tool)
}

#[cfg(test)]
mod tests {
    use super::*;
    const SESSION: &str = "00000000-0000-4000-8000-000000000004";
    fn id(n: usize) -> String {
        format!("00000000-0000-4000-8000-{n:012x}")
    }
    fn plan() -> SceneBatchPlan {
        serde_json::from_value(json!({"operationId":id(1),"targetMap":format!("{ROOT}/L_CurrentRun"),"expectedDiskState":"absent","items":(0..20).map(|n| json!({"itemId":format!("item_{n}"),"objectName":format!("UA14_Object_{n}"),"mesh":MESHES[n%3],"material":MATERIAL,"transform":{"location":{"x":n*100,"y":0,"z":0},"rotation":{"pitch":0,"yaw":0,"roll":0},"scale":{"x":1,"y":1,"z":1}}})).collect::<Vec<_>>()})).unwrap()
    }
    fn host(save: bool) -> SceneHostAuthorization {
        let scope = SceneHostScope::from_verified_owned_editor(
            "lab-project".into(),
            id(2),
            "volume:file".into(),
            id(3),
            SESSION.into(),
            plan(),
        )
        .unwrap();
        SceneHostAuthorization::new_for_verified_owned_editor(
            scope,
            SceneHostPermits {
                prepare: id(10),
                execute: id(11),
                cancel: id(12),
                resume: id(13),
                save: save.then(|| id(14)),
            },
        )
        .unwrap()
    }
    fn call(tool: &str, token: Option<Value>) -> Value {
        let mut c = json!({"name":tool,"arguments":{"protocolVersion":2,"contractVersion":CONTRACT,"expectedProjectKey":"lab-project","expectedInstanceId":id(2),"expectedRootObjectId":"volume:file","runId":id(3),"plan":plan()}});
        if let Some(t) = token {
            c["arguments"]["queryToken"] = t;
        }
        c
    }
    fn receipt(tool: &str, state: &str, applied: usize, token: Option<&str>) -> Value {
        let p = plan();
        let items: Vec<Value> = p.items.iter().enumerate().map(|(n,item)| {
            if n < applied { json!({"itemId":item.item_id,"objectName":item.object_name,"status":"applied","reason":"","owned":true,"actorGuid":id(100+n),"objectPath":format!("{}.L_CurrentRun:PersistentLevel.{}",p.target_map,item.object_name),"mesh":item.mesh,"material":item.material,"transform":item.transform}) }
            else { json!({"itemId":item.item_id,"objectName":item.object_name,"status":"not_started","reason":"","owned":false,"actorGuid":"","objectPath":"","mesh":"","material":""}) }
        }).collect();
        let mut result = json!({"schemaVersion":"uagent.scene.result.v2","contractVersion":CONTRACT,"projectKey":"lab-project","instanceId":id(2),"rootObjectId":"volume:file","runId":id(3),"operation":tool,"plan":p,"planHash":"a".repeat(64),"data":{"state":state,"targetMap":p.target_map,"currentWorldMatches":true,"packageDirty":true,"saved":false,"diskExists":false,"diskHash":"","conflict":false,"conflictReason":"","cancelIsRollback":false,"appliedCount":applied,"items":items}});
        if let Some(t) = token {
            result["data"]["queryToken"] = json!(t);
        }
        result
    }
    fn prepare(h: &mut SceneHostAuthorization) {
        h.authorize(SESSION, &call(TOOLS[0], None)).unwrap();
        h.observe_owned_editor_result(SESSION, TOOLS[0], &receipt(TOOLS[0], "prepared", 0, None))
            .unwrap();
    }
    fn bind(h: &mut SceneHostAuthorization, result: &Value) -> Result<SceneBatchData, String> {
        h.authorize(SESSION, &call(TOOLS[3], None))?;
        h.bind_owned_editor_query(SESSION, result)
    }
    #[test]
    fn exact20_closed_plan_rejects_bounds_scope_resources_and_duplicates() {
        plan().validate().unwrap();
        for bad in [
            format!("{ROOT}/Sub/L_Map"),
            format!("{ROOT}/../L_Map"),
            format!("{ROOT}/L_Map.L_Map"),
            "/Game/User/L_Map".into(),
            format!("{ROOT}/L_{}", "a".repeat(79)),
        ] {
            let mut p = plan();
            p.target_map = bad;
            assert!(p.validate().is_err());
        }
        let mut p = plan();
        p.items.pop();
        assert!(p.validate().is_err());
        let mut p = plan();
        p.items[1].item_id = p.items[0].item_id.clone();
        assert!(p.validate().is_err());
        let mut p = plan();
        p.items[1].object_name = "UA14_object_0".into();
        assert!(p.validate().is_err());
        for value in [f64::NAN, f64::INFINITY, -10000.001, 10000.001] {
            let mut p = plan();
            p.items[0].transform.location.x = value;
            assert!(p.validate().is_err());
        }
        let mut p = plan();
        p.items[0].transform.scale.x = 0.0;
        assert!(p.validate().is_err());
        let mut p = plan();
        p.items[0].transform.rotation.yaw = 180.001;
        assert!(p.validate().is_err());
        let mut p = plan();
        p.items[0].mesh = "/Game/User/Mesh.Mesh".into();
        assert!(p.validate().is_err());
        let mut p = serde_json::to_value(plan()).unwrap();
        p["items"][0]["transform"]["location"]["w"] = json!(0);
        assert!(serde_json::from_value::<SceneBatchPlan>(p).is_err());
    }
    #[test]
    fn mutation_permits_burn_before_transport_and_query_is_repeatable_without_grants() {
        let mut h = host(true);
        prepare(&mut h);
        assert!(h.authorize(SESSION, &call(TOOLS[0], None)).is_err());
        assert!(
            h.authorize(SESSION, &call(TOOLS[1], None)).unwrap()["arguments"]["hostPermit"]
                .is_string()
        );
        assert!(h.authorize(SESSION, &call(TOOLS[1], None)).is_err());
        h.authorize(SESSION, &call(TOOLS[2], None)).unwrap();
        assert!(h.authorize(SESSION, &call(TOOLS[2], None)).is_err());
        let token = id(20);
        bind(&mut h, &receipt(TOOLS[3], "cancelled", 7, Some(&token))).unwrap();
        let resumed = h
            .authorize(SESSION, &call(TOOLS[4], Some(json!(token))))
            .unwrap();
        assert!(resumed["arguments"]["hostPermit"].is_string());
        assert!(h
            .authorize(SESSION, &call(TOOLS[4], Some(json!(token))))
            .is_err());
        let token = id(21);
        bind(&mut h, &receipt(TOOLS[3], "completed", 20, Some(&token))).unwrap();
        h.authorize(SESSION, &call(TOOLS[5], Some(json!(token))))
            .unwrap();
        assert!(h
            .authorize(SESSION, &call(TOOLS[5], Some(json!(token))))
            .is_err());
        for _ in 0..3 {
            assert!(
                h.authorize(SESSION, &call(TOOLS[3], None)).unwrap()["arguments"]
                    .get("hostPermit")
                    .is_none()
            );
        }
    }
    #[test]
    fn null_unbound_mismatched_tokens_never_consume_resume_or_save_permit() {
        for tool in [TOOLS[4], TOOLS[5]] {
            let mut h = host(true);
            for token in [
                None,
                Some(Value::Null),
                Some(json!(false)),
                Some(json!(0)),
                Some(json!("")),
                Some(json!(id(20))),
            ] {
                assert!(h.authorize(SESSION, &call(tool, token)).is_err());
                assert!(!h.consumed[mutation_index(tool).unwrap()]);
            }
            let token = id(20);
            let complete = tool == TOOLS[5];
            bind(
                &mut h,
                &receipt(
                    TOOLS[3],
                    if complete { "completed" } else { "cancelled" },
                    if complete { 20 } else { 7 },
                    Some(&token),
                ),
            )
            .unwrap();
            for bad in [Value::Null, json!(0), json!(""), json!(id(21))] {
                assert!(h.authorize(SESSION, &call(tool, Some(bad))).is_err());
                assert!(!h.consumed[mutation_index(tool).unwrap()]);
            }
            h.authorize(SESSION, &call(tool, Some(json!(token))))
                .unwrap();
            assert!(h.consumed[mutation_index(tool).unwrap()]);
        }
    }
    #[test]
    fn model_cannot_inject_host_authority_test_control_scope_or_plan_changes() {
        for (field, value) in [
            ("hostPermit", json!(id(10))),
            ("testPauseAfter", json!(7)),
            ("approved", json!(true)),
            ("queryToken", json!(id(20))),
        ] {
            let mut c = call(TOOLS[0], None);
            c["arguments"][field] = value;
            assert!(host(true).authorize(SESSION, &c).is_err());
        }
        for field in [
            "expectedProjectKey",
            "expectedInstanceId",
            "expectedRootObjectId",
            "runId",
            "contractVersion",
        ] {
            let mut c = call(TOOLS[0], None);
            c["arguments"][field] = json!(id(99));
            assert!(host(true).authorize(SESSION, &c).is_err());
        }
        let mut c = call(TOOLS[0], None);
        c["arguments"]["plan"]["items"][0]["transform"]["location"]["x"] = json!(1);
        assert!(host(true).authorize(SESSION, &c).is_err());
        let c = call(TOOLS[3], None);
        let wrapper = json!({"name":"call_tool","arguments":{"tool_name":TOOLS[3],"arguments":c["arguments"]}});
        assert!(host(true).authorize(SESSION, &wrapper).is_ok());
        let mut bad = wrapper;
        bad["arguments"]["tool_name"] = json!("ue.asset.save");
        assert!(host(true).authorize(SESSION, &bad).is_err());
    }
    #[test]
    fn changed_current_session_revokes_all_old_authority_even_if_model_replays_original_run() {
        let mut h = host(true);
        let other = id(99);
        assert!(h.authorize(&other, &call(TOOLS[3], None)).is_err());
        assert!(h.authorize(SESSION, &call(TOOLS[0], None)).is_err());
        let mut h = host(true);
        h.revoke();
        assert!(h.authorize(SESSION, &call(TOOLS[3], None)).is_err());
    }
    #[test]
    fn query_must_come_from_a_host_sent_owned_transport_response_and_never_raw_token() {
        let mut h = host(true);
        let token = id(20);
        let result = receipt(TOOLS[3], "cancelled", 7, Some(&token));
        assert!(h.bind_owned_editor_query(SESSION, &result).is_err());
        assert!(h.checkpoint.is_none());
        bind(&mut h, &result).unwrap();
        assert!(h.checkpoint.is_some());
        assert!(bind(&mut h, &result).is_err());
        assert!(h.checkpoint.is_none());
    }
    #[test]
    fn any_unknown_failed_conflict_world_mismatch_or_missing_token_blocks_resume() {
        for mode in [
            "unknown",
            "failed",
            "conflict",
            "world",
            "no_token",
            "null_token",
        ] {
            let mut h = host(true);
            let token = id(20);
            let mut r = receipt(TOOLS[3], "cancelled", 7, Some(&token));
            match mode {
                "unknown" | "failed" => r["data"]["items"][7]["status"] = json!(mode),
                "conflict" => {
                    r["data"]["state"] = json!("conflicted");
                    r["data"]["conflict"] = json!(true);
                    r["data"]["conflictReason"] = json!("changed");
                }
                "world" => r["data"]["currentWorldMatches"] = json!(false),
                "no_token" => {
                    r["data"].as_object_mut().unwrap().remove("queryToken");
                }
                "null_token" => r["data"]["queryToken"] = Value::Null,
                _ => unreachable!(),
            }
            let _ = bind(&mut h, &r);
            assert!(h
                .authorize(SESSION, &call(TOOLS[4], Some(json!(token))))
                .is_err());
            assert!(!h.consumed[3]);
        }
    }
    #[test]
    fn count_only_or_changed_item_identity_resources_and_transform_cannot_bind_a_checkpoint() {
        for mode in [
            "count",
            "guid",
            "path",
            "mesh",
            "material",
            "transform",
            "owned",
            "plan",
            "run",
            "extra",
            "unapplied_transform",
        ] {
            let mut h = host(true);
            let token = id(20);
            let mut r = receipt(TOOLS[3], "cancelled", 7, Some(&token));
            match mode {
                "count" => r["data"]["appliedCount"] = json!(20),
                "guid" => {
                    r["data"]["items"][0]["actorGuid"] = r["data"]["items"][1]["actorGuid"].clone()
                }
                "path" => r["data"]["items"][0]["objectPath"] = json!("/Game/User.Actor"),
                "mesh" => r["data"]["items"][0]["mesh"] = json!(MESHES[1]),
                "material" => r["data"]["items"][0]["material"] = json!(""),
                "transform" => r["data"]["items"][0]["transform"]["location"]["x"] = json!(0.002),
                "owned" => r["data"]["items"][0]["owned"] = json!(false),
                "plan" => r["plan"]["items"][0]["transform"]["location"]["x"] = json!(1),
                "run" => r["runId"] = json!(id(99)),
                "extra" => r["data"]["extension"] = json!(true),
                "unapplied_transform" => {
                    r["data"]["items"][7]["transform"] = json!(plan().items[7].transform)
                }
                _ => unreachable!(),
            }
            assert!(bind(&mut h, &r).is_err(), "{mode}");
            assert!(h.checkpoint.is_none());
        }
    }
    #[test]
    fn save_needs_explicit_purpose_grant_and_a_complete_query_for_this_new_map() {
        let token = id(20);
        let mut h = host(false);
        bind(&mut h, &receipt(TOOLS[3], "completed", 20, Some(&token))).unwrap();
        assert!(h
            .authorize(SESSION, &call(TOOLS[5], Some(json!(token))))
            .is_err());
        assert!(!h.consumed[4]);
        let mut h = host(true);
        bind(&mut h, &receipt(TOOLS[3], "cancelled", 7, Some(&token))).unwrap();
        assert!(h
            .authorize(SESSION, &call(TOOLS[5], Some(json!(token))))
            .is_err());
        assert!(!h.consumed[4]);
        let token = id(21);
        bind(&mut h, &receipt(TOOLS[3], "completed", 20, Some(&token))).unwrap();
        h.authorize(SESSION, &call(TOOLS[5], Some(json!(token))))
            .unwrap();
        let mut saved = receipt(TOOLS[5], "saved", 20, None);
        saved["data"]["saved"] = json!(true);
        saved["data"]["diskExists"] = json!(true);
        saved["data"]["diskHash"] = json!("b".repeat(64));
        saved["data"]["packageDirty"] = json!(false);
        h.observe_owned_editor_result(SESSION, TOOLS[5], &saved)
            .unwrap();
        saved["data"]["packageDirty"] = json!(true);
        assert!(h
            .observe_owned_editor_result(SESSION, TOOLS[5], &saved)
            .is_err());
    }
    #[test]
    fn querying_or_mutating_invalidates_previous_checkpoint_before_a_transport_outcome() {
        let token = id(20);
        let mut h = host(true);
        bind(&mut h, &receipt(TOOLS[3], "cancelled", 7, Some(&token))).unwrap();
        h.authorize(SESSION, &call(TOOLS[3], None)).unwrap();
        assert!(h
            .authorize(SESSION, &call(TOOLS[4], Some(json!(token))))
            .is_err());
        assert!(!h.consumed[3]);
        let mut h = host(true);
        bind(&mut h, &receipt(TOOLS[3], "cancelled", 7, Some(&token))).unwrap();
        h.authorize(SESSION, &call(TOOLS[2], None)).unwrap();
        assert!(h
            .authorize(SESSION, &call(TOOLS[4], Some(json!(token))))
            .is_err());
    }
    #[test]
    fn execution_requires_actual_owned_editor_preparation_observation() {
        let mut h = host(true);
        assert!(h.authorize(SESSION, &call(TOOLS[1], None)).is_err());
        assert!(!h.consumed[1]);
        h.authorize(SESSION, &call(TOOLS[0], None)).unwrap();
        assert!(h.authorize(SESSION, &call(TOOLS[1], None)).is_err());
        h.observe_owned_editor_result(SESSION, TOOLS[0], &receipt(TOOLS[0], "prepared", 0, None))
            .unwrap();
        h.authorize(SESSION, &call(TOOLS[1], None)).unwrap();
    }
    fn rotation_receipt(approved: [f64; 3], observed: [f64; 3]) -> (SceneHostScope, Value) {
        let mut p = plan();
        p.items[0].transform.rotation = SceneRotation {
            pitch: approved[0],
            yaw: approved[1],
            roll: approved[2],
        };
        let scope = SceneHostScope::from_verified_owned_editor(
            "lab-project".into(),
            id(2),
            "volume:file".into(),
            id(3),
            SESSION.into(),
            p.clone(),
        )
        .unwrap();
        let mut result = receipt(TOOLS[3], "cancelled", 7, None);
        result["plan"] = json!(p);
        result["data"]["items"][0]["transform"]["rotation"] =
            json!({ "pitch": observed[0], "yaw": observed[1], "roll": observed[2] });
        (scope, result)
    }
    #[test]
    fn quaternion_receipts_accept_ue_normalization_and_reject_real_pose_changes() {
        // Same 23 vectors as the TS receipt tests, including the review repro and singularities.
        let cases = [
            (
                "review repro pitch beyond +90",
                [120.0, 0.0, 0.0],
                [60.0, 180.0, 180.0],
                true,
            ),
            (
                "pitch beyond -90",
                [-120.0, 0.0, 0.0],
                [-60.0, 180.0, 180.0],
                true,
            ),
            (
                "mixed axes beyond +90",
                [100.0, 25.0, -40.0],
                [80.0, -155.0, 140.0],
                true,
            ),
            (
                "mixed axes beyond -90",
                [-100.0, 25.0, -40.0],
                [-80.0, -155.0, 140.0],
                true,
            ),
            (
                "across +90",
                [89.999, 30.0, 10.0],
                [90.001, -150.0, -170.0],
                true,
            ),
            (
                "across -90",
                [-89.999, 30.0, 10.0],
                [-90.001, -150.0, -170.0],
                true,
            ),
            (
                "+90 singularity preserves yaw minus roll",
                [90.0, 30.0, 10.0],
                [90.0, 60.0, 40.0],
                true,
            ),
            (
                "-90 singularity preserves yaw plus roll",
                [-90.0, 30.0, 10.0],
                [-90.0, 60.0, -20.0],
                true,
            ),
            (
                "yaw +/-180 double cover",
                [0.0, 180.0, 0.0],
                [0.0, -180.0, 0.0],
                true,
            ),
            (
                "roll +/-180 double cover",
                [0.0, 0.0, 180.0],
                [0.0, 0.0, -180.0],
                true,
            ),
            (
                "pitch 180 with mixed axes",
                [180.0, 45.0, -20.0],
                [0.0, -135.0, 160.0],
                true,
            ),
            (
                "inside whole-pose tolerance",
                [0.0, 0.0, 0.0],
                [0.0, 0.0009, 0.0],
                true,
            ),
            (
                "inside tolerance after Euler normalization",
                [120.0, 0.0, 0.0],
                [60.0, 179.9991, 180.0],
                true,
            ),
            (
                "inside tolerance at singularity",
                [90.0, 30.0, 10.0],
                [90.0, 30.0009, 10.0],
                true,
            ),
            (
                "combined axes below angular tolerance",
                [0.0, 0.0, 0.0],
                [0.0005, 0.0005, 0.0005],
                true,
            ),
            (
                "combined axes exceed whole-pose tolerance",
                [0.0, 0.0, 0.0],
                [0.0007, 0.0007, 0.0007],
                false,
            ),
            (
                "real pitch difference",
                [120.0, 0.0, 0.0],
                [60.0, 0.0, 0.0],
                false,
            ),
            (
                "+90 singularity changed pose",
                [90.0, 30.0, 10.0],
                [90.0, 60.0, 10.0],
                false,
            ),
            (
                "-90 singularity changed pose",
                [-90.0, 30.0, 10.0],
                [-90.0, 60.0, 10.0],
                false,
            ),
            (
                "real difference across +90",
                [89.999, 30.0, 10.0],
                [90.001, 30.0, 10.0],
                false,
            ),
            (
                "outside angular tolerance",
                [0.0, 0.0, 0.0],
                [0.0, 0.0, 0.0011],
                false,
            ),
            (
                "opposite orientation",
                [180.0, 0.0, 0.0],
                [0.0, 0.0, 0.0],
                false,
            ),
            (
                "different half-turn axes",
                [0.0, 180.0, 0.0],
                [0.0, 0.0, 180.0],
                false,
            ),
        ];
        for (name, approved, observed, accepted) in cases {
            let (scope, result) = rotation_receipt(approved, observed);
            assert_eq!(
                scope.verify_result(TOOLS[3], &result).is_ok(),
                accepted,
                "{name}"
            );
        }
    }
    #[test]
    fn orientation_equivalence_never_changes_exact_plan_approval_values() {
        let (scope, mut result) = rotation_receipt([120.0, 0.0, 0.0], [60.0, 180.0, 180.0]);
        scope.verify_result(TOOLS[3], &result).unwrap();
        result["plan"]["items"][0]["transform"]["rotation"] =
            json!({"pitch":60,"yaw":180,"roll":180});
        assert_eq!(
            scope.verify_result(TOOLS[3], &result).unwrap_err(),
            "scene_result_binding_mismatch"
        );
    }
}
