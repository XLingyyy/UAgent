//! Exact discovery only: schemas and peer capabilities never confer mutation permission.
use serde_json::Value;
use crate::ue_pickup_template::{CONTRACT,SCOPE,target_directory};
pub(crate) fn validate_catalog(value: &Value) -> Result<(), String> {
    let tools=value.get("tools").and_then(Value::as_array).ok_or("pickup_catalog_invalid")?;
    if tools.len()>256 || value.get("nextCursor").is_some_and(|v| !v.is_null()) { return Err("pickup_catalog_incomplete".into()); }
    let expected: Vec<Value>=serde_json::from_str(include_str!("ue_pickup_tool_contract.json")).map_err(|_|"pickup_contract_unavailable")?;
    let mut names=std::collections::HashSet::new();
    for tool in tools { let name=tool.get("name").and_then(Value::as_str).ok_or("pickup_catalog_invalid")?;
        if !names.insert(name) { return Err("pickup_catalog_ambiguous".into()); }
    }
    for entry in expected {
        let actual=tools.iter().find(|v|v.get("name")==entry.get("name")).ok_or("pickup_tool_missing")?;
        if actual.get("inputSchema")!=entry.get("inputSchema") || actual.get("outputSchema")!=entry.get("outputSchema") {return Err("pickup_schema_mismatch".into());}
    }
    Ok(())
}
pub(crate) fn validate_capabilities(value: &Value) -> Result<bool, String> {
    if value.get("isError")==Some(&Value::Bool(true)) {return Err("pickup_discovery_failed".into());}
    let m=value.get("structuredContent").ok_or("pickup_structured_result_required")?;
    if m["schemaVersion"]!="uagent.pickup.capabilities.v2" || m["protocolVersion"]!=2
        || m["contractVersion"]!=CONTRACT || m["productionSupported"]!=true
        || m["scopeMode"]!=SCOPE || m["allowedMap"]!=""
        || m["parentClass"]!="/Script/UAgentPickupRuntimeV2.UAgentPickupActorV2"
        || !m["projectKey"].as_str().is_some_and(|v|!v.is_empty())
        || !m["instanceId"].as_str().is_some_and(|v|!v.is_empty()) {
        return Err("pickup_contract_mismatch".into());
    }
    let expected: Vec<Value>=serde_json::from_str(include_str!("ue_pickup_tool_contract.json")).map_err(|_|"pickup_contract_unavailable")?;
    let entries=m["tools"].as_array().ok_or("pickup_capabilities_invalid")?;
    if entries.len()!=4 {return Err("pickup_capabilities_invalid".into());}
    for tool in expected.iter().skip(1) {
        let matching:Vec<_>=entries.iter().filter(|v|v["name"]==tool["name"]).collect();
        if matching.len()!=1 || matching[0]["inputSchema"]!=tool["inputSchema"] || matching[0]["outputSchema"]!=tool["outputSchema"] {return Err("pickup_schema_mismatch".into());}
    }
    let available=m["available"].as_bool().ok_or("pickup_capabilities_invalid")?;
    if available {
        let target=m["allowedTarget"].as_str().ok_or("pickup_capabilities_invalid")?;
        if m["writeRoot"]!=target_directory(target)? {return Err("pickup_contract_mismatch".into());}
    } else if m["writeRoot"]!=""||m["allowedTarget"]!="" {return Err("pickup_contract_mismatch".into());}
    Ok(available)
}
#[cfg(test)] mod tests {
 use super::*; use serde_json::json;
 #[test] fn exact_catalog_and_changed_schema() {
  let tools:Value=serde_json::from_str(include_str!("ue_pickup_tool_contract.json")).unwrap();
  let mut v=json!({"tools":tools});assert!(validate_catalog(&v).is_ok());
  v["tools"][1]["inputSchema"]["additionalProperties"]=json!(true);assert!(validate_catalog(&v).is_err());
 }
 #[test] fn duplicate_missing_and_paginated_tools_fail_closed() {
  let tools:Value=serde_json::from_str(include_str!("ue_pickup_tool_contract.json")).unwrap();
  let mut v=json!({"tools":tools});let duplicate=v["tools"][0].clone();v["tools"].as_array_mut().unwrap().push(duplicate);assert!(validate_catalog(&v).is_err());
  assert!(validate_catalog(&json!({"tools":[]})).is_err());
  v["nextCursor"]=json!("more");assert!(validate_catalog(&v).is_err());
 }
}

pub(crate) fn negotiate(mut exchange:impl FnMut(u64,&str,Value)->Result<Value,String>)->Result<bool,String>{
 let init=exchange(1,"initialize",serde_json::json!({"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"uagent-pickup-discovery","version":"1"}}))?;
 if init["protocolVersion"]!="2025-06-18"{return Err("pickup_protocol_mismatch".into());}
 exchange(0,"notifications/initialized",serde_json::json!({}))?;
 validate_catalog(&exchange(2,"tools/list",serde_json::json!({}))?)?;
 validate_capabilities(&exchange(3,"tools/call",serde_json::json!({"name":"uagent.v2.pickup.capabilities","arguments":{}}))?)
}

#[cfg(test)] mod handshake_tests {
 use super::*;use serde_json::json;
 fn fixture()->Value{serde_json::from_str(include_str!("../../../../packages/runtime/src/__fixtures__/ue-pickup-approved-project-v2-discovery.json")).unwrap()}
 #[test]fn owned_negotiation_only_uses_discovery_and_rejects_changed_protocol(){
  let f=fixture();let mut calls=Vec::new();
  assert_eq!(negotiate(|id,method,params|{calls.push((id,method.to_string()));Ok(match id{1=>json!({"protocolVersion":"2025-06-18"}),0=>Value::Null,2=>json!({"tools":f["catalog"]}),3=>{assert_eq!(params,json!({"name":"uagent.v2.pickup.capabilities","arguments":{}}));json!({"structuredContent":f["manifest"]})},_=>panic!("unexpected request")})}).unwrap(),true);
  assert_eq!(calls.iter().map(|x|x.0).collect::<Vec<_>>(),vec![1,0,2,3]);
  let mut count=0;assert!(negotiate(|_,_,_|{count+=1;Ok(json!({"protocolVersion":"wrong"}))}).is_err());assert_eq!(count,1);
 }
 #[test]fn supported_plugin_without_approval_has_no_available_scope(){
   let mut value=json!({"structuredContent":fixture()["manifest"]});
   value["structuredContent"]["available"]=json!(false);value["structuredContent"]["writeRoot"]=json!("");value["structuredContent"]["allowedTarget"]=json!("");
   assert_eq!(validate_capabilities(&value).unwrap(),false);
   value["structuredContent"]["writeRoot"]=json!("/Game/Gameplay/Pickups");assert!(validate_capabilities(&value).is_err());
  }
  #[test]fn transport_revocation_and_legacy_scope_cannot_succeed(){
  let f=fixture();let mut count=0;
  assert!(negotiate(|id,_,_|{count+=1;if id==2{Err("pickup_connection_changed".into())}else{Ok(json!({"protocolVersion":"2025-06-18"}))}}).is_err());assert_eq!(count,3);
  let mut value=json!({"structuredContent":f["manifest"]});value["structuredContent"]["scopeMode"]=json!("isolated_lab_only");assert!(validate_capabilities(&value).is_err());
 }
}

pub(crate) fn rpc_result(body:&str,sse:bool,id:u64)->Result<Value,String>{
 let data=if sse {
  let mut data=Vec::new();let mut finished=false;
  for line in body.lines(){let line=line.trim_end_matches('\r');
   if line.is_empty(){if !data.is_empty(){finished=true;}continue;}
   if let Some(value)=line.strip_prefix("data:"){if finished{return Err("pickup_multiple_rpc_events".into());}data.push(value.strip_prefix(' ').unwrap_or(value));}
  }
  if data.is_empty()||!finished{return Err("pickup_incomplete_rpc_event".into());}data.join("\n")
 }else{body.to_string()};
 let envelope:Value=serde_json::from_str(&data).map_err(|_|"pickup_response_invalid")?;
 if envelope["jsonrpc"]!="2.0"||envelope["id"]!=id||envelope.get("error").is_some(){return Err("pickup_rpc_failed".into());}
 envelope.get("result").cloned().ok_or("pickup_result_missing".into())
}
#[cfg(test)]mod wire_tests{
 use super::*;use serde_json::json;
 #[test]fn pickup_wire_json_and_sse_are_bound_to_request(){
  let body="{\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{\"ok\":true}}";
  assert_eq!(rpc_result(body,false,3).unwrap(),json!({"ok":true}));
  let event=format!(": heartbeat\r\nevent: message\r\ndata: {body}\r\n\r\n");
  assert_eq!(rpc_result(&event,true,3).unwrap(),json!({"ok":true}));
  assert!(rpc_result(&event,true,2).is_err());assert!(rpc_result(&format!("data: {body}"),true,3).is_err());
  assert!(rpc_result(&format!("{event}{event}"),true,3).is_err());
 }
}
