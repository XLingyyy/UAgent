import type {
  BuildRepairPreview,
  BuildRepairApplyResult,
} from "../../../../../packages/runtime/src/ue-build-repair.js";
import type { PickupTemplatePlan } from "../../../../../packages/runtime/src/ue-pickup-template-v2.js";
import { sceneTransformsMatch } from "../../../../../packages/runtime/src/ue-scene-batch-v2.js";
import type {
  SceneBatchPlan,
  SceneBatchData,
} from "../../../../../packages/runtime/src/ue-scene-batch-v2.js";
import type { OperationReviewDocument, ReviewIdentity, ReviewItem, ReviewState } from "./types";

const stable = (value: unknown): string =>
  Array.isArray(value)
    ? "[" + value.map(stable).join(",") + "]"
    : value && typeof value === "object"
      ? "{" +
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => JSON.stringify(key) + ":" + stable(child))
          .join(",") +
        "}"
      : (JSON.stringify(value) ?? "");
const same = (a: unknown, b: unknown) => stable(a) === stable(b);
const unique = (items: readonly { id: string }[]) =>
  new Set(items.map((i) => i.id)).size === items.length;
/** Display projection of validated T13 preview data; never accepts/exposes previewToken/hostPermit. */
export interface SemanticPreviewData {
  before: { exists: false };
  after: { typedEditableParameters: PickupTemplatePlan };
  semanticChanges: readonly string[];
  copySaved: false;
  compileStatus: string;
}
export function reviewSemanticPreview(
  identity: ReviewIdentity,
  plan: PickupTemplatePlan,
  data: SemanticPreviewData,
): OperationReviewDocument {
  const complete =
    data.before?.exists === false &&
    data.copySaved === false &&
    data.compileStatus === "up_to_date" &&
    same(data.after?.typedEditableParameters, plan) &&
    Array.isArray(data.semanticChanges);
  return {
    ...identity,
    source: "semantic",
    mode: "preview",
    integrity: complete ? "complete" : "incomplete",
    notices: complete ? [] : ["incomplete"],
    items: [
      {
        id: plan.operationId,
        kind: "object",
        target: plan.targetPackage,
        operation: "create",
        state: complete ? "planned" : "unknown",
        changes: [
          { label: "itemId", before: null, after: plan.itemId },
          { label: "promptText", before: null, after: plan.promptText },
          {
            label: "interactionRadiusCm",
            before: null,
            after: String(plan.interactionRadiusCm) + " cm",
          },
          { label: "interactionKey", before: null, after: plan.interactionKey },
        ],
        notes: data.semanticChanges,
      },
    ],
  };
}
export function reviewFileChanges(
  identity: ReviewIdentity,
  preview: BuildRepairPreview,
  result?: BuildRepairApplyResult,
): OperationReviewDocument {
  let complete =
    preview.files.length > 0 &&
    new Set(preview.files.map((f) => f.path)).size === preview.files.length;
  if (result)
    complete =
      complete &&
      result.previewId === preview.previewId &&
      same(result.binding, preview.binding) &&
      same(result.diagnostic, preview.diagnostic) &&
      new Set(result.effects.map((e) => e.path)).size === result.effects.length &&
      result.effects.every((e) => preview.files.some((f) => f.path === e.path));
  const items: ReviewItem[] = preview.files.map((file) => {
    const effect = result?.effects.find((e) => e.path === file.path);
    let state: ReviewState = "planned";
    if (result) {
      state =
        !complete || !effect || result.status === "unknown"
          ? "unknown"
          : effect.status === "applied" &&
              result.decision === "approved" &&
              ["applied", "partial"].includes(result.status) &&
              effect.afterHash === file.afterHash &&
              Boolean(effect.afterObjectIdentity) &&
              effect.beforeHash === file.beforeHash &&
              effect.beforeObjectIdentity === file.beforeObjectIdentity
            ? "completed"
            : effect.status === "not_started"
              ? "not-started"
              : effect.status === "failed" || effect.status === "conflict"
                ? "failed"
                : "unknown";
    }
    return {
      id: file.path,
      kind: "file",
      target: file.path,
      operation: "modify",
      state,
      diff: file.displayDiff,
    };
  });
  return {
    ...identity,
    source: "files",
    mode: result ? "result" : "preview",
    integrity: complete ? "complete" : "incomplete",
    items,
    notices: [
      ...(!complete ? ["incomplete" as const] : []),
      ...(items.some((i) => i.state === "unknown") ? ["check-state" as const] : []),
    ],
  };
}
function transform(value: SceneBatchPlan["items"][number]["transform"]) {
  return [value.location.x, value.location.y, value.location.z].join(", ");
}
export function reviewSceneBatch(
  identity: ReviewIdentity,
  plan: SceneBatchPlan,
  data?: SceneBatchData,
): OperationReviewDocument {
  let complete = plan.items.length > 0 && unique(plan.items.map((i) => ({ id: i.itemId })));
  if (data)
    complete =
      complete &&
      data.targetMap === plan.targetMap &&
      new Set(data.items.map((i) => i.itemId)).size === data.items.length &&
      data.items.every((i) => plan.items.some((p) => p.itemId === i.itemId));
  const items: ReviewItem[] = plan.items.map((item) => {
    const receipt = data?.items.find((r) => r.itemId === item.itemId);
    let state: ReviewState = "planned";
    if (data)
      state =
        !complete || !receipt
          ? "unknown"
          : receipt.status === "applied" &&
              receipt.owned &&
              Boolean(receipt.actorGuid) &&
              receipt.objectPath ===
                plan.targetMap +
                  "." +
                  plan.targetMap.slice(plan.targetMap.lastIndexOf("/") + 1) +
                  ":PersistentLevel." +
                  item.objectName &&
              data.currentWorldMatches &&
              !data.conflict &&
              receipt.objectName === item.objectName &&
              receipt.mesh === item.mesh &&
              receipt.material === item.material &&
              sceneTransformsMatch(receipt.transform, item.transform)
            ? "completed"
            : receipt.status === "not_started"
              ? "not-started"
              : receipt.status === "failed"
                ? "failed"
                : "unknown";
    return {
      id: item.itemId,
      kind: "object",
      target: plan.targetMap + ":" + item.objectName,
      operation: "create",
      state,
      changes: [
        { label: "mesh", before: null, after: item.mesh },
        { label: "material", before: null, after: item.material },
        { label: "location", before: null, after: transform(item.transform) },
        {
          label: "rotation",
          before: null,
          after: [
            item.transform.rotation.pitch,
            item.transform.rotation.yaw,
            item.transform.rotation.roll,
          ].join(", "),
        },
        {
          label: "scale",
          before: null,
          after: [item.transform.scale.x, item.transform.scale.y, item.transform.scale.z].join(
            ", ",
          ),
        },
      ],
    };
  });
  return {
    ...identity,
    source: "scene",
    mode: data ? "result" : "preview",
    integrity: complete ? "complete" : "incomplete",
    items,
    notices: [
      ...(!complete ? ["incomplete" as const] : []),
      ...(data && !data.saved ? ["not-saved" as const] : []),
      ...(data?.state === "cancelled" ? ["cancelled-not-rollback" as const] : []),
      ...(items.some((i) => i.state === "unknown") ? ["check-state" as const] : []),
    ],
  };
}
/** Camel-case display projection of the existing Rust EffectRecord DTO; descriptions only.
 * Native validation and owner-bound evidence verification remain the host's responsibility. */
export interface EffectRecordDisplay {
  revision: number;
  state:
    | "prepared"
    | "mayHaveBeenSent"
    | "resultUnknown"
    | "verifiedCompleted"
    | "verifiedNotOccurred";
  mayHaveBeenSent: boolean;
  cancelRequested: boolean;
  manualReviewRequired: boolean;
  lastVerifiedOutcome: "completed" | "notOccurred" | "unknown" | null;
  intent: {
    key: { projectId: string; operationId: string };
    planSummary: string;
    targets: readonly {
      kind: "file" | "uePackage" | "ueWorld" | "nativeReceipt";
      locator: string;
    }[];
  };
  lastObservation: null | {
    outcome: "completed" | "notOccurred" | "unknown";
    execution: "quiescent" | "active" | "unknown";
    coverage: "exact" | "partial";
    attribution: "operationBound" | "unproven";
  };
}
export function reviewEffectRecord(
  identity: ReviewIdentity,
  record: EffectRecordDisplay,
): OperationReviewDocument {
  const observation = record.lastObservation,
    verified =
      observation?.execution === "quiescent" &&
      observation.coverage === "exact" &&
      observation.attribution === "operationBound" &&
      !record.manualReviewRequired;
  const state: ReviewState =
    record.state === "verifiedCompleted" &&
    verified &&
    observation?.outcome === "completed" &&
    record.lastVerifiedOutcome === "completed"
      ? "completed"
      : record.state === "verifiedNotOccurred" &&
          verified &&
          observation?.outcome === "notOccurred" &&
          record.lastVerifiedOutcome === "notOccurred"
        ? "not-started"
        : record.state === "prepared" && !record.mayHaveBeenSent && !record.manualReviewRequired
          ? "not-started"
          : "unknown";
  const items: ReviewItem[] = record.intent.targets.map((target, index) => ({
    id: record.intent.key.operationId + ":" + index,
    kind: target.kind === "file" ? "file" : "effect",
    target: target.locator,
    operation: "inspect",
    state,
  }));
  const complete =
    items.length > 0 &&
    new Set(record.intent.targets.map((t) => t.kind + ":" + t.locator)).size === items.length;
  return {
    ...identity,
    source: "effects",
    mode: "result",
    integrity: complete ? "complete" : "incomplete",
    items: items.map((i) => ({ ...i, state: complete ? i.state : "unknown" })),
    notices: [
      ...(!complete ? ["incomplete" as const] : []),
      ...(state === "unknown" ? ["check-state" as const] : []),
      ...(record.cancelRequested ? ["cancelled-not-rollback" as const] : []),
    ],
  };
}
