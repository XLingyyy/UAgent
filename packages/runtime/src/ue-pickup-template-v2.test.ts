import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  parsePickupTemplatePlan,
  UE_PICKUP_PARENT,
  UE_PICKUP_TOOLS,
  UE_PICKUP_CONTRACT,
  negotiatePickupTemplateV2,
  createPickupCall,
  parsePickupResult,
} from "./ue-pickup-template-v2.js";
const plan = () => ({
  operationId: "11111111-1111-4111-8111-111111111111",
  targetPackage: "/Game/Gameplay/Pickups/BP_Pickup",
  expectedDiskState: "absent",
  templateId: "actor.pickup.native.v1",
  parentClass: UE_PICKUP_PARENT,
  itemId: "Health",
  promptText: "Press E to collect",
  interactionRadiusCm: 200,
  interactionKey: "E",
});
describe("approved project pickup plan", () => {
  it("accepts a bounded typed plan and freezes it", () => {
    expect(parsePickupTemplatePlan(plan()).interactionRadiusCm).toBe(200);
    expect(Object.isFrozen(parsePickupTemplatePlan(plan()))).toBe(true);
  });
  it("accepts an exact target in an ordinary project subdirectory", () => {
    expect(parsePickupTemplatePlan({...plan(),targetPackage:"/Game/Items/BP_Health"}).targetPackage).toBe("/Game/Items/BP_Health");
  });
  it.each([
    "/Game/BP_Pickup",
    "/GameOther/Items/BP_Pickup",
    "/Engine/Items/BP_Pickup",
    "/Game/Items/../BP_Pickup",
    "/Game/Items/BP_Pickup.BP_Pickup",
    "/Game/Items//BP_Pickup",
    "/Game/Items/BP_Pickup/Child",
    "/Game/Items/NotBlueprint",
    "/Game/Items With Spaces/BP_Pickup",
    `/Game/${"x".repeat(81)}/BP_Pickup`,
    `/Game/${(`${"x".repeat(80)}/`).repeat(13)}BP_Pickup`,
  ])("rejects scope escape %s", (targetPackage) => {
    expect(() => parsePickupTemplatePlan({ ...plan(), targetPackage })).toThrow();
  });
  it.each([
    { graph: [] },
    { parentClass: "/Script/Engine.Actor" },
    { expectedDiskState: "overwrite" },
    { interactionKey: "Delete" },
    { interactionRadiusCm: 1001 },
    { interactionRadiusCm: 50.5 },
    { promptText: "bad\ntext" },
    { promptText: "x".repeat(129) },
  ])("rejects unsafe/freeform parameter %#", (change) => {
    expect(() => parsePickupTemplatePlan({ ...plan(), ...change })).toThrow();
  });
});

const capture = JSON.parse(
  readFileSync(
    new URL("./__fixtures__/ue-pickup-approved-project-v2-discovery.json", import.meta.url),
    "utf8",
  ),
);
function sessionFixture() {
  const { manifest, catalog } = structuredClone(capture);
  const approvedPlan = parsePickupTemplatePlan({
    ...plan(),
    targetPackage: manifest.allowedTarget,
  });
  const host = {
    projectKey: manifest.projectKey,
    rootObjectId: manifest.rootObjectId,
    approvedPlan,
  };
  return { manifest, catalog, host, session: negotiatePickupTemplateV2(manifest, catalog, host) };
}
function effectFixture() {
  const { session } = sessionFixture();
  return {
    schemaVersion: "uagent.pickup.result.v2",
    contractVersion: UE_PICKUP_CONTRACT,
    projectKey: session.projectKey,
    instanceId: session.instanceId,
    rootObjectId: session.rootObjectId,
    operation: UE_PICKUP_TOOLS[3] as string,
    plan: session.plan,
    planHash: "a".repeat(64),
    data: {
      state: "applied",
      observedDiskHash: "b".repeat(64),
      diskExists: true,
      queryLoadsAssets: false,
      effects: [
        {
          targetPackage: session.plan.targetPackage,
          diskEffect: "created",
          editorEffect: "compiled_loaded",
        },
      ],
      compileStatus: "up_to_date",
      savedPackages: [session.plan.targetPackage],
    },
  };
}
describe("pickup versioned contract and effect binding", () => {
  it("negotiates approved project schemas with synthetic host identities", () => {
    const { session } = sessionFixture();
    expect(createPickupCall(session, UE_PICKUP_TOOLS[1]).arguments).not.toHaveProperty(
      "hostPermit",
    );
  });
  it("rejects changed schema types and mismatched approval scope", () => {
    for (const mode of ["schema", "contract", "production", "root", "target", "directory", "map", "scope"]) {
      const { manifest, catalog, host } = sessionFixture();
      if (mode === "schema") catalog[1].inputSchema.properties.protocolVersion.type = "string";
      if (mode === "contract") manifest.contractVersion = "2.1.0-pickup-create-only";
      if (mode === "production") manifest.productionSupported = false;
      if (mode === "root") host.rootObjectId = "replaced-root";
      if (mode === "target") manifest.allowedTarget = "/Game/Gameplay/Pickups/BP_Other";
      if (mode === "directory") manifest.writeRoot = "/Game/Gameplay";
      if (mode === "map") manifest.allowedMap = "/Game/Gameplay/L_Map";
      if (mode === "scope") manifest.scopeMode = "isolated_lab_only";
      expect(() => negotiatePickupTemplateV2(manifest, catalog, host)).toThrow();
    }
  });
  it("does not treat production support or discovery alone as approval", () => {
    const {manifest,catalog,host}=sessionFixture();
    Object.assign(manifest,{available:false,writeRoot:"",allowedTarget:""});
    expect(() => negotiatePickupTemplateV2(manifest,catalog,host)).toThrow("scope_or_contract_mismatch");
  });
  it("requires a preview precondition for apply", () => {
    const { session } = sessionFixture();
    expect(() => createPickupCall(session, UE_PICKUP_TOOLS[3])).toThrow();
    expect(() =>
      createPickupCall(session, UE_PICKUP_TOOLS[1], "11111111-1111-4111-8111-111111111111"),
    ).toThrow();
  });
  it("binds operation, exact full plan and individual saved package effect", () => {
    const { session } = sessionFixture();
    expect(parsePickupResult(session, UE_PICKUP_TOOLS[3], effectFixture()).state).toBe("applied");
    for (const field of ["operation", "plan", "effect", "extra"]) {
      const r = effectFixture();
      if (field === "operation") r.operation = UE_PICKUP_TOOLS[4];
      if (field === "plan") r.plan = { ...r.plan, itemId: "Changed" };
      if (field === "effect") r.data.effects[0]!.targetPackage = "/Game/User/BP_Unexpected";
      if (field === "extra") Object.assign(r, { unexpected: true });
      expect(() => parsePickupResult(session, UE_PICKUP_TOOLS[3], r)).toThrow();
    }
  });
  it("rejects applied claims without an observed disk file/hash", () => {
    const { session } = sessionFixture();
    for (const value of [false, true]) {
      const r = effectFixture();
      r.data.diskExists = value;
      if (value) r.data.observedDiskHash = "";
      expect(() => parsePickupResult(session, UE_PICKUP_TOOLS[3], r)).toThrow(
        "applied_effect_not_observed",
      );
    }
  });
  it("never accepts missing/null/failed editor observations as apply success", () => {
    const { session } = sessionFixture();
    for (const editorEffect of [
      undefined,
      null,
      "compile_failed",
      "package_loaded",
      "blueprint_loaded_uncompiled",
      "blueprint_not_ready",
      "dirty_loaded",
      "none",
      "invented",
    ]) {
      const r = effectFixture();
      Object.assign(r.data.effects[0]!, { editorEffect });
      expect(() => parsePickupResult(session, UE_PICKUP_TOOLS[3], r)).toThrow();
    }
  });
  it("allows a typed unloaded query observation without claiming editor compilation", () => {
    const { session } = sessionFixture();
    const r = effectFixture();
    r.operation = UE_PICKUP_TOOLS[4];
    r.data.effects[0]!.editorEffect = "none";
    expect(parsePickupResult(session, UE_PICKUP_TOOLS[4], r).effects).toEqual(r.data.effects);
    Object.assign(r.data.effects[0]!, { editorEffect: null });
    expect(() => parsePickupResult(session, UE_PICKUP_TOOLS[4], r)).toThrow(
      "invalid_effect_receipt",
    );
  });
});
