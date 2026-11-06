import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider, createLocaleStore } from "../i18n";
import { UEApprovedBuildAction } from "./UEApprovedBuildAction";
import { UEBuildRepairAction } from "./UEBuildRepairAction";
import type { UEBuildPreviewReceipt } from "../runtime/native-ue-build-preview";
const hash="b".repeat(64), sid="e".repeat(32),run="c".repeat(32),path="Source/Game/A.cpp";
const preview={projectId:"root:abc",preparedId:"a".repeat(32),preview:{fingerprint:hash,projectRoot:"E:/Synthetic",cwd:"E:/Synthetic",profile:{engineRoot:"G:/Synthetic"}}} as UEBuildPreviewReceipt;
const selection={projectId:preview.projectId,preparedId:preview.preparedId,runId:run};
const binding={projectId:preview.projectId,runId:run,profileFingerprint:hash,hostSessionId:sid,rootObjectId:"held-root"};
const snapshot={binding,diagnostic:{},snapshotId:"d".repeat(64),files:[{path,content:"int a = 1;",sha256:"1".repeat(64),objectIdentity:"held-file"}]};
const change={nativePlanDigest:"2".repeat(64),preview:{binding,diagnostic:{},snapshotId:snapshot.snapshotId,previewId:"3".repeat(64),files:[{path,before:"int a = 1;",after:"int a = 2;",beforeHash:"1".repeat(64),afterHash:"4".repeat(64),beforeObjectIdentity:"held-file"}]}};
const applied=()=>({persisted:true,hostSettled:true,receipt:{binding,previewId:change.preview.previewId,status:"applied",recoveryRecord:"5".repeat(64),effects:[{path,status:"applied",afterHash:"4".repeat(64),afterObjectIdentity:"held-file"}]}});
const build=(repaired=false)=>({repairCycle:{chainId:run,rebuilds:repaired?1:0,maxRebuilds:3,previousRunId:repaired?run:null,status:repaired?"succeeded":"awaiting_review"},schemaVersion:1,projectId:preview.projectId,preparedId:preview.preparedId,runId:repaired?"f".repeat(32):run,persisted:true,hostSettled:true,repairAvailable:!repaired,repairSessionId:repaired?null:sid,result:{owner:{runId:repaired?"f".repeat(32):run,stepId:"build",fingerprint:hash},status:repaired?"succeeded":"failed",reason:"exited",pid:1,exitCode:repaired?0:6,durationMs:1,treeStopped:true,stdout:"synthetic",stderr:"",outputComplete:true,outputTruncated:false,effects:"possible"}});
function adapter(overrides:Record<string,()=>unknown>={}) {return vi.fn(async(command:string)=>{
 if(overrides[command])return overrides[command]();
 if(command==="approve_and_run_ue_build")return build();
 if(command==="open_ue_build_repair")return {sessionId:sid,snapshot};
 if(command==="prepare_ue_build_repair")return change;
 if(command==="approve_and_apply_ue_build_repair")return applied();
 if(command==="approve_and_rebuild_ue_build_repair")return build(true);
 if(["release_ue_build_repair","cancel_approved_ue_build"].includes(command))return true;
 throw Error(command);
});}
function wrap(node:React.ReactNode){return <I18nProvider store={createLocaleStore({initialLocale:"en",storage:null})}>{node}</I18nProvider>;}
function mount(invoke=adapter()) {const active=vi.fn(),rebuilt=vi.fn();return {...render(wrap(<UEBuildRepairAction preview={preview} runId={run} initialSessionId={sid} invoke={invoke as never} onActiveChange={active} onRebuilt={rebuilt}/>)),invoke,active,rebuilt};}
async function readAndPrepare(){fireEvent.change(screen.getByLabelText("Project-relative existing source path"),{target:{value:path}});fireEvent.click(screen.getByText("Request access to selected files"));const input=await screen.findByLabelText("Complete replacement content");fireEvent.change(input,{target:{value:"int a = 2;"}});fireEvent.click(screen.getByText("Prepare exact change"));await screen.findByLabelText("I reviewed every file in this batch");}
async function apply(){fireEvent.click(screen.getByLabelText("I reviewed every file in this batch"));fireEvent.click(screen.getByText("Request approval to write once"));}
afterEach(cleanup);
it("runs the real parent entry through separate read, reviewed write and rebuild requests",async()=>{
 const invoke=adapter(),active=vi.fn();render(wrap(<UEApprovedBuildAction preview={preview} invoke={invoke as never} onActiveChange={active} onConsumed={()=>{}}/>));
 fireEvent.click(screen.getByText("Request native approval and build once"));await screen.findByRole("heading",{name:"Source batch repair"});await readAndPrepare();
 expect((screen.getByText("Request approval to write once") as HTMLButtonElement).disabled).toBe(true);
 expect(screen.getByRole("region",{name:"Before"}).textContent).toContain("int a = 1;");expect(screen.getByRole("region",{name:"After"}).textContent).toContain("int a = 2;");
 await apply();await screen.findByText(/The edit, before-backup and result were saved/);
 expect(invoke.mock.calls.filter(([c])=>c==="approve_and_rebuild_ue_build_repair")).toHaveLength(0);
 fireEvent.click(screen.getByText("Request separate approval and rebuild"));await screen.findByText(/Build succeeded and the native receipt was saved/);
 expect(active.mock.calls.at(-1)).toEqual([false]);
 expect(invoke.mock.calls.filter(([c])=>c==="approve_and_apply_ue_build_repair")).toHaveLength(1);
 const calls=invoke.mock.calls as unknown[][];expect(calls.find(c=>c[0]==="approve_and_apply_ue_build_repair")?.[1]).toEqual({input:{selection,sessionId:sid,digest:change.nativePlanDigest}});
});
it("editing replacement invalidates the reviewed preview",async()=>{mount();await readAndPrepare();fireEvent.click(screen.getByLabelText("I reviewed every file in this batch"));fireEvent.change(screen.getByLabelText("Complete replacement content"),{target:{value:"int a = 3;"}});expect(screen.queryByText("Request approval to write once")).toBeNull();});
it("a declined write is consumed without rebuild",async()=>{const h=mount(adapter({approve_and_apply_ue_build_repair:()=>{throw Error("declined");}}));await readAndPrepare();await apply();await screen.findByRole("alert");expect(screen.queryByText("Request separate approval and rebuild")).toBeNull();expect(h.invoke.mock.calls.filter(([c])=>c==="approve_and_apply_ue_build_repair")).toHaveLength(1);});
it("a partial or unsaved write never enables rebuild",async()=>{mount(adapter({approve_and_apply_ue_build_repair:()=>({...applied(),persisted:false})}));await readAndPrepare();await apply();await screen.findByText(/Stopped without rebuilding/);expect(screen.queryByText("Request separate approval and rebuild")).toBeNull();});
it("a mismatched source preview is discarded",async()=>{mount(adapter({prepare_ue_build_repair:()=>({...change,preview:{...change.preview,files:[{...change.preview.files[0],path:"Source/Other.cpp"}]}})}));fireEvent.change(screen.getByLabelText("Project-relative existing source path"),{target:{value:path}});fireEvent.click(screen.getByText("Request access to selected files"));fireEvent.change(await screen.findByLabelText("Complete replacement content"),{target:{value:"int a = 2;"}});fireEvent.click(screen.getByText("Prepare exact change"));await screen.findByRole("alert");expect(screen.queryByText("Request approval to write once")).toBeNull();});
it("closing an idle session releases only the original native identity",async()=>{const h=mount();await readAndPrepare();h.unmount();await waitFor(()=>expect(h.invoke.mock.calls as unknown[][]).toContainEqual(["release_ue_build_repair",{input:{selection,sessionId:sid}}]));});
it("closing during read cancels then releases the late original reply",async()=>{
 let resolve:(v:unknown)=>void=()=>{};const h=mount(adapter({open_ue_build_repair:()=>new Promise(done=>{resolve=done;})}));
 fireEvent.change(screen.getByLabelText("Project-relative existing source path"),{target:{value:path}});fireEvent.click(screen.getByText("Request access to selected files"));h.unmount();
 resolve({sessionId:sid,snapshot});await waitFor(()=>expect(h.invoke.mock.calls.filter(([c])=>c==="release_ue_build_repair").length).toBeGreaterThan(1));
 expect(h.invoke.mock.calls as unknown[][]).toContainEqual(["cancel_approved_ue_build",{input:{projectId:preview.projectId,preparedId:preview.preparedId}}]);
 expect(h.rebuilt).not.toHaveBeenCalled();
});

it("StrictMode replay preserves the native session and real unmount releases it",async()=>{
 const invoke=adapter();const h=render(<StrictMode>{wrap(<UEBuildRepairAction preview={preview} runId={run} initialSessionId={sid} invoke={invoke as never} onActiveChange={()=>{}} onRebuilt={()=>{}}/>)}</StrictMode>);
 await Promise.resolve();expect(invoke.mock.calls.filter(([c])=>c==="release_ue_build_repair")).toHaveLength(0);
 await readAndPrepare();h.unmount();await waitFor(()=>expect(invoke.mock.calls.filter(([c])=>c==="release_ue_build_repair")).toHaveLength(1));
});

const secondPath="Source/Game/Game.Build.cs";
const batchSnapshot={...snapshot,files:[...snapshot.files,{path:secondPath,content:"// rules",sha256:"6".repeat(64),objectIdentity:"held-rules"}]};
const batchChange={...change,preview:{...change.preview,files:[...change.preview.files,{path:secondPath,before:"// rules",after:"// new rules",beforeHash:"6".repeat(64),afterHash:"7".repeat(64),beforeObjectIdentity:"held-rules"}]}};
function batchAdapter(partial=false){return adapter({open_ue_build_repair:()=>({sessionId:sid,snapshot:batchSnapshot}),prepare_ue_build_repair:()=>batchChange,approve_and_apply_ue_build_repair:()=>({...applied(),historyRunId:"9".repeat(32),receipt:{...applied().receipt,status:partial?"partial":"applied",effects:[...applied().receipt.effects,{path:secondPath,status:partial?"not_started":"applied",afterHash:partial?null:"7".repeat(64),afterObjectIdentity:partial?null:"held-rules"}]}})});}
async function prepareBatch(){fireEvent.change(screen.getByLabelText("Project-relative existing source path"),{target:{value:path+"\n"+secondPath}});fireEvent.click(screen.getByText("Request access to selected files"));fireEvent.change(await screen.findByLabelText("Complete replacement content: "+path),{target:{value:"int a = 2;"}});fireEvent.change(screen.getByLabelText("Complete replacement content: "+secondPath),{target:{value:"// new rules"}});fireEvent.click(screen.getByText("Prepare exact change"));await screen.findByLabelText("I reviewed every file in this batch");}
it("batch selects exact files, reviews each diff, writes once and requires separate rebuild",async()=>{const h=mount(batchAdapter());await prepareBatch();expect(screen.getAllByRole("region",{name:"Source change location"})).toHaveLength(2);expect(h.invoke.mock.calls as unknown[][]).toContainEqual(["open_ue_build_repair",{input:{selection,paths:[path,secondPath]}}]);expect(h.invoke.mock.calls as unknown[][]).toContainEqual(["prepare_ue_build_repair",{input:{selection,sessionId:sid,snapshotId:snapshot.snapshotId,files:[{path,after:"int a = 2;"},{path:secondPath,after:"// new rules"}]}}]);await apply();await screen.findByText(/The edit, before-backup and result were saved/);expect(screen.getByRole("region",{name:"Batch file results"}).textContent).toContain(secondPath);expect(h.invoke.mock.calls.filter(([c])=>c==="approve_and_rebuild_ue_build_repair")).toHaveLength(0);fireEvent.click(screen.getByText("Request separate approval and rebuild"));await waitFor(()=>expect(h.rebuilt).toHaveBeenCalledTimes(1));});
it("partial batch shows exact file outcomes and backup without retry or rebuild",async()=>{const h=mount(batchAdapter(true));await prepareBatch();await apply();const results=await screen.findByRole("region",{name:"Batch file results"});expect(results.textContent).toContain("not_started");expect(results.textContent).toContain("applied");expect(results.textContent).toContain("5".repeat(64));expect(results.textContent).toContain("9".repeat(32));expect(screen.queryByText("Request separate approval and rebuild")).toBeNull();expect((screen.getByText("Request approval to write once") as HTMLButtonElement).disabled).toBe(true);expect(h.invoke.mock.calls.filter(([c])=>c==="approve_and_apply_ue_build_repair")).toHaveLength(1);});
it("editing either batch file discards the complete reviewed preview",async()=>{mount(batchAdapter());await prepareBatch();fireEvent.click(screen.getByLabelText("I reviewed every file in this batch"));fireEvent.change(screen.getByLabelText("Complete replacement content: "+secondPath),{target:{value:"// changed again"}});expect(screen.queryByText("Request approval to write once")).toBeNull();expect(screen.queryByRole("region",{name:"Source change location"})).toBeNull();});
it("duplicate or oversized read scopes cannot be submitted",()=>{const h=mount();const input=screen.getByLabelText("Project-relative existing source path");for(const paths of [path+"\n"+path.toUpperCase(),Array.from({length:9},(_,i)=>`Source/File${i}.cpp`).join("\n")]){fireEvent.change(input,{target:{value:paths}});expect((screen.getByText("Request access to selected files") as HTMLButtonElement).disabled).toBe(true);}expect(h.invoke).not.toHaveBeenCalled();});
it("a batch response containing a duplicated file is rejected before approval",async()=>{mount(adapter({open_ue_build_repair:()=>({sessionId:sid,snapshot:{...batchSnapshot,files:[snapshot.files[0],snapshot.files[0]]}})}));fireEvent.change(screen.getByLabelText("Project-relative existing source path"),{target:{value:path+"\n"+secondPath}});fireEvent.click(screen.getByText("Request access to selected files"));await screen.findByRole("alert");expect(screen.queryByText("Prepare exact change")).toBeNull();});

const reverse={nativePlanDigest:"a".repeat(64),preview:{...change.preview,snapshotId:"f".repeat(64),previewId:"0".repeat(64),files:[{...change.preview.files[0],before:change.preview.files[0].after,after:change.preview.files[0].before,beforeHash:"4".repeat(64),afterHash:"1".repeat(64)}]}};
function restoreAdapter(options:{badPreview?:boolean;decline?:boolean;unsettled?:boolean}={}){
 let writes=0;
 return adapter({open_ue_build_repair:()=>({sessionId:sid,snapshot:batchSnapshot}),prepare_ue_build_repair:()=>batchChange,
  prepare_ue_build_restore:()=>options.badPreview?{...reverse,preview:{...reverse.preview,files:[{...reverse.preview.files[0],after:"unrelated change"}]}}:reverse,
  approve_and_apply_ue_build_repair:()=>{
   if(writes++===0)return {...applied(),restoreAvailable:true,hostSettled:!options.unsettled,historyRunId:"9".repeat(32),receipt:{...applied().receipt,status:"partial",effects:[...applied().receipt.effects,{path:secondPath,status:"not_started",afterHash:null,afterObjectIdentity:null}]}};
   if(options.decline)throw Error("ue_repair_declined");
   return {...applied(),restoration:true,restoreAvailable:false,historyRunId:"8".repeat(32),receipt:{...applied().receipt,previewId:reverse.preview.previewId,effects:[{...applied().receipt.effects[0],afterHash:"1".repeat(64)}]}};
  }});
}
it("live restore requires a fresh diff review and separate write request, then never rebuilds",async()=>{
 const h=mount(restoreAdapter());await prepareBatch();await apply();fireEvent.click(await screen.findByText("Prepare restore of confirmed writes"));
 const button=await screen.findByText("Request approval to restore once");expect((button as HTMLButtonElement).disabled).toBe(true);
 expect(h.invoke.mock.calls.filter(([c])=>c==="approve_and_apply_ue_build_repair")).toHaveLength(1);
 expect(screen.getAllByRole("region",{name:"Source change location"})).toHaveLength(1);
 fireEvent.click(screen.getByLabelText("I reviewed every file in this batch"));fireEvent.click(button);
 await screen.findByText(/Selected files restored; the restore backup and result were saved/);
 const calls=h.invoke.mock.calls as unknown[][];expect(calls).toContainEqual(["prepare_ue_build_restore",{input:{selection,sessionId:sid,digest:change.nativePlanDigest}}]);
 expect(calls).toContainEqual(["approve_and_apply_ue_build_repair",{input:{selection,sessionId:sid,digest:reverse.nativePlanDigest}}]);
 expect(calls.filter(c=>c[0]==="approve_and_apply_ue_build_repair")).toHaveLength(2);
 expect(screen.queryByText("Request separate approval and rebuild")).toBeNull();expect(screen.queryByText("Prepare restore of confirmed writes")).toBeNull();expect(h.rebuilt).not.toHaveBeenCalled();
});
it("live restore rejects a reverse preview that changes backup content",async()=>{
 const h=mount(restoreAdapter({badPreview:true}));await prepareBatch();await apply();fireEvent.click(await screen.findByText("Prepare restore of confirmed writes"));await screen.findByRole("alert");
 expect(screen.queryByText("Request approval to restore once")).toBeNull();expect(h.invoke.mock.calls.filter(([c])=>c==="approve_and_apply_ue_build_repair")).toHaveLength(1);
});
it("live restore decline consumes the attempt and cannot rebuild or repeat",async()=>{
 const h=mount(restoreAdapter({decline:true}));await prepareBatch();await apply();fireEvent.click(await screen.findByText("Prepare restore of confirmed writes"));const button=await screen.findByText("Request approval to restore once");fireEvent.click(screen.getByLabelText("I reviewed every file in this batch"));fireEvent.click(button);await screen.findByRole("alert");expect((button as HTMLButtonElement).disabled).toBe(true);expect(h.invoke.mock.calls.filter(([c])=>c==="approve_and_apply_ue_build_repair")).toHaveLength(2);expect(h.rebuilt).not.toHaveBeenCalled();
});
it("live restore is unavailable without host settlement even if a reply requests it",async()=>{
 mount(restoreAdapter({unsettled:true}));await prepareBatch();await apply();await screen.findByText(/Stopped without rebuilding/);expect(screen.queryByText("Prepare restore of confirmed writes")).toBeNull();
});

it("repair chain attaches fresh rebuild diagnostics and requires a new review and approval for each round",async()=>{
 let round=0;const runs=[run,"f".repeat(32),"9".repeat(32)],sessions=[sid,"8".repeat(32),"7".repeat(32)];
 const currentBinding=()=>({...binding,runId:runs[round],hostSessionId:sessions[round]});
 const snap=()=>({...snapshot,binding:currentBinding(),files:[{...snapshot.files[0],content:round===0?"int a = 1;":"int a = 2;"}]});
 const plan=()=>({...change,preview:{...change.preview,binding:currentBinding(),files:[{...change.preview.files[0],before:snap().files[0].content,after:round===0?"int a = 2;":"int a = 3;"}]}});
 const result=()=>({...build(),runId:runs[round],repairSessionId:round<2?sessions[round]:null,repairAvailable:round<2,repairCycle:{chainId:run,rebuilds:round,maxRebuilds:3,previousRunId:round?runs[round-1]:null,status:round<2?"awaiting_review":"succeeded"},result:{...build().result,owner:{...build().result.owner,runId:runs[round]},status:round<2?"failed":"succeeded",exitCode:round<2?6:0,stdout:`E:/Synthetic/Source/Game/A.cpp(1): error C2065: round_${round}`}});
 const invoke=vi.fn(async(command:string,payload?:unknown)=>{
  if(command==="approve_and_run_ue_build")return result();
  if(command==="open_ue_build_repair"){expect((payload as any).input.selection.runId).toBe(runs[round]);return {sessionId:sessions[round],snapshot:snap()};}
  if(command==="prepare_ue_build_repair")return plan();
  if(command==="approve_and_apply_ue_build_repair")return {...applied(),receipt:{...applied().receipt,binding:currentBinding()}};
  if(command==="approve_and_rebuild_ue_build_repair"){round++;return result();}
  if(command==="release_ue_build_repair")return true;
  throw Error(command);
 });
 render(wrap(<UEApprovedBuildAction preview={preview} invoke={invoke as never} onActiveChange={()=>{}} onConsumed={()=>{}}/>));
 fireEvent.click(screen.getByText("Request native approval and build once"));await screen.findByText(/awaiting another review and approval/);
 for(let i=0;i<2;i++){
  fireEvent.change(screen.getByLabelText("Project-relative existing source path"),{target:{value:path}});fireEvent.click(screen.getByText("Request access to selected files"));
  const input=await screen.findByLabelText("Complete replacement content");expect((input as HTMLTextAreaElement).value).toBe(`int a = ${i+1};`);
  fireEvent.change(input,{target:{value:`int a = ${i+2};`}});fireEvent.click(screen.getByText("Prepare exact change"));await screen.findByLabelText("I reviewed every file in this batch");
  expect((screen.getByText("Request approval to write once") as HTMLButtonElement).disabled).toBe(true);
  await apply();fireEvent.click(await screen.findByText("Request separate approval and rebuild"));
  if(i===0){await screen.findByText(/Approved rebuilds: 1/);expect(screen.queryByText("Request approval to write once")).toBeNull();expect(screen.getByText(/round_1/)).toBeTruthy();}
 }
 await screen.findByText("Build verified; repair chain complete");expect(screen.queryByText("Request access to selected files")).toBeNull();
 expect(invoke.mock.calls.filter(([c])=>c==="approve_and_rebuild_ue_build_repair")).toHaveLength(2);
 expect(invoke.mock.calls.filter(([c])=>c==="approve_and_apply_ue_build_repair")).toHaveLength(2);
});
it("repair chain can be stopped without requesting a model, write or rebuild",async()=>{
 const invoke=adapter();render(wrap(<UEApprovedBuildAction preview={preview} invoke={invoke as never} onActiveChange={()=>{}} onConsumed={()=>{}}/>));
 fireEvent.click(screen.getByText("Request native approval and build once"));fireEvent.click(await screen.findByText("Stop this repair chain"));await screen.findByText("Repair chain stopped by user");expect(screen.queryByText("Request access to selected files")).toBeNull();
 expect(invoke.mock.calls.every(([c])=>["approve_and_run_ue_build","release_ue_build_repair"].includes(c))).toBe(true);
});
