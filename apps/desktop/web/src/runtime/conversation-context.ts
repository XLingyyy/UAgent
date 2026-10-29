import type {TaskEvent,TaskRecord} from "@uagent/shared";
import {boundConversationHistory,MAX_CONVERSATION_TURNS} from "@uagent/runtime";
export const conversationKey=(task:TaskRecord)=>task.draft.conversationId??task.id;
export function conversationTasks(tasks:Record<string,TaskRecord>,activeId:string|null,projectId:string|null){
 const active=activeId?tasks[activeId]:null;if(!active||active.draft.projectId!==projectId)return[];
 return Object.values(tasks).filter(task=>task.draft.projectId===projectId&&conversationKey(task)===conversationKey(active)).sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id));
}
export function assistantText(events:TaskEvent[]){
 const streamed=events.filter(e=>e.type==="provider_stream_delta").map(e=>e.body??"").join("");
 if(streamed)return streamed;
 const done=events.find(e=>e.type==="provider_request_completed");const payload=done?.payload as {responseText?:unknown}|undefined;
 return typeof payload?.responseText==="string"?payload.responseText:"";
}
export function completedConversationHistory(tasks:TaskRecord[],events:Record<string,TaskEvent[]>){
 const history:Array<{role:"user"|"assistant";content:string}>=[];
 for(const task of tasks){const activity=events[task.id]??[];
  if(task.state!=="completed"||task.draft.historyEligible===false||!activity.some(e=>e.type==="provider_request_completed")||activity.some(e=>/^(tool_|terminal_|mcp_read_|editor_operation_|mcp_mutation_)/.test(e.type)))continue;
  const answer=assistantText(activity);if(!answer)continue;history.push({role:"user",content:task.draft.input},{role:"assistant",content:answer});
 }
 return boundConversationHistory(history.slice(-MAX_CONVERSATION_TURNS*2));
}
