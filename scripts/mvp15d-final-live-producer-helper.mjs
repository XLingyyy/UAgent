#!/usr/bin/env node
/* global process */

import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import {
  EARLY_IDENTITY_SCHEMA,
  LOADED_LEDGER_SCHEMA,
  LoadedModuleError,
  PRODUCTION_ORIGIN,
  observeProcess,
  publishProductionLoadedLedger,
  reduceLoadedModules,
  validateObservationIdentity,
} from "./mvp15d-loaded-module-observer.mjs";
import { computeSourceIdentity } from "./mvp15d-source-identity.mjs";

const TASK_GENERATION = "final-d13-d16";
const RUNTIME_EVENT_SCHEMA = "uagent.mvp15d.final.runtime-event.v2";
const DRIVER_SCHEMA = "uagent.mvp15d.final.driver-command.v1";
const PHASE_EVENT_SCHEMA = "uagent.mvp15d.final.phase-event.v1";
const BRIDGE_VERSION = "uagent.mvp15d.runtime-bridge.v5";
const UE_AUTOMATION_REPORT_SCHEMA = "uagent.mvp15d.ue-automation-report.v1";
const JOB_CLOSEOUT_SCHEMA = "uagent.mvp15d.final.job-closeout.v1";
const PORT_CLOSEOUT_SCHEMA = "uagent.mvp15d.final.port-closeout.v1";
const LIVE_PROCESS_TIMEOUT_MILLISECONDS = 600_000;
const ROOT_PATTERN = /^mvp15d-final-d13-d16-\d{8}_\d{6}(?:-[A-Za-z0-9]+)?$/;
const PHASES = new Set(["ue-automation", "product-capture", "ui-lifecycle"]);
const COMMON_KEYS = [
  "repository",
  "evidence-root",
  "task-id",
  "task-generation",
  "source-commit",
  "marker",
  "session",
  "endpoint",
  "generation",
  "port",
  "ue-root",
];
const RENDERED_PATHS = Object.freeze({
  "capability-probe": "capability",
  "product-capture":
    "validate,add,confirmTrust,observationDiscover,observationAttach,observationReady,Connect,Initialize,Discover,Normalize,Fingerprint,disconnect",
  "ui-lifecycle":
    "validate,add,confirmTrust,observationDiscover,observationAttach,observationReady,mcpConnect,mcpInitialize,mcpDiscover,mcpNormalize,mcpFingerprint,dryRun,approve,register,execute,verify,crossTtl,rollback,finalVerify,replay,observationStop,mcpDisconnect",
});
const UE_AUTOMATION_TESTS = Object.freeze([
  "UAgentAssetTools.Contracts",
  "UAgentAssetTools.ReadOnly",
  "UAgentAssetTools.Closeout",
]);

class LiveProducerError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new LiveProducerError(code);
}

function stable(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function retainedBinding(kind, value) {
  const raw = typeof value === "string" ? value : stable(value);
  return sha256(Buffer.from(`uagent.mvp15d.retained.${kind}.v1\0${raw}`, "utf8"));
}

function retainedKeyBinding(key) {
  const lower = key.toLowerCase();
  if (lower === "marker") return ["markerSha256", "marker"];
  if (lower === "session") return ["sessionBindingSha256", "session"];
  const sessionIndex = lower.indexOf("sessionid");
  if (sessionIndex >= 0) {
    const originalSuffix = key.slice(sessionIndex + "sessionId".length);
    return [`${key.slice(0, sessionIndex)}SessionBindingSha256${originalSuffix}`, "session"];
  }
  if (["pid", "runtimepid", "processpid"].includes(lower)) {
    return [`${key}BindingSha256`, "pid"];
  }
  if (lower.endsWith("processid")) {
    return [`${key}BindingSha256`, "process-id"];
  }
  if (
    ["starttime", "processstarttime"].includes(lower) ||
    (lower.includes("creation") && lower.includes("filetime"))
  ) {
    return [`${key}BindingSha256`, "creation-filetime"];
  }
  if (lower === "port") return ["portBindingSha256", "port"];
  if (lower === "endpoint") return ["endpointSha256", "endpoint"];
  return null;
}

function retainedEventValue(value) {
  if (Array.isArray(value)) return value.map(retainedEventValue);
  if (!value || typeof value !== "object") return value;
  const retained = {};
  for (const [key, nested] of Object.entries(value)) {
    const binding = retainedKeyBinding(key);
    if (binding) {
      if (nested !== null) retained[binding[0]] = retainedBinding(binding[1], nested);
    } else {
      retained[key] = retainedEventValue(nested);
    }
  }
  return retained;
}

function ueProductionProcessProvenance(loadedProcess, earlyIdentity) {
  return {
    pidBindingSha256: loadedProcess.pidBindingSha256,
    creationFileTimeUtc: earlyIdentity.rootCreationFileTimeUtc,
    executableBasename: loadedProcess.executableBasename,
    executableSha256: loadedProcess.executableSha256,
  };
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function regexEscape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactRuntimeLog(value, binding) {
  let text = String(value).replace(/\r\n?/g, "\n");
  const replacements = [
    [binding.project, "<project>"],
    [binding.evidenceRoot, "<evidence-root>"],
    [binding.ueRoot, "<ue-root>"],
    [binding.repository, "<repository>"],
    [binding.endpoint, "<endpoint>"],
  ].filter(([source]) => typeof source === "string" && source.length > 0);
  replacements.sort(([left], [right]) => right.length - left.length);
  for (const [source, replacement] of replacements) {
    text = text.replace(new RegExp(regexEscape(source), "giu"), replacement);
  }
  return text
    .replace(/\bAuthorization\s*[:=]\s*[^\s,;]+/giu, "Authorization: <redacted>")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer <redacted>")
    .replace(
      /\b(SecurityToken|api[_-]?key|access[_-]?token|refresh[_-]?token|token)\s*[:=]\s*[^\s,;]+/giu,
      "$1=<redacted>",
    )
    .replace(/\b[A-Za-z]:\\Users\\[^\s"'<>|]+/giu, "<home>")
    .replace(/\/(?:home|Users)\/[^\s"'<>|]+/gu, "<home>");
}

function emitRedactedRuntimeLogs(transport, binding) {
  for (const [label, path] of [
    ["runtime-stdout", transport.stdoutFile],
    ["runtime-stderr", transport.stderrFile],
  ]) {
    if (!existsSync(path)) continue;
    const text = redactRuntimeLog(readFileSync(path, "utf8"), binding);
    process.stderr.write(`[${label}]\n${text}${text.endsWith("\n") ? "" : "\n"}`);
  }
}

function requireFile(path, code) {
  if (!existsSync(path)) fail(code);
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink()) fail(code);
  return path;
}

function requireDirectory(path, code) {
  if (!existsSync(path)) fail(code);
  const stats = lstatSync(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) fail(code);
  return path;
}

function within(root, candidate) {
  const value = relative(root, candidate);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function parseOrderedArgs(phase, argv) {
  if (!PHASES.has(phase)) fail("FINAL_LIVE_PHASE_INVALID");
  const keys = COMMON_KEYS;
  if (argv.length !== keys.length * 2) fail("FINAL_LIVE_ARGUMENT_VECTOR_INVALID");
  const args = Object.create(null);
  for (let index = 0; index < keys.length; index += 1) {
    const expected = `--${keys[index]}`;
    const token = argv[index * 2];
    const value = argv[index * 2 + 1];
    if (token !== expected || !value || value.startsWith("--")) {
      fail("FINAL_LIVE_ARGUMENT_VECTOR_INVALID");
    }
    args[keys[index]] = value;
  }
  return args;
}

function validateCommonBinding(phase, args, requireProject) {
  const repository = requireDirectory(resolve(args.repository), "FINAL_LIVE_REPOSITORY_INVALID");
  const evidenceRoot = requireDirectory(
    resolve(args["evidence-root"]),
    "FINAL_LIVE_EVIDENCE_ROOT_INVALID",
  );
  const external = resolve(repository, "external");
  const port = Number(args.port);
  const generation = Number(args.generation);
  if (args["ue-root"] && !isAbsolute(args["ue-root"])) {
    fail("FINAL_LIVE_UE_ROOT_INVALID");
  }
  if (
    resolve(evidenceRoot, "..") !== external ||
    !ROOT_PATTERN.test(basename(evidenceRoot)) ||
    !within(external, evidenceRoot) ||
    !/^TASK-MVP15D-[A-Z0-9-]+$/.test(args["task-id"]) ||
    args["task-generation"] !== TASK_GENERATION ||
    !/^[0-9a-f]{40}$/.test(args["source-commit"]) ||
    !/^[A-Za-z0-9._:-]{24,160}$/.test(args.marker) ||
    !/^[A-Za-z0-9._:-]{16,160}$/.test(args.session) ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    !Number.isSafeInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    args.endpoint !== `http://127.0.0.1:${port}/mcp`
  ) {
    fail("FINAL_LIVE_BINDING_INVALID");
  }
  const projectPath = resolve(evidenceRoot, "project", "FinalHost", "FinalHost.uproject");
  const project = requireProject
    ? requireFile(projectPath, "FINAL_LIVE_PROJECT_INVALID")
    : existsSync(projectPath)
      ? requireFile(projectPath, "FINAL_LIVE_PROJECT_INVALID")
      : null;
  return {
    phase,
    repository,
    evidenceRoot,
    project,
    taskId: args["task-id"],
    sourceCommit: args["source-commit"],
    marker: args.marker,
    sessionId: args.session,
    endpoint: args.endpoint,
    generation,
    port,
    ueRoot: args["ue-root"]
      ? requireDirectory(resolve(args["ue-root"]), "FINAL_LIVE_UE_ROOT_INVALID")
      : null,
  };
}

function validateBinding(phase, argv) {
  const args = parseOrderedArgs(phase, argv);
  return {
    ...validateCommonBinding(phase, args, true),
    adapterArgumentVector: argv,
  };
}

function ensureTransportDirectories(evidenceRoot) {
  const metadata = resolve(evidenceRoot, "metadata");
  const transcripts = resolve(evidenceRoot, "transcripts");
  const logs = resolve(evidenceRoot, "logs");
  for (const directory of [metadata, transcripts, logs]) {
    if (!existsSync(directory)) mkdirSync(directory);
    requireDirectory(directory, "FINAL_LIVE_TRANSPORT_DIRECTORY_INVALID");
  }
  return { metadata, transcripts, logs };
}

function createNonce(path) {
  const nonce = randomBytes(32).toString("hex");
  const descriptor = openSync(path, "wx");
  try {
    writeFileSync(descriptor, `${nonce}\n`, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  return { value: nonce, sha256: sha256(Buffer.from(nonce, "utf8")) };
}

function writeDriver(path, binding, nonceSha256, command) {
  const value = {
    schemaVersion: DRIVER_SCHEMA,
    taskId: binding.taskId,
    phase: binding.phase,
    session: binding.sessionId,
    generation: binding.generation,
    nonceSha256,
    command,
  };
  const descriptor = openSync(path, "wx");
  try {
    writeFileSync(descriptor, `${JSON.stringify(value)}\n`, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function bridgeTransport(binding, mode) {
  const directories = ensureTransportDirectories(binding.evidenceRoot);
  const prefix = `${binding.phase}.${binding.sessionId}`;
  const nonceFile = resolve(directories.metadata, `${prefix}.nonce`);
  const driverFile = resolve(directories.metadata, `${prefix}.driver.json`);
  const identityFile = resolve(directories.metadata, `${prefix}.early-identity.json`);
  const jobCloseoutFile = resolve(directories.metadata, `${binding.phase}.job-closeout.json`);
  const portCloseoutFile = resolve(directories.metadata, `${binding.phase}.port-closeout.json`);
  const eventFile = resolve(directories.transcripts, `${binding.phase}.runtime-events.jsonl`);
  const stdoutFile = resolve(directories.logs, `${prefix}.runtime.stdout.tmp`);
  const stderrFile = resolve(directories.logs, `${prefix}.runtime.stderr.tmp`);
  for (const path of [
    nonceFile,
    driverFile,
    eventFile,
    stdoutFile,
    stderrFile,
    identityFile,
    `${identityFile}.tmp`,
    jobCloseoutFile,
    portCloseoutFile,
  ]) {
    if (existsSync(path)) fail("FINAL_LIVE_TRANSPORT_RESIDUE");
  }
  const nonce = createNonce(nonceFile);
  return {
    mode,
    nonceFile,
    nonceSha256: nonce.sha256,
    driverFile,
    identityFile,
    jobCloseoutFile,
    portCloseoutFile,
    eventFile,
    stdoutFile,
    stderrFile,
  };
}

function desktopRuntimeCommand(binding, transport) {
  const executable = requireFile(
    resolve(binding.repository, "apps", "desktop", "src-tauri", "target", "release", "uagent.exe"),
    "FINAL_LIVE_EXECUTABLE_MISSING",
  );
  const liveProductRuntime =
    transport.mode === "live" &&
    (binding.phase === "product-capture" || binding.phase === "ui-lifecycle");
  const env = { ...process.env };
  delete env.UAGENT_ENABLE_UE_EDITOR_BRIDGE;
  delete env.UAGENT_ENABLE_UE_EDITOR_LAUNCH;
  delete env.UAGENT_MVP15D_UE_ROOT;
  Object.assign(env, {
    UAGENT_ENABLE_MVP15D_TASK_BRIDGE: "1",
    UAGENT_ENABLE_UE_EDITOR_BRIDGE: liveProductRuntime ? "1" : "0",
    UAGENT_ENABLE_UE_EDITOR_LAUNCH: liveProductRuntime ? "1" : "0",
    UAGENT_ENABLE_ASSET_MUTATION:
      liveProductRuntime && binding.phase === "ui-lifecycle" ? "1" : "0",
  });
  if (liveProductRuntime) {
    if (!binding.ueRoot || !isAbsolute(binding.ueRoot)) fail("FINAL_LIVE_UE_ROOT_INVALID");
    env.UAGENT_MVP15D_UE_ROOT = binding.ueRoot;
  }
  return {
    executable,
    args: [
      "mvp15d-final-runtime-bridge",
      "--phase",
      binding.phase,
      "--mode",
      transport.mode,
      "--task-generation",
      TASK_GENERATION,
      "--task-id",
      binding.taskId,
      "--source-commit",
      binding.sourceCommit,
      "--repository",
      binding.repository,
      "--evidence-root",
      binding.evidenceRoot,
      "--marker",
      binding.marker,
      "--session",
      binding.sessionId,
      "--generation",
      String(binding.generation),
      "--endpoint",
      binding.endpoint,
      "--port",
      String(binding.port),
      "--nonce-file",
      transport.nonceFile,
      "--event-file",
      transport.eventFile,
      "--driver-file",
      transport.driverFile,
      "--rendered-product-path",
      RENDERED_PATHS[binding.phase],
    ],
    env,
  };
}

function ueRuntimeCommand(binding, transport) {
  const executable = requireFile(
    resolve(binding.ueRoot, "Engine", "Binaries", "Win64", "UnrealEditor-Cmd.exe"),
    "FINAL_LIVE_EXECUTABLE_MISSING",
  );
  const reportDirectory = resolve(binding.evidenceRoot, "captures", "ue-automation-report");
  if (existsSync(reportDirectory)) fail("FINAL_LIVE_UE_REPORT_EXISTS");
  mkdirSync(reportDirectory);
  return {
    executable,
    args: [
      binding.project,
      "-unattended",
      "-nop4",
      "-nosplash",
      "-nullrhi",
      "-stdout",
      "-FullStdOutLogOutput",
      "-ddc=NoZenLocalFallback",
      `-LocalDataCachePath=${resolve(binding.project, "..", "Saved", "DerivedDataCache")}`,
      `-ExecCmds=Automation RunTests ${UE_AUTOMATION_TESTS.join("+")};Quit`,
      `-ReportExportPath=${reportDirectory}`,
      `-UAgentTaskId=${binding.taskId}`,
      `-UAgentTaskGeneration=${TASK_GENERATION}`,
      `-UAgentSourceCommit=${binding.sourceCommit}`,
      `-UAgentTaskMarker=${binding.marker}`,
      `-UAgentSession=${binding.sessionId}`,
      `-UAgentGeneration=${binding.generation}`,
    ],
    env: {
      ...process.env,
      "UE-LocalDataCachePath": resolve(binding.project, "..", "Saved", "DerivedDataCache"),
    },
    reportDirectory,
    transport,
  };
}

function runtimeCommand(binding, transport = null) {
  if (!transport) {
    const placeholder = {
      mode: "live",
      nonceFile: resolve(binding.evidenceRoot, "metadata", `${binding.phase}.nonce`),
      eventFile: resolve(
        binding.evidenceRoot,
        "transcripts",
        `${binding.phase}.runtime-events.jsonl`,
      ),
      driverFile: resolve(binding.evidenceRoot, "metadata", `${binding.phase}.driver.json`),
    };
    return binding.phase === "ue-automation"
      ? ueRuntimeCommand(binding, placeholder)
      : desktopRuntimeCommand(binding, placeholder);
  }
  return binding.phase === "ue-automation"
    ? ueRuntimeCommand(binding, transport)
    : desktopRuntimeCommand(binding, transport);
}

function readRuntimeEvents(path, binding, allowPartial = false) {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const rawLines = text.split(/\r?\n/);
  if (rawLines.at(-1) !== "") {
    if (!allowPartial) fail("FINAL_LIVE_RUNTIME_EVENT_PARTIAL");
    rawLines.pop();
  } else {
    rawLines.pop();
  }
  return rawLines.filter(Boolean).map((line) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      fail("FINAL_LIVE_RUNTIME_EVENT_JSON_INVALID");
    }
    if (
      !event ||
      typeof event !== "object" ||
      Array.isArray(event) ||
      Object.keys(event).sort().join(",") !== "data,phase,schemaVersion,type" ||
      event.schemaVersion !== RUNTIME_EVENT_SCHEMA ||
      event.phase !== binding.phase ||
      typeof event.type !== "string" ||
      !event.data ||
      typeof event.data !== "object" ||
      Array.isArray(event.data)
    ) {
      fail("FINAL_LIVE_RUNTIME_EVENT_INVALID");
    }
    return event;
  });
}

function parseRuntimeEvents(input, binding) {
  const events = Array.isArray(input)
    ? input
    : String(input)
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            fail("FINAL_LIVE_RUNTIME_EVENT_JSON_INVALID");
          }
        });
  if (events.length === 0) fail("FINAL_LIVE_RUNTIME_EVENTS_MISSING");
  let originCount = 0;
  let closeoutCount = 0;
  for (const event of events) {
    if (
      !event ||
      typeof event !== "object" ||
      Array.isArray(event) ||
      Object.keys(event).sort().join(",") !== "data,phase,schemaVersion,type" ||
      event.schemaVersion !== RUNTIME_EVENT_SCHEMA ||
      event.phase !== binding.phase ||
      typeof event.type !== "string" ||
      !event.data ||
      typeof event.data !== "object" ||
      Array.isArray(event.data)
    ) {
      fail("FINAL_LIVE_RUNTIME_EVENT_INVALID");
    }
    if (event.type === "evidence_origin") {
      originCount += 1;
      if (
        Object.keys(event.data).sort().join(",") !== "fixtureUsed,origin" ||
        !["production_runtime", "live_runtime"].includes(event.data.origin) ||
        event.data.fixtureUsed !== false
      ) {
        fail("FINAL_LIVE_FIXTURE_ORIGIN_REJECTED");
      }
    }
    if (event.type === "closeout") closeoutCount += 1;
  }
  if (originCount !== 1 || closeoutCount !== 1 || events.at(-1).type !== "closeout") {
    fail("FINAL_LIVE_RUNTIME_EVENT_COVERAGE_INVALID");
  }
  return events;
}

function descriptor(path) {
  const stats = lstatSync(path);
  return {
    basename: basename(path),
    size: stats.size,
    sha256: sha256File(path),
  };
}

function readJson(path, code) {
  try {
    const value = JSON.parse(readFileSync(requireFile(path, code), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
    return value;
  } catch (error) {
    if (error instanceof LiveProducerError) throw error;
    fail(code);
  }
}

function contentTreeSha256(project) {
  const contentRoot = requireDirectory(
    resolve(project, "..", "Content"),
    "FINAL_LIVE_CONTENT_INVALID",
  );
  const records = [];
  const walk = (directory, prefix) => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name, "en"),
    );
    const folded = new Set();
    for (const entry of entries) {
      const foldedName = entry.name.toLowerCase();
      if (folded.has(foldedName)) fail("FINAL_LIVE_CONTENT_INVALID");
      folded.add(foldedName);
      const path = resolve(directory, entry.name);
      const logical = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) fail("FINAL_LIVE_CONTENT_INVALID");
      if (stats.isDirectory()) {
        walk(path, logical);
      } else if (stats.isFile()) {
        records.push({ path: logical, size: stats.size, sha256: sha256File(path) });
      } else {
        fail("FINAL_LIVE_CONTENT_INVALID");
      }
    }
  };
  walk(contentRoot, "");
  return sha256(Buffer.from(stable(records), "utf8"));
}

function validateProjectSeed(project) {
  const contentRoot = requireDirectory(
    resolve(project, "..", "Content"),
    "FINAL_LIVE_CONTENT_INVALID",
  );
  const candidates = ["Test01.uasset", "Test01.umap"]
    .map((name) => resolve(contentRoot, name))
    .filter(existsSync);
  if (candidates.length !== 1) fail("FINAL_LIVE_TEST01_SOURCE_INVALID");
  const source = requireFile(candidates[0], "FINAL_LIVE_TEST01_SOURCE_INVALID");
  const stats = lstatSync(source);
  if (stats.size < 1) fail("FINAL_LIVE_TEST01_SOURCE_INVALID");
  return { size: stats.size, sha256: sha256File(source) };
}

function moduleRecord(root, record, code) {
  if (
    !record ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    typeof record.path !== "string" ||
    record.path.length === 0 ||
    isAbsolute(record.path) ||
    record.path.includes("\\") ||
    record.path.split("/").some((part) => part === "" || part === "." || part === "..") ||
    !Number.isSafeInteger(record.size) ||
    record.size < 1 ||
    !/^[0-9a-f]{64}$/.test(record.sha256)
  ) {
    fail(code);
  }
  const path = requireFile(resolve(root, ...record.path.split("/")), code);
  if (
    !within(root, path) ||
    lstatSync(path).size !== record.size ||
    sha256File(path) !== record.sha256
  ) {
    fail(code);
  }
  return { path: record.path, size: record.size, sha256: record.sha256 };
}

// Resolve the task-owned UE artifact paths shared by observation and binding.
function resolveUeArtifacts(binding) {
  const packageRoot = requireDirectory(
    resolve(binding.evidenceRoot, "package", "UAgentAssetTools"),
    "FINAL_LIVE_UE_PACKAGE_INVALID",
  );
  const installedRoot = requireDirectory(
    resolve(binding.project, "..", "Plugins", "UAgentAssetTools"),
    "FINAL_LIVE_UE_INSTALLED_INVALID",
  );
  const manifestPath = resolve(packageRoot, "UAgentAssetTools.build.json");
  const manifest = readJson(manifestPath, "FINAL_LIVE_UE_MANIFEST_INVALID");
  if (
    manifest.taskId !== binding.taskId ||
    manifest.sourceCommit !== binding.sourceCommit ||
    !Array.isArray(manifest.modules) ||
    manifest.modules.length === 0
  ) {
    fail("FINAL_LIVE_UE_MANIFEST_INVALID");
  }
  return { packageRoot, installedRoot, manifestPath, manifest };
}

// R6.1 early process identity: read and validate the Job runner's early
// identity publication while the root process is still alive.
function validateEarlyIdentity(identity, binding, command) {
  const expectedKeys = [
    "executableBasename",
    "executableSha256",
    "generation",
    "rootCreationFileTimeUtc",
    "rootPid",
    "schemaVersion",
    "session",
    "taskMarker",
  ]
    .sort()
    .join(",");
  if (
    !identity ||
    typeof identity !== "object" ||
    Array.isArray(identity) ||
    Object.keys(identity).sort().join(",") !== expectedKeys
  ) {
    fail("FINAL_LIVE_EARLY_IDENTITY_INVALID");
  }
  if (
    identity.schemaVersion !== EARLY_IDENTITY_SCHEMA ||
    identity.taskMarker !== binding.marker ||
    identity.session !== binding.sessionId ||
    identity.generation !== binding.generation ||
    !Number.isSafeInteger(identity.rootPid) ||
    identity.rootPid < 1 ||
    !/^[0-9]{1,30}$/.test(identity.rootCreationFileTimeUtc) ||
    typeof identity.executableBasename !== "string" ||
    identity.executableBasename.length === 0 ||
    !/^[0-9a-f]{64}$/.test(identity.executableSha256)
  ) {
    fail("FINAL_LIVE_EARLY_IDENTITY_INVALID");
  }
  if (identity.executableBasename !== basename(command.executable)) {
    fail("FINAL_LIVE_EARLY_IDENTITY_INVALID");
  }
  if (identity.executableSha256 !== sha256File(command.executable)) {
    fail("FINAL_LIVE_EARLY_IDENTITY_INVALID");
  }
  return identity;
}

async function waitForEarlyIdentity(binding, transport, command, timeoutMilliseconds, isClosed) {
  const identityPath = transport.identityFile;
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (isClosed()) fail("FINAL_LIVE_JOB_EXITED_BEFORE_IDENTITY");
    if (existsSync(identityPath)) {
      const stats = lstatSync(identityPath);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 4096) {
        fail("FINAL_LIVE_EARLY_IDENTITY_INVALID");
      }
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(identityPath, "utf8"));
      } catch {
        fail("FINAL_LIVE_EARLY_IDENTITY_INVALID");
      }
      return validateEarlyIdentity(parsed, binding, command);
    }
    await delay(100);
  }
  fail("FINAL_LIVE_EARLY_IDENTITY_TIMEOUT");
}

// R6.1/R6.2 live companion observation: poll through a bounded task-owned
// timeout until the approved companion modules are loaded, the process exits,
// or an identity mismatch occurs. Observation never waits for process exit to
// begin; each poll re-enumerates the live PID and rechecks creation identity.
async function observeLiveCompanionModules(
  binding,
  earlyIdentity,
  installedRoot,
  manifestModules,
  isClosed,
  { timeoutMilliseconds = 90_000, pollMilliseconds = 1_500 } = {},
) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (isClosed()) fail("FINAL_LIVE_UE_PROCESS_EXITED");
    const observation = observeProcess(earlyIdentity.rootPid);
    validateObservationIdentity(earlyIdentity, observation);
    try {
      const modules = reduceLoadedModules({
        manifestModules,
        installedRoot,
        observed: observation.modules,
      });
      return { modules, observation };
    } catch (error) {
      if (error instanceof LoadedModuleError && error.code === "LOADED_WRITER_MODULE_MISSING") {
        await delay(pollMilliseconds);
        continue;
      }
      throw error;
    }
  }
  fail("FINAL_LIVE_UE_OBSERVATION_TIMEOUT");
}

// Assert the production loaded-module ledger exists and is created by the
// production observer from a live observation, never by pre-authored JSON. A
// pre-existing ledger indicates fixture/caller-authored input and is rejected.
function ensureLoadedModuleLedger(
  binding,
  packageRoot,
  installedRoot,
  manifest,
  earlyIdentity,
  earlyIdentityPath,
  observation,
  executable,
) {
  const ledgerPath = resolve(binding.evidenceRoot, "captures", "loaded-modules.json");
  if (existsSync(ledgerPath)) {
    fail("FINAL_LIVE_UE_LOADED_PREEXISTING");
  }
  if (!Number.isSafeInteger(earlyIdentity.rootPid) || earlyIdentity.rootPid <= 0) {
    fail("FINAL_LIVE_UE_LOADED_INVALID");
  }
  const manifestPath = resolve(packageRoot, "UAgentAssetTools.build.json");
  const { ledger } = publishProductionLoadedLedger(ledgerPath, {
    repository: binding.repository,
    evidenceRoot: binding.evidenceRoot,
    taskId: binding.taskId,
    taskMarker: binding.marker,
    sessionId: binding.sessionId,
    generation: binding.generation,
    sourceCommit: binding.sourceCommit,
    projectPath: binding.project,
    manifestPath,
    packageRoot,
    installedRoot,
    executablePath: executable,
    earlyIdentityPath,
    earlyIdentity,
    observation,
    producerRelativePath: "scripts/mvp15d-final-ue-automation-producer.mjs",
  });
  rmSync(earlyIdentityPath, { force: true });
  return ledger;
}

function ueArtifactBinding(binding, earlyIdentity, executable, jobCloseoutPath, jobCloseout) {
  const { packageRoot, installedRoot, manifestPath, manifest } = resolveUeArtifacts(binding);
  const packageModules = manifest.modules
    .map((record) => moduleRecord(packageRoot, record, "FINAL_LIVE_UE_PACKAGE_INVALID"))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  const installedModules = manifest.modules
    .map((record) => moduleRecord(installedRoot, record, "FINAL_LIVE_UE_INSTALLED_INVALID"))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  if (stable(packageModules) !== stable(installedModules)) {
    fail("FINAL_LIVE_UE_INSTALLED_INVALID");
  }
  const packageArtifacts = manifest.artifacts
    .map((record) => moduleRecord(packageRoot, record, "FINAL_LIVE_UE_PACKAGE_INVALID"))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  const installedArtifacts = manifest.artifacts
    .map((record) => moduleRecord(installedRoot, record, "FINAL_LIVE_UE_INSTALLED_INVALID"))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  if (stable(packageArtifacts) !== stable(installedArtifacts)) {
    fail("FINAL_LIVE_UE_INSTALLED_INVALID");
  }
  const source = computeSourceIdentity(binding.repository);
  const projectId = basename(binding.project, ".uproject");
  const executableSha256 = sha256File(executable);
  const loadedFromDisk = readJson(
    resolve(binding.evidenceRoot, "captures", "loaded-modules.json"),
    "FINAL_LIVE_UE_LOADED_INVALID",
  );
  if (
    loadedFromDisk.schemaVersion !== LOADED_LEDGER_SCHEMA ||
    loadedFromDisk.productionOrigin !== PRODUCTION_ORIGIN ||
    loadedFromDisk.fixtureUsed !== false ||
    loadedFromDisk.taskId !== binding.taskId ||
    loadedFromDisk.taskMarkerSha256 !== retainedBinding("marker", binding.marker) ||
    loadedFromDisk.sessionBindingSha256 !== retainedBinding("session", binding.sessionId) ||
    loadedFromDisk.generation !== binding.generation ||
    loadedFromDisk.sourceCommit !== binding.sourceCommit ||
    loadedFromDisk.sourceTreeSha256 !== source.sourceTreeSha256 ||
    loadedFromDisk.sourceDirty !== source.sourceDirty ||
    loadedFromDisk.project?.id !== projectId ||
    loadedFromDisk.project?.sha256 !== sha256File(binding.project) ||
    loadedFromDisk.manifest?.sha256 !== sha256File(manifestPath) ||
    loadedFromDisk.package?.id !== "UAgentAssetTools" ||
    loadedFromDisk.package?.artifactCount !== packageArtifacts.length ||
    loadedFromDisk.package?.sha256 !== sha256(Buffer.from(stable(packageArtifacts), "utf8")) ||
    loadedFromDisk.installedRoot?.id !== "UAgentAssetTools" ||
    loadedFromDisk.installedRoot?.artifactCount !== installedArtifacts.length ||
    loadedFromDisk.installedRoot?.sha256 !==
      sha256(Buffer.from(stable(installedArtifacts), "utf8")) ||
    loadedFromDisk.process?.pidBindingSha256 !== retainedBinding("pid", earlyIdentity.rootPid) ||
    loadedFromDisk.process?.creationFileTimeUtcBindingSha256 !==
      retainedBinding("creation-filetime", earlyIdentity.rootCreationFileTimeUtc) ||
    loadedFromDisk.process?.executableBasename !== basename(executable) ||
    loadedFromDisk.process?.executableSha256 !== executableSha256 ||
    !Array.isArray(loadedFromDisk.modules) ||
    loadedFromDisk.modules.length !== packageModules.length ||
    loadedFromDisk.authority?.schemaVersion !==
      "uagent.mvp15d.loaded-module-production-authority.v1" ||
    !/^[0-9a-f]{64}$/.test(loadedFromDisk.authority?.processIdentitySha256) ||
    !/^[0-9a-f]{64}$/.test(loadedFromDisk.authority?.bindingSha256)
  ) {
    fail("FINAL_LIVE_UE_LOADED_INVALID");
  }
  const loadedModules = loadedFromDisk.modules
    .map((record) => {
      if (
        !record ||
        typeof record !== "object" ||
        Array.isArray(record) ||
        typeof record.path !== "string" ||
        isAbsolute(record.path) ||
        record.path.includes("\\") ||
        record.path.split("/").some((part) => part === "" || part === "." || part === "..") ||
        typeof record.name !== "string" ||
        basename(record.path) !== record.name ||
        !Number.isSafeInteger(record.size) ||
        record.size < 1 ||
        !/^[0-9a-f]{64}$/.test(record.sha256)
      ) {
        fail("FINAL_LIVE_UE_LOADED_INVALID");
      }
      const path = requireFile(
        resolve(installedRoot, record.path.split("/").join("\\")),
        "FINAL_LIVE_UE_LOADED_INVALID",
      );
      if (
        !within(installedRoot, path) ||
        lstatSync(path).size !== record.size ||
        sha256File(path) !== record.sha256
      ) {
        fail("FINAL_LIVE_UE_LOADED_INVALID");
      }
      return { path: record.path, size: record.size, sha256: record.sha256 };
    })
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  if (stable(packageModules) !== stable(loadedModules)) {
    fail("FINAL_LIVE_UE_LOADED_INVALID");
  }
  const names = packageModules.map(({ path }) => basename(path));
  const moduleSetSha256 = sha256(Buffer.from(stable(packageModules), "utf8"));
  const loadedLedgerPath = resolve(binding.evidenceRoot, "captures", "loaded-modules.json");
  const loadedLedgerStats = lstatSync(loadedLedgerPath);
  const jobCloseoutStats = lstatSync(requireFile(jobCloseoutPath, "FINAL_LIVE_JOB_LEDGER_INVALID"));
  if (
    jobCloseout?.schemaVersion !== JOB_CLOSEOUT_SCHEMA ||
    jobCloseout.taskId !== binding.taskId ||
    jobCloseout.markerSha256 !== retainedBinding("marker", binding.marker) ||
    jobCloseout.sessionBindingSha256 !== retainedBinding("session", binding.sessionId) ||
    jobCloseout.generation !== binding.generation ||
    jobCloseout.rootPidBindingSha256 !== retainedBinding("pid", earlyIdentity.rootPid) ||
    jobCloseout.rootExitCode !== 0 ||
    jobCloseout.activeProcessZeroObserved !== true ||
    jobCloseout.finalResidualCount !== 0
  ) {
    fail("FINAL_LIVE_JOB_LEDGER_INVALID");
  }
  return {
    installedLoaded: { installed: names, loaded: names, manifest: names },
    projectSha256: sha256File(binding.project),
    manifestSha256: sha256File(manifestPath),
    packageModulesSha256: moduleSetSha256,
    installedModulesSha256: sha256(Buffer.from(stable(installedModules), "utf8")),
    loadedModulesSha256: sha256(Buffer.from(stable(loadedModules), "utf8")),
    executableSha256: loadedFromDisk.process.executableSha256,
    productionProvenance: {
      loadedLedger: {
        relativePath: "captures/loaded-modules.json",
        size: loadedLedgerStats.size,
        sha256: sha256File(loadedLedgerPath),
      },
      processIdentitySha256: loadedFromDisk.authority.processIdentitySha256,
      jobCloseout: {
        relativePath: "metadata/ue-automation.job-closeout.json",
        size: jobCloseoutStats.size,
        sha256: sha256File(jobCloseoutPath),
      },
      authorityBindingSha256: loadedFromDisk.authority.bindingSha256,
      taskId: binding.taskId,
      taskMarkerSha256: retainedBinding("marker", binding.marker),
      sessionBindingSha256: retainedBinding("session", binding.sessionId),
      generation: binding.generation,
      sourceCommit: loadedFromDisk.sourceCommit,
      sourceTreeSha256: loadedFromDisk.sourceTreeSha256,
      sourceDirty: loadedFromDisk.sourceDirty,
      process: ueProductionProcessProvenance(loadedFromDisk.process, earlyIdentity),
      projectSha256: loadedFromDisk.project.sha256,
      manifestSha256: loadedFromDisk.manifest.sha256,
      packageInventorySha256: loadedFromDisk.package.sha256,
      installedInventorySha256: loadedFromDisk.installedRoot.sha256,
      loadedModulesSha256: sha256(Buffer.from(stable(loadedModules), "utf8")),
      producerSources: loadedFromDisk.authority.sources,
    },
  };
}

async function waitForReadiness(path, binding, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const events = readRuntimeEvents(path, binding, true);
    if (events.some(({ type }) => type === "bridge_readiness")) return events;
    await delay(50);
  }
  fail("FINAL_LIVE_RUNTIME_READINESS_TIMEOUT");
}

function collectChildOutput(child) {
  const stdout = [];
  const stderr = [];
  child.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  return { stdout, stderr };
}

function waitForChild(child) {
  return new Promise((resolveChild) => {
    child.once("error", (error) => {
      resolveChild({
        pid: child.pid,
        status: null,
        signal: null,
        error,
        stdout: "",
        stderr: "",
      });
    });
    child.once("close", (status, signal) => {
      resolveChild({ pid: child.pid, status, signal, error: null, stdout: "", stderr: "" });
    });
  });
}

function windowsJobInvocation(command, binding, transport, timeoutMilliseconds) {
  const runner = requireFile(
    resolve(binding.repository, "scripts", "mvp15d-windows-job-process-runner.ps1"),
    "FINAL_LIVE_JOB_RUNNER_MISSING",
  );
  const encodedArguments = Buffer.from(JSON.stringify(command.args), "utf8").toString("base64");
  return {
    executable: "powershell.exe",
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      runner,
      "-Executable",
      command.executable,
      "-WorkingDirectory",
      binding.repository,
      "-ArgumentsBase64",
      encodedArguments,
      "-StdoutPath",
      transport.stdoutFile,
      "-StderrPath",
      transport.stderrFile,
      "-TaskMarker",
      binding.marker,
      "-IdentityPath",
      transport.identityFile,
      "-Session",
      binding.sessionId,
      "-Generation",
      String(binding.generation),
      "-TimeoutMilliseconds",
      String(timeoutMilliseconds),
    ],
  };
}

function spawnOwned(command, binding, transport, timeoutMilliseconds) {
  const invocation =
    process.platform === "win32"
      ? windowsJobInvocation(command, binding, transport, timeoutMilliseconds)
      : { executable: command.executable, args: command.args };
  const child = spawn(invocation.executable, invocation.args, {
    cwd: binding.repository,
    shell: false,
    windowsHide: true,
    env: command.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { child, output: collectChildOutput(child) };
}

async function awaitOwnedCloseout(owned, binding) {
  const { child, output } = owned;
  const result = await waitForChild(child);
  result.stdout = Buffer.concat(output.stdout).toString("utf8");
  result.stderr = Buffer.concat(output.stderr).toString("utf8");
  if (process.platform === "win32" && result.status === 0) {
    let ledger;
    try {
      ledger = JSON.parse(result.stdout.trim());
    } catch {
      fail("FINAL_LIVE_JOB_LEDGER_INVALID");
    }
    if (
      ledger?.SchemaVersion !== "uagent.mvp15d.windows-job-process-run.v1" ||
      ledger.TaskMarker !== binding.marker ||
      ledger.FailureCode ||
      ledger.TimedOut !== false ||
      ledger.ActiveProcessZeroObserved !== true ||
      ledger.FinalResidualCount !== 0 ||
      !Number.isSafeInteger(ledger.RootPid) ||
      ledger.RootPid < 1
    ) {
      fail("FINAL_LIVE_JOB_LEDGER_INVALID");
    }
    result.runtimePid = ledger.RootPid;
    result.jobLedger = ledger;
    result.runtimeExitCode = ledger.RootExitCode;
  } else {
    result.runtimePid = child.pid;
    result.runtimeExitCode = result.status;
    result.jobLedger = null;
  }
  return result;
}

function publishJobCloseout(path, binding, ledger) {
  if (
    !ledger ||
    ledger.SchemaVersion !== "uagent.mvp15d.windows-job-process-run.v1" ||
    ledger.TaskMarker !== binding.marker ||
    ledger.FailureCode !== "" ||
    ledger.TimedOut !== false ||
    ledger.ActiveProcessZeroObserved !== true ||
    ledger.FinalResidualCount !== 0 ||
    !Number.isSafeInteger(ledger.RootPid) ||
    ledger.RootPid < 1 ||
    ledger.RootExitCode !== 0
  ) {
    fail("FINAL_LIVE_JOB_LEDGER_INVALID");
  }
  const value = {
    schemaVersion: JOB_CLOSEOUT_SCHEMA,
    taskId: binding.taskId,
    markerSha256: retainedBinding("marker", binding.marker),
    sessionBindingSha256: retainedBinding("session", binding.sessionId),
    generation: binding.generation,
    jobSchemaVersion: ledger.SchemaVersion,
    rootPidBindingSha256: retainedBinding("pid", ledger.RootPid),
    rootExitCode: ledger.RootExitCode,
    timedOut: ledger.TimedOut,
    activeProcessZeroObserved: ledger.ActiveProcessZeroObserved,
    finalResidualCount: ledger.FinalResidualCount,
    failureCode: ledger.FailureCode,
  };
  const descriptorHandle = openSync(path, "wx");
  try {
    writeFileSync(descriptorHandle, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fsyncSync(descriptorHandle);
  } finally {
    closeSync(descriptorHandle);
  }
  return value;
}

function loopbackPortAccepting(port, timeoutMilliseconds = 250) {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const settle = (accepting) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolvePromise(accepting);
    };
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
    socket.setTimeout(timeoutMilliseconds, () => settle(false));
  });
}

async function publishPortCloseout(path, binding) {
  const observations = [];
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const accepting = await loopbackPortAccepting(binding.port);
    observations.push({ attempt, accepting });
    if (accepting) await delay(100);
  }
  if (observations.some(({ accepting }) => accepting)) {
    fail("FINAL_LIVE_PORT_RESIDUAL");
  }
  const value = {
    schemaVersion: PORT_CLOSEOUT_SCHEMA,
    phase: binding.phase,
    taskId: binding.taskId,
    markerSha256: retainedBinding("marker", binding.marker),
    sessionBindingSha256: retainedBinding("session", binding.sessionId),
    generation: binding.generation,
    portBindingSha256: retainedBinding("port", binding.port),
    observations,
    residualCount: 0,
  };
  const descriptorHandle = openSync(path, "wx");
  try {
    writeFileSync(descriptorHandle, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fsyncSync(descriptorHandle);
  } finally {
    closeSync(descriptorHandle);
  }
  return value;
}

function fixedArtifactAuthority(binding, runtimeProcessId) {
  const { packageRoot, installedRoot, manifestPath, manifest } = resolveUeArtifacts(binding);
  const packageModules = manifest.modules
    .map((record) => moduleRecord(packageRoot, record, "FINAL_LIVE_FIXED_ARTIFACT_INVALID"))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  const installedModules = manifest.modules
    .map((record) => moduleRecord(installedRoot, record, "FINAL_LIVE_FIXED_ARTIFACT_INVALID"))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  if (stable(packageModules) !== stable(installedModules)) {
    fail("FINAL_LIVE_FIXED_ARTIFACT_INVALID");
  }
  const packageArtifacts = manifest.artifacts
    .map((record) => moduleRecord(packageRoot, record, "FINAL_LIVE_FIXED_ARTIFACT_INVALID"))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  const installedArtifacts = manifest.artifacts
    .map((record) => moduleRecord(installedRoot, record, "FINAL_LIVE_FIXED_ARTIFACT_INVALID"))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  if (stable(packageArtifacts) !== stable(installedArtifacts)) {
    fail("FINAL_LIVE_FIXED_ARTIFACT_INVALID");
  }
  const loadedLedgerPath = resolve(binding.evidenceRoot, "captures", "loaded-modules.json");
  const loaded = readJson(loadedLedgerPath, "FINAL_LIVE_FIXED_ARTIFACT_INVALID");
  const source = computeSourceIdentity(binding.repository);
  if (
    loaded.schemaVersion !== LOADED_LEDGER_SCHEMA ||
    loaded.productionOrigin !== PRODUCTION_ORIGIN ||
    loaded.fixtureUsed !== false ||
    loaded.taskId !== binding.taskId ||
    loaded.taskMarkerSha256 !== retainedBinding("marker", binding.marker) ||
    loaded.sessionBindingSha256 !== retainedBinding("session", binding.sessionId) ||
    loaded.generation !== binding.generation ||
    loaded.sourceCommit !== binding.sourceCommit ||
    loaded.sourceTreeSha256 !== source.sourceTreeSha256 ||
    loaded.manifest?.sha256 !== sha256File(manifestPath) ||
    loaded.package?.sha256 !== sha256(Buffer.from(stable(packageArtifacts), "utf8")) ||
    loaded.installedRoot?.sha256 !== sha256(Buffer.from(stable(installedArtifacts), "utf8")) ||
    !Array.isArray(loaded.modules) ||
    loaded.modules.length !== packageModules.length ||
    !/^[0-9a-f]{64}$/.test(loaded.authority?.bindingSha256)
  ) {
    fail("FINAL_LIVE_FIXED_ARTIFACT_INVALID");
  }
  const loadedModules = loaded.modules
    .map((record) => {
      if (
        !record ||
        typeof record !== "object" ||
        Array.isArray(record) ||
        typeof record.path !== "string" ||
        isAbsolute(record.path) ||
        record.path.includes("\\") ||
        record.path.split("/").some((part) => part === "" || part === "." || part === "..") ||
        !Number.isSafeInteger(record.size) ||
        record.size < 1 ||
        !/^[0-9a-f]{64}$/.test(record.sha256)
      ) {
        fail("FINAL_LIVE_FIXED_ARTIFACT_INVALID");
      }
      const modulePath = requireFile(
        resolve(installedRoot, record.path.split("/").join("\\")),
        "FINAL_LIVE_FIXED_ARTIFACT_INVALID",
      );
      if (
        !within(installedRoot, modulePath) ||
        lstatSync(modulePath).size !== record.size ||
        sha256File(modulePath) !== record.sha256
      ) {
        fail("FINAL_LIVE_FIXED_ARTIFACT_INVALID");
      }
      return { path: record.path, size: record.size, sha256: record.sha256 };
    })
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  if (stable(loadedModules) !== stable(packageModules)) {
    fail("FINAL_LIVE_FIXED_ARTIFACT_INVALID");
  }
  const modules = packageModules.map(({ path, sha256: moduleSha256 }) => ({
    relativePath: path,
    sha256: moduleSha256,
  }));
  const modulesSha256 = sha256(Buffer.from(stable(modules), "utf8"));
  const material = {
    sourceCommit: loaded.sourceCommit,
    sourceTreeSha256: loaded.sourceTreeSha256,
    phaseSessionBindingSha256: retainedBinding("session", binding.sessionId),
    phaseGeneration: binding.generation,
    runtimeProcessIdBindingSha256: retainedBinding("process-id", runtimeProcessId),
    manifest: { sha256: sha256File(manifestPath), modulesSha256 },
    packageInventory: { sha256: loaded.package.sha256, modulesSha256 },
    installedInventory: { sha256: loaded.installedRoot.sha256, modulesSha256 },
    loadedObserver: { ledgerSha256: sha256File(loadedLedgerPath), modulesSha256 },
    modules,
  };
  return {
    authorityLevel: "fixed_producer",
    ...material,
    producerBindingSha256: sha256(Buffer.from(stable(material), "utf8")),
  };
}

async function launchOwned(command, binding, transport, timeoutMilliseconds) {
  const owned = spawnOwned(command, binding, transport, timeoutMilliseconds);
  if (process.platform === "win32") {
    const isClosed = () => owned.child.exitCode !== null || owned.child.signalCode !== null;
    await waitForEarlyIdentity(binding, transport, command, 45_000, isClosed);
  }
  return awaitOwnedCloseout(owned, binding);
}

function runtimeIdentity(events, command, binding, runtimePid) {
  const matches = events.filter(({ type }) => type === "runtime_process_identity");
  if (matches.length !== 1) fail("FINAL_LIVE_RUNTIME_IDENTITY_INVALID");
  const data = matches[0].data;
  if (
    data.taskId !== binding.taskId ||
    data.sourceCommit !== binding.sourceCommit ||
    data.markerSha256 !== retainedBinding("marker", binding.marker) ||
    data.sessionBindingSha256 !== retainedBinding("session", binding.sessionId) ||
    data.generation !== binding.generation ||
    data.portBindingSha256 !== retainedBinding("port", binding.port) ||
    data.bridgeVersion !== BRIDGE_VERSION ||
    data.endpointSha256 !== retainedBinding("endpoint", binding.endpoint) ||
    !/^[0-9a-f]{64}$/.test(data.nonceSha256) ||
    data.process?.pidBindingSha256 !== retainedBinding("pid", runtimePid) ||
    data.process.executableBasename !== basename(command.executable) ||
    data.process.executableSha256 !== sha256File(command.executable)
  ) {
    fail("FINAL_LIVE_RUNTIME_IDENTITY_INVALID");
  }
  return data;
}

// Bind the compiled binary's honest source identity to the capability result.
// Reads the runtime_process_identity event's source fields and rejects any
// binary that claims to be clean while the current task source tree is dirty.
function bindSourceIdentity(events, binding) {
  const matches = events.filter(({ type }) => type === "runtime_process_identity");
  if (matches.length !== 1) fail("FINAL_LIVE_RUNTIME_IDENTITY_INVALID");
  const data = matches[0].data;
  if (typeof data.sourceTreeSha256 !== "string" || !/^[0-9a-f]{64}$/.test(data.sourceTreeSha256)) {
    fail("FINAL_LIVE_SOURCE_TREE_SHA_INVALID");
  }
  if (typeof data.sourceDirty !== "boolean") fail("FINAL_LIVE_SOURCE_DIRTY_INVALID");
  const current = computeSourceIdentity(binding.repository);
  if (data.sourceDirty === false && current.sourceDirty === true) {
    // The dirty pre-checkpoint tree cannot claim its compiled HEAD contains the
    // task diff.
    fail("FINAL_LIVE_SOURCE_DIRTY_REJECTED");
  }
  return {
    sourceCommit: data.sourceCommit,
    sourceTreeSha256: data.sourceTreeSha256,
    sourceDirty: data.sourceDirty,
    sourceHeadRef: typeof data.sourceHeadRef === "string" ? data.sourceHeadRef : "HEAD",
  };
}

function capabilityFacts(events, rendered) {
  const matches = events.filter(({ type }) => type === "capability_handshake");
  if (matches.length !== 1) fail("FINAL_LIVE_CAPABILITY_HANDSHAKE_INVALID");
  const data = matches[0].data;
  if (
    data.bridgeVersion !== BRIDGE_VERSION ||
    data.mode !== "capability-only" ||
    data.rendererStarted !== rendered ||
    data.mcpCalls !== 0 ||
    data.networkCalls !== 0 ||
    data.assetOperations !== 0
  ) {
    fail("FINAL_LIVE_CAPABILITY_HANDSHAKE_INVALID");
  }
  return {
    mcpCalls: data.mcpCalls,
    networkCalls: data.networkCalls,
    assetOperations: data.assetOperations,
    rendererStarted: data.rendererStarted,
  };
}

function cleanupTransport(transport, removeEvents, preserveEarlyIdentity = false) {
  for (const path of [
    transport.nonceFile,
    transport.driverFile,
    ...(preserveEarlyIdentity ? [] : [transport.identityFile]),
    `${transport.identityFile}.tmp`,
    transport.stdoutFile,
    transport.stderrFile,
    ...(removeEvents ? [transport.eventFile] : []),
  ]) {
    rmSync(path, { force: true });
  }
}

async function runRuntimeCapabilityHandshake(options) {
  const phase = options.phase;
  if (!["capability-probe", "product-capture", "ui-lifecycle"].includes(phase)) {
    fail("FINAL_LIVE_CAPABILITY_PHASE_INVALID");
  }
  const args = {
    repository: options.repository,
    "evidence-root": options.evidenceRoot,
    "task-id": options.taskId,
    "task-generation": TASK_GENERATION,
    "source-commit": options.sourceCommit,
    marker: options.marker,
    session: options.session,
    endpoint: options.endpoint,
    generation: String(options.generation),
    port: String(options.port),
  };
  const binding = validateCommonBinding(phase, args, false);
  const transport = bridgeTransport(binding, "capability-only");
  const command = desktopRuntimeCommand(binding, transport);
  let result;
  try {
    const launched = launchOwned(
      command,
      binding,
      transport,
      Number(options.timeoutMilliseconds ?? 30_000),
    );
    if (phase !== "capability-probe") {
      await waitForReadiness(transport.eventFile, binding, 10_000);
      writeDriver(transport.driverFile, binding, transport.nonceSha256, "capability-handshake");
    }
    result = await launched;
    if (
      result.error ||
      result.status !== 0 ||
      result.runtimeExitCode !== 0 ||
      !Number.isSafeInteger(result.runtimePid)
    ) {
      fail("FINAL_LIVE_RUNTIME_NONZERO");
    }
    const events = parseRuntimeEvents(readRuntimeEvents(transport.eventFile, binding), binding);
    const identity = runtimeIdentity(events, command, binding, result.runtimePid);
    if (
      identity.nonceSha256 !== transport.nonceSha256 ||
      identity.process.pidBindingSha256 !== retainedBinding("pid", result.runtimePid)
    ) {
      fail("FINAL_LIVE_RUNTIME_IDENTITY_INVALID");
    }
    const facts = capabilityFacts(events, phase !== "capability-probe");
    const sourceIdentity = bindSourceIdentity(events, binding);
    const eventDescriptor = descriptor(transport.eventFile);
    const closeout = events.at(-1).data;
    if (
      stable(closeout) !==
      stable({
        authorityLevel: "runtime_observed",
        rendererCompleted: true,
        driverCommandConsumed: true,
      })
    ) {
      fail("FINAL_LIVE_RUNTIME_CLOSEOUT_INVALID");
    }
    const output = {
      status: "runtime_capability_verified",
      phase,
      bridgeVersion: BRIDGE_VERSION,
      eventFile: eventDescriptor,
      eventCount: events.length,
      runtimePid: result.runtimePid,
      runtimeExecutable: descriptor(command.executable),
      processCloseout: {
        exitCode: result.runtimeExitCode,
        jobOwned: process.platform === "win32",
        residualCount: result.jobLedger?.FinalResidualCount ?? 0,
      },
      nonceSha256: transport.nonceSha256,
      sourceCommit: sourceIdentity.sourceCommit,
      sourceTreeSha256: sourceIdentity.sourceTreeSha256,
      sourceDirty: sourceIdentity.sourceDirty,
      sourceHeadRef: sourceIdentity.sourceHeadRef,
      ...facts,
    };
    cleanupTransport(transport, options.retainEventFile !== true);
    return output;
  } catch (error) {
    cleanupTransport(transport, false);
    throw error;
  }
}

function parseOfficialAutomationReport(reportDirectory, binding) {
  const reportPathCandidates = [
    resolve(reportDirectory, "index.json"),
    resolve(reportDirectory, "Index.json"),
  ];
  const reportPath = reportPathCandidates.find(existsSync);
  if (!reportPath) fail("FINAL_LIVE_UE_REPORT_MISSING");
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    fail("FINAL_LIVE_UE_REPORT_INVALID");
  }
  const tests = Array.isArray(report.tests)
    ? report.tests
    : Array.isArray(report.results)
      ? report.results
      : [];
  const flattened = [];
  const visit = (entries) => {
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const fullName = entry.fullTestPath ?? entry.fullName ?? entry.testDisplayName ?? entry.name;
      const state = String(entry.state ?? entry.status ?? entry.result ?? "").toLowerCase();
      if (typeof fullName === "string") flattened.push({ name: fullName, status: state });
      if (Array.isArray(entry.children)) visit(entry.children);
      if (Array.isArray(entry.tests)) visit(entry.tests);
    }
  };
  visit(tests);
  const matrix = UE_AUTOMATION_TESTS.map((name) => {
    const matches = flattened.filter(({ name: observed }) => observed === name);
    if (matches.length !== 1) fail("FINAL_LIVE_UE_REPORT_MATRIX_INVALID");
    const rawStatus = matches[0].status;
    const status = ["success", "passed", "pass"].includes(rawStatus)
      ? "passed"
      : ["failed", "fail", "error"].includes(rawStatus)
        ? "failed"
        : ["skipped", "skip", "notrun", "not_run"].includes(rawStatus)
          ? "skipped"
          : null;
    if (!status) fail("FINAL_LIVE_UE_REPORT_MATRIX_INVALID");
    return { name, status };
  });
  const summary = {
    expected: matrix.length,
    passed: matrix.filter(({ status }) => status === "passed").length,
    failed: matrix.filter(({ status }) => status === "failed").length,
    skipped: matrix.filter(({ status }) => status === "skipped").length,
  };
  if (
    summary.expected !== UE_AUTOMATION_TESTS.length ||
    summary.passed !== summary.expected ||
    summary.failed !== 0 ||
    summary.skipped !== 0
  ) {
    fail("FINAL_LIVE_UE_REPORT_MATRIX_INVALID");
  }
  const reportBytes = readFileSync(reportPath);
  return {
    reportPath,
    reportSha256: sha256(reportBytes),
    matrix,
    summary,
    taskBindingSha256: sha256(
      Buffer.from(
        stable({
          taskId: binding.taskId,
          sourceCommit: binding.sourceCommit,
          marker: binding.marker,
          session: binding.sessionId,
          generation: binding.generation,
        }),
        "utf8",
      ),
    ),
  };
}

function emitRuntimeEventFile(path, binding, events) {
  const descriptor = openSync(path, "wx");
  try {
    for (const event of events) {
      writeFileSync(
        descriptor,
        `${JSON.stringify({
          schemaVersion: RUNTIME_EVENT_SCHEMA,
          phase: binding.phase,
          type: event.type,
          data: retainedEventValue(event.data),
        })}\n`,
        "utf8",
      );
    }
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function emitPhaseEvents(
  binding,
  command,
  result,
  runtimeEvents,
  transport = null,
  fixedAuthority = null,
  parentCloseout = null,
) {
  const producerId = `mvp15d-final-${binding.phase}-producer`;
  let sequence = 0;
  let timestamp = Date.now();
  const output = [];
  const emit = (type, data) => {
    sequence += 1;
    timestamp += 1;
    output.push(
      JSON.stringify({
        schemaVersion: PHASE_EVENT_SCHEMA,
        phase: binding.phase,
        taskId: binding.taskId,
        markerSha256: retainedBinding("marker", binding.marker),
        sessionBindingSha256: retainedBinding("session", binding.sessionId),
        generation: binding.generation,
        producer: {
          id: producerId,
          processIdBindingSha256: retainedBinding("process-id", process.pid),
          mode: "live",
        },
        sequence,
        capturedAt: new Date(timestamp).toISOString(),
        type,
        data: retainedEventValue(data),
      }),
    );
  };
  emit("process_started", {
    portBindingSha256: retainedBinding("port", binding.port),
    argumentVectorSha256: sha256(Buffer.from(stable(binding.adapterArgumentVector), "utf8")),
  });
  emit("runtime_process_started", {
    processIdBindingSha256: retainedBinding("process-id", result.runtimePid ?? result.pid),
    endpointSha256: retainedBinding("endpoint", binding.endpoint),
    markerSha256: retainedBinding("marker", binding.marker),
    executable: descriptor(command.executable),
    argumentVectorSha256: sha256(Buffer.from(stable(command.args), "utf8")),
  });
  emit("evidence_origin", { origin: "live_runtime", fixtureUsed: false });
  if (transport) {
    const eventFile = descriptor(transport.eventFile);
    emit("runtime_event_transport", {
      bridgeVersion:
        binding.phase === "ue-automation" ? UE_AUTOMATION_REPORT_SCHEMA : BRIDGE_VERSION,
      eventFile: {
        relativePath: `transcripts/${binding.phase}.runtime-events.jsonl`,
        size: eventFile.size,
        sha256: eventFile.sha256,
      },
      nonceSha256: transport.nonceSha256,
      asynchronous: binding.phase !== "ue-automation",
      jobOwned: process.platform === "win32",
    });
  }
  if (fixedAuthority) emit("fixed_artifact_authority", fixedAuthority);
  for (const event of runtimeEvents) {
    if (
      ![
        "closeout",
        "evidence_origin",
        "runtime_process_identity",
        "bridge_readiness",
        "capability_handshake",
      ].includes(event.type)
    ) {
      emit(event.type, event.data);
    }
  }
  emit("process_exited", { exitCode: result.runtimeExitCode ?? result.status });
  const closeoutData = parentCloseout ?? {
    authorityLevel: "parent_observed",
    processResidualCount: 0,
    portResidualCount: 0,
    markerResidualCount: 0,
    partialOutputCount: 0,
    jobCloseoutSha256: "0".repeat(64),
    portObservationSha256: "0".repeat(64),
    runtimeProcessIdBindingSha256: retainedBinding("process-id", result.runtimePid ?? result.pid),
    phaseSessionBindingSha256: retainedBinding("session", binding.sessionId),
    phaseGeneration: binding.generation,
  };
  emit("closeout", closeoutData);
  process.stdout.write(`${output.join("\n")}\n`);
  return output.length;
}

function runSyntheticProducer(phase, argv, options) {
  const binding = validateBinding(phase, argv);
  const command = runtimeCommand(binding);
  const result = options.launch(command.executable, command.args, {
    cwd: binding.repository,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    env: process.env,
  });
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0 || !Number.isSafeInteger(result.pid)) {
    fail("FINAL_LIVE_RUNTIME_NONZERO");
  }
  const runtimeEvents = parseRuntimeEvents(result.stdout, binding);
  for (const event of runtimeEvents) {
    if (event.type !== "evidence_origin" && event.type !== "closeout") {
      event.data = { ...event.data, authorityLevel: "source_only" };
    }
  }
  const eventCount = emitPhaseEvents(
    binding,
    command,
    { ...result, runtimePid: result.pid, runtimeExitCode: result.status },
    runtimeEvents,
  );
  return {
    status: "synthetic_test_events_emitted",
    phase,
    eventCount,
    runtimePid: result.pid,
    testOnlySynthetic: true,
  };
}

async function runRealLiveProducer(phase, argv) {
  const binding = validateBinding(phase, argv);
  if (phase === "ui-lifecycle") validateProjectSeed(binding.project);
  const transport = bridgeTransport(binding, "live");
  const command = runtimeCommand(binding, transport);
  const contentBefore = phase === "ue-automation" ? contentTreeSha256(binding.project) : null;
  const owned = spawnOwned(command, binding, transport, LIVE_PROCESS_TIMEOUT_MILLISECONDS);
  const closeout = awaitOwnedCloseout(owned, binding);
  const isClosed = () => owned.child.exitCode !== null || owned.child.signalCode !== null;
  let runtimeEvents;
  let result;
  let logsEmitted = false;
  let closeoutAwaited = false;
  let earlyIdentity = null;
  let observation = null;
  try {
    if (phase === "ue-automation") {
      // R6.1: obtain and validate the root process identity before the process
      // exits, then observe the approved companion modules while it is live.
      earlyIdentity = await waitForEarlyIdentity(binding, transport, command, 45_000, isClosed);
      const { packageRoot, installedRoot, manifest } = resolveUeArtifacts(binding);
      const liveObservation = await observeLiveCompanionModules(
        binding,
        earlyIdentity,
        installedRoot,
        manifest.modules,
        isClosed,
        { timeoutMilliseconds: 90_000 },
      );
      observation = liveObservation.observation;
      ensureLoadedModuleLedger(
        binding,
        packageRoot,
        installedRoot,
        manifest,
        earlyIdentity,
        transport.identityFile,
        observation,
        command.executable,
      );
    }
    if (phase === "product-capture" || phase === "ui-lifecycle") {
      await waitForReadiness(transport.eventFile, binding, 30_000);
      writeDriver(
        transport.driverFile,
        binding,
        transport.nonceSha256,
        phase === "product-capture" ? "run-product-capture" : "run-ui-lifecycle",
      );
    }
    result = await closeout;
    closeoutAwaited = true;
    emitRedactedRuntimeLogs(transport, binding);
    logsEmitted = true;
    if (result.error || result.status !== 0 || (result.runtimeExitCode ?? result.status) !== 0) {
      fail("FINAL_LIVE_RUNTIME_NONZERO");
    }
    const jobCloseout = publishJobCloseout(transport.jobCloseoutFile, binding, result.jobLedger);
    const portCloseout = await publishPortCloseout(transport.portCloseoutFile, binding);
    if (phase === "ue-automation") {
      if (
        earlyIdentity === null ||
        observation === null ||
        result.runtimePid !== earlyIdentity.rootPid
      ) {
        fail("FINAL_LIVE_UE_LOADED_INVALID");
      }
      const report = parseOfficialAutomationReport(command.reportDirectory, binding);
      const contentAfter = contentTreeSha256(binding.project);
      if (contentBefore !== contentAfter) fail("FINAL_LIVE_UE_CONTENT_CHANGED");
      const artifacts = ueArtifactBinding(
        binding,
        earlyIdentity,
        command.executable,
        transport.jobCloseoutFile,
        jobCloseout,
      );
      runtimeEvents = [
        { type: "evidence_origin", data: { origin: "production_runtime", fixtureUsed: false } },
        {
          type: "runtime_process_identity",
          data: {
            bridgeVersion: UE_AUTOMATION_REPORT_SCHEMA,
            taskId: binding.taskId,
            sourceCommit: binding.sourceCommit,
            marker: binding.marker,
            session: binding.sessionId,
            generation: binding.generation,
            endpointSha256: retainedBinding("endpoint", binding.endpoint),
            port: binding.port,
            nonceSha256: transport.nonceSha256,
            process: {
              pid: earlyIdentity.rootPid,
              executableBasename: basename(command.executable),
              executableSha256: artifacts.executableSha256,
            },
          },
        },
        {
          type: "automation_report_binding",
          data: {
            reportSha256: report.reportSha256,
            taskBindingSha256: report.taskBindingSha256,
            projectSha256: artifacts.projectSha256,
            manifestSha256: artifacts.manifestSha256,
            packageModulesSha256: artifacts.packageModulesSha256,
            installedModulesSha256: artifacts.installedModulesSha256,
            loadedModulesSha256: artifacts.loadedModulesSha256,
            executableSha256: artifacts.executableSha256,
            processId: earlyIdentity.rootPid,
          },
        },
        { type: "production_provenance", data: artifacts.productionProvenance },
        { type: "installed_loaded", data: artifacts.installedLoaded },
        { type: "automation_summary", data: report.summary },
        ...report.matrix.map((data) => ({ type: "automation_test", data })),
        { type: "content_snapshot", data: { stage: "before", sha256: contentBefore } },
        { type: "mutation_observed", data: { count: 0 } },
        { type: "content_snapshot", data: { stage: "after", sha256: contentAfter } },
        {
          type: "closeout",
          data: {
            processResidualCount: result.jobLedger?.FinalResidualCount ?? 0,
            portResidualCount: 0,
            markerResidualCount: 0,
            nonceResidualCount: 0,
            driverResidualCount: 0,
            partialOutputCount: 0,
          },
        },
      ];
      emitRuntimeEventFile(transport.eventFile, binding, runtimeEvents);
    } else {
      runtimeEvents = parseRuntimeEvents(readRuntimeEvents(transport.eventFile, binding), binding);
      runtimeIdentity(runtimeEvents, command, binding, result.runtimePid);
    }
    const fixedAuthority =
      phase === "product-capture" || phase === "ui-lifecycle"
        ? fixedArtifactAuthority(binding, result.runtimePid)
        : null;
    const parentCloseout = {
      authorityLevel: "parent_observed",
      processResidualCount: result.jobLedger.FinalResidualCount,
      portResidualCount: portCloseout.residualCount,
      markerResidualCount: 0,
      partialOutputCount: 0,
      jobCloseoutSha256: sha256File(transport.jobCloseoutFile),
      portObservationSha256: sha256File(transport.portCloseoutFile),
      runtimeProcessIdBindingSha256: retainedBinding("process-id", result.runtimePid),
      phaseSessionBindingSha256: retainedBinding("session", binding.sessionId),
      phaseGeneration: binding.generation,
    };
    const eventCount = emitPhaseEvents(
      binding,
      command,
      result,
      runtimeEvents,
      transport,
      fixedAuthority,
      parentCloseout,
    );
    cleanupTransport(transport, false, phase === "ue-automation");
    return {
      status: "live_events_emitted",
      phase,
      eventCount,
      runtimePid: result.runtimePid,
      eventFile: descriptor(transport.eventFile),
      asynchronous: true,
      jobOwned: process.platform === "win32",
    };
  } catch (error) {
    if (!closeoutAwaited) {
      try {
        await closeout;
      } catch {
        // The closeout promise is settled; the original error is rethrown.
      }
    }
    if (!logsEmitted) emitRedactedRuntimeLogs(transport, binding);
    cleanupTransport(transport, false);
    throw error;
  }
}

function runLiveProducer(phase, argv, options = {}) {
  if (typeof options.launch === "function") {
    return runSyntheticProducer(phase, argv, options);
  }
  return runRealLiveProducer(phase, argv);
}

async function liveProducerMain(phase, argv = process.argv.slice(2)) {
  try {
    await runLiveProducer(phase, argv);
  } catch (error) {
    const reason =
      error instanceof LiveProducerError
        ? error.code
        : (error?.code ?? "FINAL_LIVE_PRODUCER_FAILED");
    process.stderr.write(`${JSON.stringify({ status: "live_producer_rejected", reason })}\n`);
    process.exitCode = 2;
  }
}

export {
  BRIDGE_VERSION,
  DRIVER_SCHEMA,
  LIVE_PROCESS_TIMEOUT_MILLISECONDS,
  LiveProducerError,
  PHASE_EVENT_SCHEMA,
  RUNTIME_EVENT_SCHEMA,
  TASK_GENERATION,
  liveProducerMain,
  parseOfficialAutomationReport,
  parseOrderedArgs,
  parseRuntimeEvents,
  retainedEventValue,
  runLiveProducer,
  runRuntimeCapabilityHandshake,
  runtimeCommand,
  ueProductionProcessProvenance,
  validateBinding,
};
