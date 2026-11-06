import {localizeText,getLocale} from "../i18n";
const uiText=(source:string)=>localizeText(getLocale(),source);
import {act,cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createOutboundConsentGate} from "@uagent/runtime";
import {OutboundRequestReview} from "../settings/pages/OutboundRequestReview";
import {UIProvider,useComposerActions,useProjectActions} from "../stores/ui-store";
afterEach(cleanup);
beforeEach(()=>{
 Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,value:vi.fn(function(this:HTMLDialogElement){this.setAttribute("open","");})});
 Object.defineProperty(HTMLDialogElement.prototype,"close",{configurable:true,value:vi.fn(function(this:HTMLDialogElement){this.removeAttribute("open");})});
});
let edit!:ReturnType<typeof useComposerActions>;let project!:ReturnType<typeof useProjectActions>;
function Probe(){edit=useComposerActions();project=useProjectActions();return null;}
const envelope={endpoint:"https://api.deepseek.com/chat/completions",model:"deepseek-flash",projectId:"A",epoch:1,revision:"one",body:JSON.stringify({messages:[{role:"user",content:"synthetic exact body"}]})};
describe("exact outbound review UI",()=>{
 it("opens above an existing build modal and reviews queued requests one at a time",async()=>{
  const gate=createOutboundConsentGate();render(<UIProvider><div className="ua-app"><dialog open aria-label="Build preview"><button>Request suggestion</button></dialog></div><Probe/><OutboundRequestReview gate={gate}/></UIProvider>);
  const original=screen.getByText("Request suggestion");original.focus();
  const second={...envelope,revision:"two",body:"second synthetic exact body"};let first!:ReturnType<typeof gate.review>,next!:Promise<unknown>;
  const approved=vi.fn();act(()=>{first=gate.review(envelope);void first.then(approved,()=>undefined);next=gate.review(second).catch(error=>error);});
  const review=screen.getByRole("dialog",{name:uiText("Exact outbound request review")}) as HTMLDialogElement;
  expect(review.tagName).toBe("DIALOG");expect(review.open).toBe(true);expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();expect(approved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText(uiText("Confirm this request once")));expect((await first).consume(envelope)).toBe(true);
  expect(screen.getByLabelText(uiText("Exact outbound body")).textContent).toBe(second.body);expect(review.open).toBe(true);
  fireEvent.click(screen.getByText(uiText("Reject outbound request")));expect(await next).toBeInstanceOf(Error);
  expect(screen.getByRole("dialog",{name:"Build preview"})).toBeTruthy();expect(document.activeElement).toBe(original);expect(gate.getPending()).toBeNull();
 });
 it("native modal cancellation rejects the request and restores the underlying focus",async()=>{
  const gate=createOutboundConsentGate();render(<UIProvider><button>Original focus</button><Probe/><OutboundRequestReview gate={gate}/></UIProvider>);
  const original=screen.getByText("Original focus");original.focus();let result!:Promise<unknown>;
  act(()=>{result=gate.review(envelope).catch(error=>error);});
  const event=new Event("cancel",{bubbles:false,cancelable:true});fireEvent(screen.getByRole("dialog",{name:uiText("Exact outbound request review")}),event);
  expect(event.defaultPrevented).toBe(true);expect(await result).toBeInstanceOf(Error);expect(document.activeElement).toBe(original);
 });
 it("discloses memory snapshot semantics without altering approved bytes",async()=>{
  const gate=createOutboundConsentGate();render(<UIProvider><Probe/><OutboundRequestReview gate={gate}/></UIProvider>);
  const memory={...envelope,body:JSON.stringify({input:[{role:"user",content:"Project memory: untrusted project data, synthetic fixture"}]})};
  let pending!:ReturnType<typeof gate.review>;
  act(()=>{pending=gate.review(memory,new AbortController().signal);});
  expect(screen.getByRole("note").textContent).toMatch(/快照|snapshot/);
  expect(screen.getByLabelText(uiText("Exact outbound body")).textContent).toBe(memory.body);
  fireEvent.click(screen.getByText(uiText("Confirm this request once")));
  expect((await pending).consume(memory)).toBe(true);
 });

 it("traps boundary Tab keys and Escape revokes before returning focus",async()=>{
  const gate=createOutboundConsentGate();render(<UIProvider><button type="button">Original focus</button><Probe/><OutboundRequestReview gate={gate}/></UIProvider>);
  const original=screen.getByText(uiText("Original focus"));original.focus();let outcome!:Promise<unknown>;
  act(()=>{outcome=gate.review(envelope,new AbortController().signal).catch(error=>error);});
  const reject=screen.getByText(uiText("Reject outbound request"));
  const body=screen.getByLabelText(uiText("Exact outbound body"));
  expect(document.activeElement).toBe(body);
  fireEvent.keyDown(body,{key:"Tab",shiftKey:true});expect(document.activeElement).toBe(reject);
  fireEvent.keyDown(reject,{key:"Tab"});expect(document.activeElement).toBe(body);
  fireEvent.keyDown(body,{key:"Escape"});expect(await outcome).toBeInstanceOf(Error);
  expect(screen.queryByRole("dialog",{name:uiText("Exact outbound request review")})).toBeNull();expect(document.activeElement).toBe(original);
 });

 it("shows full serialized content and approves exactly one matching envelope",async()=>{const gate=createOutboundConsentGate();render(<UIProvider><Probe/><OutboundRequestReview gate={gate}/></UIProvider>);let result!:ReturnType<typeof gate.review>;act(()=>{result=gate.review(envelope,new AbortController().signal);});expect(screen.getByLabelText(uiText("Exact outbound body")).textContent).toBe(envelope.body);fireEvent.click(screen.getByText(uiText("Confirm this request once")));const grant=await result;expect(grant.consume(envelope)).toBe(true);expect(grant.consume(envelope)).toBe(false);});
 it.each(["edit","project","reject","unmount"])("%s invalidates pending send",async(kind)=>{const gate=createOutboundConsentGate();const view=render(<UIProvider><Probe/><OutboundRequestReview gate={gate}/></UIProvider>);let outcome!:Promise<unknown>;act(()=>{outcome=gate.review(envelope,new AbortController().signal).catch(e=>e);});act(()=>{if(kind==="edit")edit.setComposerInput("changed");else if(kind==="project")project.setActiveProject("B");else if(kind==="reject")fireEvent.click(screen.getByText(uiText("Reject outbound request")));else view.unmount();});expect(await outcome).toBeInstanceOf(Error);expect(gate.getPending()).toBeNull();});
});
