//! Isolated-Lab pickup capability policy. Scope/permits come only from the verified native host.
//! Model arguments never mint approval. No IPC endpoint, network action or production grant is installed.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
pub const CONTRACT: &str = "2.1.0-pickup-create-only";
pub const PARENT: &str = "/Script/UAgentPickupRuntimeV2.UAgentPickupActorV2";
pub const ROOT: &str = "/Game/UAgentBuildLab/Pickup_T13";
const TOOLS: [&str; 4] = [
    "uagent.v2.pickup.prepare",
    "uagent.v2.pickup.preview",
    "uagent.v2.pickup.apply",
    "uagent.v2.pickup.query",
];
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PickupTemplatePlan {
    pub operation_id: String,
    pub target_package: String,
    pub expected_disk_state: String,
    pub template_id: String,
    pub parent_class: String,
    pub item_id: String,
    pub prompt_text: String,
    pub interaction_radius_cm: u32,
    pub interaction_key: String,
}
fn guid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
            }
        })
}
fn word(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_')
}
impl PickupTemplatePlan {
    pub fn validate(&self) -> Result<(), String> {
        let name = self
            .target_package
            .strip_prefix(&format!("{ROOT}/"))
            .ok_or("target_outside_fixed_lab_scope")?;
        if !name.starts_with("BP_")
            || !word(name, 80)
            || !guid(&self.operation_id)
            || self.expected_disk_state != "absent"
            || self.template_id != "actor.pickup.native.v1"
            || self.parent_class != PARENT
            || !word(&self.item_id, 64)
            || self.prompt_text.is_empty()
            || self.prompt_text.encode_utf16().count() > 128
            || self.prompt_text.chars().any(char::is_control)
            || !(50..=1000).contains(&self.interaction_radius_cm)
            || !["E", "F"].contains(&self.interaction_key.as_str())
        {
            return Err("invalid_fixed_pickup_plan".into());
        }
        Ok(())
    }
}
#[derive(Debug)]
pub struct PickupHostScope {
    project_key: String,
    instance_id: String,
    root_object_id: String,
    plan: PickupTemplatePlan,
}
impl PickupHostScope {
    /// The caller must hold the actual Lab root object/owned editor lease and explicit exact-plan approval.
    /// Never construct this from model input or from a peer's self-asserted identity.
    pub fn from_verified_lab_host(
        project_key: String,
        instance_id: String,
        root_object_id: String,
        plan: PickupTemplatePlan,
    ) -> Result<Self, String> {
        plan.validate()?;
        if project_key.is_empty() || instance_id.is_empty() || root_object_id.is_empty() {
            return Err("verified_host_identity_required".into());
        }
        Ok(Self {
            project_key,
            instance_id,
            root_object_id,
            plan,
        })
    }
}
pub struct PickupHostAuthorization {
    scope: PickupHostScope,
    permits: [String; 3],
    consumed: [bool; 3],
    revoked: bool,
    preview: Option<String>,
}
impl PickupHostAuthorization {
    /// Host-owned one-use permits must match the separately scoped editor launch approval.
    pub fn new_for_verified_lab_host(
        scope: PickupHostScope,
        permits: [String; 3],
    ) -> Result<Self, String> {
        if !permits.iter().all(|s| guid(s))
            || permits[0] == permits[1]
            || permits[0] == permits[2]
            || permits[1] == permits[2]
        {
            return Err("distinct_host_permits_required".into());
        }
        Ok(Self {
            scope,
            permits,
            consumed: [false; 3],
            revoked: false,
            preview: None,
        })
    }
    pub fn revoke(&mut self) {
        self.revoked = true;
    }
    /// Called only on a validated response from this scope's owned editor; this token is a precondition, not approval.
    pub fn bind_reviewed_preview(&mut self, token: String) -> Result<(), String> {
        if !guid(&token) || self.revoked || !self.consumed[1] {
            return Err("reviewed_preview_required".into());
        }
        self.preview = Some(token);
        Ok(())
    }
    /// Consumes a mutation permit BEFORE sending. Uncertain transport outcomes require query, never retry.
    pub fn authorize(&mut self, input: &Value) -> Result<Value, String> {
        if self.revoked {
            return Err("pickup_scope_revoked".into());
        }
        let call = input.as_object().ok_or("call_required")?;
        if call.len() != 2 {
            return Err("unknown_call_field".into());
        }
        let mut name = call
            .get("name")
            .and_then(Value::as_str)
            .ok_or("name_required")?;
        let mut args = call
            .get("arguments")
            .and_then(Value::as_object)
            .ok_or("arguments_required")?;
        if name == "call_tool" {
            if args.len() != 2 {
                return Err("exact_wrapper_required".into());
            }
            name = args
                .get("tool_name")
                .and_then(Value::as_str)
                .ok_or("inner_name_required")?;
            args = args
                .get("arguments")
                .and_then(Value::as_object)
                .ok_or("inner_arguments_required")?;
        }
        let index = TOOLS
            .iter()
            .position(|n| *n == name)
            .ok_or("pickup_tool_not_allowed")?;
        let allowed = [
            "protocolVersion",
            "contractVersion",
            "expectedProjectKey",
            "expectedInstanceId",
            "expectedRootObjectId",
            "plan",
            "previewToken",
        ];
        if args.keys().any(|k| !allowed.contains(&k.as_str())) {
            return Err("model_host_permit_or_unknown_argument_rejected".into());
        }
        if args.len() != if index == 2 { 7 } else { 6 }
            || args.get("protocolVersion") != Some(&json!(2))
            || args.get("contractVersion").and_then(Value::as_str) != Some(CONTRACT)
            || args.get("expectedProjectKey").and_then(Value::as_str)
                != Some(self.scope.project_key.as_str())
            || args.get("expectedInstanceId").and_then(Value::as_str)
                != Some(self.scope.instance_id.as_str())
            || args.get("expectedRootObjectId").and_then(Value::as_str)
                != Some(self.scope.root_object_id.as_str())
        {
            return Err("stale_scope_or_contract".into());
        }
        let plan: PickupTemplatePlan =
            serde_json::from_value(args.get("plan").ok_or("plan_required")?.clone())
                .map_err(|_| "invalid_plan_schema")?;
        plan.validate()?;
        if plan != self.scope.plan {
            return Err("plan_differs_from_exact_host_approval".into());
        }
        if index == 2
            && (self.preview.is_none()
                || args
                    .get("previewToken")
                    .and_then(Value::as_str)
                    .filter(|token| guid(token))
                    != self.preview.as_deref())
        {
            return Err("reviewed_preview_required".into());
        }
        let mut actual = args.clone();
        if index < 3 {
            if self.consumed[index] {
                return Err("one_use_permit_consumed_query_before_retry".into());
            }
            self.consumed[index] = true;
            actual.insert("hostPermit".into(), json!(self.permits[index]));
        }
        Ok(json!({"name":name,"arguments":actual}))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn plan() -> PickupTemplatePlan {
        serde_json::from_value(json!({"operationId":"11111111-1111-4111-8111-111111111111","targetPackage":format!("{ROOT}/BP_Pickup"),"expectedDiskState":"absent","templateId":"actor.pickup.native.v1","parentClass":PARENT,"itemId":"Health","promptText":"Press E to collect","interactionRadiusCm":200,"interactionKey":"E"})).unwrap()
    }
    fn host() -> PickupHostAuthorization {
        PickupHostAuthorization::new_for_verified_lab_host(
            PickupHostScope::from_verified_lab_host(
                "project".into(),
                "instance".into(),
                "volume:file".into(),
                plan(),
            )
            .unwrap(),
            [
                "22222222-2222-4222-8222-222222222222".into(),
                "33333333-3333-4333-8333-333333333333".into(),
                "44444444-4444-4444-8444-444444444444".into(),
            ],
        )
        .unwrap()
    }
    fn call(index: usize) -> Value {
        json!({"name":TOOLS[index],"arguments":{"protocolVersion":2,"contractVersion":CONTRACT,"expectedProjectKey":"project","expectedInstanceId":"instance","expectedRootObjectId":"volume:file","plan":plan()}})
    }
    #[test]
    fn exact_plan_and_separate_one_use_effect_permissions() {
        let mut h = host();
        assert!(h.authorize(&call(0)).unwrap()["arguments"]["hostPermit"].is_string());
        assert!(h.authorize(&call(0)).is_err());
        assert!(h.authorize(&call(1)).is_ok());
        h.bind_reviewed_preview("55555555-5555-4555-8555-555555555555".into())
            .unwrap();
        let mut a = call(2);
        a["arguments"]["previewToken"] = json!("55555555-5555-4555-8555-555555555555");
        assert!(h.authorize(&a).is_ok());
        assert!(h.authorize(&a).is_err());
        assert!(h.authorize(&call(3)).is_ok());
        assert!(h.authorize(&call(3)).is_ok());
    }
    #[test]
    fn rejects_forged_grants_and_changed_parameters() {
        for (key, value) in [("hostPermit", json!("anything")), ("execute", json!(true))] {
            let mut c = call(0);
            c["arguments"][key] = value;
            assert!(host().authorize(&c).is_err());
        }
        let mut c = call(0);
        c["arguments"]["plan"]["promptText"] = json!("Different approved content");
        assert!(host().authorize(&c).is_err());
    }
    #[test]
    fn rejects_scope_version_and_parent_escape() {
        for (key, value) in [
            ("targetPackage", json!("/Game/UserGame/BP_Pickup")),
            ("parentClass", json!("/Script/Other.Parent")),
            ("expectedDiskState", json!("overwrite")),
            ("interactionRadiusCm", json!(1001)),
            ("interactionKey", json!("Delete")),
            ("graph", json!([])),
        ] {
            let mut c = call(0);
            c["arguments"]["plan"][key] = value;
            assert!(host().authorize(&c).is_err());
        }
        let mut c = call(0);
        c["arguments"]["expectedRootObjectId"] = json!("replacement");
        assert!(host().authorize(&c).is_err());
    }
    #[test]
    fn rejects_unreviewed_apply_and_revoked_queries() {
        let mut h = host();
        let mut c = call(2);
        c["arguments"]["previewToken"] = json!("55555555-5555-4555-8555-555555555555");
        assert!(h.authorize(&c).is_err());
        h.revoke();
        assert!(h.authorize(&call(3)).is_err());
    }
    #[test]
    fn wrappers_do_not_widen_the_actual_tool() {
        let c = call(3);
        let wrapped = json!({"name":"call_tool","arguments":{"tool_name":TOOLS[3],"arguments":c["arguments"]}});
        assert!(host().authorize(&wrapped).is_ok());
        let wrapped = json!({"name":"call_tool","arguments":{"tool_name":"ue.asset.save","arguments":c["arguments"]}});
        assert!(host().authorize(&wrapped).is_err());
    }
    #[test]
    fn invalid_or_unbound_preview_never_consumes_apply_permission() {
        let mut h = host();
        for value in [
            json!(null),
            json!(false),
            json!(42),
            json!(""),
            json!({}),
            json!("55555555-5555-4555-8555-555555555555"),
        ] {
            let mut input = call(2);
            input["arguments"]["previewToken"] = value;
            assert!(h.authorize(&input).is_err());
            assert!(!h.consumed[2]);
        }
        assert!(h.authorize(&call(2)).is_err());
        assert!(!h.consumed[2]);
        h.authorize(&call(1)).unwrap();
        h.bind_reviewed_preview("55555555-5555-4555-8555-555555555555".into())
            .unwrap();
        for value in [
            json!(null),
            json!(0),
            json!(""),
            json!("66666666-6666-4666-8666-666666666666"),
        ] {
            let mut input = call(2);
            input["arguments"]["previewToken"] = value;
            assert!(h.authorize(&input).is_err());
            assert!(!h.consumed[2]);
        }
        let mut valid = call(2);
        valid["arguments"]["previewToken"] = json!("55555555-5555-4555-8555-555555555555");
        assert!(h.authorize(&valid).is_ok());
        assert!(h.consumed[2]);
    }
}
