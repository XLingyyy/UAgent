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
function harness(autoApprove = true) {
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
  const failingCommands = new Set<string>();
  const invoke: NativeInvoke = async <T>(command: string, payload?: unknown) => {
    const input = (payload as { input: Record<string, unknown> }).input;
    calls.push({ command, input });
    hook?.(command);
    if (failingCommands.has(command)) throw Error("untrusted native detail " + key);
    let result: unknown;
    if (command === "open_native_responses_profile")
      result = {
        profileId: "native-profile-" + calls.filter((call) => call.command === command).length,
        providerId: owner.providerId,
        modelId: owner.modelId,
        endpoint,
        expiresAt: Date.now() + 60000,
        fixture: false,
      };
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
    } else if (command === "dispatch_native_responses_request") {
      nativeStatus = "mayHaveBeenSent";
      result = null;
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
        const value = body();
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
    fail(command: string) {
      failingCommands.add(command);
    },
    async open() {
      const profile = await createNativeResponsesProfile({
        invoke,
        providerId: owner.providerId,
        modelId: owner.modelId,
        credential: key,
        gate,
      });
      cleanup.push(profile.close);
      const adapter = profile.createRunAdapter({
        lease,
        getProjectContext: () => ({ projectId, revision }),
      });
      return { profile, adapter };
    },
  };
}

describe("Responses desktop native IPC bridge (synthetic invoke only)", () => {
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
