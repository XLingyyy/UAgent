#!/usr/bin/env node
/* global console, process */

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const TASK_ID = "TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-SOURCE-CHECKPOINT-REWORK-7";
const PREPARE_SCHEMA = "uagent.mvp15d.rework7.build-prepare.v1";
const BUILD_RUN_SCHEMA = "uagent.mvp15d.rework7.build-run.v2";
const PROCESS_SCHEMA = "uagent.mvp15d.rework7.build-process-ledger.v2";
const REVIEW_SCHEMA = "uagent.mvp15d.rework7.build-review.v2";
const INVENTORY_SCHEMA = "uagent.mvp15d.rework7.build-inventory.v1";
const SOURCE_EQUALITY_SCHEMA = "uagent.mvp15d.rework7.source-equality.v1";
const PROJECT_IDENTITY_SCHEMA = "uagent.mvp15d.rework7.project-identity.v1";
const MANIFEST_SCHEMA = "uagent.ue-companion-plugin.build-manifest.v1";
const JOB_SCHEMA = "uagent.mvp15d.windows-job-process-run.v1";
const BUILD_COMMAND_SCHEMA = "uagent.mvp15d.build-command.v1";
const BUILD_PORTS = [1345];
const SOURCE_COMMIT = "0".repeat(40);
const ENGINE_ROOT = "G:\\UnrealEngine\\UE_5.8";
const DOTNET = join(
  ENGINE_ROOT,
  "Engine",
  "Binaries",
  "ThirdParty",
  "DotNet",
  "10.0",
  "win-x64",
  "dotnet.exe",
);
const UBT = join(
  ENGINE_ROOT,
  "Engine",
  "Binaries",
  "DotNET",
  "UnrealBuildTool",
  "UnrealBuildTool.dll",
);
const JOB_HELPER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "mvp15d-windows-job-process-runner.ps1",
);
const PLUGIN_RELATIVE = join("integrations", "unreal", "UAgentAssetTools");
const PROJECT_FILE = "HostProject.uproject";
const BUILD_ARGUMENTS = [
  "UnrealBuildTool.dll",
  "UnrealEditor",
  "Win64",
  "Development",
  `-Project=${PROJECT_FILE}`,
  "-WaitMutex",
  "-NoHotReloadFromIDE",
  "-MaxParallelActions=1",
  "-NoUBA",
];
const PREPARE_RECEIPT = join("Saved", "UAgentMvp15DRework7BuildPreparation.json");
const MANIFEST_NAME = "UAgentAssetTools.build.json";
const EMPTY_CONTENT_SHA256 = "926acba71ebeb9e598c2c5219019667a8685f0c444f13761ea8ffc37dfe5466d";
const TOOL_NAMES = [
  "ue.asset.create_folder",
  "ue.asset.duplicate",
  "ue.asset.rename",
  "ue.asset.move",
  "ue.asset.delete",
  "ue.asset.save",
];

class BundleError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new BundleError(code);
}

function stable(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("BUILD_BUNDLE_NON_JSON_VALUE");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (
    !value ||
    typeof value !== "object" ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  )
    fail("BUILD_BUNDLE_NON_JSON_VALUE");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
    .join(",")}}`;
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

function isHash(value, length = 64) {
  return typeof value === "string" && new RegExp(`^[0-9a-f]{${length}}$`).test(value);
}

function samePath(left, right) {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

function within(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function requireDirectory(path, code) {
  if (!existsSync(path)) fail(code);
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(code);
  return path;
}

function requireFile(path, code) {
  if (!existsSync(path)) fail(code);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(code);
  return path;
}

function requireRealDirectory(path, code) {
  const directory = requireDirectory(resolve(path), code);
  if (!samePath(realpathSync.native(directory), directory)) fail(code);
  return directory;
}

function requireFreshDirectChild(parent, value, pattern, code) {
  const canonicalParent = requireRealDirectory(parent, code);
  const candidate = resolve(value);
  if (
    !samePath(dirname(candidate), canonicalParent) ||
    !pattern.test(basename(candidate)) ||
    existsSync(candidate)
  )
    fail(code);
  return candidate;
}

function requireExistingDirectChild(parent, value, pattern, code) {
  const canonicalParent = requireRealDirectory(parent, code);
  const candidate = requireRealDirectory(value, code);
  if (!samePath(dirname(candidate), canonicalParent) || !pattern.test(basename(candidate)))
    fail(code);
  return candidate;
}

function projectRootPattern() {
  return /^UAgent-MVP15D-Rework7-[A-Za-z0-9_-]+$/i;
}

function buildRunPattern() {
  return /^UAgent-MVP15D-Rework7-build-run-[A-Za-z0-9_-]+$/i;
}

function bundlePattern() {
  return /^mvp15d-rework7-build-[A-Za-z0-9_-]+$/i;
}

function parseArgs(argv) {
  const supported = new Set([
    "repository",
    "project-root",
    "project",
    "output",
    "build-run",
    "task-root",
  ]);
  const args = Object.create(null);
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    const key = item?.startsWith("--") ? item.slice(2) : "";
    const value = argv[index + 1];
    if (!supported.has(key) || Object.hasOwn(args, key) || !value || value.startsWith("--"))
      fail("BUILD_BUNDLE_ARGUMENT_INVALID");
    args[key] = value;
    index += 1;
  }
  return args;
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

function readJson(path, code) {
  try {
    return JSON.parse(readFileSync(requireFile(path, code), "utf8"));
  } catch {
    fail(code);
  }
}

function writeJson(path, value, code) {
  try {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch {
    fail(code);
  }
}

function toLogical(value) {
  return value.split(sep).join("/");
}

function safeLogicalPath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\\") ||
    isAbsolute(value) ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    return false;
  const resolved = resolve("C:\\bundle-root", value.split("/").join(sep));
  return within("C:\\bundle-root", resolved);
}

function walkFiles(root, current = "", state = { files: [], directories: new Set([""]) }) {
  const directory = requireDirectory(resolve(root, current), "BUILD_BUNDLE_TREE_INVALID");
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name, "en"),
  )) {
    if (!entry.name || entry.name === "." || entry.name === ".." || entry.isSymbolicLink())
      fail("BUILD_BUNDLE_TREE_INVALID");
    const logical = current ? `${toLogical(current)}/${entry.name}` : entry.name;
    const child = resolve(root, logical.split("/").join(sep));
    if (!within(root, child)) fail("BUILD_BUNDLE_TREE_INVALID");
    if (entry.isDirectory()) {
      state.directories.add(logical);
      walkFiles(root, logical, state);
    } else if (entry.isFile()) {
      requireFile(child, "BUILD_BUNDLE_TREE_INVALID");
      state.files.push(logical);
    } else {
      fail("BUILD_BUNDLE_TREE_INVALID");
    }
  }
  return state;
}

function fileRecord(root, logicalPath) {
  if (!safeLogicalPath(logicalPath)) fail("BUILD_BUNDLE_LOGICAL_PATH_INVALID");
  const path = resolve(root, logicalPath.split("/").join(sep));
  if (!within(root, path)) fail("BUILD_BUNDLE_LOGICAL_PATH_INVALID");
  const file = requireFile(path, "BUILD_BUNDLE_FILE_MISSING");
  return { path: logicalPath, size: lstatSync(file).size, sha256: sha256File(file) };
}

function artifact(path, name = basename(path)) {
  const file = requireFile(path, "BUILD_BUNDLE_ARTIFACT_MISSING");
  return { name, size: lstatSync(file).size, sha256: sha256File(file) };
}

function copyExclusive(source, destination) {
  requireFile(source, "BUILD_BUNDLE_COPY_SOURCE_INVALID");
  if (existsSync(destination)) fail("BUILD_BUNDLE_COPY_DESTINATION_EXISTS");
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination, 1);
  if (
    lstatSync(source).size !== lstatSync(destination).size ||
    sha256File(source) !== sha256File(destination)
  )
    fail("BUILD_BUNDLE_COPY_MISMATCH");
}

function sourcePath(path) {
  return (
    path === "README.md" ||
    path === "UAgentAssetTools.uplugin" ||
    path.startsWith("Config/") ||
    path.startsWith("Resources/") ||
    path.startsWith("Source/")
  );
}

function sourceInventory(sourceRoot) {
  const paths = walkFiles(sourceRoot).files.filter(sourcePath);
  const files = paths
    .map((path) => fileRecord(sourceRoot, path))
    .sort((a, b) => a.path.localeCompare(b.path, "en"));
  if (files.length !== 19) fail("BUILD_BUNDLE_SOURCE_FILE_COUNT_INVALID");
  const sourceTreeSha256 = sha256Bytes(
    Buffer.concat(
      files.flatMap((file) => [
        Buffer.from(file.path, "utf8"),
        Buffer.from([0]),
        readFileSync(resolve(sourceRoot, file.path.split("/").join(sep))),
      ]),
    ),
  );
  const sourceBundleSha256 = sha256Bytes(
    Buffer.concat([
      Buffer.from("uagent.mvp15d.source-bundle.v1\0", "utf8"),
      Buffer.from(
        files.map((file) => `${file.path}\0${file.size}\0${file.sha256}`).join("\n"),
        "utf8",
      ),
    ]),
  );
  return { files, sourceTreeSha256, sourceBundleSha256 };
}

function powershellJson(script, env, code) {
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      encoding: "utf8",
      env: { ...process.env, ...env },
      shell: false,
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) fail(code);
  try {
    const value = JSON.parse(result.stdout.trim() || "[]");
    if (!Array.isArray(value)) fail(code);
    return value;
  } catch {
    fail(code);
  }
}

function scanCloseout(marker) {
  const listeners = powershellJson(
    `@([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
      Where-Object { $_.Port -in 1345 } |
      ForEach-Object { [ordered]@{ address = $_.Address.ToString(); port = [int]$_.Port } }) |
      ConvertTo-Json -Compress`,
    {},
    "BUILD_BUNDLE_PORT_SCAN_FAILED",
  );
  const markerProcesses = powershellJson(
    `@(Get-CimInstance Win32_Process -ErrorAction Stop |
      Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:UAGENT_BUILD_MARKER) } |
      ForEach-Object {
        [ordered]@{
          pid = [int]$_.ProcessId
          parentPid = [int]$_.ParentProcessId
          executablePath = [string]$_.ExecutablePath
          commandLine = [string]$_.CommandLine
        }
      }) | ConvertTo-Json -Compress`,
    { UAGENT_BUILD_MARKER: marker },
    "BUILD_BUNDLE_MARKER_SCAN_FAILED",
  );
  return {
    capturedAt: new Date().toISOString(),
    marker,
    ports: BUILD_PORTS,
    listeners,
    markerProcesses,
  };
}

function contentAggregate(contentRoot) {
  const root = requireDirectory(contentRoot, "BUILD_BUNDLE_CONTENT_INVALID");
  const files = walkFiles(root)
    .files.map((path) => fileRecord(root, path))
    .sort((a, b) => a.path.localeCompare(b.path, "en"));
  const aggregateSha256 = sha256Bytes(
    Buffer.concat([
      Buffer.from("uagent.mvp15d.content.v1\0", "utf8"),
      Buffer.from(
        files.map((file) => `${file.path}\0${file.size}\0${file.sha256}`).join("\n"),
        "utf8",
      ),
    ]),
  );
  return { fileCount: files.length, aggregateSha256 };
}

function repositoryRoot(value) {
  const root = requireRealDirectory(value, "BUILD_BUNDLE_REPOSITORY_INVALID");
  requireDirectory(resolve(root, "external"), "BUILD_BUNDLE_EXTERNAL_ROOT_INVALID");
  requireDirectory(
    resolve(root, "integrations", "unreal", "UAgentAssetTools"),
    "BUILD_BUNDLE_SOURCE_ROOT_INVALID",
  );
  return root;
}

function resolveProject(value) {
  const project = requireFile(resolve(value), "BUILD_BUNDLE_PROJECT_INVALID");
  if (basename(project) !== PROJECT_FILE) fail("BUILD_BUNDLE_PROJECT_INVALID");
  const root = requireExistingDirectChild(
    resolve(tmpdir()),
    dirname(project),
    projectRootPattern(),
    "BUILD_BUNDLE_PROJECT_INVALID",
  );
  return { project, root, plugin: resolve(root, "Plugins", "UAgentAssetTools") };
}

function prepare(args) {
  if (!args.repository || !args["project-root"]) fail("BUILD_BUNDLE_ARGUMENT_REQUIRED");
  const repository = repositoryRoot(args.repository);
  const projectRoot = requireFreshDirectChild(
    resolve(tmpdir()),
    args["project-root"],
    projectRootPattern(),
    "BUILD_BUNDLE_PROJECT_DESTINATION_INVALID",
  );
  const sourceRoot = requireRealDirectory(
    resolve(repository, PLUGIN_RELATIVE),
    "BUILD_BUNDLE_SOURCE_ROOT_INVALID",
  );
  const source = sourceInventory(sourceRoot);
  mkdirSync(projectRoot, { recursive: false });
  mkdirSync(resolve(projectRoot, "Content"), { recursive: false });
  mkdirSync(resolve(projectRoot, "Plugins"), { recursive: false });
  mkdirSync(resolve(projectRoot, "Saved"), { recursive: false });
  const pluginRoot = resolve(projectRoot, "Plugins", "UAgentAssetTools");
  mkdirSync(pluginRoot, { recursive: false });
  for (const record of source.files) {
    copyExclusive(
      resolve(sourceRoot, record.path.split("/").join(sep)),
      resolve(pluginRoot, record.path.split("/").join(sep)),
    );
  }
  const descriptor = {
    FileVersion: 3,
    EngineAssociation: "5.8",
    Category: "",
    Description: "UAgent MVP15D Rework 7 disposable evidence host",
    Plugins: [{ Name: "UAgentAssetTools", Enabled: true }],
  };
  const project = resolve(projectRoot, PROJECT_FILE);
  writeJson(project, descriptor, "BUILD_BUNDLE_PROJECT_CREATE_FAILED");
  const contentBefore = contentAggregate(resolve(projectRoot, "Content"));
  if (contentBefore.fileCount !== 0 || contentBefore.aggregateSha256 !== EMPTY_CONTENT_SHA256)
    fail("BUILD_BUNDLE_CONTENT_BASELINE_INVALID");
  const receipt = {
    schemaVersion: PREPARE_SCHEMA,
    taskId: TASK_ID,
    notFinal15A: true,
    createdAt: new Date().toISOString(),
    project: artifact(project, PROJECT_FILE),
    sourceFileCount: source.files.length,
    sourceTreeSha256: source.sourceTreeSha256,
    sourceBundleSha256: source.sourceBundleSha256,
    contentBefore,
  };
  writeJson(resolve(projectRoot, PREPARE_RECEIPT), receipt, "BUILD_BUNDLE_PREPARE_RECEIPT_FAILED");
  console.log(
    JSON.stringify({
      status: "prepared",
      taskId: TASK_ID,
      project,
      sourceFileCount: source.files.length,
      sourceTreeSha256: source.sourceTreeSha256,
      contentBefore,
    }),
  );
}

function validateRawJob(raw, expectedMarker, code) {
  if (
    !raw ||
    raw.SchemaVersion !== JOB_SCHEMA ||
    raw.TaskMarker !== expectedMarker ||
    raw.RootExitCode !== 0 ||
    raw.ActiveProcessZeroObserved !== true ||
    raw.TimedOut !== false ||
    raw.ForcedJobTermination !== false ||
    raw.ForcedUnassignedRootTermination !== false ||
    raw.UnassignedRootResidualAfterCleanup !== false ||
    raw.FinalResidualCount !== 0 ||
    raw.UnexpectedJobMessageCount !== 0 ||
    (raw.FailureCode !== null && raw.FailureCode !== "") ||
    !Array.isArray(raw.Processes) ||
    raw.Processes.length === 0 ||
    raw.AccountingTotalProcessCount !== raw.Processes.length ||
    raw.Processes.some(
      (entry) =>
        entry.JobNewProcessObserved !== true ||
        (entry.IdentityComplete === true
          ? entry.JobMembershipVerified !== true
          : typeof entry.JobMembershipVerified !== "boolean"),
    )
  )
    fail(code);
}

function validateProcessLedger(value, phase) {
  assertExactKeys(
    value,
    ["closeout", "phase", "raw", "schemaVersion", "taskId", "taskMarker"],
    "BUILD_BUNDLE_PROCESS_LEDGER_INVALID",
  );
  assertExactKeys(
    value.closeout,
    [
      "capturedAt",
      "exitEventCount",
      "exitEventMissingCount",
      "identityCompleteCount",
      "identityIncompleteCount",
      "jobEventMembershipCount",
      "listeners",
      "marker",
      "markerProcesses",
      "markerScanComplete",
      "ports",
      "portScanComplete",
      "processResidualCount",
    ],
    "BUILD_BUNDLE_PROCESS_LEDGER_INVALID",
  );
  if (
    value.schemaVersion !== PROCESS_SCHEMA ||
    value.taskId !== TASK_ID ||
    value.phase !== phase ||
    typeof value.taskMarker !== "string" ||
    !new RegExp(`^uagent-mvp15d-rework7-build-${phase}-[0-9a-f]{32}$`).test(value.taskMarker) ||
    !Number.isFinite(Date.parse(value.closeout.capturedAt)) ||
    value.closeout.marker !== value.taskMarker ||
    stable(value.closeout.ports) !== stable(BUILD_PORTS) ||
    !Array.isArray(value.closeout.listeners) ||
    value.closeout.listeners.length !== 0 ||
    !Array.isArray(value.closeout.markerProcesses) ||
    value.closeout.markerProcesses.length !== 0 ||
    value.closeout.processResidualCount !== 0 ||
    value.closeout.portScanComplete !== true ||
    value.closeout.markerScanComplete !== true
  )
    fail("BUILD_BUNDLE_PROCESS_LEDGER_INVALID");
  validateRawJob(value.raw, value.taskMarker, "BUILD_BUNDLE_PROCESS_LEDGER_INVALID");
  const identityCompleteCount = value.raw.Processes.filter(
    ({ IdentityComplete }) => IdentityComplete === true,
  ).length;
  const exitEventCount = value.raw.Processes.filter(
    ({ ExitObserved }) => ExitObserved === true,
  ).length;
  if (
    value.closeout.jobEventMembershipCount !== value.raw.Processes.length ||
    value.closeout.identityCompleteCount !== identityCompleteCount ||
    value.closeout.identityIncompleteCount !== value.raw.Processes.length - identityCompleteCount ||
    value.closeout.exitEventCount !== exitEventCount ||
    value.closeout.exitEventMissingCount !== value.raw.Processes.length - exitEventCount
  )
    fail("BUILD_BUNDLE_PROCESS_LEDGER_INVALID");
  return value;
}

function runBuildPhase({ phase, project, output }) {
  const marker = `uagent-mvp15d-rework7-build-${phase}-${randomBytes(16).toString("hex")}`;
  const stdoutPath = resolve(output, `${phase}.stdout.log`);
  const stderrPath = resolve(output, `${phase}.stderr.log`);
  const argumentsBase64 = Buffer.from(
    JSON.stringify([
      UBT,
      "UnrealEditor",
      "Win64",
      "Development",
      `-Project=${project}`,
      "-WaitMutex",
      "-NoHotReloadFromIDE",
      "-MaxParallelActions=1",
      "-NoUBA",
    ]),
    "utf8",
  ).toString("base64");
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      JOB_HELPER,
      "-Executable",
      DOTNET,
      "-WorkingDirectory",
      dirname(project),
      "-ArgumentsBase64",
      argumentsBase64,
      "-StdoutPath",
      stdoutPath,
      "-StderrPath",
      stderrPath,
      "-TaskMarker",
      marker,
      "-TimeoutMilliseconds",
      "1200000",
    ],
    {
      cwd: dirname(project),
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 1_230_000,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0 || !result.stdout?.trim())
    fail("BUILD_BUNDLE_BUILD_HELPER_FAILED");
  let raw;
  try {
    raw = JSON.parse(result.stdout.trim());
  } catch {
    fail("BUILD_BUNDLE_BUILD_HELPER_INVALID");
  }
  writeJson(
    resolve(output, `${phase}.raw.json`),
    raw,
    "BUILD_BUNDLE_BUILD_RAW_LEDGER_WRITE_FAILED",
  );
  validateRawJob(raw, marker, "BUILD_BUNDLE_BUILD_PROCESS_FAILED");
  const closeoutScan = scanCloseout(marker);
  const identityCompleteCount = raw.Processes.filter(
    ({ IdentityComplete }) => IdentityComplete === true,
  ).length;
  const exitEventCount = raw.Processes.filter(({ ExitObserved }) => ExitObserved === true).length;
  const ledger = {
    schemaVersion: PROCESS_SCHEMA,
    taskId: TASK_ID,
    phase,
    taskMarker: marker,
    raw,
    closeout: {
      ...closeoutScan,
      processResidualCount: 0,
      portScanComplete: true,
      markerScanComplete: true,
      jobEventMembershipCount: raw.Processes.length,
      identityCompleteCount,
      identityIncompleteCount: raw.Processes.length - identityCompleteCount,
      exitEventCount,
      exitEventMissingCount: raw.Processes.length - exitEventCount,
    },
  };
  writeJson(
    resolve(output, `${phase}.process.json`),
    ledger,
    "BUILD_BUNDLE_PROCESS_LEDGER_WRITE_FAILED",
  );
  return {
    phase,
    stdout: artifact(stdoutPath, `${phase}.stdout.log`),
    stderr: artifact(stderrPath, `${phase}.stderr.log`),
    process: artifact(resolve(output, `${phase}.process.json`), `${phase}.process.json`),
  };
}

function runBuilds(args) {
  if (!args.project || !args.output) fail("BUILD_BUNDLE_ARGUMENT_REQUIRED");
  requireFile(DOTNET, "BUILD_BUNDLE_DOTNET_UNAVAILABLE");
  requireFile(UBT, "BUILD_BUNDLE_UBT_UNAVAILABLE");
  requireFile(JOB_HELPER, "BUILD_BUNDLE_JOB_HELPER_UNAVAILABLE");
  const binding = resolveProject(args.project);
  const output = requireFreshDirectChild(
    resolve(tmpdir()),
    args.output,
    buildRunPattern(),
    "BUILD_BUNDLE_BUILD_RUN_DESTINATION_INVALID",
  );
  mkdirSync(output, { recursive: false });
  requireExistingDirectChild(
    resolve(tmpdir()),
    output,
    buildRunPattern(),
    "BUILD_BUNDLE_BUILD_RUN_DESTINATION_INVALID",
  );
  const full = runBuildPhase({
    phase: "full",
    project: binding.project,
    output,
  });
  const incremental = runBuildPhase({
    phase: "incremental",
    project: binding.project,
    output,
  });
  const receipt = {
    schemaVersion: BUILD_RUN_SCHEMA,
    taskId: TASK_ID,
    project: artifact(binding.project, PROJECT_FILE),
    full,
    incremental,
    completed: true,
  };
  writeJson(resolve(output, "build-run.json"), receipt, "BUILD_BUNDLE_BUILD_RUN_WRITE_FAILED");
  console.log(
    JSON.stringify({
      status: "built",
      taskId: TASK_ID,
      output,
      fullExitCode: 0,
      incrementalExitCode: 0,
      fullProcessCount: readJson(
        resolve(output, "full.process.json"),
        "BUILD_BUNDLE_PROCESS_LEDGER_INVALID",
      ).raw.Processes.length,
      incrementalProcessCount: readJson(
        resolve(output, "incremental.process.json"),
        "BUILD_BUNDLE_PROCESS_LEDGER_INVALID",
      ).raw.Processes.length,
    }),
  );
}

function validateBuildRun(buildRun, projectArtifact) {
  const root = requireExistingDirectChild(
    resolve(tmpdir()),
    buildRun,
    buildRunPattern(),
    "BUILD_BUNDLE_BUILD_RUN_INVALID",
  );
  const expected = [
    "build-run.json",
    "full.process.json",
    "full.raw.json",
    "full.stderr.log",
    "full.stdout.log",
    "incremental.process.json",
    "incremental.raw.json",
    "incremental.stderr.log",
    "incremental.stdout.log",
  ];
  const actual = walkFiles(root).files.sort((a, b) => a.localeCompare(b, "en"));
  if (stable(actual) !== stable(expected)) fail("BUILD_BUNDLE_BUILD_RUN_INVALID");
  const receipt = readJson(resolve(root, "build-run.json"), "BUILD_BUNDLE_BUILD_RUN_INVALID");
  if (
    receipt.schemaVersion !== BUILD_RUN_SCHEMA ||
    receipt.taskId !== TASK_ID ||
    receipt.completed !== true ||
    stable(receipt.project) !== stable(projectArtifact)
  )
    fail("BUILD_BUNDLE_BUILD_RUN_INVALID");
  const full = validateProcessLedger(
    readJson(resolve(root, "full.process.json"), "BUILD_BUNDLE_PROCESS_LEDGER_INVALID"),
    "full",
  );
  const incremental = validateProcessLedger(
    readJson(resolve(root, "incremental.process.json"), "BUILD_BUNDLE_PROCESS_LEDGER_INVALID"),
    "incremental",
  );
  for (const phase of ["full", "incremental"]) {
    const log = readFileSync(resolve(root, `${phase}.stdout.log`), "utf8");
    if (!/Result:\s+Succeeded/i.test(log)) fail("BUILD_BUNDLE_BUILD_LOG_INVALID");
  }
  return { root, receipt, full, incremental };
}

function manifestHash(manifest) {
  const withoutSelf = { ...manifest };
  delete withoutSelf.manifestSha256;
  return sha256Bytes(Buffer.from(stable(withoutSelf), "utf8"));
}

function buildCommandRecord(buildRun) {
  return {
    schemaVersion: BUILD_COMMAND_SCHEMA,
    executable: artifact(DOTNET, "dotnet.exe"),
    unrealBuildTool: artifact(UBT, "UnrealBuildTool.dll"),
    target: "UnrealEditor Win64 Development",
    project: PROJECT_FILE,
    arguments: BUILD_ARGUMENTS,
    fullTaskMarker: buildRun.full.taskMarker,
    incrementalTaskMarker: buildRun.incremental.taskMarker,
  };
}

function createTaskManifest(pluginRoot, sourceTreeSha256, buildRun) {
  const manifestPath = resolve(pluginRoot, MANIFEST_NAME);
  if (existsSync(manifestPath)) fail("BUILD_BUNDLE_MANIFEST_ALREADY_EXISTS");
  const binaryRoot = requireDirectory(
    resolve(pluginRoot, "Binaries", "Win64"),
    "BUILD_BUNDLE_BINARY_ROOT_INVALID",
  );
  const moduleIndexPath = resolve(binaryRoot, "UnrealEditor.modules");
  const moduleIndex = readJson(moduleIndexPath, "BUILD_BUNDLE_MODULE_INDEX_INVALID");
  const moduleNames = [
    "UnrealEditor-UAgentAssetTools.dll",
    "UnrealEditor-UAgentAssetToolsTests.dll",
  ];
  if (
    Object.keys(moduleIndex).sort().join(",") !== "BuildId,Modules" ||
    Object.keys(moduleIndex.Modules ?? {})
      .sort()
      .join(",") !== "UAgentAssetTools,UAgentAssetToolsTests" ||
    moduleIndex.BuildId !== "55116800" ||
    stable(moduleIndex.Modules) !==
      stable({
        UAgentAssetTools: moduleNames[0],
        UAgentAssetToolsTests: moduleNames[1],
      })
  )
    fail("BUILD_BUNDLE_MODULE_INDEX_INVALID");
  const buildCommand = buildCommandRecord(buildRun);
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA,
    pluginId: "UAgentAssetTools",
    pluginVersion: "0.1.0",
    contractVersion: "mvp15d.asset-tools.v1",
    sourceCommit: SOURCE_COMMIT,
    sourceTreeSha256,
    dirty: false,
    ueVersion: "5.8.0",
    ueBuildId: "55116800",
    targetPlatform: "Win64",
    configuration: "Development",
    compiler: "MSVC",
    windowsSdk: "Windows SDK",
    buildCommandFingerprint: sha256Bytes(Buffer.from(stable(buildCommand), "utf8")),
    uplugin: artifact(resolve(pluginRoot, "UAgentAssetTools.uplugin")),
    schema: artifact(
      resolve(pluginRoot, "Resources", "uagent-asset-tools.schema.json"),
      "uagent-asset-tools.schema.json",
    ),
    moduleIndex: artifact(moduleIndexPath, "UnrealEditor.modules"),
    modules: moduleNames.map((name) => artifact(resolve(binaryRoot, name), name)),
    toolNames: TOOL_NAMES,
    generatedAt: new Date().toISOString(),
    builder: { kind: "local", name: "uagent-mvp15d-rework7-task-only" },
  };
  const output = { ...manifest, manifestSha256: manifestHash(manifest) };
  writeJson(manifestPath, output, "BUILD_BUNDLE_MANIFEST_WRITE_FAILED");
  validateManifest(output, pluginRoot, sourceTreeSha256, buildCommand);
  return output;
}

function validateManifest(manifest, pluginRoot, sourceTreeSha256, buildCommand) {
  assertExactKeys(
    manifest,
    [
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
    ],
    "BUILD_BUNDLE_MANIFEST_INVALID",
  );
  if (
    manifest.schemaVersion !== MANIFEST_SCHEMA ||
    manifest.pluginId !== "UAgentAssetTools" ||
    manifest.pluginVersion !== "0.1.0" ||
    manifest.contractVersion !== "mvp15d.asset-tools.v1" ||
    manifest.sourceCommit !== SOURCE_COMMIT ||
    manifest.sourceTreeSha256 !== sourceTreeSha256 ||
    manifest.dirty !== false ||
    manifest.ueVersion !== "5.8.0" ||
    manifest.ueBuildId !== "55116800" ||
    manifest.targetPlatform !== "Win64" ||
    manifest.configuration !== "Development" ||
    manifest.compiler !== "MSVC" ||
    manifest.windowsSdk !== "Windows SDK" ||
    manifest.buildCommandFingerprint !== sha256Bytes(Buffer.from(stable(buildCommand), "utf8")) ||
    typeof manifest.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(manifest.generatedAt)) ||
    new Date(manifest.generatedAt).toISOString() !== manifest.generatedAt ||
    !isHash(manifest.manifestSha256) ||
    manifest.manifestSha256 !== manifestHash(manifest) ||
    stable(manifest.toolNames) !== stable(TOOL_NAMES) ||
    stable(manifest.builder) !== stable({ kind: "local", name: "uagent-mvp15d-rework7-task-only" })
  )
    fail("BUILD_BUNDLE_MANIFEST_INVALID");
  const moduleIndex = readJson(
    resolve(pluginRoot, "Binaries", "Win64", "UnrealEditor.modules"),
    "BUILD_BUNDLE_MODULE_INDEX_INVALID",
  );
  assertExactKeys(moduleIndex, ["BuildId", "Modules"], "BUILD_BUNDLE_MODULE_INDEX_INVALID");
  assertExactKeys(
    moduleIndex.Modules,
    ["UAgentAssetTools", "UAgentAssetToolsTests"],
    "BUILD_BUNDLE_MODULE_INDEX_INVALID",
  );
  if (
    moduleIndex.BuildId !== manifest.ueBuildId ||
    moduleIndex.Modules.UAgentAssetTools !== "UnrealEditor-UAgentAssetTools.dll" ||
    moduleIndex.Modules.UAgentAssetToolsTests !== "UnrealEditor-UAgentAssetToolsTests.dll"
  )
    fail("BUILD_BUNDLE_MODULE_INDEX_INVALID");
  const expected = {
    uplugin: artifact(resolve(pluginRoot, "UAgentAssetTools.uplugin")),
    schema: artifact(
      resolve(pluginRoot, "Resources", "uagent-asset-tools.schema.json"),
      "uagent-asset-tools.schema.json",
    ),
    moduleIndex: artifact(
      resolve(pluginRoot, "Binaries", "Win64", "UnrealEditor.modules"),
      "UnrealEditor.modules",
    ),
    modules: [
      artifact(resolve(pluginRoot, "Binaries", "Win64", "UnrealEditor-UAgentAssetTools.dll")),
      artifact(resolve(pluginRoot, "Binaries", "Win64", "UnrealEditor-UAgentAssetToolsTests.dll")),
    ],
  };
  if (
    stable(manifest.uplugin) !== stable(expected.uplugin) ||
    stable(manifest.schema) !== stable(expected.schema) ||
    stable(manifest.moduleIndex) !== stable(expected.moduleIndex) ||
    stable(manifest.modules) !== stable(expected.modules)
  )
    fail("BUILD_BUNDLE_MANIFEST_ARTIFACT_MISMATCH");
  return manifest;
}

function copySourceSnapshot(sourceRoot, destinationRoot, inventory) {
  for (const record of inventory.files) {
    copyExclusive(
      resolve(sourceRoot, record.path.split("/").join(sep)),
      resolve(destinationRoot, record.path.split("/").join(sep)),
    );
  }
}

function create(args) {
  if (!args.repository || !args.project || !args.output || !args["build-run"])
    fail("BUILD_BUNDLE_ARGUMENT_REQUIRED");
  const repository = repositoryRoot(args.repository);
  const binding = resolveProject(args.project);
  const repositorySourceRoot = requireRealDirectory(
    resolve(repository, PLUGIN_RELATIVE),
    "BUILD_BUNDLE_SOURCE_ROOT_INVALID",
  );
  const projectSourceRoot = requireRealDirectory(
    binding.plugin,
    "BUILD_BUNDLE_PROJECT_SOURCE_INVALID",
  );
  const repositorySource = sourceInventory(repositorySourceRoot);
  const projectSource = sourceInventory(projectSourceRoot);
  if (stable(repositorySource) !== stable(projectSource))
    fail("BUILD_BUNDLE_SOURCE_EQUALITY_FAILED");
  const prepareReceipt = readJson(
    resolve(binding.root, PREPARE_RECEIPT),
    "BUILD_BUNDLE_PREPARE_RECEIPT_INVALID",
  );
  if (
    prepareReceipt.schemaVersion !== PREPARE_SCHEMA ||
    prepareReceipt.taskId !== TASK_ID ||
    prepareReceipt.notFinal15A !== true ||
    prepareReceipt.sourceTreeSha256 !== repositorySource.sourceTreeSha256 ||
    prepareReceipt.sourceBundleSha256 !== repositorySource.sourceBundleSha256 ||
    stable(prepareReceipt.project) !== stable(artifact(binding.project, PROJECT_FILE))
  )
    fail("BUILD_BUNDLE_PREPARE_RECEIPT_INVALID");
  const buildRun = validateBuildRun(args["build-run"], prepareReceipt.project);
  const manifest = createTaskManifest(binding.plugin, repositorySource.sourceTreeSha256, buildRun);
  const contentAfter = contentAggregate(resolve(binding.root, "Content"));
  if (stable(contentAfter) !== stable(prepareReceipt.contentBefore) || contentAfter.fileCount !== 0)
    fail("BUILD_BUNDLE_CONTENT_CHANGED");
  const output = requireFreshDirectChild(
    resolve(repository, "external"),
    args.output,
    bundlePattern(),
    "BUILD_BUNDLE_OUTPUT_INVALID",
  );
  mkdirSync(output, { recursive: false });
  requireExistingDirectChild(
    resolve(repository, "external"),
    output,
    bundlePattern(),
    "BUILD_BUNDLE_OUTPUT_INVALID",
  );
  copyExclusive(binding.project, resolve(output, "project", PROJECT_FILE));
  copyExclusive(
    resolve(binding.root, PREPARE_RECEIPT),
    resolve(output, "metadata", "prepare-receipt.json"),
  );
  copySourceSnapshot(
    repositorySourceRoot,
    resolve(output, "snapshots", "repository", "UAgentAssetTools"),
    repositorySource,
  );
  copySourceSnapshot(
    projectSourceRoot,
    resolve(output, "snapshots", "project", "UAgentAssetTools"),
    projectSource,
  );
  for (const phase of ["full", "incremental"]) {
    copyExclusive(
      resolve(buildRun.root, `${phase}.stdout.log`),
      resolve(output, "logs", `${phase}.stdout.log`),
    );
    copyExclusive(
      resolve(buildRun.root, `${phase}.stderr.log`),
      resolve(output, "logs", `${phase}.stderr.log`),
    );
    copyExclusive(
      resolve(buildRun.root, `${phase}.process.json`),
      resolve(output, "ledgers", `${phase}.process.json`),
    );
    copyExclusive(
      resolve(buildRun.root, `${phase}.raw.json`),
      resolve(output, "ledgers", `${phase}.raw.json`),
    );
  }
  const compiledRoot = resolve(output, "compiled", "UAgentAssetTools");
  const compiledCopies = [
    ["UAgentAssetTools.uplugin", "UAgentAssetTools.uplugin"],
    [
      join("Resources", "uagent-asset-tools.schema.json"),
      "Resources/uagent-asset-tools.schema.json",
    ],
    [join("Resources", "mvp15d-native-binding-v2.json"), "Resources/mvp15d-native-binding-v2.json"],
    [join("Binaries", "Win64", "UnrealEditor.modules"), "Binaries/Win64/UnrealEditor.modules"],
    [
      join("Binaries", "Win64", "UnrealEditor-UAgentAssetTools.dll"),
      "Binaries/Win64/UnrealEditor-UAgentAssetTools.dll",
    ],
    [
      join("Binaries", "Win64", "UnrealEditor-UAgentAssetToolsTests.dll"),
      "Binaries/Win64/UnrealEditor-UAgentAssetToolsTests.dll",
    ],
    [MANIFEST_NAME, MANIFEST_NAME],
  ];
  for (const [source, destination] of compiledCopies) {
    copyExclusive(
      resolve(binding.plugin, source),
      resolve(compiledRoot, destination.split("/").join(sep)),
    );
  }
  const sourceEquality = {
    schemaVersion: SOURCE_EQUALITY_SCHEMA,
    taskId: TASK_ID,
    sourceTreeSha256: repositorySource.sourceTreeSha256,
    sourceBundleSha256: repositorySource.sourceBundleSha256,
    fileCount: repositorySource.files.length,
    files: repositorySource.files.map((record) => ({
      path: record.path,
      size: record.size,
      sha256: record.sha256,
      repositoryEqualsProject: true,
      retainedRepositoryEqualsProject: true,
    })),
    complete: true,
  };
  writeJson(
    resolve(output, "metadata", "source-equality.json"),
    sourceEquality,
    "BUILD_BUNDLE_SOURCE_EQUALITY_WRITE_FAILED",
  );
  const projectIdentity = {
    schemaVersion: PROJECT_IDENTITY_SCHEMA,
    taskId: TASK_ID,
    project: artifact(resolve(output, "project", PROJECT_FILE), PROJECT_FILE),
    engineAssociation: "5.8",
    pluginId: "UAgentAssetTools",
    enabled: true,
    notFinal15A: true,
  };
  writeJson(
    resolve(output, "metadata", "project-identity.json"),
    projectIdentity,
    "BUILD_BUNDLE_PROJECT_IDENTITY_WRITE_FAILED",
  );
  const buildCommand = buildCommandRecord(buildRun);
  writeJson(
    resolve(output, "metadata", "build-command.json"),
    buildCommand,
    "BUILD_BUNDLE_BUILD_COMMAND_WRITE_FAILED",
  );
  const compiledArtifacts = compiledCopies.map(([, destination]) =>
    fileRecord(output, `compiled/UAgentAssetTools/${destination}`),
  );
  const review = {
    schemaVersion: REVIEW_SCHEMA,
    taskId: TASK_ID,
    notFinal15A: true,
    projectIdentitySha256: sha256File(resolve(output, "metadata", "project-identity.json")),
    prepareReceiptSha256: sha256File(resolve(output, "metadata", "prepare-receipt.json")),
    sourceEqualitySha256: sha256File(resolve(output, "metadata", "source-equality.json")),
    sourceTreeSha256: repositorySource.sourceTreeSha256,
    sourceBundleSha256: repositorySource.sourceBundleSha256,
    manifestSha256: manifest.manifestSha256,
    compiledArtifacts,
    buildLogs: ["full", "incremental"].flatMap((phase) => [
      fileRecord(output, `logs/${phase}.stdout.log`),
      fileRecord(output, `logs/${phase}.stderr.log`),
    ]),
    processLedgers: ["full", "incremental"].map((phase) =>
      fileRecord(output, `ledgers/${phase}.process.json`),
    ),
    contentBefore: prepareReceipt.contentBefore,
    contentAfter,
    contentUnchanged: true,
    processCloseout: {
      complete: true,
      phaseCount: 2,
      processResidualCount: 0,
      jobEventMembershipCount:
        buildRun.full.raw.Processes.length + buildRun.incremental.raw.Processes.length,
      identityCompleteCount:
        buildRun.full.closeout.identityCompleteCount +
        buildRun.incremental.closeout.identityCompleteCount,
      identityIncompleteCount:
        buildRun.full.closeout.identityIncompleteCount +
        buildRun.incremental.closeout.identityIncompleteCount,
      exitEventCount:
        buildRun.full.closeout.exitEventCount + buildRun.incremental.closeout.exitEventCount,
      exitEventMissingCount:
        buildRun.full.closeout.exitEventMissingCount +
        buildRun.incremental.closeout.exitEventMissingCount,
    },
    portCloseout: {
      complete: true,
      applicable: true,
      scannedPorts: BUILD_PORTS,
      residualCount: 0,
    },
    markerCloseout: {
      complete: true,
      markerCount: 2,
      residualCount: 0,
    },
    status: "completed",
  };
  writeJson(
    resolve(output, "metadata", "build-review.json"),
    review,
    "BUILD_BUNDLE_REVIEW_WRITE_FAILED",
  );
  const entries = walkFiles(output)
    .files.filter((path) => path !== "inventory.json")
    .map((path) => fileRecord(output, path))
    .sort((a, b) => a.path.localeCompare(b.path, "en"));
  const bundleSha256 = sha256Bytes(
    Buffer.from(
      entries.map((entry) => `${entry.path}\0${entry.size}\0${entry.sha256}`).join("\n"),
      "utf8",
    ),
  );
  const inventoryBase = {
    schemaVersion: INVENTORY_SCHEMA,
    taskId: TASK_ID,
    entries,
    bundleSha256,
  };
  const inventory = {
    ...inventoryBase,
    inventorySha256: sha256Bytes(Buffer.from(stable(inventoryBase), "utf8")),
  };
  writeJson(resolve(output, "inventory.json"), inventory, "BUILD_BUNDLE_INVENTORY_WRITE_FAILED");
  const result = validate({ repository, taskRoot: output });
  console.log(JSON.stringify({ status: "created", ...result }));
}

function validateInventory(root) {
  const inventory = readJson(resolve(root, "inventory.json"), "BUILD_BUNDLE_INVENTORY_INVALID");
  assertExactKeys(
    inventory,
    ["bundleSha256", "entries", "inventorySha256", "schemaVersion", "taskId"],
    "BUILD_BUNDLE_INVENTORY_INVALID",
  );
  if (
    inventory.schemaVersion !== INVENTORY_SCHEMA ||
    inventory.taskId !== TASK_ID ||
    !Array.isArray(inventory.entries) ||
    !isHash(inventory.bundleSha256) ||
    !isHash(inventory.inventorySha256)
  )
    fail("BUILD_BUNDLE_INVENTORY_INVALID");
  const withoutSelf = { ...inventory };
  delete withoutSelf.inventorySha256;
  if (inventory.inventorySha256 !== sha256Bytes(Buffer.from(stable(withoutSelf), "utf8")))
    fail("BUILD_BUNDLE_INVENTORY_SELF_HASH_MISMATCH");
  const seen = new Set();
  const seenFolded = new Set();
  for (const entry of inventory.entries) {
    assertExactKeys(entry, ["path", "sha256", "size"], "BUILD_BUNDLE_INVENTORY_ENTRY_INVALID");
    const folded = typeof entry.path === "string" ? entry.path.toLowerCase() : "";
    if (
      !safeLogicalPath(entry.path) ||
      entry.path === "inventory.json" ||
      seen.has(entry.path) ||
      seenFolded.has(folded) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      !isHash(entry.sha256)
    )
      fail("BUILD_BUNDLE_INVENTORY_ENTRY_INVALID");
    seen.add(entry.path);
    seenFolded.add(folded);
  }
  const orderedPaths = inventory.entries.map(({ path }) => path);
  if (stable(orderedPaths) !== stable([...orderedPaths].sort((a, b) => a.localeCompare(b, "en"))))
    fail("BUILD_BUNDLE_INVENTORY_ENTRY_ORDER_INVALID");
  const actualTree = walkFiles(root);
  const actualFiles = actualTree.files
    .filter((path) => path !== "inventory.json")
    .sort((a, b) => a.localeCompare(b, "en"));
  const expectedFiles = inventory.entries
    .map(({ path }) => path)
    .sort((a, b) => a.localeCompare(b, "en"));
  if (stable(actualFiles) !== stable(expectedFiles))
    fail("BUILD_BUNDLE_INVENTORY_FILE_SET_MISMATCH");
  const expectedDirectories = new Set([""]);
  for (const path of ["inventory.json", ...expectedFiles]) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      expectedDirectories.add(parts.slice(0, index).join("/"));
    }
  }
  if (
    stable([...actualTree.directories].sort((a, b) => a.localeCompare(b, "en"))) !==
    stable([...expectedDirectories].sort((a, b) => a.localeCompare(b, "en")))
  )
    fail("BUILD_BUNDLE_INVENTORY_DIRECTORY_SET_MISMATCH");
  const recomputed = inventory.entries.map((entry) => fileRecord(root, entry.path));
  if (stable(recomputed) !== stable(inventory.entries))
    fail("BUILD_BUNDLE_INVENTORY_DIGEST_MISMATCH");
  const bundleSha256 = sha256Bytes(
    Buffer.from(
      inventory.entries.map((entry) => `${entry.path}\0${entry.size}\0${entry.sha256}`).join("\n"),
      "utf8",
    ),
  );
  if (bundleSha256 !== inventory.bundleSha256) fail("BUILD_BUNDLE_INVENTORY_BUNDLE_HASH_MISMATCH");
  return inventory;
}

function validate({ repository, taskRoot }) {
  const repo = repositoryRoot(repository);
  const root = requireExistingDirectChild(
    resolve(repo, "external"),
    taskRoot,
    bundlePattern(),
    "BUILD_BUNDLE_TASK_ROOT_INVALID",
  );
  const inventory = validateInventory(root);
  const projectIdentity = readJson(
    resolve(root, "metadata", "project-identity.json"),
    "BUILD_BUNDLE_PROJECT_IDENTITY_INVALID",
  );
  assertExactKeys(
    projectIdentity,
    [
      "enabled",
      "engineAssociation",
      "notFinal15A",
      "pluginId",
      "project",
      "schemaVersion",
      "taskId",
    ],
    "BUILD_BUNDLE_PROJECT_IDENTITY_INVALID",
  );
  const retainedProjectPath = resolve(root, "project", PROJECT_FILE);
  const retainedProject = readJson(retainedProjectPath, "BUILD_BUNDLE_PROJECT_IDENTITY_INVALID");
  assertExactKeys(
    retainedProject,
    ["Category", "Description", "EngineAssociation", "FileVersion", "Plugins"],
    "BUILD_BUNDLE_PROJECT_IDENTITY_INVALID",
  );
  if (
    projectIdentity.schemaVersion !== PROJECT_IDENTITY_SCHEMA ||
    projectIdentity.taskId !== TASK_ID ||
    projectIdentity.notFinal15A !== true ||
    projectIdentity.engineAssociation !== "5.8" ||
    projectIdentity.pluginId !== "UAgentAssetTools" ||
    projectIdentity.enabled !== true ||
    stable(projectIdentity.project) !== stable(artifact(retainedProjectPath, PROJECT_FILE)) ||
    retainedProject.FileVersion !== 3 ||
    retainedProject.EngineAssociation !== "5.8" ||
    stable(retainedProject.Plugins) !== stable([{ Name: "UAgentAssetTools", Enabled: true }])
  )
    fail("BUILD_BUNDLE_PROJECT_IDENTITY_INVALID");
  const sourceEquality = readJson(
    resolve(root, "metadata", "source-equality.json"),
    "BUILD_BUNDLE_SOURCE_EQUALITY_INVALID",
  );
  if (
    sourceEquality.schemaVersion !== SOURCE_EQUALITY_SCHEMA ||
    sourceEquality.taskId !== TASK_ID ||
    sourceEquality.complete !== true ||
    !Array.isArray(sourceEquality.files) ||
    sourceEquality.files.length !== 19
  )
    fail("BUILD_BUNDLE_SOURCE_EQUALITY_INVALID");
  const currentSourceRoot = requireRealDirectory(
    resolve(repo, PLUGIN_RELATIVE),
    "BUILD_BUNDLE_SOURCE_ROOT_INVALID",
  );
  const currentSource = sourceInventory(currentSourceRoot);
  if (
    sourceEquality.sourceTreeSha256 !== currentSource.sourceTreeSha256 ||
    sourceEquality.sourceBundleSha256 !== currentSource.sourceBundleSha256 ||
    sourceEquality.fileCount !== currentSource.files.length
  )
    fail("BUILD_BUNDLE_SOURCE_CURRENT_MISMATCH");
  for (const current of currentSource.files) {
    const equality = sourceEquality.files.find(({ path }) => path === current.path);
    if (
      !equality ||
      equality.size !== current.size ||
      equality.sha256 !== current.sha256 ||
      equality.repositoryEqualsProject !== true ||
      equality.retainedRepositoryEqualsProject !== true
    )
      fail("BUILD_BUNDLE_SOURCE_EQUALITY_INVALID");
    const repositoryCopy = resolve(
      root,
      "snapshots",
      "repository",
      "UAgentAssetTools",
      current.path.split("/").join(sep),
    );
    const projectCopy = resolve(
      root,
      "snapshots",
      "project",
      "UAgentAssetTools",
      current.path.split("/").join(sep),
    );
    if (sha256File(repositoryCopy) !== current.sha256 || sha256File(projectCopy) !== current.sha256)
      fail("BUILD_BUNDLE_SOURCE_EQUALITY_INVALID");
  }
  const compiledRoot = resolve(root, "compiled", "UAgentAssetTools");
  const manifest = readJson(resolve(compiledRoot, MANIFEST_NAME), "BUILD_BUNDLE_MANIFEST_INVALID");
  const buildCommand = readJson(
    resolve(root, "metadata", "build-command.json"),
    "BUILD_BUNDLE_BUILD_COMMAND_INVALID",
  );
  assertExactKeys(
    buildCommand,
    [
      "executable",
      "arguments",
      "fullTaskMarker",
      "incrementalTaskMarker",
      "project",
      "schemaVersion",
      "target",
      "unrealBuildTool",
    ],
    "BUILD_BUNDLE_BUILD_COMMAND_INVALID",
  );
  if (buildCommand.schemaVersion !== BUILD_COMMAND_SCHEMA)
    fail("BUILD_BUNDLE_BUILD_COMMAND_INVALID");
  validateManifest(manifest, compiledRoot, currentSource.sourceTreeSha256, buildCommand);
  const review = readJson(
    resolve(root, "metadata", "build-review.json"),
    "BUILD_BUNDLE_REVIEW_INVALID",
  );
  if (
    review.schemaVersion !== REVIEW_SCHEMA ||
    review.taskId !== TASK_ID ||
    review.notFinal15A !== true ||
    review.status !== "completed" ||
    review.contentUnchanged !== true ||
    stable(review.contentBefore) !== stable(review.contentAfter) ||
    review.contentBefore.fileCount !== 0 ||
    review.contentBefore.aggregateSha256 !== EMPTY_CONTENT_SHA256 ||
    review.sourceTreeSha256 !== currentSource.sourceTreeSha256 ||
    review.sourceBundleSha256 !== currentSource.sourceBundleSha256 ||
    review.manifestSha256 !== manifest.manifestSha256 ||
    review.processCloseout?.complete !== true ||
    review.processCloseout?.processResidualCount !== 0 ||
    review.portCloseout?.complete !== true ||
    review.portCloseout?.applicable !== true ||
    stable(review.portCloseout?.scannedPorts) !== stable(BUILD_PORTS) ||
    review.portCloseout?.residualCount !== 0 ||
    review.markerCloseout?.complete !== true ||
    review.markerCloseout?.residualCount !== 0
  )
    fail("BUILD_BUNDLE_REVIEW_INVALID");
  if (
    review.projectIdentitySha256 !==
      sha256File(resolve(root, "metadata", "project-identity.json")) ||
    review.prepareReceiptSha256 !== sha256File(resolve(root, "metadata", "prepare-receipt.json")) ||
    review.sourceEqualitySha256 !== sha256File(resolve(root, "metadata", "source-equality.json"))
  )
    fail("BUILD_BUNDLE_REVIEW_INVALID");
  const expectedCompiledArtifacts = [
    "UAgentAssetTools.uplugin",
    "Resources/uagent-asset-tools.schema.json",
    "Resources/mvp15d-native-binding-v2.json",
    "Binaries/Win64/UnrealEditor.modules",
    "Binaries/Win64/UnrealEditor-UAgentAssetTools.dll",
    "Binaries/Win64/UnrealEditor-UAgentAssetToolsTests.dll",
    MANIFEST_NAME,
  ].map((path) => fileRecord(root, `compiled/UAgentAssetTools/${path}`));
  if (stable(review.compiledArtifacts) !== stable(expectedCompiledArtifacts))
    fail("BUILD_BUNDLE_REVIEW_INVALID");
  const phaseLedgers = [];
  for (const phase of ["full", "incremental"]) {
    const processLedger = validateProcessLedger(
      readJson(
        resolve(root, "ledgers", `${phase}.process.json`),
        "BUILD_BUNDLE_PROCESS_LEDGER_INVALID",
      ),
      phase,
    );
    const rawLedger = readJson(
      resolve(root, "ledgers", `${phase}.raw.json`),
      "BUILD_BUNDLE_PROCESS_LEDGER_INVALID",
    );
    if (stable(rawLedger) !== stable(processLedger.raw))
      fail("BUILD_BUNDLE_PROCESS_LEDGER_INVALID");
    phaseLedgers.push(processLedger);
    const log = readFileSync(resolve(root, "logs", `${phase}.stdout.log`), "utf8");
    if (!/Result:\s+Succeeded/i.test(log)) fail("BUILD_BUNDLE_BUILD_LOG_INVALID");
  }
  if (
    stable(review.buildLogs) !==
      stable(
        ["full", "incremental"].flatMap((phase) => [
          fileRecord(root, `logs/${phase}.stdout.log`),
          fileRecord(root, `logs/${phase}.stderr.log`),
        ]),
      ) ||
    stable(review.processLedgers) !==
      stable(
        ["full", "incremental"].map((phase) => fileRecord(root, `ledgers/${phase}.process.json`)),
      )
  )
    fail("BUILD_BUNDLE_REVIEW_INVALID");
  const totalProcesses = phaseLedgers.reduce((sum, ledger) => sum + ledger.raw.Processes.length, 0);
  const totalComplete = phaseLedgers.reduce(
    (sum, ledger) => sum + ledger.closeout.identityCompleteCount,
    0,
  );
  const totalExitEvents = phaseLedgers.reduce(
    (sum, ledger) => sum + ledger.closeout.exitEventCount,
    0,
  );
  if (
    review.processCloseout.phaseCount !== 2 ||
    review.processCloseout.jobEventMembershipCount !== totalProcesses ||
    review.processCloseout.identityCompleteCount !== totalComplete ||
    review.processCloseout.identityIncompleteCount !== totalProcesses - totalComplete ||
    review.processCloseout.exitEventCount !== totalExitEvents ||
    review.processCloseout.exitEventMissingCount !== totalProcesses - totalExitEvents
  )
    fail("BUILD_BUNDLE_REVIEW_INVALID");
  for (const ledger of phaseLedgers) {
    const live = scanCloseout(ledger.taskMarker);
    if (live.listeners.length !== 0 || live.markerProcesses.length !== 0)
      fail("BUILD_BUNDLE_LIVE_CLOSEOUT_INVALID");
  }
  return {
    taskId: TASK_ID,
    taskRoot: root,
    fileCount: inventory.entries.length + 1,
    bundleSha256: inventory.bundleSha256,
    inventorySha256: inventory.inventorySha256,
    manifestSha256: manifest.manifestSha256,
    sourceTreeSha256: currentSource.sourceTreeSha256,
    sourceBundleSha256: currentSource.sourceBundleSha256,
    contentSha256: review.contentAfter.aggregateSha256,
    processResidualCount: review.processCloseout.processResidualCount,
    portResidualCount: review.portCloseout.residualCount,
    markerResidualCount: review.markerCloseout.residualCount,
    jobEventMembershipCount: totalProcesses,
    identityCompleteCount: totalComplete,
    identityIncompleteCount: totalProcesses - totalComplete,
    exitEventCount: totalExitEvents,
    exitEventMissingCount: totalProcesses - totalExitEvents,
  };
}

function main() {
  const [mode, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (mode === "prepare") prepare(args);
  else if (mode === "run-builds") runBuilds(args);
  else if (mode === "create") create(args);
  else if (mode === "validate") {
    if (!args.repository || !args["task-root"]) fail("BUILD_BUNDLE_ARGUMENT_REQUIRED");
    console.log(
      JSON.stringify({
        status: "validated",
        ...validate({ repository: args.repository, taskRoot: args["task-root"] }),
      }),
    );
  } else {
    fail("BUILD_BUNDLE_MODE_INVALID");
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (error) {
    const reason = error instanceof BundleError ? error.code : "BUILD_BUNDLE_FAILED";
    console.error(JSON.stringify({ status: "rejected", reason }));
    process.exitCode = 2;
  }
}

export { BundleError, safeLogicalPath, sourceInventory, validateInventory, validateProcessLedger };
