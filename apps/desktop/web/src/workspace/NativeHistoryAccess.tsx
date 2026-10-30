import {useEffect,useRef,useState} from "react";
import {useI18n} from "../i18n";
import {RunHistoryPanel} from "./RunHistoryPanel";
import {canContinueNativeHistory,completedArchivedDiscussionText,type NativeRunArchive} from "../runtime/native-run-history";
import {safeProviderSession} from "../runtime/safe-provider-session";
import {useProjectActions,useProjectStore,useComposerActions,useThreadActions,useSettingsActions,useRuntimeStore} from "../stores/ui-store";
import "./NativeHistoryAccess.css";
export function NativeHistoryAccess(){
 const {t}=useI18n(),[open,setOpen]=useState(false),panel=useRef<HTMLElement>(null);
 const projectId=useProjectStore(s=>s.activeProjectId),projects=useProjectActions(),composer=useComposerActions(),threads=useThreadActions(),settings=useSettingsActions();
 const active=useRuntimeStore(s=>s.activeTaskId?s.tasksById[s.activeTaskId]:null),busy=Boolean(active&&!["completed","failed","cancelled"].includes(active.state));
 useEffect(()=>{
  if(!open)return;const previous=document.activeElement as HTMLElement|null,app=document.querySelector<HTMLElement>(".ua-app"),was=app?.hasAttribute("inert");app?.setAttribute("inert","");
  const node=panel.current;node?.querySelector<HTMLElement>("button")?.focus();
  const key=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();setOpen(false);}if(event.key==="Tab"){const controls=[...node!.querySelectorAll<HTMLElement>("button,input,select,summary,[tabindex='0']")].filter(n=>!n.hasAttribute("disabled")&&n.getClientRects().length);const first=controls[0],last=controls.at(-1);if((event.shiftKey&&document.activeElement===first)||(!event.shiftKey&&document.activeElement===last)){event.preventDefault();(event.shiftKey?last:first)?.focus();}}};node?.addEventListener("keydown",key);
  return()=>{node?.removeEventListener("keydown",key);if(!was)app?.removeAttribute("inert");if(previous?.isConnected)previous.focus();};
 },[open]);
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
 return <><button className="ua-history-open" type="button" disabled={open} onClick={()=>setOpen(true)}>{t("historyRun.open")}</button>{open&&<aside ref={panel} className="ua-history-drawer" role="dialog" aria-modal="true" aria-label={t("historyRun.title")}><RunHistoryPanel projectId={projectId} onClose={()=>setOpen(false)} onContinue={continueSaved} continuationDisabled={busy}/></aside>}</>;
}
