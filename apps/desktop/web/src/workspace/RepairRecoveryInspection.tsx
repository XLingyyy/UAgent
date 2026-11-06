import {HistoricalRepairRestore} from "./HistoricalRepairRestore";
import {SourceChangeReview} from "./SourceChangeReview";
import {useEffect,useRef,useState} from "react";
import {useI18n} from "../i18n";
import type {NativeRepairInspection,NativeRunHistoryPort} from "../runtime/native-run-history";
export function RepairRecoveryInspection({projectId,runId,backupSha256,inspect}:{projectId:string;runId:string;backupSha256:string;inspect:NativeRunHistoryPort["inspectRepair"]}){
 const {locale}=useI18n(),zh=locale==="zh-CN";const [result,setResult]=useState<NativeRepairInspection|null>(null),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);const generation=useRef(0);
 useEffect(()=>{generation.current++;setResult(null);setBusy(false);setFailed(false);return()=>{generation.current++;};},[projectId,runId,backupSha256,inspect]);
 async function check(){if(!inspect||busy)return;const epoch=++generation.current;setBusy(true);setResult(null);setFailed(false);try{const r=await inspect(projectId,runId,backupSha256);if(epoch===generation.current)setResult(r);}catch{if(epoch===generation.current)setFailed(true);}finally{if(epoch===generation.current)setBusy(false);}}
 const names={matches_before:zh?"匹配修改前内容":"Matches before content",matches_after:zh?"匹配计划写入内容":"Matches planned after content",object_changed:zh?"文件对象已更换":"File object replaced",diverged:zh?"内容已发生其他变化":"Content changed outside this repair",unavailable:zh?"无法读取或核对":"Unavailable for verification"};
 return <section aria-label={zh?"重启后的修复核对":"Repair inspection after restart"}>
  <h4>{zh?"核对当前文件与历史备份":"Compare current files with saved backups"}</h4>
  <p>{zh?"重新选择并信任原项目后可只读核对。这里只展示本次观察，不恢复执行权限；核对后文件仍可能变化。":"Select and trust the original project again, then inspect read-only. This shows one observation, does not restore execution authority, and files may change afterward."}</p>
  <button type="button" disabled={!inspect||busy} onClick={()=>void check()}>{busy?(zh?"正在核对…":"Inspecting…"):(zh?"只读核对当前文件":"Inspect current files read-only")}</button>
  {failed&&<p role="alert">{zh?"未完成核对。请确认原项目已重新信任，且备份、文件身份和记录完整。未获得恢复授权。":"Inspection failed. Re-trust the original project and check backup, file identities and records. No restore authority was granted."}</p>}
  {result&&<><ul>{result.files.map(f=><li key={f.path}><code>{f.path}</code> — {names[f.state]}<p>{zh?"保存的写入结果":"Saved write result"}: {f.savedEffect}</p>{f.currentSha256&&<code>{f.currentSha256}</code>}{f.knownAppliedMatch&&<p>{zh?"与已记录的成功写入一致；仍需新的恢复批准和准入。":"Matches a recorded successful write; new restore approval and admission are still required."}</p>}</li>)}</ul>
   {!result.resultPresent&&<p>{zh?"未保存完整结果，不能推断哪些文件写入成功。":"No complete result was saved; successful writes cannot be inferred."}</p>}
   <p>{zh?"持久执行记录":"Durable execution record"}: {result.execution.status}{result.execution.recordedPhase?` / ${result.execution.recordedPhase}`:""}</p>
   <p>{zh?"settled 只表示账本记录了回调返回；无匹配记录也不证明执行已停止。二者都不是恢复写入许可。":"A settled record reports a returned callback. An absent matching record does not prove execution stopped. Neither grants restore permission."}</p>
   {result.restoreCandidates.length>0&&<details><summary>{zh?"恢复差异预览（尚不可执行）":"Restore diff preview (not executable)"}</summary>
    <p>{zh?"仅包含本次核对仍匹配已记录成功写入的文件；修改前内容来自已校验备份。不会写入文件。":"Only files still matching recorded successful writes are included. Replacement content comes from the verified backup. No files will be written."}</p>
    {result.restoreCandidates.map(f=><section key={f.path}><h4>{f.path}</h4><SourceChangeReview before={f.before} after={f.after}/><details><summary>{zh?"完整恢复内容":"Complete restoration content"}</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{f.after}</pre></details></section>)}
   </details>}
   {result.restoreCandidates.length>0&&<HistoricalRepairRestore projectId={projectId} runId={runId} backupSha256={backupSha256}/>}
  </>}
 </section>;
}
