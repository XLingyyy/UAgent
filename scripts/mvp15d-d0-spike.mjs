#!/usr/bin/env node
/* global console, process */

/**
 * Rework-7 D0 verifier.
 *
 * This file deliberately does not start Unreal, a Commandlet, or an Automation
 * test.  D0 transcripts are emitted by the desktop/native connection-session-
 * discovery boundary and this verifier only checks their immutable hash index.
 * A supervisor can therefore inspect every redacted input artifact without
 * trusting an implementation-run signing key.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const D0_EVIDENCE_SCHEMA_VERSION = "uagent.mvp15d.d0-product-adapter-hash-index.v7";
export const D0_RAW_TRANSCRIPT_SCHEMA_VERSION = "uagent.mvp15d.d0-product-adapter-transcript.v7";
export const D0_ROUTE_DECISION_SCHEMA_VERSION = "uagent.mvp15d.d0-route-decision.v6";
export const D0_ADAPTER_ARTIFACT_SCHEMA_VERSION = "uagent.mvp15d.d0-desktop-adapter-artifact.v7";
export const D0_RUNNER_ARTIFACT_SCHEMA_VERSION = "uagent.mvp15d.runner-artifact.v2";
export const D0_ADAPTER_METAFILE_SCHEMA_VERSION = "uagent.mvp15d.adapter-metafile.v2";
export const D0_TASK_ID = "TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-SOURCE-CHECKPOINT-REWORK-7";
export const D0_CAPTURE_ORIGIN = "uagent_desktop_native_connection_session_discovery_boundary";
export const D0_PRODUCT_RUNNER_ENTRYPOINT = "scripts/mvp15d-product-adapter-runner.mjs";
export const D0_PRODUCT_ADAPTER_ENTRYPOINT =
  "apps/desktop/web/src/runtime/desktop-runtime-adapter.ts";
export const D0_NATIVE_TRANSPORT_COMMAND = "mcp_streamable_http_request";
export const D0_TOOL_NAMES = [
  "ue.asset.create_folder",
  "ue.asset.duplicate",
  "ue.asset.rename",
  "ue.asset.move",
  "ue.asset.delete",
  "ue.asset.save",
];
export const D0_DIRECT_PROBE_NAME = "uagent.d0.probe";
export const D0_TOOLSET_META_NAMES = ["call_tool", "describe_toolset", "list_toolsets"];
export const D0_COMBINATIONS = [
  { id: "direct-tool-search-on", route: "direct", toolSearch: true },
  { id: "direct-tool-search-off", route: "direct", toolSearch: false },
  { id: "toolset-registry-tool-search-on", route: "toolset_registry", toolSearch: true },
  { id: "toolset-registry-tool-search-off", route: "toolset_registry", toolSearch: false },
];

const BUNDLE_DIRECTORY = "d0-product-adapter";
const EVIDENCE_FILE = "hashes.json";
const ADAPTER_ARTIFACT_FILE = "adapter.artifact.json";
const ROUTE_DECISION_FILE = "route-decision.json";
const RUNNER_ARTIFACT_FILE = "runner.artifact.json";
const ADAPTER_METAFILE = "adapter-bundle.metafile.json";
const ARTIFACT_DIRECTORY = "artifacts";
const ADAPTER_INPUT_DIRECTORY = `${ARTIFACT_DIRECTORY}/adapter-inputs`;
const ADAPTER_BUNDLE_FILE = `${ARTIFACT_DIRECTORY}/adapter-bundle.js`;
const NATIVE_BRIDGE_FILE = `${ARTIFACT_DIRECTORY}/native-bridge.exe`;
const NATIVE_BRIDGE_SOURCE_FILE = `${ARTIFACT_DIRECTORY}/native-bridge-source.rs`;
const TRANSCRIPT_DIRECTORY = "transcripts";
const D0_QUALIFIED_PROBE_NAME = "UAgentAssetTools.UAgentAssetToolsD0Toolset.Probe";
const D0_TOOLSET_NAME = "UAgentAssetTools.UAgentAssetToolsD0Toolset";
const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(SCRIPT_DIRECTORY, "..");

class EvidenceError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new EvidenceError(code);
}

export function stable(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("D0_EVIDENCE_NON_JSON_VALUE");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (
    !value ||
    typeof value !== "object" ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    fail("D0_EVIDENCE_NON_JSON_VALUE");
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
    .join(",")}}`;
}

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

export function currentD0ProductProvenance() {
  const runnerPath = resolve(SCRIPT_DIRECTORY, "mvp15d-product-adapter-runner.mjs");
  return {
    producer: {
      kind: "real_product_adapter_runner",
      entrypoint: D0_PRODUCT_RUNNER_ENTRYPOINT,
      taskId: D0_TASK_ID,
      sourceSha256: sha256File(requireRegularFile(runnerPath, "D0_PRODUCT_PRODUCER_INVALID")),
    },
    provenance: {
      adapterEntrypoint: D0_PRODUCT_ADAPTER_ENTRYPOINT,
      captureBoundary: D0_CAPTURE_ORIGIN,
      nativeTransportCommand: D0_NATIVE_TRANSPORT_COMMAND,
      projectOwnership: "fresh_task_owned",
    },
  };
}

function isHash(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function assertExactKeys(value, expected, code) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index]))
    fail(code);
}

function validateProducerProvenance(producer, provenance, code) {
  assertExactKeys(producer, ["entrypoint", "kind", "sourceSha256", "taskId"], code);
  assertExactKeys(
    provenance,
    ["adapterEntrypoint", "captureBoundary", "nativeTransportCommand", "projectOwnership"],
    code,
  );
  const expected = currentD0ProductProvenance();
  if (
    stable(producer) !== stable(expected.producer) ||
    stable(provenance) !== stable(expected.provenance)
  )
    fail(code);
}

function isWithin(root, candidate) {
  const pathRelative = relative(root, candidate);
  return pathRelative === "" || (!pathRelative.startsWith("..") && !isAbsolute(pathRelative));
}

function samePath(left, right) {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function requireDirectory(path, code) {
  if (!existsSync(path)) fail(code);
  const stats = lstatSync(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) fail(code);
  return path;
}

function requireRegularFile(path, code) {
  if (!existsSync(path)) fail(code);
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink()) fail(code);
  return path;
}

function canonicalChild(root, fragments, code) {
  const child = resolve(root, ...fragments);
  if (!isWithin(root, child)) fail(code);
  return child;
}

export function resolveTaskOwnedD0Root(value) {
  const taskRoot = resolve(value);
  const parent = dirname(taskRoot);
  const tempRoot = resolve(tmpdir());
  const externalRoot = resolve(WORKSPACE_ROOT, "external");
  const temporary =
    samePath(parent, tempRoot) &&
    /^UAgent-MVP15D-Rework7-[A-Za-z0-9_-]+$/i.test(taskRoot.split(/[\\/]/).at(-1) ?? "");
  const durable =
    samePath(parent, externalRoot) &&
    /^mvp15d-rework7-[A-Za-z0-9_-]+$/i.test(taskRoot.split(/[\\/]/).at(-1) ?? "");
  if (!temporary && !durable) fail("D0_TASK_ROOT_NOT_TASK_OWNED");
  requireDirectory(temporary ? tempRoot : externalRoot, "D0_TASK_ROOT_INVALID");
  return requireDirectory(taskRoot, "D0_TASK_ROOT_INVALID");
}

function readJsonFile(path, code) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(code);
  }
}

function walkBundleFiles(root, current = "", state = { files: [], directories: new Set([""]) }) {
  const directory = canonicalChild(
    root,
    current ? current.split("/") : [],
    "D0_BUNDLE_PATH_INVALID",
  );
  requireDirectory(directory, "D0_BUNDLE_PATH_INVALID");
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name, "en"),
  )) {
    if (!entry.name || entry.name === "." || entry.name === ".." || entry.isSymbolicLink())
      fail("D0_BUNDLE_LINK_OR_PATH_INVALID");
    const childRelative = current ? `${current}/${entry.name}` : entry.name;
    const child = canonicalChild(root, childRelative.split("/"), "D0_BUNDLE_LINK_OR_PATH_INVALID");
    if (entry.isDirectory()) {
      state.directories.add(childRelative);
      walkBundleFiles(root, childRelative, state);
    } else if (entry.isFile()) {
      requireRegularFile(child, "D0_BUNDLE_LINK_OR_PATH_INVALID");
      state.files.push(childRelative);
    } else {
      fail("D0_BUNDLE_SPECIAL_FILE_INVALID");
    }
  }
  return state;
}

function assertRedactedPayload(value) {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("D0_REDACTION_INVALID");
    return;
  }
  if (typeof value === "string") {
    if (
      value.length > 64 * 1024 ||
      /^[A-Za-z]:[\\/]/.test(value) ||
      /^\\\\/.test(value) ||
      /(?:Bearer|token|secret|credential|authorization|password|session(?:[_-]?id)?|pid(?:[_-]?hash)?)/i.test(
        value,
      )
    ) {
      fail("D0_REDACTION_INVALID");
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 1_024) fail("D0_REDACTION_INVALID");
    value.forEach(assertRedactedPayload);
    return;
  }
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
    fail("D0_REDACTION_INVALID");
  const entries = Object.entries(value);
  if (entries.length > 1_024) fail("D0_REDACTION_INVALID");
  for (const [key, nested] of entries) {
    if (
      /(?:token|secret|credential|authorization|password|session(?:[_-]?id)?|pid(?:[_-]?hash)?|trusted(?:[_-]?root)?)/i.test(
        key,
      )
    ) {
      fail("D0_REDACTION_INVALID");
    }
    assertRedactedPayload(nested);
  }
}

function extractDiscoveryTools(value) {
  const candidates = [value.response?.result?.tools, value.response?.result?.result?.tools];
  return candidates.find(Array.isArray) ?? null;
}

function isCompleteDescriptor(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    typeof value.description === "string" &&
    value.inputSchema &&
    typeof value.inputSchema === "object" &&
    !Array.isArray(value.inputSchema),
  );
}

export function isD0ExactEmptyInputSchema(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return false;
  const keys = Object.keys(value).sort();
  if (stable(keys) !== stable(["additionalProperties", "properties", "required", "type"]))
    return false;
  return (
    value.type === "object" &&
    value.additionalProperties === false &&
    value.properties &&
    typeof value.properties === "object" &&
    !Array.isArray(value.properties) &&
    Object.getPrototypeOf(value.properties) === Object.prototype &&
    Object.keys(value.properties).length === 0 &&
    Array.isArray(value.required) &&
    value.required.length === 0
  );
}

export function isD0ExactToolsetEmptyInputSchema(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    stable(Object.keys(value)) === stable(["type"]) &&
    value.type === "object",
  );
}

function jsonRpcId(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return typeof value.id === "string" || Number.isSafeInteger(value.id)
    ? `${typeof value.id}:${String(value.id)}`
    : null;
}

function validateJsonRpcRequest(value, expectedMethod, code) {
  assertExactKeys(value, ["id", "jsonrpc", "method", "params"], code);
  if (
    value.jsonrpc !== "2.0" ||
    value.method !== expectedMethod ||
    jsonRpcId(value) === null ||
    !value.params ||
    typeof value.params !== "object" ||
    Array.isArray(value.params) ||
    Object.getPrototypeOf(value.params) !== Object.prototype
  )
    fail(code);
}

function validateJsonRpcResponse(value, request, code) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail(code);
  const hasResult = Object.hasOwn(value, "result");
  const hasError = Object.hasOwn(value, "error");
  if (hasResult === hasError) fail(code);
  assertExactKeys(
    value,
    hasResult ? ["id", "jsonrpc", "result"] : ["error", "id", "jsonrpc"],
    code,
  );
  if (
    value.jsonrpc !== "2.0" ||
    jsonRpcId(value) === null ||
    jsonRpcId(value) !== jsonRpcId(request)
  )
    fail(code);
  if (hasError) {
    if (
      !value.error ||
      typeof value.error !== "object" ||
      Array.isArray(value.error) ||
      Object.getPrototypeOf(value.error) !== Object.prototype
    )
      fail(code);
    const keys = Object.keys(value.error).sort();
    if (
      stable(keys) !== stable(["code", "message"]) &&
      stable(keys) !== stable(["code", "data", "message"])
    )
      fail(code);
    if (
      !Number.isSafeInteger(value.error.code) ||
      typeof value.error.message !== "string" ||
      value.error.message.length === 0
    )
      fail(code);
  }
  return hasResult;
}

export function validateD0CapturedJsonRpcExchange(value, expectedMethod) {
  const code =
    expectedMethod === "initialize"
      ? "D0_INITIALIZE_CAPTURE_INVALID"
      : "D0_DISCOVERY_CAPTURE_INVALID";
  assertExactKeys(value, ["request", "requestSha256", "response", "responseSha256"], code);
  assertRedactedPayload(value.request);
  assertRedactedPayload(value.response);
  if (
    !isHash(value.requestSha256) ||
    value.requestSha256 !== sha256Bytes(stable(value.request)) ||
    !isHash(value.responseSha256) ||
    value.responseSha256 !== sha256Bytes(stable(value.response))
  )
    fail(code);
  validateJsonRpcRequest(value.request, expectedMethod, code);
  if (!validateJsonRpcResponse(value.response, value.request, code)) fail(code);
  return true;
}

function findStructuredNoOp(value, depth = 0) {
  if (depth > 12 || value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      return findStructuredNoOp(JSON.parse(value), depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStructuredNoOp(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  if (
    value.status === "noop" &&
    value.mutationCount === 0 &&
    (value.route === "direct" || value.route === "toolset_registry") &&
    typeof value.toolSearchEnabled === "boolean" &&
    Number.isSafeInteger(value.registrationGeneration) &&
    value.registrationGeneration > 0
  ) {
    return value;
  }
  for (const nested of Object.values(value)) {
    const found = findStructuredNoOp(nested, depth + 1);
    if (found) return found;
  }
  return null;
}

function validateSession(value) {
  assertExactKeys(
    value,
    ["connectionGeneration", "discoveryGeneration", "process", "sessionIdHash"],
    "D0_SESSION_INVALID",
  );
  if (
    !Number.isSafeInteger(value.connectionGeneration) ||
    value.connectionGeneration < 1 ||
    !Number.isSafeInteger(value.discoveryGeneration) ||
    value.discoveryGeneration < 1 ||
    !isHash(value.sessionIdHash)
  )
    fail("D0_SESSION_INVALID");
  assertExactKeys(value.process, ["kind", "pidHash", "portHash"], "D0_SESSION_INVALID");
  if (
    value.process.kind !== "task_owned" ||
    !isHash(value.process.pidHash) ||
    !isHash(value.process.portHash)
  )
    fail("D0_SESSION_INVALID");
}

export function validateD0NoOpEvidence(value, expected) {
  assertExactKeys(
    value,
    ["mutationCount", "request", "requestSha256", "response", "responseSha256"],
    "D0_NOOP_INVALID",
  );
  assertRedactedPayload(value.request);
  assertRedactedPayload(value.response);
  if (
    value.mutationCount !== 0 ||
    !isHash(value.requestSha256) ||
    !isHash(value.responseSha256) ||
    value.requestSha256 !== sha256Bytes(stable(value.request)) ||
    value.responseSha256 !== sha256Bytes(stable(value.response))
  )
    fail("D0_NOOP_INVALID");
  validateJsonRpcRequest(value.request, "tools/call", "D0_NOOP_INVALID");
  if (!validateJsonRpcResponse(value.response, value.request, "D0_NOOP_INVALID"))
    fail("D0_NOOP_INVALID");
  const expectedRequestTool =
    expected.route === "direct"
      ? D0_DIRECT_PROBE_NAME
      : expected.toolSearch
        ? "call_tool"
        : D0_QUALIFIED_PROBE_NAME;
  assertExactKeys(value.request.params, ["arguments", "name"], "D0_NOOP_INVALID");
  if (value.request.params.name !== expectedRequestTool) fail("D0_NOOP_INVALID");
  if (expected.route === "toolset_registry" && expected.toolSearch) {
    assertExactKeys(
      value.request.params.arguments,
      ["arguments", "tool_name", "toolset_name"],
      "D0_NOOP_INVALID",
    );
    if (
      value.request.params.arguments.toolset_name !== D0_TOOLSET_NAME ||
      value.request.params.arguments.tool_name !== "Probe" ||
      stable(value.request.params.arguments.arguments) !== "{}"
    )
      fail("D0_NOOP_INVALID");
  } else if (stable(value.request.params.arguments) !== "{}") {
    fail("D0_NOOP_INVALID");
  }
  const noOp = findStructuredNoOp(value.response);
  if (!noOp || noOp.route !== expected.route || noOp.toolSearchEnabled !== expected.toolSearch)
    fail("D0_NOOP_INVALID");
  return true;
}

function validateProbeDescriptor(descriptor, expected) {
  const schemaValid =
    expected.route === "direct"
      ? isD0ExactEmptyInputSchema(descriptor.inputSchema)
      : isD0ExactToolsetEmptyInputSchema(descriptor.inputSchema);
  if (!isCompleteDescriptor(descriptor) || !schemaValid) {
    fail("D0_PROBE_INVALID");
  }
  if (expected.route === "direct" && descriptor.name !== D0_DIRECT_PROBE_NAME)
    fail("D0_PROBE_INVALID");
  if (expected.route === "toolset_registry" && descriptor.name !== D0_QUALIFIED_PROBE_NAME)
    fail("D0_PROBE_INVALID");
}

export function validateD0DirectInventory(toolNames) {
  if (
    !Array.isArray(toolNames) ||
    toolNames.filter((name) => name === D0_DIRECT_PROBE_NAME).length !== 1 ||
    toolNames.includes(D0_QUALIFIED_PROBE_NAME)
  )
    fail("D0_DIRECT_INVENTORY_CONFLICT");
  return true;
}

function validateLifecyclePublication(value, expected) {
  assertExactKeys(
    value,
    ["adapterGeneration", "inventory", "noOp", "probe"],
    "D0_LIFECYCLE_INVALID",
  );
  assertExactKeys(value.inventory, ["duplicateToolNames", "toolNames"], "D0_LIFECYCLE_INVALID");
  if (
    !Array.isArray(value.inventory.toolNames) ||
    value.inventory.toolNames.length === 0 ||
    value.inventory.toolNames.some((name) => typeof name !== "string") ||
    new Set(value.inventory.toolNames).size !== value.inventory.toolNames.length ||
    stable(value.inventory.duplicateToolNames) !== "[]"
  )
    fail("D0_LIFECYCLE_INVALID");
  if (expected.route === "direct") {
    try {
      validateD0DirectInventory(value.inventory.toolNames);
    } catch {
      fail("D0_LIFECYCLE_INVALID");
    }
  }
  if (
    expected.route === "toolset_registry" &&
    expected.toolSearch &&
    D0_TOOLSET_META_NAMES.some(
      (name) => value.inventory.toolNames.filter((candidate) => candidate === name).length !== 1,
    )
  ) {
    fail("D0_LIFECYCLE_INVALID");
  }
  if (
    expected.route === "toolset_registry" &&
    !expected.toolSearch &&
    value.inventory.toolNames.filter((name) => name === D0_QUALIFIED_PROBE_NAME).length !== 1
  ) {
    fail("D0_LIFECYCLE_INVALID");
  }
  assertExactKeys(
    value.adapterGeneration,
    ["bindingGeneration", "discoveryGeneration"],
    "D0_LIFECYCLE_INVALID",
  );
  if (
    !Number.isSafeInteger(value.adapterGeneration.bindingGeneration) ||
    value.adapterGeneration.bindingGeneration < 1 ||
    !Number.isSafeInteger(value.adapterGeneration.discoveryGeneration) ||
    value.adapterGeneration.discoveryGeneration < 1
  )
    fail("D0_LIFECYCLE_INVALID");
  assertExactKeys(
    value.probe,
    ["descriptor", "descriptorSha256", "schemaSha256"],
    "D0_LIFECYCLE_INVALID",
  );
  validateProbeDescriptor(value.probe.descriptor, expected);
  if (
    !isHash(value.probe.descriptorSha256) ||
    !isHash(value.probe.schemaSha256) ||
    value.probe.descriptorSha256 !== sha256Bytes(stable(value.probe.descriptor)) ||
    value.probe.schemaSha256 !== sha256Bytes(stable(value.probe.descriptor.inputSchema))
  ) {
    fail("D0_LIFECYCLE_INVALID");
  }
  validateD0NoOpEvidence(value.noOp, expected);
}

export function validateD0LifecyclePublicationGeneration(publication, expectedGeneration) {
  if (
    !Number.isSafeInteger(expectedGeneration) ||
    expectedGeneration < 1 ||
    publication?.adapterGeneration?.discoveryGeneration !== expectedGeneration
  ) {
    fail("D0_LIFECYCLE_GENERATION_REUSE");
  }
  return true;
}

function nativeRequestId(value) {
  return typeof value === "string" && value.length > 0
    ? `string:${value}`
    : Number.isSafeInteger(value)
      ? `number:${String(value)}`
      : null;
}

export function validateD0NativeLifecycle(value) {
  assertExactKeys(value, ["bridgeProcessIdentityHash", "commands"], "D0_NATIVE_LIFECYCLE_INVALID");
  if (
    !isHash(value.bridgeProcessIdentityHash) ||
    !Array.isArray(value.commands) ||
    value.commands.length < 9
  )
    fail("D0_NATIVE_LIFECYCLE_INVALID");
  const expectedStates = new Map([
    ["trust_native_project_root", { status: "trusted", generation: false }],
    ["discover_editor_processes", { status: "ready", generation: false }],
    ["attach_editor_process", { status: "attached", generation: false }],
    ["attest_mvp15_companion", { status: "observed", generation: true }],
  ]);
  const requestIds = new Set();
  const requestHashes = new Set();
  const responseHashes = new Set();
  let lastAttestationGeneration = 0;
  let discoverCount = 0;
  let awaitingAttach = false;
  let attached = false;
  for (let index = 0; index < value.commands.length; index += 1) {
    const command = value.commands[index];
    assertExactKeys(
      command,
      [
        "applied",
        "attestationGeneration",
        "bridgeProcessIdentityHash",
        "command",
        "minimumAttestationGeneration",
        "nativeGeneration",
        "requestId",
        "requestSha256",
        "requestedAttestationGeneration",
        "responseRequestId",
        "responseSha256",
        "revokedApprovalCount",
        "status",
      ],
      "D0_NATIVE_LIFECYCLE_INVALID",
    );
    const retraction = command.command === "retract_mvp15_companion_approvals";
    const expected = expectedStates.get(command.command);
    const requestId = nativeRequestId(command.requestId);
    if (
      (!expected && !retraction) ||
      (expected && command.status !== expected.status) ||
      command.bridgeProcessIdentityHash !== value.bridgeProcessIdentityHash ||
      requestId === null ||
      requestId !== nativeRequestId(command.responseRequestId) ||
      requestIds.has(requestId) ||
      !isHash(command.requestSha256) ||
      !isHash(command.responseSha256) ||
      requestHashes.has(command.requestSha256) ||
      responseHashes.has(command.responseSha256)
    ) {
      fail("D0_NATIVE_LIFECYCLE_INVALID");
    }
    requestIds.add(requestId);
    requestHashes.add(command.requestSha256);
    responseHashes.add(command.responseSha256);
    if (!retraction) {
      if (
        command.applied !== null ||
        command.requestedAttestationGeneration !== null ||
        command.minimumAttestationGeneration !== null ||
        command.nativeGeneration !== null ||
        command.revokedApprovalCount !== null
      ) {
        fail("D0_NATIVE_LIFECYCLE_INVALID");
      }
    } else {
      const requested = command.requestedAttestationGeneration;
      const applied =
        command.status === "retracted" &&
        command.applied === true &&
        command.attestationGeneration === requested &&
        (requested === null || Number.isSafeInteger(requested)) &&
        Number.isSafeInteger(command.minimumAttestationGeneration) &&
        command.minimumAttestationGeneration >= 0 &&
        (requested === null || command.minimumAttestationGeneration === requested);
      const stale =
        command.status === "stale" &&
        command.applied === false &&
        Number.isSafeInteger(requested) &&
        requested > 0 &&
        command.attestationGeneration === requested &&
        Number.isSafeInteger(command.minimumAttestationGeneration) &&
        command.minimumAttestationGeneration > requested;
      if (
        (!applied && !stale) ||
        !Number.isSafeInteger(command.nativeGeneration) ||
        command.nativeGeneration < 1 ||
        !Number.isSafeInteger(command.revokedApprovalCount) ||
        command.revokedApprovalCount < 0
      ) {
        fail("D0_NATIVE_LIFECYCLE_INVALID");
      }
    }
    if (
      index === 0
        ? command.command !== "trust_native_project_root"
        : command.command === "trust_native_project_root"
    ) {
      fail("D0_NATIVE_LIFECYCLE_INVALID");
    }
    if (command.command === "discover_editor_processes") {
      if (awaitingAttach) fail("D0_NATIVE_LIFECYCLE_INVALID");
      awaitingAttach = true;
      discoverCount += 1;
    } else if (command.command === "attach_editor_process") {
      if (!awaitingAttach) fail("D0_NATIVE_LIFECYCLE_INVALID");
      awaitingAttach = false;
      attached = true;
    } else if (command.command === "attest_mvp15_companion") {
      if (!attached || awaitingAttach) fail("D0_NATIVE_LIFECYCLE_INVALID");
    } else if (retraction) {
      if (awaitingAttach) fail("D0_NATIVE_LIFECYCLE_INVALID");
    }
    if (expected?.generation) {
      if (
        !Number.isSafeInteger(command.attestationGeneration) ||
        command.attestationGeneration <= lastAttestationGeneration
      )
        fail("D0_NATIVE_LIFECYCLE_INVALID");
      lastAttestationGeneration = command.attestationGeneration;
    } else if (!retraction && command.attestationGeneration !== null) {
      fail("D0_NATIVE_LIFECYCLE_INVALID");
    }
  }
  if (
    discoverCount < 2 ||
    awaitingAttach ||
    value.commands.at(-1).command !== "retract_mvp15_companion_approvals"
  ) {
    fail("D0_NATIVE_LIFECYCLE_INVALID");
  }
  return true;
}

export function validateD0LifecycleGenerationSequence(value) {
  const generations = [
    value?.refresh?.beforeGeneration,
    value?.refresh?.afterGeneration,
    value?.reconnect?.beforeGeneration,
    value?.reconnect?.afterGeneration,
    value?.retractionRecovery?.beforeGeneration,
    value?.retractionRecovery?.connectionGeneration,
    value?.retractionRecovery?.afterGeneration,
    value?.rendererReconstruction?.connectionGeneration,
    value?.rendererReconstruction?.discoveryGeneration,
    value?.editorRestart?.afterGeneration,
  ];
  if (
    generations.some((generation) => !Number.isSafeInteger(generation) || generation < 1) ||
    generations.some((generation, index) => index > 0 && generation <= generations[index - 1]) ||
    value?.rendererReconstruction?.priorDiscoveryGeneration !==
      value?.retractionRecovery?.afterGeneration ||
    value?.editorRestart?.beforeGeneration !== value?.rendererReconstruction?.discoveryGeneration
  )
    fail("D0_LIFECYCLE_GENERATION_REUSE");
  return true;
}

function validateAttestation(value, expectedGeneration, code) {
  assertExactKeys(
    value,
    ["currentGeneration", "liveFingerprintSha256Prefix", "manifestSha256Prefix", "status"],
    code,
  );
  const manifestPrefixValid =
    typeof value.manifestSha256Prefix === "string" &&
    /^[0-9a-f]{8,64}$/.test(value.manifestSha256Prefix);
  const verified =
    value.status === "verified" &&
    typeof value.liveFingerprintSha256Prefix === "string" &&
    /^[0-9a-f]{8,64}$/.test(value.liveFingerprintSha256Prefix);
  const d0RevocationBound =
    value.status === "native_observed_revocation_bound" &&
    value.liveFingerprintSha256Prefix === null;
  if (
    value.currentGeneration !== expectedGeneration ||
    !manifestPrefixValid ||
    (!verified && !d0RevocationBound)
  )
    fail(code);
}

function validateLifecycle(value, expected, nativeLifecycle) {
  assertExactKeys(
    value,
    [
      "editorRestart",
      "firstListenerStaleRetraction",
      "reconnect",
      "refresh",
      "rendererReconstruction",
      "retractionRecovery",
      "staleRetraction",
    ],
    "D0_LIFECYCLE_INVALID",
  );
  const adapterGenerations = [];
  for (const name of ["refresh", "reconnect", "editorRestart"]) {
    const step = value[name];
    const phaseKeys =
      name === "refresh"
        ? [
            "afterGeneration",
            "attestation",
            "beforeGeneration",
            "completed",
            "discovery",
            "publication",
            "sessionIdHash",
          ]
        : name === "reconnect"
          ? [
              "afterGeneration",
              "attestation",
              "beforeGeneration",
              "completed",
              "connectionGeneration",
              "discovery",
              "initialize",
              "publication",
              "sessionIdHash",
            ]
          : [
              "afterGeneration",
              "attestation",
              "beforeGeneration",
              "completed",
              "connectionGeneration",
              "discovery",
              "editorSessionIdHash",
              "initialize",
              "processDescriptorHash",
              "publication",
              "sessionIdHash",
            ];
    assertExactKeys(step, phaseKeys, "D0_LIFECYCLE_INVALID");
    if (
      step.completed !== true ||
      !Number.isSafeInteger(step.beforeGeneration) ||
      !Number.isSafeInteger(step.afterGeneration) ||
      step.beforeGeneration < 1 ||
      step.afterGeneration <= step.beforeGeneration ||
      !isHash(step.sessionIdHash)
    ) {
      fail("D0_LIFECYCLE_INVALID");
    }
    validateD0CapturedJsonRpcExchange(step.discovery, "tools/list");
    validateAttestation(step.attestation, step.afterGeneration, "D0_LIFECYCLE_INVALID");
    if (name !== "refresh") {
      validateD0CapturedJsonRpcExchange(step.initialize, "initialize");
      if (
        !Number.isSafeInteger(step.connectionGeneration) ||
        step.connectionGeneration <= step.beforeGeneration ||
        step.connectionGeneration >= step.afterGeneration
      )
        fail("D0_LIFECYCLE_INVALID");
    }
    if (
      name === "editorRestart" &&
      (!isHash(step.editorSessionIdHash) || !isHash(step.processDescriptorHash))
    ) {
      fail("D0_LIFECYCLE_INVALID");
    }
    validateLifecyclePublication(step.publication, expected);
    validateD0LifecyclePublicationGeneration(step.publication, step.afterGeneration);
    adapterGenerations.push(step.publication.adapterGeneration);
  }
  validateD0LifecycleGenerationSequence(value);
  if (
    adapterGenerations[1].bindingGeneration <= adapterGenerations[0].bindingGeneration ||
    adapterGenerations[1].discoveryGeneration <= adapterGenerations[0].discoveryGeneration
  ) {
    fail("D0_LIFECYCLE_GENERATION_REUSE");
  }
  assertExactKeys(
    value.firstListenerStaleRetraction,
    [
      "attestationGeneration",
      "nativeRetractionCompleted",
      "requestId",
      "responseRequestId",
      "status",
    ],
    "D0_LIFECYCLE_INVALID",
  );
  const retraction = value.firstListenerStaleRetraction;
  if (
    retraction.nativeRetractionCompleted !== true ||
    retraction.status !== "retracted" ||
    nativeRequestId(retraction.requestId) === null ||
    nativeRequestId(retraction.requestId) !== nativeRequestId(retraction.responseRequestId) ||
    !Number.isSafeInteger(retraction.attestationGeneration) ||
    !nativeLifecycle.commands.some(
      (command) =>
        command.command === "retract_mvp15_companion_approvals" &&
        command.status === retraction.status &&
        nativeRequestId(command.requestId) === nativeRequestId(retraction.requestId) &&
        command.attestationGeneration === retraction.attestationGeneration,
    )
  ) {
    fail("D0_LIFECYCLE_INVALID");
  }

  const recovery = value.retractionRecovery;
  assertExactKeys(
    recovery,
    [
      "afterGeneration",
      "attestation",
      "beforeGeneration",
      "completed",
      "connectionGeneration",
      "discovery",
      "initialize",
      "publication",
      "sessionIdHash",
      "triggeringRetractionRequestId",
    ],
    "D0_LIFECYCLE_INVALID",
  );
  if (
    recovery.completed !== true ||
    !Number.isSafeInteger(recovery.beforeGeneration) ||
    recovery.beforeGeneration < 1 ||
    !Number.isSafeInteger(recovery.connectionGeneration) ||
    recovery.connectionGeneration <= recovery.beforeGeneration ||
    !Number.isSafeInteger(recovery.afterGeneration) ||
    recovery.afterGeneration <= recovery.connectionGeneration ||
    !isHash(recovery.sessionIdHash) ||
    nativeRequestId(recovery.triggeringRetractionRequestId) === null ||
    nativeRequestId(recovery.triggeringRetractionRequestId) !==
      nativeRequestId(retraction.requestId)
  ) {
    fail("D0_LIFECYCLE_INVALID");
  }
  validateD0CapturedJsonRpcExchange(recovery.initialize, "initialize");
  validateD0CapturedJsonRpcExchange(recovery.discovery, "tools/list");
  validateAttestation(recovery.attestation, recovery.afterGeneration, "D0_LIFECYCLE_INVALID");
  validateLifecyclePublication(recovery.publication, expected);
  validateD0LifecyclePublicationGeneration(recovery.publication, recovery.afterGeneration);
  if (
    recovery.publication.adapterGeneration.bindingGeneration <=
      adapterGenerations[1].bindingGeneration ||
    recovery.publication.adapterGeneration.discoveryGeneration <=
      adapterGenerations[1].discoveryGeneration
  ) {
    fail("D0_LIFECYCLE_GENERATION_REUSE");
  }

  const reconstruction = value.rendererReconstruction;
  assertExactKeys(
    reconstruction,
    [
      "attestation",
      "completed",
      "connectionGeneration",
      "discovery",
      "discoveryGeneration",
      "firstListener",
      "initialize",
      "priorDiscoveryGeneration",
      "publication",
      "sessionIdHash",
      "startupRetraction",
    ],
    "D0_LIFECYCLE_INVALID",
  );
  assertExactKeys(
    reconstruction.firstListener,
    ["companionVerified", "discoveryCleared", "nativeZeroAuthorityBaselineCompleted", "status"],
    "D0_LIFECYCLE_INVALID",
  );
  assertExactKeys(
    reconstruction.startupRetraction,
    [
      "applied",
      "minimumAttestationGeneration",
      "nativeGeneration",
      "requestId",
      "requestedAttestationGeneration",
      "responseRequestId",
      "status",
    ],
    "D0_LIFECYCLE_INVALID",
  );
  if (
    reconstruction.completed !== true ||
    !Number.isSafeInteger(reconstruction.priorDiscoveryGeneration) ||
    !Number.isSafeInteger(reconstruction.connectionGeneration) ||
    !Number.isSafeInteger(reconstruction.discoveryGeneration) ||
    reconstruction.connectionGeneration < 1 ||
    reconstruction.discoveryGeneration <= reconstruction.connectionGeneration ||
    !isHash(reconstruction.sessionIdHash) ||
    reconstruction.firstListener.discoveryCleared !== true ||
    reconstruction.firstListener.companionVerified !== false ||
    reconstruction.firstListener.nativeZeroAuthorityBaselineCompleted !== true ||
    typeof reconstruction.firstListener.status !== "string" ||
    reconstruction.firstListener.status.length === 0 ||
    reconstruction.startupRetraction.status !== "retracted" ||
    reconstruction.startupRetraction.applied !== true ||
    reconstruction.startupRetraction.requestedAttestationGeneration !== null ||
    !Number.isSafeInteger(reconstruction.startupRetraction.minimumAttestationGeneration) ||
    reconstruction.startupRetraction.minimumAttestationGeneration < 0 ||
    !Number.isSafeInteger(reconstruction.startupRetraction.nativeGeneration) ||
    reconstruction.startupRetraction.nativeGeneration < 1 ||
    nativeRequestId(reconstruction.startupRetraction.requestId) === null ||
    nativeRequestId(reconstruction.startupRetraction.requestId) !==
      nativeRequestId(reconstruction.startupRetraction.responseRequestId) ||
    !nativeLifecycle.commands.some(
      (command) =>
        command.command === "retract_mvp15_companion_approvals" &&
        command.status === reconstruction.startupRetraction.status &&
        command.applied === reconstruction.startupRetraction.applied &&
        command.requestedAttestationGeneration === null &&
        command.minimumAttestationGeneration ===
          reconstruction.startupRetraction.minimumAttestationGeneration &&
        command.nativeGeneration === reconstruction.startupRetraction.nativeGeneration &&
        nativeRequestId(command.requestId) ===
          nativeRequestId(reconstruction.startupRetraction.requestId),
    )
  ) {
    fail("D0_LIFECYCLE_INVALID");
  }
  validateD0CapturedJsonRpcExchange(reconstruction.initialize, "initialize");
  validateD0CapturedJsonRpcExchange(reconstruction.discovery, "tools/list");
  validateAttestation(
    reconstruction.attestation,
    reconstruction.discoveryGeneration,
    "D0_LIFECYCLE_INVALID",
  );
  validateLifecyclePublication(reconstruction.publication, expected);
  validateD0LifecyclePublicationGeneration(
    reconstruction.publication,
    reconstruction.discoveryGeneration,
  );
  if (
    reconstruction.publication.adapterGeneration.bindingGeneration <=
      recovery.publication.adapterGeneration.bindingGeneration ||
    reconstruction.publication.adapterGeneration.discoveryGeneration <=
      recovery.publication.adapterGeneration.discoveryGeneration ||
    adapterGenerations[2].bindingGeneration <=
      reconstruction.publication.adapterGeneration.bindingGeneration ||
    adapterGenerations[2].discoveryGeneration <=
      reconstruction.publication.adapterGeneration.discoveryGeneration
  ) {
    fail("D0_LIFECYCLE_GENERATION_REUSE");
  }

  const stale = value.staleRetraction;
  assertExactKeys(
    stale,
    [
      "applied",
      "minimumAttestationGeneration",
      "nativeGeneration",
      "requestId",
      "requestedAttestationGeneration",
      "responseRequestId",
      "status",
    ],
    "D0_LIFECYCLE_INVALID",
  );
  if (
    stale.status !== "stale" ||
    stale.applied !== false ||
    !Number.isSafeInteger(stale.requestedAttestationGeneration) ||
    stale.requestedAttestationGeneration < 1 ||
    !Number.isSafeInteger(stale.minimumAttestationGeneration) ||
    stale.minimumAttestationGeneration <= stale.requestedAttestationGeneration ||
    !Number.isSafeInteger(stale.nativeGeneration) ||
    stale.nativeGeneration < 1 ||
    nativeRequestId(stale.requestId) === null ||
    nativeRequestId(stale.requestId) !== nativeRequestId(stale.responseRequestId) ||
    !nativeLifecycle.commands.some(
      (command) =>
        command.command === "retract_mvp15_companion_approvals" &&
        command.status === "stale" &&
        command.applied === false &&
        command.requestedAttestationGeneration === stale.requestedAttestationGeneration &&
        command.minimumAttestationGeneration === stale.minimumAttestationGeneration,
    )
  ) {
    fail("D0_LIFECYCLE_INVALID");
  }
}

function validateTranscript(value, expected) {
  assertExactKeys(
    value,
    [
      "attestation",
      "captureOrigin",
      "closeout",
      "combination",
      "discovery",
      "initialize",
      "inventory",
      "lifecycle",
      "nativeLifecycle",
      "noOp",
      "probe",
      "producer",
      "provenance",
      "route",
      "schemaVersion",
      "session",
      "taskId",
      "toolSearch",
    ],
    "D0_RAW_TRANSCRIPT_INVALID",
  );
  if (
    value.schemaVersion !== D0_RAW_TRANSCRIPT_SCHEMA_VERSION ||
    value.taskId !== D0_TASK_ID ||
    value.captureOrigin !== D0_CAPTURE_ORIGIN ||
    value.combination !== expected.id ||
    value.route !== expected.route ||
    value.toolSearch !== expected.toolSearch
  )
    fail("D0_RAW_TRANSCRIPT_INVALID");
  validateProducerProvenance(value.producer, value.provenance, "D0_PRODUCT_PRODUCER_INVALID");
  validateSession(value.session);
  validateD0CapturedJsonRpcExchange(value.initialize, "initialize");
  validateD0CapturedJsonRpcExchange(value.discovery, "tools/list");
  validateAttestation(
    value.attestation,
    value.session.discoveryGeneration,
    "D0_ATTESTATION_INVALID",
  );
  assertExactKeys(
    value.probe,
    ["descriptor", "descriptorSha256", "schema", "schemaSha256"],
    "D0_PROBE_INVALID",
  );
  assertRedactedPayload(value.probe.descriptor);
  assertRedactedPayload(value.probe.schema);
  if (
    !isHash(value.probe.descriptorSha256) ||
    !isHash(value.probe.schemaSha256) ||
    value.probe.descriptorSha256 !== sha256Bytes(stable(value.probe.descriptor)) ||
    value.probe.schemaSha256 !== sha256Bytes(stable(value.probe.schema))
  )
    fail("D0_PROBE_INVALID");
  assertExactKeys(value.inventory, ["duplicateToolNames", "toolNames"], "D0_INVENTORY_INVALID");
  const discoveryTools = extractDiscoveryTools(value.discovery);
  if (
    !Array.isArray(discoveryTools) ||
    discoveryTools.length === 0 ||
    discoveryTools.some((descriptor) => !isCompleteDescriptor(descriptor))
  ) {
    fail("D0_DISCOVERY_DESCRIPTOR_INVALID");
  }
  const discoveredNames = discoveryTools.map(({ name }) => name);
  const duplicateNames = [
    ...new Set(discoveredNames.filter((name, index) => discoveredNames.indexOf(name) !== index)),
  ].sort();
  if (
    stable(value.inventory.toolNames) !== stable(discoveredNames) ||
    stable(value.inventory.duplicateToolNames) !== stable(duplicateNames) ||
    duplicateNames.length !== 0
  )
    fail("D0_INVENTORY_INVALID");
  if (
    !(expected.route === "direct"
      ? isD0ExactEmptyInputSchema(value.probe.schema)
      : isD0ExactToolsetEmptyInputSchema(value.probe.schema)) ||
    stable(value.probe.schema) !== stable(value.probe.descriptor.inputSchema)
  ) {
    fail("D0_PROBE_INVALID");
  }
  validateProbeDescriptor(value.probe.descriptor, expected);
  if (expected.route === "direct") validateD0DirectInventory(discoveredNames);
  if (
    expected.route === "toolset_registry" &&
    expected.toolSearch &&
    D0_TOOLSET_META_NAMES.some((name) => !discoveredNames.includes(name))
  )
    fail("D0_PROBE_INVALID");
  validateD0NativeLifecycle(value.nativeLifecycle);
  validateLifecycle(value.lifecycle, expected, value.nativeLifecycle);
  validateD0NoOpEvidence(value.noOp, expected);
  assertExactKeys(
    value.closeout,
    [
      "completed",
      "contentUnchanged",
      "markerClosed",
      "mutationCount",
      "portClosed",
      "processClosed",
    ],
    "D0_CLOSEOUT_INVALID",
  );
  if (
    value.closeout.completed !== true ||
    value.closeout.contentUnchanged !== true ||
    value.closeout.mutationCount !== 0 ||
    value.closeout.portClosed !== true ||
    value.closeout.processClosed !== true ||
    value.closeout.markerClosed !== true
  )
    fail("D0_CLOSEOUT_INVALID");
}

function transcriptIndex(transcripts) {
  return transcripts.map(({ combination, sha256 }) => ({ id: combination.id, sha256 }));
}

function indexedArtifact(path, logicalPath) {
  const stats = lstatSync(requireRegularFile(path, "D0_INDEXED_ARTIFACT_INVALID"));
  if (!Number.isSafeInteger(stats.size) || stats.size <= 0) fail("D0_INDEXED_ARTIFACT_INVALID");
  return { path: logicalPath, size: stats.size, sha256: sha256File(path) };
}

function validateArtifactReference(value, expectedPath, bundleRoot, extraKeys, code) {
  assertExactKeys(value, ["path", "sha256", "size", ...extraKeys], code);
  const path = canonicalChild(bundleRoot, expectedPath.split("/"), code);
  const actual = indexedArtifact(path, expectedPath);
  if (value.path !== expectedPath || value.size !== actual.size || value.sha256 !== actual.sha256)
    fail(code);
  return actual;
}

function validateIndependentTranscripts(transcripts) {
  const selectors = [
    ["sessionIdHash", ({ transcript }) => transcript.session.sessionIdHash],
    ["pidHash", ({ transcript }) => transcript.session.process.pidHash],
    ["portHash", ({ transcript }) => transcript.session.process.portHash],
    [
      "bridgeProcessIdentityHash",
      ({ transcript }) => transcript.nativeLifecycle.bridgeProcessIdentityHash,
    ],
    ["initializeRequestHash", ({ transcript }) => transcript.initialize.requestSha256],
    ["initializeResponseHash", ({ transcript }) => transcript.initialize.responseSha256],
    ["discoveryRequestHash", ({ transcript }) => transcript.discovery.requestSha256],
    ["discoveryResponseHash", ({ transcript }) => transcript.discovery.responseSha256],
    ["noOpRequestHash", ({ transcript }) => transcript.noOp.requestSha256],
    ["noOpResponseHash", ({ transcript }) => transcript.noOp.responseSha256],
  ];
  for (const [, select] of selectors) {
    const values = transcripts.map(select);
    if (new Set(values).size !== D0_COMBINATIONS.length) fail("D0_TRANSCRIPT_IDENTITY_REUSE");
  }
}

function validateAdapterMetafile(value, adapter, bundleRoot, bundleFiles) {
  assertExactKeys(
    value,
    [
      "builder",
      "builderVersion",
      "entrypoint",
      "esbuildMetafileSha256",
      "inputs",
      "output",
      "schemaVersion",
      "taskId",
    ],
    "D0_ADAPTER_METAFILE_INVALID",
  );
  if (
    value.schemaVersion !== D0_ADAPTER_METAFILE_SCHEMA_VERSION ||
    value.taskId !== D0_TASK_ID ||
    value.entrypoint !== D0_PRODUCT_ADAPTER_ENTRYPOINT ||
    value.builder !== "esbuild" ||
    typeof value.builderVersion !== "string" ||
    value.builderVersion.length === 0 ||
    !isHash(value.esbuildMetafileSha256) ||
    !Array.isArray(value.inputs) ||
    value.inputs.length === 0
  ) {
    fail("D0_ADAPTER_METAFILE_INVALID");
  }
  validateArtifactReference(
    value.output,
    ADAPTER_BUNDLE_FILE,
    bundleRoot,
    [],
    "D0_ADAPTER_METAFILE_INVALID",
  );
  if (stable(value.output) !== stable(adapter.bundle)) fail("D0_ADAPTER_METAFILE_INVALID");
  const sourcePaths = new Set();
  const artifactPaths = new Set();
  for (let index = 0; index < value.inputs.length; index += 1) {
    const input = value.inputs[index];
    assertExactKeys(
      input,
      ["artifactPath", "sha256", "size", "sourcePath"],
      "D0_ADAPTER_METAFILE_INVALID",
    );
    if (
      typeof input.sourcePath !== "string" ||
      input.sourcePath.length === 0 ||
      input.sourcePath.includes("\\") ||
      isAbsolute(input.sourcePath) ||
      input.sourcePath.split("/").includes("..") ||
      sourcePaths.has(input.sourcePath) ||
      artifactPaths.has(input.artifactPath) ||
      !new RegExp(
        `^${ADAPTER_INPUT_DIRECTORY.replace("/", "\\/")}\\/${String(index).padStart(4, "0")}-[A-Za-z0-9._-]+$`,
      ).test(input.artifactPath)
    ) {
      fail("D0_ADAPTER_METAFILE_INVALID");
    }
    sourcePaths.add(input.sourcePath);
    artifactPaths.add(input.artifactPath);
    validateArtifactReference(
      {
        path: input.artifactPath,
        size: input.size,
        sha256: input.sha256,
      },
      input.artifactPath,
      bundleRoot,
      [],
      "D0_ADAPTER_METAFILE_INVALID",
    );
  }
  const actualInputFiles = bundleFiles.filter((path) =>
    path.startsWith(`${ADAPTER_INPUT_DIRECTORY}/`),
  );
  if (
    stable([...artifactPaths].sort()) !== stable(actualInputFiles.sort()) ||
    !sourcePaths.has(D0_PRODUCT_ADAPTER_ENTRYPOINT)
  )
    fail("D0_ADAPTER_METAFILE_INVALID");
  const entry = value.inputs.find(({ sourcePath }) => sourcePath === D0_PRODUCT_ADAPTER_ENTRYPOINT);
  if (entry.sha256 !== adapter.sourceSha256) fail("D0_ADAPTER_METAFILE_INVALID");
}

function validateRunnerArtifact(value, bundleRoot) {
  assertExactKeys(
    value,
    ["entrypoint", "schemaVersion", "sourceSha256", "sourceSize", "taskId"],
    "D0_RUNNER_ARTIFACT_INVALID",
  );
  const current = currentD0ProductProvenance().producer;
  const runnerPath = resolve(SCRIPT_DIRECTORY, "mvp15d-product-adapter-runner.mjs");
  const runnerStats = lstatSync(requireRegularFile(runnerPath, "D0_RUNNER_ARTIFACT_INVALID"));
  if (
    value.schemaVersion !== D0_RUNNER_ARTIFACT_SCHEMA_VERSION ||
    value.taskId !== D0_TASK_ID ||
    value.entrypoint !== D0_PRODUCT_RUNNER_ENTRYPOINT ||
    value.sourceSha256 !== current.sourceSha256 ||
    value.sourceSize !== runnerStats.size
  )
    fail("D0_RUNNER_ARTIFACT_INVALID");
  requireRegularFile(
    canonicalChild(bundleRoot, [RUNNER_ARTIFACT_FILE], "D0_RUNNER_ARTIFACT_INVALID"),
    "D0_RUNNER_ARTIFACT_INVALID",
  );
}

function validateAdapterArtifact(value, bundleRoot, bundleFiles) {
  assertExactKeys(
    value,
    [
      "bundle",
      "captureOrigin",
      "entrypoint",
      "metafile",
      "nativeBridge",
      "nativeBridgeSource",
      "producer",
      "provenance",
      "schemaVersion",
      "sourceSha256",
      "taskId",
    ],
    "D0_ADAPTER_ARTIFACT_INVALID",
  );
  if (
    value.schemaVersion !== D0_ADAPTER_ARTIFACT_SCHEMA_VERSION ||
    value.taskId !== D0_TASK_ID ||
    value.captureOrigin !== D0_CAPTURE_ORIGIN ||
    value.entrypoint !== D0_PRODUCT_ADAPTER_ENTRYPOINT ||
    !isHash(value.sourceSha256)
  )
    fail("D0_ADAPTER_ARTIFACT_INVALID");
  validateProducerProvenance(value.producer, value.provenance, "D0_PRODUCT_PRODUCER_INVALID");
  validateArtifactReference(
    value.bundle,
    ADAPTER_BUNDLE_FILE,
    bundleRoot,
    [],
    "D0_ADAPTER_ARTIFACT_INVALID",
  );
  validateArtifactReference(
    value.metafile,
    ADAPTER_METAFILE,
    bundleRoot,
    [],
    "D0_ADAPTER_ARTIFACT_INVALID",
  );
  validateArtifactReference(
    value.nativeBridge,
    NATIVE_BRIDGE_FILE,
    bundleRoot,
    ["profile"],
    "D0_ADAPTER_ARTIFACT_INVALID",
  );
  if (!["debug", "release"].includes(value.nativeBridge.profile))
    fail("D0_ADAPTER_ARTIFACT_INVALID");
  validateArtifactReference(
    value.nativeBridgeSource,
    NATIVE_BRIDGE_SOURCE_FILE,
    bundleRoot,
    ["entrypoint"],
    "D0_ADAPTER_ARTIFACT_INVALID",
  );
  if (
    value.nativeBridgeSource.entrypoint !==
      "apps/desktop/src-tauri/src/bin/mvp15d-native-invoke-bridge.rs" ||
    !isHash(value.nativeBridgeSource.sha256)
  )
    fail("D0_ADAPTER_ARTIFACT_INVALID");
  const metafile = readJsonFile(
    canonicalChild(bundleRoot, [ADAPTER_METAFILE], "D0_ADAPTER_METAFILE_INVALID"),
    "D0_ADAPTER_METAFILE_INVALID",
  );
  validateAdapterMetafile(metafile, value, bundleRoot, bundleFiles);
}

function validateRouteDecision(value, transcriptIndexSha256, transcripts) {
  assertExactKeys(
    value,
    [
      "basisTranscriptIndexSha256",
      "producer",
      "provenance",
      "schemaVersion",
      "selectedRoute",
      "taskId",
    ],
    "D0_ROUTE_DECISION_INVALID",
  );
  if (
    value.schemaVersion !== D0_ROUTE_DECISION_SCHEMA_VERSION ||
    value.taskId !== D0_TASK_ID ||
    value.basisTranscriptIndexSha256 !== transcriptIndexSha256 ||
    value.selectedRoute !== "direct"
  )
    fail("D0_ROUTE_DECISION_INVALID");
  validateProducerProvenance(value.producer, value.provenance, "D0_PRODUCT_PRODUCER_INVALID");
  if (!transcripts.every(({ transcript }) => transcript.closeout.completed === true))
    fail("D0_ROUTE_DECISION_INVALID");
  for (const { transcript } of transcripts.filter(
    ({ combination }) => combination.route === value.selectedRoute,
  )) {
    try {
      validateD0DirectInventory(transcript.inventory.toolNames);
      for (const phase of ["refresh", "reconnect", "editorRestart"]) {
        validateD0DirectInventory(transcript.lifecycle[phase].publication.inventory.toolNames);
      }
    } catch {
      fail("D0_ROUTE_DECISION_INVENTORY_CONFLICT");
    }
  }
}

function parseArgs(argv) {
  const supported = new Set(["task-root"]);
  const args = Object.create(null);
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) fail("D0_ARGUMENT_INVALID");
    const key = item.slice(2);
    const value = argv[index + 1];
    if (!supported.has(key) || Object.hasOwn(args, key) || !value || value.startsWith("--"))
      fail("D0_ARGUMENT_INVALID");
    args[key] = value;
    index += 1;
  }
  return args;
}

/** Verify, but never sign or create, a supervisor-readable D0 hash index. */
export function validateTaskOwnedD0Bundle({ taskRoot: taskRootArgument }) {
  const taskRoot = resolveTaskOwnedD0Root(taskRootArgument);
  const bundleRoot = requireDirectory(
    canonicalChild(taskRoot, [BUNDLE_DIRECTORY], "D0_PRODUCT_RUN_EVIDENCE_REQUIRED"),
    "D0_PRODUCT_RUN_EVIDENCE_REQUIRED",
  );
  const transcriptRoot = requireDirectory(
    canonicalChild(bundleRoot, [TRANSCRIPT_DIRECTORY], "D0_PRODUCT_RUN_EVIDENCE_REQUIRED"),
    "D0_PRODUCT_RUN_EVIDENCE_REQUIRED",
  );
  const files = walkBundleFiles(bundleRoot);
  const fixedFiles = new Set([
    EVIDENCE_FILE,
    ADAPTER_ARTIFACT_FILE,
    ROUTE_DECISION_FILE,
    RUNNER_ARTIFACT_FILE,
    ADAPTER_METAFILE,
    ADAPTER_BUNDLE_FILE,
    NATIVE_BRIDGE_FILE,
    NATIVE_BRIDGE_SOURCE_FILE,
    ...D0_COMBINATIONS.map(({ id }) => `${TRANSCRIPT_DIRECTORY}/${id}.json`),
  ]);
  if (
    files.directories.size !== 4 ||
    !files.directories.has(TRANSCRIPT_DIRECTORY) ||
    !files.directories.has(ARTIFACT_DIRECTORY) ||
    !files.directories.has(ADAPTER_INPUT_DIRECTORY) ||
    files.files.some(
      (file) => !fixedFiles.has(file) && !file.startsWith(`${ADAPTER_INPUT_DIRECTORY}/`),
    )
  ) {
    fail("D0_BUNDLE_ARTIFACT_INVALID");
  }

  const adapterPath = canonicalChild(
    bundleRoot,
    [ADAPTER_ARTIFACT_FILE],
    "D0_ADAPTER_ARTIFACT_INVALID",
  );
  const adapter = readJsonFile(
    requireRegularFile(adapterPath, "D0_ADAPTER_ARTIFACT_INVALID"),
    "D0_ADAPTER_ARTIFACT_INVALID",
  );
  validateAdapterArtifact(adapter, bundleRoot, files.files);
  const runnerArtifactPath = canonicalChild(
    bundleRoot,
    [RUNNER_ARTIFACT_FILE],
    "D0_RUNNER_ARTIFACT_INVALID",
  );
  const runnerArtifact = readJsonFile(
    requireRegularFile(runnerArtifactPath, "D0_RUNNER_ARTIFACT_INVALID"),
    "D0_RUNNER_ARTIFACT_INVALID",
  );
  validateRunnerArtifact(runnerArtifact, bundleRoot);
  const transcripts = D0_COMBINATIONS.map((combination) => {
    const path = canonicalChild(
      transcriptRoot,
      [`${combination.id}.json`],
      "D0_RAW_TRANSCRIPT_REQUIRED",
    );
    requireRegularFile(path, "D0_RAW_TRANSCRIPT_REQUIRED");
    const transcript = readJsonFile(path, "D0_RAW_TRANSCRIPT_JSON_INVALID");
    validateTranscript(transcript, combination);
    return { combination, path, transcript, sha256: sha256File(path) };
  });
  validateIndependentTranscripts(transcripts);
  const index = transcriptIndex(transcripts);
  const transcriptIndexSha256 = sha256Bytes(stable(index));
  const routePath = canonicalChild(bundleRoot, [ROUTE_DECISION_FILE], "D0_ROUTE_DECISION_INVALID");
  requireRegularFile(routePath, "D0_ROUTE_DECISION_INVALID");
  const routeDecision = readJsonFile(routePath, "D0_ROUTE_DECISION_JSON_INVALID");
  validateRouteDecision(routeDecision, transcriptIndexSha256, transcripts);

  const evidencePath = canonicalChild(
    bundleRoot,
    [EVIDENCE_FILE],
    "D0_PRODUCT_RUN_EVIDENCE_REQUIRED",
  );
  requireRegularFile(evidencePath, "D0_PRODUCT_RUN_EVIDENCE_REQUIRED");
  const evidence = readJsonFile(evidencePath, "D0_EVIDENCE_JSON_INVALID");
  assertExactKeys(
    evidence,
    [
      "adapterArtifactSha256",
      "artifacts",
      "captureOrigin",
      "captureVerification",
      "combinations",
      "producer",
      "provenance",
      "routeDecisionSha256",
      "schemaVersion",
      "taskId",
      "transcriptIndexSha256",
    ],
    "D0_EVIDENCE_FIELDS_INVALID",
  );
  validateProducerProvenance(evidence.producer, evidence.provenance, "D0_PRODUCT_PRODUCER_INVALID");
  assertExactKeys(
    evidence.captureVerification,
    ["destinationRecomputed", "sourceReadMode"],
    "D0_EVIDENCE_FIELDS_INVALID",
  );
  if (
    evidence.captureVerification.destinationRecomputed !== true ||
    evidence.captureVerification.sourceReadMode !== "single_open_file_descriptor"
  )
    fail("D0_EVIDENCE_FIELDS_INVALID");
  const actualArtifacts = files.files
    .filter((path) => path !== EVIDENCE_FILE)
    .map((path) =>
      indexedArtifact(
        canonicalChild(bundleRoot, path.split("/"), "D0_INDEXED_ARTIFACT_INVALID"),
        path,
      ),
    )
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  if (
    evidence.schemaVersion !== D0_EVIDENCE_SCHEMA_VERSION ||
    evidence.taskId !== D0_TASK_ID ||
    evidence.captureOrigin !== D0_CAPTURE_ORIGIN ||
    evidence.adapterArtifactSha256 !== sha256File(adapterPath) ||
    evidence.transcriptIndexSha256 !== transcriptIndexSha256 ||
    evidence.routeDecisionSha256 !== sha256File(routePath) ||
    stable(evidence.combinations) !== stable(index) ||
    stable(evidence.artifacts) !== stable(actualArtifacts)
  )
    fail("D0_EVIDENCE_FIELDS_INVALID");
  return { selectedRoute: routeDecision.selectedRoute, transcriptIndexSha256, combinations: index };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args["task-root"]) fail("D0_PRODUCT_RUN_EVIDENCE_REQUIRED");
    const result = validateTaskOwnedD0Bundle({ taskRoot: args["task-root"] });
    console.log(
      JSON.stringify({
        status: "validated_hash_indexed_product_adapter_evidence",
        schemaVersion: D0_EVIDENCE_SCHEMA_VERSION,
        taskId: D0_TASK_ID,
        selectedRoute: result.selectedRoute,
        combinations: result.combinations.map(({ id }) => id),
        transcriptIndexSha256: result.transcriptIndexSha256,
        mutationCount: 0,
      }),
    );
  } catch (error) {
    const reason = error instanceof EvidenceError ? error.code : "D0_EVIDENCE_VALIDATION_FAILED";
    console.error(JSON.stringify({ status: "d0_evidence_rejected", reason, mutationCount: 0 }));
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
