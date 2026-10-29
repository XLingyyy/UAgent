/** T14 current-run scene policy. Hashes and model text never confer native write authority. */
export const UE_SCENE_CONTRACT = "2.2.0-scene-batch-current-run";
export const UE_SCENE_ROOT = "/Game/UAgentBuildLab/Scene_T14";
export const UE_SCENE_MATERIAL = "/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial";
export const UE_SCENE_MESHES = Object.freeze(
  ["Cube", "Sphere", "Cylinder"].map((name) => `/Engine/BasicShapes/${name}.${name}`),
);
export const UE_SCENE_TOOLS = Object.freeze([
  "uagent.v2.scene.capabilities",
  "uagent.v2.scene.prepare",
  "uagent.v2.scene.execute",
  "uagent.v2.scene.cancel",
  "uagent.v2.scene.query",
  "uagent.v2.scene.resume",
  "uagent.v2.scene.save",
] as const);
export type SceneTool = (typeof UE_SCENE_TOOLS)[number];
export type SceneOperation = Exclude<SceneTool, "uagent.v2.scene.capabilities">;
type RecordValue = Record<string, unknown>;
export interface SceneTransform {
  location: { x: number; y: number; z: number };
  rotation: { pitch: number; yaw: number; roll: number };
  scale: { x: number; y: number; z: number };
}
export interface SceneBatchItem {
  itemId: string;
  objectName: string;
  mesh: string;
  material: typeof UE_SCENE_MATERIAL;
  transform: SceneTransform;
}
export interface SceneBatchPlan {
  operationId: string;
  targetMap: string;
  expectedDiskState: "absent";
  items: SceneBatchItem[];
}
export type SceneState =
  | "not_started"
  | "prepared"
  | "running"
  | "paused_for_test_cancel"
  | "cancelled"
  | "completed"
  | "saved"
  | "conflicted"
  | "failed";
export interface SceneItemReceipt {
  itemId: string;
  objectName: string;
  status: "not_started" | "applied" | "unknown" | "failed";
  reason: string;
  owned: boolean;
  actorGuid: string;
  objectPath: string;
  mesh: string;
  material: string;
  transform?: SceneTransform;
}
export interface SceneBatchData {
  state: SceneState;
  targetMap: string;
  currentWorldMatches: boolean;
  packageDirty: boolean;
  saved: boolean;
  diskExists: boolean;
  diskHash: string;
  conflict: boolean;
  cancelIsRollback: false;
  items: SceneItemReceipt[];
  queryToken?: string;
  appliedCount: number;
  conflictReason: string;
}
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const WORD = /^[A-Za-z0-9_]{1,64}$/;
const PLAN_FIELDS = ["operationId", "targetMap", "expectedDiskState", "items"];
const ITEM_FIELDS = ["itemId", "objectName", "mesh", "material", "transform"];
const DATA_FIELDS = [
  "state",
  "targetMap",
  "currentWorldMatches",
  "packageDirty",
  "saved",
  "diskExists",
  "diskHash",
  "conflict",
  "cancelIsRollback",
  "items",
  "appliedCount",
  "conflictReason",
];
const RECEIPT_FIELDS = [
  "itemId",
  "objectName",
  "status",
  "reason",
  "owned",
  "actorGuid",
  "objectPath",
  "mesh",
  "material",
];
const STATES: SceneState[] = [
  "not_started",
  "prepared",
  "running",
  "paused_for_test_cancel",
  "cancelled",
  "completed",
  "saved",
  "conflicted",
  "failed",
];
const SESSIONS = new WeakSet<object>();
const SESSION = Symbol("verified-current-run-scene-session");
export interface SceneSession {
  readonly [SESSION]: true;
  readonly projectKey: string;
  readonly instanceId: string;
  readonly rootObjectId: string;
  readonly runId: string;
  readonly plan: SceneBatchPlan;
}
function fail(reason: string): never {
  throw new Error(`scene_v2_${reason}`);
}
function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("object_required");
  return value as RecordValue;
}
function exact(
  value: RecordValue,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    fail("unexpected_fields");
}
function guid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    GUID.test(value) &&
    value !== "00000000-0000-0000-0000-000000000000"
  );
}
function bounded(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
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
function transform(value: unknown): SceneTransform {
  const t = record(value);
  exact(t, ["location", "rotation", "scale"]);
  for (const [field, keys, min, max] of [
    ["location", ["x", "y", "z"], -10000, 10000],
    ["rotation", ["pitch", "yaw", "roll"], -180, 180],
    ["scale", ["x", "y", "z"], 0.1, 10],
  ] as const) {
    const v = record(t[field]);
    exact(v, keys);
    if (keys.some((key) => !bounded(v[key], min, max))) fail("invalid_transform");
  }
  return structuredClone(t) as unknown as SceneTransform;
}
/** Closed plan: exactly 20 fixed static objects in one new direct-child ordinary map. */
export function parseSceneBatchPlan(value: unknown): SceneBatchPlan {
  const p = record(value);
  exact(p, PLAN_FIELDS);
  if (
    !guid(p.operationId) ||
    typeof p.targetMap !== "string" ||
    !p.targetMap.startsWith(`${UE_SCENE_ROOT}/`) ||
    !/^L_[A-Za-z0-9_]{0,78}$/.test(p.targetMap.slice(UE_SCENE_ROOT.length + 1)) ||
    p.expectedDiskState !== "absent" ||
    !Array.isArray(p.items) ||
    p.items.length !== 20
  )
    fail("invalid_fixed_plan");
  const ids = new Set<string>(),
    names = new Set<string>();
  const items = p.items.map((value): SceneBatchItem => {
    const item = record(value);
    exact(item, ITEM_FIELDS);
    if (
      typeof item.itemId !== "string" ||
      !WORD.test(item.itemId) ||
      typeof item.objectName !== "string" ||
      !WORD.test(item.objectName) ||
      !item.objectName.startsWith("UA14_") ||
      typeof item.mesh !== "string" ||
      !UE_SCENE_MESHES.includes(item.mesh) ||
      item.material !== UE_SCENE_MATERIAL ||
      ids.has(item.itemId) ||
      names.has(item.objectName.toLowerCase())
    )
      fail("invalid_or_duplicate_item");
    ids.add(item.itemId);
    names.add(item.objectName.toLowerCase());
    return {
      itemId: item.itemId,
      objectName: item.objectName,
      mesh: item.mesh,
      material: UE_SCENE_MATERIAL,
      transform: transform(item.transform),
    };
  });
  return freeze({
    operationId: p.operationId,
    targetMap: p.targetMap,
    expectedDiskState: "absent",
    items,
  });
}
const stringSchema = (extra: RecordValue = {}): RecordValue => ({ type: "string", ...extra });
const closedSchema = (properties: RecordValue, optional: string[] = []): RecordValue => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties).filter((key) => !optional.includes(key)),
});
function transformSchema(): RecordValue {
  const vector = (keys: string[], minimum: number, maximum: number) =>
    closedSchema(
      Object.fromEntries(keys.map((key) => [key, { type: "number", minimum, maximum }])),
    );
  return closedSchema({
    location: vector(["x", "y", "z"], -10000, 10000),
    rotation: vector(["pitch", "yaw", "roll"], -180, 180),
    scale: vector(["x", "y", "z"], 0.1, 10),
  });
}
export function scenePlanSchema(): RecordValue {
  return closedSchema({
    operationId: stringSchema({ pattern: GUID.source }),
    targetMap: stringSchema({ pattern: `^${UE_SCENE_ROOT}/L_[A-Za-z0-9_]{0,78}$` }),
    expectedDiskState: stringSchema({ const: "absent" }),
    items: {
      type: "array",
      minItems: 20,
      maxItems: 20,
      items: closedSchema({
        itemId: stringSchema({ pattern: WORD.source }),
        objectName: stringSchema({ pattern: "^UA14_[A-Za-z0-9_]{0,59}$" }),
        mesh: stringSchema({ enum: UE_SCENE_MESHES }),
        material: stringSchema({ const: UE_SCENE_MATERIAL }),
        transform: transformSchema(),
      }),
    },
  });
}
/** Model schemas exclude hostPermit. Transport schemas require a host-injected permit for each mutation. */
export function sceneInputSchema(
  tool: SceneTool,
  audience: "model" | "transport" = "transport",
): RecordValue {
  if (!UE_SCENE_TOOLS.includes(tool)) fail("unknown_tool");
  if (tool === UE_SCENE_TOOLS[0]) return closedSchema({});
  const properties: RecordValue = {
    protocolVersion: { type: "integer", const: 2 },
    contractVersion: stringSchema({ const: UE_SCENE_CONTRACT }),
    expectedProjectKey: stringSchema({ minLength: 1, maxLength: 4096 }),
    expectedInstanceId: stringSchema({ pattern: GUID.source }),
    expectedRootObjectId: stringSchema({ minLength: 1, maxLength: 4096 }),
    runId: stringSchema({ pattern: GUID.source }),
    plan: scenePlanSchema(),
  };
  if (tool === UE_SCENE_TOOLS[5] || tool === UE_SCENE_TOOLS[6])
    properties.queryToken = stringSchema({ pattern: GUID.source });
  if (audience === "transport" && tool !== UE_SCENE_TOOLS[4])
    properties.hostPermit = stringSchema({ pattern: GUID.source });
  return closedSchema(properties);
}
export function sceneResultSchema(): RecordValue {
  const properties: RecordValue = {
    state: stringSchema({ enum: STATES }),
    targetMap: stringSchema(),
    currentWorldMatches: { type: "boolean" },
    packageDirty: { type: "boolean" },
    saved: { type: "boolean" },
    diskExists: { type: "boolean" },
    diskHash: stringSchema({ pattern: "^(|[0-9a-f]{64})$" }),
    conflict: { type: "boolean" },
    cancelIsRollback: { type: "boolean", const: false },
    items: {
      type: "array",
      minItems: 20,
      maxItems: 20,
      items: closedSchema(
        {
          itemId: stringSchema(),
          objectName: stringSchema(),
          status: stringSchema({ enum: ["not_started", "applied", "unknown", "failed"] }),
          reason: stringSchema(),
          owned: { type: "boolean" },
          actorGuid: stringSchema(),
          objectPath: stringSchema(),
          mesh: stringSchema(),
          material: stringSchema(),
          transform: transformSchema(),
        },
        ["transform"],
      ),
    },
    queryToken: stringSchema({ pattern: GUID.source }),
    appliedCount: { type: "integer", minimum: 0, maximum: 20 },
    conflictReason: stringSchema(),
  };
  return closedSchema({
    schemaVersion: stringSchema({ const: "uagent.scene.result.v2" }),
    contractVersion: stringSchema({ const: UE_SCENE_CONTRACT }),
    projectKey: stringSchema(),
    instanceId: stringSchema({ pattern: GUID.source }),
    rootObjectId: stringSchema(),
    runId: stringSchema({ pattern: GUID.source }),
    operation: stringSchema({ enum: UE_SCENE_TOOLS.slice(1) }),
    plan: scenePlanSchema(),
    planHash: stringSchema({ pattern: HASH.source }),
    data: closedSchema(properties, ["queryToken"]),
  });
}
/** Call only after native verification of the owned editor/root lease and explicit exact-plan approval. This is frontend binding, never a write grant. */
export function createSceneSessionFromVerifiedHost(host: {
  projectKey: string;
  instanceId: string;
  rootObjectId: string;
  runId: string;
  approvedPlan: unknown;
}): SceneSession {
  if (
    typeof host.projectKey !== "string" ||
    !host.projectKey ||
    host.projectKey.length > 4096 ||
    !guid(host.instanceId) ||
    typeof host.rootObjectId !== "string" ||
    !host.rootObjectId ||
    host.rootObjectId.length > 4096 ||
    !guid(host.runId)
  )
    fail("verified_host_identity_required");
  const session = freeze({
    [SESSION]: true as const,
    projectKey: host.projectKey,
    instanceId: host.instanceId,
    rootObjectId: host.rootObjectId,
    runId: host.runId,
    plan: parseSceneBatchPlan(host.approvedPlan),
  });
  SESSIONS.add(session);
  return session;
}
function assertSession(session: SceneSession): void {
  if (!SESSIONS.has(session)) fail("unverified_session");
}
export function createSceneCall(
  session: SceneSession,
  tool: SceneOperation,
  queryToken?: string,
): { name: SceneOperation; arguments: RecordValue } {
  assertSession(session);
  if (
    !UE_SCENE_TOOLS.includes(tool) ||
    ([UE_SCENE_TOOLS[5], UE_SCENE_TOOLS[6]].includes(
      tool as "uagent.v2.scene.resume" | "uagent.v2.scene.save",
    )
      ? !guid(queryToken)
      : queryToken !== undefined)
  )
    fail("invalid_tool_or_query_precondition");
  return {
    name: tool,
    arguments: {
      protocolVersion: 2,
      contractVersion: UE_SCENE_CONTRACT,
      expectedProjectKey: session.projectKey,
      expectedInstanceId: session.instanceId,
      expectedRootObjectId: session.rootObjectId,
      runId: session.runId,
      plan: session.plan,
      ...(queryToken === undefined ? {} : { queryToken }),
    },
  };
}
// UE5.8 Core/Private/Math/UnrealMath.cpp, FRotator3d::Quaternion scalar formula.
function ueQuaternion(rotation: SceneTransform["rotation"]): number[] {
  const halfDegreesToRadians = Math.PI / 360;
  const sp = Math.sin(rotation.pitch * halfDegreesToRadians),
    cp = Math.cos(rotation.pitch * halfDegreesToRadians),
    sy = Math.sin(rotation.yaw * halfDegreesToRadians),
    cy = Math.cos(rotation.yaw * halfDegreesToRadians),
    sr = Math.sin(rotation.roll * halfDegreesToRadians),
    cr = Math.cos(rotation.roll * halfDegreesToRadians);
  const q = [
    cr * sp * sy - sr * cp * cy,
    -cr * sp * cy - sr * cp * sy,
    cr * cp * sy - sr * sp * cy,
    cr * cp * cy + sr * sp * sy,
  ];
  const norm = Math.sqrt(q.reduce((sum, value) => sum + value * value, 0));
  return q.map((value) => value / norm);
}
function sameOrientation(
  actual: SceneTransform["rotation"],
  expected: SceneTransform["rotation"],
): boolean {
  const a = ueQuaternion(actual),
    b = ueQuaternion(expected);
  const sign = a.reduce((dot, value, i) => dot + value * b[i]!, 0) < 0 ? -1 : 1;
  let differenceSquared = 0,
    sumSquared = 0;
  for (let i = 0; i < 4; i++) {
    const aligned = sign * b[i]!,
      difference = a[i]! - aligned,
      sum = a[i]! + aligned;
    differenceSquared += difference * difference;
    sumSquared += sum * sum;
  }
  // q and -q describe one pose. For aligned unit quaternions this is the shortest
  // physical orientation angle: 4*atan2(|a-b|, |a+b|). Tolerance is 0.001 degrees
  // for the whole orientation, not 0.001 per Euler axis; approval stays value-exact.
  const angleDegrees =
    (4 * Math.atan2(Math.sqrt(differenceSquared), Math.sqrt(sumSquared)) * 180) / Math.PI;
  return angleDegrees <= 0.001;
}
function sameTransform(actual: SceneTransform, expected: SceneTransform): boolean {
  for (const key of ["location", "scale"] as const) {
    for (const axis of ["x", "y", "z"] as const) {
      if (Math.abs(actual[key][axis] - expected[key][axis]) > 0.001) return false;
    }
  }
  return sameOrientation(actual.rotation, expected.rotation);
}
/** Pure display comparison using the same validated geometry and tolerances as scene receipts.
 * This performs no owner verification and grants no execution authority. */
export function sceneTransformsMatch(actual: unknown, expected: SceneTransform): boolean {
  try {
    return sameTransform(transform(actual), transform(expected));
  } catch {
    return false;
  }
}
/** Verifies every identity, plan value and observed actor; a plausible count/hash alone is insufficient. */
export function parseSceneResult(
  session: SceneSession,
  tool: SceneOperation,
  value: unknown,
): SceneBatchData {
  assertSession(session);
  const r = record(value);
  exact(r, [
    "schemaVersion",
    "contractVersion",
    "projectKey",
    "instanceId",
    "rootObjectId",
    "runId",
    "operation",
    "plan",
    "planHash",
    "data",
  ]);
  if (
    !UE_SCENE_TOOLS.slice(1).includes(tool) ||
    r.schemaVersion !== "uagent.scene.result.v2" ||
    r.contractVersion !== UE_SCENE_CONTRACT ||
    r.projectKey !== session.projectKey ||
    r.instanceId !== session.instanceId ||
    r.rootObjectId !== session.rootObjectId ||
    r.runId !== session.runId ||
    r.operation !== tool ||
    stable(parseSceneBatchPlan(r.plan)) !== stable(session.plan) ||
    typeof r.planHash !== "string" ||
    !HASH.test(r.planHash)
  )
    fail("result_binding_mismatch");
  const data = record(r.data);
  exact(data, DATA_FIELDS, ["queryToken"]);
  if (
    !STATES.includes(data.state as SceneState) ||
    data.targetMap !== session.plan.targetMap ||
    ["currentWorldMatches", "packageDirty", "saved", "diskExists", "conflict"].some(
      (key) => typeof data[key] !== "boolean",
    ) ||
    data.cancelIsRollback !== false ||
    typeof data.conflictReason !== "string" ||
    (!data.conflict && data.conflictReason !== "") ||
    typeof data.diskHash !== "string" ||
    (data.diskExists ? !HASH.test(data.diskHash) : data.diskHash !== "") ||
    (Object.hasOwn(data, "queryToken") && !guid(data.queryToken)) ||
    !Array.isArray(data.items) ||
    data.items.length !== 20
  )
    fail("invalid_result_data");
  const actorGuids = new Set<string>(),
    actorPaths = new Set<string>();
  const mapName = session.plan.targetMap.slice(session.plan.targetMap.lastIndexOf("/") + 1);
  data.items.forEach((value, index) => {
    const item = record(value),
      expected = session.plan.items[index]!;
    exact(item, RECEIPT_FIELDS, ["transform"]);
    if (
      item.itemId !== expected.itemId ||
      item.objectName !== expected.objectName ||
      !["not_started", "applied", "unknown", "failed"].includes(String(item.status)) ||
      typeof item.reason !== "string" ||
      typeof item.owned !== "boolean" ||
      ["actorGuid", "objectPath", "mesh", "material"].some((key) => typeof item[key] !== "string")
    )
      fail("invalid_item_receipt");
    if (item.status === "applied") {
      const path = `${session.plan.targetMap}.${mapName}:PersistentLevel.${expected.objectName}`;
      if (
        !item.owned ||
        !guid(item.actorGuid) ||
        item.objectPath !== path ||
        item.mesh !== expected.mesh ||
        item.material !== expected.material ||
        !sameTransform(transform(item.transform), expected.transform) ||
        actorGuids.has(item.actorGuid) ||
        actorPaths.has(path)
      )
        fail("applied_item_not_verified");
      actorGuids.add(item.actorGuid);
      actorPaths.add(path);
    } else if (
      item.owned ||
      item.actorGuid !== "" ||
      item.objectPath !== "" ||
      Object.hasOwn(item, "transform") ||
      (item.mesh !== "" && item.mesh !== expected.mesh) ||
      (item.material !== "" && item.material !== expected.material)
    )
      fail("unapplied_item_claims_observation");
  });
  const items = data.items as SceneItemReceipt[],
    allApplied = items.every((item) => item.status === "applied");
  if (data.appliedCount !== items.filter((item) => item.status === "applied").length)
    fail("incorrect_applied_count");
  if (
    (data.state === "completed" || data.state === "saved") &&
    (!allApplied || !data.currentWorldMatches || data.conflict)
  )
    fail("completion_not_verified");
  if (
    (data.state === "not_started" || data.state === "prepared") &&
    items.some((item) => item.status !== "not_started")
  )
    fail("invalid_preparation_state");
  if (
    data.state === "prepared" &&
    (!data.currentWorldMatches || data.saved || data.diskExists || data.conflict)
  )
    fail("invalid_preparation_state");
  if (
    (data.saved && (data.state !== "saved" || !data.diskExists || data.packageDirty)) ||
    (data.state === "saved" && !data.saved) ||
    (data.state === "conflicted" && !data.conflict) ||
    (data.conflict && data.state !== "conflicted" && data.state !== "failed")
  )
    fail("inconsistent_result_state");
  if (tool === UE_SCENE_TOOLS[6] && data.state !== "saved") fail("save_not_verified");
  return freeze(structuredClone(data)) as unknown as SceneBatchData;
}
/** A query token is only a freshness precondition; native still binds it to its owned-editor response. */
export function sceneRemainingItemIds(data: SceneBatchData): string[] {
  if (
    !guid(data.queryToken) ||
    !["cancelled", "paused_for_test_cancel"].includes(data.state) ||
    !data.currentWorldMatches ||
    data.conflict ||
    data.saved ||
    data.diskExists ||
    data.items.length !== 20 ||
    data.items.some((item) => item.status !== "applied" && item.status !== "not_started")
  )
    fail("query_not_resumable");
  const remaining = data.items
    .filter((item) => item.status === "not_started")
    .map((item) => item.itemId);
  if (!remaining.length) fail("query_not_resumable");
  return remaining;
}

export interface SceneToolDescriptor {
  name: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}
function schemaStable(value: unknown, key = ""): string {
  if (Array.isArray(value)) {
    const values = value.map((child) => schemaStable(child));
    return `[${(key === "required" || key === "enum" ? values.sort() : values).join(",")}]`;
  }
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, child]) => `${JSON.stringify(name)}:${schemaStable(child, name)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
export function sceneCapabilitiesSchema(): RecordValue {
  return closedSchema({
    schemaVersion: stringSchema({ const: "uagent.scene.capabilities.v2" }),
    protocolVersion: { type: "integer", const: 2 },
    contractVersion: stringSchema({ const: UE_SCENE_CONTRACT }),
    projectKey: stringSchema({ minLength: 1 }),
    instanceId: stringSchema({ pattern: GUID.source }),
    rootObjectId: stringSchema({ minLength: 1 }),
    runId: stringSchema({ pattern: GUID.source }),
    available: { type: "boolean" },
    productionSupported: { type: "boolean", const: false },
    scopeMode: stringSchema({ const: "isolated_lab_current_run_only" }),
    writeRoot: stringSchema({ const: UE_SCENE_ROOT }),
    approvedPlans: { type: "array", minItems: 0, maxItems: 2, items: scenePlanSchema() },
    tools: {
      type: "array",
      minItems: 6,
      maxItems: 6,
      items: closedSchema({
        name: stringSchema({ enum: UE_SCENE_TOOLS.slice(1) }),
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        effect: stringSchema({ minLength: 1 }),
      }),
    },
  });
}
/** Discovery is untrusted. Native verified identities/approval bind the selected exact plan;
 * descriptors must match the full nested transport schemas before frontend calls are offered. */
export function negotiateSceneBatchV2(
  value: unknown,
  catalog: readonly SceneToolDescriptor[],
  host: {
    projectKey: string;
    instanceId: string;
    rootObjectId: string;
    runId: string;
    approvedPlan: unknown;
  },
): SceneSession {
  const m = record(value);
  exact(m, [
    "schemaVersion",
    "protocolVersion",
    "contractVersion",
    "projectKey",
    "instanceId",
    "rootObjectId",
    "runId",
    "available",
    "productionSupported",
    "scopeMode",
    "writeRoot",
    "approvedPlans",
    "tools",
  ]);
  const approvedPlan = parseSceneBatchPlan(host.approvedPlan);
  if (
    m.schemaVersion !== "uagent.scene.capabilities.v2" ||
    m.protocolVersion !== 2 ||
    m.contractVersion !== UE_SCENE_CONTRACT ||
    m.projectKey !== host.projectKey ||
    m.instanceId !== host.instanceId ||
    m.rootObjectId !== host.rootObjectId ||
    m.runId !== host.runId ||
    m.available !== true ||
    m.productionSupported !== false ||
    m.scopeMode !== "isolated_lab_current_run_only" ||
    m.writeRoot !== UE_SCENE_ROOT ||
    !Array.isArray(m.approvedPlans) ||
    m.approvedPlans.length !== 2 ||
    !Array.isArray(m.tools) ||
    m.tools.length !== 6
  )
    fail("manifest_scope_or_contract_mismatch");
  const plans = m.approvedPlans.map(parseSceneBatchPlan);
  if (
    new Set(plans.map((p) => p.targetMap.toLowerCase())).size !== 2 ||
    new Set(plans.map((p) => p.operationId)).size !== 2 ||
    plans.filter((p) => stable(p) === stable(approvedPlan)).length !== 1
  )
    fail("manifest_approved_plan_mismatch");
  const descriptors = new Map(catalog.map((entry) => [entry.name, entry]));
  if (descriptors.size !== catalog.length) fail("ambiguous_catalog");
  const declared = m.tools.map((value) => {
    const descriptor = record(value);
    exact(descriptor, ["name", "inputSchema", "outputSchema", "effect"]);
    if (
      typeof descriptor.name !== "string" ||
      typeof descriptor.effect !== "string" ||
      !descriptor.effect
    )
      fail("invalid_tool_descriptor");
    return descriptor;
  });
  if (new Set(declared.map((entry) => entry.name)).size !== 6) fail("ambiguous_catalog");
  for (const tool of UE_SCENE_TOOLS) {
    const descriptor = descriptors.get(tool);
    const output = tool === UE_SCENE_TOOLS[0] ? sceneCapabilitiesSchema() : sceneResultSchema();
    if (
      !descriptor ||
      schemaStable(descriptor.inputSchema) !== schemaStable(sceneInputSchema(tool)) ||
      schemaStable(descriptor.outputSchema) !== schemaStable(output)
    )
      fail("tool_schema_mismatch");
    if (tool !== UE_SCENE_TOOLS[0]) {
      const declarations = declared.filter((entry) => entry.name === tool);
      if (
        declarations.length !== 1 ||
        schemaStable(declarations[0]!.inputSchema) !== schemaStable(descriptor.inputSchema) ||
        schemaStable(declarations[0]!.outputSchema) !== schemaStable(descriptor.outputSchema)
      )
        fail("tool_schema_mismatch");
    }
  }
  return createSceneSessionFromVerifiedHost({ ...host, approvedPlan });
}
