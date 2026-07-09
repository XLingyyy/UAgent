import type {
  AssetManifestEntry,
  AssetManifestState,
  AssetRollbackActionKind,
} from "@uagent/shared";
import { createSandboxAssetPathPolicy } from "./mvp15-asset-policy.js";

export interface RegisterAssetInput {
  projectId: string;
  editorSessionId: string;
  runId: string;
  assetPath: string;
  sourceOperationId: string;
  evidenceId: string;
  sourceAssetPath?: string;
}

export interface AssetManifestRegistry {
  registerCreated(input: RegisterAssetInput): AssetManifestEntry;
  registerDuplicated(input: RegisterAssetInput): AssetManifestEntry;
  markRenamed(entryId: string, nextAssetPath: string, operationId: string, evidenceId: string): AssetManifestEntry;
  markMoved(entryId: string, nextAssetPath: string, operationId: string, evidenceId: string): AssetManifestEntry;
  markSaved(entryId: string, evidenceId: string): AssetManifestEntry;
  markDeleted(entryId: string, evidenceId: string): AssetManifestEntry;
  rollbackState(entryId: string, evidenceId: string): AssetManifestEntry;
  get(entryId: string): AssetManifestEntry | null;
  list(): AssetManifestEntry[];
}

export function createAssetManifestRegistry(now: () => number = () => Date.now()): AssetManifestRegistry {
  const entries = new Map<string, AssetManifestEntry>();
  const policy = createSandboxAssetPathPolicy();
  let counter = 0;

  function register(input: RegisterAssetInput, rollbackAction: AssetRollbackActionKind): AssetManifestEntry {
    const validation = policy.validateAssetPath(input.assetPath);
    if (!validation.ok || !validation.canonicalPath) throw new Error(validation.reason);
    counter += 1;
    const entry: AssetManifestEntry = {
      id: `asset-manifest:${input.runId}:${counter}`,
      projectId: input.projectId,
      editorSessionId: input.editorSessionId,
      runId: input.runId,
      assetPath: validation.canonicalPath,
      packagePath: policy.mapAssetPathToPackagePath(validation.canonicalPath),
      sourceOperationId: input.sourceOperationId,
      sourceAssetPath: input.sourceAssetPath,
      createdAt: now(),
      currentState: "created",
      rollbackAction,
      evidenceIds: [input.evidenceId],
    };
    entries.set(entry.id, entry);
    return entry;
  }

  function update(entryId: string, state: AssetManifestState, evidenceId: string, nextAssetPath?: string, rollbackAction?: AssetRollbackActionKind): AssetManifestEntry {
    const current = entries.get(entryId);
    if (!current) throw new Error("manifest_entry_required");
    const assetPath = nextAssetPath ?? current.assetPath;
    const validation = policy.validateAssetPath(assetPath);
    if (!validation.ok || !validation.canonicalPath) throw new Error(validation.reason);
    const next: AssetManifestEntry = {
      ...current,
      assetPath: validation.canonicalPath,
      packagePath: policy.mapAssetPathToPackagePath(validation.canonicalPath),
      currentState: state,
      rollbackAction: rollbackAction ?? current.rollbackAction,
      evidenceIds: [...new Set([...current.evidenceIds, evidenceId])],
    };
    entries.set(entryId, next);
    return next;
  }

  return {
    registerCreated: (input) => register(input, "delete_created"),
    registerDuplicated: (input) => register(input, "delete_created"),
    markRenamed: (entryId, nextAssetPath, _operationId, evidenceId) => update(entryId, "renamed", evidenceId, nextAssetPath, "rename_back"),
    markMoved: (entryId, nextAssetPath, _operationId, evidenceId) => update(entryId, "moved", evidenceId, nextAssetPath, "move_back"),
    markSaved: (entryId, evidenceId) => update(entryId, "saved", evidenceId),
    markDeleted: (entryId, evidenceId) => update(entryId, "deleted", evidenceId, undefined, "restore_from_trash"),
    rollbackState: (entryId, evidenceId) => update(entryId, "rolled_back", evidenceId, undefined, "none"),
    get: (entryId) => entries.get(entryId) ?? null,
    list: () => [...entries.values()],
  };
}
