import {beforeAll,afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {I18nProvider,createLocaleStore} from "../i18n";
import {CodexConversation} from "../workspace/CodexConversation";
import {UIProvider} from "../app/providers";
import {LeftSidebar} from "../sidebar/LeftSidebar";
import {useSettingsStore} from "../stores/ui-store";
import type {NativeInvoke} from "./project-native-adapter";
beforeAll(()=>{
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open", "");};
 HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");this.dispatchEvent(new Event("close"));};
});
afterEach(cleanup);
const models=[{model:"synthetic-model",displayName:"Synthetic model",description:"fixture",hidden:false,isDefault:true,defaultReasoningEffort:"medium",supportedReasoningEfforts:[{reasoningEffort:"medium",description:"fixture"}]}];
function mockInvoke(){return vi.fn(async(command:string)=>{if(command==="discover_codex")return {executable:"E:/synthetic/codex.exe"};if(command==="list_codex_models")return models;throw Error(`Unexpected native call: ${command}`);});}
function show(projectId:string|null,projectTrusted:boolean){const invoke=mockInvoke(),setup=vi.fn();render(<I18nProvider store={createLocaleStore({initialLocale:"en",storage:null,eventTarget:null})}><CodexConversation projectId={projectId} projectTrusted={projectTrusted} onProjectSetup={setup} invoke={invoke as NativeInvoke}/></I18nProvider>);fireEvent.click(screen.getByText("Official Codex conversation"));return {invoke,setup};}
it("first launch allows catalog browsing and drafting, explains the project prerequisite and never sends",async()=>{
 const {invoke,setup}=show(null,false);await waitFor(()=>expect((screen.getByLabelText("Conversation Codex executable") as HTMLInputElement).value).toContain("synthetic"));
 const load=screen.getByRole("button",{name:"Load Conversation Codex models"});expect(load.matches(":disabled")).toBe(false);fireEvent.click(load);await screen.findByRole("option",{name:"Synthetic model (synthetic-model)"});
 const input=screen.getByLabelText("Codex input");expect(input.matches(":disabled")).toBe(false);fireEvent.change(input,{target:{value:"draft only"}});expect((input as HTMLTextAreaElement).value).toBe("draft only");
 expect(screen.getByRole("button",{name:"Review and request send approval"}).matches(":disabled")).toBe(true);expect(screen.getByRole("button",{name:"Configure Conversation Codex session"}).matches(":disabled")).toBe(true);
 fireEvent.click(screen.getByRole("button",{name:"Set up project"}));expect(setup).toHaveBeenCalledOnce();expect(invoke.mock.calls.map(([c])=>c)).toEqual(["discover_codex","list_codex_models"]);
});
it("a restored untrusted project can browse models but cannot configure, load private history or send",async()=>{
 const {invoke}=show("restored-project",false);await waitFor(()=>expect((screen.getByLabelText("Conversation Codex executable") as HTMLInputElement).value).toContain("synthetic"));
 fireEvent.click(screen.getByRole("button",{name:"Load Conversation Codex models"}));await screen.findByRole("option",{name:"Synthetic model (synthetic-model)"});
 expect(screen.getByLabelText("Codex conversation").matches(":disabled")).toBe(true);expect(screen.getByRole("button",{name:"Configure Conversation Codex session"}).matches(":disabled")).toBe(true);expect(invoke.mock.calls.map(([c])=>c)).toEqual(["discover_codex","list_codex_models"]);
});
function SettingsProbe(){const state=useSettingsStore(s=>s);return <output data-testid="settings-state">{String(state.open)}:{state.activePageId}</output>;}
it("the real sidebar opens project configuration instead of an inert project button",()=>{
 render(<UIProvider><LeftSidebar/><SettingsProbe/></UIProvider>);fireEvent.click(screen.getByRole("button",{name:/Add or manage projects|\u6dfb\u52a0\u6216\u7ba1\u7406\u5de5\u7a0b/}));expect(screen.getByTestId("settings-state").textContent).toBe("true:config");
});

it("keeps the Codex draft and model fields mounted when its panel closes",async()=>{
 const {invoke}=show(null,false);
 await waitFor(()=>expect((screen.getByLabelText("Conversation Codex executable") as HTMLInputElement).value).toContain("synthetic"));
 const input=screen.getByLabelText("Codex input");
 fireEvent.change(input,{target:{value:"keep this draft"}});
 fireEvent.click(screen.getByRole("button",{name:"Close Codex conversation panel"}));
 expect(screen.queryByRole("dialog")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"Official Codex conversation"}));
 expect(screen.getByLabelText("Codex input")).toBe(input);
 expect((input as HTMLTextAreaElement).value).toBe("keep this draft");
 expect(invoke.mock.calls.map(([c])=>c)).toEqual(["discover_codex"]);
});
