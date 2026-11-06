import {afterEach, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {HostedTasksPanel} from "./HostedTasksPanel";

const mocks=vi.hoisted(()=>({invoke:vi.fn(),settings:vi.fn()}));
vi.mock("../runtime/native-provider-budget",()=>({localNativeInvoke:()=>mocks.invoke}));
vi.mock("../runtime/safe-provider-session",()=>({safeProviderSession:{getHostedProfileId:()=>"profile"}}));
vi.mock("../i18n",()=>({useI18n:()=>({locale:"en"})}));
vi.mock("../stores/ui-store",()=>({useSettingsActions:()=>({openSettings:mocks.settings}),useProjectStore:(select:Function)=>select({activeProjectId:"p",registeredProjects:[{id:"p",name:"Project",trustState:"trusted"}]})}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("saves paused requirements against the observed plan version without automatically resuming",async()=>{
  HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  HTMLDialogElement.prototype.close=function(){this.open=false;};
  let version=1;
  mocks.invoke.mockImplementation(async(command:string,args?:{input:{action:string}})=>{
    if(command==="hosted_source_change")return{preview:null,receipt:null};
    if(command==="list_hosted_tasks")return[{runId:"existing",projectId:"p",goal:"Read source",terminal:false}];
    if(args?.input.action==="amend"){version++;return{accepted:true};}
    if(args?.input.action==="snapshot")return{revision:7,settled:true,text:"Paused",run:{status:"paused",stopReason:version===1?"user_paused":"requirements_updated",planVersion:version,steps:[],modelRequests:1,toolCalls:0}};
    throw Error("unexpected action");
  });
  render(<HostedTasksPanel/>);fireEvent.click(screen.getByRole("button",{name:"Background file investigation"}));
  fireEvent.change(await screen.findByLabelText("Updated requirements"),{target:{value:"Focus on header declarations"}});
  fireEvent.click(screen.getByRole("button",{name:"Save requirements and replan"}));
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledWith("control_hosted_task",{input:{runId:"existing",action:"amend",instructions:"Focus on header declarations",expectedPlanVersion:1}}));
  expect(mocks.invoke.mock.calls.some(([,args])=>args?.input?.action==="resume")).toBe(false);
});
it("reattaches to a native task after the panel unmounts without issuing start, cancel or resume",async()=>{
  HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  HTMLDialogElement.prototype.close=function(){this.open=false;};
  mocks.invoke.mockImplementation(async(command:string,args?:{input:{action:string}})=>{
    if(command==="hosted_source_change")return{preview:null,receipt:null};
    if(command==="list_hosted_tasks")return[{runId:"existing",projectId:"p",goal:"Read Source/Main.cpp",terminal:true}];
    if(command==="control_hosted_task"&&args?.input.action==="snapshot")return{revision:7,settled:true,text:"Native result",run:{status:"completed",steps:[],modelRequests:2,toolCalls:1}};
    throw Error("unexpected action");
  });
  const first=render(<HostedTasksPanel/>);fireEvent.click(screen.getByRole("button",{name:"Background file investigation"}));
  await screen.findByText("Native result");first.unmount();
  render(<HostedTasksPanel/>);fireEvent.click(screen.getByRole("button",{name:"Background file investigation"}));
  await screen.findByText("Native result");
  await waitFor(()=>expect(mocks.invoke.mock.calls.filter(([command])=>command==="list_hosted_tasks")).toHaveLength(2));
  expect(mocks.invoke.mock.calls.every(([command,args])=>command==="list_hosted_tasks"||command==="hosted_source_change"||(command==="control_hosted_task"&&args.input.action==="snapshot"))).toBe(true);
});

it("accepts a matching workflow draft without starting or inheriting source-write proposals",async()=>{
  HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  HTMLDialogElement.prototype.close=function(){this.open=false;};
  mocks.invoke.mockImplementation(async(command:string)=>{if(command==="list_hosted_tasks")return[];throw Error("unexpected action");});
  render(<HostedTasksPanel/>);
  fireEvent(window,new CustomEvent("uagent:prepare-hosted-investigation",{detail:{projectId:"other",goal:"Foreign goal",prefix:"Source"}}));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent(window,new CustomEvent("uagent:prepare-hosted-investigation",{detail:{projectId:"p",goal:"Find repair declarations",prefix:"Source/Test01"}}));
  await screen.findByRole("dialog");
  expect((screen.getByLabelText("Investigation goal") as HTMLTextAreaElement).value).toBe("Find repair declarations");
  expect((screen.getByLabelText("Directory to read and share with DeepSeek") as HTMLInputElement).value).toBe("Source/Test01");
  expect((screen.getByLabelText("Prepare source change proposals for separate review and approval") as HTMLInputElement).checked).toBe(false);
  expect(mocks.invoke.mock.calls.every(([command])=>command==="list_hosted_tasks")).toBe(true);
});
