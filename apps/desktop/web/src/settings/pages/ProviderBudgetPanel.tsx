import {useI18n} from "../../i18n";
import {useEffect,useState} from "react";
import type {DeepSeekBudgetRecord} from "@uagent/runtime";
import {createNativeProviderBudget,localNativeInvoke} from "../../runtime/native-provider-budget";
export function ProviderBudgetPanel(){
  const {text: uiText} = useI18n();
 const [record,setRecord]=useState<DeepSeekBudgetRecord|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
 async function load(initialize=false){if(busy)return;const invoke=localNativeInvoke();if(!invoke){setError("Native budget storage is unavailable in this browser. Live requests stay locked.");return;}setBusy(true);setError("");try{const budget=createNativeProviderBudget(invoke);setRecord(await (initialize?budget.initialize():budget.store.read()));}catch{setRecord(null);setError("Budget unavailable or damaged. No balance was reset. Initialization can create a new campaign only; existing damaged records require investigation.");}finally{setBusy(false);}}
 useEffect(()=>{void load();},[]);
 return <section className="ua-budget-panel" aria-label={uiText("Cumulative Flash budget")}><h4>{uiText("CNY 10 cumulative test budget")}</h4><p>{uiText("All attempts reserve their worst-case cost before sending. Failure, Stop and restart do not refund or reset reservations.")}</p>
 {record&&<dl><dt>{uiText("Conservatively reserved")}</dt><dd>{uiText("CNY")}{" "}{(record.reservedMicros/1e6).toFixed(6)}</dd><dt>{uiText("Remaining")}</dt><dd>{uiText("CNY")}{" "}{((record.limitMicros-record.reservedMicros)/1e6).toFixed(6)}</dd><dt>{uiText("Requests / uncertain")}</dt><dd>{record.requests} / {record.uncertainRequests}</dd><dt>{uiText("Reported input / output tokens")}</dt><dd>{record.inputTokens} / {record.outputTokens}</dd></dl>}
 <div className="ua-budget-actions"><button type="button" disabled={busy} onClick={()=>void load()}>{uiText("Read cumulative budget")}</button><button type="button" disabled={busy} onClick={()=>void load(true)}>{uiText("Initialize or reopen fixed budget")}</button></div>
 {error&&<p role="alert">{uiText(error)}</p>}<p>{uiText("Initialization stores only accounting metadata, never a key or prompt. There is no reset control.")}</p></section>;
}
