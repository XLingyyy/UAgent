/** Fixed create-only pickup slice. Public identity/preview hashes never confer write authority. */
export const UE_PICKUP_CONTRACT = "2.1.0-pickup-create-only";
export const UE_PICKUP_ROOT = "/Game/UAgentBuildLab/Pickup_T13";
export const UE_PICKUP_PARENT = "/Script/UAgentPickupRuntimeV2.UAgentPickupActorV2";
export const UE_PICKUP_TOOLS = [
  "uagent.v2.pickup.capabilities",
  "uagent.v2.pickup.prepare",
  "uagent.v2.pickup.preview",
  "uagent.v2.pickup.apply",
  "uagent.v2.pickup.query",
] as const;
export type PickupTool = (typeof UE_PICKUP_TOOLS)[number];
type ObjectValue = Record<string, unknown>;
export interface PickupTemplatePlan {
  operationId: string;
  targetPackage: string;
  expectedDiskState: "absent";
  templateId: "actor.pickup.native.v1";
  parentClass: typeof UE_PICKUP_PARENT;
  itemId: string;
  promptText: string;
  interactionRadiusCm: number;
  interactionKey: "E" | "F";
}
const PLAN_FIELDS = [
  "operationId",
  "targetPackage",
  "expectedDiskState",
  "templateId",
  "parentClass",
  "itemId",
  "promptText",
  "interactionRadiusCm",
  "interactionKey",
];
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SESSION = Symbol("verified-pickup-session");
export interface PickupSession {
  readonly [SESSION]: true;
  readonly projectKey: string;
  readonly instanceId: string;
  readonly rootObjectId: string;
  readonly plan: PickupTemplatePlan;
}
function fail(reason: string): never {
  throw new Error(`pickup_v2_${reason}`);
}
function obj(v: unknown): ObjectValue {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail("object_required");
  return v as ObjectValue;
}
function exact(v: ObjectValue, keys: readonly string[]): void {
  if (Object.keys(v).length !== keys.length || Object.keys(v).some((k) => !keys.includes(k)))
    fail("unexpected_fields");
}
export function parsePickupTemplatePlan(value: unknown): PickupTemplatePlan {
  const p = obj(value);
  exact(p, PLAN_FIELDS);
  if (
    typeof p.operationId !== "string" ||
    !GUID.test(p.operationId) ||
    typeof p.targetPackage !== "string" ||
    !p.targetPackage.startsWith(`${UE_PICKUP_ROOT}/`) ||
    !/^BP_[A-Za-z0-9_]{0,77}$/.test(p.targetPackage.slice(UE_PICKUP_ROOT.length + 1)) ||
    p.expectedDiskState !== "absent" ||
    p.templateId !== "actor.pickup.native.v1" ||
    p.parentClass !== UE_PICKUP_PARENT ||
    typeof p.itemId !== "string" ||
    !/^[A-Za-z0-9_]{1,64}$/.test(p.itemId) ||
    typeof p.promptText !== "string" ||
    p.promptText.length < 1 ||
    p.promptText.length > 128 ||
    [...p.promptText].some((character) => {
      const code = character.codePointAt(0)!;
      return code < 32 || (code >= 127 && code <= 159);
    }) ||
    !Number.isInteger(p.interactionRadiusCm) ||
    Number(p.interactionRadiusCm) < 50 ||
    Number(p.interactionRadiusCm) > 1000 ||
    (p.interactionKey !== "E" && p.interactionKey !== "F")
  )
    fail("invalid_fixed_plan");
  return Object.freeze({ ...p }) as unknown as PickupTemplatePlan;
}
const kind = (type: string): ObjectValue => ({ type });
const str = (maxLength = 4096, constant?: string): ObjectValue => ({
  type: "string",
  minLength: 1,
  maxLength,
  ...(constant ? { const: constant } : {}),
});
function planSchema(): ObjectValue {
  const properties: ObjectValue = Object.fromEntries(PLAN_FIELDS.map((k) => [k, str()]));
  Object.assign(properties, {
    operationId: str(36),
    targetPackage: str(1024),
    expectedDiskState: str(6, "absent"),
    templateId: str(64, "actor.pickup.native.v1"),
    parentClass: str(128, UE_PICKUP_PARENT),
    itemId: str(64),
    promptText: str(128),
    interactionRadiusCm: { type: "integer", minimum: 50, maximum: 1000 },
    interactionKey: { ...str(1), enum: ["E", "F"] },
  });
  return { type: "object", additionalProperties: false, properties, required: PLAN_FIELDS };
}
export function pickupInputSchema(tool: PickupTool): ObjectValue {
  const id = UE_PICKUP_TOOLS.indexOf(tool),
    properties: ObjectValue = {},
    required: string[] = [];
  if (id > 0) {
    Object.assign(properties, {
      protocolVersion: { type: "integer", const: 2 },
      contractVersion: str(64, UE_PICKUP_CONTRACT),
      expectedProjectKey: str(),
      expectedInstanceId: str(),
      expectedRootObjectId: str(),
      plan: planSchema(),
    });
    required.push(...Object.keys(properties));
    if (id < 4) {
      properties.hostPermit = str(36);
      required.push("hostPermit");
    }
    if (id === 3) {
      properties.previewToken = str(36);
      required.push("previewToken");
    }
  }
  return { type: "object", additionalProperties: false, properties, required };
}
function outputSchema(discovery: boolean): ObjectValue {
  const properties: ObjectValue = Object.fromEntries(
    ["schemaVersion", "contractVersion", "projectKey", "instanceId", "rootObjectId"].map((k) => [
      k,
      kind("string"),
    ]),
  );
  if (discovery) {
    for (const k of [
      "scopeMode",
      "writeRoot",
      "allowedMap",
      "allowedTarget",
      "parentClass",
      "meshDependency",
      "fontDependency",
      "inputDependency",
      "uiDependency",
      "persistence",
    ])
      properties[k] = kind("string");
    Object.assign(properties, {
      protocolVersion: kind("integer"),
      available: kind("boolean"),
      productionSupported: kind("boolean"),
      tools: kind("array"),
    });
  } else
    Object.assign(properties, {
      plan: planSchema(),
      operation: kind("string"),
      planHash: kind("string"),
      data: kind("object"),
    });
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  };
}
function stable(v: unknown, key = ""): string {
  if (Array.isArray(v)) {
    const a = v.map((x) => stable(x));
    return `[${(key === "required" ? a.sort() : a).join(",")}]`;
  }
  if (v && typeof v === "object")
    return `{${Object.entries(v)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, x]) => `${JSON.stringify(k)}:${stable(x, k)}`)
      .join(",")}}`;
  return JSON.stringify(v) ?? "undefined";
}
export function assertPickupSchema(value: unknown, schemaValue: unknown): void {
  const s = obj(schemaValue);
  const valid =
    s.type === "object"
      ? !!value && typeof value === "object" && !Array.isArray(value)
      : s.type === "array"
        ? Array.isArray(value)
        : s.type === "integer"
          ? Number.isInteger(value)
          : typeof value === s.type;
  if (
    !valid ||
    ("const" in s && value !== s.const) ||
    (Array.isArray(s.enum) && !s.enum.includes(value))
  )
    fail("result_schema_mismatch");
  if (
    typeof value === "string" &&
    ((typeof s.minLength === "number" && value.length < s.minLength) ||
      (typeof s.maxLength === "number" && value.length > s.maxLength))
  )
    fail("result_schema_mismatch");
  if (
    typeof value === "number" &&
    ((typeof s.minimum === "number" && value < s.minimum) ||
      (typeof s.maximum === "number" && value > s.maximum))
  )
    fail("result_schema_mismatch");
  if (s.type === "object" && s.properties) {
    const record = obj(value),
      fields = obj(s.properties);
    if (
      (s.required as string[]).some((k) => !(k in record)) ||
      (s.additionalProperties === false && Object.keys(record).some((k) => !(k in fields)))
    )
      fail("result_schema_mismatch");
    for (const [k, v] of Object.entries(fields)) if (k in record) assertPickupSchema(record[k], v);
  }
}
/** Host identity/exact plan is supplied after owned endpoint/root verification and approval, never from model text. */
export function negotiatePickupTemplateV2(
  manifestValue: unknown,
  catalog: readonly { name: string; inputSchema?: unknown; outputSchema?: unknown }[],
  host: { projectKey: string; rootObjectId: string; approvedPlan: PickupTemplatePlan },
): PickupSession {
  assertPickupSchema(manifestValue, outputSchema(true));
  const m = obj(manifestValue),
    plan = parsePickupTemplatePlan(host.approvedPlan);
  if (
    m.schemaVersion !== "uagent.pickup.capabilities.v2" ||
    m.protocolVersion !== 2 ||
    m.contractVersion !== UE_PICKUP_CONTRACT ||
    m.available !== true ||
    m.productionSupported !== false ||
    m.scopeMode !== "isolated_lab_only" ||
    m.projectKey !== host.projectKey ||
    m.rootObjectId !== host.rootObjectId ||
    !host.rootObjectId ||
    m.allowedTarget !== plan.targetPackage ||
    m.writeRoot !== UE_PICKUP_ROOT ||
    m.allowedMap !== `${UE_PICKUP_ROOT}/L_PickupValidation` ||
    m.parentClass !== UE_PICKUP_PARENT ||
    typeof m.instanceId !== "string" ||
    !GUID.test(m.instanceId)
  )
    fail("scope_or_contract_mismatch");
  const descriptors = new Map(catalog.map((e) => [e.name, e]));
  if (descriptors.size !== catalog.length || !Array.isArray(m.tools) || m.tools.length !== 4)
    fail("ambiguous_catalog");
  for (const tool of UE_PICKUP_TOOLS) {
    const entry = descriptors.get(tool);
    if (
      !entry ||
      stable(entry.inputSchema) !== stable(pickupInputSchema(tool)) ||
      stable(entry.outputSchema) !== stable(outputSchema(tool === UE_PICKUP_TOOLS[0]))
    )
      fail("schema_mismatch");
    if (tool !== UE_PICKUP_TOOLS[0]) {
      const capabilities = m.tools.map(obj).filter((e) => e.name === tool);
      if (
        capabilities.length !== 1 ||
        stable(capabilities[0]!.inputSchema) !== stable(entry.inputSchema) ||
        stable(capabilities[0]!.outputSchema) !== stable(entry.outputSchema)
      )
        fail("schema_mismatch");
    }
  }
  return Object.freeze({
    [SESSION]: true as const,
    projectKey: host.projectKey,
    rootObjectId: host.rootObjectId,
    instanceId: m.instanceId,
    plan,
  });
}
/** No hostPermit is accepted here. The native host validates/consumes approval and injects it before transport. */
export function createPickupCall(
  session: PickupSession,
  tool: Exclude<PickupTool, "uagent.v2.pickup.capabilities">,
  previewToken?: string,
): { name: PickupTool; arguments: ObjectValue } {
  if (session[SESSION] !== true || !UE_PICKUP_TOOLS.includes(tool)) fail("unverified_session");
  if (
    (tool === UE_PICKUP_TOOLS[3] && (!previewToken || !GUID.test(previewToken))) ||
    (tool !== UE_PICKUP_TOOLS[3] && previewToken !== undefined)
  )
    fail("invalid_preview_precondition");
  return {
    name: tool,
    arguments: {
      protocolVersion: 2,
      contractVersion: UE_PICKUP_CONTRACT,
      expectedProjectKey: session.projectKey,
      expectedInstanceId: session.instanceId,
      expectedRootObjectId: session.rootObjectId,
      plan: session.plan,
      ...(previewToken ? { previewToken } : {}),
    },
  };
}
export function parsePickupResult(
  session: PickupSession,
  tool: PickupTool,
  value: unknown,
): ObjectValue {
  if (session[SESSION] !== true) fail("unverified_session");
  assertPickupSchema(value, outputSchema(false));
  const r = obj(value),
    data = obj(r.data);
  if (
    r.schemaVersion !== "uagent.pickup.result.v2" ||
    r.contractVersion !== UE_PICKUP_CONTRACT ||
    r.operation !== tool ||
    r.projectKey !== session.projectKey ||
    r.instanceId !== session.instanceId ||
    r.rootObjectId !== session.rootObjectId ||
    stable(parsePickupTemplatePlan(r.plan)) !== stable(session.plan) ||
    typeof r.planHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(r.planHash)
  )
    fail("result_binding_mismatch");
  if (
    tool === UE_PICKUP_TOOLS[1] &&
    (data.prepared !== true ||
      data.effect !== "authorized_engine_dependency_loading_and_native_cdo_preparation")
  )
    fail("preparation_not_observed");
  if (
    tool === UE_PICKUP_TOOLS[2] &&
    (typeof data.previewToken !== "string" ||
      !GUID.test(data.previewToken) ||
      typeof data.copyObjectPath !== "string" ||
      !data.copyObjectPath.startsWith("/Temp/UAgentPickupT13/") ||
      data.copySaved !== false ||
      data.compileStatus !== "up_to_date" ||
      !Array.isArray(data.semanticChanges) ||
      data.semanticChanges.length > 16)
  )
    fail("invalid_copy_preview");
  if (tool === UE_PICKUP_TOOLS[3] || tool === UE_PICKUP_TOOLS[4]) {
    if (
      !Array.isArray(data.effects) ||
      data.effects.length !== 1 ||
      obj(data.effects[0]).targetPackage !== session.plan.targetPackage ||
      !["created", "not_created", "unknown"].includes(String(obj(data.effects[0]).diskEffect)) ||
      typeof obj(data.effects[0]).editorEffect !== "string" ||
      ![
        "none",
        "package_loaded",
        "blueprint_not_ready",
        "blueprint_loaded_uncompiled",
        "dirty_loaded",
        "compile_failed",
        "compiled_loaded",
      ].includes(String(obj(data.effects[0]).editorEffect)) ||
      data.queryLoadsAssets !== false ||
      typeof data.diskExists !== "boolean" ||
      typeof data.state !== "string"
    )
      fail("invalid_effect_receipt");
    if (
      data.state === "applied" &&
      (data.diskExists !== true ||
        typeof data.observedDiskHash !== "string" ||
        !/^[0-9a-f]{64}$/.test(data.observedDiskHash) ||
        obj(data.effects[0]).diskEffect !== "created")
    )
      fail("applied_effect_not_observed");
    if (
      tool === UE_PICKUP_TOOLS[3] &&
      (data.state !== "applied" ||
        obj(data.effects[0]).diskEffect !== "created" ||
        obj(data.effects[0]).editorEffect !== "compiled_loaded" ||
        (data.idempotentReplayNoWrite !== true &&
          (data.compileStatus !== "up_to_date" ||
            stable(data.savedPackages) !== stable([session.plan.targetPackage]))))
    )
      fail("apply_not_verified");
  }
  return data;
}
