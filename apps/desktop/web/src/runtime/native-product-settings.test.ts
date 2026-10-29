import {describe,it,expect,vi} from "vitest";
import {createNativeProductSettings,restoredProvider,safeProviderProjection,type ProductSettingsSnapshot} from "./native-product-settings";
import {createNativePolicyFetcher} from "./native-provider-endpoint";
import type {NativeInvoke} from "./project-native-adapter";
import type {ProviderConfig} from "../types/provider";
import {createLocaleStore} from "../i18n/locale-store";
const provider:ProviderConfig={providerId:"deepseek",displayName:"DeepSeek",baseUrl:"https://api.deepseek.com",wireApi:"chat_completions",authMode:"env_key",models:[{id:"deepseek-flash",label:"Flash",contextWindow:1000,supportsReasoning:false}],defaultModel:"deepseek-flash",enabled:true};
const initial=():ProductSettingsSnapshot=>({preferences:{revision:1,preferences:{theme:"dark",locale:"zh-CN",activeProjectId:"A",selectedProviderId:"deepseek",defaultProviderId:"deepseek"}},providers:[{generation:"a".repeat(64),revision:1,config:provider,transportSupported:true,connectionVerified:false,requiresNewSession:true}],projects:[{id:"A",root:"E:/FixtureA",label:"A",createdAt:1},{id:"B",root:"E:/FixtureB",label:"B",createdAt:1}],projectPreferences:[{projectId:"A",revision:1,preferences:{providerId:"deepseek",modelId:"deepseek-flash",reasoningEffort:null},requiresFreshProjectTrust:true}]});
function harness(){
 const state=initial();const calls:Array<{command:string;input:Record<string,unknown>|undefined}>=[];
 const invoke:NativeInvoke=async<T>(command:string,args?:unknown)=>{
  const input=(args as {input?:Record<string,unknown>}|undefined)?.input;calls.push({command,input});
  if(command==="initialize_product_settings"||command==="read_product_settings")return structuredClone(state) as T;
  if(command==="get_product_provider_version"){const p=state.providers[0];return {providerId:p.config.providerId,generation:p.generation,revision:p.revision,exists:true} as T;}
  if(command==="save_product_preferences"){if(input!.expectedRevision!==state.preferences.revision)throw {kind:"conflict"};state.preferences={revision:state.preferences.revision+1,preferences:input!.preferences as ProductSettingsSnapshot["preferences"]["preferences"]};return structuredClone(state.preferences) as T;}
  if(command==="save_product_provider"){const token=input!.version as {revision:number};if(token.revision!==state.providers[0].revision)throw {kind:"conflict"};state.providers[0]={...state.providers[0],revision:token.revision+1,config:input!.config as ProviderConfig,connectionVerified:false};return structuredClone(state.providers[0]) as T;}
  throw Error("Unexpected command "+command);
 };
 return {state,calls,settings:createNativeProductSettings(invoke)};
}
describe("native product-settings adapter, synthetic IPC",()=>{
 it("hydrates existing preferences, project isolation and disabled sessions",async()=>{
  const h=harness();await h.settings.initialize("en");expect(h.settings.getBootstrap()!.preferences.preferences.locale).toBe("zh-CN");
  expect(h.settings.projectPreferences("B")).toBeNull();expect(h.settings.projectPreferences("A")!.preferences.modelId).toBe("deepseek-flash");
  expect(restoredProvider(provider).networkMode).toBe("disabled");expect(h.settings.providerVersions().deepseek.revision).toBe(1);
 });
 it("projects only nonsecret config and preserves the token captured at edit start",async()=>{
  const h=harness();await h.settings.initialize("en");const token=await h.settings.captureVersion("deepseek");
  await h.settings.saveProvider({...provider,secretRef:"env-only",networkMode:"live"},token!);
  const write=h.calls.find(c=>c.command==="save_product_provider")!;
  expect(write.input!.version).toEqual(token);expect(write.input!.config).toEqual(safeProviderProjection(provider));
  expect(write.input!.config).not.toHaveProperty("secretRef");expect(write.input!.config).not.toHaveProperty("networkMode");
 });
 it("conflict never refreshes a provider token or silently replays stale text",async()=>{
  const h=harness();await h.settings.initialize("en");const token=await h.settings.captureVersion("deepseek");h.state.providers[0].revision=2;
  await expect(h.settings.saveProvider({...provider,displayName:"stale"},token!)).rejects.toThrow("conflict");
  expect(h.settings.getStatus().error).toBe("conflict");
  await expect(h.settings.saveProvider(provider,token!)).rejects.toThrow("settings_reload_required");
  expect(h.calls.filter(c=>c.command==="get_product_provider_version")).toHaveLength(1);
  expect(h.calls.filter(c=>c.command==="save_product_provider")).toHaveLength(1);
 });
 it("serializes immediate language/theme updates using native acknowledgements",async()=>{
  const h=harness();await h.settings.initialize("zh-CN");
  await Promise.all([h.settings.savePreferences({locale:"en"}),h.settings.savePreferences({theme:"light"})]);
  const calls=h.calls.filter(c=>c.command==="save_product_preferences");
  expect(calls.map(c=>c.input!.expectedRevision)).toEqual([1,2]);expect(h.state.preferences.preferences).toMatchObject({locale:"en",theme:"light"});
 });
 it("disables old locale persistence and cross-window browser writes after cutover",()=>{
  const storage={getItem:vi.fn(()=>"en"),setItem:vi.fn()},target=new EventTarget();
  const store=createLocaleStore({storage,eventTarget:target as Window});expect(store.getSnapshot()).toBe("en");
  store.subscribe(()=>undefined);store.disablePersistence();store.setLocale("zh-CN");
  target.dispatchEvent(Object.assign(new Event("storage"),{key:"uagent.locale",newValue:"en",storageArea:null}));
  expect(store.getSnapshot()).toBe("zh-CN");expect(storage.setItem).not.toHaveBeenCalled();
 });
});
describe("native endpoint preflight before actual fetch",()=>{
 it("fails closed when the native policy is unavailable or rejects transport",async()=>{
  const fetcher=vi.fn();
  await expect(createNativePolicyFetcher(null,fetcher)("https://api.deepseek.com/chat/completions")).rejects.toThrow("unavailable");
  const invoke:NativeInvoke=async<T>()=>({canonicalBaseUrl:"https://other.example",transportSupported:false}) as T;
  await expect(createNativePolicyFetcher(invoke,fetcher)("https://other.example/chat/completions")).rejects.toThrow("rejected");
  expect(fetcher).not.toHaveBeenCalled();
 });
 it("reuses the canonical native policy and preserves the exact approved request",async()=>{
  const invoke=vi.fn(async()=>({canonicalBaseUrl:"https://api.deepseek.com",transportSupported:true})) as unknown as NativeInvoke;
  const response=new Response("synthetic");const fetcher=vi.fn(async()=>response),init={method:"POST",body:"exact approved bytes"};
  expect(await createNativePolicyFetcher(invoke,fetcher)("https://api.deepseek.com/chat/completions",init)).toBe(response);
  expect(invoke).toHaveBeenCalledWith("check_native_provider_endpoint",{input:{wireApi:"chat_completions",baseUrl:"https://api.deepseek.com"}});
  expect(fetcher).toHaveBeenCalledWith("https://api.deepseek.com/chat/completions",init);
 });
 it("an abort during native preflight prevents all network transmission",async()=>{
  const controller=new AbortController(),fetcher=vi.fn();
  const invoke:NativeInvoke=async<T>()=>{controller.abort();return {canonicalBaseUrl:"https://api.deepseek.com",transportSupported:true} as T;};
  await expect(createNativePolicyFetcher(invoke,fetcher)("https://api.deepseek.com/chat/completions",{signal:controller.signal})).rejects.toMatchObject({name:"AbortError"});
  expect(fetcher).not.toHaveBeenCalled();
 });
});
