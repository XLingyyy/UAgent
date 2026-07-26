#!/usr/bin/env node
/* global console, process */

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

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

function stable(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("BUILD_NON_JSON_VALUE");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (!value || typeof value !== "object" || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    fail("BUILD_NON_JSON_VALUE");
  }
  return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}";
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
    launcherSha256: sha256Bytes(readFileSync(runUat)),
    executableName: basename(automationTool),
    executableSha256: sha256Bytes(readFileSync(automationTool)),
    command: "BuildPlugin",
    plugin: "UAgentAssetTools.uplugin",
    packageRoot: "$" + "{PACKAGE_ROOT}",
    targetPlatform: "Win64",
  }), "utf8"));
}

function parseArgs(argv) {
  const supported = new Set(["source", "package", "runuat", "plugin"]);
  const args = Object.create(null);
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) fail("BUILD_ARGUMENT_INVALID");
    const key = item.slice(2);
    if (!supported.has(key) || Object.hasOwn(args, key)) fail("BUILD_ARGUMENT_INVALID");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail("BUILD_ARGUMENT_INVALID");
    args[key] = value;
    index += 1;
  }
  return args;
}

function isWithin(root, candidate) {
  const pathRelative = relative(root, candidate);
  return pathRelative === "" || (!pathRelative.startsWith("..") && !isAbsolute(pathRelative));
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

function toGitPath(value) {
  return value.split("\\").join("/");
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
  return { repositoryRoot, sourceRoot, sourceCommit, sourceTreeSha256 };
}

function resolvePlugin(sourceRoot, pluginArgument) {
  const candidates = pluginArgument
    ? [isAbsolute(pluginArgument) ? resolve(pluginArgument) : resolve(sourceRoot, pluginArgument)]
    : [
      resolve(sourceRoot, "plugins", "UAgentAssetTools", "UAgentAssetTools.uplugin"),
      resolve(sourceRoot, "integrations", "unreal", "UAgentAssetTools", "UAgentAssetTools.uplugin"),
    ];
  const existing = candidates.filter((candidate) => existsSync(candidate));
  if (existing.length !== 1) fail("PLUGIN_PATH_AMBIGUOUS_OR_MISSING");
  const plugin = requireRegularFile(existing[0], "PLUGIN_FILE_INVALID");
  if (!isWithin(sourceRoot, plugin)) fail("PLUGIN_OUTSIDE_SOURCE_ROOT");
  return plugin;
}

function ensureTracked(repositoryRoot, plugin) {
  const pluginRelative = toGitPath(relative(repositoryRoot, plugin));
  if (pluginRelative.startsWith("../") || pluginRelative === "..") fail("PLUGIN_OUTSIDE_GIT_ROOT");
  runGitText(repositoryRoot, ["ls-files", "--error-unmatch", "--", pluginRelative], "SOURCE_PLUGIN_NOT_TRACKED");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.source || !args.package || !args.runuat) fail("BUILD_ARGUMENT_REQUIRED");
  const sourceRoot = resolve(args.source);
  const packageRoot = resolve(args.package);
  const runUat = requireRegularFile(resolve(args.runuat), "RUNUAT_FILE_INVALID");
  const automationTool = resolveAutomationTool(runUat);
  if (existsSync(packageRoot)) fail("PACKAGE_TARGET_ALREADY_EXISTS");

  const provenance = deriveGitFacts(sourceRoot);
  const plugin = resolvePlugin(provenance.sourceRoot, args.plugin);
  ensureTracked(provenance.repositoryRoot, plugin);
  const pluginSha256 = sha256Bytes(readFileSync(plugin));
  const buildArguments = [
    "BuildPlugin",
    "-Plugin=" + plugin,
    "-Package=" + packageRoot,
    "-TargetPlatforms=Win64",
  ];

  const result = spawnSync(automationTool, buildArguments, {
    cwd: provenance.sourceRoot,
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) fail("RUNUAT_SPAWN_FAILED");
  if (result.status !== 0) {
    console.error(JSON.stringify({
      status: "build_failed",
      reason: "RUNUAT_EXIT_NONZERO",
      exitCode: result.status ?? 2,
      sourceCommit: provenance.sourceCommit,
      sourceTreeSha256: provenance.sourceTreeSha256,
      dirty: false,
    }));
    process.exitCode = result.status ?? 2;
    return;
  }

  console.log(JSON.stringify({
    status: "build_completed",
    sourceCommit: provenance.sourceCommit,
    sourceTreeSha256: provenance.sourceTreeSha256,
    dirty: false,
    pluginSha256,
    buildCommandFingerprint: buildCommandFingerprint(runUat, automationTool),
  }));
}

try {
  main();
} catch (error) {
  const reason = error instanceof ToolingError ? error.code : "BUILD_TOOLING_FAILED";
  console.error(JSON.stringify({ status: "build_rejected", reason }));
  process.exitCode = 2;
}
