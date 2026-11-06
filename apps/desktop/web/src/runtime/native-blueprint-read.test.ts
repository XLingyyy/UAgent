import {describe,it,expect,vi} from "vitest";
import {blueprintPath,readBlueprint,selectBlueprintReadSession,selectedBlueprintReadSession} from "./native-blueprint-read";
const session={projectId:"root:a",rootId:"r",sessionId:"s"},packageName="/Game/UAgentBuildLab/Pickup_T13/BP_Test";
function fixture(){return {schemaVersion:1,...session,editorSessionId:session.sessionId,packageName,rootObjectId:"file:1",observationGeneration:1,status:"observed",cacheable:false,result:{operation:"uagent.v2.blueprint.describe",mutationCount:0,data:{packageName,loadPolicy:"already_loaded_only"}}};}
describe("native Blueprint read",()=>{
 it("maps project asset scope and rejects traversal",()=>{expect(blueprintPath(packageName)).toBe("Content/UAgentBuildLab/Pickup_T13/BP_Test.uasset");for(const p of ["/Engine/Other","/Game/UAgentBuildLab/Pickup_T13/../A",packageName+".BP_Test"])expect(()=>blueprintPath(p)).toThrow();});
 it("passes request data only and checks returned binding",async()=>{const invoke=vi.fn().mockResolvedValue(fixture());expect((await readBlueprint(session,packageName,undefined,invoke)).status).toBe("observed");expect(invoke).toHaveBeenCalledWith("read_ue_blueprint_structure",{input:{projectId:"root:a",rootId:"r",editorSessionId:"s",packageName}});invoke.mockResolvedValue({...fixture(),editorSessionId:"other"});await expect(readBlueprint(session,packageName,undefined,invoke)).rejects.toThrow("invalid_response");});
 it("discards late result after cancellation",async()=>{const c=new AbortController();const invoke=vi.fn().mockImplementation(async()=>{c.abort();return fixture();});await expect(readBlueprint(session,packageName,c.signal,invoke)).rejects.toThrow("cancelled");});
 it("old cleanup cannot remove replacement selected session",()=>{const clear=selectBlueprintReadSession(session);const clear2=selectBlueprintReadSession({...session,sessionId:"new"});clear();expect(selectedBlueprintReadSession("root:a")?.sessionId).toBe("new");expect(selectedBlueprintReadSession("root:b")).toBe(null);clear2();expect(selectedBlueprintReadSession("root:a")).toBe(null);});
});

it("investigation registry dispatches the native read only within approved read and sharing scope",async()=>{
 const {createProjectReadToolRegistry,defaultInvestigationLimits}=await import("./project-read-tools");
 const invoke=vi.fn().mockResolvedValue(fixture());vi.stubGlobal("__TAURI_INTERNALS__",{invoke});
 const clear=selectBlueprintReadSession(session);
 try{
 const adapter={source:"native",getProject:()=>({id:session.projectId,trustState:"trusted",rootRef:"trusted-root"})} as unknown as import("./project-native-adapter").NativeProjectAdapter;
 const registry=createProjectReadToolRegistry(adapter);
 const scope={id:"scope",runId:"run",projectId:session.projectId,rootRef:"trusted-root",conversationId:"chat",providerId:"mock",modelId:"mock",endpoint:"https://invalid.example",mode:"read_only" as const,readPrefixes:["Content/UAgentBuildLab/Pickup_T13"],sharePrefixes:[] as string[],toolIds:["ue.blueprint_structure"],expiresAt:Date.now()+60000,limits:defaultInvestigationLimits()};
 const context={runId:"run",projectId:session.projectId,scope,signal:new AbortController().signal,isCurrent:()=>true};
 const call={id:"one",name:"ue_blueprint_structure",arguments:JSON.stringify({packageName})};
 expect((await registry.execute(call,context)).status).not.toBe("completed");expect(invoke).not.toHaveBeenCalled();
 scope.sharePrefixes=["Content/UAgentBuildLab/Pickup_T13"];
 const result=await registry.execute({...call,id:"two"},context);expect(result.status).toBe("completed");expect(result.output).toMatchObject({observation:{editorSessionId:"s",cacheable:false}});expect(result.sources).toEqual([]);expect(invoke).toHaveBeenCalledTimes(1);
 }finally{clear();vi.unstubAllGlobals();}
});

it("maps ordinary project Blueprint paths without a Lab marker",()=>{expect(blueprintPath("/Game/Characters/BP_Hero")).toBe("Content/Characters/BP_Hero.uasset");});
