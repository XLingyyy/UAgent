import {localizeText,getLocale} from "../i18n";
const uiText=(source:string)=>localizeText(getLocale(),source);
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import type {TaskDraft} from "@uagent/shared";
import type {ProviderAdapter} from "@uagent/runtime";
import type {NativeInvoke} from "./project-native-adapter";
import {createDesktopRuntimeAdapter} from "./desktop-runtime-adapter";
import {UIProvider} from "../stores/ui-store";
import {ProviderProposalPanel} from "../workspace/ProviderProposalPanel";
afterEach(cleanup);
const draft:TaskDraft={input:"Inspect synthetic project",projectId:"A",providerId:"deepseek",modelId:"deepseek-flash",permissionMode:"request_approval",reasoningEffort:"medium",runMode:"local",branch:null,contextPercent:null};
function mount(command:string){
 const invoke=vi.fn(async(name:string,payload?:unknown)=>{if(name==="terminal_capability_status")return {enabled:true,mode:"native"};if(name==="propose_terminal_command")return {proposalId:"synthetic-proposal",command:(payload as {input:{command:string}}).input.command,risk:"allowlisted",reason:"safe",canonicalCwd:"G:/Synthetic"};if(name==="approve_terminal_proposal")return {token:"synthetic-only",status:"approved"};if(name==="execute_terminal_command_real")return {status:"completed",chunks:[],exitCode:0,outputSummary:"Synthetic local result"};throw Error("synthetic_unavailable");});
 const provider:ProviderAdapter={id:"deepseek",getCapabilities:()=>({providerId:"deepseek",modelIds:["deepseek-flash"],supportsStreaming:true,supportsTools:false,isMock:true}),complete:vi.fn(),async *stream(request){yield {id:"one",requestId:request.id,providerId:"deepseek",modelId:"deepseek-flash",index:0,delta:JSON.stringify({version:1,kind:"terminal_readonly",command,reason:"Inspect synthetic state"}),done:true,usage:{inputTokens:1,outputTokens:1,totalTokens:2}};}};
 const runtime=createDesktopRuntimeAdapter({nativeInvoke:invoke as NativeInvoke,providerAdapter:provider,providerEnabled:true});
 render(<UIProvider runtimeClient={runtime}><ProviderProposalPanel/></UIProvider>);
 runtime.setProviderProjectContext?.({projectId:"A",rootRef:"G:/Synthetic",trusted:true});return{runtime,invoke};
}
describe("offline main task to human approval to native boundary feedback",()=>{
 it.each(["git status","git diff"])("%s waits for the displayed approval and completes with tool feedback",async(command)=>{const {runtime,invoke}=mount(command);let id="";await act(async()=>{const task=await runtime.submitTask(draft);id=task.id;expect(task.state).toBe("awaiting_approval");});expect(invoke.mock.calls.some(c=>c[0]==="execute_terminal_command_real")).toBe(false);fireEvent.click(screen.getByText(uiText("Approve this read-only command")));await waitFor(()=>expect(runtime.getSnapshot().tasksById[id].state).toBe("completed"));expect(invoke.mock.calls.filter(c=>c[0]==="execute_terminal_command_real")).toHaveLength(1);expect(runtime.getSnapshot().eventsByTaskId[id].some(e=>e.type==="tool_completed"&&e.body==="Synthetic local result")).toBe(true);});
 it("rejects via actual UI without dispatching a native command",async()=>{const {runtime,invoke}=mount("git status");let id="";await act(async()=>{id=(await runtime.submitTask(draft)).id;});fireEvent.click(screen.getByText(uiText("Reject proposal")));expect(runtime.getSnapshot().tasksById[id].state).toBe("cancelled");expect(invoke.mock.calls.some(c=>c[0]==="propose_terminal_command")).toBe(false);});
});
