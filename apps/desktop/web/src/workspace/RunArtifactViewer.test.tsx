import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createSha256Hash } from "@uagent/runtime";
import { I18nProvider, createLocaleStore } from "../i18n";
import { createNativeRunHistory,type NativeRunArchive } from "../runtime/native-run-history";
import { RunArtifactViewer } from "./RunArtifactViewer";
const content=JSON.stringify({preview:{preview:{files:[{path:"Source/Game/A.cpp",before:"int a = 1;\n<script>inert</script>",after:"int a = 2;"}]}}});
const sha=createSha256Hash(content);
const archive={descriptor:{projectId:"A",runId:"r"},snapshot:{artifacts:[{id:"nativeRepairBefore",sha256:sha,mediaType:"application/json"}]}} as unknown as NativeRunArchive;
function wrap(node:React.ReactNode){return <I18nProvider store={createLocaleStore({initialLocale:"en",storage:null})}>{node}</I18nProvider>;}
afterEach(cleanup);
it("loads saved before content through scoped read-only IPC and verifies its digest",async()=>{
 const invoke=vi.fn(async()=>({schemaVersion:1,projectId:"A",runId:"r",referenceId:"nativeRepairBefore",sha256:sha,content}));const history=createNativeRunHistory(invoke as never);
 const {container}=render(wrap(<RunArtifactViewer archive={archive} load={history.artifact}/>));fireEvent.click(screen.getByText("Repair before-backup and plan"));
 await screen.findAllByText(/int a = 1/);expect(container.querySelector("script")).toBeNull();
 expect(invoke.mock.calls).toEqual([["read_native_run_artifact",{input:{schemaVersion:1,projectId:"A",runId:"r",referenceId:"nativeRepairBefore"}}]]);
 expect(screen.queryByText("Restore")).toBeNull();expect(screen.getByText(/not the current file/)).toBeTruthy();
});
it.each(["project","digest","content"])("rejects a changed %s receipt",async mode=>{
 const value={schemaVersion:1,projectId:"A",runId:"r",referenceId:"nativeRepairBefore",sha256:sha,content};
 if(mode==="project")value.projectId="B";if(mode==="digest")value.sha256="0".repeat(64);if(mode==="content")value.content="{}";
 const history=createNativeRunHistory(vi.fn(async()=>value) as never);await expect(history.artifact!("A","r","nativeRepairBefore",sha)).rejects.toThrow();
});
it("switching runs discards a late old record",async()=>{
 let complete:(value:string)=>void=()=>{};const load=vi.fn(()=>new Promise<string>(r=>{complete=r;}));
 const h=render(wrap(<RunArtifactViewer archive={archive} load={load}/>));fireEvent.click(screen.getByText("Repair before-backup and plan"));
 h.rerender(wrap(<RunArtifactViewer archive={{...archive,descriptor:{...archive.descriptor,runId:"other"}}} load={load}/>));complete(content);
 await waitFor(()=>expect(screen.queryByText(/int a = 1/)).toBeNull());expect(screen.queryByText("Complete original JSON record")).toBeNull();
});
it("a display limit failure never presents partial source",async()=>{
 render(wrap(<RunArtifactViewer archive={archive} load={async()=>{throw Error("artifactDisplayLimit");}}/>));fireEvent.click(screen.getByText("Repair before-backup and plan"));await screen.findByRole("alert");expect(screen.queryByText(/int a = 1/)).toBeNull();
});
it("unknown artifact references cannot invoke the native reader",async()=>{
 const invoke=vi.fn();const history=createNativeRunHistory(invoke);await expect(history.artifact!("A","r","arbitrary-path",sha)).rejects.toThrow();expect(invoke).not.toHaveBeenCalled();
});
