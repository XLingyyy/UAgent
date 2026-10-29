import {useI18n} from "../i18n";
import {useState} from "react";
import {useProjectStore,useRuntimeStore} from "../stores/ui-store";
import {attachmentStore} from "../runtime/attachment-store";
import {savedText} from "../runtime/local-workspace-store";
export function LocalLogsPanel(){
  const {text: uiText} = useI18n();
 const projectId=useProjectStore(s=>s.activeProjectId);const runtime=useRuntimeStore(s=>s);const [filter,setFilter]=useState("");
 const events=Object.values(runtime.eventsByTaskId).flat().filter(e=>runtime.tasksById[e.taskId]?.draft.projectId===projectId&&/^(task_|approval_|tool_|terminal_|provider_request_)/.test(e.type)).slice(-200).filter(e=>e.type.includes(filter));
 return <section aria-label={uiText("Local task logs")}><h3>{uiText("Logs")}</h3><p>{uiText("Recent current-project task lifecycle events, in memory only. Raw prompts, model output, credentials and attachment text are excluded.")}</p><input aria-label={uiText("Filter log events")} value={filter} onChange={e=>setFilter(e.target.value)}/><ol>{events.map((e,i)=><li key={`${e.id}-${i}`}>{e.type}</li>)}</ol>{!events.length&&<p>{uiText("No matching local task events.")}</p>}</section>;
}
export function LocalAssetSearchPanel(){
  const {text: uiText,t} = useI18n();
 const project=useProjectStore(s=>s);const [query,setQuery]=useState("");const [type,setType]=useState("all");const [message,setMessage]=useState("");
 const snapshot=project.activeProjectIndex?.projectId===project.activeProjectId?project.activeProjectIndex:null;
 const assets=snapshot?.assets??[];const found=assets.filter(a=>(type==="all"||a.assetType===type)&&`${a.displayName} ${a.rootRelativePath}`.toLowerCase().includes(query.toLowerCase()));
 return <section aria-label={uiText("Local indexed asset search")}><h3>{uiText("Asset Search")}</h3><p>{uiText("Search the existing current-project index. This does not rescan files, load UE assets, or contact a provider.")}</p><input aria-label={uiText("Search indexed assets")} value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label={uiText("Asset type")} value={type} onChange={e=>setType(e.target.value)}><option value="all">{uiText("All types")}</option>{[...new Set(assets.map(a=>a.assetType))].map(t=><option key={t}>{t}</option>)}</select>
 {!snapshot&&<p>{uiText("No current project index. Use the existing project scan and trust controls first.")}</p>}
 <p>{t("assets.matchCount",{count:found.length})}</p>{found.slice(0,100).map(a=><article key={a.id}><h4>{savedText(a.displayName)}</h4><p>{savedText(a.rootRelativePath)} · {a.assetType}</p><button type="button" onClick={()=>{try{attachmentStore.addAsset(project.activeProjectId!,a.displayName,a.rootRelativePath,a.assetType);setMessage("Reference added for preview; it is not selected or sent.");}catch{setMessage("Reference could not be added. Check current project and context limits.");}}}>{t("assets.previewReference",{name:savedText(a.displayName)})}</button></article>)}<p role="status">{uiText(message)}</p></section>;
}
