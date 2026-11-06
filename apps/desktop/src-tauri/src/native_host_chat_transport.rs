//! Non-streaming tool replies over the existing fixed DeepSeek WinHTTP transport.
//! Raw provider JSON and credential echoes never enter the Host pipe.
use super::*;
use serde_json::{json, Value};
use std::collections::HashSet;

pub(crate) struct HostedChatTransport { tools: Vec<Value> }
impl HostedChatTransport {
    pub(crate) fn new(tools: Vec<Value>) -> Self { Self { tools } }
}
fn failed() -> TransportFailure {
    TransportFailure::new(WriteStatus::MayHaveWritten, "host_chat_protocol_rejected".into())
}
fn identifier(value: &Value, maximum: usize) -> std::result::Result<&str, ()> {
    let text=value.as_str().ok_or(())?;
    if text.is_empty() || text.len()>maximum || !text.bytes().all(|c|c.is_ascii_alphanumeric()||matches!(c,b'_'|b'-')) {return Err(());}
    Ok(text)
}
fn keys(value:&Value, allowed:&[&str])->std::result::Result<(),()> {
    if value.as_object().ok_or(())?.keys().any(|key|!allowed.contains(&key.as_str())) {return Err(());}
    Ok(())
}
fn validate_body(raw:&[u8], model:&str, tools:&[Value])->std::result::Result<Value,()> {
    if raw.is_empty()||raw.len()>32768||tools.is_empty()||tools.len()>8 {return Err(());}
    let body:Value=serde_json::from_slice(raw).map_err(|_|())?;
    keys(&body,&["model","messages","max_tokens","stream","thinking","temperature","tools","tool_choice"])?;
    if body["model"]!=model || body["stream"]!=false || body["thinking"]!=json!({"type":"disabled"})
        || body["temperature"].as_f64()!=Some(0.0) || !body["max_tokens"].as_u64().is_some_and(|v|(1..=1024).contains(&v))
        || body["tools"]!=json!(tools) || !matches!(body["tool_choice"].as_str(),Some("auto"|"none")) {return Err(());}
    let names=tools.iter().map(|tool|tool["function"]["name"].as_str().ok_or(())).collect::<std::result::Result<HashSet<_>,_>>()?;
    let messages=body["messages"].as_array().ok_or(())?;
    if messages.is_empty()||messages.len()>32 {return Err(());}
    let mut pending=HashSet::new();let mut seen=HashSet::new();
    for message in messages {
        keys(message,&["role","content","tool_calls","tool_call_id"])?;
        if !message["content"].is_string() {return Err(());}
        let role=message["role"].as_str().ok_or(())?;
        if role=="tool" {
            if message.get("tool_calls").is_some() || !pending.remove(identifier(&message["tool_call_id"],128)?) {return Err(());}
        } else {
            if !matches!(role,"system"|"user"|"assistant") || !pending.is_empty() || message.get("tool_call_id").is_some() {return Err(());}
            if let Some(calls)=message.get("tool_calls") {
                let calls=calls.as_array().ok_or(())?;
                if role!="assistant"||calls.is_empty()||calls.len()>8 {return Err(());}
                for call in calls {
                    keys(call,&["id","type","function"])?;keys(&call["function"],&["name","arguments"])?;
                    let id=identifier(&call["id"],128)?;
                    if call["type"]!="function"||!seen.insert(id)||!names.contains(call["function"]["name"].as_str().ok_or(())?) {return Err(());}
                    let args:Value=serde_json::from_str(call["function"]["arguments"].as_str().ok_or(())?).map_err(|_|())?;
                    if !args.is_object() {return Err(());}
                    pending.insert(id);
                }
            }
        }
    }
    if !pending.is_empty(){return Err(());}
    Ok(body)
}

fn project_reply(raw:&[u8], model:&str, tools:&[Value], key:&[u8])->std::result::Result<Value,()> {
    let value:Value=serde_json::from_slice(raw).map_err(|_|())?;
    if crate::native_deepseek_http::contains_secret(&value,key,0) || value.get("error").is_some()
        || value["model"]!=model {return Err(());}
    let id=value["id"].as_str().filter(|id|!id.is_empty()&&id.len()<=256&&!id.chars().any(char::is_control)).ok_or(())?;
    let choices=value["choices"].as_array().filter(|choices|choices.len()==1).ok_or(())?;
    let choice=&choices[0];let message=&choice["message"];
    if message["role"]!="assistant" {return Err(());}
    let text=match &message["content"] {Value::Null=>"",Value::String(text)=>text,_=>return Err(())};
    if text.len()>131072 {return Err(());}
    let finish=choice["finish_reason"].as_str().filter(|v|matches!(*v,"stop"|"length"|"tool_calls")).ok_or(())?;
    let mut result=json!({"id":id,"text":text,"finishReason":finish,"usageStatus":"unknown"});
    let mut seen=HashSet::new();
    if let Some(calls)=message.get("tool_calls").filter(|v|!v.is_null()) {
        let calls=calls.as_array().filter(|calls|!calls.is_empty()&&calls.len()<=8).ok_or(())?;
        if finish!="tool_calls" {return Err(());}
        let mut output=Vec::new();
        for call in calls {
            let id=identifier(&call["id"],128)?;
            let name=identifier(&call["function"]["name"],64)?;
            let arguments=call["function"]["arguments"].as_str().filter(|v|v.len()<=8192).ok_or(())?;
            if !seen.insert(id)||call["type"]!="function"||!tools.iter().any(|tool|tool["function"]["name"]==name) {return Err(());}
            if !serde_json::from_str::<Value>(arguments).map_err(|_|())?.is_object(){return Err(());}
            output.push(json!({"id":id,"name":name,"arguments":arguments}));
        }
        result["toolCalls"]=json!(output);
    } else if finish=="tool_calls" {return Err(());}
    if let Some(usage)=value.get("usage").filter(|value|!value.is_null()) {
        let input=usage["prompt_tokens"].as_u64().filter(|v|*v<=9_007_199_254_740_991).ok_or(())?;
        let output=usage["completion_tokens"].as_u64().filter(|v|*v<=9_007_199_254_740_991).ok_or(())?;
        let total=usage["total_tokens"].as_u64().filter(|v|*v<=9_007_199_254_740_991).ok_or(())?;
        if input.checked_add(output)!=Some(total){return Err(());}
        result["usage"]=json!({"inputTokens":input,"outputTokens":output,"totalTokens":total});
        result["usageStatus"]=json!("reported");
    }
    Ok(result)
}

impl Transport for HostedChatTransport {
    fn before_dispatch(&mut self,request:RequestView<'_>)->std::result::Result<(),TransportFailure> {
        if request.endpoint!="https://api.deepseek.com/chat/completions" {return Err(failed());}
        validate_body(request.body,request.model,&self.tools).map_err(|_|failed())?;
        Ok(())
    }
    fn dispatch(&mut self,request:RequestView<'_>,credential:CredentialBytes<'_>,signal:DispatchSignal<'_>,response:&mut ResponseBuffer)
        ->std::result::Result<WriteReceipt,TransportFailure> {
        let body=validate_body(request.body,request.model,&self.tools).map_err(|_|failed())?;
        if crate::native_deepseek_http::contains_secret(&body,credential.bytes(),0)||signal.is_cancelled(){return Err(failed());}
        let mut transport=crate::native_deepseek_http::WinHttpDeepSeekTransport::with_sinks(
            Arc::new(|_|Ok(())),Arc::new(|status,content_type|{
                if status!=200||content_type.split(';').next().map(str::trim)!=Some("application/json") {return Err(());}
                Ok(())
            }));
        transport.before_dispatch(request)?;
        let mut raw=ResponseBuffer::new();
        let key=credential.0;
        let receipt=transport.dispatch(request,credential,signal,&mut raw)?;
        let projected=project_reply(&raw.bytes,request.model,&self.tools,key);
        raw.bytes.fill(0);
        let rejected=||TransportFailure::new(receipt.write,"host_chat_response_rejected".into());
        let projected=projected.map_err(|_|rejected())?;
        let bytes=serde_json::to_vec(&projected).map_err(|_|rejected())?;
        response.push(&bytes).map_err(|_|rejected())?;
        Ok(receipt)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tools()->Vec<Value>{vec![json!({"type":"function","function":{"name":"project_read_file","description":"Read","parameters":{"type":"object"}}})]}
    fn body()->Value{json!({"model":"deepseek-flash","messages":[{"role":"user","content":"Read Source/A.cpp"}],"tools":tools(),"tool_choice":"auto","max_tokens":1024,"stream":false,"thinking":{"type":"disabled"},"temperature":0})}
    fn reply()->Value{json!({"id":"reply","model":"deepseek-flash","choices":[{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call1","type":"function","function":{"name":"project_read_file","arguments":"{\"path\":\"Source/A.cpp\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}})}
    #[test] fn host_chat_body_preserves_pinned_tools_and_rejects_unsupported_options(){
        validate_body(body().to_string().as_bytes(),"deepseek-flash",&tools()).unwrap();
        for field in ["model","tools","stream","max_tokens","thinking"] {
            let mut value=body();value[field]=json!("substituted");
            assert!(validate_body(value.to_string().as_bytes(),"deepseek-flash",&tools()).is_err());
        }
        let mut value=body();value["web_search"]=json!(true);
        assert!(validate_body(value.to_string().as_bytes(),"deepseek-flash",&tools()).is_err());
    }
    #[test] fn host_chat_reply_projects_only_complete_allowed_calls_and_real_usage(){
        let value=project_reply(reply().to_string().as_bytes(),"deepseek-flash",&tools(),b"synthetic-secret").unwrap();
        assert_eq!(value["toolCalls"][0]["arguments"],"{\"path\":\"Source/A.cpp\"}");
        assert_eq!(value["usage"]["totalTokens"],15);
        let mut missing=reply();missing.as_object_mut().unwrap().remove("usage");
        let value=project_reply(missing.to_string().as_bytes(),"deepseek-flash",&tools(),b"synthetic-secret").unwrap();
        assert_eq!(value["usageStatus"],"unknown");assert!(value.get("usage").is_none());
    }
    #[test] fn host_chat_secret_echoes_and_unapproved_or_partial_calls_never_leave_native(){
        for (pointer,value) in [("/ignored",json!("synthetic-secret")),("/choices/0/message/tool_calls/0/function/name",json!("execute_shell")),
            ("/choices/0/message/tool_calls/0/function/arguments",json!("{\"path\":"))] {
            let mut response=reply();
            if pointer=="/ignored"{response["ignored"]=value;}else{*response.pointer_mut(pointer).unwrap()=value;}
            assert!(project_reply(response.to_string().as_bytes(),"deepseek-flash",&tools(),b"synthetic-secret").is_err());
        }
    }
}
