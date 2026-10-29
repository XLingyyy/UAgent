import {conversationTasks,assistantText} from "../../runtime/conversation-context";
import {useI18n} from "../../i18n";
import { useEffect,useState,useSyncExternalStore } from "react";
import { emptyWorkspace,localWorkspaceStore,savedText,type SavedChat } from "../../runtime/local-workspace-store";
import { useWorkspacePersistenceActions,useRuntimeStore,useThreadStore,useProjectStore } from "../../stores/ui-store";

export function LocalWorkspaceBootstrap(){
 const actions=useWorkspacePersistenceActions();
 useEffect(()=>{let active=true;void localWorkspaceStore.load().then(async()=>{const state=localWorkspaceStore.getSnapshot();if(active&&!state.error&&state.record)await actions.restore(state.record.workspace,()=>active);}).catch(()=>undefined);return()=>{active=false;};},[actions]);
 return null;
}
export function LocalWorkspacePanel(){
  const {text: uiText} = useI18n();
 const state=useSyncExternalStore(localWorkspaceStore.subscribe,localWorkspaceStore.getSnapshot,localWorkspaceStore.getSnapshot);
 const actions=useWorkspacePersistenceActions();const runtime=useRuntimeStore(s=>s);const thread=useThreadStore(s=>s.activeThreadId);
 const project=useProjectStore(s=>s.registeredProjects.find(p=>p.id===s.activeProjectId));const [message,setMessage]=useState("");
 useEffect(()=>{void localWorkspaceStore.load();},[]);
 async function save(chat:boolean){try{
   const config=actions.capture();let chats=state.record?.workspace.chats??[];
   if(chat){const task=thread?runtime.tasksById[thread]:null;if(!task)throw Error("no_conversation");
     const group=conversationTasks(runtime.tasksById,thread,task.draft.projectId);
     const messages:SavedChat["messages"]=group.flatMap(turn=>{const events=runtime.eventsByTaskId[turn.id]??[],answer=turn.state==="completed"?assistantText(events):"";return [{role:"user" as const,text:savedText(turn.draft.input)},...(answer?[{role:"assistant" as const,text:savedText(answer)}]:[]),...events.filter(e=>e.type==="tool_completed"||e.type==="terminal_real_completed").slice(-8).map(e=>({role:"tool" as const,text:savedText(e.body??e.title)})),...(turn.state==="completed"?events.filter(e=>e.type==="task_completed"&&e.title==="Model result analysis completed").slice(-1).map(e=>({role:"assistant" as const,text:savedText(e.body??"")})):[])];});
     const item:SavedChat={id:crypto.randomUUID(),title:savedText(group[0]?.title??task.title,50),projectLabel:savedText(project?.name??"No project",50),createdAt:Date.now(),archived:false,messages:messages.slice(-30)};
     if(chats.length>=30)throw Error("history_limit");chats=[...chats,item];
   }
   await localWorkspaceStore.save({...config,chats});setMessage(chat?"Saved a redacted conversation copy. No execution can resume from it.":"Saved local configuration. Trust and live credentials are not saved.");
 }catch{setMessage("Could not save. Check native storage, current conversation and the 30-chat limit.");}}
 return <section className="ua-settings-section" aria-label={uiText("Local workspace persistence")}><h3>{uiText("Local configuration and history")}</h3>
  <p>{uiText("Save theme, registered project paths and the supported model selection. Restored projects need fresh trust, and model sessions stay closed.")}</p>
  <p>{uiText("Conversations are saved only when requested, as redacted text (up to 2,000 characters per message). Raw attachments, tokens and full event payloads are excluded. No existing private history is imported.")}</p>
  <button type="button" disabled={state.busy||!state.loaded||!!state.error} onClick={()=>void save(false)}>{uiText("Save local configuration")}</button>
  <button type="button" disabled={state.busy||!thread||!!state.error} onClick={()=>void save(true)}>{uiText("Save redacted conversation copy")}</button>
  <button type="button" disabled={state.busy} onClick={()=>void localWorkspaceStore.load()}>{uiText("Reload saved data")}</button>
  <button type="button" disabled={!state.record||state.busy} onClick={()=>void actions.restore(state.record?.workspace??emptyWorkspace()).then(()=>setMessage("Configuration restored; roots are untrusted.")).catch(()=>setMessage("Some saved roots are unavailable; current state was not replaced."))}>{uiText("Restore saved configuration")}</button>
  <p role="status">{uiText(state.error??message)}</p>
 </section>;
}
