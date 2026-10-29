
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {writeFileSync} from "node:fs";
import {UIProvider,useProviderStore} from "../../stores/ui-store";
import {I18nProvider,createLocaleStore} from "../../i18n";
import {ProviderSettings} from "./ProviderSettings";
import {nativeProductSettings,safeProviderProjection,type ProductProviderSnapshot} from "../../runtime/native-product-settings";
import {createSupportedProvider} from "../../provider/runtime-availability";
import type {ProviderConfig,ProviderVersion} from "../../types/provider";

afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
const existing=createSupportedProvider();
const version:ProviderVersion={providerId:"deepseek",generation:"a".repeat(64),revision:4,exists:true};
function mount(){
 vi.spyOn(nativeProductSettings,"getBootstrap").mockReturnValue(null);
 vi.spyOn(nativeProductSettings,"enabled").mockReturnValue(true);
 vi.stubGlobal("fetch",vi.fn(()=>{throw Error("No network in settings tests");}));
 render(<I18nProvider store={createLocaleStore({initialLocale:"en",storage:null,eventTarget:null})}>
  <UIProvider initialState={{provider:{providers:[],selectedProviderId:null,defaultProviderId:null,testStatus:"idle"}}}>
   <ProviderSettings/><VersionProbe/>
  </UIProvider>
 </I18nProvider>);
}
function VersionProbe(){
 const state=useProviderStore(s=>s);
 return <output data-testid="provider-version">{JSON.stringify(state.providerVersions)}</output>;
}
function saved(config:ProviderConfig,revision=5):ProductProviderSnapshot{
 return {config,generation:version.generation!,revision,connectionVerified:false,requiresNewSession:true,transportSupported:false};
}
async function startCustom(){
 fireEvent.click(screen.getByRole("button",{name:"Add provider"}));
 await screen.findByRole("combobox",{name:"Provider type"});
}
describe("settings P2 provider create conflicts and native model projection",()=>{
 it("shows another window's current config and requires explicit edit before updating it",async()=>{
  const current={...existing,displayName:"Other window's provider",baseUrl:"https://api.deepseek.com/",models:[{...existing.models[0],label:"Other window model"}]};
  vi.spyOn(nativeProductSettings,"captureVersion").mockResolvedValueOnce(undefined).mockResolvedValueOnce(version);
  const refresh=vi.spyOn(nativeProductSettings,"initialize").mockImplementation(async()=>{
   vi.mocked(nativeProductSettings.getBootstrap).mockReturnValue({providers:[saved(current,7)]} as import("../../runtime/native-product-settings").ProductSettingsSnapshot);
  });
  const save=vi.spyOn(nativeProductSettings,"saveProvider").mockImplementation(async config=>saved(config,8));
  mount();await startCustom();
  fireEvent.change(screen.getByRole("combobox",{name:"Provider type"}),{target:{value:"deepseek"}});
  await screen.findByRole("heading",{name:"Other window's provider"});
  expect(screen.getByRole("alert").textContent).toContain("already exists");
  expect(screen.queryByRole("button",{name:"Save provider"})).toBeNull();
  expect(screen.queryByRole("textbox",{name:"Display name"})).toBeNull();
  expect(save).not.toHaveBeenCalled();
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("provider-version").textContent).toContain('"revision":7');
  fireEvent.click(screen.getByRole("button",{name:"Edit provider"}));
  expect((screen.getByRole("textbox",{name:"Display name"}) as HTMLInputElement).value).toBe(current.displayName);
  fireEvent.change(screen.getByRole("textbox",{name:"Display name"}),{target:{value:"Explicitly reviewed edit"}});
  fireEvent.click(screen.getByRole("button",{name:"Save provider"}));
  await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0].displayName).toBe("Explicitly reviewed edit");
  expect(save.mock.calls[0][1]).toEqual({...version,revision:7});
  expect(fetch).not.toHaveBeenCalled();
 });
 it("blocks creation if the conflicting existing record cannot be read",async()=>{
  vi.spyOn(nativeProductSettings,"captureVersion").mockResolvedValueOnce(undefined).mockResolvedValueOnce(version);
  vi.spyOn(nativeProductSettings,"initialize").mockRejectedValue(Error("synthetic read failure"));
  const save=vi.spyOn(nativeProductSettings,"saveProvider");
  mount();await startCustom();
  fireEvent.change(screen.getByRole("combobox",{name:"Provider type"}),{target:{value:"deepseek"}});
  await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain("could not be read"));
  expect(screen.queryByRole("button",{name:"Save provider"})).toBeNull();
  expect(save).not.toHaveBeenCalled();
 });
 it("adds a model with a visible editable context window and projects a native-safe unverified DTO",async()=>{
  vi.spyOn(nativeProductSettings,"captureVersion").mockImplementation(async id=>({providerId:id,generation:null,revision:0,exists:false}));
  const save=vi.spyOn(nativeProductSettings,"saveProvider").mockImplementation(async config=>saved(config,1));
  mount();await startCustom();
  fireEvent.change(screen.getByRole("textbox",{name:"Display name"}),{target:{value:"Synthetic custom provider"}});
  fireEvent.change(screen.getByRole("textbox",{name:"Base URL"}),{target:{value:"https://configured.invalid/v1"}});
  fireEvent.click(screen.getByRole("button",{name:"Add model"}));
  fireEvent.change(screen.getByRole("textbox",{name:"Model 1 ID"}),{target:{value:"synthetic-custom-model"}});
  const context=screen.getByRole("spinbutton",{name:"Context window (tokens) 1"}) as HTMLInputElement;
  expect(context.value).toBe("32768");
  expect(screen.getByText(/not a verified model capability/)).toBeTruthy();
  fireEvent.change(context,{target:{value:"65536"}});
  fireEvent.change(screen.getByRole("combobox",{name:"Default model"}),{target:{value:"synthetic-custom-model"}});
  fireEvent.click(screen.getByRole("button",{name:"Save provider"}));
  await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));
  const dto=safeProviderProjection(save.mock.calls[0][0]);
  expect(dto.models[0]).toMatchObject({contextWindow:65536,supportsReasoning:false,
   capabilityDeclarations:{text:"unknown",tools:"unknown",streaming:"unknown"}});
  expect(dto).not.toHaveProperty("secretRef");
  expect(fetch).not.toHaveBeenCalled();
  const output=process.env.UAGENT_SETTINGS_DTO_EVIDENCE;
  if(output){
   if(!/^[EG]:[\\/]/i.test(output))throw Error("settings DTO evidence must stay on E/G");
   writeFileSync(output,JSON.stringify(dto,null,2)+"\n");
  }
 });
 it.each(["0","-1","1.5","100000001"])("refuses an invalid context window %s before native save",async invalid=>{
  vi.spyOn(nativeProductSettings,"captureVersion").mockResolvedValue(undefined);
  const save=vi.spyOn(nativeProductSettings,"saveProvider");
  mount();await startCustom();
  fireEvent.change(screen.getByRole("textbox",{name:"Display name"}),{target:{value:"Synthetic"}});
  fireEvent.change(screen.getByRole("textbox",{name:"Base URL"}),{target:{value:"https://configured.invalid/v1"}});
  fireEvent.click(screen.getByRole("button",{name:"Add model"}));
  fireEvent.change(screen.getByRole("textbox",{name:"Model 1 ID"}),{target:{value:"synthetic"}});
  fireEvent.change(screen.getByRole("combobox",{name:"Default model"}),{target:{value:"synthetic"}});
  fireEvent.change(screen.getByRole("spinbutton",{name:"Context window (tokens) 1"}),{target:{value:invalid}});
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Save provider"})));
  expect(screen.getByRole("alert")).toBeTruthy();expect(save).not.toHaveBeenCalled();
 });
});
