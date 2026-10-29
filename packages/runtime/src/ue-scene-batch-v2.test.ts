import { describe, expect, it } from "vitest";
import {
  UE_SCENE_CONTRACT,
  UE_SCENE_ROOT,
  UE_SCENE_TOOLS,
  UE_SCENE_MESHES,
  UE_SCENE_MATERIAL,
  parseSceneBatchPlan,
  createSceneSessionFromVerifiedHost,
  createSceneCall,
  parseSceneResult,
  sceneRemainingItemIds,
  sceneInputSchema,
  sceneResultSchema,
  sceneCapabilitiesSchema,
  negotiateSceneBatchV2,
  type SceneBatchData,
  type SceneBatchPlan,
  type SceneOperation,
  type SceneSession,
} from "./ue-scene-batch-v2.js";
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
function plan(): SceneBatchPlan {
  return {
    operationId: id(1),
    targetMap: `${UE_SCENE_ROOT}/L_CurrentRun`,
    expectedDiskState: "absent",
    items: Array.from({ length: 20 }, (_, n) => ({
      itemId: `item_${n}`,
      objectName: `UA14_Object_${n}`,
      mesh: UE_SCENE_MESHES[n % 3]!,
      material: UE_SCENE_MATERIAL,
      transform: {
        location: { x: n * 100, y: 0, z: 0 },
        rotation: { pitch: 0, yaw: 0, roll: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    })),
  };
}
function session() {
  return createSceneSessionFromVerifiedHost({
    projectKey: "lab-project",
    instanceId: id(2),
    rootObjectId: "volume:file",
    runId: id(3),
    approvedPlan: plan(),
  });
}
function receipt(operation: SceneOperation = UE_SCENE_TOOLS[4], applied = 7) {
  const p = plan();
  const data: SceneBatchData = {
    state: applied === 20 ? "completed" : "cancelled",
    targetMap: p.targetMap,
    currentWorldMatches: true,
    packageDirty: true,
    saved: false,
    diskExists: false,
    diskHash: "",
    conflict: false,
    conflictReason: "",
    cancelIsRollback: false,
    appliedCount: applied,
    queryToken: id(4),
    items: p.items.map((item, n) =>
      n < applied
        ? {
            itemId: item.itemId,
            objectName: item.objectName,
            status: "applied",
            reason: "",
            owned: true,
            actorGuid: id(100 + n),
            objectPath: `${p.targetMap}.L_CurrentRun:PersistentLevel.${item.objectName}`,
            mesh: item.mesh,
            material: item.material,
            transform: structuredClone(item.transform),
          }
        : {
            itemId: item.itemId,
            objectName: item.objectName,
            status: "not_started",
            reason: "",
            owned: false,
            actorGuid: "",
            objectPath: "",
            mesh: "",
            material: "",
          },
    ),
  };
  return {
    schemaVersion: "uagent.scene.result.v2",
    contractVersion: UE_SCENE_CONTRACT,
    projectKey: "lab-project",
    instanceId: id(2),
    rootObjectId: "volume:file",
    runId: id(3),
    operation,
    plan: p,
    planHash: "a".repeat(64),
    data,
  };
}
const parse = (value: ReturnType<typeof receipt>) =>
  parseSceneResult(session(), value.operation, value);
describe("T14 closed exact-20 scene plan", () => {
  it("freezes independent nested copies of the full approved plan", () => {
    const p = plan(),
      parsed = parseSceneBatchPlan(p);
    p.items[0]!.transform.location.x = 999;
    expect(parsed.items[0]!.transform.location.x).toBe(0);
    expect(Object.isFrozen(parsed.items[0]!.transform.location)).toBe(true);
    expect(Object.isFrozen(parsed.items)).toBe(true);
  });
  it.each([0, 19, 21])("rejects %s items", (count) => {
    const p = plan();
    p.items = Array.from({ length: count }, (_, i) => p.items[i % 20]!);
    expect(() => parseSceneBatchPlan(p)).toThrow();
  });
  it.each([
    "/Game/User/L_Map",
    `${UE_SCENE_ROOT}Other/L_Map`,
    `${UE_SCENE_ROOT}/Sub/L_Map`,
    `${UE_SCENE_ROOT}/../L_Map`,
    `${UE_SCENE_ROOT}/L_Map.L_Map`,
    `${UE_SCENE_ROOT}/L_${"a".repeat(79)}`,
  ])("rejects map escape %s", (targetMap) => {
    expect(() => parseSceneBatchPlan({ ...plan(), targetMap })).toThrow();
  });
  it("rejects duplicate item IDs and case-insensitive duplicate object names", () => {
    for (const field of ["itemId", "objectName"] as const) {
      const p = plan();
      p.items[1]![field] = p.items[0]![field];
      if (field === "objectName") p.items[1]!.objectName = "UA14_object_0";
      expect(() => parseSceneBatchPlan(p)).toThrow();
    }
  });
  it.each([NaN, Infinity, -Infinity, 10000.001, -10000.001, "0", null])(
    "rejects nonfinite/out-of-bounds coordinates %#",
    (value) => {
      const p = plan();
      Object.assign(p.items[0]!.transform.location, { x: value });
      expect(() => parseSceneBatchPlan(p)).toThrow();
    },
  );
  it("rejects extension fields at every plan/transform level and fixed-resource escapes", () => {
    const changes: ((p: SceneBatchPlan) => void)[] = [
      (p) => Object.assign(p, { overwrite: true }),
      (p) => Object.assign(p.items[0]!, { testPauseAfter: 7 }),
      (p) => Object.assign(p.items[0]!.transform, { pivot: {} }),
      (p) => Object.assign(p.items[0]!.transform.location, { w: 0 }),
      (p) => {
        p.items[0]!.mesh = "/Game/User/Mesh.Mesh";
      },
      (p) => Object.assign(p.items[0]!, { material: "/Game/User/Mat.Mat" }),
      (p) => {
        p.items[0]!.objectName = "user_object";
      },
      (p) => {
        p.items[0]!.transform.rotation.yaw = 180.001;
      },
      (p) => {
        p.items[0]!.transform.scale.x = 0;
      },
      (p) => {
        p.operationId = id(1).toUpperCase().replace("4000", "4ABC");
      },
      (p) => Object.assign(p, { expectedDiskState: "overwrite" }),
    ];
    for (const change of changes) {
      const p = plan();
      change(p);
      expect(() => parseSceneBatchPlan(p)).toThrow();
    }
  });
});
describe("T14 frontend binding and transport schemas", () => {
  it("keeps model calls permit-free; resume and save require lowercase GUID query tokens", () => {
    const s = session();
    for (const tool of UE_SCENE_TOOLS.slice(1) as SceneOperation[]) {
      const token = tool === UE_SCENE_TOOLS[5] || tool === UE_SCENE_TOOLS[6] ? id(4) : undefined;
      expect(createSceneCall(s, tool, token).arguments).not.toHaveProperty("hostPermit");
      if (token) {
        for (const bad of [undefined, "", "00000000-0000-0000-0000-000000000000", "NOT-A-GUID"])
          expect(() => createSceneCall(s, tool, bad)).toThrow();
      }
    }
    expect(() => createSceneCall(s, UE_SCENE_TOOLS[4], id(4))).toThrow();
    expect(() => createSceneCall({ ...s } as SceneSession, UE_SCENE_TOOLS[4])).toThrow(
      "unverified_session",
    );
  });
  it("publishes nested closed schemas with exactly 20 items and no generic result data", () => {
    const input = sceneInputSchema(UE_SCENE_TOOLS[5]),
      model = sceneInputSchema(UE_SCENE_TOOLS[5], "model");
    expect(input.additionalProperties).toBe(false);
    expect(input.required).toContain("hostPermit");
    expect(input.required).toContain("queryToken");
    expect(model.required).not.toContain("hostPermit");
    expect(sceneInputSchema(UE_SCENE_TOOLS[4]).required).not.toContain("hostPermit");
    const output = sceneResultSchema() as {
      properties: {
        data: {
          additionalProperties: boolean;
          properties: {
            items: { minItems: number; maxItems: number; items: { additionalProperties: boolean } };
          };
        };
      };
    };
    expect(output.properties.data.additionalProperties).toBe(false);
    expect(output.properties.data.properties.items.minItems).toBe(20);
    expect(output.properties.data.properties.items.maxItems).toBe(20);
    expect(output.properties.data.properties.items.items.additionalProperties).toBe(false);
  });
});
describe("T14 per-object owned-editor receipts", () => {
  it("verifies seven retained objects and reports only the remaining thirteen", () => {
    const data = parse(receipt());
    expect(sceneRemainingItemIds(data)).toEqual(
      plan()
        .items.slice(7)
        .map((item) => item.itemId),
    );
    expect(data.cancelIsRollback).toBe(false);
    expect(Object.isFrozen(data.items[0]!.transform)).toBe(true);
  });
  it("binds every identity, operation and full plan value", () => {
    const changes: ((r: ReturnType<typeof receipt>) => void)[] = [
      (r) => {
        r.projectKey = "other";
      },
      (r) => {
        r.instanceId = id(5);
      },
      (r) => {
        r.rootObjectId = "other";
      },
      (r) => {
        r.runId = id(5);
      },
      (r) => {
        r.contractVersion = "2.1";
      },
      (r) => {
        r.plan.items[0]!.transform.location.x = 1;
      },
      (r) => Object.assign(r, { hostPermit: id(5) }),
      (r) => Object.assign(r.data, { arbitrary: true }),
      (r) => {
        r.planHash = "a".repeat(63);
      },
    ];
    for (const change of changes) {
      const r = receipt();
      change(r);
      expect(() => parse(r)).toThrow();
    }
    expect(() => parseSceneResult(session(), UE_SCENE_TOOLS[2], receipt())).toThrow();
  });
  it("rejects count-only, reordered and substituted actor claims", () => {
    const changes: ((r: ReturnType<typeof receipt>) => void)[] = [
      (r) => {
        r.data.appliedCount = 20;
      },
      (r) => {
        r.data.items.pop();
      },
      (r) => {
        r.data.items.reverse();
      },
      (r) => {
        r.data.items[0]!.actorGuid = r.data.items[1]!.actorGuid;
      },
      (r) => {
        r.data.items[0]!.objectPath += "_Other";
      },
      (r) => {
        r.data.items[0]!.actorGuid = "00000000-0000-0000-0000-000000000000";
      },
      (r) => {
        r.data.items[0]!.owned = false;
      },
      (r) => {
        r.data.items[0]!.mesh = UE_SCENE_MESHES[1]!;
      },
      (r) => {
        r.data.items[0]!.material = "";
      },
      (r) => {
        r.data.items[0]!.transform!.location.x += 0.002;
      },
      (r) => {
        delete r.data.items[0]!.transform;
      },
      (r) => {
        r.data.items[7]!.transform = plan().items[7]!.transform;
      },
      (r) => Object.assign(r.data.items[7]!, { transform: null }),
      (r) => {
        r.data.items[7]!.owned = true;
      },
    ];
    for (const change of changes) {
      const r = receipt();
      change(r);
      expect(() => parse(r)).toThrow();
    }
  });
  it("accepts agreed float tolerance and wrapped equivalent angles", () => {
    const s = session(),
      r = receipt();
    r.data.items[0]!.transform!.location.x = 0.0005;
    expect(parseSceneResult(s, UE_SCENE_TOOLS[4], r).appliedCount).toBe(7);
    const p = plan();
    p.items[0]!.transform.rotation.yaw = 180;
    const wrappedSession = createSceneSessionFromVerifiedHost({ ...s, approvedPlan: p });
    r.plan = p;
    r.data.items[0]!.transform!.rotation.yaw = -180;
    expect(parseSceneResult(wrappedSession, UE_SCENE_TOOLS[4], r).appliedCount).toBe(7);
  });
  it("reports unknown/conflicted state without granting resumability", () => {
    for (const status of ["unknown", "failed"] as const) {
      const r = receipt();
      r.data.items[7]!.status = status;
      expect(() => sceneRemainingItemIds(parse(r))).toThrow("query_not_resumable");
    }
    const r = receipt();
    r.data.state = "conflicted";
    r.data.conflict = true;
    r.data.conflictReason = "world changed";
    r.data.currentWorldMatches = false;
    expect(() => sceneRemainingItemIds(parse(r))).toThrow();
    for (const token of [null, "", 0]) {
      const bad = receipt();
      Object.assign(bad.data, { queryToken: token });
      expect(() => parse(bad)).toThrow();
    }
    const noToken = receipt();
    delete noToken.data.queryToken;
    expect(() => sceneRemainingItemIds(parse(noToken))).toThrow();
  });
  it("permits a pre-prepare query without matching or traversing another world", () => {
    const r = receipt(UE_SCENE_TOOLS[4], 0);
    r.data.state = "not_started";
    r.data.currentWorldMatches = false;
    r.data.packageDirty = false;
    delete r.data.queryToken;
    expect(parse(r).state).toBe("not_started");
  });
  it("requires all twenty verified items and a clean newly created disk receipt for save", () => {
    const r = receipt(UE_SCENE_TOOLS[6], 20);
    r.data.state = "saved";
    r.data.saved = true;
    r.data.diskExists = true;
    r.data.diskHash = "b".repeat(64);
    r.data.packageDirty = false;
    expect(parse(r).saved).toBe(true);
    for (const change of [
      (v: typeof r) => {
        v.data.packageDirty = true;
      },
      (v: typeof r) => {
        v.data.diskHash = "";
      },
      (v: typeof r) => {
        v.data.items[19]!.status = "unknown";
      },
      (v: typeof r) => {
        v.data.currentWorldMatches = false;
      },
    ]) {
      const bad = structuredClone(r);
      change(bad);
      expect(() => parse(bad)).toThrow();
    }
  });
});

describe("T14 isolated discovery negotiation", () => {
  function discovery() {
    const second = plan();
    second.operationId = id(5);
    second.targetMap = `${UE_SCENE_ROOT}/L_SecondCase`;
    const catalog = UE_SCENE_TOOLS.map((name) => ({
      name,
      inputSchema: sceneInputSchema(name),
      outputSchema: name === UE_SCENE_TOOLS[0] ? sceneCapabilitiesSchema() : sceneResultSchema(),
    }));
    const manifest = {
      schemaVersion: "uagent.scene.capabilities.v2",
      protocolVersion: 2,
      contractVersion: UE_SCENE_CONTRACT,
      projectKey: "lab-project",
      instanceId: id(2),
      rootObjectId: "volume:file",
      runId: id(3),
      available: true,
      productionSupported: false,
      scopeMode: "isolated_lab_current_run_only",
      writeRoot: UE_SCENE_ROOT,
      approvedPlans: [plan(), second],
      tools: catalog.slice(1).map((entry) => ({ ...entry, effect: "host-scoped scene operation" })),
    };
    const host = {
      projectKey: "lab-project",
      instanceId: id(2),
      rootObjectId: "volume:file",
      runId: id(3),
      approvedPlan: plan(),
    };
    return { manifest, catalog, host };
  }
  // Validate the published schema rather than asserting its minItems value: the disabled
  // response must remain valid across all envelope fields and nested descriptor arrays.
  function assertSchema(value: unknown, schema: Record<string, unknown>): void {
    if (Object.hasOwn(schema, "const")) expect(value).toEqual(schema.const);
    if (Array.isArray(schema.enum)) expect(schema.enum).toContain(value);
    if (schema.type === "array") {
      expect(Array.isArray(value)).toBe(true);
      const values = value as unknown[];
      if (typeof schema.minItems === "number")
        expect(values.length).toBeGreaterThanOrEqual(schema.minItems);
      if (typeof schema.maxItems === "number")
        expect(values.length).toBeLessThanOrEqual(schema.maxItems);
      if (schema.items)
        values.forEach((child) => assertSchema(child, schema.items as Record<string, unknown>));
    } else if (schema.type === "object") {
      expect(value !== null && typeof value === "object" && !Array.isArray(value)).toBe(true);
      const object = value as Record<string, unknown>;
      const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
      if (Array.isArray(schema.required))
        schema.required.forEach((key) => expect(Object.hasOwn(object, key)).toBe(true));
      if (schema.additionalProperties === false)
        expect(Object.keys(object).every((key) => Object.hasOwn(properties, key))).toBe(true);
      Object.entries(properties).forEach(([key, child]) => {
        if (Object.hasOwn(object, key)) assertSchema(object[key], child);
      });
    } else if (schema.type === "integer") {
      expect(Number.isInteger(value)).toBe(true);
    } else {
      expect(typeof value).toBe(schema.type);
    }
    if (typeof value === "string") {
      if (typeof schema.pattern === "string") expect(value).toMatch(new RegExp(schema.pattern));
      if (typeof schema.minLength === "number")
        expect(value.length).toBeGreaterThanOrEqual(schema.minLength);
      if (typeof schema.maxLength === "number")
        expect(value.length).toBeLessThanOrEqual(schema.maxLength);
    }
    if (typeof value === "number") {
      expect(Number.isFinite(value)).toBe(true);
      if (typeof schema.minimum === "number") expect(value).toBeGreaterThanOrEqual(schema.minimum);
      if (typeof schema.maximum === "number") expect(value).toBeLessThanOrEqual(schema.maximum);
    }
  }
  it("accepts the disabled manifest schema while refusing any session from its unverified placeholders", () => {
    const { manifest, catalog, host } = discovery();
    manifest.available = false;
    manifest.rootObjectId = "unverified-root";
    manifest.runId = "00000000-0000-0000-0000-000000000000";
    manifest.approvedPlans = [];
    expect(() => assertSchema(manifest, sceneCapabilitiesSchema())).not.toThrow();
    expect(() => negotiateSceneBatchV2(manifest, catalog, host)).toThrow();
    const placeholders = { ...host, rootObjectId: manifest.rootObjectId, runId: manifest.runId };
    expect(() => negotiateSceneBatchV2(manifest, catalog, placeholders)).toThrow();
  });
  it.each([0, 1])(
    "still requires two exact plans when available=true, even if %s plans satisfy the output schema",
    (count) => {
      const { manifest, catalog, host } = discovery();
      manifest.approvedPlans = manifest.approvedPlans.slice(0, count);
      expect(() => assertSchema(manifest, sceneCapabilitiesSchema())).not.toThrow();
      expect(() => negotiateSceneBatchV2(manifest, catalog, host)).toThrow();
    },
  );
  it("accepts two approved full plans but binds the selected plan and current host", () => {
    const { manifest, catalog, host } = discovery();
    expect(negotiateSceneBatchV2(manifest, catalog, host).plan).toEqual(plan());
  });
  it("rejects production, stale identities, changed plans, extra fields and weak nested schemas", () => {
    const changes: ((v: ReturnType<typeof discovery>) => void)[] = [
      (v) => {
        v.manifest.productionSupported = true;
      },
      (v) => {
        v.manifest.runId = id(99);
      },
      (v) => {
        v.manifest.rootObjectId = "changed";
      },
      (v) => {
        v.manifest.scopeMode = "production";
      },
      (v) => {
        v.manifest.approvedPlans[0]!.items[0]!.transform.scale.x = 2;
      },
      (v) => {
        v.manifest.approvedPlans[1] = structuredClone(v.manifest.approvedPlans[0]!);
      },
      (v) => Object.assign(v.manifest, { permissions: "all" }),
      (v) => {
        v.catalog[1]!.outputSchema = { type: "object" };
      },
      (v) => {
        v.manifest.tools[0]!.inputSchema = { type: "object" };
      },
      (v) => {
        v.manifest.tools[1]!.name = v.manifest.tools[0]!.name;
      },
    ];
    for (const change of changes) {
      const v = discovery();
      change(v);
      expect(() => negotiateSceneBatchV2(v.manifest, v.catalog, v.host)).toThrow();
    }
  });
});

describe("T14 UE quaternion orientation receipts", () => {
  const cases: {
    name: string;
    approved: [number, number, number];
    observed: [number, number, number];
    accepted: boolean;
  }[] = [
    {
      name: "review repro pitch beyond +90",
      approved: [120, 0, 0],
      observed: [60, 180, 180],
      accepted: true,
    },
    { name: "pitch beyond -90", approved: [-120, 0, 0], observed: [-60, 180, 180], accepted: true },
    {
      name: "mixed axes beyond +90",
      approved: [100, 25, -40],
      observed: [80, -155, 140],
      accepted: true,
    },
    {
      name: "mixed axes beyond -90",
      approved: [-100, 25, -40],
      observed: [-80, -155, 140],
      accepted: true,
    },
    {
      name: "across +90",
      approved: [89.999, 30, 10],
      observed: [90.001, -150, -170],
      accepted: true,
    },
    {
      name: "across -90",
      approved: [-89.999, 30, 10],
      observed: [-90.001, -150, -170],
      accepted: true,
    },
    {
      name: "+90 singularity preserves yaw minus roll",
      approved: [90, 30, 10],
      observed: [90, 60, 40],
      accepted: true,
    },
    {
      name: "-90 singularity preserves yaw plus roll",
      approved: [-90, 30, 10],
      observed: [-90, 60, -20],
      accepted: true,
    },
    {
      name: "yaw +/-180 double cover",
      approved: [0, 180, 0],
      observed: [0, -180, 0],
      accepted: true,
    },
    {
      name: "roll +/-180 double cover",
      approved: [0, 0, 180],
      observed: [0, 0, -180],
      accepted: true,
    },
    {
      name: "pitch 180 with mixed axes",
      approved: [180, 45, -20],
      observed: [0, -135, 160],
      accepted: true,
    },
    {
      name: "inside whole-pose tolerance",
      approved: [0, 0, 0],
      observed: [0, 0.0009, 0],
      accepted: true,
    },
    {
      name: "inside tolerance after Euler normalization",
      approved: [120, 0, 0],
      observed: [60, 179.9991, 180],
      accepted: true,
    },
    {
      name: "inside tolerance at singularity",
      approved: [90, 30, 10],
      observed: [90, 30.0009, 10],
      accepted: true,
    },
    {
      name: "combined axes below angular tolerance",
      approved: [0, 0, 0],
      observed: [0.0005, 0.0005, 0.0005],
      accepted: true,
    },
    {
      name: "combined axes exceed whole-pose tolerance",
      approved: [0, 0, 0],
      observed: [0.0007, 0.0007, 0.0007],
      accepted: false,
    },
    { name: "real pitch difference", approved: [120, 0, 0], observed: [60, 0, 0], accepted: false },
    {
      name: "+90 singularity changed pose",
      approved: [90, 30, 10],
      observed: [90, 60, 10],
      accepted: false,
    },
    {
      name: "-90 singularity changed pose",
      approved: [-90, 30, 10],
      observed: [-90, 60, 10],
      accepted: false,
    },
    {
      name: "real difference across +90",
      approved: [89.999, 30, 10],
      observed: [90.001, 30, 10],
      accepted: false,
    },
    {
      name: "outside angular tolerance",
      approved: [0, 0, 0],
      observed: [0, 0, 0.0011],
      accepted: false,
    },
    { name: "opposite orientation", approved: [180, 0, 0], observed: [0, 0, 0], accepted: false },
    {
      name: "different half-turn axes",
      approved: [0, 180, 0],
      observed: [0, 0, 180],
      accepted: false,
    },
  ];
  function rotationReceipt(approved: [number, number, number], observed: [number, number, number]) {
    const p = plan();
    p.items[0]!.transform.rotation = { pitch: approved[0], yaw: approved[1], roll: approved[2] };
    const bound = createSceneSessionFromVerifiedHost({ ...session(), approvedPlan: p });
    const r = receipt();
    r.plan = structuredClone(p);
    r.data.items[0]!.transform!.rotation = {
      pitch: observed[0],
      yaw: observed[1],
      roll: observed[2],
    };
    return { bound, r };
  }
  it.each(cases)("$name", ({ approved, observed, accepted }) => {
    const { bound, r } = rotationReceipt(approved, observed);
    const parse = () => parseSceneResult(bound, UE_SCENE_TOOLS[4], r);
    if (accepted) expect(parse().appliedCount).toBe(7);
    else expect(parse).toThrow("applied_item_not_verified");
  });
  it("keeps the approved Euler numbers exact even when another representation describes the same pose", () => {
    const { bound, r } = rotationReceipt([120, 0, 0], [60, 180, 180]);
    expect(parseSceneResult(bound, UE_SCENE_TOOLS[4], r).appliedCount).toBe(7);
    r.plan.items[0]!.transform.rotation = { pitch: 60, yaw: 180, roll: 180 };
    expect(() => parseSceneResult(bound, UE_SCENE_TOOLS[4], r)).toThrow("result_binding_mismatch");
  });
});
