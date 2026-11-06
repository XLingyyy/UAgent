//! Preparation for the approved-project new-map startup contract. No editor launch here.
use crate::trusted_root_handle::{TrustedRootHandle,ReadRule};
use crate::ue_scene_batch::SceneBatchPlan;
use serde_json::json;
use std::sync::Arc;
use std::time::{Duration,Instant};
pub(crate) struct PreparedSceneLaunch {
 pub root:Arc<TrustedRootHandle>, pub project:Arc<crate::ue_semantic_launch::Prepared>, pub plan:SceneBatchPlan,
 pub root_object_id:String, pub permits:[String;5], pub run_id:String, pub expires:Instant,
 pub file_hash:String,
}
fn guid()->Result<String,String>{let mut b=[0u8;16];getrandom::getrandom(&mut b).map_err(|_|"scene_random_failed")?;b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;let h:String=b.iter().map(|b|format!("{b:02x}")).collect();Ok(format!("{}-{}-{}-{}-{}",&h[..8],&h[8..12],&h[12..16],&h[16..20],&h[20..]))}
pub(crate) fn validate_directories(root:&TrustedRootHandle)->Result<(),String>{
 let reader=root.scope_from_verified_host(vec![ReadRule::subtree("Saved/UAgentSceneT14").map_err(|e|e.to_string())?,ReadRule::subtree("Content/UAgentBuildLab/Scene_T14").map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
 reader.pin_directory("Saved/UAgentSceneT14").map_err(|_|"scene_prepared_directories_required")?;
 reader.pin_directory("Content/UAgentBuildLab/Scene_T14").map_err(|_|"scene_prepared_directories_required")?;
 root.check_current().map_err(|e|e.to_string())
}
pub(crate) fn write_approved_launch(project:Arc<crate::ue_semantic_launch::Prepared>,plan:SceneBatchPlan,live:impl Fn()->bool)->Result<PreparedSceneLaunch,String>{
 let root=project.root.clone();plan.validate()?;validate_directories(&root)?;if !project.current(){return Err("scene_project_identity_changed".into());}
 let root_object_id=root.pickup_legacy_identity().map_err(|e|e.to_string())?;
 let permits=[guid()?,guid()?,guid()?,guid()?,guid()?];let run_id=guid()?;
 let bytes=serde_json::to_vec(&json!({"projectFile":project.project_file,"projectDescriptorHash":project.hash,"rootObjectId":root_object_id,"runId":run_id,"operations":[{"plan":plan,"preparePermit":permits[0],"executePermit":permits[1],"cancelPermit":permits[2],"resumePermit":permits[3],"savePermit":permits[4]}]})).map_err(|_|"scene_serialize_failed")?;
 let reader=root.scope_from_verified_host(vec![ReadRule::subtree("Saved/UAgentSceneT14").map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
 let directory=reader.pin_directory("Saved/UAgentSceneT14").map_err(|e|e.to_string())?;
 if !live(){return Err("scene_document_revoked".into());}
 // Existing relative FILE_CREATE writer: never overwrite a previous approval or follow a junction.
 crate::ue_build_repair_io::create_recovery_record(&directory,"host-approved-plans.json",&bytes)?;
 if !live(){return Err("scene_approval_written_document_revoked_no_execution".into());}
 Ok(PreparedSceneLaunch{root,project,plan,root_object_id,permits,run_id,expires:Instant::now()+Duration::from_secs(600),file_hash:crate::ue_build_repair_io::hash(&bytes)})
}

impl PreparedSceneLaunch {
 pub(crate) fn pin_approved_file(&self)->Result<crate::ue_build_repair_io::IdentityPin,String>{
  if Instant::now()>=self.expires{return Err("scene_plan_expired".into());}
  validate_directories(&self.root)?;if !self.project.current(){return Err("scene_project_identity_changed".into());}
  let reader=self.root.scope_from_verified_host(vec![ReadRule::subtree("Saved/UAgentSceneT14").map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
  let directory=reader.pin_directory("Saved/UAgentSceneT14").map_err(|e|e.to_string())?;
  let pin=crate::ue_build_repair_io::IdentityPin::read_shared(&directory,"host-approved-plans.json")?;
  let mut file=reader.open_file("Saved/UAgentSceneT14/host-approved-plans.json").map_err(|e|e.to_string())?;
  let bytes=file.read_bounded(131072).map_err(|e|e.to_string())?;
  if crate::ue_build_repair_io::hash(&bytes.bytes)!=self.file_hash{return Err("scene_approval_file_changed".into());}
  pin.check()?;Ok(pin)
 }
}

pub(crate) fn approved_scene_arguments(uproject:&std::path::Path,approval:&std::path::Path)->Result<Vec<std::ffi::OsString>,String>{
 let expected=uproject.parent().ok_or("scene_project_invalid")?.join("Saved/UAgentSceneT14/host-approved-plans.json");
 if !uproject.is_absolute()||approval!=expected||crate::ue_semantic_launch::validate(uproject.file_name().and_then(|v|v.to_str()).unwrap_or(""),crate::ue_scene_batch::ROOT).is_err(){return Err("scene_startup_binding_invalid".into());}
 Ok(vec!["-UAgentSceneEnableApprovedProjectWrites".into(),format!("-UAgentSceneAllowedProjectFile={}",uproject.to_string_lossy()).into(),format!("-UAgentSceneApprovedPlansFile={}",approval.to_string_lossy()).into()])
}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn ordinary_scene_approval_pins_descriptor_and_never_overwrites(){
  let base=std::path::PathBuf::from(std::env::var_os("UAGENT_REPAIR_TEST_DIR").unwrap()).join(format!("ordinary-scene-{}",guid().unwrap()));
  std::fs::create_dir_all(base.join("Saved/UAgentSceneT14")).unwrap();std::fs::create_dir_all(base.join("Content/UAgentBuildLab/Scene_T14")).unwrap();
  std::fs::write(base.join("Ordinary.uproject"),br#"{"FileVersion":3,"Description":"Synthetic; never launched"}"#).unwrap();
  let root=Arc::new(TrustedRootHandle::open_from_host_selection(&base).unwrap());
  let project=Arc::new(crate::ue_semantic_launch::Prepared::new(root.clone(),"Ordinary.uproject".into(),crate::ue_scene_batch::ROOT.into()).unwrap());
  let plan:SceneBatchPlan=serde_json::from_value(json!({"operationId":guid().unwrap(),"targetMap":format!("{}/L_New",crate::ue_scene_batch::ROOT),"expectedDiskState":"absent","items":[{"itemId":"one","objectName":"UA14_One","mesh":"/Engine/BasicShapes/Cube.Cube","material":crate::ue_scene_batch::MATERIAL,"transform":{"location":{"x":1,"y":2,"z":3},"rotation":{"pitch":0,"yaw":45,"roll":0},"scale":{"x":1,"y":1,"z":2}}}]})).unwrap();
  assert!(write_approved_launch(project.clone(),plan.clone(),||false).is_err());
  let launch=write_approved_launch(project.clone(),plan.clone(),||true).unwrap();let _pin=launch.pin_approved_file().unwrap();
  assert!(std::fs::OpenOptions::new().write(true).open(base.join("Ordinary.uproject")).is_err());
  assert!(write_approved_launch(project,plan,||true).is_err());
  let bytes=std::fs::read(base.join("Saved/UAgentSceneT14/host-approved-plans.json")).unwrap();let saved:serde_json::Value=serde_json::from_slice(&bytes).unwrap();assert_eq!(saved["projectFile"],"Ordinary.uproject");assert_eq!(saved["projectDescriptorHash"],launch.project.hash);
  let args=approved_scene_arguments(&base.join("Ordinary.uproject"),&base.join("Saved/UAgentSceneT14/host-approved-plans.json")).unwrap();assert_eq!(args[0],"-UAgentSceneEnableApprovedProjectWrites");
  assert!(approved_scene_arguments(&base.join("Ordinary.uproject"),&base.join("Other.json")).is_err());
  root.revoke();assert!(launch.pin_approved_file().is_err());
 }
}
