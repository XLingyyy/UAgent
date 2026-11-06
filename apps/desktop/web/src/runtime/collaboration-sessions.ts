import {CODEX_ENDPOINT,codexMemberSessions,codexLeadSession} from "./codex-member-session";
import type {CollaborationMembers,TaskDraft} from "@uagent/shared";
import type {RunScopeLease} from "@uagent/runtime";
import {createDesktopProviderSession,safeProviderSession} from "./safe-provider-session";
export const collaborationSessions:Record<string,ReturnType<typeof createDesktopProviderSession>>={investigator:createDesktopProviderSession(),reviewer:createDesktopProviderSession(),member_3:createDesktopProviderSession(),member_4:createDesktopProviderSession()};
export function captureMemberSessions(members:CollaborationMembers|undefined,projectId?:string){
 const checks=Object.keys(members??{}).filter(id=>members?.[id].model).map(id=>{
  const selected=members![id].model!;
  if(selected.providerId==="codex"){
   const codex=codexMemberSessions[id],state=codex?.getSnapshot();
   const current=()=>Boolean(state&&codex.getSnapshot()===state&&codex.current(projectId??state.projectId,selected.modelId)&&selected.endpoint===CODEX_ENDPOINT);
   if(!current())throw Error("member_session_unavailable");return {current,expiresAt:state.expiresAt};
  }
  const session=collaborationSessions[id],generation=session.getSessionGeneration(),state=session.getSnapshot();
  const current=()=>{const now=session.getSnapshot();return now.ready&&!now.savedCredential&&!now.nativeClosing&&now.expiresAt!==null&&now.expiresAt>Date.now()&&session.getSessionGeneration()===generation&&now.providerId===selected.providerId&&now.modelId===selected.modelId&&now.endpoint===selected.endpoint;};
  if(!current())throw Error("member_session_unavailable");
  return {current,expiresAt:state.expiresAt!};
 });
 return {isCurrent:()=>checks.every(check=>check.current()),expiresAt:Math.min(Infinity,...checks.map(check=>check.expiresAt))};
}
export function createInvestigationAdapter(lease:RunScopeLease,draft:TaskDraft){
 if(lease.scope.providerId==="codex"){if(!draft.collaboration||draft.savedRun)throw Error("codex_collaboration_required");return codexLeadSession.createAdapter("lead",lease);}
 return safeProviderSession.createRunAdapter(lease,draft);
}
export function createCollaborationMemberAdapter(role:string,lease:RunScopeLease,draft:TaskDraft){
 if(draft.collaborationMembers?.[role].model?.providerId==="codex")return codexMemberSessions[role].createAdapter(role,lease);
 if(lease.scope.providerId==="codex"&&!draft.collaborationMembers?.[role].model)return codexLeadSession.createAdapter(role,lease);
 const session=draft.collaborationMembers?.[role].model?collaborationSessions[role]:safeProviderSession;
 const state=session.getSnapshot();if(!state.ready||state.savedCredential||state.providerId!==lease.scope.providerId||state.modelId!==lease.scope.modelId||state.endpoint!==lease.scope.endpoint)throw Error("member_session_unavailable");
 return session.createRunAdapter(lease,draft);
}
