import {useI18n} from "../i18n";
import {useSyncExternalStore} from "react";
import {useProviderProposalService} from "../stores/ui-store";
const noop=()=>()=>{};const empty=()=>null;
export function ProviderProposalPanel(){
  const {text: uiText} = useI18n();
 const service=useProviderProposalService();const state=useSyncExternalStore(service?.subscribe??noop,service?.getSnapshot??empty,empty);
 if(!state)return null;
 return <section className="ua-proposal-panel" aria-label={uiText("Model proposal requiring approval")}><h3>{uiText("Proposed read-only command")}</h3><p><code>{state.command}</code> · {uiText("Project")}: {state.projectId}</p><p>{state.reason}</p><p>{uiText("Only this command in the current trusted project. File/UE writes, arbitrary shell commands and full test suites are not authorized here.")}</p>
 <button type="button" disabled={state.status!=="pending"} onClick={()=>void service?.approve(state.id)}>{uiText("Approve this read-only command")}</button>
 <button type="button" disabled={state.status!=="pending"} onClick={()=>service?.reject(state.id)}>{uiText("Reject proposal")}</button>
 <button type="button" disabled={!["pending","executing"].includes(state.status)&&!(state.status==="completed"&&["idle","requesting"].includes(state.feedbackStatus??""))} onClick={()=>service?.invalidate()}>{uiText("Stop proposed workflow")}</button>
 <p role="status">{uiText(({pending:"Pending approval",executing:"Running",completed:"Completed",rejected:"Rejected",cancelled:"Cancelled",failed:"Failed"} as Record<string,string>)[state.status])}: {state.status === "completed" ? state.summary : uiText(state.summary)}</p>
 {state.status==="completed"&&<section aria-label={uiText("Selected tool result for model feedback")}><h4>{uiText("Optional model analysis of this result")}</h4>
 <p>{uiText("Nothing is shared automatically. Choose a redacted excerpt, remove private business content, then review a new complete request and cost. At most one follow-up per task; its answer cannot trigger more tools.")}</p>
 <button type="button" disabled={state.feedbackStatus!=="idle"} onClick={()=>service?.useResultForFeedback(state.id)}>{uiText("Use redacted result for editing")}</button>
 <textarea aria-label={uiText("Edited tool result to share")} value={state.feedbackDraft??""} disabled={state.feedbackStatus!=="idle"} maxLength={4096} onChange={e=>service?.setFeedbackDraft(state.id,e.target.value)}/>
 <p>{uiText("Up to 4 KiB / 80 lines after redaction. Automatic masking cannot identify every confidential detail. Editing clears selection.")}</p>
 <label><input type="checkbox" checked={state.feedbackSelected??false} disabled={state.feedbackStatus!=="idle"||!state.feedbackDraft?.trim()} onChange={e=>service?.selectFeedback(state.id,e.target.checked)}/>{uiText("Share this edited result only")}</label>
 <button type="button" disabled={state.feedbackStatus!=="idle"||!state.feedbackSelected||!state.feedbackDraft?.trim()} onClick={()=>void service?.requestFeedback(state.id)}>{uiText("Review one model follow-up")}</button>
 <p role="status">{state.feedbackNotice ? uiText(state.feedbackNotice) : ""}</p>{state.feedbackResult&&<pre aria-label={uiText("Model feedback analysis")} style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{state.feedbackResult}</pre>}</section>}
 </section>;
}
