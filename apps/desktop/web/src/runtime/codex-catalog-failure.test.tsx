import {beforeAll,afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {I18nProvider,createLocaleStore} from "../i18n";
import {CodexConversation} from "../workspace/CodexConversation";
import {codexCatalogFailure} from "../composer/codex-catalog-error";
import type {NativeInvoke} from "./project-native-adapter";
beforeAll(()=>{
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open", "");};
 HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");this.dispatchEvent(new Event("close"));};
});
afterEach(cleanup);
it("shows the native catalog failure and permits a fresh explicit catalog retry without sending",async()=>{
 let catalogs=0;
 const invoke=vi.fn(async(command:string)=>{
  if(command==="discover_codex")return {executable:"E:/synthetic/codex.exe"};
  if(command==="list_codex_models"){
   if(++catalogs===1)throw "codex_program_directory_unavailable";
   return [{model:"fixture-model",displayName:"Fixture model",description:"fixture",hidden:false,isDefault:true,defaultReasoningEffort:"medium",supportedReasoningEfforts:[{reasoningEffort:"medium",description:"fixture"}]}];
  }
  throw Error(`Unexpected native call: ${command}`);
 });
 render(<I18nProvider store={createLocaleStore({initialLocale:"en",storage:null,eventTarget:null})}><CodexConversation projectId={null} projectTrusted={false} invoke={invoke as NativeInvoke}/></I18nProvider>);
 fireEvent.click(screen.getByText("Official Codex conversation"));
 await waitFor(()=>expect((screen.getByLabelText("Conversation Codex executable") as HTMLInputElement).value).toContain("synthetic"));
 const load=screen.getByRole("button",{name:"Load Conversation Codex models"});fireEvent.click(load);
 expect((await screen.findByRole("alert")).textContent).toContain("codex_program_directory_unavailable");
 expect(screen.getByRole("button",{name:"Review and request send approval"}).matches(":disabled")).toBe(true);
 fireEvent.click(load);await screen.findByRole("option",{name:"Fixture model (fixture-model)"});expect(screen.queryByRole("alert")).toBeNull();
 expect(invoke.mock.calls.map(([c])=>c)).toEqual(["discover_codex","list_codex_models","list_codex_models"]);
});
it("shows only allowlisted diagnostics, never arbitrary native error content",()=>{
 expect(codexCatalogFailure(new Error("codex_reply_timeout private account or path"),false)).toContain("(codex_reply_timeout)");
 expect(codexCatalogFailure("codex_unknown_secret private account or path",true)).toMatch(/\(codex_catalog_failed\)$/);
 expect(codexCatalogFailure("codex_unknown_secret private account or path",true)).not.toContain("private");
 expect(codexCatalogFailure({message:"private account"},false)).not.toContain("private");
});
