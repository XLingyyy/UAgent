import type {
  BuildRepairPreview,
  BuildRepairApplyResult,
} from "../../../../../packages/runtime/src/ue-build-repair.js";
import type { PickupTemplatePlan } from "../../../../../packages/runtime/src/ue-pickup-template-v2.js";
import {
  createSceneSessionFromVerifiedHost,
  parseSceneBatchPlan,
  parseSceneResult,
  UE_SCENE_CONTRACT,
} from "../../../../../packages/runtime/src/ue-scene-batch-v2.js";
import type {
  SceneBatchPlan,
  SceneBatchData,
} from "../../../../../packages/runtime/src/ue-scene-batch-v2.js";
import {
  reviewFileChanges,
  reviewSceneBatch,
  reviewSemanticPreview,
  reviewEffectRecord,
  type EffectRecordDisplay,
} from "./adapters";
import type { Locale } from "../i18n";
const hash = (character: string) => character.repeat(64);
const binding = {
  hostSessionId: "synthetic-host",
  projectId: "synthetic-project",
  rootObjectId: "synthetic-root",
  runId: "synthetic-run",
  profileFingerprint: hash("a"),
};
const diagnostic = {
  diagnosticId: "synthetic-diagnostic",
  buildOwner: { runId: "synthetic-run", stepId: "build-1", fingerprint: hash("b") },
};
export const filePreview: BuildRepairPreview = {
  schemaVersion: 1,
  repairId: "repair-demo",
  attempt: 1,
  binding,
  diagnostic,
  snapshotId: "snapshot-demo",
  previewId: "preview-files-1",
  files: [
    {
      path: "Source/Gameplay/InteractionComponent.h",
      before: "bool CanInteract();\n",
      after: "bool CanInteract() const;\n",
      beforeHash: hash("1"),
      afterHash: hash("2"),
      beforeObjectIdentity: "file-1",
      unifiedDiff: "@@ -18,1 +18,1 @@\n-bool CanInteract();\n+bool CanInteract() const;",
      displayDiff: "@@ -18,1 +18,1 @@\n-bool CanInteract();\n+bool CanInteract() const;",
    },
    {
      path: "Source/Gameplay/InteractionComponent.cpp",
      before: "bool UInteractionComponent::CanInteract() {\n",
      after: "bool UInteractionComponent::CanInteract() const {\n",
      beforeHash: hash("3"),
      afterHash: hash("4"),
      beforeObjectIdentity: "file-2",
      unifiedDiff:
        "@@ -42,1 +42,1 @@\n-bool UInteractionComponent::CanInteract() {\n+bool UInteractionComponent::CanInteract() const {",
      displayDiff:
        "@@ -42,1 +42,1 @@\n-bool UInteractionComponent::CanInteract() {\n+bool UInteractionComponent::CanInteract() const {",
    },
    {
      path: "Source/Gameplay/Gameplay.Build.cs",
      before: 'PublicDependencyModuleNames.Add("Core");\n',
      after: 'PublicDependencyModuleNames.AddRange(new[] { "Core", "EnhancedInput" });\n',
      beforeHash: hash("5"),
      afterHash: hash("6"),
      beforeObjectIdentity: "file-3",
      unifiedDiff:
        '@@ -12,1 +12,1 @@\n-PublicDependencyModuleNames.Add("Core");\n+PublicDependencyModuleNames.AddRange(new[] { "Core", "EnhancedInput" });',
      displayDiff:
        '@@ -12,1 +12,1 @@\n-PublicDependencyModuleNames.Add("Core");\n+PublicDependencyModuleNames.AddRange(new[] { "Core", "EnhancedInput" });',
    },
  ],
};
export const fileResult: BuildRepairApplyResult = {
  binding,
  diagnostic,
  previewId: filePreview.previewId,
  decision: "approved",
  status: "partial",
  reason: "",
  effects: filePreview.files.map((file, index) => ({
    path: file.path,
    status: index === 0 ? "applied" : index === 1 ? "failed" : "unknown",
    beforeHash: file.beforeHash,
    beforeObjectIdentity: file.beforeObjectIdentity,
    afterHash: index === 0 ? file.afterHash : null,
    afterObjectIdentity: index === 0 ? "new-file-1" : null,
    reason: "",
  })),
};
export const pickupPlan: PickupTemplatePlan = {
  operationId: "00000000-0000-4000-8000-000000000013",
  targetPackage: "/Game/UAgentBuildLab/Pickup_T13/BP_HealthPickup",
  expectedDiskState: "absent",
  templateId: "actor.pickup.native.v1",
  parentClass: "/Script/UAgentPickupRuntimeV2.UAgentPickupActorV2",
  itemId: "HealthPickup",
  promptText: "按 E 拾取",
  interactionRadiusCm: 180,
  interactionKey: "E",
};
export const pickupPreview = {
  before: { exists: false as const },
  after: { typedEditableParameters: pickupPlan },
  semanticChanges: [
    "create native-parent Blueprint",
    "configure four inherited components",
    "set four typed editable defaults",
    "enable bounded pickup behavior supplied by fixed parent",
  ],
  copySaved: false as const,
  compileStatus: "up_to_date",
};
export const scenePlan = parseSceneBatchPlan({
  operationId: "00000000-0000-4000-8000-000000000014",
  targetMap: "/Game/UAgentBuildLab/Scene_T14/L_TrainingGround",
  expectedDiskState: "absent",
  items: Array.from({ length: 20 }, (_, i) => ({
    itemId: "item_" + i,
    objectName: "UA14_TrainingBlock_" + String(i + 1).padStart(2, "0"),
    mesh: "/Engine/BasicShapes/Cube.Cube",
    material: "/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial",
    transform: {
      location: { x: (i % 5) * 300, y: Math.floor(i / 5) * 300, z: 50 },
      rotation: { pitch: 0, yaw: 0, roll: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  })),
});
/** Synthetic receipt data only. Applied/unapplied fields follow the real closed T14 contract. */
export function sceneFixtureData(plan: SceneBatchPlan, appliedCount: number): SceneBatchData {
  const mapName = plan.targetMap.slice(plan.targetMap.lastIndexOf("/") + 1);
  return {
    state: appliedCount === 20 ? "completed" : "cancelled",
    targetMap: plan.targetMap,
    currentWorldMatches: true,
    packageDirty: appliedCount > 0,
    saved: false,
    diskExists: false,
    diskHash: "",
    conflict: false,
    cancelIsRollback: false,
    appliedCount,
    conflictReason: "",
    items: plan.items.map((item, i) => ({
      itemId: item.itemId,
      objectName: item.objectName,
      status: i < appliedCount ? "applied" : "not_started",
      reason: "",
      owned: i < appliedCount,
      actorGuid:
        i < appliedCount ? "00000000-0000-4000-8000-" + String(i + 1).padStart(12, "0") : "",
      objectPath:
        i < appliedCount
          ? plan.targetMap + "." + mapName + ":PersistentLevel." + item.objectName
          : "",
      mesh: i < appliedCount ? item.mesh : "",
      material: i < appliedCount ? item.material : "",
      ...(i < appliedCount ? { transform: structuredClone(item.transform) } : {}),
    })),
  };
}
/** In-memory synthetic host binding for fixture validation; no native approval or execution. */
export function parseSceneFixture(plan: SceneBatchPlan, data: SceneBatchData): SceneBatchData {
  const session = createSceneSessionFromVerifiedHost({
    projectKey: "synthetic-scene-project",
    instanceId: "00000000-0000-4000-8000-000000000101",
    rootObjectId: "synthetic-scene-root",
    runId: "00000000-0000-4000-8000-000000000102",
    approvedPlan: plan,
  });
  return parseSceneResult(session, "uagent.v2.scene.query", {
    schemaVersion: "uagent.scene.result.v2",
    contractVersion: UE_SCENE_CONTRACT,
    projectKey: session.projectKey,
    instanceId: session.instanceId,
    rootObjectId: session.rootObjectId,
    runId: session.runId,
    operation: "uagent.v2.scene.query",
    plan: session.plan,
    planHash: hash("a"),
    data,
  });
}
const partialSceneData = sceneFixtureData(scenePlan, 2);
partialSceneData.items[2]!.status = "unknown";
export const sceneResult = parseSceneFixture(scenePlan, partialSceneData);

export const uncertainRecord: EffectRecordDisplay = {
  revision: 4,
  state: "resultUnknown",
  mayHaveBeenSent: true,
  cancelRequested: true,
  manualReviewRequired: true,
  lastVerifiedOutcome: "completed",
  intent: {
    key: { projectId: "synthetic-project", operationId: "effect-demo" },
    planSummary: "Move training objects",
    targets: [
      { kind: "ueWorld", locator: scenePlan.targetMap },
      { kind: "file", locator: "Config/DefaultGame.ini" },
    ],
  },
  lastObservation: {
    outcome: "unknown",
    execution: "unknown",
    coverage: "partial",
    attribution: "unproven",
  },
};
export function reviewFixtures(locale: Locale = "zh-CN") {
  const title = (zh: string, en: string) => (locale === "en" ? en : zh);
  return {
    files: reviewFileChanges(
      {
        id: "files",
        revision: "1",
        title: title("修复交互组件编译错误", "Fix interaction component compile errors"),
      },
      filePreview,
    ),
    fileResult: reviewFileChanges(
      {
        id: "files-result",
        revision: "2",
        title: title("交互组件 · 修改结果", "Interaction component · results"),
      },
      filePreview,
      fileResult,
    ),
    semantic: reviewSemanticPreview(
      {
        id: "pickup",
        revision: "1",
        title: title("新建交互拾取物", "Create an interactive pickup"),
      },
      pickupPlan,
      pickupPreview,
    ),
    scene: reviewSceneBatch(
      {
        id: "scene",
        revision: "3",
        title: title("训练区域 · 场景结果", "Training ground · scene results"),
      },
      scenePlan,
      sceneResult,
    ),
    effects: reviewEffectRecord(
      {
        id: "effect",
        revision: "4",
        title: title("训练区域 · 等待效果核对", "Training ground · effect check needed"),
      },
      uncertainRecord,
    ),
  };
}
