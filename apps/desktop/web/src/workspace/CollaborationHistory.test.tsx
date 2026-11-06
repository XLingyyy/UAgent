import {readFileSync} from "node:fs";
import {join} from "node:path";
import {it,expect,vi,afterEach} from "vitest";
import {render,screen,fireEvent,waitFor,cleanup,within} from "@testing-library/react";
import {createNativeRunHistory,type NativeRunArchive} from "../runtime/native-run-history";
import {I18nProvider,createLocaleStore} from "../i18n";
import {RunHistoryPanel} from "./RunHistoryPanel";
import {delegationHistory} from "./CollaborationHistory";
afterEach(cleanup);
const base=process.env.UAGENT_PARALLEL_REPLAY_DIR;
const load=(scenario:string,id="run")=>JSON.parse(readFileSync(join(base!,`archive-${scenario}-${id}.json`),"utf8"));
it.skipIf(!base)("dynamic archive native SQLite output survives the exact frontend parser for all parent and child records",async()=>{
 for(const scenario of ["completed","cancelled"])for(const id of ["run","run-investigator","run-reviewer"]){
  const raw=load(scenario,id),invoke=vi.fn(async()=>raw),archive=await createNativeRunHistory(invoke).snapshot("project",raw.descriptor.runId);
  expect(archive.completeness.complete).toBe(true);expect(archive.coordinatorState?.collaboration).toEqual(raw.coordinatorState.collaboration);if(id==="run")expect(delegationHistory(archive)?.cards).toHaveLength(2);else expect(delegationHistory(archive)).toBeNull();
  expect(invoke).toHaveBeenCalledWith("snapshot_native_run_store",{input:{schemaVersion:1,projectId:"project",runId:raw.descriptor.runId}});
  if(id==="run")expect(archive.descriptor.status).toBe(scenario==="completed"?"succeeded":"cancelled");
 }
});
it.skipIf(!base)("dynamic archive shows actual models assignments and saved worker results without executing",async()=>{
 const raw=load("completed"),invoke=vi.fn(async(command:string)=>command==="list_native_run_history"?{schemaVersion:1,runs:[raw.descriptor],offset:0,limit:30,hasMore:false}:raw),history=createNativeRunHistory(invoke),onContinue=vi.fn();
 render(<I18nProvider store={createLocaleStore({initialLocale:"en",storage:null,eventTarget:null})}><RunHistoryPanel history={history} projectId="project" onContinue={onContinue}/></I18nProvider>);
 fireEvent.click(await screen.findByRole("button",{name:/Investigate value/}));
 const section=await screen.findByRole("region",{name:"Saved dynamic delegation"});
 expect(within(section).getByText("configured-a / model-a")).toBeTruthy();expect(within(section).getByText("configured-b / model-b")).toBeTruthy();
 expect(within(section).getByText("Trace source lifecycle and cancellation")).toBeTruthy();expect(within(section).getByText("Find missing tests and counterexamples")).toBeTruthy();expect(within(section).getAllByText("Completed")).toHaveLength(2);
 expect(within(section).getByText("investigator_REPORT")).toBeTruthy();expect(within(section).getByText("reviewer_REPORT")).toBeTruthy();
 await waitFor(()=>expect(screen.getByText("synthesizer_REPORT")).toBeTruthy());expect(document.querySelector('.ua-run-history__conversation')?.textContent).not.toContain('"investigator":');
 expect(onContinue).not.toHaveBeenCalled();expect(invoke.mock.calls.map(c=>c[0])).toEqual(["list_native_run_history","snapshot_native_run_store"]);
});
it.skipIf(!base)("dynamic archive cancelled or absent worker observations never imply completion",async()=>{
 const raw=load("cancelled"),archive=await createNativeRunHistory(async()=>raw).snapshot("project","run");const summary=delegationHistory(archive)!;expect(summary.cards.every(c=>c.status==="cancelled"&&c.report===null)).toBe(true);
 const missing=structuredClone(archive);const team=missing.coordinatorState!.collaboration as Record<string,unknown>;delete team.workers;expect(delegationHistory(missing)!.cards.every(c=>c.status===null)).toBe(true);
});
it("dynamic archive malformed assignments leave raw conversation untouched",()=>{
 for(const assignments of [{investigator:"only"},{investigator:"",reviewer:"x"},{investigator:"x",reviewer:"y",tool:"execute"}]){
  const archive={coordinatorState:{collaboration:{mode:"dynamic_delegation",assignments}},providerMessages:[]} as unknown as NativeRunArchive;expect(delegationHistory(archive)).toBeNull();
 }
});

it("dynamic archive never hides matching earlier answers or infers sibling models from child scope",()=>{
 const assignments={investigator:"Inspect source",reviewer:"Check tests"},plan=JSON.stringify(assignments);
 const parent={coordinatorState:{collaboration:{mode:"dynamic_delegation",assignments}},providerMessages:[{role:"user",content:"Earlier goal"},{role:"assistant",content:plan},{role:"user",content:"Current goal"},{role:"assistant",content:plan}]} as unknown as NativeRunArchive;
 expect(delegationHistory(parent)!.plannerIndex).toBe(3);
 const child=structuredClone(parent);child.coordinatorState!.parentRunId="parent-run";child.coordinatorState!.scopeDescription={providerId:"member-only",modelId:"A"};expect(delegationHistory(child)).toBeNull();
 parent.providerMessages[3].content="ordinary response";expect(delegationHistory(parent)!.plannerIndex).toBe(-1);
});

it.skipIf(!base)("configured members native archives show all saved members after removal",async()=>{
 for(const scenario of ["dynamic-four","dynamic-removed"]){
  const raw=load(scenario),archive=await createNativeRunHistory(async()=>raw).snapshot("project","run"),summary=delegationHistory(archive)!;
  expect(summary.cards).toHaveLength(scenario==="dynamic-four"?4:3);expect(summary.cards.every(c=>c.status==="completed"&&c.report===c.id+"_REPORT")).toBe(true);expect(summary.plannerIndex).toBeGreaterThan(0);
  expect(summary.cards.find(c=>c.id==="reviewer")?.model).toBe("configured-b / model-b");
  if(scenario==="dynamic-removed")expect(summary.cards.some(c=>c.id==="investigator")).toBe(false);
 }
});
