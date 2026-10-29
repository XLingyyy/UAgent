import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,describe,it,expect,vi} from "vitest";
import {UIProvider,useProviderActions} from "../stores/ui-store";
import {ProviderSettings} from "../settings/pages/ProviderSettings";
import {I18nProvider,createLocaleStore} from "../i18n";
import {nativeProductSettings,type ProductProviderSnapshot} from "./native-product-settings";
import {createSupportedProvider} from "../provider/runtime-availability";
const config=createSupportedProvider();
const v1={providerId:"deepseek",generation:"a".repeat(64),revision:1,exists:true};
function OtherWriter(){const actions=useProviderActions();return <button onClick={()=>void actions.saveProvider({...config,displayName:"Other writer"},v1)}>Apply other writer</button>;}
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe("T08 provider editor version ownership",()=>{
 it("keeps the edit-start token after the displayed provider changes, then preserves conflicting draft",async()=>{
  vi.spyOn(nativeProductSettings,"enabled").mockReturnValue(true);
  const save=vi.spyOn(nativeProductSettings,"saveProvider")
   .mockResolvedValueOnce({generation:v1.generation,revision:2,config:{...config,displayName:"Other writer"},transportSupported:true,connectionVerified:false,requiresNewSession:true})
   .mockRejectedValueOnce(Error("conflict"));
  render(<I18nProvider store={createLocaleStore({initialLocale:"en",storage:null,eventTarget:null})}><UIProvider initialState={{provider:{providers:[config],selectedProviderId:"deepseek",defaultProviderId:"deepseek",testStatus:"idle",providerVersions:{deepseek:v1}}}}><ProviderSettings/><OtherWriter/></UIProvider></I18nProvider>);
  fireEvent.click(screen.getByRole("button",{name:"Edit provider"}));
  fireEvent.change(screen.getByRole("textbox",{name:"Display name"}),{target:{value:"My unsaved edit"}});
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Apply other writer"})));
  fireEvent.click(screen.getByRole("button",{name:"Save provider"}));
  await waitFor(()=>expect(screen.getByRole("alert")).toBeTruthy());
  expect(save).toHaveBeenCalledTimes(2);expect(save.mock.calls[1][1]).toEqual(v1);
  expect((screen.getByRole("textbox",{name:"Display name"}) as HTMLInputElement).value).toBe("My unsaved edit");
 });
 it("waits for native acknowledgement before closing a saved edit",async()=>{
  vi.spyOn(nativeProductSettings,"enabled").mockReturnValue(true);
  let resolve!:(value:ProductProviderSnapshot)=>void;
  vi.spyOn(nativeProductSettings,"saveProvider").mockImplementation(()=>new Promise(r=>{resolve=r;}));
  render(<I18nProvider store={createLocaleStore({initialLocale:"en",storage:null,eventTarget:null})}><UIProvider initialState={{provider:{providers:[config],selectedProviderId:"deepseek",defaultProviderId:"deepseek",testStatus:"idle",providerVersions:{deepseek:v1}}}}><ProviderSettings/></UIProvider></I18nProvider>);
  fireEvent.click(screen.getByRole("button",{name:"Edit provider"}));fireEvent.click(screen.getByRole("button",{name:"Save provider"}));
  expect((screen.getByRole("button",{name:"Save provider"}) as HTMLButtonElement).disabled).toBe(true);
  await act(async()=>resolve({generation:v1.generation,revision:2,config,transportSupported:true,connectionVerified:false,requiresNewSession:true}));
  expect(screen.queryByRole("button",{name:"Save provider"})).toBeNull();
 });
 it("locks the form until a template's edit token has arrived",async()=>{
  vi.spyOn(nativeProductSettings,"enabled").mockReturnValue(true);
  let resolve!:(value:import("../types/provider").ProviderVersion)=>void;
  vi.spyOn(nativeProductSettings,"captureVersion").mockResolvedValueOnce(undefined).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  render(<I18nProvider store={createLocaleStore({initialLocale:"en",storage:null,eventTarget:null})}><UIProvider initialState={{provider:{providers:[],selectedProviderId:null,defaultProviderId:null,testStatus:"idle"}}}><ProviderSettings/></UIProvider></I18nProvider>);
  fireEvent.click(screen.getByRole("button",{name:"Add provider"}));
  const template=await screen.findByRole("combobox",{name:"Provider type"});
  fireEvent.change(template,{target:{value:"deepseek"}});
  expect(document.querySelector("fieldset")!.disabled).toBe(true);
  await act(async()=>resolve({...v1,generation:null,revision:0,exists:false}));
  expect(document.querySelector("fieldset")!.disabled).toBe(false);
  fireEvent.change(screen.getByRole("textbox",{name:"Display name"}),{target:{value:"My preserved name"}});
  expect((screen.getByRole("textbox",{name:"Display name"}) as HTMLInputElement).value).toBe("My preserved name");
 });
});
