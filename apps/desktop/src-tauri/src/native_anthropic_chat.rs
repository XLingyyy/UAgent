use super::*;
use serde_json::{Value,json};
pub(super) fn chat_messages(body:&str)->Result<Vec<Value>>{
 let v:Value=serde_json::from_str(body).map_err(|_|failure("anthropic_body_invalid"))?;
 if v.as_object().is_none_or(|o|o.keys().any(|k|!["model","stream","max_tokens","system","messages","temperature"].contains(&k.as_str()))){return Err(failure("anthropic_chat_tools_forbidden"));}
 let mut result=vec![];if let Some(system)=v.get("system"){result.push(json!({"role":"system","content":system.as_str().ok_or_else(||failure("anthropic_body_invalid"))?}));}
 let messages=v["messages"].as_array().filter(|m|!m.is_empty()&&m.len()<=128).ok_or_else(||failure("anthropic_body_invalid"))?;
 for m in messages {let role=m["role"].as_str().filter(|r|["user","assistant"].contains(r)).ok_or_else(||failure("anthropic_body_invalid"))?;
 let text=if let Some(text)=m["content"].as_str(){text.to_string()}else{let mut text=String::new();for b in m["content"].as_array().ok_or_else(||failure("anthropic_body_invalid"))?{if b["type"]!="text"{return Err(failure("anthropic_chat_tools_forbidden"));}text.push_str(b["text"].as_str().ok_or_else(||failure("anthropic_body_invalid"))?);}text};result.push(json!({"role":role,"content":text}));}Ok(result)
}
pub(super) fn result(response:&ResponseState,model:&str)->Option<(String,String,UsageStatus)>{
 let bytes:Vec<u8>=response.chunks.iter().flatten().copied().collect();let raw=std::str::from_utf8(&bytes).ok()?;
 let mut message:Value;
 if response.head.as_ref()?.content_type.starts_with("application/json"){message=serde_json::from_str(raw).ok()?;}else{
  message=Value::Null;let mut blocks:Vec<Value>=vec![];let mut open:Option<usize>=None;let mut delta=false;let mut ended=false;
  for frame in raw.replace("\r\n","\n").replace('\r',"\n").split("\n\n"){
   let data=frame.lines().filter_map(|l|l.strip_prefix("data:").map(str::trim_start)).collect::<Vec<_>>().join("\n");if data.is_empty(){continue;}if ended{return None;}
   let v:Value=serde_json::from_str(&data).ok()?;match v["type"].as_str()?{
    "ping"=>{},"message_start"=>{if !message.is_null(){return None;}message=v["message"].clone();},
    "content_block_start"=>{if message.is_null()||delta||open.is_some()||v["index"].as_u64()? as usize!=blocks.len()||v["content_block"]["type"]!="text"{return None;}open=Some(blocks.len());blocks.push(v["content_block"].clone());},
    "content_block_delta"=>{let i=open?;if v["index"].as_u64()? as usize!=i||v["delta"]["type"]!="text_delta"{return None;}let text=blocks[i]["text"].as_str()?.to_string()+v["delta"]["text"].as_str()?;blocks[i]["text"]=json!(text);},
    "content_block_stop"=>{if open?!=v["index"].as_u64()? as usize{return None;}open=None;},
    "message_delta"=>{if message.is_null()||open.is_some(){return None;}delta=true;message["stop_reason"]=v["delta"]["stop_reason"].clone();if let Some(u)=v["usage"].as_object(){for(k,x)in u{message["usage"][k]=x.clone();}}},
    "message_stop"=>{if !delta||open.is_some(){return None;}ended=true;},_=>return None,
   }
  }if !ended{return None;}message["content"]=json!(blocks);
 }
 if message["model"].as_str()?!=model||!["end_turn","stop_sequence","max_tokens"].contains(&message["stop_reason"].as_str()?){return None;}
 let mut text=String::new();for b in message["content"].as_array()?{if b["type"]!="text"{return None;}text.push_str(b["text"].as_str()?);}
 let usage=match (message["usage"]["input_tokens"].as_u64(),message["usage"]["output_tokens"].as_u64()){(Some(i),Some(o))=>UsageStatus::Reported{input_tokens:i,output_tokens:o,total_tokens:i.checked_add(o)},_=>UsageStatus::Unknown};
 Some((message["id"].as_str()?.into(),text,usage))
}
