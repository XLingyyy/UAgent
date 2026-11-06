import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useI18n } from "../i18n";
import { safeProviderSession } from "../runtime/safe-provider-session";
import { requestRepairSuggestion,repairSuggestionAvailable,type RepairBuildResult } from "../runtime/ue-build-repair-proposal";
import type { UEBuildPreviewReceipt } from "../runtime/native-ue-build-preview";
const failureCopy={
 repair_no_parsed_errors:["构建失败，但未解析到可用于源码修复的错误。请检查构建输出中的工具链或执行器错误；本次未向模型发送请求。","The build failed without a parsed source-repair diagnostic. Check the build output for toolchain or executor errors. No model request was sent."],
 repair_suggestion_truncated:["模型输出被截断 [repair_suggestion_truncated]。未采纳任何修改。","The model output was truncated [repair_suggestion_truncated]. No edit was adopted."],
 repair_suggestion_invalid_json:["模型建议的 JSON 无效 [repair_suggestion_invalid_json]。未采纳任何修改。","The model suggestion is invalid JSON [repair_suggestion_invalid_json]. No edit was adopted."],
 repair_suggestion_rejected:["模型建议未通过提案校验 [repair_suggestion_rejected]。未采纳任何修改。","The model suggestion failed proposal validation [repair_suggestion_rejected]. No edit was adopted."],
 repair_suggestion_invalidated:["建议请求已因取消、会话或上下文变化失效 [repair_suggestion_invalidated]。未采纳任何修改。","The suggestion was invalidated by cancellation or a session/context change [repair_suggestion_invalidated]. No edit was adopted."],
 auth_missing:["模型服务鉴权未通过 [auth_missing]。未采纳任何修改。","Provider authentication failed [auth_missing]. No edit was adopted."],
 rate_limited:["模型服务限制了本次请求 [rate_limited]。未采纳任何修改。","The provider rate-limited this request [rate_limited]. No edit was adopted."],
 timeout:["建议请求超时 [timeout]。未采纳任何修改。","The suggestion request timed out [timeout]. No edit was adopted."],
 network_error:["建议请求传输失败 [network_error]。未采纳任何修改。","The suggestion request transport failed [network_error]. No edit was adopted."],
 malformed_response:["模型响应未通过格式校验 [malformed_response]。未采纳任何修改。","The provider response failed format validation [malformed_response]. No edit was adopted."],
 cancelled:["建议请求已取消 [cancelled]。未采纳任何修改。","The suggestion request was cancelled [cancelled]. No edit was adopted."],
 provider_unavailable:["模型服务或本次请求当前不可用 [provider_unavailable]。未采纳任何修改。","The provider or this request is currently unavailable [provider_unavailable]. No edit was adopted."],
 other:["未取得有效建议：请求被拒绝、取消、会话已变更、没有匹配报错，或建议不完整。未采纳任何修改。","No valid suggestion: request rejected, cancelled, session changed, no matching errors, or incomplete suggestions. No edit was adopted."],
} as const;
type SuggestionFailure=keyof typeof failureCopy;
function suggestionFailure(error:unknown):SuggestionFailure{
 if(error&&typeof error==="object"&&"name" in error&&error.name==="ProviderRuntimeError"&&"code" in error){
  const code=(["auth_missing","rate_limited","timeout","network_error","malformed_response","cancelled","provider_unavailable"] as const).find(code=>code===error.code);
  if(code)return code;
 }
 if(error instanceof Error){
  if(error.message==="repair_model_session_unavailable")return "repair_suggestion_invalidated";
  if(error.message==="repair_suggestion_contains_redaction")return "repair_suggestion_rejected";
  const code=(["repair_no_parsed_errors","repair_suggestion_truncated","repair_suggestion_invalid_json","repair_suggestion_rejected","repair_suggestion_invalidated"] as const).find(code=>code===error.message);
  if(code)return code;
 }
 return "other";
}
export function UEBuildRepairSuggestion({files,result,preview,runId,disabled,onUse}:{files:readonly {path:string;content:string}[];result:RepairBuildResult;preview:UEBuildPreviewReceipt;runId:string;disabled:boolean;onUse:(proposals:{path:string;after:string}[])=>void}){
 const {locale}=useI18n(),zh=locale==="zh-CN";const state=useSyncExternalStore(safeProviderSession.subscribe,safeProviderSession.getSnapshot,safeProviderSession.getSnapshot);
 const [inputPrice,setInputPrice]=useState(""),[outputPrice,setOutputPrice]=useState(""),[pricesConfirmed,setPricesConfirmed]=useState(false);
 const prices={input:Number(inputPrice),output:Number(outputPrice)},validPrices=[prices.input,prices.output].every(n=>Number.isFinite(n)&&n>0);
 const [busy,setBusy]=useState(false),[suggestions,setSuggestions]=useState<{path:string;after:string}[]|null>(null),[failure,setFailure]=useState<SuggestionFailure|null>(null);const active=useRef<AbortController|null>(null);
 useEffect(()=>{setBusy(false);setSuggestions(null);setFailure(null);return()=>{active.current?.abort();active.current=null;};},[files,result,preview,runId,disabled]);
 async function request(){if(active.current||!validPrices||!pricesConfirmed)return;const controller=new AbortController();active.current=controller;setBusy(true);setSuggestions(null);setFailure(null);
  try{const proposals=await requestRepairSuggestion({files,result,preview,runId,prices},controller.signal);if(active.current===controller)setSuggestions(proposals);}catch(error){if(active.current===controller)setFailure(suggestionFailure(error));}finally{if(active.current===controller){active.current=null;setBusy(false);}}}
 return <section aria-label={zh?"DeepSeek 修复建议":"DeepSeek repair suggestions"}>
  <h4>{zh?"DeepSeek 修复建议":"DeepSeek repair suggestions"}</h4>
  <p>{zh?"发送本次已读取的 1–8 个文件和对应报错。下一步先审阅完整外发正文及费用预估，再确认一次请求。逐文件查看建议后，可一次采纳到待审阅草稿；不会自动写入或重建。":"Send the 1–8 files read for this batch and their matching errors. Next, review the exact outbound body and cost estimate before confirming one request. Review each proposed replacement, then adopt the suggestions into the drafts together. No automatic write or rebuild."}</p>
  <ul aria-label={zh?"本次请求包含的文件":"Files included in this request"}>{files.map(file=><li key={file.path}><code>{file.path}</code></li>)}</ul>
  <p>{zh?"完整请求限 32 KiB；过长或被截断的建议会拒绝，可减少所选文件后重新请求。":"The complete request is limited to 32 KiB. Oversized or truncated suggestions are rejected; select fewer files before requesting again."}</p>
  {!repairSuggestionAvailable(state)&&<p>{zh?"需要临时 DeepSeek 会话；保存凭据和 Responses 会话暂不支持此入口。":"Requires a temporary DeepSeek session. Saved-credential and Responses sessions are not supported here."}</p>}
  <p>{zh?"请填写已核实的非缓存输入/输出单价（人民币/百万 token）。按向上取整的单价估算；不是账户扣费硬上限。":"Enter verified non-cached input/output rates in CNY per million tokens. Estimates round rates upward; this is not an account billing cap."}</p>
  <label>{zh?"输入单价":"Input price"}<input type="number" min="0" step="any" value={inputPrice} disabled={disabled||busy} onChange={e=>{setInputPrice(e.target.value);setPricesConfirmed(false);}}/></label>
  <label>{zh?"输出单价":"Output price"}<input type="number" min="0" step="any" value={outputPrice} disabled={disabled||busy} onChange={e=>{setOutputPrice(e.target.value);setPricesConfirmed(false);}}/></label>
  <label><input type="checkbox" checked={pricesConfirmed} disabled={disabled||busy||!validPrices} onChange={e=>setPricesConfirmed(e.target.checked)}/>{zh?"我已核实这些价格，下一步审阅本次外发及费用":"I verified these rates; next review this request and its cost"}</label>
  <button type="button" disabled={disabled||busy||!validPrices||!pricesConfirmed||!repairSuggestionAvailable(state)} onClick={()=>void request()}>{zh?"审阅外发内容并请求建议":"Review outbound request for suggestion"}</button>
  {busy&&<button type="button" onClick={()=>{active.current?.abort();active.current=null;setBusy(false);}}>{zh?"取消建议请求":"Cancel suggestion request"}</button>}
  {failure&&<p role="alert">{failureCopy[failure][zh?0:1]}</p>}
  {suggestions!==null&&<>{suggestions.map(proposal=><section key={proposal.path} aria-label={(zh?"建议替换内容：":"Suggested replacement: ")+proposal.path}><h5>{proposal.path}</h5><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{proposal.after}</pre></section>)}<button type="button" disabled={disabled} onClick={()=>{onUse(suggestions);setSuggestions(null);}}>{zh?"采纳全部建议供差异审阅":"Adopt suggestions for diff review"}</button></>}
 </section>;
}
