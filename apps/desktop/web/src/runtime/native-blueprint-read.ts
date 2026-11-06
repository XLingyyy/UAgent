import {localNativeInvoke} from "./native-provider-budget";
import type {NativeInvoke} from "./project-native-adapter";
export interface BlueprintReadSession {projectId:string;rootId:string;sessionId:string}
export interface BlueprintObservation {schemaVersion:1;projectId:string;rootId:string;editorSessionId:string;packageName:string;rootObjectId:string;observationGeneration:number;status:"observed";cacheable:false;result:Record<string,unknown>}
const ROOT="/Game/";
export function blueprintPath(packageName:string):string {
 if(!packageName.startsWith(ROOT)||packageName.length>1024||!packageName.split("/").slice(1).every(p=>/^[\p{L}\p{N}_]+$/u.test(p)))throw Error("semantic_invalid_package");
 return `Content/${packageName.slice(6)}.uasset`;
}
let selected:Readonly<BlueprintReadSession>|null=null;
export function selectBlueprintReadSession(session:BlueprintReadSession){const current=Object.freeze({...session});selected=current;return ()=>{if(selected===current)selected=null;};}
export function selectedBlueprintReadSession(projectId:string){return selected?.projectId===projectId?selected:null;}
export async function readBlueprint(session:BlueprintReadSession,packageName:string,signal?:AbortSignal,invoke:NativeInvoke|null=localNativeInvoke()):Promise<BlueprintObservation>{
 blueprintPath(packageName);if(signal?.aborted)throw Error("semantic_read_cancelled");if(!invoke)throw Error("semantic_native_unavailable");
 const value=await invoke<BlueprintObservation>("read_ue_blueprint_structure",{input:{projectId:session.projectId,rootId:session.rootId,editorSessionId:session.sessionId,packageName}});
 if(signal?.aborted)throw Error("semantic_read_cancelled");
 if(value.schemaVersion!==1||value.projectId!==session.projectId||value.rootId!==session.rootId||value.editorSessionId!==session.sessionId||value.packageName!==packageName||value.status!=="observed"||value.cacheable!==false||typeof value.rootObjectId!=="string"||!value.rootObjectId||!Number.isSafeInteger(value.observationGeneration)||!value.result||value.result.operation!=="uagent.v2.blueprint.describe"||value.result.mutationCount!==0)throw Error("semantic_invalid_response");
 const data=value.result.data as Record<string,unknown>|undefined;
 if(data?.packageName!==packageName||data.loadPolicy!=="already_loaded_only")throw Error("semantic_invalid_response");
 return value;
}
