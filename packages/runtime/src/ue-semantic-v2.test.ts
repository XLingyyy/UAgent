import { describe, expect, it } from "vitest";
import {
  UE_SEMANTIC_V2_READS,
  negotiateUESemanticV2,
  createUESemanticReadCall,
  authorizeUESemanticRead,
  parseUESemanticSnapshot,
  canReuseUESemanticSnapshot,
  validateUESemanticDiscoveryResult,
} from "./ue-semantic-v2.js";
function fixtureInput(name: string): {
  type: string;
  additionalProperties: boolean;
  properties: Record<string, Record<string, unknown>>;
  required: string[];
} {
  const discovery = name === "uagent.v2.capabilities";
  const target = /world|selection/.test(name) ? "expectedWorldPackage" : "packageName";
  return {
    type: "object",
    additionalProperties: false,
    properties: discovery
      ? {}
      : {
          protocolVersion: { type: "integer", const: 2 },
          expectedProjectKey: { type: "string", minLength: 1, maxLength: 4096 },
          expectedInstanceId: { type: "string", minLength: 1, maxLength: 4096 },
          limit: { type: "integer", minimum: 1, maximum: 256 },
          [target]: { type: "string", minLength: 1, maxLength: 1024 },
          ...(name.includes("blueprint")
            ? { expectedRevision: { type: "string", pattern: "^[0-9a-f]{32}$" } }
            : {}),
        },
    required: discovery
      ? []
      : ["protocolVersion", "expectedProjectKey", "expectedInstanceId", target],
  };
}
function fixtureOutput(discovery = false) {
  const fields = {
    schemaVersion: "string",
    projectKey: "string",
    instanceId: "string",
    ...(discovery
      ? {
          protocolVersion: "integer",
          contractVersion: "string",
          engineVersion: "string",
          projectName: "string",
          readScopeEnabled: "boolean",
          readRoots: "array",
          legacyV1Contract: "string",
          legacyV1RemainsSeparate: "boolean",
          writeCapabilities: "array",
          capabilities: "array",
        }
      : { operation: "string", observedAtUtc: "string", data: "object", mutationCount: "integer" }),
  };
  return {
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(
      Object.entries(fields).map(([key, type]) => [
        key,
        key === "mutationCount" ? { type, const: 0 } : { type },
      ]),
    ),
    required: Object.keys(fields),
  };
}
function setup() {
  const capabilities = UE_SEMANTIC_V2_READS.map((name) => ({
    name,
    effect: "read_only",
    available: true,
    inputSchema: fixtureInput(name),
    outputSchema: fixtureOutput(),
  }));
  const manifest = {
    schemaVersion: "uagent.semantic.capabilities.v2",
    protocolVersion: 2,
    contractVersion: "2.0.0-readonly",
    engineVersion: "5.8.2-56702186",
    projectName: "UAgentBuildLab",
    projectKey: "project-a",
    instanceId: "instance-a",
    readScopeEnabled: true,
    readRoots: ["/Game/Allowed"],
    writeCapabilities: [],
    legacyV1Contract: "mvp15d.asset-tools.v1",
    legacyV1RemainsSeparate: true,
    capabilities,
  };
  const catalog = [
    {
      name: "uagent.v2.capabilities",
      inputSchema: fixtureInput("uagent.v2.capabilities"),
      outputSchema: fixtureOutput(true),
    },
    ...structuredClone(capabilities),
  ];
  const scope = {
    projectKey: "project-a",
    rootObjectId: "volume:file-a",
    allowedReadRoots: ["/Game/Allowed/Narrow"],
  };
  return { manifest, catalog, scope, session: negotiateUESemanticV2(manifest, catalog, scope) };
}
function snapshot(session = setup().session) {
  return {
    schemaVersion: "uagent.semantic.result.v2",
    projectKey: session.projectKey,
    instanceId: session.instanceId,
    operation: UE_SEMANTIC_V2_READS[0],
    mutationCount: 0,
    observedAtUtc: "2026-10-29T14:00:00Z",
    data: {
      packageName: "/Game/Allowed/Narrow/BP_Test",
      objectPath: "/Game/Allowed/Narrow/BP_Test.BP_Test",
      parentClass: "/Script/Engine.Actor",
      loadPolicy: "already_loaded_only",
      source: {
        packageName: "/Game/Allowed/Narrow/BP_Test",
        packageDirty: false,
        cacheable: false,
        diskExists: true,
        origin: "editor_or_asset_registry_observation",
        diskCoherence: "not_established",
        revision: "a".repeat(32),
      },
      dirtyBefore: false,
      dirtyAfter: false,
      memberScope: "declared_blueprint_graphs_and_scs_only",
      components: [],
      variables: [],
      functions: [],
      events: [],
    },
  };
}
function blueprintCall(session = setup().session) {
  return createUESemanticReadCall(session, UE_SEMANTIC_V2_READS[0], {
    packageName: "/Game/Allowed/Narrow/BP_Test",
  });
}
describe("UE semantic v2 read-only contracts", () => {
  it("negotiates version and narrows server scope to the native host grant", () => {
    expect(setup().session.readRoots).toEqual(["/Game/Allowed/Narrow"]);
  });
  it("rejects unsupported versions and cross-project identity", () => {
    const { manifest, catalog, scope } = setup();
    expect(() =>
      negotiateUESemanticV2({ ...manifest, protocolVersion: 3 }, catalog, scope),
    ).toThrow("unsupported_version");
    expect(() => negotiateUESemanticV2(manifest, catalog, scope, [1])).toThrow(
      "unsupported_version",
    );
    expect(() =>
      negotiateUESemanticV2(manifest, catalog, { ...scope, projectKey: "project-b" }),
    ).toThrow("project_or_root_mismatch");
  });
  it("never promotes v1 writes or annotations into reads", () => {
    const { manifest, catalog, scope, session } = setup();
    expect(() =>
      negotiateUESemanticV2({ ...manifest, writeCapabilities: ["ue.asset.save"] }, catalog, scope),
    ).toThrow("unexpected_write_capability");
    expect(() =>
      authorizeUESemanticRead(session, {
        name: "call_tool",
        arguments: { tool_name: "ue.asset.save", arguments: {} },
      }),
    ).toThrow("tool_not_allowed");
  });
  it("requires exact descriptors and rejects ambiguous catalogs", () => {
    const { manifest, catalog, scope } = setup();
    expect(() => negotiateUESemanticV2(manifest, catalog.slice(1), scope)).toThrow(
      "catalog_ambiguous_or_missing",
    );
    expect(() => negotiateUESemanticV2(manifest, [...catalog, catalog[0]!], scope)).toThrow(
      "catalog_ambiguous_or_missing",
    );
    expect(() =>
      negotiateUESemanticV2(
        manifest,
        catalog.map((entry) =>
          entry.name === UE_SEMANTIC_V2_READS[0] ? { ...entry, inputSchema: {} } : entry,
        ),
        scope,
      ),
    ).toThrow();
  });
  it("checks the actual inner tool and arguments", () => {
    const { session } = setup();
    const call = createUESemanticReadCall(
      session,
      UE_SEMANTIC_V2_READS[0],
      { packageName: "/Game/Allowed/Narrow/BP_Test" },
      "call_tool",
    );
    expect(authorizeUESemanticRead(session, call)).toMatchObject({
      name: UE_SEMANTIC_V2_READS[0],
      arguments: { protocolVersion: 2, expectedProjectKey: "project-a" },
    });
    expect(() =>
      authorizeUESemanticRead(session, {
        ...call,
        arguments: { ...call.arguments, toolset_name: "arbitrary" },
      }),
    ).toThrow("unsupported_toolset_wrapper");
  });
  it.each([
    "/Game/Allowed/NarrowOther/BP_Test",
    "/Game/Allowed/Narrow/../Other",
    "/Engine/Test",
    "/Game/Allowed/Narrow/BP_Test.BP_Test",
  ])("rejects scope escape %s", (packageName) => {
    expect(() =>
      createUESemanticReadCall(setup().session, UE_SEMANTIC_V2_READS[0], { packageName }),
    ).toThrow("package_outside_read_scope");
  });
  it("rejects identity overrides, stale requests and extra execution fields", () => {
    const { session } = setup();
    expect(() =>
      createUESemanticReadCall(session, UE_SEMANTIC_V2_READS[0], { expectedProjectKey: "b" }),
    ).toThrow("identity_override");
    const call = createUESemanticReadCall(session, UE_SEMANTIC_V2_READS[0], {
      packageName: "/Game/Allowed/Narrow/BP_Test",
    });
    for (const args of [{ expectedInstanceId: "old" }, { execute: true }, { limit: 257 }])
      expect(() =>
        authorizeUESemanticRead(session, { ...call, arguments: { ...call.arguments, ...args } }),
      ).toThrow();
  });
  it("attaches trusted root identity and rejects cross-project/effect results", () => {
    const { session } = setup();
    expect(parseUESemanticSnapshot(session, blueprintCall(session), snapshot()).rootObjectId).toBe(
      "volume:file-a",
    );
    expect(() =>
      parseUESemanticSnapshot(session, blueprintCall(session), {
        ...snapshot(),
        mutationCount: 1,
      }),
    ).toThrow("result_identity_or_effect_mismatch");
    expect(() =>
      parseUESemanticSnapshot(session, blueprintCall(session), {
        ...snapshot(),
        projectKey: "other",
      }),
    ).toThrow("result_identity_or_effect_mismatch");
  });
  it("invalidates changed, dirty, root-replaced and reconnected snapshots", () => {
    const { session, manifest, catalog, scope } = setup();
    const result = parseUESemanticSnapshot(session, blueprintCall(session), snapshot());
    expect(canReuseUESemanticSnapshot(result, session, "a".repeat(32))).toBe(false);
    expect(canReuseUESemanticSnapshot(result, session, "b".repeat(32))).toBe(false);
    expect(
      canReuseUESemanticSnapshot(
        { ...result, data: { ...result.data, dirtyAfter: true } },
        session,
        "a".repeat(32),
      ),
    ).toBe(false);
    expect(
      canReuseUESemanticSnapshot(
        result,
        negotiateUESemanticV2(manifest, catalog, { ...scope, rootObjectId: "volume:replacement" }),
        "a".repeat(32),
      ),
    ).toBe(false);
    expect(
      canReuseUESemanticSnapshot(
        result,
        negotiateUESemanticV2({ ...manifest, instanceId: "new" }, catalog, scope),
        "a".repeat(32),
      ),
    ).toBe(false);
  });
  it("rejects altered optional types, required sets, ranges, and output schemas on either side", () => {
    for (const side of ["manifest", "catalog"] as const) {
      for (const change of [
        "versionType",
        "limitRange",
        "targetMissing",
        "extraField",
        "outputType",
      ] as const) {
        const { manifest, catalog, scope } = setup();
        const entry = side === "manifest" ? manifest.capabilities[0]! : catalog[1]!;
        if (change === "versionType")
          entry.inputSchema.properties.protocolVersion = { type: "string" } as never;
        if (change === "limitRange")
          entry.inputSchema.properties.limit = {
            type: "integer",
            minimum: 0,
            maximum: 999,
          } as never;
        if (change === "targetMissing")
          entry.inputSchema.required = [
            "protocolVersion",
            "expectedProjectKey",
            "expectedInstanceId",
          ];
        if (change === "extraField")
          Object.assign(entry.inputSchema.properties, { execute: { type: "boolean" } });
        if (change === "outputType")
          entry.outputSchema.properties.mutationCount = { type: "string" } as never;
        expect(() => negotiateUESemanticV2(manifest, catalog, scope)).toThrow(
          "descriptor_schema_mismatch",
        );
      }
    }
  });
  it("requires scoped world targets before dispatch and rejects a switched world result", () => {
    const { session } = setup();
    for (const name of [UE_SEMANTIC_V2_READS[1], UE_SEMANTIC_V2_READS[2]]) {
      expect(() => createUESemanticReadCall(session, name)).toThrow("package_outside_read_scope");
      expect(() =>
        createUESemanticReadCall(session, name, {
          expectedWorldPackage: "/Game/Allowed/L_OutsideHostGrant",
        }),
      ).toThrow("package_outside_read_scope");
      const call = createUESemanticReadCall(session, name, {
        expectedWorldPackage: "/Game/Allowed/Narrow/L_Expected",
      });
      const raw = snapshot();
      expect(() => parseUESemanticSnapshot(session, call, { ...raw, operation: name })).toThrow(
        "result_outside_scope",
      );
    }
  });
  it("binds the exact requested package, object path and expected revision", () => {
    const { session } = setup();
    const call = blueprintCall(session);
    const wrongPath = snapshot();
    wrongPath.data.objectPath = "/Game/Private/BP_Secret.BP_Secret";
    expect(() => parseUESemanticSnapshot(session, call, wrongPath)).toThrow(
      "result_object_path_mismatch",
    );
    const wrongPackage = snapshot();
    wrongPackage.data.packageName = wrongPackage.data.source.packageName =
      "/Game/Allowed/Narrow/BP_Other";
    wrongPackage.data.objectPath = "/Game/Allowed/Narrow/BP_Other.BP_Other";
    expect(() => parseUESemanticSnapshot(session, call, wrongPackage)).toThrow(
      "result_outside_scope",
    );
    const pinned = createUESemanticReadCall(session, UE_SEMANTIC_V2_READS[0], {
      packageName: "/Game/Allowed/Narrow/BP_Test",
      expectedRevision: "b".repeat(32),
    });
    expect(() => parseUESemanticSnapshot(session, pinned, snapshot())).toThrow(
      "invalid_source_snapshot",
    );
    expect(Object.isFrozen(call.arguments)).toBe(true);
  });
  it("never reuses readonly observations even with forged coherence/cache hints", () => {
    const { session } = setup();
    const parsed = parseUESemanticSnapshot(session, blueprintCall(session), snapshot());
    for (const diskCoherence of ["not_established", "coherent", undefined]) {
      const forged = {
        ...parsed,
        data: {
          ...parsed.data,
          source: { ...snapshot().data.source, cacheable: true, diskCoherence },
        },
      };
      expect(canReuseUESemanticSnapshot(forged, session, "a".repeat(32))).toBe(false);
      expect(() =>
        parseUESemanticSnapshot(session, blueprintCall(session), {
          ...snapshot(),
          data: forged.data,
        }),
      ).toThrow("invalid_source_snapshot");
    }
  });
  it("rejects identically wrong schemas and accepts reordered required sets", () => {
    const { manifest, catalog, scope } = setup();
    manifest.capabilities[0]!.inputSchema.properties.protocolVersion = { type: "string" };
    catalog[1]!.inputSchema.properties.protocolVersion = { type: "string" };
    expect(() => negotiateUESemanticV2(manifest, catalog, scope)).toThrow(
      "descriptor_schema_mismatch",
    );
    const valid = setup();
    valid.catalog[1]!.inputSchema.required.reverse();
    expect(
      negotiateUESemanticV2(valid.manifest, valid.catalog, valid.scope).available,
    ).toHaveLength(4);
  });
  it("validates actual discovery/result envelopes against their closed output schema", () => {
    const { manifest, session } = setup();
    expect(() => validateUESemanticDiscoveryResult(manifest)).not.toThrow();
    const missing = { ...manifest } as Record<string, unknown>;
    delete missing.projectName;
    expect(() => validateUESemanticDiscoveryResult(missing)).toThrow("result_schema_mismatch");
    expect(() => validateUESemanticDiscoveryResult({ ...manifest, projectName: 42 })).toThrow(
      "result_schema_mismatch",
    );
    expect(() => validateUESemanticDiscoveryResult({ ...manifest, unexpectedField: true })).toThrow(
      "result_schema_mismatch",
    );
    expect(() =>
      parseUESemanticSnapshot(session, blueprintCall(session), {
        ...snapshot(),
        unexpectedField: true,
      }),
    ).toThrow("result_schema_mismatch");
  });
});
