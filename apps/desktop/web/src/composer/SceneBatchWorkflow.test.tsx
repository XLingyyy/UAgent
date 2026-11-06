import {it,expect,vi,afterEach} from "vitest";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {I18nProvider,createLocaleStore} from "../i18n";
import {SceneBatchWorkflow} from "./SceneBatchWorkflow";
import {sceneGridPlan,sceneObjectPlan,sceneStep} from "../runtime/native-scene-batch";
const mocks=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock("../stores/ui-store",()=>({useOptionalProjectStore:()=>"root:a"}));
vi.mock("../runtime/native-provider-budget",()=>({localNativeInvoke:()=>mocks.invoke}));
afterEach(async()=>{cleanup();await Promise.resolve();mocks.invoke.mockReset();});
function mount(){return render(<I18nProvider store={createLocaleStore({initialLocale:"en",storage:null,eventTarget:null})}><SceneBatchWorkflow/></I18nProvider>);}
function response(plan:any,stage:string,state:string,count:number){return {persisted:true,receiptFile:`Saved/UAgentSceneT14/receipt-${"a".repeat(32)}.json`,receipt:{schemaVersion:1,projectId:"root:a",operationId:plan.operationId,runId:"00000000-0000-4000-8000-000000000003",stage,status:"observed",data:{state,targetMap:plan.targetMap,appliedCount:count,currentWorldMatches:true,cancelIsRollback:false,conflict:false,conflictReason:"",saved:state==="saved",packageDirty:state!=="saved",diskExists:state==="saved",diskHash:state==="saved"?"b".repeat(64):"",items:plan.items.map((i:any,n:number)=>({...i,status:n<count?"applied":"not_started",reason:"",owned:n<count,actorGuid:n<count?`actor-${n}`:"",objectPath:n<count?`${plan.targetMap}.${i.objectName}`:""}))}}};}
async function begin(){fireEvent.click(screen.getByText("Review object plan"));fireEvent.click(screen.getByLabelText("I reviewed the target map and every object"));fireEvent.click(screen.getByText("Request native plan approval"));fireEvent.click(await screen.findByText("Approve and start project editor"));await screen.findByText("Approve scene preparation");}
it("scene workflow shows partial per-object receipts then resumes and separately saves",async()=>{
 let plan:any,queries=0,executed=false;mocks.invoke.mockImplementation(async(command:string,{input}:any)=>{
 if(command==="approve_ue_scene_launch_plan"){plan=input.plan;return {schemaVersion:1,projectId:"root:a",operationId:plan.operationId,status:"startup_plan_written",editorStarted:false};}
 if(command==="start_approved_ue_scene_editor")return {projectId:"root:a",operationId:plan.operationId,status:"editor_started"};
 if(command==="stop_approved_ue_scene_editor")return true;
 if(input.stage==="query"){if(!executed)return response(plan,input.stage,"not_started",0);queries++;return response(plan,input.stage,queries===1?"cancelled":"completed",queries===1?1:3);}
 if(input.stage==="execute")executed=true;const values:Record<string,[string,number]>={prepare:["prepared",0],execute:["running",0],cancel:["cancelled",1],resume:["running",1],save:["saved",3]};const [state,count]=values[input.stage];return response(plan,input.stage,state,count);
 });mount();fireEvent.change(screen.getByLabelText("Selected project .uproject filename"),{target:{value:"Ordinary.uproject"}});for(let i=0;i<17;i++)fireEvent.click(screen.getAllByText("Remove object").at(-1)!);
 fireEvent.change(screen.getByLabelText("Object 2 location.x"),{target:{value:"-700"}});
 fireEvent.change(screen.getByLabelText("Object 2 rotation.yaw"),{target:{value:"45"}});
 fireEvent.change(screen.getByLabelText("Object 3 scale.z"),{target:{value:"2.5"}});
 await begin();expect(mocks.invoke.mock.calls.find(([c])=>c==="approve_ue_scene_launch_plan")![1].input.projectFile).toBe("Ordinary.uproject");expect(plan.items).toHaveLength(3);expect(plan.items[1].transform.location.x).toBe(-700);expect(plan.items[2].transform.scale.z).toBe(2.5);
 fireEvent.click(screen.getByText("Refresh object receipts"));await screen.findByText(/Partial \/ incomplete: 0\/3/);expect((screen.getByText("Approve scene preparation") as HTMLButtonElement).disabled).toBe(false);
 for(const label of ["Approve scene preparation","Approve planned placements","Approve stopping placements (no rollback)"]){fireEvent.click(screen.getByText(label));await waitFor(()=>expect(screen.queryByText("Waiting for native approval or receipt…")).toBeNull());}
 expect(screen.getByText(/Partial \/ incomplete: 1\/3/)).toBeTruthy();expect(screen.getByLabelText("Object receipts").querySelectorAll("li")).toHaveLength(3);expect((screen.getByText("Separately approve saving new map") as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByText("Refresh object receipts"));await waitFor(()=>expect((screen.getByText("Approve remaining placements") as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByText("Approve remaining placements"));await waitFor(()=>expect(screen.queryByText("Waiting for native approval or receipt…")).toBeNull());
 fireEvent.click(screen.getByText("Refresh object receipts"));await screen.findByText(/All planned objects placed; save not confirmed/);expect(mocks.invoke.mock.calls.filter(([c,a])=>c==="scene_batch_step"&&a.input.stage==="save")).toHaveLength(0);
 fireEvent.click(screen.getByText("Separately approve saving new map"));await screen.findByText(/New map save verified/);expect(mocks.invoke.mock.calls.filter(([c,a])=>c==="scene_batch_step"&&a.input.stage==="save")).toHaveLength(1);
});
it("scene parameters stay fixed to twenty bounded Lab objects",()=>{const p=sceneGridPlan("L_Test",0,200,"00000000-0000-4000-8000-000000000001");expect(p.items).toHaveLength(20);expect(()=>sceneGridPlan("../L_Test",0,200,p.operationId)).toThrow();expect(()=>sceneGridPlan("L_Test",0,10001,p.operationId)).toThrow();});
it("scene reply rejects foreign operation and false partial-save claim",async()=>{const p=sceneGridPlan("L_Test",0,200,"00000000-0000-4000-8000-000000000001");let r=response(p,"save","saved",7);await expect(sceneStep(vi.fn(async()=>r) as never,"root:a",p,"save")).rejects.toThrow();r=response(p,"query","cancelled",7);r.receipt.operationId="other";await expect(sceneStep(vi.fn(async()=>r) as never,"root:a",p,"query")).rejects.toThrow();});
it("scene transport failure does not automatically replay preparation",async()=>{let plan:any;mocks.invoke.mockImplementation(async(c:string,{input}:any)=>{if(c==="approve_ue_scene_launch_plan"){plan=input.plan;return {schemaVersion:1,projectId:"root:a",operationId:plan.operationId,status:"startup_plan_written",editorStarted:false};}if(c==="start_approved_ue_scene_editor")return {projectId:"root:a",operationId:plan.operationId,status:"editor_started"};if(c==="stop_approved_ue_scene_editor")return true;throw Error("timeout");});mount();await begin();const button=screen.getByText("Approve scene preparation");fireEvent.click(button);await screen.findByRole("alert");fireEvent.click(button);expect(mocks.invoke.mock.calls.filter(([c])=>c==="scene_batch_step")).toHaveLength(1);});

it("scene negotiation accepts one exact plan and preserves two-plan compatibility",async()=>{
 const u=await import("../../../../../packages/runtime/src/ue-scene-batch-v2");const plan=sceneGridPlan("L_Test",0,200,"00000000-0000-4000-8000-000000000001");
 const catalog=u.UE_SCENE_TOOLS.map(name=>({name,inputSchema:u.sceneInputSchema(name),outputSchema:name===u.UE_SCENE_TOOLS[0]?u.sceneCapabilitiesSchema():u.sceneResultSchema()}));
 const host={projectKey:"lab",instanceId:"00000000-0000-4000-8000-000000000002",rootObjectId:"volume:file",runId:"00000000-0000-4000-8000-000000000003",approvedPlan:plan};
 const m={schemaVersion:"uagent.scene.capabilities.v2",protocolVersion:2,contractVersion:u.UE_SCENE_CONTRACT,projectKey:host.projectKey,instanceId:host.instanceId,rootObjectId:host.rootObjectId,runId:host.runId,available:true,productionSupported:false,scopeMode:"approved_project_new_map_current_run",writeRoot:u.UE_SCENE_ROOT,approvedPlans:[plan],tools:catalog.slice(1).map(t=>({...t,effect:"explicit native operation"}))};
 expect(()=>u.negotiateSceneBatchV2(m,catalog,host)).not.toThrow();const second=sceneGridPlan("L_Other",1,200,"00000000-0000-4000-8000-000000000004");expect(()=>u.negotiateSceneBatchV2({...m,approvedPlans:[plan,second]},catalog,host)).not.toThrow();for(const plans of [[],[plan,plan],[plan,second,second]])expect(()=>u.negotiateSceneBatchV2({...m,approvedPlans:plans},catalog,host)).toThrow();
});

it("custom list edits invalidate review; adding and removing retain unique identities",()=>{
 mount();fireEvent.click(screen.getByText("Review object plan"));fireEvent.click(screen.getByLabelText("I reviewed the target map and every object"));
 fireEvent.change(screen.getByLabelText("Object 1 name"),{target:{value:"UA14_Custom"}});
 expect(screen.queryByLabelText("I reviewed the target map and every object")).toBeNull();
 fireEvent.click(screen.getAllByText("Remove object")[1]!);fireEvent.click(screen.getByText("Add object"));fireEvent.click(screen.getByText("Review object plan"));
 expect(screen.getByLabelText("I reviewed the target map and every object")).toBeTruthy();
 fireEvent.change(screen.getByLabelText("Object 2 scale.x"),{target:{value:"0"}});fireEvent.click(screen.getByText("Review object plan"));expect(screen.getByRole("alert")).toBeTruthy();
 expect(mocks.invoke).not.toHaveBeenCalled();
});
it("custom plan supports bounded list and rejects empty, excessive, duplicate and invalid transforms",()=>{
 const p=sceneGridPlan("L_Test",0,200,"00000000-0000-4000-8000-000000000001");
 for(const count of [1,3,19,20])expect(sceneObjectPlan("L_Custom",p.items.slice(0,count),p.operationId).items).toHaveLength(count);
 for(const items of [[],[...p.items,p.items[0]!],[p.items[0]!,p.items[0]!]])expect(()=>sceneObjectPlan("L_Custom",items,p.operationId)).toThrow();
 const items=structuredClone(p.items.slice(0,1));items[0]!.transform.rotation.yaw=181;expect(()=>sceneObjectPlan("L_Custom",items,p.operationId)).toThrow();
});
