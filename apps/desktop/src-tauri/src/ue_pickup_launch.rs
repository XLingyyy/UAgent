//! Preparation for the existing isolated-Lab startup contract. No editor launch here.
use crate::trusted_root_handle::{TrustedRootHandle,ReadRule};
use crate::ue_pickup_template::PickupTemplatePlan;
use serde_json::{json,Value};
use std::sync::Arc;
use std::time::{Duration,Instant};
pub(crate) struct PreparedPickupLaunch {
 pub root:Arc<TrustedRootHandle>, pub plan:PickupTemplatePlan,
 pub root_object_id:String, pub permits:[String;3], pub expires:Instant,
 pub file_hash:String,
}
fn guid()->Result<String,String>{let mut b=[0u8;16];getrandom::getrandom(&mut b).map_err(|_|"pickup_random_failed")?;b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;let h:String=b.iter().map(|b|format!("{b:02x}")).collect();Ok(format!("{}-{}-{}-{}-{}",&h[..8],&h[8..12],&h[12..16],&h[16..20],&h[20..]))}
pub(crate) fn validate_lab(root:&TrustedRootHandle)->Result<(),String>{
 let rules=vec![ReadRule::exact_file(".uagent-isolated-lab.json"),ReadRule::exact_file("UAgentBuildLab.uproject"),ReadRule::subtree("Saved/UAgentPickupT13"),ReadRule::subtree("Content/UAgentBuildLab/Pickup_T13")].into_iter().collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
 let reader=root.scope_from_verified_host(rules).map_err(|e|e.to_string())?;
 let mut marker=reader.open_file(".uagent-isolated-lab.json").map_err(|e|e.to_string())?;
 let bytes=marker.read_bounded(4096).map_err(|e|e.to_string())?;
 let value:Value=serde_json::from_slice(&bytes.bytes).map_err(|_|"pickup_lab_marker_invalid")?;
 if value["project"]!="UAgentBuildLab"||value["existingUserProject"]!=false{return Err("pickup_isolated_lab_required".into());}
 root.check_current().map_err(|e|e.to_string())
}
pub(crate) fn write_approved_launch(root:Arc<TrustedRootHandle>,plan:PickupTemplatePlan,live:impl Fn()->bool)->Result<PreparedPickupLaunch,String>{
 plan.validate()?;validate_lab(&root)?;
 let root_object_id=root.pickup_legacy_identity().map_err(|e|e.to_string())?;
 let permits=[guid()?,guid()?,guid()?];
 let bytes=serde_json::to_vec(&json!({"rootObjectId":root_object_id,"plan":plan,"preparePermit":permits[0],"previewPermit":permits[1],"applyPermit":permits[2]})).map_err(|_|"pickup_serialize_failed")?;
 let reader=root.scope_from_verified_host(vec![ReadRule::subtree("Saved/UAgentPickupT13").map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
 let directory=reader.pin_directory("Saved/UAgentPickupT13").map_err(|e|e.to_string())?;
 if !live(){return Err("pickup_document_revoked".into());}
 // Existing relative FILE_CREATE writer: never overwrite a previous approval or follow a junction.
 crate::ue_build_repair_io::create_recovery_record(&directory,"host-approved-plan.json",&bytes)?;
 if !live(){return Err("pickup_approval_written_document_revoked_no_execution".into());}
 Ok(PreparedPickupLaunch{root,plan,root_object_id,permits,expires:Instant::now()+Duration::from_secs(600),file_hash:crate::ue_build_repair_io::hash(&bytes)})
}

impl PreparedPickupLaunch {
 pub(crate) fn pin_approved_file(&self)->Result<crate::ue_build_repair_io::IdentityPin,String>{
  if Instant::now()>=self.expires{return Err("pickup_plan_expired".into());}
  validate_lab(&self.root)?;
  let reader=self.root.scope_from_verified_host(vec![ReadRule::subtree("Saved/UAgentPickupT13").map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
  let directory=reader.pin_directory("Saved/UAgentPickupT13").map_err(|e|e.to_string())?;
  let pin=crate::ue_build_repair_io::IdentityPin::read_shared(&directory,"host-approved-plan.json")?;
  let mut file=reader.open_file("Saved/UAgentPickupT13/host-approved-plan.json").map_err(|e|e.to_string())?;
  let bytes=file.read_bounded(16384).map_err(|e|e.to_string())?;
  if crate::ue_build_repair_io::hash(&bytes.bytes)!=self.file_hash{return Err("pickup_approval_file_changed".into());}
  pin.check()?;Ok(pin)
 }
}

pub(crate) fn approved_pickup_arguments(uproject:&std::path::Path,approval:&std::path::Path)->Result<Vec<std::ffi::OsString>,String>{
 let expected=uproject.parent().ok_or("pickup_project_invalid")?.join("Saved/UAgentPickupT13/host-approved-plan.json");
 if !uproject.is_absolute()||approval!=expected||uproject.file_name().and_then(|v|v.to_str())!=Some("UAgentBuildLab.uproject"){return Err("pickup_startup_binding_invalid".into());}
 Ok(vec!["-UAgentEnableSemanticReads".into(),"-UAgentSemanticReadRoot=/Game/UAgentBuildLab/Pickup_T13".into(),"-UAgentPickupEnableLabWrites".into(),format!("-UAgentPickupAllowedProjectFile={}",uproject.to_string_lossy()).into(),format!("-UAgentPickupApprovedPlanFile={}",approval.to_string_lossy()).into()])
}
