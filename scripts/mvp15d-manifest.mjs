#!/usr/bin/env node
/* global console, process */

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUILD_COMMAND_SCHEMA,
  buildCommandLedger,
  deriveGitFacts,
  orderedBuildArguments,
  readEngineIdentity,
  stable,
} from "./mvp15d-plugin-build.mjs";
import {
  PRODUCTION_AUTHORITY_SCHEMA,
  PRODUCTION_ORIGIN,
} from "./mvp15d-loaded-module-observer.mjs";

const MANIFEST_SCHEMA = "uagent.ue-companion-plugin.build-manifest.v3";
const BUILD_RESULT_SCHEMA = "uagent.mvp15d.final.build-result.v4";
const LOADED_LEDGER_SCHEMA = "uagent.mvp15d.final.loaded-modules.v2";
const TASK_GENERATION = "final-d13-d16";
const TOOL_NAMES = [
  "ue.asset.create_folder",
  "ue.asset.duplicate",
  "ue.asset.rename",
  "ue.asset.move",
  "ue.asset.delete",
  "ue.asset.save",
];
const MANIFEST_NAME = "UAgentAssetTools.build.json";
const UPLUGIN_RELATIVE_PATH = "UAgentAssetTools.uplugin";
const SCHEMA_RELATIVE_PATH = "Resources/uagent-asset-tools.schema.json";
const MODULE_INDEX_RELATIVE_PATH = "Binaries/Win64/UnrealEditor.modules";
const MODULE_DIRECTORY_RELATIVE_PATH = "Binaries/Win64";

class ToolingError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new ToolingError(code);
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

function isHex(value, length = 64) {
  return typeof value === "string" && new RegExp(`^[0-9a-f]{${length}}$`).test(value);
}

function isWithin(root, candidate) {
  const pathRelative = relative(root, candidate);
  return pathRelative === "" || (!pathRelative.startsWith("..") && !isAbsolute(pathRelative));
}

function toLogical(value) {
  return value.split("\\").join("/");
}

function assertExactKeys(value, expected, code) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(code);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(code);
  }
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

function samePath(left, right) {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function requireContainedRegularFile(root, candidate, code) {
  const trusted = requireDirectory(resolve(root), code);
  const leaf = resolve(candidate);
  if (!isWithin(trusted, leaf)) fail(code);
  const logical = relative(trusted, leaf);
  if (
    !logical ||
    isAbsolute(logical) ||
    logical.split(/[\\/]/u).some((part) => !part || part === "..")
  ) {
    fail(code);
  }
  let current = trusted;
  const components = logical.split(/[\\/]/u);
  for (let index = 0; index < components.length; index += 1) {
    current = resolve(current, components[index]);
    if (!existsSync(current)) fail(code);
    const stats = lstatSync(current);
    if (stats.isSymbolicLink()) fail(code);
    if (index === components.length - 1 ? !stats.isFile() : !stats.isDirectory()) fail(code);
  }
  const canonicalRoot = realpathSync.native(trusted);
  const canonicalLeaf = realpathSync.native(leaf);
  if (!isWithin(canonicalRoot, canonicalLeaf) || !samePath(canonicalLeaf, leaf)) fail(code);
  return leaf;
}

function parseArgs(argv) {
  const supported = new Set([
    "source",
    "package-root",
    "runuat",
    "ue-root",
    "manifest",
    "builder",
    "builder-kind",
    "build-ledger",
    "build-result",
    "project-root",
    "loaded-ledger",
    "engine-plugin-root",
    "user-plugin-root",
  ]);
  const args = Object.create(null);
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) fail("MANIFEST_ARGUMENT_INVALID");
    const key = item.slice(2);
    if (!supported.has(key) || Object.hasOwn(args, key)) {
      fail("MANIFEST_ARGUMENT_INVALID");
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail("MANIFEST_ARGUMENT_INVALID");
    args[key] = value;
    index += 1;
  }
  return args;
}

function readJson(path, code) {
  requireRegularFile(path, code);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(code);
  }
}

function artifact(packageRoot, logicalPath) {
  if (
    typeof logicalPath !== "string" ||
    !logicalPath ||
    logicalPath.includes("\\") ||
    logicalPath.startsWith("/") ||
    logicalPath.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    fail("PACKAGE_ARTIFACT_PATH_INVALID");
  }
  const absolutePath = resolve(packageRoot, logicalPath.split("/").join("\\"));
  if (!isWithin(packageRoot, absolutePath)) {
    fail("PACKAGE_ARTIFACT_PATH_INVALID");
  }
  requireRegularFile(absolutePath, "PACKAGE_ARTIFACT_MISSING");
  return {
    path: logicalPath,
    size: lstatSync(absolutePath).size,
    sha256: sha256File(absolutePath),
  };
}

function assertNoSensitiveBytes(path) {
  const bytes = readFileSync(path);
  const text = bytes.toString("latin1");
  if (
    /[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/]/i.test(text) ||
    /\b(?:authorization|password|secret|api[-_]?key|bearer)\s*[:=]\s*[^\s"'\\]{4,}/i.test(text) ||
    /https?:\/\/[^/\s:@]+:[^/\s@]+@/i.test(text)
  ) {
    fail("PACKAGE_SECRET_OR_USER_PATH_DETECTED");
  }
}

function walkPackage(root, current = "", state) {
  const output = state ?? {
    files: [],
    directories: new Set([""]),
    folded: new Map(),
  };
  const directory = requireDirectory(
    resolve(root, current.split("/").join("\\")),
    "PACKAGE_DIRECTORY_INVALID",
  );
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name, "en"),
  );
  for (const entry of entries) {
    if (!entry.name || entry.name === "." || entry.name === ".." || entry.isSymbolicLink()) {
      fail("PACKAGE_LINK_OR_REPARSE_INVALID");
    }
    const logicalPath = current ? `${current}/${entry.name}` : entry.name;
    const folded = logicalPath.toLowerCase();
    if (output.folded.has(folded)) fail("PACKAGE_CASE_COLLISION");
    output.folded.set(folded, logicalPath);
    const absolutePath = resolve(root, logicalPath.split("/").join("\\"));
    if (!isWithin(root, absolutePath)) fail("PACKAGE_PATH_ESCAPE");
    const stats = lstatSync(absolutePath);
    if (stats.isSymbolicLink()) fail("PACKAGE_LINK_OR_REPARSE_INVALID");
    if (entry.isDirectory() && stats.isDirectory()) {
      output.directories.add(logicalPath);
      walkPackage(root, logicalPath, output);
    } else if (entry.isFile() && stats.isFile()) {
      assertNoSensitiveBytes(absolutePath);
      output.files.push(logicalPath);
    } else {
      fail("PACKAGE_SPECIAL_FILE_INVALID");
    }
  }
  return output;
}

function collectPackageArtifacts(packageRoot, manifestPresent) {
  if (
    basename(packageRoot).toLowerCase() === "hostproject" ||
    existsSync(resolve(packageRoot, "HostProject.uproject"))
  ) {
    fail("PACKAGE_PARTIAL_HOST_PROJECT_REJECTED");
  }
  const walked = walkPackage(packageRoot);
  const modules = walked.files.filter(
    (path) =>
      path.startsWith(`${MODULE_DIRECTORY_RELATIVE_PATH}/`) &&
      /^Binaries\/Win64\/UnrealEditor-[A-Za-z0-9_.-]+\.dll$/.test(path),
  );
  if (modules.length === 0) fail("PACKAGE_MODULE_LIST_MISSING");
  const allowed = new Set([
    UPLUGIN_RELATIVE_PATH,
    SCHEMA_RELATIVE_PATH,
    MODULE_INDEX_RELATIVE_PATH,
    ...modules,
  ]);
  if (manifestPresent) allowed.add(MANIFEST_NAME);
  for (const path of walked.files) {
    if (/(?:^|\/)(?:Source|Intermediate|HostProject)(?:\/|$)/i.test(path) || !allowed.has(path)) {
      fail("PACKAGE_ARTIFACT_EXTRA_OR_FORBIDDEN");
    }
  }
  for (const path of allowed) {
    if (!walked.files.includes(path)) fail("PACKAGE_ARTIFACT_MISSING");
  }
  const expectedDirectories = new Set([
    "",
    "Binaries",
    MODULE_DIRECTORY_RELATIVE_PATH,
    "Resources",
  ]);
  if (
    walked.directories.size !== expectedDirectories.size ||
    [...walked.directories].some((directory) => !expectedDirectories.has(directory))
  ) {
    fail("PACKAGE_DIRECTORY_EXTRA_OR_MISSING");
  }
  const artifacts = walked.files
    .filter((path) => path !== MANIFEST_NAME)
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((path) => artifact(packageRoot, path));
  return {
    artifacts,
    modules: artifacts.filter((item) =>
      /^Binaries\/Win64\/UnrealEditor-[A-Za-z0-9_.-]+\.dll$/.test(item.path),
    ),
  };
}

function validateModuleIndex(packageRoot, modules, expectedModuleBuildId) {
  const index = readJson(
    resolve(packageRoot, MODULE_INDEX_RELATIVE_PATH.split("/").join("\\")),
    "PACKAGE_MODULE_INDEX_INVALID",
  );
  assertExactKeys(index, ["BuildId", "Modules"], "PACKAGE_MODULE_INDEX_INVALID");
  if (index.BuildId !== expectedModuleBuildId) fail("PACKAGE_MODULE_INDEX_INVALID");
  const expected = Object.create(null);
  for (const module of modules) {
    const name = basename(module.path).match(/^UnrealEditor-([A-Za-z0-9_.-]+)\.dll$/)?.[1];
    if (!name || Object.hasOwn(expected, name)) {
      fail("PACKAGE_MODULE_INDEX_INVALID");
    }
    expected[name] = basename(module.path);
  }
  assertExactKeys(index.Modules, Object.keys(expected), "PACKAGE_MODULE_INDEX_INVALID");
  for (const [name, file] of Object.entries(expected)) {
    if (index.Modules[name] !== file) fail("PACKAGE_MODULE_INDEX_INVALID");
  }
}

function commandLedgerFingerprint(ledger) {
  const basis = { ...ledger };
  delete basis.commandFingerprint;
  return sha256Bytes(Buffer.from(stable(basis), "utf8"));
}

function validateSourceArtifact(evidenceRoot, value) {
  const hasObservedRaw =
    Object.hasOwn(value ?? {}, "observedRawSize") ||
    Object.hasOwn(value ?? {}, "observedRawSha256");
  assertExactKeys(
    value,
    hasObservedRaw
      ? [
          "relativePath",
          "size",
          "sha256",
          "capturedAt",
          "producer",
          "redactionStatus",
          "observedRawSize",
          "observedRawSha256",
        ]
      : ["relativePath", "size", "sha256", "capturedAt", "producer", "redactionStatus"],
    "BUILD_SOURCE_ARTIFACT_INVALID",
  );
  if (
    typeof value.relativePath !== "string" ||
    value.relativePath.includes("\\") ||
    value.relativePath.startsWith("/") ||
    value.relativePath.split("/").some((part) => !part || part === "." || part === "..") ||
    !Number.isSafeInteger(value.size) ||
    value.size < 0 ||
    !isHex(value.sha256) ||
    typeof value.capturedAt !== "string" ||
    Number.isNaN(Date.parse(value.capturedAt)) ||
    value.producer !== "mvp15d-plugin-build" ||
    value.redactionStatus !== "deterministically-redacted" ||
    (hasObservedRaw &&
      (!Number.isSafeInteger(value.observedRawSize) ||
        value.observedRawSize < 0 ||
        !isHex(value.observedRawSha256)))
  ) {
    fail("BUILD_SOURCE_ARTIFACT_INVALID");
  }
  const path = resolve(evidenceRoot, value.relativePath.split("/").join("\\"));
  if (
    !isWithin(evidenceRoot, path) ||
    lstatSync(requireRegularFile(path, "BUILD_SOURCE_ARTIFACT_MISSING")).size !== value.size ||
    sha256File(path) !== value.sha256
  ) {
    fail("BUILD_SOURCE_ARTIFACT_HASH_MISMATCH");
  }
}

function validateBuildEvidence(args, provenance, packageRoot, plugin) {
  if (!args["build-ledger"] || !args["build-result"]) {
    fail("MANIFEST_BUILD_EVIDENCE_REQUIRED");
  }
  const ledgerPath = resolve(args["build-ledger"]);
  const resultPath = resolve(args["build-result"]);
  const evidenceRoot = resolve(ledgerPath, "..", "..");
  if (
    !isWithin(evidenceRoot, packageRoot) ||
    resolve(resultPath, "..", "..") !== evidenceRoot ||
    toLogical(relative(evidenceRoot, ledgerPath)) !== "metadata/build-command.json" ||
    toLogical(relative(evidenceRoot, resultPath)) !== "metadata/build-result.json"
  ) {
    fail("MANIFEST_BUILD_EVIDENCE_LOCATION_INVALID");
  }
  const ledger = readJson(ledgerPath, "MANIFEST_BUILD_LEDGER_INVALID");
  assertExactKeys(
    ledger,
    [
      "schemaVersion",
      "taskGeneration",
      "taskId",
      "launcher",
      "orderedArgumentsSha256",
      "sourceCommit",
      "sourceTreeSha256",
      "pluginDescriptor",
      "packageOutputIdentity",
      "targetPlatform",
      "configuration",
      "engineIdentity",
      "orderedArguments",
      "toolchainFacts",
      "commandFingerprint",
    ],
    "MANIFEST_BUILD_LEDGER_INVALID",
  );
  assertExactKeys(ledger.launcher, ["basename", "size", "sha256"], "MANIFEST_BUILD_LEDGER_INVALID");
  assertExactKeys(
    ledger.pluginDescriptor,
    ["relativePath", "size", "sha256"],
    "MANIFEST_BUILD_LEDGER_INVALID",
  );
  assertExactKeys(
    ledger.toolchainFacts,
    [
      "engineVersion",
      "engineChangelist",
      "compatibleChangelist",
      "moduleBuildId",
      "compilerName",
      "compilerVersion",
      "sdkName",
      "sdkVersion",
    ],
    "MANIFEST_BUILD_LEDGER_INVALID",
  );
  assertExactKeys(
    ledger.engineIdentity,
    [
      "engineVersion",
      "engineChangelist",
      "compatibleChangelist",
      "moduleBuildId",
      "branch",
      "buildVersion",
      "engineModuleManifest",
    ],
    "MANIFEST_BUILD_LEDGER_INVALID",
  );
  assertExactKeys(
    ledger.engineIdentity.buildVersion,
    ["relativePath", "size", "sha256"],
    "MANIFEST_BUILD_LEDGER_INVALID",
  );
  assertExactKeys(
    ledger.engineIdentity.engineModuleManifest,
    ["relativePath", "size", "sha256"],
    "MANIFEST_BUILD_LEDGER_INVALID",
  );
  if (
    ledger.schemaVersion !== BUILD_COMMAND_SCHEMA ||
    ledger.taskGeneration !== TASK_GENERATION ||
    !ledger.toolchainFacts ||
    ledger.toolchainFacts.engineVersion !== "5.8.1" ||
    ledger.toolchainFacts.engineChangelist !== 56057345 ||
    ledger.toolchainFacts.compatibleChangelist !== 55116800 ||
    ledger.toolchainFacts.moduleBuildId !== "55116800" ||
    ledger.engineIdentity.engineVersion !== ledger.toolchainFacts.engineVersion ||
    ledger.engineIdentity.engineChangelist !== ledger.toolchainFacts.engineChangelist ||
    ledger.engineIdentity.compatibleChangelist !== ledger.toolchainFacts.compatibleChangelist ||
    ledger.engineIdentity.moduleBuildId !== ledger.toolchainFacts.moduleBuildId ||
    ledger.toolchainFacts.compilerName !== "MSVC" ||
    ledger.toolchainFacts.sdkName !== "Windows SDK" ||
    ledger.commandFingerprint !== commandLedgerFingerprint(ledger)
  ) {
    fail("MANIFEST_BUILD_LEDGER_INVALID");
  }
  const runUat = requireRegularFile(resolve(args.runuat), "RUNUAT_FILE_INVALID");
  if (basename(runUat).toLowerCase() !== "runuat.bat") {
    fail("RUNUAT_BASENAME_INVALID");
  }
  const engineIdentity = readEngineIdentity(args["ue-root"], runUat);
  if (stable(engineIdentity) !== stable(ledger.engineIdentity)) {
    fail("MANIFEST_ENGINE_IDENTITY_RECOMPUTE_MISMATCH");
  }
  const orderedArguments = orderedBuildArguments(plugin, packageRoot);
  const expectedBase = buildCommandLedger({
    taskId: ledger.taskId,
    runUat,
    orderedArguments,
    provenance,
    plugin,
    packageRoot,
    engineIdentity,
  });
  for (const key of Object.keys(expectedBase)) {
    if (key !== "commandFingerprint" && stable(ledger[key]) !== stable(expectedBase[key])) {
      fail("MANIFEST_BUILD_LEDGER_RECOMPUTE_MISMATCH");
    }
  }
  const result = readJson(resultPath, "MANIFEST_BUILD_RESULT_INVALID");
  assertExactKeys(
    result,
    [
      "schemaVersion",
      "taskGeneration",
      "taskMarkerSha256",
      "status",
      "reason",
      "commandFingerprint",
      "childPidBindingSha256",
      "childExitCode",
      "wrapperExitCode",
      "sourceArtifacts",
      "packagePresent",
      "successManifestPresent",
      "closeout",
    ],
    "MANIFEST_BUILD_RESULT_INVALID",
  );
  assertExactKeys(
    result.closeout,
    ["wrapperPidBindingSha256", "childExited", "taskOwnedResidualCount"],
    "MANIFEST_BUILD_RESULT_INVALID",
  );
  if (
    result.schemaVersion !== BUILD_RESULT_SCHEMA ||
    result.taskGeneration !== TASK_GENERATION ||
    result.status !== "build_completed" ||
    result.reason !== null ||
    result.commandFingerprint !== ledger.commandFingerprint ||
    !isHex(result.taskMarkerSha256) ||
    (result.childPidBindingSha256 !== null && !isHex(result.childPidBindingSha256)) ||
    !isHex(result.closeout?.wrapperPidBindingSha256) ||
    result.childExitCode !== 0 ||
    result.wrapperExitCode !== 0 ||
    result.packagePresent !== true ||
    result.successManifestPresent !== false ||
    result.closeout?.childExited !== true ||
    result.closeout?.taskOwnedResidualCount !== 0 ||
    !Array.isArray(result.sourceArtifacts) ||
    result.sourceArtifacts.length === 0
  ) {
    fail("MANIFEST_BUILD_RESULT_INVALID");
  }
  for (const sourceArtifact of result.sourceArtifacts) {
    validateSourceArtifact(evidenceRoot, sourceArtifact);
  }
  if (result.sourceArtifacts.every(({ size }) => size === 0)) {
    fail("MANIFEST_BUILD_TRANSCRIPT_EMPTY");
  }
  return {
    evidenceRoot,
    ledger,
    result,
    evidenceArtifacts: [
      {
        path: "metadata/build-command.json",
        size: lstatSync(ledgerPath).size,
        sha256: sha256File(ledgerPath),
      },
      {
        path: "metadata/build-result.json",
        size: lstatSync(resultPath).size,
        sha256: sha256File(resultPath),
      },
      ...result.sourceArtifacts.map(({ relativePath, size, sha256 }) => ({
        path: relativePath,
        size,
        sha256,
      })),
    ],
  };
}

function manifestSelfHash(manifest) {
  const value = { ...manifest };
  delete value.manifestSelfSha256;
  return sha256Bytes(Buffer.from(stable(value), "utf8"));
}

function validateArtifactRecord(value, code) {
  assertExactKeys(value, ["path", "size", "sha256"], code);
  if (
    typeof value.path !== "string" ||
    value.path.includes("\\") ||
    value.path.startsWith("/") ||
    value.path.split("/").some((part) => !part || part === "." || part === "..") ||
    !Number.isSafeInteger(value.size) ||
    value.size < 0 ||
    !isHex(value.sha256)
  ) {
    fail(code);
  }
}

function validateManifestShape(manifest) {
  assertExactKeys(
    manifest,
    [
      "schemaVersion",
      "taskGeneration",
      "taskId",
      "pluginId",
      "pluginVersion",
      "contractVersion",
      "sourceCommit",
      "sourceTreeSha256",
      "physicalFixtures",
      "dirty",
      "engineVersion",
      "engineChangelist",
      "compatibleChangelist",
      "moduleBuildId",
      "targetPlatform",
      "configuration",
      "compiler",
      "windowsSdk",
      "buildCommandFingerprint",
      "buildEvidenceArtifacts",
      "artifacts",
      "modules",
      "toolNames",
      "generatedAt",
      "builder",
      "manifestSelfSha256",
    ],
    "MANIFEST_FIELDS_INVALID",
  );
  if (
    manifest.schemaVersion !== MANIFEST_SCHEMA ||
    manifest.taskGeneration !== TASK_GENERATION ||
    !/^TASK-MVP15D-[A-Z0-9-]+$/.test(manifest.taskId) ||
    manifest.pluginId !== "UAgentAssetTools" ||
    manifest.pluginVersion !== "0.1.0" ||
    manifest.contractVersion !== "mvp15d.asset-tools.v1" ||
    !isHex(manifest.sourceCommit, 40) ||
    !isHex(manifest.sourceTreeSha256) ||
    manifest.dirty !== false ||
    manifest.engineVersion !== "5.8.1" ||
    manifest.engineChangelist !== 56057345 ||
    manifest.compatibleChangelist !== 55116800 ||
    manifest.moduleBuildId !== "55116800" ||
    manifest.targetPlatform !== "Win64" ||
    manifest.configuration !== "Development" ||
    manifest.compiler?.name !== "MSVC" ||
    typeof manifest.compiler?.version !== "string" ||
    manifest.windowsSdk?.name !== "Windows SDK" ||
    typeof manifest.windowsSdk?.version !== "string" ||
    !isHex(manifest.buildCommandFingerprint) ||
    stable(manifest.toolNames) !== stable(TOOL_NAMES) ||
    typeof manifest.generatedAt !== "string" ||
    Number.isNaN(Date.parse(manifest.generatedAt)) ||
    !isHex(manifest.manifestSelfSha256) ||
    manifest.manifestSelfSha256 !== manifestSelfHash(manifest)
  ) {
    fail("MANIFEST_FIELDS_INVALID");
  }
  assertExactKeys(manifest.compiler, ["name", "version"], "MANIFEST_FIELDS_INVALID");
  assertExactKeys(manifest.windowsSdk, ["name", "version"], "MANIFEST_FIELDS_INVALID");
  if (
    !Array.isArray(manifest.physicalFixtures) ||
    manifest.physicalFixtures.length !== 2 ||
    !Array.isArray(manifest.artifacts) ||
    manifest.artifacts.length < 4 ||
    !Array.isArray(manifest.modules) ||
    manifest.modules.length < 1 ||
    !Array.isArray(manifest.buildEvidenceArtifacts) ||
    manifest.buildEvidenceArtifacts.length < 3
  ) {
    fail("MANIFEST_FIELDS_INVALID");
  }
  for (const collection of [
    manifest.physicalFixtures,
    manifest.artifacts,
    manifest.modules,
    manifest.buildEvidenceArtifacts,
  ]) {
    const folded = new Set();
    for (const item of collection) {
      if (collection === manifest.physicalFixtures) {
        assertExactKeys(
          item,
          ["path", "size", "sha256", "gitObjectSha256"],
          "MANIFEST_PHYSICAL_FIXTURE_INVALID",
        );
        if (
          typeof item.path !== "string" ||
          item.path.includes("\\") ||
          item.path.startsWith("/") ||
          item.path.split("/").some((part) => !part || part === "." || part === "..") ||
          !Number.isSafeInteger(item.size) ||
          item.size < 0 ||
          !isHex(item.sha256) ||
          !isHex(item.gitObjectSha256)
        ) {
          fail("MANIFEST_PHYSICAL_FIXTURE_INVALID");
        }
      } else {
        validateArtifactRecord(item, "MANIFEST_ARTIFACT_INVALID");
      }
      const key = item.path.toLowerCase();
      if (folded.has(key)) fail("MANIFEST_ARTIFACT_DUPLICATE");
      folded.add(key);
    }
  }
  assertExactKeys(manifest.builder, ["kind", "name"], "MANIFEST_BUILDER_INVALID");
  if (
    !["local", "ci"].includes(manifest.builder.kind) ||
    typeof manifest.builder.name !== "string" ||
    !/^[A-Za-z0-9._ -]+$/.test(manifest.builder.name) ||
    manifest.builder.name.trim() !== manifest.builder.name
  ) {
    fail("MANIFEST_BUILDER_INVALID");
  }
  return manifest;
}

function resolveManifestPath(packageRoot, manifestArgument) {
  const expected = resolve(packageRoot, MANIFEST_NAME);
  const actual = manifestArgument ? resolve(manifestArgument) : expected;
  if (actual !== expected) fail("MANIFEST_PATH_NONCANONICAL");
  return expected;
}

function commonInputs(args, manifestPresent) {
  if (
    !args.source ||
    !args["package-root"] ||
    !args.runuat ||
    !args["ue-root"] ||
    !args["build-ledger"] ||
    !args["build-result"]
  ) {
    fail("MANIFEST_ARGUMENT_REQUIRED");
  }
  const packageRoot = requireDirectory(resolve(args["package-root"]), "PACKAGE_ROOT_INVALID");
  const provenance = deriveGitFacts(args.source);
  const plugin = requireRegularFile(
    resolve(
      provenance.sourceRoot,
      "integrations",
      "unreal",
      "UAgentAssetTools",
      UPLUGIN_RELATIVE_PATH,
    ),
    "SOURCE_PLUGIN_MISSING",
  );
  const build = validateBuildEvidence(args, provenance, packageRoot, plugin);
  const collected = collectPackageArtifacts(packageRoot, manifestPresent);
  validateModuleIndex(packageRoot, collected.modules, build.ledger.toolchainFacts.moduleBuildId);
  const packagedDescriptor = collected.artifacts.find(({ path }) => path === UPLUGIN_RELATIVE_PATH);
  const sourceSchema = requireRegularFile(
    resolve(
      provenance.sourceRoot,
      "integrations",
      "unreal",
      "UAgentAssetTools",
      SCHEMA_RELATIVE_PATH.split("/").join("\\"),
    ),
    "SOURCE_SCHEMA_MISSING",
  );
  const packagedSchema = collected.artifacts.find(({ path }) => path === SCHEMA_RELATIVE_PATH);
  if (
    packagedDescriptor?.sha256 !== sha256File(plugin) ||
    packagedSchema?.sha256 !== sha256File(sourceSchema)
  ) {
    fail("PACKAGE_SOURCE_ARTIFACT_MISMATCH");
  }
  return { packageRoot, provenance, plugin, build, collected };
}

function create(args) {
  const inputs = commonInputs(args, false);
  const manifestPath = resolveManifestPath(inputs.packageRoot, args.manifest);
  if (existsSync(manifestPath)) fail("MANIFEST_ALREADY_EXISTS");
  const builderKind = args["builder-kind"] ?? "local";
  const builderName = args.builder ?? "uagent-mvp15d-final";
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA,
    taskGeneration: TASK_GENERATION,
    taskId: inputs.build.ledger.taskId,
    pluginId: "UAgentAssetTools",
    pluginVersion: "0.1.0",
    contractVersion: "mvp15d.asset-tools.v1",
    sourceCommit: inputs.provenance.sourceCommit,
    sourceTreeSha256: inputs.provenance.sourceTreeSha256,
    physicalFixtures: inputs.provenance.physicalFixtures,
    dirty: false,
    engineVersion: inputs.build.ledger.toolchainFacts.engineVersion,
    engineChangelist: inputs.build.ledger.toolchainFacts.engineChangelist,
    compatibleChangelist: inputs.build.ledger.toolchainFacts.compatibleChangelist,
    moduleBuildId: inputs.build.ledger.toolchainFacts.moduleBuildId,
    targetPlatform: inputs.build.ledger.targetPlatform,
    configuration: inputs.build.ledger.configuration,
    compiler: {
      name: inputs.build.ledger.toolchainFacts.compilerName,
      version: inputs.build.ledger.toolchainFacts.compilerVersion,
    },
    windowsSdk: {
      name: inputs.build.ledger.toolchainFacts.sdkName,
      version: inputs.build.ledger.toolchainFacts.sdkVersion,
    },
    buildCommandFingerprint: inputs.build.ledger.commandFingerprint,
    buildEvidenceArtifacts: inputs.build.evidenceArtifacts,
    artifacts: inputs.collected.artifacts,
    modules: inputs.collected.modules,
    toolNames: TOOL_NAMES,
    generatedAt: new Date().toISOString(),
    builder: { kind: builderKind, name: builderName },
  };
  const output = {
    ...manifest,
    manifestSelfSha256: manifestSelfHash(manifest),
  };
  validateManifestShape(output);
  writeFileSync(manifestPath, `${JSON.stringify(output, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  collectPackageArtifacts(inputs.packageRoot, true);
  return {
    status: "manifest_created",
    manifestSelfSha256: output.manifestSelfSha256,
    manifestFileSha256: sha256File(manifestPath),
    sourceCommit: output.sourceCommit,
    sourceTreeSha256: output.sourceTreeSha256,
    toolCount: output.toolNames.length,
    moduleCount: output.modules.length,
    artifactCount: output.artifacts.length,
  };
}

function verify(args) {
  if (
    !args.source ||
    !args["package-root"] ||
    !args.runuat ||
    !args["ue-root"] ||
    !args["build-ledger"] ||
    !args["build-result"]
  ) {
    fail("MANIFEST_ARGUMENT_REQUIRED");
  }
  const packageRoot = requireDirectory(resolve(args["package-root"]), "PACKAGE_ROOT_INVALID");
  const manifestPath = resolveManifestPath(packageRoot, args.manifest);
  const manifest = validateManifestShape(readJson(manifestPath, "MANIFEST_JSON_INVALID"));
  const inputs = commonInputs(args, true);
  if (
    manifest.sourceCommit !== inputs.provenance.sourceCommit ||
    manifest.sourceTreeSha256 !== inputs.provenance.sourceTreeSha256 ||
    stable(manifest.physicalFixtures) !== stable(inputs.provenance.physicalFixtures) ||
    manifest.taskId !== inputs.build.ledger.taskId ||
    manifest.buildCommandFingerprint !== inputs.build.ledger.commandFingerprint ||
    stable(manifest.buildEvidenceArtifacts) !== stable(inputs.build.evidenceArtifacts) ||
    stable(manifest.artifacts) !== stable(inputs.collected.artifacts) ||
    stable(manifest.modules) !== stable(inputs.collected.modules) ||
    manifest.engineVersion !== inputs.build.ledger.toolchainFacts.engineVersion ||
    manifest.engineChangelist !== inputs.build.ledger.toolchainFacts.engineChangelist ||
    manifest.compatibleChangelist !== inputs.build.ledger.toolchainFacts.compatibleChangelist ||
    manifest.moduleBuildId !== inputs.build.ledger.toolchainFacts.moduleBuildId ||
    manifest.targetPlatform !== inputs.build.ledger.targetPlatform ||
    manifest.configuration !== inputs.build.ledger.configuration ||
    stable(manifest.compiler) !==
      stable({
        name: inputs.build.ledger.toolchainFacts.compilerName,
        version: inputs.build.ledger.toolchainFacts.compilerVersion,
      }) ||
    stable(manifest.windowsSdk) !==
      stable({
        name: inputs.build.ledger.toolchainFacts.sdkName,
        version: inputs.build.ledger.toolchainFacts.sdkVersion,
      })
  ) {
    fail("MANIFEST_RECOMPUTE_MISMATCH");
  }
  return {
    status: "manifest_verified",
    manifestSelfSha256: manifest.manifestSelfSha256,
    manifestFileSha256: sha256File(manifestPath),
    sourceCommit: manifest.sourceCommit,
    sourceTreeSha256: manifest.sourceTreeSha256,
    toolCount: manifest.toolNames.length,
    moduleCount: manifest.modules.length,
    artifactCount: manifest.artifacts.length,
  };
}

function findDescriptors(root, current = "", results = []) {
  if (!existsSync(root)) return results;
  const directory = requireDirectory(
    current ? resolve(root, current.split("/").join("\\")) : root,
    "INSTALLED_SEARCH_ROOT_INVALID",
  );
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) fail("INSTALLED_SEARCH_LINK_INVALID");
    const logical = current ? `${current}/${entry.name}` : entry.name;
    const path = resolve(root, logical.split("/").join("\\"));
    if (entry.isDirectory()) findDescriptors(root, logical, results);
    else if (entry.isFile() && entry.name.toLowerCase() === "uagentassettools.uplugin") {
      results.push(path);
    }
  }
  return results;
}

function loadedAuthorityBindingMaterial(loaded) {
  return {
    schemaVersion: loaded.schemaVersion,
    productionOrigin: loaded.productionOrigin,
    fixtureUsed: loaded.fixtureUsed,
    taskGeneration: loaded.taskGeneration,
    taskId: loaded.taskId,
    taskMarkerSha256: loaded.taskMarkerSha256,
    sessionBindingSha256: loaded.sessionBindingSha256,
    generation: loaded.generation,
    sourceCommit: loaded.sourceCommit,
    sourceTreeSha256: loaded.sourceTreeSha256,
    sourceDirty: loaded.sourceDirty,
    project: loaded.project,
    manifest: loaded.manifest,
    package: loaded.package,
    installedRoot: loaded.installedRoot,
    process: loaded.process,
    modules: loaded.modules,
    processIdentitySha256: loaded.authority.processIdentitySha256,
    sources: loaded.authority.sources,
  };
}

function validateLoadedAuthorityShape(loaded, manifest, installed) {
  const code = "LOADED_LEDGER_INVALID";
  assertExactKeys(
    loaded.authority,
    ["schemaVersion", "processIdentitySha256", "sources", "bindingSha256"],
    code,
  );
  assertExactKeys(
    loaded.authority.sources,
    ["phaseProducer", "helper", "observer", "jobRunner"],
    code,
  );
  const expectedSourcePaths = {
    phaseProducer: "scripts/mvp15d-final-ue-automation-producer.mjs",
    helper: "scripts/mvp15d-final-live-producer-helper.mjs",
    observer: "scripts/mvp15d-loaded-module-observer.mjs",
    jobRunner: "scripts/mvp15d-windows-job-process-runner.ps1",
  };
  for (const [name, descriptor] of Object.entries(loaded.authority.sources)) {
    assertExactKeys(descriptor, ["relativePath", "size", "sha256"], code);
    if (
      descriptor.relativePath !== expectedSourcePaths[name] ||
      !Number.isSafeInteger(descriptor.size) ||
      descriptor.size <= 0 ||
      !isHex(descriptor.sha256)
    ) {
      fail(code);
    }
  }
  const packageSha256 = sha256Bytes(Buffer.from(stable(manifest.artifacts), "utf8"));
  const installedSha256 = sha256Bytes(Buffer.from(stable(installed.artifacts), "utf8"));
  const expectedBindingSha256 = sha256Bytes(
    Buffer.from(stable(loadedAuthorityBindingMaterial(loaded)), "utf8"),
  );
  if (
    loaded.taskGeneration !== TASK_GENERATION ||
    loaded.authority.schemaVersion !== PRODUCTION_AUTHORITY_SCHEMA ||
    !isHex(loaded.authority.processIdentitySha256) ||
    loaded.package.artifactCount !== manifest.artifacts.length ||
    loaded.package.sha256 !== packageSha256 ||
    loaded.installedRoot.artifactCount !== installed.artifacts.length ||
    loaded.installedRoot.sha256 !== installedSha256 ||
    loaded.authority.bindingSha256 !== expectedBindingSha256
  ) {
    fail(code);
  }
}

function verifyInstalled(args) {
  const verified = verify(args);
  if (!args["project-root"] || !args["loaded-ledger"]) {
    fail("INSTALLED_ARGUMENT_REQUIRED");
  }
  const packageRoot = resolve(args["package-root"]);
  const manifest = validateManifestShape(
    readJson(resolve(packageRoot, MANIFEST_NAME), "MANIFEST_JSON_INVALID"),
  );
  const projectRoot = requireDirectory(
    resolve(args["project-root"]),
    "INSTALLED_PROJECT_ROOT_INVALID",
  );
  const evidenceRoot = resolve(args["build-ledger"], "..", "..");
  if (!isWithin(evidenceRoot, projectRoot)) {
    fail("INSTALLED_PROJECT_OUTSIDE_EVIDENCE");
  }
  const projectDescriptors = findDescriptors(projectRoot);
  if (projectDescriptors.length !== 1) {
    fail("INSTALLED_PROJECT_COPY_COUNT_INVALID");
  }
  const installedRoot = resolve(projectDescriptors[0], "..");
  if (
    toLogical(relative(projectRoot, installedRoot)).toLowerCase() !== "plugins/uagentassettools"
  ) {
    fail("INSTALLED_LOCATION_INVALID");
  }
  for (const key of ["engine-plugin-root", "user-plugin-root"]) {
    if (args[key] && findDescriptors(resolve(args[key])).length !== 0) {
      fail("INSTALLED_SHADOW_COPY_DETECTED");
    }
  }
  const installed = collectPackageArtifacts(installedRoot, true);
  validateModuleIndex(installedRoot, installed.modules, manifest.moduleBuildId);
  if (
    stable(installed.artifacts) !== stable(manifest.artifacts) ||
    stable(installed.modules) !== stable(manifest.modules) ||
    sha256File(resolve(installedRoot, MANIFEST_NAME)) !==
      sha256File(resolve(packageRoot, MANIFEST_NAME))
  ) {
    fail("INSTALLED_MANIFEST_MISMATCH");
  }
  const loadedPath = resolve(args["loaded-ledger"]);
  if (!isWithin(evidenceRoot, loadedPath)) {
    fail("LOADED_LEDGER_OUTSIDE_EVIDENCE");
  }
  const loaded = readJson(loadedPath, "LOADED_LEDGER_INVALID");
  const hasProductionAuthority = Object.hasOwn(loaded, "authority");
  assertExactKeys(
    loaded,
    hasProductionAuthority
      ? [
          "schemaVersion",
          "productionOrigin",
          "fixtureUsed",
          "taskGeneration",
          "taskId",
          "taskMarkerSha256",
          "sessionBindingSha256",
          "generation",
          "sourceCommit",
          "sourceTreeSha256",
          "sourceDirty",
          "project",
          "manifest",
          "package",
          "installedRoot",
          "process",
          "modules",
          "authority",
        ]
      : [
          "schemaVersion",
          "productionOrigin",
          "fixtureUsed",
          "taskId",
          "taskMarkerSha256",
          "sessionBindingSha256",
          "generation",
          "sourceCommit",
          "sourceTreeSha256",
          "sourceDirty",
          "project",
          "manifest",
          "package",
          "installedRoot",
          "process",
          "modules",
        ],
    "LOADED_LEDGER_INVALID",
  );
  if (
    loaded.schemaVersion !== LOADED_LEDGER_SCHEMA ||
    loaded.productionOrigin !== PRODUCTION_ORIGIN ||
    loaded.fixtureUsed !== false ||
    loaded.taskId !== manifest.taskId ||
    !isHex(loaded.taskMarkerSha256) ||
    !isHex(loaded.sessionBindingSha256) ||
    !Number.isSafeInteger(loaded.generation) ||
    loaded.generation < 1 ||
    !isHex(loaded.sourceCommit, 40) ||
    !isHex(loaded.sourceTreeSha256) ||
    typeof loaded.sourceDirty !== "boolean" ||
    !Array.isArray(loaded.modules) ||
    loaded.modules.length !== manifest.modules.length
  ) {
    fail("LOADED_LEDGER_INVALID");
  }
  assertExactKeys(loaded.project, ["id", "sha256"], "LOADED_LEDGER_INVALID");
  assertExactKeys(loaded.manifest, ["sha256"], "LOADED_LEDGER_INVALID");
  assertExactKeys(
    loaded.package,
    hasProductionAuthority ? ["id", "artifactCount", "sha256"] : ["id", "sha256"],
    "LOADED_LEDGER_INVALID",
  );
  assertExactKeys(
    loaded.installedRoot,
    hasProductionAuthority ? ["id", "artifactCount", "sha256"] : ["id", "sha256"],
    "LOADED_LEDGER_INVALID",
  );
  assertExactKeys(
    loaded.process,
    [
      "pidBindingSha256",
      "creationFileTimeUtcBindingSha256",
      "executableBasename",
      "executableSha256",
    ],
    "LOADED_LEDGER_INVALID",
  );
  if (
    !/^[A-Za-z0-9._-]{1,64}$/.test(loaded.project.id) ||
    !isHex(loaded.project.sha256) ||
    !isHex(loaded.manifest.sha256) ||
    !/^[A-Za-z0-9._-]{1,64}$/.test(loaded.package.id) ||
    !isHex(loaded.package.sha256) ||
    !/^[A-Za-z0-9._-]{1,64}$/.test(loaded.installedRoot.id) ||
    !isHex(loaded.installedRoot.sha256) ||
    !isHex(loaded.process.pidBindingSha256) ||
    !isHex(loaded.process.creationFileTimeUtcBindingSha256) ||
    typeof loaded.process.executableBasename !== "string" ||
    loaded.process.executableBasename.length === 0 ||
    loaded.process.executableBasename.includes("/") ||
    loaded.process.executableBasename.includes("\\") ||
    !isHex(loaded.process.executableSha256)
  ) {
    fail("LOADED_LEDGER_INVALID");
  }
  if (hasProductionAuthority) validateLoadedAuthorityShape(loaded, manifest, installed);
  const loadedArtifacts = [];
  const names = new Set();
  for (const module of loaded.modules) {
    assertExactKeys(module, ["name", "path", "size", "sha256"], "LOADED_MODULE_INVALID");
    if (
      typeof module.path !== "string" ||
      isAbsolute(module.path) ||
      module.path.includes("\\") ||
      module.path.split("/").length !== 3 ||
      module.path.split("/")[0] !== "Binaries" ||
      typeof module.name !== "string" ||
      basename(module.path) !== module.name ||
      names.has(module.name.toLowerCase()) ||
      !Number.isSafeInteger(module.size) ||
      module.size < 1 ||
      !isHex(module.sha256)
    ) {
      fail("LOADED_MODULE_INVALID");
    }
    names.add(module.name.toLowerCase());
    const path = requireContainedRegularFile(
      installedRoot,
      resolve(installedRoot, module.path.split("/").join("\\")),
      "LOADED_MODULE_MISSING",
    );
    if (
      !isWithin(installedRoot, path) ||
      lstatSync(path).size !== module.size ||
      sha256File(path) !== module.sha256
    ) {
      fail("LOADED_MODULE_INVALID");
    }
    loadedArtifacts.push({
      path: module.path,
      size: module.size,
      sha256: module.sha256,
    });
  }
  loadedArtifacts.sort((left, right) => left.path.localeCompare(right.path, "en"));
  if (stable(loadedArtifacts) !== stable(manifest.modules)) {
    fail("LOADED_MANIFEST_MISMATCH");
  }
  return {
    ...verified,
    status: "installed_loaded_structural_verified",
    productionLaunchAuthorityVerified: false,
    installedCopyCount: 1,
    shadowCopyCount: 0,
    loadedModuleCount: loadedArtifacts.length,
    processIdBindingSha256: loaded.process.pidBindingSha256,
    sessionBindingSha256: loaded.sessionBindingSha256,
    generation: loaded.generation,
  };
}

function main() {
  const [mode, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  let output;
  if (mode === "create") output = create(args);
  else if (mode === "verify") output = verify(args);
  else if (mode === "verify-installed") output = verifyInstalled(args);
  else fail("MANIFEST_MODE_INVALID");
  console.log(JSON.stringify(output));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    const reason = error instanceof ToolingError ? error.code : "MANIFEST_TOOLING_FAILED";
    console.error(JSON.stringify({ status: "manifest_rejected", reason }));
    process.exitCode = 2;
  }
}

export {
  LOADED_LEDGER_SCHEMA,
  MANIFEST_SCHEMA,
  ToolingError,
  collectPackageArtifacts,
  create,
  manifestSelfHash,
  validateManifestShape,
  verify,
  verifyInstalled,
};
