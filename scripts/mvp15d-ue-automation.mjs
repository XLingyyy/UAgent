#!/usr/bin/env node
/* global console, process */

/**
 * Runs the Rework-7 supporting UE Automation matrix in a positively identified
 * task-owned project and records redacted process/log/Content aggregates. It
 * never turns a compiler result into an Automation claim; a zero exit, an
 * Automation summary, and the complete named matrix are all required for
 * `completed`.  This runner does not produce product-adapter evidence.
 */
import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";

export const UE_AUTOMATION_CAPTURE_SCHEMA_VERSION =
  "uagent.mvp15d.rework7.supporting-ue-automation-capture.v3";
export const UE_AUTOMATION_PROCESS_LEDGER_SCHEMA_VERSION =
  "uagent.mvp15d.rework7.ue-session-process-ledger.v2";
export const UE_AUTOMATION_TASK_ID =
  "TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-SOURCE-CHECKPOINT-REWORK-7";
export const UE_AUTOMATION_COMMANDLET =
  "G:\\UnrealEngine\\UE_5.8\\Engine\\Binaries\\Win64\\UnrealEditor-Cmd.exe";
export const UE_AUTOMATION_FILTER = "UAgentAssetTools";
export const UE_AUTOMATION_BASELINE_TESTS = Object.freeze([
  "UAgentAssetTools.Manifest.SourceCheckpointNoManifest",
  "UAgentAssetTools.Manifest.InvalidFieldsContract",
  "UAgentAssetTools.Manifest.ExtraFieldsRejectedContract",
  "UAgentAssetTools.Manifest.SelfHashContract",
  "UAgentAssetTools.Manifest.ArtifactContract",
  "UAgentAssetTools.Manifest.PackageLayoutContract",
  "UAgentAssetTools.Manifest.ModuleIdentityContract",
  "UAgentAssetTools.Manifest.LoadedModuleCandidateRejected",
  "UAgentAssetTools.Contract.ExactSix",
  "UAgentAssetTools.Contract.SandboxValidation",
  "UAgentAssetTools.Contract.StrictMalformedInput",
  "UAgentAssetTools.Contract.StrictWrongType",
  "UAgentAssetTools.Contract.StrictUnknownField",
  "UAgentAssetTools.Contract.AcceptedPlanBinding",
  "UAgentAssetTools.Contract.DescriptorSchema",
  "UAgentAssetTools.Contract.StrictOutputSchema",
  "UAgentAssetTools.Outcome.KnownNone",
  "UAgentAssetTools.DryRun.PreconditionMissingSource",
  "UAgentAssetTools.Outcome.KnownPartialContract",
  "UAgentAssetTools.Outcome.UnknownCallSuccessObservationFailedContract",
  "UAgentAssetTools.Outcome.UnknownCleanupObservationFailedContract",
  "UAgentAssetTools.Operation.ForwardInverseProduction",
  "UAgentAssetTools.Ownership.RunRootCreateToIdentityRace",
  "UAgentAssetTools.Ownership.EffectDirectoryCreateToIdentityRace",
  "UAgentAssetTools.Ownership.ForwardHashMismatch",
  "UAgentAssetTools.Ownership.ForwardToolMismatch",
  "UAgentAssetTools.Ownership.ForwardArgumentsMismatchContract",
  "UAgentAssetTools.Ownership.InverseToolMismatch",
  "UAgentAssetTools.Ownership.InverseHashMismatch",
  "UAgentAssetTools.Ownership.InverseArgumentsMismatch",
  "UAgentAssetTools.Ownership.ResultContractMismatch",
  "UAgentAssetTools.Ownership.TargetCollisionNoReplacement",
  "UAgentAssetTools.Ownership.RunMismatch",
  "UAgentAssetTools.Ownership.ManifestIdentityMismatch",
  "UAgentAssetTools.Ownership.DryRunReplayIdempotence",
  "UAgentAssetTools.Ownership.WrongOrderRollback",
  "UAgentAssetTools.Lifecycle.ReconnectRestartRetractionContract",
  "UAgentAssetTools.Ownership.GenerationRegistrationRetraction",
  "UAgentAssetTools.Cleanup.ExactEmptyRootContract",
  "UAgentAssetTools.Cleanup.PhysicalNonEmptyRootNoRecursiveContract",
  "UAgentAssetTools.Cleanup.LinkReparsePathContract",
  "UAgentAssetTools.Cleanup.ReplacementOwnershipContract",
  "UAgentAssetTools.Cleanup.ObservationFailureContract",
  "UAgentAssetTools.Lifecycle.TaskOnlyRegistrationProbe",
]);
export const UE_AUTOMATION_COMBINATION_SESSIONS = Object.freeze([
  Object.freeze({
    id: "direct-tool-search-on",
    route: "direct",
    toolSearch: "on",
    filter: "UAgentMvp15D0Matrix.DirectToolSearchOn",
    expectedTests: Object.freeze(["UAgentMvp15D0Matrix.DirectToolSearchOn"]),
  }),
  Object.freeze({
    id: "direct-tool-search-off",
    route: "direct",
    toolSearch: "off",
    filter: "UAgentMvp15D0Matrix.DirectToolSearchOff",
    expectedTests: Object.freeze(["UAgentMvp15D0Matrix.DirectToolSearchOff"]),
  }),
  Object.freeze({
    id: "toolset-registry-tool-search-on",
    route: "toolset_registry",
    toolSearch: "on",
    filter: "UAgentMvp15D0Matrix.ToolsetRegistryToolSearchOn",
    expectedTests: Object.freeze(["UAgentMvp15D0Matrix.ToolsetRegistryToolSearchOn"]),
  }),
  Object.freeze({
    id: "toolset-registry-tool-search-off",
    route: "toolset_registry",
    toolSearch: "off",
    filter: "UAgentMvp15D0Matrix.ToolsetRegistryToolSearchOff",
    expectedTests: Object.freeze(["UAgentMvp15D0Matrix.ToolsetRegistryToolSearchOff"]),
  }),
]);
export const UE_AUTOMATION_EXPECTED_TESTS = Object.freeze([
  ...UE_AUTOMATION_BASELINE_TESTS,
  ...UE_AUTOMATION_COMBINATION_SESSIONS.flatMap((session) => session.expectedTests),
]);
export const UE_AUTOMATION_SESSIONS = Object.freeze([
  Object.freeze({
    id: "baseline",
    filter: UE_AUTOMATION_FILTER,
    expectedTests: UE_AUTOMATION_BASELINE_TESTS,
    route: null,
    toolSearch: null,
  }),
  ...UE_AUTOMATION_COMBINATION_SESSIONS,
]);

const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;
const MAX_CONTENT_FILES = 10_000;
const PROCESS_SESSION_TIMEOUT_MS = 15 * 60_000;
const WINDOWS_JOB_HELPER_SCHEMA_VERSION = "uagent.mvp15d.windows-job-process-run.v1";
const WINDOWS_JOB_HELPER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "mvp15d-windows-job-process-runner.ps1",
);

class AutomationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new AutomationError(code);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stable(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("UE_AUTOMATION_LEDGER_NON_JSON_VALUE");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (!value || typeof value !== "object") fail("UE_AUTOMATION_LEDGER_NON_JSON_VALUE");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
    .join(",")}}`;
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

function isHash(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isIsoUtc(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function normalizedExecutable(path) {
  if (typeof path !== "string" || path.length === 0) return "";
  try {
    return resolve(path).toLowerCase();
  } catch {
    return "";
  }
}

function executableEvidence(path, role, minimumCount, maximumCount) {
  const executablePath = regularFile(resolve(path), "UE_AUTOMATION_EXPECTED_EXECUTABLE_INVALID");
  const normalizedPath = normalizedExecutable(executablePath);
  const bytes = readFileSync(executablePath);
  return {
    role,
    executable: basename(executablePath),
    executablePathSha256: sha256(Buffer.from(normalizedPath, "utf8")),
    executableFileSha256: sha256(bytes),
    byteLength: bytes.length,
    minimumCount,
    maximumCount,
  };
}

function processTable() {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath,CommandLine | ConvertTo-Json -Compress",
    ],
    {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) fail("UE_AUTOMATION_PROCESS_SCAN_FAILED");
  let rows;
  try {
    const parsed = JSON.parse(result.stdout);
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    fail("UE_AUTOMATION_PROCESS_SCAN_FAILED");
  }
  return rows
    .map((row) => ({
      pid: Number(row?.ProcessId),
      parentPid: Number(row?.ParentProcessId),
      creationDate: typeof row?.CreationDate === "string" ? row.CreationDate : "",
      executablePath: typeof row?.ExecutablePath === "string" ? row.ExecutablePath : "",
      commandLine: typeof row?.CommandLine === "string" ? row.CommandLine : "",
    }))
    .filter(
      ({ pid, parentPid }) =>
        Number.isSafeInteger(pid) && pid > 0 && Number.isSafeInteger(parentPid) && parentPid >= 0,
    );
}

function markerProcesses(marker, table = processTable()) {
  return table.filter(({ commandLine }) => commandLine.includes(marker));
}

function markerResidualEvidence(marker) {
  return markerProcesses(marker).map((row) => {
    const material = {
      pid: row.pid,
      parentPid: row.parentPid,
      creationDate: row.creationDate,
      executablePathSha256: sha256(Buffer.from(normalizedExecutable(row.executablePath), "utf8")),
      commandLineSha256: sha256(Buffer.from(row.commandLine, "utf8")),
    };
    return {
      pid: row.pid,
      identitySha256: sha256(Buffer.from(stable(material), "utf8")),
    };
  });
}

function within(root, candidate) {
  const value = relative(root, candidate);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function samePath(left, right) {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function entryOrNull(path, code) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    fail(code);
  }
}

function regularFile(path, code) {
  if (!existsSync(path)) fail(code);
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink()) fail(code);
  return path;
}

function fileEvidence(path) {
  if (!existsSync(path)) {
    return {
      name: basename(path),
      exists: false,
      sha256: null,
      byteLength: 0,
    };
  }
  const file = regularFile(path, "UE_AUTOMATION_LOG_INVALID");
  const bytes = readFileSync(file);
  return {
    name: basename(file),
    exists: true,
    sha256: sha256(bytes),
    byteLength: bytes.length,
  };
}

function parseArgs(argv) {
  const supported = new Set(["project", "output", "task-root"]);
  const result = Object.create(null);
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (
      !key.startsWith("--") ||
      !supported.has(key.slice(2)) ||
      Object.hasOwn(result, key.slice(2))
    )
      fail("UE_AUTOMATION_ARGUMENT_INVALID");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail("UE_AUTOMATION_ARGUMENT_INVALID");
    result[key.slice(2)] = value;
    index += 1;
  }
  const captureMode = Boolean(result.project && result.output && !result["task-root"]);
  const validationMode = Boolean(result["task-root"] && !result.project && !result.output);
  if (!captureMode && !validationMode) fail("UE_AUTOMATION_ARGUMENT_REQUIRED");
  return result;
}

function resolveTaskProject(value) {
  const project = regularFile(resolve(value), "UE_AUTOMATION_PROJECT_INVALID");
  if (!project.toLowerCase().endsWith(".uproject")) fail("UE_AUTOMATION_PROJECT_INVALID");
  const projectRoot = resolve(dirname(project));
  const tempRoot = resolve(tmpdir());
  const fresh =
    samePath(dirname(projectRoot), tempRoot) &&
    /^UAgent-MVP15D-Rework7-[A-Za-z0-9_-]+$/i.test(basename(projectRoot));
  if (!fresh) fail("UE_AUTOMATION_PROJECT_NOT_TASK_OWNED");
  const tempStats = entryOrNull(tempRoot, "UE_AUTOMATION_PROJECT_INVALID");
  if (!tempStats?.isDirectory() || tempStats.isSymbolicLink())
    fail("UE_AUTOMATION_PROJECT_INVALID");
  return { project, projectRoot };
}

function taskOutputBoundary(value, code) {
  const output = resolve(value);
  const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const externalRoot = resolve(workspace, "external");
  const tempRoot = resolve(tmpdir());
  const external =
    samePath(dirname(output), externalRoot) &&
    /^mvp15d-rework7-[A-Za-z0-9_-]+$/i.test(basename(output));
  const temporary =
    samePath(dirname(output), tempRoot) &&
    /^UAgent-MVP15D-Rework7-[A-Za-z0-9_-]+$/i.test(basename(output));
  if (!external && !temporary) fail(code);
  const allowedParent = external ? externalRoot : tempRoot;
  const parentStats = entryOrNull(allowedParent, "UE_AUTOMATION_OUTPUT_INVALID");
  if (!parentStats?.isDirectory() || parentStats.isSymbolicLink())
    fail("UE_AUTOMATION_OUTPUT_INVALID");
  return output;
}

export function createFreshUeAutomationOutput(value) {
  const output = taskOutputBoundary(value, "UE_AUTOMATION_OUTPUT_NOT_TASK_OWNED");
  if (entryOrNull(output, "UE_AUTOMATION_OUTPUT_INVALID"))
    fail("UE_AUTOMATION_OUTPUT_ALREADY_EXISTS");
  try {
    mkdirSync(output, { recursive: false });
  } catch {
    fail("UE_AUTOMATION_OUTPUT_INVALID");
  }
  const outputStats = entryOrNull(output, "UE_AUTOMATION_OUTPUT_INVALID");
  if (!outputStats?.isDirectory() || outputStats.isSymbolicLink())
    fail("UE_AUTOMATION_OUTPUT_INVALID");
  return output;
}

function existingTaskOutput(value) {
  const output = taskOutputBoundary(value, "UE_AUTOMATION_TASK_ROOT_NOT_TASK_OWNED");
  const stats = entryOrNull(output, "UE_AUTOMATION_TASK_ROOT_INVALID");
  if (!stats?.isDirectory() || stats.isSymbolicLink()) fail("UE_AUTOMATION_TASK_ROOT_INVALID");
  return output;
}

function aggregateContent(contentRoot) {
  if (!existsSync(contentRoot))
    return {
      fileCount: 0,
      aggregateSha256: sha256(Buffer.from("uagent.mvp15d.content.v1\0", "utf8")),
    };
  const entries = [];
  const walk = (directory) => {
    const directoryStats = lstatSync(directory);
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink())
      fail("UE_AUTOMATION_CONTENT_LINK_OR_INVALID");
    for (const item of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name, "en"),
    )) {
      const child = resolve(directory, item.name);
      if (!within(contentRoot, child) || item.isSymbolicLink())
        fail("UE_AUTOMATION_CONTENT_LINK_OR_INVALID");
      if (item.isDirectory()) walk(child);
      else if (item.isFile()) {
        const bytes = readFileSync(child);
        entries.push(
          `${relative(contentRoot, child).replace(/\\/g, "/")}\0${bytes.length}\0${sha256(bytes)}`,
        );
        if (entries.length > MAX_CONTENT_FILES) fail("UE_AUTOMATION_CONTENT_FILE_LIMIT");
      } else fail("UE_AUTOMATION_CONTENT_LINK_OR_INVALID");
    }
  };
  walk(contentRoot);
  return {
    fileCount: entries.length,
    aggregateSha256: sha256(Buffer.from(`uagent.mvp15d.content.v1\0${entries.join("\n")}`, "utf8")),
  };
}

export function validateExpectedTestMatrix(
  namedTests,
  completedTests,
  expectedTests = UE_AUTOMATION_EXPECTED_TESTS,
) {
  const expected = [...expectedTests];
  const expectedSet = new Set(expected);
  const namedSet = new Set(namedTests);
  const completedByName = new Map(completedTests.map((test) => [test.name, test.result]));
  const missingFromDiscovery = expected.filter((name) => !namedSet.has(name));
  const unexpectedFromDiscovery = [...namedSet].filter((name) => !expectedSet.has(name)).sort();
  const missingFromCompletion = expected.filter((name) => !completedByName.has(name));
  const unexpectedFromCompletion = [...completedByName.keys()]
    .filter((name) => !expectedSet.has(name))
    .sort();
  const unsuccessful = expected
    .filter((name) => completedByName.get(name) !== "Success")
    .map((name) => ({ name, result: completedByName.get(name) ?? "missing" }));
  return {
    expectedTests: expected,
    expectedCount: expected.length,
    missingFromDiscovery,
    unexpectedFromDiscovery,
    missingFromCompletion,
    unexpectedFromCompletion,
    unsuccessful,
    complete:
      missingFromDiscovery.length === 0 &&
      unexpectedFromDiscovery.length === 0 &&
      missingFromCompletion.length === 0 &&
      unexpectedFromCompletion.length === 0 &&
      unsuccessful.length === 0,
  };
}

export function parseAutomationLog(text, expectedTests = UE_AUTOMATION_EXPECTED_TESTS) {
  const namedTests = [
    ...new Set(
      [
        ...text.matchAll(
          /(?:AutomationTest|LogAutomationController).*?((?:(?:UAgentAssetTools|UAgentMvp15D0Matrix)\.)[A-Za-z0-9_.-]+)/g,
        ),
      ].map((match) => match[1]),
    ),
  ].sort();
  const crashReportClientPids = [
    ...new Set(
      [...text.matchAll(/Started CrashReportClient \(pid=(\d+)\)/g)]
        .map((match) => Number(match[1]))
        .filter((pid) => Number.isSafeInteger(pid) && pid > 0),
    ),
  ];
  const completionResults = new Map();
  for (const match of text.matchAll(
    /LogAutomationController:\s+(?:Display|Error): Test Completed\. Result=\{([^}]+)\} Name=\{[^}]*\} Path=\{((?:UAgentAssetTools|UAgentMvp15D0Matrix)\.[A-Za-z0-9_.-]+)\}/g,
  )) {
    const results = completionResults.get(match[2]) ?? new Set();
    results.add(match[1]);
    completionResults.set(match[2], results);
  }
  const completedTests = [...completionResults.entries()]
    .map(([name, results]) => ({
      name,
      result: results.size === 1 ? [...results][0] : "conflicting_results",
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  const summary = text.match(
    /(?:Automation(?:Controller)?[^\n]*?(?:Complete|completed)|Automation Test Queue Empty)/i,
  );
  const expectedMatrix = validateExpectedTestMatrix(namedTests, completedTests, expectedTests);
  return {
    namedTests,
    completedTests,
    crashReportClientPids,
    expectedMatrix,
    summaryObserved: Boolean(summary),
    failureObserved: !expectedMatrix.complete,
  };
}

function expectedProcessExecutables(commandlet) {
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  const engineBinaries = dirname(commandlet);
  const engineRoot = resolve(engineBinaries, "..", "..");
  return [
    executableEvidence(commandlet, "editor_root", 1, 1),
    executableEvidence(
      resolve(engineBinaries, "CrashReportClientEditor.exe"),
      "crash_report_client",
      1,
      null,
    ),
    executableEvidence(resolve(systemRoot, "System32", "conhost.exe"), "console_host", 0, null),
    executableEvidence(
      resolve(systemRoot, "System32", "cmd.exe"),
      "platform_validator_shell",
      0,
      null,
    ),
    executableEvidence(
      resolve(engineRoot, "Binaries", "ThirdParty", "DotNet", "10.0", "win-x64", "dotnet.exe"),
      "platform_validator_dotnet",
      0,
      null,
    ),
  ];
}

function processIdentityMaterial(value) {
  return {
    pid: value.pid,
    parentPid: value.parentPid,
    creationFileTimeUtc: value.creationFileTimeUtc,
    executablePathSha256: value.executablePathSha256,
    commandLineSha256: value.commandLineSha256,
  };
}

function rawProcessIdentity(value) {
  const executablePath = normalizedExecutable(value?.ExecutablePath);
  const commandLine =
    typeof value?.CommandLine === "string" && value.CommandLine.length > 0
      ? value.CommandLine
      : null;
  const evidence = {
    pid: Number(value?.Pid),
    parentPid: Number(value?.ParentPid),
    creationFileTimeUtc:
      typeof value?.CreationFileTimeUtc === "string" ? value.CreationFileTimeUtc : "",
    executable: executablePath ? basename(executablePath) : "",
    executablePathSha256: executablePath ? sha256(Buffer.from(executablePath, "utf8")) : null,
    commandLineSha256: commandLine ? sha256(Buffer.from(commandLine, "utf8")) : null,
  };
  return {
    ...evidence,
    identitySha256: sha256(Buffer.from(stable(processIdentityMaterial(evidence)), "utf8")),
    rawCommandLine: commandLine,
  };
}

function launcherEvidence(value) {
  const identity = rawProcessIdentity(value);
  return {
    pid: identity.pid,
    parentPid: identity.parentPid,
    creationFileTimeUtc: identity.creationFileTimeUtc,
    executable: identity.executable,
    executablePathSha256: identity.executablePathSha256,
    commandLineSha256: identity.commandLineSha256,
    identitySha256: identity.identitySha256,
  };
}

function processRole(identity, expectedExecutables) {
  const expected = expectedExecutables.find(
    ({ executablePathSha256 }) => executablePathSha256 === identity.executablePathSha256,
  );
  return expected?.role ?? "unexpected_descendant";
}

function parentIdentityFor(processEntry, processEntries, launcher) {
  if (processEntry.parentPid === launcher.pid && processEntry.firstObservation.sequence >= 0) {
    return launcher.identitySha256;
  }
  const candidates = processEntries
    .filter(
      (candidate) =>
        candidate.pid === processEntry.parentPid &&
        candidate.firstObservation.sequence < processEntry.firstObservation.sequence &&
        (!candidate.exit.observed ||
          candidate.exit.sequence > processEntry.firstObservation.sequence),
    )
    .sort((left, right) => right.firstObservation.sequence - left.firstObservation.sequence);
  return candidates[0]?.identitySha256 ?? null;
}

function closeoutReason(
  closeout,
  helperFailureCode,
  { markerOwnershipComplete, expectedCountsComplete, crashLogCorroborated },
) {
  if (helperFailureCode) return helperFailureCode;
  if (closeout.unassignedRootResidualAfterCleanup) return "UE_AUTOMATION_UNASSIGNED_ROOT_RESIDUAL";
  if (closeout.forcedUnassignedRootTermination)
    return "UE_AUTOMATION_UNASSIGNED_ROOT_FORCED_CLOSEOUT";
  if (closeout.timedOut) return "UE_AUTOMATION_PROCESS_JOB_TIMEOUT";
  if (closeout.forcedJobTermination) return "UE_AUTOMATION_FORCED_PROCESS_CLOSEOUT";
  if (!closeout.activeProcessZeroObserved) return "UE_AUTOMATION_PROCESS_ACTIVE_ZERO_MISSING";
  if (closeout.finalResidualCount !== 0 || closeout.markerResidualCount !== 0)
    return "UE_AUTOMATION_PROCESS_RESIDUAL";
  if (closeout.incompleteIdentityCount !== 0) return "UE_AUTOMATION_PROCESS_IDENTITY_INCOMPLETE";
  if (closeout.unattributedCount !== 0) return "UE_AUTOMATION_PROCESS_PARENT_UNATTRIBUTED";
  if (closeout.unknownExecutableCount !== 0) return "UE_AUTOMATION_PROCESS_EXECUTABLE_UNEXPECTED";
  if (closeout.unclosedCount !== 0) return "UE_AUTOMATION_PROCESS_EXIT_MISSING";
  if (closeout.missingJobNewProcessCount !== 0) return "UE_AUTOMATION_PROCESS_START_EVENT_MISSING";
  if (closeout.unexpectedJobMessageCount !== 0) return "UE_AUTOMATION_JOB_EVENT_UNEXPECTED";
  if (!closeout.accountingProcessCountMatches)
    return "UE_AUTOMATION_PROCESS_EVENT_ACCOUNTING_MISMATCH";
  if (!closeout.rootExitObserved) return "UE_AUTOMATION_ROOT_EXIT_MISSING";
  if (closeout.rootExitCode !== 0) return "UE_AUTOMATION_COMMANDLET_EXIT_NONZERO";
  if (closeout.helperExitCode !== 0) return "UE_AUTOMATION_JOB_HELPER_EXIT_NONZERO";
  if (!markerOwnershipComplete) return "UE_AUTOMATION_PROCESS_MARKER_MISMATCH";
  if (!expectedCountsComplete) return "UE_AUTOMATION_PROCESS_EXECUTABLE_COUNT_MISMATCH";
  if (!crashLogCorroborated) return "UE_AUTOMATION_CRASH_REPORT_CLIENT_DESCENDANT_MISSING";
  return "ue_automation_process_closeout_completed";
}

export function createUeSessionProcessLedger({
  rawJobResult,
  helperExitCode,
  helperSourceSha256,
  sessionId,
  taskMarker,
  expectedExecutables,
  crashReportClientPids,
  markerResiduals = [],
}) {
  if (
    !rawJobResult ||
    rawJobResult.SchemaVersion !== WINDOWS_JOB_HELPER_SCHEMA_VERSION ||
    rawJobResult.TaskMarker !== taskMarker ||
    rawJobResult.JobName !== `Local\\UAgentMvp15D-${taskMarker}` ||
    !Array.isArray(rawJobResult.Processes)
  ) {
    fail("UE_AUTOMATION_JOB_HELPER_OUTPUT_INVALID");
  }
  const launcher = launcherEvidence(rawJobResult.Launcher);
  const rawByIdentity = rawJobResult.Processes.map((raw) => ({
    raw,
    identity: rawProcessIdentity(raw),
  }));
  const processes = rawByIdentity.map(({ raw, identity }) => {
    const role = processRole(identity, expectedExecutables);
    const commandLineMarkerObserved =
      typeof identity.rawCommandLine === "string" && identity.rawCommandLine.includes(taskMarker);
    return {
      identitySha256: identity.identitySha256,
      pid: identity.pid,
      parentPid: identity.parentPid,
      parentIdentitySha256: null,
      creationFileTimeUtc: identity.creationFileTimeUtc,
      executable: identity.executable,
      executablePathSha256: identity.executablePathSha256,
      commandLineSha256: identity.commandLineSha256,
      role,
      identityComplete: raw.IdentityComplete === true,
      firstObservation: {
        sequence: Number(raw.FirstObservationSequence),
        at: raw.FirstObservedAt,
        basis:
          role === "editor_root" ? "create_suspended_before_resume" : "windows_job_new_process",
      },
      ownership: {
        basis: "windows_job_membership",
        jobMembershipVerified: raw.JobMembershipVerified === true,
        jobNewProcessObserved: raw.JobNewProcessObserved === true,
        taskMarkerObserved: raw.JobMembershipVerified === true,
        commandLineMarkerObserved,
        markerBasis: commandLineMarkerObserved
          ? role === "editor_root"
            ? "root_command_line_and_named_job"
            : role === "crash_report_client"
              ? "crash_report_client_log_argument_and_named_job"
              : "command_line_and_named_job"
          : "named_job_membership",
      },
      exit: {
        observed: raw.ExitObserved === true,
        sequence: Number(raw.ExitSequence),
        at: typeof raw.ExitedAt === "string" ? raw.ExitedAt : "",
        kind: typeof raw.ExitKind === "string" ? raw.ExitKind : "",
        code: Number.isSafeInteger(raw.ExitCode) ? raw.ExitCode : null,
      },
    };
  });
  for (const processEntry of processes) {
    processEntry.parentIdentitySha256 = parentIdentityFor(processEntry, processes, launcher);
  }
  const rootProcesses = processes.filter(({ role }) => role === "editor_root");
  const root = rootProcesses.length === 1 ? rootProcesses[0] : null;
  const matchedCrashReportClientPids = crashReportClientPids.filter((pid) =>
    processes.some(
      (processEntry) => processEntry.role === "crash_report_client" && processEntry.pid === pid,
    ),
  );
  const closeout = {
    rootExitObserved: root?.exit.observed === true,
    rootExitCode: Number.isSafeInteger(rawJobResult.RootExitCode)
      ? rawJobResult.RootExitCode
      : null,
    activeProcessZeroObserved: rawJobResult.ActiveProcessZeroObserved === true,
    activeProcessZeroObservedAt:
      typeof rawJobResult.ActiveProcessZeroObservedAt === "string"
        ? rawJobResult.ActiveProcessZeroObservedAt
        : "",
    timedOut: rawJobResult.TimedOut === true,
    forcedJobTermination: rawJobResult.ForcedJobTermination === true,
    forcedUnassignedRootTermination: rawJobResult.ForcedUnassignedRootTermination === true,
    unassignedRootResidualAfterCleanup: rawJobResult.UnassignedRootResidualAfterCleanup === true,
    residualCountBeforeCleanup: Number(rawJobResult.ResidualCountBeforeCleanup),
    finalResidualCount: Number(rawJobResult.FinalResidualCount),
    markerResidualCount: markerResiduals.length,
    markerResiduals,
    incompleteIdentityCount: processes.filter(({ identityComplete }) => !identityComplete).length,
    unattributedCount: processes.filter(({ parentIdentitySha256 }) => !isHash(parentIdentitySha256))
      .length,
    unknownExecutableCount: processes.filter(({ role }) => role === "unexpected_descendant").length,
    unclosedCount: processes.filter(({ exit }) => !exit.observed).length,
    missingJobNewProcessCount: processes.filter(({ ownership }) => !ownership.jobNewProcessObserved)
      .length,
    unexpectedJobMessageCount: Number(rawJobResult.UnexpectedJobMessageCount),
    accountingTotalProcessCount: Number(rawJobResult.AccountingTotalProcessCount),
    recordedProcessCount: processes.length,
    accountingProcessCountMatches:
      Number(rawJobResult.AccountingTotalProcessCount) === processes.length,
    helperExitCode,
  };
  const helperFailureCode =
    typeof rawJobResult.FailureCode === "string" && rawJobResult.FailureCode
      ? rawJobResult.FailureCode
      : null;
  const markerOwnershipComplete = processes.every(
    ({ role, ownership }) =>
      ownership.jobMembershipVerified &&
      ownership.taskMarkerObserved &&
      (role !== "editor_root" || ownership.commandLineMarkerObserved),
  );
  const expectedCountsComplete = expectedExecutables.every((expected) => {
    const count = processes.filter(({ role }) => role === expected.role).length;
    return (
      count >= expected.minimumCount &&
      (expected.maximumCount === null || count <= expected.maximumCount)
    );
  });
  const crashLogCorroborated =
    crashReportClientPids.length > 0 &&
    matchedCrashReportClientPids.length === crashReportClientPids.length;
  const completed =
    helperFailureCode === null &&
    markerOwnershipComplete &&
    expectedCountsComplete &&
    crashLogCorroborated &&
    closeout.rootExitObserved &&
    closeout.rootExitCode === 0 &&
    closeout.activeProcessZeroObserved &&
    !closeout.timedOut &&
    !closeout.forcedJobTermination &&
    !closeout.forcedUnassignedRootTermination &&
    !closeout.unassignedRootResidualAfterCleanup &&
    closeout.residualCountBeforeCleanup === 0 &&
    closeout.finalResidualCount === 0 &&
    closeout.markerResidualCount === 0 &&
    closeout.incompleteIdentityCount === 0 &&
    closeout.unattributedCount === 0 &&
    closeout.unknownExecutableCount === 0 &&
    closeout.unclosedCount === 0 &&
    closeout.missingJobNewProcessCount === 0 &&
    closeout.unexpectedJobMessageCount === 0 &&
    closeout.accountingProcessCountMatches &&
    closeout.helperExitCode === 0;
  return {
    schemaVersion: UE_AUTOMATION_PROCESS_LEDGER_SCHEMA_VERSION,
    sessionId,
    taskMarker,
    taskMarkerSha256: sha256(Buffer.from(taskMarker, "utf8")),
    ownershipMechanism: "windows_job_object",
    jobNameSha256: sha256(Buffer.from(rawJobResult.JobName ?? "", "utf8")),
    helperSource: {
      name: basename(WINDOWS_JOB_HELPER_PATH),
      sha256: helperSourceSha256,
    },
    launcher,
    expectedExecutables,
    processes,
    root: root
      ? {
          pid: root.pid,
          identitySha256: root.identitySha256,
          exitCode: closeout.rootExitCode,
        }
      : null,
    logCorroboration: {
      crashReportClientPids,
      matchedCrashReportClientPids,
      complete: crashLogCorroborated,
    },
    closeout,
    status: completed ? "completed" : "failed",
    reason: completed
      ? "ue_automation_process_closeout_completed"
      : closeoutReason(closeout, helperFailureCode, {
          markerOwnershipComplete,
          expectedCountsComplete,
          crashLogCorroborated,
        }),
  };
}

function validateExpectedExecutable(value) {
  assertExactKeys(
    value,
    [
      "byteLength",
      "executable",
      "executableFileSha256",
      "executablePathSha256",
      "maximumCount",
      "minimumCount",
      "role",
    ],
    "UE_AUTOMATION_PROCESS_LEDGER_INVALID",
  );
  if (
    ![
      "editor_root",
      "crash_report_client",
      "console_host",
      "platform_validator_shell",
      "platform_validator_dotnet",
    ].includes(value.role) ||
    typeof value.executable !== "string" ||
    !isHash(value.executableFileSha256) ||
    !isHash(value.executablePathSha256) ||
    !Number.isSafeInteger(value.byteLength) ||
    value.byteLength <= 0 ||
    !Number.isSafeInteger(value.minimumCount) ||
    value.minimumCount < 0 ||
    !(
      value.maximumCount === null ||
      (Number.isSafeInteger(value.maximumCount) && value.maximumCount >= value.minimumCount)
    )
  ) {
    fail("UE_AUTOMATION_PROCESS_LEDGER_INVALID");
  }
}

function validateLedgerProcess(value) {
  assertExactKeys(
    value,
    [
      "commandLineSha256",
      "creationFileTimeUtc",
      "executable",
      "executablePathSha256",
      "exit",
      "firstObservation",
      "identityComplete",
      "identitySha256",
      "ownership",
      "parentIdentitySha256",
      "parentPid",
      "pid",
      "role",
    ],
    "UE_AUTOMATION_PROCESS_LEDGER_INVALID",
  );
  assertExactKeys(
    value.firstObservation,
    ["at", "basis", "sequence"],
    "UE_AUTOMATION_PROCESS_LEDGER_INVALID",
  );
  assertExactKeys(
    value.ownership,
    [
      "basis",
      "commandLineMarkerObserved",
      "jobMembershipVerified",
      "jobNewProcessObserved",
      "markerBasis",
      "taskMarkerObserved",
    ],
    "UE_AUTOMATION_PROCESS_LEDGER_INVALID",
  );
  assertExactKeys(
    value.exit,
    ["at", "code", "kind", "observed", "sequence"],
    "UE_AUTOMATION_PROCESS_LEDGER_INVALID",
  );
  if (
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0 ||
    !Number.isSafeInteger(value.parentPid) ||
    value.parentPid <= 0 ||
    !/^\d+$/.test(value.creationFileTimeUtc) ||
    typeof value.executable !== "string" ||
    value.executable.length === 0 ||
    !isHash(value.executablePathSha256) ||
    !(value.commandLineSha256 === null || isHash(value.commandLineSha256)) ||
    !isHash(value.identitySha256) ||
    value.identitySha256 !== sha256(Buffer.from(stable(processIdentityMaterial(value)), "utf8")) ||
    !isHash(value.parentIdentitySha256) ||
    ![
      "editor_root",
      "crash_report_client",
      "console_host",
      "platform_validator_shell",
      "platform_validator_dotnet",
    ].includes(value.role) ||
    value.identityComplete !== true ||
    !["create_suspended_before_resume", "windows_job_new_process"].includes(
      value.firstObservation.basis,
    ) ||
    !Number.isSafeInteger(value.firstObservation.sequence) ||
    value.firstObservation.sequence < 0 ||
    !isIsoUtc(value.firstObservation.at) ||
    value.ownership.basis !== "windows_job_membership" ||
    value.ownership.jobMembershipVerified !== true ||
    value.ownership.jobNewProcessObserved !== true ||
    value.ownership.taskMarkerObserved !== true ||
    typeof value.ownership.commandLineMarkerObserved !== "boolean" ||
    value.exit.observed !== true ||
    !Number.isSafeInteger(value.exit.sequence) ||
    value.exit.sequence <= value.firstObservation.sequence ||
    !isIsoUtc(value.exit.at) ||
    !["exit", "abnormal_exit"].includes(value.exit.kind) ||
    !Number.isSafeInteger(value.exit.code)
  ) {
    fail("UE_AUTOMATION_PROCESS_LEDGER_INVALID");
  }
  if (
    (value.role === "editor_root" &&
      (value.firstObservation.basis !== "create_suspended_before_resume" ||
        value.ownership.commandLineMarkerObserved !== true ||
        value.ownership.markerBasis !== "root_command_line_and_named_job")) ||
    (value.role !== "editor_root" && value.firstObservation.basis !== "windows_job_new_process") ||
    ![
      "root_command_line_and_named_job",
      "crash_report_client_log_argument_and_named_job",
      "command_line_and_named_job",
      "named_job_membership",
    ].includes(value.ownership.markerBasis)
  ) {
    fail("UE_AUTOMATION_PROCESS_MARKER_MISMATCH");
  }
}

export function validateUeSessionProcessLedger(value) {
  assertExactKeys(
    value,
    [
      "closeout",
      "expectedExecutables",
      "helperSource",
      "jobNameSha256",
      "launcher",
      "logCorroboration",
      "ownershipMechanism",
      "processes",
      "reason",
      "root",
      "schemaVersion",
      "sessionId",
      "status",
      "taskMarker",
      "taskMarkerSha256",
    ],
    "UE_AUTOMATION_PROCESS_LEDGER_INVALID",
  );
  assertExactKeys(value.helperSource, ["name", "sha256"], "UE_AUTOMATION_PROCESS_LEDGER_INVALID");
  assertExactKeys(
    value.launcher,
    [
      "commandLineSha256",
      "creationFileTimeUtc",
      "executable",
      "executablePathSha256",
      "identitySha256",
      "parentPid",
      "pid",
    ],
    "UE_AUTOMATION_PROCESS_LEDGER_INVALID",
  );
  assertExactKeys(
    value.root,
    ["exitCode", "identitySha256", "pid"],
    "UE_AUTOMATION_PROCESS_LEDGER_INVALID",
  );
  assertExactKeys(
    value.logCorroboration,
    ["complete", "crashReportClientPids", "matchedCrashReportClientPids"],
    "UE_AUTOMATION_PROCESS_LEDGER_INVALID",
  );
  assertExactKeys(
    value.closeout,
    [
      "activeProcessZeroObserved",
      "activeProcessZeroObservedAt",
      "accountingProcessCountMatches",
      "accountingTotalProcessCount",
      "finalResidualCount",
      "forcedJobTermination",
      "forcedUnassignedRootTermination",
      "helperExitCode",
      "incompleteIdentityCount",
      "markerResidualCount",
      "markerResiduals",
      "missingJobNewProcessCount",
      "rootExitCode",
      "rootExitObserved",
      "residualCountBeforeCleanup",
      "recordedProcessCount",
      "timedOut",
      "unattributedCount",
      "unclosedCount",
      "unknownExecutableCount",
      "unexpectedJobMessageCount",
      "unassignedRootResidualAfterCleanup",
    ],
    "UE_AUTOMATION_PROCESS_LEDGER_INVALID",
  );
  if (
    value.schemaVersion !== UE_AUTOMATION_PROCESS_LEDGER_SCHEMA_VERSION ||
    !UE_AUTOMATION_SESSIONS.some(({ id }) => id === value.sessionId) ||
    typeof value.taskMarker !== "string" ||
    value.taskMarker !==
      `uagent-mvp15d-rework7-ue-${value.sessionId}-${value.taskMarker.slice(-32)}` ||
    !/^[0-9a-f]{32}$/.test(value.taskMarker.slice(-32)) ||
    value.taskMarkerSha256 !== sha256(Buffer.from(value.taskMarker, "utf8")) ||
    value.ownershipMechanism !== "windows_job_object" ||
    value.jobNameSha256 !==
      sha256(Buffer.from(`Local\\UAgentMvp15D-${value.taskMarker}`, "utf8")) ||
    value.helperSource.name !== basename(WINDOWS_JOB_HELPER_PATH) ||
    !isHash(value.helperSource.sha256) ||
    !Array.isArray(value.expectedExecutables) ||
    value.expectedExecutables.length !== 5 ||
    !Array.isArray(value.processes) ||
    value.processes.length < 2 ||
    value.status !== "completed" ||
    value.reason !== "ue_automation_process_closeout_completed"
  ) {
    fail("UE_AUTOMATION_PROCESS_LEDGER_INVALID");
  }
  if (
    !Number.isSafeInteger(value.launcher.pid) ||
    value.launcher.pid <= 0 ||
    !Number.isSafeInteger(value.launcher.parentPid) ||
    value.launcher.parentPid <= 0 ||
    !/^\d+$/.test(value.launcher.creationFileTimeUtc) ||
    typeof value.launcher.executable !== "string" ||
    value.launcher.executable.length === 0 ||
    !isHash(value.launcher.executablePathSha256) ||
    !isHash(value.launcher.commandLineSha256) ||
    value.launcher.identitySha256 !==
      sha256(Buffer.from(stable(processIdentityMaterial(value.launcher)), "utf8"))
  ) {
    fail("UE_AUTOMATION_PROCESS_LEDGER_INVALID");
  }
  value.expectedExecutables.forEach(validateExpectedExecutable);
  value.processes.forEach(validateLedgerProcess);
  if (
    new Set(value.processes.map(({ identitySha256 }) => identitySha256)).size !==
      value.processes.length ||
    new Set(value.expectedExecutables.map(({ role }) => role)).size !==
      value.expectedExecutables.length
  ) {
    fail("UE_AUTOMATION_PROCESS_IDENTITY_COLLISION");
  }
  const identities = new Map([
    [value.launcher.identitySha256, value.launcher],
    ...value.processes.map((processEntry) => [processEntry.identitySha256, processEntry]),
  ]);
  if (
    value.processes.some((processEntry) => {
      const parent = identities.get(processEntry.parentIdentitySha256);
      return (
        !parent ||
        parent.pid !== processEntry.parentPid ||
        (parent !== value.launcher &&
          (parent.firstObservation.sequence >= processEntry.firstObservation.sequence ||
            parent.exit.sequence <= processEntry.firstObservation.sequence))
      );
    }) ||
    value.processes.filter(({ role }) => role === "editor_root").length !== 1 ||
    value.root.exitCode !== 0 ||
    !value.processes.some(
      ({ identitySha256, pid, role }) =>
        role === "editor_root" &&
        identitySha256 === value.root.identitySha256 &&
        pid === value.root.pid,
    )
  ) {
    fail("UE_AUTOMATION_PROCESS_PARENT_IDENTITY_INVALID");
  }
  const eventSequences = value.processes.flatMap((processEntry) => [
    processEntry.firstObservation.sequence,
    processEntry.exit.sequence,
  ]);
  if (new Set(eventSequences).size !== eventSequences.length) {
    fail("UE_AUTOMATION_PROCESS_EVENT_SEQUENCE_INVALID");
  }
  for (const pid of new Set(value.processes.map(({ pid }) => pid))) {
    const lifetimes = value.processes
      .filter((processEntry) => processEntry.pid === pid)
      .sort((left, right) => left.firstObservation.sequence - right.firstObservation.sequence);
    if (
      lifetimes.some(
        (processEntry, index) =>
          index > 0 && lifetimes[index - 1].exit.sequence >= processEntry.firstObservation.sequence,
      )
    ) {
      fail("UE_AUTOMATION_PROCESS_PID_REUSE_OVERLAP");
    }
  }
  for (const expected of value.expectedExecutables) {
    const matching = value.processes.filter(({ role }) => role === expected.role);
    const count = matching.length;
    if (
      count < expected.minimumCount ||
      (expected.maximumCount !== null && count > expected.maximumCount) ||
      matching.some(
        (processEntry) =>
          processEntry.executablePathSha256 !== expected.executablePathSha256 ||
          processEntry.executable.toLowerCase() !== expected.executable.toLowerCase(),
      )
    ) {
      fail("UE_AUTOMATION_PROCESS_EXECUTABLE_UNEXPECTED");
    }
  }
  const crashReportClientProcesses = value.processes.filter(
    ({ role }) => role === "crash_report_client",
  );
  if (
    !Array.isArray(value.logCorroboration.crashReportClientPids) ||
    value.logCorroboration.crashReportClientPids.length === 0 ||
    value.logCorroboration.crashReportClientPids.some(
      (pid) => !Number.isSafeInteger(pid) || pid <= 0,
    ) ||
    new Set(value.logCorroboration.crashReportClientPids).size !==
      value.logCorroboration.crashReportClientPids.length ||
    value.logCorroboration.crashReportClientPids.some(
      (pid) => !crashReportClientProcesses.some((processEntry) => processEntry.pid === pid),
    ) ||
    stable(value.logCorroboration.crashReportClientPids) !==
      stable(value.logCorroboration.matchedCrashReportClientPids) ||
    value.logCorroboration.complete !== true ||
    value.closeout.rootExitObserved !== true ||
    value.closeout.rootExitCode !== 0 ||
    value.closeout.activeProcessZeroObserved !== true ||
    !isIsoUtc(value.closeout.activeProcessZeroObservedAt) ||
    value.closeout.timedOut !== false ||
    value.closeout.forcedJobTermination !== false ||
    value.closeout.forcedUnassignedRootTermination !== false ||
    value.closeout.unassignedRootResidualAfterCleanup !== false ||
    value.closeout.residualCountBeforeCleanup !== 0 ||
    value.closeout.finalResidualCount !== 0 ||
    value.closeout.markerResidualCount !== 0 ||
    !Array.isArray(value.closeout.markerResiduals) ||
    value.closeout.markerResiduals.length !== 0 ||
    value.closeout.incompleteIdentityCount !== 0 ||
    value.closeout.unattributedCount !== 0 ||
    value.closeout.unknownExecutableCount !== 0 ||
    value.closeout.unclosedCount !== 0 ||
    value.closeout.missingJobNewProcessCount !== 0 ||
    value.closeout.unexpectedJobMessageCount !== 0 ||
    !Number.isSafeInteger(value.closeout.accountingTotalProcessCount) ||
    value.closeout.accountingTotalProcessCount !== value.processes.length ||
    value.closeout.recordedProcessCount !== value.processes.length ||
    value.closeout.accountingProcessCountMatches !== true ||
    value.closeout.helperExitCode !== 0
  ) {
    fail("UE_AUTOMATION_PROCESS_CLOSEOUT_INVALID");
  }
  return true;
}

export function validateUeAutomationCapture(value) {
  if (
    !value ||
    value.schemaVersion !== UE_AUTOMATION_CAPTURE_SCHEMA_VERSION ||
    value.taskId !== UE_AUTOMATION_TASK_ID ||
    value.captureKind !== "supporting_ue_automation" ||
    value.status !== "completed" ||
    !Array.isArray(value.sessions) ||
    value.sessions.length !== UE_AUTOMATION_SESSIONS.length ||
    !value.processCloseout ||
    value.processCloseout.sessionCount !== UE_AUTOMATION_SESSIONS.length ||
    value.processCloseout.completedSessionCount !== UE_AUTOMATION_SESSIONS.length ||
    value.processCloseout.finalResidualCount !== 0 ||
    value.processCloseout.complete !== true
  ) {
    fail("UE_AUTOMATION_CAPTURE_INVALID");
  }
  const markers = new Set();
  for (const expected of UE_AUTOMATION_SESSIONS) {
    const session = value.sessions.find(({ id }) => id === expected.id);
    if (
      !session ||
      session.status !== "completed" ||
      session.processLedger?.sessionId !== expected.id
    ) {
      fail("UE_AUTOMATION_CAPTURE_INVALID");
    }
    validateUeSessionProcessLedger(session.processLedger);
    if (markers.has(session.processLedger.taskMarker)) {
      fail("UE_AUTOMATION_PROCESS_MARKER_COLLISION");
    }
    markers.add(session.processLedger.taskMarker);
  }
  return true;
}

function validateRetainedLog(outputRoot, evidence, expectedName, required, files) {
  assertExactKeys(
    evidence,
    ["byteLength", "exists", "name", "sha256"],
    "UE_AUTOMATION_RETAINED_LOG_INVALID",
  );
  if (
    evidence.name !== expectedName ||
    basename(evidence.name) !== evidence.name ||
    typeof evidence.exists !== "boolean"
  ) {
    fail("UE_AUTOMATION_RETAINED_LOG_INVALID");
  }
  const path = resolve(outputRoot, evidence.name);
  if (!within(outputRoot, path)) fail("UE_AUTOMATION_RETAINED_LOG_INVALID");
  const stats = entryOrNull(path, "UE_AUTOMATION_RETAINED_LOG_INVALID");
  if (!evidence.exists) {
    if (required || stats || evidence.sha256 !== null || evidence.byteLength !== 0)
      fail("UE_AUTOMATION_RETAINED_LOG_INVALID");
    return;
  }
  const file = regularFile(path, "UE_AUTOMATION_RETAINED_LOG_INVALID");
  const bytes = readFileSync(file);
  if (
    !Number.isSafeInteger(evidence.byteLength) ||
    evidence.byteLength !== bytes.length ||
    !isHash(evidence.sha256) ||
    evidence.sha256 !== sha256(bytes) ||
    files.has(evidence.name)
  ) {
    fail("UE_AUTOMATION_RETAINED_LOG_INVALID");
  }
  files.add(evidence.name);
}

function validateRetainedContentAggregate(value) {
  assertExactKeys(
    value,
    ["aggregateSha256", "fileCount"],
    "UE_AUTOMATION_RETAINED_CONTENT_INVALID",
  );
  if (
    !Number.isSafeInteger(value.fileCount) ||
    value.fileCount < 0 ||
    !isHash(value.aggregateSha256)
  ) {
    fail("UE_AUTOMATION_RETAINED_CONTENT_INVALID");
  }
}

export function validateTaskOwnedUeAutomationBundle({ taskRoot }) {
  const outputRoot = existingTaskOutput(taskRoot);
  const reportName = "automation-capture.json";
  const reportPath = resolve(outputRoot, reportName);
  const reportBytes = readFileSync(regularFile(reportPath, "UE_AUTOMATION_CAPTURE_FILE_INVALID"));
  let report;
  try {
    report = JSON.parse(reportBytes.toString("utf8"));
  } catch {
    fail("UE_AUTOMATION_CAPTURE_FILE_INVALID");
  }
  validateUeAutomationCapture(report);
  validateRetainedContentAggregate(report.contentBefore);
  validateRetainedContentAggregate(report.contentAfter);
  if (
    stable(report.contentBefore) !== stable(report.contentAfter) ||
    report.contentUnchanged !== true ||
    report.reason !== "ue_automation_completed" ||
    report.productAdapterEvidence !== "not_produced_by_this_runner" ||
    report.portCloseout !== "not_applicable_no_network_listener"
  ) {
    fail("UE_AUTOMATION_RETAINED_CONTENT_INVALID");
  }
  const files = new Set([reportName]);
  const allNamedTests = [];
  for (const expected of UE_AUTOMATION_SESSIONS) {
    const session = report.sessions.find(({ id }) => id === expected.id);
    if (
      session.route !== expected.route ||
      session.toolSearch !== expected.toolSearch ||
      session.filter !== expected.filter ||
      stable(session.expectedTests) !== stable(expected.expectedTests) ||
      session.contentUnchanged !== true ||
      !session.tests ||
      !Array.isArray(session.tests.namedTests) ||
      !Array.isArray(session.tests.completedTests)
    ) {
      fail("UE_AUTOMATION_RETAINED_MATRIX_INVALID");
    }
    const matrix = validateExpectedTestMatrix(
      session.tests.namedTests,
      session.tests.completedTests,
      expected.expectedTests,
    );
    if (
      !matrix.complete ||
      stable(matrix) !== stable(session.tests.expectedMatrix) ||
      session.tests.summaryObserved !== true ||
      session.tests.failureObserved !== false
    ) {
      fail("UE_AUTOMATION_RETAINED_MATRIX_INVALID");
    }
    allNamedTests.push(...session.tests.namedTests);
    assertExactKeys(
      session.processLogs,
      ["crashReportClient", "editor", "stderr", "stdout"],
      "UE_AUTOMATION_RETAINED_LOG_INVALID",
    );
    const expectedLogNames = {
      editor: `UnrealEditor-Cmd-${session.id}.log`,
      stdout: `UnrealEditor-Cmd-${session.id}.stdout.log`,
      stderr: `UnrealEditor-Cmd-${session.id}.stderr.log`,
      crashReportClient: `CrashReportClient-${session.id}-${session.processLedger.taskMarker}.log`,
    };
    for (const kind of ["editor", "stdout", "stderr", "crashReportClient"]) {
      validateRetainedLog(
        outputRoot,
        session.processLogs[kind],
        expectedLogNames[kind],
        kind !== "crashReportClient",
        files,
      );
    }
    if (stable(session.log) !== stable(session.processLogs.editor))
      fail("UE_AUTOMATION_RETAINED_LOG_INVALID");
  }
  if (
    new Set(allNamedTests).size !== UE_AUTOMATION_EXPECTED_TESTS.length ||
    stable([...new Set(allNamedTests)].sort()) !==
      stable([...UE_AUTOMATION_EXPECTED_TESTS].sort()) ||
    stable(report.tests?.expectedTests) !== stable(UE_AUTOMATION_EXPECTED_TESTS) ||
    report.tests.expectedCount !== UE_AUTOMATION_EXPECTED_TESTS.length ||
    report.tests.discoveredCount !== UE_AUTOMATION_EXPECTED_TESTS.length ||
    report.tests.complete !== true
  ) {
    fail("UE_AUTOMATION_RETAINED_MATRIX_INVALID");
  }
  const rootEntries = readdirSync(outputRoot, { withFileTypes: true });
  if (
    rootEntries.some(
      (entry) =>
        entry.isSymbolicLink() ||
        !entry.isFile() ||
        !files.has(entry.name) ||
        !regularFile(resolve(outputRoot, entry.name), "UE_AUTOMATION_RETAINED_FILE_INVALID"),
    ) ||
    rootEntries.length !== files.size
  ) {
    fail("UE_AUTOMATION_RETAINED_FILE_INVALID");
  }
  return {
    taskRoot: outputRoot,
    taskId: report.taskId,
    sessionCount: report.sessions.length,
    testCount: allNamedTests.length,
    captureSha256: sha256(reportBytes),
  };
}

async function runCommandlet(commandlet, args, cwd, ddcPath, { marker, stdoutPath, stderrPath }) {
  if (markerProcesses(marker).length !== 0) {
    fail("UE_AUTOMATION_PROCESS_MARKER_COLLISION");
  }
  return new Promise((resolveRun, rejectRun) => {
    const helper = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        WINDOWS_JOB_HELPER_PATH,
        "-Executable",
        commandlet,
        "-WorkingDirectory",
        cwd,
        "-ArgumentsBase64",
        Buffer.from(JSON.stringify(args), "utf8").toString("base64"),
        "-StdoutPath",
        stdoutPath,
        "-StderrPath",
        stderrPath,
        "-TaskMarker",
        marker,
        "-TimeoutMilliseconds",
        String(PROCESS_SESSION_TIMEOUT_MS),
      ],
      {
        cwd,
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          "UE-LocalDataCachePath": ddcPath,
          "UE-SharedDataCachePath": "None",
        },
      },
    );
    let stdout = "";
    let stderr = "";
    let spawnError = null;
    let watchdogFired = false;
    const append = (current, value) =>
      current.length >= MAX_CAPTURE_BYTES ? current : (current + value).slice(0, MAX_CAPTURE_BYTES);
    helper.stdout?.setEncoding("utf8");
    helper.stderr?.setEncoding("utf8");
    helper.stdout?.on("data", (value) => {
      stdout = append(stdout, value);
    });
    helper.stderr?.on("data", (value) => {
      stderr = append(stderr, value);
    });
    helper.once("error", (error) => {
      spawnError = error.code ?? "WINDOWS_JOB_HELPER_SPAWN_FAILED";
    });
    const watchdog = setTimeout(() => {
      watchdogFired = true;
      helper.kill();
    }, PROCESS_SESSION_TIMEOUT_MS + 60_000);
    helper.once("close", (helperExitCode) => {
      clearTimeout(watchdog);
      if (spawnError) {
        rejectRun(new AutomationError(spawnError));
        return;
      }
      if (watchdogFired) {
        rejectRun(new AutomationError("UE_AUTOMATION_JOB_HELPER_TIMEOUT"));
        return;
      }
      let rawJobResult;
      try {
        rawJobResult = JSON.parse(stdout.trim());
      } catch {
        rejectRun(new AutomationError("UE_AUTOMATION_JOB_HELPER_OUTPUT_INVALID"));
        return;
      }
      const processStdout = existsSync(stdoutPath)
        ? readFileSync(stdoutPath, "utf8").slice(0, MAX_CAPTURE_BYTES)
        : "";
      const processStderr = existsSync(stderrPath)
        ? readFileSync(stderrPath, "utf8").slice(0, MAX_CAPTURE_BYTES)
        : "";
      resolveRun({
        pid: Number(rawJobResult.RootPid) || null,
        exitCode: Number.isSafeInteger(rawJobResult.RootExitCode)
          ? rawJobResult.RootExitCode
          : null,
        spawnError: null,
        stdout: processStdout,
        stderr: processStderr,
        helperExitCode,
        helperPid: helper.pid ?? null,
        helperStderr: stderr,
        rawJobResult,
      });
    });
  });
}

export async function runMvp15DUeAutomation({ project, output }) {
  const binding = resolveTaskProject(project);
  const outputRoot = createFreshUeAutomationOutput(output);
  const commandlet = regularFile(
    resolve(UE_AUTOMATION_COMMANDLET),
    "UE_AUTOMATION_COMMANDLET_UNAVAILABLE",
  );
  const helperPath = regularFile(WINDOWS_JOB_HELPER_PATH, "UE_AUTOMATION_JOB_HELPER_UNAVAILABLE");
  const helperSourceSha256 = sha256(readFileSync(helperPath));
  const expectedExecutables = expectedProcessExecutables(commandlet);
  const reportPath = resolve(outputRoot, "automation-capture.json");
  const sessionLogPaths = new Map(
    UE_AUTOMATION_SESSIONS.map((session) => [
      session.id,
      resolve(outputRoot, `UnrealEditor-Cmd-${session.id}.log`),
    ]),
  );
  if (existsSync(reportPath) || [...sessionLogPaths.values()].some((path) => existsSync(path))) {
    fail("UE_AUTOMATION_OUTPUT_ALREADY_EXISTS");
  }
  const contentBefore = aggregateContent(resolve(binding.projectRoot, "Content"));
  const sessions = [];
  for (const [sessionIndex, session] of UE_AUTOMATION_SESSIONS.entries()) {
    const logPath = sessionLogPaths.get(session.id);
    const taskMarker = `uagent-mvp15d-rework7-ue-${session.id}-${randomBytes(16).toString("hex")}`;
    const crashReportClientLogPath = resolve(
      outputRoot,
      `CrashReportClient-${session.id}-${taskMarker}.log`,
    );
    const stdoutPath = resolve(outputRoot, `UnrealEditor-Cmd-${session.id}.stdout.log`);
    const stderrPath = resolve(outputRoot, `UnrealEditor-Cmd-${session.id}.stderr.log`);
    if ([crashReportClientLogPath, stdoutPath, stderrPath].some((path) => existsSync(path))) {
      fail("UE_AUTOMATION_OUTPUT_ALREADY_EXISTS");
    }
    const ddcPath = resolve(
      tmpdir(),
      `UAgent-MVP15D-Rework7-ue-ddc-${process.pid}-${sessionIndex}`,
    );
    if (existsSync(ddcPath)) fail("UE_AUTOMATION_DDC_ALREADY_EXISTS");
    mkdirSync(ddcPath, { recursive: false });
    const args = [
      binding.project,
      "-unattended",
      "-nop4",
      "-nosplash",
      "-NullRHI",
      "-NoSound",
      "-NoZenAutoLaunch",
      "-notraceserver",
      `-tracefile=${resolve(ddcPath, "session.utrace").split("\\").join("/")}`,
      "-stdout",
      "-FullStdOutLogOutput",
      `-DDC=(Local=(Type=FileSystem,Path=${ddcPath.split("\\").join("/")}))`,
      `-ExecCmds=Automation RunTests ${session.filter};Quit;`,
      "-TestExit=Automation Test Queue Empty",
      `-abslog=${logPath}`,
      `-abscrashreportclientlog=${crashReportClientLogPath.replace(/\\/g, "/")}`,
      `-UAgentMvp15DTaskMarker=${taskMarker}`,
    ];
    if (session.route !== null) {
      args.push(
        "-UAgentMvp15D0Probe",
        `-UAgentMvp15D0Route=${session.route}`,
        `-UAgentMvp15D0ToolSearch=${session.toolSearch}`,
      );
    }
    const startedAt = new Date().toISOString();
    const processResult = await runCommandlet(commandlet, args, binding.projectRoot, ddcPath, {
      marker: taskMarker,
      stdoutPath,
      stderrPath,
    });
    const completedAt = new Date().toISOString();
    const logText = existsSync(logPath)
      ? readFileSync(regularFile(logPath, "UE_AUTOMATION_LOG_INVALID"), "utf8")
      : "";
    const parsed = parseAutomationLog(
      `${logText}\n${processResult.stdout}\n${processResult.stderr}`,
      session.expectedTests,
    );
    const processLedger = createUeSessionProcessLedger({
      rawJobResult: processResult.rawJobResult,
      helperExitCode: processResult.helperExitCode,
      helperSourceSha256,
      sessionId: session.id,
      taskMarker,
      expectedExecutables,
      crashReportClientPids: parsed.crashReportClientPids,
      markerResiduals: markerResidualEvidence(taskMarker),
    });
    const contentAfterSession = aggregateContent(resolve(binding.projectRoot, "Content"));
    const contentUnchanged =
      contentBefore.fileCount === contentAfterSession.fileCount &&
      contentBefore.aggregateSha256 === contentAfterSession.aggregateSha256;
    const logs = {
      editor: fileEvidence(logPath),
      crashReportClient: fileEvidence(crashReportClientLogPath),
      stdout: fileEvidence(stdoutPath),
      stderr: fileEvidence(stderrPath),
    };
    // CRC monitor mode can close cleanly without materializing its optional -abslog target.
    const processArtifactsComplete = [logs.editor, logs.stdout, logs.stderr].every(
      ({ exists }) => exists,
    );
    const completed =
      processResult.spawnError === null &&
      processResult.exitCode === 0 &&
      processLedger.status === "completed" &&
      parsed.summaryObserved &&
      !parsed.failureObserved &&
      processArtifactsComplete &&
      contentUnchanged;
    const reason = completed
      ? "ue_automation_session_completed"
      : (processResult.spawnError ??
        (processLedger.status !== "completed"
          ? processLedger.reason
          : processResult.exitCode !== 0
            ? "UE_AUTOMATION_COMMANDLET_EXIT_NONZERO"
            : !parsed.summaryObserved
              ? "UE_AUTOMATION_SUMMARY_MISSING"
              : !parsed.expectedMatrix.complete
                ? "UE_AUTOMATION_EXPECTED_TEST_MATRIX_MISMATCH"
                : !processArtifactsComplete
                  ? "UE_AUTOMATION_PROCESS_LOG_MISSING"
                  : contentUnchanged
                    ? "UE_AUTOMATION_FAILURE_LOGGED"
                    : "UE_AUTOMATION_CONTENT_MUTATION_OBSERVED"));
    sessions.push({
      id: session.id,
      route: session.route,
      toolSearch: session.toolSearch,
      filter: session.filter,
      expectedTests: session.expectedTests,
      process: {
        executable: basename(commandlet),
        pid: processResult.pid,
        startedAt,
        completedAt,
        exitCode: processResult.exitCode,
        spawnError: processResult.spawnError,
        commandSha256: sha256(Buffer.from(JSON.stringify(args), "utf8")),
        helper: {
          executable: "powershell.exe",
          pid: processResult.helperPid,
          exitCode: processResult.helperExitCode,
          stderrSha256: sha256(Buffer.from(processResult.helperStderr, "utf8")),
          stderrByteLength: Buffer.byteLength(processResult.helperStderr, "utf8"),
        },
      },
      log: logs.editor,
      processLogs: logs,
      processLedger,
      tests: parsed,
      contentUnchanged,
      status: completed ? "completed" : "failed",
      reason,
    });
    if (!completed) break;
  }
  const contentAfter = aggregateContent(resolve(binding.projectRoot, "Content"));
  const contentUnchanged =
    contentBefore.fileCount === contentAfter.fileCount &&
    contentBefore.aggregateSha256 === contentAfter.aggregateSha256;
  const completed =
    sessions.length === UE_AUTOMATION_SESSIONS.length &&
    sessions.every((session) => session.status === "completed") &&
    contentUnchanged;
  const firstFailure = sessions.find((session) => session.status !== "completed");
  const processCloseout = {
    sessionCount: sessions.length,
    completedSessionCount: sessions.filter(
      ({ processLedger }) => processLedger.status === "completed",
    ).length,
    finalResidualCount: sessions.reduce(
      (count, { processLedger }) =>
        count +
        processLedger.closeout.finalResidualCount +
        processLedger.closeout.markerResidualCount,
      0,
    ),
    complete:
      sessions.length === UE_AUTOMATION_SESSIONS.length &&
      sessions.every(({ processLedger }) => processLedger.status === "completed"),
  };
  const report = {
    schemaVersion: UE_AUTOMATION_CAPTURE_SCHEMA_VERSION,
    taskId: UE_AUTOMATION_TASK_ID,
    captureKind: "supporting_ue_automation",
    productAdapterEvidence: "not_produced_by_this_runner",
    filter: UE_AUTOMATION_FILTER,
    sessions,
    tests: {
      expectedTests: UE_AUTOMATION_EXPECTED_TESTS,
      expectedCount: UE_AUTOMATION_EXPECTED_TESTS.length,
      discoveredCount: sessions.reduce(
        (count, session) => count + session.tests.namedTests.length,
        0,
      ),
      complete: completed,
    },
    contentBefore,
    contentAfter,
    contentUnchanged,
    processCloseout,
    portCloseout: "not_applicable_no_network_listener",
    status: completed ? "completed" : "failed",
    reason: completed
      ? "ue_automation_completed"
      : (firstFailure?.reason ??
        (contentUnchanged
          ? "UE_AUTOMATION_SESSION_FAILED"
          : "UE_AUTOMATION_CONTENT_MUTATION_OBSERVED")),
  };
  if (completed) validateUeAutomationCapture(report);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return { reportPath, report };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args["task-root"]) {
    const result = validateTaskOwnedUeAutomationBundle({ taskRoot: args["task-root"] });
    console.log(
      JSON.stringify({
        status: "validated_supporting_ue_automation_capture",
        taskId: result.taskId,
        sessionCount: result.sessionCount,
        testCount: result.testCount,
        captureSha256: result.captureSha256,
      }),
    );
    return;
  }
  const result = await runMvp15DUeAutomation(args);
  console.log(
    JSON.stringify({
      status: result.report.status,
      reason: result.report.reason,
      taskId: UE_AUTOMATION_TASK_ID,
      reportFile: basename(result.reportPath),
      sessionCount: result.report.sessions.length,
      testCount: result.report.tests.discoveredCount,
      expectedTestCount: result.report.tests.expectedCount,
      expectedMatrixComplete: result.report.tests.complete,
    }),
  );
  if (result.report.status !== "completed") process.exitCode = 2;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    const reason = error instanceof AutomationError ? error.code : "UE_AUTOMATION_CAPTURE_FAILED";
    console.error(JSON.stringify({ status: "failed", reason }));
    process.exitCode = 2;
  });
}
