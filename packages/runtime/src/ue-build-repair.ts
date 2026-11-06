/** T10 pure coordinator. Native ports retain root authority and atomically consume real approvals.
 * A preview ID, fixture proposer, diagnostic or TS object never grants write/build permission. */
import { createSha256Hash, createTextBackedOperation } from "./mvp12-change-set.js";
import {
  assessUEBuildRepair,
  type UEBuildDiagnosticSummary,
} from "./ue-build-diagnostics.js";
import {
  isVerifiedUEBuildSuccess,
  type UEBuildExecutionResult,
  type UEBuildOwner,
} from "./ue-build-profile.js";

export const BUILD_REPAIR_MAX_FILES = 8;
export const BUILD_REPAIR_MAX_FILE_BYTES = 256 * 1024;
export const BUILD_REPAIR_MAX_TOTAL_BYTES = 1024 * 1024;
export const BUILD_REPAIR_HARD_MAX_ATTEMPTS = 3;
export interface BuildRepairBinding {
  hostSessionId: string;
  projectId: string;
  rootObjectId: string;
  runId: string;
  profileFingerprint: string;
}
export interface BuildRepairDiagnosticRef {
  diagnosticId: string;
  buildOwner: UEBuildOwner;
}
export interface BuildRepairDiagnosticRoots {
  projectRoot: string;
  engineRoot: string;
  diagnosticCwd: string;
}
export interface BuildRepairSnapshotFile {
  path: string;
  content: string;
  sha256: string;
  objectIdentity: string;
}
export interface BuildRepairSnapshot {
  binding: BuildRepairBinding;
  diagnostic: BuildRepairDiagnosticRef;
  snapshotId: string;
  files: BuildRepairSnapshotFile[];
}
export interface BuildRepairPreviewFile {
  path: string;
  before: string;
  after: string;
  beforeHash: string;
  afterHash: string;
  beforeObjectIdentity: string;
  unifiedDiff: string;
  displayDiff: string;
}
export interface BuildRepairPreview {
  schemaVersion: 1;
  repairId: string;
  attempt: number;
  binding: BuildRepairBinding;
  diagnostic: BuildRepairDiagnosticRef;
  snapshotId: string;
  previewId: string;
  files: BuildRepairPreviewFile[];
}
export type BuildRepairEffectStatus = "applied" | "not_started" | "unknown" | "failed" | "conflict";
export interface BuildRepairEffect {
  path: string;
  status: BuildRepairEffectStatus;
  beforeHash: string;
  beforeObjectIdentity: string;
  afterHash: string | null;
  afterObjectIdentity: string | null;
  reason: string;
}
export interface BuildRepairApplyResult {
  binding: BuildRepairBinding;
  diagnostic: BuildRepairDiagnosticRef;
  previewId: string;
  decision: "approved" | "denied" | "cancelled";
  status: "applied" | "not_started" | "partial" | "unknown" | "conflict";
  reason: string;
  effects: BuildRepairEffect[];
}
export interface BuildRepairBuildRequest {
  binding: BuildRepairBinding;
  owner: UEBuildOwner;
  appliedPreviewId: string;
  expectedSources: { path: string; sha256: string; objectIdentity: string }[];
}
export interface BuildRepairBuildResult {
  decision: "approved" | "denied" | "cancelled";
  execution: UEBuildExecutionResult | null;
  reason: string;
}
export interface BuildRepairQueryResult {
  binding: BuildRepairBinding;
  diagnostic: BuildRepairDiagnosticRef;
  previewId: string;
  queryId: string;
  files: { path: string; sha256: string; objectIdentity: string }[];
}
/** Wire only to trusted native owned-root/T09 adapters, never model-supplied callback objects.
 * apply/build ports obtain the native approval and consume it atomically before dispatch.
 * Cancellation is passed through; exceptions after dispatch mean unknown effects, not denial. */
export interface BuildRepairNativePorts {
  assertActive(binding: BuildRepairBinding, signal: AbortSignal): Promise<void>;
  readSnapshots(
    request: { binding: BuildRepairBinding; diagnostic: BuildRepairDiagnosticRef; paths: string[] },
    signal: AbortSignal,
  ): Promise<BuildRepairSnapshot>;
  applyWithNativeApproval(
    request: {
      binding: BuildRepairBinding;
      diagnostic: BuildRepairDiagnosticRef;
      preview: BuildRepairPreview;
    },
    signal: AbortSignal,
  ): Promise<BuildRepairApplyResult>;
  /** Native must look up this registered preview/effects, then recheck and hold these exact
   * Source after-states at final dispatch. The DTO is neither approval nor a project snapshot. */
  buildWithNativeApproval(
    request: BuildRepairBuildRequest,
    signal: AbortSignal,
  ): Promise<BuildRepairBuildResult>;
  queryRecovery(
    request: {
      binding: BuildRepairBinding;
      diagnostic: BuildRepairDiagnosticRef;
      previewId: string;
      paths: string[];
    },
    signal: AbortSignal,
  ): Promise<BuildRepairQueryResult>;
}
export interface BuildRepairProposalInput {
  attempt: number;
  diagnostics: UEBuildDiagnosticSummary;
  files: { path: string; content: string }[];
}
/** Output is closed {files:[{path,after}]}; it cannot select new read scope or carry approvals. */
export type BuildRepairProposer = (
  input: BuildRepairProposalInput,
  signal: AbortSignal,
) => Promise<unknown>;
export type BuildRepairState =
  | "idle"
  | "diagnosing"
  | "reading"
  | "proposing"
  | "applying"
  | "building"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "invalidated"
  | "exhausted"
  | "recovery_required"
  | "recovery_checked";
export interface BuildRepairRecoveryFile {
  path: string;
  sha256: string;
  objectIdentity: string;
  state: "verified_applied" | "verified_not_started" | "matches_after_unowned" | "conflict";
}
export interface BuildRepairAttempt {
  attempt: number;
  diagnostic: BuildRepairDiagnosticRef;
  preview: BuildRepairPreview | null;
  effects: BuildRepairEffect[];
  build: UEBuildExecutionResult | null;
}
export interface BuildRepairCheckpoint {
  schemaVersion: 1;
  repairId: string;
  binding: BuildRepairBinding;
  state: BuildRepairState;
  reason: string;
  attempt: number;
  maxAttempts: number;
  buildAttempts: number;
  diagnostic: BuildRepairDiagnosticRef | null;
  diagnostics: UEBuildDiagnosticSummary | null;
  preview: BuildRepairPreview | null;
  effects: BuildRepairEffect[];
  lastBuild: UEBuildExecutionResult | null;
  pendingBuildOwner: UEBuildOwner | null;
  recovery: {
    queryId: string;
    files: BuildRepairRecoveryFile[];
    requiresOwnedBuildQuery: boolean;
  } | null;
  history: BuildRepairAttempt[];
  recoveryOptions: (
    | "query_files"
    | "inspect_effects"
    | "new_preview_and_native_approval"
    | "query_owned_build"
  )[];
}
export interface BuildRepairCoordinatorOptions {
  repairId: string;
  binding: BuildRepairBinding;
  initialBuildOwner: UEBuildOwner;
  diagnosticRoots: BuildRepairDiagnosticRoots;
  approvedReadPaths: readonly string[];
  maxAttempts?: number;
  ports: BuildRepairNativePorts;
  proposer: BuildRepairProposer;
}
type Obj = Record<string, unknown>;
const SHA256 = /^[0-9a-f]{64}$/;
class RepairFault extends Error {
  constructor(readonly code: string) {
    super(`ue_build_repair_${code}`);
  }
}
function fail(code: string): never {
  throw new RepairFault(code);
}
function obj(value: unknown): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("object_required");
  return value as Obj;
}
function closed(value: Obj, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    fail("unexpected_fields");
}
function textId(value: unknown, max = 512): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    ![...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  );
}
function frozen<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}
function copy<T>(value: T): T {
  return structuredClone(value);
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
function same(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}
function binding(value: unknown): BuildRepairBinding {
  const b = obj(value);
  closed(b, ["hostSessionId", "projectId", "rootObjectId", "runId", "profileFingerprint"]);
  if (
    ["hostSessionId", "projectId", "rootObjectId", "runId"].some((key) => !textId(b[key])) ||
    typeof b.profileFingerprint !== "string" ||
    !SHA256.test(b.profileFingerprint)
  )
    fail("invalid_binding");
  return frozen(copy(b)) as unknown as BuildRepairBinding;
}
function owner(value: unknown): UEBuildOwner {
  const o = obj(value);
  closed(o, ["runId", "stepId", "fingerprint"]);
  if (
    !textId(o.runId) ||
    !textId(o.stepId, 256) ||
    typeof o.fingerprint !== "string" ||
    !SHA256.test(o.fingerprint)
  )
    fail("invalid_build_owner");
  return copy(o) as unknown as UEBuildOwner;
}
function matchesOwner(actual: unknown, expected: UEBuildOwner): boolean {
  return same(owner(actual), expected);
}
/** This fixed-profile slice intentionally excludes Target.cs: changing it invalidates T09 approval.
 * No canonicalization fallback, aliases, ADS, new/delete/move or model-selected file discovery. */
export function parseBuildRepairPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 1024 ||
    !value.startsWith("Source/") ||
    value.includes("\\")
  )
    fail("invalid_source_path");
  const parts = value.split("/");
  if (
    parts.length < 2 ||
    parts.length > 32 ||
    parts.some(
      (part) =>
        !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(part) ||
        part === "." ||
        part === ".." ||
        part.endsWith(".") ||
        /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part) ||
        /^(?:Binaries|Intermediate|Saved|DerivedDataCache|node_modules)$/i.test(part),
    ) ||
    !/(?:\.cpp|\.h|\.hpp|\.Build\.cs)$/.test(value)
  )
    fail("invalid_source_path");
  return value;
}
function sourceText(value: unknown): { content: string; bytes: number } {
  if (typeof value !== "string") fail("text_required");
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) fail("binary_text_rejected");
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail("invalid_unicode_text");
    } else if (c >= 0xdc00 && c <= 0xdfff) fail("invalid_unicode_text");
  }
  const bytes = new TextEncoder().encode(value).length;
  if (bytes > BUILD_REPAIR_MAX_FILE_BYTES) fail("file_size_limit");
  return { content: value, bytes };
}
function diagnosticRef(value: unknown, expected: BuildRepairDiagnosticRef): void {
  const d = obj(value);
  closed(d, ["diagnosticId", "buildOwner"]);
  if (d.diagnosticId !== expected.diagnosticId || !matchesOwner(d.buildOwner, expected.buildOwner))
    fail("diagnostic_binding_mismatch");
}
function receiptBinding(
  value: Obj,
  fixed: BuildRepairBinding,
  diagnostic: BuildRepairDiagnosticRef,
): void {
  if (!same(binding(value.binding), fixed)) fail("host_binding_mismatch");
  diagnosticRef(value.diagnostic, diagnostic);
}
function execution(value: unknown, expected: UEBuildOwner): UEBuildExecutionResult {
  const r = obj(value);
  closed(r, [
    "owner",
    "status",
    "reason",
    "pid",
    "exitCode",
    "durationMs",
    "treeStopped",
    "stdout",
    "stderr",
    "outputTruncated",
    "outputComplete",
    "effects",
  ]);
  if (
    !matchesOwner(r.owner, expected) ||
    ![
      "succeeded",
      "failed",
      "cancelled",
      "timed_out",
      "not_started",
      "termination_unknown",
    ].includes(String(r.status)) ||
    typeof r.reason !== "string" ||
    (r.pid !== null && !(Number.isSafeInteger(r.pid) && Number(r.pid) > 0)) ||
    (r.exitCode !== null && !Number.isSafeInteger(r.exitCode)) ||
    typeof r.durationMs !== "number" ||
    !Number.isFinite(r.durationMs) ||
    r.durationMs < 0 ||
    ["treeStopped", "outputTruncated", "outputComplete"].some(
      (key) => typeof r[key] !== "boolean",
    ) ||
    typeof r.stdout !== "string" ||
    typeof r.stderr !== "string" ||
    r.stdout.length + r.stderr.length > 8 * 1024 * 1024 ||
    !["not_started", "possible"].includes(String(r.effects))
  )
    fail("invalid_build_execution");
  return frozen(copy(r)) as unknown as UEBuildExecutionResult;
}
function roots(value: BuildRepairDiagnosticRoots): BuildRepairDiagnosticRoots {
  const r = obj(value);
  closed(r, ["projectRoot", "engineRoot", "diagnosticCwd"]);
  for (const key of Object.keys(r))
    if (
      !textId(r[key], 4096) ||
      !/^[A-Za-z]:[\\/]/.test(r[key] as string) ||
      (r[key] as string)
        .replace(/\\/g, "/")
        .split("/")
        .some((part) => part === "." || part === "..")
    )
      fail("trusted_diagnostic_roots_required");
  return frozen(copy(value));
}

export class BuildRepairCoordinator {
  private readonly fixed: BuildRepairBinding;
  private readonly initialOwner: UEBuildOwner;
  private readonly trustedRoots: BuildRepairDiagnosticRoots;
  private readonly paths: string[];
  private readonly ports: BuildRepairNativePorts;
  private readonly proposer: BuildRepairProposer;
  private busy = false;
  private started = false;
  private invalidated = false;
  private generation = 0;
  private current: BuildRepairCheckpoint;
  constructor(options: BuildRepairCoordinatorOptions) {
    this.fixed = binding(options.binding);
    this.initialOwner = frozen(owner(options.initialBuildOwner));
    if (
      this.initialOwner.runId !== this.fixed.runId ||
      this.initialOwner.fingerprint !== this.fixed.profileFingerprint ||
      !textId(options.repairId, 128)
    )
      fail("initial_owner_or_repair_id_mismatch");
    this.trustedRoots = roots(options.diagnosticRoots);
    if (
      !Array.isArray(options.approvedReadPaths) ||
      options.approvedReadPaths.length < 1 ||
      options.approvedReadPaths.length > BUILD_REPAIR_MAX_FILES
    )
      fail("read_scope_file_limit");
    this.paths = options.approvedReadPaths.map(parseBuildRepairPath);
    if (new Set(this.paths.map((p) => p.toLowerCase())).size !== this.paths.length)
      fail("duplicate_read_path");
    this.paths.sort();
    const max = options.maxAttempts ?? 2;
    if (!Number.isInteger(max) || max < 1 || max > BUILD_REPAIR_HARD_MAX_ATTEMPTS)
      fail("attempt_limit");
    this.ports = Object.freeze({ ...options.ports });
    this.proposer = options.proposer;
    this.current = {
      schemaVersion: 1,
      repairId: options.repairId,
      binding: this.fixed,
      state: "idle",
      reason: "not_started",
      attempt: 0,
      maxAttempts: max,
      buildAttempts: 0,
      diagnostic: null,
      diagnostics: null,
      preview: null,
      effects: [],
      lastBuild: null,
      pendingBuildOwner: null,
      recovery: null,
      recoveryOptions: [],
      history: [],
    };
  }
  get checkpoint(): BuildRepairCheckpoint {
    this.syncHistory();
    return frozen(copy(this.current));
  }
  /** Host calls this on root/editor/session/run/profile invalidation. It never cancels an owned
   * process by itself; the native adapter must honor its signal and later query uncertain owners. */
  invalidate(): void {
    this.invalidated = true;
    this.generation++;
    this.finish("invalidated", "scope_invalidated");
  }
  private local(generation: number, signal: AbortSignal): void {
    if (this.invalidated || generation !== this.generation) fail("scope_invalidated");
    if (signal.aborted) fail("cancelled");
  }
  private async active(generation: number, signal: AbortSignal): Promise<void> {
    this.local(generation, signal);
    try {
      await this.ports.assertActive(this.fixed, signal);
    } catch {
      this.local(generation, signal);
      this.invalidated = true;
      this.generation++;
      fail("scope_inactive");
    }
    this.local(generation, signal);
  }
  private syncHistory(): void {
    if (this.current.attempt === 0 || !this.current.diagnostic) return;
    this.current.history[this.current.attempt - 1] = {
      attempt: this.current.attempt,
      diagnostic: this.current.diagnostic,
      preview: this.current.preview,
      effects: copy(this.current.effects),
      build: this.current.lastBuild,
    };
  }
  private finish(state: BuildRepairState, reason: string): void {
    this.current.state = state;
    this.current.reason = reason;
    const options: BuildRepairCheckpoint["recoveryOptions"] = [];
    if (this.current.preview) {
      options.push("inspect_effects");
      if (state !== "invalidated") options.push("query_files");
    }
    if (this.current.pendingBuildOwner) options.push("query_owned_build");
    if (
      this.current.preview &&
      !this.current.pendingBuildOwner &&
      !this.current.effects.some((e) => !["applied", "not_started"].includes(e.status)) &&
      state !== "invalidated" &&
      state !== "recovery_required" &&
      (!this.current.recovery ||
        this.current.recovery.files.every((f) =>
          ["verified_applied", "verified_not_started"].includes(f.state),
        ))
    )
      options.push("new_preview_and_native_approval");
    this.current.recoveryOptions = options;
    this.syncHistory();
  }
  private inspectSnapshots(
    value: unknown,
    diagnostic: BuildRepairDiagnosticRef,
  ): BuildRepairSnapshot {
    const r = obj(value);
    closed(r, ["binding", "diagnostic", "snapshotId", "files"]);
    receiptBinding(r, this.fixed, diagnostic);
    if (
      !textId(r.snapshotId, 256) ||
      !Array.isArray(r.files) ||
      r.files.length !== this.paths.length
    )
      fail("invalid_snapshot");
    let total = 0;
    const files = new Map<string, BuildRepairSnapshotFile>(),
      ids = new Set<string>();
    for (const value of r.files) {
      const f = obj(value);
      closed(f, ["path", "content", "sha256", "objectIdentity"]);
      const path = parseBuildRepairPath(f.path),
        text = sourceText(f.content);
      if (
        !this.paths.includes(path) ||
        files.has(path) ||
        !textId(f.objectIdentity) ||
        ids.has(f.objectIdentity) ||
        typeof f.sha256 !== "string" ||
        !SHA256.test(f.sha256) ||
        createSha256Hash(text.content) !== f.sha256
      )
        fail("snapshot_hash_identity_or_scope_mismatch");
      total += text.bytes;
      files.set(path, {
        path,
        content: text.content,
        sha256: f.sha256,
        objectIdentity: f.objectIdentity,
      });
      ids.add(f.objectIdentity);
    }
    if (total > BUILD_REPAIR_MAX_TOTAL_BYTES) fail("snapshot_total_limit");
    return frozen({
      binding: this.fixed,
      diagnostic,
      snapshotId: r.snapshotId,
      files: this.paths.map((p) => files.get(p)!),
    });
  }
  private makePreview(
    value: unknown,
    snapshot: BuildRepairSnapshot,
    attempt: number,
  ): BuildRepairPreview {
    const r = obj(value);
    closed(r, ["files"]);
    if (!Array.isArray(r.files) || r.files.length < 1 || r.files.length > BUILD_REPAIR_MAX_FILES)
      fail("proposal_file_limit");
    const files: BuildRepairPreviewFile[] = [],
      seen = new Set<string>();
    let total = 0;
    for (const value of r.files) {
      const change = obj(value);
      closed(change, ["path", "after"]);
      const path = parseBuildRepairPath(change.path),
        after = sourceText(change.after);
      const before = snapshot.files.find((f) => f.path === path);
      if (!before || seen.has(path.toLowerCase())) fail("proposal_outside_read_scope_or_duplicate");
      seen.add(path.toLowerCase());
      total += sourceText(before.content).bytes + after.bytes;
      if (before.content === after.content) continue;
      const operation = createTextBackedOperation({
        id: `${this.current.repairId}:${attempt}:${files.length}`,
        rootId: this.fixed.rootObjectId,
        rootRelativePath: path,
        before: before.content,
        after: after.content,
        intent: "locate_build_error",
        summary: "Review exact source repair before native approval",
        sourceDiagnosticIds: this.current.diagnostics!.diagnostics.map((d) => d.id),
        projectRoot: this.trustedRoots.projectRoot,
      });
      files.push({
        path,
        before: before.content,
        after: after.content,
        beforeHash: operation.beforeHash,
        afterHash: operation.afterHash,
        beforeObjectIdentity: before.objectIdentity,
        unifiedDiff: operation.unifiedDiff,
        displayDiff: operation.displayDiff,
      });
    }
    if (total > BUILD_REPAIR_MAX_TOTAL_BYTES) fail("preview_total_limit");
    if (!files.length) fail("proposal_has_no_changes");
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const body = {
      schemaVersion: 1 as const,
      repairId: this.current.repairId,
      attempt,
      binding: this.fixed,
      diagnostic: snapshot.diagnostic,
      snapshotId: snapshot.snapshotId,
      files,
    };
    return frozen({ ...body, previewId: createSha256Hash(stable(body)) });
  }
  private uncertainEffects(preview: BuildRepairPreview): BuildRepairEffect[] {
    return preview.files.map((file) => ({
      path: file.path,
      status: "unknown",
      beforeHash: file.beforeHash,
      beforeObjectIdentity: file.beforeObjectIdentity,
      afterHash: null,
      afterObjectIdentity: null,
      reason: "native_apply_outcome_pending",
    }));
  }
  private inspectApply(value: unknown, preview: BuildRepairPreview): BuildRepairApplyResult {
    const r = obj(value);
    closed(r, ["binding", "diagnostic", "previewId", "decision", "status", "reason", "effects"]);
    receiptBinding(r, this.fixed, preview.diagnostic);
    if (
      r.previewId !== preview.previewId ||
      !["approved", "denied", "cancelled"].includes(String(r.decision)) ||
      !["applied", "not_started", "partial", "unknown", "conflict"].includes(String(r.status)) ||
      typeof r.reason !== "string" ||
      !Array.isArray(r.effects) ||
      r.effects.length !== preview.files.length
    )
      fail("invalid_apply_receipt");
    const effects = r.effects.map((value, index) => {
      const e = obj(value),
        file = preview.files[index]!;
      closed(e, [
        "path",
        "status",
        "beforeHash",
        "beforeObjectIdentity",
        "afterHash",
        "afterObjectIdentity",
        "reason",
      ]);
      if (
        e.path !== file.path ||
        e.beforeHash !== file.beforeHash ||
        e.beforeObjectIdentity !== file.beforeObjectIdentity ||
        !["applied", "not_started", "unknown", "failed", "conflict"].includes(String(e.status)) ||
        typeof e.reason !== "string" ||
        (e.afterHash !== null && (typeof e.afterHash !== "string" || !SHA256.test(e.afterHash))) ||
        (e.afterObjectIdentity !== null && !textId(e.afterObjectIdentity))
      )
        fail("invalid_file_effect");
      if (
        e.status === "applied" &&
        (e.afterHash !== file.afterHash || !textId(e.afterObjectIdentity))
      )
        fail("applied_effect_not_verified");
      if (e.status === "not_started" && (e.afterHash !== null || e.afterObjectIdentity !== null))
        fail("not_started_effect_claims_write");
      return copy(e) as unknown as BuildRepairEffect;
    });
    if (
      (r.status === "applied" &&
        (r.decision !== "approved" || effects.some((e) => e.status !== "applied"))) ||
      (r.status === "not_started" && effects.some((e) => e.status !== "not_started")) ||
      (r.status === "partial" &&
        (!effects.some((e) => e.status === "applied") ||
          effects.every((e) => e.status === "applied"))) ||
      (r.decision !== "approved" &&
        (r.status !== "not_started" || effects.some((e) => e.status !== "not_started")))
    )
      fail("inconsistent_apply_receipt");
    return frozen({ ...copy(r), effects }) as unknown as BuildRepairApplyResult;
  }
  private newDiagnostic(build: UEBuildExecutionResult, summary: UEBuildDiagnosticSummary): BuildRepairDiagnosticRef {
    this.current.diagnostics = frozen(summary);
    return frozen({
      buildOwner: build.owner,
      diagnosticId: createSha256Hash(
        stable({
          binding: this.fixed,
          roots: this.trustedRoots,
          owner: build.owner,
          status: build.status,
          exitCode: build.exitCode,
          treeStopped: build.treeStopped,
          outputComplete: build.outputComplete,
          outputTruncated: build.outputTruncated,
          stdoutHash: createSha256Hash(build.stdout),
          stderrHash: createSha256Hash(build.stderr),
          summary,
        }),
      ),
    });
  }
  /** initialExecution must be the actual result of initialBuildOwner from the trusted T09 adapter.
   * This is one-shot. Only confirmed failed builds get bounded new proposal/approval cycles. */
  async run(
    initialExecution: UEBuildExecutionResult,
    signal: AbortSignal,
  ): Promise<BuildRepairCheckpoint> {
    if (this.busy) fail("coordinator_busy");
    if (this.started) fail("coordinator_already_started");
    this.busy = true;
    this.started = true;
    const generation = this.generation;
    try {
      await this.active(generation, signal);
      this.local(generation, signal);
      let build = execution(initialExecution, this.initialOwner);
      this.current.lastBuild = build;
      for (let attempt = 1; attempt <= this.current.maxAttempts; attempt++) {
        await this.active(generation, signal);
        this.local(generation, signal);
        if (isVerifiedUEBuildSuccess(build)) {
          this.finish("succeeded", "verified_build_success");
          return this.checkpoint;
        }
        if (!build.treeStopped || build.status === "termination_unknown") {
          this.current.pendingBuildOwner = build.owner;
          this.finish("recovery_required", "owned_build_termination_not_verified");
          return this.checkpoint;
        }
        this.current.state = "diagnosing";
        this.current.reason = "parsing_owned_build_diagnostics";
        const assessment = assessUEBuildRepair(build, this.trustedRoots);
        const diagnostic = this.newDiagnostic(build, assessment.summary);
        if (
          !assessment.eligible
        ) {
          this.finish(
            build.status === "cancelled" ? "cancelled" : "failed",
            "execution_not_repairable",
          );
          return this.checkpoint;
        }
        this.syncHistory();
        this.current.attempt = attempt;
        this.current.diagnostic = diagnostic;
        this.current.preview = null;
        this.current.effects = [];
        this.current.recovery = null;
        this.current.state = "reading";
        this.current.reason = "host_snapshot_pending";
        await this.active(generation, signal);
        this.local(generation, signal);
        const rawSnapshot = await this.ports.readSnapshots(
          { binding: this.fixed, diagnostic, paths: copy(this.paths) },
          signal,
        );
        await this.active(generation, signal);
        this.local(generation, signal);
        const snapshot = this.inspectSnapshots(rawSnapshot, diagnostic);
        this.current.state = "proposing";
        this.current.reason = "proposal_pending";
        const proposed = await this.proposer(
          frozen({
            attempt,
            diagnostics: copy(this.current.diagnostics!),
            files: snapshot.files.map(({ path, content }) => ({ path, content })),
          }),
          signal,
        );
        await this.active(generation, signal);
        this.local(generation, signal);
        const preview = this.makePreview(proposed, snapshot, attempt);
        this.current.preview = preview;
        await this.active(generation, signal);
        this.local(generation, signal);
        this.current.state = "applying";
        this.current.reason = "native_approval_or_apply_pending";
        this.current.effects = this.uncertainEffects(preview);
        const rawApply = await this.ports.applyWithNativeApproval(
          { binding: this.fixed, diagnostic, preview },
          signal,
        );
        const applied = this.inspectApply(rawApply, preview);
        this.current.effects = copy(applied.effects);
        await this.active(generation, signal);
        this.local(generation, signal);
        if (applied.decision !== "approved") {
          this.finish(
            applied.decision === "cancelled" ? "cancelled" : "failed",
            `native_apply_approval_${applied.decision}`,
          );
          return this.checkpoint;
        }
        if (applied.status !== "applied") {
          this.finish(
            applied.status === "not_started" ? "failed" : "recovery_required",
            `native_apply_${applied.status}`,
          );
          return this.checkpoint;
        }
        await this.active(generation, signal);
        this.local(generation, signal);
        const buildOwner = frozen({
          runId: this.fixed.runId,
          stepId: `${this.current.repairId}:build:${attempt}`,
          fingerprint: this.fixed.profileFingerprint,
        });
        this.current.state = "building";
        this.current.reason = "native_approval_or_build_pending";
        this.current.buildAttempts++;
        this.current.pendingBuildOwner = buildOwner;
        const rawBuild = await this.ports.buildWithNativeApproval(
          frozen({
            binding: this.fixed,
            owner: buildOwner,
            appliedPreviewId: preview.previewId,
            expectedSources: preview.files.map((file, index) => ({
              path: file.path,
              sha256: applied.effects[index]!.afterHash!,
              objectIdentity: applied.effects[index]!.afterObjectIdentity!,
            })),
          }),
          signal,
        );
        const b = obj(rawBuild);
        closed(b, ["decision", "execution", "reason"]);
        if (
          !["approved", "denied", "cancelled"].includes(String(b.decision)) ||
          typeof b.reason !== "string"
        )
          fail("invalid_build_approval_receipt");
        if (b.decision !== "approved") {
          if (b.execution !== null) fail("unapproved_build_execution");
          this.current.pendingBuildOwner = null;
          await this.active(generation, signal);
          this.local(generation, signal);
          this.finish(
            b.decision === "cancelled" ? "cancelled" : "failed",
            `native_build_approval_${b.decision}`,
          );
          return this.checkpoint;
        }
        build = execution(b.execution, buildOwner);
        this.current.lastBuild = build;
        if (build.treeStopped && build.status !== "termination_unknown")
          this.current.pendingBuildOwner = null;
        await this.active(generation, signal);
        this.local(generation, signal);
        if (isVerifiedUEBuildSuccess(build)) {
          this.finish("succeeded", "verified_build_success");
          return this.checkpoint;
        }
        if (!build.treeStopped || build.status === "termination_unknown") {
          this.finish("recovery_required", "owned_build_termination_not_verified");
          return this.checkpoint;
        }
        if (build.status === "cancelled") {
          this.finish("cancelled", "owned_build_cancelled");
          return this.checkpoint;
        }
        if (
          build.status !== "failed" ||
          build.exitCode === null ||
          build.exitCode === 0 ||
          !build.outputComplete ||
          build.outputTruncated
        ) {
          this.finish("failed", "execution_not_repairable");
          return this.checkpoint;
        }
        if (attempt === this.current.maxAttempts) {
          this.finish("exhausted", "repair_attempt_limit_reached");
          return this.checkpoint;
        }
      }
      this.finish("exhausted", "repair_attempt_limit_reached");
    } catch (error) {
      const code = error instanceof RepairFault ? error.code : "native_or_proposer_call_failed";
      if (this.invalidated || code === "scope_invalidated" || code === "scope_inactive")
        this.finish("invalidated", code);
      else if (signal.aborted || code === "cancelled") this.finish("cancelled", "cancelled");
      else
        this.finish(
          this.current.state === "applying" || this.current.state === "building"
            ? "recovery_required"
            : "failed",
          code,
        );
    } finally {
      this.busy = false;
    }
    return this.checkpoint;
  }
  /** Read-only reconciliation. It does not resume writes, restore bytes or approve another build.
   * File queries cannot settle an uncertain owned process; query that owner through T09 separately. */
  async queryRecovery(signal: AbortSignal): Promise<BuildRepairCheckpoint> {
    if (this.busy) fail("coordinator_busy");
    const preview = this.current.preview;
    if (!preview) fail("no_preview_to_query");
    this.busy = true;
    const generation = this.generation;
    try {
      await this.active(generation, signal);
      this.local(generation, signal);
      const raw = await this.ports.queryRecovery(
        {
          binding: this.fixed,
          diagnostic: preview.diagnostic,
          previewId: preview.previewId,
          paths: preview.files.map((f) => f.path),
        },
        signal,
      );
      await this.active(generation, signal);
      this.local(generation, signal);
      const r = obj(raw);
      closed(r, ["binding", "diagnostic", "previewId", "queryId", "files"]);
      receiptBinding(r, this.fixed, preview.diagnostic);
      if (
        r.previewId !== preview.previewId ||
        !textId(r.queryId, 256) ||
        !Array.isArray(r.files) ||
        r.files.length !== preview.files.length
      )
        fail("invalid_recovery_query");
      const observed = new Map<string, { path: string; sha256: string; objectIdentity: string }>();
      for (const value of r.files) {
        const f = obj(value);
        closed(f, ["path", "sha256", "objectIdentity"]);
        const path = parseBuildRepairPath(f.path);
        if (
          observed.has(path) ||
          !preview.files.some((p) => p.path === path) ||
          typeof f.sha256 !== "string" ||
          !SHA256.test(f.sha256) ||
          !textId(f.objectIdentity)
        )
          fail("invalid_recovery_file");
        observed.set(path, { path, sha256: f.sha256, objectIdentity: f.objectIdentity });
      }
      const files: BuildRepairRecoveryFile[] = preview.files.map((file) => {
        const actual = observed.get(file.path)!,
          effect = this.current.effects.find((e) => e.path === file.path);
        let state: BuildRepairRecoveryFile["state"] = "conflict";
        if (
          effect?.status === "applied" &&
          actual.sha256 === file.afterHash &&
          actual.objectIdentity === effect.afterObjectIdentity
        )
          state = "verified_applied";
        else if (
          actual.sha256 === file.beforeHash &&
          actual.objectIdentity === file.beforeObjectIdentity
        )
          state = "verified_not_started";
        else if (actual.sha256 === file.afterHash) state = "matches_after_unowned";
        return { ...actual, state };
      });
      this.current.recovery = {
        queryId: r.queryId,
        files,
        requiresOwnedBuildQuery: this.current.pendingBuildOwner !== null,
      };
      this.finish(
        "recovery_checked",
        this.current.pendingBuildOwner
          ? "files_checked_owned_build_query_still_required"
          : "files_checked_no_automatic_resume",
      );
    } catch (error) {
      const code = error instanceof RepairFault ? error.code : "recovery_query_call_failed";
      this.finish(
        this.invalidated ? "invalidated" : signal.aborted ? "cancelled" : "recovery_required",
        code,
      );
    } finally {
      this.busy = false;
    }
    return this.checkpoint;
  }
}
/** Test-only deterministic replacement provider. No approval objects, native grants or network API.
 * Native test approvals stay in the host fixture; they cannot become production authority. */
export function createFixtureBuildRepairProposer(
  proposals: readonly unknown[],
): BuildRepairProposer {
  const saved = copy(proposals);
  let next = 0;
  return async (_input, signal) => {
    if (signal.aborted) fail("cancelled");
    if (next >= saved.length) fail("fixture_proposals_exhausted");
    return copy(saved[next++]);
  };
}

/** Local response import. Reuses the coordinator's closed proposal contract and source scope.
 * No provider call, file access, native approval or execution is performed. */
export function parseSingleFileBuildRepairProposal(text:string, file:{path:string;content:string}):{path:string;after:string} {
  if(text.length>BUILD_REPAIR_MAX_TOTAL_BYTES*2)fail("proposal_response_limit");
  const expected=parseBuildRepairPath(file.path);
  const r=obj(JSON.parse(text));closed(r,["files"]);
  if(!Array.isArray(r.files)||r.files.length!==1)fail("proposal_single_file_required");
  const item=obj(r.files[0]);closed(item,["path","after"]);
  const path=parseBuildRepairPath(item.path),after=sourceText(item.after),before=sourceText(file.content);
  if(path!==expected)fail("proposal_outside_read_scope_or_duplicate");
  if(after.content===before.content)fail("proposal_has_no_changes");
  if(before.bytes+after.bytes>BUILD_REPAIR_MAX_TOTAL_BYTES)fail("preview_total_limit");
  return {path,after:after.content};
}

/** Local multi-file import, bound only to the original explicitly read snapshot.
 * The result is editable proposal data, never a write/approval capability. */
export function parseMultiFileBuildRepairProposal(text:string, files:readonly {path:string;content:string}[]):{path:string;after:string}[] {
  if(text.length>BUILD_REPAIR_MAX_TOTAL_BYTES*2)fail("proposal_response_limit");
  if(!files.length||files.length>BUILD_REPAIR_MAX_FILES)fail("proposal_file_limit");
  const scope=new Map<string,{path:string;content:string}>();
  for(const file of files){const path=parseBuildRepairPath(file.path);sourceText(file.content);if(scope.has(path.toLowerCase()))fail("proposal_outside_read_scope_or_duplicate");scope.set(path.toLowerCase(),file);}
  const r=obj(JSON.parse(text));closed(r,["files"]);
  if(!Array.isArray(r.files)||!r.files.length||r.files.length>BUILD_REPAIR_MAX_FILES)fail("proposal_file_limit");
  const seen=new Set<string>(),result:{path:string;after:string}[]=[];let total=0;
  for(const value of r.files){
    const item=obj(value);closed(item,["path","after"]);
    const path=parseBuildRepairPath(item.path),before=scope.get(path.toLowerCase()),after=sourceText(item.after);
    if(!before||path!==before.path||seen.has(path.toLowerCase()))fail("proposal_outside_read_scope_or_duplicate");seen.add(path.toLowerCase());
    total+=sourceText(before.content).bytes+after.bytes;if(total>BUILD_REPAIR_MAX_TOTAL_BYTES)fail("preview_total_limit");
    if(before.content!==after.content)result.push({path,after:after.content});
  }
  if(!result.length)fail("proposal_has_no_changes");
  return result;
}
