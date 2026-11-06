import {useEffect,useRef,useState} from "react";
import {useI18n} from "../i18n";
import type {NativeInvoke} from "../runtime/project-native-adapter";
import type {BlueprintReadSession} from "../runtime/native-blueprint-read";
import {readAssetReferences,type AssetReferenceObservation} from "../runtime/native-asset-references";
export function AssetReferenceReader({session,initialPackage,invoke}:{session:BlueprintReadSession;initialPackage:string;invoke?:NativeInvoke|null}){
 const {locale}=useI18n(),zh=locale==="zh-CN",generation=useRef(0);
 const [target,setTarget]=useState(initialPackage),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[result,setResult]=useState<AssetReferenceObservation|null>(null);
 useEffect(()=>{generation.current++;setResult(null);setBusy(false);setError(null);return()=>{generation.current++;};},[session.projectId,session.rootId,session.sessionId,target]);
 async function query(){const id=++generation.current;setBusy(true);setError(null);setResult(null);try{const v=await readAssetReferences(session,target,undefined,invoke);if(id===generation.current)setResult(v);}catch(e){if(id===generation.current)setError(String(e));}finally{if(id===generation.current)setBusy(false);}}
 return <section aria-label={zh?"资产引用关系":"Asset reference relationships"}>
  <h3>{zh?"查询 Asset Registry 引用":"Query Asset Registry references"}</h3>
  <label>{zh?"引用查询的资产包路径":"Asset package for reference query"}<input value={target} disabled={busy} onChange={e=>setTarget(e.target.value)}/></label>
  <p>{zh?"查询一个包的直接依赖和直接引用者，各最多 128 项；不递归遍历，不加载、编译、扫描或保存资产。不区分软硬引用，也不包含运行时对象引用。空结果不证明资产不存在或没有引用。":"Direct package dependencies and referencers, up to 128 each. No recursive traversal, asset loading, compilation, scanning or saving. Hard/soft edges are not distinguished; runtime object references are excluded. Empty results do not prove asset absence or no references."}</p>
  <button type="button" disabled={busy} onClick={()=>void query()}>{busy?(zh?"正在查询…":"Querying…"):(zh?"确认并查询引用":"Confirm and query references")}</button>
  {busy&&<button type="button" onClick={()=>{generation.current++;setBusy(false);}}>{zh?"忽略本次结果":"Discard reference result"}</button>}
  {error&&<p role="alert">{zh?"引用查询未完成：":"Reference query did not complete: "}{error}</p>}
  {result&&<div aria-label={zh?"引用查询结果":"Reference query result"}>
   <p>{zh?"来源：当前工程的 Asset Registry 观察，不保证与磁盘同步。":"Source: current project's Asset Registry observation; disk coherence is not established."} {String(result.result.observedAtUtc)}</p>
   {(result.result.data.assetRegistryLoading||result.result.data.truncated)&&<p role="status">{zh?"结果不完整：索引仍在加载或已达到返回上限。":"Incomplete: the registry is still loading or the result limit was reached."}</p>}
   <h4>{zh?"直接依赖":"Direct dependencies"}</h4><pre>{result.result.data.dependencies.join("\n")||"[]"}</pre>
   <h4>{zh?"直接引用者":"Direct referencers"}</h4><pre>{result.result.data.referencers.join("\n")||"[]"}</pre>
  </div>}
 </section>;
}
