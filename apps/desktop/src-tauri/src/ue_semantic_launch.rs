//! Approved read-only editor startup data. No asset write grants or arbitrary arguments.
use std::{sync::Arc,path::Path,ffi::OsString,fs::File};
use crate::trusted_root_handle::{TrustedRootHandle,ReadRule,BoundReadFile};
pub(crate) fn validate(project_file:&str,read_root:&str)->Result<(),String>{
 let stem=project_file.strip_suffix(".uproject").ok_or("semantic_project_file_invalid")?;
 if stem.is_empty()||stem.len()>128||!stem.chars().all(|c|c.is_ascii_alphanumeric()||c=='_')||!crate::ue_blueprint_read::target(read_root){return Err("semantic_start_scope_invalid".into());}Ok(())
}
pub(crate) fn arguments(project:&Path,read_root:&str)->Result<Vec<OsString>,String>{
 validate(project.file_name().and_then(|v|v.to_str()).ok_or("semantic_project_file_invalid")?,read_root)?;
 if !project.is_absolute(){return Err("semantic_project_file_invalid".into());}
 Ok(vec!["-UAgentEnableSemanticReads".into(),format!("-UAgentSemanticReadRoot={read_root}").into()])
}
pub(crate) struct Prepared {
 pub root:Arc<TrustedRootHandle>,pub project_file:String,pub read_root:String,pub hash:String,
 file:BoundReadFile,_pin:File,
}
impl Prepared {
 pub fn new(root:Arc<TrustedRootHandle>,project_file:String,read_root:String)->Result<Self,String>{
  use std::os::windows::fs::OpenOptionsExt;
  validate(&project_file,&read_root)?;
  let reader=root.scope_from_verified_host(vec![ReadRule::exact_file(&project_file).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
  let mut file=reader.open_file(&project_file).map_err(|e|e.to_string())?;
  // Deny replacement/modification while approval, launch and the owned session are alive.
  let pin=std::fs::OpenOptions::new().read(true).share_mode(1).open(file.path_hint()).map_err(|_|"semantic_project_pin_failed")?;
  file.check_current().map_err(|e|e.to_string())?;
  let bytes=file.read_bounded(1024*1024).map_err(|e|e.to_string())?.bytes;
  let value:serde_json::Value=serde_json::from_slice(&bytes).map_err(|_|"semantic_project_json_invalid")?;
  if value["FileVersion"].as_u64().is_none(){return Err("semantic_project_json_invalid".into());}
  Ok(Self{root,project_file,read_root,hash:crate::ue_build_repair_io::hash(&bytes),file,_pin:pin})
 }
 pub fn current(&self)->bool {self.root.check_current().is_ok()&&self.file.check_current().is_ok()}
}
#[cfg(test)] mod tests {
 use super::*;
 #[test]fn readonly_arguments_have_no_write_or_command_flags(){
  let a=arguments(Path::new("E:/Synthetic/Ordinary.uproject"),"/Game/Characters").unwrap();
  assert_eq!(a,vec![OsString::from("-UAgentEnableSemanticReads"),OsString::from("-UAgentSemanticReadRoot=/Game/Characters")]);
 }
 #[test]fn paths_and_scope_cannot_inject_launch_arguments(){
  for (p,s) in [("../Other.uproject","/Game/Characters"),("A.uproject -ExecCmds=X","/Game/Characters"),("A.uproject","/Game/Characters -ExecCmds=X"),("A.uproject","/Game/../Other"),("A.uproject","/Engine/Actors")]{assert!(validate(p,s).is_err());}
 }
 #[test]fn synthetic_project_descriptor_is_pinned_and_revocation_stops_plan(){
  let base=std::env::var_os("UAGENT_REPAIR_TEST_DIR").expect("isolated test output required");
  let mut random=[0u8;8];getrandom::getrandom(&mut random).unwrap();
  let suffix:String=random.iter().map(|b|format!("{b:02x}")).collect();
  let directory=std::path::PathBuf::from(base).join(format!("semantic-project-{suffix}"));std::fs::create_dir_all(&directory).unwrap();
  let project=directory.join("Ordinary.uproject");std::fs::write(&project,r#"{"FileVersion":3,"EngineAssociation":"5.8","Description":"Synthetic; never launched"}"#).unwrap();
  let root=Arc::new(TrustedRootHandle::open_from_host_selection(&directory).unwrap());
  assert!(Prepared::new(root.clone(),"../Ordinary.uproject".into(),"/Game/Characters".into()).is_err());
  let plan=Prepared::new(root.clone(),"Ordinary.uproject".into(),"/Game/Characters".into()).unwrap();
  assert!(plan.current());assert_eq!(plan.hash.len(),64);
  // Existing descriptor cannot change while approved identity is retained.
  assert!(std::fs::OpenOptions::new().write(true).open(&project).is_err());
  root.revoke();assert!(!plan.current());
  // Preserve the new fixture; no recursive deletion or overwrite cleanup.
 }

}
