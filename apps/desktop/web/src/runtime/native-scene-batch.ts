import {parseSceneBatchPlan,UE_SCENE_ROOT,UE_SCENE_MATERIAL,UE_SCENE_MESHES,type SceneBatchItem,type SceneBatchPlan,type SceneBatchData} from "../../../../../packages/runtime/src/ue-scene-batch-v2";
import type {NativeInvoke} from "./project-native-adapter";
export type SceneStage="prepare"|"execute"|"query"|"cancel"|"resume"|"save";
export function sceneGridPlan(name:string,mesh:number,spacing:number,operationId:string):SceneBatchPlan{
 if(!/^L_[A-Za-z0-9_]{1,76}$/.test(name)||!Number.isInteger(mesh)||mesh<0||mesh>=UE_SCENE_MESHES.length||!Number.isFinite(spacing)||spacing<100||spacing>1000)throw Error("scene_parameters_invalid");
 return parseSceneBatchPlan({operationId,targetMap:`${UE_SCENE_ROOT}/${name}`,expectedDiskState:"absent",items:Array.from({length:20},(_,i)=>({itemId:`item_${i+1}`,objectName:`UA14_Object_${i+1}`,mesh:UE_SCENE_MESHES[mesh],material:UE_SCENE_MATERIAL,transform:{location:{x:(i%5)*spacing,y:Math.floor(i/5)*spacing,z:50},rotation:{pitch:0,yaw:0,roll:0},scale:{x:1,y:1,z:1}}}))});
}
export interface SceneReceipt{receipt:{schemaVersion:1;projectId:string;operationId:string;runId:string;stage:SceneStage;status:"observed";data:SceneBatchData};persisted:true;receiptFile:string}
export async function sceneStep(invoke:NativeInvoke,projectId:string,plan:SceneBatchPlan,stage:SceneStage):Promise<SceneReceipt>{
 const r=await invoke<SceneReceipt>("scene_batch_step",{input:{projectId,operationId:plan.operationId,stage}}),v=r?.receipt,d=v?.data;
 if(r?.persisted!==true||!/^Saved\/UAgentSceneT14\/receipt-[a-f0-9]{32}\.json$/.test(r.receiptFile)||v?.schemaVersion!==1||v.projectId!==projectId||v.operationId!==plan.operationId||v.stage!==stage||v.status!=="observed"||!/^[a-f0-9-]{36}$/.test(v.runId)||!d||d.targetMap!==plan.targetMap||d.cancelIsRollback!==false||!Array.isArray(d.items)||d.items.length!==plan.items.length||new Set(d.items.map(i=>i.itemId)).size!==plan.items.length||d.items.some(i=>!plan.items.some(p=>p.itemId===i.itemId&&p.objectName===i.objectName)||!["applied","not_started","unknown","failed"].includes(i.status))||d.appliedCount!==d.items.filter(i=>i.status==="applied").length)throw Error("scene_receipt_invalid");
 if(d.saved&&(d.state!=="saved"||d.appliedCount!==plan.items.length||!d.diskExists||!/^[a-f0-9]{64}$/.test(d.diskHash)||d.conflict||!d.currentWorldMatches||d.packageDirty))throw Error("scene_save_unverified");
 return r;
}

/** UI-authored objects use the same closed native plan and resource bounds as the grid. */
export function sceneObjectPlan(name:string,items:SceneBatchItem[],operationId:string):SceneBatchPlan {
 if(!/^L_[A-Za-z0-9_]{1,76}$/.test(name))throw Error("scene_parameters_invalid");
 return parseSceneBatchPlan({operationId,targetMap:`${UE_SCENE_ROOT}/${name}`,expectedDiskState:"absent",items});
}
