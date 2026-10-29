/** Exact read-only v2 mapping. Metadata/fingerprints never grant filesystem or mutation authority. */
export const UE_SEMANTIC_V2_DISCOVERY = "uagent.v2.capabilities";
export const UE_SEMANTIC_V2_READS = [
  "uagent.v2.blueprint.describe",
  "uagent.v2.world.describe",
  "uagent.v2.selection.describe",
  "uagent.v2.asset.references",
] as const;
export type UESemanticReadTool = (typeof UE_SEMANTIC_V2_READS)[number];
type JsonObject = Record<string, unknown>;
const SESSION = Symbol("verified-semantic-session");
export interface UESemanticSession {
  readonly [SESSION]: true;
  readonly protocolVersion: 2;
  readonly projectKey: string;
  readonly instanceId: string;
  readonly rootObjectId: string;
  readonly readRoots: readonly string[];
  readonly available: readonly UESemanticReadTool[];
}
export interface UESemanticHostScope {
  /** From the trusted native host after validating the owned editor peer and open root object. */
  projectKey: string;
  rootObjectId: string;
  allowedReadRoots: readonly string[];
}
export interface UESemanticToolDescriptor {
  name: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}
export interface UESemanticReadCall {
  name: string;
  arguments: JsonObject;
}
export interface UESemanticSnapshot {
  /** Trusted-host metadata, never accepted from a peer result. */
  rootObjectId: string;
  schemaVersion: "uagent.semantic.result.v2";
  projectKey: string;
  instanceId: string;
  operation: UESemanticReadTool;
  mutationCount: 0;
  observedAtUtc: string;
  data: JsonObject;
}
function fail(reason: string): never {
  throw new Error(`semantic_v2_${reason}`);
}
function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("expected_object");
  return value as JsonObject;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 4096) return fail("expected_string");
  return value;
}
export function isCanonicalSemanticPackage(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\/Game(?:\/[\p{L}\p{N}_]+)+$/u.test(value) &&
    value.length <= 1024
  );
}
function within(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}
function assertSession(session: UESemanticSession): void {
  if (session[SESSION] !== true) fail("unverified_session");
}
function expectedInputSchema(name: string): JsonObject {
  const properties: JsonObject = {};
  const required: string[] = [];
  if (name !== UE_SEMANTIC_V2_DISCOVERY) {
    Object.assign(properties, {
      protocolVersion: { type: "integer", const: 2 },
      expectedProjectKey: { type: "string", minLength: 1, maxLength: 4096 },
      expectedInstanceId: { type: "string", minLength: 1, maxLength: 4096 },
      limit: { type: "integer", minimum: 1, maximum: 256 },
    });
    required.push("protocolVersion", "expectedProjectKey", "expectedInstanceId");
    const target =
      name === "uagent.v2.world.describe" || name === "uagent.v2.selection.describe"
        ? "expectedWorldPackage"
        : "packageName";
    properties[target] = { type: "string", minLength: 1, maxLength: 1024 };
    required.push(target);
    if (name === "uagent.v2.blueprint.describe")
      properties.expectedRevision = { type: "string", pattern: "^[0-9a-f]{32}$" };
  }
  return { type: "object", additionalProperties: false, properties, required };
}
function expectedOutputSchema(discovery: boolean): JsonObject {
  const types: Record<string, string> = {
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
      Object.entries(types).map(([key, type]) => [
        key,
        key === "mutationCount" ? { type, const: 0 } : { type },
      ]),
    ),
    required: Object.keys(types),
  };
}
function canonicalSchema(value: unknown, key = ""): string {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalSchema(item));
    return `[${(key === "required" ? items.sort() : items).join(",")}]`;
  }
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, item]) => `${JSON.stringify(name)}:${canonicalSchema(item, name)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
function schemaMatches(value: unknown, expected: JsonObject): boolean {
  return canonicalSchema(value) === canonicalSchema(expected);
}
/** Validate the response itself, including closed output fields, rather than just schema agreement. */
function assertSchemaValue(value: unknown, schema: JsonObject): void {
  const kind = schema.type;
  const valid =
    kind === "object"
      ? !!value && typeof value === "object" && !Array.isArray(value)
      : kind === "array"
        ? Array.isArray(value)
        : kind === "integer"
          ? Number.isInteger(value)
          : typeof value === kind;
  if (!valid || ("const" in schema && value !== schema.const)) fail("result_schema_mismatch");
  if (kind === "object") {
    if (!schema.properties) return;
    const record = object(value);
    const properties = object(schema.properties);
    const required = schema.required as string[];
    if (
      required.some((key) => !(key in record)) ||
      (schema.additionalProperties === false &&
        Object.keys(record).some((key) => !(key in properties)))
    )
      fail("result_schema_mismatch");
    for (const [key, field] of Object.entries(properties))
      if (key in record) assertSchemaValue(record[key], object(field));
  }
}
export function validateUESemanticDiscoveryResult(value: unknown): void {
  assertSchemaValue(value, expectedOutputSchema(true));
}
/** Only call after the native host has established the editor peer/root identity and read grant. */
export function negotiateUESemanticV2(
  manifestValue: unknown,
  catalog: readonly UESemanticToolDescriptor[],
  scope: UESemanticHostScope,
  supportedVersions: readonly number[] = [2],
): UESemanticSession {
  validateUESemanticDiscoveryResult(manifestValue);
  const manifest = object(manifestValue);
  if (
    manifest.schemaVersion !== "uagent.semantic.capabilities.v2" ||
    manifest.protocolVersion !== 2 ||
    manifest.contractVersion !== "2.0.0-readonly" ||
    !supportedVersions.includes(2)
  )
    fail("unsupported_version");
  if (manifest.projectKey !== scope.projectKey || !scope.rootObjectId)
    fail("project_or_root_mismatch");
  if (!/^5\.8\./.test(text(manifest.engineVersion))) fail("unsupported_engine");
  if (
    manifest.legacyV1Contract !== "mvp15d.asset-tools.v1" ||
    manifest.legacyV1RemainsSeparate !== true
  )
    fail("legacy_contract_changed");
  if (!Array.isArray(manifest.writeCapabilities) || manifest.writeCapabilities.length)
    fail("unexpected_write_capability");
  if (
    manifest.readScopeEnabled !== true ||
    !Array.isArray(manifest.readRoots) ||
    !Array.isArray(manifest.capabilities)
  )
    fail("read_scope_disabled");
  const serverRoots = manifest.readRoots;
  if (
    !serverRoots.length ||
    !serverRoots.every(isCanonicalSemanticPackage) ||
    !scope.allowedReadRoots.length ||
    !scope.allowedReadRoots.every(isCanonicalSemanticPackage)
  )
    fail("invalid_scope");
  const roots = [
    ...new Set(
      scope.allowedReadRoots.flatMap((host) =>
        serverRoots.flatMap((server) =>
          within(host, server) ? [host] : within(server, host) ? [server] : [],
        ),
      ),
    ),
  ];
  if (!roots.length) fail("scope_intersection_empty");
  const descriptors = new Map(catalog.map((entry) => [entry.name, entry]));
  if (descriptors.size !== catalog.length || !descriptors.has(UE_SEMANTIC_V2_DISCOVERY))
    fail("catalog_ambiguous_or_missing");
  const discovery = descriptors.get(UE_SEMANTIC_V2_DISCOVERY)!;
  if (
    !schemaMatches(discovery.inputSchema, expectedInputSchema(UE_SEMANTIC_V2_DISCOVERY)) ||
    !schemaMatches(discovery.outputSchema, expectedOutputSchema(true))
  )
    fail("descriptor_schema_mismatch");
  const seen = new Set<string>();
  const available: UESemanticReadTool[] = [];
  for (const value of manifest.capabilities) {
    const capability = object(value);
    const name = text(capability.name);
    if (
      !UE_SEMANTIC_V2_READS.includes(name as UESemanticReadTool) ||
      seen.has(name) ||
      capability.effect !== "read_only"
    )
      fail("unknown_or_duplicate_capability");
    seen.add(name);
    const descriptor = descriptors.get(name);
    if (
      !descriptor ||
      typeof capability.available !== "boolean" ||
      !schemaMatches(descriptor.inputSchema, expectedInputSchema(name)) ||
      !schemaMatches(capability.inputSchema, expectedInputSchema(name)) ||
      !schemaMatches(descriptor.outputSchema, expectedOutputSchema(false)) ||
      !schemaMatches(capability.outputSchema, expectedOutputSchema(false))
    )
      fail("descriptor_schema_mismatch");
    if (capability.available === true) available.push(name as UESemanticReadTool);
  }
  if (seen.size !== UE_SEMANTIC_V2_READS.length) fail("capability_missing");
  return Object.freeze({
    [SESSION]: true as const,
    protocolVersion: 2 as const,
    projectKey: text(manifest.projectKey),
    instanceId: text(manifest.instanceId),
    rootObjectId: scope.rootObjectId,
    readRoots: Object.freeze(roots),
    available: Object.freeze(available),
  });
}
/** Parses a wrapper's actual inner tool and arguments before applying local policy. */
export function authorizeUESemanticRead(
  session: UESemanticSession,
  callValue: unknown,
): UESemanticReadCall {
  assertSession(session);
  const call = object(callValue);
  if (Object.keys(call).some((key) => !["name", "arguments"].includes(key)))
    fail("unknown_call_field");
  let name = text(call.name);
  let args = object(call.arguments);
  if (name === "call_tool") {
    if (Object.keys(args).some((key) => !["tool_name", "arguments"].includes(key)))
      fail("unsupported_toolset_wrapper");
    name = text(args.tool_name);
    args = object(args.arguments);
  }
  if (!session.available.includes(name as UESemanticReadTool)) fail("tool_not_allowed");
  const targetKey =
    name === "uagent.v2.world.describe" || name === "uagent.v2.selection.describe"
      ? "expectedWorldPackage"
      : "packageName";
  const keys = [
    "protocolVersion",
    "expectedProjectKey",
    "expectedInstanceId",
    "limit",
    targetKey,
    ...(name === "uagent.v2.blueprint.describe" ? ["expectedRevision"] : []),
  ];
  if (Object.keys(args).some((key) => !keys.includes(key))) fail("unknown_argument");
  if (
    args.protocolVersion !== 2 ||
    args.expectedProjectKey !== session.projectKey ||
    args.expectedInstanceId !== session.instanceId
  )
    fail("stale_or_cross_project_request");
  if (
    !isCanonicalSemanticPackage(args[targetKey]) ||
    !session.readRoots.some((root) => within(args[targetKey] as string, root))
  )
    fail("package_outside_read_scope");
  if (
    args.limit !== undefined &&
    (!Number.isInteger(args.limit) || Number(args.limit) < 1 || Number(args.limit) > 256)
  )
    fail("invalid_limit");
  if (
    args.expectedRevision !== undefined &&
    (typeof args.expectedRevision !== "string" || !/^[0-9a-f]{32}$/.test(args.expectedRevision))
  )
    fail("invalid_revision");
  return Object.freeze({ name, arguments: Object.freeze({ ...args }) });
}
export function createUESemanticReadCall(
  session: UESemanticSession,
  name: UESemanticReadTool,
  parameters: JsonObject = {},
  route: "direct" | "call_tool" = "direct",
): UESemanticReadCall {
  if (
    Object.keys(parameters).some((key) =>
      ["protocolVersion", "expectedProjectKey", "expectedInstanceId"].includes(key),
    )
  )
    fail("identity_override");
  const inner = authorizeUESemanticRead(session, {
    name,
    arguments: {
      ...parameters,
      protocolVersion: 2,
      expectedProjectKey: session.projectKey,
      expectedInstanceId: session.instanceId,
    },
  });
  return route === "direct"
    ? inner
    : Object.freeze({
        name: "call_tool",
        arguments: Object.freeze({ tool_name: inner.name, arguments: inner.arguments }),
      });
}
export function parseUESemanticSnapshot(
  session: UESemanticSession,
  request: UESemanticReadCall,
  value: unknown,
): UESemanticSnapshot {
  const call = authorizeUESemanticRead(session, request);
  const operation = call.name as UESemanticReadTool;
  const target = call.arguments.packageName ?? call.arguments.expectedWorldPackage;
  const result = object(value);
  const data = object(result.data);
  const source = object(data.source);
  if (
    result.schemaVersion !== "uagent.semantic.result.v2" ||
    result.projectKey !== session.projectKey ||
    result.instanceId !== session.instanceId ||
    result.operation !== operation ||
    !session.available.includes(operation) ||
    result.mutationCount !== 0
  )
    fail("result_identity_or_effect_mismatch");
  assertSchemaValue(value, expectedOutputSchema(false));
  if (
    !isCanonicalSemanticPackage(source.packageName) ||
    !session.readRoots.some((root) => within(source.packageName as string, root)) ||
    data.packageName !== source.packageName ||
    source.packageName !== target
  )
    fail("result_outside_scope");
  if (
    typeof source.packageDirty !== "boolean" ||
    source.cacheable !== false ||
    source.origin !== "editor_or_asset_registry_observation" ||
    source.diskCoherence !== "not_established" ||
    typeof source.diskExists !== "boolean" ||
    typeof source.revision !== "string" ||
    (call.arguments.expectedRevision !== undefined &&
      source.revision !== call.arguments.expectedRevision)
  )
    fail("invalid_source_snapshot");
  if (operation === "uagent.v2.blueprint.describe") {
    text(data.parentClass);
    const packageName = target as string;
    if (data.objectPath !== `${packageName}.${packageName.slice(packageName.lastIndexOf("/") + 1)}`)
      fail("result_object_path_mismatch");
    if (data.loadPolicy !== "already_loaded_only") fail("invalid_load_policy");
    if (
      typeof data.dirtyBefore !== "boolean" ||
      typeof data.dirtyAfter !== "boolean" ||
      data.memberScope !== "declared_blueprint_graphs_and_scs_only"
    )
      fail("invalid_blueprint_snapshot");
    for (const field of ["components", "variables", "functions", "events"])
      if (!Array.isArray(data[field]) || data[field].length > Number(call.arguments.limit ?? 128))
        fail("invalid_or_unbounded_members");
  }
  if (operation === "uagent.v2.world.describe" || operation === "uagent.v2.selection.describe") {
    if (
      data.worldType !== "editor" ||
      data.worldPartition !== false ||
      data.externalActors !== false ||
      !Array.isArray(data.actors) ||
      data.actors.length > Number(call.arguments.limit ?? 128) ||
      !data.actors.every(
        (actor) =>
          typeof object(actor).objectPath === "string" &&
          (object(actor).objectPath as string).startsWith(
            `${target}.${String(target).split("/").at(-1)}:PersistentLevel.`,
          ),
      )
    )
      fail("unsupported_world_snapshot");
  }
  if (operation === "uagent.v2.asset.references") {
    for (const field of ["dependencies", "referencers"])
      if (
        !Array.isArray(data[field]) ||
        data[field].length > Number(call.arguments.limit ?? 128) ||
        !data[field].every((item) => typeof item === "string")
      )
        fail("invalid_references");
    if (data.referenceKind !== "on_disk_package_dependencies_only")
      fail("unsupported_reference_kind");
  }
  text(result.observedAtUtc);
  return { ...result, rootObjectId: session.rootObjectId } as unknown as UESemanticSnapshot;
}
/** This contract never establishes disk/editor coherence, so no observation is reusable. */
export function canReuseUESemanticSnapshot(
  _snapshot: UESemanticSnapshot,
  session: UESemanticSession,
  _currentRevision: string,
): boolean {
  assertSession(session);
  void _snapshot;
  void _currentRevision;
  return false;
}
