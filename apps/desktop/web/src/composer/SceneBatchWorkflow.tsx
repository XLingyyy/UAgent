import {useEffect,useRef,useState} from "react";
import {useI18n} from "../i18n";
import {useOptionalProjectStore} from "../stores/ui-store";
import {localNativeInvoke} from "../runtime/native-provider-budget";
import {sceneGridPlan,sceneObjectPlan,sceneStep,type SceneReceipt,type SceneStage} from "../runtime/native-scene-batch";
import {UE_SCENE_MESHES,type SceneBatchItem,type SceneBatchPlan} from "../../../../../packages/runtime/src/ue-scene-batch-v2";
export function SceneBatchWorkflow(){
 const {locale}=useI18n(),zh=locale==="zh-CN",projectId=useOptionalProjectStore(s=>s.activeProjectId);
 const [projectFile,setProjectFile]=useState("UAgentBuildLab.uproject");
 const [name,setName]=useState("L_SceneBatch"),[mesh,setMesh]=useState(0),[spacing,setSpacing]=useState(200),[plan,setPlan]=useState<SceneBatchPlan|null>(null),[reviewed,setReviewed]=useState(false);
 const [items,setItems]=useState<SceneBatchItem[]>(()=>sceneGridPlan("L_Default",0,200,"00000000-0000-4000-8000-000000000001").items);
 const changeItem=(index:number,update:(item:SceneBatchItem)=>void)=>{setItems(previous=>previous.map((item,i)=>{if(i!==index)return item;const next=structuredClone(item);update(next);return next;}));invalidate();};
 const [approved,setApproved]=useState(false),[started,setStarted]=useState(false),[stopped,setStopped]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[receipt,setReceipt]=useState<SceneReceipt|null>(null);
 const generation=useRef(0),running=useRef(false),mounted=useRef(true),binding=useRef<{projectId:string;operationId:string}|null>(null),attempts=useRef(new Set<string>());
 const invalidate=()=>{setPlan(null);setReviewed(false);setError(null);};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;queueMicrotask(()=>{if(mounted.current)return;generation.current++;const input=binding.current;if(input)void localNativeInvoke()?.("stop_approved_ue_scene_editor",{input}).catch(()=>{});});};},[]);
 useEffect(()=>{generation.current++;const old=binding.current;binding.current=null;if(old)void localNativeInvoke()?.("stop_approved_ue_scene_editor",{input:old}).catch(()=>{});setApproved(false);setStarted(false);setStopped(false);setReceipt(null);setPlan(null);setReviewed(false);setBusy(false);running.current=false;attempts.current.clear();},[projectId]);
 async function work(action:(generation:number)=>Promise<void>){if(running.current||stopped)return;const n=++generation.current;running.current=true;setBusy(true);setError(null);try{await action(n);}catch(e){if(mounted.current&&n===generation.current)setError(String(e));}finally{if(n===generation.current){running.current=false;if(mounted.current)setBusy(false);}}}
 async function approve(){if(running.current||stopped||!plan||!reviewed||!projectId||attempts.current.has("approval"))return;attempts.current.add("approval");await work(async n=>{const invoke=localNativeInvoke();if(!invoke)throw Error("native_required");const input={projectId,operationId:plan.operationId};binding.current=input;
  const r=await invoke<Record<string,unknown>>("approve_ue_scene_launch_plan",{input:{projectId,projectFile,plan}});
  if(r.schemaVersion!==1||r.projectId!==projectId||r.operationId!==plan.operationId||r.status!=="startup_plan_written"||r.editorStarted!==false)throw Error("scene_startup_receipt_invalid");
  if(n===generation.current&&mounted.current)setApproved(true);else await invoke("stop_approved_ue_scene_editor",{input});
 });}
 async function start(){if(running.current||stopped||!approved||!binding.current||attempts.current.has("start"))return;attempts.current.add("start");await work(async n=>{const invoke=localNativeInvoke();if(!invoke)throw Error("native_required");const input=binding.current!;
  const r=await invoke<Record<string,unknown>>("start_approved_ue_scene_editor",{input});
  if(r.projectId!==input.projectId||r.operationId!==input.operationId||r.status!=="editor_started")throw Error("scene_start_failed");if(n===generation.current&&mounted.current)setStarted(true);else await invoke("stop_approved_ue_scene_editor",{input});
 });}
 async function step(stage:SceneStage){if(running.current||stopped||!started||!plan||!projectId||stage!=="query"&&attempts.current.has(stage))return;if(stage!=="query")attempts.current.add(stage);await work(async n=>{const invoke=localNativeInvoke();if(!invoke)throw Error("native_required");const result=await sceneStep(invoke,projectId,plan,stage);if(receipt&&result.receipt.runId!==receipt.receipt.runId)throw Error("scene_run_changed");if(n===generation.current&&mounted.current)setReceipt(result);});}
 async function stop(){generation.current++;running.current=false;setBusy(false);setStopped(true);setStarted(false);const input=binding.current;if(input)try{await localNativeInvoke()?.("stop_approved_ue_scene_editor",{input});}catch(e){setError(String(e));}}
 const data=receipt?.receipt.data,state=data?.state,locked=approved||busy||stopped;
 const resumable=Boolean(data&&["cancelled","paused_for_test_cancel"].includes(data.state)&&!data.conflict&&data.currentWorldMatches&&!data.diskExists&&data.items.every(i=>i.status==="applied"||i.status==="not_started"));
 const saveable=Boolean(data&&state==="completed"&&data.appliedCount===plan?.items.length&&!data.conflict&&data.currentWorldMatches&&!data.diskExists);
 const action=(stage:SceneStage,label:string,enabled=true)=><button type="button" disabled={busy||stopped||!enabled||(stage!=="query"&&attempts.current.has(stage))} onClick={()=>void step(stage)}>{label}</button>;
 return <section aria-label={zh?"场景批次":"Scene batch"}>
  <p>{zh?"在当前批准的工程中新建普通地图，放置 1–20 个指定静态对象，不覆盖已有地图。当前运行内可核对并续接剩余对象。计划约 10 分钟后失效；停止编辑器会丢失未保存对象。":"Create a new ordinary map in the selected approved project and place 1–20 selected static objects without overwriting an existing map. Inspect and continue remaining placements within the current run. The plan expires after about 10 minutes; stopping the editor loses unsaved objects."}</p>
 <label>{zh?"当前工程根目录的 .uproject 文件名":"Selected project .uproject filename"}<input value={projectFile} disabled={locked} onChange={e=>{setProjectFile(e.target.value);invalidate();}}/></label>
 <p>{zh?"需匹配插件及已有 Saved/UAgentSceneT14 与 Content/UAgentBuildLab/Scene_T14 目录。仅新建地图，不覆盖批准文件或地图。":"Requires matching plugin and existing Saved/UAgentSceneT14 and Content/UAgentBuildLab/Scene_T14 directories. New maps only; no approval-file or map overwrite."}</p>
 <label>{zh?"新地图名称":"New map name"}<input value={name} disabled={locked} onChange={e=>{setName(e.target.value);invalidate();}}/></label>
 <label>{zh?"静态网格":"Grid mesh"}<select value={mesh} disabled={locked} onChange={e=>{setMesh(Number(e.target.value));invalidate();}}>{["Cube","Sphere","Cylinder"].map((m,i)=><option key={m} value={i}>{m}</option>)}</select></label>
 <label>{zh?"对象间距（厘米）":"Grid spacing (cm)"}<input type="number" min={100} max={1000} value={spacing} disabled={locked} onChange={e=>{setSpacing(Number(e.target.value));invalidate();}}/></label>
 <button type="button" disabled={locked} onClick={()=>{try{setItems(sceneGridPlan(name,mesh,spacing,crypto.randomUUID()).items);invalidate();}catch(e){setError(String(e));}}}>{zh?"用网格重置对象列表":"Reset objects to grid"}</button>
 <p>{zh?"1–20 项；名称以 UA14_ 开头且唯一。位置 ±10000 厘米，旋转 ±180 度，缩放 0.1–10。材质固定为引擎基础材质。":"1–20 objects; unique UA14_ names. Position ±10000 cm, rotation ±180 degrees, scale 0.1–10. Fixed engine basic material."}</p>
 <fieldset disabled={locked}><legend>{zh?"对象列表":"Object list"}</legend>{items.map((item,index)=><fieldset key={item.itemId}><legend>{index+1}</legend>
 <label>{zh?"对象名称":"Object name"}<input aria-label={`Object ${index+1} name`} value={item.objectName} onChange={e=>changeItem(index,i=>{i.objectName=e.target.value;})}/></label>
 <label>{zh?"网格":"Mesh"}<select aria-label={`Object ${index+1} mesh`} value={item.mesh} onChange={e=>changeItem(index,i=>{i.mesh=e.target.value;})}>{UE_SCENE_MESHES.map(m=><option key={m} value={m}>{m.split(".").at(-1)}</option>)}</select></label>
 {(["location","rotation","scale"] as const).map(group=><div key={group}>{Object.entries(item.transform[group]).map(([axis,value])=><label key={axis}>{group}.{axis}<input aria-label={`Object ${index+1} ${group}.${axis}`} type="number" step="any" value={Number.isNaN(value)?"":value} onChange={e=>changeItem(index,i=>{Object.assign(i.transform[group],{[axis]:e.target.value===""?NaN:Number(e.target.value)});})}/></label>)}</div>)}
 <button type="button" disabled={items.length===1} onClick={()=>{setItems(old=>old.filter((_,i)=>i!==index));invalidate();}}>{zh?"移除此对象":"Remove object"}</button></fieldset>)}
 <button type="button" disabled={items.length>=20} onClick={()=>{let n=1;while(items.some(i=>i.itemId===`item_${n}`||i.objectName.toLowerCase()===`ua14_object_${n}`))n++;const item=structuredClone(items[0]!);item.itemId=`item_${n}`;item.objectName=`UA14_Object_${n}`;setItems(old=>[...old,item]);invalidate();}}>{zh?"添加对象":"Add object"}</button></fieldset>
 <button type="button" disabled={locked||!projectId} onClick={()=>{try{setPlan(sceneObjectPlan(name,items,crypto.randomUUID()));setReviewed(false);setError(null);}catch(e){setError(String(e));}}}>{zh?"审阅对象计划":"Review object plan"}</button>
  {plan&&<><details open><summary>{zh?"完整参数与变换":"Exact parameters and transforms"}</summary><pre>{JSON.stringify(plan,null,2)}</pre></details><label><input type="checkbox" checked={reviewed} disabled={locked} onChange={e=>setReviewed(e.target.checked)}/>{zh?"已审阅目标地图及全部计划对象":"I reviewed the target map and every object"}</label></>}
 {!approved&&<button type="button" disabled={busy||stopped||!reviewed||attempts.current.has("approval")} onClick={()=>void approve()}>{zh?"申请原生批准计划":"Request native plan approval"}</button>}
 {approved&&!started&&<button type="button" disabled={busy||stopped||attempts.current.has("start")} onClick={()=>void start()}>{zh?"批准并启动工程编辑器":"Approve and start project editor"}</button>}
 {started&&<div>{action("prepare",zh?"批准准备新场景":"Approve scene preparation",!data||state==="not_started")}{action("execute",zh?"批准放置计划对象":"Approve planned placements",state==="prepared")}{action("query",zh?"刷新逐对象状态":"Refresh object receipts")}{action("cancel",zh?"批准停止后续放置（不回滚）":"Approve stopping placements (no rollback)",state==="running")}{action("resume",zh?"批准续接剩余对象":"Approve remaining placements",resumable&&receipt?.receipt.stage==="query")}{action("save",zh?"另行批准保存新地图":"Separately approve saving new map",saveable&&receipt?.receipt.stage==="query")}</div>}
 {(approved||busy)&&!stopped&&<button type="button" onClick={()=>void stop()}>{zh?"停止编辑器（丢弃未保存场景）":"Stop editor (discard unsaved scene)"}</button>}
 {busy&&<p role="status">{zh?"等待原生审批或操作回执…":"Waiting for native approval or receipt…"}</p>}
 {error&&<p role="alert">{zh?"本次结果未确认；不自动重放写操作。可刷新状态核对。":"Outcome unconfirmed; mutation is not replayed automatically. Refresh receipts to inspect."} {error}</p>}
 {stopped&&<p role="status">{zh?"已停止本次流程；历史回执不代表未保存场景仍存在。":"Workflow stopped; historical receipts do not prove that the unsaved scene still exists."}</p>}
  {data&&<section aria-label={zh?"逐对象回执":"Object receipts"}><p role="status">{data.saved?(zh?"新地图保存已确认":"New map save verified"):data.appliedCount===plan?.items.length?(zh?"全部计划对象已放置，尚未确认保存":"All planned objects placed; save not confirmed"):(zh?"部分完成 / 未完成":"Partial / incomplete")}: {data.appliedCount}/{plan?.items.length} · {data.state}</p>
 <p>{receipt!.receiptFile}</p><ul>{data.items.map(i=><li key={i.itemId}><strong>{i.objectName}</strong>: {i.status} · {i.reason} {i.actorGuid&&<code>{i.actorGuid}</code>} {i.objectPath} {i.transform&&<pre>{JSON.stringify(i.transform)}</pre>}</li>)}</ul>{data.conflict&&<p role="alert">{data.conflictReason}</p>}
 </section>}
 </section>;
}
