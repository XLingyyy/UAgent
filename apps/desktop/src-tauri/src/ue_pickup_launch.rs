//! Exact approved-project startup preparation. No editor launch or asset creation here.
use crate::trusted_root_handle::{TrustedRootHandle,ReadRule,PinnedDirectory};
use crate::ue_pickup_template::PickupTemplatePlan;
use serde_json::json;
use std::sync::Arc;
use std::time::{Duration,Instant};
pub(crate) struct PreparedPickupLaunch {
 pub root:Arc<TrustedRootHandle>, pub project:Arc<crate::ue_semantic_launch::Prepared>, pub plan:PickupTemplatePlan,
 pub root_object_id:String, pub permits:[String;3], pub expires:Instant,
 pub file_hash:String, pub target_directory:Arc<PinnedDirectory>,
 approval_directory:PinnedDirectory, approval_bytes:Vec<u8>,
}
fn guid()->Result<String,String>{let mut b=[0u8;16];getrandom::getrandom(&mut b).map_err(|_|"pickup_random_failed")?;b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;let h:String=b.iter().map(|b|format!("{b:02x}")).collect();Ok(format!("{}-{}-{}-{}-{}",&h[..8],&h[8..12],&h[12..16],&h[16..20],&h[20..]))}
pub(crate) fn prepare_launch(project:Arc<crate::ue_semantic_launch::Prepared>,plan:PickupTemplatePlan)->Result<PreparedPickupLaunch,String>{
 plan.validate()?;if !project.current()||project.read_root!=plan.write_root()?{return Err("pickup_project_scope_changed".into());}
 let root=project.root.clone();let content=format!("Content/{}",plan.write_root()?.strip_prefix("/Game/").unwrap());
 let reader=root.scope_from_verified_host(vec![ReadRule::subtree("Saved/UAgentPickupT13").map_err(|e|e.to_string())?,ReadRule::subtree(&content).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
 let approval_directory=reader.pin_directory("Saved/UAgentPickupT13").map_err(|_|"pickup_prepared_directories_required")?;
 let target_directory=Arc::new(reader.pin_directory(&content).map_err(|_|"pickup_prepared_directories_required")?);
 let root_object_id=root.pickup_legacy_identity().map_err(|e|e.to_string())?;
 let permits=[guid()?,guid()?,guid()?];
 let approval_bytes=serde_json::to_vec(&json!({"projectFile":project.project_file,"projectDescriptorHash":project.hash,"writeRoot":plan.write_root()?,"rootObjectId":root_object_id,"plan":plan,"preparePermit":permits[0],"previewPermit":permits[1],"applyPermit":permits[2]})).map_err(|_|"pickup_serialize_failed")?;
 let file_hash=crate::ue_build_repair_io::hash(&approval_bytes);
 Ok(PreparedPickupLaunch{root,project,plan,root_object_id,permits,expires:Instant::now()+Duration::from_secs(600),file_hash,target_directory,approval_directory,approval_bytes})
}
pub(crate) fn write_approved_launch(launch:PreparedPickupLaunch,live:impl Fn()->bool)->Result<PreparedPickupLaunch,String>{
 launch.check_current()?;if !live(){return Err("pickup_document_revoked".into());}
 // A new operation gets a new FILE_CREATE leaf; old approvals are retained and never overwritten.
 crate::ue_build_repair_io::create_recovery_record(&launch.approval_directory,&launch.approval_name(),&launch.approval_bytes)?;
 if !live(){return Err("pickup_approval_written_document_revoked_no_execution".into());}
 launch.check_current()?;Ok(launch)
}
impl PreparedPickupLaunch {
 fn approval_name(&self)->String{format!("host-approved-{}.json",self.plan.operation_id)}
 pub(crate) fn approval_path(&self)->std::path::PathBuf{self.root.path_hint().join("Saved/UAgentPickupT13").join(self.approval_name())}
 pub(crate) fn check_current(&self)->Result<(),String>{
  if Instant::now()>=self.expires{return Err("pickup_plan_expired".into());}
  if !self.project.current(){return Err("pickup_project_identity_changed".into());}
  self.target_directory.check_current().map_err(|e|e.to_string())?;
  self.approval_directory.check_current().map_err(|e|e.to_string())
 }
 pub(crate) fn pin_approved_file(&self)->Result<crate::ue_build_repair_io::IdentityPin,String>{
  self.check_current()?;
  let pin=crate::ue_build_repair_io::IdentityPin::read_shared(&self.approval_directory,&self.approval_name())?;
  let relative=format!("Saved/UAgentPickupT13/{}",self.approval_name());
  let reader=self.root.scope_from_verified_host(vec![ReadRule::exact_file(&relative).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
  let mut file=reader.open_file(&relative).map_err(|e|e.to_string())?;let bytes=file.read_bounded(16384).map_err(|e|e.to_string())?;
  if crate::ue_build_repair_io::hash(&bytes.bytes)!=self.file_hash{return Err("pickup_approval_file_changed".into());}
  pin.check()?;Ok(pin)
 }
}
pub(crate) fn approved_pickup_arguments(uproject:&std::path::Path,approval:&std::path::Path,write_root:&str)->Result<Vec<std::ffi::OsString>,String>{
 let scratch=uproject.parent().ok_or("pickup_project_invalid")?.join("Saved/UAgentPickupT13");
 let name=approval.file_name().and_then(|v|v.to_str()).ok_or("pickup_startup_binding_invalid")?;
 let operation=name.strip_prefix("host-approved-").and_then(|v|v.strip_suffix(".json")).ok_or("pickup_startup_binding_invalid")?;
 if !uproject.is_absolute()||approval.parent()!=Some(scratch.as_path())||!crate::ue_pickup_template::guid(operation){return Err("pickup_startup_binding_invalid".into());}
 crate::ue_pickup_template::target_directory(&format!("{write_root}/BP_Check"))?;
 let mut args=crate::ue_semantic_launch::arguments(uproject,write_root)?;
 args.extend(["-UAgentPickupEnableApprovedProjectWrites".into(),format!("-UAgentPickupAllowedProjectFile={}",uproject.to_string_lossy()).into(),format!("-UAgentPickupApprovedPlanFile={}",approval.to_string_lossy()).into()]);Ok(args)
}
#[cfg(test)]mod tests{
 use super::*;
 fn fixture()->(std::path::PathBuf,Arc<crate::ue_semantic_launch::Prepared>,PickupTemplatePlan){
  let base=std::path::PathBuf::from(std::env::var_os("UAGENT_REPAIR_TEST_DIR").expect("isolated test output required")).join(format!("ordinary-pickup-{}",guid().unwrap()));
  std::fs::create_dir_all(base.join("Saved/UAgentPickupT13")).unwrap();std::fs::create_dir_all(base.join("Content/Gameplay/Pickups")).unwrap();
  std::fs::write(base.join("Ordinary.uproject"),br#"{"FileVersion":3,"Description":"Synthetic; never launched"}"#).unwrap();
  let root=Arc::new(TrustedRootHandle::open_from_host_selection(&base).unwrap());
  let project=Arc::new(crate::ue_semantic_launch::Prepared::new(root,"Ordinary.uproject".into(),"/Game/Gameplay/Pickups".into()).unwrap());
  let plan:PickupTemplatePlan=serde_json::from_value(json!({"operationId":guid().unwrap(),"targetPackage":"/Game/Gameplay/Pickups/BP_Pickup","expectedDiskState":"absent","templateId":"actor.pickup.native.v1","parentClass":crate::ue_pickup_template::PARENT,"itemId":"Health","promptText":"Press E","interactionRadiusCm":200,"interactionKey":"E"})).unwrap();(base,project,plan)
 }
 #[test]fn ordinary_pickup_approval_pins_project_directory_and_operation(){
  let (base,project,plan)=fixture();assert!(!base.join(".uagent-isolated-lab.json").exists());
  let prepared=prepare_launch(project.clone(),plan.clone()).unwrap();
  assert!(std::fs::OpenOptions::new().write(true).open(base.join("Ordinary.uproject")).is_err());
  assert!(std::fs::rename(base.join("Content/Gameplay/Pickups"),base.join("Content/Gameplay/Moved")).is_err());
  let launch=write_approved_launch(prepared,||true).unwrap();let _pin=launch.pin_approved_file().unwrap();
  let saved:serde_json::Value=serde_json::from_slice(&std::fs::read(launch.approval_path()).unwrap()).unwrap();
  assert_eq!(saved["projectFile"],"Ordinary.uproject");assert_eq!(saved["projectDescriptorHash"],project.hash);assert_eq!(saved["writeRoot"],"/Game/Gameplay/Pickups");
  assert!(write_approved_launch(prepare_launch(project.clone(),plan.clone()).unwrap(),||true).is_err());
  let mut second=plan;second.operation_id=guid().unwrap();second.target_package="/Game/Gameplay/Pickups/BP_Second".into();
  let next=write_approved_launch(prepare_launch(project.clone(),second).unwrap(),||true).unwrap();assert_ne!(launch.approval_path(),next.approval_path());assert!(launch.approval_path().exists());
  project.root.revoke();assert!(launch.pin_approved_file().is_err());assert!(next.check_current().is_err());
 }
 #[test]fn pickup_declined_or_revoked_scope_never_writes_approval(){
  let (base,project,plan)=fixture();let prepared=prepare_launch(project.clone(),plan.clone()).unwrap();let approval=prepared.approval_path();
  assert!(write_approved_launch(prepared,||false).is_err());assert!(!approval.exists());
  let mut other=plan.clone();other.target_package="/Game/Other/BP_Pickup".into();assert!(prepare_launch(project.clone(),other).is_err());
  let prepared=prepare_launch(project.clone(),plan).unwrap();project.root.revoke();assert!(write_approved_launch(prepared,||true).is_err());assert!(!approval.exists());assert!(!base.join("Content/Gameplay/Pickups/BP_Pickup.uasset").exists());
 }
 #[test]fn pickup_arguments_require_exact_operation_file_and_approved_parent(){
  let (base,project,plan)=fixture();let launch=prepare_launch(project,plan).unwrap();let descriptor=base.join("Ordinary.uproject");
  let args=approved_pickup_arguments(&descriptor,&launch.approval_path(),launch.plan.write_root().unwrap()).unwrap();
  assert!(args.iter().any(|v|v=="-UAgentPickupEnableApprovedProjectWrites"));assert!(args.iter().any(|v|v=="-UAgentSemanticReadRoot=/Game/Gameplay/Pickups"));
  for file in [base.join("host-approved-plan.json"),base.join("Saved/UAgentPickupT13/host-approved-plan.json"),base.join("Saved/UAgentPickupT13/host-approved-../other.json")]{assert!(approved_pickup_arguments(&descriptor,&file,"/Game/Gameplay/Pickups").is_err());}
  assert!(approved_pickup_arguments(&descriptor,&launch.approval_path(),"/Game/../Other").is_err());
 }
 #[test]fn pickup_missing_or_reparse_target_directory_is_rejected(){
  let (base,project,plan)=fixture();std::fs::rename(base.join("Content/Gameplay/Pickups"),base.join("Content/Gameplay/Outside")).unwrap();
  assert!(prepare_launch(project.clone(),plan.clone()).is_err());
  use std::os::windows::process::CommandExt;
  let cmd=std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap()).join("System32").join("cmd.exe");
  let status=std::process::Command::new(cmd).args(["/D","/C","mklink","/J"]).arg(base.join("Content/Gameplay/Pickups").to_string_lossy().replace('/', "\\")).arg(base.join("Content/Gameplay/Outside").to_string_lossy().replace('/', "\\")).creation_flags(0x08000000).output().unwrap();assert!(status.status.success(),"junction fixture failed: {:?} {:?}",status.status,status.stderr);
  struct JunctionCleanup(std::path::PathBuf);
  impl Drop for JunctionCleanup{fn drop(&mut self){let _=std::fs::remove_dir(&self.0);}}
  // Remove only this owned junction, including on panic; retain its target and all fixture evidence.
  let link=base.join("Content/Gameplay/Pickups");let cleanup=JunctionCleanup(link.clone());
  let rejected=prepare_launch(project,plan).is_err();drop(cleanup);
  assert!(!link.exists());assert!(base.join("Content/Gameplay/Outside").is_dir());assert!(rejected);
 }
}
