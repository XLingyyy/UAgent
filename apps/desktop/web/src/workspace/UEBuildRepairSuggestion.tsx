import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useI18n } from "../i18n";
import { safeProviderSession } from "../runtime/safe-provider-session";
import { requestRepairSuggestion,repairSuggestionAvailable,type RepairBuildResult } from "../runtime/ue-build-repair-proposal";
import type { UEBuildPreviewReceipt } from "../runtime/native-ue-build-preview";
export function UEBuildRepairSuggestion({file,result,preview,runId,disabled,onUse}:{file:{path:string;content:string};result:RepairBuildResult;preview:UEBuildPreviewReceipt;runId:string;disabled:boolean;onUse:(text:string)=>void}){
 const {locale}=useI18n(),zh=locale==="zh-CN";const state=useSyncExternalStore(safeProviderSession.subscribe,safeProviderSession.getSnapshot,safeProviderSession.getSnapshot);
 const [inputPrice,setInputPrice]=useState(""),[outputPrice,setOutputPrice]=useState(""),[pricesConfirmed,setPricesConfirmed]=useState(false);
 const prices={input:Number(inputPrice),output:Number(outputPrice)},validPrices=[prices.input,prices.output].every(n=>Number.isFinite(n)&&n>0);
 const [busy,setBusy]=useState(false),[suggestion,setSuggestion]=useState<string|null>(null),[failed,setFailed]=useState(false);const active=useRef<AbortController|null>(null);
 useEffect(()=>()=>{active.current?.abort();active.current=null;},[file,preview,runId]);
 useEffect(()=>{if(disabled){active.current?.abort();active.current=null;setBusy(false);setSuggestion(null);}},[disabled]);
 async function request(){if(active.current||!validPrices||!pricesConfirmed)return;const controller=new AbortController();active.current=controller;setBusy(true);setSuggestion(null);setFailed(false);
  try{const p=await requestRepairSuggestion({file,result,preview,runId,prices},controller.signal);if(active.current===controller)setSuggestion(p.after);}catch{if(active.current===controller)setFailed(true);}finally{if(active.current===controller){active.current=null;setBusy(false);}}}
 return <section aria-label={zh?"DeepSeek 单文件修复建议":"DeepSeek single-file repair suggestion"}>
  <h4>{zh?"DeepSeek 单文件修复建议":"DeepSeek single-file repair suggestion"}</h4>
  <p>{zh?"仅发送当前文件和对应报错。下一步先审阅完整外发正文及费用预估，再确认一次请求。建议不会自动写入或重建。":"Send only this file and its matching errors. Next, review the exact outbound body and cost estimate before confirming one request. Suggestions never write or rebuild automatically."}</p>
  {!repairSuggestionAvailable(state)&&<p>{zh?"需要临时 DeepSeek 会话；保存凭据和 Responses 会话暂不支持此入口。":"Requires a temporary DeepSeek session. Saved-credential and Responses sessions are not supported here."}</p>}
  <p>{zh?"请填写已核实的非缓存输入/输出单价（人民币/百万 token）。按向上取整的单价估算；不是账户扣费硬上限。":"Enter verified non-cached input/output rates in CNY per million tokens. Estimates round rates upward; this is not an account billing cap."}</p>
  <label>{zh?"输入单价":"Input price"}<input type="number" min="0" step="any" value={inputPrice} disabled={disabled||busy} onChange={e=>{setInputPrice(e.target.value);setPricesConfirmed(false);}}/></label>
  <label>{zh?"输出单价":"Output price"}<input type="number" min="0" step="any" value={outputPrice} disabled={disabled||busy} onChange={e=>{setOutputPrice(e.target.value);setPricesConfirmed(false);}}/></label>
  <label><input type="checkbox" checked={pricesConfirmed} disabled={disabled||busy||!validPrices} onChange={e=>setPricesConfirmed(e.target.checked)}/>{zh?"我已核实这些价格，下一步审阅本次外发及费用":"I verified these rates; next review this request and its cost"}</label>
  <button type="button" disabled={disabled||busy||!validPrices||!pricesConfirmed||!repairSuggestionAvailable(state)} onClick={()=>void request()}>{zh?"审阅外发内容并请求建议":"Review outbound request for suggestion"}</button>
  {busy&&<button type="button" onClick={()=>{active.current?.abort();active.current=null;setBusy(false);}}>{zh?"取消建议请求":"Cancel suggestion request"}</button>}
  {failed&&<p role="alert">{zh?"未取得有效建议：请求被拒绝、取消、会话已变更，或没有匹配报错。未采纳任何修改。":"No valid suggestion: request rejected, cancelled, session changed, or no matching errors. No edit was adopted."}</p>}
  {suggestion!==null&&<><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{suggestion}</pre><button type="button" disabled={disabled} onClick={()=>{onUse(suggestion);setSuggestion(null);}}>{zh?"采纳建议供差异审阅":"Adopt suggestion for diff review"}</button></>}
 </section>;
}
