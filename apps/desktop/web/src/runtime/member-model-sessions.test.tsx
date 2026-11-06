import {afterEach,expect,it,vi} from "vitest";
import {render,screen,fireEvent,waitFor,cleanup,act} from "@testing-library/react";
import {useState} from "react";
import {createOutboundConsentGate} from "@uagent/runtime";
import type {CollaborationMember,CollaborationMembers,TaskRunScope,TaskDraft} from "@uagent/shared";
import type {ProviderConfig} from "../types/provider";
import {CollaborationModelField} from "../composer/CollaborationModelField";
import {createSafeProviderSession,RESPONSES_FIXTURE_CREDENTIAL} from "./safe-provider-session";
import {collaborationSessions,captureMemberSessions,createCollaborationMemberAdapter} from "./collaboration-sessions";
import type {NativeInvoke} from "./project-native-adapter";
const original={...collaborationSessions};const created:ReturnType<typeof createSafeProviderSession>[]=[];
afterEach(async()=>{cleanup();for(const session of created.splice(0)){session.dispose();await session.whenSettled();}Object.assign(collaborationSessions,original);vi.unstubAllGlobals();vi.restoreAllMocks();});
function setup(){
 const calls:string[]=[],gate=createOutboundConsentGate();let number=0;
 const invoke:NativeInvoke=async<T,>(command:string,payload?:unknown)=>{
  calls.push(command);const input=(payload as {input:any}).input;
  if(command==="open_native_responses_profile")return {profileId:"profile-"+(++number),providerId:input.providerId,modelId:input.modelId,endpoint:"https://api.openai.com/v1/responses",expiresAt:Date.now()+60000,fixture:true} as T;
  if(command==="close_native_responses_profile")return null as T;
  throw Error("unexpected native command "+command);
 };
 vi.stubGlobal("__TAURI_INTERNALS__",{invoke});vi.stubGlobal("fetch",vi.fn(()=>{throw Error("network forbidden");}));
 for(const slot of ["investigator","reviewer","member_3","member_4"] as const){const session=createSafeProviderSession({mode:"offline",responsesFixture:true,nativeInvoke:invoke,gate});created.push(session);collaborationSessions[slot]=session;session.updateContext("project","Goal","selection");}
 return {calls,gate};
}
const model=(modelId:string)=>({providerId:"configured-openai",modelId,endpoint:"https://api.openai.com/v1/responses"});
it("member model sessions use distinct existing Responses profiles and revoke captured approval on clear",async()=>{
 const h=setup();await collaborationSessions.investigator.openResponses("configured-openai","model-a",RESPONSES_FIXTURE_CREDENTIAL);await collaborationSessions.reviewer.openResponses("configured-openai","model-b",RESPONSES_FIXTURE_CREDENTIAL);
 const members:CollaborationMembers={investigator:{role:"source_analyst",focus:"",model:model("model-a")},reviewer:{role:"risk_reviewer",focus:"",model:model("model-b")}};
 const binding=captureMemberSessions(members);expect(binding.isCurrent()).toBe(true);
 for(const slot of ["investigator","reviewer"] as const){
  const scope={id:"scope",runId:"run:"+slot,projectId:"project",conversationId:"chat",mode:"read_only",expiresAt:Date.now()+50000,...members[slot].model} as TaskRunScope;
  const draft={taskMode:"investigation",projectId:"project",conversationId:"chat",investigationScopeId:"scope",collaborationMembers:members,...members[slot].model} as TaskDraft;
  const adapter=createCollaborationMemberAdapter(slot,{scope,isCurrent:binding.isCurrent},draft);expect(adapter.getCapabilities().modelIds).toEqual([members[slot].model!.modelId]);
 }
 collaborationSessions.reviewer.close("cleared");expect(binding.isCurrent()).toBe(false);expect(()=>captureMemberSessions(members)).toThrow("member_session_unavailable");await collaborationSessions.reviewer.whenSettled();
 expect(h.calls.filter(c=>c==="open_native_responses_profile")).toHaveLength(2);expect(h.calls.every(c=>c.includes("profile"))).toBe(true);expect(fetch).not.toHaveBeenCalled();
});
it("member model UI selects configured supported models and clears temporary key without storing it",async()=>{
 const h=setup();const selected:CollaborationMember[]=[];
 const providers:ProviderConfig[]=[{providerId:"configured-openai",displayName:"Configured OpenAI",baseUrl:"https://api.openai.com/v1",wireApi:"responses",authMode:"env_key",enabled:true,networkMode:"live",models:[{id:"model-a",label:"Model A",contextWindow:10000,supportsReasoning:false},{id:"model-b",label:"Model B",contextWindow:10000,supportsReasoning:false}]}];
 function Form(){const [member,setMember]=useState<CollaborationMember>({role:"source_analyst",focus:""});return <CollaborationModelField number={1} slot="investigator" member={member} onChange={value=>{selected.push(value);setMember(value);}} providers={providers} projectId="project" input="Goal" mainModel="DeepSeek / deepseek-flash" disabled={false} locale="en"/>;}
 render(<Form/>);fireEvent.change(screen.getByLabelText("Member 1 model"),{target:{value:JSON.stringify(["configured-openai","model-b"])}});
 const input=screen.getByLabelText("Member 1 temporary API key") as HTMLInputElement;fireEvent.change(input,{target:{value:RESPONSES_FIXTURE_CREDENTIAL}});fireEvent.click(screen.getByRole("button",{name:"Configure member 1 session"}));
 await waitFor(()=>expect(screen.getByText(/Temporary session configured/)).toBeTruthy());expect(input.value).toBe("");expect(selected.at(-1)?.model?.modelId).toBe("model-b");expect(JSON.stringify(selected)).not.toContain(RESPONSES_FIXTURE_CREDENTIAL);expect(h.gate.getPending()).toBeNull();expect(fetch).not.toHaveBeenCalled();
 await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Clear session"}));await collaborationSessions.investigator.whenSettled();});expect(screen.getByText(/Independent temporary session required/)).toBeTruthy();
});

it("serial parent members bind four independent Responses profiles without external requests",async()=>{
 const h=setup(),members:CollaborationMembers={};
 for(const id of ["investigator","reviewer","member_3","member_4"]){await collaborationSessions[id].openResponses("configured-openai","model-"+id,RESPONSES_FIXTURE_CREDENTIAL);members[id]={role:"test_analyst",focus:"",model:model("model-"+id)};}
 const binding=captureMemberSessions(members);expect(binding.isCurrent()).toBe(true);
 for(const id of Object.keys(members)){
  const scope={id:"scope",runId:"run:"+id,projectId:"project",conversationId:"chat",mode:"read_only",expiresAt:Date.now()+50000,...members[id].model} as TaskRunScope;
  const draft={taskMode:"investigation",projectId:"project",conversationId:"chat",investigationScopeId:"scope",collaborationMembers:members,...members[id].model} as TaskDraft;
  expect(createCollaborationMemberAdapter(id,{scope,isCurrent:binding.isCurrent},draft).getCapabilities().modelIds).toEqual([members[id].model!.modelId]);
 }
 collaborationSessions.member_3.close("cleared");expect(binding.isCurrent()).toBe(false);await collaborationSessions.member_3.whenSettled();
 expect(h.calls.filter(c=>c==="open_native_responses_profile")).toHaveLength(4);expect(fetch).not.toHaveBeenCalled();expect(h.gate.getPending()).toBeNull();
});
