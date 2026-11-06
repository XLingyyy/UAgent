import {BlueprintStructureReader} from "../workspace/BlueprintStructureReader";
import {parsePickupTemplatePlan,UE_PICKUP_PARENT,UE_PICKUP_ROOT} from "../../../../../packages/runtime/src/ue-pickup-template-v2";
import {useEffect,useRef,useState} from "react";
import {useI18n} from "../i18n";
import {useOptionalRuntimeStore,useOptionalProjectStore} from "../stores/ui-store";
import {localNativeInvoke} from "../runtime/native-provider-budget";
import type {NativeInvoke} from "../runtime/project-native-adapter";
export async function negotiatePickupConnection(invoke:NativeInvoke|null,input:{projectId:string;rootId:string;editorSessionId:string}) {
 if(!invoke)throw Error("pickup_native_unavailable");
 const result=await invoke<Record<string,unknown>>("negotiate_ue_pickup_connection",{input});
 if(result.schemaVersion!==1||result.projectId!==input.projectId||result.editorSessionId!==input.editorSessionId||result.status!=="negotiated_readonly"||result.toolsVerified!==true||result.mutationEnabled!==false||result.connectionRetained!==false||typeof result.pluginLabEnabled!=="boolean"||result.reason!=="pickup_native_plan_approval_not_integrated")throw Error("pickup_invalid_connection_report");
 return {labEnabled:result.pluginLabEnabled};
}
export function BlueprintTemplateWorkflow(){
 const {locale}=useI18n(),zh=locale==="zh-CN";
 const projectId=useOptionalProjectStore(s=>s.activeProjectId);
 const [name,setName]=useState("BP_Pickup"),[item,setItem]=useState("Health"),[prompt,setPrompt]=useState("Press E to collect");
 const [creationAttempted,setCreationAttempted]=useState(false);
 const [effect,setEffect]=useState<"preview_ready"|"created_saved"|"failed"|null>(null);
 const [review,setReview]=useState<Record<string,unknown>|null>(null);
 const [effectAttempted,setEffectAttempted]=useState(false);
 const [startup,setStartup]=useState<"written"|"failed"|null>(null);
 const [operationId,setOperationId]=useState<string|null>(null);
 const [owned,setOwned]=useState<{projectId:string;rootId:string;sessionId:string;mode:string}|null>(null);
 const observed=useOptionalRuntimeStore(s=>s.mvp14.session);
 const session=owned??observed;
 const [busy,setBusy]=useState(false),[result,setResult]=useState<"verified"|"failed"|"start_failed"|"stop_failed"|null>(null);
 const generation=useRef(0);
 const key=[projectId,name,item,prompt,observed?.projectId,observed?.rootId,observed?.sessionId].join("|");
 useEffect(()=>{generation.current++;setCreationAttempted(false);setEffect(null);setReview(null);setEffectAttempted(false);setResult(null);setStartup(null);setOperationId(null);setOwned(null);setBusy(false);return()=>{generation.current++;};},[key]);
 const check=async()=>{if(!session)return;const current=++generation.current;setBusy(true);setResult(null);
  try{await negotiatePickupConnection(localNativeInvoke(),{projectId:session.projectId,rootId:session.rootId,editorSessionId:session.sessionId});if(generation.current===current)setResult("verified");}
  catch{if(generation.current===current)setResult("failed");}finally{if(generation.current===current)setBusy(false);}
 };
 const approve=async()=>{
  if(!projectId)return;const current=++generation.current;setBusy(true);setStartup(null);
  try{
   const plan=parsePickupTemplatePlan({operationId:crypto.randomUUID(),targetPackage:`${UE_PICKUP_ROOT}/${name}`,expectedDiskState:"absent",templateId:"actor.pickup.native.v1",parentClass:UE_PICKUP_PARENT,itemId:item,promptText:prompt,interactionRadiusCm:200,interactionKey:"E"});
   const invoke=localNativeInvoke();if(!invoke)throw Error("native_required");
   const value=await invoke<Record<string,unknown>>("approve_ue_pickup_launch_plan",{input:{projectId,plan}});
   if(value.schemaVersion!==1||value.projectId!==projectId||value.operationId!==plan.operationId||value.status!=="startup_plan_written"||value.approvalFileCreated!==true||value.editorStarted!==false||value.assetCreated!==false)throw Error("invalid_startup_receipt");
   if(current===generation.current){setStartup("written");setOperationId(plan.operationId);}
  }catch{if(current===generation.current)setStartup("failed");}finally{if(current===generation.current)setBusy(false);}
 };
 useEffect(()=>{return()=>{if(projectId&&operationId){void localNativeInvoke()?.("stop_approved_ue_pickup_editor",{input:{projectId,operationId}}).catch(()=>{});}};},[projectId,operationId]);
 const start=async()=>{if(!projectId||!operationId)return;const current=++generation.current;setBusy(true);setResult(null);
  try{const invoke=localNativeInvoke();if(!invoke)throw Error("native_required");
   const value=await invoke<Record<string,unknown>>("start_approved_ue_pickup_editor",{input:{projectId,operationId}});
   const next=value.session as {projectId:string;rootId:string;sessionId:string;mode:string;status:string}|undefined;
   if(value.schemaVersion!==1||value.projectId!==projectId||value.operationId!==operationId||value.status!=="editor_started"||value.assetCreated!==false||next?.projectId!==projectId||next.status!=="attached"||!next.rootId||!next.sessionId)throw Error("invalid_start_receipt");
   if(current===generation.current)setOwned(next);else await invoke("stop_approved_ue_pickup_editor",{input:{projectId,operationId}});
  }catch{if(current===generation.current)setResult("start_failed");}finally{if(current===generation.current)setBusy(false);}
 };
 const stop=async()=>{if(!projectId||!operationId)return;generation.current++;setBusy(true);try{const invoke=localNativeInvoke();if(!invoke||await invoke("stop_approved_ue_pickup_editor",{input:{projectId,operationId}})!==true)throw Error("stop_unconfirmed");setOwned(null);setOperationId(null);}catch{setResult("stop_failed");}finally{setBusy(false);}};
 const runEffect=async(apply:boolean)=>{
  if(!projectId||!operationId||!owned)return;
  const current=++generation.current;setBusy(true);setEffectAttempted(true);if(apply)setCreationAttempted(true);
  try{const invoke=localNativeInvoke();if(!invoke)throw Error("native_required");
   const value=await invoke<Record<string,unknown>>(apply?"apply_ue_pickup_template":"preview_ue_pickup_template",{input:{projectId,operationId}});
   const data=value.data as Record<string,unknown>|undefined;
   if(value.schemaVersion!==1||value.projectId!==projectId||value.operationId!==operationId||value.status!==(apply?"created_saved":"preview_ready")||data?.assetCreated!==apply)throw Error("invalid_effect_receipt");
   if(current===generation.current){setReview(data);setEffect(apply?"created_saved":"preview_ready");setEffectAttempted(false);}
  }catch(error){if(current===generation.current){if(apply&&String(error).includes("pickup_creation_declined")){setCreationAttempted(false);setEffectAttempted(false);}else setEffect("failed");}}
  finally{if(current===generation.current)setBusy(false);}
 };
 return <section aria-label={zh?"蓝图模板":"Blueprint template"}>
  <label>{zh?"模板":"Template"} <select><option value="actor.pickup.native.v1">{zh?"交互拾取 Actor（固定原生父类）":"Interactive pickup Actor (fixed native parent)"}</option></select></label>
  <label>{zh?"新蓝图名称":"New Blueprint name"}<input value={name} disabled={busy||Boolean(owned)} onChange={e=>setName(e.target.value)}/></label>
  <label>{zh?"物品标识":"Item identifier"}<input value={item} disabled={busy||Boolean(owned)} onChange={e=>setItem(e.target.value)}/></label>
  <label>{zh?"交互提示":"Interaction prompt"}<input value={prompt} disabled={busy||Boolean(owned)} onChange={e=>setPrompt(e.target.value)}/></label>
  <p>{zh?"固定交互距离 200 厘米，按键 E。仅支持已准备目录的隔离 UAgentBuildLab 工程。":"Fixed interaction radius: 200 cm; key: E. Requires a prepared isolated UAgentBuildLab project."}</p>
  <button type="button" disabled={busy||!projectId||Boolean(owned)} onClick={()=>void approve()}>{zh?"审阅并批准启动计划":"Review and approve startup plan"}</button>
  {operationId&&<button type="button" disabled={busy||Boolean(owned)} onClick={()=>void start()}>{zh?"确认并受管启动编辑器":"Confirm and start managed editor"}</button>}
  {busy&&operationId&&!owned&&<button type="button" onClick={()=>void stop()}>{zh?"取消编辑器启动":"Cancel editor startup"}</button>}
  {owned&&<><p>{effect==="created_saved"?(zh?"模板已创建保存。":"Template created and saved."):(effect==="failed"||creationAttempted)?(zh?"操作结果尚未确认。":"Operation outcome not confirmed."):(zh?"模板编辑器已启动；资产尚未创建。":"Template editor started; asset not created.")}</p><button type="button" onClick={()=>void stop()}>{zh?"结束模板编辑器":"Stop template editor"}</button></>}
  {startup&&!owned&&!creationAttempted&&<p role="status">{startup==="written"?(zh?"审批文件已新建。下一步单独确认受管启动；蓝图尚未创建。":"Approval file created. Editor not started; Blueprint not created. Confirm managed startup separately."):(zh?"启动计划未完成。请检查隔离工程、参数或是否已有审批文件；不会覆盖旧文件。":"Startup plan did not complete. Check isolated project, parameters or an existing approval file; existing files are never overwritten.")}</p>}
  {creationAttempted&&effect!=="created_saved"&&<p role="status">{zh?"创建已请求，结果尚未确认；目标资产可能已经写入，请核对工程。":"Creation requested; outcome not confirmed. The target asset may have been written; inspect the project."}</p>}
  {owned&&<div>
   <button type="button" disabled={busy||effectAttempted||effect!==null} onClick={()=>void runEffect(false)}>{zh?"准备并编译预览":"Prepare and compile preview"}</button>
   {review&&<pre aria-label={zh?"模板操作结果":"Template operation result"}>{JSON.stringify(review,null,2)}</pre>}
   {effect==="preview_ready"&&<button type="button" disabled={busy||effectAttempted} onClick={()=>void runEffect(true)}>{zh?"审阅并批准创建保存":"Review and approve creation"}</button>}
   {effect==="created_saved"&&<p role="status">{zh?"已核实新蓝图编译成功并保存。":"New Blueprint compiled and saved; result verified."}</p>}
   {effect==="failed"&&<p role="status">{zh?"操作失败或结果不确定，不会自动重试。资产可能已写入，请检查实际工程状态。":"Operation failed or outcome is uncertain. No automatic retry; an asset may have been written. Inspect the project state."}</p>}
  </div>}
  <p>{zh?"先核对受管编辑器中的 V2 工具契约。此检查不会准备、编译或创建资产。":"Check the V2 tool contract in the managed editor first. This check does not prepare, compile or create assets."}</p>
  <button type="button" disabled={busy||!session||session.mode!=="attached"} onClick={()=>void check()}>{zh?"检查 V2 受管连接":"Check managed V2 connection"}</button>
  {(result==="start_failed"||result==="stop_failed")&&<p role="status">{result==="start_failed"?(zh?"编辑器启动未完成或已取消。尚未创建资产。":"Editor startup did not complete or was declined. No asset was created."):(zh?"停止请求未确认，请检查受管任务状态。":"Stop request was not confirmed. Check the managed task status.")}</p>}
  {(result==="verified"||result==="failed")&&<p role="status">{result==="verified"?(zh?"受管连接与工具契约已核对。请准备编译预览，再单独批准创建。":"Managed connection and tool contract checked. Use the owned template editor to prepare a compiled preview, then approve creation separately."):(zh?"连接核对失败。需要当前可信工程的自有编辑器监听器和完整 V2 插件契约。":"Connection check failed. A current trusted project's owned editor listener and the complete V2 plugin contract are required.")}</p>}
  {!result&&<p role="status">{zh?"创建需要隔离受管编辑器、编译预览和单独批准。":"Creation requires the isolated managed editor, a compiled preview and separate approval."}</p>}
 {owned&&<BlueprintStructureReader session={owned} initialPackage={`${UE_PICKUP_ROOT}/${name}`}/>}
 </section>;
}
