import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {ProviderSessionSetup} from "./ProviderSessionSetup";
import {I18nProvider,createLocaleStore,translate} from "../../i18n";
import {createSupportedProvider} from "../../provider/runtime-availability";
import {createNativeProviderCredentials,SAVED_CREDENTIAL_MASK,type SavedProviderCredential} from "../../runtime/native-provider-credentials";
import type {NativeInvoke} from "../../runtime/project-native-adapter";
import type {SafeProviderSession} from "../../runtime/safe-provider-session";
const composer=vi.hoisted(()=>({setComposerModel:vi.fn(async()=>undefined)}));
vi.mock("../../stores/ui-store",()=>({useComposerActions:()=>composer}));
vi.mock("../../runtime/safe-provider-session",()=>({safeProviderSession:{}}));
const providerVersion={providerId:"deepseek",generation:"generation-a",revision:1,exists:true};
const absent=():SavedProviderCredential=>({saved:false,version:null,mask:null,providerVersion:{...providerVersion}});
const stored=():SavedProviderCredential=>({saved:true,version:"synthetic-vault-version-a",mask:SAVED_CREDENTIAL_MASK,providerVersion:{...providerVersion}});
function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function harness(initial:SavedProviderCredential=absent()){
 let receipt=initial;
 const invoke=vi.fn(async(command:string)=>{
  if(command==="get_saved_provider_credential")return receipt;
  if(command==="save_provider_credential"){receipt=stored();return receipt;}
  if(command==="delete_provider_credential"){receipt=absent();return receipt;}
  throw Error("Unexpected synthetic command");
 });
 const state={ready:false,providerId:null,modelId:null,endpoint:null,wireApi:null,fixture:false,canConfigure:true,pendingSetup:false};
 const controller={getSnapshot:()=>state,subscribe:()=>()=>undefined,closeAsync:vi.fn(async():Promise<void>=>undefined),enable:vi.fn(),openSaved:vi.fn(async()=>true)};
 const credentials=createNativeProviderCredentials(invoke as NativeInvoke);
 const locale=createLocaleStore({initialLocale:"en",storage:null,eventTarget:null});
 const provider=createSupportedProvider();
 const mount=()=>render(<I18nProvider store={locale}><ProviderSessionSetup provider={provider} controller={controller as unknown as SafeProviderSession} credentials={credentials}/></I18nProvider>);
 return{invoke,controller,credentials,locale,provider,mount,setReceipt:(next:typeof initial)=>{receipt=next;}};
}
afterEach(()=>{cleanup();composer.setComposerModel.mockReset();composer.setComposerModel.mockResolvedValue(undefined);});
describe("saved provider credential form (synthetic only)",()=>{
 it("loads only mask metadata without opening or sending",async()=>{
  const h=harness(stored());h.mount();
  const field=await screen.findByLabelText("Saved API key") as HTMLInputElement;
  expect(field.value).toBe(SAVED_CREDENTIAL_MASK);expect(field.readOnly).toBe(true);
  expect(h.invoke).toHaveBeenCalledTimes(1);expect(h.controller.openSaved).not.toHaveBeenCalled();
  expect(screen.queryByRole("checkbox")).toBeNull();
 });
 it("waits for the old session to close, saves captured input once, and masks it",async()=>{
  const h=harness(),gate=deferred<void>();h.controller.closeAsync.mockReturnValue(gate.promise);
  const view=h.mount();await screen.findByText("No API key saved");
  const field=screen.getByLabelText("API key") as HTMLInputElement;
  fireEvent.change(field,{target:{value:"synthetic-user-input-key"}});
  fireEvent.click(screen.getByRole("button",{name:"Save API key"}));
  expect(field.value).toBe("");expect(h.invoke.mock.calls.some(c=>c[0]==="save_provider_credential")).toBe(false);
  await act(async()=>{gate.resolve();await gate.promise;});
  await screen.findByLabelText("Saved API key");
  expect(h.invoke.mock.calls.filter(c=>c[0]==="save_provider_credential")).toHaveLength(1);
  expect(h.controller.openSaved).toHaveBeenCalledWith("deepseek","deepseek-flash");
  expect(view.container.innerHTML).not.toContain("synthetic-user-input-key");
  expect((screen.getByLabelText("Saved API key") as HTMLInputElement).value).toBe(SAVED_CREDENTIAL_MASK);
 });
 it("distinguishes a saved key from a failed session opening",async()=>{
  const h=harness();h.controller.openSaved.mockRejectedValue(Error("Synthetic native error"));
  h.mount();await screen.findByText("No API key saved");
  fireEvent.change(screen.getByLabelText("API key"),{target:{value:"synthetic-user-input-key"}});
  fireEvent.click(screen.getByRole("button",{name:"Save API key"}));
  await screen.findByText("The key is saved, but this session did not open. Select the model again and retry.");
  expect(screen.getByLabelText("Saved API key")).toBeTruthy();
  expect(screen.queryByText("Saving was not confirmed. Reload the status before trying again; no automatic retry was sent.")).toBeNull();
 });
 it("does not save when native close is unconfirmed",async()=>{
  const h=harness();h.controller.closeAsync.mockRejectedValue(Error("Synthetic close failure"));
  h.mount();await screen.findByText("No API key saved");
  fireEvent.change(screen.getByLabelText("API key"),{target:{value:"synthetic-user-input-key"}});
  fireEvent.click(screen.getByRole("button",{name:"Save API key"}));
  await screen.findByText("Saving was not confirmed. Reload the status before trying again; no automatic retry was sent.");
  expect(h.invoke.mock.calls.some(c=>c[0]==="save_provider_credential")).toBe(false);
  expect(h.controller.openSaved).not.toHaveBeenCalled();
  expect(h.invoke).toHaveBeenCalledTimes(1);
 });
 it("opens replacement empty and binds it to the old captured version",async()=>{
  const h=harness(stored());h.mount();await screen.findByLabelText("Saved API key");
  fireEvent.click(screen.getByRole("button",{name:"Replace API key"}));
  expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
  fireEvent.change(screen.getByLabelText("API key"),{target:{value:"synthetic-replacement-key"}});
  fireEvent.click(screen.getByRole("button",{name:"Save API key"}));
  await screen.findByLabelText("Saved API key");
  const call=h.invoke.mock.calls.find(c=>c[0]==="save_provider_credential");
  expect(call).toBeTruthy();
  expect((call as unknown[])[1]).toEqual({input:{providerId:"deepseek",expectedProviderVersion:providerVersion,expectedCredentialVersion:"synthetic-vault-version-a",credential:"synthetic-replacement-key"}});
 });
 it("deletion closes the old session and removes the fixed mask",async()=>{
  const h=harness(stored());h.mount();await screen.findByLabelText("Saved API key");
  fireEvent.click(screen.getByRole("button",{name:"Delete API key"}));
  await screen.findByText("No API key saved");
  expect(h.controller.closeAsync).toHaveBeenCalledWith("revoked");
  expect(h.invoke.mock.calls.filter(c=>c[0]==="delete_provider_credential")).toHaveLength(1);
  expect(screen.queryByLabelText("Saved API key")).toBeNull();expect(h.controller.openSaved).not.toHaveBeenCalled();
 });
 it("conflict requires an explicit reload and never replays the delete",async()=>{
  const h=harness(stored());
  h.invoke.mockImplementation(async(command:string)=>{if(command==="get_saved_provider_credential")return stored();throw {kind:"credential_conflict",detail:"synthetic-secret"};});
  h.mount();await screen.findByLabelText("Saved API key");
  fireEvent.click(screen.getByRole("button",{name:"Delete API key"}));
  await screen.findByText("The key or provider configuration changed. Reload the status before trying again.");
  expect((screen.getByRole("button",{name:"Delete API key"}) as HTMLButtonElement).disabled).toBe(true);
  expect(h.invoke.mock.calls.filter(c=>c[0]==="get_saved_provider_credential")).toHaveLength(2);
  expect(h.invoke.mock.calls.filter(c=>c[0]==="delete_provider_credential")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button",{name:"Reload key status"}));
  await waitFor(()=>expect(h.invoke.mock.calls.filter(c=>c[0]==="get_saved_provider_credential")).toHaveLength(3));
  expect(h.invoke.mock.calls.filter(c=>c[0]==="delete_provider_credential")).toHaveLength(1);
 });
 it("rejects invalid input and clears it without a native save",async()=>{
  const h=harness();h.mount();await screen.findByText("No API key saved");
  fireEvent.change(screen.getByLabelText("API key"),{target:{value:"with space in key"}});
  fireEvent.click(screen.getByRole("button",{name:"Save API key"}));
  await screen.findByText("The key format is invalid. Check it and enter it again.");
  expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
  expect(h.invoke).toHaveBeenCalledTimes(1);
 });
 it("native unavailable does not fall back to a memory credential form",async()=>{
  const h=harness();render(<I18nProvider store={h.locale}><ProviderSessionSetup provider={h.provider} controller={h.controller as unknown as SafeProviderSession} credentials={createNativeProviderCredentials(null)}/></I18nProvider>);
  await screen.findByText("Secure key storage is unavailable. Keys cannot be saved or read.");
  expect((screen.getByRole("button",{name:"Save API key"}) as HTMLButtonElement).disabled).toBe(true);
  expect(h.controller.openSaved).not.toHaveBeenCalled();expect(screen.queryByRole("checkbox")).toBeNull();
 });
 it("locale changes do not reopen, send or re-read a saved key",async()=>{
  const h=harness(stored());h.mount();await screen.findByLabelText("Saved API key");
  act(()=>h.locale.setLocale("zh-CN"));
  expect(screen.getByLabelText(translate("zh-CN","vault.savedKey"))).toBeTruthy();
  expect(screen.getByRole("button",{name:translate("zh-CN","vault.replace")})).toBeTruthy();
  expect(h.invoke).toHaveBeenCalledTimes(1);expect(h.controller.openSaved).not.toHaveBeenCalled();
 });
 it("a provider change during save cannot open the previous provider session",async()=>{
  const h=harness(),gate=deferred<ReturnType<typeof stored>>();
  h.invoke.mockImplementation(async(command:string)=>command==="save_provider_credential"?gate.promise:absent());
  const view=h.mount();await screen.findByText("No API key saved");
  fireEvent.change(screen.getByLabelText("API key"),{target:{value:"synthetic-user-input-key"}});
  fireEvent.click(screen.getByRole("button",{name:"Save API key"}));
  await waitFor(()=>expect(h.invoke.mock.calls.some(c=>c[0]==="save_provider_credential")).toBe(true));
  view.rerender(<I18nProvider store={h.locale}><ProviderSessionSetup provider={{...h.provider,baseUrl:"https://api.deepseek.com/"}} controller={h.controller as unknown as SafeProviderSession} credentials={h.credentials}/></I18nProvider>);
  await act(async()=>{gate.resolve(stored());await gate.promise;});
  expect(h.controller.openSaved).not.toHaveBeenCalled();
 });
 it("cleanup-pending deletion hides the old mask and disables reuse after readback",async()=>{
  const h=harness(stored());let disabled=false;
  h.invoke.mockImplementation(async(command:string)=>{
   if(command==="get_saved_provider_credential")return disabled?{...absent(),cleanupPending:true}:stored();
   disabled=true;throw {kind:"credential_cleanup_pending"};
  });
  h.mount();await screen.findByLabelText("Saved API key");
  fireEvent.click(screen.getByRole("button",{name:"Delete API key"}));
  await screen.findByText("System cleanup did not finish. This key is disabled for future requests.");
  await waitFor(()=>expect(screen.queryByLabelText("Saved API key")).toBeNull());
  expect(screen.queryByRole("button",{name:"Use saved API key"})).toBeNull();
  expect((screen.getByRole("button",{name:"Save API key"}) as HTMLButtonElement).disabled).toBe(true);
  expect(h.invoke.mock.calls.filter(c=>c[0]==="delete_provider_credential")).toHaveLength(1);
  expect(h.controller.openSaved).not.toHaveBeenCalled();
 });
 it("reopening a cleanup-pending record never offers automatic reuse",async()=>{
  const h=harness({...absent(),cleanupPending:true});h.mount();
  await screen.findByText("API key disabled");
  expect(screen.queryByRole("button",{name:"Use saved API key"})).toBeNull();
  expect(screen.queryByLabelText("Saved API key")).toBeNull();
  expect(h.controller.openSaved).not.toHaveBeenCalled();
 });
 it("failed receipt is not presented as a saved key",async()=>{
  const h=harness();
  h.invoke.mockImplementation(async()=>absent());
  h.mount();await screen.findByText("No API key saved");
  fireEvent.change(screen.getByLabelText("API key"),{target:{value:"synthetic-user-input-key"}});
  fireEvent.click(screen.getByRole("button",{name:"Save API key"}));
  await screen.findByText("Saving was not confirmed. Reload the status before trying again; no automatic retry was sent.");
  expect(screen.queryByLabelText("Saved API key")).toBeNull();expect(h.controller.openSaved).not.toHaveBeenCalled();
 });
});
