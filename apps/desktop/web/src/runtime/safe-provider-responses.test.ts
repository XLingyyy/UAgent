// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import {
  createOutboundConsentGate,
  RunScopeAuthority,
  DEEPSEEK_ENDPOINT,
  DEEPSEEK_MODEL,
  type RunScopeLease,
} from "@uagent/runtime";
import type { ProviderNativeContinuation, ProviderRuntimeRequest, TaskDraft } from "@uagent/shared";
import {
  createSafeProviderSession,
  RESPONSES_FIXTURE_CREDENTIAL,
  type SafeProviderSession,
} from "./safe-provider-session";
import { createAttachmentStore } from "./attachment-store";
import { ProviderRuntimeBridge } from "../../../../../packages/runtime/src/provider/provider-runtime-bridge";
import type { NativeInvoke } from "./project-native-adapter";

const providerId = "configured-responses",
  modelId = "configured-model",
  projectId = "root:fixture",
  endpoint = "https://api.openai.com/v1/responses";
const managers: SafeProviderSession[] = [];
const unlock: Array<() => void> = [];
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(async () => {
  for (const release of unlock.splice(0)) release();
  for (const manager of managers.splice(0)) {
    manager.dispose();
    await manager.whenSettled().catch(() => undefined);
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(
  patch: {
    responsesFixture?: boolean;
    native?: boolean;
    ttl?: number;
    nativeFixture?: boolean;
    autoApprove?: boolean;
    live?: boolean;
    modelSettings?: { supportsReasoning: boolean; requestDefaults: { temperature: number|null; maxOutputTokens: number|null } };
  } = {},
) {
  const calls: Array<{ command: string; input: Record<string, unknown> }> = [],
    records: ProviderNativeContinuation[] = [],
    gate = createOutboundConsentGate(),
    attachments = createAttachmentStore();
  let openWait: ReturnType<typeof deferred> | null = null,
    closeWait: ReturnType<typeof deferred> | null = null,
    closeFails = false,
    openFails = false,
    prepared = "",
    counter = 0;
  const invoke: NativeInvoke = async <T>(command: string, payload?: unknown) => {
    const input = (payload as { input: Record<string, unknown> }).input;
    calls.push({ command, input });
    let result: unknown = null;
    if (command === "open_native_responses_profile") {
      if (openWait) await openWait.promise;
      if (openFails) throw Error("untrusted native open detail");
      result = {
        profileId: "native-profile-" + ++counter,
        providerId: input.providerId,
        modelId: input.modelId,
        endpoint,
        expiresAt: Date.now() + (patch.ttl ?? 60000),
        fixture: patch.nativeFixture ?? !patch.live,
        modelSettings: patch.modelSettings ?? {supportsReasoning:false,requestDefaults:{temperature:null,maxOutputTokens:null}},
      };
    } else if (command === "close_native_responses_profile") {
      if (closeWait) await closeWait.promise;
      if (closeFails) throw Error("untrusted close detail " + RESPONSES_FIXTURE_CREDENTIAL);
    } else if (command === "bind_native_responses_run")
      result = {
        runHandle: "native-run-handle",
        owner: {
          providerId,
          modelId,
          projectId,
          projectEpoch: 42,
          runId: "run-fixture",
          conversationId: "conversation-fixture",
        },
      };
    else if(command==="bind_native_responses_conversation")result={runHandle:"native-chat",owner:{providerId,modelId,projectId:input.projectId===null?"chat:local":"chat:project:"+input.projectId,projectEpoch:43,runId:"chat-run-fixture",conversationId:input.conversationId}};
    else if (command === "load_native_provider_continuations") result = records;
    else if (command === "save_native_provider_continuation")
      records.push(input.record as ProviderNativeContinuation);
    else if (command === "prepare_native_responses_request") {
      prepared = input.body as string;
      result = {
        requestId: "native-request",
        endpoint,
        modelId,
        bodySha256: createHash("sha256").update(prepared).digest("hex"),
      };
    } else if (command === "poll_native_responses_request")
      result = {
        cursor: input.cursor,
        nextCursor: (input.cursor as number) + 1,
        head: { status: 200, contentType: "application/json" },
        chunks: [
          Array.from(
            new TextEncoder().encode(
              JSON.stringify({
                id: "resp_fixture",
                model: modelId,
                status: "completed",
                created_at: 1700000000,
                output: [
                  {
                    type: "message",
                    id: "msg_fixture",
                    role: "assistant",
                    status: "completed",
                    content: [
                      { type: "output_text", text: "Native fixture answer", annotations: [] },
                    ],
                  },
                ],
              }),
            ),
          ),
        ],
        done: true,
        error: null,
        dispatchStatus: "sent",
      };
    return result as T;
  };
  const fetcher = vi.fn(() => {
    throw Error("DeepSeek fallback must not run");
  });
  const manager = createSafeProviderSession({
    mode: patch.live ? "live" : "offline",
    liveAuthorized: patch.live,
    fetcher,
    nativeInvoke: patch.native === false ? null : invoke,
    responsesFixture: patch.responsesFixture ?? !patch.live,
    gate,
    attachments,
  });
  managers.push(manager);
  manager.updateContext(projectId, "Inspect", modelId, "conversation-fixture");
  if (patch.autoApprove !== false)
    gate.subscribe(() => {
      const pending = gate.getPending();
      if (pending) queueMicrotask(() => gate.approve(pending.id));
    });
  const count = (command: string) => calls.filter((call) => call.command === command).length;
  const open = () => manager.openResponses(providerId, modelId, patch.live ? "synthetic-local-test-credential" : RESPONSES_FIXTURE_CREDENTIAL);
  function lease(override: Partial<RunScopeLease["scope"]> = {}) {
    const generation = manager.getSessionGeneration(),
      authority = new RunScopeAuthority();
    return authority.approve(
      {
        id: "scope-fixture",
        runId: "run-fixture",
        projectId,
        conversationId: "conversation-fixture",
        rootRef: "E:/SyntheticProject",
        providerId,
        modelId,
        endpoint,
        mode: "read_only",
        readPrefixes: ["Source"],
        sharePrefixes: ["Source"],
        toolIds: ["project.read_file"],
        limits: {
          maxToolCalls: 3,
          maxModelRequests: 4,
          maxDurationMs: 60000,
          maxAttemptsPerFailure: 2,
          maxToolResultBytes: 8192,
          maxContextBytes: 24576,
        },
        expiresAt: Date.now() + 60000,
        ...override,
      },
      () => manager.getSnapshot().ready && manager.getSessionGeneration() === generation,
    );
  }
  return {
    calls,
    records,
    gate,
    manager,
    count,
    open,
    lease,
    attachments,
    fetcher,
    holdOpen() {
      openWait = deferred();
      unlock.push(openWait.resolve);
      return openWait.resolve;
    },
    holdClose() {
      closeWait = deferred();
      unlock.push(closeWait.resolve);
      return closeWait.resolve;
    },
    failClose() {
      closeFails = true;
    },
    failOpen() {
      openFails = true;
    },
    prepared: () => prepared,
  };
}
const request = (): ProviderRuntimeRequest => ({
  id: "request-fixture",
  providerId,
  modelId,
  messages: [{ role: "user", content: "Inspect the approved source." }],
  metadata: { projectId, runId: "run-fixture", purpose: "investigation" },
});

describe("safe Responses fixture controller (synthetic invoke only)", () => {
  it("opens an authorized live native profile without dispatch, credential persistence or a fixture fallback", async()=>{
    const h=setup({live:true});await expect(h.open()).resolves.toBe(true);
    expect(h.manager.getSnapshot()).toMatchObject({ready:true,fixture:false,wireApi:"responses"});
    expect(h.count("dispatch_native_responses_request")).toBe(0);
    expect(JSON.stringify(h.manager.getSnapshot())).not.toContain("synthetic-local-test-credential");
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it.each([{nativeFixture:true},{native:false}])("refuses wrong native mode or missing native transport in live mode: %j",async patch=>{
    const h=setup({live:true,...patch});await expect(h.open()).rejects.toThrow();
    expect(h.manager.getSnapshot().ready).toBe(false);
    expect(h.count("dispatch_native_responses_request")).toBe(0);expect(h.fetcher).not.toHaveBeenCalled();
  });
  it("rejects fixture and malformed credentials before native open in normal mode",async()=>{
    const h=setup({live:true});
    for(const key of [RESPONSES_FIXTURE_CREDENTIAL,"short","synthetic key","bad\ncredential"])
      await expect(h.manager.openResponses(providerId,modelId,key)).rejects.toThrow("responses_credential_invalid");
    expect(h.calls).toHaveLength(0);expect(h.manager.getSnapshot().nativeCloseFailed).toBe(false);
  });
  it.each([false,true])("sends two ordinary live-mode synthetic requests with exact intent and declared reasoning=%s",async supportsReasoning=>{
    const h=setup({live:true,autoApprove:false,modelSettings:{supportsReasoning,requestDefaults:{temperature:null,maxOutputTokens:null}}});await h.open();
    const bridge=new ProviderRuntimeBridge({adapter:{id:providerId,getCapabilities:()=>h.manager.adapter.getCapabilities(),complete:(r,c)=>h.manager.adapter.complete(r,c)},enabled:true});
    const history:Array<{role:"user"|"assistant";content:string}>=[];
    for(const [index,effort] of ["low","xhigh"].entries()){
      const text="live synthetic UI turn "+index;h.manager.updateContext(projectId,text,modelId,"conversation-fixture");
      const draft={permissionMode:"request_approval",runMode:"local",branch:"",contextPercent:0,taskMode:"discussion",input:text,projectId,providerId,modelId,reasoningEffort:effort,conversationId:"conversation-fixture",conversationHistory:[...history]} as TaskDraft;
      await bridge.execute({system:"Assistant",developer:"Discuss only",context:[],constraints:[],toolPolicy:["No tool execution is enabled by this request."],user:text,metadata:{providerId,providerModelId:modelId}},draft,"live-"+index,"plan-"+index,{authorizeSend:h.manager.captureOrdinarySend(draft,()=>true)});
      const body=JSON.parse(h.prepared());expect(body.model).toBe(modelId);
      expect(body.temperature).toBeUndefined();expect(body.max_output_tokens).toBeUndefined();
      expect(body.reasoning).toEqual(supportsReasoning?{effort}:undefined);
      expect(h.gate.getPending()).toBeNull();history.push({role:"user",content:text},{role:"assistant",content:"Native fixture answer"});
    }
    expect(h.count("dispatch_native_responses_request")).toBe(2);
    expect(h.count("approve_native_responses_request")).toBe(2);expect(h.fetcher).not.toHaveBeenCalled();
  });
  it("uses trusted ordinary send snapshots for two requests without a second dialog, retaining native approval", async () => {
    const h=setup({autoApprove:false});await h.open();
    const bridge=new ProviderRuntimeBridge({adapter:{id:providerId,getCapabilities:()=>h.manager.adapter.getCapabilities(),complete:(r,c)=>h.manager.adapter.complete(r,c)},enabled:true});
    const history: Array<{role:"user"|"assistant";content:string}>=[];
    for(const [index,effort] of ["low","xhigh"].entries()){
      const text="ordinary UI request "+index;
      h.manager.updateContext(projectId,text,modelId,"conversation-fixture");
      const draft={permissionMode:"request_approval",runMode:"local",branch:"",contextPercent:0,taskMode:"discussion",input:text,projectId,providerId,modelId,reasoningEffort:effort,conversationId:"conversation-fixture",conversationHistory:[...history]} as TaskDraft;
      const authorizeSend=h.manager.captureOrdinarySend(draft,()=>true);
      const seen:Array<unknown>=[];const unsubscribe=h.gate.subscribe(()=>seen.push(h.gate.getPending()));
      await bridge.execute({system:"You are an assistant.",developer:"Discuss only.",context:[],constraints:[],toolPolicy:["No tool execution is enabled by this request."],user:text,metadata:{providerId,providerModelId:modelId}},draft,"ordinary-"+index,"plan-"+index,{authorizeSend});
      unsubscribe();
      expect(h.gate.getPending()).toBeNull();expect(seen.every(value=>value===null)).toBe(true);
      expect(h.count("approve_native_responses_request")).toBe(index+1);expect(h.count("dispatch_native_responses_request")).toBe(index+1);
      expect(JSON.parse(h.prepared()).reasoning).toEqual({effort});
      history.push({role:"user",content:text},{role:"assistant",content:"Native fixture answer"});
    }
    expect(h.count("bind_native_responses_conversation")).toBe(1);expect(h.records).toHaveLength(2);
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it("ordinary send authorization rejects scope expansion, stale sources, replay and investigation modes", async () => {
    const h=setup({autoApprove:false});await h.open();const text="ordinary UI request";
    const draft={permissionMode:"request_approval",runMode:"local",branch:"",contextPercent:0,taskMode:"discussion",input:text,projectId,providerId,modelId,reasoningEffort:"low",conversationId:"conversation-fixture",conversationHistory:[]} as TaskDraft;
    const ordinary=():ProviderRuntimeRequest=>({...request(),reasoningEffort:"low",metadata:{projectId,conversationId:"conversation-fixture"},messages:[{role:"system",content:"system"},{role:"developer",content:"developer"},{role:"user",content:text+"\n\nNo tool execution is enabled by this request."}]});
    expect(()=>h.manager.captureOrdinarySend({...draft,taskMode:"investigation"},()=>true)).toThrow("unavailable");
    for(const expand of ["tool","history","reasoning","conversation"]){
      const authorize=h.manager.captureOrdinarySend(draft,()=>true),input=ordinary();
      if(expand==="tool")input.tools=[{name:"read",description:"not granted",parameters:{type:"object"}}];
      if(expand==="history")input.messages.splice(2,0,{role:"user",content:"unselected local result"});
      if(expand==="reasoning")input.reasoningEffort="xhigh";
      if(expand==="conversation")input.metadata!.conversationId="foreign";
      expect(()=>authorize(input,false)).toThrow("changed");
    }
    const stale=h.manager.captureOrdinarySend(draft,()=>true);h.manager.updateContext(projectId,"changed source",modelId,"conversation-fixture");
    expect(()=>stale(ordinary(),false)).toThrow("changed");
    const one=h.manager.captureOrdinarySend(draft,()=>true);one(ordinary(),false);
    expect(()=>one(ordinary(),false)).toThrow("already_used");
    expect(h.count("dispatch_native_responses_request")).toBe(0);expect(h.gate.getPending()).toBeNull();
  });


  it("uses each draft's reasoning selection through a cached ordinary bridge and exact native approval", async () => {
    vi.stubGlobal("fetch", vi.fn(() => { throw Error("No browser fetch"); }));
    const h = setup({ autoApprove: false });
    await h.open();
    // This fixture returns JSON; exercise the real bridge/controller via complete.
    const bridge = new ProviderRuntimeBridge({
      adapter: {
        id: providerId,
        getCapabilities: () => h.manager.adapter.getCapabilities(),
        complete: (request, options) => h.manager.adapter.complete(request, options),
      },
      enabled: true,
    });
    const input = {
      system: "You are a concise assistant.",
      developer: "Discuss only; no tools.",
      context: [], constraints: [], toolPolicy: [],
      user: "A synthetic ordinary question.",
      metadata: { providerId, providerModelId: modelId },
    };
    const reviews: string[] = [];
    for (const [index, selectedEffort] of ["low", "xhigh", "none", "auto"].entries()) {
      const draft = {
        taskMode: "discussion", projectId, providerId, modelId,
        conversationId: "conversation-fixture", reasoningEffort: selectedEffort,
      } as TaskDraft;
      const pending = bridge.execute(input, draft, "effort-task-" + index, "effort-plan-" + index);
      await vi.waitFor(() => expect(h.gate.getPending()).not.toBeNull());
      expect(h.count("dispatch_native_responses_request")).toBe(index);
      const review = h.gate.getPending()!;
      const body = JSON.parse(review.envelope.body);
      expect(body.reasoning).toEqual(selectedEffort === "auto" ? undefined : { effort: selectedEffort });
      expect(body.tools).toBeUndefined();
      expect(review.envelope.body).toBe(h.prepared());
      reviews.push(review.envelope.body);
      h.gate.approve(review.id);
      await pending;
      expect(h.count("dispatch_native_responses_request")).toBe(index + 1);
    }
    expect(h.calls.filter(c => c.command === "prepare_native_responses_request").map(c => c.input.body)).toEqual(reviews);
    expect(h.count("bind_native_responses_conversation")).toBe(1);
    expect(h.count("open_native_responses_profile")).toBe(1);
    expect(h.records).toHaveLength(4);
    expect(h.fetcher).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an unsupported per-request reasoning value before native preparation or approval", async () => {
    const h = setup({ autoApprove: false });
    await h.open();
    const input = {
      ...request(),
      metadata: { projectId, conversationId: "conversation-fixture" },
      reasoningEffort: "unsupported-effort",
    } as unknown as ProviderRuntimeRequest;
    await expect(h.manager.adapter.complete(input)).rejects.toMatchObject({ code: "malformed_response" });
    expect(h.count("prepare_native_responses_request")).toBe(0);
    expect(h.count("approve_native_responses_request")).toBe(0);
    expect(h.count("dispatch_native_responses_request")).toBe(0);
    expect(h.gate.getPending()).toBeNull();
  });

  it("routes ordinary requests through native chat and discards native ownership on conversation change",async()=>{
    vi.stubGlobal("fetch",vi.fn(()=>{throw Error("No browser fetch");}));
    const h=setup();await h.open();
    const input={...request(),metadata:{projectId,conversationId:"conversation-fixture"},messages:[{role:"user" as const,content:"ordinary question"}]};
    const result=await h.manager.adapter.complete(input);
    expect(result.text).toBe("Native fixture answer");expect(result.usageStatus).toBe("unknown");
    expect(h.count("bind_native_responses_conversation")).toBe(1);expect(h.count("bind_native_responses_run")).toBe(0);
    expect(h.manager.adapter.getCapabilities().supportsTools).toBe(false);
    h.manager.updateContext(projectId,"new question",modelId,"different-conversation");await h.manager.whenSettled();
    expect(h.manager.getSnapshot().ready).toBe(false);
    expect(h.count("close_native_responses_profile")).toBe(1);
    expect(h.fetcher).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
  });

  it.each([{ responsesFixture: false }, { native: false }])(
    "rejects unavailable fixture configuration without native calls: %j",
    async (patch) => {
      const h = setup(patch);
      await expect(h.open()).rejects.toThrow("responses_native_unavailable");
      expect(h.calls).toHaveLength(0);
      expect(h.manager.getSnapshot().ready).toBe(false);
    },
  );

  it("opens only explicit fixture input and reports actual provider/model/protocol without a connectivity claim", async () => {
    const h = setup();
    expect(h.manager.getSnapshot()).toMatchObject({
      ready: false,
      providerId: null,
      modelId: null,
      wireApi: null,
    });
    await expect(h.open()).resolves.toBe(true);
    expect(h.manager.getSnapshot()).toMatchObject({
      ready: true,
      providerId,
      modelId,
      endpoint,
      wireApi: "responses",
      fixture: true,
      nativeClosing: false,
    });
    expect(h.count("open_native_responses_profile")).toBe(1);
    expect(h.count("bind_native_responses_run")).toBe(0);
    expect(JSON.stringify(h.manager.getSnapshot())).not.toContain(RESPONSES_FIXTURE_CREDENTIAL);
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it("rejects arbitrary credentials before any native invocation", async () => {
    const h = setup();
    await expect(
      h.manager.openResponses(providerId, modelId, "synthetic-not-the-native-fixture-value"),
    ).rejects.toThrow("responses_fixture_credential_required");
    expect(h.calls).toHaveLength(0);
  });

  it("requires an actual live investigation lease and refuses an unowned generic request without fallback", async () => {
    const h = setup();
    await h.open();
    await expect(h.manager.adapter.complete(request())).rejects.toThrow("responses_chat_unavailable");
    const approved = h.lease();
    expect(() =>
      h.manager.createRunAdapter(JSON.parse(JSON.stringify(approved)) as RunScopeLease),
    ).toThrow("responses_run_scope_unavailable");
    expect(() => h.manager.createRunAdapter(h.lease({ projectId: "root:other" }))).toThrow(
      "responses_run_scope_unavailable",
    );
    const selected = h.manager.createRunAdapter(approved);
    expect(h.manager.createRunAdapter(approved)).toBe(selected);
    expect(selected.getCapabilities()).toMatchObject({
      providerId,
      modelIds: [modelId],
      isMock: true,
    });
    expect(h.count("bind_native_responses_run")).toBe(0);
    const result = await selected.complete(request());
    expect(result).toMatchObject({ text: "Native fixture answer", usageStatus: "unknown" });
    expect(result.usage).toBeUndefined();
    expect(h.count("bind_native_responses_run")).toBe(1);
    expect(h.records[0].owner.projectEpoch).toBe(42);
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it("does not implicitly attach selected local references to investigation requests", async () => {
    const h = setup();
    h.attachments.addAsset(
      projectId,
      "private selection",
      "Content/Private.uasset",
      "binary_asset",
    );
    h.attachments.select(h.attachments.getSnapshot().items[0].id, true);
    await h.open();
    await h.manager.createRunAdapter(h.lease()).complete(request());
    expect(h.prepared()).not.toContain("Private.uasset");
    expect(h.records).toHaveLength(1);
  });

  it("cancels during native setup, closes the eventual candidate, and waits for its explicit acknowledgement", async () => {
    const h = setup(),
      releaseOpen = h.holdOpen(),
      releaseClose = h.holdClose(),
      opening = h.open();
    await vi.waitFor(() => expect(h.count("open_native_responses_profile")).toBe(1));
    let settled = false;
    const closing = h.manager.closeAsync("setup_cancelled").then(() => {
      settled = true;
    });
    expect(h.manager.getSnapshot()).toMatchObject({ ready: false, nativeClosing: true });
    releaseOpen();
    await vi.waitFor(() => expect(h.count("close_native_responses_profile")).toBe(1));
    expect(settled).toBe(false);
    expect(h.manager.getSnapshot().ready).toBe(false);
    releaseClose();
    await expect(opening).resolves.toBe(false);
    await closing;
    expect(settled).toBe(true);
    expect(h.manager.getSnapshot()).toMatchObject({ ready: false, nativeClosing: false });
  });

  it.each(["project", "input"])(
    "a %s context change while opening prevents the candidate becoming ready",
    async (change) => {
      const h = setup(),
        release = h.holdOpen(),
        opening = h.open();
      await vi.waitFor(() => expect(h.count("open_native_responses_profile")).toBe(1));
      h.manager.updateContext(
        change === "project" ? "root:other" : projectId,
        "Changed",
        modelId,
        "conversation-fixture",
      );
      release();
      await expect(opening).resolves.toBe(false);
      await h.manager.whenSettled();
      expect(h.manager.getSnapshot()).toMatchObject({ ready: false, nativeClosing: false });
      expect(h.count("close_native_responses_profile")).toBe(1);
    },
  );

  it("waits for the prior native profile close before issuing a new open", async () => {
    const h = setup();
    await h.open();
    const release = h.holdClose(),
      next = h.open();
    await vi.waitFor(() => expect(h.count("close_native_responses_profile")).toBe(1));
    expect(h.count("open_native_responses_profile")).toBe(1);
    expect(h.manager.getSnapshot().ready).toBe(false);
    release();
    await expect(next).resolves.toBe(true);
    expect(h.count("open_native_responses_profile")).toBe(2);
    expect(h.manager.getSnapshot()).toMatchObject({ ready: true, fixture: true });
  });

  it("a failed close acknowledgement keeps all transitions blocked without leaking native error details", async () => {
    const h = setup();
    await h.open();
    h.failClose();
    await expect(h.manager.closeAsync("project_changed")).rejects.toThrow(
      "native_revocation_unconfirmed",
    );
    expect(h.manager.getSnapshot()).toMatchObject({
      ready: false,
      nativeClosing: true,
      nativeCloseFailed: true,
      canConfigure: false,
    });
    await expect(h.manager.whenSettled()).rejects.toThrow("native_revocation_unconfirmed");
    await expect(h.open()).rejects.toThrow("responses_native_unavailable");
    expect(() => h.manager.openAccount("synthetic-deepseek-input")).toThrow(
      "native_revocation_unconfirmed",
    );
    expect(h.count("open_native_responses_profile")).toBe(1);
    expect(JSON.stringify(h.manager.getSnapshot())).not.toContain(RESPONSES_FIXTURE_CREDENTIAL);
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it("an uncertain open failure is blocked instead of claiming the missing profile was revoked", async () => {
    const h = setup();
    h.failOpen();
    await expect(h.open()).rejects.toThrow("native_revocation_unconfirmed");
    await expect(h.manager.whenSettled()).rejects.toThrow("native_revocation_unconfirmed");
    expect(h.manager.getSnapshot()).toMatchObject({
      ready: false,
      nativeClosing: true,
      nativeCloseFailed: true,
    });
    expect(h.count("open_native_responses_profile")).toBe(1);
  });

  it("rejects a non-fixture native receipt after acknowledged cleanup", async () => {
    const h = setup({ nativeFixture: false });
    await expect(h.open()).rejects.toThrow("responses_setup_failed");
    await h.manager.whenSettled();
    expect(h.manager.getSnapshot()).toMatchObject({
      ready: false,
      nativeClosing: false,
      nativeCloseFailed: false,
    });
    expect(h.count("close_native_responses_profile")).toBe(1);
  });

  it("expired fixture credentials close once and never reopen automatically", async () => {
    vi.useFakeTimers();
    const h = setup({ ttl: 500 });
    await h.open();
    await vi.advanceTimersByTimeAsync(501);
    await h.manager.whenSettled();
    expect(h.manager.getSnapshot()).toMatchObject({
      ready: false,
      reason: "expired",
      wireApi: null,
    });
    expect(h.count("close_native_responses_profile")).toBe(1);
    expect(h.count("open_native_responses_profile")).toBe(1);
  });

  it("old adapters and leases cannot become current after close and a new explicit profile", async () => {
    const h = setup();
    await h.open();
    const originalLease = h.lease(),
      old = h.manager.createRunAdapter(originalLease);
    await h.manager.closeAsync();
    await h.open();
    await expect(old.complete(request())).rejects.toMatchObject({ code: "cancelled" });
    expect(() => h.manager.createRunAdapter(originalLease)).toThrow(
      "responses_run_scope_unavailable",
    );
    expect(h.count("bind_native_responses_run")).toBe(0);
    expect(h.count("dispatch_native_responses_request")).toBe(0);
  });

  it("DeepSeek can reopen only after the native close barrier and retains its original identity", async () => {
    const h = setup();
    await h.open();
    const release = h.holdClose();
    h.manager.close("cleared");
    expect(() => h.manager.openAccount("synthetic-deepseek-input")).toThrow(
      "native_revocation_unconfirmed",
    );
    release();
    await h.manager.whenSettled();
    h.manager.openAccount("synthetic-deepseek-input");
    expect(h.manager.getSnapshot()).toMatchObject({
      ready: true,
      providerId: "deepseek",
      modelId: DEEPSEEK_MODEL,
      endpoint: DEEPSEEK_ENDPOINT,
      wireApi: "chat_completions",
      fixture: true,
    });
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it("a draft cannot supply or change the approved run ownership", async () => {
    const h = setup();
    await h.open();
    const draft = {
      taskMode: "discussion",
      providerId,
      modelId,
      projectId,
      conversationId: "different",
    } as TaskDraft;
    expect(() => h.manager.createRunAdapter(h.lease(), draft)).toThrow(
      "responses_run_scope_unavailable",
    );
    expect(h.count("bind_native_responses_run")).toBe(0);
  });
});
