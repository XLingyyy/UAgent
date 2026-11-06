import type {ProviderRuntimeRequest} from "@uagent/shared";
import {createProviderRuntimeError} from "./provider-error.js";
import type {ResponsesResult} from "./responses/protocol.js";
const fail=(p:string)=>createProviderRuntimeError(p,"malformed_response","Invalid or unsupported Anthropic Messages data.");
const object=(v:any,p:string):Record<string,any>=>{if(!v||typeof v!=="object"||Array.isArray(v))throw fail(p);return v;};
export function anthropicBody(r:ProviderRuntimeRequest,stream:boolean){
 const p=r.providerId, messages:any[]=[];const system:string[]=[];
 const pending=new Map<string,string>(),seen=new Set<string>();
 let results:any[]|null=null;
 const token=(v:unknown)=>typeof v==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
 if(!Number.isSafeInteger(r.maxOutputTokens??1024)||(r.maxOutputTokens??1024)<1)throw fail(p);
 for(const m of r.messages){
  if(typeof m.content!=="string")throw fail(p);
  if(m.role==="tool"){
   if(!m.toolCallId||!pending.has(m.toolCallId)||m.toolCalls?.length||(m.name!==undefined&&m.name!==pending.get(m.toolCallId)))throw fail(p);
   pending.delete(m.toolCallId);
   if(!results){results=[];messages.push({role:"user",content:results});}
   // Only the coordinator's matching result envelope supplies the failure flag.
   let failed=false;try{const value=JSON.parse(m.content);failed=value?.callId===m.toolCallId&&typeof value?.toolId==="string"&&value.status==="failed";}catch{}
   results.push({type:"tool_result",tool_use_id:m.toolCallId,content:m.content,...(failed?{is_error:true}:{})});continue;
  }
  if(pending.size||m.toolCallId)throw fail(p);
  if(m.role==="system"||m.role==="developer"){if(m.toolCalls?.length)throw fail(p);system.push(m.content);continue;}
  if(!["user","assistant"].includes(m.role))throw fail(p);
  if(m.role==="user"&&results){if(m.toolCalls?.length)throw fail(p);if(m.content)results.push({type:"text",text:m.content});results=null;continue;}
  results=null;
  const content:any[]=[];if(m.content)content.push({type:"text",text:m.content});
  for(const t of m.toolCalls??[]){
   if(m.role!=="assistant"||!token(t.id)||!token(t.name)||seen.has(t.id))throw fail(p);
   seen.add(t.id);pending.set(t.id,t.name);
   content.push({type:"tool_use",id:t.id,name:t.name,input:object(JSON.parse(t.arguments),p)});
  }
  if(!content.length)content.push({type:"text",text:" "});messages.push({role:m.role,content});
 }
 if(pending.size)throw fail(p);
 if(!messages.length)throw fail(p);
 return {model:r.modelId,stream,max_tokens:r.maxOutputTokens??1024,...(system.length?{system:system.join("\n\n")}:{}),messages,
 ...(r.temperature===undefined?{}:{temperature:r.temperature}),
 ...(r.tools?.length?{tools:r.tools.map(t=>({name:t.name,description:t.description,input_schema:t.parameters})),tool_choice:{type:r.toolChoice==="none"?"none":"auto"}}:{})};
}
export function parseAnthropicResult(value:unknown,r:ProviderRuntimeRequest):ResponsesResult {
 const v=object(value,r.providerId);if(typeof v.id!=="string"||v.model!==r.modelId||!Array.isArray(v.content))throw fail(r.providerId);
 let text="";const toolCalls:ResponsesResult["toolCalls"]=[];const ids=new Set<string>();
 for(const b of v.content){if(b.type==="text"&&typeof b.text==="string")text+=b.text;
 else if(b.type==="tool_use"&&typeof b.id==="string"&&typeof b.name==="string"&&r.tools?.some(t=>t.name===b.name)&&r.toolChoice!=="none"&&!ids.has(b.id)){ids.add(b.id);toolCalls.push({id:b.id,name:b.name,arguments:JSON.stringify(object(b.input,r.providerId))});}else throw fail(r.providerId);}
 if(!["end_turn","stop_sequence","max_tokens","tool_use"].includes(v.stop_reason)||(v.stop_reason==="tool_use")!==Boolean(toolCalls.length))throw fail(r.providerId);
 const input=v.usage?.input_tokens,output=v.usage?.output_tokens;
 const usage=Number.isSafeInteger(input)&&input>=0&&Number.isSafeInteger(output)&&output>=0&&Number.isSafeInteger(input+output)?{inputTokens:input,outputTokens:output,totalTokens:input+output}:undefined;
 return {id:v.id,modelId:r.modelId,text,toolCalls,finishReason:toolCalls.length?"tool_calls":v.stop_reason==="max_tokens"?"length":"stop",usage,usageStatus:usage?"reported":"unknown",createdAt:Date.now(),output:[]};
}
export class AnthropicEvents {
 private message:any;private blocks=new Map<number,{value:any;json:string;closed:boolean}>();private delta=false;private ended=false;
 constructor(private request:ProviderRuntimeRequest){}
 accept(value:unknown,_event?:string):{emissions:{delta:string;toolCallDelta?:import("@uagent/shared").ProviderToolCallDelta}[];result?:ResponsesResult}{
  const p=this.request.providerId,v=object(value,p);if(this.ended)throw fail(p);
  if(v.type==="error")throw createProviderRuntimeError(p,v.error?.type==="rate_limit_error"?"rate_limited":"provider_unavailable","Anthropic stream failed; no automatic retry.");
  if(v.type==="ping")return {emissions:[]};
  if(v.type==="message_start"){if(this.message)throw fail(p);this.message=object(v.message,p);return {emissions:[]};}
  if(!this.message)throw fail(p);
  if(v.type==="content_block_start"){
   if(this.delta||!Number.isSafeInteger(v.index)||v.index!==this.blocks.size||this.blocks.has(v.index))throw fail(p);
   const b=object(v.content_block,p);if(!["text","tool_use"].includes(b.type))throw fail(p);
   if(b.type==="text"&&typeof b.text!=="string")throw fail(p);
   this.blocks.set(v.index,{value:{...b},json:"",closed:false});return {emissions:b.type==="text"?[{delta:b.text}]:[]};
  }
  if(v.type==="content_block_delta"||v.type==="content_block_stop"){
   const b=this.blocks.get(v.index);if(!b||b.closed||this.delta)throw fail(p);
   if(v.type==="content_block_stop"){b.closed=true;if(b.value.type==="tool_use"&&b.json)b.value.input=object(JSON.parse(b.json),p);return {emissions:[]};}
   if(b.value.type==="text"&&v.delta?.type==="text_delta"&&typeof v.delta.text==="string"){b.value.text+=v.delta.text;return {emissions:[{delta:v.delta.text}]};}
   if(b.value.type==="tool_use"&&v.delta?.type==="input_json_delta"&&typeof v.delta.partial_json==="string"){b.json+=v.delta.partial_json;return {emissions:[]};}throw fail(p);
  }
  if(v.type==="message_delta"){if([...this.blocks.values()].some(b=>!b.closed))throw fail(p);this.delta=true;this.message={...this.message,...v.delta,usage:{...this.message.usage,...v.usage}};return {emissions:[]};}
  if(v.type==="message_stop"){if(!this.delta||[...this.blocks.values()].some(b=>!b.closed))throw fail(p);this.ended=true;return {emissions:[],result:parseAnthropicResult({...this.message,content:[...this.blocks.values()].map(b=>b.value)},this.request)};}
  return {emissions:[]};
 }
}
