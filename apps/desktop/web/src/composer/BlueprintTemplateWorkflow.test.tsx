import {it,expect,vi,afterEach} from "vitest";
import {negotiatePickupConnection,BlueprintTemplateWorkflow} from "./BlueprintTemplateWorkflow";
const input={projectId:"root:a",rootId:"root:a",editorSessionId:"session"};
const report={schemaVersion:1,...input,status:"negotiated_readonly",toolsVerified:true,pluginLabEnabled:false,mutationEnabled:false,connectionRetained:false,reason:"pickup_native_plan_approval_not_integrated"};
it("pickup negotiation uses only the exact native discovery command",async()=>{
 const invoke=vi.fn(async()=>report);
 expect(await negotiatePickupConnection(invoke as never,input)).toEqual({labEnabled:false});
 expect(invoke).toHaveBeenCalledWith("negotiate_ue_pickup_connection",{input});expect(invoke).toHaveBeenCalledTimes(1);
});
it("pickup negotiation rejects foreign identity and claimed write permission",async()=>{
 for(const patch of [{projectId:"foreign"},{editorSessionId:"changed"},{mutationEnabled:true},{connectionRetained:true}]){
  await expect(negotiatePickupConnection((async()=>({...report,...patch})) as never,input)).rejects.toThrow();
 }
 await expect(negotiatePickupConnection(null,input)).rejects.toThrow();
});

import {render,screen,fireEvent,waitFor,cleanup,act} from "@testing-library/react";
import {I18nProvider,createLocaleStore} from "../i18n";
const mocks=vi.hoisted(()=>({invoke:vi.fn(),session:{projectId:"root:a",rootId:"root:a",sessionId:"session",mode:"attached"}}));
vi.mock("../stores/ui-store",()=>({useOptionalRuntimeStore:()=>mocks.session,useOptionalProjectStore:()=>"root:a"}));
vi.mock("../runtime/native-provider-budget",()=>({localNativeInvoke:()=>mocks.invoke}));
afterEach(cleanup);
it("pickup template button completes native negotiation without offering creation",async()=>{
 mocks.invoke.mockResolvedValue(report);
 render(<I18nProvider store={createLocaleStore({initialLocale:"en",storage:null,eventTarget:null})}><BlueprintTemplateWorkflow/></I18nProvider>);
 fireEvent.click(screen.getByRole("button",{name:"Check managed V2 connection"}));
 await waitFor(()=>expect(screen.getByRole("status").textContent).toContain("Managed connection and tool contract checked"));
 expect(mocks.invoke).toHaveBeenCalledWith("negotiate_ue_pickup_connection",{input});
 expect(screen.getByRole("status").textContent).toContain("approve creation separately");
 expect(screen.getAllByRole("button")).toHaveLength(2);
});

it("pickup startup plan sends exact template data and never reports asset creation",async()=>{
 mocks.invoke.mockImplementation(async(command,payload)=>{
  expect(command).toBe("approve_ue_pickup_launch_plan");const {projectId,plan}=payload.input;
  expect(plan.targetPackage).toBe("/Game/UAgentBuildLab/Pickup_T13/BP_Custom");expect(plan.itemId).toBe("Health");expect(plan.interactionKey).toBe("E");
  expect(Object.keys(payload.input).sort()).toEqual(["plan","projectId"]);
  expect(JSON.stringify(payload)).not.toContain("Permit");
  return {schemaVersion:1,projectId,operationId:plan.operationId,status:"startup_plan_written",approvalFileCreated:true,editorStarted:false,assetCreated:false};
 });
 render(<I18nProvider store={createLocaleStore({initialLocale:"en",storage:null,eventTarget:null})}><BlueprintTemplateWorkflow/></I18nProvider>);
 fireEvent.change(screen.getByLabelText("New Blueprint name"),{target:{value:"BP_Custom"}});
 fireEvent.click(screen.getByRole("button",{name:"Review and approve startup plan"}));
 await waitFor(()=>expect(screen.getByText(/Approval file created. Editor not started; Blueprint not created/)).toBeTruthy());
});

it("pickup managed startup uses only approved operation identity and stops its own editor",async()=>{
 let operation="";
 mocks.invoke.mockImplementation(async(command,payload)=>{
  if(command==="approve_ue_pickup_launch_plan"){operation=payload.input.plan.operationId;return {schemaVersion:1,projectId:"root:a",operationId:operation,status:"startup_plan_written",approvalFileCreated:true,editorStarted:false,assetCreated:false};}
  expect(payload).toEqual({input:{projectId:"root:a",operationId:operation}});
  if(command==="start_approved_ue_pickup_editor")return {schemaVersion:1,projectId:"root:a",operationId:operation,status:"editor_started",assetCreated:false,session:{projectId:"root:a",rootId:"root:a",sessionId:"native-started-session",mode:"attached",status:"attached"}};
  if(command==="stop_approved_ue_pickup_editor")return true;
  throw Error("unexpected native action");
 });
 render(<I18nProvider store={createLocaleStore({initialLocale:"en",storage:null,eventTarget:null})}><BlueprintTemplateWorkflow/></I18nProvider>);
 fireEvent.click(screen.getByRole("button",{name:"Review and approve startup plan"}));
 await waitFor(()=>expect(screen.getByRole("button",{name:"Confirm and start managed editor"})).toBeTruthy());
 fireEvent.click(screen.getByRole("button",{name:"Confirm and start managed editor"}));
 await waitFor(()=>expect(screen.getByText("Template editor started; asset not created.")).toBeTruthy());
 fireEvent.click(screen.getByRole("button",{name:"Stop template editor"}));
 await waitFor(()=>expect(screen.queryByText("Template editor started; asset not created.")).toBeNull());
});

it("pickup managed startup late response stops the original operation after unmount",async()=>{
 let operation="";let resolveStart!:(value:unknown)=>void;
 const pending=new Promise(resolve=>{resolveStart=resolve;});
 mocks.invoke.mockReset();
 mocks.invoke.mockImplementation(async(command,payload)=>{
  if(command==="approve_ue_pickup_launch_plan"){operation=payload.input.plan.operationId;return {schemaVersion:1,projectId:"root:a",operationId:operation,status:"startup_plan_written",approvalFileCreated:true,editorStarted:false,assetCreated:false};}
  if(command==="start_approved_ue_pickup_editor")return pending;
  if(command==="stop_approved_ue_pickup_editor")return true;
  throw Error("unexpected command");
 });
 const view=render(<I18nProvider store={createLocaleStore({initialLocale:"en",storage:null,eventTarget:null})}><BlueprintTemplateWorkflow/></I18nProvider>);
 fireEvent.click(screen.getByRole("button",{name:"Review and approve startup plan"}));
 await waitFor(()=>expect(screen.getByRole("button",{name:"Confirm and start managed editor"})).toBeTruthy());
 fireEvent.click(screen.getByRole("button",{name:"Confirm and start managed editor"}));
 view.unmount();
 expect(mocks.invoke.mock.calls.filter(c=>c[0]==="stop_approved_ue_pickup_editor")).toHaveLength(1);
 await act(async()=>{resolveStart({schemaVersion:1,projectId:"root:a",operationId:operation,status:"editor_started",assetCreated:false,session:{projectId:"root:a",rootId:"root:a",sessionId:"late-session",mode:"attached",status:"attached"}});await pending;});
 const stops=mocks.invoke.mock.calls.filter(c=>c[0]==="stop_approved_ue_pickup_editor");
 expect(stops).toHaveLength(2);
 for(const call of stops)expect(call[1]).toEqual({input:{projectId:"root:a",operationId:operation}});
});

async function startTemplateForEffects(failApply=false,waitApply?:Promise<void>){
 let operation="";const calls:string[]=[];
 mocks.invoke.mockReset();mocks.invoke.mockImplementation(async(command,payload)=>{
  calls.push(command);
  if(command==="approve_ue_pickup_launch_plan"){operation=payload.input.plan.operationId;return {schemaVersion:1,projectId:"root:a",operationId:operation,status:"startup_plan_written",approvalFileCreated:true,editorStarted:false,assetCreated:false};}
  expect(payload).toEqual({input:{projectId:"root:a",operationId:operation}});
  if(command==="start_approved_ue_pickup_editor")return {schemaVersion:1,projectId:"root:a",operationId:operation,status:"editor_started",assetCreated:false,session:{projectId:"root:a",rootId:"root:a",sessionId:"native-session",mode:"attached",status:"attached"}};
  if(command==="stop_approved_ue_pickup_editor")return true;
  if(command==="preview_ue_pickup_template")return {schemaVersion:1,projectId:"root:a",operationId:operation,status:"preview_ready",data:{assetCreated:false,plan:{operationId:operation,targetPackage:"/Game/UAgentBuildLab/Pickup_T13/BP_Pickup"},preview:{compileStatus:"up_to_date",copySaved:false,semanticChanges:["create native-parent Blueprint"],compileDiagnostics:[]}}};
  if(command==="apply_ue_pickup_template"){if(waitApply)await waitApply;if(failApply)throw Error("transport unknown");return {schemaVersion:1,projectId:"root:a",operationId:operation,status:"created_saved",data:{assetCreated:true,plan:{operationId:operation,targetPackage:"/Game/UAgentBuildLab/Pickup_T13/BP_Pickup"},compileStatus:"up_to_date",observedDiskHash:"a".repeat(64),savedPackages:["/Game/UAgentBuildLab/Pickup_T13/BP_Pickup"]}};}
  throw Error("unexpected action");
 });
 render(<I18nProvider store={createLocaleStore({initialLocale:"en",storage:null,eventTarget:null})}><BlueprintTemplateWorkflow/></I18nProvider>);
 fireEvent.click(screen.getByRole("button",{name:"Review and approve startup plan"}));await waitFor(()=>expect(screen.getByRole("button",{name:"Confirm and start managed editor"})).toBeTruthy());
 fireEvent.click(screen.getByRole("button",{name:"Confirm and start managed editor"}));await waitFor(()=>expect(screen.getByRole("button",{name:"Prepare and compile preview"})).toBeTruthy());return calls;
}
it("pickup creation reviews compiled preview before separate create IPC",async()=>{
 const calls=await startTemplateForEffects();expect(screen.queryByRole("button",{name:"Review and approve creation"})).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"Prepare and compile preview"}));await waitFor(()=>expect(screen.getByRole("button",{name:"Review and approve creation"})).toBeTruthy());
 expect(screen.getByLabelText("Template operation result").textContent).toContain("up_to_date");expect(calls).not.toContain("apply_ue_pickup_template");
 fireEvent.click(screen.getByRole("button",{name:"Review and approve creation"}));await waitFor(()=>expect(screen.getByText("New Blueprint compiled and saved; result verified.")).toBeTruthy());
 expect(screen.queryByText("Template editor started; asset not created.")).toBeNull();expect(calls.filter(c=>c==="apply_ue_pickup_template")).toHaveLength(1);
});
it("pickup creation unknown outcome never offers automatic retry or claims no asset",async()=>{
 const calls=await startTemplateForEffects(true);fireEvent.click(screen.getByRole("button",{name:"Prepare and compile preview"}));await waitFor(()=>expect(screen.getByRole("button",{name:"Review and approve creation"})).toBeTruthy());
 fireEvent.click(screen.getByRole("button",{name:"Review and approve creation"}));await waitFor(()=>expect(screen.getByText(/Operation failed or outcome is uncertain/)).toBeTruthy());
 expect(screen.queryByRole("button",{name:"Review and approve creation"})).toBeNull();expect(screen.queryByText("Template editor started; asset not created.")).toBeNull();expect(calls.filter(c=>c==="apply_ue_pickup_template")).toHaveLength(1);
});

it("pickup creation stopped in flight retains unknown outcome after late success",async()=>{
 let finish!:()=>void;const pending=new Promise<void>(resolve=>{finish=resolve;});await startTemplateForEffects(false,pending);
 fireEvent.click(screen.getByRole("button",{name:"Prepare and compile preview"}));await waitFor(()=>expect(screen.getByRole("button",{name:"Review and approve creation"})).toBeTruthy());
 fireEvent.click(screen.getByRole("button",{name:"Review and approve creation"}));fireEvent.click(screen.getByRole("button",{name:"Stop template editor"}));
 await waitFor(()=>expect(screen.queryByRole("button",{name:"Stop template editor"})).toBeNull());
 await act(async()=>{finish();await pending;});
 expect(screen.getByText(/Creation requested; outcome not confirmed/)).toBeTruthy();
 expect(screen.queryByText(/Approval file created. Editor not started; Blueprint not created/)).toBeNull();expect(screen.queryByText("New Blueprint compiled and saved; result verified.")).toBeNull();
});
