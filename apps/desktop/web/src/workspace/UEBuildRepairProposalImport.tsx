import { useState } from "react";
import { parseSingleFileBuildRepairProposal } from "@uagent/runtime";
import { useI18n } from "../i18n";
const copy={
 "zh-CN":{title:"导入模型修复建议",input:"模型响应 JSON（仅本地处理）",check:"校验当前文件建议",use:"采用为待审阅内容",hint:'粘贴已有响应，格式为 {"files":[{"path":"当前文件路径","after":"完整替换内容"}]}。此入口不会调用模型或外发源码。',bad:"响应不是当前单文件的有效替换建议；未采用，未修改文件。",notice:"建议未验证。采用后仍须准备精确差异、批准写入，再单独批准重建。"},
 en:{title:"Import model repair suggestion",input:"Model response JSON (local processing only)",check:"Validate suggestion for this file",use:"Use as content for review",hint:'Paste an existing response: {"files":[{"path":"current file path","after":"complete replacement content"}]}. This entry does not call a model or send source code.',bad:"The response is not a valid replacement for this single file. Nothing was adopted or written.",notice:"The suggestion is unverified. After adopting it, prepare the exact change, approve writing, then separately approve rebuilding."}
};
export function UEBuildRepairProposalImport({file,disabled,onUse}:{file:{path:string;content:string};disabled:boolean;onUse:(after:string)=>void}){
 const {locale}=useI18n(),w=copy[locale];const [text,setText]=useState(""),[proposal,setProposal]=useState<{path:string;after:string}|null>(null),[error,setError]=useState(false);
 return <section aria-label={w.title}><h4>{w.title}</h4><p>{w.hint}</p>
  <label>{w.input}<textarea rows={5} maxLength={2097152} value={text} disabled={disabled} onChange={e=>{setText(e.target.value);setProposal(null);setError(false);}}/></label>
  <button type="button" disabled={disabled||!text.trim()} onClick={()=>{try{setProposal(parseSingleFileBuildRepairProposal(text,file));setError(false);}catch{setProposal(null);setError(true);}}}>{w.check}</button>
  {error&&<p role="alert">{w.bad}</p>}
  {proposal&&<><p>{proposal.path}</p><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{proposal.after}</pre><p>{w.notice}</p>
    <button type="button" disabled={disabled} onClick={()=>{onUse(proposal.after);setProposal(null);}}>{w.use}</button></>}
 </section>;
}
