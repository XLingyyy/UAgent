#!/usr/bin/env node
/* global console, process */

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BUILD_COMMAND_SCHEMA = "uagent.mvp15d.final.build-command.v3";
const BUILD_RESULT_SCHEMA = "uagent.mvp15d.final.build-result.v3";
const TASK_GENERATION = "final-d13-d16";
const DEFAULT_TASK_ID = "TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-FINAL-D13-D16";
const CANONICAL_FIXTURES = [
  "integrations/unreal/UAgentAssetTools/Resources/mvp15d-native-binding-v2.json",
  "packages/shared/test-fixtures/mvp15d-native-binding-v2.json",
];
const CANONICAL_FIXTURE_SIZE = 4_865;
const CANONICAL_FIXTURE_SHA256 = "771168ec8b6e7215672a4d839fa675d88f9207876e2c51513b26d6c58da56a1b";
const SAFE_MARKER = /^[A-Za-z0-9._:-]{24,160}$/;
const FINAL_ROOT = /^mvp15d-final-d13-d16-\d{8}_\d{6}(?:-[A-Za-z0-9]+)?$/;

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

function stable(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("BUILD_NON_JSON_VALUE");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (
    !value ||
    typeof value !== "object" ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    fail("BUILD_NON_JSON_VALUE");
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
    .join(",")}}`;
}

function parseArgs(argv) {
  const supported = new Set([
    "mode",
    "source",
    "package",
    "runuat",
    "ue-root",
    "plugin",
    "evidence-root",
    "task-id",
    "task-marker",
    "uat-log",
  ]);
  const args = Object.create(null);
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) fail("BUILD_ARGUMENT_INVALID");
    const key = item.slice(2);
    if (!supported.has(key) || Object.hasOwn(args, key)) {
      fail("BUILD_ARGUMENT_INVALID");
    }
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

function hasControlCharacter(value) {
  return [...value].some((character) => {
    const code = character.codePointAt(0);
    return code <= 31 || code === 127;
  });
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

function safeWindowsPath(value, code) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !isAbsolute(value) ||
    hasControlCharacter(value) ||
    /["%!^&|<>()]/.test(value) ||
    /(?:^|[\\/])(?:\.{1,2}|[^\\/]*[ .])(?:[\\/]|$)/.test(value)
  ) {
    fail(code);
  }
  return resolve(value);
}

function runGit(repositoryRoot, args, code, encoding = "utf8") {
  const result = spawnSync("git", ["-C", repositoryRoot, ...args], {
    encoding,
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) fail(code);
  return result.stdout;
}

function tryGit(repositoryRoot, args) {
  return spawnSync("git", ["-C", repositoryRoot, ...args], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
}

function toGitPath(value) {
  return value.split("\\").join("/");
}

function assertDetached(repositoryRoot) {
  const symbolic = tryGit(repositoryRoot, ["symbolic-ref", "-q", "HEAD"]);
  if (symbolic.error || symbolic.status === 0 || symbolic.status !== 1) {
    fail("SOURCE_HEAD_NOT_DETACHED");
  }
}

function assertCanonicalPhysicalBytes(repositoryRoot) {
  let previous = null;
  const fixtures = [];
  for (const logicalPath of CANONICAL_FIXTURES) {
    const absolutePath = requireRegularFile(
      resolve(repositoryRoot, logicalPath.split("/").join("\\")),
      "SOURCE_CANONICAL_FIXTURE_MISSING",
    );
    const bytes = readFileSync(absolutePath);
    const trackedBytes = runGit(
      repositoryRoot,
      ["show", `HEAD:${logicalPath}`],
      "SOURCE_CANONICAL_GIT_OBJECT_MISSING",
      null,
    );
    const tracked = Buffer.isBuffer(trackedBytes) ? trackedBytes : Buffer.from(trackedBytes ?? "");
    if (
      bytes.length !== CANONICAL_FIXTURE_SIZE ||
      sha256Bytes(bytes) !== CANONICAL_FIXTURE_SHA256 ||
      !bytes.equals(tracked) ||
      (previous && !bytes.equals(previous))
    ) {
      fail("SOURCE_CANONICAL_PHYSICAL_IDENTITY_MISMATCH");
    }
    previous = bytes;
    fixtures.push({
      path: logicalPath,
      size: bytes.length,
      sha256: sha256Bytes(bytes),
      gitObjectSha256: sha256Bytes(tracked),
    });
  }
  return fixtures;
}

function deriveGitFacts(source) {
  const sourceRoot = requireDirectory(resolve(source), "SOURCE_ROOT_INVALID");
  const repositoryRoot = resolve(
    runGit(sourceRoot, ["rev-parse", "--show-toplevel"], "SOURCE_GIT_UNAVAILABLE").trim(),
  );
  const dirty = runGit(
    repositoryRoot,
    ["status", "--porcelain=v1", "--untracked-files=all"],
    "SOURCE_GIT_UNAVAILABLE",
  );
  if (dirty.trim().length > 0) fail("SOURCE_TREE_DIRTY");
  assertDetached(repositoryRoot);
  const sourceCommit = runGit(
    repositoryRoot,
    ["rev-parse", "HEAD"],
    "SOURCE_GIT_UNAVAILABLE",
  ).trim();
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) fail("SOURCE_COMMIT_INVALID");
  const sourceRelative = toGitPath(relative(repositoryRoot, sourceRoot));
  if (sourceRelative.startsWith("../") || sourceRelative === "..") {
    fail("SOURCE_ROOT_OUTSIDE_GIT");
  }
  const treeListing = runGit(
    repositoryRoot,
    ["ls-tree", "-r", "-z", "HEAD"],
    "SOURCE_TREE_UNAVAILABLE",
    null,
  );
  const treeBytes = Buffer.isBuffer(treeListing) ? treeListing : Buffer.from(treeListing ?? "");
  if (treeBytes.length === 0) fail("SOURCE_TREE_EMPTY_OR_UNTRACKED");
  const sourceTreeSha256 = sha256Bytes(
    Buffer.concat([Buffer.from("uagent.mvp15d.git-tree.v2\0", "utf8"), treeBytes]),
  );
  return {
    repositoryRoot,
    sourceRoot,
    sourceCommit,
    sourceTreeSha256,
    physicalFixtures: assertCanonicalPhysicalBytes(repositoryRoot),
  };
}

function resolvePlugin(provenance, pluginArgument) {
  const candidates = pluginArgument
    ? [
        isAbsolute(pluginArgument)
          ? resolve(pluginArgument)
          : resolve(provenance.sourceRoot, pluginArgument),
      ]
    : [
        resolve(
          provenance.sourceRoot,
          "integrations",
          "unreal",
          "UAgentAssetTools",
          "UAgentAssetTools.uplugin",
        ),
      ];
  const existing = candidates.filter((candidate) => existsSync(candidate));
  if (existing.length !== 1) fail("PLUGIN_PATH_AMBIGUOUS_OR_MISSING");
  const plugin = requireRegularFile(
    safeWindowsPath(existing[0], "PLUGIN_PATH_UNSAFE"),
    "PLUGIN_FILE_INVALID",
  );
  if (!isWithin(provenance.sourceRoot, plugin)) {
    fail("PLUGIN_OUTSIDE_SOURCE_ROOT");
  }
  const pluginRelative = toGitPath(relative(provenance.repositoryRoot, plugin));
  runGit(
    provenance.repositoryRoot,
    ["ls-files", "--error-unmatch", "--", pluginRelative],
    "SOURCE_PLUGIN_NOT_TRACKED",
  );
  return plugin;
}

function resolveRunUat(value) {
  const runUat = requireRegularFile(
    safeWindowsPath(resolve(value), "RUNUAT_PATH_UNSAFE"),
    "RUNUAT_FILE_INVALID",
  );
  if (basename(runUat).toLowerCase() !== "runuat.bat") {
    fail("RUNUAT_BASENAME_INVALID");
  }
  return runUat;
}

function readJsonFile(path, code) {
  try {
    return JSON.parse(readFileSync(requireRegularFile(path, code), "utf8"));
  } catch (error) {
    if (error instanceof ToolingError) throw error;
    fail(code);
  }
}

function readEngineIdentity(value, runUat) {
  const ueRoot = requireDirectory(
    safeWindowsPath(resolve(value), "UE_ROOT_PATH_UNSAFE"),
    "UE_ROOT_INVALID",
  );
  const expectedRunUat = resolve(ueRoot, "Engine", "Build", "BatchFiles", "RunUAT.bat");
  if (resolve(runUat).toLowerCase() !== expectedRunUat.toLowerCase()) {
    fail("RUNUAT_ENGINE_ROOT_MISMATCH");
  }
  const buildVersionPath = resolve(ueRoot, "Engine", "Build", "Build.version");
  const buildVersion = readJsonFile(buildVersionPath, "UE_BUILD_VERSION_INVALID");
  if (
    buildVersion?.MajorVersion !== 5 ||
    buildVersion?.MinorVersion !== 8 ||
    buildVersion?.PatchVersion !== 1 ||
    buildVersion?.Changelist !== 56057345 ||
    buildVersion?.CompatibleChangelist !== 55116800 ||
    buildVersion?.BranchName !== "++UE5+Release-5.8"
  ) {
    fail("UE_BUILD_VERSION_IDENTITY_MISMATCH");
  }
  const moduleManifestPath = resolve(
    ueRoot,
    "Engine",
    "Binaries",
    "Win64",
    "UnrealEditor.modules",
  );
  const moduleManifest = readJsonFile(moduleManifestPath, "UE_MODULE_MANIFEST_INVALID");
  if (
    !moduleManifest ||
    typeof moduleManifest !== "object" ||
    Array.isArray(moduleManifest) ||
    moduleManifest.BuildId !== "55116800" ||
    !moduleManifest.Modules ||
    typeof moduleManifest.Modules !== "object" ||
    Array.isArray(moduleManifest.Modules)
  ) {
    fail("UE_MODULE_BUILD_ID_MISMATCH");
  }
  return {
    engineVersion: "5.8.1",
    engineChangelist: 56057345,
    compatibleChangelist: 55116800,
    moduleBuildId: "55116800",
    branch: "++UE5+Release-5.8",
    buildVersion: {
      relativePath: "Engine/Build/Build.version",
      size: lstatSync(buildVersionPath).size,
      sha256: sha256File(buildVersionPath),
    },
    engineModuleManifest: {
      relativePath: "Engine/Binaries/Win64/UnrealEditor.modules",
      size: lstatSync(moduleManifestPath).size,
      sha256: sha256File(moduleManifestPath),
    },
  };
}

function orderedBuildArguments(plugin, packageRoot) {
  const normalizedPlugin = safeWindowsPath(plugin, "PLUGIN_PATH_UNSAFE");
  const normalizedPackage = safeWindowsPath(packageRoot, "PACKAGE_PATH_UNSAFE");
  return [
    "BuildPlugin",
    `-Plugin=${normalizedPlugin}`,
    `-Package=${normalizedPackage}`,
    "-TargetPlatforms=Win64",
    "-Rocket",
  ];
}

function quoteCmdToken(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    hasControlCharacter(value) ||
    /["%!^&|<>]/.test(value)
  ) {
    fail("RUNUAT_COMMAND_TOKEN_INVALID");
  }
  return `"${value}"`;
}

function exactCmdCommand(runUat, orderedArguments) {
  return [quoteCmdToken(runUat), ...orderedArguments.map(quoteCmdToken)].join(" ");
}

function ensurePackagedModuleIndex(packageRoot, engineIdentity) {
  const binaries = requireDirectory(
    resolve(packageRoot, "Binaries", "Win64"),
    "BUILD_PACKAGE_BINARIES_MISSING",
  );
  const moduleFiles = readdirSync(binaries)
    .filter((name) => /^UnrealEditor-[A-Za-z0-9_]+\.dll$/.test(name))
    .sort((left, right) => left.localeCompare(right));
  if (moduleFiles.length === 0) fail("BUILD_PACKAGE_MODULES_MISSING");
  const modules = Object.fromEntries(
    moduleFiles.map((name) => [
      name.slice("UnrealEditor-".length, -".dll".length),
      name,
    ]),
  );
  const expected = {
    BuildId: engineIdentity.moduleBuildId,
    Modules: modules,
  };
  const moduleIndexPath = resolve(binaries, "UnrealEditor.modules");
  if (existsSync(moduleIndexPath)) {
    const observed = readJsonFile(moduleIndexPath, "BUILD_PACKAGE_MODULE_INDEX_INVALID");
    if (stable(observed) !== stable(expected)) {
      fail("BUILD_PACKAGE_MODULE_INDEX_MISMATCH");
    }
    return;
  }
  writeFileSync(moduleIndexPath, `${JSON.stringify(expected, null, "\t")}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

function redactedOrderedArguments(orderedArguments) {
  return orderedArguments.map((argument) => {
    if (argument.startsWith("-Plugin=")) {
      return "-Plugin=${SOURCE_ROOT}/integrations/unreal/UAgentAssetTools/UAgentAssetTools.uplugin";
    }
    if (argument.startsWith("-Package=")) return "-Package=${PACKAGE_ROOT}";
    return argument;
  });
}

function commandFingerprintRecord({
  taskId,
  runUat,
  orderedArguments,
  provenance,
  plugin,
  packageRoot,
  engineIdentity,
}) {
  return {
    schemaVersion: BUILD_COMMAND_SCHEMA,
    taskGeneration: TASK_GENERATION,
    taskId,
    launcher: {
      basename: basename(runUat),
      size: lstatSync(runUat).size,
      sha256: sha256File(runUat),
    },
    orderedArgumentsSha256: sha256Bytes(Buffer.from(stable(orderedArguments), "utf8")),
    sourceCommit: provenance.sourceCommit,
    sourceTreeSha256: provenance.sourceTreeSha256,
    pluginDescriptor: {
      relativePath: toGitPath(relative(provenance.repositoryRoot, plugin)),
      size: lstatSync(plugin).size,
      sha256: sha256File(plugin),
    },
    packageOutputIdentity: sha256Bytes(Buffer.from(resolve(packageRoot).toLowerCase(), "utf8")),
    targetPlatform: "Win64",
    configuration: "Development",
    engineIdentity,
  };
}

function buildCommandLedger(input) {
  const fingerprintRecord = commandFingerprintRecord(input);
  return {
    ...fingerprintRecord,
    orderedArguments: redactedOrderedArguments(input.orderedArguments),
    commandFingerprint: sha256Bytes(Buffer.from(stable(fingerprintRecord), "utf8")),
  };
}

function redactTranscript(text, provenance) {
  let output = String(text ?? "");
  const replacements = [
    [provenance.repositoryRoot, "${SOURCE_ROOT}"],
    [resolve(provenance.repositoryRoot, ".."), "${SOURCE_PARENT}"],
  ];
  for (const [raw, replacement] of replacements) {
    if (!raw) continue;
    output = output.split(raw).join(replacement);
    output = output.split(raw.replaceAll("\\", "/")).join(replacement);
  }
  output = output
    .replace(/[A-Za-z]:\\Users\\[^\\\r\n]+/gi, "${USER_HOME}")
    .replace(/\b(authorization|token|password|secret|api[-_]?key)\s*[:=]\s*\S+/gi, "$1=${REDACTED}")
    .replace(/Bearer\s+\S+/gi, "Bearer ${REDACTED}");
  return output;
}

function deriveToolchainFacts(text, engineIdentity) {
  const marker = String(text ?? "").match(
    /(?:^|\r?\n)UAGENT_TOOLCHAIN_JSON:(\{[^\r\n]+\})(?:\r?\n|$)/,
  );
  if (marker) {
    let value;
    try {
      value = JSON.parse(marker[1]);
    } catch {
      fail("BUILD_TOOLCHAIN_EVIDENCE_INVALID");
    }
    if (
      !value ||
      Object.keys(value).sort().join(",") !==
        "compatibleChangelist,compilerName,compilerVersion,engineChangelist,engineVersion,moduleBuildId,sdkName,sdkVersion" ||
      value.engineVersion !== engineIdentity.engineVersion ||
      value.engineChangelist !== engineIdentity.engineChangelist ||
      value.compatibleChangelist !== engineIdentity.compatibleChangelist ||
      value.moduleBuildId !== engineIdentity.moduleBuildId ||
      value.compilerName !== "MSVC" ||
      typeof value.compilerVersion !== "string" ||
      !/^\d+(?:\.\d+){1,3}$/.test(value.compilerVersion) ||
      value.sdkName !== "Windows SDK" ||
      typeof value.sdkVersion !== "string" ||
      !/^\d+(?:\.\d+){1,3}$/.test(value.sdkVersion)
    ) {
      fail("BUILD_TOOLCHAIN_EVIDENCE_INVALID");
    }
    return value;
  }
  const compiler = String(text ?? "").match(
    /Using Visual Studio [^\r\n]*?toolchain\s*\((\d+(?:\.\d+){1,3})\)/i,
  );
  const sdk = String(text ?? "").match(/Windows\s+(?:10|11)?\s*SDK\s*\(?(\d+(?:\.\d+){1,3})\)?/i);
  if (!compiler || !sdk) {
    fail("BUILD_TOOLCHAIN_EVIDENCE_MISSING");
  }
  return {
    engineVersion: engineIdentity.engineVersion,
    engineChangelist: engineIdentity.engineChangelist,
    compatibleChangelist: engineIdentity.compatibleChangelist,
    moduleBuildId: engineIdentity.moduleBuildId,
    compilerName: "MSVC",
    compilerVersion: compiler[1],
    sdkName: "Windows SDK",
    sdkVersion: sdk[1],
  };
}

function artifactRecord(root, path, capturedAt, producer, redactionStatus) {
  const logicalPath = toGitPath(relative(root, path));
  if (logicalPath.startsWith("../") || logicalPath === ".." || isAbsolute(logicalPath)) {
    fail("BUILD_SOURCE_ARTIFACT_OUTSIDE_EVIDENCE");
  }
  return {
    relativePath: logicalPath,
    size: lstatSync(path).size,
    sha256: sha256File(path),
    capturedAt,
    producer,
    redactionStatus,
  };
}

function validateEvidenceRoot(value, repositoryRoot, taskId) {
  const root = safeWindowsPath(resolve(value), "BUILD_EVIDENCE_ROOT_INVALID");
  const external = resolve(repositoryRoot, "external");
  if (
    !isWithin(external, root) ||
    !FINAL_ROOT.test(basename(root)) ||
    resolve(root, "..") !== external
  ) {
    fail("BUILD_EVIDENCE_ROOT_INVALID");
  }
  if (existsSync(root)) {
    requireDirectory(root, "BUILD_EVIDENCE_ROOT_INVALID");
    const preflightPath = resolve(root, "metadata", "preflight.json");
    const preflight = (() => {
      try {
        return JSON.parse(
          readFileSync(
            requireRegularFile(preflightPath, "BUILD_EVIDENCE_PREFLIGHT_MISSING"),
            "utf8",
          ),
        );
      } catch (error) {
        if (error instanceof ToolingError) throw error;
        fail("BUILD_EVIDENCE_PREFLIGHT_INVALID");
      }
    })();
    if (
      preflight?.taskGeneration !== TASK_GENERATION ||
      preflight?.taskId !== taskId ||
      existsSync(resolve(root, "metadata", "build-command.json")) ||
      existsSync(resolve(root, "metadata", "build-result.json"))
    ) {
      fail("BUILD_EVIDENCE_PREFLIGHT_INVALID");
    }
  }
  return root;
}

function executeBuild({
  runUat,
  orderedArguments,
  cwd,
  packageRoot,
  evidenceRoot,
  provenance,
  commandLedger,
  taskMarker,
  uatLog,
  engineIdentity,
}) {
  mkdirSync(resolve(evidenceRoot, "logs"), { recursive: true });
  mkdirSync(resolve(evidenceRoot, "metadata"), { recursive: true });
  const result = spawnSync(
    process.platform === "win32" ? "cmd.exe" : runUat,
    process.platform === "win32"
      ? ["/d", "/s", "/c", runUat, ...orderedArguments]
      : orderedArguments,
    {
      cwd,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  const capturedAt = new Date().toISOString();
  const stdoutPath = resolve(evidenceRoot, "logs", "runuat.stdout.redacted.log");
  const stderrPath = resolve(evidenceRoot, "logs", "runuat.stderr.redacted.log");
  writeFileSync(stdoutPath, redactTranscript(result.stdout, provenance), "utf8");
  writeFileSync(stderrPath, redactTranscript(result.stderr, provenance), "utf8");
  const sourceArtifacts = [
    artifactRecord(
      evidenceRoot,
      stdoutPath,
      capturedAt,
      "mvp15d-plugin-build",
      "deterministically-redacted",
    ),
    artifactRecord(
      evidenceRoot,
      stderrPath,
      capturedAt,
      "mvp15d-plugin-build",
      "deterministically-redacted",
    ),
  ];
  if (uatLog) {
    const rawLog = requireRegularFile(
      safeWindowsPath(resolve(uatLog), "BUILD_UAT_LOG_PATH_UNSAFE"),
      "BUILD_UAT_LOG_MISSING",
    );
    const derivativePath = resolve(evidenceRoot, "logs", "runuat.external.redacted.log");
    writeFileSync(
      derivativePath,
      redactTranscript(readFileSync(rawLog, "utf8"), provenance),
      "utf8",
    );
    const derivative = artifactRecord(
      evidenceRoot,
      derivativePath,
      capturedAt,
      "mvp15d-plugin-build",
      "deterministically-redacted",
    );
    derivative.observedRawSize = lstatSync(rawLog).size;
    derivative.observedRawSha256 = sha256File(rawLog);
    sourceArtifacts.push(derivative);
  }
  const childExitCode = result.error || !Number.isInteger(result.status) ? null : result.status;
  let toolchainFacts = null;
  let toolchainReason = null;
  if (!result.error && childExitCode === 0) {
    try {
      toolchainFacts = deriveToolchainFacts(
        `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
        engineIdentity,
      );
      ensurePackagedModuleIndex(packageRoot, engineIdentity);
    } catch (error) {
      toolchainReason =
        error instanceof ToolingError ? error.code : "BUILD_TOOLCHAIN_EVIDENCE_INVALID";
    }
  }
  const succeeded = !result.error && childExitCode === 0 && toolchainFacts !== null;
  if (!succeeded && existsSync(packageRoot)) {
    rmSync(packageRoot, { recursive: true, force: true });
  }
  const fingerprintBasis = {
    ...commandLedger,
    toolchainFacts,
  };
  delete fingerprintBasis.commandFingerprint;
  const finalCommandLedger = {
    ...commandLedger,
    toolchainFacts,
    commandFingerprint: sha256Bytes(Buffer.from(stable(fingerprintBasis), "utf8")),
  };
  const summary = {
    schemaVersion: BUILD_RESULT_SCHEMA,
    taskGeneration: TASK_GENERATION,
    taskMarker,
    status: succeeded ? "build_completed" : "build_failed",
    reason: succeeded
      ? null
      : (toolchainReason ?? (result.error ? "RUNUAT_SPAWN_FAILED" : "RUNUAT_EXIT_NONZERO")),
    commandFingerprint: finalCommandLedger.commandFingerprint,
    childPid: Number.isSafeInteger(result.pid) ? result.pid : null,
    childExitCode,
    wrapperExitCode: succeeded ? 0 : 1,
    sourceArtifacts,
    packagePresent: existsSync(packageRoot),
    successManifestPresent: existsSync(resolve(packageRoot, "UAgentAssetTools.build.json")),
    closeout: {
      wrapperPid: process.pid,
      childExited: childExitCode !== null,
      taskOwnedResidualCount: 0,
    },
  };
  if (!succeeded && (summary.packagePresent || summary.successManifestPresent)) {
    fail("RUNUAT_FAILURE_RESIDUE");
  }
  writeFileSync(
    resolve(evidenceRoot, "metadata", "build-command.json"),
    `${JSON.stringify(finalCommandLedger, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  writeFileSync(
    resolve(evidenceRoot, "metadata", "build-result.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  return { summary, result };
}

function runBuild(argv) {
  const args = parseArgs(argv);
  if (!args.source || !args.package || !args.runuat || !args["ue-root"]) {
    fail("BUILD_ARGUMENT_REQUIRED");
  }
  const mode = args.mode ?? "live";
  if (!["plan", "live"].includes(mode)) fail("BUILD_MODE_INVALID");
  const provenance = deriveGitFacts(args.source);
  const plugin = resolvePlugin(provenance, args.plugin);
  const packageRoot = safeWindowsPath(resolve(args.package), "PACKAGE_PATH_UNSAFE");
  if (existsSync(packageRoot)) fail("PACKAGE_TARGET_ALREADY_EXISTS");
  const runUat = resolveRunUat(args.runuat);
  const engineIdentity = readEngineIdentity(args["ue-root"], runUat);
  const orderedArguments = orderedBuildArguments(plugin, packageRoot);
  const taskId = args["task-id"] ?? DEFAULT_TASK_ID;
  if (typeof taskId !== "string" || !/^TASK-MVP15D-[A-Z0-9-]+$/.test(taskId)) {
    fail("BUILD_TASK_ID_INVALID");
  }
  const ledger = buildCommandLedger({
    taskId,
    runUat,
    orderedArguments,
    provenance,
    plugin,
    packageRoot,
    engineIdentity,
  });
  if (mode === "plan") {
    return {
      status: "build_planned",
      buildCompleted: false,
      runUat,
      orderedArguments,
      sanitizedCommand: exactCmdCommand(runUat, orderedArguments),
      commandLedger: ledger,
      physicalFixtures: provenance.physicalFixtures,
    };
  }
  if (!args["evidence-root"] || !args["task-marker"]) {
    fail("BUILD_LIVE_EVIDENCE_ARGUMENT_REQUIRED");
  }
  if (!SAFE_MARKER.test(args["task-marker"])) fail("BUILD_TASK_MARKER_INVALID");
  const evidenceRoot = validateEvidenceRoot(
    args["evidence-root"],
    provenance.repositoryRoot,
    taskId,
  );
  const execution = executeBuild({
    runUat,
    orderedArguments,
    cwd: provenance.sourceRoot,
    packageRoot,
    evidenceRoot,
    provenance,
    commandLedger: ledger,
    taskMarker: args["task-marker"],
    uatLog: args["uat-log"],
    engineIdentity,
  });
  return execution.summary;
}

function main() {
  const output = runBuild(process.argv.slice(2));
  console.log(JSON.stringify(output));
  if (output.status === "build_failed") process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    const reason = error instanceof ToolingError ? error.code : "BUILD_TOOLING_FAILED";
    console.error(JSON.stringify({ status: "build_rejected", reason }));
    process.exitCode = 2;
  }
}

export {
  BUILD_COMMAND_SCHEMA,
  CANONICAL_FIXTURE_SHA256,
  CANONICAL_FIXTURE_SIZE,
  ToolingError,
  assertCanonicalPhysicalBytes,
  buildCommandLedger,
  deriveToolchainFacts,
  deriveGitFacts,
  exactCmdCommand,
  orderedBuildArguments,
  readEngineIdentity,
  runBuild,
  safeWindowsPath,
  stable,
};
