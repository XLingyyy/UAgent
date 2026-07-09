import type { AssetChangeSet, AssetManifestEntry, AssetVerificationCheck } from "@uagent/shared";

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
