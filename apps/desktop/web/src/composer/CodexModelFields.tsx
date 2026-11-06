import {codexCatalogFailure} from "./codex-catalog-error";
import {useEffect,useRef,useState,useSyncExternalStore} from "react";
import type {NativeInvoke} from "../runtime/project-native-adapter";
import {localNativeInvoke} from "../runtime/native-provider-budget";
import {createCodexMemberSession} from "../runtime/codex-member-session";
export interface CodexCatalogModel {model:string;displayName:string;description:string;hidden:boolean;isDefault:boolean;defaultReasoningEffort:string;supportedReasoningEfforts:Array<{reasoningEffort:string;description:string}>}
type Selection={executable:string;model:string;effort:string};
export function CodexModelFields({session,slot,label,projectId,input,disabled,zh,onModel,invoke:provided}:{session:ReturnType<typeof createCodexMemberSession>;slot:string;label:string;projectId:string|null;input:string;disabled:boolean;zh:boolean;onModel?:(model:string)=>void;invoke?:NativeInvoke|null}){
 const state=useSyncExternalStore(session.subscribe,session.getSnapshot,session.getSnapshot);
 const [value,setValue]=useState<Selection>({executable:"",model:"",effort:""}),[catalog,setCatalog]=useState<CodexCatalogModel[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const epoch=useRef(0),callback=useRef(onModel);callback.current=onModel;
 useEffect(()=>{let current=true;epoch.current++;session.close();setCatalog([]);setError("");setBusy(true);setValue({executable:"",model:"",effort:""});
 void(async()=>{try{const invoke=provided===undefined?localNativeInvoke():provided;if(!invoke)throw Error("native unavailable");const saved=projectId?await invoke<Selection|null>("read_codex_model_preference",{input:{projectId,slot}}):null;
 const v=saved??{executable:(await invoke<{executable:string}>("discover_codex",{})).executable,model:"",effort:""};if(current){setValue(v);callback.current?.(v.model);}
 }catch{if(current)setError(zh?"读取配置失败，请检查工程授权。":"Could not load preferences; check project trust.");}finally{if(current)setBusy(false);}})();
 return()=>{current=false;epoch.current++;session.close();};},[session,slot,projectId,provided]);
 useEffect(()=>{session.updateContext(projectId,input,JSON.stringify(value));},[session,projectId,input,value]);
 const selected=catalog.find(m=>m.model===value.model),valid=Boolean(selected?.supportedReasoningEfforts.some(e=>e.reasoningEffort===value.effort));
 const change=(next:Selection)=>{epoch.current++;session.close();setValue(next);callback.current?.(next.model);setError("");};
 async function refresh(){const version=epoch.current;session.close();setBusy(true);setError("");setCatalog([]);try{const invoke=provided===undefined?localNativeInvoke():provided;if(!invoke)throw Error();const models=await invoke<CodexCatalogModel[]>("list_codex_models",{input:{executable:value.executable}});if(version!==epoch.current)return;
 if(!Array.isArray(models)||models.some(m=>!m.model||!Array.isArray(m.supportedReasoningEfforts)))throw Error();const visible=models.filter(m=>!m.hidden);setCatalog(visible);
 if(!value.model&&visible.length){const m=visible.find(m=>m.isDefault)??visible[0];const next={...value,model:m.model,effort:m.defaultReasoningEffort};setValue(next);callback.current?.(m.model);}
 }catch(error){if(version===epoch.current)setError(codexCatalogFailure(error,zh));}finally{if(version===epoch.current)setBusy(false);}}
 async function configure(){if(!valid||!projectId)return;const version=epoch.current;setBusy(true);setError("");try{const invoke=provided===undefined?localNativeInvoke():provided;if(!invoke)throw Error();await invoke("save_codex_model_preference",{input:{projectId,slot,selection:value}});if(version!==epoch.current)return;session.configure(projectId,value.model,value.executable,value.effort);
 }catch{if(version===epoch.current)setError(zh?"保存或配置失败，请重新核对。":"Could not save or configure this selection.");}finally{if(version===epoch.current)setBusy(false);}}
 return <fieldset className="ua-codex-model-fields" disabled={disabled||busy}>
 <label>{zh?"Codex 程序路径":"Codex executable"}<input aria-label={`${label} Codex executable`} value={value.executable} onChange={e=>{setCatalog([]);change({...value,executable:e.target.value});}}/></label>
 <button type="button" onClick={()=>void refresh()} disabled={!value.executable}>{zh?"读取官方模型列表":`Load ${label} Codex models`}</button>
 <label>{zh?"官方模型":"Official model"}<select aria-label={`${label} Codex model`} value={value.model} onChange={e=>{const m=catalog.find(m=>m.model===e.target.value);if(m)change({...value,model:m.model,effort:m.defaultReasoningEffort});}}>
 {!selected&&<option value={value.model}>{value.model?`${value.model} — ${zh?"待重新核对":"refresh required"}`:zh?"请先读取列表":"Load catalog first"}</option>}
 {catalog.map(m=><option key={m.model} value={m.model}>{m.displayName} ({m.model})</option>)}</select></label>
 <label>{zh?"推理强度":"Reasoning effort"}<select aria-label={`${label} Codex reasoning effort`} value={value.effort} onChange={e=>change({...value,effort:e.target.value})}>
 {!valid&&<option value={value.effort}>{value.effort|| (zh?"请先选择模型":"Select a model")}</option>}
 {selected?.supportedReasoningEfforts.map(e=><option key={e.reasoningEffort} value={e.reasoningEffort}>{e.reasoningEffort} — {e.description}</option>)}</select></label>
 <button type="button" disabled={!valid||!projectId} onClick={()=>void configure()}>{zh?"保存并配置 Codex 会话":`Configure ${label} Codex session`}</button>
 <button type="button" onClick={()=>session.close()}>{zh?"关闭会话授权":"Close session authorization"}</button>
 <p role="status">{state.ready?`${state.modelId} / ${state.effort} — ${zh?"已配置，真实连接未验":"configured; live connection untested"}`:zh?"保存的选择不恢复授权；请读取列表后重新配置。":"Saved selections do not restore authorization; reload the catalog and configure again."}</p>
 <details className="ua-agent-notes"><summary>{zh?"模型列表说明":"About the model catalog"}</summary><p>{zh?"列表来自所选官方 app-server；不代表已验证账户额度或模型调用。使用默认服务档，不请求倍速。":"Catalog comes from the selected official app-server; account quota and live inference are unverified. Default service tier; no fast tier requested."}</p></details>
 {error&&<p role="alert">{error}</p>}
 </fieldset>;
}
