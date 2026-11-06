import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,it,expect,vi} from "vitest";
import {parseMultiFileBuildRepairProposal} from "@uagent/runtime";
import {I18nProvider,createLocaleStore} from "../i18n";
import {UEBuildRepairBatchProposalImport} from "./UEBuildRepairBatchProposalImport";
import {UEBuildRepairAction} from "./UEBuildRepairAction";
import type {UEBuildPreviewReceipt} from "../runtime/native-ue-build-preview";
const files=[{path:"Source/Game/A.cpp",content:"int a = 1;"},{path:"Source/Game/B.cpp",content:"int b = 1;"}];
const suggestions=files.map((f,i)=>({path:f.path,after:`int ${i?"b":"a"} = 2;`}));
const response=JSON.stringify({files:suggestions});
const wrap=(node:React.ReactNode)=><I18nProvider store={createLocaleStore({initialLocale:"en",storage:null})}>{node}</I18nProvider>;
afterEach(async()=>{cleanup();await Promise.resolve();});
function importSuggestions(text=response){fireEvent.change(screen.getByLabelText("Multi-file suggestion JSON (local processing only)"),{target:{value:text}});fireEvent.click(screen.getByText("Validate batch suggestions"));}
it.each([
 ["outside scope",{files:[suggestions[0],{path:"Source/Other.cpp",after:"x"}]}],
 ["duplicate path",{files:[suggestions[0],suggestions[0]]}],
 ["injected command",{files:suggestions,command:"run"}],
 ["binary content",{files:[{...suggestions[0],after:"x\0y"}]}],
])("rejects entire import with %s",(_,value)=>{expect(()=>parseMultiFileBuildRepairProposal(JSON.stringify(value),files)).toThrow();});
it("permits a selected subset, skips unchanged entries and retains existing size limits",()=>{
 expect(parseMultiFileBuildRepairProposal(JSON.stringify({files:[suggestions[1],{path:files[0].path,after:files[0].content}]}),files)).toEqual([suggestions[1]]);
 expect(()=>parseMultiFileBuildRepairProposal(JSON.stringify({files:[{path:files[0].path,after:"x".repeat(256*1024+1)}]}),files)).toThrow();
});
it("shows local per-file diffs and adopts only an explicit selection",()=>{
 const use=vi.fn();render(wrap(<UEBuildRepairBatchProposalImport files={files} disabled={false} onUse={use}/>));importSuggestions();expect(use).not.toHaveBeenCalled();expect(screen.getAllByRole("region",{name:"Source change location"})).toHaveLength(2);
 fireEvent.click(screen.getByText("Adopt file: "+files[1].path));expect(use.mock.calls).toEqual([[files[1].path,suggestions[1].after]]);
 expect((screen.getByText("Adopted: "+files[1].path) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.change(screen.getByLabelText("Multi-file suggestion JSON (local processing only)"),{target:{value:"invalid"}});expect(screen.queryByText("Adopt file: "+files[0].path)).toBeNull();
});
it("a new snapshot cannot adopt a previously validated suggestion",()=>{
 const use=vi.fn();const h=render(wrap(<UEBuildRepairBatchProposalImport files={files} disabled={false} onUse={use}/>));importSuggestions();h.rerender(wrap(<UEBuildRepairBatchProposalImport files={files.map(f=>({...f,content:f.content+" // new"}))} disabled={false} onUse={use}/>));expect(screen.queryByText("Adopt file: "+files[0].path)).toBeNull();expect(use).not.toHaveBeenCalled();
});
function mount(partial=false){
 const sid="e".repeat(32),run="c".repeat(32),fingerprint="b".repeat(64),snapshotId="d".repeat(64);
 const preview={projectId:"root:synthetic",preparedId:"a".repeat(32),preview:{fingerprint}} as UEBuildPreviewReceipt;
 const binding={projectId:preview.projectId,runId:run,profileFingerprint:fingerprint,hostSessionId:sid,rootObjectId:"synthetic-root"};
 const snapshot={binding,diagnostic:{},snapshotId,files:files.map((f,i)=>({...f,sha256:String(i+1).repeat(64),objectIdentity:"file-"+i}))};
 let planned:any[]=[];const rebuilt=vi.fn();
 const invoke=vi.fn(async(command:string,payload?:unknown)=>{
  const input=(payload as any)?.input;
  if(command==="open_ue_build_repair")return {sessionId:sid,snapshot};
  if(command==="prepare_ue_build_repair"){
   planned=input.files.map((replacement:{path:string;after:string})=>{const before=snapshot.files.find(f=>f.path===replacement.path)!;return {path:before.path,before:before.content,after:replacement.after,beforeHash:before.sha256,afterHash:"4".repeat(64),beforeObjectIdentity:before.objectIdentity};});
   return {nativePlanDigest:"2".repeat(64),preview:{binding,diagnostic:{},snapshotId,previewId:"3".repeat(64),files:planned}};
  }
  if(command==="approve_and_apply_ue_build_repair")return {persisted:true,hostSettled:true,historyRunId:"9".repeat(32),receipt:{binding,previewId:"3".repeat(64),status:partial?"partial":"applied",recoveryRecord:"5".repeat(64),effects:planned.map((f,i)=>({path:f.path,status:partial&&i===1?"not_started":"applied",afterHash:partial&&i===1?null:f.afterHash,afterObjectIdentity:partial&&i===1?null:f.beforeObjectIdentity}))}};
  if(command==="release_ue_build_repair")return true;
  throw Error("unexpected call "+command);
 });
 render(wrap(<UEBuildRepairAction preview={preview} runId={run} initialSessionId={sid} invoke={invoke as never} onActiveChange={()=>{}} onRebuilt={rebuilt}/>));
 return {invoke,rebuilt};
}
async function read(){fireEvent.change(screen.getByLabelText("Project-relative existing source path"),{target:{value:files.map(f=>f.path).join("\n")}});fireEvent.click(screen.getByText("Request access to selected files"));await screen.findByLabelText("Multi-file suggestion JSON (local processing only)");}
it.each([false,true])("adopted batch reuses one native write and existing result/backup handling, partial=%s",async partial=>{
 const h=mount(partial);await read();importSuggestions();for(const f of files)fireEvent.click(screen.getByText("Adopt file: "+f.path));expect(h.invoke.mock.calls.map(c=>c[0])).toEqual(["open_ue_build_repair"]);
 fireEvent.click(screen.getByText("Prepare exact change"));const review=await screen.findByLabelText("I reviewed every file in this batch");
 expect((screen.getByText("Request approval to write once") as HTMLButtonElement).disabled).toBe(true);
 expect((h.invoke.mock.calls.find(c=>c[0]==="prepare_ue_build_repair")![1] as any).input.files).toEqual(suggestions);
 fireEvent.click(review);fireEvent.click(screen.getByText("Request approval to write once"));const outcomes=await screen.findByRole("region",{name:"Batch file results"});
 expect(outcomes.textContent).toContain("5".repeat(64));expect(outcomes.textContent).toContain(files[1].path);expect(outcomes.textContent).toContain(partial?"not_started":"applied");
 expect(h.invoke.mock.calls.filter(c=>c[0]==="approve_and_apply_ue_build_repair")).toHaveLength(1);expect(h.rebuilt).not.toHaveBeenCalled();
 expect(Boolean(screen.queryByText("Request separate approval and rebuild"))).toBe(!partial);
});
it("a later file adoption invalidates prior batch approval and leaves unselected files unchanged",async()=>{
 const h=mount();await read();importSuggestions();fireEvent.click(screen.getByText("Adopt file: "+files[0].path));expect((screen.getByLabelText("Complete replacement content: "+files[1].path) as HTMLTextAreaElement).value).toBe(files[1].content);
 fireEvent.click(screen.getByText("Prepare exact change"));fireEvent.click(await screen.findByLabelText("I reviewed every file in this batch"));
 expect((h.invoke.mock.calls.find(c=>c[0]==="prepare_ue_build_repair")![1] as any).input.files).toEqual([suggestions[0]]);
 fireEvent.click(screen.getByText("Adopt file: "+files[1].path));await waitFor(()=>expect(screen.queryByText("Request approval to write once")).toBeNull());expect(h.invoke.mock.calls.some(c=>c[0]==="approve_and_apply_ue_build_repair")).toBe(false);
});
