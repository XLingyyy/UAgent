import {afterEach,expect,it,vi} from "vitest";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {useState} from "react";
import type {CollaborationMember} from "@uagent/shared";
import {CollaborationModelField} from "../composer/CollaborationModelField";
import {codexMemberSessions} from "./codex-member-session";
import {captureMemberSessions,createCollaborationMemberAdapter} from "./collaboration-sessions";
afterEach(()=>{cleanup();codexMemberSessions.investigator.close();vi.unstubAllGlobals();});
it("member selection configures official Codex without keys and invalidates on model change",async()=>{
 const invoke=vi.fn(async(cmd:string)=>{if(cmd==="read_codex_model_preference")return null;if(cmd==="save_codex_model_preference")return;if(cmd==="list_codex_models")return [{model:"test-model",displayName:"Synthetic model",description:"mock",hidden:false,isDefault:true,defaultReasoningEffort:"balanced",supportedReasoningEfforts:[{reasoningEffort:"balanced",description:"mock balanced"},{reasoningEffort:"deep",description:"mock deep"}]}];if(cmd==="discover_codex")return {found:true,executable:"E:/synthetic/codex.exe"};throw Error("No process or network permitted");});vi.stubGlobal("__TAURI_INTERNALS__",{invoke});let selected:CollaborationMember={role:"risk_reviewer",focus:""};
 function Form(){const [member,setMember]=useState(selected);return <CollaborationModelField slot="investigator" number={1} member={member} onChange={m=>{selected=m;setMember(m);}} providers={[]} projectId="synthetic" input="Review" mainModel="DeepSeek" disabled={false} locale="en"/>;}
 render(<Form/>);fireEvent.change(screen.getByLabelText("Member 1 model"),{target:{value:"codex"}});await waitFor(()=>expect((screen.getByLabelText("Member 1 Codex executable") as HTMLInputElement).value).toContain("synthetic"));expect(screen.queryByLabelText(/temporary API key/)).toBeNull();fireEvent.click(screen.getByRole("button",{name:"Load Member 1 Codex models"}));await waitFor(()=>expect((screen.getByLabelText("Member 1 Codex model") as HTMLSelectElement).value).toBe("test-model"));fireEvent.click(screen.getByRole("button",{name:"Configure Member 1 Codex session"}));await waitFor(()=>expect(screen.getByText(/Session configured/)).toBeTruthy());const members={investigator:selected};const binding=captureMemberSessions(members,"synthetic");expect(binding.isCurrent()).toBe(true);
 expect(createCollaborationMemberAdapter("investigator",{scope:{...selected.model,projectId:"synthetic",runId:"run:investigator",expiresAt:Date.now()+60000} as any,isCurrent:binding.isCurrent},{collaborationMembers:members} as any).id).toBe("codex");
 fireEvent.change(screen.getByLabelText("Member 1 Codex reasoning effort"),{target:{value:"deep"}});expect(binding.isCurrent()).toBe(false);expect(invoke.mock.calls.every(([cmd])=>["discover_codex","read_codex_model_preference","list_codex_models","save_codex_model_preference"].includes(cmd))).toBe(true);
});
