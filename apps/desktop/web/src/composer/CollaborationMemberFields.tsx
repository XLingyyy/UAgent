import {codexMemberSessions} from "../runtime/codex-member-session";
import {collaborationSessions} from "../runtime/collaboration-sessions";
import type {ProviderConfig} from "../types/provider";
import {CollaborationModelField} from "./CollaborationModelField";
import type {CollaborationMembers,CollaborationRole} from "@uagent/shared";
const roles:Record<CollaborationRole,[string,string]>={
 source_analyst:["源码调查","Source analyst"],risk_reviewer:["风险复核","Risk reviewer"],
 performance_analyst:["性能分析","Performance analyst"],test_analyst:["测试分析","Test analyst"]
};
export function collaborationRoleLabel(role:CollaborationRole,locale:string){return roles[role][locale==="zh-CN"?0:1];}
export function CollaborationMemberFields({members,onChange,disabled,locale,providers,projectId,input,mainModel}:{providers:ProviderConfig[];projectId:string|null;input:string;mainModel:string;members:CollaborationMembers;onChange:(value:CollaborationMembers)=>void;disabled:boolean;locale:string}){
 const zh=locale==="zh-CN";
 return <fieldset className="ua-agent-members" disabled={disabled}><legend>{zh?"协作成员":"Collaboration members"}</legend>
 {Object.keys(members).map((id,index)=><div className="ua-agent-member" key={id}><div className="ua-agent-member__heading"><span>{String(index+1).padStart(2,"0")}</span><strong>{collaborationRoleLabel(members[id].role,locale)}</strong></div>
  <label>{zh?`成员 ${index+1} 职责`:`Member ${index+1} role`}<select value={members[id].role} onChange={e=>onChange({...members,[id]:{...members[id],role:e.target.value as CollaborationRole}})}>
   {(Object.keys(roles) as CollaborationRole[]).map(role=><option key={role} value={role}>{collaborationRoleLabel(role,locale)}</option>)}
  </select></label>
  <CollaborationModelField number={index+1} slot={id} member={members[id]} onChange={member=>onChange({...members,[id]:member})} providers={providers} projectId={projectId} input={input} mainModel={mainModel} disabled={disabled} locale={locale}/>
  <label>{zh?`成员 ${index+1} 关注点（可选）`:`Member ${index+1} focus (optional)`}<input type="text" maxLength={240} value={members[id].focus} onChange={e=>onChange({...members,[id]:{...members[id],focus:e.target.value}})}/></label>
  <button className="ua-agent-member__remove" type="button" disabled={disabled||Object.keys(members).length<=2} onClick={()=>{collaborationSessions[id].close("revoked");codexMemberSessions[id].close();const next={...members};delete next[id];onChange(next);}}>{zh?"移除此成员":"Remove member"}</button>
 </div>)}
 <button className="ua-agent-members__add" type="button" disabled={disabled||Object.keys(members).length>=4} onClick={()=>{const id=["investigator","reviewer","member_3","member_4"].find(key=>!members[key]);if(id)onChange({...members,[id]:{role:"test_analyst",focus:""}});}}>{zh?"添加成员":"Add member"}</button>
 <details className="ua-agent-notes"><summary>{zh?"成员职责与能力边界":"Member capabilities"}</summary><p>{zh?"两位成员独立取证，可沿用主模型或配置独立临时会话；汇总使用主模型。性能与测试角色只分析证据，不执行基准测试或测试命令。":"Configured members independently gather evidence using the main model or their own temporary sessions. Synthesis uses the main model. Performance and test roles analyze evidence; they do not execute benchmarks or test commands."}</p></details>
 </fieldset>;
}
