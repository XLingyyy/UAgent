import type {NativeRunArchive} from "../runtime/native-run-history";
import {useI18n} from "../i18n";
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
/** Archived descriptions only; never recreate workers, approvals or a scope. */
export function delegationHistory(archive:NativeRunArchive){
 const state=archive.coordinatorState,team=object(state?.collaboration),assignments=object(team.assignments);
 if(state?.parentRunId!==undefined||team.mode!=="dynamic_delegation"||Object.keys(assignments).length<2||Object.keys(assignments).length>4||Object.keys(assignments).some(id=>!["investigator","reviewer","member_3","member_4"].includes(id))||Object.values(assignments).some(v=>typeof v!=="string"||!v.trim()||v.length>2000))return null;
 const members=object(team.members),scope=object(state?.scopeDescription);
 const workers=Array.isArray(team.workers)?team.workers.map(object):[],reports=Array.isArray(team.reports)?team.reports.map(object):[];
 const cards=Object.keys(assignments).map((id,index)=>{
  const member=object(members[id]),model=member.model===undefined?scope:object(member.model);
  const matches=workers.filter(w=>w.agentId===id),worker=matches.length===1?matches[0]:{};
  const matchingReports=reports.filter(report=>report.agentId===id);
  return {id,index,task:assignments[id] as string,model:typeof model.providerId==="string"&&typeof model.modelId==="string"?`${model.providerId} / ${model.modelId}`:null,
   status:typeof worker.status==="string"&&["queued","running","paused","completed","failed","cancelled"].includes(worker.status)?worker.status:null,
   report:matchingReports.length===1&&typeof matchingReports[0].text==="string"?matchingReports[0].text:null};
 });
 // A dynamic parent appends its planner immediately after the current goal.
 // Never classify earlier conversation history or a child worker's answer as planning.
 const goalIndex=archive.providerMessages.map(m=>m.role).lastIndexOf("user");
 const candidate=goalIndex>=0?archive.providerMessages[goalIndex+1]:undefined;
 let plannerIndex=-1;
 if(candidate?.role==="assistant"&&!candidate.toolCalls?.length){try{const plan=object(JSON.parse(candidate.content));if(Object.keys(plan).sort().join(",")===Object.keys(assignments).sort().join(",")&&Object.keys(assignments).every(id=>plan[id]===assignments[id]))plannerIndex=goalIndex+1;}catch{/* Unrecognized answer remains visible. */}}
 return {cards,plannerIndex};
}
export function CollaborationHistory({summary}:{summary:NonNullable<ReturnType<typeof delegationHistory>>}){
 const {locale}=useI18n(),zh=locale==="zh-CN";
 const labels:Record<string,string>=zh?{queued:"排队",running:"当时正在运行",paused:"暂停",completed:"已完成",failed:"失败",cancelled:"已取消"}:{queued:"Queued",running:"Running when saved",paused:"Paused",completed:"Completed",failed:"Failed",cancelled:"Cancelled"};
 return <section aria-label={zh?"保存的动态分工":"Saved dynamic delegation"}>
  <h3>{zh?"主 Agent 的分工与成员结果":"Lead-agent assignments and member results"}</h3>
  <p>{zh?"这是保存时的记录，不表示当前任务仍在运行，也不会恢复执行或授权。":"These are saved observations, not current activity. Viewing them does not resume execution or restore permissions."}</p>
  {summary.cards.map(c=><article key={c.id} aria-label={`${zh?"成员":"Member"} ${c.index+1}`}><h4>{zh?"成员":"Member"} {c.index+1}</h4>
   <p>{c.model??(zh?"模型未记录":"Model not recorded")}</p><p>{c.status?labels[c.status]:(zh?"成员状态未记录":"Member status not recorded")}</p>
   <pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{c.task}</pre>
   {c.report!==null?<details><summary>{zh?"成员报告":"Member report"}</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{c.report}</pre></details>:<p>{zh?"没有保存的成员报告":"No saved member report"}</p>}
  </article>)}
 </section>;
}
