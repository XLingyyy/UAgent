import { localNativeInvoke } from "./native-provider-budget";
import type { NativeInvoke } from "./project-native-adapter";

/** Untrusted request data for a future native host. No IPC in this slice accepts it. */
export interface UESemanticReadIntentDraft {
  operation: "blueprint_describe" | "asset_references";
  packageName: string;
  limit: number;
  expectedRevision?: string;
}
/** Shape feedback only: this neither checks a read grant nor constructs a session/scope. */
export function validateUESemanticReadIntentDraft(value: unknown): value is UESemanticReadIntentDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).every(key => ["operation", "packageName", "limit", "expectedRevision"].includes(key)) &&
    (v.operation === "blueprint_describe" || v.operation === "asset_references") &&
    typeof v.packageName === "string" && v.packageName.length <= 1024 && /^\/Game(?:\/[\p{L}\p{N}_]+)+$/u.test(v.packageName) &&
    Number.isSafeInteger(v.limit) && (v.limit as number) >= 1 && (v.limit as number) <= 256 &&
    (!Object.hasOwn(v, "expectedRevision") || v.operation === "blueprint_describe" && typeof v.expectedRevision === "string" && /^[a-f0-9]{32}$/.test(v.expectedRevision));
}
const required = [
  ["owned_editor_connection", "not_integrated"],
  ["native_semantic_read_grant", "not_integrated"],
  ["exact_v2_negotiation", "not_checked"],
  ["request_bound_result_provenance", "not_integrated"],
] as const;
export type UESemanticReadPrerequisiteId = (typeof required)[number][0];
export interface UESemanticReadPrerequisite {
  readonly id: UESemanticReadPrerequisiteId;
  readonly status: "not_integrated" | "not_checked";
}
/** Actual native root observation plus explicit integration blockers; no asset data. */
export interface UESemanticReadAvailability {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly observedAtMs: number;
  readonly status: "blocked";
  readonly reason: "native_verified_editor_read_host_missing";
  readonly trustedRootCurrent: true;
  readonly observationOnly: true;
  readonly scopeEstablished: false;
  readonly readEnabled: false;
  readonly queryDispatched: false;
  readonly semanticDataReturned: false;
  readonly prerequisites: readonly UESemanticReadPrerequisite[];
}
export type UESemanticReadInspectionErrorKind = "unavailable" | "trust" | "busy" | "invalid_response";
export class UESemanticReadInspectionError extends Error {
  constructor(readonly kind: UESemanticReadInspectionErrorKind) { super(`ue_semantic_inspection_${kind}`); this.name = "UESemanticReadInspectionError"; }
}
const fail = (kind: UESemanticReadInspectionErrorKind): never => { throw new UESemanticReadInspectionError(kind); };
const validProjectId = (value: unknown): value is string => typeof value === "string" && /^root:[a-f0-9]{1,64}$/.test(value);
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) return fail("invalid_response");
  return value as Record<string, unknown>;
}
function availability(raw: unknown, projectId: string): UESemanticReadAvailability {
  const v = record(raw, ["schemaVersion", "projectId", "observedAtMs", "status", "reason", "trustedRootCurrent", "observationOnly", "scopeEstablished", "readEnabled", "queryDispatched", "semanticDataReturned", "prerequisites"]);
  if (v.schemaVersion !== 1 || v.projectId !== projectId || !Number.isSafeInteger(v.observedAtMs) || (v.observedAtMs as number) < 0 ||
      v.status !== "blocked" || v.reason !== "native_verified_editor_read_host_missing" || v.trustedRootCurrent !== true || v.observationOnly !== true ||
      v.scopeEstablished !== false || v.readEnabled !== false || v.queryDispatched !== false || v.semanticDataReturned !== false ||
      !Array.isArray(v.prerequisites) || v.prerequisites.length !== required.length) return fail("invalid_response");
  const prerequisites = v.prerequisites.map((entry, index) => {
    const item = record(entry, ["id", "status"]), expected = required[index];
    if (item.id !== expected[0] || item.status !== expected[1]) return fail("invalid_response");
    return Object.freeze({ id: expected[0], status: expected[1] });
  });
  const result: UESemanticReadAvailability = {
    schemaVersion: 1, projectId, observedAtMs: v.observedAtMs as number,
    status: "blocked", reason: "native_verified_editor_read_host_missing", trustedRootCurrent: true, observationOnly: true,
    scopeEstablished: false, readEnabled: false, queryDispatched: false, semanticDataReturned: false,
    prerequisites: Object.freeze(prerequisites),
  };
  return Object.freeze(result);
}
function safeError(error: unknown): UESemanticReadInspectionError {
  if (error instanceof UESemanticReadInspectionError) return error;
  const code = typeof error === "string" && /^ue_semantic_[a-z_]{1,96}$/.test(error) ? error : "";
  return new UESemanticReadInspectionError(code.includes("trusted_") ? "trust" : code === "ue_semantic_inspection_busy" ? "busy" : "unavailable");
}
/** There is deliberately no query, connect, discover, prepare/load, or scope setter. */
export function createNativeUESemanticRead(invoke: NativeInvoke | null) {
  return {
    available: () => invoke !== null,
    async inspect(projectId: string): Promise<UESemanticReadAvailability> {
      if (!validProjectId(projectId)) return fail("trust");
      if (!invoke) return fail("unavailable");
      try { return availability(await invoke("inspect_ue_semantic_read_availability", { input: { projectId } }), projectId); }
      catch (error) { throw safeError(error); }
    },
  };
}
export type NativeUESemanticRead = ReturnType<typeof createNativeUESemanticRead>;
export const nativeUESemanticRead = createNativeUESemanticRead(localNativeInvoke());
