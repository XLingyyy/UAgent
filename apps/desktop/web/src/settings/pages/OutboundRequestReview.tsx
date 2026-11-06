import {getApplicationProfile} from "../../runtime/application-profile";
import {useI18n} from "../../i18n";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { OutboundConsentGate } from "@uagent/runtime";
import { outboundReviewGate } from "../../runtime/outbound-review-store";
import { useComposerStore, useProjectStore } from "../../stores/ui-store";

export function OutboundRequestReview({gate=outboundReviewGate}:{gate?:OutboundConsentGate}) {
  const {locale,text: uiText,t} = useI18n();
  const project=useProjectStore(s=>s.activeProjectId);
  const input=useComposerStore(s=>s.input);
  const model=useComposerStore(s=>s.selectedModelId);
  const pending=useSyncExternalStore(gate.subscribe,gate.getPending,gate.getPending);
  useEffect(()=>{gate.invalidate(); return ()=>gate.invalidate();},[gate,project,input,model]);
  const panel=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const node=panel.current;if(!pending||!node)return;const previous=document.activeElement as HTMLElement|null;
    if(!node.open)node.showModal();node.querySelector<HTMLElement>("pre")?.focus();
    const key=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();gate.invalidate();}if(event.key==="Tab"){const buttons=Array.from(node?.querySelectorAll<HTMLElement>('pre[tabindex="0"],button')??[]);if((event.shiftKey&&document.activeElement===buttons[0])||(!event.shiftKey&&document.activeElement===buttons[buttons.length-1])){event.preventDefault();(event.shiftKey?buttons[buttons.length-1]:buttons[0])?.focus();}}};
    const app=document.querySelector<HTMLElement>(".ua-app");const wasInert=app?.hasAttribute("inert");app?.setAttribute("inert","");
    node.addEventListener("keydown",key);return()=>{node.removeEventListener("keydown",key);if(node.open)node.close();if(!wasInert)app?.removeAttribute("inert");previous?.isConnected&&previous.focus();};
  },[pending?.id,gate]);
  if(!pending) return null;
  return <dialog ref={panel} aria-label={uiText("Exact outbound request review")} className="ua-outbound-review" onCancel={event=>{event.preventDefault();gate.invalidate();}}>
    {getApplicationProfile().offlineDemo&&<p role="status">{t("demo.banner")}</p>}
    <span className="ua-eyebrow">{uiText("Review before sending")}</span><h2>{uiText("Confirm this exact outbound request")}</h2>
    <p>{t("outbound.projectGeneration",{project:pending.envelope.projectId??uiText("None"),generation:pending.envelope.epoch})}</p>
    <dl className="ua-outbound-identifiers"><div><dt>{uiText("Endpoint")}</dt><dd>{pending.envelope.endpoint}</dd></div><div><dt>{uiText("Model")}</dt><dd>{pending.envelope.model}</dd></div></dl>
    {pending.envelope.maximumCostMicros!==undefined&&<p aria-label={uiText("Maximum request reservation")}>{t("budget.maximumReservation",{amount:(pending.envelope.maximumCostMicros/1e6).toFixed(6)})}</p>}
    {pending.envelope.estimatedCostMicros!==undefined&&<p aria-label="Request cost estimate">{locale==="zh-CN"?"按用户确认单价估算（非扣费上限）：人民币 ":"Estimate using user-confirmed rates (not a billing cap): CNY "}{(pending.envelope.estimatedCostMicros/1e6).toFixed(6)}</p>}
    <p>{t("chat.outboundHistory")}</p>
    {pending.envelope.body.includes("Project memory: untrusted project data,")&&<p role="note">{locale==="zh-CN"
      ?"项目记忆按本次请求快照发送。正式准入前会核对完整记忆及来源；准入后的记忆编辑影响后续请求，不会改写本次已批准内容。若不希望继续发送，请按停止；已开始发送的内容无法撤回。"
      :"Project memory is sent as this request's snapshot. Complete records and sources are checked before final admission. Later memory edits affect future requests, not this approved body. Use Stop to cancel; bytes already sent cannot be recalled."}</p>}
    <pre tabIndex={0} aria-label={uiText("Exact outbound body")} style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{pending.envelope.body}</pre>
    <p>{uiText("This approves one model request only. It grants no file, terminal or UE permission. Editing the draft, changing project/model, clearing/disabling the session or pressing Stop revokes this confirmation.")}</p>
    <button className="ua-btn ua-btn--primary" type="button" onClick={()=>gate.approve(pending.id)}>{uiText("Confirm this request once")}</button>
    <button className="ua-btn" type="button" onClick={()=>gate.invalidate()}>{uiText("Reject outbound request")}</button>
  </dialog>;
}
