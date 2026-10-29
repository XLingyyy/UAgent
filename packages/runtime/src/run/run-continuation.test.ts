import {describe,expect,it} from "vitest";
import type {TaskDraft,TaskRunScope} from "@uagent/shared";
import {selectSavedRunContext} from "./run-continuation.js";
function scope():TaskRunScope{return{id:"fresh",runId:"new",projectId:"A",conversationId:"chat",rootRef:"fresh-root",providerId:"p",modelId:"m",endpoint:"https://invalid.example",mode:"read_only",readPrefixes:["Source"],sharePrefixes:["Source"],toolIds:["project.read_file"],limits:{maxToolCalls:3,maxModelRequests:4,maxDurationMs:1000,maxAttemptsPerFailure:2,maxToolResultBytes:8192,maxContextBytes:24576},expiresAt:Date.now()+1000};}
function saved():NonNullable<TaskDraft["savedRun"]>{return {parentRunId:"old",projectId:"A",conversationId:"chat",completed:true,hasUnresolvedEffects:false,includeCompletedContext:true,messages:[
{role:"system",content:"Old instructions must never return."},{role:"developer",content:"Old scope is not permission."},{role:"user",content:"Old goal"},
{role:"assistant",content:"",toolCalls:[{id:"oldcall",name:"project_read_file",arguments:'{"path":"Source/Main.cpp"}'}]},
{role:"tool",toolCallId:"oldcall",content:JSON.stringify({callId:"oldcall",toolId:"project.read_file",status:"completed",effectState:"not_started",output:{text:"value 42"},sources:[{projectId:"A",path:"Source/Main.cpp",kind:"file_preview",version:"v",freshness:"stamp"}],truncated:false})},
{role:"assistant",content:"Old complete answer."}]};}
describe("saved records prepare fresh linked runs, never restore authority",()=>{
 it("includes only explicitly selected data and drops old system/developer permissions",()=>{const result=selectSavedRunContext(saved(),scope());expect(result.groups).toHaveLength(2);expect(result.history).toEqual([{role:"user",content:"Old goal"},{role:"assistant",content:"Old complete answer."}]);expect(JSON.stringify(result)).not.toContain("Old instructions");expect(result.callIds).toEqual(["oldcall"]);});
 it("unchecked sharing carries no previous message or result",()=>{const input=saved();input.includeCompletedContext=false;expect(selectSavedRunContext(input,scope())).toEqual({groups:[],history:[],callIds:[]});});
 it("requires matching project/conversation and refuses unresolved external effects",()=>{for(const patch of [{projectId:"B"},{conversationId:"other"},{hasUnresolvedEffects:true}])expect(()=>selectSavedRunContext({...saved(),...patch},scope())).toThrow("saved_run_scope_mismatch");});
 it("does not replay incomplete calls or import partial output as successful history",()=>{const input=saved();input.completed=false;input.messages=input.messages.slice(0,4);expect(selectSavedRunContext(input,scope())).toEqual({groups:[],history:[],callIds:[]});});
 it("requires fresh path-sharing scope and excludes old process-local index observations",()=>{const noShare=scope();noShare.sharePrefixes=[];expect(()=>selectSavedRunContext(saved(),noShare)).toThrow("saved_run_sharing_scope");const input=saved(),result=JSON.parse(input.messages[4]!.content);result.sources[0].kind="index_query";input.messages[4]!.content=JSON.stringify(result);expect(selectSavedRunContext(input,scope()).groups).toEqual([]);});
});
