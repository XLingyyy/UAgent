import {useEffect,useRef,useState} from "react";
import {useI18n} from "../i18n";
import {RunHistoryPanel} from "./RunHistoryPanel";
import {SessionCatalogPanel} from "./SessionCatalogPanel";
import type {NativeSessionContinuation} from "../runtime/native-session-catalog";
import type {NativeHistorySearchSelection} from "../runtime/native-run-history-search";
import {canContinueNativeHistory,completedArchivedDiscussionText,type NativeRunArchive} from "../runtime/native-run-history";
import {safeProviderSession} from "../runtime/safe-provider-session";
import {useProjectActions,useProjectStore,useComposerActions,useThreadActions,useSettingsActions,useRuntimeStore} from "../stores/ui-store";
import "./NativeHistoryAccess.css";
export function NativeHistoryAccess(){
 const {t,locale}=useI18n(),[open,setOpen]=useState(false),panel=useRef<HTMLDialogElement>(null);
 const [view,setView]=useState<"runs"|"sessions">("runs"),[anchor,setAnchor]=useState<NativeRunArchive|null>(null);
 const [selection,setSelection]=useState<NativeHistorySearchSelection|null>(null),[preparationError,setPreparationError]=useState<string|null>(null);
 const projectId=useProjectStore(s=>s.activeProjectId),projects=useProjectActions(),composer=useComposerActions(),threads=useThreadActions(),settings=useSettingsActions();
 const active=useRuntimeStore(s=>s.activeTaskId?s.tasksById[s.activeTaskId]:null),busy=Boolean(active&&!["completed","failed","cancelled"].includes(active.state));
 useEffect(()=>{const node=panel.current;if(!open||!node)return;if(!node.open)node.showModal();return()=>{if(node.open)node.close();};},[open]);
 async function prepareSession(request:NativeSessionContinuation,isCurrent:()=>boolean){
  setPreparationError(null);
  try{
   if(!anchor||anchor.descriptor.projectId!==request.session.projectId||!composer.prepareSessionDraft)throw Error("session_preparation_unavailable");
   await composer.prepareSessionDraft(request,anchor.descriptor.runId,isCurrent);
   if(isCurrent())setOpen(false);
  }catch(error){
   if(isCurrent()){
    const code=error&&typeof error==="object"&&"kind" in error?String(error.kind):error instanceof Error?error.message:"";
    const zh=locale==="zh-CN";
    setPreparationError(code==="session_project_requires_selection"?(zh?"请先在项目设置重新选择并信任对应项目，再准备这个会话的新任务。":"Select and trust this session's project in settings before preparing a new task."):
     code==="branchCapacity"?(zh?"引用资料超过 8 KiB 草稿预算。请先建立较小的会话分支；内容不会被自动截断。":"Quoted context exceeds the 8 KiB draft budget. Create a smaller branch; text is never silently truncated."):
     code==="session_unresolved_effects"?(zh?"原记录存在未解决的执行状态，当前无法准备继续。":"The original record has unresolved execution state."):
     code==="session_attachments_require_review"?(zh?"请先处理当前草稿已选附件，再准备新的会话草稿。":"Review the current draft's selected attachments first."):
     (zh?"准备已停止。请刷新记录并重新检查当前项目和模型选择。":"Preparation stopped. Refresh and check the current project and model selection."));
   }
   throw error;
  }
 }
 async function continueSaved(archive:NativeRunArchive,share:boolean){
  if(busy||!canContinueNativeHistory(archive))throw Error("archive_not_continuable");
  await safeProviderSession.closeAsync("revoked");threads.setActiveThread(null);
  if(archive.coordinatorState?.taskMode==="discussion"){
   const state=archive.coordinatorState,logical=state.logicalProjectId;
   if((logical!==null&&typeof logical!=="string")||typeof state.providerId!=="string"||typeof state.modelId!=="string")throw Error("archive_identity_invalid");
   await projects.setActiveProject(logical);
   await composer.setComposerModel(JSON.stringify([state.providerId,state.modelId]));
   const messages=share?completedArchivedDiscussionText(archive):[];
   composer.setComposerInput("");composer.setSavedRun({taskMode:"discussion",logicalProjectId:logical,providerId:state.providerId,modelId:state.modelId,parentRunId:archive.descriptor.runId,projectId:archive.descriptor.projectId,conversationId:crypto.randomUUID(),includeCompletedContext:share,completed:true,hasUnresolvedEffects:false,messages});
   composer.setComposerTaskMode("discussion");setOpen(false);settings.openSettings("provider");return;
  }
  const id=await projects.addProjectRoot(archive.descriptor.projectRoot);if(!id)throw Error("project_unavailable");
  composer.setComposerInput(archive.descriptor.goal);composer.setSavedRun({
   parentRunId:archive.descriptor.runId,projectId:archive.descriptor.projectId,conversationId:archive.descriptor.sessionId,
   includeCompletedContext:share,completed:archive.descriptor.status==="succeeded",hasUnresolvedEffects:false,messages:share?archive.providerMessages:[],
  });composer.setComposerTaskMode("investigation");setOpen(false);settings.openSettings("config");
 }
 return <><button className="ua-history-open" type="button" disabled={open} onClick={()=>setOpen(true)}>{t("historyRun.open")}</button>
  {open&&<dialog ref={panel} className="ua-history-drawer" aria-label={t("historyRun.title")}
   onCancel={event=>{event.preventDefault();setOpen(false);}} onClose={()=>setOpen(false)}>
   <nav className="ua-history-drawer__tabs" aria-label={locale==="zh-CN"?"保存记录":"Saved records"}>
    <button type="button" aria-pressed={view==="runs"} onClick={()=>setView("runs")}>{locale==="zh-CN"?"运行记录":"Runs"}</button>
    <button type="button" aria-pressed={view==="sessions"} disabled={!anchor} onClick={()=>setView("sessions")}>{locale==="zh-CN"?"会话管理":"Sessions"}</button>
    <button type="button" onClick={()=>setOpen(false)}>{locale==="zh-CN"?"关闭":"Close"}</button>
   </nav>
   <div className="ua-history-drawer__content">
   {view==="runs"?<RunHistoryPanel projectId={projectId} onClose={()=>setOpen(false)} onContinue={continueSaved} continuationDisabled={busy}
      initialSelection={selection} onOpenSessions={archive=>{setAnchor(archive);setPreparationError(null);setView("sessions");}}/>:
    <>{preparationError&&<p className="ua-history-drawer__error" role="alert">{preparationError}</p>}
     <SessionCatalogPanel projectId={anchor?.descriptor.projectId??null} onClose={()=>setView("runs")}
      onContinue={prepareSession} continuationDisabled={busy}
      onOpenArchive={value=>{setSelection(value);setView("runs");}}/>
    </>}
   </div>
  </dialog>}
 </>;
}
