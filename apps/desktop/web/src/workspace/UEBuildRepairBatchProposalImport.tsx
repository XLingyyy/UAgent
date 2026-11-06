import {useState} from "react";
import {parseMultiFileBuildRepairProposal} from "@uagent/runtime";
import {useI18n} from "../i18n";
import {SourceChangeReview} from "./SourceChangeReview";
type File={path:string;content:string};
export function UEBuildRepairBatchProposalImport({files,disabled,onUse}:{files:readonly File[];disabled:boolean;onUse:(path:string,after:string)=>void}){
 const {locale}=useI18n(),zh=locale==="zh-CN";
 const [text,setText]=useState(""),[error,setError]=useState(false);
 const [proposal,setProposal]=useState<{scope:readonly File[];items:{path:string;after:string}[];adopted:string[]}|null>(null);
 const current=proposal?.scope===files?proposal:null;
 function validate(){if(disabled)return;try{setProposal({scope:files,items:parseMultiFileBuildRepairProposal(text,files),adopted:[]});setError(false);}catch{setProposal(null);setError(true);}}
 function use(path:string,after:string){if(disabled||!current||current.adopted.includes(path))return;onUse(path,after);setProposal({...current,adopted:[...current.adopted,path]});}
 return <section aria-label={zh?"导入多文件修复建议":"Import multi-file repair suggestions"}>
  <h4>{zh?"导入多文件修复建议":"Import multi-file repair suggestions"}</h4>
  <p>{zh?'粘贴本地模型响应：{"files":[{"path":"已读取的 Source 路径","after":"完整替换内容"}]}。仅接受本次已读取的文件，最多 8 个；无变化的条目不列出。此入口不调用模型或发送源码。':'Paste a local response: {"files":[{"path":"already-read Source path","after":"complete replacement content"}]}. Only files read in this session are accepted, up to 8; unchanged entries are omitted. No model call or source upload occurs.'}</p>
  <label>{zh?"多文件建议 JSON（仅本地处理）":"Multi-file suggestion JSON (local processing only)"}<textarea rows={6} maxLength={2097152} disabled={disabled} value={text} onChange={e=>{setText(e.target.value);setProposal(null);setError(false);}}/></label>
  <button type="button" disabled={disabled||!text.trim()} onClick={validate}>{zh?"校验本批建议":"Validate batch suggestions"}</button>
  {error&&<p role="alert">{zh?"整批建议无效：请检查文件范围、重复路径、格式和内容大小。未采纳或写入任何文件。":"The batch is invalid. Check scope, duplicate paths, format and content limits. Nothing was adopted or written."}</p>}
  {current&&<><p>{zh?"逐文件采纳只填入待审阅内容，可能替换你尚未写入的手工编辑。完成选择后仍须准备整批精确差异并统一批准写入；重建另行批准。":"Adopting a file only fills its review editor and may replace your unsaved manual edits. Then prepare the complete batch diff and approve the write together; rebuilding requires separate approval."}</p>
   {current.items.map(item=><section key={item.path} aria-label={(zh?"建议：":"Suggestion: ")+item.path}>
    <h5>{item.path}</h5><SourceChangeReview before={files.find(f=>f.path===item.path)!.content} after={item.after}/>
    <details><summary>{zh?"查看完整建议内容":"View complete suggested content"}</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{item.after}</pre></details>
    <button type="button" disabled={disabled||current.adopted.includes(item.path)} onClick={()=>use(item.path,item.after)}>{current.adopted.includes(item.path)?(zh?"已采纳：":"Adopted: "):(zh?"采纳文件：":"Adopt file: ")}{item.path}</button>
   </section>)}
  </>}
 </section>;
}
