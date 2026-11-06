import {beforeAll,expect,it} from "vitest";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {CodexConversation} from "../workspace/CodexConversation";
import {I18nProvider,createLocaleStore} from "../i18n";
import type {NativeInvoke} from "./project-native-adapter";
beforeAll(()=>{
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open", "");};
 HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");this.dispatchEvent(new Event("close"));};
});
it("standalone uses official catalog/effort and resumes an old linked conversation without changing its identity",async()=>{
 const starts:any[]=[];const saved:any[]=[];const invoke=(async(command:string,payload:any)=>{const i=payload?.input;
 if(command==="read_codex_model_preference"){expect(i.slot).toBe("conversation");return null;}
 if(command==="save_codex_model_preference"){saved.push(i);return;}
 if(command==="discover_codex")return {executable:"E:/synthetic/codex.exe"};
 if(command==="list_codex_models")return [{model:"mock-official",displayName:"Mock official",description:"mock",hidden:false,isDefault:true,defaultReasoningEffort:"balanced",supportedReasoningEfforts:[{reasoningEffort:"balanced",description:"mock"},{reasoningEffort:"deep",description:"mock"}]}];
 if(command==="list_codex_sessions")return [{sessionId:"old-session",threadId:"old-thread",state:"idle"},{sessionId:"member-session",threadId:"m",state:"idle",memberId:"reviewer"}];
 if(command==="start_codex_turn"){starts.push(i);return {requestId:"request",sessionId:i.sessionId,threadId:"old-thread",turnId:"turn",status:"preparing",text:"",persisted:false,error:null};}
 if(command==="poll_codex_turn")return {requestId:"request",sessionId:"old-session",threadId:"old-thread",turnId:"turn",status:"completed",text:"synthetic reply",persisted:true,error:null};
 if(command==="cancel_codex_turn")return;throw Error(command);
 }) as NativeInvoke;
 try{render(<I18nProvider store={createLocaleStore({initialLocale:"en",storage:null,eventTarget:null})}><CodexConversation projectId="synthetic" invoke={invoke}/></I18nProvider>);
 fireEvent.click(screen.getByText("Official Codex conversation"));await waitFor(()=>expect((screen.getByLabelText("Conversation Codex executable") as HTMLInputElement).value).toContain("synthetic"));
 fireEvent.click(screen.getByRole("button",{name:"Load Conversation Codex models"}));await screen.findByRole("option",{name:"Mock official (mock-official)"});fireEvent.change(screen.getByLabelText("Conversation Codex reasoning effort"),{target:{value:"deep"}});fireEvent.click(screen.getByRole("button",{name:"Configure Conversation Codex session"}));await waitFor(()=>expect(saved).toHaveLength(1));
 fireEvent.change(screen.getByLabelText("Codex conversation"),{target:{value:"old-session"}});expect((screen.getByRole("option",{name:/member-session/}) as HTMLOptionElement).disabled).toBe(true);
 fireEvent.change(screen.getByLabelText("Codex input"),{target:{value:"synthetic question"}});fireEvent.click(screen.getByRole("button",{name:"Review and request send approval"}));await screen.findByText("synthetic reply");
 expect(starts).toHaveLength(1);expect(starts[0]).toMatchObject({sessionId:"old-session",model:"mock-official",effort:"deep",prompt:"synthetic question"});expect(starts[0].member).toBeUndefined();expect(saved[0].slot).toBe("conversation");
 }finally{cleanup();}
});
