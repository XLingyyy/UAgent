import type { ProviderRuntimeMessage, RunJsonValue } from "@uagent/shared";
import type { NativeRunStoreInvoke } from "./native-run-store";

export type NativeHistoryStatus =
  | "created"
  | "running"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "needsReconciliation";
export type NativeHistoryActionStatus =
  | "prepared"
  | "inFlight"
  | "succeeded"
  | "failed"
  | "unknown"
  | "skipped";
/** Archived root is a display/retrust descriptor. It is never a native root reference or permission. */
export interface NativeHistoryRun {
  projectId: string;
  projectLabel: string;
  projectRoot: string;
  sessionId: string;
  sessionTitle: string;
  runId: string;
  goal: string;
  status: NativeHistoryStatus;
  updatedAt: number;
  hasUnresolvedEffects: boolean;
}
export interface NativeHistoryPage {
  schemaVersion: 1;
  runs: NativeHistoryRun[];
  offset: number;
  limit: number;
  hasMore: boolean;
}
export interface NativeHistoryToolCall {
  id: string;
  stepId: string;
  toolName: string;
  arguments: RunJsonValue;
  result: RunJsonValue | null;
  status: NativeHistoryActionStatus;
}
export interface NativeHistorySnapshot {
  run: {
    projectId: string;
    id: string;
    sessionId: string;
    goal: string;
    status: NativeHistoryStatus;
    revision: number;
    createdAt: number;
    updatedAt: number;
  };
  checkpoint: RunJsonValue;
  steps: Array<{
    id: string;
    title: string;
    status: NativeHistoryActionStatus;
    dependsOn: string[];
  }>;
  toolCalls: NativeHistoryToolCall[];
  changesets: RunJsonValue[];
  artifacts: RunJsonValue[];
  requiresFreshAuthorization: true;
  hasUnknownExternalEffects: boolean;
}
export interface NativeArchivedMessage {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  body: string;
  createdAt: number;
}
export interface NativeHistoryEvent {
  id: string;
  kind: string;
  createdAt: number;
  data: RunJsonValue;
}
/** Data only: no scope token, credentials, approval or restored coordinator instance. */
export interface NativeRunArchive {
  schemaVersion: 1;
  descriptor: NativeHistoryRun;
  snapshot: NativeHistorySnapshot;
  coordinatorState: Record<string, RunJsonValue> | null;
  messages: NativeArchivedMessage[];
  providerMessages: ProviderRuntimeMessage[];
  events: NativeHistoryEvent[];
  completeness: {
    complete: boolean;
    loadedMessageCount: number;
    storedMessageCount: number | null;
    reason: string | null;
  };
}
export interface NativeRunHistoryPort {
  list(input?: { projectId?: string; offset?: number; limit?: number }): Promise<NativeHistoryPage>;
  snapshot(projectId: string, runId: string): Promise<NativeRunArchive>;
}
const statuses: readonly string[] = [
  "created",
  "running",
  "paused",
  "succeeded",
  "failed",
  "cancelled",
  "needsReconciliation",
];
const actionStatuses: readonly string[] = [
  "prepared",
  "inFlight",
  "succeeded",
  "failed",
  "unknown",
  "skipped",
];
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
function invalid(): never {
  throw new Error("native_run_history_invalid_record");
}
function object(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  return typeof value === "string" ? value : invalid();
}
function id(value: unknown): string {
  const result = text(value);
  if (
    !result ||
    new TextEncoder().encode(result).length > 256 ||
    Array.from(result).some(char=>{const code=char.codePointAt(0)!;return code<=0x1f||(code>=0x7f&&code<=0x9f);})
  )
    return invalid();
  return result;
}
function integer(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : invalid();
}
function boolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : invalid();
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : invalid();
}
function safeJson(value: unknown, depth = 0): RunJsonValue {
  if (depth > 64) return invalid();
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : invalid();
  if (Array.isArray(value)) return value.map((child) => safeJson(child, depth + 1));
  const source = object(value),
    result: Record<string, RunJsonValue> = {};
  for (const [key, child] of Object.entries(source)) {
    if (forbidden.has(key.replace(/[^a-z0-9]/gi, "").toLowerCase())) return invalid();
    Object.defineProperty(result, key, { value: safeJson(child, depth + 1), enumerable: true });
  }
  return result;
}
function status(value: unknown): NativeHistoryStatus {
  return statuses.includes(text(value)) ? (value as NativeHistoryStatus) : invalid();
}
function actionStatus(value: unknown): NativeHistoryActionStatus {
  return actionStatuses.includes(text(value)) ? (value as NativeHistoryActionStatus) : invalid();
}
function descriptor(value: unknown): NativeHistoryRun {
  const source = object(value);
  return {
    projectId: id(source.projectId),
    projectLabel: text(source.projectLabel),
    projectRoot: text(source.projectRoot),
    sessionId: id(source.sessionId),
    sessionTitle: text(source.sessionTitle),
    runId: id(source.runId),
    goal: text(source.goal),
    status: status(source.status),
    updatedAt: integer(source.updatedAt),
    hasUnresolvedEffects: boolean(source.hasUnresolvedEffects),
  };
}
function providerMessage(value: NativeArchivedMessage): ProviderRuntimeMessage {
  const envelope = object(JSON.parse(value.body));
  if (envelope.format !== "uagent.provider-message.v1") return invalid();
  const source = object(envelope.message),
    role = text(source.role);
  if (
    !["system", "developer", "user", "assistant", "tool"].includes(role) ||
    (role === "developer" ? "system" : role) !== value.role
  )
    return invalid();
  const result: ProviderRuntimeMessage = {
    role: role as ProviderRuntimeMessage["role"],
    content: text(source.content),
  };
  if (source.name !== undefined) result.name = text(source.name);
  if (source.toolCallId !== undefined) result.toolCallId = id(source.toolCallId);
  if (source.toolCalls !== undefined)
    result.toolCalls = list(source.toolCalls).map((value) => {
      const call = object(value),
        args = text(call.arguments);
      safeJson(JSON.parse(args));
      return { id: id(call.id), name: id(call.name), arguments: args };
    });
  return result;
}
function parseArchive(value: unknown, projectId: string, runId: string): NativeRunArchive {
  const source = object(value),
    saved = descriptor(source.descriptor),
    raw = object(source.snapshot),
    run = object(raw.run);
  if (
    source.schemaVersion !== 1 ||
    saved.projectId !== projectId ||
    saved.runId !== runId ||
    run.projectId !== projectId ||
    run.id !== runId ||
    run.sessionId !== saved.sessionId ||
    run.goal !== saved.goal ||
    run.status !== saved.status ||
    raw.requiresFreshAuthorization !== true
  )
    return invalid();
  const messages = list(source.messages).map((value) => {
    const message = object(value),
      role = text(message.role);
    if (!["system", "user", "assistant", "tool"].includes(role)) return invalid();
    return {
      id: id(message.id),
      role: role as NativeArchivedMessage["role"],
      body: text(message.body),
      createdAt: integer(message.createdAt),
    };
  });
  if (new Set(messages.map((message) => message.id)).size !== messages.length) return invalid();
  const completeness = object(source.completeness),
    loadedMessageCount = integer(completeness.loadedMessageCount),
    storedMessageCount =
      completeness.storedMessageCount === null ? null : integer(completeness.storedMessageCount),
    complete = boolean(completeness.complete);
  if (
    loadedMessageCount !== messages.length ||
    (complete && storedMessageCount !== messages.length)
  )
    return invalid();
  const coordinatorState =
    source.coordinatorState === null
      ? null
      : (object(safeJson(source.coordinatorState)) as Record<string, RunJsonValue>);
  const events = list(source.events).map((value) => {
    const event = object(value);
    return {
      id: id(event.id),
      kind: id(event.kind),
      createdAt: integer(event.createdAt),
      data: safeJson(event.data),
    };
  });
  if (new Set(events.map((event) => event.id)).size !== events.length) return invalid();
  let sequence = 0;
  for (const event of events) {
    if (event.kind === "coordinator_state_v1") continue;
    const data = object(event.data);
    if (
      data.runId !== runId ||
      data.eventId !== event.id ||
      data.type !== event.kind ||
      data.createdAt !== event.createdAt ||
      integer(data.sequence) <= sequence
    )
      return invalid();
    if (event.kind === "model_text_delta") text(object(data.payload).text);
    sequence = integer(data.sequence);
  }
  if (
    coordinatorState &&
    (coordinatorState.format !== "uagent.coordinator-state.v1" ||
      coordinatorState.projectId !== projectId ||
      coordinatorState.runId !== runId ||
      coordinatorState.conversationId !== saved.sessionId ||
      coordinatorState.requiresFreshAuthorization !== true ||
      (complete && coordinatorState.messageCount !== messages.length))
  )
    return invalid();
  if (coordinatorState?.taskMode === "discussion") {
    const logical = coordinatorState.logicalProjectId;
    if ((logical !== null && typeof logical !== "string") ||
        coordinatorState.archiveOnly !== true ||
        !["uagent.responses-chat-archive.v1","uagent.deepseek-chat-archive.v1"].includes(String(coordinatorState.archiveFormat)) ||
        projectId !== (logical === null ? "chat:local" : "chat:project:" + logical) ||
        saved.projectRoot !== (logical === null ? "conversation://local" : "conversation://chat")) return invalid();
    id(coordinatorState.providerId); id(coordinatorState.modelId);
  }
  const snapshot: NativeHistorySnapshot = {
    run: {
      projectId,
      id: runId,
      sessionId: saved.sessionId,
      goal: saved.goal,
      status: saved.status,
      revision: integer(run.revision),
      createdAt: integer(run.createdAt),
      updatedAt: integer(run.updatedAt),
    },
    checkpoint: safeJson(raw.checkpoint),
    steps: list(raw.steps).map((value) => {
      const step = object(value);
      return {
        id: id(step.id),
        title: text(step.title),
        status: actionStatus(step.status),
        dependsOn: list(step.dependsOn).map(id),
      };
    }),
    toolCalls: list(raw.toolCalls).map((value) => {
      const call = object(value);
      return {
        id: id(call.id),
        stepId: id(call.stepId),
        toolName: id(call.toolName),
        arguments: safeJson(call.arguments),
        result: safeJson(call.result),
        status: actionStatus(call.status),
      };
    }),
    changesets: list(raw.changesets).map((value) => safeJson(value)),
    artifacts: list(raw.artifacts).map((value) => safeJson(value)),
    requiresFreshAuthorization: true,
    hasUnknownExternalEffects: boolean(raw.hasUnknownExternalEffects),
  };
  const actualUnresolved =
    snapshot.hasUnknownExternalEffects ||
    snapshot.toolCalls.some((call) => ["inFlight", "unknown"].includes(call.status)) ||
    snapshot.steps.some((step) => ["inFlight", "unknown"].includes(step.status));
  saved.hasUnresolvedEffects ||= actualUnresolved || saved.status === "needsReconciliation";
  return {
    schemaVersion: 1,
    descriptor: saved,
    snapshot,
    coordinatorState,
    messages,
    providerMessages: messages.map(providerMessage),
    events,
    completeness: {
      complete,
      loadedMessageCount,
      storedMessageCount,
      reason: completeness.reason === null ? null : text(completeness.reason),
    },
  };
}
function globalInvoke(): NativeRunStoreInvoke | null {
  return (
    (globalThis as { __TAURI_INTERNALS__?: { invoke?: NativeRunStoreInvoke } }).__TAURI_INTERNALS__
      ?.invoke ?? null
  );
}
/** Read-only app archive port. No command here trusts a project, writes records, or runs a task. */
export function createNativeRunHistory(
  invoke: NativeRunStoreInvoke | null = globalInvoke(),
): NativeRunHistoryPort {
  return {
    async list(input = {}) {
      if (!invoke) throw new Error("native_run_history_unavailable");
      const offset = integer(input.offset ?? 0),
        limit = integer(input.limit ?? 30),
        projectId = input.projectId === undefined ? undefined : id(input.projectId);
      if (limit < 1 || limit > 100 || offset > 1000000) return invalid();
      const page = object(
        await invoke("list_native_run_history", {
          input: {
            schemaVersion: 1,
            ...(projectId === undefined ? {} : { projectId }),
            offset,
            limit,
          },
        }),
      );
      if (page.schemaVersion !== 1 || page.offset !== offset || page.limit !== limit)
        return invalid();
      const runs = list(page.runs).map(descriptor);
      if (
        runs.length > limit ||
        (projectId !== undefined && runs.some((run) => run.projectId !== projectId)) ||
        new Set(runs.map((run) => JSON.stringify([run.projectId, run.runId]))).size !== runs.length
      )
        return invalid();
      return { schemaVersion: 1, runs, offset, limit, hasMore: boolean(page.hasMore) };
    },
    async snapshot(projectId, runId) {
      id(projectId);
      id(runId);
      if (!invoke) throw new Error("native_run_history_unavailable");
      return parseArchive(
        await invoke("snapshot_native_run_store", {
          input: { schemaVersion: 1, projectId, runId },
        }),
        projectId,
        runId,
      );
    },
  };
}

export function canContinueNativeHistory(archive: NativeRunArchive): boolean {
  return (
    archive.completeness.complete &&
    archive.coordinatorState !== null &&
    !archive.descriptor.hasUnresolvedEffects &&
    !archive.snapshot.hasUnknownExternalEffects &&
    !archive.snapshot.toolCalls.some(
      (call) => call.status === "inFlight" || call.status === "unknown",
    ) &&
    !archive.snapshot.steps.some((step) => step.status === "inFlight" || step.status === "unknown")
  );
}


/** Select only completed discussion requests. Failed/cancelled user blocks are
 * display evidence, never silently paired with a later successful answer. */
export function completedArchivedDiscussionText(archive:NativeRunArchive):Array<{role:"user"|"assistant";content:string}>{
  if(archive.coordinatorState?.taskMode!=="discussion")return [];
  const pending=new Map<string,string>(),selected=new Set<string>(),history:Array<{role:"user"|"assistant";content:string}>=[];
  const finalStatus=new Map<string,RunJsonValue>();
  for(const event of archive.events){
    const data=event.data as Record<string,RunJsonValue>;
    if(event.kind==="coordinator_state_v1"&&typeof data.lastRequestId==="string"&&typeof data.lastRequestStatus==="string")
      finalStatus.set(data.lastRequestId,data.lastRequestStatus);
  }
  for(const event of archive.events){
    const data=event.data as Record<string,RunJsonValue>,payload=data.payload as Record<string,RunJsonValue>|undefined;
    if(event.kind==="model_started"&&payload&&payload.contextEligible!==false&&typeof payload.requestId==="string"&&Array.isArray(payload.messages)){
      const tail:string[]=[];
      for(let i=payload.messages.length-1;i>=0;i--){const m=payload.messages[i] as Record<string,RunJsonValue>;if(!m||m.role!=="user"||typeof m.content!=="string")break;tail.unshift(m.content);}
      if(tail.length===1)pending.set(payload.requestId,tail[0]);
    }
    if(event.kind==="coordinator_state_v1"&&data.taskMode==="discussion"&&data.lastRequestStatus==="completed"&&typeof data.lastRequestId==="string"&&finalStatus.get(data.lastRequestId)==="completed"&&!selected.has(data.lastRequestId)&&typeof data.messageCount==="number"){
      const answer=archive.providerMessages[data.messageCount-1],question=pending.get(data.lastRequestId);
      if(question!==undefined&&answer?.role==="assistant"&&!answer.toolCalls?.length&&!answer.toolCallId){
        history.push({role:"user",content:question},{role:"assistant",content:answer.content});selected.add(data.lastRequestId);
      }
    }
  }
  return history;
}


/** All unfinished request bodies remain viewable after later successful retries.
 * This selector is presentation only and never supplies restored context. */
export function archivedPartialAssistantReplies(archive: NativeRunArchive): Array<{requestId:string;text:string}> {
  const pending = new Map<string,string>();
  let active: string | undefined;
  for (const event of archive.events) {
    const data = event.data as Record<string,RunJsonValue>;
    const payload = data.payload as Record<string,RunJsonValue> | undefined;
    if (event.kind === "model_started") {
      active = typeof payload?.requestId === "string" ? payload.requestId : event.id;
      pending.set(active,"");
    } else if (event.kind === "model_text_delta" && typeof payload?.text === "string") {
      const requestId = typeof payload.requestId === "string" ? payload.requestId : active;
      if (requestId && pending.has(requestId)) pending.set(requestId,pending.get(requestId)! + payload.text);
    } else if (event.kind === "model_completed") {
      const requestId = typeof payload?.requestId === "string" ? payload.requestId : active;
      if (requestId) pending.delete(requestId);
      if (requestId === active) active = undefined;
    }
  }
  return [...pending].filter(([,text])=>Boolean(text)).map(([requestId,text])=>({requestId,text}));
}

/** Interrupted stream text is evidence for display only, never a completed history turn. */
export function archivedPartialAssistantText(archive: NativeRunArchive): string {
  let active = false,
    partial = "";
  for (const event of archive.events) {
    if (event.kind === "model_started") {
      active = true;
      partial = "";
    } else if (event.kind === "model_completed") {
      active = false;
      partial = "";
    } else if (event.kind === "model_text_delta" && active) {
      const payload = object(object(event.data).payload);
      partial += text(payload.text);
    }
  }
  return partial;
}
