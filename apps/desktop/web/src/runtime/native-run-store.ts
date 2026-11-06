import type {
  ProviderRuntimeMessage,
  RunCheckpoint,
  RunContextPlan,
  RunEvent,
  RunJsonValue,
  RunStep,
  RunStoreCommit,
  RunStorePort,
  RunToolResult,
  TaskRun,
} from "@uagent/shared";

export type NativeRunStoreInvoke = (command: string, args: { input: unknown }) => Promise<unknown>;
type ActionStatus = "prepared" | "inFlight" | "succeeded" | "failed" | "unknown" | "skipped";
type StoredRunStatus =
  | "created"
  | "running"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "needsReconciliation";
interface StoredToolCall {
  id: string;
  stepId: string;
  toolName: string;
  arguments: RunJsonValue;
  result: RunJsonValue | null;
  status: ActionStatus;
}
export interface NativeRunCommitInput {
  schemaVersion: 1;
  projectId: string;
  sessionId: string;
  runId: string;
  goal: string;
  createdAt: number;
  expectedRevision: number;
  expectedMessageCount: number;
  batch: {
    status: StoredRunStatus;
    checkpoint: { nextStepId: string | null; reason: string; summary: string; capturedAt: number };
    messages: Array<{
      id: string;
      role: "system" | "user" | "assistant" | "tool";
      body: string;
      createdAt: number;
    }>;
    steps: Array<{ id: string; title: string; status: ActionStatus; dependsOn: string[] }>;
    toolCalls: StoredToolCall[];
    events: Array<{ id: string; kind: string; createdAt: number; data: RunJsonValue }>;
    changesets: [];
    artifacts: [];
  };
}
interface RunCursor {
  revision: number;
  capturedAt: number;
  messages: string[];
  calls: Map<string, StoredToolCall>;
  sequence: number;
  identity: string;
  poisoned: boolean;
  pendingCompletion?: { input: NativeRunCommitInput; messages: string[]; run: TaskRun };
  tail: Promise<void>;
}
const forbidden = new Set([
  "apikey",
  "authorization",
  "approval",
  "approvaltoken",
  "executiontoken",
  "accesstoken",
  "refreshtoken",
  "password",
  "secret",
  "credential",
  "credentials",
  "headers",
  "scope",
  "scoperef",
  "rootref",
  "endpoint",
  "expiresat",
]);
function completedUsage(payload: Record<string, unknown>): "reported" | "unknown" {
  const status = payload.usageStatus;
  if (status !== undefined && status !== "reported" && status !== "unknown") fail("usage_status");
  const hasUsage = payload.usage !== undefined;
  if (status !== undefined && (status === "reported") !== hasUsage) fail("usage_status");
  return hasUsage ? "reported" : "unknown";
}
function fail(reason: string): never {
  throw new Error("native_run_store_" + reason);
}
function integer(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) fail("invalid_integer");
  return value;
}
function text(value: string): string {
  if (typeof value !== "string") fail("invalid_text");
  return value;
}
function recordId(value: string): string {
  text(value);
  if (
    !value ||
    new TextEncoder().encode(value).length > 256 ||
    Array.from(value).some((character) => {
      const code = character.codePointAt(0)!;
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    })
  )
    fail("invalid_id");
  return value;
}
/** Reject structured credential/authority fields; freeform conversation text remains exact. */
function safeJson(value: unknown, depth = 0): RunJsonValue {
  if (depth > 64) fail("json_depth");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("invalid_number");
    return value;
  }
  if (Array.isArray(value)) return value.map((child) => safeJson(child, depth + 1));
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const result: Record<string, RunJsonValue> = {};
    for (const [key, child] of Object.entries(value)) {
      if (forbidden.has(key.replace(/[^a-z0-9]/gi, "").toLowerCase()))
        fail("credential_or_authority");
      Object.defineProperty(result, key, { value: safeJson(child, depth + 1), enumerable: true });
    }
    return result;
  }
  return fail("invalid_json");
}
function argumentsValue(value: string): RunJsonValue {
  try {
    return safeJson(JSON.parse(text(value)));
  } catch {
    return fail("unsafe_tool_arguments");
  }
}
function providerMessage(message: ProviderRuntimeMessage): ProviderRuntimeMessage {
  if (!["system", "developer", "user", "assistant", "tool"].includes(message.role))
    fail("message_role");
  const result: ProviderRuntimeMessage = { role: message.role, content: text(message.content) };
  if (message.name !== undefined) result.name = text(message.name);
  if (message.toolCallId !== undefined) result.toolCallId = recordId(message.toolCallId);
  if (message.toolCalls !== undefined)
    result.toolCalls = message.toolCalls.map((call) => {
      argumentsValue(call.arguments);
      return { id: recordId(call.id), name: recordId(call.name), arguments: text(call.arguments) };
    });
  return result;
}
function sourceRef(source: RunToolResult["sources"][number], projectId: string): RunJsonValue {
  knownKeys(source, ["projectId", "path", "version", "kind", "freshness"]);
  if (
    source.projectId !== projectId ||
    !["project_index", "index_query", "file_preview", "tool"].includes(source.kind)
  )
    fail("source_scope");
  if (!source.version) fail("source_version");
  if (
    source.freshness !== undefined &&
    (typeof source.freshness !== "string" || !source.freshness || source.freshness.length > 256)
  )
    fail("source_freshness");
  return {
    projectId,
    path: text(source.path),
    version: text(source.version),
    kind: source.kind,
    ...(source.freshness === undefined ? {} : { freshness: source.freshness }),
  };
}
function knownKeys(value: unknown, allowed: readonly string[]): void {
  if (Object.keys(object(value)).some((key) => !allowed.includes(key))) fail("unknown_plan_field");
}
function contextPlanView(
  plan: RunContextPlan,
  run: TaskRun,
  messages: ProviderRuntimeMessage[],
): RunJsonValue {
  knownKeys(plan, [
    "schemaVersion",
    "planId",
    "runId",
    "projectId",
    "conversationId",
    "method",
    "maxBytes",
    "usedBytes",
    "fullRecordMessageCount",
    "scopeDescription",
    "segments",
    "omitted",
  ]);
  if (
    plan.schemaVersion !== 1 ||
    plan.method !== "deterministic-selection-v1" ||
    plan.runId !== run.runId ||
    plan.projectId !== run.projectId ||
    plan.conversationId !== run.conversationId
  )
    fail("context_plan_scope");
  const fullCount = integer(plan.fullRecordMessageCount),
    maxBytes = integer(plan.maxBytes),
    usedBytes = integer(plan.usedBytes);
  if (
    !fullCount ||
    fullCount > messages.length ||
    !maxBytes ||
    maxBytes > run.limits.maxContextBytes ||
    usedBytes > maxBytes
  )
    fail("context_plan_bounds");
  knownKeys(plan.scopeDescription, ["mode", "readPrefixes", "sharePrefixes"]);
  if (
    plan.scopeDescription.mode !== "read_only" ||
    JSON.stringify(plan.scopeDescription.readPrefixes) !== JSON.stringify(run.scope.readPrefixes) ||
    JSON.stringify(plan.scopeDescription.sharePrefixes) !== JSON.stringify(run.scope.sharePrefixes)
  )
    fail("context_plan_bounds");
  const seen = new Set<number>();
  function indexes(values: number[]): number[] {
    if (!Array.isArray(values) || !values.length) fail("context_plan_indexes");
    return values.map((value) => {
      integer(value);
      if (value >= fullCount || seen.has(value)) fail("context_plan_indexes");
      seen.add(value);
      return value;
    });
  }
  const segments = plan.segments.map((segment) => {
    knownKeys(segment, ["category", "originalMessageIndexes", "selection", "sources", "excerpts"]);
    if (
      !["goal", "constraints", "history", "project_fact", "tool_result"].includes(
        segment.category,
      ) ||
      !["exact", "deterministic_excerpt"].includes(segment.selection)
    )
      fail("context_plan_selection");
    const selected = indexes(segment.originalMessageIndexes);
    const excerpts = segment.excerpts?.map((range) => {
      knownKeys(range, ["messageIndex", "start", "end", "unit"]);
      const messageIndex = integer(range.messageIndex),
        start = integer(range.start),
        end = integer(range.end);
      if (
        range.unit !== "utf16" ||
        !selected.includes(messageIndex) ||
        start >= end ||
        end > messages[messageIndex]!.content.length
      )
        fail("context_plan_range");
      return { messageIndex, start, end, unit: "utf16" };
    });
    if (
      (segment.selection === "exact" && excerpts !== undefined) ||
      (segment.selection === "deterministic_excerpt" && !excerpts?.length)
    )
      fail("context_plan_selection");
    return {
      category: segment.category,
      originalMessageIndexes: selected,
      selection: segment.selection,
      sources: segment.sources.map((source) => sourceRef(source, run.projectId)),
      ...(excerpts === undefined ? {} : { excerpts }),
    };
  });
  const omitted = plan.omitted.map((item) => {
    knownKeys(item, ["originalMessageIndexes", "reason"]);
    if (!["budget", "superseded"].includes(item.reason)) fail("context_plan_omission");
    return { originalMessageIndexes: indexes(item.originalMessageIndexes), reason: item.reason };
  });
  if (seen.size !== fullCount) fail("context_plan_indexes");
  return safeJson({
    schemaVersion: 1,
    planId: recordId(plan.planId),
    runId: run.runId,
    projectId: run.projectId,
    conversationId: run.conversationId,
    method: plan.method,
    maxBytes,
    usedBytes,
    fullRecordMessageCount: fullCount,
    scopeDescription: {
      mode: "read_only",
      readPrefixes: plan.scopeDescription.readPrefixes.map(text),
      sharePrefixes: plan.scopeDescription.sharePrefixes.map(text),
    },
    segments,
    omitted,
  });
}

function toolResult(result: RunToolResult, projectId: string): RunJsonValue {
  if (
    !["completed", "blocked", "failed", "cancelled"].includes(result.status) ||
    !["not_started", "applied", "partial", "unknown", "compensated"].includes(result.effectState) ||
    typeof result.truncated !== "boolean"
  )
    fail("tool_result");
  return {
    callId: recordId(result.callId),
    toolId: recordId(result.toolId),
    status: result.status,
    effectState: result.effectState,
    output: safeJson(result.output),
    sources: result.sources.map((source) => sourceRef(source, projectId)),
    truncated: result.truncated,
    ...(result.diagnosticCode === undefined ? {} : { diagnosticCode: text(result.diagnosticCode) }),
  };
}
function checkpointView(checkpoint: RunCheckpoint, run: TaskRun): RunJsonValue {
  if (checkpoint.runId !== run.runId || checkpoint.schemaVersion !== 1) fail("checkpoint_scope");
  return {
    schemaVersion: 1,
    runId: run.runId,
    completedStepIds: checkpoint.completedStepIds.map(recordId),
    unresolvedEffects: checkpoint.unresolvedEffects.map((effect) => {
      if (
        !["not_started", "applied", "partial", "unknown", "compensated"].includes(
          effect.effectState,
        )
      )
        fail("effect_state");
      return {
        callId: recordId(effect.callId),
        toolId: recordId(effect.toolId),
        effectState: effect.effectState,
      };
    }),
    contextRefs: checkpoint.contextRefs.map((source) => sourceRef(source, run.projectId)),
    nextStepId: checkpoint.nextStepId === null ? null : recordId(checkpoint.nextStepId),
    reason: text(checkpoint.reason),
  };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("event_payload");
  return value as Record<string, unknown>;
}
function eventView(
  event: RunEvent,
  run: TaskRun,
  messages: ProviderRuntimeMessage[],
): RunJsonValue {
  const payload = event.payload === undefined ? {} : object(event.payload);
  const string = (name: string) => text(payload[name] as string);
  let data: RunJsonValue;
  switch (event.type) {
    case "run_created":
      data = {};
      break; // scopeRef is an ephemeral lease reference.
    case "status_changed":
      data = {
        status: string("status"),
        ...(payload.reason === undefined ? {} : { reason: string("reason") }),
        ...(payload.pauseRequested === undefined
          ? {}
          : { pauseRequested: payload.pauseRequested === true }),
      };
      break;
    case "model_started":
      data = {
        requestId: string("requestId"),
        ...(payload.contextPlan === undefined
          ? {}
          : { contextPlan: contextPlanView(payload.contextPlan as RunContextPlan, run, messages) }),
      };
      break;
    case "model_text_delta":
      data = { text: string("text") };
      break;
    case "model_completed":
      data = {
        requestId: string("requestId"),
        ...(payload.finishReason === undefined ? {} : { finishReason: string("finishReason") }),
        usageStatus: completedUsage(payload),
        ...(payload.usage === undefined ? {} : { usage: safeJson(payload.usage) }),
      };
      break;
    case "tool_requested":
      argumentsValue(string("arguments"));
      data = { callId: string("callId"), name: string("name"), arguments: string("arguments"), ...(payload.providerCallId===undefined?{}:{providerCallId:string("providerCallId")}) };
      break;
    case "tool_started":
      data = { callId: string("callId"), name: string("name") };
      break;
    case "tool_completed":
    case "tool_failed":
      data = { result: toolResult(payload.result as RunToolResult, run.projectId) };
      break;
    case "checkpoint_created":
      data = { checkpoint: checkpointView(payload.checkpoint as RunCheckpoint, run) };
      break;
    default:
      return fail("event_type");
  }
  return {
    schemaVersion: 1,
    eventId: recordId(event.eventId),
    runId: run.runId,
    sequence: integer(event.sequence),
    agentId: recordId(event.agentId),
    createdAt: integer(event.createdAt),
    type: event.type,
    ...(event.stepId === undefined ? {} : { stepId: recordId(event.stepId) }),
    payload: data,
  };
}
function runStatus(status: TaskRun["status"]): StoredRunStatus {
  switch (status) {
    case "queued":
      return "created";
    case "planning":
    case "running":
    case "verifying":
      return "running";
    case "waiting_approval":
    case "paused":
    case "interrupted":
      return "paused";
    case "reconciling":
      return "needsReconciliation";
    case "completed":
      return "succeeded";
    case "failed":
    case "cancelled":
      return status;
    default:
      return fail("run_status");
  }
}
function actionStatus(step: RunStep): ActionStatus {
  if (step.result) {
    if (["partial", "unknown"].includes(step.result.effectState)) return "unknown";
    if (step.result.status === "completed") return "succeeded";
    if (step.result.status === "blocked") return "skipped";
    if (step.result.status === "cancelled")
      return step.result.effectState === "not_started" || step.result.effectState === "compensated"
        ? "skipped"
        : "unknown";
    return "failed";
  }
  if (step.status === "pending") return "prepared";
  if (step.status === "running") return "inFlight";
  // No fabricated failure/result for an operation interrupted before observation.
  if (step.status === "cancelled") return step.callId ? "unknown" : "skipped";
  return fail("missing_observed_result");
}
function mapCommit(
  update: RunStoreCommit,
  cursor: RunCursor,
): { input: NativeRunCommitInput; next: Pick<RunCursor, "messages" | "calls" | "sequence" | "capturedAt"> } {
  const run = update.run;
  if (
    run.schemaVersion !== 1 ||
    run.scope.runId !== run.runId ||
    run.scope.projectId !== run.projectId ||
    run.scope.conversationId !== run.conversationId ||
    run.scope.mode !== "read_only"
  )
    fail("scope_mismatch");
  [run.runId, run.taskId, run.projectId, run.conversationId].forEach(recordId);
  if (
    cursor.identity !== JSON.stringify([run.projectId, run.conversationId, run.goal, run.createdAt])
  )
    fail("identity_changed");
  const messages = update.messages.map((message) =>
    JSON.stringify({ format: "uagent.provider-message.v1", message: providerMessage(message) }),
  );
  if (
    messages.length < cursor.messages.length ||
    cursor.messages.some((body, index) => messages[index] !== body)
  )
    fail("message_prefix_changed");
  const startedPlans = update.events
    .filter((event) => event.type === "model_started")
    .map((event) => object(event.payload).contextPlan)
    .filter((value) => value !== undefined);
  const latestPlan = update.contextPlan ?? (startedPlans.at(-1) as RunContextPlan | undefined);
  const contextPlan =
    latestPlan === undefined ? undefined : contextPlanView(latestPlan, run, update.messages);
  if (
    contextPlan !== undefined &&
    startedPlans.some(
      (plan) =>
        JSON.stringify(contextPlanView(plan as RunContextPlan, run, update.messages)) !==
        JSON.stringify(contextPlan),
    )
  )
    fail("context_plan_mismatch");
  let sequence = cursor.sequence;
  const eventIds = new Set<string>();
  const events: NativeRunCommitInput["batch"]["events"] = update.events.map((event) => {
    if (
      event.schemaVersion !== 1 ||
      event.runId !== run.runId ||
      integer(event.sequence) !== sequence + 1 ||
      eventIds.has(event.eventId)
    )
      fail("event_order");
    eventIds.add(event.eventId);
    sequence = event.sequence;
    return {
      id: event.eventId,
      kind: event.type,
      createdAt: integer(event.createdAt),
      data: eventView(event, run, update.messages),
    };
  });
  const calls = new Map(cursor.calls);
  const stepIds = new Set<string>();
  const steps = run.steps.map((step) => {
    const id = recordId(step.stepId);
    if (stepIds.has(id)) fail("duplicate_step");
    stepIds.add(id);
    const status = actionStatus(step);
    if (step.callId) {
      const previous = calls.get(id);
      const requested = update.events.find(
        (event) =>
          event.type === "tool_requested" &&
          event.stepId === id &&
          object(event.payload).callId === step.callId,
      );
      if (!previous && !requested) fail("missing_tool_intent");
      const request = requested ? object(requested.payload) : null;
      // Event arguments are redacted diagnostics. Exact execution arguments come
      // from the provider envelope that requested this particular call.
      const exact = request
        ? [...update.messages]
            .reverse()
            .filter((message) => message.role === "assistant")
            .flatMap((message) => message.toolCalls ?? [])
            .find((call) => call.id === step.callId)
        : undefined;
      if (request && (!exact || exact.name !== request.name)) fail("tool_envelope_mismatch");
      const argumentsJson = exact ? argumentsValue(exact.arguments) : previous!.arguments;
      const toolName = exact ? recordId(exact.name) : previous!.toolName;
      if (previous?.result !== null && previous?.result !== undefined && step.result === undefined)
        fail("tool_observation_removed");
      if (
        previous &&
        (previous.toolName !== toolName ||
          JSON.stringify(previous.arguments) !== JSON.stringify(argumentsJson))
      )
        fail("tool_identity_changed");
      if (step.result && step.result.callId !== step.callId) fail("tool_result_call_mismatch");
      calls.set(id, {
        id: recordId(id + ":tool"),
        stepId: id,
        toolName,
        arguments: argumentsJson,
        result: step.result ? toolResult(step.result, run.projectId) : null,
        status,
      });
    }
    return { id, title: text(step.executor), status, dependsOn: step.dependencies.map(recordId) };
  });
  if ([...cursor.calls.keys()].some((id) => !stepIds.has(id))) fail("step_removed");
  const capturedAt = Math.max(
    cursor.capturedAt,
    integer(run.updatedAt),
    integer(run.createdAt),
    ...update.events.map((event) => event.createdAt),
  );
  const scopeDescription: RunJsonValue = {
    mode: "read_only",
    readPrefixes: run.scope.readPrefixes.map(text),
    sharePrefixes: run.scope.sharePrefixes.map(text),
    toolIds: run.scope.toolIds.map(recordId),
    providerId: text(run.scope.providerId),
    modelId: text(run.scope.modelId),
  };
  const state = safeJson({
    format: "uagent.coordinator-state.v1",
    runId: run.runId,
    taskId: run.taskId,
    projectId: run.projectId,
    conversationId: run.conversationId,
    goal: text(run.goal),
    planVersion: integer(run.planVersion),
    ...(run.collaboration===undefined?{}:{collaboration:safeJson({...(run.collaboration.assignments?{assignments:run.collaboration.assignments}:{}),mode:run.collaboration.mode,activeAgent:run.collaboration.activeAgent,
      ...(run.collaboration.members?{members:Object.fromEntries(Object.entries(run.collaboration.members).map(([id,member])=>[id,{role:member.role,focus:member.focus,...(member.model?{model:{providerId:member.model.providerId,modelId:member.model.modelId}}:{})}]))}:{}),
      ...(run.collaboration.workers?{workers:run.collaboration.workers.map(worker=>({agentId:text(worker.agentId),runId:recordId(worker.runId),status:text(worker.status),modelRequests:integer(worker.modelRequests),toolCalls:integer(worker.toolCalls),...(worker.stopReason?{stopReason:text(worker.stopReason)}:{})}))}:{}),
      calls:run.collaboration.calls.map(call=>({agentId:text(call.agentId),requestId:text(call.requestId),callId:recordId(call.callId),providerCallId:text(call.providerCallId)})),
      reports:run.collaboration.reports.map(report=>({agentId:text(report.agentId),text:text(report.text),stepIds:report.stepIds.map(recordId)}))})}),
    status: run.status,
    limits: safeJson(run.limits),
    ...(run.parentRunId === undefined ? {} : { parentRunId: recordId(run.parentRunId) }),
    modelRequests: integer(run.modelRequests),
    toolCalls: integer(run.toolCalls),
    createdAt: integer(run.createdAt),
    updatedAt: integer(run.updatedAt),
    ...(run.finishedAt === undefined ? {} : { finishedAt: integer(run.finishedAt) }),
    ...(run.stopReason === undefined ? {} : { stopReason: text(run.stopReason) }),
    scopeDescription,
    messageCount: messages.length,
    ...(contextPlan === undefined ? {} : { contextPlan }),
    steps: run.steps.map((step) => ({
      stepId: step.stepId,
      dependencies: step.dependencies.map(recordId),
      inputRefs: step.inputRefs.map(text),
      preconditions: step.preconditions.map(text),
      executor: step.executor,
      status: step.status,
      ...(step.callId === undefined ? {} : { callId: step.callId }),
      ...(step.result === undefined ? {} : { result: toolResult(step.result, run.projectId) }),
    })),
    ...(update.checkpoint === undefined
      ? {}
      : { checkpoint: checkpointView(update.checkpoint, run) }),
    requiresFreshAuthorization: true,
  });
  events.push({
    id: recordId(run.runId + ":state:" + (cursor.revision + 1)),
    kind: "coordinator_state_v1",
    createdAt: capturedAt,
    data: state,
  });
  const nativeStepId = update.checkpoint?.nextStepId;
  return {
    input: {
      schemaVersion: 1,
      projectId: run.projectId,
      sessionId: run.conversationId,
      runId: run.runId,
      goal: run.goal,
      createdAt: run.createdAt,
      expectedRevision: cursor.revision,
      expectedMessageCount: cursor.messages.length,
      batch: {
        status: runStatus(run.status),
        checkpoint: {
          nextStepId: nativeStepId && stepIds.has(nativeStepId) ? nativeStepId : null,
          reason: update.checkpoint?.reason ?? run.stopReason ?? "coordinatorTransition",
          summary: "Coordinator transition recorded",
          capturedAt,
        },
        messages: messages.slice(cursor.messages.length).map((body, offset) => {
          const message = update.messages[cursor.messages.length + offset]!;
          return {
            id: recordId(run.runId + ":message:" + (cursor.messages.length + offset + 1)),
            role: message.role === "developer" ? "system" : message.role,
            body,
            createdAt: capturedAt,
          };
        }),
        steps,
        toolCalls: [...calls.values()],
        events,
        changesets: [],
        artifacts: [],
      },
    },
    next: { messages, calls, sequence, capturedAt },
  };
}

function globalInvoke(): NativeRunStoreInvoke | null {
  return (
    (globalThis as { __TAURI_INTERNALS__?: { invoke?: NativeRunStoreInvoke } }).__TAURI_INTERNALS__
      ?.invoke ?? null
  );
}
/**
 * A failed/uncertain acknowledgement blocks writes for the life of this adapter.
 * Only exact read-only confirmation of a final commit may restore completed UI state.
 * Reloading history is a separate display operation and never reconstructs scheduling authority.
 */
export function createNativeRunStore(
  invoke: NativeRunStoreInvoke | null = globalInvoke(),
): RunStorePort {
  const cursors = new Map<string, RunCursor>();
  return {
    async reconcileCompleted(runId) {
      const current=cursors.get(runId);
      if(!current||!invoke)return null;
      await current.tail;
      const pending=current.pendingCompletion;
      if(!current.poisoned||!pending)return null;
      try {
        const archive=object(await invoke("snapshot_native_run_store",{input:{schemaVersion:1,projectId:pending.input.projectId,runId}}));
        const snapshot=object(archive.snapshot),saved=object(snapshot.run),complete=object(archive.completeness);
        const expectedState=pending.input.batch.events.find(e=>e.kind==="coordinator_state_v1")!.data;
        // Compare JSON structurally: Rust serialization may reorder object keys.
        const canonical=(v:unknown):string=>JSON.stringify(v,(_key,x)=>x&&typeof x==="object"&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
        if(archive.schemaVersion!==1||saved.projectId!==pending.input.projectId||saved.id!==runId||saved.status!=="succeeded"||saved.revision!==pending.input.expectedRevision+1||complete.complete!==true||complete.loadedMessageCount!==pending.messages.length||complete.storedMessageCount!==pending.messages.length||canonical(archive.coordinatorState)!==canonical(expectedState)||!Array.isArray(archive.messages))return null;
        if(archive.messages.length!==pending.messages.length||archive.messages.some((value,index)=>{const m=object(value);return m.id!==runId+":message:"+(index+1)||m.body!==pending.messages[index];}))return null;
        return JSON.parse(JSON.stringify(pending.run)) as TaskRun;
      } catch { return null; }
    },
    commit(update) {
      const snapshot = JSON.parse(JSON.stringify(update)) as RunStoreCommit;
      const run = snapshot.run;
      let cursor = cursors.get(run.runId);
      if (!cursor) {
        cursor = {
          revision: 0,
          capturedAt: 0,
          messages: [],
          calls: new Map(),
          sequence: 0,
          identity: JSON.stringify([run.projectId, run.conversationId, run.goal, run.createdAt]),
          poisoned: false,
          tail: Promise.resolve(),
        };
        cursors.set(run.runId, cursor);
      }
      const current = cursor;
      const operation = current.tail.then(async () => {
        if (current.poisoned) fail("reconciliation_required");
        try {
          if (!invoke) fail("unavailable");
          const { input, next } = mapCommit(snapshot, current);
          if(run.status==="completed")current.pendingCompletion={input,messages:next.messages,run:snapshot.run};
          const ack = object(await invoke("commit_native_run_store", { input }));
          if (
            ack.schemaVersion !== 1 ||
            ack.projectId !== run.projectId ||
            ack.runId !== run.runId ||
            ack.revision !== current.revision + 1 ||
            ack.messageCount !== next.messages.length
          )
            fail("invalid_acknowledgement");
          Object.assign(current, next);
          current.revision++;
        } catch (error) {
          current.poisoned = true;
          throw error;
        }
      });
      current.tail = operation.catch(() => undefined);
      return operation;
    },
  };
}
