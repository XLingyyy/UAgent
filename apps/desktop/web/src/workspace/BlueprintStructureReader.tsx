import type {NativeInvoke} from "../runtime/project-native-adapter";
import {useEffect,useRef,useState} from "react";
import {useI18n} from "../i18n";
import {readBlueprint,selectBlueprintReadSession,type BlueprintReadSession,type BlueprintObservation} from "../runtime/native-blueprint-read";
export function BlueprintStructureReader({session,initialPackage,invoke}:{session:BlueprintReadSession;initialPackage:string;invoke?:NativeInvoke|null}){
 const {locale}=useI18n(),zh=locale==="zh-CN",generation=useRef(0);
 const [packageName,setPackage]=useState(initialPackage),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[result,setResult]=useState<BlueprintObservation|null>(null);
 const key=[session.projectId,session.rootId,session.sessionId,packageName].join("|");
 useEffect(()=>selectBlueprintReadSession(session),[session.projectId,session.rootId,session.sessionId]);
 useEffect(()=>{generation.current++;setResult(null);setError(null);setBusy(false);return()=>{generation.current++;};},[key]);
 async function query(){const id=++generation.current;setBusy(true);setResult(null);setError(null);try{const data=await readBlueprint(session,packageName,undefined,invoke);if(id===generation.current)setResult(data);}catch(e){if(id===generation.current)setError(String(e));}finally{if(id===generation.current)setBusy(false);}}
 return <section aria-label={zh?"蓝图结构只读查询":"Read-only Blueprint structure"}>
 <h3>{zh?"查看已加载蓝图结构":"Inspect loaded Blueprint structure"}</h3>
 <label>{zh?"蓝图包路径":"Blueprint package"}<input value={packageName} disabled={busy} onChange={e=>setPackage(e.target.value)}/></label>
 <p>{zh?"读取所选工程的已加载蓝图；需要原生受管编辑器连接和已启用的 V2 读取范围，每次查询另行确认。不加载、编译或保存资产。结果仅为编辑器观察，调查工具仍需读取及外发审批。请通过只读启动入口建立普通工程会话，手工启动的编辑器不可直接连接。":"Read a loaded Blueprint in the selected project. Requires a native-owned editor connection and enabled V2 read scope, with separate confirmation for each query. No loading, compiling or saving; editor observations only. Investigation tools still require read/sharing approval. Use managed read-only startup for ordinary projects; manually started editors cannot be connected directly."}</p>
 <button type="button" disabled={busy} onClick={()=>void query()}>{busy?(zh?"正在读取…":"Reading…"):(zh?"确认并读取结构":"Confirm and read structure")}</button>
 {busy&&<button type="button" onClick={()=>{generation.current++;setBusy(false);}}>{zh?"忽略本次结果":"Discard pending result"}</button>}
 {error&&<p role="alert">{error.includes("semantic_blueprint_cold_load_unsupported")?(zh?"目标蓝图尚未完全加载。当前不支持保证只读的冷加载：UE 加载可能编译依赖并修改内存中的蓝图状态。没有执行加载、保存或自动重试；本次未取得结构。":"The target Blueprint is not fully loaded. Guaranteed read-only cold loading is unsupported: UE loading may compile dependencies and modify in-memory Blueprint state. No load, save or automatic retry was performed; no structure was returned."):error.includes("semantic_blueprint_not_ready")?(zh?"目标蓝图仍在加载、编译或重建，或缺少生成类；本次未取得结构，也未自动重试。":"The Blueprint is loading, compiling, regenerating or lacks a generated class. No structure returned and no automatic retry."):(zh?"未取得结构；读取可能未启用、已拒绝或连接失效。":"No structure returned; reads may be disabled, declined or the connection expired.")} {error}</p>}
 {result&&<><p>{zh?"来源：当前受管编辑器；不可作为可复用文件快照。":"Source: current managed editor; not a reusable file snapshot."} {String(result.result.observedAtUtc)}</p><pre>{JSON.stringify(result.result.data,null,2)}</pre></>}
 </section>;
}
