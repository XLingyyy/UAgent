// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { createOutboundConsentGate, type RunScopeLease } from "@uagent/runtime";
import type {
  ProviderContinuationOwner,
  ProviderNativeContinuation,
  ProviderRuntimeRequest,
} from "@uagent/shared";
import { createNativeResponsesProfile } from "./native-responses-session";
import type { NativeInvoke } from "./project-native-adapter";
import { PROJECT_MEMORY_MESSAGE_PREFIX } from "../../../../../packages/runtime/src/project-memory/dispatch-contract";

const key = "synthetic-local-bridge-key-ONLY";
const endpoint = "https://api.openai.com/v1/responses";
const owner: ProviderContinuationOwner = {
  providerId: "configured-responses",
  modelId: "configured-model",
  projectId: "root:fixture",
  projectEpoch: 31,
  runId: "run-fixture",
  conversationId: "conversation-fixture",
};
const cleanup: Array<() => Promise<void>> = [];
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw Error("browser_fetch_forbidden");
    }),
  );
});
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
  vi.unstubAllGlobals();
  if (vi.isFakeTimers()) { vi.clearAllTimers(); vi.useRealTimers(); }
});
function body(text = "Hello") {
  return {
    id: "resp_fixture",
    model: owner.modelId,
    status: "completed",
    created_at: 1700000000,
    output: [
      {
        type: "message",
        id: "msg_fixture",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
  };
}
function request(id = "request-fixture"): ProviderRuntimeRequest {
  return {
    id,
    providerId: owner.providerId,
    modelId: owner.modelId,
    messages: [{ role: "user", content: "Read the selected project. \u4e2d\u6587" }],
  };
}
const memoryRow = {id:"m",revision:1,kind:"decision",body:"Synthetic whole decision",sourceRefs:[],
  origin:{kind:"user",sessionId:null,messageId:null},confirmation:{kind:"user",confirmedAt:1},readAt:1};
const memoryText = PROJECT_MEMORY_MESSAGE_PREFIX + JSON.stringify([memoryRow]);
function memoryRequest(id:string):ProviderRuntimeRequest {
  return {...request(id),messages:[{role:"system",content:"System"},{role:"developer",content:"Developer"},
    {role:"user",content:memoryText},{role:"user",content:"Goal"}],metadata:{projectId:owner.projectId,runId:owner.runId}};
}
function harness(autoApprove = true, memory = false) {
  const calls: Array<{ command: string; input: Record<string, unknown> }> = [];
  const records: ProviderNativeContinuation[] = [];
  const gate = createOutboundConsentGate();
  if (autoApprove)
    gate.subscribe(() => {
      const pending = gate.getPending();
      if (pending) queueMicrotask(() => gate.approve(pending.id));
    });
  let current = true,
    projectId: string | null = owner.projectId,
    revision = "source-1";
  const limits = {
    maxToolCalls: 3,
    maxModelRequests: 4,
    maxDurationMs: 60000,
    maxAttemptsPerFailure: 2,
    maxToolResultBytes: 8192,
    maxContextBytes: 24576,
  };
  const lease: RunScopeLease = {
    isCurrent: () => current,
    scope: {
      id: "fresh-in-memory-scope",
      runId: owner.runId,
      projectId: owner.projectId,
      conversationId: owner.conversationId,
      providerId: owner.providerId,
      modelId: owner.modelId,
      endpoint,
      rootRef: "E:/SyntheticProject",
      mode: "read_only",
      readPrefixes: ["Source/"],
      sharePrefixes: ["Source/"],
      toolIds: ["project.read_file"],
      limits,
      expiresAt: Date.now() + 60000,
    },
  };
  let preparedBody = "",
    nativeOwner = { ...owner },
    digestOverride: string | null = null;
  let pollOverride: ((cursor: number) => unknown | Promise<unknown>) | null = null;
  let hook: ((command: string) => void) | null = null;
  let activeNativeRequest = 0;
  let nativeCancelled = false;
  let nativeStatus = "notDispatched";
  let memoryOrdinal = 0, memoryExpiresAt = 0, memoryBatchId = "";
  let preparedTtl: number | null = null, virtualNow: number | null = null;
  const memoryOwner = () => ({runHandle:"native-run-handle",runId:nativeOwner.runId,projectId:nativeOwner.projectId,
    projectEpoch:nativeOwner.projectEpoch,providerId:nativeOwner.providerId,modelId:nativeOwner.modelId});
  const memoryAction = (action:string,batchId:unknown,requestId:unknown) => ({schemaVersion:1,owner:memoryOwner(),batchId,requestId,action,
    dispatchStatus:nativeStatus,terminal:action==="cancelled",reason:action==="cancelled"?"cancelled":null});
  const failingCommands = new Set<string>();
  const stalledCommands = new Set<string>();
  const invoke: NativeInvoke = async <T>(command: string, payload?: unknown) => {
    const input = (payload as { input: Record<string, unknown> }).input;
    calls.push({ command, input });
    hook?.(command);
    if (failingCommands.has(command)) throw Error("untrusted native detail " + key);
    if (stalledCommands.has(command)) return new Promise<T>(() => {});
    let result: unknown;
    if (command === "open_native_responses_profile")
      result = {
        profileId: "native-profile-" + calls.filter((call) => call.command === command).length,
        providerId: owner.providerId,
        modelId: owner.modelId,
        endpoint,
        expiresAt: Date.now() + 60000,
        fixture: false,
        nativeProjectMemoryDispatch: memory,
        modelSettings: { supportsReasoning: true, requestDefaults: { temperature: null, maxOutputTokens: null } },
      };
    else if (memory && command === "authorize_native_project_memory_scope") {
      memoryExpiresAt = input.expiresAt as number;
      result = {scopeId:"native-memory-scope",projectId:input.projectId,runId:input.runId,conversationId:input.conversationId,
        readPrefixes:input.readPrefixes,sharePrefixes:input.sharePrefixes,maxContextBytes:24576,
        expiresAt:memoryExpiresAt,productionMemoryDispatchEnabled:true};
    } else if (memory && command === "bind_native_project_memory_run") {
      result = {runHandle:"native-run-handle",owner:nativeOwner};
    } else if (memory && command === "prepare_native_project_memory_selection") {
      memoryBatchId = (++memoryOrdinal).toString(16).padStart(32,"0");
      result = {schemaVersion:1,owner:memoryOwner(),expiresAt:memoryExpiresAt,batch:{schemaVersion:1,batchId:memoryBatchId,
        projectId:owner.projectId,selected:input.selected,message:{role:"user",content:memoryText},
        sectionSha256:createHash("sha256").update(memoryText).digest("hex"),maxContextBytes:24576}};
    } else if (memory && command === "approve_native_responses_request") {
      result = memoryAction("approved",input.memoryBatchId,input.requestId);
    } else if (memory && command === "cancel_native_project_memory_dispatch") {
      nativeCancelled = true;
      result = memoryAction("cancelled",input.batchId,input.requestId);
    }
    else if(command==="bind_native_responses_conversation"){
      nativeOwner={...owner,projectId:input.projectId===null?"chat:local":"chat:project:"+input.projectId,runId:"chat-run-fixture"};
      result={runHandle:"native-chat-handle",owner:nativeOwner};
    }
    else if (command === "bind_native_responses_run")
      result = { runHandle: "native-run-handle", owner: nativeOwner };
    else if (command === "load_native_provider_continuations") result = records;
    else if (command === "save_native_provider_continuation") {
      records.push(input.record as ProviderNativeContinuation);
      result = null;
    } else if (command === "prepare_native_responses_request") {
      preparedBody = input.body as string;
      nativeCancelled = false;
      nativeStatus = "notDispatched";
      result = {
        requestId: "native-request-" + ++activeNativeRequest,
        endpoint,
        modelId: owner.modelId,
        bodySha256: digestOverride ?? createHash("sha256").update(preparedBody).digest("hex"),
      };
      if (memory) {const prepared=result as Record<string,unknown>;delete prepared.modelId;
        Object.assign(prepared,{schemaVersion:1,owner:memoryOwner(),expiresAt:preparedTtl === null ? memoryExpiresAt : Math.min(memoryExpiresAt, Date.now() + preparedTtl),batchId:memoryBatchId,body:preparedBody});}
    } else if (command === "dispatch_native_responses_request") {
      nativeStatus = "mayHaveBeenSent";
      result = memory ? memoryAction("scheduled",input.memoryBatchId,input.requestId) : null;
    } else if (command === "cancel_native_responses_request") {
      nativeCancelled = true;
      result = null;
    } else if (command === "poll_native_responses_request") {
      if (pollOverride) result = await pollOverride(input.cursor as number);
      else if (nativeCancelled)
        result = {
          cursor: input.cursor,
          nextCursor: input.cursor,
          chunks: [],
          head: null,
          done: true,
          error: "native_request_cancelled",
          dispatchStatus: nativeStatus,
        };
      else {
        const value = body();value.id="resp_fixture_"+activeNativeRequest;
        const stream = JSON.parse(preparedBody).stream === true;
        const raw = stream
          ? [
              {
                type: "response.created",
                response: { id: value.id, model: value.model, status: "in_progress" },
              },
              { type: "response.output_item.added", output_index: 0, item: value.output[0] },
              { type: "response.completed", response: value },
            ]
              .map((event) => "data: " + JSON.stringify(event) + "\n\n")
              .join("")
          : JSON.stringify(value);
        result = {
          cursor: input.cursor,
          nextCursor: (input.cursor as number) + 1,
          chunks: [Array.from(new TextEncoder().encode(raw))],
          head: { status: 200, contentType: stream ? "text/event-stream" : "application/json" },
          done: true,
          error: null,
          dispatchStatus: "sent",
        };
      }
    } else result = null;
    if (command === "poll_native_responses_request")
      nativeStatus = (result as { dispatchStatus: string }).dispatchStatus;
    return result as T;
  };
  const count = (command: string) => calls.filter((call) => call.command === command).length;
  return {
    calls,
    records,
    gate,
    lease,
    count,
    invoke,
    setCurrent(value: boolean) {
      current = value;
    },
    setProject(value: string | null) {
      projectId = value;
    },
    setRevision(value: string) {
      revision = value;
    },
    setOwner(value: ProviderContinuationOwner) {
      nativeOwner = value;
    },
    setDigest(value: string) {
      digestOverride = value;
    },
    setPoll(value: (cursor: number) => unknown | Promise<unknown>) {
      pollOverride = value;
    },
    setHook(value: (command: string) => void) {
      hook = value;
    },
    fail(command: string) { failingCommands.add(command); },
    stall(command: string) { stalledCommands.add(command); },
    setPreparedTtl(value: number) { preparedTtl = value; },
    setClock(value: number) { virtualNow = value; },
    async open(chat=false) {
      const profile = await createNativeResponsesProfile({
        invoke,
        providerId: owner.providerId,
        modelId: owner.modelId,
        credential: key,
        gate,
        now: () => virtualNow ?? Date.now(),
      });
      cleanup.push(profile.close);
      const adapter = chat?profile.createConversationAdapter({projectId,conversationId:owner.conversationId,isCurrent:()=>current,getProjectContext:()=>({projectId,revision})}):profile.createRunAdapter({
        lease,
        getProjectContext: () => ({ projectId, revision }),
      });
      return { profile, adapter };
    },
  };
}


describe("Responses no-tool conversation native binding (synthetic IPC)",()=>{
  const chatRequest=(id:string,text:string,history:ProviderRuntimeRequest["messages"]=[]):ProviderRuntimeRequest=>({
    ...request(id),messages:[...history,{role:"user",content:text}],metadata:{projectId:owner.projectId,conversationId:owner.conversationId}
  });
  it("sends both ordinary turns through exact per-request native approvals, with no tool binding",async()=>{
    const h=harness(false),{adapter}=await h.open(true);
    const first=adapter.complete(chatRequest("chat-one","My code is blue-whale-42"));
    await vi.waitFor(()=>expect(h.gate.getPending()).not.toBeNull());expect(h.count("dispatch_native_responses_request")).toBe(0);
    const firstEnvelope=h.gate.getPending()!.envelope;expect(JSON.parse(firstEnvelope.body).tools).toBeUndefined();
    h.gate.approve(h.gate.getPending()!.id);const result=await first;expect(result.usageStatus).toBe("unknown");
    const second=adapter.complete(chatRequest("chat-two","What was my code?",[{role:"user",content:"My code is blue-whale-42"},{role:"assistant",content:result.text}]));
    await vi.waitFor(()=>expect(h.gate.getPending()).not.toBeNull());
    expect(h.count("dispatch_native_responses_request")).toBe(1);
    const review=h.gate.getPending()!.envelope;expect(review.body).toContain("blue-whale-42");expect(review.body).toContain(result.text);
    const assistant=JSON.parse(review.body).input.find((item:{role?:string})=>item.role==="assistant");
    expect(assistant).toEqual({type:"message",role:"assistant",content:result.text});
    expect(review.body).not.toContain("msg_fixture");
    h.gate.approve(h.gate.getPending()!.id);await second;
    expect(h.count("bind_native_responses_conversation")).toBe(1);expect(h.count("bind_native_responses_run")).toBe(0);
    expect(h.records).toHaveLength(2);expect(h.records.every(r=>r.owner.projectId==="chat:project:"+owner.projectId)).toBe(true);
    expect(h.calls.filter(c=>c.command==="prepare_native_responses_request").map(c=>c.input.logicalRequestId)).toEqual(["chat-one","chat-two"]);
    expect(adapter.getCapabilities().supportsTools).toBe(false);expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it.each(["tools","tool-message","conversation"] as const)("refuses %s before native binding",async kind=>{
    const h=harness(),{adapter}=await h.open(true);const input=chatRequest("bad-chat","text");
    if(kind==="tools")input.tools=[{name:"read",description:"not granted",parameters:{type:"object"}}];
    if(kind==="tool-message")input.messages.unshift({role:"tool",content:"local result",toolCallId:"local"});
    if(kind==="conversation")input.metadata!.conversationId="other";
    await expect(adapter.complete(input)).rejects.toThrow();
    expect(h.count("prepare_native_responses_request")).toBe(0);expect(h.count("dispatch_native_responses_request")).toBe(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it.each(["lease","project","credential"] as const)("invalidates pending conversation on %s change without dispatch",async kind=>{
    const h=harness(false),{adapter,profile}=await h.open(true);
    const pending=adapter.complete(chatRequest("held-chat","wait"));const rejection=expect(pending).rejects.toThrow();
    await vi.waitFor(()=>expect(h.gate.getPending()).not.toBeNull());
    if(kind==="lease")h.setCurrent(false);
    else if(kind==="project")h.setProject("other");
    else await profile.closeAcknowledged();
    const review=h.gate.getPending();if(review)h.gate.approve(review.id);
    await rejection;expect(h.count("dispatch_native_responses_request")).toBe(0);
    expect(h.records).toHaveLength(0);expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("Responses desktop native IPC bridge (synthetic invoke only)", () => {
  it.each([[400,"malformed_response"],[401,"auth_missing"],[403,"auth_missing"],[404,"malformed_response"],[422,"malformed_response"],[429,"rate_limited"],[503,"provider_unavailable"]])("classifies a terminal native HTTP %i without forwarding server content or retrying",async(status,code)=>{
    const h=harness();h.setPoll(cursor=>({cursor,nextCursor:cursor,chunks:[],head:{status,contentType:"application/json"},done:true,error:"native_transport_failed",dispatchStatus:"sent"}));
    const {profile,adapter}=await h.open();const error=await adapter.complete(request()).catch(e=>e);
    expect(error).toMatchObject({code,dispatchStatus:"sent",message:"Responses returned HTTP "+status+". No automatic retry was sent."});
    expect(JSON.stringify(error)).not.toContain(key);
    expect(h.count("dispatch_native_responses_request")).toBe(1);
    expect(h.count("save_native_provider_continuation")).toBe(0);
    expect(profile.getSnapshot().lastDispatchStatus).toBe("sent");
  });
  it("waits for a terminal HTTP rejection and keeps possible-send status conservative",async()=>{
    const h=harness();let polls=0;
    h.setPoll(cursor=>({cursor,nextCursor:cursor,chunks:[],head:{status:401,contentType:"application/json"},done:++polls>1,error:polls>1?"native_transport_failed":null,dispatchStatus:"mayHaveBeenSent"}));
    const {adapter}=await h.open();const error=await adapter.complete(request()).catch(e=>e);
    expect(polls).toBeGreaterThanOrEqual(2);
    expect(error).toMatchObject({code:"auth_missing",dispatchStatus:"mayHaveBeenSent"});
    expect(h.count("dispatch_native_responses_request")).toBe(1);
  });
  it.each(["native_source_changed","native_request_cancelled"])("does not replace authority failure %s with an HTTP category",async nativeError=>{
    const h=harness();h.setPoll(cursor=>({cursor,nextCursor:cursor,chunks:[],head:{status:401,contentType:"application/json"},done:true,error:nativeError,dispatchStatus:"mayHaveBeenSent"}));
    const {adapter}=await h.open();const error=await adapter.complete(request()).catch(e=>e);
    expect(error).toMatchObject({code:"network_error",dispatchStatus:"mayHaveBeenSent"});
    expect(error.message).not.toContain("HTTP");expect(h.count("dispatch_native_responses_request")).toBe(1);
  });
  it.each([false,true])("keeps strict model checks with a static non-echoing failure, streaming=%s",async stream=>{
    const h=harness();h.setPoll(cursor=>{
      const value={...body(),model:"alias-resolved-snapshot-"+key};
      const raw=stream?"data: "+JSON.stringify({type:"response.created",response:value})+"\n\n":JSON.stringify(value);
      return {cursor,nextCursor:cursor+1,chunks:[Array.from(new TextEncoder().encode(raw))],head:{status:200,contentType:stream?"text/event-stream":"application/json"},done:true,error:null,dispatchStatus:"sent"};
    });
    const {adapter}=await h.open();
    const error=await (stream?(async()=>{for await(const _chunk of adapter.stream!(request()))void _chunk;})():adapter.complete(request())).catch(e=>e);
    expect(error).toMatchObject({code:"malformed_response",message:"Responses model differs from the explicitly selected model."});
    expect(JSON.stringify(error)).not.toContain(key);expect(h.count("save_native_provider_continuation")).toBe(0);
  });

  it("opens only on explicit local input, binds lazily, and never claims connectivity", async () => {
    const h = harness(),
      { profile } = await h.open();
    expect(h.calls.map((call) => call.command)).toEqual(["open_native_responses_profile"]);
    expect(profile.getSnapshot()).toMatchObject({ ready: true, connectionVerified: false });
    expect(JSON.stringify(profile.getSnapshot())).not.toContain(key);
    expect(h.count("bind_native_responses_run")).toBe(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("requires exact-body approval, uses only IPC, saves native ownership and keeps usage unknown", async () => {
    const h = harness(false),
      { adapter, profile } = await h.open();
    const originalDeadline = h.lease.scope.expiresAt;
    const result = adapter.complete(request());
    await vi.waitFor(() => expect(h.gate.getPending()).not.toBeNull());
    expect(h.count("dispatch_native_responses_request")).toBe(0);
    expect(h.count("approve_native_responses_request")).toBe(0);
    expect(
      h.calls.find((call) => call.command === "bind_native_responses_run")!.input.scopeExpiresAt,
    ).toBe(originalDeadline);
    const reviewed = h.gate.getPending()!.envelope;
    expect(reviewed).toMatchObject({
      endpoint,
      model: owner.modelId,
      projectId: owner.projectId,
      epoch: owner.projectEpoch,
    });
    h.gate.approve(h.gate.getPending()!.id);
    const response = await result;
    expect(response.text).toBe("Hello");
    expect(response.usage).toBeUndefined();
    expect(response.usageStatus).toBe("unknown");
    expect(h.count("dispatch_native_responses_request")).toBe(1);
    expect(h.records).toHaveLength(1);
    expect(h.records[0].owner).toEqual(owner);
    expect(profile.getSnapshot().lastDispatchStatus).toBe("sent");
    expect(
      h.calls.find((call) => call.command === "prepare_native_responses_request")!.input.body,
    ).toBe(reviewed.body);
    expect(
      h.calls.some(
        (call) =>
          call.command !== "open_native_responses_profile" &&
          JSON.stringify(call.input).includes(key),
      ),
    ).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("sends the original fixed scope deadline even if a caller replaces its descriptive field later", async () => {
    const h = harness(),
      originalDeadline = h.lease.scope.expiresAt,
      { adapter } = await h.open();
    // The production authority freezes scope; this deliberately mutable fixture probes the capture boundary.
    h.lease.scope.expiresAt = originalDeadline + 60_000;
    await adapter.complete(request());
    expect(
      h.calls.find((call) => call.command === "bind_native_responses_run")!.input.scopeExpiresAt,
    ).toBe(originalDeadline);
  });

  it("preserves native SSE byte order and produces one terminal chunk without fabricated usage", async () => {
    const h = harness(),
      { adapter } = await h.open(),
      chunks = [];
    for await (const chunk of adapter.stream!(request())) chunks.push(chunk);
    expect(chunks.filter((chunk) => chunk.done)).toHaveLength(1);
    expect(chunks.map((chunk) => chunk.delta).join("")).toBe("Hello");
    expect(chunks.at(-1)).toMatchObject({ done: true, usageStatus: "unknown" });
    expect(chunks.at(-1)!.usage).toBeUndefined();
    expect(h.records).toHaveLength(1);
  });

  it("cancels during approval with zero dispatch and releases the native request", async () => {
    const h = harness(false),
      { adapter } = await h.open(),
      controller = new AbortController();
    const response = adapter
      .complete(request(), { signal: controller.signal })
      .catch((error) => error);
    await vi.waitFor(() => expect(h.gate.getPending()).not.toBeNull());
    controller.abort();
    expect(await response).toMatchObject({ code: "cancelled", dispatchStatus: "notDispatched" });
    await vi.waitFor(() => expect(h.count("release_native_responses_request")).toBe(1));
    expect(h.count("cancel_native_responses_request")).toBe(1);
    expect(h.count("dispatch_native_responses_request")).toBe(0);
    expect(h.records).toHaveLength(0);
  });

  it.each(["prepare", "approve", "beforeSend", "grantInvalidation"])(
    "%s invalidation before the final fetch leaves native dispatch at zero",
    async (timing) => {
      const h = harness(),
        { adapter } = await h.open();
      if (timing === "prepare" || timing === "approve")
        h.setHook((command) => {
          if (
            command ===
            (timing === "prepare"
              ? "prepare_native_responses_request"
              : "approve_native_responses_request")
          )
            h.setCurrent(false);
        });
      const result = await adapter
        .complete(request(), {
          beforeSend: async () => {
            if (timing === "beforeSend") h.setCurrent(false);
            if (timing === "grantInvalidation") h.gate.invalidate();
          },
        })
        .catch((error) => error);
      expect(result).toMatchObject({ code: "cancelled" });
      await vi.waitFor(() => expect(h.count("release_native_responses_request")).toBe(1));
      expect(h.count("dispatch_native_responses_request")).toBe(0);
      expect(h.records).toHaveLength(0);
    },
  );

  it.each(["project", "sourceRevision"])(
    "rejects a %s switch during approval before dispatch",
    async (change) => {
      const h = harness(false),
        { adapter } = await h.open();
      const response = adapter.complete(request()).catch((error) => error);
      await vi.waitFor(() => expect(h.gate.getPending()).not.toBeNull());
      if (change === "project") h.setProject("root:other-project");
      else h.setRevision("source-2");
      h.gate.approve(h.gate.getPending()!.id);
      expect(await response).toMatchObject({ code: "cancelled", dispatchStatus: "notDispatched" });
      await vi.waitFor(() => expect(h.count("release_native_responses_request")).toBe(1));
      expect(h.count("dispatch_native_responses_request")).toBe(0);
      expect(h.records).toHaveLength(0);
    },
  );

  it("rejects mismatched native owner before review/load and cannot replace the captured lease check", async () => {
    const h = harness(),
      { adapter } = await h.open();
    h.setCurrent(false);
    (h.lease as { isCurrent: () => boolean }).isCurrent = () => true;
    await expect(adapter.complete(request())).rejects.toMatchObject({ name: "AbortError" });
    expect(h.count("bind_native_responses_run")).toBe(0);
    const other = harness();
    other.setOwner({ ...owner, projectId: "root:other-project" });
    await expect((await other.open()).adapter.complete(request())).rejects.toThrow(
      "native_responses_unavailable",
    );
    expect(other.count("load_native_provider_continuations")).toBe(0);
    expect(other.count("prepare_native_responses_request")).toBe(0);
  });

  it("rejects a prepared body hash mismatch before exposing approval or sending", async () => {
    const h = harness(),
      { adapter } = await h.open();
    h.setDigest("0".repeat(64));
    await expect(adapter.complete(request())).rejects.toMatchObject({ code: "cancelled" });
    expect(h.gate.getPending()).toBeNull();
    expect(h.count("approve_native_responses_request")).toBe(0);
    expect(h.count("dispatch_native_responses_request")).toBe(0);
    expect(h.count("cancel_native_responses_request")).toBe(1);
  });

  it("allows a not-yet-dispatched preflight poll, then rejects a changed chunk cursor", async () => {
    const h = harness(),
      { adapter } = await h.open();
    let polls = 0;
    h.setPoll((cursor) =>
      ++polls === 1
        ? {
            cursor,
            nextCursor: cursor,
            chunks: [],
            head: null,
            done: false,
            error: null,
            dispatchStatus: "notDispatched",
          }
        : {
            cursor: cursor + 1,
            nextCursor: cursor + 2,
            chunks: [[1]],
            head: { status: 200, contentType: "application/json" },
            done: true,
            error: null,
            dispatchStatus: "sent",
          },
    );
    await expect(adapter.complete(request())).rejects.toMatchObject({
      code: "network_error",
    });
    // Two response polls plus the final cancellation status query.
    expect(polls).toBe(3);
    expect(h.records).toHaveLength(0);
    expect(h.count("cancel_native_responses_request")).toBe(1);
  });

  it("cancels after native dispatch without saving an unfinished reply or retrying", async () => {
    const h = harness(),
      { adapter, profile } = await h.open(),
      controller = new AbortController();
    h.setPoll((cursor) => ({
      cursor,
      nextCursor: cursor,
      chunks: [],
      head: { status: 200, contentType: "application/json" },
      done: false,
      error: null,
      dispatchStatus: "mayHaveBeenSent",
    }));
    const result = adapter
      .complete(request(), { signal: controller.signal })
      .catch((error) => error);
    await vi.waitFor(() => expect(h.count("poll_native_responses_request")).toBeGreaterThan(0));
    controller.abort();
    expect(await result).toMatchObject({ code: "cancelled", dispatchStatus: "mayHaveBeenSent" });
    expect(profile.getSnapshot().lastDispatchStatus).toBe("mayHaveBeenSent");
    await vi.waitFor(() => expect(h.count("cancel_native_responses_request")).toBe(1));
    expect(h.count("dispatch_native_responses_request")).toBe(1);
    expect(h.records).toHaveLength(0);
  });

  it("profile close discards the current credential, closes native profile and never restores authorization", async () => {
    const h = harness(false),
      { profile, adapter } = await h.open();
    const pending = adapter.complete(request()).catch((error) => error);
    await vi.waitFor(() => expect(h.gate.getPending()).not.toBeNull());
    await profile.close();
    await expect(pending).resolves.toMatchObject({ code: "cancelled" });
    expect(profile.getSnapshot()).toMatchObject({ ready: false, connectionVerified: false });
    await expect(adapter.complete(request())).rejects.toMatchObject({ name: "AbortError" });
    expect(h.count("close_native_responses_profile")).toBe(1);
    expect(h.count("dispatch_native_responses_request")).toBe(0);
  });

  it("reopening requires fresh explicit input and review even when continuation descriptions exist", async () => {
    const h = harness(),
      first = await h.open();
    await first.adapter.complete(request());
    await first.profile.close();
    const before = h.count("approve_native_responses_request");
    const reopened = await h.open();
    await reopened.adapter.complete(request("request-after-reopen"));
    expect(h.count("open_native_responses_profile")).toBe(2);
    expect(h.count("bind_native_responses_run")).toBe(2);
    expect(h.count("approve_native_responses_request")).toBe(before + 1);
    expect(h.records).toHaveLength(2);
  });

  it("streams multiple native batches in place and withholds save until the real terminal event", async () => {
    const h = harness(),
      { adapter } = await h.open();
    const value = body("\u4f60\u597d");
    const events = [
      [
        {
          type: "response.created",
          response: { id: value.id, model: value.model, status: "in_progress" },
        },
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { ...value.output[0], content: [] },
        },
        {
          type: "response.output_text.delta",
          output_index: 0,
          content_index: 0,
          item_id: "msg_fixture",
          delta: "\u4f60",
        },
      ],
      [
        {
          type: "response.output_text.delta",
          output_index: 0,
          content_index: 0,
          item_id: "msg_fixture",
          delta: "\u597d",
        },
      ],
      [{ type: "response.completed", response: value }],
    ];
    const packets = events.map((batch) =>
      Array.from(
        new TextEncoder().encode(
          batch.map((event) => "data: " + JSON.stringify(event) + "\n\n").join(""),
        ),
      ),
    );
    h.setPoll((cursor) => ({
      cursor,
      nextCursor: cursor + 1,
      chunks: [packets[cursor]],
      head: { status: 200, contentType: "text/event-stream; charset=utf-8" },
      done: cursor === packets.length - 1,
      error: null,
      dispatchStatus: "sent",
    }));
    const chunks = [];
    for await (const chunk of adapter.stream!(request())) {
      chunks.push(chunk);
      if (!chunk.done) expect(h.records).toHaveLength(0);
    }
    expect(chunks.filter((chunk) => !chunk.done).map((chunk) => chunk.delta)).toEqual([
      "\u4f60",
      "\u597d",
    ]);
    expect(chunks.filter((chunk) => chunk.done)).toHaveLength(1);
    expect(h.records).toHaveLength(1);
  });

  it.each(["largeChunk", "invalidByte", "excessiveCursor", "nativeError"])(
    "refuses %s poll data without storing or retrying",
    async (variant) => {
      const h = harness(),
        { adapter } = await h.open();
      h.setPoll((cursor) => ({
        cursor,
        nextCursor: variant === "excessiveCursor" ? 4097 : cursor + 1,
        chunks: [
          variant === "largeChunk"
            ? new Array(65537).fill(32)
            : variant === "invalidByte"
              ? [256]
              : [32],
        ],
        head: { status: 200, contentType: "application/json" },
        done: true,
        error: variant === "nativeError" ? "untrusted echo " + key : null,
        dispatchStatus: "mayHaveBeenSent",
      }));
      const error = await adapter.complete(request()).catch((value) => value);
      expect(error).toMatchObject({ code: "network_error" });
      expect(JSON.stringify(error)).not.toContain(key);
      expect(h.records).toHaveLength(0);
      expect(h.count("dispatch_native_responses_request")).toBe(1);
      expect(h.count("cancel_native_responses_request")).toBe(1);
    },
  );

  it.each([false, true])(
    "keeps possible transmission when dispatch acknowledgement is lost, cancelFails=%s and no terminal proof exists",
    async (cancelFails) => {
      const h = harness(),
        { adapter, profile } = await h.open();
      h.fail("dispatch_native_responses_request");
      if (cancelFails) h.fail("cancel_native_responses_request");
      h.fail("release_native_responses_request");
      h.setPoll((cursor) => ({
        cursor,
        nextCursor: cursor,
        chunks: [],
        head: null,
        done: false,
        error: null,
        dispatchStatus: "notDispatched",
      }));
      const error = await adapter.complete(request()).catch((value) => value);
      expect(error).toMatchObject({ code: "network_error", dispatchStatus: "mayHaveBeenSent" });
      expect(profile.getSnapshot().lastDispatchStatus).toBe("mayHaveBeenSent");
      expect(h.count("dispatch_native_responses_request")).toBe(1);
      expect(h.count("release_native_responses_request")).toBe(1);
      expect(h.records).toHaveLength(0);
    },
  );

  it("accepts an unsent fact only after a native terminal error closes the send gate", async () => {
    const h = harness(),
      { adapter, profile } = await h.open();
    h.fail("dispatch_native_responses_request");
    h.fail("cancel_native_responses_request");
    h.setPoll((cursor) => ({
      cursor,
      nextCursor: cursor,
      chunks: [],
      head: null,
      done: true,
      error: "native_request_cancelled",
      dispatchStatus: "notDispatched",
    }));
    const error = await adapter.complete(request()).catch((value) => value);
    expect(error).toMatchObject({ code: "network_error", dispatchStatus: "notDispatched" });
    expect(profile.getSnapshot().lastDispatchStatus).toBe("notDispatched");
    expect(h.records).toHaveLength(0);
  });

  it("explicit close acknowledgement rejects a native failure while best-effort close remains handled", async () => {
    const h = harness(),
      { profile } = await h.open();
    h.fail("close_native_responses_profile");
    await expect(profile.closeAcknowledged()).rejects.toThrow("native_responses_unavailable");
    await expect(profile.close()).resolves.toBeUndefined();
    expect(profile.getSnapshot().ready).toBe(false);
    expect(h.count("close_native_responses_profile")).toBe(1);
  });

  it("native exceptions containing fixture credentials become static errors without any browser fallback", async () => {
    const h = harness(),
      { adapter } = await h.open();
    h.fail("dispatch_native_responses_request");
    const error = await adapter.complete(request()).catch((value) => value);
    expect(JSON.stringify(error)).not.toContain(key);
    expect(String(error)).not.toContain(key);
    expect(h.count("dispatch_native_responses_request")).toBe(1);
    expect(h.records).toHaveLength(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

// Synthetic IPC tests: no native grant or production transport acceptance.
describe("memory companion in the existing Responses session",()=>{
  it("reuses one native run for two whole-body reviewed requests and releases each without run cancellation",async()=>{
    const h=harness(true,true),{adapter}=await h.open();
    expect(adapter.getCapabilities().supportsNativeProjectMemory).toBe(true);
    await adapter.complete(memoryRequest("memory-one"));
    expect(h.count("release_native_responses_request")).toBe(1);
    expect(h.count("cancel_native_project_memory_dispatch")).toBe(0);
    await adapter.complete(memoryRequest("memory-two"));
    expect(h.count("bind_native_project_memory_run")).toBe(1);
    expect(h.count("bind_native_responses_run")).toBe(0);
    expect(h.count("prepare_native_project_memory_selection")).toBe(2);
    expect(h.count("approve_native_responses_request")).toBe(2);
    expect(h.count("dispatch_native_responses_request")).toBe(2);
    expect(h.count("release_native_responses_request")).toBe(2);
    expect(h.count("cancel_native_project_memory_dispatch")).toBe(0);
    const prepared=h.calls.filter(call=>call.command==="prepare_native_responses_request");
    expect(prepared.every(call=>call.input.schemaVersion===1&&typeof call.input.memoryBatchId==="string")).toBe(true);
    expect(h.gate.getPending()).toBeNull();expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("keeps disabled native production capability fenced before scope/run creation",async()=>{
    const h=harness(),{adapter}=await h.open();
    await expect(adapter.complete(memoryRequest("disabled"))).rejects.toThrow();
    expect(h.count("authorize_native_project_memory_scope")).toBe(0);
    expect(h.count("bind_native_project_memory_run")).toBe(0);
    expect(h.count("dispatch_native_responses_request")).toBe(0);
  });
  it("cancels the native memory workflow when whole-body consent is interrupted",async()=>{
    const h=harness(false,true),{adapter}=await h.open(),controller=new AbortController();
    const result=expect(adapter.complete(memoryRequest("stopped"),{signal:controller.signal})).rejects.toThrow();
    await vi.waitFor(()=>expect(h.gate.getPending()).not.toBeNull());
    expect(h.gate.getPending()!.envelope.body).toContain(memoryText.replaceAll('"','\\"'));
    controller.abort();await result;
    expect(h.count("cancel_native_project_memory_dispatch")).toBe(1);
    expect(h.count("approve_native_responses_request")).toBe(0);
    expect(h.count("dispatch_native_responses_request")).toBe(0);
    expect(h.count("release_native_responses_request")).toBe(1);
    expect(h.count("cancel_native_responses_request")).toBe(0);
  });
});

// Cleanup failure must settle consumers; a timeout never certifies native stop.
describe("memory terminal cleanup failure boundaries (synthetic IPC)",()=>{
  it("errors a successful JSON consumer when request release fails and prevents run reuse",async()=>{
    const h=harness(true,true),{adapter,profile}=await h.open();
    h.fail("release_native_responses_request");
    await expect(adapter.complete(memoryRequest("release-failed"))).rejects.toMatchObject({dispatchStatus:"sent"});
    expect(profile.getSnapshot().lastDispatchStatus).toBe("sent");
    expect(h.count("dispatch_native_responses_request")).toBe(1);
    expect(h.count("release_native_responses_request")).toBe(1);
    expect(h.count("revoke_native_project_memory_scope")).toBe(1);
    await expect(adapter.complete(memoryRequest("no-reuse"))).rejects.toThrow();
    expect(h.count("dispatch_native_responses_request")).toBe(1);
  });
  it("settles the same consumer when local success detach expires after the final poll",async()=>{
    const h=harness(true,true);h.setPreparedTtl(1000);
    const {adapter}=await h.open();
    h.setHook(command=>{if(command==="poll_native_responses_request")h.setClock(Date.now()+2000);});
    await expect(adapter.complete(memoryRequest("detach-expired"))).rejects.toMatchObject({dispatchStatus:"sent"});
    expect(h.count("dispatch_native_responses_request")).toBe(1);
    expect(h.count("cancel_native_project_memory_dispatch")).toBe(1);
    expect(h.count("release_native_responses_request")).toBe(1);
  });
  it("bounds consent cancellation even when scope revocation never acknowledges",async()=>{
    vi.useFakeTimers({toFake:["setTimeout","clearTimeout","Date","performance"]});
    const h=harness(false,true),{adapter}=await h.open(),controller=new AbortController();
    h.stall("revoke_native_project_memory_scope");
    const stopped=expect(adapter.complete(memoryRequest("revoke-stalled"),{signal:controller.signal}))
      .rejects.toMatchObject({dispatchStatus:"notDispatched"});
    await vi.waitFor(()=>expect(h.gate.getPending()).not.toBeNull());
    controller.abort();
    await vi.waitFor(()=>expect(h.count("revoke_native_project_memory_scope")).toBe(1));
    await vi.advanceTimersByTimeAsync(2100);await stopped;
    expect(h.count("cancel_native_project_memory_dispatch")).toBe(1);
    expect(h.count("release_native_responses_request")).toBe(1);
    expect(h.count("approve_native_responses_request")).toBe(0);
    expect(h.count("dispatch_native_responses_request")).toBe(0);
  });
  it("bounds a stalled release after send with a sent fact and no automatic retry",async()=>{
    vi.useFakeTimers({toFake:["setTimeout","clearTimeout","Date","performance"]});
    const h=harness(true,true),{adapter,profile}=await h.open();h.stall("release_native_responses_request");
    const stopped=expect(adapter.complete(memoryRequest("release-stalled"))).rejects.toMatchObject({dispatchStatus:"sent"});
    await vi.waitFor(()=>expect(h.count("release_native_responses_request")).toBe(1));
    await vi.advanceTimersByTimeAsync(2100);await stopped;
    expect(profile.getSnapshot().lastDispatchStatus).toBe("sent");
    expect(h.count("release_native_responses_request")).toBe(1);
    expect(h.count("revoke_native_project_memory_scope")).toBe(1);
    await expect(adapter.complete(memoryRequest("no-retry"))).rejects.toThrow();
    expect(h.count("dispatch_native_responses_request")).toBe(1);
  });
});
