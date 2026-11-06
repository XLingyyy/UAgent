/** T17/T19 IPC descriptors. None of these serialized values is execution authority. */
export const RUNTIME_HOST_PROTOCOL = "uagent.runtime-host.v1" as const;
export interface RuntimeHostIdentity {
  readonly scopeId: string;
  readonly runId: string;
  readonly projectId: string;
  readonly rootRef: string;
  readonly conversationId: string;
  readonly providerId: string;
  readonly modelId: string;
}
export interface RuntimeHostOwnerRef {
  readonly hostGeneration: string;
  readonly ownerId: string;
}
export interface RuntimeHostTicketRef extends RuntimeHostOwnerRef {
  readonly ticketId: string;
}
export type RuntimeHostJobPhase = "queued" | "admitted" | "handoff_pending" | "running" | "retained" | "finished";
export type RuntimeHostExecutionObservation = "quiescent" | "active" | "unknown";
export interface RuntimeHostResourceClaim {
  readonly kind: "ue-editor" | "ubt" | "file-write";
  readonly key: string;
}
export interface RuntimeHostJobSnapshot {
  readonly ticket: RuntimeHostTicketRef;
  readonly jobId: string;
  readonly stepId: string;
  readonly executionId: string;
  readonly kind: "model" | "operation";
  readonly phase: RuntimeHostJobPhase;
  readonly reason: string | null;
  /** Includes a reserved model slot even when the explicit resources array is empty. */
  readonly holdsResources: boolean;
  readonly callbackSettled: boolean;
  readonly executionObservation: RuntimeHostExecutionObservation;
  readonly cancelRequested: boolean;
  readonly rootObjectId: string | null;
  readonly resources: readonly RuntimeHostResourceClaim[];
}
export interface RuntimeHostOwnerSnapshot {
  readonly protocol: typeof RUNTIME_HOST_PROTOCOL;
  readonly owner: RuntimeHostOwnerRef;
  readonly identity: RuntimeHostIdentity;
  readonly connected: boolean;
  readonly ownerLeaseMs: number;
  readonly recoveryCatalogInstalled: boolean;
  readonly monitorActive: boolean;
  readonly modelConcurrency: number;
  /** Host-wide counts only; other windows' job identities are not disclosed. */
  readonly pendingExecutions: number;
  readonly unknownExecutions: number;
  readonly jobs: readonly RuntimeHostJobSnapshot[];
}
export interface RuntimeHostModelJobInput {
  readonly jobId: string;
  readonly stepId: string;
  readonly queueTimeoutMs: number;
  readonly executionTimeoutMs: number;
}
export class RuntimeHostError extends Error {
  constructor(readonly code: "invalid" | "unavailable" | "revoked" | "not_admitted" | "cancelled" | "timed_out" | "capacity") {
    super("runtime_host_" + code);
    this.name = "RuntimeHostError";
  }
}
const fail = (): never => { throw new RuntimeHostError("invalid"); };
export function runtimeHostId(value: unknown): string {
  if (typeof value !== "string" || !value || value.trim() !== value ||
      new TextEncoder().encode(value).length > 512 || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) return fail();
  return value;
}
function nativeId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) return fail();
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function boolean(value: unknown): boolean { return typeof value === "boolean" ? value : fail(); }
function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 256) return fail();
  return value as number;
}
function number(value: unknown, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) return fail();
  return value as number;
}
export function parseRuntimeHostIdentity(value: unknown): RuntimeHostIdentity {
  const v = object(value);
  return Object.freeze({ scopeId: runtimeHostId(v.scopeId), runId: runtimeHostId(v.runId), projectId: runtimeHostId(v.projectId),
    rootRef: runtimeHostId(v.rootRef), conversationId: runtimeHostId(v.conversationId), providerId: runtimeHostId(v.providerId), modelId: runtimeHostId(v.modelId) });
}
export function parseRuntimeHostOwnerRef(value: unknown): RuntimeHostOwnerRef {
  const v = object(value);
  return Object.freeze({ hostGeneration: nativeId(v.hostGeneration), ownerId: nativeId(v.ownerId) });
}
export function parseRuntimeHostTicket(value: unknown): RuntimeHostTicketRef {
  const v = object(value);
  return Object.freeze({ ...parseRuntimeHostOwnerRef(v), ticketId: nativeId(v.ticketId) });
}
export function sameRuntimeHostOwner(a: RuntimeHostOwnerRef, b: RuntimeHostOwnerRef): boolean {
  return a.hostGeneration === b.hostGeneration && a.ownerId === b.ownerId;
}
export function parseRuntimeHostJob(value: unknown, expectedOwner?: RuntimeHostOwnerRef): RuntimeHostJobSnapshot {
  const v = object(value), ticket = parseRuntimeHostTicket(v.ticket);
  if (expectedOwner && !sameRuntimeHostOwner(ticket, expectedOwner)) return fail();
  if (!["queued", "admitted", "handoff_pending", "running", "retained", "finished"].includes(v.phase as string) ||
      !["quiescent", "active", "unknown"].includes(v.executionObservation as string) ||
      !["model", "operation"].includes(v.kind as string) || !Array.isArray(v.resources) || v.resources.length > 16) return fail();
  const phase = v.phase as RuntimeHostJobPhase, observation = v.executionObservation as RuntimeHostExecutionObservation;
  const holds = boolean(v.holdsResources), settled = boolean(v.callbackSettled);
  if (holds !== (phase !== "queued" && phase !== "finished") ||
      (phase === "finished" && (!settled || observation !== "quiescent")) ||
      (phase === "handoff_pending" && settled)) return fail();
  const claims: RuntimeHostResourceClaim[] = v.resources.map((value: unknown) => {
    const claim = object(value);
    if (!["ue-editor", "ubt", "file-write"].includes(claim.kind as string)) return fail();
    return Object.freeze({ kind: claim.kind as RuntimeHostResourceClaim["kind"], key: runtimeHostId(claim.key) });
  });
  if (new Set(claims.map(c => c.key)).size !== claims.length ||
      (v.kind === "model" && (claims.length !== 0 || v.rootObjectId !== null)) ||
      (v.kind === "operation" && (claims.length === 0 || v.rootObjectId === null))) return fail();
  return Object.freeze({ ticket, jobId: runtimeHostId(v.jobId), stepId: runtimeHostId(v.stepId), executionId: nativeId(v.executionId),
    kind: v.kind as RuntimeHostJobSnapshot["kind"], phase, reason: v.reason === null ? null : runtimeHostId(v.reason),
    holdsResources: holds, callbackSettled: settled, executionObservation: observation, cancelRequested: boolean(v.cancelRequested),
    rootObjectId: v.rootObjectId === null ? null : runtimeHostId(v.rootObjectId), resources: Object.freeze(claims) });
}
export function parseRuntimeHostSnapshot(value: unknown, expectedOwner?: RuntimeHostOwnerRef): RuntimeHostOwnerSnapshot {
  const v = object(value), owner = parseRuntimeHostOwnerRef(v.owner);
  if (v.protocol !== RUNTIME_HOST_PROTOCOL || (expectedOwner && !sameRuntimeHostOwner(owner, expectedOwner)) ||
      !Array.isArray(v.jobs) || v.jobs.length > 256 || v.ownerLeaseMs !== 15000 || v.modelConcurrency !== 3) return fail();
  const jobs = v.jobs.map((job: unknown) => parseRuntimeHostJob(job, owner));
  if (new Set(jobs.map(job => job.ticket.ticketId)).size !== jobs.length) return fail();
  return Object.freeze({ protocol: RUNTIME_HOST_PROTOCOL, owner, identity: parseRuntimeHostIdentity(v.identity),
    connected: boolean(v.connected), ownerLeaseMs: number(v.ownerLeaseMs, 15000), modelConcurrency: number(v.modelConcurrency, 3),
    recoveryCatalogInstalled: boolean(v.recoveryCatalogInstalled), monitorActive: boolean(v.monitorActive),
    pendingExecutions: count(v.pendingExecutions), unknownExecutions: count(v.unknownExecutions), jobs: Object.freeze(jobs) });
}
export function validateRuntimeHostModelInput(value: RuntimeHostModelJobInput): RuntimeHostModelJobInput {
  return Object.freeze({ jobId: runtimeHostId(value.jobId), stepId: runtimeHostId(value.stepId),
    queueTimeoutMs: number(value.queueTimeoutMs, 3_600_000), executionTimeoutMs: number(value.executionTimeoutMs, 3_600_000) });
}

