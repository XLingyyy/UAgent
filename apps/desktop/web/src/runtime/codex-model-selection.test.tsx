import {afterEach,expect,it,vi} from "vitest";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {CodexModelFields} from "../composer/CodexModelFields";
import {createCodexMemberSession,CODEX_ENDPOINT} from "./codex-member-session";
import type {NativeInvoke} from "./project-native-adapter";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const models=["catalog-a","catalog-b"].map((model,i)=>({model,displayName:"Official mock "+i,description:"synthetic",hidden:false,isDefault:i===0,defaultReasoningEffort:"balanced",supportedReasoningEfforts:[{reasoningEffort:"balanced",description:"mock"},{reasoningEffort:"deep",description:"mock"}]}));
it("restores choices without authority; lead and member persist and transmit independent model/effort",async()=>{
 const saved=new Map<string,any>([["lead",{executable:"E:/synthetic/codex.exe",model:"catalog-b",effort:"deep"}]]),starts:any[]=[],views=new Map<string,any>();
 const invoke=(async(command:string,payload:any)=>{const i=payload?.input;
 if(command==="read_codex_model_preference")return saved.get(i.slot)??null;
 if(command==="save_codex_model_preference"){saved.set(i.slot,structuredClone(i.selection));return;}
 if(command==="discover_codex")return {executable:"E:/synthetic/codex.exe"};if(command==="list_codex_models")return models;
 if(command==="start_codex_turn"){starts.push(i);const v={requestId:"q"+starts.length,sessionId:"s"+starts.length,threadId:"t",turnId:"u",status:"completed",text:"synthetic",persisted:true,error:null};views.set(v.requestId,v);return {...v,persisted:false,text:""};}
 if(command==="dispatch_codex_turn"||command==="cancel_codex_turn")return;if(command==="poll_codex_turn")return views.get(i.requestId);throw Error(command);
 }) as NativeInvoke;vi.stubGlobal("__TAURI_INTERNALS__",{invoke});
 const lead=createCodexMemberSession(()=>invoke),member=createCodexMemberSession(()=>invoke);
 const form=render(<><CodexModelFields session={lead} slot="lead" label="Lead" projectId="p" input="synthetic" disabled={false} zh={false}/><CodexModelFields session={member} slot="investigator" label="Member 1" projectId="p" input="synthetic" disabled={false} zh={false}/></>);
 await waitFor(()=>expect((screen.getByLabelText("Lead Codex model") as HTMLSelectElement).value).toBe("catalog-b"));expect(lead.getSnapshot().ready).toBe(false);expect((screen.getByRole("button",{name:"Configure Lead Codex session"}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole("button",{name:"Load Lead Codex models"}));await waitFor(()=>expect((screen.getByRole("button",{name:"Configure Lead Codex session"}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole("button",{name:"Configure Lead Codex session"}));await waitFor(()=>expect(lead.getSnapshot().ready).toBe(true));
 fireEvent.click(screen.getByRole("button",{name:"Load Member 1 Codex models"}));await waitFor(()=>expect((screen.getByLabelText("Member 1 Codex model") as HTMLSelectElement).value).toBe("catalog-a"));fireEvent.click(screen.getByRole("button",{name:"Configure Member 1 Codex session"}));await waitFor(()=>expect(member.getSnapshot().ready).toBe(true));
 for(const [session,role] of [[lead,"lead"],[member,"investigator"]] as const){const state=session.getSnapshot();const lease={scope:{projectId:"p",runId:role,providerId:"codex",modelId:state.modelId,endpoint:CODEX_ENDPOINT,expiresAt:Date.now()+60000} as any,isCurrent:()=>true};const adapter=session.createAdapter(role,lease);await adapter.complete({id:role,providerId:"codex",modelId:state.modelId,messages:[{role:"user",content:"synthetic"}],toolChoice:"none",metadata:{runId:role,projectId:"p"}},{beforeSend:async()=>{}});}
 expect(starts.map(v=>[v.model,v.effort])).toEqual([["catalog-b","deep"],["catalog-a","balanced"]]);expect(saved.get("investigator").effort).toBe("balanced");form.unmount();expect(lead.getSnapshot().ready).toBe(false);expect(member.getSnapshot().ready).toBe(false);
 render(<CodexModelFields session={lead} slot="lead" label="Lead" projectId="p" input="synthetic" disabled={false} zh={false}/>);await waitFor(()=>expect((screen.getByLabelText("Lead Codex reasoning effort") as HTMLSelectElement).value).toBe("deep"));expect(lead.getSnapshot().ready).toBe(false);
});
it("stale catalog preference is displayed but cannot configure or silently fall back",async()=>{
 const invoke=(async(command:string)=>command==="read_codex_model_preference"?{executable:"E:/synthetic/codex.exe",model:"retired-model",effort:"retired-effort"}:command==="list_codex_models"?models:Promise.reject(Error("unexpected operation"))) as NativeInvoke;vi.stubGlobal("__TAURI_INTERNALS__",{invoke});const session=createCodexMemberSession(()=>invoke);
 render(<CodexModelFields session={session} slot="lead" label="Lead" projectId="p" input="synthetic" disabled={false} zh={false}/>);await waitFor(()=>expect((screen.getByLabelText("Lead Codex model") as HTMLSelectElement).value).toBe("retired-model"));fireEvent.click(screen.getByRole("button",{name:"Load Lead Codex models"}));await screen.findByRole("option",{name:/Official mock 0/});expect((screen.getByRole("button",{name:"Configure Lead Codex session"}) as HTMLButtonElement).disabled).toBe(true);expect(session.getSnapshot().ready).toBe(false);expect((screen.getByLabelText("Lead Codex model") as HTMLSelectElement).value).toBe("retired-model");
});
