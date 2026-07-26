#!/usr/bin/env node
/* global console, process */

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

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
const MODULE_DIRECTORY_RELATIVE_PATH = "Binaries/Win64";
const MODULE_INDEX_RELATIVE_PATH = "Binaries/Win64/UnrealEditor.modules";

class ToolingError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new ToolingError(code);
}

function stable(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("MANIFEST_NON_JSON_VALUE");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (!value || typeof value !== "object" || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    fail("MANIFEST_NON_JSON_VALUE");
  }
  return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}";
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

function parseArgs(argv) {
  const supported = new Set([
    "source",
    "package-root",
    "runuat",
    "manifest",
    "builder",
    "builder-kind",
  ]);
  const args = Object.create(null);
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) fail("MANIFEST_ARGUMENT_INVALID");
    const key = item.slice(2);
    if (!supported.has(key) || Object.hasOwn(args, key)) fail("MANIFEST_ARGUMENT_INVALID");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail("MANIFEST_ARGUMENT_INVALID");
    args[key] = value;
    index += 1;
  }
  return args;
}

function isWithin(root, candidate) {
  const pathRelative = relative(root, candidate);
  return pathRelative === "" || (!pathRelative.startsWith("..") && !isAbsolute(pathRelative));
}

function toGitPath(value) {
  return value.split("\\").join("/");
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

function runGitText(repositoryRoot, args, code) {
  const result = spawnSync("git", ["-C", repositoryRoot, ...args], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) fail(code);
  return result.stdout;
}

function runGitBytes(repositoryRoot, args, code) {
  const result = spawnSync("git", ["-C", repositoryRoot, ...args], {
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) fail(code);
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? "");
}

function deriveGitFacts(source) {
  const sourceRoot = requireDirectory(resolve(source), "SOURCE_ROOT_INVALID");
  const repositoryRoot = resolve(runGitText(sourceRoot, ["rev-parse", "--show-toplevel"], "SOURCE_GIT_UNAVAILABLE").trim());
  const dirty = runGitText(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"], "SOURCE_GIT_UNAVAILABLE");
  if (dirty.trim().length > 0) fail("SOURCE_TREE_DIRTY");
  const sourceCommit = runGitText(repositoryRoot, ["rev-parse", "HEAD"], "SOURCE_GIT_UNAVAILABLE").trim();
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) fail("SOURCE_COMMIT_INVALID");
  const sourceRelative = toGitPath(relative(repositoryRoot, sourceRoot));
  if (sourceRelative.startsWith("../") || sourceRelative === "..") fail("SOURCE_ROOT_OUTSIDE_GIT");
  const treeArgs = ["ls-tree", "-r", "-z", "HEAD"];
  if (sourceRelative && sourceRelative !== ".") treeArgs.push("--", sourceRelative);
  const treeListing = runGitBytes(repositoryRoot, treeArgs, "SOURCE_TREE_UNAVAILABLE");
  if (treeListing.length === 0) fail("SOURCE_TREE_EMPTY_OR_UNTRACKED");
  const sourceTreeSha256 = sha256Bytes(Buffer.concat([
    Buffer.from("uagent.mvp15d.git-tree.v1\0", "utf8"),
    Buffer.from(sourceRelative || ".", "utf8"),
    Buffer.from("\0", "utf8"),
    treeListing,
  ]));
  return { sourceCommit, sourceTreeSha256 };
}

function artifactFromRelativePath(packageRoot, relativePath, expectedName) {
  const normalized = relativePath.split("/").join("\\");
  const absolutePath = resolve(packageRoot, normalized);
  if (!isWithin(packageRoot, absolutePath)) fail("PACKAGE_ARTIFACT_PATH_INVALID");
  requireRegularFile(absolutePath, "PACKAGE_ARTIFACT_MISSING");
  return {
    name: expectedName,
    size: lstatSync(absolutePath).size,
    sha256: sha256File(absolutePath),
  };
}

function collectModuleArtifacts(packageRoot) {
  const moduleDirectory = resolve(packageRoot, MODULE_DIRECTORY_RELATIVE_PATH);
  requireDirectory(moduleDirectory, "PACKAGE_MODULE_DIRECTORY_MISSING");
  const entries = readdirSync(moduleDirectory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  if (entries.length === 0) fail("PACKAGE_MODULE_LIST_MISSING");
  const modules = [];
  for (const entry of entries) {
    if (entry.name === "UnrealEditor.modules") continue;
    if (!/^[A-Za-z0-9_.-]+\.dll$/.test(entry.name) || entry.isDirectory() || entry.isSymbolicLink() || !entry.isFile()) {
      fail("PACKAGE_MODULE_ARTIFACT_INVALID");
    }
    const modulePath = resolve(moduleDirectory, entry.name);
    requireRegularFile(modulePath, "PACKAGE_MODULE_ARTIFACT_INVALID");
    modules.push({
      name: entry.name,
      size: lstatSync(modulePath).size,
      sha256: sha256File(modulePath),
    });
  }
  return modules;
}

function validateModuleIndex(packageRoot, modules) {
  let moduleIndex;
  try {
    moduleIndex = JSON.parse(readFileSync(
      resolve(packageRoot, MODULE_INDEX_RELATIVE_PATH.split("/").join("\\")),
      "utf8",
    ));
  } catch {
    fail("PACKAGE_MODULE_INDEX_INVALID");
  }
  assertExactKeys(moduleIndex, ["BuildId", "Modules"], "PACKAGE_MODULE_INDEX_INVALID");
  if (moduleIndex.BuildId !== "55116800") fail("PACKAGE_MODULE_INDEX_INVALID");
  const expectedMappings = Object.create(null);
  for (const module of modules) {
    const match = module.name.match(/^UnrealEditor-([A-Za-z0-9_.-]+)\.dll$/);
    if (!match) fail("PACKAGE_MODULE_INDEX_INVALID");
    expectedMappings[match[1]] = module.name;
  }
  assertExactKeys(moduleIndex.Modules, Object.keys(expectedMappings), "PACKAGE_MODULE_INDEX_INVALID");
  for (const [name, fileName] of Object.entries(expectedMappings)) {
    if (moduleIndex.Modules[name] !== fileName) fail("PACKAGE_MODULE_INDEX_INVALID");
  }
}

function walkPackageFiles(root, current = "", state = { files: [], directories: new Set([""]) }) {
  const directory = resolve(root, current);
  requireDirectory(directory, "PACKAGE_DIRECTORY_INVALID");
  const entries = readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    if (!entry.name || entry.name === "." || entry.name === ".." || entry.isSymbolicLink()) fail("PACKAGE_LINK_OR_PATH_INVALID");
    const childRelative = current ? current + "/" + entry.name : entry.name;
    const childPath = resolve(root, childRelative.split("/").join("\\"));
    if (!isWithin(root, childPath)) fail("PACKAGE_LINK_OR_PATH_INVALID");
    if (entry.isDirectory()) {
      state.directories.add(childRelative);
      walkPackageFiles(root, childRelative, state);
    } else if (entry.isFile()) {
      requireRegularFile(childPath, "PACKAGE_LINK_OR_PATH_INVALID");
      state.files.push(childRelative);
    } else {
      fail("PACKAGE_SPECIAL_FILE_INVALID");
    }
  }
  return state;
}

function assertSealedPackage(packageRoot, modules, manifestPresent) {
  const expected = new Set([
    UPLUGIN_RELATIVE_PATH,
    SCHEMA_RELATIVE_PATH,
    MODULE_INDEX_RELATIVE_PATH,
    ...modules.map((module) => MODULE_DIRECTORY_RELATIVE_PATH + "/" + module.name),
  ]);
  if (manifestPresent) expected.add(MANIFEST_NAME);
  const actual = walkPackageFiles(packageRoot);
  const expectedDirectories = new Set(["", "Resources", "Binaries", MODULE_DIRECTORY_RELATIVE_PATH]);
  for (const file of actual.files) {
    if (!expected.has(file)) fail("PACKAGE_ARTIFACT_EXTRA");
  }
  for (const file of expected) {
    if (!actual.files.includes(file)) fail("PACKAGE_ARTIFACT_MISSING");
  }
  for (const directory of actual.directories) {
    if (!expectedDirectories.has(directory)) fail("PACKAGE_ARTIFACT_EXTRA");
  }
  for (const directory of expectedDirectories) {
    if (!actual.directories.has(directory)) fail("PACKAGE_ARTIFACT_MISSING");
  }
}

function isHex(value, length) {
  return typeof value === "string" && new RegExp("^[0-9a-f]{" + length + "}$").test(value);
}

function isSafeBuilderName(value) {
  return typeof value === "string" && value.trim() === value && /^[A-Za-z0-9._ -]+$/.test(value);
}

function isIsoUtc(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function assertExactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) fail(code);
}

function validateArtifact(value, expectedName) {
  assertExactKeys(value, ["name", "size", "sha256"], "MANIFEST_ARTIFACT_INVALID");
  if (value.name !== expectedName || !Number.isSafeInteger(value.size) || value.size < 0 || !isHex(value.sha256, 64)) {
    fail("MANIFEST_ARTIFACT_INVALID");
  }
}

function manifestHash(manifest) {
  const withoutSelfHash = { ...manifest };
  delete withoutSelfHash.manifestSha256;
  return sha256Bytes(Buffer.from(stable(withoutSelfHash), "utf8"));
}

function resolveAutomationTool(runUat) {
  const engineRoot = dirname(dirname(dirname(runUat)));
  return requireRegularFile(
    resolve(engineRoot, "Binaries", "DotNET", "AutomationTool", "AutomationTool.exe"),
    "AUTOMATION_TOOL_FILE_INVALID",
  );
}

function buildCommandFingerprint(runUat, automationTool) {
  return sha256Bytes(Buffer.from(stable({
    schemaVersion: "uagent.mvp15d.build-command.v1",
    launcherName: basename(runUat),
    launcherSha256: sha256File(runUat),
    executableName: basename(automationTool),
    executableSha256: sha256File(automationTool),
    command: "BuildPlugin",
    plugin: UPLUGIN_RELATIVE_PATH,
    packageRoot: "$" + "{PACKAGE_ROOT}",
    targetPlatform: "Win64",
  }), "utf8"));
}

function validateManifestShape(manifest) {
  assertExactKeys(manifest, [
    "schemaVersion",
    "pluginId",
    "pluginVersion",
    "contractVersion",
    "sourceCommit",
    "sourceTreeSha256",
    "dirty",
    "ueVersion",
    "ueBuildId",
    "targetPlatform",
    "configuration",
    "compiler",
    "windowsSdk",
    "buildCommandFingerprint",
    "uplugin",
    "schema",
    "moduleIndex",
    "modules",
    "toolNames",
    "generatedAt",
    "builder",
    "manifestSha256",
  ], "MANIFEST_FIELDS_INVALID");
  if (
    manifest.schemaVersion !== "uagent.ue-companion-plugin.build-manifest.v1"
    || manifest.pluginId !== "UAgentAssetTools"
    || manifest.pluginVersion !== "0.1.0"
    || manifest.contractVersion !== "mvp15d.asset-tools.v1"
    || manifest.dirty !== false
    || manifest.ueVersion !== "5.8.0"
    || manifest.ueBuildId !== "55116800"
    || manifest.targetPlatform !== "Win64"
    || manifest.configuration !== "Development"
    || manifest.compiler !== "MSVC"
    || manifest.windowsSdk !== "Windows SDK"
    || !isHex(manifest.sourceCommit, 40)
    || !isHex(manifest.sourceTreeSha256, 64)
    || !isHex(manifest.buildCommandFingerprint, 64)
    || !isHex(manifest.manifestSha256, 64)
    || JSON.stringify(manifest.toolNames) !== JSON.stringify(TOOL_NAMES)
    || !isIsoUtc(manifest.generatedAt)
  ) {
    fail("MANIFEST_FIELDS_INVALID");
  }
  validateArtifact(manifest.uplugin, "UAgentAssetTools.uplugin");
  validateArtifact(manifest.schema, "uagent-asset-tools.schema.json");
  validateArtifact(manifest.moduleIndex, "UnrealEditor.modules");
  if (!Array.isArray(manifest.modules) || manifest.modules.length === 0) fail("MANIFEST_MODULE_LIST_INVALID");
  const moduleNames = [];
  for (const module of manifest.modules) {
    if (!module || typeof module.name !== "string" || !/^[A-Za-z0-9_.-]+$/.test(module.name)) fail("MANIFEST_MODULE_LIST_INVALID");
    validateArtifact(module, module.name);
    moduleNames.push(module.name);
  }
  if (
    new Set(moduleNames).size !== moduleNames.length
    || [...moduleNames].sort((left, right) => left.localeCompare(right, "en")).some((name, index) => name !== moduleNames[index])
  ) {
    fail("MANIFEST_MODULE_LIST_INVALID");
  }
  assertExactKeys(manifest.builder, ["kind", "name"], "MANIFEST_BUILDER_INVALID");
  if (!["local", "ci"].includes(manifest.builder.kind) || !isSafeBuilderName(manifest.builder.name)) fail("MANIFEST_BUILDER_INVALID");
  if (manifestHash(manifest) !== manifest.manifestSha256) fail("MANIFEST_SELF_HASH_MISMATCH");
  return manifest;
}

function verifyPackageArtifacts(packageRoot, manifest) {
  const uplugin = artifactFromRelativePath(packageRoot, UPLUGIN_RELATIVE_PATH, "UAgentAssetTools.uplugin");
  const schema = artifactFromRelativePath(packageRoot, SCHEMA_RELATIVE_PATH, "uagent-asset-tools.schema.json");
  const moduleIndex = artifactFromRelativePath(packageRoot, MODULE_INDEX_RELATIVE_PATH, "UnrealEditor.modules");
  const modules = collectModuleArtifacts(packageRoot);
  validateModuleIndex(packageRoot, modules);
  assertSealedPackage(packageRoot, modules, true);
  if (stable(uplugin) !== stable(manifest.uplugin) || stable(schema) !== stable(manifest.schema) || stable(moduleIndex) !== stable(manifest.moduleIndex) || stable(modules) !== stable(manifest.modules)) {
    fail("PACKAGE_ARTIFACT_HASH_MISMATCH");
  }
}

function resolveManifestPath(packageRoot, manifestArgument) {
  const expected = resolve(packageRoot, MANIFEST_NAME);
  const actual = manifestArgument ? resolve(manifestArgument) : expected;
  if (actual !== expected) fail("MANIFEST_PATH_NONCANONICAL");
  return expected;
}

function create(args) {
  if (!args.source || !args["package-root"] || !args.runuat) fail("MANIFEST_ARGUMENT_REQUIRED");
  const packageRoot = requireDirectory(resolve(args["package-root"]), "PACKAGE_ROOT_INVALID");
  const manifestPath = resolveManifestPath(packageRoot, args.manifest);
  if (existsSync(manifestPath)) fail("MANIFEST_ALREADY_EXISTS");
  const runUat = requireRegularFile(resolve(args.runuat), "RUNUAT_FILE_INVALID");
  const automationTool = resolveAutomationTool(runUat);
  const provenance = deriveGitFacts(args.source);
  const modules = collectModuleArtifacts(packageRoot);
  validateModuleIndex(packageRoot, modules);
  assertSealedPackage(packageRoot, modules, false);
  const builderKind = args["builder-kind"] ?? "local";
  if (!["local", "ci"].includes(builderKind)) fail("MANIFEST_BUILDER_INVALID");
  const builderName = args.builder ?? "uagent-mvp15d";
  if (!isSafeBuilderName(builderName)) fail("MANIFEST_BUILDER_INVALID");
  const manifest = {
    schemaVersion: "uagent.ue-companion-plugin.build-manifest.v1",
    pluginId: "UAgentAssetTools",
    pluginVersion: "0.1.0",
    contractVersion: "mvp15d.asset-tools.v1",
    sourceCommit: provenance.sourceCommit,
    sourceTreeSha256: provenance.sourceTreeSha256,
    dirty: false,
    ueVersion: "5.8.0",
    ueBuildId: "55116800",
    targetPlatform: "Win64",
    configuration: "Development",
    compiler: "MSVC",
    windowsSdk: "Windows SDK",
    buildCommandFingerprint: buildCommandFingerprint(runUat, automationTool),
    uplugin: artifactFromRelativePath(packageRoot, UPLUGIN_RELATIVE_PATH, "UAgentAssetTools.uplugin"),
    schema: artifactFromRelativePath(packageRoot, SCHEMA_RELATIVE_PATH, "uagent-asset-tools.schema.json"),
    moduleIndex: artifactFromRelativePath(packageRoot, MODULE_INDEX_RELATIVE_PATH, "UnrealEditor.modules"),
    modules,
    toolNames: TOOL_NAMES,
    generatedAt: new Date().toISOString(),
    builder: { kind: builderKind, name: builderName },
  };
  const output = { ...manifest, manifestSha256: manifestHash(manifest) };
  writeFileSync(manifestPath, JSON.stringify(output, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  verifyPackageArtifacts(packageRoot, output);
  console.log(JSON.stringify({
    status: "manifest_created",
    manifestSha256: output.manifestSha256,
    sourceCommit: output.sourceCommit,
    sourceTreeSha256: output.sourceTreeSha256,
    dirty: false,
    toolCount: output.toolNames.length,
    moduleCount: output.modules.length,
  }));
}

function verify(args) {
  if (!args.source || !args["package-root"] || !args.runuat) fail("MANIFEST_ARGUMENT_REQUIRED");
  const packageRoot = requireDirectory(resolve(args["package-root"]), "PACKAGE_ROOT_INVALID");
  const manifestPath = resolveManifestPath(packageRoot, args.manifest);
  requireRegularFile(manifestPath, "MANIFEST_MISSING");
  const runUat = requireRegularFile(resolve(args.runuat), "RUNUAT_FILE_INVALID");
  const automationTool = resolveAutomationTool(runUat);
  let raw;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    fail("MANIFEST_JSON_INVALID");
  }
  const manifest = validateManifestShape(raw);
  const provenance = deriveGitFacts(args.source);
  if (
    manifest.sourceCommit !== provenance.sourceCommit
    || manifest.sourceTreeSha256 !== provenance.sourceTreeSha256
    || manifest.dirty !== false
  ) {
    fail("MANIFEST_SOURCE_PROVENANCE_MISMATCH");
  }
  if (manifest.buildCommandFingerprint !== buildCommandFingerprint(runUat, automationTool)) fail("MANIFEST_BUILD_COMMAND_MISMATCH");
  verifyPackageArtifacts(packageRoot, manifest);
  console.log(JSON.stringify({
    status: "manifest_verified",
    manifestSha256: manifest.manifestSha256,
    sourceCommit: manifest.sourceCommit,
    sourceTreeSha256: manifest.sourceTreeSha256,
    dirty: false,
    toolCount: manifest.toolNames.length,
    moduleCount: manifest.modules.length,
  }));
}

function main() {
  const [mode, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (mode === "create") create(args);
  else if (mode === "verify") verify(args);
  else fail("MANIFEST_MODE_INVALID");
}

try {
  main();
} catch (error) {
  const reason = error instanceof ToolingError ? error.code : "MANIFEST_TOOLING_FAILED";
  console.error(JSON.stringify({ status: "manifest_rejected", reason }));
  process.exitCode = 2;
}
