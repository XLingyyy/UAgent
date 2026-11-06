import {localNativeInvoke} from "./native-provider-budget";
import type {NativeInvoke} from "./project-native-adapter";
import {blueprintPath,type BlueprintReadSession,type BlueprintObservation} from "./native-blueprint-read";
export interface AssetReferenceData {packageName:string;referenceKind:"on_disk_package_dependencies_only";assetRegistryLoading:boolean;dependencies:string[];referencers:string[];truncated:boolean;source:{packageName:string;cacheable:false;origin:string;diskCoherence:"not_established";[key:string]:unknown}}
export interface AssetReferenceObservation extends BlueprintObservation {result:Record<string,unknown>&{data:AssetReferenceData}}
export async function readAssetReferences(session:BlueprintReadSession,packageName:string,signal?:AbortSignal,invoke:NativeInvoke|null=localNativeInvoke()):Promise<AssetReferenceObservation>{
 blueprintPath(packageName);if(signal?.aborted)throw Error("semantic_read_cancelled");if(!invoke)throw Error("semantic_native_unavailable");
 const v=await invoke<AssetReferenceObservation>("read_ue_asset_references",{input:{projectId:session.projectId,rootId:session.rootId,editorSessionId:session.sessionId,packageName}});
 if(signal?.aborted)throw Error("semantic_read_cancelled");
 if(v.schemaVersion!==1||v.projectId!==session.projectId||v.rootId!==session.rootId||v.editorSessionId!==session.sessionId||v.packageName!==packageName||v.status!=="observed"||v.cacheable!==false||typeof v.rootObjectId!=="string"||!v.rootObjectId||!Number.isSafeInteger(v.observationGeneration)||v.result?.operation!=="uagent.v2.asset.references"||v.result.mutationCount!==0)throw Error("semantic_invalid_reference_response");
 const d=v.result.data;
 if(d?.packageName!==packageName||d.referenceKind!=="on_disk_package_dependencies_only"||typeof d.assetRegistryLoading!=="boolean"||typeof d.truncated!=="boolean"||d.source?.packageName!==packageName||d.source.cacheable!==false||d.source.origin!=="editor_or_asset_registry_observation"||d.source.diskCoherence!=="not_established")throw Error("semantic_invalid_reference_response");
 for(const list of [d.dependencies,d.referencers])if(!Array.isArray(list)||list.length>128||list.some(p=>typeof p!=="string"||p.length>1024||!/^\/[\p{L}\p{N}_]+(?:\/[\p{L}\p{N}_]+)+$/u.test(p)))throw Error("semantic_invalid_reference_response");
 return v;
}
