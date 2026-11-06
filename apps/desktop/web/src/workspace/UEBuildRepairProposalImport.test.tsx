import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { parseSingleFileBuildRepairProposal } from "@uagent/runtime";
import { I18nProvider, createLocaleStore } from "../i18n";
import { UEBuildRepairProposalImport } from "./UEBuildRepairProposalImport";
import { UEBuildRepairAction } from "./UEBuildRepairAction";
import type { UEBuildPreviewReceipt } from "../runtime/native-ue-build-preview";
const file={path:"Source/Game/A.cpp",content:"int a = 1;"};
const response=(after="int a = 2;")=>JSON.stringify({files:[{path:file.path,after}]});
function wrap(node:React.ReactNode){return <I18nProvider store={createLocaleStore({initialLocale:"en",storage:null})}>{node}</I18nProvider>;}
afterEach(cleanup);
it.each([
 ["different file",{files:[{path:"Source/Game/Other.cpp",after:"x"}]}],
 ["command payload",{files:[{path:file.path,after:"x"}],command:"execute"}],
 ["approval payload",{files:[{path:file.path,after:"x",approved:true}]}],
 ["multiple files",{files:[{path:file.path,after:"x"},{path:"Source/Game/B.cpp",after:"x"}]}],
 ["no change",{files:[{path:file.path,after:file.content}]}],
 ["binary source",{files:[{path:file.path,after:"x\0y"}]}],
] as const)("rejects %s",(_,value)=>{expect(()=>parseSingleFileBuildRepairProposal(JSON.stringify(value),file)).toThrow();});
it("keeps the candidate local until explicitly adopted, then clears it",()=>{
 const use=vi.fn();render(wrap(<UEBuildRepairProposalImport file={file} disabled={false} onUse={use}/>));
 fireEvent.change(screen.getByLabelText("Model response JSON (local processing only)"),{target:{value:response()}});fireEvent.click(screen.getByText("Validate suggestion for this file"));
 expect(use).not.toHaveBeenCalled();expect(screen.getByText("int a = 2;")).toBeTruthy();
 fireEvent.click(screen.getByText("Use as content for review"));expect(use.mock.calls).toEqual([["int a = 2;"]]);expect(screen.queryByText("Use as content for review")).toBeNull();
});
it("editing the response clears its previously validated candidate",()=>{
 render(wrap(<UEBuildRepairProposalImport file={file} disabled={false} onUse={()=>{}}/>));
 const input=screen.getByLabelText("Model response JSON (local processing only)");fireEvent.change(input,{target:{value:response()}});fireEvent.click(screen.getByText("Validate suggestion for this file"));fireEvent.change(input,{target:{value:"invalid"}});expect(screen.queryByText("Use as content for review")).toBeNull();
});
it("adoption invalidates an existing native preview and never requests a write or rebuild",async()=>{
 const sid="e".repeat(32),run="c".repeat(32),fingerprint="b".repeat(64);
 const preview={projectId:"root:abc",preparedId:"a".repeat(32),preview:{fingerprint}} as UEBuildPreviewReceipt;
 const binding={projectId:preview.projectId,runId:run,profileFingerprint:fingerprint,hostSessionId:sid,rootObjectId:"root"};
 const snapshot={binding,diagnostic:{},snapshotId:"d".repeat(64),files:[{...file,sha256:"1".repeat(64),objectIdentity:"file"}]};
 const invoke=vi.fn(async(command:string)=>{
  if(command==="open_ue_build_repair")return {sessionId:sid,snapshot};
  if(command==="prepare_ue_build_repair")return {nativePlanDigest:"2".repeat(64),preview:{binding,diagnostic:{},snapshotId:snapshot.snapshotId,previewId:"3".repeat(64),files:[{path:file.path,before:file.content,after:"int a = 2;",beforeHash:"1".repeat(64),afterHash:"4".repeat(64),beforeObjectIdentity:"file"}]}};
  if(command==="release_ue_build_repair")return true;
  throw Error("unexpected IPC: "+command);
 });
 render(wrap(<UEBuildRepairAction preview={preview} runId={run} initialSessionId={sid} invoke={invoke as never} onActiveChange={()=>{}} onRebuilt={()=>{}}/>));
 fireEvent.change(screen.getByLabelText("Project-relative existing source path"),{target:{value:file.path}});fireEvent.click(screen.getByText("Request access to this file"));
 const replacement=await screen.findByLabelText("Complete replacement content");fireEvent.change(replacement,{target:{value:"int a = 2;"}});fireEvent.click(screen.getByText("Prepare exact change"));fireEvent.click(await screen.findByLabelText("I reviewed the complete before and after content"));
 fireEvent.change(screen.getByLabelText("Model response JSON (local processing only)"),{target:{value:response("int a = 3;")}});fireEvent.click(screen.getByText("Validate suggestion for this file"));fireEvent.click(screen.getByText("Use as content for review"));
 expect((replacement as HTMLTextAreaElement).value).toBe("int a = 3;");expect(screen.queryByText("Request approval to write once")).toBeNull();expect(invoke.mock.calls.map(c=>c[0])).toEqual(["open_ue_build_repair","prepare_ue_build_repair"]);
});
