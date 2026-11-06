import { UEBuildRepairBatchProposalImport } from "./UEBuildRepairBatchProposalImport";
import { SourceChangeReview } from "./SourceChangeReview";
import { UEBuildRepairSuggestion } from "./UEBuildRepairSuggestion";
import type { RepairBuildResult } from "../runtime/ue-build-repair-proposal";
import { UEBuildRepairProposalImport } from "./UEBuildRepairProposalImport";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import type { NativeInvoke } from "../runtime/project-native-adapter";
import type { UEBuildPreviewReceipt } from "../runtime/native-ue-build-preview";
type Binding = { projectId:string; runId:string; profileFingerprint:string; hostSessionId:string; rootObjectId:string };
type Snapshot = { binding:Binding; diagnostic:unknown; snapshotId:string; files:{path:string;content:string;sha256:string;objectIdentity:string}[] };
type Preview = { nativePlanDigest:string; preview:{binding:Binding;diagnostic:unknown;snapshotId:string;previewId:string;files:{path:string;before:string;after:string;beforeHash:string;afterHash:string;beforeObjectIdentity:string}[]} };
const hash = (v:unknown):v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const copy = {
  "zh-CN": { title:"源码批次修复", scope:"已有源码的项目内相对路径", read:"申请读取所选文件", replacement:"完整替换内容", prepare:"准备精确差异", before:"修改前", after:"修改后", reviewed:"我已审阅本批次每个文件的完整前后内容", apply:"申请批准写入一次", rebuild:"再次申请批准并重建", busy:"等待原生审批或操作完成…", cancel:"取消本次操作", failed:"操作未完成或会话已失效。请核对历史记录和源码；不要假定未发生修改。需要新的构建会话才能继续。", applied:"修改已写入，备份和结果已保存。尚未验证构建。", stopped:"未取得完整且已落账的修改结果；已停止，未重建。", hint:"每行选择一个已有 Source 文件，最多 8 个；未编辑的文件不会写入。读取、写入和重建分别确认；模型建议另行审阅外发内容，不自动重试。会话约 10 分钟后失效。", digest:"精确修改 SHA-256" },
  en: { title:"Source batch repair", scope:"Project-relative existing source path", read:"Request access to selected files", replacement:"Complete replacement content", prepare:"Prepare exact change", before:"Before", after:"After", reviewed:"I reviewed every file in this batch", apply:"Request approval to write once", rebuild:"Request separate approval and rebuild", busy:"Waiting for native approval or completion…", cancel:"Cancel this operation", failed:"The operation did not complete or the session expired. Check history and source; do not assume nothing changed. A fresh build session is required to continue.", applied:"The edit, before-backup and result were saved. A build has not verified the edit yet.", stopped:"A complete persisted edit was not confirmed. Stopped without rebuilding.", hint:"Choose up to 8 existing Source files, one path per line. Unchanged files are not written. Reading, writing and rebuilding require separate confirmation. Model suggestions require separate outbound review; no automatic retry. The session expires after about 10 minutes.", digest:"Exact change SHA-256" },
};
export function UEBuildRepairAction({preview,runId,initialSessionId,invoke,onActiveChange,onRebuilt,onStopped,buildResult}:{preview:UEBuildPreviewReceipt;runId:string;initialSessionId:string;buildResult?:RepairBuildResult;invoke:NativeInvoke;onActiveChange:(v:boolean)=>void;onRebuilt:(value:unknown)=>void;onStopped?:(reason?:string)=>void}) {
  const {locale}=useI18n(), w=copy[locale];
  const [path,setPath]=useState(""),[afters,setAfters]=useState<Record<string,string>>({});
  const [outcome,setOutcome]=useState<{effects:{path:string;status:string}[];backup:string|null;history:string|null}|null>(null);
  const paths=path.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
  const validPaths=paths.length>0&&paths.length<=8&&new Set(paths.map(v=>v.toLowerCase())).size===paths.length;
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[session,setSession]=useState(initialSessionId);
  const [prepared,setPrepared]=useState<Preview|null>(null),[reviewed,setReviewed]=useState(false),[applied,setApplied]=useState(false);
  const [restoreAvailable,setRestoreAvailable]=useState(false),[restoring,setRestoring]=useState(false),[restored,setRestored]=useState(false);
  const [busy,setBusy]=useState(false),[ended,setEnded]=useState(false),[failed,setFailed]=useState(false),[attempted,setAttempted]=useState(false);
  const running=useRef(false),mounted=useRef(true),sessionRef=useRef(initialSessionId);
  const selection={projectId:preview.projectId,preparedId:preview.preparedId,runId};
  const release=(sessionId:string)=>{if(sessionId)void invoke("release_ue_build_repair",{input:{selection,sessionId}}).catch(()=>undefined);};
  useEffect(()=>{
    mounted.current=true;
    return()=>{
      mounted.current=false;
      // StrictMode replays setup immediately. Only an actual unmount releases native state.
      queueMicrotask(()=>{
        if(mounted.current)return;
        release(sessionRef.current);
        if(running.current)void invoke("cancel_approved_ue_build",{input:{projectId:preview.projectId,preparedId:preview.preparedId}}).catch(()=>undefined);
      });
    };
  },[invoke,preview.projectId,preview.preparedId,runId]);
  function binding(v:Binding){return v?.projectId===preview.projectId&&v.runId===runId&&v.profileFingerprint===preview.preview.fingerprint&&typeof v.hostSessionId==="string"&&typeof v.rootObjectId==="string";}
  async function work(action:()=>Promise<void>){
    if(running.current||ended)return;running.current=true;setBusy(true);onActiveChange(true);
    try{await action();}catch{if(mounted.current){setFailed(true);setEnded(true);onStopped?.();}}
    finally{running.current=false;if(mounted.current){setBusy(false);onActiveChange(false);}else release(sessionRef.current);}
  }
  function setAfter(value:string,filePath=snapshot?.files[0]?.path){if(!filePath)return;setAfters(previous=>({...previous,[filePath]:value}));setPrepared(null);setReviewed(false);}
  async function read(){if(!validPaths)return;await work(async()=>{
    const requested=[...paths];
    const r=await invoke("open_ue_build_repair",{input:{selection,...(requested.length===1?{path:requested[0]}:{paths:requested})}}) as {sessionId:string;snapshot:Snapshot};
    const s=r?.snapshot;
    if(!s||!binding(s.binding)||!hash(s.snapshotId)||!Array.isArray(s.files)||s.files.length!==requested.length||new Set(s.files.map(f=>f.path)).size!==requested.length||s.files.some(f=>!requested.includes(f.path)||typeof f.content!=="string"||!hash(f.sha256)||typeof f.objectIdentity!=="string")||!/^[a-f0-9]{32}$/.test(r.sessionId)||s.binding.hostSessionId!==r.sessionId||r.sessionId!==initialSessionId)throw Error("repair_snapshot_mismatch");
    sessionRef.current=r.sessionId;
    if(mounted.current){setSnapshot(s);setSession(r.sessionId);setAfters(Object.fromEntries(s.files.map(f=>[f.path,f.content])));}else release(r.sessionId);
  });}
  async function prepare(){await work(async()=>{
    if(!snapshot)throw Error("snapshot_required");
    const replacements=snapshot.files.filter(f=>afters[f.path]!==f.content).map(f=>({path:f.path,after:afters[f.path]}));
    if(!replacements.length)throw Error("changes_required");
    const p=await invoke("prepare_ue_build_repair",{input:{selection,sessionId:session,snapshotId:snapshot.snapshotId,...(snapshot.files.length===1?{after:replacements[0].after}:{files:replacements})}}) as Preview;
    if(!p||!hash(p.nativePlanDigest)||!hash(p.preview?.previewId)||!binding(p.preview.binding)||p.preview.binding.hostSessionId!==session||p.preview.snapshotId!==snapshot.snapshotId||!Array.isArray(p.preview.files)||p.preview.files.length!==replacements.length||new Set(p.preview.files.map(f=>f.path)).size!==replacements.length||p.preview.files.some(f=>{
      const before=snapshot.files.find(v=>v.path===f.path),replacement=replacements.find(v=>v.path===f.path);
      return !before||!replacement||f.before!==before.content||f.after!==replacement.after||f.beforeHash!==before.sha256||f.beforeObjectIdentity!==before.objectIdentity||!hash(f.afterHash);
    }))throw Error("repair_preview_mismatch");
    if(mounted.current){setPrepared(p);setReviewed(false);}
  });}
  async function apply(){if(!prepared||!reviewed||attempted)return;setAttempted(true);await work(async()=>{
    const p=prepared.preview;
    const r=await invoke("approve_and_apply_ue_build_repair",{input:{selection,sessionId:session,digest:prepared.nativePlanDigest}}) as {persisted:boolean;hostSettled:boolean;restoreAvailable?:boolean;restoration?:boolean;historyRunId?:string;receipt:{binding:Binding;previewId:string;status:string;recoveryRecord:string|null;effects:{path:string;status:string;afterHash:string|null;afterObjectIdentity:string|null}[]}};
    const effects=r?.receipt?.effects;
    if(!r||!binding(r.receipt?.binding)||r.receipt.binding.hostSessionId!==session||r.receipt.previewId!==p.previewId||!Array.isArray(effects)||effects.length!==p.files.length||new Set(effects.map(e=>e.path)).size!==effects.length||effects.some(e=>!p.files.some(f=>f.path===e.path)||!["applied","not_started","conflict","unknown"].includes(e.status)))throw Error("repair_result_mismatch");
    const ok=r.persisted===true&&r.hostSettled===true&&r.receipt.status==="applied"&&hash(r.receipt.recoveryRecord)&&effects.every(e=>{const f=p.files.find(f=>f.path===e.path)!;return e.status==="applied"&&e.afterHash===f.afterHash&&e.afterObjectIdentity===f.beforeObjectIdentity;});
    if(restoring&&r.restoration!==true)throw Error("restore_result_mismatch");
    const canRestore=!restoring&&r.restoreAvailable===true&&r.persisted===true&&r.hostSettled===true&&r.receipt.status==="partial"&&hash(r.receipt.recoveryRecord)
      &&effects.some(e=>e.status==="applied")&&effects.every(e=>e.status!=="unknown"&&(e.status!=="applied"||p.files.some(f=>f.path===e.path&&e.afterHash===f.afterHash&&e.afterObjectIdentity===f.beforeObjectIdentity)));
    if(mounted.current){setRestoreAvailable(canRestore);setRestored(restoring&&ok);setOutcome({effects:effects.map(e=>({path:e.path,status:e.status})),backup:hash(r.receipt.recoveryRecord)?r.receipt.recoveryRecord:null,history:r.persisted&&typeof r.historyRunId==="string"&&/^[a-f0-9]{32}$/.test(r.historyRunId)?r.historyRunId:null});setApplied(!restoring&&ok);if(restoring||(!ok&&!canRestore)){setEnded(true);onStopped?.("operation_stopped");}}
  });}
  async function prepareRestore(){if(!restoreAvailable||!prepared||!outcome)return;await work(async()=>{
    const original=prepared;
    const expected=original.preview.files.filter(f=>outcome.effects.some(e=>e.path===f.path&&e.status==="applied"));
    const p=await invoke("prepare_ue_build_restore",{input:{selection,sessionId:session,digest:original.nativePlanDigest}}) as Preview;
    if(!p||!hash(p.nativePlanDigest)||!hash(p.preview?.previewId)||!hash(p.preview.snapshotId)||!binding(p.preview.binding)||p.preview.binding.hostSessionId!==session
      ||!Array.isArray(p.preview.files)||p.preview.files.length!==expected.length||new Set(p.preview.files.map(f=>f.path)).size!==expected.length
      ||p.preview.files.some(f=>!expected.some(old=>f.path===old.path&&f.before===old.after&&f.after===old.before&&f.beforeHash===old.afterHash&&f.afterHash===old.beforeHash&&f.beforeObjectIdentity===old.beforeObjectIdentity)))throw Error("restore_preview_mismatch");
    if(mounted.current){setPrepared(p);setReviewed(false);setAttempted(false);setRestoreAvailable(false);setRestoring(true);}
  });}
  async function rebuild(){if(!applied||!prepared)return;await work(async()=>{
    const r=await invoke("approve_and_rebuild_ue_build_repair",{input:{selection,sessionId:session,digest:prepared.nativePlanDigest}});
    if(mounted.current){setEnded(true);onRebuilt(r);}
  });}
  const disabled=busy||ended;
  return <section aria-label={w.title}>
    <h3>{w.title}</h3><p>{w.hint}</p>
    <label>{w.scope}<textarea rows={3} value={path} disabled={disabled||Boolean(snapshot)} onChange={e=>setPath(e.target.value)}/></label>
    {!snapshot&&<button type="button" disabled={disabled||!validPaths} onClick={()=>void read()}>{w.read}</button>}
    {snapshot&&<>
      {!restoring&&!attempted&&buildResult&&<UEBuildRepairSuggestion key={snapshot.snapshotId+"-model"} files={snapshot.files} result={buildResult} preview={preview} runId={runId} disabled={disabled} onUse={proposals=>{setAfters(previous=>({...previous,...Object.fromEntries(proposals.map(proposal=>[proposal.path,proposal.after]))}));setPrepared(null);setReviewed(false);}}/>}
      {!restoring&&!attempted&&snapshot.files.length===1&&<UEBuildRepairProposalImport key={snapshot.snapshotId} file={snapshot.files[0]} disabled={disabled}
        onUse={text=>{setAfter(text);setPrepared(null);setReviewed(false);}}/>}
      {!restoring&&!attempted&&snapshot.files.length>1&&<UEBuildRepairBatchProposalImport key={snapshot.snapshotId+"-batch-import"} files={snapshot.files} disabled={disabled} onUse={(path,text)=>setAfter(text,path)}/>}
      {snapshot.files.map(f=><label key={f.path}>{snapshot.files.length===1?w.replacement:`${w.replacement}: ${f.path}`}<textarea rows={10} value={afters[f.path]??f.content} disabled={disabled||attempted||restoring} onChange={e=>setAfter(e.target.value,f.path)}/></label>)}
      <button type="button" disabled={disabled||attempted||restoring||snapshot.files.every(f=>afters[f.path]===f.content)} onClick={()=>void prepare()}>{w.prepare}</button>
    </>}
    {prepared&&<>
      <p>{restoring?(locale==="zh-CN"?"恢复差异：仅还原已确认写入的文件，必须重新审阅并批准。":"Restore diff: only confirmed writes will be reversed. Review and approve again."):w.digest}: <code>{prepared.nativePlanDigest}</code></p>
      {prepared.preview.files.map(f=><section key={f.path} aria-label={f.path}>
        <h4>{f.path}</h4><SourceChangeReview before={f.before} after={f.after}/>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:12}}>
          <section aria-label={w.before}><h4>{w.before}</h4><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{f.before}</pre></section>
          <section aria-label={w.after}><h4>{w.after}</h4><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{f.after}</pre></section>
        </div>
      </section>)}
      <label><input type="checkbox" checked={reviewed} disabled={disabled||attempted} onChange={e=>setReviewed(e.target.checked)}/>{w.reviewed}</label>
      <button type="button" disabled={disabled||attempted||!reviewed} onClick={()=>void apply()}>{restoring?(locale==="zh-CN"?"请求批准恢复一次":"Request approval to restore once"):w.apply}</button>
    </>}
    {busy&&<><p role="status">{w.busy}</p><button type="button" onClick={()=>void invoke("cancel_approved_ue_build",{input:{projectId:preview.projectId,preparedId:preview.preparedId}}).catch(()=>{if(mounted.current)setFailed(true);})}>{w.cancel}</button></>}
    {restoreAvailable&&!ended&&<button type="button" disabled={disabled} onClick={()=>void prepareRestore()}>{locale==="zh-CN"?"准备已写入文件的恢复差异":"Prepare restore of confirmed writes"}</button>}
    {restored&&<p role="status">{locale==="zh-CN"?"所选文件已恢复，恢复前备份与结果已保存。原部分失败记录仍待核对，不自动重建。":"Selected files restored; the restore backup and result were saved. The original partial failure remains unresolved; no automatic rebuild."}</p>}
    {applied&&<><p role="status">{w.applied}</p><button type="button" disabled={disabled} onClick={()=>void rebuild()}>{w.rebuild}</button></>}
    {restoreAvailable&&<p>{locale==="zh-CN"?"此入口仅在当前原生会话有效且原执行已确认结束时可恢复。关闭窗口或会话过期会使此入口失效；原进程结束后，可在历史记录中重新核对符合条件的记录并请求批准恢复。未知写入或外部修改仍会阻止恢复。":"Restore here requires a valid current native session and confirmed execution return. Closing the window or session expiry invalidates this entry. After the original process has exited, eligible records can be checked again in History and submitted for explicit restore approval. Unknown writes or external changes still block restoration."}</p>}
    {outcome&&<section aria-label={locale==="zh-CN"?"批次文件结果":"Batch file results"}>
      <h4>{locale==="zh-CN"?"批次文件结果":"Batch file results"}</h4>
      <ul>{outcome.effects.map(e=><li key={e.path}><code>{e.path}</code>: {e.status}</li>)}</ul>
      {outcome.backup&&<p>{locale==="zh-CN"?"修改前备份 SHA-256":"Before-backup SHA-256"}: <code>{outcome.backup}</code></p>}
      {outcome.history&&<p>{locale==="zh-CN"?"历史记录运行 ID":"History run ID"}: <code>{outcome.history}</code></p>}
      {!applied&&<p>{locale==="zh-CN"?"部分或未知结果需要先核对历史备份和当前文件。本入口不自动重试或恢复，也不会继续构建。":"Partial or unknown results require reconciling saved backups with current files. This entry does not automatically retry, restore or continue building."}</p>}
    </section>}
    {ended&&!applied&&!restored&&!failed&&<p role="alert">{w.stopped}</p>}{failed&&<p role="alert">{w.failed}</p>}
  </section>;
}
