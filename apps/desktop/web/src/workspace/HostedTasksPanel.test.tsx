import {afterEach, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {HostedTasksPanel} from "./HostedTasksPanel";

const mocks=vi.hoisted(()=>({invoke:vi.fn(),settings:vi.fn()}));
vi.mock("../runtime/native-provider-budget",()=>({localNativeInvoke:()=>mocks.invoke}));
vi.mock("../runtime/safe-provider-session",()=>({safeProviderSession:{getHostedProfileId:()=>"profile"}}));
vi.mock("../i18n",()=>({useI18n:()=>({locale:"en"})}));
vi.mock("../stores/ui-store",()=>({useSettingsActions:()=>({openSettings:mocks.settings}),useProjectStore:(select:Function)=>select({activeProjectId:"p",registeredProjects:[{id:"p",name:"Project",trustState:"trusted"}]})}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("reattaches to a native task after the panel unmounts without issuing start, cancel or resume",async()=>{
  HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  HTMLDialogElement.prototype.close=function(){this.open=false;};
  mocks.invoke.mockImplementation(async(command:string,args?:{input:{action:string}})=>{
    if(command==="list_hosted_tasks")return[{runId:"existing",projectId:"p",goal:"Read Source/Main.cpp",terminal:true}];
    if(command==="control_hosted_task"&&args?.input.action==="snapshot")return{revision:7,settled:true,text:"Native result",run:{status:"completed",steps:[],modelRequests:2,toolCalls:1}};
    throw Error("unexpected action");
  });
  const first=render(<HostedTasksPanel/>);fireEvent.click(screen.getByRole("button",{name:"Background file investigation"}));
  await screen.findByText("Native result");first.unmount();
  render(<HostedTasksPanel/>);fireEvent.click(screen.getByRole("button",{name:"Background file investigation"}));
  await screen.findByText("Native result");
  await waitFor(()=>expect(mocks.invoke.mock.calls.filter(([command])=>command==="list_hosted_tasks")).toHaveLength(2));
  expect(mocks.invoke.mock.calls.every(([command,args])=>command==="list_hosted_tasks"||(command==="control_hosted_task"&&args.input.action==="snapshot"))).toBe(true);
});
