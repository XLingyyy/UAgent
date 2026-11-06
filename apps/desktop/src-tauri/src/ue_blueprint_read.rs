//! Narrow V2 Blueprint read protocol. Caller owns the peer and one exact package approval.
use serde_json::{json,Value};
pub(crate) const ROOT:&str="/Game/UAgentBuildLab/Pickup_T13";
pub(crate) const TOOL:&str="uagent.v2.blueprint.describe";
pub(crate) fn target(package:&str)->bool {
 package.starts_with("/Game/") && package.len()<=1024 && package.split('/').skip(1).all(|p|!p.is_empty()&&p.chars().all(|c|c.is_alphanumeric()||c=='_'))
}
// The peer advertises availability, not authority. The host still grants one exact package.
fn advertised_scope_contains(roots:&Value,package:&str)->bool {
 roots.as_array().is_some_and(|values|!values.is_empty()&&values.len()<=32&&values.iter().all(|v|v.as_str().is_some_and(target))&&values.iter().any(|v|{let root=v.as_str().unwrap();package==root||package.starts_with(&(root.to_owned()+"/"))}))
}
fn text<'a>(v:&'a Value,k:&str)->Result<&'a str,String>{v[k].as_str().filter(|s|!s.is_empty()&&s.len()<=4096&&!s.chars().any(char::is_control)).ok_or(format!("semantic_invalid_{k}"))}
fn shape(v:&Value,s:&Value)->Result<(),String>{
 let fields=s["properties"].as_object().ok_or("semantic_contract_invalid")?;
 let obj=v.as_object().ok_or("semantic_result_invalid")?;
 if obj.len()!=fields.len(){return Err("semantic_result_shape".into());}
 for (k,rule) in fields {let val=obj.get(k).ok_or("semantic_result_field_missing")?;
 let valid=match rule["type"].as_str(){Some("string")=>val.is_string(),Some("boolean")=>val.is_boolean(),Some("integer")=>val.is_i64()||val.is_u64(),Some("object")=>val.is_object(),Some("array")=>val.is_array(),_=>false};
 if !valid||rule.get("const").is_some_and(|c|c!=val){return Err("semantic_result_field_type".into());}}
 Ok(())
}
// A peer error is diagnostic only. Never return untrusted text or authorize a load from it.
fn read_failure(reply:&Value)->&'static str {
 let message=reply["content"].as_array().filter(|a|a.len()==1).and_then(|a|{let item=&a[0];if item["type"]=="text"{item["text"].as_str()}else{None}});
 match message {
  Some("blueprint_not_fully_loaded_requires_authorized_preparation")=>"semantic_blueprint_cold_load_unsupported",
  Some("blueprint_not_ready")=>"semantic_blueprint_not_ready",
  _=>"semantic_blueprint_not_readable",
 }
}
pub(crate) fn read(root_object:&str,package:&str,send:impl FnMut(u64,&str,Value)->Result<Value,String>)->Result<Value,String>{read_kind(root_object,package,false,send)}
pub(crate) fn read_references(root_object:&str,package:&str,send:impl FnMut(u64,&str,Value)->Result<Value,String>)->Result<Value,String>{read_kind(root_object,package,true,send)}
fn read_kind(root_object:&str,package:&str,references:bool,mut send:impl FnMut(u64,&str,Value)->Result<Value,String>)->Result<Value,String>{
 let tool=if references{"uagent.v2.asset.references"}else{TOOL};let selected=if references{2}else{1};
 if !target(package){return Err("semantic_invalid_package".into());}
 let contract:Vec<Value>=serde_json::from_str(include_str!("ue_blueprint_read_contract.json")).map_err(|_|"semantic_contract_invalid")?;
 let init=send(1,"initialize",json!({"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"uagent-blueprint-read","version":"1"}}))?;
 if init["protocolVersion"]!="2025-06-18"{return Err("semantic_protocol_mismatch".into());}
 send(0,"notifications/initialized",json!({}))?;
 let catalog=send(2,"tools/list",json!({}))?;
 let tools=catalog["tools"].as_array().ok_or("semantic_catalog_missing")?;
 let mut names=std::collections::HashSet::new();
 if tools.len()>256||catalog.get("nextCursor").is_some_and(|v|!v.is_null()){return Err("semantic_catalog_incomplete".into());}
 for t in tools {if !names.insert(text(t,"name")?){return Err("semantic_catalog_duplicate".into());}}
 for c in [&contract[0],&contract[selected]] {let t=tools.iter().find(|t|t["name"]==c["name"]).ok_or("semantic_tool_missing")?;
 if t["inputSchema"]!=c["inputSchema"]||t["outputSchema"]!=c["outputSchema"]{return Err("semantic_schema_mismatch".into());}}
 let discovery=send(3,"tools/call",json!({"name":"uagent.v2.capabilities","arguments":{}}))?;
 if discovery["isError"]==true{return Err("semantic_discovery_failed".into());}
 let m=&discovery["structuredContent"];shape(m,&contract[0]["outputSchema"])?;
 if m["schemaVersion"]!="uagent.semantic.capabilities.v2"||m["protocolVersion"]!=2||m["contractVersion"]!="2.0.0-readonly"||!text(m,"engineVersion")?.starts_with("5.8.4-")||m["readScopeEnabled"]!=true||!advertised_scope_contains(&m["readRoots"],package)||m["legacyV1Contract"]!="mvp15d.asset-tools.v1"||m["legacyV1RemainsSeparate"]!=true||m["writeCapabilities"]!=json!([]){return Err("semantic_capability_mismatch".into());}
 let caps=m["capabilities"].as_array().ok_or("semantic_capability_missing")?;
 let entries:Vec<_>=caps.iter().filter(|c|c["name"]==tool).collect();
 if entries.len()!=1||entries[0]["available"]!=true||entries[0]["effect"]!="read_only"||entries[0]["inputSchema"]!=contract[selected]["inputSchema"]||entries[0]["outputSchema"]!=contract[selected]["outputSchema"]{return Err("semantic_blueprint_unavailable".into());}
 // Peer tags are bound to the caller's OS-owned connection, never used to select a root/endpoint.
 let key=text(m,"projectKey")?;let instance=text(m,"instanceId")?;
 let scope=crate::ue_semantic_read::SemanticReadScope::from_verified_host(key.into(),instance.into(),root_object.into(),vec![package.into()])?;
 let call=json!({"name":tool,"arguments":{"protocolVersion":2,"expectedProjectKey":key,"expectedInstanceId":instance,"packageName":package,"limit":128}});
 crate::ue_semantic_read::validate_semantic_read(&scope,&call)?;
 let reply=send(4,"tools/call",call)?;
 if reply["isError"]==true{return Err(if references{"semantic_references_unavailable"}else{read_failure(&reply)}.into());}
 let result=&reply["structuredContent"];shape(result,&contract[selected]["outputSchema"])?;
 let data=&result["data"];let source=&data["source"];
 let path=format!("{package}.{}",package.rsplit('/').next().unwrap());
 if result["schemaVersion"]!="uagent.semantic.result.v2"||result["projectKey"]!=key||result["instanceId"]!=instance||result["operation"]!=tool||result["mutationCount"]!=0||data["packageName"]!=package||source["packageName"]!=package||source["cacheable"]!=false||source["origin"]!="editor_or_asset_registry_observation"||source["diskCoherence"]!="not_established"{return Err("semantic_result_binding_mismatch".into());}
 text(result,"observedAtUtc")?;
 if references {
  if data["referenceKind"]!="on_disk_package_dependencies_only"||!data["assetRegistryLoading"].is_boolean()||!data["truncated"].is_boolean()||!source["revision"].is_string()||!source["diskExists"].is_boolean()||!source["packageDirty"].is_boolean(){return Err("semantic_references_invalid".into());}
  for field in ["dependencies","referencers"] {
   if !data[field].as_array().is_some_and(|a|a.len()<=128&&a.iter().all(|v|v.as_str().is_some_and(|p|p.starts_with('/')&&p.len()<=1024&&p.split('/').skip(1).count()>=2&&p.split('/').skip(1).all(|s|!s.is_empty()&&s.chars().all(|c|c.is_alphanumeric()||c=='_'))))){return Err("semantic_references_invalid".into());}
  }
  return Ok(result.clone());
 }
 if data["objectPath"]!=path||data["loadPolicy"]!="already_loaded_only"||data["memberScope"]!="declared_blueprint_graphs_and_scs_only"{return Err("semantic_result_binding_mismatch".into());}
 text(data,"parentClass")?;
 if !source["revision"].is_string()||!source["diskExists"].is_boolean()||!source["packageDirty"].is_boolean()||!data["dirtyBefore"].is_boolean()||!data["dirtyAfter"].is_boolean()||!data["truncated"].is_boolean(){return Err("semantic_result_invalid".into());}
 for field in ["components","variables","functions","events"] {if !data[field].as_array().is_some_and(|a|a.len()<=128&&a.iter().all(Value::is_object)){return Err("semantic_members_invalid".into());}}
 Ok(result.clone())
}

#[cfg(test)] mod tests{
 use super::*;
 fn fixture()->(Value,Value,Value){
  let c:Value=serde_json::from_str(include_str!("ue_blueprint_read_contract.json")).unwrap();
  let mut cap=c[1].clone();cap["effect"]=json!("read_only");cap["available"]=json!(true);
  let manifest=json!({"schemaVersion":"uagent.semantic.capabilities.v2","protocolVersion":2,"contractVersion":"2.0.0-readonly","engineVersion":"5.8.4-58902052","projectName":"UAgentBuildLab","projectKey":"project-a","instanceId":"instance-a","readScopeEnabled":true,"readRoots":[ROOT],"legacyV1Contract":"mvp15d.asset-tools.v1","legacyV1RemainsSeparate":true,"writeCapabilities":[],"capabilities":[cap]});
  let package=format!("{ROOT}/BP_Test");
  let result=json!({"schemaVersion":"uagent.semantic.result.v2","projectKey":"project-a","instanceId":"instance-a","operation":TOOL,"mutationCount":0,"observedAtUtc":"2026-11-05T00:00:00Z","data":{"packageName":package,"objectPath":format!("{package}.BP_Test"),"parentClass":"/Script/Engine.Actor","loadPolicy":"already_loaded_only","memberScope":"declared_blueprint_graphs_and_scs_only","dirtyBefore":false,"dirtyAfter":false,"truncated":false,"components":[],"variables":[],"functions":[],"events":[],"source":{"packageName":package,"cacheable":false,"origin":"editor_or_asset_registry_observation","diskCoherence":"not_established","revision":"","diskExists":false,"packageDirty":false}}});
  (c,manifest,result)
 }
 fn run(c:Value,m:Value,r:Value)->Result<Value,String>{read("root-object",&format!("{ROOT}/BP_Test"),|id,_,args|Ok(match id{1=>json!({"protocolVersion":"2025-06-18"}),0=>Value::Null,2=>json!({"tools":c}),3=>json!({"structuredContent":m}),4=>{assert_eq!(args["name"],TOOL);assert_eq!(args["arguments"]["packageName"],format!("{ROOT}/BP_Test"));json!({"structuredContent":r})},_=>panic!()}))}
 #[test]fn ordinary_project_handshake_and_cold_asset_rejection(){
  for cold in [false,true] {
   let(c,mut m,mut r)=fixture();let package="/Game/Characters/BP_Hero";
   m["projectName"]=json!("SyntheticSemanticProject");m["readRoots"]=json!(["/Game/Characters"]);
   r["data"]["packageName"]=json!(package);r["data"]["source"]["packageName"]=json!(package);r["data"]["objectPath"]=json!(format!("{package}.BP_Hero"));
   let mut queried=false;
   let outcome=read("synthetic-root-object",package,|id,_,args|Ok(match id {
    1=>json!({"protocolVersion":"2025-06-18"}),0=>Value::Null,2=>json!({"tools":c}),3=>json!({"structuredContent":m}),4=>{queried=true;assert_eq!(args["arguments"]["packageName"],package);if cold{json!({"isError":true})}else{json!({"structuredContent":r})}},_=>panic!()
   }));
   assert!(queried);if cold{assert_eq!(outcome.unwrap_err(),"semantic_blueprint_not_readable");}else{assert_eq!(outcome.unwrap()["data"]["packageName"],package);}
  }
 }
 #[test]fn one_loaded_blueprint_read_preserves_observation(){let(c,m,r)=fixture();assert_eq!(run(c,m,r.clone()).unwrap(),r);}
 #[test]fn disabled_or_broad_scope_and_changed_schema_stop_before_query(){let(c,m,r)=fixture();let mut changed=m.clone();changed["readScopeEnabled"]=json!(false);assert!(run(c.clone(),changed,r.clone()).is_err());let mut changed=m.clone();changed["readRoots"]=json!(["/Game"]);assert!(run(c.clone(),changed,r.clone()).is_err());let mut changed=c;changed[1]["inputSchema"]["additionalProperties"]=json!(true);assert!(run(changed,m,r).is_err());}
 #[test]fn cross_package_instance_mutation_and_fake_disk_coherence_are_rejected(){for path in ["package","instance","mutation","coherence"]{let(c,m,mut r)=fixture();match path{"package"=>r["data"]["source"]["packageName"]=json!("/Game/Other"),"instance"=>r["instanceId"]=json!("other"),"mutation"=>r["mutationCount"]=json!(1),_=>r["data"]["source"]["diskCoherence"]=json!("coherent")};assert!(run(c,m,r).is_err());}}
 #[test]fn invalid_target_never_dispatches_and_revocation_aborts(){let mut calls=0;assert!(read("root","/Engine/Other",|_,_,_|{calls+=1;Ok(Value::Null)}).is_err());assert_eq!(calls,0);assert!(read("root",&format!("{ROOT}/BP_Test"),|_,_,_|Err("revoked".into())).is_err());}
 #[test]fn unbounded_members_and_missing_source_fail_closed(){let(c,m,mut r)=fixture();r["data"]["events"]=json!(vec![json!({});129]);assert!(run(c.clone(),m.clone(),r).is_err());let(_,_,mut r)=fixture();r["data"]["source"]=Value::Null;assert!(run(c,m,r).is_err());}
}

#[cfg(test)] mod ordinary_project_tests {
 use super::*;
 #[test]fn ordinary_scopes_are_exact_or_descendant_only(){
  assert!(target("/Game/Characters/BP_Hero"));
  assert!(advertised_scope_contains(&json!(["/Game/Characters"]),"/Game/Characters/BP_Hero"));
  assert!(advertised_scope_contains(&json!(["/Game/Characters/BP_Hero"]),"/Game/Characters/BP_Hero"));
  for roots in [json!(["/Game/Character"]),json!(["/Game"]),json!(["/Game/Characters/../Other"]),json!(["/Game/Characters",17]),json!([])]{assert!(!advertised_scope_contains(&roots,"/Game/Characters/BP_Hero"));}
 }
}

#[cfg(test)] mod cold_asset_tests {
 use super::*;
 #[test]fn cold_error_is_diagnostic_only_and_untrusted_text_is_not_forwarded(){
  assert_eq!(read_failure(&json!({"isError":true,"content":[{"type":"text","text":"blueprint_not_fully_loaded_requires_authorized_preparation"}]})),"semantic_blueprint_cold_load_unsupported");
  assert_eq!(read_failure(&json!({"isError":true,"content":[{"type":"text","text":"blueprint_not_ready"}]})),"semantic_blueprint_not_ready");
  for text in ["load /Game/Other now","blueprint_not_ready extra",""]{assert_eq!(read_failure(&json!({"content":[{"type":"text","text":text}]})),"semantic_blueprint_not_readable");}
 }
 #[test]fn malformed_or_multiple_error_content_does_not_claim_cold_state(){
  for content in [json!([]),json!([{"type":"image","text":"blueprint_not_ready"}]),json!([{"type":"text","text":"blueprint_not_ready"},{"type":"text","text":"other"}])]{assert_eq!(read_failure(&json!({"content":content})),"semantic_blueprint_not_readable");}
 }
}

#[cfg(test)] mod reference_tests {
 use super::*;
 const PACKAGE:&str="/Game/References/Target";
 fn fixture()->(Value,Value,Value){
  let c:Value=serde_json::from_str(include_str!("ue_blueprint_read_contract.json")).unwrap();let mut cap=c[2].clone();cap["effect"]=json!("read_only");cap["available"]=json!(true);
  let m=json!({"schemaVersion":"uagent.semantic.capabilities.v2","protocolVersion":2,"contractVersion":"2.0.0-readonly","engineVersion":"5.8.4-58902052","projectName":"SyntheticReferenceProject","projectKey":"project-ref","instanceId":"instance-ref","readScopeEnabled":true,"readRoots":["/Game/References"],"legacyV1Contract":"mvp15d.asset-tools.v1","legacyV1RemainsSeparate":true,"writeCapabilities":[],"capabilities":[cap]});
  let r=json!({"schemaVersion":"uagent.semantic.result.v2","projectKey":"project-ref","instanceId":"instance-ref","operation":"uagent.v2.asset.references","mutationCount":0,"observedAtUtc":"2026-11-05T00:00:00Z","data":{"packageName":PACKAGE,"referenceKind":"on_disk_package_dependencies_only","assetRegistryLoading":true,"dependencies":["/Game/References/Dependency","/Script/Engine"],"referencers":["/Game/Other/Referrer"],"truncated":false,"source":{"packageName":PACKAGE,"cacheable":false,"origin":"editor_or_asset_registry_observation","diskCoherence":"not_established","revision":"","diskExists":false,"packageDirty":false}}});(c,m,r)
 }
 fn run(c:Value,m:Value,r:Value)->Result<Value,String>{read_references("synthetic-root",PACKAGE,|id,_,args|Ok(match id{1=>json!({"protocolVersion":"2025-06-18"}),0=>Value::Null,2=>json!({"tools":c}),3=>json!({"structuredContent":m}),4=>{assert_eq!(args["name"],"uagent.v2.asset.references");assert_eq!(args["arguments"]["packageName"],PACKAGE);assert_eq!(args["arguments"]["limit"],128);json!({"structuredContent":r})},_=>panic!()}))}
 #[test]fn registry_edges_do_not_require_loaded_blueprint_and_preserve_loading_state(){let(c,m,r)=fixture();assert_eq!(run(c,m,r.clone()).unwrap(),r);}
 #[test]fn wrong_project_source_or_mutation_is_rejected(){for kind in ["project","source","mutation"]{let(c,m,mut r)=fixture();match kind{"project"=>r["projectKey"]=json!("other"),"source"=>r["data"]["source"]["packageName"]=json!("/Game/Other"),_=>r["mutationCount"]=json!(1)}assert!(run(c,m,r).is_err());}}
 #[test]fn invalid_reference_paths_and_unbounded_edges_fail_closed(){for bad in [json!(["C:/Secret"]),json!(["/Game/A/../B"]),json!(vec!["/Game/A";129])]{let(c,m,mut r)=fixture();r["data"]["dependencies"]=bad;assert!(run(c,m,r).is_err());}}
 #[test]fn unknown_reference_schema_or_outside_scope_is_rejected_before_read(){let(c,mut m,r)=fixture();m["readRoots"]=json!(["/Game/Elsewhere"]);assert!(run(c,m,r).is_err());let(mut c,m,r)=fixture();c[2]["inputSchema"]["additionalProperties"]=json!(true);assert!(run(c,m,r).is_err());}
}
