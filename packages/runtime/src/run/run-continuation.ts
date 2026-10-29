import type {ProviderRuntimeMessage,TaskDraft,TaskRunScope} from "@uagent/shared";
import {isRunPathAllowed} from "./tool-registry.js";
const readTools=new Set(["project_list_files","project_find_files","project_read_file"]);
/** Saved records are selected data, not a coordinator, lease, credential or pending dispatch. */
export function selectSavedRunContext(saved:NonNullable<TaskDraft["savedRun"]>,scope:TaskRunScope){
 if(!saved.parentRunId||saved.parentRunId===scope.runId||saved.projectId!==scope.projectId||saved.conversationId!==scope.conversationId||saved.hasUnresolvedEffects)throw Error("saved_run_scope_mismatch");
 const groups:ProviderRuntimeMessage[]=[],history:Array<{role:"user"|"assistant";content:string}>=[];
 if(!saved.includeCompletedContext)return {groups,history,callIds:[] as string[]};
 if(!Array.isArray(saved.messages)||saved.messages.length>256)throw Error("saved_run_invalid");
 const records=saved.messages;let goal=-1;
 for(let i=0;i<records.length;i++)if(records[i]?.role==="user")goal=i;
 if(goal<0)throw Error("saved_run_invalid");
 const final=records.at(-1);
 if(saved.completed&&final?.role==="assistant"&&!final.toolCalls&&final.content)history.push({role:"user",content:records[goal]!.content},{role:"assistant",content:final.content});
 const callIds:string[]=[];
 for(let i=goal+1;i<records.length;){
  const assistant=records[i++];if(assistant?.role!=="assistant"||!assistant.toolCalls?.length)continue;
  const pending=new Set(assistant.toolCalls.map(call=>call.id)),part:ProviderRuntimeMessage[]=[assistant];let eligible=assistant.toolCalls.every(call=>readTools.has(call.name)),complete=true;
  while(pending.size){
   const message=records[i];if(!message||message.role!=="tool"||!message.toolCallId||!pending.delete(message.toolCallId)){complete=false;break;}i++;part.push(message);
   let result:Record<string,unknown>;try{result=JSON.parse(message.content) as Record<string,unknown>;}catch{throw Error("saved_run_invalid");}
   const sources=result.sources;
   if(result.status!=="completed"||result.effectState!=="not_started"||!Array.isArray(sources)||!sources.length)eligible=false;
   if(Array.isArray(sources))for(const raw of sources){
    const source=raw as {projectId?:string;path?:string;kind?:string;version?:string};
    if(source.projectId!==scope.projectId||typeof source.path!=="string")throw Error("saved_run_scope_mismatch");
    // Index snapshots are process-local observations and must be queried again after restart.
    if(source.kind==="index_query"||source.kind==="project_index")eligible=false;
    if(!isRunPathAllowed(source.path,scope.readPrefixes)||!isRunPathAllowed(source.path,scope.sharePrefixes))throw Error("saved_run_sharing_scope");
   }
  }
  if(complete&&eligible){groups.push(...JSON.parse(JSON.stringify(part)) as ProviderRuntimeMessage[]);callIds.push(...assistant.toolCalls.map(call=>call.id));}
 }
 return {groups,history,callIds};
}
