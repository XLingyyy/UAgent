import {useI18n} from "../../i18n";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { OutboundConsentGate } from "@uagent/runtime";
import { outboundReviewGate } from "../../runtime/outbound-review-store";
import { useComposerStore, useProjectStore } from "../../stores/ui-store";

export function OutboundRequestReview({gate=outboundReviewGate}:{gate?:OutboundConsentGate}) {
  const {text: uiText,t} = useI18n();
  const project=useProjectStore(s=>s.activeProjectId);
  const input=useComposerStore(s=>s.input);
  const model=useComposerStore(s=>s.selectedModelId);
  const pending=useSyncExternalStore(gate.subscribe,gate.getPending,gate.getPending);
  useEffect(()=>{gate.invalidate(); return ()=>gate.invalidate();},[gate,project,input,model]);
  const panel=useRef<HTMLElement>(null);
  useEffect(()=>{
    if(!pending)return;const previous=document.activeElement as HTMLElement|null;const node=panel.current;node?.querySelector<HTMLElement>("pre")?.focus();
    const key=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();gate.invalidate();}if(event.key==="Tab"){const buttons=Array.from(node?.querySelectorAll<HTMLElement>('pre[tabindex="0"],button')??[]);if((event.shiftKey&&document.activeElement===buttons[0])||(!event.shiftKey&&document.activeElement===buttons[buttons.length-1])){event.preventDefault();(event.shiftKey?buttons[buttons.length-1]:buttons[0])?.focus();}}};
    const app=document.querySelector<HTMLElement>(".ua-app");const wasInert=app?.hasAttribute("inert");app?.setAttribute("inert","");
    node?.addEventListener("keydown",key);return()=>{node?.removeEventListener("keydown",key);if(!wasInert)app?.removeAttribute("inert");previous?.isConnected&&previous.focus();};
  },[pending?.id,gate]);
  if(!pending) return null;
  return <section ref={panel} role="dialog" aria-modal="true" aria-label={uiText("Exact outbound request review")} className="ua-outbound-review">
    <span className="ua-eyebrow">{uiText("Review before sending")}</span><h2>{uiText("Confirm this exact outbound request")}</h2>
    <p>{t("outbound.projectGeneration",{project:pending.envelope.projectId??uiText("None"),generation:pending.envelope.epoch})}</p>
    <dl className="ua-outbound-identifiers"><div><dt>{uiText("Endpoint")}</dt><dd>{pending.envelope.endpoint}</dd></div><div><dt>{uiText("Model")}</dt><dd>{pending.envelope.model}</dd></div></dl>
    {pending.envelope.maximumCostMicros!==undefined&&<p aria-label={uiText("Maximum request reservation")}>{t("budget.maximumReservation",{amount:(pending.envelope.maximumCostMicros/1e6).toFixed(6)})}</p>}
    <p>{t("chat.outboundHistory")}</p>
    <pre tabIndex={0} aria-label={uiText("Exact outbound body")} style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{pending.envelope.body}</pre>
    <p>{uiText("This approves one model request only. It grants no file, terminal or UE permission. Editing the draft, changing project/model, clearing/disabling the session or pressing Stop revokes this confirmation.")}</p>
    <button className="ua-btn ua-btn--primary" type="button" onClick={()=>gate.approve(pending.id)}>{uiText("Confirm this request once")}</button>
    <button className="ua-btn" type="button" onClick={()=>gate.invalidate()}>{uiText("Reject outbound request")}</button>
  </section>;
}
