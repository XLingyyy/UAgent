import {useEffect,useRef,useState,useSyncExternalStore} from "react";
import type {CollaborationMember} from "@uagent/shared";
import type {ProviderConfig} from "../types/provider";
import {createComposerModelOptions} from "./composer-data";
import {collaborationSessions} from "../runtime/collaboration-sessions";
import {CODEX_ENDPOINT,codexMemberSessions} from "../runtime/codex-member-session";
import {CodexModelFields} from "./CodexModelFields";
export function CollaborationModelField({slot,number,member,onChange,providers,projectId,input,mainModel,disabled,locale}:{slot:string;number:number;member:CollaborationMember;onChange:(member:CollaborationMember)=>void;providers:ProviderConfig[];projectId:string|null;input:string;mainModel:string;disabled:boolean;locale:string}){
 const zh=locale==="zh-CN",session=collaborationSessions[slot],codex=codexMemberSessions[slot];
 const state=useSyncExternalStore(session.subscribe,session.getSnapshot,session.getSnapshot);
 const codexState=useSyncExternalStore(codex.subscribe,codex.getSnapshot,codex.getSnapshot);
 const isCodex=member.model?.providerId==="codex";
 const options=createComposerModelOptions(providers).filter(option=>option.runtimeSupported),selected=isCodex?"codex":member.model?JSON.stringify([member.model.providerId,member.model.modelId]):"";

 const credential=useRef<HTMLInputElement>(null);const [error,setError]=useState(false),[opening,setOpening]=useState(false);
 useEffect(()=>session.attachLifetime(window),[session]);
 useEffect(()=>()=>codex.close(),[codex]);
 useEffect(()=>{session.updateContext(projectId,input,selected);if(!selected||isCodex)session.close("cleared");setError(false);if(credential.current)credential.current.value="";},[session,projectId,input,selected,isCodex]);


 const ready=isCodex?codexState.ready&&codex.current(projectId??"",member.model!.modelId):Boolean(member.model&&state.ready&&!state.savedCredential&&!state.nativeClosing&&state.providerId===member.model.providerId&&state.modelId===member.model.modelId&&state.endpoint===member.model.endpoint);
 async function open(){
  const key=credential.current?.value??"";if(credential.current)credential.current.value="";setOpening(true);setError(false);
  try{if(isCodex)return;
   const option=options.find(o=>o.id===selected);if(!option||!member.model)throw Error("unsupported");session.enable();session.openAccount(key);
  }catch{setError(true);}finally{setOpening(false);}
 }
 return <div className="ua-agent-model"><label>{zh?`成员 ${number} 模型`:`Member ${number} model`}<select disabled={disabled||opening} value={selected} onChange={e=>{session.close("revoked");codex.close();const option=options.find(o=>o.id===e.target.value);const {model:_,...rest}=member;onChange(e.target.value==="codex"?{...rest,model:{providerId:"codex",modelId:"",endpoint:CODEX_ENDPOINT}}:option?{...rest,model:{providerId:option.providerId!,modelId:option.modelId!,endpoint:"https://api.deepseek.com/chat/completions"}}:rest);}}>
  <option value="">{zh?`沿用主模型：${mainModel}`:`Use main model: ${mainModel}`}</option>
  <option value="codex">Codex / {zh?"官方 ChatGPT 登录":"Official ChatGPT login"}</option>
  {options.map(o=><option key={o.id} value={o.id}>{o.provider} / {o.modelId}</option>)}
 </select></label>
 {member.model&&<><p>{member.model.providerId} / {member.model.modelId} — {ready?(zh?"会话已配置（连接未验证）":"Session configured (connection untested)"):(zh?"需要配置独立会话":"Independent session required")}</p>
 {isCodex?<><CodexModelFields session={codex} slot={slot} label={`Member ${number}`} projectId={projectId} input={input} disabled={disabled||opening} zh={zh} onModel={modelId=>{if(member.model?.modelId!==modelId)onChange({...member,model:{providerId:"codex",modelId,endpoint:CODEX_ENDPOINT}});}}/>
 <details className="ua-agent-notes"><summary>{zh?"Codex 成员权限与用量":"Codex member permissions and usage"}</summary><p>{zh?"Codex 成员可在批准范围内列文件、搜索文件和读取文本，每次结果回传单独批准。每次发送均需原生确认，使用 Codex 账户额度；内部用量暂不能计入共享 Token 预算。主 Agent 按上方所选连接分配和汇总。":"Codex members can list, find and read text in the approved scope, with separate approval for each returned result. Each turn requires native confirmation and uses Codex account quota; internal usage cannot be included in the shared token budget. The selected lead connection delegates and synthesizes."}</p></details></>:<label>{zh?`成员 ${number} 临时 API 密钥`:`Member ${number} temporary API key`}<input ref={credential} type="password" autoComplete="off" disabled={disabled||opening}/></label>}
 {!isCodex&&<button type="button" disabled={disabled||opening||state.nativeClosing} onClick={()=>void open()}>{zh?`配置成员 ${number} 会话`:`Configure member ${number} session`}</button>}
 <button type="button" disabled={disabled||opening} onClick={()=>{session.close("cleared");codex.close();}}>{zh?"清除会话":"Clear session"}</button>
 {error&&<p role="alert">{zh?"会话配置失败或已失效，请检查所选连接。":"Session setup failed or became stale. Check the selected connection."}</p>}
 </>}
 </div>;
}
