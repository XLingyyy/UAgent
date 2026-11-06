import {afterEach,expect,it,vi} from "vitest";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {webcrypto} from "node:crypto";
import {UIProvider,useProjectActions} from "../stores/ui-store";
import {I18nProvider,createLocaleStore} from "../i18n";
import {ComposerDock} from "../composer/ComposerDock";
import {InvestigationScopeReview} from "../settings/pages/InvestigationScopeReview";
import {createDesktopRuntimeAdapter} from "./desktop-runtime-adapter";
import {codexLeadSession} from "./codex-member-session";
import {safeProviderSession} from "./safe-provider-session";
import {investigationScopeGate} from "./investigation-scope-gate";
import {initializeApplicationProfile} from "./application-profile";
import type {NativeInvoke} from "./project-native-adapter";
afterEach(()=>{cleanup();codexLeadSession.close();safeProviderSession.close("cleared");investigationScopeGate.invalidate();vi.unstubAllGlobals();vi.restoreAllMocks();});
it("production composer submits Codex lead without any API session and archives delegated output",async()=>{
 const calls:string[]=[],starts:any[]=[],views=new Map<string,any>(),saves=new Map<string,{revision:number;count:number;status:string}>();let leadCount=0;
 const invoke=(async(command:string,payload:any)=>{calls.push(command);const i=payload?.input;
 if(command==="get_application_profile")return {isolated:true,offlineDemo:false};
 if(command==="read_codex_model_preference")return null;
 if(command==="save_codex_model_preference")return;
 if(command==="list_codex_models")return [{model:"test-model",displayName:"Synthetic model",description:"mock",hidden:false,isDefault:true,defaultReasoningEffort:"balanced",supportedReasoningEfforts:[{reasoningEffort:"balanced",description:"mock balanced"},{reasoningEffort:"deep",description:"mock deep"}]}];
 if(command==="discover_codex")return {found:true,executable:"E:/synthetic/codex.exe"};
 if(command==="validate_native_project_root")return {ok:true,reason:"valid",displayRoot:"[project-root]/Synthetic",projectName:"Synthetic",engine:{label:"Unknown",association:null,source:"unknown"}};
 if(command==="trust_native_project_root")return {rootId:"trusted-root:synthetic",trustState:"trusted"};
 if(command==="scan_native_project_index")return {id:"index:synthetic",status:"ready",directories:[],assets:[],files:[{id:"source",displayName:"A.cpp",nodeType:"file",rootRelativePath:"Source/A.cpp",displayPath:"[project-root]/Source/A.cpp",extension:".cpp",byteSize:1,isIgnored:false,limitReason:"none"}],summary:{projectId:i.projectId,status:"ready",scannedAt:1,directoryCount:0,fileCount:1,assetCount:0,ignoredCount:0,limitReasons:[],warnings:[],redactedRoot:"[project-root]/Synthetic"}};
 if(command==="inspect_native_project_sources")return {rootCurrent:true,projectId:i.projectId,sources:[]};
 if(command==="commit_native_run_store"){const prev=saves.get(i.runId)??{revision:0,count:0,status:""};expect(i.expectedRevision).toBe(prev.revision);expect(i.expectedMessageCount).toBe(prev.count);const next={revision:prev.revision+1,count:prev.count+i.batch.messages.length,status:i.batch.status};saves.set(i.runId,next);return {schemaVersion:1,projectId:i.projectId,runId:i.runId,revision:next.revision,messageCount:next.count};}
 if(command==="start_codex_turn"){starts.push(structuredClone(i));const n=starts.length,lead=i.member.memberId==="lead";if(lead)leadCount++;const text=lead?(leadCount===1?' {"investigator":"Review architecture gaps","reviewer":"Review risks"}':'FINAL_CODEX_UI_REPORT'):'member '+i.member.memberId;const v={requestId:"q"+n,sessionId:i.sessionId??"s"+n,threadId:"t"+n,turnId:"turn",status:"completed",text,persisted:true,error:null};views.set(v.requestId,v);return {...v,status:"preparing",text:"",persisted:false};}
 if(command==="dispatch_codex_turn"||command==="cancel_codex_turn")return;
 if(command==="poll_codex_turn")return views.get(i.requestId);
 throw Error("Unexpected native operation: "+command);
 }) as NativeInvoke;
 vi.stubGlobal("crypto",webcrypto);vi.stubGlobal("__TAURI_INTERNALS__",{invoke});vi.stubGlobal("fetch",vi.fn(()=>{throw Error("NETWORK FORBIDDEN");}));await initializeApplicationProfile();safeProviderSession.close("cleared");
 const runtime=createDesktopRuntimeAdapter({nativeInvoke:invoke,providerEnabled:false}),locale=createLocaleStore({initialLocale:"en",storage:null,eventTarget:null});
 function Setup(){const a=useProjectActions();return <button onClick={()=>{void(async()=>{const id=await a.addProjectRoot("G:/SyntheticCodexLead");if(!id)throw Error("setup");await a.trustProjectRoot(id);await a.scanProjectIndex("trusted-root:synthetic");})();}}>Load synthetic</button>;}
 render(<I18nProvider store={locale}><UIProvider runtimeClient={runtime} initialState={{provider:{providers:[]},composer:{selectedModelId:"not-configured"}}}><Setup/><ComposerDock/><InvestigationScopeReview/></UIProvider></I18nProvider>);
 fireEvent.click(screen.getByText("Load synthetic"));await waitFor(()=>expect(screen.getByRole("button",{name:/^Project selector:/}).textContent).toContain("Synthetic"));
 fireEvent.change(screen.getByRole("textbox",{name:"Task input"}),{target:{value:"Analyze synthetic lifecycle"}});fireEvent.click(screen.getByRole("button",{name:"Task mode"}));fireEvent.click(screen.getByRole("checkbox",{name:/Multi-agent independent/}));fireEvent.click(screen.getByRole("checkbox",{name:/Lead agent delegates/}));fireEvent.change(screen.getByLabelText("Lead connection"),{target:{value:"codex"}});
 await waitFor(()=>expect((screen.getByLabelText("Lead Codex executable") as HTMLInputElement).value).toContain("synthetic"));fireEvent.click(screen.getByRole("button",{name:"Load Lead Codex models"}));await waitFor(()=>expect((screen.getByLabelText("Lead Codex model") as HTMLSelectElement).value).toBe("test-model"));fireEvent.change(screen.getByLabelText("Lead Codex reasoning effort"),{target:{value:"deep"}});fireEvent.click(screen.getByRole("button",{name:"Configure Lead Codex session"}));await waitFor(()=>expect(screen.getByRole("button",{name:"Send task"})).toBeTruthy());
 expect(safeProviderSession.getSnapshot().ready).toBe(false);fireEvent.click(screen.getByRole("button",{name:"Send task"}));await screen.findByRole("dialog",{name:"What may this investigation read?"});expect(investigationScopeGate.getPending()?.proposal.providerId).toBe("codex");
 fireEvent.click(screen.getByRole("checkbox",{name:/Allow tool results/}));fireEvent.click(screen.getByRole("button",{name:"Allow this read-only investigation"}));
 await waitFor(()=>expect(Object.values(runtime.getSnapshot().tasksById).at(-1)?.state).toBe("completed"));
 expect(starts).toHaveLength(4);expect(starts.every(s=>s.model==="test-model"&&s.effort==="deep")).toBe(true);const leads=starts.filter(s=>s.member.memberId==="lead");expect(leads).toHaveLength(2);expect(leads[1].sessionId).toBe("s1");expect(starts.filter(s=>s.member.memberId!=="lead").every(s=>s.sessionId===null)).toBe(true);expect([...saves.values()].filter(s=>s.status==="succeeded")).toHaveLength(3);expect(calls.some(c=>/credential|list_project_memories/.test(c))).toBe(false);expect(fetch).not.toHaveBeenCalled();
 const completed=Object.values(runtime.getSnapshot().tasksById).at(-1)!;
 await expect(runtime.submitTask({...completed.draft,investigationScopeId:"unapproved-scope"})).rejects.toThrow("task_submission_failed");expect(starts).toHaveLength(4);

});
