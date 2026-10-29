import {useEffect,useRef} from "react";
import {useI18n} from "../i18n";
import {ProviderProposalPanel} from "./ProviderProposalPanel";
import {ConversationMessage} from "./ConversationMessage";
import {ConversationMarkdown} from "./ConversationMarkdown";
import type {WorkspaceMessage} from "./workspace-data";
import {mapTaskEventToWorkspaceMessage} from "../runtime/event-view-models";
import {assistantText,conversationTasks,conversationKey,completedConversationHistory} from "../runtime/conversation-context";
import {useRuntimeStore,useThreadStore,useThreadActions,useProjectStore,useComposerStore} from "../stores/ui-store";
import "./ConversationViewport.css";

export interface ConversationViewportProps{messages?:WorkspaceMessage[]}
export function ConversationViewport({messages=[]}:ConversationViewportProps){
 const {t}=useI18n();const active=useThreadStore(s=>s.activeThreadId),project=useProjectStore(s=>s.activeProjectId),runtime=useRuntimeStore(s=>s);
 const {setActiveThread}=useThreadActions();const tasks=conversationTasks(runtime.tasksById,active,project),list=useRef<HTMLDivElement>(null),follow=useRef(true);
 const selectedModel=useComposerStore(s=>s.selectedModelId);
 const contextTurns=completedConversationHistory(tasks.filter(task=>JSON.stringify([task.draft.providerId,task.draft.modelId])===selectedModel),runtime.eventsByTaskId).length/2;
 const key=tasks.length?conversationKey(tasks[0]):active;
 useEffect(()=>{follow.current=true;},[key,tasks.length]);
 useEffect(()=>{if(follow.current&&list.current)list.current.scrollTop=list.current.scrollHeight;},[runtime.eventsByTaskId,tasks.length,key]);
 return <section className="ua-conversation-viewport ua-chat" aria-label={t("chat.conversation")}>
  <header className="ua-chat-header"><strong>{t("chat.conversation")}</strong><button type="button" onClick={()=>setActiveThread(null)}>{t("chat.new")}</button></header>
  <div ref={list} className="ua-conversation-viewport__list ua-chat-list" onScroll={()=>{const n=list.current;if(n)follow.current=n.scrollHeight-n.scrollTop-n.clientHeight<90;}}>
   {tasks.map(task=>{const events=runtime.eventsByTaskId[task.id]??[],answer=assistantText(events),pending=!["completed","failed","cancelled"].includes(task.state),failed=task.state==="failed",cancelled=task.state==="cancelled";
    return <div className="ua-chat-turn" key={task.id} data-task-id={task.id}>
     <article className="ua-chat-message ua-chat-message--user" aria-label={t("chat.user")}><span className="ua-chat-role">{t("chat.user")}</span><p>{task.draft.input}</p></article>
     <article className="ua-chat-message ua-chat-message--assistant" aria-label={t("chat.assistant")} aria-busy={pending} data-streaming={pending}>
      <span className="ua-chat-role">{t("chat.assistant")}</span>{answer?<ConversationMarkdown text={answer}/>:pending?<p className="ua-chat-pending" role="status">{t("chat.replying")}</p>:null}
      {(failed||cancelled)&&<p className="ua-chat-issue" role="status">{t(cancelled?"chat.stopped":"chat.failed")}</p>}
     </article>
     <details className="ua-chat-details"><summary>{t("chat.details")}</summary>{events.map(event=><ConversationMessage key={event.id} message={mapTaskEventToWorkspaceMessage(event)}/>)}</details>
    </div>;
   })}
   {!tasks.length&&messages.map(message=><ConversationMessage key={message.id} message={message}/>)}
   <ProviderProposalPanel/>
   <details className="ua-chat-context"><summary>{t("chat.contextCount",{count:contextTurns})}</summary><p>{t("chat.contextHelp")}</p><p>{t("chat.historySharing")}</p></details>
  </div>
 </section>;
}
