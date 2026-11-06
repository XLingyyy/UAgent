//! Fresh read-only comparison of saved repair artifacts after restart. Never settles effects or grants writes.
use crate::{trusted_root_handle::{TrustedRootHandle,ReadRule},ue_build_repair::RepairPreviewInput,ue_build_repair_io::hash};
use serde::{Deserialize,Serialize};
use std::{collections::BTreeSet,sync::atomic::{AtomicBool,Ordering},time::Instant};
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct SavedPreview{preview:RepairPreviewInput,native_plan_digest:String}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct SavedBackup{schema_version:u32,preview:SavedPreview,#[serde(default)] execution_identity:Option<crate::repair_execution_identity::ExecutionIdentity>}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct FileObservation{pub path:String,pub state:String,pub saved_effect:String,pub current_sha256:Option<String>,pub known_applied_match:bool}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct RestoreCandidate{pub path:String,pub before:String,pub after:String,pub before_hash:String,pub after_hash:String}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct ExecutionEvidence{pub status:&'static str,pub recorded_phase:Option<crate::local_run_store::effect_reconciliation::DispatchPhase>,pub stopped_proven:bool}
impl ExecutionEvidence{pub fn unavailable()->Self{Self{status:"unavailable",recorded_phase:None,stopped_proven:false}}}
pub fn describe_execution(effects:&[crate::local_run_store::effect_reconciliation::runtime_host_catalog_reader::DurableEffectBarrier],project:&str,run:&str,root_object:&str)->ExecutionEvidence{
 let selected:Vec<_>=effects.iter().filter(|e|e.project_id==project&&e.owner.run_id==run).collect();
 if selected.len()!=1{return ExecutionEvidence{status:if selected.is_empty(){"no_matching_barrier"}else{"ambiguous"},recorded_phase:None,stopped_proven:false};}
 let e=selected[0];if e.root_object_id!=root_object{return ExecutionEvidence{status:"root_mismatch",recorded_phase:None,stopped_proven:false};}
 ExecutionEvidence{status:"recorded_barrier",recorded_phase:Some(e.dispatch.phase),stopped_proven:false}
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct RecoveryInspection{pub schema_version:u32,pub project_id:String,pub run_id:String,pub backup_sha256:String,pub result_present:bool,pub files:Vec<FileObservation>,pub restore_candidates:Vec<RestoreCandidate>,pub execution:ExecutionEvidence,pub restore_available:bool,pub restore_blocker:&'static str}
fn live(root:&TrustedRootHandle,cancelled:&AtomicBool,deadline:Instant)->Result<(),String>{
 if cancelled.load(Ordering::Acquire)||Instant::now()>=deadline{return Err("repair_inspection_cancelled".into());}
 root.check_current().map_err(|_|"repair_inspection_root_changed".into())
}
pub fn inspect(root:&TrustedRootHandle,project:&str,run:&str,backup:&[u8],result:Option<&[u8]>,cancelled:&AtomicBool,deadline:Instant)->Result<RecoveryInspection,String>{
 live(root,cancelled,deadline)?;
 if backup.len()>2*1024*1024||result.is_some_and(|r|r.len()>2*1024*1024){return Err("repair_inspection_record_too_large".into());}
 let saved:SavedBackup=serde_json::from_slice(backup).map_err(|_|"repair_inspection_invalid_backup")?;
 let p=&saved.preview.preview;let backup_sha256=hash(backup);
 if saved.schema_version!=1||p.binding.project_id!=project||p.binding.root_object_id!=root.identity().observation_key()||p.files.is_empty()||p.files.len()>8||hash(&serde_json::to_vec(p).map_err(|_|"repair_inspection_invalid_backup")?)!=saved.preview.native_plan_digest{return Err("repair_inspection_binding_changed".into());}
 let mut seen=BTreeSet::new();let mut rules=Vec::new();
 for f in &p.files{
  crate::ue_build_repair::source_path(&f.path)?;
  if !seen.insert(f.path.to_ascii_lowercase())||f.before.len()>256*1024||f.after.len()>256*1024||hash(f.before.as_bytes())!=f.before_hash||hash(f.after.as_bytes())!=f.after_hash||f.before==f.after{return Err("repair_inspection_invalid_backup".into());}
  rules.push(ReadRule::exact_file(&f.path).map_err(|_|"repair_inspection_invalid_path")?);
 }
 let receipt:Option<serde_json::Value>=result.map(|bytes|serde_json::from_slice(bytes).map_err(|_|"repair_inspection_invalid_result")).transpose()?;
 if let Some(r)=&receipt{
  let binding=serde_json::to_value(&p.binding).map_err(|_|"repair_inspection_invalid_result")?;
  let effects=r["effects"].as_array().ok_or("repair_inspection_invalid_result")?;
  if r["diagnostic"]!=serde_json::to_value(&p.diagnostic).map_err(|_|"repair_inspection_invalid_result")?||r["binding"]!=binding||r["previewId"]!=p.preview_id||r["recoveryRecord"]!=backup_sha256||effects.len()!=p.files.len(){return Err("repair_inspection_result_binding_changed".into());}
  for (e,f) in effects.iter().zip(&p.files){
   if e["path"]!=f.path||e["beforeHash"]!=f.before_hash||e["beforeObjectIdentity"]!=f.before_object_identity||!matches!(e["status"].as_str(),Some("applied"|"not_started"|"conflict"|"unknown")){return Err("repair_inspection_result_binding_changed".into());}
   if e["status"]=="applied"&&(e["afterHash"]!=f.after_hash||e["afterObjectIdentity"]!=f.before_object_identity){return Err("repair_inspection_result_binding_changed".into());}
  }
 }
 let reader=root.scope_from_verified_host(rules).map_err(|_|"repair_inspection_scope_unavailable")?;let mut files=Vec::new();let mut restore_candidates=Vec::new();
 for (i,f) in p.files.iter().enumerate(){
  live(root,cancelled,deadline)?;
  let saved_effect=receipt.as_ref().and_then(|r|r["effects"][i]["status"].as_str()).unwrap_or("unrecorded").to_owned();
  let observation=reader.open_file(&f.path).and_then(|mut file|file.read_bounded(256*1024));
  let (state,current_sha256)=match observation{
   Ok(value)=>{let digest=hash(&value.bytes);let state=if value.file_identity.observation_key()!=f.before_object_identity{"object_changed"}else if digest==f.before_hash{"matches_before"}else if digest==f.after_hash{"matches_after"}else{"diverged"};(state,Some(digest))},
   Err(_)=>("unavailable",None)
  };
  if state=="matches_after"&&saved_effect=="applied"{restore_candidates.push(RestoreCandidate{path:f.path.clone(),before:f.after.clone(),after:f.before.clone(),before_hash:f.after_hash.clone(),after_hash:f.before_hash.clone()});}
  files.push(FileObservation{path:f.path.clone(),known_applied_match:state=="matches_after"&&saved_effect=="applied",state:state.into(),saved_effect,current_sha256});
 }
 live(root,cancelled,deadline)?;
 Ok(RecoveryInspection{schema_version:1,project_id:project.into(),run_id:run.into(),backup_sha256,result_present:receipt.is_some(),files,restore_candidates,execution:ExecutionEvidence::unavailable(),restore_available:false,restore_blocker:"original_execution_settlement_required"})
}

/// Called with the current store's physical identity and its validated effect intent.
/// Missing legacy identity and every OS lookup error remain blocked; no admission is created.
pub(crate) fn observe_original_process(backup:&[u8],database:(u64,[u8;16]),intent:&crate::local_run_store::effect_reconciliation::EffectIntent)->Result<crate::repair_execution_identity::ProcessObservation,String>{
 if backup.len()>2*1024*1024{return Err("repair_inspection_record_too_large".into());}
 let saved:SavedBackup=serde_json::from_slice(backup).map_err(|_|"repair_inspection_invalid_backup")?;
 if saved.schema_version!=1||saved.preview.native_plan_digest!=intent.approved_plan_digest{return Err("repair_execution_binding_changed".into());}
 saved.execution_identity.ok_or("repair_execution_identity_missing")?.observe(database,&intent.key.project_id,&intent.owner.run_id,&intent.key.operation_id,&intent.digest().map_err(|_|"repair_intent_invalid")?).map_err(str::to_string)
}
