import { UEBuildRepairAction } from "./UEBuildRepairAction";
import { UEBuildFailureDiagnosis } from "./UEBuildFailureDiagnosis";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { localNativeInvoke } from "../runtime/native-provider-budget";
import type { NativeInvoke } from "../runtime/project-native-adapter";
import type { UEBuildPreviewReceipt } from "../runtime/native-ue-build-preview";

interface RepairCycle {chainId:string;rebuilds:number;maxRebuilds:3;previousRunId:string|null;status:string}
interface Receipt {
  schemaVersion: 1; projectId: string; preparedId: string; runId: string;
  repairCycle?:RepairCycle;
  persisted: boolean; hostSettled: boolean; repairAvailable?: boolean; repairSessionId?: string | null;
  result: { owner: { runId: string; stepId: string; fingerprint: string }; status: string; reason: string;
    pid: number | null; exitCode: number | null; durationMs: number; treeStopped: boolean;
    stdout: string; stderr: string; outputTruncated: boolean; outputComplete: boolean; effects: string };
}
function parse(value: unknown, preview: UEBuildPreviewReceipt): Receipt {
  const r = value as Receipt, b = r?.result;
  if (!r || r.schemaVersion !== 1 || r.projectId !== preview.projectId || r.preparedId !== preview.preparedId ||
      typeof r.runId !== "string" || !/^[a-f0-9]{32}$/.test(r.runId) || typeof r.persisted !== "boolean" || typeof r.hostSettled !== "boolean" ||
      (r.repairAvailable !== undefined && typeof r.repairAvailable !== "boolean") ||
      (r.repairAvailable === true && (typeof r.repairSessionId !== "string" || !/^[a-f0-9]{32}$/.test(r.repairSessionId))) ||
      !b || b.owner?.runId !== r.runId || b.owner.stepId !== "build" || b.owner.fingerprint !== preview.preview.fingerprint ||
      !["succeeded", "failed", "cancelled", "timed_out", "not_started", "unknown", "termination_unknown"].includes(b.status) ||
      typeof b.treeStopped !== "boolean" || typeof b.outputComplete !== "boolean" || typeof b.outputTruncated !== "boolean" ||
      typeof b.stdout !== "string" || typeof b.stderr !== "string" || typeof b.reason !== "string" ||
      (b.exitCode !== null && !Number.isInteger(b.exitCode))) throw Error("invalid_native_build_receipt");
  const c=r.repairCycle;
  if(c&&(!/^[a-f0-9]{32}$/.test(c.chainId)||!Number.isInteger(c.rebuilds)||c.rebuilds<0||c.rebuilds>3||c.maxRebuilds!==3||!(c.previousRunId===null||/^[a-f0-9]{32}$/.test(c.previousRunId))||!["awaiting_review","succeeded","cancelled","timed_out","not_repairable","incomplete_diagnostics","repeated_output","round_limit","unconfirmed"].includes(c.status)))throw Error("invalid_repair_cycle");
  if(c&&((c.status==="awaiting_review")!==(r.repairAvailable===true)||c.status==="succeeded"&&!(b.status==="succeeded"&&b.exitCode===0&&b.treeStopped&&b.outputComplete&&r.persisted&&r.hostSettled)||c.status==="round_limit"&&c.rebuilds!==3))throw Error("repair_cycle_status_mismatch");
  if(r.repairAvailable===true&&(!c||c.status!=="awaiting_review"||c.rebuilds>=3||!r.persisted||!r.hostSettled||b.status!=="failed"||b.exitCode===null||b.exitCode===0||!b.treeStopped||!b.outputComplete||b.outputTruncated))throw Error("invalid_repair_continuation");
  return r;
}
const messages = {
  "zh-CN": {
    start: "请求原生确认并构建一次", waiting: "等待原生确认或构建结束…", cancel: "取消本次构建", cancelling: "已请求取消，等待进程收尾…",
    hint: "接下来由原生确认框展示具体工程和命令。批准后会执行工程构建逻辑、写入构建产物；不会自动修改源码或重试。",
    done: "构建成功，原生结果已保存", other: "构建未成功或仍需核对", failed: "请求未完成。请查看原生确认结果；需要重新准备预览后才能再申请。",
    unsaved: "结果未完整落账或进程归属尚未确认，请勿自动重试。", log: "构建输出（末尾最多 16000 字符）", consumed: "这份预览已消费；再次构建需要重新准备和批准。",
  },
  "en": {
    start: "Request native approval and build once", waiting: "Waiting for native approval or build completion…", cancel: "Cancel this build", cancelling: "Cancellation requested; waiting for settlement…",
    hint: "The native dialog shows the exact project and command. Approval executes project build logic and writes build artifacts. No automatic source repair or retry.",
    done: "Build succeeded and the native receipt was saved", other: "Build did not succeed or needs review", failed: "Request did not complete. Check the native decision; prepare a new preview before requesting again.",
    unsaved: "The receipt was not fully saved or process settlement is unconfirmed. Do not retry automatically.", log: "Build output (last 16000 characters)", consumed: "This preview was consumed. Another build needs a fresh preview and approval.",
  },
};
export function UEApprovedBuildAction({ preview, invoke, onActiveChange, onConsumed }: {
  preview: UEBuildPreviewReceipt; invoke?: NativeInvoke | null; onActiveChange: (active: boolean) => void; onConsumed: () => void;
}) {
  const defaultInvoke = useMemo(localNativeInvoke, []);
  const call = invoke === undefined ? defaultInvoke : invoke;
  const { locale } = useI18n(), words = messages[locale];
  const [pending, setPending] = useState(false), [consumed, setConsumed] = useState(false), [cancelled, setCancelled] = useState(false);
  const [result, setResult] = useState<Receipt | null>(null), [failed, setFailed] = useState(false);
  const [rounds,setRounds]=useState<Receipt[]>([]),[stop,setStop]=useState<string|null>(null);
  const running = useRef(false), mounted = useRef(true);
  const seenRuns=useRef(new Set<string>());
  const identity = { projectId: preview.projectId, preparedId: preview.preparedId };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (running.current) void call?.("cancel_approved_ue_build", { input: identity }).catch(() => undefined);
    };
  }, [preview.projectId, preview.preparedId, call]);
  async function start() {
    if (!call || running.current || consumed) return;
    running.current = true; setConsumed(true); setPending(true); onConsumed(); onActiveChange(true);
    try {
      const receipt = parse(await call("approve_and_run_ue_build", { input: { ...identity, fingerprint: preview.preview.fingerprint } }), preview);
      if(receipt.repairCycle&&(receipt.repairCycle.rebuilds!==0||receipt.repairCycle.chainId!==receipt.runId||receipt.repairCycle.previousRunId!==null))throw Error("invalid_initial_cycle");
      if (mounted.current){seenRuns.current.add(receipt.runId);setResult(receipt);setRounds([receipt]);}
    } catch { if (mounted.current) setFailed(true); }
    finally { running.current = false; if (mounted.current) { setPending(false); onActiveChange(false); } }
  }
  async function cancel() {
    if (!call || !running.current) return;
    try { await call("cancel_approved_ue_build", { input: identity }); if (mounted.current) setCancelled(true); }
    catch { if (mounted.current) setFailed(true); }
  }
  function rebuilt(value:unknown){
    const next=parse(value,preview),prior=result?.repairCycle,c=next.repairCycle;
    if(!result||!prior||!c||seenRuns.current.has(next.runId)||c.chainId!==prior.chainId||c.previousRunId!==result.runId||c.rebuilds!==prior.rebuilds+1)throw Error("repair_cycle_reply_mismatch");
    seenRuns.current.add(next.runId);running.current=false;onActiveChange(false);setResult(next);setRounds(previous=>[...previous,next]);
  }
  function stopRepair(){if(running.current||!result||!call)return;setStop("user_stopped");void call("release_ue_build_repair",{input:{selection:{projectId:preview.projectId,preparedId:preview.preparedId,runId:result.runId},sessionId:result.repairSessionId}}).catch(()=>setStop("release_unconfirmed"));}
  const cycleStatus=stop??result?.repairCycle?.status;
  const cycleLabels:Record<string,string>=locale==="zh-CN"?{awaiting_review:"新诊断已接回本修复会话；等待下一轮审阅与批准",succeeded:"构建通过，修复会话结束",repeated_output:"构建输出与此前失败重复，已停止继续修复",round_limit:"已达到 3 次重建上限",cancelled:"构建已取消，修复会话结束",timed_out:"构建超时，修复会话结束",not_repairable:"结果不满足继续修复条件",incomplete_diagnostics:"诊断不完整，已停止",unconfirmed:"结果或落账未确认，已停止",user_stopped:"已由用户结束修复会话",release_unconfirmed:"已停止继续操作；原生会话释放未确认",operation_stopped:"本轮结束，不再继续重建；请核对下方文件结果",operation_failed:"本轮操作未完成，已停止；请核对历史和文件"}:{awaiting_review:"New diagnostics are attached to this repair chain; awaiting another review and approval",succeeded:"Build verified; repair chain complete",repeated_output:"Build output repeats an earlier failure; repair stopped",round_limit:"Three-rebuild limit reached",cancelled:"Build cancelled; repair stopped",timed_out:"Build timed out; repair stopped",not_repairable:"Result is not eligible for another repair",incomplete_diagnostics:"Incomplete diagnostics; repair stopped",unconfirmed:"Result or persistence unconfirmed; repair stopped",user_stopped:"Repair chain stopped by user",release_unconfirmed:"Further work stopped; native release unconfirmed",operation_stopped:"This round ended without further rebuilding; inspect the file results below",operation_failed:"Operation did not complete; repair stopped. Inspect history and files"};
  const success = result && result.result.status === "succeeded" && result.result.exitCode === 0 && result.result.treeStopped &&
    result.result.outputComplete && result.persisted && result.hostSettled;
  return <div aria-label={words.start}>
    <p>{words.hint}</p>
    <button type="button" disabled={!call || consumed || pending} onClick={() => void start()}>{words.start}</button>
    {pending && <button type="button" disabled={cancelled} onClick={() => void cancel()}>{words.cancel}</button>}
    <div role="status">{pending ? (cancelled ? words.cancelling : words.waiting) : consumed ? words.consumed : ""}</div>
    {failed && <p role="alert">{words.failed}</p>}
    {result && <section>
      <p>{success ? words.done : words.other} · {result.result.status} · exit {String(result.result.exitCode)}</p>
      {(!result.persisted || !result.hostSettled) && <p role="alert">{words.unsaved}</p>}
      <p>Run: {result.runId}</p>
      <UEBuildFailureDiagnosis result={result.result} preview={preview} persisted={result.persisted} hostSettled={result.hostSettled} repairAvailable={result.repairAvailable===true}/>
      {cycleStatus&&<section aria-label={locale==="zh-CN"?"修复会话进度":"Repair chain progress"}>
        <p role="status">{cycleLabels[cycleStatus]}</p><p>{locale==="zh-CN"?"已批准重建":"Approved rebuilds"}: {result.repairCycle?.rebuilds??0} / 3</p>
        <ol>{rounds.map(r=><li key={r.runId}>{r.repairCycle?.rebuilds??0}: {r.result.status} · exit {String(r.result.exitCode)} · Run {r.runId}</li>)}</ol>
        {!stop&&result.repairAvailable&&<button type="button" disabled={pending||running.current} onClick={stopRepair}>{locale==="zh-CN"?"结束本次修复会话":"Stop this repair chain"}</button>}
      </section>}
      {stop!=="user_stopped"&&stop!=="release_unconfirmed"&&result.repairAvailable===true && call && <UEBuildRepairAction key={result.runId} buildResult={result.result} preview={preview} runId={result.runId} initialSessionId={result.repairSessionId!} invoke={call}
        onActiveChange={value=>{running.current=value;onActiveChange(value);}} onStopped={reason=>setStop(reason??"operation_failed")} onRebuilt={rebuilt}/>}
      <details><summary>{words.log}</summary>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{`${result.result.stdout}\n${result.result.stderr}`.slice(-16000)}</pre>
      </details>
    </section>}
  </div>;
}
