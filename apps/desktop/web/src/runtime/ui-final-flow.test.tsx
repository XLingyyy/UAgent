import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {I18nProvider,createLocaleStore,translate,localizeText,getLocale} from "../i18n";
import {UIProvider} from "../stores/ui-store";
import {GeneralSettings} from "../settings/pages/GeneralSettings";
import {DeepSeekSessionSetup} from "../settings/pages/DeepSeekSessionSetup";
import {OutboundRequestReview} from "../settings/pages/OutboundRequestReview";
import {ComposerDock} from "../composer/ComposerDock";
import {createSafeProviderSession,safeProviderSession} from "./safe-provider-session";
import {createDesktopRuntimeAdapter} from "./desktop-runtime-adapter";
import {createOutboundConsentGate,DEEPSEEK_CAMPAIGN,DEEPSEEK_ENDPOINT,DEEPSEEK_MODEL,type DeepSeekBudgetRecord,type DeepSeekBudgetStore,type ProviderAdapter} from "@uagent/runtime";
import type {TaskRecord} from "@uagent/shared";
const uiText=(source:string)=>localizeText(getLocale(),source);
const managers:ReturnType<typeof createSafeProviderSession>[]=[];
afterEach(()=>{safeProviderSession.close("cleared");cleanup();managers.splice(0).forEach(m=>m.dispose());vi.unstubAllGlobals();vi.restoreAllMocks();});
function setup(){
 vi.stubGlobal("fetch",vi.fn(()=>{throw Error("REAL NETWORK FORBIDDEN");}));
 const fetcher=vi.fn(async()=>new Response("synthetic"));
 const record:DeepSeekBudgetRecord={campaign:DEEPSEEK_CAMPAIGN,limitMicros:10000000,reservedMicros:3000000,requests:2,uncertainRequests:1,inputTokens:10,outputTokens:20};
 const native=vi.fn(async(name:string)=>{if(name==="read_provider_budget")return {...record};throw Error("UNEXPECTED_NATIVE_MUTATION");});vi.stubGlobal("__TAURI_INTERNALS__",{invoke:native});
 const ledger:DeepSeekBudgetStore={durable:true,read:vi.fn(()=>({...record})),reserve:vi.fn(()=>{throw Error("NO RESERVATION EXPECTED");}),recordUsage:vi.fn()};
 const manager=createSafeProviderSession({mode:"live",liveAuthorized:true,fetcher});managers.push(manager);
 const write=vi.fn();const locale=createLocaleStore({initialLocale:"zh-CN",storage:{getItem:()=>null,setItem:write},eventTarget:null});
 return {manager,fetcher,ledger,native,locale,write};
}
describe("redesigned core UI with synthetic boundaries",()=>{
 it("switches language without checking authorization, opening a session, resetting budget or sending",async()=>{
  const h=setup();render(<I18nProvider store={h.locale}><UIProvider><GeneralSettings/><DeepSeekSessionSetup controller={h.manager} getBudget={()=>h.ledger}/></UIProvider></I18nProvider>);
  expect((screen.getByLabelText(translate("zh-CN","session.authorizeLabel")) as HTMLInputElement).checked).toBe(false);
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
  const before=h.native.mock.calls.length;
  fireEvent.click(screen.getByRole("button",{name:"English"}));
  expect((screen.getByLabelText(translate("en","session.authorizeLabel")) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByLabelText(translate("en","session.verifyRatesConsent")) as HTMLInputElement).checked).toBe(false);
  expect(h.manager.getSnapshot().ready).toBe(false);expect(h.write.mock.calls).toEqual([["uagent.locale","en"]]);
  expect(h.fetcher).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();expect(h.ledger.reserve).not.toHaveBeenCalled();
  expect(h.native.mock.calls.length).toBe(before);expect(h.native.mock.calls.some(c=>/initialize|reserve|save/.test(c[0]))).toBe(false);
 });
 it("keeps an explicitly opened synthetic memory session through an immediate locale switch",async()=>{
  const h=setup();h.manager.open("synthetic-ui-only-key",h.ledger,{endpoint:DEEPSEEK_ENDPOINT,model:DEEPSEEK_MODEL,campaign:DEEPSEEK_CAMPAIGN,expiresAt:Date.now()+60000,pricesVerified:true,inputMicrosPerToken:2,outputMicrosPerToken:8});
  const expires=h.manager.getSnapshot().expiresAt;render(<I18nProvider store={h.locale}><UIProvider><GeneralSettings/><DeepSeekSessionSetup controller={h.manager} getBudget={()=>h.ledger}/></UIProvider></I18nProvider>);
  fireEvent.click(screen.getByRole("button",{name:"English"}));
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
  expect(h.manager.getSnapshot()).toMatchObject({ready:true,expiresAt:expires});expect(h.fetcher).not.toHaveBeenCalled();expect(h.ledger.reserve).not.toHaveBeenCalled();
 });
 it("retains a failed draft and retries only on a second explicit Ctrl+Enter",async()=>{
  setup();const runtime=createDesktopRuntimeAdapter({nativeInvoke:null});const submit=vi.spyOn(runtime,"submitTask").mockRejectedValueOnce(Error("synthetic_offline")).mockResolvedValueOnce({id:"retry-task",state:"completed"} as TaskRecord);
  render(<UIProvider runtimeClient={runtime}><ComposerDock/></UIProvider>);const input=screen.getByLabelText(uiText("Composer input")) as HTMLTextAreaElement;
  fireEvent.change(input,{target:{value:"Synthetic retry task"}});fireEvent.keyDown(input,{key:"Enter",ctrlKey:true});
  await screen.findByRole("alert");expect(input.value).toBe("Synthetic retry task");expect(submit).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(input,{key:"Enter",ctrlKey:true});await waitFor(()=>expect(input.value).toBe(""));expect(submit).toHaveBeenCalledTimes(2);expect(fetch).not.toHaveBeenCalled();
 });
 it("stops a streaming task from the composer and retains its draft without a retry",async()=>{
  setup();let aborted=false;
  const provider:ProviderAdapter={id:"deepseek",getCapabilities:()=>({providerId:"deepseek",modelIds:[DEEPSEEK_MODEL],supportsStreaming:true,supportsTools:false,isMock:true}),complete:vi.fn(),async *stream(request,call){yield{id:"first",requestId:request.id,providerId:"deepseek",modelId:DEEPSEEK_MODEL,index:0,delta:"Synthetic partial response",done:false};await new Promise<void>(resolve=>{if(call?.signal?.aborted){aborted=true;resolve();}else call?.signal?.addEventListener("abort",()=>{aborted=true;resolve();},{once:true});});}};
  const runtime=createDesktopRuntimeAdapter({nativeInvoke:null,providerAdapter:provider,providerEnabled:true});
  const providerConfig={providerId:"deepseek",displayName:"DeepSeek Flash",baseUrl:"https://api.deepseek.com",wireApi:"openai_compatible" as const,authMode:"env_key" as const,enabled:true,networkMode:"live" as const,models:[{id:DEEPSEEK_MODEL,label:"DeepSeek Flash",contextWindow:1000000,supportsReasoning:false}],defaultModel:DEEPSEEK_MODEL};
  render(<UIProvider runtimeClient={runtime} initialState={{provider:{providers:[providerConfig]},composer:{input:"Synthetic cancellable task",selectedModelId:JSON.stringify(["deepseek",DEEPSEEK_MODEL])}}}><ComposerDock/></UIProvider>);
  act(()=>{safeProviderSession.enable();safeProviderSession.openAccount("synthetic-composer-test-only");});
  fireEvent.click(screen.getByRole("button",{name:uiText("Send task")}));fireEvent.click(await screen.findByRole("button",{name:uiText("Stop task")}));
  await waitFor(()=>expect(aborted).toBe(true));await waitFor(()=>expect(screen.queryByRole("button",{name:uiText("Stop task")})).toBeNull());
  expect((screen.getByLabelText(uiText("Composer input")) as HTMLTextAreaElement).value).toBe("Synthetic cancellable task");expect(fetch).not.toHaveBeenCalled();
 });
 it("keeps the exact pending body across locale change and revokes with keyboard Escape",async()=>{
  const h=setup(),gate=createOutboundConsentGate();render(<I18nProvider store={h.locale}><UIProvider><div className="ua-app"><button>Original focus</button></div><OutboundRequestReview gate={gate}/></UIProvider></I18nProvider>);
  const original=screen.getByText("Original focus");original.focus();const envelope={endpoint:DEEPSEEK_ENDPOINT,model:DEEPSEEK_MODEL,projectId:"Synthetic A",epoch:3,revision:"one",maximumCostMicros:10000,body:JSON.stringify({messages:[{role:"user",content:"Untranslated synthetic raw data"}]})};
  let pending!:Promise<unknown>;act(()=>{pending=gate.review(envelope).catch(e=>e);});const id=gate.getPending()!.id;
  act(()=>h.locale.setLocale("en"));expect(gate.getPending()!.id).toBe(id);expect(screen.getByLabelText("Exact outbound body").textContent).toBe(envelope.body);expect(document.querySelector(".ua-app")?.hasAttribute("inert")).toBe(true);
  fireEvent.keyDown(screen.getByLabelText("Exact outbound body"),{key:"Escape"});expect(await pending).toBeInstanceOf(Error);expect(document.querySelector(".ua-app")?.hasAttribute("inert")).toBe(false);expect(document.activeElement).toBe(original);expect(fetch).not.toHaveBeenCalled();
 });
});
