import { describe, expect, it } from "vitest";
import {
  MVP15_ASSET_TOOL_ALLOWLIST,
  type Mvp15McpAssetToolDescriptorLike,
} from "./mvp15-mcp-asset-adapter.js";
import { createMvp15ExactToolFacade } from "./mvp15-exact-tool-facade.js";
import {
  createMvp15LiveAssetToolsetFingerprint,
  MVP15_LIVE_ASSET_TOOLSET_FINGERPRINT_SCHEMA_VERSION,
} from "./mvp15-live-asset-toolset-fingerprint.js";

const schemaVersion = "ue.asset.contract.v1";

function directTools(): Mvp15McpAssetToolDescriptorLike[] {
  return MVP15_ASSET_TOOL_ALLOWLIST.map((name, index) => ({
    name,
    schemaVersion,
    inputSchema: {
      type: "object",
      properties: { assetPath: { minLength: index + 1, type: "string" } },
      required: ["assetPath"],
    },
    dryRunSchema: { properties: { dryRun: { const: true } }, type: "object" },
    rollbackContract: { operation: name, type: "reverse_operation" },
    affectedAssetsSchema: { items: { type: "string" }, type: "array" },
    evidenceQuery: { modes: ["before", "after"], type: "read_only" },
  }));
}

function facadeCandidates(toolsetId = "editor.asset.AssetTools", methodSuffix = "v1") {
  return createMvp15ExactToolFacade([
    {
      toolsetId,
      methods: directTools().map((tool, index) => ({
        exactToolName: tool.name,
        methodId: `asset_method_${index}_${methodSuffix}`,
        schemaVersion,
        inputSchema: tool.inputSchema,
        dryRunSchema: tool.dryRunSchema,
        rollbackContract: tool.rollbackContract,
        affectedAssetsSchema: tool.affectedAssetsSchema,
        evidenceQuery: tool.evidenceQuery,
      })),
    },
  ]).candidates;
}

function reorderedObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).reverse());
}

describe("MVP15 live exact-six asset toolset fingerprint", () => {
  it("creates deterministic machine-readable direct and facade exact-six fingerprints", () => {
    const direct = createMvp15LiveAssetToolsetFingerprint(directTools());
    const facade = createMvp15LiveAssetToolsetFingerprint({
      directTools: [],
      facadeTools: facadeCandidates(),
    });

    expect(direct).toMatchObject({
      status: "ready",
      schemaVersion: MVP15_LIVE_ASSET_TOOLSET_FINGERPRINT_SCHEMA_VERSION,
      toolCount: 6,
      source: "direct",
      issues: {
        missingTools: [],
        duplicateTools: [],
        unexpectedToolCount: 0,
        unexpectedDuplicateCount: 0,
        malformedToolCount: 0,
        reordered: false,
        invalidTools: [],
      },
    });
    expect(facade).toMatchObject({ status: "ready", toolCount: 6, source: "facade" });
    expect(direct.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(facade.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(direct.sha256).not.toBe(facade.sha256);
    expect(direct.canonicalByteLength).toBeGreaterThan(100);
    expect(direct.tools).toHaveLength(6);
    expect(direct.tools.every((tool) => /^[0-9a-f]{64}$/.test(tool.sha256))).toBe(true);
  });

  it("ignores recursive object insertion order while preserving array order", () => {
    const original = directTools();
    const reordered = original.map((tool) => ({
      ...tool,
      inputSchema: reorderedObject(tool.inputSchema as Record<string, unknown>),
      evidenceQuery: reorderedObject(tool.evidenceQuery as Record<string, unknown>),
    }));
    const arrayChanged = directTools();
    arrayChanged[0] = {
      ...arrayChanged[0],
      evidenceQuery: { modes: ["after", "before"], type: "read_only" },
    };

    expect(createMvp15LiveAssetToolsetFingerprint(reordered).sha256).toBe(
      createMvp15LiveAssetToolsetFingerprint(original).sha256,
    );
    expect(createMvp15LiveAssetToolsetFingerprint(arrayChanged).sha256).not.toBe(
      createMvp15LiveAssetToolsetFingerprint(original).sha256,
    );
  });

  it("changes the hash for every required contract, schema version, and facade identity", () => {
    const baseline = createMvp15LiveAssetToolsetFingerprint(directTools()).sha256;
    for (const field of [
      "inputSchema",
      "dryRunSchema",
      "rollbackContract",
      "affectedAssetsSchema",
      "evidenceQuery",
    ] as const) {
      const changed = directTools();
      changed[2] = { ...changed[2], [field]: { changed: field, type: "object" } };
      expect(createMvp15LiveAssetToolsetFingerprint(changed).sha256).not.toBe(baseline);
    }
    const versionChanged = directTools();
    versionChanged[1] = { ...versionChanged[1], schemaVersion: `${schemaVersion}.changed` };
    expect(createMvp15LiveAssetToolsetFingerprint(versionChanged).sha256).not.toBe(baseline);

    const facadeBaseline = createMvp15LiveAssetToolsetFingerprint({
      directTools: [],
      facadeTools: facadeCandidates(),
    }).sha256;
    expect(
      createMvp15LiveAssetToolsetFingerprint({
        directTools: [],
        facadeTools: facadeCandidates("editor.asset.OtherTools"),
      }).sha256,
    ).not.toBe(facadeBaseline);
    expect(
      createMvp15LiveAssetToolsetFingerprint({
        directTools: [],
        facadeTools: facadeCandidates("editor.asset.AssetTools", "v2"),
      }).sha256,
    ).not.toBe(facadeBaseline);
  });

  it.each([
    ["missing", () => directTools().slice(0, 5), "missingTools"],
    ["duplicate", () => [...directTools(), directTools()[0]], "duplicateTools"],
    [
      "unexpected",
      () => [...directTools(), { ...directTools()[0], name: "ue.asset.compile_all" }],
      "unexpectedToolCount",
    ],
    [
      "raw reorder",
      () => {
        const tools = directTools();
        [tools[1], tools[2]] = [tools[2], tools[1]];
        return tools;
      },
      "reordered",
    ],
  ] as const)("fails closed for %s asset discovery", (_label, makeTools, issue) => {
    const result = createMvp15LiveAssetToolsetFingerprint(makeTools());
    expect(result.status).toBe("blocked_by_mcp_schema");
    expect(result.sha256).toBeNull();
    expect(result.canonicalByteLength).toBeNull();
    expect(
      issue === "reordered"
        ? result.issues.reordered
        : issue === "unexpectedToolCount"
          ? result.issues.unexpectedToolCount > 0
          : result.issues[issue].length > 0,
    ).toBe(true);
  });

  it("publishes only allowlisted duplicate names and redacted counts for unexpected tools", () => {
    const allowlistedDuplicate = createMvp15LiveAssetToolsetFingerprint([
      ...directTools(),
      directTools()[0],
    ]);
    expect(allowlistedDuplicate).toMatchObject({
      status: "blocked_by_mcp_schema",
      sha256: null,
      issues: { duplicateTools: [MVP15_ASSET_TOOL_ALLOWLIST[0]] },
    });

    const unexpectedNames = [
      "ue.asset.http://127.0.0.1/private",
      "ue.asset.C:\\Users\\operator\\token=secret-value",
      "ue.asset.Bearer secret-credential",
    ];
    const result = createMvp15LiveAssetToolsetFingerprint([
      ...directTools(),
      ...unexpectedNames.map((name) => ({ name })),
      { name: unexpectedNames[0] },
    ]);
    expect(result).toMatchObject({
      status: "blocked_by_mcp_schema",
      sha256: null,
      canonicalByteLength: null,
      issues: {
        duplicateTools: [],
        unexpectedToolCount: 4,
        unexpectedDuplicateCount: 1,
        malformedToolCount: 0,
      },
    });
    const serialized = JSON.stringify(result);
    for (const canary of [
      "http://127.0.0.1",
      "127.0.0.1",
      "C:\\Users\\operator",
      "token=",
      "secret-value",
      "Bearer",
      "secret-credential",
    ]) {
      expect(serialized).not.toContain(canary);
    }
  });

  it("fails closed without throwing for malformed runtime descriptors and top-level input", () => {
    const throwingName = new Proxy({}, {
      get() {
        throw new Error("Bearer descriptor-name-canary");
      },
    });
    const throwingContract = new Proxy(
      { name: MVP15_ASSET_TOOL_ALLOWLIST[0] },
      {
        get(target, property, receiver) {
          if (property === "name") return Reflect.get(target, property, receiver);
          throw new Error("token=descriptor-contract-canary");
        },
      },
    );
    const malformedDescriptors: unknown[] = [
      null,
      7,
      "primitive",
      true,
      { name: 17 },
      throwingName,
      throwingContract,
    ];

    for (const malformed of malformedDescriptors) {
      let result: ReturnType<typeof createMvp15LiveAssetToolsetFingerprint> | undefined;
      expect(() => {
        result = createMvp15LiveAssetToolsetFingerprint([
          ...directTools(),
          malformed,
        ] as never);
      }).not.toThrow();
      expect(result).toMatchObject({
        status: "blocked_by_mcp_schema",
        sha256: null,
        canonicalByteLength: null,
        issues: { malformedToolCount: 1 },
      });
      expect(JSON.stringify(result)).not.toMatch(/Bearer|token=|descriptor-(?:name|contract)-canary/);
    }

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    for (const malformedInput of [null, 7, true, "token=top-level-canary", revoked.proxy]) {
      let result: ReturnType<typeof createMvp15LiveAssetToolsetFingerprint> | undefined;
      expect(() => {
        result = createMvp15LiveAssetToolsetFingerprint(malformedInput as never);
      }).not.toThrow();
      expect(result).toMatchObject({
        status: "blocked_by_mcp_schema",
        sha256: null,
        canonicalByteLength: null,
        issues: { malformedToolCount: 1 },
      });
      expect(JSON.stringify(result)).not.toContain("token=top-level-canary");
    }
  });

  it.each([null, [], "primitive", 7, true])(
    "rejects a non-object required contract value %j without an accepted sha",
    (invalidValue) => {
      const tools = directTools();
      tools[0] = { ...tools[0], rollbackContract: invalidValue };
      const result = createMvp15LiveAssetToolsetFingerprint(tools);
      expect(result.status).toBe("blocked_by_mcp_schema");
      expect(result.sha256).toBeNull();
      expect(result.issues.invalidTools[0]).toMatchObject({
        name: MVP15_ASSET_TOOL_ALLOWLIST[0],
        fields: expect.arrayContaining(["rollbackContract"]),
      });
    },
  );

  it("rejects empty schema and facade identity plus non-JSON nested values", () => {
    const emptyVersion = directTools();
    emptyVersion[0] = { ...emptyVersion[0], schemaVersion: " " };
    expect(createMvp15LiveAssetToolsetFingerprint(emptyVersion)).toMatchObject({
      status: "blocked_by_mcp_schema",
      sha256: null,
      issues: { invalidTools: [{ fields: expect.arrayContaining(["schemaVersion"]) }] },
    });

    const facade = facadeCandidates();
    facade[0] = {
      ...facade[0],
      annotations: {
        mvp15Facade: {
          wrapperToolName: "call_tool",
          toolsetId: "",
          methodId: "",
          schemaVersion: "",
        },
      },
    };
    expect(
      createMvp15LiveAssetToolsetFingerprint({ directTools: [], facadeTools: facade }),
    ).toMatchObject({
      status: "blocked_by_mcp_schema",
      sha256: null,
      issues: { invalidTools: [{ fields: expect.arrayContaining(["facadeIdentity", "schemaVersion"]) }] },
    });

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const unsupported = directTools();
    unsupported[0] = { ...unsupported[0], inputSchema: cyclic };
    expect(createMvp15LiveAssetToolsetFingerprint(unsupported)).toMatchObject({
      status: "blocked_by_mcp_schema",
      sha256: null,
      issues: { invalidTools: [{ fields: ["canonicalJson"] }] },
    });

    const nonJsonObject = directTools();
    nonJsonObject[0] = { ...nonJsonObject[0], inputSchema: new Date(0) };
    expect(createMvp15LiveAssetToolsetFingerprint(nonJsonObject)).toMatchObject({
      status: "blocked_by_mcp_schema",
      sha256: null,
      issues: { invalidTools: [{ fields: ["canonicalJson"] }] },
    });
  });

  it("preserves direct/facade fallback and precedence safety semantics", () => {
    const incompleteDirect = directTools();
    incompleteDirect[0] = { ...incompleteDirect[0], rollbackContract: null };
    const mixed = createMvp15LiveAssetToolsetFingerprint({
      directTools: incompleteDirect,
      facadeTools: facadeCandidates(),
    });
    expect(mixed).toMatchObject({ status: "ready", source: "mixed", toolCount: 6 });
    expect(mixed.tools[0].source).toBe("facade");
    expect(mixed.tools.slice(1).every((tool) => tool.source === "direct")).toBe(true);

    const staleFacade = facadeCandidates();
    staleFacade[0] = { ...staleFacade[0], rollbackContract: null };
    const directPreferred = createMvp15LiveAssetToolsetFingerprint({
      directTools: directTools(),
      facadeTools: staleFacade,
    });
    expect(directPreferred).toMatchObject({ status: "ready", source: "direct" });
    expect(directPreferred.tools.every((tool) => tool.source === "direct")).toBe(true);
  });
});
