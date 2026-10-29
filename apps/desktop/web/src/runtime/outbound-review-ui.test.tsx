import {localizeText,getLocale} from "../i18n";
const uiText=(source:string)=>localizeText(getLocale(),source);
import {act,cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,describe,expect,it} from "vitest";
import {createOutboundConsentGate} from "@uagent/runtime";
import {OutboundRequestReview} from "../settings/pages/OutboundRequestReview";
import {UIProvider,useComposerActions,useProjectActions} from "../stores/ui-store";
afterEach(cleanup);
let edit!:ReturnType<typeof useComposerActions>;let project!:ReturnType<typeof useProjectActions>;
function Probe(){edit=useComposerActions();project=useProjectActions();return null;}
const envelope={endpoint:"https://api.deepseek.com/chat/completions",model:"deepseek-flash",projectId:"A",epoch:1,revision:"one",body:JSON.stringify({messages:[{role:"user",content:"synthetic exact body"}]})};
describe("exact outbound review UI",()=>{
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
