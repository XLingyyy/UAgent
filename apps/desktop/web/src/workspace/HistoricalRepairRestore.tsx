import {useEffect,useMemo,useRef,useState} from "react";
import {useI18n} from "../i18n";
import {localNativeInvoke} from "../runtime/native-provider-budget";
import type {NativeInvoke} from "../runtime/project-native-adapter";
import {SourceChangeReview} from "./SourceChangeReview";
type Prepared={selection:{projectId:string;runId:string;preparedId:string};sessionId:string;preview:{nativePlanDigest:string;preview:{binding:{projectId:string;hostSessionId:string};files:{path:string;before:string;after:string}[]}}};
export function HistoricalRepairRestore({projectId,runId,backupSha256,invoke:providedInvoke}:{projectId:string;runId:string;backupSha256:string;invoke?:NativeInvoke|null}){
 const invoke=useMemo(()=>providedInvoke===undefined?localNativeInvoke():providedInvoke,[providedInvoke]);
 const {locale}=useI18n(),zh=locale==="zh-CN";
 const [prepared,setPrepared]=useState<Prepared|null>(null),[reviewed,setReviewed]=useState(false),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false),[attempted,setAttempted]=useState(false),[outcome,setOutcome]=useState<{status:string;effects:{path:string;status:string}[]}|null>(null);
 const epoch=useRef(0),running=useRef(false),held=useRef<Prepared|null>(null);
 const release=(p:Prepared|null)=>{if(p&&invoke)void invoke("release_ue_build_repair",{input:{selection:p.selection,sessionId:p.sessionId}}).catch(()=>undefined);};
 useEffect(()=>{epoch.current++;running.current=false;setPrepared(null);setReviewed(false);setFailed(false);setBusy(false);setAttempted(false);setOutcome(null);return()=>{epoch.current++;release(held.current);held.current=null;};},[projectId,runId,backupSha256,invoke]);
 async function prepare(){if(!invoke||running.current)return;running.current=true;setBusy(true);setFailed(false);const generation=epoch.current;try{
  const p=await invoke("prepare_historical_ue_restore",{input:{projectId,runId,backupSha256}}) as Prepared;
  if(generation!==epoch.current){release(p);return;}
  if(p.selection.projectId!==projectId||p.selection.runId!==runId||!p.selection.preparedId||!p.sessionId||p.preview.preview.binding.projectId!==projectId||p.preview.preview.binding.hostSessionId!==p.sessionId||!/^[a-f0-9]{64}$/.test(p.preview.nativePlanDigest)||!p.preview.preview.files.length||p.preview.preview.files.length>8)throw new Error("binding");
  held.current=p;setPrepared(p);setReviewed(false);
 }catch{if(generation===epoch.current)setFailed(true);}finally{if(generation===epoch.current){running.current=false;setBusy(false);}}}
 async function apply(){if(!invoke||!prepared||!reviewed||running.current||attempted)return;running.current=true;setBusy(true);setAttempted(true);const generation=epoch.current,p=prepared;held.current=null;
 try{const r=await invoke("approve_and_apply_ue_build_repair",{input:{selection:p.selection,sessionId:p.sessionId,digest:p.preview.nativePlanDigest}}) as {persisted:boolean;hostSettled:boolean;restoration:boolean;receipt:{binding:{projectId:string;hostSessionId:string};status:string;effects:{path:string;status:string}[]}};
  if(generation!==epoch.current)return;
  if(!r.persisted||!r.hostSettled||!r.restoration||r.receipt.binding.projectId!==projectId||r.receipt.binding.hostSessionId!==p.sessionId)throw new Error("receipt");setOutcome(r.receipt);
 }catch{if(generation===epoch.current)setFailed(true);}finally{if(generation===epoch.current){running.current=false;setBusy(false);}}}
 return <section aria-label={zh?"批准历史恢复":"Approve historical recovery"}>
  <p>{zh?"仅支持带进程身份且已记录执行结束的新记录。原进程仍在运行、旧记录或文件变化均会阻止恢复。":"Requires a new record with process identity and durable callback settlement. A running original process, legacy record or changed file blocks recovery."}</p>
  {!prepared&&!attempted&&<button disabled={!invoke||busy} onClick={()=>void prepare()}>{zh?"核验恢复资格并准备差异":"Check recovery eligibility and prepare diff"}</button>}
  {prepared&&<>{prepared.preview.preview.files.map(f=><section key={f.path}><h4>{f.path}</h4><SourceChangeReview before={f.before} after={f.after}/></section>)}<code>{prepared.preview.nativePlanDigest}</code><label><input type="checkbox" checked={reviewed} disabled={busy||attempted} onChange={e=>setReviewed(e.target.checked)}/>{zh?"我已审阅所有恢复差异":"I reviewed every restoration diff"}</label><button disabled={!reviewed||busy||attempted} onClick={()=>void apply()}>{zh?"请求原生确认并恢复一次":"Request native approval and restore once"}</button></>}
  {failed&&<p role="alert">{zh?"无法确认恢复完成。请核对历史与文件，不会自动重试；旧记录或无法证明结束的执行保持阻止。":"Restoration could not be confirmed. Check history and files; no automatic retry. Legacy or unproven executions remain blocked."}</p>}
  {outcome&&<div role="status">{outcome.status}<ul>{outcome.effects.map(f=><li key={f.path}>{f.path}: {f.status}</li>)}</ul></div>}
  <p>{zh?"每次写入仍需原生确认，并生成新备份和回执。不会自动重建或解除原任务的阻塞。":"Writes require native confirmation and create a fresh backup and receipt. No automatic rebuild or clearing of the original task barrier."}</p>
 </section>;
}
