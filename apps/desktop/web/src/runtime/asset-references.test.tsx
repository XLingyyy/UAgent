import {it,expect,vi,afterEach} from "vitest";
import {render,screen,fireEvent,cleanup} from "@testing-library/react";
import {I18nProvider,createLocaleStore} from "../i18n";
import {AssetReferenceReader} from "../workspace/AssetReferenceReader";
import {readAssetReferences} from "./native-asset-references";
import {selectBlueprintReadSession} from "./native-blueprint-read";
import {createProjectReadToolRegistry,defaultInvestigationLimits,PROJECT_READ_TOOL_IDS} from "./project-read-tools";
import type {NativeProjectAdapter} from "./project-native-adapter";
const session={projectId:"root:synthetic-references",rootId:"native-root",sessionId:"owned-editor"},packageName="/Game/References/Target";
function fixture(){return {schemaVersion:1,projectId:session.projectId,rootId:session.rootId,editorSessionId:session.sessionId,packageName,rootObjectId:"root-object",observationGeneration:1,status:"observed",cacheable:false,result:{schemaVersion:"uagent.semantic.result.v2",projectKey:"synthetic-project",instanceId:"synthetic-instance",operation:"uagent.v2.asset.references",mutationCount:0,observedAtUtc:"2026-11-05T00:00:00Z",data:{packageName,referenceKind:"on_disk_package_dependencies_only",assetRegistryLoading:true,dependencies:["/Game/References/Dependency","/Script/Engine"],referencers:["/Game/Other/Referrer"],truncated:false,source:{packageName,cacheable:false,origin:"editor_or_asset_registry_observation",diskCoherence:"not_established"}}}};}
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("native call stays bound to selected project and rejects wrong peer or malformed reference names",async()=>{
 const invoke=vi.fn().mockResolvedValue(fixture());expect((await readAssetReferences(session,packageName,undefined,invoke)).result.data.dependencies).toHaveLength(2);
 expect(invoke).toHaveBeenCalledWith("read_ue_asset_references",{input:{projectId:session.projectId,rootId:session.rootId,editorSessionId:session.sessionId,packageName}});
 invoke.mockResolvedValue({...fixture(),editorSessionId:"other"});await expect(readAssetReferences(session,packageName,undefined,invoke)).rejects.toThrow("invalid_reference");
 const bad=fixture();bad.result.data.dependencies=["C:/Other"];invoke.mockResolvedValue(bad);await expect(readAssetReferences(session,packageName,undefined,invoke)).rejects.toThrow("invalid_reference");
});
it("cancellation discards a late registry result",async()=>{const abort=new AbortController();const invoke=vi.fn(async()=>{abort.abort();return fixture();});await expect(readAssetReferences(session,packageName,abort.signal,invoke)).rejects.toThrow("cancelled");});
it("UI requires explicit query and displays dependencies, referencers and incomplete provenance",async()=>{
 const invoke=vi.fn().mockResolvedValue(fixture());render(<I18nProvider store={createLocaleStore({initialLocale:"en",storage:null})}><AssetReferenceReader session={session} initialPackage={packageName} invoke={invoke}/></I18nProvider>);
 expect(invoke).not.toHaveBeenCalled();fireEvent.click(screen.getByText("Confirm and query references"));await screen.findByLabelText("Reference query result");expect(screen.getByText("/Game/Other/Referrer")).toBeTruthy();expect(screen.getByRole("status").textContent).toContain("Incomplete");expect(screen.getByText(/Source: current project's Asset Registry/)).toBeTruthy();expect(invoke).toHaveBeenCalledTimes(1);
});
function registryContext(){const adapter={source:"native",getProject:()=>({id:session.projectId,trustState:"trusted",rootRef:"synthetic-root"})} as unknown as NativeProjectAdapter;
 const registry=createProjectReadToolRegistry(adapter);const scope={id:"scope",runId:"run",projectId:session.projectId,rootRef:"synthetic-root",conversationId:"chat",providerId:"mock",modelId:"mock",endpoint:"https://invalid.example",mode:"read_only" as const,readPrefixes:["Content/References"],sharePrefixes:[] as string[],toolIds:["ue.asset_references"],expiresAt:Date.now()+60000,limits:defaultInvestigationLimits()};
 return {registry,scope,context:{runId:"run",projectId:session.projectId,scope,signal:new AbortController().signal,isCurrent:()=>true},call:{id:"ref-call",name:"ue_asset_references",arguments:JSON.stringify({packageName})}};
}
it("investigation requires sharing permission and omits every out-of-scope related name",async()=>{
 const invoke=vi.fn().mockResolvedValue(fixture());vi.stubGlobal("__TAURI_INTERNALS__",{invoke});const clear=selectBlueprintReadSession(session);try{
  const h=registryContext();expect(PROJECT_READ_TOOL_IDS).toContain("ue.asset_references");expect((await h.registry.execute(h.call,h.context)).status).not.toBe("completed");expect(invoke).not.toHaveBeenCalled();
  h.scope.sharePrefixes=["Content/References"];const result=await h.registry.execute({...h.call,id:"permitted"},h.context);expect(result.status).toBe("completed");expect(result.truncated).toBe(true);expect(result.sources).toEqual([]);
  const data=result.output as any;expect(data.observation.result.data.dependencies).toEqual(["/Game/References/Dependency"]);expect(data.observation.result.data.referencers).toEqual([]);expect(data.omittedOutsideScope).toEqual({dependencies:1,referencers:1});expect(JSON.stringify(result.output)).not.toContain("/Game/Other");expect(JSON.stringify(result.output)).not.toContain("/Script/Engine");
 }finally{clear();}
});
it("a changed selected editor cannot return an old tool observation",async()=>{
 let clearNext:()=>void=()=>{};const clear=selectBlueprintReadSession(session);const invoke=vi.fn(async()=>{clearNext=selectBlueprintReadSession({...session,sessionId:"new"});return fixture();});vi.stubGlobal("__TAURI_INTERNALS__",{invoke});try{const h=registryContext();h.scope.sharePrefixes=["Content/References"];expect((await h.registry.execute(h.call,h.context)).status).not.toBe("completed");}finally{clear();clearNext();}
});
