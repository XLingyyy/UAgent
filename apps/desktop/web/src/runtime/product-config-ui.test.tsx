import {cleanup,render,screen} from "@testing-library/react";
import {afterEach,describe,it,expect,vi} from "vitest";
import {UIProvider} from "../stores/ui-store";
import {I18nProvider,createLocaleStore} from "../i18n";
import {WelcomeHero} from "../workspace/WelcomeHero";
import {ComposerDock} from "../composer/ComposerDock";
import {ProviderSettings} from "../settings/pages/ProviderSettings";
import {supportsProviderModel} from "../provider/runtime-availability";
import type {ProviderConfig} from "../types/provider";
const custom:ProviderConfig={providerId:"custom",displayName:"My Provider",baseUrl:"https://configured.invalid/v1",wireApi:"responses",authMode:"env_key",networkMode:"live",enabled:true,models:[{id:"user-model",label:"My Model",contextWindow:32000,supportsReasoning:false}],defaultModel:"user-model"};
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("product model configuration without test policy promotion",()=>{
 it.each(["zh-CN","en"] as const)("shows actual selection and truthful availability in %s",locale=>{
  const fetcher=vi.fn(()=>{throw Error("NO REAL NETWORK");});vi.stubGlobal("fetch",fetcher);
  const store=createLocaleStore({initialLocale:locale,storage:null,eventTarget:null});
  render(<I18nProvider store={store}><UIProvider initialState={{provider:{providers:[custom],selectedProviderId:"custom",defaultProviderId:"custom"},composer:{selectedModelId:JSON.stringify(["custom","user-model"])}}}><WelcomeHero/><ComposerDock/></UIProvider></I18nProvider>);
  expect(screen.getByRole("heading",{level:1})).toBeTruthy();expect(screen.getByText(/My Provider \/ My Model/)).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/CNY\s*10|10\s*元|十元|DeepSeek/);
  expect(document.body.textContent).toContain(locale==="zh-CN"?"此构建尚不可运行":"runtime unavailable in this build");
  expect(fetcher).not.toHaveBeenCalled();
 });
 it.each(["zh-CN","en"] as const)("keeps generic settings accessible without mounting legacy setup in %s",locale=>{
  const native=vi.fn((command:string)=>{void command;throw Error("NO NATIVE MUTATION");});vi.stubGlobal("__TAURI_INTERNALS__",{invoke:native});vi.stubGlobal("fetch",vi.fn(()=>{throw Error("NO NETWORK");}));
  const store=createLocaleStore({initialLocale:locale,storage:null,eventTarget:null});
  render(<I18nProvider store={store}><UIProvider><ProviderSettings/></UIProvider></I18nProvider>);
  expect(document.querySelector(".ua-provider-advanced")).toBeNull();expect(document.querySelector(".ua-provider-setup")).toBeNull();
  expect(document.body.textContent).not.toMatch(/CNY\s*10|10\s*元|十元|核价|Verify current Flash prices/);
  expect(screen.getByRole("button",{name:locale==="zh-CN"?"添加服务商":"Add provider"})).toBeTruthy();
  expect(native.mock.calls.some(args=>/budget|reserve|usage|save/.test(String(args[0])))).toBe(false);expect(fetch).not.toHaveBeenCalled();
 });
 it("does not treat a configured transport, model or endpoint as supported unless shipped",()=>{
  const known={...custom,providerId:"deepseek",baseUrl:"https://api.deepseek.com",wireApi:"openai_compatible" as const};
  expect(supportsProviderModel(known,"deepseek-flash")).toBe(true);
  expect(supportsProviderModel({...known,baseUrl:"https://configured.invalid"},"deepseek-flash")).toBe(false);
  expect(supportsProviderModel(known,"other-model")).toBe(false);expect(supportsProviderModel(custom,"user-model")).toBe(false);
 });
});
