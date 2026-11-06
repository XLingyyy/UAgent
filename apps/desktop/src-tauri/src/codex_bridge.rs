//! Official app-server stdio protocol. No API key handling or private session-file reads.
use serde::{Serialize,Deserialize};
use serde_json::{json,Value};
use std::{collections::BTreeMap,sync::{Arc,Mutex,atomic::{AtomicBool,Ordering}},time::{Duration,Instant},io::{BufRead,BufReader,Read,Write},process::{Command,Stdio},path::Path};
#[derive(Clone,Default,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct View {pub request_id:String,pub session_id:String,pub thread_id:Option<String>,pub turn_id:Option<String>,pub status:String,pub text:String,pub persisted:bool,pub error:Option<String>,pub pending_tool:Option<ToolCall>,#[serde(skip)] pub tool_reply:Option<Value>,#[serde(skip)] pub tool_released:bool}
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct ToolCall{pub call_id:String,pub name:String,pub arguments:Value}
pub(crate) fn read_tool(name:&str)->bool{["project_list_files","project_find_files","project_read_file"].contains(&name)}
pub(crate) trait Transport {fn send(&mut self,v:Value)->Result<(),String>;fn receive(&mut self,wait:Duration)->Result<Option<Value>,String>;}
fn id(v:&Value)->Result<String,String>{let s=v.as_str().ok_or("codex_invalid_id")?;if s.is_empty()||s.len()>200||!s.bytes().all(|b|b.is_ascii_alphanumeric()||b"_-".contains(&b)){return Err("codex_invalid_id".into());}Ok(s.into())}
fn reject_request(t:&mut impl Transport,v:&Value)->Result<(),String>{t.send(json!({"id":v["id"],"error":{"code":-32601,"message":"UAgent has not approved this tool or permission request"}}))}
fn response(t:&mut impl Transport,n:u64,cancel:&AtomicBool,live:&impl Fn()->bool)->Result<Value,String>{
 let end=Instant::now()+Duration::from_secs(30);while Instant::now()<end{if cancel.load(Ordering::Acquire)||!live(){return Err("codex_cancelled".into());}if let Some(v)=t.receive(Duration::from_millis(100))?{if v.get("method").is_some()&&v.get("id").is_some(){reject_request(t,&v)?;}else if v["id"]==n{if v.get("error").is_some(){return Err("codex_server_rejected_request".into());}return v.get("result").cloned().ok_or("codex_invalid_reply".into());}}}Err("codex_reply_timeout".into())
}
#[cfg(test)]
pub(crate) fn conversation(t:&mut impl Transport,cwd:&str,model:&str,prompt:&str,resume:Option<&str>,cancel:&AtomicBool,live:impl Fn()->bool,view:&Mutex<View>,remember:impl FnMut(&str)->Result<(),String>)->Result<(),String>{
 conversation_tools(t,cwd,model,prompt,resume,cancel,live,view,remember,&[])
}
#[cfg(test)]
pub(crate) fn conversation_tools(t:&mut impl Transport,cwd:&str,model:&str,prompt:&str,resume:Option<&str>,cancel:&AtomicBool,live:impl Fn()->bool,view:&Mutex<View>,remember:impl FnMut(&str)->Result<(),String>,tools:&[Value])->Result<(),String>{
 conversation_options(t,cwd,model,prompt,resume,cancel,live,view,remember,tools,None)
}
pub(crate) fn conversation_options(t:&mut impl Transport,cwd:&str,model:&str,prompt:&str,resume:Option<&str>,cancel:&AtomicBool,live:impl Fn()->bool,view:&Mutex<View>,mut remember:impl FnMut(&str)->Result<(),String>,tools:&[Value],effort:Option<&str>)->Result<(),String>{
 t.send(json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"uagent","title":"UAgent","version":"0.1.0"},"capabilities":{"experimentalApi":true}}}))?;response(t,1,cancel,&live)?;t.send(json!({"method":"initialized","params":{}}))?;
 t.send(json!({"id":2,"method":"account/read","params":{"refreshToken":false}}))?;let account=response(t,2,cancel,&live)?;
 if account["account"]["type"]!="chatgpt"{return Err("codex_chatgpt_login_required".into());}
 if let Some(effort)=effort{let models=model_pages(t,cancel,&live)?;if !models.iter().any(|m|m.model==model&&m.supported_reasoning_efforts.iter().any(|e|e.reasoning_effort==effort)){return Err("codex_model_or_effort_unavailable".into());}}
 let mut params=json!({"cwd":cwd,"model":model,"modelProvider":"openai","approvalPolicy":"on-request","approvalsReviewer":"user","sandbox":"read-only"});
 if let Some(thread)=resume{params["threadId"]=json!(thread);params["excludeTurns"]=json!(true);}else{params["ephemeral"]=json!(false);if !tools.is_empty(){params["dynamicTools"]=json!(tools);}}
 t.send(json!({"id":3,"method":if resume.is_some(){"thread/resume"}else{"thread/start"},"params":params}))?;let thread=response(t,3,cancel,&live)?;let thread_id=id(&thread["thread"]["id"])?;
 if resume.is_some_and(|v|v!=thread_id){return Err("codex_thread_mismatch".into());}
 remember(&thread_id)?;{let mut v=view.lock().map_err(|_|"codex_unavailable")?;v.thread_id=Some(thread_id.clone());v.status="sending".into();}
 if cancel.load(Ordering::Acquire)||!live(){return Err("codex_cancelled".into());}
 t.send(json!({"id":4,"method":"turn/start","params":{"threadId":thread_id,"input":[{"type":"text","text":prompt}],"model":model,"approvalPolicy":"on-request","approvalsReviewer":"user","sandboxPolicy":{"type":"readOnly","networkAccess":false},"serviceTierForTurn":"default","effort":effort}}))?;
 // Do not discard notifications arriving before the turn/start response.
 let end=Instant::now()+Duration::from_secs(900);let mut turn:Option<String>=None;let mut parts=BTreeMap::<String,String>::new();let mut order=Vec::<String>::new();let mut seen_calls=std::collections::BTreeSet::new();let mut interrupted=false;let mut stop_at=None;
 while Instant::now()<end{
  if !live(){return Err("codex_document_closed".into());}
  if cancel.load(Ordering::Acquire)&&stop_at.is_none(){stop_at=Some(Instant::now()+Duration::from_secs(5));}
  if cancel.load(Ordering::Acquire)&&!interrupted{if let Some(turn)=&turn{t.send(json!({"id":5,"method":"turn/interrupt","params":{"threadId":thread_id,"turnId":turn}}))?;interrupted=true;stop_at=Some(Instant::now()+Duration::from_secs(5));}}
  if stop_at.is_some_and(|deadline|Instant::now()>=deadline){return Err("codex_interrupt_unconfirmed".into());}
  let Some(v)=t.receive(Duration::from_millis(100))? else {continue;};
  if v.get("method").is_some()&&v.get("id").is_some(){
   let p=&v["params"];
   if v["method"]!="item/tool/call"||!p["namespace"].is_null()||cancel.load(Ordering::Acquire)||p["threadId"]!=thread_id||turn.as_deref()!=p["turnId"].as_str()||turn.is_none()||!tools.iter().any(|tool|tool["name"]==p["tool"]) {reject_request(t,&v)?;continue;}
   let call_id=id(&p["callId"])?;let name=p["tool"].as_str().ok_or("codex_invalid_tool")?;
   if !read_tool(name)||!seen_calls.insert(call_id.clone())||!p["arguments"].is_object(){return Err("codex_invalid_tool_call".into());}
   {let mut state=view.lock().map_err(|_|"codex_unavailable")?;state.pending_tool=Some(ToolCall{call_id:call_id.clone(),name:name.into(),arguments:p["arguments"].clone()});state.tool_reply=None;state.tool_released=false;state.turn_id=turn.clone();}
   let deadline=Instant::now()+Duration::from_secs(180);
   let reply=loop{if cancel.load(Ordering::Acquire)||!live(){return Err("codex_tool_cancelled".into());}if Instant::now()>=deadline{return Err("codex_tool_approval_timeout".into());}
    {let mut state=view.lock().map_err(|_|"codex_unavailable")?;if state.tool_released{let reply=state.tool_reply.take().ok_or("codex_tool_reply_missing")?;state.pending_tool=None;state.tool_released=false;break reply;}}
    std::thread::sleep(Duration::from_millis(25));
   };
   if cancel.load(Ordering::Acquire)||!live(){return Err("codex_tool_cancelled".into());}
   t.send(json!({"id":v["id"],"result":reply}))?;continue;
  }
  if v["id"]==4{if v.get("error").is_some(){return Err("codex_turn_rejected".into());}let got=id(&v["result"]["turn"]["id"])?;if turn.as_ref().is_some_and(|old|old!=&got){return Err("codex_turn_mismatch".into());}turn=Some(got);continue;}
  let method=v["method"].as_str().unwrap_or("");let p=&v["params"];if p["threadId"]!=thread_id{continue;}
  if method=="turn/started"{let got=id(&p["turn"]["id"])?;if turn.as_ref().is_some_and(|old|old!=&got){return Err("codex_turn_mismatch".into());}turn=Some(got);}
  let event_turn=if method=="turn/completed"{p["turn"]["id"].as_str()}else{p["turnId"].as_str()};
  if event_turn.is_some()&&event_turn!=turn.as_deref(){continue;}
  if method=="item/agentMessage/delta"{let item=id(&p["itemId"])?;if !parts.contains_key(&item){order.push(item.clone());}parts.entry(item).or_default().push_str(p["delta"].as_str().ok_or("codex_invalid_delta")?);}
  if method=="item/completed"&&p["item"]["type"]=="agentMessage"{let item=id(&p["item"]["id"])?;if !parts.contains_key(&item){order.push(item.clone());}parts.insert(item,p["item"]["text"].as_str().ok_or("codex_invalid_message")?.into());}
  let text=order.iter().filter_map(|id|parts.get(id)).cloned().collect::<Vec<_>>().join("\n\n");if text.len()>1024*1024{return Err("codex_response_too_large".into());}
  {let mut state=view.lock().map_err(|_|"codex_unavailable")?;state.text=text;state.turn_id=turn.clone();state.status=if interrupted{"cancelling"}else{"streaming"}.into();}
  if method=="turn/completed"{if turn.is_none()||event_turn!=turn.as_deref(){return Err("codex_completion_without_turn".into());}let status=p["turn"]["status"].as_str().unwrap_or("unknown");if !["completed","interrupted","failed"].contains(&status){return Err("codex_unknown_completion".into());}view.lock().map_err(|_|"codex_unavailable")?.status=status.into();return Ok(());}
 }
 Err("codex_turn_timeout".into())
}
struct Pipe {input:std::process::ChildStdin,rx:std::sync::mpsc::Receiver<Result<Value,String>>}
impl Transport for Pipe{fn send(&mut self,v:Value)->Result<(),String>{let mut b=serde_json::to_vec(&v).map_err(|_|"codex_encode")?;b.push(b'\n');self.input.write_all(&b).and_then(|_|self.input.flush()).map_err(|_|"codex_pipe_write".into())}fn receive(&mut self,wait:Duration)->Result<Option<Value>,String>{match self.rx.recv_timeout(wait){Ok(v)=>v.map(Some),Err(std::sync::mpsc::RecvTimeoutError::Timeout)=>Ok(None),Err(_)=>Err("codex_process_ended".into())}}}
pub(crate) fn run(exe:&Path,cwd:&Path,model:&str,prompt:&str,resume:Option<&str>,cancel:&AtomicBool,live:impl Fn()->bool,view:&Mutex<View>,remember:impl FnMut(&str)->Result<(),String>,tools:&[Value],effort:Option<&str>)->Result<(),String>{
 let mut command=Command::new(exe);command.args(["app-server","--listen","stdio://"]).env_remove("OPENAI_API_KEY").env_remove("CODEX_API_KEY");
 with_command(command,cwd,cancel,&live,|t|conversation_options(t,&cwd.to_string_lossy(),model,prompt,resume,cancel,&live,view,remember,tools,effort))
}
#[cfg(test)]
fn run_command(mut command:Command,cwd:&Path,model:&str,prompt:&str,resume:Option<&str>,cancel:&AtomicBool,live:impl Fn()->bool,view:&Mutex<View>,remember:impl FnMut(&str)->Result<(),String>,tools:&[Value])->Result<(),String>{
 with_command(command,cwd,cancel,&live,|t|conversation_tools(t,&cwd.to_string_lossy(),model,prompt,resume,cancel,&live,view,remember,tools))
}
fn with_command<T>(mut command:Command,cwd:&Path,cancel:&AtomicBool,live:&impl Fn()->bool,action:impl FnOnce(&mut Pipe)->Result<T,String>)->Result<T,String>{
 use std::os::windows::process::CommandExt;
 if cancel.load(Ordering::Acquire)||!live(){return Err("codex_cancelled_before_start".into());}
 let job=crate::ue_build_process::windows_job::OwnedJob::new().map_err(|_|"codex_job_failed")?;
 let mut child=command.current_dir(cwd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).creation_flags(0x08000004).spawn().map_err(|_|"codex_start_failed")?;
 if job.assign(&child).and_then(|_|job.resume(&child)).is_err(){let _=child.kill();let _=child.wait();return Err("codex_job_failed".into());}
 let stdout=child.stdout.take().ok_or("codex_stdout")?;let input=child.stdin.take().ok_or("codex_stdin")?;let(tx,rx)=std::sync::mpsc::sync_channel(64);
 let reader=std::thread::spawn(move||{let mut reader=BufReader::new(stdout);loop{let mut line=String::new();match reader.by_ref().take(2*1024*1024+1).read_line(&mut line){Ok(0)=>break,Ok(_)=>{let value=if line.len()>2*1024*1024{Err("codex_message_too_large".into())}else{serde_json::from_str(&line).map_err(|_|"codex_invalid_json".into())};let failed=value.is_err();if tx.send(value).is_err()||failed{break;}},Err(_)=>break}}});
 let result=action(&mut Pipe{input,rx});
 let terminated=job.terminate().is_ok();drop(job);let _=child.wait();let _=reader.join();if !terminated{return Err("codex_cleanup_unconfirmed".into());}result
}

#[cfg(test)]mod tests{
 use super::*;use std::collections::VecDeque;
 struct Mock{queue:VecDeque<Value>,sent:Vec<Value>,account:&'static str,cancel:Option<Arc<AtomicBool>>}
 impl Transport for Mock{
 fn send(&mut self,v:Value)->Result<(),String>{let method=v["method"].as_str().unwrap_or("");match method{
 "initialize"=>self.queue.push_back(json!({"id":1,"result":{}})),
 "account/read"=>self.queue.push_back(json!({"id":2,"result":{"account":{"type":self.account}}})),
 "thread/start"|"thread/resume"=>self.queue.push_back(json!({"id":3,"result":{"thread":{"id":"thread_mock"}}})),
 "turn/start"=>{self.queue.extend([
 json!({"method":"turn/started","params":{"threadId":"thread_mock","turn":{"id":"turn_mock"}}}),
 json!({"method":"item/agentMessage/delta","params":{"threadId":"thread_mock","turnId":"turn_mock","itemId":"item_mock","delta":"Hello"}}),
 json!({"id":4,"result":{"turn":{"id":"turn_mock"}}}),
 json!({"id":99,"method":"item/commandExecution/requestApproval","params":{}})]);
 if self.cancel.is_none(){self.queue.push_back(json!({"method":"item/agentMessage/delta","params":{"threadId":"OTHER","turnId":"turn_mock","itemId":"wrong","delta":"WRONG"}}));self.queue.push_back(json!({"method":"turn/completed","params":{"threadId":"thread_mock","turn":{"id":"turn_mock","status":"completed"}}}));}},
 "turn/interrupt"=>self.queue.push_back(json!({"method":"turn/completed","params":{"threadId":"thread_mock","turn":{"id":"turn_mock","status":"interrupted"}}})),_=>{}}
 self.sent.push(v);Ok(())}
 fn receive(&mut self,_:Duration)->Result<Option<Value>,String>{let v=self.queue.pop_front().ok_or("mock_no_reply")?;if v["method"]=="turn/started"{if let Some(c)=&self.cancel{c.store(true,Ordering::Release);}}Ok(Some(v))}}
 fn mock()->Mock{Mock{queue:VecDeque::new(),sent:vec![],account:"chatgpt",cancel:None}}
 #[test]fn stream_before_reply_and_resume_link_persisted_before_send(){
 let mut t=mock();let view=Mutex::new(View::default());let stored=AtomicBool::new(false);
 conversation(&mut t,"E:/Synthetic","test-model","synthetic",Some("thread_mock"),&AtomicBool::new(false),||true,&view,|id|{assert_eq!(id,"thread_mock");stored.store(true,Ordering::SeqCst);Ok(())}).unwrap();assert!(stored.load(Ordering::SeqCst));assert_eq!(view.lock().unwrap().text,"Hello");assert_eq!(view.lock().unwrap().status,"completed");assert!(t.sent.iter().any(|v|v["id"]==99&&v.get("error").is_some()));assert!(t.sent.iter().any(|v|v["method"]=="thread/resume"));let turn=t.sent.iter().find(|v|v["method"]=="turn/start").unwrap();assert_eq!(turn["params"]["sandboxPolicy"]["type"],"readOnly");
 }
 #[test]fn cancelled_turn_interrupts_exact_thread_and_turn(){let cancel=Arc::new(AtomicBool::new(false));let mut t=mock();t.cancel=Some(cancel.clone());let view=Mutex::new(View::default());conversation(&mut t,"E:/Synthetic","test-model","synthetic",None,&cancel,||true,&view,|_|Ok(())).unwrap();assert_eq!(view.lock().unwrap().status,"interrupted");let request=t.sent.iter().find(|v|v["method"]=="turn/interrupt").unwrap();assert_eq!(request["params"],json!({"threadId":"thread_mock","turnId":"turn_mock"}));}
 #[test]fn api_key_login_and_failed_link_never_send(){for fail_link in [false,true]{let mut t=mock();if !fail_link{t.account="apiKey";}assert!(conversation(&mut t,"E:/Synthetic","test-model","synthetic",None,&AtomicBool::new(false),||true,&Mutex::new(View::default()),|_|Err("disk failure".into())).is_err());assert!(!t.sent.iter().any(|v|v["method"]=="turn/start"));}}
 #[test]fn sqlite_link_survives_reopen_and_uncertain_turn_cannot_replay(){
 use crate::local_run_store::{RunStore,Project};let base=Path::new("E:/Codex/UAgent/2026-10-29/tmp").join(format!("codex-synthetic-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));std::fs::create_dir_all(&base).unwrap();
 let db=RunStore::open(base.join("store")).unwrap();db.create_project(&Project{id:"p".into(),root:base.to_string_lossy().into(),label:"synthetic".into(),created_at:1}).unwrap();assert_eq!(db.codex_begin("p","s","one","synthetic",2,false).unwrap(),None);assert!(db.codex_begin("p","s","two","duplicate",3,true).is_err());db.codex_remember("p","s","one","thread_mock").unwrap();db.codex_finish("p","s","one","Hello",true,"completed",4).unwrap();drop(db);
 let db=RunStore::open(base.join("store")).unwrap();assert_eq!(db.codex_begin("p","s","two","again",5,true).unwrap().as_deref(),Some("thread_mock"));assert!(db.codex_finish("p","s","one","stale",true,"completed",6).is_err());db.codex_finish("p","s","two","partial",false,"uncertain",6).unwrap();assert!(db.codex_begin("p","s","three","no replay",7,true).is_err());assert!(db.codex_links("other").unwrap().is_empty());assert_eq!(db.codex_links("p").unwrap()[0].state,"uncertain");
 }
 #[test]fn real_owned_stdio_mock_process_streams_and_exits(){
 let python=std::env::var("UAGENT_TEST_PYTHON").unwrap();let script=std::env::var("UAGENT_CODEX_MOCK_SCRIPT").unwrap();let mut command=Command::new(python);command.args(["-u",&script]);let view=Mutex::new(View::default());
 run_command(command,Path::new("E:/Codex/UAgent/2026-10-29/tmp"),"synthetic","test",None,&AtomicBool::new(false),||true,&view,|_|Ok(()),&[]).unwrap();assert_eq!(view.lock().unwrap().text,"pipe mock output");assert_eq!(view.lock().unwrap().status,"completed");
 }
 #[test]fn collaboration_links_are_isolated_durable_and_cannot_be_replayed_from_other_contexts(){
 use crate::local_run_store::{RunStore,Project};let base=Path::new("E:/Codex/UAgent/2026-10-29/tmp").join(format!("codex-members-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));std::fs::create_dir_all(&base).unwrap();
 let db=RunStore::open(base.join("store")).unwrap();db.create_project(&Project{id:"p".into(),root:base.to_string_lossy().into(),label:"synthetic".into(),created_at:1}).unwrap();
 for role in ["investigator","reviewer"]{db.codex_begin_scoped("p",role,role,"synthetic",2,false,Some(("run",role))).unwrap();db.codex_remember("p",role,role,&format!("thread_{role}")).unwrap();db.codex_finish("p",role,role,"report",true,"completed",3).unwrap();}
 assert!(db.codex_begin_scoped("p","duplicate","dup","no",4,false,Some(("run","investigator"))).is_err());drop(db);
 let db=RunStore::open(base.join("store")).unwrap();let links=db.codex_links("p").unwrap();assert_eq!(links.len(),2);assert!(links.iter().all(|l|l.run_id.as_deref()==Some("run")&&l.member_id.as_deref()==Some(&l.session_id)));
 assert!(db.codex_begin("p","investigator","q","no",4,true).is_err());assert!(db.codex_begin_scoped("p","investigator","q","no",4,true,Some(("another_run","investigator"))).is_err());assert!(db.codex_begin_scoped("p","investigator","q","no",4,true,Some(("run","reviewer"))).is_err());
 assert_eq!(db.codex_begin_scoped("p","investigator","q","yes",4,true,Some(("run","investigator"))).unwrap().as_deref(),Some("thread_investigator"));assert!(db.codex_begin_scoped("p","investigator","again","no",5,true,Some(("run","investigator"))).is_err());assert_eq!(db.codex_links("p").unwrap().iter().find(|l|l.session_id=="reviewer").unwrap().state,"idle");
 }
 #[test]fn lead_planning_thread_reopens_for_synthesis_without_member_context_promotion(){
 use crate::local_run_store::{RunStore,Project};let base=Path::new("E:/Codex/UAgent/2026-10-29/tmp").join(format!("codex-lead-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));std::fs::create_dir_all(&base).unwrap();let db=RunStore::open(base.join("store")).unwrap();db.create_project(&Project{id:"p".into(),root:base.to_string_lossy().into(),label:"synthetic".into(),created_at:1}).unwrap();
 db.codex_begin_scoped("p","lead-session","plan","synthetic plan",2,false,Some(("parent","lead"))).unwrap();db.codex_remember("p","lead-session","plan","lead-thread").unwrap();db.codex_finish("p","lead-session","plan","assigned",true,"completed",3).unwrap();
 db.codex_begin_scoped("p","child-session","report","synthetic report",4,false,Some(("parent:investigator","investigator"))).unwrap();db.codex_remember("p","child-session","report","child-thread").unwrap();db.codex_finish("p","child-session","report","report",true,"completed",5).unwrap();drop(db);
 let db=RunStore::open(base.join("store")).unwrap();assert!(db.codex_begin_scoped("p","child-session","wrong","no",6,true,Some(("parent","lead"))).is_err());assert_eq!(db.codex_begin_scoped("p","lead-session","synthesis","synthetic evidence",6,true,Some(("parent","lead"))).unwrap().as_deref(),Some("lead-thread"));db.codex_finish("p","lead-session","synthesis","final report",true,"completed",7).unwrap();let links=db.codex_links("p").unwrap();assert_eq!(links.iter().find(|l|l.member_id.as_deref()==Some("lead")).unwrap().run_id.as_deref(),Some("parent"));
 }
 use std::time::{SystemTime,UNIX_EPOCH};
}

#[cfg(test)]mod dynamic_tests{
 use super::*;use std::collections::VecDeque;
 struct Mock{sent:Vec<Value>,queue:VecDeque<Value>}
 impl Transport for Mock{fn send(&mut self,v:Value)->Result<(),String>{self.sent.push(v);Ok(())}fn receive(&mut self,_:Duration)->Result<Option<Value>,String>{self.queue.pop_front().map(Some).ok_or("mock_empty".into())}}
 fn mock(thread:&str)->Mock{Mock{sent:vec![],queue:VecDeque::from(vec![json!({"id":1,"result":{}}),json!({"id":2,"result":{"account":{"type":"chatgpt"}}}),json!({"id":3,"result":{"thread":{"id":"t"}}}),json!({"id":4,"result":{"turn":{"id":"u"}}}),json!({"id":"rpc-call","method":"item/tool/call","params":{"threadId":thread,"turnId":"u","callId":"call","tool":"project_read_file","arguments":{"path":"Source/A.cpp"}}}),json!({"method":"turn/completed","params":{"threadId":"t","turn":{"id":"u","status":"completed"}}})])}}
 fn tools()->Vec<Value>{vec![json!({"type":"function","name":"project_read_file","description":"read synthetic","inputSchema":{"type":"object"}})]}
 #[test]fn dynamic_reply_waits_for_release_and_preserves_exact_approved_body(){
 let view=Mutex::new(View::default());let cancel=AtomicBool::new(false);let mut t=mock("t");
 std::thread::scope(|scope|{scope.spawn(||{let deadline=Instant::now()+Duration::from_secs(5);loop{assert!(Instant::now()<deadline);{let mut v=view.lock().unwrap();if v.pending_tool.is_some(){assert_eq!(v.pending_tool.as_ref().unwrap().arguments["path"],"Source/A.cpp");v.tool_reply=Some(json!({"contentItems":[{"type":"inputText","text":"SYNTHETIC exact \n body"}],"success":true}));break;}}std::thread::sleep(Duration::from_millis(5));}std::thread::sleep(Duration::from_millis(40));let mut v=view.lock().unwrap();assert!(v.pending_tool.is_some());assert!(v.tool_reply.is_some());v.tool_released=true;});
 conversation_tools(&mut t,"E:/Synthetic","test","synthetic",None,&cancel,||true,&view,|_|Ok(()),&tools()).unwrap();});
 let reply=t.sent.iter().find(|v|v["id"]=="rpc-call").unwrap();assert_eq!(reply["result"]["contentItems"][0]["text"],"SYNTHETIC exact \n body");assert!(t.sent.iter().any(|v|v["method"]=="initialize"&&v["params"]["capabilities"]["experimentalApi"]==true));assert!(t.sent.iter().any(|v|v["method"]=="thread/start"&&v["params"]["dynamicTools"][0]["name"]=="project_read_file"));assert!(view.lock().unwrap().pending_tool.is_none());
 }
 #[test]fn dynamic_wrong_thread_and_unoffered_tool_are_rejected_without_payload(){for (thread,enabled) in [("other",true),("t",false)]{let mut t=mock(thread);let definitions=if enabled{tools()}else{vec![]};conversation_tools(&mut t,"E:/Synthetic","test","synthetic",None,&AtomicBool::new(false),||true,&Mutex::new(View::default()),|_|Ok(()),&definitions).unwrap();let reply=t.sent.iter().find(|v|v["id"]=="rpc-call").unwrap();assert!(reply.get("error").is_some());assert!(reply.get("result").is_none());}}
 #[test]fn dynamic_cancelled_during_approval_never_sends_result(){let view=Mutex::new(View::default());let cancel=AtomicBool::new(false);let mut t=mock("t");std::thread::scope(|scope|{scope.spawn(||{let deadline=Instant::now()+Duration::from_secs(5);loop{assert!(Instant::now()<deadline);if view.lock().unwrap().pending_tool.is_some(){cancel.store(true,Ordering::Release);break;}std::thread::sleep(Duration::from_millis(5));}});assert_eq!(conversation_tools(&mut t,"E:/Synthetic","test","synthetic",None,&cancel,||true,&view,|_|Ok(()),&tools()).unwrap_err(),"codex_tool_cancelled");});assert!(!t.sent.iter().any(|v|v["id"]=="rpc-call"&&v.get("result").is_some()));}
}

#[derive(Clone,Serialize,Deserialize)]#[serde(rename_all="camelCase")]
pub(crate) struct ReasoningOption{pub reasoning_effort:String,pub description:String}
#[derive(Clone,Serialize,Deserialize)]#[serde(rename_all="camelCase")]
pub(crate) struct CatalogModel{pub model:String,pub display_name:String,pub description:String,pub hidden:bool,pub is_default:bool,pub default_reasoning_effort:String,pub supported_reasoning_efforts:Vec<ReasoningOption>}
fn model_pages(t:&mut impl Transport,cancel:&AtomicBool,live:&impl Fn()->bool)->Result<Vec<CatalogModel>,String>{
 let mut models=Vec::new();let mut cursor:Option<String>=None;let mut cursors=std::collections::BTreeSet::new();
 for page in 0..10{let n=100+page;t.send(json!({"id":n,"method":"model/list","params":{"cursor":cursor,"limit":100,"includeHidden":false}}))?;let result=response(t,n,cancel,live)?;
 let data:Vec<CatalogModel>=serde_json::from_value(result["data"].clone()).map_err(|_|"codex_catalog_invalid")?;
 for m in data{if m.hidden{continue;}if m.model.is_empty()||m.supported_reasoning_efforts.is_empty()||!m.supported_reasoning_efforts.iter().any(|e|e.reasoning_effort==m.default_reasoning_effort){return Err("codex_catalog_invalid".into());}if !models.iter().any(|v:&CatalogModel|v.model==m.model){models.push(m);}}
 if result["nextCursor"].is_null(){return Ok(models);}let next=result["nextCursor"].as_str().filter(|v|!v.is_empty()).ok_or("codex_catalog_cursor")?.to_string();if !cursors.insert(next.clone()){return Err("codex_catalog_cursor".into());}cursor=Some(next);
 }Err("codex_catalog_incomplete".into())
}
pub(crate) fn catalog(t:&mut impl Transport,cancel:&AtomicBool,live:impl Fn()->bool)->Result<Vec<CatalogModel>,String>{
 t.send(json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"uagent","title":"UAgent","version":"0.1.0"},"capabilities":{"experimentalApi":true}}}))?;response(t,1,cancel,&live)?;t.send(json!({"method":"initialized","params":{}}))?;model_pages(t,cancel,&live)
}
pub(crate) fn list_models(exe:&Path,cwd:&Path,live:impl Fn()->bool)->Result<Vec<CatalogModel>,String>{let mut command=Command::new(exe);command.args(["app-server","--listen","stdio://"]).env_remove("OPENAI_API_KEY").env_remove("CODEX_API_KEY");let cancel=AtomicBool::new(false);with_command(command,cwd,&cancel,&live,|t|catalog(t,&cancel,&live))}

#[cfg(test)]mod model_tests{
 use super::*;use std::collections::VecDeque;
 struct Mock{sent:Vec<Value>,queue:VecDeque<Value>,loop_cursor:bool}
 fn model(name:&str,hidden:bool)->Value{json!({"model":name,"displayName":name,"description":"synthetic","hidden":hidden,"isDefault":true,"defaultReasoningEffort":"balanced","supportedReasoningEfforts":[{"reasoningEffort":"balanced","description":"synthetic balanced"},{"reasoningEffort":"deep","description":"synthetic deep"}]})}
 impl Transport for Mock{
 fn send(&mut self,v:Value)->Result<(),String>{match v["method"].as_str().unwrap_or(""){
 "initialize"=>self.queue.push_back(json!({"id":1,"result":{}})),
 "account/read"=>self.queue.push_back(json!({"id":2,"result":{"account":{"type":"chatgpt"}}})),
 "model/list"=>{let first=v["params"]["cursor"].is_null();self.queue.push_back(json!({"id":v["id"],"result":{"data":if first{vec![model("model-a",false),model("hidden",true)]}else{vec![model("model-b",false)]},"nextCursor":if first||self.loop_cursor{Some("page-2")}else{None}}}));},
 "thread/start"|"thread/resume"=>self.queue.push_back(json!({"id":3,"result":{"thread":{"id":"t"}}})),
 "turn/start"=>{self.queue.push_back(json!({"id":4,"result":{"turn":{"id":"u"}}}));self.queue.push_back(json!({"method":"turn/completed","params":{"threadId":"t","turn":{"id":"u","status":"completed"}}}));},_=>{}}
 self.sent.push(v);Ok(())}
 fn receive(&mut self,_:Duration)->Result<Option<Value>,String>{self.queue.pop_front().map(Some).ok_or("mock_no_reply".into())}}
 fn mock()->Mock{Mock{sent:vec![],queue:VecDeque::new(),loop_cursor:false}}
 #[test]fn catalog_pages_hide_hidden_and_never_read_account_or_start_turn(){let mut t=mock();let models=catalog(&mut t,&AtomicBool::new(false),||true).unwrap();assert_eq!(models.iter().map(|m|m.model.as_str()).collect::<Vec<_>>(),vec!["model-a","model-b"]);assert!(!t.sent.iter().any(|v|["account/read","thread/start","turn/start"].contains(&v["method"].as_str().unwrap_or(""))));let mut repeated=mock();repeated.loop_cursor=true;assert_eq!(catalog(&mut repeated,&AtomicBool::new(false),||true).err().unwrap(),"codex_catalog_cursor");}
 #[test]fn chosen_model_and_effort_reach_turn_with_default_tier(){let mut t=mock();conversation_options(&mut t,"E:/Synthetic","model-b","synthetic",None,&AtomicBool::new(false),||true,&Mutex::new(View::default()),|_|Ok(()),&[],Some("deep")).unwrap();let v=t.sent.iter().find(|v|v["method"]=="turn/start").unwrap();assert_eq!(v["params"]["model"],"model-b");assert_eq!(v["params"]["effort"],"deep");assert_eq!(v["params"]["serviceTierForTurn"],"default");}
 #[test]fn stale_model_or_effort_cannot_start_thread_or_send_prompt(){for (model,effort) in [("not-listed","deep"),("model-b","not-listed"),("hidden","deep")]{let mut t=mock();assert_eq!(conversation_options(&mut t,"E:/Synthetic",model,"SYNTHETIC_SECRET",None,&AtomicBool::new(false),||true,&Mutex::new(View::default()),|_|Ok(()),&[],Some(effort)).err().unwrap(),"codex_model_or_effort_unavailable");assert!(!t.sent.iter().any(|v|["thread/start","turn/start"].contains(&v["method"].as_str().unwrap_or(""))));}}
 #[test]fn preferences_survive_sqlite_reopen_scoped_by_project_and_role(){use crate::local_run_store::{RunStore,codex_sessions::ModelPreference};let base=Path::new("E:/Codex/UAgent/2026-10-29/tmp").join(format!("codex-model-prefs-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));std::fs::create_dir_all(&base).unwrap();let db=RunStore::open(base.join("store")).unwrap();for(role,effort)in [("lead","deep"),("investigator","balanced")]{db.save_codex_model_preference("p",role,&ModelPreference{executable:"E:/Synthetic/codex.exe".into(),model:"model-b".into(),effort:effort.into()}).unwrap();}drop(db);let db=RunStore::open(base.join("store")).unwrap();assert_eq!(db.codex_model_preference("p","lead").unwrap().unwrap().effort,"deep");assert_eq!(db.codex_model_preference("p","investigator").unwrap().unwrap().effort,"balanced");assert!(db.codex_model_preference("other","lead").unwrap().is_none());assert!(db.codex_model_preference("p","reviewer").unwrap().is_none());db.create_project(&crate::local_run_store::Project{id:"p".into(),root:base.to_string_lossy().into(),label:"synthetic".into(),created_at:1}).unwrap();db.codex_begin("p","session","request","synthetic",2,false).unwrap();db.codex_record_selection("p","session","request","model-b",Some("deep"),3).unwrap();assert!(db.messages("p","session",-1,10).unwrap().iter().any(|m|m.body.contains("model-b; reasoning effort: deep; service tier: default")));}
}
