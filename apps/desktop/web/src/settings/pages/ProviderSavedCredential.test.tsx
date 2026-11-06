import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {ProviderSessionSetup} from "./ProviderSessionSetup";
import {I18nProvider,createLocaleStore,translate} from "../../i18n";
import {createSupportedProvider} from "../../provider/runtime-availability";
import {createNativeProviderCredentials,SAVED_CREDENTIAL_MASK,type SavedProviderCredential} from "../../runtime/native-provider-credentials";
import type {NativeInvoke} from "../../runtime/project-native-adapter";
import type {ProviderVersion} from "../../types/provider";
import type {SafeProviderSession} from "../../runtime/safe-provider-session";
const composer=vi.hoisted(()=>({setComposerModel:vi.fn(async()=>undefined)}));
vi.mock("../../stores/ui-store",()=>({useComposerActions:()=>composer}));
vi.mock("../../runtime/safe-provider-session",()=>({safeProviderSession:{}}));
const providerVersion={providerId:"deepseek",generation:"generation-a",revision:1,exists:true};
const absent=():SavedProviderCredential=>({saved:false,version:null,mask:null,providerVersion:{...providerVersion},wireApi:"chat_completions",endpoint:"https://api.deepseek.com/chat/completions"});
const stored=():SavedProviderCredential=>({saved:true,version:"synthetic-vault-version-a",mask:SAVED_CREDENTIAL_MASK,providerVersion:{...providerVersion},wireApi:"chat_completions",endpoint:"https://api.deepseek.com/chat/completions"});
function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function harness(initial:SavedProviderCredential=absent()){
 let receipt=initial;
 const invoke=vi.fn(async(command:string)=>{
  if(command==="get_saved_provider_credential")return receipt;
  if(command==="save_provider_credential"){receipt=stored();return receipt;}
  if(command==="delete_provider_credential"){receipt=absent();return receipt;}
  if(command==="cleanup_provider_credentials"){receipt={...receipt,cleanupPending:false};return receipt;}
  throw Error("Unexpected synthetic command");
 });
 const state={ready:false,providerId:null as string|null,modelId:null as string|null,endpoint:null as string|null,wireApi:null as "chat_completions"|null,fixture:false,canConfigure:true,pendingSetup:false,savedCredential:false};
 const controller={getSnapshot:()=>state,subscribe:()=>()=>undefined,close:vi.fn(),closeAsync:vi.fn(async():Promise<void>=>undefined),enable:vi.fn(),openSaved:vi.fn(async()=>true),openAccount:vi.fn()};
 const credentials=createNativeProviderCredentials(invoke as NativeInvoke);
 const locale=createLocaleStore({initialLocale:"en",storage:null,eventTarget:null});
 const provider=createSupportedProvider();
 const mount=(displayedVersion?:Readonly<ProviderVersion>)=>render(<I18nProvider store={locale}><ProviderSessionSetup provider={provider} providerVersion={displayedVersion} controller={controller as unknown as SafeProviderSession} credentials={credentials}/></I18nProvider>);
 return{invoke,controller,state,credentials,locale,provider,mount,setReceipt:(next:typeof initial)=>{receipt=next;}};
}
afterEach(()=>{cleanup();composer.setComposerModel.mockReset();composer.setComposerModel.mockResolvedValue(undefined);});
describe("saved provider credential form (synthetic only)",()=>{
 it("explicitly switches the production wrapper to a temporary session while retaining a saved key",async()=>{
  const h=harness(stored()),gate=deferred<void>();h.controller.closeAsync.mockReturnValueOnce(gate.promise);h.mount();
  await screen.findByLabelText("Saved API key");
  const temporary=screen.getByRole("radio",{name:"This session only"}) as HTMLInputElement;
  expect((screen.getByRole("radio",{name:"Save key"}) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(temporary);fireEvent.click(temporary);
  expect(temporary.disabled).toBe(true);expect(h.controller.closeAsync).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText("Session API key")).toBeNull();
  await act(async()=>{gate.resolve();await gate.promise;});
  const field=await screen.findByLabelText("Session API key") as HTMLInputElement;
  expect(field.value).toBe("");expect(h.controller.openSaved).not.toHaveBeenCalled();expect(h.controller.openAccount).not.toHaveBeenCalled();
  fireEvent.change(field,{target:{value:"synthetic-manually-entered-key"}});
  fireEvent.click(screen.getByLabelText("Authorize this model session"));
  fireEvent.click(screen.getByRole("button",{name:"Open session and select model"}));
  await waitFor(()=>expect(h.controller.openAccount).toHaveBeenCalledWith("synthetic-manually-entered-key"));
  expect(field.value).toBe("");expect(h.invoke.mock.calls.every(c=>c[0]==="get_saved_provider_credential")).toBe(true);
  fireEvent.click(screen.getByRole("radio",{name:"Save key"}));
  await screen.findByLabelText("Saved API key");expect(h.controller.openSaved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Use saved API key"}));
  await waitFor(()=>expect(h.controller.openSaved).toHaveBeenCalledWith("deepseek","deepseek-flash"));
  expect(h.invoke.mock.calls.every(c=>c[0]==="get_saved_provider_credential")).toBe(true);
 });
 it("keeps the saved form when closing its session fails",async()=>{
  const h=harness(stored());h.controller.closeAsync.mockRejectedValue(Error("synthetic close failed"));h.mount();
  await screen.findByLabelText("Saved API key");fireEvent.click(screen.getByRole("radio",{name:"This session only"}));
  await screen.findByText("The current session could not be closed. The connection mode was not changed. Retry explicitly.");
  expect((screen.getByRole("radio",{name:"Save key"}) as HTMLInputElement).checked).toBe(true);
  expect(screen.queryByLabelText("Session API key")).toBeNull();expect(screen.getByLabelText("Saved API key")).toBeTruthy();
  expect(h.controller.openSaved).not.toHaveBeenCalled();expect(h.controller.openAccount).not.toHaveBeenCalled();
  expect(h.invoke.mock.calls.every(c=>c[0]==="get_saved_provider_credential")).toBe(true);
 });
 it("blocks mode changes while a saved session is opening",async()=>{
  const h=harness(stored()),gate=deferred<boolean>();h.controller.openSaved.mockReturnValue(gate.promise);h.mount();
  await screen.findByLabelText("Saved API key");fireEvent.click(screen.getByRole("button",{name:"Use saved API key"}));
  await waitFor(()=>expect(h.controller.openSaved).toHaveBeenCalledTimes(1));
  const temporary=screen.getByRole("radio",{name:"This session only"}) as HTMLInputElement;
  expect(temporary.disabled).toBe(true);fireEvent.click(temporary);expect(h.controller.closeAsync).not.toHaveBeenCalled();
  await act(async()=>{gate.resolve(true);await gate.promise;});expect(temporary.disabled).toBe(false);
 });
 it.each([false,true])("does not present a session from the other credential mode as ready (saved=%s)",async savedCredential=>{
  const h=harness(stored());Object.assign(h.state,{ready:true,savedCredential,providerId:"deepseek",modelId:"deepseek-flash",endpoint:"https://api.deepseek.com/chat/completions",wireApi:"chat_completions"});h.mount();
  if(savedCredential){await screen.findByLabelText("Saved API key");fireEvent.click(screen.getByRole("radio",{name:"This session only"}));await screen.findByLabelText("Session API key");expect(screen.getByText("Session closed")).toBeTruthy();}
  else {fireEvent.click(screen.getByRole("radio",{name:"Save key"}));await screen.findByLabelText("Saved API key");expect(screen.getByRole("button",{name:"Use saved API key"})).toBeTruthy();}
  expect(screen.queryByText("Session open · connection unverified")).toBeNull();
 });
 it("preserves the active temporary mode when settings are unmounted and reopened",()=>{
  const h=harness(stored());Object.assign(h.state,{ready:true,savedCredential:false,providerId:"deepseek",modelId:"deepseek-flash",endpoint:"https://api.deepseek.com/chat/completions",wireApi:"chat_completions"});
  const view=h.mount();expect((screen.getByRole("radio",{name:"This session only"}) as HTMLInputElement).checked).toBe(true);
  view.unmount();h.mount();
  expect((screen.getByRole("radio",{name:"This session only"}) as HTMLInputElement).checked).toBe(true);
  expect(screen.getByText("Session open · connection unverified")).toBeTruthy();
  expect((screen.getByLabelText("Session API key") as HTMLInputElement).value).toBe("");
  expect(h.controller.closeAsync).not.toHaveBeenCalled();expect(h.controller.close).not.toHaveBeenCalled();
  expect(h.controller.openAccount).not.toHaveBeenCalled();expect(h.controller.openSaved).not.toHaveBeenCalled();expect(h.invoke).not.toHaveBeenCalled();
 });
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
   if(command==="get_saved_provider_credential")return disabled?{...absent(),version:"pending-metadata-token",cleanupPending:true}:stored();
   disabled=true;throw {kind:"credential_cleanup_pending"};
  });
  h.mount();await screen.findByLabelText("Saved API key");
  fireEvent.click(screen.getByRole("button",{name:"Delete API key"}));
  await screen.findByText("Old credential cleanup is still pending. Retry cleanup explicitly; sessions remain closed until it completes.");
  await waitFor(()=>expect(screen.queryByLabelText("Saved API key")).toBeNull());
  expect(screen.queryByRole("button",{name:"Use saved API key"})).toBeNull();
  expect((screen.getByRole("button",{name:"Save API key"}) as HTMLButtonElement).disabled).toBe(true);
  expect(h.invoke.mock.calls.filter(c=>c[0]==="delete_provider_credential")).toHaveLength(1);
  expect(h.controller.openSaved).not.toHaveBeenCalled();
 });
 it("reopening a cleanup-pending record never offers automatic reuse",async()=>{
  const h=harness({...absent(),version:"pending-metadata-token",cleanupPending:true});h.mount();
  await screen.findByText("API key disabled");
  expect(screen.queryByRole("button",{name:"Use saved API key"})).toBeNull();
  expect(screen.queryByLabelText("Saved API key")).toBeNull();
  expect(h.controller.openSaved).not.toHaveBeenCalled();
 });
 it.each([
  ["missing","The saved key is missing from system storage."],
  ["corrupt","The saved key record is damaged."],
  ["unavailable","This key is temporarily unavailable."],
 ] as const)("renders disabled %s recovery and waits for an explicit user action",async(recovery,message)=>{
  const h=harness({...absent(),version:"active-metadata-token",recovery});h.mount();
  await screen.findByText(message);
  expect(screen.queryByLabelText("API key")).toBeNull();
  expect(screen.queryByRole("button",{name:"Save API key"})).toBeNull();
  expect(screen.queryByLabelText("Saved API key")).toBeNull();
  expect(screen.queryByRole("button",{name:"Use saved API key"})).toBeNull();
  expect(screen.getByRole("button",{name:"Replace API key"})).toBeTruthy();
  expect(screen.getByRole("button",{name:"Remove unavailable record"})).toBeTruthy();
  expect(h.invoke).toHaveBeenCalledTimes(1);expect(h.controller.openSaved).not.toHaveBeenCalled();
 });
 it.each(["missing","corrupt","unavailable"] as const)("replaces %s only after a user click and saves the captured token",async recovery=>{
  const h=harness({...absent(),version:"active-metadata-token",recovery});h.mount();
  await screen.findByRole("button",{name:"Replace API key"});
  fireEvent.click(screen.getByRole("button",{name:"Replace API key"}));
  expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
  expect(h.invoke).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText("API key"),{target:{value:"synthetic-recovery-replacement"}});
  fireEvent.click(screen.getByRole("button",{name:"Save API key"}));
  await screen.findByLabelText("Saved API key");
  expect(h.controller.closeAsync).toHaveBeenCalledWith("revoked");
  const call=h.invoke.mock.calls.find(c=>c[0]==="save_provider_credential");
  expect((call as unknown[])[1]).toEqual({input:{providerId:"deepseek",expectedProviderVersion:providerVersion,expectedCredentialVersion:"active-metadata-token",credential:"synthetic-recovery-replacement"}});
  expect(h.invoke.mock.calls.filter(c=>c[0]==="save_provider_credential")).toHaveLength(1);
  expect(h.controller.openSaved).toHaveBeenCalledTimes(1);
 });
 it("explicitly removing an unavailable record keeps it disabled and does not open a session",async()=>{
  const h=harness({...absent(),version:"active-metadata-token",recovery:"unavailable"});h.mount();
  await screen.findByRole("button",{name:"Remove unavailable record"});
  fireEvent.click(screen.getByRole("button",{name:"Remove unavailable record"}));
  await screen.findByText("No API key saved");
  expect(h.invoke.mock.calls.filter(c=>c[0]==="delete_provider_credential")).toHaveLength(1);
  expect(h.controller.openSaved).not.toHaveBeenCalled();
  expect(h.invoke.mock.calls.some(c=>c[0]==="save_provider_credential")).toBe(false);
 });
 it("stale recovery CAS is read back but never automatically replayed",async()=>{
  const initial={...absent(),version:"old-active-token",recovery:"missing" as const},h=harness(initial);let stale=false;
  h.invoke.mockImplementation(async(command:string)=>{
   if(command==="get_saved_provider_credential")return stale?{...initial,version:"new-token",providerVersion:{...providerVersion,revision:2}}:initial;
   stale=true;throw {kind:"credential_conflict"};
  });
  h.mount();await screen.findByRole("button",{name:"Remove unavailable record"});
  fireEvent.click(screen.getByRole("button",{name:"Remove unavailable record"}));
  await screen.findByText("The key or provider configuration changed. Reload the status before trying again.");
  expect((screen.getByRole("button",{name:"Replace API key"}) as HTMLButtonElement).disabled).toBe(true);
  expect(h.invoke.mock.calls.filter(c=>c[0]==="delete_provider_credential")).toHaveLength(1);
  expect(h.invoke.mock.calls.filter(c=>c[0]==="get_saved_provider_credential")).toHaveLength(2);
  const call=h.invoke.mock.calls.find(c=>c[0]==="delete_provider_credential");
  expect((call as unknown[])[1]).toEqual({input:{providerId:"deepseek",expectedProviderVersion:providerVersion,expectedCredentialVersion:"old-active-token"}});
 });
 it("endpoint changes during recovery save cannot open or replay the old intent",async()=>{
  const initial={...absent(),version:"old-active-token",recovery:"corrupt" as const},h=harness(initial),gate=deferred<SavedProviderCredential>();let changed=false;
  h.invoke.mockImplementation(async(command:string)=>command==="save_provider_credential"?gate.promise:changed?{...initial,version:"new-token",providerVersion:{...providerVersion,revision:2}}:initial);
  const view=h.mount();await screen.findByRole("button",{name:"Replace API key"});
  fireEvent.click(screen.getByRole("button",{name:"Replace API key"}));
  fireEvent.change(screen.getByLabelText("API key"),{target:{value:"synthetic-recovery-replacement"}});
  fireEvent.click(screen.getByRole("button",{name:"Save API key"}));
  await waitFor(()=>expect(h.invoke.mock.calls.some(c=>c[0]==="save_provider_credential")).toBe(true));
  changed=true;
  view.rerender(<I18nProvider store={h.locale}><ProviderSessionSetup provider={{...h.provider,baseUrl:"https://api.deepseek.com/"}} controller={h.controller as unknown as SafeProviderSession} credentials={h.credentials}/></I18nProvider>);
  await act(async()=>{gate.reject({kind:"credential_conflict"});await gate.promise.catch(()=>undefined);});
  expect(h.controller.openSaved).not.toHaveBeenCalled();
  expect(h.invoke.mock.calls.filter(c=>c[0]==="save_provider_credential")).toHaveLength(1);
  const oldCall=h.invoke.mock.calls.find(c=>c[0]==="save_provider_credential");
  expect((oldCall as unknown[])[1]).toEqual({input:{providerId:"deepseek",expectedProviderVersion:providerVersion,expectedCredentialVersion:"old-active-token",credential:"synthetic-recovery-replacement"}});
  expect(screen.queryByLabelText("Saved API key")).toBeNull();
 });
 it("failed recovery removal reads back disabled cleanup-pending instead of claiming success",async()=>{
  const h=harness({...absent(),version:"active-metadata-token",recovery:"corrupt"});let disabled=false;
  h.invoke.mockImplementation(async(command:string)=>{
   if(command==="get_saved_provider_credential")return disabled?{...absent(),version:"disabled-tombstone",cleanupPending:true,recovery:null}:{...absent(),version:"active-metadata-token",recovery:"corrupt"};
   disabled=true;throw {kind:"credential_cleanup_pending"};
  });
  h.mount();await screen.findByRole("button",{name:"Remove unavailable record"});
  fireEvent.click(screen.getByRole("button",{name:"Remove unavailable record"}));
  await screen.findByText("Old credential cleanup is still pending. Retry cleanup explicitly; sessions remain closed until it completes.");
  expect(screen.queryByRole("button",{name:"Use saved API key"})).toBeNull();
  expect(screen.queryByRole("button",{name:"Remove unavailable record"})).toBeNull();
  expect((screen.getByRole("button",{name:"Save API key"}) as HTMLButtonElement).disabled).toBe(true);
  expect(h.invoke.mock.calls.filter(c=>c[0]==="delete_provider_credential")).toHaveLength(1);
 });
 it("a native route for another endpoint cannot be adopted into the displayed provider",async()=>{
  const h=harness({...absent(),version:"active-metadata-token",recovery:"missing",wireApi:"responses",endpoint:"https://api.openai.com/v1/responses"});h.mount(providerVersion);
  await screen.findByText("The key or provider configuration changed. Reload the status before trying again.");
  expect(screen.queryByRole("button",{name:"Replace API key"})).toBeNull();
  expect(screen.queryByRole("button",{name:"Remove unavailable record"})).toBeNull();
  expect(h.invoke).toHaveBeenCalledTimes(1);expect(h.controller.openSaved).not.toHaveBeenCalled();
 });
 it("a changed generation or revision cannot silently refresh the displayed recovery CAS token",async()=>{
  const h=harness({...absent(),version:"new-active-token",recovery:"corrupt",providerVersion:{...providerVersion,generation:"different-generation",revision:2}});h.mount(providerVersion);
  await screen.findByText("The key or provider configuration changed. Reload the status before trying again.");
  expect(screen.queryByRole("button",{name:"Replace API key"})).toBeNull();
  expect((screen.getByRole("button",{name:"Save API key"}) as HTMLButtonElement).disabled).toBe(true);
  expect(h.invoke).toHaveBeenCalledTimes(1);
 });
 it("unreadable metadata offers only a read-only refresh and never fabricates a recovery token",async()=>{
  const h=harness();h.invoke.mockImplementation(async()=>{throw Error("metadata unavailable");});h.mount();
  await screen.findByText("Secure key storage is unavailable. Keys cannot be saved or read.");
  expect(screen.getByText("Key status is temporarily unavailable.")).toBeTruthy();
  expect(screen.queryByText("No API key saved")).toBeNull();
  expect(screen.queryByRole("button",{name:"Replace API key"})).toBeNull();
  expect(screen.queryByRole("button",{name:"Remove unavailable record"})).toBeNull();
  expect((screen.getByRole("button",{name:"Save API key"}) as HTMLButtonElement).disabled).toBe(true);
  expect(h.controller.openSaved).not.toHaveBeenCalled();expect(h.invoke).toHaveBeenCalledTimes(1);
 });
 it("active plus pending preserves the mask and waits for explicit cleanup after closing the owner",async()=>{
  const h=harness({...stored(),cleanupPending:true}),gate=deferred<void>();h.controller.closeAsync.mockReturnValue(gate.promise);h.mount();
  await screen.findByText("New API key saved · old records await cleanup");
  expect((screen.getByLabelText("Saved API key") as HTMLInputElement).value).toBe(SAVED_CREDENTIAL_MASK);
  expect(screen.queryByRole("button",{name:"Use saved API key"})).toBeNull();
  expect((screen.getByRole("button",{name:"Replace API key"}) as HTMLButtonElement).disabled).toBe(true);
  expect(h.controller.openSaved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Retry cleanup"}));
  expect(h.invoke.mock.calls.some(c=>c[0]==="cleanup_provider_credentials")).toBe(false);
  await act(async()=>{gate.resolve();await gate.promise;});
  await waitFor(()=>expect(screen.queryByRole("button",{name:"Retry cleanup"})).toBeNull());
  expect(h.invoke.mock.calls.filter(c=>c[0]==="cleanup_provider_credentials")).toHaveLength(1);
  expect((screen.getByRole("button",{name:"Use saved API key"}) as HTMLButtonElement).disabled).toBe(false);
  expect(h.controller.openSaved).not.toHaveBeenCalled();
 });
 it.each(["missing","corrupt","unavailable"] as const)("recovery %s plus pending preserves its reason and requires cleanup before recovery",async recovery=>{
  const h=harness({...absent(),version:"recovery-token",recovery,cleanupPending:true});h.mount();
  const messages={missing:"The saved key is missing from system storage.",corrupt:"The saved key record is damaged.",unavailable:"This key is temporarily unavailable."};
  await screen.findByText(messages[recovery]);
  expect(screen.getByText("Clean up old credential records before opening a session, replacing or deleting a key.")).toBeTruthy();
  expect((screen.getByRole("button",{name:"Replace API key"}) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button",{name:"Remove unavailable record"}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button",{name:"Retry cleanup"}));
  await waitFor(()=>expect(screen.queryByRole("button",{name:"Retry cleanup"})).toBeNull());
  expect((screen.getByRole("button",{name:"Replace API key"}) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByRole("button",{name:"Use saved API key"})).toBeNull();
  expect(screen.queryByLabelText("Saved API key")).toBeNull();expect(h.controller.openSaved).not.toHaveBeenCalled();
 });
 it("inactive pending returns to an empty form after explicit cleanup",async()=>{
  const h=harness({...absent(),version:"inactive-token",cleanupPending:true});h.mount();
  await screen.findByText("API key disabled");
  fireEvent.click(screen.getByRole("button",{name:"Retry cleanup"}));
  await screen.findByText("No API key saved");
  expect((screen.getByLabelText("API key") as HTMLInputElement).disabled).toBe(false);
  expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
  expect(h.controller.openSaved).not.toHaveBeenCalled();
 });
 it("a successful save with active pending is persisted but never opens a session",async()=>{
  const h=harness();let committed=false;
  h.invoke.mockImplementation(async(command:string)=>{if(command==="save_provider_credential"){committed=true;return{...stored(),cleanupPending:true};}return committed?{...stored(),cleanupPending:true}:absent();});
  h.mount();await screen.findByText("No API key saved");
  fireEvent.change(screen.getByLabelText("API key"),{target:{value:"synthetic-new-valid-key"}});
  fireEvent.click(screen.getByRole("button",{name:"Save API key"}));
  await screen.findByText("New API key saved · old records await cleanup");
  expect(screen.getByLabelText("Saved API key")).toBeTruthy();
  expect((screen.getByRole("button",{name:"Retry cleanup"}) as HTMLButtonElement).disabled).toBe(false);
  expect(h.controller.openSaved).not.toHaveBeenCalled();
  expect(screen.queryByRole("button",{name:"Use saved API key"})).toBeNull();
 });
 it("partial cleanup adopts the fresh tombstone token only for a second explicit retry",async()=>{
  const h=harness();let tries=0;
  h.invoke.mockImplementation(async(command:string)=>{
   if(command==="cleanup_provider_credentials"){tries++;return{...absent(),version:tries===1?"partial-token-2":"clean-token-3",cleanupPending:tries===1};}
   return{...absent(),version:tries?"partial-token-2":"pending-token-1",cleanupPending:true};
  });
  h.mount();await screen.findByRole("button",{name:"Retry cleanup"});
  fireEvent.click(screen.getByRole("button",{name:"Retry cleanup"}));
  await screen.findByText("Old credential cleanup is still pending. Retry cleanup explicitly; sessions remain closed until it completes.");
  await waitFor(()=>expect(h.invoke.mock.calls.filter(c=>c[0]==="get_saved_provider_credential")).toHaveLength(2));
  expect(h.invoke.mock.calls.filter(c=>c[0]==="cleanup_provider_credentials")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button",{name:"Retry cleanup"}));
  await screen.findByText("No API key saved");
  const calls=h.invoke.mock.calls.filter(c=>c[0]==="cleanup_provider_credentials") as unknown[][];
  expect(calls).toHaveLength(2);
  expect(calls[0][1]).toEqual({input:{providerId:"deepseek",expectedProviderVersion:providerVersion,expectedCredentialVersion:"pending-token-1"}});
  expect(calls[1][1]).toEqual({input:{providerId:"deepseek",expectedProviderVersion:providerVersion,expectedCredentialVersion:"partial-token-2"}});
  expect((screen.getByLabelText("API key") as HTMLInputElement).disabled).toBe(false);
  expect(h.controller.openSaved).not.toHaveBeenCalled();
 });
 it("cleanup conflicts keep the mutation review barrier but permit an explicit fresh-token cleanup retry",async()=>{
  const h=harness();let tries=0;
  h.invoke.mockImplementation(async(command:string)=>{
   if(command==="cleanup_provider_credentials"){if(tries++===0)throw{kind:"credential_conflict"};return{...stored(),version:"fresh-token",cleanupPending:false};}
   return{...stored(),version:tries?"fresh-token":"old-token",cleanupPending:tries<2};
  });
  h.mount(providerVersion);await screen.findByRole("button",{name:"Retry cleanup"});
  fireEvent.click(screen.getByRole("button",{name:"Retry cleanup"}));
  await screen.findByText("The key or provider configuration changed. Reload the status before trying again.");
  expect((screen.getByRole("button",{name:"Retry cleanup"}) as HTMLButtonElement).disabled).toBe(false);
  expect(h.invoke.mock.calls.filter(c=>c[0]==="cleanup_provider_credentials")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button",{name:"Retry cleanup"}));
  await waitFor(()=>expect(screen.queryByRole("button",{name:"Retry cleanup"})).toBeNull());
  expect((screen.getByRole("button",{name:"Replace API key"}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button",{name:"Reload key status"}));
  await waitFor(()=>expect((screen.getByRole("button",{name:"Replace API key"}) as HTMLButtonElement).disabled).toBe(false));
  expect(h.invoke.mock.calls.filter(c=>c[0]==="cleanup_provider_credentials")).toHaveLength(2);
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
