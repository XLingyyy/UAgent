//! Production host sequencing for the existing Lab-only scene policy, with owned transport supplied by caller.
use crate::ue_scene_batch::{SceneBatchPlan,SceneHostScope,SceneHostAuthorization,SceneHostPermits,CONTRACT,ROOT};
use serde_json::{json,Value};
pub(crate) fn negotiate(mut send:impl FnMut(u64,&str,Value)->Result<Value,String>)->Result<Value,String>{
 let init=send(1,"initialize",json!({"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"uagent-scene-batch","version":"1"}}))?;
 if init["protocolVersion"]!="2025-06-18"{return Err("scene_protocol_mismatch".into());}send(0,"notifications/initialized",json!({}))?;
 let catalog=send(2,"tools/list",json!({}))?;
 let expected:Value=serde_json::from_str(include_str!("../../../../integrations/unreal/UAgentAssetToolsV2/Resources/scene-batch-v2-schemas.json")).map_err(|_|"scene_contract_unavailable")?;
 let tools=catalog["tools"].as_array().ok_or("scene_catalog_invalid")?;let mut names=std::collections::HashSet::new();
 if tools.len()>256||catalog.get("nextCursor").is_some_and(|v|!v.is_null()){return Err("scene_catalog_incomplete".into());}
 for t in tools{if !names.insert(t["name"].as_str().ok_or("scene_tool_name_invalid")?){return Err("scene_catalog_duplicate".into());}}
 for e in expected["tools"].as_array().ok_or("scene_contract_invalid")?{let t=tools.iter().find(|t|t["name"]==e["name"]).ok_or("scene_tool_missing")?;if t["inputSchema"]!=e["inputSchema"]||t["outputSchema"]!=e["outputSchema"]{return Err("scene_schema_mismatch".into());}}
 let reply=send(3,"tools/call",json!({"name":"uagent.v2.scene.capabilities","arguments":{}}))?;if reply["isError"]==true{return Err("scene_discovery_failed".into());}
 let m=&reply["structuredContent"];
 if m["schemaVersion"]!="uagent.scene.capabilities.v2"||m["protocolVersion"]!=2||m["contractVersion"]!=CONTRACT||m["available"]!=true||m["productionSupported"]!=false||m["scopeMode"]!="approved_project_new_map_current_run"||m["writeRoot"]!=ROOT{return Err("scene_lab_contract_mismatch".into());}
 let descriptors=m["tools"].as_array().ok_or("scene_capabilities_missing")?;
 if descriptors.len()!=6{return Err("scene_capabilities_invalid".into());}
 for e in expected["tools"].as_array().unwrap().iter().skip(1){let matches:Vec<_>=descriptors.iter().filter(|t|t["name"]==e["name"]).collect();if matches.len()!=1||matches[0]["inputSchema"]!=e["inputSchema"]||matches[0]["outputSchema"]!=e["outputSchema"]{return Err("scene_schema_mismatch".into());}}
 Ok(m.clone())
}
pub(crate) struct Execution{plan:SceneBatchPlan,project:String,instance:String,root:String,run:String,auth:SceneHostAuthorization,token:Option<String>}
impl Execution{
 pub(crate) fn new(m:&Value,root:String,run:String,plan:SceneBatchPlan,permits:[String;5])->Result<Self,String>{
  if m["rootObjectId"]!=root||m["runId"]!=run||m["approvedPlans"]!=json!([plan]){return Err("scene_approved_plan_mismatch".into());}
  let project=m["projectKey"].as_str().ok_or("scene_project_missing")?.to_owned();let instance=m["instanceId"].as_str().ok_or("scene_instance_missing")?.to_owned();
  let scope=SceneHostScope::from_verified_owned_editor(project.clone(),instance.clone(),root.clone(),run.clone(),run.clone(),plan.clone())?;
  let [prepare,execute,cancel,resume,save]=permits;
  let auth=SceneHostAuthorization::new_for_verified_owned_editor(scope,SceneHostPermits{prepare,execute,cancel,resume,save:Some(save)})?;
  Ok(Self{plan,project,instance,root,run,auth,token:None})
 }
 pub(crate) fn check(&mut self,m:&Value)->Result<(),String>{if m["projectKey"]!=self.project||m["instanceId"]!=self.instance||m["rootObjectId"]!=self.root||m["runId"]!=self.run||m["approvedPlans"]!=json!([self.plan]){self.auth.revoke();return Err("scene_editor_changed".into());}Ok(())}
 pub(crate) fn step(&mut self,stage:&str,mut send:impl FnMut(Value)->Result<Value,String>)->Result<Value,String>{
  if !["prepare","execute","cancel","query","resume","save"].contains(&stage){return Err("scene_stage_invalid".into());}
  let tool=format!("uagent.v2.scene.{stage}");let mut args=json!({"protocolVersion":2,"contractVersion":CONTRACT,"expectedProjectKey":self.project,"expectedInstanceId":self.instance,"expectedRootObjectId":self.root,"runId":self.run,"plan":self.plan});
  if matches!(stage,"resume"|"save"){args["queryToken"]=json!(self.token.take().ok_or("scene_current_query_required")?);}
  let call=self.auth.authorize(&self.run,&json!({"name":tool,"arguments":args}))?;
  self.token=None;let reply=send(call)?;if reply["isError"]==true{return Err("scene_operation_failed_query_before_retry".into());}
  let data=self.auth.observe_owned_editor_result(&self.run,&tool,&reply["structuredContent"])?;
  if stage=="query"{self.token=data.query_token.clone();}
  let mut public=serde_json::to_value(data).map_err(|_|"scene_receipt_encoding")?;
  public.as_object_mut().unwrap().remove("queryToken");Ok(public)
 }
}

#[cfg(test)]mod tests{
 use super::*;
 fn guid(n:u32)->String{format!("00000000-0000-4000-8000-{n:012x}")}
 fn plan()->SceneBatchPlan{serde_json::from_value(json!({"operationId":guid(1),"targetMap":format!("{ROOT}/L_Grid"),"expectedDiskState":"absent","items":(0..20).map(|i|json!({"itemId":format!("item_{i}"),"objectName":format!("UA14_Object_{i}"),"mesh":"/Engine/BasicShapes/Cube.Cube","material":crate::ue_scene_batch::MATERIAL,"transform":{"location":{"x":i*100,"y":0,"z":50},"rotation":{"pitch":0,"yaw":0,"roll":0},"scale":{"x":1,"y":1,"z":1}}})).collect::<Vec<_>>()})).unwrap()}
 fn manifest()->Value{json!({"projectKey":"project-lab","instanceId":guid(2),"rootObjectId":"volume:file","runId":guid(3),"approvedPlans":[plan()]})}
 fn execution()->Execution{Execution::new(&manifest(),"volume:file".into(),guid(3),plan(),[guid(10),guid(11),guid(12),guid(13),guid(14)]).unwrap()}
 fn reply(call:Value,state:&str,count:usize,token:Option<u32>)->Value{
  let p:SceneBatchPlan=serde_json::from_value(call["arguments"]["plan"].clone()).unwrap();let items:Vec<_>=p.items.iter().enumerate().map(|(i,item)|if i<count{json!({"itemId":item.item_id,"objectName":item.object_name,"status":"applied","reason":"","owned":true,"actorGuid":guid(100+i as u32),"objectPath":format!("{}.L_Grid:PersistentLevel.{}",p.target_map,item.object_name),"mesh":item.mesh,"material":item.material,"transform":item.transform})}else{json!({"itemId":item.item_id,"objectName":item.object_name,"status":"not_started","reason":"","owned":false,"actorGuid":"","objectPath":"","mesh":"","material":""})}).collect();
  let mut data=json!({"state":state,"targetMap":p.target_map,"currentWorldMatches":true,"packageDirty":state!="saved","saved":state=="saved","diskExists":state=="saved","diskHash":if state=="saved"{"a".repeat(64)}else{String::new()},"conflict":false,"conflictReason":"","cancelIsRollback":false,"appliedCount":count,"items":items});if let Some(t)=token{data["queryToken"]=json!(guid(t));}
  json!({"structuredContent":{"schemaVersion":"uagent.scene.result.v2","contractVersion":CONTRACT,"projectKey":"project-lab","instanceId":guid(2),"rootObjectId":"volume:file","runId":guid(3),"operation":call["name"],"plan":p,"planHash":"b".repeat(64),"data":data}})
 }
 #[test]fn scene_partial_seven_then_fresh_query_resume_thirteen_and_separate_save(){let mut e=execution();e.step("prepare",|c|Ok(reply(c,"prepared",0,None))).unwrap();e.step("execute",|c|Ok(reply(c,"running",0,None))).unwrap();let partial=e.step("cancel",|c|Ok(reply(c,"cancelled",7,None))).unwrap();assert_eq!(partial["appliedCount"],7);assert!(e.step("resume",|_|panic!("query required")).is_err());let query=e.step("query",|c|Ok(reply(c,"cancelled",7,Some(30)))).unwrap();assert!(query.get("queryToken").is_none());e.step("resume",|c|{assert_eq!(c["arguments"]["queryToken"],guid(30));Ok(reply(c,"running",7,None))}).unwrap();e.step("query",|c|Ok(reply(c,"completed",20,Some(31)))).unwrap();let saved=e.step("save",|c|{assert!(c["arguments"]["hostPermit"].is_string());Ok(reply(c,"saved",20,None))}).unwrap();assert_eq!(saved["saved"],true);assert!(e.step("save",|_|panic!("repeat save")).is_err());}
 #[test]fn scene_uncertain_execute_cannot_replay_but_query_is_available(){let mut e=execution();e.step("prepare",|c|Ok(reply(c,"prepared",0,None))).unwrap();assert!(e.step("execute",|_|Err("transport_timeout".into())).is_err());assert!(e.step("execute",|_|panic!("replay")).is_err());assert_eq!(e.step("query",|c|Ok(reply(c,"cancelled",7,Some(30)))).unwrap()["appliedCount"],7);}
 #[test]fn scene_count_is_not_enough_and_changed_peer_revokes(){let mut e=execution();let r=e.step("query",|c|{let mut r=reply(c,"completed",20,Some(30));r["structuredContent"]["data"]["items"][5]["actorGuid"]=json!(guid(100));Ok(r)});assert!(r.is_err());assert!(e.step("save",|_|panic!("unverified object")).is_err());let mut m=manifest();m["instanceId"]=json!(guid(99));assert!(e.check(&m).is_err());assert!(e.step("query",|_|panic!("replaced peer")).is_err());}
 #[test]fn scene_exact_catalog_rejects_mismatch_before_effects(){let mut count=0;let mut schema:Value=serde_json::from_str(include_str!("../../../../integrations/unreal/UAgentAssetToolsV2/Resources/scene-batch-v2-schemas.json")).unwrap();schema["tools"][1]["inputSchema"]["additionalProperties"]=json!(true);assert!(negotiate(|id,_,_|{count+=1;Ok(match id{1=>json!({"protocolVersion":"2025-06-18"}),0=>Value::Null,2=>json!({"tools":schema["tools"]}),_=>panic!("bad schema must stop before capability query")})}).is_err());assert_eq!(count,3);}
 #[test]fn scene_single_plan_negotiation_only_dispatches_exact_discovery(){let schemas:Value=serde_json::from_str(include_str!("../../../../integrations/unreal/UAgentAssetToolsV2/Resources/scene-batch-v2-schemas.json")).unwrap();let mut m=manifest();for(k,v)in json!({"schemaVersion":"uagent.scene.capabilities.v2","protocolVersion":2,"contractVersion":CONTRACT,"available":true,"productionSupported":false,"scopeMode":"approved_project_new_map_current_run","writeRoot":ROOT,"tools":schemas["tools"].as_array().unwrap()[1..].to_vec()}).as_object().unwrap(){m[k]=v.clone();}let mut calls=vec![];let got=negotiate(|id,_,args|{calls.push(id);Ok(match id{1=>json!({"protocolVersion":"2025-06-18"}),0=>Value::Null,2=>json!({"tools":schemas["tools"]}),3=>{assert_eq!(args["name"],"uagent.v2.scene.capabilities");json!({"structuredContent":m})},_=>panic!("no effects")})}).unwrap();assert_eq!(got["approvedPlans"],json!([plan()]));assert_eq!(calls,vec![1,0,2,3]);}

 #[test]fn custom_three_objects_partial_resume_and_save_bound_to_approved_plan(){
 let mut p=plan();p.items.truncate(3);p.items[1].transform.location.x=-700.0;p.items[1].transform.rotation.yaw=45.0;p.items[2].transform.scale.z=2.5;
 let mut m=manifest();m["approvedPlans"]=json!([p]);
 let mut e=Execution::new(&m,"volume:file".into(),guid(3),p.clone(),[guid(10),guid(11),guid(12),guid(13),guid(14)]).unwrap();
 e.step("prepare",|c|{assert_eq!(c["arguments"]["plan"],json!(p));Ok(reply(c,"prepared",0,None))}).unwrap();
 e.step("execute",|c|Ok(reply(c,"running",1,None))).unwrap();
 e.step("cancel",|c|Ok(reply(c,"cancelled",1,None))).unwrap();
 assert!(e.step("save",|_|panic!("partial cannot save")).is_err());
 e.step("query",|c|Ok(reply(c,"cancelled",1,Some(30)))).unwrap();
 e.step("resume",|c|Ok(reply(c,"running",1,None))).unwrap();
 e.step("query",|c|Ok(reply(c,"completed",3,Some(31)))).unwrap();
 assert_eq!(e.step("save",|c|Ok(reply(c,"saved",3,None))).unwrap()["saved"],true);
 let mut changed=m.clone();changed["approvedPlans"][0]["items"][0]["transform"]["location"]["x"]=json!(99);assert!(e.check(&changed).is_err());
 }
}
