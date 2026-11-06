//! Fixed native effect sequence; all transport is supplied by the owned editor connection.
use serde_json::{json,Value};
use crate::ue_pickup_template::{PickupTemplatePlan,PickupHostScope,PickupHostAuthorization,CONTRACT,SCOPE};
#[path="ue_pickup_blake3.rs"]
mod blake3;
fn digest(bytes:&[u8])->String{let mut h=blake3::Hasher::new();h.update(bytes);let mut out=[0u8;32];h.finalize(&mut out);out.iter().map(|b|format!("{b:02x}")).collect()}
pub(crate) struct Execution {plan:PickupTemplatePlan, project:String, instance:String, root:String, auth:PickupHostAuthorization, preview:Option<Value>, attempted:bool, applied:bool}
fn guid(s:&str)->bool{s.len()==36&&s.bytes().enumerate().all(|(i,b)|if [8,13,18,23].contains(&i){b==b'-'}else{b.is_ascii_digit()||(b'a'..=b'f').contains(&b)})}
fn hash(s:&str)->bool{s.len()==64&&s.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))}
fn plan_hash(p:&PickupTemplatePlan)->String{let text=format!("{}\n{}\nabsent\n{}\n{}\n{}\n{}\n{}\n{}",p.operation_id,p.target_package,p.template_id,p.parent_class,p.item_id,p.prompt_text,p.interaction_radius_cm,p.interaction_key);digest(text.as_bytes())}
impl Execution {
 /// Caller owns the launched process/listener, held project/target directory and exact startup file.
 /// Public peer project/instance labels are bound to that owned process, never used as authority alone.
 pub(crate) fn new(m:&Value,root:String,plan:PickupTemplatePlan,permits:[String;3])->Result<Self,String>{
  plan.validate()?;
  if m["available"]!=true||m["rootObjectId"]!=root||m["allowedTarget"]!=plan.target_package||m["allowedMap"]!=""||m["writeRoot"]!=plan.write_root()?||m["contractVersion"]!=CONTRACT||m["scopeMode"]!=SCOPE||m["productionSupported"]!=true||!m["instanceId"].as_str().is_some_and(guid){return Err("pickup_owned_scope_mismatch".into());}
  let project=m["projectKey"].as_str().filter(|s|!s.is_empty()).ok_or("pickup_project_missing")?.to_owned();let instance=m["instanceId"].as_str().unwrap().to_owned();
  let scope=PickupHostScope::from_verified_project_host(project.clone(),instance.clone(),root.clone(),plan.clone())?;
  Ok(Self{plan,project,instance,root,auth:PickupHostAuthorization::new_for_verified_project_host(scope,permits)?,preview:None,attempted:false,applied:false})
 }
 pub(crate) fn check_manifest(&self,m:&Value)->Result<(),String>{if m["available"]!=true||m["projectKey"]!=self.project||m["instanceId"]!=self.instance||m["rootObjectId"]!=self.root||m["allowedTarget"]!=self.plan.target_package||m["writeRoot"]!=self.plan.write_root()?||m["allowedMap"]!=""||m["contractVersion"]!=CONTRACT||m["scopeMode"]!=SCOPE||m["productionSupported"]!=true{return Err("pickup_editor_scope_changed".into());}Ok(())}
 fn call(&mut self,stage:&str)->Result<Value,String>{
  let mut args=json!({"protocolVersion":2,"contractVersion":CONTRACT,"expectedProjectKey":self.project,"expectedInstanceId":self.instance,"expectedRootObjectId":self.root,"plan":self.plan});
  if stage=="apply"{args["previewToken"]=self.preview.as_ref().ok_or("pickup_preview_required")?["previewToken"].clone();}
  self.auth.authorize(&json!({"name":format!("uagent.v2.pickup.{stage}"),"arguments":args}))
 }
 fn result(&self,stage:&str,v:Value)->Result<Value,String>{
  if v["isError"]==true{return Err("pickup_effect_failed_query_before_retry".into());}let r=&v["structuredContent"];
  if r["schemaVersion"]!="uagent.pickup.result.v2"||r["contractVersion"]!=CONTRACT||r["projectKey"]!=self.project||r["instanceId"]!=self.instance||r["rootObjectId"]!=self.root||r["operation"]!=format!("uagent.v2.pickup.{stage}")||r["plan"]!=json!(self.plan)||r["planHash"]!=plan_hash(&self.plan)||!r["data"].is_object(){return Err("pickup_result_binding_mismatch".into());}Ok(r["data"].clone())
 }
 pub(crate) fn preview(&mut self,mut send:impl FnMut(Value)->Result<Value,String>)->Result<Value,String>{
  if self.attempted{return Err("pickup_preview_already_attempted_no_retry".into());}self.attempted=true;
  let call=self.call("prepare")?;let data=self.result("prepare",send(call)?)?;
  if data["prepared"]!=true||data["effect"]!="authorized_engine_dependency_loading_and_native_cdo_preparation"{return Err("pickup_preparation_not_observed".into());}
  let call=self.call("preview")?;let data=self.result("preview",send(call)?)?;
  if !data["previewToken"].as_str().is_some_and(guid)||!data["copyObjectPath"].as_str().is_some_and(|s|s.starts_with("/Temp/UAgentPickupT13/"))||data["copySaved"]!=false||data["compileStatus"]!="up_to_date"||!data["semanticChanges"].as_array().is_some_and(|v|v.len()<=16&&v.iter().all(|s|s.as_str().is_some_and(|t|t.len()<=1024)))||!data["compileDiagnostics"].is_array(){return Err("pickup_compiled_preview_invalid".into());}
  self.auth.bind_reviewed_preview(data["previewToken"].as_str().unwrap().to_owned())?;self.preview=Some(data.clone());Ok(self.review())
 }
 pub(crate) fn review(&self)->Value{json!({"plan":self.plan,"preview":self.preview.as_ref().map(|v|json!({"copyObjectPath":v["copyObjectPath"],"copySaved":false,"compileStatus":v["compileStatus"],"semanticChanges":v["semanticChanges"],"compileDiagnostics":v["compileDiagnostics"]})),"assetCreated":false})}
 pub(crate) fn apply(&mut self,mut send:impl FnMut(Value)->Result<Value,String>)->Result<Value,String>{
  if self.preview.is_none()||self.applied{return Err("pickup_reviewed_preview_required".into());}
  let call=self.call("apply")?;self.applied=true;let data=self.result("apply",send(call)?)?;
  let effects=data["effects"].as_array().ok_or("pickup_effect_receipt_invalid")?;
  if data["state"]!="applied"||data["diskExists"]!=true||!data["observedDiskHash"].as_str().is_some_and(hash)||data["queryLoadsAssets"]!=false||effects.len()!=1||effects[0]["targetPackage"]!=self.plan.target_package||effects[0]["diskEffect"]!="created"||effects[0]["editorEffect"]!="compiled_loaded"||data["compileStatus"]!="up_to_date"||data["savedPackages"]!=json!([self.plan.target_package]){return Err("pickup_create_save_not_verified".into());}
  Ok(json!({"plan":self.plan,"assetCreated":true,"observedDiskHash":data["observedDiskHash"],"compileStatus":"up_to_date","savedPackages":data["savedPackages"]}))
 }
}

#[cfg(test)]mod execution_tests{
 use super::*;
 fn plan()->PickupTemplatePlan{serde_json::from_value(json!({"operationId":"11111111-1111-4111-8111-111111111111","targetPackage":"/Game/Gameplay/Pickups/BP_Pickup","expectedDiskState":"absent","templateId":"actor.pickup.native.v1","parentClass":crate::ue_pickup_template::PARENT,"itemId":"Health","promptText":"Press E","interactionRadiusCm":200,"interactionKey":"E"})).unwrap()}
 fn manifest()->Value{json!({"available":true,"projectKey":"project-owned","instanceId":"55555555-5555-4555-8555-555555555555","rootObjectId":"volume:file","allowedTarget":plan().target_package,"allowedMap":"","writeRoot":"/Game/Gameplay/Pickups","contractVersion":CONTRACT,"scopeMode":SCOPE,"productionSupported":true})}
 fn execution()->Execution{Execution::new(&manifest(),"volume:file".into(),plan(),["22222222-2222-4222-8222-222222222222".into(),"33333333-3333-4333-8333-333333333333".into(),"44444444-4444-4444-8444-444444444444".into()]).unwrap()}
 fn reply(call:&Value)->Value{
  let name=call["name"].as_str().unwrap();assert!(call["arguments"]["hostPermit"].is_string());
  let data=if name.ends_with("prepare"){json!({"prepared":true,"effect":"authorized_engine_dependency_loading_and_native_cdo_preparation"})}else if name.ends_with("preview"){json!({"previewToken":"66666666-6666-4666-8666-666666666666","copyObjectPath":"/Temp/UAgentPickupT13/BP_Copy","copySaved":false,"compileStatus":"up_to_date","semanticChanges":["create native-parent Blueprint"],"compileDiagnostics":[]})}else{json!({"state":"applied","diskExists":true,"observedDiskHash":"a".repeat(64),"queryLoadsAssets":false,"effects":[{"targetPackage":plan().target_package,"diskEffect":"created","editorEffect":"compiled_loaded"}],"compileStatus":"up_to_date","savedPackages":[plan().target_package]})};
  json!({"structuredContent":{"schemaVersion":"uagent.pickup.result.v2","contractVersion":CONTRACT,"projectKey":"project-owned","instanceId":manifest()["instanceId"],"rootObjectId":"volume:file","operation":name,"plan":plan(),"planHash":digest(b"11111111-1111-4111-8111-111111111111\n/Game/Gameplay/Pickups/BP_Pickup\nabsent\nactor.pickup.native.v1\n/Script/UAgentPickupRuntimeV2.UAgentPickupActorV2\nHealth\nPress E\n200\nE"),"data":data}})
 }
 #[test]fn execution_blake3_known_vectors_and_cpp_canonical_bytes(){assert_eq!(digest(b""),"af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262");assert_eq!(digest(b"abc"),"6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85");let canonical=b"11111111-1111-4111-8111-111111111111\n/Game/Gameplay/Pickups/BP_Pickup\nabsent\nactor.pickup.native.v1\n/Script/UAgentPickupRuntimeV2.UAgentPickupActorV2\nHealth\nPress E\n200\nE";assert_eq!(plan_hash(&plan()),digest(canonical));}
 #[test]fn execution_prepare_preview_separate_apply_and_no_permit_disclosure(){let mut e=execution();let mut calls=vec![];let review=e.preview(|c|{calls.push(c["name"].clone());Ok(reply(&c))}).unwrap();assert_eq!(calls.len(),2);assert_eq!(review["assetCreated"],false);assert!(!review.to_string().contains("previewToken"));assert!(!review.to_string().contains("hostPermit"));let result=e.apply(|c|{calls.push(c["name"].clone());Ok(reply(&c))}).unwrap();assert_eq!(result["assetCreated"],true);assert_eq!(calls.len(),3);assert!(e.apply(|_|panic!("repeated write")).is_err());}
 #[test]fn execution_transport_uncertainty_and_unreviewed_apply_never_retry(){let mut e=execution();assert!(e.apply(|_|panic!("unreviewed write")).is_err());assert!(e.preview(|_|Err("timeout".into())).is_err());assert!(e.preview(|_|panic!("retry")).is_err());let mut e=execution();e.preview(|c|Ok(reply(&c))).unwrap();assert!(e.apply(|_|Err("timeout after send".into())).is_err());assert!(e.apply(|_|panic!("repeat uncertain write")).is_err());}
 #[test]fn execution_changed_scope_hash_or_compile_status_fail_closed(){let mut m=manifest();m["rootObjectId"]=json!("other");assert!(Execution::new(&m,"volume:file".into(),plan(),["x".into(),"y".into(),"z".into()]).is_err());let mut e=execution();m=manifest();m["instanceId"]=json!("77777777-7777-4777-8777-777777777777");assert!(e.check_manifest(&m).is_err());assert!(e.preview(|c|{let mut r=reply(&c);r["structuredContent"]["planHash"]=json!("b".repeat(64));Ok(r)}).is_err());let mut e=execution();assert!(e.preview(|c|{let mut r=reply(&c);if c["name"].as_str().unwrap().ends_with("preview"){r["structuredContent"]["data"]["compileStatus"]=json!("error");}Ok(r)}).is_err());assert!(e.apply(|_|panic!("invalid preview")).is_err());}
 #[test]fn execution_binds_approved_directory_without_map_authority(){
   for (field,value) in [("writeRoot",json!("/Game/Gameplay")),("allowedMap",json!("/Game/Gameplay/Pickups/L_Map")),("contractVersion",json!("2.1.0-pickup-create-only")),("productionSupported",json!(false)),("scopeMode",json!("isolated_lab_only"))]{
    let mut m=manifest();m[field]=value;assert!(Execution::new(&m,"volume:file".into(),plan(),["x".into(),"y".into(),"z".into()]).is_err());assert!(execution().check_manifest(&m).is_err());
   }
  }
  #[test]fn execution_requires_actual_disk_and_loaded_compiled_receipt(){let mut e=execution();e.preview(|c|Ok(reply(&c))).unwrap();assert!(e.apply(|c|{let mut r=reply(&c);r["structuredContent"]["data"]["diskExists"]=json!(false);Ok(r)}).is_err());assert!(e.apply(|_|panic!("retry after malformed receipt")).is_err());}
}
