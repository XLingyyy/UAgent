import type {
  AssetChangeSet,
  AssetContentEvidenceObservation,
  AssetContentEvidenceRequest,
  AssetContentManifestObservation,
  AssetExternalVerificationBaseline,
  AssetManifestEntry,
  AssetMutationExternalRegistrationBinding,
  AssetVerificationCheck,
  AssetVerificationResult,
} from "@uagent/shared";

type MaybePromise<T> = T | Promise<T>;

export interface AssetExternalBaselineResult {
  ok: boolean;
  reason: string | null;
  baseline: AssetExternalVerificationBaseline | null;
}

export interface AssetExternalVerificationResult {
  ok: boolean;
  reason: string | null;
  verification: AssetVerificationResult | null;
}

export interface AssetMutationExternalVerificationAdapter {
  captureBaseline(
    changeSet: AssetChangeSet,
    registration: AssetMutationExternalRegistrationBinding,
  ): MaybePromise<AssetExternalBaselineResult>;
  verify(
    changeSet: AssetChangeSet,
    registration: AssetMutationExternalRegistrationBinding,
    baseline: AssetExternalVerificationBaseline,
  ): MaybePromise<AssetExternalVerificationResult>;
  verifyRollback?(
    changeSet: AssetChangeSet,
    registration: AssetMutationExternalRegistrationBinding,
    baseline: AssetExternalVerificationBaseline,
  ): MaybePromise<AssetExternalVerificationResult>;
}

export interface Mvp15NativeAssetVerificationAdapterOptions {
  readEvidence(input: AssetContentEvidenceRequest): MaybePromise<AssetContentEvidenceObservation | unknown>;
  snapshotManifest(input: AssetMutationExternalRegistrationBinding): MaybePromise<AssetContentManifestObservation | unknown>;
  now?: () => number;
}

export function createMvp15NativeAssetVerificationAdapter(
  options: Mvp15NativeAssetVerificationAdapterOptions,
): AssetMutationExternalVerificationAdapter {
  const now = options.now ?? (() => Date.now());
  return {
    async captureBaseline(changeSet, registration) {
      const sourcePath = duplicateSourcePath(changeSet);
      if (sourcePath !== "/Game/Test01") {
        return { ok: false, reason: "external_baseline_source_required", baseline: null };
      }
      try {
        const source = normalizeEvidence(await options.readEvidence({ ...registration, assetPath: sourcePath }), sourcePath);
        if (!source || !source.exists || source.size === null || source.sha256 === null) {
          return { ok: false, reason: "external_baseline_source_invalid", baseline: null };
        }
        const contentManifest = normalizeManifest(await options.snapshotManifest(registration));
        if (!contentManifest) return { ok: false, reason: "external_baseline_manifest_invalid", baseline: null };
        const sourceEntry = contentManifest.entries.find((entry) => entry.assetPath === sourcePath);
        if (!sourceEntry || sourceEntry.size !== source.size || sourceEntry.sha256 !== source.sha256) {
          return { ok: false, reason: "external_baseline_source_manifest_mismatch", baseline: null };
        }
        return {
          ok: true,
          reason: null,
          baseline: {
            source: cloneEvidence(source),
            contentManifest: cloneManifest(contentManifest),
          },
        };
      } catch {
        return { ok: false, reason: "external_baseline_read_failed", baseline: null };
      }
    },
    async verify(changeSet, registration, baseline) {
      const sourcePath = duplicateSourcePath(changeSet);
      const finalTarget = finalTargetPath(changeSet);
      const oldPaths = oldMutationPaths(changeSet);
      if (sourcePath !== "/Game/Test01" || !finalTarget || !isCanonicalAssetPath(finalTarget)) {
        return verificationFailure("external_verification_binding_invalid");
      }
      const trustedBaselineSource = normalizeEvidence(baseline.source, sourcePath);
      const trustedBaselineManifest = normalizeManifest(baseline.contentManifest);
      if (!trustedBaselineSource?.exists || trustedBaselineSource.size === null || !trustedBaselineSource.sha256 || !trustedBaselineManifest) {
        return verificationFailure("external_baseline_invalid");
      }
      try {
        const sourceAfter = normalizeEvidence(await options.readEvidence({ ...registration, assetPath: sourcePath }), sourcePath);
        if (!sourceAfter?.exists || sourceAfter.size === null || !sourceAfter.sha256) {
          return verificationFailure("external_source_evidence_invalid");
        }
        if (sourceAfter.size !== trustedBaselineSource.size || sourceAfter.sha256 !== trustedBaselineSource.sha256) {
          return verificationFailure("external_source_changed");
        }
        const target = normalizeEvidence(await options.readEvidence({ ...registration, assetPath: finalTarget }), finalTarget);
        if (!target?.exists || target.size === null || !target.sha256) {
          return verificationFailure("external_target_evidence_invalid");
        }
        const absent: AssetContentEvidenceObservation[] = [];
        for (const oldPath of oldPaths) {
          const observation = normalizeEvidence(await options.readEvidence({ ...registration, assetPath: oldPath }), oldPath);
          if (!observation || observation.exists || observation.size !== null || observation.sha256 !== null) {
            return verificationFailure("external_old_path_evidence_invalid");
          }
          absent.push(observation);
        }
        const afterManifest = normalizeManifest(await options.snapshotManifest(registration));
        if (!afterManifest) return verificationFailure("external_manifest_invalid");
        const runRoot = `/Game/UAgentSandbox/${changeSet.runId}`;
        if (!manifestEntriesEqual(entriesOutsideRun(trustedBaselineManifest, runRoot), entriesOutsideRun(afterManifest, runRoot))) {
          return verificationFailure("external_content_outside_run_changed");
        }
        const runEntries = afterManifest.entries.filter((entry) => isPathWithin(entry.assetPath, runRoot));
        if (runEntries.length !== 1 || runEntries[0]?.assetPath !== finalTarget) {
          return verificationFailure("external_run_manifest_unexpected");
        }
        if (runEntries[0].size !== target.size || runEntries[0].sha256 !== target.sha256) {
          return verificationFailure("external_target_manifest_mismatch");
        }
        if (oldPaths.some((path) => afterManifest.entries.some((entry) => entry.assetPath === path))) {
          return verificationFailure("external_old_path_manifest_present");
        }
        const checks: AssetVerificationCheck[] = [
          externalCheck("source", "source_asset_untouched", "passed", sourcePath, "Source size and SHA-256 match the pre-execution baseline."),
          externalCheck("target", "asset_exists", "passed", finalTarget, "Final sandbox target exists in read-only Content evidence."),
          externalCheck("saved", "single_asset_saved", "passed", finalTarget, "The single sandbox target is present on disk after save."),
          ...absent.map((observation, index) => externalCheck(`old-${index}`, "asset_moved", "passed", observation.assetPath, "Old rename/move path is absent from Content.")),
        ];
        const evidenceIds = [sourceAfter.evidenceId, target.evidenceId, ...absent.map((item) => item.evidenceId), afterManifest.evidenceId]
          .filter((value): value is string => Boolean(value));
        return {
          ok: true,
          reason: null,
          verification: {
            id: `asset-verification:external:${hash(changeSet.id)}`,
            changeSetId: changeSet.id,
            status: "passed",
            checkedAt: now(),
            checks,
            evidenceId: `asset-evidence:external:${hash(evidenceIds.join("|"))}`,
            redaction: { redacted: true, replacedPaths: 0, replacedSecrets: 0 },
            summary: "External read-only Content evidence matched the source, target, old-path, save, and outside-run baseline.",
          },
        };
      } catch {
        return verificationFailure("external_verification_read_failed");
      }
    },
    async verifyRollback(changeSet, registration, baseline) {
      const sourcePath = duplicateSourcePath(changeSet);
      if (sourcePath !== "/Game/Test01") return verificationFailure("external_rollback_binding_invalid");
      const trustedBaselineSource = normalizeEvidence(baseline.source, sourcePath);
      const trustedBaselineManifest = normalizeManifest(baseline.contentManifest);
      if (!trustedBaselineSource?.exists || trustedBaselineSource.size === null || !trustedBaselineSource.sha256 || !trustedBaselineManifest) {
        return verificationFailure("external_baseline_invalid");
      }
      try {
        const sourceAfter = normalizeEvidence(await options.readEvidence({ ...registration, assetPath: sourcePath }), sourcePath);
        if (!sourceAfter?.exists || sourceAfter.size === null || !sourceAfter.sha256) {
          return verificationFailure("external_rollback_source_evidence_invalid");
        }
        if (sourceAfter.size !== trustedBaselineSource.size || sourceAfter.sha256 !== trustedBaselineSource.sha256) {
          return verificationFailure("external_rollback_source_changed");
        }
        const afterManifest = normalizeManifest(await options.snapshotManifest(registration));
        if (!afterManifest) return verificationFailure("external_rollback_manifest_invalid");
        const runRoot = `/Game/UAgentSandbox/${changeSet.runId}`;
        if (afterManifest.entries.some((entry) => isPathWithin(entry.assetPath, runRoot))) {
          return verificationFailure("external_rollback_run_not_empty");
        }
        if (!manifestEntriesEqual(entriesOutsideRun(trustedBaselineManifest, runRoot), entriesOutsideRun(afterManifest, runRoot))) {
          return verificationFailure("external_rollback_content_not_restored");
        }
        const evidenceIds = [sourceAfter.evidenceId, afterManifest.evidenceId].filter((value): value is string => Boolean(value));
        return {
          ok: true,
          reason: null,
          verification: {
            id: `asset-verification:rollback:${hash(changeSet.id)}`,
            changeSetId: changeSet.id,
            status: "passed",
            checkedAt: now(),
            checks: [
              externalCheck("rollback-source", "source_asset_untouched", "passed", sourcePath, "Source size and SHA-256 match the pre-execution baseline after rollback."),
              externalCheck("rollback-run", "asset_deleted_or_trash", "passed", runRoot, "The run-scoped Content manifest contains no asset packages after rollback."),
            ],
            evidenceId: `asset-evidence:external-rollback:${hash(evidenceIds.join("|"))}`,
            redaction: { redacted: true, replacedPaths: 0, replacedSecrets: 0 },
            summary: "External read-only Content evidence confirms rollback restored the baseline.",
          },
        };
      } catch {
        return verificationFailure("external_rollback_verification_read_failed");
      }
    },
  };
}

function verificationFailure(reason: string): AssetExternalVerificationResult {
  return { ok: false, reason, verification: null };
}

function normalizeEvidence(raw: unknown, expectedPath: string): AssetContentEvidenceObservation | null {
  if (!isRecord(raw) || !hasOnlyKeys(raw, ["status", "reason", "assetPath", "exists", "size", "sha256", "evidenceId"]) || containsSensitiveValue(raw)) return null;
  if (raw.status !== "observed" || typeof raw.reason !== "string" || raw.assetPath !== expectedPath || !isCanonicalAssetPath(expectedPath)) return null;
  if (typeof raw.exists !== "boolean" || typeof raw.evidenceId !== "string" || !raw.evidenceId.trim()) return null;
  if (raw.exists) {
    if (!isSafeSize(raw.size) || !isSha256(raw.sha256) || raw.reason !== "asset_present") return null;
  } else if (raw.size !== null || raw.sha256 !== null || raw.reason !== "asset_absent") {
    return null;
  }
  return {
    status: "observed",
    reason: raw.reason,
    assetPath: expectedPath,
    exists: raw.exists,
    size: raw.exists ? raw.size as number : null,
    sha256: raw.exists ? raw.sha256 as string : null,
    evidenceId: raw.evidenceId,
  };
}

function normalizeManifest(raw: unknown): AssetContentManifestObservation | null {
  if (!isRecord(raw) || !hasOnlyKeys(raw, ["status", "reason", "entries", "aggregateSha256", "evidenceId"]) || containsSensitiveValue(raw)) return null;
  if (raw.status !== "observed" || raw.reason !== "content_manifest_captured" || !Array.isArray(raw.entries)) return null;
  if (!isSha256(raw.aggregateSha256) || typeof raw.evidenceId !== "string" || !raw.evidenceId.trim()) return null;
  const entries: AssetContentManifestObservation["entries"] = [];
  let previousPath = "";
  for (const rawEntry of raw.entries) {
    if (!isRecord(rawEntry) || !hasOnlyKeys(rawEntry, ["assetPath", "size", "sha256"]) || !isCanonicalAssetPath(rawEntry.assetPath) || !isSafeSize(rawEntry.size) || !isSha256(rawEntry.sha256)) return null;
    if (previousPath && rawEntry.assetPath <= previousPath) return null;
    previousPath = rawEntry.assetPath;
    entries.push({ assetPath: rawEntry.assetPath, size: rawEntry.size, sha256: rawEntry.sha256 });
  }
  return {
    status: "observed",
    reason: "content_manifest_captured",
    entries,
    aggregateSha256: raw.aggregateSha256,
    evidenceId: raw.evidenceId,
  };
}

function cloneEvidence(evidence: AssetContentEvidenceObservation): AssetContentEvidenceObservation {
  return { ...evidence };
}

function cloneManifest(manifest: AssetContentManifestObservation): AssetContentManifestObservation {
  return { ...manifest, entries: manifest.entries.map((entry) => ({ ...entry })) };
}

function duplicateSourcePath(changeSet: AssetChangeSet): string | null {
  return changeSet.operations.find((operation) => operation.kind === "duplicate_asset")?.assetPathBefore ?? null;
}

function finalTargetPath(changeSet: AssetChangeSet): string | null {
  const save = changeSet.operations.find((operation) => operation.kind === "save_single_asset");
  return save?.assetPathAfter ?? save?.assetPathBefore ?? null;
}

function oldMutationPaths(changeSet: AssetChangeSet): string[] {
  return [...new Set(changeSet.operations
    .filter((operation) => operation.kind === "rename_asset" || operation.kind === "move_asset")
    .flatMap((operation) => operation.assetPathBefore ? [operation.assetPathBefore] : []))];
}

function entriesOutsideRun(manifest: AssetContentManifestObservation, runRoot: string): AssetContentManifestObservation["entries"] {
  return manifest.entries.filter((entry) => !isPathWithin(entry.assetPath, runRoot));
}

function manifestEntriesEqual(left: AssetContentManifestObservation["entries"], right: AssetContentManifestObservation["entries"]): boolean {
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index];
    return other?.assetPath === entry.assetPath && other.size === entry.size && other.sha256 === entry.sha256;
  });
}

function externalCheck(
  suffix: string,
  kind: AssetVerificationCheck["kind"],
  status: AssetVerificationCheck["status"],
  assetPath: string,
  summary: string,
): AssetVerificationCheck {
  return { id: `verify:external:${suffix}:${hash(assetPath)}`, kind, status, assetPath, summary };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function containsSensitiveValue(value: unknown): boolean {
  if (typeof value === "string") {
    return /^[A-Za-z]:[\\/]/.test(value)
      || /^\\\\/.test(value)
      || /^file:/i.test(value)
      || (value.startsWith("/") && !value.startsWith("/Game/"))
      || /approval.?token|trusted.?project.?root|pid.?hash|editor.?session|\bsk-[a-z0-9_-]{8,}/i.test(value);
  }
  if (Array.isArray(value)) return value.some(containsSensitiveValue);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, nested]) => (
    /approval.?token|trusted.?project.?root|pid.?hash|editor.?session/i.test(key)
    || containsSensitiveValue(nested)
  ));
}

function isCanonicalAssetPath(value: unknown): value is string {
  return typeof value === "string"
    && value.startsWith("/Game/")
    && value.length > "/Game/".length
    && !value.includes("\\")
    && !value.includes("//")
    && !value.includes("..")
    && !value.includes(":")
    && !value.includes(".")
    && value.split("/").slice(2).every((segment) => Boolean(segment));
}

function isPathWithin(assetPath: string, root: string): boolean {
  return assetPath === root || assetPath.startsWith(`${root}/`);
}

function isSafeSize(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export interface AssetVerificationManifestReader {
  get(entryId: string): AssetManifestEntry | null;
  list(): AssetManifestEntry[];
}

export function verifyAssetExists(changeSet: AssetChangeSet, assetPath: string, manifest?: AssetVerificationManifestReader): AssetVerificationCheck {
  const found = findEntryForPath(changeSet, assetPath, manifest);
  const exists = found?.entry
    ? !["deleted", "rolled_back"].includes(found.entry.currentState) && (found.entry.assetPath === assetPath || hasPlannedFollowUp(changeSet, found.operation.manifestEntryId, assetPath))
    : existingRecordedCheck(changeSet, "asset_exists", assetPath)?.status === "passed";
  return {
    id: `verify:exists:${hash(assetPath)}`,
    kind: "asset_exists",
    status: exists ? "passed" : "failed",
    assetPath,
    summary: exists ? "Asset exists in sandbox manifest." : "Asset was not found in sandbox manifest.",
  };
}

export function verifyAssetMoved(changeSet: AssetChangeSet, beforePath: string, afterPath: string, manifest?: AssetVerificationManifestReader): AssetVerificationCheck {
  const op = changeSet.operations.find((operation) => ["rename_asset", "move_asset"].includes(operation.kind) && operation.assetPathBefore === beforePath && operation.assetPathAfter === afterPath);
  const entry = op?.manifestEntryId && manifest ? manifest.get(op.manifestEntryId) : null;
  const moved = entry
    ? entry.projectId === changeSet.projectId &&
      entry.editorSessionId === changeSet.editorSessionId &&
      entry.assetPath !== beforePath &&
      ((entry.assetPath === afterPath && ["renamed", "moved", "saved"].includes(entry.currentState)) || hasPlannedFollowUp(changeSet, op?.manifestEntryId ?? null, afterPath))
    : existingRecordedCheck(changeSet, "asset_moved", afterPath)?.status === "passed";
  return {
    id: `verify:moved:${hash(afterPath)}`,
    kind: "asset_moved",
    status: moved ? "passed" : "failed",
    assetPath: afterPath,
    summary: moved ? "Old path is absent and new sandbox path is present." : "Move verification did not find the expected before/after pair.",
  };
}

export function verifyAssetDeletedOrTrash(changeSet: AssetChangeSet, assetPath: string, manifest?: AssetVerificationManifestReader): AssetVerificationCheck {
  const op = changeSet.operations.find((operation) => operation.kind === "delete_sandbox_asset" && operation.assetPathBefore === assetPath);
  const entry = op?.manifestEntryId && manifest ? manifest.get(op.manifestEntryId) : null;
  const deleted = entry
    ? entry.projectId === changeSet.projectId && entry.editorSessionId === changeSet.editorSessionId && entry.assetPath === assetPath && entry.currentState === "deleted"
    : existingRecordedCheck(changeSet, "asset_deleted_or_trash", assetPath)?.status === "passed";
  return {
    id: `verify:deleted:${hash(assetPath)}`,
    kind: "asset_deleted_or_trash",
    status: deleted ? "passed" : "blocked",
    assetPath,
    summary: deleted ? "Asset is deleted or moved to sandbox trash." : "Delete requires manifest ownership and rollback action.",
  };
}

export function verifySingleAssetSaved(changeSet: AssetChangeSet, assetPath: string, manifest?: AssetVerificationManifestReader): AssetVerificationCheck {
  const op = changeSet.operations.find((operation) => operation.kind === "save_single_asset" && operation.assetPathAfter === assetPath);
  const entry = op?.manifestEntryId && manifest ? manifest.get(op.manifestEntryId) : null;
  const saved = entry
    ? entry.projectId === changeSet.projectId && entry.editorSessionId === changeSet.editorSessionId && entry.assetPath === assetPath && entry.currentState === "saved"
    : existingRecordedCheck(changeSet, "single_asset_saved", assetPath)?.status === "passed";
  return {
    id: `verify:saved:${hash(assetPath)}`,
    kind: "single_asset_saved",
    status: saved ? "passed" : "failed",
    assetPath,
    summary: saved ? "Single sandbox asset save was recorded; global editor save remains blocked." : "Single asset save record missing.",
  };
}

export function verifySourceAssetUntouched(changeSet: AssetChangeSet, assetPath: string, manifest?: AssetVerificationManifestReader): AssetVerificationCheck {
  const duplicateOp = changeSet.operations.find((op) => op.kind === "duplicate_asset" && op.assetPathBefore === assetPath);
  const sourceOnly = manifest
    ? Boolean(duplicateOp) && !manifest.list().some((entry) => entry.projectId === changeSet.projectId && entry.editorSessionId === changeSet.editorSessionId && entry.assetPath === assetPath)
    : existingRecordedCheck(changeSet, "source_asset_untouched", assetPath)?.status === "passed";
  return {
    id: `verify:source:${hash(assetPath)}`,
    kind: "source_asset_untouched",
    status: sourceOnly ? "passed" : "blocked",
    assetPath,
    summary: sourceOnly ? "Source template asset was read-only and untouched." : "No source asset was bound for duplicate verification.",
  };
}

function findEntryForPath(changeSet: AssetChangeSet, assetPath: string, manifest?: AssetVerificationManifestReader): { entry: AssetManifestEntry; operation: NonNullable<AssetChangeSet["operations"][number]> } | null {
  if (!manifest) return null;
  const op = changeSet.operations.find((operation) => operation.assetPathAfter === assetPath && operation.manifestEntryId);
  const entry = op?.manifestEntryId ? manifest.get(op.manifestEntryId) : null;
  return op && entry ? { entry, operation: op } : null;
}

function existingRecordedCheck(changeSet: AssetChangeSet, kind: AssetVerificationCheck["kind"], assetPath: string): AssetVerificationCheck | null {
  return changeSet.verification?.checks.find((check) => check.kind === kind && check.assetPath === assetPath) ?? null;
}

function hasPlannedFollowUp(changeSet: AssetChangeSet, manifestEntryId: string | null, assetPath: string): boolean {
  if (!manifestEntryId) return false;
  return changeSet.operations.some(
    (operation) =>
      operation.manifestEntryId === manifestEntryId &&
      operation.assetPathBefore === assetPath &&
      (operation.kind === "rename_asset" || operation.kind === "move_asset"),
  );
}

function hash(value: string): string {
  let result = 0;
  for (let i = 0; i < value.length; i += 1) result = (result * 31 + value.charCodeAt(i)) >>> 0;
  return result.toString(16);
}
