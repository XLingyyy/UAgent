import {afterEach,expect,it,vi} from "vitest";
import {DEEPSEEK_CAMPAIGN,DEEPSEEK_ENDPOINT,DEEPSEEK_MODEL,type DeepSeekBudgetStore} from "@uagent/runtime";
import {createSafeProviderSession} from "./safe-provider-session";
import {requestRepairSuggestion,repairSuggestionInput,repairSuggestionAvailable} from "./ue-build-repair-proposal";
import {outboundReviewGate as gate} from "./outbound-review-store";
import {attachmentStore} from "./attachment-store";
import type {UEBuildPreviewReceipt} from "./native-ue-build-preview";
const preview={projectId:"A",preview:{projectRoot:"E:/SyntheticGame",cwd:"E:/SyntheticGame",profile:{engineRoot:"G:/SyntheticEngine"}}} as UEBuildPreviewReceipt;
const file={path:"Source/Game/Foo.cpp",content:"int a = Missing;"};
const input={prices:{input:10,output:10},files:[file],preview,runId:"synthetic-run",result:{status:"failed",exitCode:6,treeStopped:true,outputComplete:true,outputTruncated:false,stdout:"E:/SyntheticGame/Source/Game/Foo.cpp(12,4): error C2065: 'Missing': undeclared identifier\nE:/SyntheticGame/Source/Game/Other.cpp(4): error C2001: OTHER_FILE_ERROR\n",stderr:""}};
const managers:ReturnType<typeof createSafeProviderSession>[]=[];
function setup(text=JSON.stringify({files:[{path:file.path,after:"int a = 0;"}]})){
 const fetcher=vi.fn(async(..._args:Parameters<typeof fetch>)=>new Response('data: '+JSON.stringify({choices:[{delta:{content:text},finish_reason:"stop"}],usage:{prompt_tokens:2,completion_tokens:3,total_tokens:5}})+'\n\ndata: [DONE]\n\n',{headers:{"Content-Type":"text/event-stream"}}));
 const manager=createSafeProviderSession({mode:"offline",fetcher});managers.push(manager);manager.updateContext("A","synthetic","deepseek-flash");
 const budget:DeepSeekBudgetStore={durable:false,read:()=>({campaign:DEEPSEEK_CAMPAIGN,limitMicros:10000000,reservedMicros:0,requests:0,uncertainRequests:0,inputTokens:0,outputTokens:0}),reserve:()=>"synthetic",recordUsage:()=>{}};
 manager.open("synthetic-only",budget,{endpoint:DEEPSEEK_ENDPOINT,model:DEEPSEEK_MODEL,campaign:DEEPSEEK_CAMPAIGN,expiresAt:Date.now()+60000,inputMicrosPerToken:10,outputMicrosPerToken:10,pricesVerified:true});return{manager,fetcher};
}
afterEach(()=>{for(const m of managers.splice(0))m.dispose();gate.invalidate();attachmentStore.clear();});
it("uses actual consent and cost gate, excludes other files/attachments, and returns an unadopted proposal",async()=>{
 const {manager,fetcher}=setup();attachmentStore.addAsset("A","secret-context","Content/Excluded.uasset","binary_asset");attachmentStore.select(attachmentStore.getSnapshot().items[0].id,true);
 const pending=requestRepairSuggestion(input,new AbortController().signal,manager);await vi.waitFor(()=>expect(gate.getPending()).not.toBeNull());
 const envelope=gate.getPending()!.envelope;expect(envelope.body).toContain("int a = Missing;");expect(envelope.body).toContain("C2065");expect(envelope.body).not.toContain("OTHER_FILE_ERROR");expect(envelope.body).not.toContain("Excluded.uasset");expect(envelope.maximumCostMicros).toBeGreaterThan(0);expect(fetcher).not.toHaveBeenCalled();gate.approve(gate.getPending()!.id);
 expect(await pending).toEqual([{path:file.path,after:"int a = 0;"}]);expect(file.content).toBe("int a = Missing;");expect(fetcher).toHaveBeenCalledTimes(1);
});
it("rejection never reaches the simulated transport",async()=>{const{manager,fetcher}=setup();const p=requestRepairSuggestion(input,new AbortController().signal,manager).catch(e=>e);await vi.waitFor(()=>expect(gate.getPending()).not.toBeNull());gate.invalidate();expect(await p).toMatchObject({code:"cancelled"});expect(fetcher).not.toHaveBeenCalled();});
it("cancel revokes pending consent",async()=>{const{manager,fetcher}=setup();const controller=new AbortController();const p=requestRepairSuggestion(input,controller.signal,manager).catch(e=>e);await vi.waitFor(()=>expect(gate.getPending()).not.toBeNull());controller.abort();expect(await p).toMatchObject({code:"cancelled"});expect(fetcher).not.toHaveBeenCalled();});
it("project changes revoke the request",async()=>{const{manager,fetcher}=setup();const p=requestRepairSuggestion(input,new AbortController().signal,manager).catch(e=>e);await vi.waitFor(()=>expect(gate.getPending()).not.toBeNull());manager.updateContext("B","other","deepseek-flash");expect(await p).toMatchObject({code:"cancelled"});expect(fetcher).not.toHaveBeenCalled();});
it("rejects another file in a model response",async()=>{const{manager}=setup(JSON.stringify({files:[{path:"Source/Other.cpp",after:"x"}]}));const p=requestRepairSuggestion(input,new AbortController().signal,manager).catch(e=>e);await vi.waitFor(()=>expect(gate.getPending()).not.toBeNull());gate.approve(gate.getPending()!.id);expect(await p).toMatchObject({message:"repair_suggestion_rejected"});});
it.each([
 ["```json\nPRIVATE_RESPONSE\n```","repair_suggestion_invalid_json"],
 [JSON.stringify({files:[],extra:"PRIVATE_RESPONSE"}),"repair_suggestion_rejected"],
])("returns a fixed error category for invalid proposal content",async(text,code)=>{
 const{manager,fetcher}=setup(text);const pending=requestRepairSuggestion(input,new AbortController().signal,manager).catch(error=>error);await vi.waitFor(()=>expect(gate.getPending()).not.toBeNull());gate.approve(gate.getPending()!.id);const error=await pending;expect(error).toMatchObject({message:code});expect(String(error)).not.toContain("PRIVATE_RESPONSE");expect(fetcher).toHaveBeenCalledTimes(1);
});
it("distinguishes a response invalidated by a changed session context",async()=>{
 const{manager}=setup(),revision=manager.getContextVersion();vi.spyOn(manager,"getContextVersion").mockReturnValueOnce(revision).mockReturnValue(revision+1);const pending=requestRepairSuggestion(input,new AbortController().signal,manager).catch(error=>error);await vi.waitFor(()=>expect(gate.getPending()).not.toBeNull());gate.approve(gate.getPending()!.id);expect(await pending).toMatchObject({message:"repair_suggestion_invalidated"});
});
it("no matching errors or incomplete diagnostics fail before transport",()=>{expect(()=>repairSuggestionInput([{...file,path:"Source/Absent.cpp"}],input.result,preview)).toThrow();expect(()=>repairSuggestionInput([file],{...input.result,outputComplete:false},preview)).toThrow();});
it("executor failure without a parsed diagnostic stops before outbound review",async()=>{const{manager,fetcher}=setup();await expect(requestRepairSuggestion({...input,result:{...input.result,stdout:"Unhandled exception: NullReferenceException: Object reference not set to an instance of an object.\nResult: Failed (OtherCompilationError)\n"}},new AbortController().signal,manager)).rejects.toThrow("repair_no_parsed_errors");expect(gate.getPending()).toBeNull();expect(fetcher).not.toHaveBeenCalled();});
it("saved credentials and Responses cannot enter this request path",()=>{const{manager}=setup();expect(repairSuggestionAvailable({...manager.getSnapshot(),savedCredential:true})).toBe(false);expect(repairSuggestionAvailable({...manager.getSnapshot(),wireApi:"responses"})).toBe(false);});

it("account-managed sessions also require an exact cost estimate before transport",async()=>{const{manager,fetcher}=setup();manager.openAccount("synthetic-only");const p=requestRepairSuggestion(input,new AbortController().signal,manager);await vi.waitFor(()=>expect(gate.getPending()).not.toBeNull());expect(gate.getPending()!.envelope.estimatedCostMicros).toBeGreaterThan(0);expect(gate.getPending()!.envelope.maximumCostMicros).toBeUndefined();expect(fetcher).not.toHaveBeenCalled();gate.approve(gate.getPending()!.id);expect((await p)[0].path).toBe(file.path);});
it("invalid prices fail before consent or transport",async()=>{const{manager,fetcher}=setup();await expect(requestRepairSuggestion({...input,prices:{input:NaN,output:1}},new AbortController().signal,manager)).rejects.toThrow("repair_price_confirmation_required");expect(gate.getPending()).toBeNull();expect(fetcher).not.toHaveBeenCalled();});

it("requests two explicitly read files and returns only their proposed changes",async()=>{
 const other={path:"Source/Game/Other.cpp",content:"int b = Bad;"};
 const {manager,fetcher}=setup(JSON.stringify({files:[{path:file.path,after:"int a = 1;"},{path:other.path,after:"int b = 2;"}]}));
 const pending=requestRepairSuggestion({...input,files:[file,other]},new AbortController().signal,manager);
 await vi.waitFor(()=>expect(gate.getPending()).not.toBeNull());
 const body=gate.getPending()!.envelope.body;
 expect(body).toContain(file.content);expect(body).toContain(other.content);expect(body).toContain("OTHER_FILE_ERROR");expect(fetcher).not.toHaveBeenCalled();
 gate.approve(gate.getPending()!.id);
 expect(await pending).toEqual([{path:file.path,after:"int a = 1;"},{path:other.path,after:"int b = 2;"}]);
});
it("preserves long C++ names and approved relative paths in the exact outbound review",async()=>{
 const source={path:"Source/Game/LongCompileProbeForRepair.cpp",content:"int UAgentBuildLabCompileProbe() { return Missing; }"};
 const after="int UAgentBuildLabCompileProbe() { return 0; }";
 const {manager,fetcher}=setup(JSON.stringify({files:[{path:source.path,after}]}));
 const result={...input.result,stdout:`E:/SyntheticGame/${source.path}(1): error C2065: 'Missing': undeclared identifier\n`};
 const pending=requestRepairSuggestion({...input,files:[source],result},new AbortController().signal,manager);
 await vi.waitFor(()=>expect(gate.getPending()).not.toBeNull());
 const reviewed=gate.getPending()!.envelope.body;
 expect(reviewed).toContain(source.path);expect(reviewed).toContain(source.content);expect(reviewed).not.toContain("[REDACTED]");expect(fetcher).not.toHaveBeenCalled();
 gate.approve(gate.getPending()!.id);
 expect(await pending).toEqual([{path:source.path,after}]);expect(fetcher.mock.calls[0][1]?.body).toBe(reviewed);
});
it.each(["[REDACTED]","[user-home]"])("rejects a replacement polluted by %s",async marker=>{
 const {manager}=setup(JSON.stringify({files:[{path:file.path,after:`int ${marker}() { return 0; }`}]}));
 const pending=requestRepairSuggestion(input,new AbortController().signal,manager).catch(e=>e);
 await vi.waitFor(()=>expect(gate.getPending()).not.toBeNull());gate.approve(gate.getPending()!.id);
 expect(await pending).toMatchObject({message:"repair_suggestion_contains_redaction"});
});
it("includes build-level and matching module linker diagnostics when Build.cs is selected",()=>{
 const rules={path:"Source/Game/Game.Build.cs",content:"public class Game : ModuleRules {}"};
 const result={...input.result,stdout:"Module.Game.cpp.obj : error LNK2019: unresolved external symbol '__imp_HttpModule'\nModule.Other.cpp.obj : error LNK2019: UNRELATED_LINKER_ERROR\nError: Unable to instantiate module 'HTTP': rules could not be found\n"};
 const body=repairSuggestionInput([rules],result,preview);
 expect(body).toContain("__imp_HttpModule");expect(body).toContain("Unable to instantiate");expect(body).not.toContain("UNRELATED_LINKER_ERROR");
});
it("includes non-unity object linker errors for a build-rules repair without inventing a source location",()=>{
 const rules={path:"Source/Game/Game.Build.cs",content:"public class Game : ModuleRules {}"};
 const nativePreview={...preview,preview:{...preview.preview,cwd:"G:/SyntheticEngine/Engine/Source"}};
 const result={...input.result,stdout:"CompileProbe.cpp.obj : error LNK2019: unresolved external symbol '__imp_HttpModule'\nModule.Other.cpp.obj : error LNK2019: UNRELATED_LINKER_ERROR\n"};
 const body=repairSuggestionInput([rules],result,nativePreview);
 expect(body).toContain("__imp_HttpModule");expect(body).not.toContain("UNRELATED_LINKER_ERROR");
 expect(JSON.parse(body).diagnostics[0].location).toBeUndefined();
});
it("rejects empty, repeated, out-of-scope or excessive input files before outbound review",async()=>{
 const {manager,fetcher}=setup();
 for(const files of [[],[file,file],[{...file,path:"Config/DefaultEngine.ini"}],Array.from({length:9},(_,i)=>({...file,path:`Source/File${i}.cpp`}))]){
  await expect(requestRepairSuggestion({...input,files},new AbortController().signal,manager)).rejects.toThrow();
 }
 expect(gate.getPending()).toBeNull();expect(fetcher).not.toHaveBeenCalled();
});
it("does not adopt truncated output or silently truncate an oversized batch",async()=>{
 const {manager,fetcher}=setup();
 await expect(requestRepairSuggestion({...input,files:[{...file,content:"int value = 0;\n".repeat(3000)}]},new AbortController().signal,manager)).rejects.toThrow();
 expect(gate.getPending()).toBeNull();expect(fetcher).not.toHaveBeenCalled();
 fetcher.mockImplementation(async()=>new Response('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify({files:[{path:file.path,after:"replacement"}]})},finish_reason:"length"}],usage:{prompt_tokens:2,completion_tokens:3,total_tokens:5}})+'\n\ndata: [DONE]\n\n',{headers:{"Content-Type":"text/event-stream"}}));
 const pending=requestRepairSuggestion(input,new AbortController().signal,manager).catch(e=>e);
 await vi.waitFor(()=>expect(gate.getPending()).not.toBeNull());gate.approve(gate.getPending()!.id);
  expect(await pending).toMatchObject({message:"repair_suggestion_truncated"});
});
