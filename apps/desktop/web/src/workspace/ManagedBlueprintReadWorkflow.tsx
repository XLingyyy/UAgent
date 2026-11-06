import {AssetReferenceReader} from "./AssetReferenceReader";
import {useEffect,useRef,useState,useMemo} from "react";
import {useI18n} from "../i18n";
import {localNativeInvoke} from "../runtime/native-provider-budget";
import type {NativeInvoke} from "../runtime/project-native-adapter";
import type {BlueprintReadSession} from "../runtime/native-blueprint-read";
import {BlueprintStructureReader} from "./BlueprintStructureReader";
export function ManagedBlueprintReadWorkflow({projectId,invoke:provided}:{projectId:string;invoke?:NativeInvoke|null}){
 const invoke=useMemo(()=>provided===undefined?localNativeInvoke():provided,[provided]);
 const {locale}=useI18n(),zh=locale==="zh-CN";
 const [file,setFile]=useState("Game.uproject"),[root,setRoot]=useState("/Game/Characters");
 const [operation,setOperation]=useState<string|null>(null),[session,setSession]=useState<BlueprintReadSession|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const generation=useRef(0),owner=useRef<{projectId:string;operationId:string}|null>(null);
 useEffect(()=>{setSession(null);setOperation(null);setBusy(false);setError(null);return()=>{generation.current++;const previous=owner.current;owner.current=null;if(previous)void invoke?.("stop_ue_semantic_editor",{input:previous}).catch(()=>{});};},[projectId,invoke]);
 async function stop(){const previous=owner.current;if(!previous||!invoke)return;generation.current++;setBusy(true);setSession(null);
  try{if(await invoke("stop_ue_semantic_editor",{input:previous})!==true)throw Error("semantic_stop_not_confirmed");owner.current=null;setOperation(null);setError(null);}catch(e){setError(String(e));}finally{setBusy(false);}}
 async function start(){if(!invoke||owner.current)return;const id=++generation.current;const input={projectId,operationId:crypto.randomUUID(),projectFile:file,readRoot:root};owner.current={projectId,operationId:input.operationId};setOperation(input.operationId);setBusy(true);setError(null);
  try{const value=await invoke<Record<string,unknown>>("start_ue_semantic_editor",{input});const next=value.session as (BlueprintReadSession&{status:string})|undefined;
   if(value.schemaVersion!==1||value.projectId!==projectId||value.operationId!==input.operationId||value.projectFile!==file||value.readRoot!==root||value.status!=="editor_started"||value.assetWriteEnabled!==false||value.toolsVerified!==false||typeof value.projectSha256!=="string"||!/^[a-f0-9]{64}$/.test(value.projectSha256)||next?.projectId!==projectId||next.status!=="attached"||!next.rootId||!next.sessionId)throw Error("semantic_start_receipt_invalid");
   if(id===generation.current)setSession(next);else await invoke("stop_ue_semantic_editor",{input:{projectId,operationId:input.operationId}});
  }catch(e){let released=true;try{await invoke("stop_ue_semantic_editor",{input:{projectId,operationId:input.operationId}});}catch{released=false;}if(id===generation.current){setError(String(e)+(released?"":"; semantic_stop_not_confirmed"));if(released){owner.current=null;setOperation(null);}}}finally{if(id===generation.current)setBusy(false);}
 }
 return <section aria-label={zh?"普通工程蓝图读取":"Managed project Blueprint reads"}>
  <h3>{zh?"启动只读查询编辑器":"Start an editor for read-only queries"}</h3>
  <label>{zh?"工程根目录内的 .uproject 文件名":"Project-root .uproject filename"}<input value={file} disabled={Boolean(operation)} onChange={e=>setFile(e.target.value)}/></label>
  <label>{zh?"蓝图读取目录或精确包路径":"Blueprint read root or exact package"}<input value={root} disabled={Boolean(operation)} onChange={e=>setRoot(e.target.value)}/></label>
  <p>{zh?"需要已安装 V2 语义插件的 UE 5.8.4 工程，以及现有原生编辑器启动配置。启动将运行工程和插件代码并产生常规日志/缓存，须原生批准；不会授予资产写入。无交互窗口，最多保留 10 分钟。蓝图必须已经加载，每次查询另行批准；不会自动加载冷资产。":"Requires UE 5.8.4, the installed V2 semantic plugin and existing native editor launch configuration. Startup runs project/plugin code and creates ordinary logs/cache, subject to native approval; no asset write permission is granted. The editor is headless, with a maximum 10-minute lease. Blueprints must already be loaded; each query requires separate approval. Cold assets are not loaded automatically."}</p>
  <button type="button" disabled={!invoke||Boolean(operation)||busy} onClick={()=>void start()}>{zh?"审阅并批准启动只读编辑器":"Review and start read-only editor"}</button>
  {operation&&<button type="button" onClick={()=>void stop()}>{session?(zh?"停止只读编辑器":"Stop read-only editor"):(zh?"取消只读启动":"Cancel read-only startup")}</button>}
  {busy&&<p role="status">{zh?"正在处理受管编辑器请求…":"Processing managed editor request…"}</p>}
  {error&&<p role="alert">{zh?"操作未确认：":"Operation not confirmed: "}{error}</p>}
  {session&&<><p>{zh?"受管进程已连接；V2 契约将在首次查询时核对。":"Owned process connected; the V2 contract is checked on the first query."}</p><BlueprintStructureReader session={session} initialPackage={root} invoke={invoke}/><AssetReferenceReader session={session} initialPackage={root} invoke={invoke}/></>}
 </section>;
}
