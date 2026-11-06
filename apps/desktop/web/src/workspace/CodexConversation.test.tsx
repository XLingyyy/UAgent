import {it,expect,vi,afterEach,beforeAll} from "vitest";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {I18nProvider,createLocaleStore} from "../i18n";
import {CodexConversation} from "./CodexConversation";
beforeAll(()=>{
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open", "");};
 HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");this.dispatchEvent(new Event("close"));};
});
afterEach(cleanup);
const initial={requestId:"request",sessionId:"session",threadId:null,turnId:null,status:"preparing",text:"",persisted:false,error:null};
const models=[{model:"synthetic",displayName:"Synthetic model",description:"fixture",hidden:false,isDefault:true,defaultReasoningEffort:"medium",supportedReasoningEfforts:[{reasoningEffort:"medium",description:"fixture"}]}];
function mount(invoke:any){
 const view=render(<I18nProvider store={createLocaleStore({initialLocale:"en",storage:null,eventTarget:null})}><CodexConversation projectId="project" invoke={invoke}/></I18nProvider>);
 fireEvent.click(screen.getByRole("button",{name:"Official Codex conversation"}));
 return view;
}
async function configure(){
 await waitFor(()=>expect((screen.getByLabelText("Conversation Codex executable") as HTMLInputElement).value).toBe("E:/Codex/codex.exe"));
 fireEvent.click(screen.getByRole("button",{name:"Load Conversation Codex models"}));
 await screen.findByRole("option",{name:"Synthetic model (synthetic)"});
 fireEvent.click(screen.getByRole("button",{name:"Configure Conversation Codex session"}));
 await screen.findByText(/configured; live connection untested/);
}
it("displays streamed final text and links the persisted session without auto-sending",async()=>{
 const invoke=vi.fn(async(c:string)=>{
  if(c==="read_codex_model_preference"||c==="save_codex_model_preference")return null;
  if(c==="discover_codex")return {found:true,executable:"E:/Codex/codex.exe"};
  if(c==="list_codex_models")return models;
  if(c==="list_codex_sessions")return [{sessionId:"session",threadId:"thread",state:"idle"}];
  if(c==="start_codex_turn")return initial;
  if(c==="poll_codex_turn")return {...initial,threadId:"thread",status:"completed",text:"Synthetic reply",persisted:true};
  throw Error(c);
 });
 mount(invoke);await configure();
 expect(invoke.mock.calls.some(([c])=>c==="start_codex_turn")).toBe(false);
 fireEvent.change(screen.getByLabelText("Codex input"),{target:{value:"Synthetic prompt"}});
 fireEvent.click(screen.getByRole("button",{name:"Review and request send approval"}));
 await screen.findByText("Synthetic reply");
 expect(screen.getByText("completed / Archived")).toBeTruthy();
 expect(invoke.mock.calls.filter(([c])=>c==="start_codex_turn")).toHaveLength(1);
});
it("navigation cancels a late-created native turn and never replays it",async()=>{
 let finish!:(v:unknown)=>void;
 const invoke=vi.fn((c:string)=>{
  if(c==="read_codex_model_preference"||c==="save_codex_model_preference"||c==="cancel_codex_turn")return Promise.resolve(null);
  if(c==="discover_codex")return Promise.resolve({found:true,executable:"E:/Codex/codex.exe"});
  if(c==="list_codex_models")return Promise.resolve(models);
  if(c==="list_codex_sessions")return Promise.resolve([]);
  if(c==="start_codex_turn")return new Promise(r=>{finish=r;});
  throw Error(c);
 });
 const view=mount(invoke);await configure();
 fireEvent.change(screen.getByLabelText("Codex input"),{target:{value:"test"}});
 fireEvent.click(screen.getByRole("button",{name:"Review and request send approval"}));
 view.unmount();finish(initial);
 await waitFor(()=>expect(invoke).toHaveBeenCalledWith("cancel_codex_turn",{input:{projectId:"project",requestId:"request"}}));
 expect(invoke.mock.calls.filter(([c])=>c==="start_codex_turn")).toHaveLength(1);
});
