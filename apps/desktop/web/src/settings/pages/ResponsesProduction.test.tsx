import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {UIProvider} from "../../stores/ui-store";
import {I18nProvider,createLocaleStore} from "../../i18n";
import {ProviderSettings} from "./ProviderSettings";
import {ProviderSessionSetup} from "./ProviderSessionSetup";
import {nativeProductSettings} from "../../runtime/native-product-settings";
import {createResponsesProvider,supportsProviderModel} from "../../provider/runtime-availability";
import {createComposerModelOptions} from "../../composer/composer-data";
import {createSafeProviderSession} from "../../runtime/safe-provider-session";
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
function wrap(child:React.ReactNode,locale:"en"|"zh-CN"="en"){
 return <I18nProvider store={createLocaleStore({initialLocale:locale,storage:null,eventTarget:null})}><UIProvider>{child}</UIProvider></I18nProvider>;
}
function nativeHost(){vi.stubGlobal("__TAURI_INTERNALS__",{invoke:vi.fn(()=>{throw Error("No uncontrolled native IPC");})});}
describe("official Responses configuration",()=>{
 it("offers an official template without inventing a model or claiming connectivity",async()=>{
  nativeHost();vi.spyOn(nativeProductSettings,"getBootstrap").mockReturnValue(null);
  vi.spyOn(nativeProductSettings,"captureVersion").mockResolvedValue(undefined);
  render(wrap(<ProviderSettings/>));
  fireEvent.click(screen.getByRole("button",{name:"Add provider"}));
  const type=await screen.findByRole("combobox",{name:"Provider type"});
  fireEvent.change(type,{target:{value:"responses"}});
  await waitFor(()=>expect((screen.getByRole("textbox",{name:"Base URL"}) as HTMLInputElement).value).toBe("https://api.openai.com/v1"));
  expect((screen.getByRole("combobox",{name:"Wire API"}) as HTMLSelectElement).value).toBe("responses");
  expect(screen.queryByRole("textbox",{name:"Model 1 ID"})).toBeNull();
  expect(screen.getByText(/snapshot IDs recommended/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Add model"}));
  expect(screen.getByRole("checkbox",{name:"Send reasoning effort 1"})).toBeTruthy();
 });
 it.each(["en","zh-CN"] as const)("shows a real temporary credential input without a fixture banner: %s",locale=>{
  nativeHost();const p=createResponsesProvider();p.models=[{id:"synthetic-model",label:"Synthetic",supportsReasoning:false,contextWindow:32768}];p.defaultModel="synthetic-model";
  const manager=createSafeProviderSession({mode:"live",liveAuthorized:true,nativeInvoke:async()=>{throw Error("Must not open automatically");}});
  render(wrap(<ProviderSessionSetup provider={p} controller={manager}/>,locale));
  expect(screen.getByLabelText(locale==="en"?"Session API key":"本次会话 API 密钥")).toBeTruthy();
  expect(screen.queryByPlaceholderText("offline-responses-fixture-only")).toBeNull();
  expect(screen.getByText(locale==="en"?/Supports the official OpenAI Responses service/:/支持 OpenAI 官方 Responses 服务/)).toBeTruthy();
  expect(manager.getSnapshot().ready).toBe(false);manager.dispose();
 });
 it("keeps unsupported roots and browser previews unavailable",()=>{
  const p=createResponsesProvider();p.models=[{id:"synthetic",label:"Synthetic",supportsReasoning:false,contextWindow:32768}];
  expect(supportsProviderModel(p,"synthetic")).toBe(false);
  nativeHost();expect(supportsProviderModel(p,"synthetic")).toBe(true);
  expect(createComposerModelOptions([p]).find(m=>m.modelId==="synthetic")).toMatchObject({networkMode:"live",isFixture:false,runtimeSupported:true});
  for(const root of ["https://other.invalid/v1","http://localhost:8000/v1","https://api.openai.com.evil.invalid/v1"])
   expect(supportsProviderModel({...p,baseUrl:root},"synthetic")).toBe(false);
 });
});
