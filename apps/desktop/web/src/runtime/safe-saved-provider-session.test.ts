// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createOutboundConsentGate,DEEPSEEK_MODEL,type RunScopeLease} from "@uagent/runtime";
import type {TaskDraft,ProviderRuntimeRequest} from "@uagent/shared";
import type {NativeInvoke} from "./project-native-adapter";
const factories=vi.hoisted(()=>({deepseek:vi.fn(),responses:vi.fn()}));
vi.mock("./native-saved-deepseek-session",()=>({createSavedDeepSeekProfile:factories.deepseek}));
vi.mock("./native-responses-session",async original=>({...await original<typeof import("./native-responses-session")>(),createNativeResponsesProfile:factories.responses}));
import {createSafeProviderSession} from "./safe-provider-session";
import {createAttachmentStore} from "./attachment-store";
const managers:ReturnType<typeof createSafeProviderSession>[]=[];
const SSE='data: {"model":"deepseek-flash","choices":[{"delta":{"content":"Synthetic saved reply"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}\n\ndata: [DONE]\n\n';
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}
function harness(protocol:"chat_completions"|"responses"="chat_completions"){
 const calls:Array<{command:string;input:Record<string,unknown>}>=[],order:string[]=[];
 const receipt={saved:true,version:"vault-version-A" as string|null,mask:"********" as string|null,cleanupPending:false,providerVersion:{providerId:"deepseek",generation:"provider-generation-A",revision:1,exists:true},wireApi:protocol,endpoint:protocol==="responses"?"https://api.openai.com/v1/responses":"https://api.deepseek.com/chat/completions"};
 let revision=0,serial=0;
 const invoke:NativeInvoke=async<T,>(command:string,args?:unknown)=>{
  const input=structuredClone((args as {input?:Record<string,unknown>})?.input??{});
  calls.push({command,input});
  if(command==="get_saved_provider_credential")return structuredClone(receipt) as T;
  if(command==="open_native_discussion_archive")return{schemaVersion:1,archiveHandle:"archive-"+(++serial),projectId:input.logicalProjectId===null?"chat:local":"chat:project:"+input.logicalProjectId,runId:"run-"+serial} as T;
  if(command==="mutate_native_discussion_archive"){order.push((input.mutation as {kind:string}).kind);return{revision:++revision,messageCount:revision} as T;}
  if(command==="close_native_discussion_archive")return{revision:++revision,messageCount:revision} as T;
  throw Error("No real IPC expected: "+command);
 };
 const gate=createOutboundConsentGate(),manager=createSafeProviderSession({mode:"live",liveAuthorized:true,nativeInvoke:invoke,gate,attachments:createAttachmentStore()});
 managers.push(manager);manager.updateContext("A","Hello",JSON.stringify(["deepseek",DEEPSEEK_MODEL]),"conversation-A");
 const fetcher=vi.fn(async()=>{order.push("fetch");return new Response(SSE,{headers:{"Content-Type":"text/event-stream"}});});
 let closed=false;
 const profile={
  getSnapshot:()=>({ready:!closed,providerId:"deepseek",modelId:DEEPSEEK_MODEL,endpoint:receipt.endpoint,expiresAt:Date.now()+30000,fixture:false,vaultVersion:receipt.version!,modelSettings:{supportsReasoning:false,requestDefaults:{temperature:null,maxOutputTokens:null}}}),
  fetcher,validateText:vi.fn(async(text:string)=>{void text;order.push("validate");}),
  closeAcknowledged:vi.fn(async()=>{closed=true;}),
  createRunAdapter:vi.fn(),createConversationAdapter:vi.fn(),
 };
 factories.deepseek.mockResolvedValue(profile);factories.responses.mockResolvedValue(profile);
 const draft:TaskDraft={input:"Hello",projectId:"A",providerId:"deepseek",modelId:DEEPSEEK_MODEL,conversationId:"conversation-A",taskMode:"discussion",permissionMode:"request_approval",reasoningEffort:"low",runMode:"local",branch:"",contextPercent:0};
 const request:ProviderRuntimeRequest={id:"request-A",providerId:"deepseek",modelId:DEEPSEEK_MODEL,reasoningEffort:"low",messages:[{role:"system",content:"System data"},{role:"developer",content:"Reply concisely"},{role:"user",content:"Hello\n\nNo tool execution is enabled by this request."}],metadata:{projectId:"A",conversationId:"conversation-A"}};
 return{manager,invoke,receipt,calls,order,profile,fetcher,draft,request,gate};
}
beforeEach(()=>{factories.deepseek.mockReset();factories.responses.mockReset();vi.stubGlobal("fetch",vi.fn(()=>{throw Error("REAL NETWORK FORBIDDEN");}));});
afterEach(async()=>{for(const manager of managers.splice(0)){manager.dispose();await manager.whenSettled().catch(()=>undefined);}expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();});
describe("saved native session controller (synthetic profiles, no credentials)",()=>{
 it("opens from metadata with no network, uses single Send, validates archive before persistence, disables tools",async()=>{
  const h=harness();await expect(h.manager.openSaved("deepseek",DEEPSEEK_MODEL)).resolves.toBe(true);
  expect(h.manager.getSnapshot()).toMatchObject({ready:true,savedCredential:true,savedKeyVersion:"vault-version-A",wireApi:"chat_completions"});
  expect(h.fetcher).not.toHaveBeenCalled();
  const authorize=h.manager.captureOrdinarySend(h.draft,()=>true);
  const response=await h.manager.adapter.complete(h.request,{outboundSendIntent:authorize(h.request,true)});
  expect(response.text).toBe("Synthetic saved reply");expect(h.gate.getPending()).toBeNull();
  expect(h.order.indexOf("validate")).toBeLessThan(h.order.indexOf("begin"));
  expect(h.order.indexOf("begin")).toBeLessThan(h.order.indexOf("fetch"));
  expect(h.profile.validateText.mock.calls[0][0]).toContain("Hello");
  expect(h.manager.adapter.getCapabilities().supportsTools).toBe(false);
  expect(()=>h.manager.createRunAdapter({} as RunScopeLease)).toThrow("discussion_only");
  expect(JSON.stringify(h.calls)).not.toContain("native-saved-deepseek-parser-marker");
 });
 it("Stop closes ephemeral profile without deleting stored credential and a new explicit open can reuse metadata",async()=>{
  const h=harness();await h.manager.openSaved("deepseek",DEEPSEEK_MODEL);await h.manager.closeAsync("stopped");
  expect(h.manager.getSnapshot()).toMatchObject({ready:false,savedCredential:false,savedKeyVersion:null});
  expect(h.profile.closeAcknowledged).toHaveBeenCalledTimes(1);
  expect(h.calls.some(c=>/save_provider_credential|delete_provider_credential/.test(c.command))).toBe(false);
  await expect(h.manager.openSaved("deepseek",DEEPSEEK_MODEL)).resolves.toBe(true);
  expect(factories.deepseek).toHaveBeenCalledTimes(2);
 });
 it("routes protocol from native metadata even when provider id is deepseek",async()=>{
  const h=harness("responses");await h.manager.openSaved("deepseek",DEEPSEEK_MODEL);
  expect(factories.deepseek).not.toHaveBeenCalled();
  expect(factories.responses).toHaveBeenCalledWith(expect.objectContaining({savedVersion:"vault-version-A",providerId:"deepseek"}));
  expect(h.manager.getSnapshot()).toMatchObject({wireApi:"responses",savedCredential:true});
 });
 it("an absent saved record with a tombstone token never grants a profile",async()=>{
  const h=harness();Object.assign(h.receipt,{saved:false,version:"revoked-tombstone-token",mask:null});
  await expect(h.manager.openSaved("deepseek",DEEPSEEK_MODEL)).rejects.toThrow("saved_session_setup_failed");
  expect(factories.deepseek).not.toHaveBeenCalled();expect(h.manager.getSnapshot().nativeClosing).toBe(false);
 });
 it("rejects missing protocol metadata and mismatched endpoint without guessing or opening",async()=>{
  const h=harness();(h.receipt as {wireApi?:string}).wireApi=undefined;
  await expect(h.manager.openSaved("deepseek",DEEPSEEK_MODEL)).rejects.toThrow();
  expect(factories.deepseek).not.toHaveBeenCalled();expect(factories.responses).not.toHaveBeenCalled();
 });
 it("rejects secrets before archive begin and before native transport",async()=>{
  const h=harness();await h.manager.openSaved("deepseek",DEEPSEEK_MODEL);
  h.profile.validateText.mockRejectedValue(Error("synthetic-private-native-error"));
  const authorize=h.manager.captureOrdinarySend(h.draft,()=>true);
  await expect(h.manager.adapter.complete(h.request,{outboundSendIntent:authorize(h.request,true)})).rejects.toMatchObject({message:"Conversation history could not be saved. No automatic retry was sent."});
  expect(h.order).not.toContain("begin");expect(h.fetcher).not.toHaveBeenCalled();
 });
 it("a close while status lookup waits cannot silently reopen a profile",async()=>{
  const h=harness(),pending=deferred<typeof h.receipt>();
  const native:NativeInvoke=async<T,>(command:string,args?:unknown)=>command==="get_saved_provider_credential"?await pending.promise as T:h.invoke<T>(command,args);
  const manager=createSafeProviderSession({mode:"live",liveAuthorized:true,nativeInvoke:native});managers.push(manager);
  manager.updateContext("A","Hello","model","conversation-A");
  const opening=manager.openSaved("deepseek",DEEPSEEK_MODEL);await vi.waitFor(()=>expect(manager.getSnapshot().pendingSetup).toBe(true));
  manager.close("stopped");expect(manager.getSnapshot().nativeClosing).toBe(true);
  pending.resolve(h.receipt);
  await expect(opening).resolves.toBe(false);await manager.whenSettled();
  expect(factories.deepseek).not.toHaveBeenCalled();expect(manager.getSnapshot().ready).toBe(false);
 });
 it("late native receipt remains in close barrier until confirmed cleanup",async()=>{
  const h=harness(),nativeOpen=deferred<typeof h.profile>(),cleanup=deferred<void>();
  h.profile.closeAcknowledged.mockImplementation(()=>cleanup.promise);factories.deepseek.mockReturnValue(nativeOpen.promise);
  const opening=h.manager.openSaved("deepseek",DEEPSEEK_MODEL);
  await vi.waitFor(()=>expect(factories.deepseek).toHaveBeenCalledTimes(1));
  h.manager.close("stopped");
  let settled=false;const close=h.manager.whenSettled().then(()=>{settled=true;});
  nativeOpen.resolve(h.profile);await vi.waitFor(()=>expect(h.profile.closeAcknowledged).toHaveBeenCalledTimes(1));
  expect(settled).toBe(false);expect(h.manager.getSnapshot().ready).toBe(false);
  cleanup.resolve();await expect(opening).resolves.toBe(false);await close;
  expect(h.manager.getSnapshot()).toMatchObject({nativeClosing:false,nativeCloseFailed:false});
 });
 it("native close failure preserves barrier and blocks reopening rather than pretending success",async()=>{
  const h=harness();await h.manager.openSaved("deepseek",DEEPSEEK_MODEL);
  h.profile.closeAcknowledged.mockRejectedValue(Error("synthetic-private-close-error"));
  await expect(h.manager.closeAsync("cleared")).rejects.toThrow("native_revocation_unconfirmed");
  expect(h.manager.getSnapshot()).toMatchObject({ready:false,nativeCloseFailed:true,nativeClosing:true});
  await expect(h.manager.openSaved("deepseek",DEEPSEEK_MODEL)).rejects.toThrow("saved_session_native_unavailable");
 });
 it("same-project input changes update request revision; conversation/model/project changes close the saved profile",async()=>{
  const h=harness();await h.manager.openSaved("deepseek",DEEPSEEK_MODEL);
  const options=factories.deepseek.mock.calls[0][0],before=options.getContext();
  h.manager.updateContext("A","Next question",JSON.stringify(["deepseek",DEEPSEEK_MODEL]),"conversation-A");
  expect(options.getContext().revision).not.toBe(before.revision);expect(h.manager.getSnapshot().ready).toBe(true);
  h.manager.updateContext("A","New conversation",JSON.stringify(["deepseek",DEEPSEEK_MODEL]),"conversation-B");
  await h.manager.whenSettled();expect(h.manager.getSnapshot().ready).toBe(false);
  expect(h.profile.closeAcknowledged).toHaveBeenCalledTimes(1);
 });
});
describe("saved Responses profile opener IPC",()=>{
 it("passes only native vault version; no stored key or parser marker reaches open IPC",async()=>{
  const actual=await vi.importActual<typeof import("./native-responses-session")>("./native-responses-session");
  const calls:Array<{command:string;input:unknown}>=[];
  const invoke:NativeInvoke=async<T,>(command:string,args?:unknown)=>{
   const input=(args as {input:unknown}).input;calls.push({command,input});
   if(command==="open_saved_native_responses_profile")return{profileId:"native-profile-A",providerId:"configured-provider",modelId:"model-snapshot",endpoint:"https://api.openai.com/v1/responses",expiresAt:Date.now()+30000,fixture:false,modelSettings:{supportsReasoning:true,requestDefaults:{temperature:null,maxOutputTokens:null}}} as T;
   if(command==="close_native_responses_profile")return null as T;
   throw Error("Unexpected command");
  };
  const profile=await actual.createNativeResponsesProfile({invoke,providerId:"configured-provider",modelId:"model-snapshot",credential:"unused-one-off-input",savedVersion:"vault-version-X",savedProviderVersion:{providerId:"configured-provider",generation:"provider-gen-X",revision:3,exists:true},gate:createOutboundConsentGate()});
  expect(calls[0]).toEqual({command:"open_saved_native_responses_profile",input:{providerId:"configured-provider",modelId:"model-snapshot",expectedVaultVersion:"vault-version-X",expectedProviderVersion:{providerId:"configured-provider",generation:"provider-gen-X",revision:3,exists:true}}});
  expect(JSON.stringify(calls)).not.toContain("credential");expect(JSON.stringify(calls)).not.toContain("parser-marker");
  expect(profile.getSnapshot()).toMatchObject({savedCredential:true,savedKeyVersion:"vault-version-X",connectionVerified:false});
  expect(()=>profile.createRunAdapter({} as never)).toThrow();await profile.closeAcknowledged();
 });
});
