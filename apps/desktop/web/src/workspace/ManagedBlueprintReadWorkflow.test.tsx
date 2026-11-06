import {afterEach,it,expect,vi} from "vitest";
import {render,screen,fireEvent,cleanup,waitFor} from "@testing-library/react";
import {I18nProvider,createLocaleStore} from "../i18n";
import {ManagedBlueprintReadWorkflow} from "./ManagedBlueprintReadWorkflow";
import type {NativeInvoke} from "../runtime/project-native-adapter";
const projectId="root:synthetic-ordinary",packageName="/Game/Characters/BP_Hero";
function receipt(input:any){return {schemaVersion:1,...input,status:"editor_started",projectSha256:"a".repeat(64),assetWriteEnabled:false,toolsVerified:false,session:{projectId,rootId:"root-identity",sessionId:"owned-editor",status:"attached"}};}
function observation(){return {schemaVersion:1,projectId,rootId:"root-identity",editorSessionId:"owned-editor",packageName,rootObjectId:"object-identity",observationGeneration:1,status:"observed",cacheable:false,result:{operation:"uagent.v2.blueprint.describe",mutationCount:0,data:{packageName,loadPolicy:"already_loaded_only"}}};}
function mount(invoke?:NativeInvoke){return render(<I18nProvider store={createLocaleStore({initialLocale:"en",storage:null})}><ManagedBlueprintReadWorkflow projectId={projectId} invoke={invoke}/></I18nProvider>);}
function start(){fireEvent.change(screen.getByLabelText("Project-root .uproject filename"),{target:{value:"Ordinary.uproject"}});fireEvent.change(screen.getByLabelText("Blueprint read root or exact package"),{target:{value:packageName}});fireEvent.click(screen.getByText("Review and start read-only editor"));}
afterEach(async()=>{cleanup();await Promise.resolve();vi.unstubAllGlobals();});
it("starts the selected project then queries with the bound owned session; no automatic query or writes",async()=>{
 const invoke=vi.fn(async(command:string,payload:any)=>{if(command==="start_ue_semantic_editor")return receipt(payload.input);if(command==="read_ue_blueprint_structure")return observation();if(command==="stop_ue_semantic_editor")return true;throw Error(command);});
 // Default bridge binding must remain stable during React state updates.
 vi.stubGlobal("__TAURI_INTERNALS__",{invoke});mount();start();await screen.findByText("Stop read-only editor");expect(invoke.mock.calls.map(c=>c[0])).toEqual(["start_ue_semantic_editor"]);
 expect(invoke.mock.calls[0][1].input).toMatchObject({projectId,projectFile:"Ordinary.uproject",readRoot:packageName});
 fireEvent.click(screen.getByText("Confirm and read structure"));await waitFor(()=>expect(invoke.mock.calls.some(c=>c[0]==="read_ue_blueprint_structure")).toBe(true));
 expect(invoke.mock.calls.find(c=>c[0]==="read_ue_blueprint_structure")![1].input).toEqual({projectId,rootId:"root-identity",editorSessionId:"owned-editor",packageName});
 fireEvent.click(screen.getByText("Stop read-only editor"));await waitFor(()=>expect(screen.queryByText("Stop read-only editor")).toBeNull());
 expect(invoke.mock.calls.every(c=>["start_ue_semantic_editor","read_ue_blueprint_structure","stop_ue_semantic_editor"].includes(c[0]))).toBe(true);
});
it("cancels startup and discards a late success with exact-owner cleanup",async()=>{
 let finish!:(v:any)=>void;let input:any;
 const invoke=vi.fn(async(command:string,payload:any)=>{if(command==="start_ue_semantic_editor"){input=payload.input;return new Promise(resolve=>finish=resolve);}return true;});mount(invoke as NativeInvoke);start();fireEvent.click(screen.getByText("Cancel read-only startup"));await waitFor(()=>expect(screen.queryByText("Cancel read-only startup")).toBeNull());finish(receipt(input));await waitFor(()=>expect(invoke.mock.calls.filter(c=>c[0]==="stop_ue_semantic_editor")).toHaveLength(2));expect(screen.queryByText("Confirm and read structure")).toBeNull();
 for(const call of invoke.mock.calls.filter(c=>c[0]==="stop_ue_semantic_editor"))expect(call[1].input).toEqual({projectId,operationId:input.operationId});
});
it("unmount releases the same project operation",async()=>{
 let input:any;const invoke=vi.fn(async(command:string,payload:any)=>{if(command==="start_ue_semantic_editor"){input=payload.input;return receipt(input);}return true;});const h=mount(invoke as NativeInvoke);start();await screen.findByText("Stop read-only editor");h.unmount();await waitFor(()=>expect(invoke).toHaveBeenCalledWith("stop_ue_semantic_editor",{input:{projectId,operationId:input.operationId}}));
});
it("rejects mismatched startup receipts and keeps stop available when cleanup is uncertain",async()=>{
 const invoke=vi.fn(async(command:string,payload:any)=>{if(command==="start_ue_semantic_editor")return {...receipt(payload.input),readRoot:"/Game/Other"};throw Error("transport unavailable");});mount(invoke as NativeInvoke);start();expect((await screen.findByRole("alert")).textContent).toContain("semantic_start_receipt_invalid");expect(screen.getByText("Cancel read-only startup")).toBeTruthy();expect(screen.queryByText("Confirm and read structure")).toBeNull();
});
