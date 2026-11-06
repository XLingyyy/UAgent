import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createOutboundConsentGate,boundConversationHistory,DEEPSEEK_MODEL} from "@uagent/runtime";
import type {TaskDraft,TaskEvent,TaskRecord} from "@uagent/shared";
import {createSafeProviderSession,safeProviderSession} from "./safe-provider-session";
import {createDesktopRuntimeAdapter} from "./desktop-runtime-adapter";
import {createAttachmentStore} from "./attachment-store";
import {conversationTasks,completedConversationHistory} from "./conversation-context";
import {UIProvider} from "../stores/ui-store";
import {ConversationViewport} from "../workspace/ConversationViewport";
import {ComposerDock} from "../composer/ComposerDock";
import {OutboundRequestReview} from "../settings/pages/OutboundRequestReview";
import {I18nProvider,createLocaleStore,localizeText} from "../i18n";
import {createSupportedProvider} from "../provider/runtime-availability";

const managers:ReturnType<typeof createSafeProviderSession>[]=[];
beforeEach(()=>{
 Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,value:vi.fn(function(this:HTMLDialogElement){this.setAttribute("open","");})});
 Object.defineProperty(HTMLDialogElement.prototype,"close",{configurable:true,value:vi.fn(function(this:HTMLDialogElement){this.removeAttribute("open");})});
});
afterEach(()=>{cleanup();managers.splice(0).forEach(m=>m.dispose());safeProviderSession.close("cleared");vi.unstubAllGlobals();vi.restoreAllMocks();});
async function mount(ordinary=false,savedRun?:TaskDraft["savedRun"]){
 vi.stubGlobal("fetch",vi.fn(()=>{throw Error("REAL NETWORK FORBIDDEN");}));
 const streams:ReadableStreamDefaultController<Uint8Array>[]=[],sent:string[]=[];
 const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{sent.push(String(init?.body));return new Response(new ReadableStream<Uint8Array>({start(c){streams.push(c);}}),{headers:{"Content-Type":"text/event-stream"}});});
 const gate=createOutboundConsentGate(),manager=createSafeProviderSession({mode:"live",liveAuthorized:true,fetcher,gate,attachments:createAttachmentStore()});managers.push(manager);
 const runtime=createDesktopRuntimeAdapter({nativeInvoke:null,providerAdapter:manager.adapter,providerEnabled:true,...(ordinary?{captureOrdinarySend:(draft:TaskDraft,current:()=>boolean)=>{manager.updateContext(draft.projectId,draft.input,JSON.stringify([draft.providerId,draft.modelId]),draft.conversationId);return manager.captureOrdinarySend(draft,current);}}:{})});const locale=createLocaleStore({initialLocale:"en",storage:null,eventTarget:null});
 const view=render(<I18nProvider store={locale}><UIProvider runtimeClient={runtime} initialState={{provider:{providers:[createSupportedProvider()]},composer:{selectedModelId:JSON.stringify(["deepseek",DEEPSEEK_MODEL]),...(savedRun?{savedRun}:{})}}}><div className="ua-app"><ConversationViewport/><ComposerDock/></div><OutboundRequestReview gate={gate}/></UIProvider></I18nProvider>);
 act(()=>{safeProviderSession.enable();safeProviderSession.openAccount("synthetic-ui-test-only");manager.openAccount("synthetic-transport-key");});
 await act(async()=>{await Promise.resolve();});
 const input=()=>screen.getByRole("textbox",{name:localizeText(locale.getSnapshot(),"Composer input")}) as HTMLTextAreaElement;
 async function send(text:string){fireEvent.change(input(),{target:{value:text}});fireEvent.click(screen.getByRole("button",{name:localizeText(locale.getSnapshot(),"Send task")}));await waitFor(()=>expect(gate.getPending()).not.toBeNull());return gate.getPending()!;}
 async function approve(){const count=streams.length;fireEvent.click(screen.getByRole("button",{name:"Confirm this request once"}));await waitFor(()=>expect(streams.length).toBe(count+1));}
 async function delta(text:string){await act(async()=>{streams.at(-1)!.enqueue(new TextEncoder().encode('data: '+JSON.stringify({model:DEEPSEEK_MODEL,choices:[{delta:{content:text}}]})+'\n\n'));await Promise.resolve();});}
 async function done(){await act(async()=>{streams.at(-1)!.enqueue(new TextEncoder().encode('data: '+JSON.stringify({model:DEEPSEEK_MODEL,choices:[{delta:{},finish_reason:"stop"}],usage:{prompt_tokens:10,completion_tokens:8,total_tokens:18}})+'\n\ndata: [DONE]\n\n'));streams.at(-1)!.close();});await waitFor(()=>expect(input().value).toBe(""));}
 async function reject(){await act(async()=>{gate.invalidate();await Promise.resolve();});await waitFor(()=>expect(document.querySelector(".ua-composer__send-btn")?.textContent).toBe(localizeText(locale.getSnapshot(),"Send task")));}
 return{...view,manager,runtime,gate,fetcher,sent,streams,input,send,approve,delta,done,reject,locale};
}
describe("multi-turn conversation and incremental text without real API",()=>{
 it("shows terminal history uncertainty in both languages without resending or reusing the turn",async()=>{
  const h=await mount(true);vi.spyOn(h.manager.adapter,"confirmOrdinaryDelivery").mockRejectedValue(Error("synthetic archive acknowledgement loss"));
  fireEvent.change(h.input(),{target:{value:"One ordinary delivered reply"}});
  fireEvent.click(screen.getByRole("button",{name:"Send task"}));
  await waitFor(()=>expect(h.sent).toHaveLength(1));await h.delta("Visible received answer");await h.done();
  expect(screen.getByText(/history confirmation result is unknown/)).toBeTruthy();
  const snapshot=h.runtime.getSnapshot(),task=snapshot.tasksById[snapshot.activeTaskId!];
  expect(task.state).toBe("completed");expect(completedConversationHistory([task],snapshot.eventsByTaskId)).toEqual([]);
  act(()=>h.locale.setLocale("zh-CN"));
  expect(screen.getByText(/历史确认结果未知/)).toBeTruthy();
  expect(document.querySelector(".ua-chat-message--assistant")?.textContent).toContain("Visible received answer");
  expect(h.sent).toHaveLength(1);expect(h.gate.getPending()).toBeNull();
 });

 it.each(["provider","model"])("refuses restored discussion text with a different %s origin before any send",async(kind)=>{
  const savedRun:NonNullable<TaskDraft["savedRun"]>={taskMode:"discussion",logicalProjectId:null,
   parentRunId:"archive",projectId:"chat:local",conversationId:"restored",includeCompletedContext:true,completed:true,
   hasUnresolvedEffects:false,providerId:kind==="provider"?"foreign-provider":"deepseek",
   modelId:kind==="model"?"foreign-model":DEEPSEEK_MODEL,messages:[{role:"user",content:"Old question"},{role:"assistant",content:"Old answer"}]};
  const h=await mount(true,savedRun);fireEvent.change(h.input(),{target:{value:"New question"}});
  fireEvent.click(screen.getByRole("button",{name:"Send task"}));
  await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain("belongs to another provider or model"));
  expect(h.fetcher).not.toHaveBeenCalled();expect(h.gate.getPending()).toBeNull();expect(h.input().value).toBe("New question");
 });


 it("restores explicitly selected complete text under the same model using only a fresh send intent",async()=>{
  const answer="Archived full text. ".repeat(180),savedRun:NonNullable<TaskDraft["savedRun"]>={taskMode:"discussion",logicalProjectId:null,
   parentRunId:"old-data-only-record",projectId:"chat:local",conversationId:"fresh-conversation",includeCompletedContext:true,completed:true,
   hasUnresolvedEffects:false,providerId:"deepseek",modelId:DEEPSEEK_MODEL,messages:[{role:"user",content:"Archived question"},{role:"assistant",content:answer}]};
  const h=await mount(true,savedRun);fireEvent.change(h.input(),{target:{value:"Continue with selected text."}});
  fireEvent.click(screen.getByRole("button",{name:"Send task"}));await waitFor(()=>expect(h.sent).toHaveLength(1));
  const body=JSON.parse(h.sent[0]);expect(body.messages[2]).toEqual({role:"user",content:"Archived question"});expect(body.messages[3]).toEqual({role:"assistant",content:answer});
  expect(h.sent[0]).not.toContain("old-data-only-record");expect(h.gate.getPending()).toBeNull();
  await h.delta("Fresh complete answer.");await h.done();
 });

 it("ordinary send starts once without a dialog and details remain independent while streaming, switching language and stopping",async()=>{
  const h=await mount(true);
  fireEvent.change(h.input(),{target:{value:"Remember ordinary blue."}});
  const send=screen.getByRole("button",{name:"Send task"});
  fireEvent.click(send);fireEvent.click(send);
  await waitFor(()=>expect(h.sent).toHaveLength(1));
  expect(h.gate.getPending()).toBeNull();expect(screen.queryByRole("button",{name:"Confirm this request once"})).toBeNull();
  await h.delta("Ordinary answer ");
  const assistant=document.querySelector(".ua-chat-message--assistant");
  fireEvent.click(screen.getByRole("button",{name:"View run details"}));
  const panel=screen.getByRole("region",{name:"Run details"}),details=screen.getByLabelText("Run events");
  const list=document.querySelector(".ua-chat-list") as HTMLElement;
  Object.defineProperty(list,"scrollHeight",{value:900,configurable:true});list.scrollTop=17;details.scrollTop=31;
  await h.delta("continues.");
  expect(document.querySelector(".ua-chat-message--assistant")).toBe(assistant);
  expect(assistant?.textContent).toContain("Ordinary answer continues.");
  expect(panel.textContent).not.toContain("Ordinary answer");
  expect(screen.getByRole("region",{name:"Run details"})).toBe(panel);
  expect(details.scrollTop).toBe(31);expect(list.scrollTop).toBe(17);
  act(()=>h.locale.setLocale("zh-CN"));expect(h.sent).toHaveLength(1);
  expect(screen.getByRole("region",{name:"运行详情"})).toBe(panel);expect(details.scrollTop).toBe(31);
  act(()=>h.locale.setLocale("en"));
  await h.done();
  expect(h.runtime.getSnapshot().eventsByTaskId[h.runtime.getSnapshot().activeTaskId!].some(e=>e.type==="provider_stream_delta"&&e.body==="Ordinary answer ")).toBe(true);
  fireEvent.click(screen.getByRole("button",{name:"Close run details"}));
  fireEvent.change(h.input(),{target:{value:"Second ordinary question."}});fireEvent.click(screen.getByRole("button",{name:"Send task"}));
  await waitFor(()=>expect(h.sent).toHaveLength(2));
  expect(h.gate.getPending()).toBeNull();
  const body=JSON.parse(h.sent[1]);expect(body.messages[3].content).toBe("Ordinary answer continues.");
  await h.delta("Incomplete second answer");
  fireEvent.click(screen.getAllByRole("button",{name:"View run details"}).at(-1)!);
  const stoppedPanel=screen.getByRole("region",{name:"Run details"});
  fireEvent.click(screen.getByRole("button",{name:"Stop task"}));
  await waitFor(()=>expect(document.querySelectorAll(".ua-chat-message--assistant")[1]?.getAttribute("aria-busy")).toBe("false"));
  expect(h.sent).toHaveLength(2);expect(stoppedPanel.textContent).not.toContain("Incomplete second answer");
  fireEvent.click(screen.getByRole("button",{name:"Close run details"}));
  fireEvent.click(screen.getAllByRole("button",{name:"View run details"}).at(-1)!);
  expect(screen.getByRole("region",{name:"Run details"}).textContent).not.toContain("Incomplete second answer");
 });


 it("keeps the ordinary send source revision stable while publishing the first task and follow-up",async()=>{
  const h=await mount(true),capture=h.runtime.captureOrdinarySend!;
  let checks=0;
  vi.spyOn(h.runtime,"captureOrdinarySend").mockImplementation((draft,current)=>{
    const revision=safeProviderSession.getContextVersion(),authorize=capture(draft,current);
    return(request,stream)=>{expect(safeProviderSession.getContextVersion()).toBe(revision);checks++;return authorize(request,stream);};
  });
  for(const [index,text] of ["First native-bound task","Second native-bound task"].entries()){
    fireEvent.change(h.input(),{target:{value:text}});fireEvent.click(screen.getByRole("button",{name:"Send task"}));
    await waitFor(()=>expect(h.sent).toHaveLength(index+1));expect(checks).toBe(index+1);
    await h.delta("Complete "+text);await h.done();
  }
  expect(checks).toBe(2);expect(h.gate.getPending()).toBeNull();
 });

 it("does not publish a transient empty conversation while routing a follow-up task",async()=>{
  const h=await mount();await h.send("First question");await h.approve();await h.delta("First answer");await h.done();
  const snapshot=h.runtime.getSnapshot(),active=snapshot.tasksById[snapshot.activeTaskId!],conversation=active.draft.conversationId;
  expect(conversation).toBeTruthy();
  const observed:Array<string|undefined>=[],original=safeProviderSession.updateContext;
  vi.spyOn(safeProviderSession,"updateContext").mockImplementation((project,input,model,conversationId)=>{observed.push(conversationId);original(project,input,model,conversationId);});
  await h.send("Follow-up");
  expect(observed.length).toBeGreaterThan(0);expect(observed.every(id=>id===conversation)).toBe(true);await h.reject();
 });

 it("sends exact ordered history and keeps incremental content in one assistant node",async()=>{
  const h=await mount();await h.send("Remember synthetic blue.");expect(h.fetcher).not.toHaveBeenCalled();await h.approve();await h.delta("Synthetic ");await waitFor(()=>expect(document.querySelector(".ua-chat-message--assistant")?.textContent).toContain("Synthetic "));
  const node=document.querySelector(".ua-chat-message--assistant");expect(document.querySelectorAll(".ua-chat-message--assistant")).toHaveLength(1);expect(screen.queryByRole("region",{name:"Run details"})).toBeNull();
  await h.delta("blue.");expect(document.querySelector(".ua-chat-message--assistant")).toBe(node);expect(node?.textContent).toContain("Synthetic blue.");await h.done();expect(document.querySelectorAll(".ua-chat-message--assistant")).toHaveLength(1);
  const review=await h.send("What color?");const body=JSON.parse(review.envelope.body);expect(body.messages.map((m:{role:string})=>m.role)).toEqual(["system","system","user","assistant","user"]);expect(body.messages[2].content).toBe("Remember synthetic blue.");expect(body.messages[3].content).toBe("Synthetic blue.");expect(screen.getByLabelText("Exact outbound body").textContent).toBe(review.envelope.body);expect(h.fetcher).toHaveBeenCalledTimes(1);
  await h.approve();expect(h.sent[1]).toBe(review.envelope.body);await h.delta("Blue.");await h.done();expect(document.querySelectorAll(".ua-chat-message--assistant")).toHaveLength(2);expect(document.querySelectorAll(".ua-chat-message--user")).toHaveLength(2);expect(fetch).not.toHaveBeenCalled();
 });
 it("new conversation isolates requests while keeping prior UI history separately selectable",async()=>{const h=await mount();await h.send("First chat secret fact.");await h.approve();await h.delta("First chat answer.");await h.done();fireEvent.click(screen.getByRole("button",{name:"New conversation"}));expect(document.querySelectorAll(".ua-chat-message")).toHaveLength(0);const next=await h.send("New independent chat.");expect(next.envelope.body).not.toContain("First chat");await h.reject();await waitFor(()=>expect(h.input().value).toBe("New independent chat."));});
 it("retains partial cancellation visibly without adding a successful history turn",async()=>{const h=await mount();await h.send("Cancelled question.");await h.approve();await h.delta("Partial answer.");fireEvent.click(await screen.findByRole("button",{name:"Stop task"}));await waitFor(()=>expect(h.manager.getSnapshot().ready).toBe(false));expect(document.querySelector(".ua-chat-message--assistant")?.textContent).toContain("Partial answer.");expect(document.querySelector(".ua-chat-message--assistant")?.textContent).toContain("Stopped.");act(()=>{safeProviderSession.enable();safeProviderSession.openAccount("synthetic-ui-test-only");h.manager.openAccount("synthetic-transport-key");});const retry=await h.send("Retry question.");expect(retry.envelope.body).not.toContain("Partial answer.");expect(JSON.parse(retry.envelope.body).messages.filter((m:{role:string})=>m.role==="user")).toHaveLength(1);await h.reject();});
 it("shows failure, keeps the draft and excludes failed partial output from retry history",async()=>{const h=await mount();await h.send("Question after failure.");await h.approve();await h.delta("Unfinished.");await act(async()=>{h.streams.at(-1)!.error(Error("synthetic stream failure"));});await waitFor(()=>expect(document.querySelector(".ua-chat-issue")?.textContent).toContain("did not complete"));expect(h.input().value).toBe("Question after failure.");expect(h.fetcher).toHaveBeenCalledTimes(1);const retry=await h.send("Question after failure.");expect(retry.envelope.body).not.toContain("Unfinished.");await h.reject();});
 it("switches language while streaming without restarting, truncating or duplicating the answer",async()=>{const h=await mount();await h.send("Language check.");await h.approve();await h.delta("**Keep** ");const node=document.querySelector(".ua-chat-message--assistant");act(()=>h.locale.setLocale("zh-CN"));await h.delta("all text.");expect(document.querySelector(".ua-chat-message--assistant")).toBe(node);expect(node?.querySelector("strong")?.textContent).toBe("Keep");expect(node?.textContent).toContain("all text.");expect(h.fetcher).toHaveBeenCalledTimes(1);await h.done();});
 it("masks a credential echoed across SSE boundaries while flushing unrelated short deltas",async()=>{const h=await mount();await h.send("Masking check.");await h.approve();await h.delta("OK ");expect(document.querySelector(".ua-chat-message--assistant")?.textContent).toContain("OK ");await h.delta("synthetic-trans");await h.delta("port-key done");await h.done();expect(document.querySelector(".ua-chat-message--assistant")?.textContent).toContain("[REDACTED] done");expect(document.querySelector(".ua-chat-message--assistant")?.textContent).not.toContain("synthetic-transport-key");});
});

const draft:TaskDraft={input:"typed text",projectId:"A",providerId:"deepseek",modelId:DEEPSEEK_MODEL,permissionMode:"request_approval",reasoningEffort:"medium",runMode:"local",branch:null,contextPercent:null};
function task(id:string,patch:Partial<TaskRecord>={}):TaskRecord{return{id,title:id,state:"completed",draft:{...draft,conversationId:"chat"},createdAt:Number(id.replace(/\D/g,""))||1,updatedAt:1,completedAt:1,error:null,...patch};}
function events(id:string,text="Answer"):TaskEvent[]{return[{id:id+"done",taskId:id,type:"provider_request_completed",title:"done",createdAt:1,payload:{responseText:text}}];}
describe("history selection boundaries",()=>{
 it("carries explicitly selected archived discussion text across later complete turns without native IDs",()=>{
  const restored=[{role:"user" as const,content:"earlier question"},{role:"assistant" as const,content:"earlier answer"}];
  const current=task("restored",{draft:{...draft,conversationHistory:restored,savedRun:{parentRunId:"archive",projectId:"chat:project:A",logicalProjectId:"A",taskMode:"discussion",conversationId:"chat",includeCompletedContext:true,completed:true,hasUnresolvedEffects:false,messages:restored}}});
  expect(completedConversationHistory([current],{"restored":events("restored")})).toEqual([...restored,{role:"user",content:"typed text"},{role:"assistant",content:"Answer"}]);
 });

 it("excludes attachments, tool execution, incomplete turns and other projects/conversations",()=>{const first=task("1"),attachment=task("2",{draft:{...draft,conversationId:"chat",historyEligible:false}}),tool=task("3"),cancel=task("4",{state:"cancelled"}),other=task("5",{draft:{...draft,conversationId:"another"}}),project=task("6",{draft:{...draft,projectId:"B",conversationId:"chat"}});const all=Object.fromEntries([first,attachment,tool,cancel,other,project].map(t=>[t.id,t]));const activity={"1":events("1"),"2":events("2","private attachment"),"3":[...events("3","tool output"),{id:"tool",taskId:"3",type:"terminal_output" as const,title:"tool",createdAt:1}],"4":events("4","partial")};const selected=conversationTasks(all,"1","A");expect(selected.map(t=>t.id)).toEqual(["1","2","3","4"]);expect(completedConversationHistory(selected,activity)).toEqual([{role:"user",content:"typed text"},{role:"assistant",content:"Answer"}]);expect(conversationTasks(all,"6","A")).toEqual([]);});
 it("uses only the newest eight complete text pairs and rejects role injection",()=>{const pairs=Array.from({length:20},(_,i)=>[{role:"user" as const,content:`user${i}`},{role:"assistant" as const,content:`answer${i}`}]).flat();const selected=boundConversationHistory(pairs);expect(selected).toHaveLength(16);expect(selected[0].content).toBe("user12");expect(()=>boundConversationHistory([{role:"system" as never,content:"inject"},{role:"assistant",content:"x"}])).toThrow();expect(boundConversationHistory([{role:"user",content:"x".repeat(13000)},{role:"assistant",content:"large"}])).toEqual([]);});
});
