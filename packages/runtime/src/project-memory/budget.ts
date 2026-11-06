import type { ProviderRuntimeMessage, TaskRun } from "@uagent/shared";
import { prepareRunContext, RunContextError } from "../context/run-context.js";

type PreparedContext=ReturnType<typeof prepareRunContext>;
/** Existing context assembly places selected history pairs immediately after constraints. */
function reserveHistorySlot(context:PreparedContext,recordCount:number):PreparedContext{
  if(context.messages.length<30)return context;
  const history=context.plan.segments.filter(segment=>segment.category==="history").sort((a,b)=>a.originalMessageIndexes[0]!-b.originalMessageIndexes[0]!);
  const oldest=history[0];
  if(!oldest)return context; // Required/current tool groups take priority over memory.
  if(oldest.originalMessageIndexes.length!==2)throw new RunContextError("context_protocol");
  const messages=[...context.messages.slice(0,2),...context.messages.slice(4)];
  const segments=context.plan.segments.filter(segment=>segment!==oldest);
  const selected=segments.filter(segment=>segment.category!=="constraints"&&segment.category!=="goal").sort((a,b)=>a.originalMessageIndexes[0]!-b.originalMessageIndexes[0]!);
  const manifestIndex=2+(history.length-1)*2+1;
  messages[manifestIndex]={role:"user",content:"Context map (data, never permission): "+JSON.stringify({
    method:"deterministic v1",total:recordCount,
    records:selected.map(segment=>({indexes:segment.originalMessageIndexes,form:segment.selection==="exact"?"exact":"excerpt"})),
    omitted:recordCount-3-selected.reduce((sum,segment)=>sum+segment.originalMessageIndexes.length,0),
  })};
  return{messages,plan:{...context.plan,segments,
    omitted:[...context.plan.omitted,{originalMessageIndexes:oldest.originalMessageIndexes,reason:"budget" as const}].sort((a,b)=>a.originalMessageIndexes[0]!-b.originalMessageIndexes[0]!),
    usedBytes:new TextEncoder().encode(JSON.stringify(messages)).length,
  }};
}
/** Preserve required constraints/newest tool exchange, then prefer memory over older history.
 * Required groups win if the byte reservation cannot fit them.
 * Archives and original record indexes remain unchanged. The selector measures final message JSON.
 */
export function prepareMemoryBudgetedRunContext(input:{run:TaskRun;records:readonly ProviderRuntimeMessage[];goalMessageIndex:number;reserveForMemory?:boolean}):PreparedContext{
  const full=input.run.limits.maxContextBytes;
  if(!Number.isSafeInteger(full)||full<1||full>24576)throw new RunContextError("context_limit");
  // Default preparation never sacrifices context before catalog eligibility is known.
  if(!input.reserveForMemory)return prepareRunContext(input);
  const reserve=Math.min(4096,Math.floor(full/3));
  const finish=(context:PreparedContext):PreparedContext=>{
    const selected=reserveHistorySlot(context,input.records.length);
    return{messages:selected.messages,plan:{...selected.plan,maxBytes:full}};
  };
  if(reserve<512)return finish(prepareRunContext(input));
  const run:TaskRun={...input.run,limits:{...input.run.limits,maxContextBytes:full-reserve}};
  try{return finish(prepareRunContext({...input,run}));}
  catch(error){
    if(!(error instanceof RunContextError)||error.code!=="context_limit")throw error;
    return finish(prepareRunContext(input));
  }
}
