#!/usr/bin/env node
/* global console, process */

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { collectPackageArtifacts, create, verify } from "./mvp15d-manifest.mjs";
import { runBuild, stable } from "./mvp15d-plugin-build.mjs";
import {
  EARLY_IDENTITY_SCHEMA,
  LOADED_LEDGER_SCHEMA,
  PRODUCTION_AUTHORITY_SCHEMA,
  PRODUCTION_ORIGIN,
} from "./mvp15d-loaded-module-observer.mjs";
import { computeSourceIdentity } from "./mvp15d-source-identity.mjs";

const TASK_GENERATION = "final-d13-d16";
const DEFAULT_TASK_ID = "TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-FINAL-D13-D16";
const ROOT_PATTERN = /^mvp15d-final-d13-d16-\d{8}_\d{6}(?:-[A-Za-z0-9]+)?$/;
const TOOL_NAMES = [
  "ue.asset.create_folder",
  "ue.asset.duplicate",
  "ue.asset.rename",
  "ue.asset.move",
  "ue.asset.delete",
  "ue.asset.save",
];
const FORWARD_ORDER = [
  "create_run_root",
  "duplicate_test01",
  "rename_duplicate",
  "move_duplicate",
  "save_one_package",
];
const INVERSE_ORDER = ["move_back", "rename_back", "delete_duplicate", "cleanup_empty_folder"];
const UE_AUTOMATION_TESTS = [
  "UAgentAssetTools.Contracts",
  "UAgentAssetTools.ReadOnly",
  "UAgentAssetTools.Closeout",
];
const PRODUCT_SCHEMA = "uagent.mvp15d.final.product-capture.v1";
const UI_SCHEMA = "uagent.mvp15d.final.ui-lifecycle.v1";
const UE_SCHEMA = "uagent.mvp15d.final.ue-automation.v1";
const INVENTORY_SCHEMA = "uagent.mvp15d.final.inventory.v1";
const CLOSEOUT_SCHEMA = "uagent.mvp15d.final.closeout.v1";
const EVENT_SCHEMA = "uagent.mvp15d.final.phase-event.v1";
const RUNTIME_EVENT_SCHEMA = "uagent.mvp15d.final.runtime-event.v1";
const PRODUCER_LEDGER_SCHEMA = "uagent.mvp15d.final.producer-ledger.v1";
const FIXTURE_PRODUCER_ID = "mvp15d-final-phase-fixture-producer";
const FIRST_FAILURE_SCHEMA = "uagent.mvp15d.final.first-failure.v1";
const JOB_CLOSEOUT_SCHEMA = "uagent.mvp15d.final.job-closeout.v1";
const LIVE_PRODUCER_HELPER = Object.freeze({
  relativePath: "scripts/mvp15d-final-live-producer-helper.mjs",
});
const LIVE_PRODUCERS = Object.freeze({
  "ue-automation": Object.freeze({
    id: "mvp15d-final-ue-automation-producer",
    relativePath: "scripts/mvp15d-final-ue-automation-producer.mjs",
  }),
  "product-capture": Object.freeze({
    id: "mvp15d-final-product-capture-producer",
    relativePath: "scripts/mvp15d-final-product-capture-producer.mjs",
  }),
  "ui-lifecycle": Object.freeze({
    id: "mvp15d-final-ui-lifecycle-producer",
    relativePath: "scripts/mvp15d-final-ui-lifecycle-producer.mjs",
  }),
});
const ALLOWED_TOP_LEVEL = new Set([
  "captures",
  "logs",
  "metadata",
  "package",
  "project",
  "summaries",
  "transcripts",
]);
const OWNED_LAUNCH_RECEIPTS = new WeakSet();

class FinalRunnerError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new FinalRunnerError(code);
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

function toLogical(value) {
  return value.split("\\").join("/");
}

function within(root, candidate) {
  const value = relative(root, candidate);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function requireDirectory(path, code) {
  if (!existsSync(path)) fail(code);
  const stats = lstatSync(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) fail(code);
  return path;
}

function requireFile(path, code) {
  if (!existsSync(path)) fail(code);
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink()) fail(code);
  return path;
}

function readJson(path, code) {
  requireFile(path, code);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(code);
  }
}

function assertExactKeys(value, keys, code) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(code);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(code);
  }
}

function parseArgs(argv) {
  const supported = new Set([
    "mode",
    "repository",
    "task-id",
    "evidence-root",
    "source",
    "source-commit",
    "ue-root",
    "package",
    "package-root",
    "project",
    "project-root",
    "runuat",
    "plugin",
    "marker",
    "port",
    "session",
    "generation",
    "producer-mode",
    "input",
    "manifest",
    "build-ledger",
    "build-result",
    "builder",
    "builder-kind",
    "uat-log",
  ]);
  const args = Object.create(null);
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) fail("FINAL_ARGUMENT_INVALID");
    const key = item.slice(2);
    if (!supported.has(key) || Object.hasOwn(args, key)) {
      fail("FINAL_ARGUMENT_INVALID");
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail("FINAL_ARGUMENT_INVALID");
    args[key] = value;
    index += 1;
  }
  return args;
}

function validateTaskId(value) {
  const taskId = value ?? DEFAULT_TASK_ID;
  if (!/^TASK-MVP15D-[A-Z0-9-]+$/.test(taskId)) {
    fail("FINAL_TASK_ID_INVALID");
  }
  return taskId;
}

function validateRoot(args, mustExist) {
  if (!args.repository || !args["evidence-root"]) {
    fail("FINAL_ROOT_ARGUMENT_REQUIRED");
  }
  const repository = requireDirectory(resolve(args.repository), "FINAL_REPOSITORY_INVALID");
  const external = resolve(repository, "external");
  const root = resolve(args["evidence-root"]);
  if (
    resolve(root, "..") !== external ||
    !ROOT_PATTERN.test(basename(root)) ||
    !within(external, root)
  ) {
    fail("FINAL_ROOT_INVALID");
  }
  if (mustExist) requireDirectory(root, "FINAL_ROOT_MISSING");
  else if (existsSync(root)) fail("FINAL_ROOT_ALREADY_EXISTS");
  return { repository, root };
}

function validateMarkerPort(args) {
  if (
    !args.marker ||
    !/^[A-Za-z0-9._:-]{24,160}$/.test(args.marker) ||
    !args.port ||
    !/^\d{4,5}$/.test(args.port)
  ) {
    fail("FINAL_OWNERSHIP_ARGUMENT_INVALID");
  }
  const port = Number(args.port);
  if (port < 1024 || port > 65535) {
    fail("FINAL_OWNERSHIP_ARGUMENT_INVALID");
  }
  return { marker: args.marker, port };
}

function sourceArtifact(root, value, code) {
  assertExactKeys(
    value,
    ["relativePath", "size", "sha256", "capturedAt", "producer", "redactionStatus", "schema"],
    code,
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
    typeof value.producer !== "string" ||
    !/^[A-Za-z0-9._-]+$/.test(value.producer) ||
    !["raw", "deterministically-redacted"].includes(value.redactionStatus) ||
    typeof value.schema !== "string" ||
    !/^[A-Za-z0-9.+/;=_ -]{3,160}$/.test(value.schema)
  ) {
    fail(code);
  }
  const path = resolve(root, value.relativePath.split("/").join("\\"));
  if (
    !within(root, path) ||
    lstatSync(requireFile(path, code)).size !== value.size ||
    sha256File(path) !== value.sha256
  ) {
    fail(code);
  }
}

function validateSummarySources(root, summary, code) {
  if (!Array.isArray(summary.sourceArtifacts) || summary.sourceArtifacts.length === 0) {
    fail(code);
  }
  for (const artifact of summary.sourceArtifacts) {
    sourceArtifact(root, artifact, code);
  }
}

function preflight(args) {
  const identity = validateRoot(args, false);
  const taskId = validateTaskId(args["task-id"]);
  const ownership = validateMarkerPort(args);
  if (
    !args["source-commit"] ||
    !/^[0-9a-f]{40}$/.test(args["source-commit"]) ||
    !args["ue-root"] ||
    !isAbsolute(args["ue-root"])
  ) {
    fail("FINAL_PREFLIGHT_ARGUMENT_INVALID");
  }
  const plan = {
    schemaVersion: "uagent.mvp15d.final.preflight.v1",
    taskGeneration: TASK_GENERATION,
    taskId,
    sourceCommit: args["source-commit"],
    rootName: basename(identity.root),
    ueRootIdentity: sha256Bytes(Buffer.from(resolve(args["ue-root"]).toLowerCase(), "utf8")),
    marker: ownership.marker,
    port: ownership.port,
    taskLocalCache: "project/Saved/DerivedDataCache",
    project: "project/FinalHost",
    package: "package/UAgentAssetTools",
    sandboxPrefix: "/Game/UAgentSandbox/",
    readOnlySource: "/Game/Test01",
  };
  if ((args.mode ?? "plan") === "plan") {
    return { status: "preflight_planned", plan };
  }
  if (args.mode !== "create") fail("FINAL_PREFLIGHT_MODE_INVALID");
  const externalRoot = resolve(identity.root, "..");
  if (!existsSync(externalRoot)) mkdirSync(externalRoot);
  else requireDirectory(externalRoot, "FINAL_EXTERNAL_ROOT_INVALID");
  mkdirSync(identity.root);
  for (const directory of ALLOWED_TOP_LEVEL) {
    mkdirSync(resolve(identity.root, directory));
  }
  writeFileSync(
    resolve(identity.root, "metadata", "preflight.json"),
    `${JSON.stringify(plan, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  return { status: "preflight_created", plan };
}

function buildArgs(args, mode) {
  return [
    "--mode",
    mode,
    "--source",
    args.source,
    "--package",
    args.package ?? args["package-root"],
    "--runuat",
    args.runuat,
    "--ue-root",
    args["ue-root"],
    "--task-id",
    validateTaskId(args["task-id"]),
    ...(args.plugin ? ["--plugin", args.plugin] : []),
    ...(mode === "live"
      ? [
          "--evidence-root",
          args["evidence-root"],
          "--task-marker",
          args.marker,
          ...(args["uat-log"] ? ["--uat-log", args["uat-log"]] : []),
        ]
      : []),
  ];
}

function projectCreate(args) {
  const { root } = validateRoot(args, true);
  const projectRoot = resolve(
    args.project ?? args["project-root"] ?? resolve(root, "project", "FinalHost"),
  );
  if (
    !within(root, projectRoot) ||
    toLogical(relative(root, projectRoot)) !== "project/FinalHost"
  ) {
    fail("FINAL_PROJECT_ROOT_INVALID");
  }
  const plan = {
    project: "project/FinalHost",
    descriptor: "project/FinalHost/FinalHost.uproject",
    engineAssociation: "5.8",
    taskLocalDdc: "project/FinalHost/Saved/DerivedDataCache",
    readOnlySeed: "/Game/Test01",
  };
  if ((args.mode ?? "plan") === "plan") {
    if (existsSync(projectRoot)) fail("FINAL_PROJECT_ALREADY_EXISTS");
    return { status: "project_create_planned", plan };
  }
  if (args.mode !== "create" || existsSync(projectRoot)) {
    fail("FINAL_PROJECT_CREATE_REJECTED");
  }
  mkdirSync(projectRoot);
  mkdirSync(resolve(projectRoot, "Config"));
  mkdirSync(resolve(projectRoot, "Content"));
  writeFileSync(
    resolve(projectRoot, "FinalHost.uproject"),
    `${JSON.stringify(
      {
        FileVersion: 3,
        EngineAssociation: "5.8",
        Category: "",
        Description: "UAgent MVP15D final task-owned disposable host",
        Plugins: [{ Name: "UAgentAssetTools", Enabled: true }],
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  writeFileSync(
    resolve(projectRoot, "Config", "DefaultEngine.ini"),
    [
      "[/Script/Engine.Engine]",
      "",
      "[DerivedDataBackendGraph]",
      "Root=(Type=KeyLength, Length=120, Inner=Local)",
      'Local=(Type=FileSystem, ReadOnly=false, Clean=false, Path="%GAMEDIR%Saved/DerivedDataCache")',
      "",
    ].join("\n"),
    { encoding: "utf8", flag: "wx" },
  );
  return { status: "project_created", plan };
}

function packageInstall(args) {
  const { root } = validateRoot(args, true);
  if (!args["package-root"] || !args["project-root"]) {
    fail("FINAL_INSTALL_ARGUMENT_REQUIRED");
  }
  const packageRoot = requireDirectory(resolve(args["package-root"]), "FINAL_PACKAGE_ROOT_INVALID");
  const projectRoot = requireDirectory(resolve(args["project-root"]), "FINAL_PROJECT_ROOT_INVALID");
  if (!within(root, packageRoot) || !within(root, projectRoot)) {
    fail("FINAL_INSTALL_OUTSIDE_ROOT");
  }
  collectPackageArtifacts(packageRoot, true);
  const pluginsRoot = resolve(projectRoot, "Plugins");
  const destination = resolve(pluginsRoot, "UAgentAssetTools");
  if (existsSync(pluginsRoot) || existsSync(destination)) {
    fail("FINAL_INSTALL_SHADOW_OR_DUPLICATE");
  }
  const plan = {
    source: toLogical(relative(root, packageRoot)),
    destination: toLogical(relative(root, destination)),
    installedCopyCount: 1,
  };
  if ((args.mode ?? "plan") === "plan") {
    return { status: "package_install_planned", plan };
  }
  if (args.mode !== "install") fail("FINAL_INSTALL_MODE_INVALID");
  mkdirSync(pluginsRoot);
  cpSync(packageRoot, destination, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    force: false,
  });
  const sourceArtifacts = collectPackageArtifacts(packageRoot, true);
  const installedArtifacts = collectPackageArtifacts(destination, true);
  if (stable(sourceArtifacts) !== stable(installedArtifacts)) {
    fail("FINAL_INSTALL_HASH_MISMATCH");
  }
  return { status: "package_installed", plan };
}

function validatePhaseSession(args, kind, mode) {
  const sessionId = args.session ?? `final-${mode}-${kind}-session-0001`;
  const generation = Number(args.generation ?? "1");
  if (
    !/^[A-Za-z0-9._:-]{16,160}$/.test(sessionId) ||
    !Number.isSafeInteger(generation) ||
    generation < 1
  ) {
    fail("FINAL_PHASE_ARGUMENT_INVALID");
  }
  return { sessionId, generation };
}

function validateRepositoryCommit(repository, sourceCommit) {
  const result = spawnSync("git", ["-C", repository, "rev-parse", "HEAD"], {
    cwd: repository,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || result.stdout.trim().toLowerCase() !== sourceCommit) {
    fail("FINAL_SOURCE_COMMIT_MISMATCH");
  }
}

function liveProducerVector(kind, args, identity, taskId, ownership, session) {
  const sourceCommit = args["source-commit"];
  const allowed = new Set([
    "mode",
    "repository",
    "evidence-root",
    "task-id",
    "source-commit",
    "marker",
    "port",
    "session",
    "generation",
    ...(kind === "ue-automation" ? ["ue-root"] : []),
  ]);
  if (
    !sourceCommit ||
    !/^[0-9a-f]{40}$/.test(sourceCommit) ||
    Object.keys(args).some((key) => !allowed.has(key)) ||
    (kind === "ue-automation" && (!args["ue-root"] || !isAbsolute(args["ue-root"])))
  ) {
    fail("FINAL_PHASE_ARGUMENT_INVALID");
  }
  validateRepositoryCommit(identity.repository, sourceCommit);
  const endpoint = `http://127.0.0.1:${ownership.port}/mcp`;
  return {
    sourceCommit,
    endpoint,
    vector: [
      "--repository",
      identity.repository,
      "--evidence-root",
      identity.root,
      "--task-id",
      taskId,
      "--task-generation",
      TASK_GENERATION,
      "--source-commit",
      sourceCommit,
      "--marker",
      ownership.marker,
      "--session",
      session.sessionId,
      "--endpoint",
      endpoint,
      "--generation",
      String(session.generation),
      "--port",
      String(ownership.port),
      ...(kind === "ue-automation" ? ["--ue-root", resolve(args["ue-root"])] : []),
    ],
  };
}

function fixedProducerPlan(kind, args, identity, taskId, ownership) {
  const producer = LIVE_PRODUCERS[kind];
  const session = validatePhaseSession(args, kind, "live");
  const sourceCommit =
    args["source-commit"] && /^[0-9a-f]{40}$/.test(args["source-commit"])
      ? args["source-commit"]
      : "<required-source-commit>";
  const endpoint = `http://127.0.0.1:${ownership.port}/mcp`;
  const vector = [
    "--repository",
    identity.repository,
    "--evidence-root",
    identity.root,
    "--task-id",
    taskId,
    "--task-generation",
    TASK_GENERATION,
    "--source-commit",
    sourceCommit,
    "--marker",
    ownership.marker,
    "--session",
    session.sessionId,
    "--endpoint",
    endpoint,
    "--generation",
    String(session.generation),
    "--port",
    String(ownership.port),
    ...(kind === "ue-automation"
      ? ["--ue-root", args["ue-root"] ? resolve(args["ue-root"]) : "<required-ue-root>"]
      : []),
  ];
  return {
    executable: process.execPath,
    producer: producer.relativePath,
    orderedArguments: [resolve(identity.repository, producer.relativePath), ...vector],
    shell: false,
    endpoint,
  };
}

function phasePlan(kind, args) {
  const identity = validateRoot(args, true);
  const taskId = validateTaskId(args["task-id"]);
  const ownership = validateMarkerPort(args);
  const shared = {
    taskGeneration: TASK_GENERATION,
    mutationAuthority: kind === "ui-lifecycle" ? "ui_trust_only" : "none",
    installedLoadedIdentityRequired: true,
    rawTranscriptRequired: true,
    taskOwnedProcessesOnly: true,
    taskOwnedPortsOnly: true,
    closeoutResidualCount: 0,
    liveCommand: fixedProducerPlan(kind, args, identity, taskId, ownership),
  };
  if (kind === "ue-automation") {
    return {
      status: "ue_automation_planned",
      plan: {
        ...shared,
        zeroMutation: true,
        contentUnchanged: true,
        structuredResultsRequired: true,
      },
    };
  }
  if (kind === "product-capture") {
    return {
      status: "product_capture_planned",
      plan: {
        ...shared,
        path: ["Connect", "Initialize", "Discover", "Normalize", "Fingerprint"],
        toolNames: TOOL_NAMES,
        rejectFixtureOrBypass: true,
        retractions: [
          "disconnect",
          "failure",
          "endpoint_change",
          "reconnect",
          "renderer_restart",
          "newer_generation",
        ],
        zeroMutation: true,
      },
    };
  }
  return {
    status: "ui_lifecycle_planned",
    plan: {
      ...shared,
      renderedUiPath: ["validate", "add", "confirmTrust"],
      readOnlySource: "/Game/Test01",
      sandboxPrefix: "/Game/UAgentSandbox/<run-id>/",
      forwardOrder: FORWARD_ORDER,
      inverseOrder: INVERSE_ORDER,
      ledger: {
        dryRunActions: 5,
        dryRunCalls: 1,
        nativeRegistrations: 1,
        nativeExecuteGuards: 5,
        executeCalls: 5,
        verifyMutations: 0,
        nativeRollbackGuards: 4,
        rollbackCalls: 4,
        replaySideEffectDelta: [0, 0, 0, 0, 0],
      },
    },
  };
}

function phasePaths(root, kind) {
  const events = resolve(root, "transcripts", `${kind}.events.jsonl`);
  return {
    events,
    stdout: events,
    runtimeEvents: resolve(root, "transcripts", `${kind}.runtime-events.jsonl`),
    stderr: resolve(root, "logs", `${kind}.stderr.log`),
    firstFailure: resolve(root, "logs", `${kind}.first-failure.json`),
    ledger: resolve(root, "metadata", `${kind}.producer.json`),
    summary: resolve(root, "summaries", `${kind}.json`),
  };
}

function artifactBinding(root, path, capturedAt, producer, redactionStatus, schema) {
  return {
    relativePath: toLogical(relative(root, path)),
    size: lstatSync(path).size,
    sha256: sha256File(path),
    capturedAt,
    producer,
    redactionStatus,
    schema,
  };
}

function exactData(event, keys, code) {
  assertExactKeys(event.data, keys, code);
  return event.data;
}

function parsePhaseEvents(text, kind, binding) {
  const lines = String(text)
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
  if (lines.length < 4) fail("FINAL_PHASE_EVENTS_MISSING");
  const events = lines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      fail("FINAL_PHASE_EVENT_JSON_INVALID");
    }
  });
  let previousTime = 0;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    assertExactKeys(
      event,
      [
        "schemaVersion",
        "phase",
        "taskId",
        "marker",
        "sessionId",
        "generation",
        "producer",
        "sequence",
        "capturedAt",
        "type",
        "data",
      ],
      "FINAL_PHASE_EVENT_SHAPE_INVALID",
    );
    assertExactKeys(event.producer, ["id", "pid", "mode"], "FINAL_PHASE_PRODUCER_INVALID");
    const capturedAt = Date.parse(event.capturedAt);
    if (
      event.schemaVersion !== EVENT_SCHEMA ||
      event.phase !== kind ||
      event.taskId !== binding.taskId ||
      event.marker !== binding.marker ||
      event.sessionId !== binding.sessionId ||
      event.generation !== binding.generation ||
      event.producer.id !== binding.producerId ||
      event.producer.mode !== binding.mode ||
      event.producer.pid !== binding.pid ||
      event.sequence !== index + 1 ||
      !Number.isFinite(capturedAt) ||
      capturedAt <= previousTime ||
      typeof event.type !== "string"
    ) {
      fail("FINAL_PHASE_EVENT_BINDING_INVALID");
    }
    previousTime = capturedAt;
  }
  if (
    events[0].type !== "process_started" ||
    events.at(-2)?.type !== "process_exited" ||
    events.at(-1)?.type !== "closeout"
  ) {
    fail("FINAL_PHASE_EVENT_COVERAGE_INVALID");
  }
  const processStarted = exactData(
    events[0],
    ["port", "argumentVectorSha256"],
    "FINAL_PHASE_PROCESS_START_INVALID",
  );
  const processExited = exactData(events.at(-2), ["exitCode"], "FINAL_PHASE_PROCESS_EXIT_INVALID");
  const closeout = exactData(
    events.at(-1),
    ["processResidualCount", "portResidualCount", "markerResidualCount", "partialOutputCount"],
    "FINAL_PHASE_CLOSEOUT_INVALID",
  );
  if (
    processStarted.port !== binding.port ||
    !isHex(processStarted.argumentVectorSha256) ||
    processExited.exitCode !== 0 ||
    Object.values(closeout).some((count) => count !== 0)
  ) {
    fail("FINAL_PHASE_PROCESS_OR_RESIDUE_INVALID");
  }
  let runtimeProcess = null;
  let runtimeTransport = null;
  let persistedOriginClaimConsistent = false;
  if (binding.mode === "live") {
    const origins = events.filter((event) => event.type === "evidence_origin");
    if (origins.length !== 1) fail("FINAL_PHASE_LIVE_ORIGIN_INVALID");
    const origin = exactData(
      origins[0],
      ["origin", "fixtureUsed"],
      "FINAL_PHASE_LIVE_ORIGIN_INVALID",
    );
    if (origin.origin !== "live_runtime" || origin.fixtureUsed !== false) {
      fail("FINAL_PHASE_LIVE_ORIGIN_INVALID");
    }
    persistedOriginClaimConsistent = true;
    const matches = events.filter((event) => event.type === "runtime_process_started");
    if (matches.length !== 1) fail("FINAL_PHASE_RUNTIME_PROCESS_INVALID");
    runtimeProcess = exactData(
      matches[0],
      ["pid", "endpoint", "marker", "executable", "argumentVectorSha256"],
      "FINAL_PHASE_RUNTIME_PROCESS_INVALID",
    );
    assertExactKeys(
      runtimeProcess.executable,
      ["basename", "size", "sha256"],
      "FINAL_PHASE_RUNTIME_PROCESS_INVALID",
    );
    if (
      !Number.isSafeInteger(runtimeProcess.pid) ||
      runtimeProcess.pid <= 0 ||
      runtimeProcess.endpoint !== binding.endpoint ||
      runtimeProcess.marker !== binding.marker ||
      typeof runtimeProcess.executable.basename !== "string" ||
      !Number.isSafeInteger(runtimeProcess.executable.size) ||
      runtimeProcess.executable.size <= 0 ||
      !isHex(runtimeProcess.executable.sha256) ||
      !isHex(runtimeProcess.argumentVectorSha256)
    ) {
      fail("FINAL_PHASE_RUNTIME_PROCESS_INVALID");
    }
    const transports = events.filter((event) => event.type === "runtime_event_transport");
    if (transports.length !== 1) fail("FINAL_PHASE_RUNTIME_TRANSPORT_INVALID");
    runtimeTransport = exactData(
      transports[0],
      ["bridgeVersion", "eventFile", "nonceSha256", "asynchronous", "jobOwned"],
      "FINAL_PHASE_RUNTIME_TRANSPORT_INVALID",
    );
    assertExactKeys(
      runtimeTransport.eventFile,
      ["relativePath", "size", "sha256"],
      "FINAL_PHASE_RUNTIME_TRANSPORT_INVALID",
    );
    if (
      runtimeTransport.bridgeVersion !==
        (kind === "ue-automation"
          ? "uagent.mvp15d.ue-automation-report.v1"
          : "uagent.mvp15d.runtime-bridge.v1") ||
      runtimeTransport.eventFile.relativePath !== `transcripts/${kind}.runtime-events.jsonl` ||
      !Number.isSafeInteger(runtimeTransport.eventFile.size) ||
      runtimeTransport.eventFile.size <= 0 ||
      !isHex(runtimeTransport.eventFile.sha256) ||
      !isHex(runtimeTransport.nonceSha256) ||
      typeof runtimeTransport.asynchronous !== "boolean" ||
      typeof runtimeTransport.jobOwned !== "boolean" ||
      (kind !== "ue-automation" && runtimeTransport.asynchronous !== true)
    ) {
      fail("FINAL_PHASE_RUNTIME_TRANSPORT_INVALID");
    }
  }
  return {
    events,
    closeout,
    argumentVectorSha256: processStarted.argumentVectorSha256,
    runtimeProcess,
    runtimeTransport,
    productionProvenance:
      binding.mode === "live" && kind === "ue-automation"
        ? productionProvenanceEvent(events)
        : null,
    persistedOriginClaimConsistent,
  };
}

function oneEvent(events, type, code) {
  const matches = events.filter((event) => event.type === type);
  if (matches.length !== 1) fail(code);
  return matches[0];
}

function installedLoaded(events) {
  const data = exactData(
    oneEvent(events, "installed_loaded", "FINAL_INSTALLED_LOADED_EVENT_INVALID"),
    ["installed", "loaded", "manifest"],
    "FINAL_INSTALLED_LOADED_EVENT_INVALID",
  );
  for (const key of ["installed", "loaded", "manifest"]) {
    if (
      !Array.isArray(data[key]) ||
      data[key].length === 0 ||
      data[key].some((name) => typeof name !== "string") ||
      new Set(data[key].map((name) => name.toLowerCase())).size !== data[key].length
    ) {
      fail("FINAL_INSTALLED_LOADED_EVENT_INVALID");
    }
  }
  if (
    stable(data.installed) !== stable(data.loaded) ||
    stable(data.loaded) !== stable(data.manifest)
  ) {
    fail("FINAL_INSTALLED_LOADED_MISMATCH");
  }
  return true;
}

function snapshotPair(events, code) {
  const snapshots = events.filter((event) => event.type === "content_snapshot");
  if (snapshots.length !== 2) fail(code);
  const values = snapshots.map((event) => exactData(event, ["stage", "sha256"], code));
  if (
    values[0].stage !== "before" ||
    values[1].stage !== "after" ||
    !isHex(values[0].sha256) ||
    values[0].sha256 !== values[1].sha256
  ) {
    fail(code);
  }
  return values[0].sha256;
}

function productionProvenanceEvent(events) {
  const code = "FINAL_UE_PRODUCTION_PROVENANCE_INVALID";
  const data = exactData(
    oneEvent(events, "production_provenance", code),
    [
      "loadedLedger",
      "earlyIdentity",
      "jobCloseout",
      "authorityBindingSha256",
      "taskId",
      "taskMarker",
      "sessionId",
      "generation",
      "sourceCommit",
      "sourceTreeSha256",
      "sourceDirty",
      "process",
      "projectSha256",
      "manifestSha256",
      "packageInventorySha256",
      "installedInventorySha256",
      "loadedModulesSha256",
      "producerSources",
    ],
    code,
  );
  for (const descriptor of [data.loadedLedger, data.earlyIdentity, data.jobCloseout]) {
    assertExactKeys(descriptor, ["relativePath", "size", "sha256"], code);
    if (
      typeof descriptor.relativePath !== "string" ||
      isAbsolute(descriptor.relativePath) ||
      descriptor.relativePath.includes("\\") ||
      !Number.isSafeInteger(descriptor.size) ||
      descriptor.size <= 0 ||
      !isHex(descriptor.sha256)
    ) {
      fail(code);
    }
  }
  assertExactKeys(
    data.process,
    ["pid", "creationFileTimeUtc", "executableBasename", "executableSha256"],
    code,
  );
  assertExactKeys(data.producerSources, ["phaseProducer", "helper", "observer", "jobRunner"], code);
  for (const descriptor of Object.values(data.producerSources)) {
    assertExactKeys(descriptor, ["relativePath", "size", "sha256"], code);
    if (
      typeof descriptor.relativePath !== "string" ||
      isAbsolute(descriptor.relativePath) ||
      descriptor.relativePath.includes("\\") ||
      !Number.isSafeInteger(descriptor.size) ||
      descriptor.size <= 0 ||
      !isHex(descriptor.sha256)
    ) {
      fail(code);
    }
  }
  if (
    data.loadedLedger.relativePath !== "captures/loaded-modules.json" ||
    data.earlyIdentity.relativePath !==
      `metadata/ue-automation.${data.sessionId}.early-identity.json` ||
    data.jobCloseout.relativePath !== "metadata/ue-automation.job-closeout.json" ||
    !/^TASK-MVP15D-[A-Z0-9-]+$/.test(data.taskId) ||
    !/^[A-Za-z0-9._:-]{24,160}$/.test(data.taskMarker) ||
    !/^[A-Za-z0-9._:-]{16,160}$/.test(data.sessionId) ||
    !Number.isSafeInteger(data.generation) ||
    data.generation < 1 ||
    !isHex(data.sourceCommit, 40) ||
    !isHex(data.sourceTreeSha256) ||
    typeof data.sourceDirty !== "boolean" ||
    !Number.isSafeInteger(data.process.pid) ||
    data.process.pid < 1 ||
    !/^[0-9]{1,30}$/.test(data.process.creationFileTimeUtc) ||
    typeof data.process.executableBasename !== "string" ||
    !isHex(data.process.executableSha256) ||
    [
      data.authorityBindingSha256,
      data.projectSha256,
      data.manifestSha256,
      data.packageInventorySha256,
      data.installedInventorySha256,
      data.loadedModulesSha256,
    ].some((value) => !isHex(value))
  ) {
    fail(code);
  }
  return data;
}

function deriveUe(events, closeout, mode) {
  const tests = events
    .filter((event) => event.type === "automation_test")
    .map((event) => exactData(event, ["name", "status"], "FINAL_UE_TEST_EVENT_INVALID"));
  if (
    stable(tests.map(({ name }) => name)) !== stable(UE_AUTOMATION_TESTS) ||
    tests.some(({ name, status }) => typeof name !== "string" || status !== "passed") ||
    new Set(tests.map(({ name }) => name)).size !== tests.length
  ) {
    fail("FINAL_UE_TEST_EVENT_INVALID");
  }
  const automationSummary = exactData(
    oneEvent(events, "automation_summary", "FINAL_UE_TEST_EVENT_INVALID"),
    ["expected", "passed", "failed", "skipped"],
    "FINAL_UE_TEST_EVENT_INVALID",
  );
  if (
    automationSummary.expected !== UE_AUTOMATION_TESTS.length ||
    automationSummary.passed !== UE_AUTOMATION_TESTS.length ||
    automationSummary.failed !== 0 ||
    automationSummary.skipped !== 0
  ) {
    fail("FINAL_UE_TEST_EVENT_INVALID");
  }
  if (mode === "live") {
    const provenance = productionProvenanceEvent(events);
    const reportBinding = exactData(
      oneEvent(events, "automation_report_binding", "FINAL_UE_REPORT_BINDING_INVALID"),
      [
        "reportSha256",
        "taskBindingSha256",
        "projectSha256",
        "manifestSha256",
        "packageModulesSha256",
        "installedModulesSha256",
        "loadedModulesSha256",
        "executableSha256",
        "processId",
      ],
      "FINAL_UE_REPORT_BINDING_INVALID",
    );
    const runtimeProcess = exactData(
      oneEvent(events, "runtime_process_started", "FINAL_UE_REPORT_BINDING_INVALID"),
      ["pid", "endpoint", "marker", "executable", "argumentVectorSha256"],
      "FINAL_UE_REPORT_BINDING_INVALID",
    );
    if (
      [
        reportBinding.reportSha256,
        reportBinding.taskBindingSha256,
        reportBinding.projectSha256,
        reportBinding.manifestSha256,
        reportBinding.packageModulesSha256,
        reportBinding.installedModulesSha256,
        reportBinding.loadedModulesSha256,
        reportBinding.executableSha256,
      ].some((value) => !isHex(value)) ||
      reportBinding.packageModulesSha256 !== reportBinding.installedModulesSha256 ||
      reportBinding.installedModulesSha256 !== reportBinding.loadedModulesSha256 ||
      reportBinding.processId !== runtimeProcess.pid ||
      reportBinding.executableSha256 !== runtimeProcess.executable.sha256 ||
      reportBinding.projectSha256 !== provenance.projectSha256 ||
      reportBinding.manifestSha256 !== provenance.manifestSha256 ||
      reportBinding.loadedModulesSha256 !== provenance.loadedModulesSha256 ||
      provenance.process.pid !== runtimeProcess.pid ||
      provenance.process.executableSha256 !== runtimeProcess.executable.sha256
    ) {
      fail("FINAL_UE_REPORT_BINDING_INVALID");
    }
  }
  const mutation = exactData(
    oneEvent(events, "mutation_observed", "FINAL_UE_MUTATION_EVENT_INVALID"),
    ["count"],
    "FINAL_UE_MUTATION_EVENT_INVALID",
  );
  if (mutation.count !== 0) fail("FINAL_UE_MUTATION_EVENT_INVALID");
  return {
    installedLoadedVerified: installedLoaded(events),
    matrixComplete: true,
    testNames: tests.map(({ name }) => name),
    expectedTestCount: automationSummary.expected,
    passedTestCount: automationSummary.passed,
    failedTestCount: automationSummary.failed,
    skippedTestCount: automationSummary.skipped,
    mutationCount: mutation.count,
    contentSha256: snapshotPair(events, "FINAL_UE_CONTENT_EVENT_INVALID"),
    contentUnchanged: true,
    processResidualCount: closeout.processResidualCount,
    ...(mode === "live"
      ? {
          productionArtifactConsistencyVerified: true,
          loadedLedgerSha256: productionProvenanceEvent(events).loadedLedger.sha256,
          jobCloseoutSha256: productionProvenanceEvent(events).jobCloseout.sha256,
        }
      : {}),
  };
}

function descriptorFor(repository, logicalPath, code) {
  const path = requireFile(resolve(repository, logicalPath.split("/").join("\\")), code);
  const stats = lstatSync(path);
  return { relativePath: logicalPath, size: stats.size, sha256: sha256File(path) };
}

function validateBoundArtifact(root, descriptor, expectedRelativePath, code) {
  if (
    descriptor?.relativePath !== expectedRelativePath ||
    !Number.isSafeInteger(descriptor.size) ||
    descriptor.size <= 0 ||
    !isHex(descriptor.sha256)
  ) {
    fail(code);
  }
  const path = resolve(root, expectedRelativePath.split("/").join("\\"));
  if (
    !within(root, path) ||
    lstatSync(requireFile(path, code)).size !== descriptor.size ||
    sha256File(path) !== descriptor.sha256
  ) {
    fail(code);
  }
  return path;
}

function validateEarlyIdentityArtifact(root, descriptor, loaded, code) {
  const expectedRelativePath = `metadata/ue-automation.${loaded.sessionId}.early-identity.json`;
  const path = validateBoundArtifact(root, descriptor, expectedRelativePath, code);
  const identity = readJson(path, code);
  assertExactKeys(
    identity,
    [
      "schemaVersion",
      "taskMarker",
      "session",
      "generation",
      "rootPid",
      "rootCreationFileTimeUtc",
      "executableBasename",
      "executableSha256",
    ],
    code,
  );
  if (
    identity.schemaVersion !== EARLY_IDENTITY_SCHEMA ||
    identity.taskMarker !== loaded.taskMarker ||
    identity.session !== loaded.sessionId ||
    identity.generation !== loaded.generation ||
    identity.rootPid !== loaded.process.pid ||
    identity.rootCreationFileTimeUtc !== loaded.process.creationFileTimeUtc ||
    identity.executableBasename !== loaded.process.executableBasename ||
    identity.executableSha256 !== loaded.process.executableSha256
  ) {
    fail(code);
  }
  return identity;
}

function loadedAuthorityBindingMaterial(loaded) {
  return {
    schemaVersion: loaded.schemaVersion,
    productionOrigin: loaded.productionOrigin,
    fixtureUsed: loaded.fixtureUsed,
    taskGeneration: loaded.taskGeneration,
    taskId: loaded.taskId,
    taskMarker: loaded.taskMarker,
    sessionId: loaded.sessionId,
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
    earlyIdentity: loaded.authority.earlyIdentity,
    sources: loaded.authority.sources,
  };
}

function verifyUeProductionArtifactConsistency(
  repository,
  root,
  phaseLedger,
  events,
  runtimeExecutablePath = null,
) {
  const code = "FINAL_UE_PRODUCTION_PROVENANCE_INVALID";
  const provenance = productionProvenanceEvent(events);
  const loadedPath = validateBoundArtifact(
    root,
    provenance.loadedLedger,
    "captures/loaded-modules.json",
    code,
  );
  const jobPath = validateBoundArtifact(
    root,
    provenance.jobCloseout,
    "metadata/ue-automation.job-closeout.json",
    code,
  );
  const loaded = readJson(loadedPath, code);
  assertExactKeys(
    loaded,
    [
      "schemaVersion",
      "productionOrigin",
      "fixtureUsed",
      "taskGeneration",
      "taskId",
      "taskMarker",
      "sessionId",
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
    ],
    code,
  );
  assertExactKeys(loaded.project, ["id", "sha256"], code);
  assertExactKeys(loaded.manifest, ["sha256"], code);
  assertExactKeys(loaded.package, ["id", "artifactCount", "sha256"], code);
  assertExactKeys(loaded.installedRoot, ["id", "artifactCount", "sha256"], code);
  assertExactKeys(
    loaded.process,
    ["pid", "creationFileTimeUtc", "executableBasename", "executableSha256"],
    code,
  );
  assertExactKeys(
    loaded.authority,
    ["schemaVersion", "earlyIdentity", "sources", "bindingSha256"],
    code,
  );
  assertExactKeys(loaded.authority.earlyIdentity, ["relativePath", "size", "sha256"], code);
  assertExactKeys(
    loaded.authority.sources,
    ["phaseProducer", "helper", "observer", "jobRunner"],
    code,
  );
  const expectedSources = {
    phaseProducer: descriptorFor(
      repository,
      "scripts/mvp15d-final-ue-automation-producer.mjs",
      code,
    ),
    helper: descriptorFor(repository, "scripts/mvp15d-final-live-producer-helper.mjs", code),
    observer: descriptorFor(repository, "scripts/mvp15d-loaded-module-observer.mjs", code),
    jobRunner: descriptorFor(repository, "scripts/mvp15d-windows-job-process-runner.ps1", code),
  };
  for (const descriptor of Object.values(loaded.authority.sources)) {
    assertExactKeys(descriptor, ["relativePath", "size", "sha256"], code);
  }
  validateEarlyIdentityArtifact(root, loaded.authority.earlyIdentity, loaded, code);
  const source = computeSourceIdentity(repository);
  const projectPath = requireFile(
    resolve(root, "project", "FinalHost", "FinalHost.uproject"),
    code,
  );
  const packageRoot = requireDirectory(resolve(root, "package", "UAgentAssetTools"), code);
  const installedRoot = requireDirectory(
    resolve(root, "project", "FinalHost", "Plugins", "UAgentAssetTools"),
    code,
  );
  const manifestPath = requireFile(resolve(packageRoot, "UAgentAssetTools.build.json"), code);
  const installedManifestPath = requireFile(
    resolve(installedRoot, "UAgentAssetTools.build.json"),
    code,
  );
  const manifest = readJson(manifestPath, code);
  const packageInventory = collectPackageArtifacts(packageRoot, true);
  const installedInventory = collectPackageArtifacts(installedRoot, true);
  const packageSha256 = sha256Bytes(Buffer.from(stable(packageInventory.artifacts), "utf8"));
  const installedSha256 = sha256Bytes(Buffer.from(stable(installedInventory.artifacts), "utf8"));
  const loadedModules = [];
  let previousPath = "";
  for (const module of loaded.modules ?? []) {
    assertExactKeys(module, ["path", "name", "size", "sha256"], code);
    if (
      typeof module.path !== "string" ||
      module.path.localeCompare(previousPath, "en") <= 0 ||
      basename(module.path) !== module.name ||
      !Number.isSafeInteger(module.size) ||
      module.size <= 0 ||
      !isHex(module.sha256)
    ) {
      fail(code);
    }
    previousPath = module.path;
    const path = requireFile(resolve(installedRoot, module.path.split("/").join("\\")), code);
    if (
      !within(installedRoot, path) ||
      lstatSync(path).size !== module.size ||
      sha256File(path) !== module.sha256
    ) {
      fail(code);
    }
    loadedModules.push({ path: module.path, size: module.size, sha256: module.sha256 });
  }
  const loadedModulesSha256 = sha256Bytes(Buffer.from(stable(loadedModules), "utf8"));
  const job = readJson(jobPath, code);
  assertExactKeys(
    job,
    [
      "schemaVersion",
      "taskId",
      "marker",
      "sessionId",
      "generation",
      "jobSchemaVersion",
      "rootPid",
      "rootExitCode",
      "timedOut",
      "activeProcessZeroObserved",
      "finalResidualCount",
      "failureCode",
    ],
    code,
  );
  const expectedBindingSha256 = sha256Bytes(
    Buffer.from(stable(loadedAuthorityBindingMaterial(loaded)), "utf8"),
  );
  if (
    loaded.schemaVersion !== LOADED_LEDGER_SCHEMA ||
    loaded.productionOrigin !== PRODUCTION_ORIGIN ||
    loaded.fixtureUsed !== false ||
    loaded.taskGeneration !== TASK_GENERATION ||
    loaded.taskId !== phaseLedger.taskId ||
    loaded.taskMarker !== phaseLedger.marker ||
    loaded.sessionId !== phaseLedger.sessionId ||
    loaded.generation !== phaseLedger.generation ||
    loaded.sourceCommit !== phaseLedger.sourceCommit ||
    loaded.sourceCommit !== source.compiledCommit ||
    loaded.sourceTreeSha256 !== source.sourceTreeSha256 ||
    loaded.sourceDirty !== source.sourceDirty ||
    loaded.project.id !== basename(projectPath, ".uproject") ||
    loaded.project.sha256 !== sha256File(projectPath) ||
    loaded.manifest.sha256 !== sha256File(manifestPath) ||
    sha256File(installedManifestPath) !== loaded.manifest.sha256 ||
    loaded.package.id !== "UAgentAssetTools" ||
    loaded.package.artifactCount !== packageInventory.artifacts.length ||
    loaded.package.sha256 !== packageSha256 ||
    loaded.installedRoot.id !== "UAgentAssetTools" ||
    loaded.installedRoot.artifactCount !== installedInventory.artifacts.length ||
    loaded.installedRoot.sha256 !== installedSha256 ||
    stable(packageInventory.artifacts) !== stable(installedInventory.artifacts) ||
    stable(loadedModules) !== stable(manifest.modules) ||
    loaded.authority.schemaVersion !== PRODUCTION_AUTHORITY_SCHEMA ||
    loaded.authority.earlyIdentity.relativePath !==
      `metadata/ue-automation.${loaded.sessionId}.early-identity.json` ||
    !Number.isSafeInteger(loaded.authority.earlyIdentity.size) ||
    loaded.authority.earlyIdentity.size <= 0 ||
    !isHex(loaded.authority.earlyIdentity.sha256) ||
    stable(loaded.authority.sources) !== stable(expectedSources) ||
    loaded.authority.bindingSha256 !== expectedBindingSha256 ||
    provenance.authorityBindingSha256 !== expectedBindingSha256 ||
    stable(provenance.earlyIdentity) !== stable(loaded.authority.earlyIdentity) ||
    provenance.taskId !== loaded.taskId ||
    provenance.taskMarker !== loaded.taskMarker ||
    provenance.sessionId !== loaded.sessionId ||
    provenance.generation !== loaded.generation ||
    provenance.sourceCommit !== loaded.sourceCommit ||
    provenance.sourceTreeSha256 !== loaded.sourceTreeSha256 ||
    provenance.sourceDirty !== loaded.sourceDirty ||
    stable(provenance.process) !== stable(loaded.process) ||
    provenance.projectSha256 !== loaded.project.sha256 ||
    provenance.manifestSha256 !== loaded.manifest.sha256 ||
    provenance.packageInventorySha256 !== packageSha256 ||
    provenance.installedInventorySha256 !== installedSha256 ||
    provenance.loadedModulesSha256 !== loadedModulesSha256 ||
    stable(provenance.producerSources) !== stable(expectedSources) ||
    phaseLedger.runtimeProcess.pid !== loaded.process.pid ||
    phaseLedger.runtimeProcess.executable.basename !== loaded.process.executableBasename ||
    phaseLedger.runtimeProcess.executable.sha256 !== loaded.process.executableSha256 ||
    (runtimeExecutablePath !== null &&
      (loaded.process.executableBasename !== basename(runtimeExecutablePath) ||
        loaded.process.executableSha256 !==
          sha256File(requireFile(runtimeExecutablePath, code)))) ||
    phaseLedger.producer.relativePath !== expectedSources.phaseProducer.relativePath ||
    phaseLedger.producer.sha256 !== expectedSources.phaseProducer.sha256 ||
    phaseLedger.producer.helper.relativePath !== expectedSources.helper.relativePath ||
    phaseLedger.producer.helper.sha256 !== expectedSources.helper.sha256 ||
    job.schemaVersion !== JOB_CLOSEOUT_SCHEMA ||
    job.taskId !== loaded.taskId ||
    job.marker !== loaded.taskMarker ||
    job.sessionId !== loaded.sessionId ||
    job.generation !== loaded.generation ||
    job.jobSchemaVersion !== "uagent.mvp15d.windows-job-process-run.v1" ||
    job.rootPid !== loaded.process.pid ||
    job.rootExitCode !== 0 ||
    job.timedOut !== false ||
    job.activeProcessZeroObserved !== true ||
    job.finalResidualCount !== 0 ||
    job.failureCode !== ""
  ) {
    fail(code);
  }
  return {
    status: "ue_production_artifact_consistency_verified",
    persistedArtifactConsistencyVerified: true,
    productionLaunchAuthorityVerified: false,
    authorityBindingSha256: expectedBindingSha256,
    loadedLedgerSha256: provenance.loadedLedger.sha256,
    jobCloseoutSha256: provenance.jobCloseout.sha256,
  };
}

function deriveProduct(events, closeout, mode) {
  const origin = exactData(
    oneEvent(events, "capture_origin", "FINAL_PRODUCT_ORIGIN_EVENT_INVALID"),
    ["origin", "fixtureUsed", "manualDescriptorInjection", "directMcpBypass"],
    "FINAL_PRODUCT_ORIGIN_EVENT_INVALID",
  );
  if (
    origin.origin !== (mode === "fixture" ? "task_owned_fixture" : "real_product_adapter") ||
    origin.fixtureUsed !== (mode === "fixture") ||
    origin.manualDescriptorInjection !== false ||
    origin.directMcpBypass !== false
  ) {
    fail("FINAL_PRODUCT_ORIGIN_EVENT_INVALID");
  }
  const productPath = events
    .filter((event) => event.type === "product_step")
    .map((event) => exactData(event, ["step"], "FINAL_PRODUCT_PATH_EVENT_INVALID").step);
  if (
    stable(productPath) !==
    stable(["Connect", "Initialize", "Discover", "Normalize", "Fingerprint"])
  ) {
    fail("FINAL_PRODUCT_PATH_EVENT_INVALID");
  }
  installedLoaded(events);
  const published = events
    .filter((event) => event.type === "tool_published")
    .map((event) =>
      exactData(event, ["descriptor", "canonicalSha256"], "FINAL_PRODUCT_TOOL_EVENT_INVALID"),
    );
  if (published.length !== TOOL_NAMES.length) fail("FINAL_PRODUCT_TOOL_EVENT_INVALID");
  const toolSummaries = published.map(({ descriptor, canonicalSha256 }, index) => {
    assertExactKeys(
      descriptor,
      ["name", "schemaVersion", "inputSchema"],
      "FINAL_PRODUCT_TOOL_EVENT_INVALID",
    );
    if (
      descriptor.name !== TOOL_NAMES[index] ||
      descriptor.schemaVersion !== "mvp15d.asset-tools.v1" ||
      canonicalSha256 !== sha256Bytes(Buffer.from(stable(descriptor), "utf8"))
    ) {
      fail("FINAL_PRODUCT_TOOL_EVENT_INVALID");
    }
    return { name: descriptor.name, schemaVersion: descriptor.schemaVersion, canonicalSha256 };
  });
  const retractions = events
    .filter((event) => event.type === "tool_retracted")
    .map((event) => exactData(event, ["reason", "count"], "FINAL_PRODUCT_RETRACTION_INVALID"));
  const expectedRetractions = [
    "disconnect",
    "endpoint_change",
    "failure",
    "reconnect",
    "renderer_restart",
    "newer_generation",
  ];
  if (
    stable(retractions.map(({ reason }) => reason)) !== stable(expectedRetractions) ||
    retractions.some(({ count }) => count !== TOOL_NAMES.length)
  ) {
    fail("FINAL_PRODUCT_RETRACTION_INVALID");
  }
  const mutation = exactData(
    oneEvent(events, "mutation_observed", "FINAL_PRODUCT_MUTATION_EVENT_INVALID"),
    ["count"],
    "FINAL_PRODUCT_MUTATION_EVENT_INVALID",
  );
  if (mutation.count !== 0) fail("FINAL_PRODUCT_MUTATION_EVENT_INVALID");
  return {
    captureOrigin: origin.origin,
    fixtureUsed: origin.fixtureUsed,
    manualDescriptorInjection: false,
    directMcpBypass: false,
    productPath,
    installedLoadedVerified: true,
    toolNames: TOOL_NAMES,
    toolNamesSha256: sha256Bytes(Buffer.from(stable(TOOL_NAMES), "utf8")),
    toolSummaries,
    toolsetSha256: sha256Bytes(Buffer.from(stable(toolSummaries), "utf8")),
    retractions: expectedRetractions,
    mutationCount: 0,
    processResidualCount: closeout.processResidualCount,
    portResidualCount: closeout.portResidualCount,
  };
}

function deriveUi(events, closeout, mode) {
  const origin = exactData(
    oneEvent(events, "capture_origin", "FINAL_UI_ORIGIN_EVENT_INVALID"),
    ["origin", "fixtureUsed"],
    "FINAL_UI_ORIGIN_EVENT_INVALID",
  );
  if (
    origin.origin !== (mode === "fixture" ? "task_owned_fixture" : "rendered_product_ui") ||
    origin.fixtureUsed !== (mode === "fixture")
  ) {
    fail("FINAL_UI_ORIGIN_EVENT_INVALID");
  }
  const renderedUiPath = events
    .filter((event) => event.type === "rendered_step")
    .map((event) => exactData(event, ["step"], "FINAL_UI_PATH_EVENT_INVALID").step);
  if (stable(renderedUiPath) !== stable(["validate", "add", "confirmTrust"])) {
    fail("FINAL_UI_PATH_EVENT_INVALID");
  }
  const actions = events
    .filter((event) => event.type === "lifecycle_action")
    .map((event) =>
      exactData(event, ["direction", "action", "sideEffectCount"], "FINAL_UI_ACTION_EVENT_INVALID"),
    );
  const forwardOrder = actions
    .filter(({ direction }) => direction === "forward")
    .map(({ action }) => action);
  const inverseOrder = actions
    .filter(({ direction }) => direction === "inverse")
    .map(({ action }) => action);
  if (
    stable(forwardOrder) !== stable(FORWARD_ORDER) ||
    stable(inverseOrder) !== stable(INVERSE_ORDER) ||
    actions.some(({ sideEffectCount }) => sideEffectCount !== 0)
  ) {
    fail("FINAL_UI_ACTION_EVENT_INVALID");
  }
  const negative = exactData(
    oneEvent(events, "negative_matrix", "FINAL_UI_NEGATIVE_EVENT_INVALID"),
    ["caseCount", "passedCount"],
    "FINAL_UI_NEGATIVE_EVENT_INVALID",
  );
  const partial = exactData(
    oneEvent(events, "partial_unknown_effect", "FINAL_UI_PARTIAL_EVENT_INVALID"),
    ["covered"],
    "FINAL_UI_PARTIAL_EVENT_INVALID",
  );
  const rootState = exactData(
    oneEvent(events, "run_root_state", "FINAL_UI_ROOT_EVENT_INVALID"),
    ["removed"],
    "FINAL_UI_ROOT_EVENT_INVALID",
  );
  const ownership = exactData(
    oneEvent(events, "ownership_state", "FINAL_UI_OWNERSHIP_EVENT_INVALID"),
    ["closed"],
    "FINAL_UI_OWNERSHIP_EVENT_INVALID",
  );
  if (
    negative.caseCount !== 8 ||
    negative.passedCount !== negative.caseCount ||
    partial.covered !== true ||
    rootState.removed !== true ||
    ownership.closed !== true
  ) {
    fail("FINAL_UI_LIFECYCLE_EVENT_INVALID");
  }
  const replaySideEffectDelta =
    mode === "live"
      ? events
          .filter((event) => event.type === "replay_observation")
          .map((event) =>
            exactData(event, ["action", "sideEffectDelta"], "FINAL_UI_REPLAY_EVENT_INVALID"),
          )
      : [];
  if (
    mode === "live" &&
    (stable(replaySideEffectDelta.map(({ action }) => action)) !== stable(FORWARD_ORDER) ||
      replaySideEffectDelta.some(({ sideEffectDelta }) => sideEffectDelta !== 0))
  ) {
    fail("FINAL_UI_REPLAY_EVENT_INVALID");
  }
  return {
    captureOrigin: origin.origin,
    fixtureUsed: origin.fixtureUsed,
    renderedUiPath,
    readOnlySource: "/Game/Test01",
    forwardOrder,
    inverseOrder,
    ledger: {
      forwardEventCount: forwardOrder.length,
      inverseEventCount: inverseOrder.length,
      sideEffectCount: 0,
      forbiddenTotal: 0,
      ...(mode === "live"
        ? {
            replaySideEffectDelta: replaySideEffectDelta.map(
              ({ sideEffectDelta }) => sideEffectDelta,
            ),
          }
        : {}),
    },
    negativeMatrixComplete: true,
    negativeCaseCount: negative.caseCount,
    partialUnknownEffectCovered: true,
    contentSha256: snapshotPair(events, "FINAL_UI_CONTENT_EVENT_INVALID"),
    contentRestored: true,
    runRootRemoved: true,
    ownershipClosed: true,
    processResidualCount: closeout.processResidualCount,
    portResidualCount: closeout.portResidualCount,
  };
}

function derivedFor(kind, events, closeout, mode) {
  if (kind === "ue-automation") return deriveUe(events, closeout, mode);
  if (kind === "product-capture") return deriveProduct(events, closeout, mode);
  return deriveUi(events, closeout, mode);
}

function executeFixturePhase(kind, args) {
  const { repository, root } = validateRoot(args, true);
  const taskId = validateTaskId(args["task-id"]);
  const { marker, port } = validateMarkerPort(args);
  const { sessionId, generation } = validatePhaseSession(args, kind, "fixture");
  if (args.input) fail("FINAL_PHASE_ARGUMENT_INVALID");
  const paths = phasePaths(root, kind);
  if (Object.values(paths).some((path) => existsSync(path))) fail("FINAL_PHASE_OUTPUT_EXISTS");
  const producer = requireFile(
    resolve(repository, "scripts", "mvp15d-final-phase-fixture-producer.mjs"),
    "FINAL_PHASE_PRODUCER_MISSING",
  );
  const vector = [
    "--phase",
    kind,
    "--task-id",
    taskId,
    "--marker",
    marker,
    "--session",
    sessionId,
    "--generation",
    String(generation),
    "--port",
    String(port),
  ];
  const result = spawnSync(process.execPath, [producer, ...vector], {
    cwd: repository,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, UAGENT_FINAL_FIXTURE_FAULT: "" },
  });
  const capturedAt = new Date().toISOString();
  writeFileSync(paths.events, result.stdout ?? "", { encoding: "utf8", flag: "wx" });
  writeFileSync(paths.stderr, result.stderr ?? "", { encoding: "utf8", flag: "wx" });
  const ledger = {
    schemaVersion: PRODUCER_LEDGER_SCHEMA,
    phase: kind,
    taskId,
    marker,
    sessionId,
    generation,
    port,
    producer: {
      id: FIXTURE_PRODUCER_ID,
      relativePath: "scripts/mvp15d-final-phase-fixture-producer.mjs",
      size: lstatSync(producer).size,
      sha256: sha256File(producer),
    },
    executable: {
      basename: basename(process.execPath),
      size: lstatSync(process.execPath).size,
      sha256: sha256File(process.execPath),
    },
    argumentVector: vector,
    argumentVectorSha256: sha256Bytes(Buffer.from(stable(vector), "utf8")),
    outputs: {
      events: {
        relativePath: toLogical(relative(root, paths.events)),
        size: lstatSync(paths.events).size,
        sha256: sha256File(paths.events),
      },
      stderr: {
        relativePath: toLogical(relative(root, paths.stderr)),
        size: lstatSync(paths.stderr).size,
        sha256: sha256File(paths.stderr),
      },
    },
    childPid: result.pid ?? null,
    exitCode: Number.isInteger(result.status) ? result.status : null,
    capturedAt,
  };
  writeFileSync(paths.ledger, `${JSON.stringify(ledger, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  if (result.error || result.status !== 0 || !Number.isSafeInteger(result.pid)) {
    fail("FINAL_PHASE_PRODUCER_NONZERO");
  }
  const parsed = parsePhaseEvents(result.stdout, kind, {
    taskId,
    marker,
    sessionId,
    generation,
    port,
    mode: "fixture",
    pid: result.pid,
    producerId: FIXTURE_PRODUCER_ID,
  });
  const sourceArtifacts = [
    artifactBinding(root, paths.events, capturedAt, FIXTURE_PRODUCER_ID, "raw", EVENT_SCHEMA),
    artifactBinding(root, paths.stderr, capturedAt, FIXTURE_PRODUCER_ID, "raw", "text/plain"),
    artifactBinding(
      root,
      paths.ledger,
      capturedAt,
      "mvp15d-final-runner",
      "raw",
      PRODUCER_LEDGER_SCHEMA,
    ),
  ];
  const summary = {
    schemaVersion:
      kind === "ue-automation"
        ? UE_SCHEMA
        : kind === "product-capture"
          ? PRODUCT_SCHEMA
          : UI_SCHEMA,
    taskGeneration: TASK_GENERATION,
    taskId,
    evidenceMode: "fixture",
    sessionId,
    generation,
    producerLedgerSha256: sha256File(paths.ledger),
    ...derivedFor(kind, parsed.events, parsed.closeout, "fixture"),
    sourceArtifacts,
  };
  writeFileSync(paths.summary, `${JSON.stringify(summary, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return verifyPhaseSummary(kind, { ...args, input: paths.summary });
}

function outputBinding(root, path) {
  return {
    relativePath: toLogical(relative(root, path)),
    size: lstatSync(path).size,
    sha256: sha256File(path),
  };
}

function rootIdentitySha256(root) {
  return sha256Bytes(Buffer.from(toLogical(resolve(root)).toLowerCase(), "utf8"));
}

function redactArgumentVector(vector, identity, args) {
  const replacements = new Map([
    [identity.repository.toLowerCase(), "<repository>"],
    [identity.root.toLowerCase(), "<evidence-root>"],
    ...(args["ue-root"] ? [[resolve(args["ue-root"]).toLowerCase(), "<ue-root>"]] : []),
  ]);
  return vector.map((value) => replacements.get(value.toLowerCase()) ?? value);
}

function replaceLiteral(text, value, replacement) {
  if (!value) return text;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(escaped, "gi"), replacement);
}

function redactProducerStderr(text, identity, args) {
  const raw = String(text ?? "");
  const sensitive =
    /\b(?:securitytoken|authorization|bearer|api[_-]?key|client[_-]?secret|password|private[_ -]?key)\b/i.test(
      raw,
    );
  if (sensitive) {
    return {
      text: `${JSON.stringify({
        status: "producer_stderr_rejected",
        reason: "FINAL_PHASE_STDERR_SENSITIVE",
      })}\n`,
      sensitive: true,
    };
  }
  let redacted = raw;
  for (const [value, replacement] of [
    [identity.root, "<evidence-root>"],
    [identity.repository, "<repository>"],
    [args["ue-root"] ? resolve(args["ue-root"]) : null, "<ue-root>"],
    [process.env.USERPROFILE, "<user-home>"],
  ]) {
    redacted = replaceLiteral(redacted, value, replacement);
  }
  redacted = redacted
    .replace(/\\\\[^\\/\s]+[\\/][^\r\n"'<>|]*/g, "<unc-path>")
    .replace(/\b[A-Za-z]:[\\/][^\r\n"'<>|]*/g, "<absolute-path>");
  return { text: redacted, sensitive: false };
}

function liveLedger({
  kind,
  identity,
  taskId,
  ownership,
  session,
  launch,
  producer,
  producerPath,
  paths,
  result,
  capturedAt,
  closeout,
  runtimeProcess,
  runtimeTransport,
  productionProvenance,
  firstFailure,
  args,
}) {
  const argumentVector = redactArgumentVector(launch.vector, identity, args);
  const helperPath = requireFile(
    resolve(identity.repository, LIVE_PRODUCER_HELPER.relativePath),
    "FINAL_PHASE_PRODUCER_MISSING",
  );
  return {
    schemaVersion: PRODUCER_LEDGER_SCHEMA,
    taskGeneration: TASK_GENERATION,
    phase: kind,
    taskId,
    evidenceRoot: basename(identity.root),
    evidenceRootSha256: rootIdentitySha256(identity.root),
    sourceCommit: launch.sourceCommit,
    marker: ownership.marker,
    sessionId: session.sessionId,
    endpoint: launch.endpoint,
    generation: session.generation,
    port: ownership.port,
    producer: {
      id: producer.id,
      mode: "live",
      relativePath: producer.relativePath,
      size: lstatSync(producerPath).size,
      sha256: sha256File(producerPath),
      helper: {
        relativePath: LIVE_PRODUCER_HELPER.relativePath,
        size: lstatSync(helperPath).size,
        sha256: sha256File(helperPath),
      },
    },
    executable: {
      basename: basename(process.execPath),
      size: lstatSync(process.execPath).size,
      sha256: sha256File(process.execPath),
    },
    argumentVector,
    argumentVectorSha256: sha256Bytes(Buffer.from(stable(launch.vector), "utf8")),
    outputs: {
      stdout: outputBinding(identity.root, paths.stdout),
      stderr: outputBinding(identity.root, paths.stderr),
      events: outputBinding(identity.root, paths.events),
      ...(existsSync(paths.runtimeEvents)
        ? { runtimeEvents: outputBinding(identity.root, paths.runtimeEvents) }
        : {}),
    },
    processOwnership: {
      kind: "task_owned",
      marker: ownership.marker,
      parentPid: process.pid,
      childPid: Number.isSafeInteger(result.pid) ? result.pid : null,
      closed: true,
    },
    termination: {
      exitCode: Number.isInteger(result.status) ? result.status : null,
      signal: typeof result.signal === "string" ? result.signal : null,
      errorCode: typeof result.error?.code === "string" ? result.error.code : null,
    },
    runtimeProcess,
    runtimeTransport,
    productionProvenance,
    closeout,
    firstFailure,
    capturedAt,
  };
}

function writeFirstFailure(kind, paths, binding, result, reason, capturedAt) {
  const value = {
    schemaVersion: FIRST_FAILURE_SCHEMA,
    taskGeneration: TASK_GENERATION,
    taskId: binding.taskId,
    phase: kind,
    status: "failed",
    reason,
    exitCode: Number.isInteger(result.status) ? result.status : null,
    signal: typeof result.signal === "string" ? result.signal : null,
    errorCode: typeof result.error?.code === "string" ? result.error.code : null,
    stdoutSha256: sha256File(paths.stdout),
    stderrSha256: sha256File(paths.stderr),
    capturedAt,
  };
  writeFileSync(paths.firstFailure, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return outputBinding(binding.root, paths.firstFailure);
}

function issueOwnedLaunchReceipt({ kind, identity, taskId, launch, producerPath, paths, result }) {
  const receipt = Object.freeze({
    kind,
    repository: identity.repository,
    root: identity.root,
    taskId,
    sourceCommit: launch.sourceCommit,
    producerPath,
    argumentVectorSha256: sha256Bytes(Buffer.from(stable(launch.vector), "utf8")),
    parentPid: process.pid,
    childPid: result.pid,
    exitCode: result.status,
    launcher: spawnSync,
    producerLedgerSha256: sha256File(paths.ledger),
    summarySha256: sha256File(paths.summary),
  });
  OWNED_LAUNCH_RECEIPTS.add(receipt);
  return receipt;
}

function verifyOwnedLaunchAuthority(kind, args, receipt) {
  const code = "FINAL_PHASE_OWNED_LAUNCH_RECEIPT_INVALID";
  if (!OWNED_LAUNCH_RECEIPTS.has(receipt)) fail(code);
  try {
    const { repository, root } = validateRoot(args, true);
    const taskId = validateTaskId(args["task-id"]);
    const paths = phasePaths(root, kind);
    const persisted = verifyPhaseSummary(kind, args);
    const ledger = readJson(paths.ledger, code);
    const expectedProducerPath = resolve(repository, LIVE_PRODUCERS[kind].relativePath);
    if (
      receipt.kind !== kind ||
      receipt.repository !== repository ||
      receipt.root !== root ||
      receipt.taskId !== taskId ||
      receipt.sourceCommit !== ledger.sourceCommit ||
      receipt.producerPath !== expectedProducerPath ||
      receipt.argumentVectorSha256 !== ledger.argumentVectorSha256 ||
      receipt.parentPid !== process.pid ||
      receipt.parentPid !== ledger.processOwnership.parentPid ||
      receipt.childPid !== ledger.processOwnership.childPid ||
      receipt.exitCode !== 0 ||
      receipt.launcher !== spawnSync ||
      receipt.producerLedgerSha256 !== sha256File(paths.ledger) ||
      receipt.summarySha256 !== sha256File(paths.summary) ||
      persisted.persistedArtifactConsistencyVerified !== true ||
      persisted.productionLaunchAuthorityVerified !== false
    ) {
      fail(code);
    }
    return {
      ...persisted,
      status: `${kind.replaceAll("-", "_")}_owned_launch_verified`,
      productionLaunchAuthorityVerified: true,
    };
  } finally {
    OWNED_LAUNCH_RECEIPTS.delete(receipt);
  }
}

function executeOwnedLaunchReceiptFixture() {
  if (arguments.length !== 0) fail("FINAL_PHASE_ARGUMENT_INVALID");
  const kind = "product-capture";
  const taskId = DEFAULT_TASK_ID;
  const marker = "uagent-mvp15d-owned-receipt-fixture-0001";
  const sessionId = "final-owned-receipt-fixture-session-0001";
  const generation = 1;
  const port = 31429;
  const producerId = FIXTURE_PRODUCER_ID;
  const producerPath = requireFile(
    resolve(
      fileURLToPath(new URL(".", import.meta.url)),
      "mvp15d-final-phase-fixture-producer.mjs",
    ),
    "FINAL_PHASE_PRODUCER_MISSING",
  );
  const vector = [
    "--phase",
    kind,
    "--task-id",
    taskId,
    "--marker",
    marker,
    "--session",
    sessionId,
    "--generation",
    String(generation),
    "--port",
    String(port),
  ];
  const result = spawnSync(process.execPath, [producerPath, ...vector], {
    cwd: resolve(fileURLToPath(new URL("..", import.meta.url))),
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0 || !Number.isSafeInteger(result.pid)) {
    fail("FINAL_PHASE_PRODUCER_NONZERO");
  }
  const parsed = parsePhaseEvents(result.stdout, kind, {
    taskId,
    marker,
    sessionId,
    generation,
    port,
    mode: "fixture",
    pid: result.pid,
    producerId,
  });
  const receipt = Object.freeze({
    scope: "fixture",
    kind,
    producerPath,
    argumentVectorSha256: sha256Bytes(Buffer.from(stable(vector), "utf8")),
    parentPid: process.pid,
    childPid: result.pid,
    exitCode: result.status,
    launcher: spawnSync,
    outputSha256: sha256Bytes(Buffer.from(result.stdout, "utf8")),
  });
  OWNED_LAUNCH_RECEIPTS.add(receipt);
  try {
    if (
      !OWNED_LAUNCH_RECEIPTS.has(receipt) ||
      receipt.scope !== "fixture" ||
      receipt.kind !== kind ||
      receipt.producerPath !== producerPath ||
      receipt.argumentVectorSha256 !== parsed.argumentVectorSha256 ||
      receipt.parentPid !== process.pid ||
      receipt.childPid !== result.pid ||
      receipt.exitCode !== 0 ||
      receipt.launcher !== spawnSync ||
      receipt.outputSha256 !== sha256Bytes(Buffer.from(result.stdout, "utf8")) ||
      Object.values(parsed.closeout).some((count) => count !== 0)
    ) {
      fail("FINAL_PHASE_OWNED_LAUNCH_RECEIPT_INVALID");
    }
    return {
      status: "owned_launch_receipt_fixture_verified",
      fixtureUsed: true,
      ownedLaunchReceiptVerified: true,
      persistedArtifactConsistencyVerified: false,
      productionLaunchAuthorityVerified: false,
      childPid: result.pid,
      eventCount: parsed.events.length,
    };
  } finally {
    OWNED_LAUNCH_RECEIPTS.delete(receipt);
  }
}

function executeLivePhase(kind, args) {
  if (arguments.length !== 2) fail("FINAL_PHASE_PRODUCTION_LAUNCH_REQUIRED");
  const identity = validateRoot(args, true);
  const taskId = validateTaskId(args["task-id"]);
  const ownership = validateMarkerPort(args);
  const session = validatePhaseSession(args, kind, "live");
  const launch = liveProducerVector(kind, args, identity, taskId, ownership, session);
  const paths = phasePaths(identity.root, kind);
  if (Object.values(paths).some((path) => existsSync(path))) fail("FINAL_PHASE_OUTPUT_EXISTS");
  const producer = LIVE_PRODUCERS[kind];
  const producerPath = requireFile(
    resolve(identity.repository, producer.relativePath),
    "FINAL_PHASE_PRODUCER_MISSING",
  );
  const result = spawnSync(process.execPath, [producerPath, ...launch.vector], {
    cwd: identity.repository,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  const capturedAt = new Date().toISOString();
  const stderr = redactProducerStderr(result.stderr, identity, args);
  writeFileSync(paths.stdout, result.stdout ?? "", { encoding: "utf8", flag: "wx" });
  writeFileSync(paths.stderr, stderr.text, { encoding: "utf8", flag: "wx" });

  let parsed = null;
  let failure = null;
  if (stderr.sensitive) {
    failure = new FinalRunnerError("FINAL_PHASE_STDERR_SENSITIVE");
  } else if (result.error || result.status !== 0 || !Number.isSafeInteger(result.pid)) {
    failure = new FinalRunnerError("FINAL_PHASE_PRODUCER_NONZERO");
  } else {
    try {
      parsed = parsePhaseEvents(result.stdout, kind, {
        taskId,
        marker: ownership.marker,
        sessionId: session.sessionId,
        generation: session.generation,
        port: ownership.port,
        endpoint: launch.endpoint,
        mode: "live",
        pid: result.pid,
        producerId: producer.id,
      });
    } catch (error) {
      failure = error;
    }
  }
  if (failure) {
    const reason =
      failure instanceof FinalRunnerError ? failure.code : (failure?.code ?? "FINAL_PHASE_FAILED");
    const firstFailure = writeFirstFailure(
      kind,
      paths,
      { ...identity, taskId },
      result,
      reason,
      capturedAt,
    );
    const ledger = liveLedger({
      kind,
      identity,
      taskId,
      ownership,
      session,
      launch,
      producer,
      producerPath,
      paths,
      result,
      capturedAt,
      closeout: null,
      runtimeProcess: null,
      runtimeTransport: null,
      productionProvenance: null,
      firstFailure,
      args,
    });
    writeFileSync(paths.ledger, `${JSON.stringify(ledger, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    rmSync(paths.summary, { force: true });
    throw failure;
  }

  const ledger = liveLedger({
    kind,
    identity,
    taskId,
    ownership,
    session,
    launch,
    producer,
    producerPath,
    paths,
    result,
    capturedAt,
    closeout: parsed.closeout,
    runtimeProcess: parsed.runtimeProcess,
    runtimeTransport: parsed.runtimeTransport,
    productionProvenance: parsed.productionProvenance,
    firstFailure: null,
    args,
  });
  writeFileSync(paths.ledger, `${JSON.stringify(ledger, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  const sourceArtifacts = [
    artifactBinding(identity.root, paths.events, capturedAt, producer.id, "raw", EVENT_SCHEMA),
    artifactBinding(
      identity.root,
      paths.stderr,
      capturedAt,
      producer.id,
      "deterministically-redacted",
      "text/plain",
    ),
    artifactBinding(
      identity.root,
      paths.ledger,
      capturedAt,
      "mvp15d-final-runner",
      "raw",
      PRODUCER_LEDGER_SCHEMA,
    ),
    artifactBinding(
      identity.root,
      paths.runtimeEvents,
      capturedAt,
      producer.id,
      "raw",
      RUNTIME_EVENT_SCHEMA,
    ),
  ];
  if (kind === "ue-automation") {
    const earlyIdentityRelativePath = parsed.productionProvenance.earlyIdentity.relativePath;
    sourceArtifacts.push(
      artifactBinding(
        identity.root,
        resolve(identity.root, earlyIdentityRelativePath.split("/").join("\\")),
        capturedAt,
        producer.id,
        "raw",
        EARLY_IDENTITY_SCHEMA,
      ),
      artifactBinding(
        identity.root,
        resolve(identity.root, "captures", "loaded-modules.json"),
        capturedAt,
        producer.id,
        "raw",
        LOADED_LEDGER_SCHEMA,
      ),
      artifactBinding(
        identity.root,
        resolve(identity.root, "metadata", "ue-automation.job-closeout.json"),
        capturedAt,
        producer.id,
        "raw",
        JOB_CLOSEOUT_SCHEMA,
      ),
    );
  }
  const summary = {
    schemaVersion:
      kind === "ue-automation"
        ? UE_SCHEMA
        : kind === "product-capture"
          ? PRODUCT_SCHEMA
          : UI_SCHEMA,
    taskGeneration: TASK_GENERATION,
    taskId,
    sourceCommit: launch.sourceCommit,
    evidenceMode: "live",
    persistedOriginClaimConsistent: parsed.persistedOriginClaimConsistent,
    productionLaunchAuthorityVerified: false,
    sessionId: session.sessionId,
    endpoint: launch.endpoint,
    generation: session.generation,
    producerLedgerSha256: sha256File(paths.ledger),
    ...derivedFor(kind, parsed.events, parsed.closeout, "live"),
    sourceArtifacts,
  };
  writeFileSync(paths.summary, `${JSON.stringify(summary, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  try {
    const receipt = issueOwnedLaunchReceipt({
      kind,
      identity,
      taskId,
      launch,
      producerPath,
      paths,
      result,
    });
    return verifyOwnedLaunchAuthority(kind, { ...args, input: paths.summary }, receipt);
  } catch (error) {
    rmSync(paths.summary, { force: true });
    throw error;
  }
}

function verifyPhaseSummary(kind, args) {
  const { repository, root } = validateRoot(args, true);
  const taskId = validateTaskId(args["task-id"]);
  const paths = phasePaths(root, kind);
  const input = resolve(args.input ?? paths.summary);
  if (input !== paths.summary) fail("FINAL_PHASE_SUMMARY_NONCANONICAL");
  const summary = readJson(input, "FINAL_PHASE_SUMMARY_INVALID");
  validateSummarySources(root, summary, "FINAL_PHASE_SOURCE_INVALID");
  const eventsArtifact = summary.sourceArtifacts.find(
    ({ relativePath, schema }) =>
      relativePath === toLogical(relative(root, paths.events)) && schema === EVENT_SCHEMA,
  );
  const ledgerArtifact = summary.sourceArtifacts.find(
    ({ relativePath, schema }) =>
      relativePath === toLogical(relative(root, paths.ledger)) && schema === PRODUCER_LEDGER_SCHEMA,
  );
  const runtimeEventsArtifact = summary.sourceArtifacts.find(
    ({ relativePath, schema }) =>
      relativePath === toLogical(relative(root, paths.runtimeEvents)) &&
      schema === RUNTIME_EVENT_SCHEMA,
  );
  const loadedLedgerArtifact = summary.sourceArtifacts.find(
    ({ relativePath, schema }) =>
      relativePath === "captures/loaded-modules.json" && schema === LOADED_LEDGER_SCHEMA,
  );
  const jobCloseoutArtifact = summary.sourceArtifacts.find(
    ({ relativePath, schema }) =>
      relativePath === "metadata/ue-automation.job-closeout.json" && schema === JOB_CLOSEOUT_SCHEMA,
  );
  const earlyIdentityArtifact = summary.sourceArtifacts.find(
    ({ relativePath, schema }) =>
      relativePath === `metadata/ue-automation.${summary.sessionId}.early-identity.json` &&
      schema === EARLY_IDENTITY_SCHEMA,
  );
  if (
    !eventsArtifact ||
    !ledgerArtifact ||
    (summary.evidenceMode === "live" && !runtimeEventsArtifact) ||
    (summary.evidenceMode === "live" &&
      kind === "ue-automation" &&
      (!loadedLedgerArtifact || !earlyIdentityArtifact || !jobCloseoutArtifact))
  ) {
    fail("FINAL_PHASE_SOURCE_COVERAGE_INVALID");
  }
  const ledger = readJson(paths.ledger, "FINAL_PHASE_LEDGER_INVALID");
  const isLive = summary.evidenceMode === "live";
  assertExactKeys(
    ledger,
    isLive
      ? [
          "schemaVersion",
          "taskGeneration",
          "phase",
          "taskId",
          "evidenceRoot",
          "evidenceRootSha256",
          "sourceCommit",
          "marker",
          "sessionId",
          "endpoint",
          "generation",
          "port",
          "producer",
          "executable",
          "argumentVector",
          "argumentVectorSha256",
          "outputs",
          "processOwnership",
          "termination",
          "runtimeProcess",
          "runtimeTransport",
          "productionProvenance",
          "closeout",
          "firstFailure",
          "capturedAt",
        ]
      : [
          "schemaVersion",
          "phase",
          "taskId",
          "marker",
          "sessionId",
          "generation",
          "port",
          "producer",
          "executable",
          "argumentVector",
          "argumentVectorSha256",
          "outputs",
          "childPid",
          "exitCode",
          "capturedAt",
        ],
    "FINAL_PHASE_LEDGER_INVALID",
  );
  assertExactKeys(
    ledger.outputs,
    isLive ? ["events", "runtimeEvents", "stderr", "stdout"] : ["events", "stderr"],
    "FINAL_PHASE_LEDGER_INVALID",
  );
  assertExactKeys(
    ledger.producer,
    isLive
      ? ["id", "mode", "relativePath", "size", "sha256", "helper"]
      : ["id", "relativePath", "size", "sha256"],
    "FINAL_PHASE_LEDGER_INVALID",
  );
  if (isLive) {
    assertExactKeys(
      ledger.producer.helper,
      ["relativePath", "size", "sha256"],
      "FINAL_PHASE_LEDGER_INVALID",
    );
  }
  assertExactKeys(ledger.executable, ["basename", "size", "sha256"], "FINAL_PHASE_LEDGER_INVALID");
  for (const output of Object.values(ledger.outputs)) {
    assertExactKeys(output, ["relativePath", "size", "sha256"], "FINAL_PHASE_LEDGER_INVALID");
    const path = resolve(root, output.relativePath.split("/").join("\\"));
    if (
      !within(root, path) ||
      lstatSync(requireFile(path, "FINAL_PHASE_LEDGER_INVALID")).size !== output.size ||
      sha256File(path) !== output.sha256
    ) {
      fail("FINAL_PHASE_LEDGER_OUTPUT_MISMATCH");
    }
  }
  const producer = isLive
    ? LIVE_PRODUCERS[kind]
    : {
        id: FIXTURE_PRODUCER_ID,
        relativePath: "scripts/mvp15d-final-phase-fixture-producer.mjs",
      };
  const producerPath = resolve(repository, producer.relativePath);
  const helperPath = isLive ? resolve(repository, LIVE_PRODUCER_HELPER.relativePath) : null;
  const expectedVector = isLive
    ? [
        "--repository",
        repository,
        "--evidence-root",
        root,
        "--task-id",
        taskId,
        "--task-generation",
        TASK_GENERATION,
        "--source-commit",
        ledger.sourceCommit,
        "--marker",
        ledger.marker,
        "--session",
        ledger.sessionId,
        "--endpoint",
        `http://127.0.0.1:${ledger.port}/mcp`,
        "--generation",
        String(ledger.generation),
        "--port",
        String(ledger.port),
        ...(kind === "ue-automation" ? ["--ue-root", resolve(args["ue-root"] ?? "")] : []),
      ]
    : [
        "--phase",
        kind,
        "--task-id",
        taskId,
        "--marker",
        ledger.marker,
        "--session",
        ledger.sessionId,
        "--generation",
        String(ledger.generation),
        "--port",
        String(ledger.port),
      ];
  const expectedLedgerVector = isLive
    ? redactArgumentVector(expectedVector, { repository, root }, args)
    : expectedVector;
  if (isLive) {
    assertExactKeys(
      ledger.processOwnership,
      ["kind", "marker", "parentPid", "childPid", "closed"],
      "FINAL_PHASE_LEDGER_INVALID",
    );
    assertExactKeys(
      ledger.termination,
      ["exitCode", "signal", "errorCode"],
      "FINAL_PHASE_LEDGER_INVALID",
    );
    assertExactKeys(
      ledger.runtimeProcess,
      ["pid", "endpoint", "marker", "executable", "argumentVectorSha256"],
      "FINAL_PHASE_LEDGER_INVALID",
    );
    assertExactKeys(
      ledger.runtimeProcess.executable,
      ["basename", "size", "sha256"],
      "FINAL_PHASE_LEDGER_INVALID",
    );
    assertExactKeys(
      ledger.runtimeTransport,
      ["bridgeVersion", "eventFile", "nonceSha256", "asynchronous", "jobOwned"],
      "FINAL_PHASE_LEDGER_INVALID",
    );
    assertExactKeys(
      ledger.runtimeTransport.eventFile,
      ["relativePath", "size", "sha256"],
      "FINAL_PHASE_LEDGER_INVALID",
    );
    assertExactKeys(
      ledger.closeout,
      ["processResidualCount", "portResidualCount", "markerResidualCount", "partialOutputCount"],
      "FINAL_PHASE_LEDGER_INVALID",
    );
  }
  const runtimeExecutablePath = isLive
    ? requireFile(
        kind === "ue-automation"
          ? resolve(args["ue-root"] ?? "", "Engine", "Binaries", "Win64", "UnrealEditor-Cmd.exe")
          : resolve(repository, "apps", "desktop", "src-tauri", "target", "release", "uagent.exe"),
        "FINAL_PHASE_RUNTIME_EXECUTABLE_INVALID",
      )
    : null;
  if (isLive && /^[0-9a-f]{40}$/.test(ledger.sourceCommit ?? "")) {
    validateRepositoryCommit(repository, ledger.sourceCommit);
  }
  if (
    ledger.schemaVersion !== PRODUCER_LEDGER_SCHEMA ||
    ledger.phase !== kind ||
    ledger.taskId !== taskId ||
    (isLive
      ? ledger.taskGeneration !== TASK_GENERATION ||
        ledger.evidenceRoot !== basename(root) ||
        ledger.evidenceRootSha256 !== rootIdentitySha256(root) ||
        !/^[0-9a-f]{40}$/.test(ledger.sourceCommit) ||
        ledger.endpoint !== `http://127.0.0.1:${ledger.port}/mcp` ||
        ledger.processOwnership.kind !== "task_owned" ||
        ledger.processOwnership.marker !== ledger.marker ||
        !Number.isSafeInteger(ledger.processOwnership.parentPid) ||
        !Number.isSafeInteger(ledger.processOwnership.childPid) ||
        ledger.processOwnership.closed !== true ||
        ledger.termination.exitCode !== 0 ||
        ledger.termination.signal !== null ||
        ledger.termination.errorCode !== null ||
        !Number.isSafeInteger(ledger.runtimeProcess.pid) ||
        ledger.runtimeProcess.endpoint !== ledger.endpoint ||
        ledger.runtimeProcess.marker !== ledger.marker ||
        ledger.runtimeProcess.executable.basename !== basename(runtimeExecutablePath) ||
        ledger.runtimeProcess.executable.size !== lstatSync(runtimeExecutablePath).size ||
        ledger.runtimeProcess.executable.sha256 !== sha256File(runtimeExecutablePath) ||
        !isHex(ledger.runtimeProcess.argumentVectorSha256) ||
        ledger.runtimeTransport.eventFile.relativePath !==
          `transcripts/${kind}.runtime-events.jsonl` ||
        stable(ledger.runtimeTransport.eventFile) !== stable(ledger.outputs.runtimeEvents) ||
        !isHex(ledger.runtimeTransport.nonceSha256) ||
        (kind !== "ue-automation" && ledger.runtimeTransport.asynchronous !== true) ||
        typeof ledger.runtimeTransport.jobOwned !== "boolean" ||
        ledger.firstFailure !== null ||
        Object.values(ledger.closeout).some((count) => count !== 0)
      : ledger.exitCode !== 0 || !Number.isSafeInteger(ledger.childPid)) ||
    ledger.producer?.id !== producer.id ||
    (isLive && ledger.producer.mode !== "live") ||
    ledger.producer.relativePath !== producer.relativePath ||
    ledger.producer.size !== lstatSync(producerPath).size ||
    ledger.producer.sha256 !== sha256File(producerPath) ||
    (isLive &&
      (ledger.producer.helper.relativePath !== LIVE_PRODUCER_HELPER.relativePath ||
        ledger.producer.helper.size !==
          lstatSync(requireFile(helperPath, "FINAL_PHASE_LEDGER_INVALID")).size ||
        ledger.producer.helper.sha256 !== sha256File(helperPath))) ||
    ledger.executable.basename !== basename(process.execPath) ||
    ledger.executable.size !== lstatSync(process.execPath).size ||
    ledger.executable.sha256 !== sha256File(process.execPath) ||
    stable(ledger.argumentVector) !== stable(expectedLedgerVector) ||
    summary.producerLedgerSha256 !== sha256File(paths.ledger)
  ) {
    fail("FINAL_PHASE_LEDGER_INVALID");
  }
  if (
    isLive &&
    (ledger.outputs.stdout.relativePath !== ledger.outputs.events.relativePath ||
      ledger.outputs.stdout.size !== ledger.outputs.events.size ||
      ledger.outputs.stdout.sha256 !== ledger.outputs.events.sha256 ||
      !summary.sourceArtifacts.some(
        ({ relativePath, schema, redactionStatus }) =>
          relativePath === toLogical(relative(root, paths.stderr)) &&
          schema === "text/plain" &&
          redactionStatus === "deterministically-redacted",
      ))
  ) {
    fail("FINAL_PHASE_SOURCE_COVERAGE_INVALID");
  }
  const childPid = isLive ? ledger.processOwnership.childPid : ledger.childPid;
  const parsed = parsePhaseEvents(readFileSync(paths.events, "utf8"), kind, {
    taskId,
    marker: ledger.marker,
    sessionId: ledger.sessionId,
    generation: ledger.generation,
    port: ledger.port,
    endpoint: isLive ? ledger.endpoint : null,
    mode: summary.evidenceMode,
    pid: childPid,
    producerId: producer.id,
  });
  if (
    (isLive &&
      (stable(parsed.runtimeProcess) !== stable(ledger.runtimeProcess) ||
        stable(parsed.runtimeTransport) !== stable(ledger.runtimeTransport) ||
        stable(parsed.productionProvenance) !== stable(ledger.productionProvenance))) ||
    parsed.argumentVectorSha256 !== ledger.argumentVectorSha256 ||
    ledger.argumentVectorSha256 !== sha256Bytes(Buffer.from(stable(expectedVector), "utf8"))
  ) {
    fail("FINAL_PHASE_ARGUMENT_VECTOR_MISMATCH");
  }
  if (isLive && kind === "ue-automation") {
    verifyUeProductionArtifactConsistency(
      repository,
      root,
      ledger,
      parsed.events,
      runtimeExecutablePath,
    );
  }
  const expected = {
    schemaVersion:
      kind === "ue-automation"
        ? UE_SCHEMA
        : kind === "product-capture"
          ? PRODUCT_SCHEMA
          : UI_SCHEMA,
    taskGeneration: TASK_GENERATION,
    taskId,
    ...(isLive ? { sourceCommit: ledger.sourceCommit } : {}),
    evidenceMode: isLive ? "live" : "fixture",
    ...(isLive
      ? {
          persistedOriginClaimConsistent: parsed.persistedOriginClaimConsistent,
          productionLaunchAuthorityVerified: false,
        }
      : {}),
    sessionId: ledger.sessionId,
    ...(isLive ? { endpoint: ledger.endpoint } : {}),
    generation: ledger.generation,
    producerLedgerSha256: sha256File(paths.ledger),
    ...derivedFor(kind, parsed.events, parsed.closeout, isLive ? "live" : "fixture"),
    sourceArtifacts: summary.sourceArtifacts,
  };
  if (stable(summary) !== stable(expected)) fail("FINAL_PHASE_SUMMARY_SOURCE_DISAGREEMENT");
  return {
    status: `${kind.replaceAll("-", "_")}_${isLive ? "persisted_consistency" : "fixture"}_verified`,
    persistedArtifactConsistencyVerified: true,
    productionLaunchAuthorityVerified: false,
    eventCount: parsed.events.length,
    mutationCount: expected.mutationCount ?? 0,
  };
}

function validateUeAutomation(args) {
  return verifyPhaseSummary("ue-automation", args);
}

function validateProductCapture(args) {
  return verifyPhaseSummary("product-capture", args);
}

function validateUiLifecycle(args) {
  return verifyPhaseSummary("ui-lifecycle", args);
}

function walkEvidence(root, current = "", state) {
  const output = state ?? {
    files: [],
    directories: [],
    folded: new Map(),
  };
  const path = current ? resolve(root, current.split("/").join("\\")) : root;
  for (const entry of readdirSync(requireDirectory(path, "FINAL_INVENTORY_PATH_INVALID"), {
    withFileTypes: true,
  }).sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    if (entry.isSymbolicLink()) fail("FINAL_INVENTORY_LINK_REPARSE");
    const logical = current ? `${current}/${entry.name}` : entry.name;
    if (logical === "inventory.json") continue;
    const folded = logical.toLowerCase();
    if (output.folded.has(folded)) fail("FINAL_INVENTORY_CASE_COLLISION");
    output.folded.set(folded, logical);
    const child = resolve(root, logical.split("/").join("\\"));
    if (!within(root, child)) fail("FINAL_INVENTORY_ESCAPE");
    const stats = lstatSync(child);
    if (entry.isDirectory() && stats.isDirectory()) {
      output.directories.push(logical);
      walkEvidence(root, logical, output);
    } else if (entry.isFile() && stats.isFile()) {
      output.files.push({
        path: logical,
        size: stats.size,
        sha256: sha256File(child),
      });
    } else {
      fail("FINAL_INVENTORY_SPECIAL_FILE");
    }
  }
  return output;
}

function validateKnownRoots(walked) {
  for (const entry of [...walked.directories, ...walked.files.map(({ path }) => path)]) {
    const top = entry.split("/")[0];
    if (!ALLOWED_TOP_LEVEL.has(top)) fail("FINAL_INVENTORY_UNKNOWN_PATH");
  }
}

function validateRetainedSources(root, walked) {
  const transcriptFiles = walked.files.filter(
    ({ path, size }) => size > 0 && (path.startsWith("logs/") || path.startsWith("transcripts/")),
  );
  if (transcriptFiles.length === 0) fail("FINAL_INVENTORY_TRANSCRIPT_EMPTY");
  for (const summary of walked.files.filter(
    ({ path }) => path.startsWith("summaries/") && path.endsWith(".json"),
  )) {
    const value = readJson(
      resolve(root, summary.path.split("/").join("\\")),
      "FINAL_INVENTORY_SUMMARY_INVALID",
    );
    validateSummarySources(root, value, "FINAL_INVENTORY_SOURCE_LINK_INVALID");
  }
}

function inventoryBase(taskId, walked) {
  const directories = [...walked.directories].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  const files = [...walked.files].sort((left, right) => left.path.localeCompare(right.path, "en"));
  const bundleSha256 = sha256Bytes(
    Buffer.from(
      files.map(({ path, size, sha256 }) => `${path}\0${size}\0${sha256}`).join("\n"),
      "utf8",
    ),
  );
  return {
    schemaVersion: INVENTORY_SCHEMA,
    taskGeneration: TASK_GENERATION,
    taskId,
    directoryCount: directories.length,
    fileCount: files.length,
    directories,
    files,
    bundleSha256,
  };
}

function inventoryCreate(args) {
  const { root } = validateRoot(args, true);
  const inventoryPath = resolve(root, "inventory.json");
  if (existsSync(inventoryPath)) fail("FINAL_INVENTORY_ALREADY_EXISTS");
  const walked = walkEvidence(root);
  validateKnownRoots(walked);
  validateRetainedSources(root, walked);
  const base = inventoryBase(validateTaskId(args["task-id"]), walked);
  const inventory = {
    ...base,
    inventorySelfSha256: sha256Bytes(Buffer.from(stable(base), "utf8")),
  };
  writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return {
    status: "inventory_created",
    fileCount: inventory.fileCount,
    directoryCount: inventory.directoryCount,
    inventorySelfSha256: inventory.inventorySelfSha256,
    inventoryFileSha256: sha256File(inventoryPath),
    bundleSha256: inventory.bundleSha256,
  };
}

function inventoryVerify(args) {
  const { root } = validateRoot(args, true);
  const path = resolve(root, "inventory.json");
  const inventory = readJson(path, "FINAL_INVENTORY_INVALID");
  assertExactKeys(
    inventory,
    [
      "schemaVersion",
      "taskGeneration",
      "taskId",
      "directoryCount",
      "fileCount",
      "directories",
      "files",
      "bundleSha256",
      "inventorySelfSha256",
    ],
    "FINAL_INVENTORY_INVALID",
  );
  const walked = walkEvidence(root);
  validateKnownRoots(walked);
  validateRetainedSources(root, walked);
  const base = inventoryBase(validateTaskId(args["task-id"]), walked);
  if (
    inventory.schemaVersion !== INVENTORY_SCHEMA ||
    inventory.taskGeneration !== TASK_GENERATION ||
    stable(base) !==
      stable(
        Object.fromEntries(
          Object.entries(inventory).filter(([key]) => key !== "inventorySelfSha256"),
        ),
      ) ||
    inventory.inventorySelfSha256 !== sha256Bytes(Buffer.from(stable(base), "utf8"))
  ) {
    fail("FINAL_INVENTORY_RECOMPUTE_MISMATCH");
  }
  return {
    status: "inventory_verified",
    fileCount: inventory.fileCount,
    directoryCount: inventory.directoryCount,
    inventorySelfSha256: inventory.inventorySelfSha256,
    inventoryFileSha256: sha256File(path),
    bundleSha256: inventory.bundleSha256,
  };
}

function closeout(args) {
  const { root } = validateRoot(args, true);
  const value = readJson(resolve(args.input ?? ""), "FINAL_CLOSEOUT_INVALID");
  assertExactKeys(
    value,
    [
      "schemaVersion",
      "taskGeneration",
      "taskId",
      "taskOwnedProcessCount",
      "portResidualCount",
      "markerResidualCount",
      "cacheResidualCount",
      "projectResidualCount",
      "sandboxResidualCount",
      "partialPackageCount",
      "unclassifiedResidualCount",
      "sourceArtifacts",
    ],
    "FINAL_CLOSEOUT_INVALID",
  );
  if (
    value.schemaVersion !== CLOSEOUT_SCHEMA ||
    value.taskGeneration !== TASK_GENERATION ||
    value.taskId !== validateTaskId(args["task-id"]) ||
    [
      value.taskOwnedProcessCount,
      value.portResidualCount,
      value.markerResidualCount,
      value.cacheResidualCount,
      value.projectResidualCount,
      value.sandboxResidualCount,
      value.partialPackageCount,
      value.unclassifiedResidualCount,
    ].some((count) => count !== 0)
  ) {
    fail("FINAL_CLOSEOUT_RESIDUAL");
  }
  validateSummarySources(root, value, "FINAL_CLOSEOUT_SOURCE_INVALID");
  return { status: "closeout_verified", residualCount: 0 };
}

function manifestArgs(args) {
  return {
    source: args.source,
    "package-root": args["package-root"] ?? args.package,
    runuat: args.runuat,
    "ue-root": args["ue-root"],
    manifest: args.manifest,
    builder: args.builder,
    "builder-kind": args["builder-kind"],
    "build-ledger": args["build-ledger"],
    "build-result": args["build-result"],
  };
}

function runPhaseCommand(kind, args) {
  const mode = args.mode ?? "plan";
  if (mode === "plan") return phasePlan(kind, args);
  if (mode === "fixture") return executeFixturePhase(kind, args);
  if (mode === "verify") return verifyPhaseSummary(kind, args);
  if (mode === "live") return executeLivePhase(kind, args);
  fail("FINAL_PHASE_MODE_INVALID");
}

function run(command, args) {
  if (command === "preflight") return preflight(args);
  if (command === "build-plan") return runBuild(buildArgs(args, "plan"));
  if (command === "build") return runBuild(buildArgs(args, "live"));
  if (command === "manifest-create") return create(manifestArgs(args));
  if (command === "manifest-verify") return verify(manifestArgs(args));
  if (command === "project-create") return projectCreate(args);
  if (command === "package-install") return packageInstall(args);
  if (command === "ue-automation") {
    return runPhaseCommand(command, args);
  }
  if (command === "product-capture") {
    return runPhaseCommand(command, args);
  }
  if (command === "ui-lifecycle") {
    return runPhaseCommand(command, args);
  }
  if (command === "inventory-create") return inventoryCreate(args);
  if (command === "inventory-verify") return inventoryVerify(args);
  if (command === "closeout") return closeout(args);
  fail("FINAL_COMMAND_INVALID");
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const output = run(command, parseArgs(rest));
  console.log(JSON.stringify(output));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    const reason =
      error instanceof FinalRunnerError ? error.code : (error?.code ?? "FINAL_RUNNER_FAILED");
    console.error(JSON.stringify({ status: "final_command_rejected", reason }));
    process.exitCode = 2;
  }
}

export {
  CLOSEOUT_SCHEMA,
  FORWARD_ORDER,
  FinalRunnerError,
  INVENTORY_SCHEMA,
  INVERSE_ORDER,
  PRODUCT_SCHEMA,
  TASK_GENERATION,
  TOOL_NAMES,
  UE_SCHEMA,
  UI_SCHEMA,
  EVENT_SCHEMA,
  inventoryCreate,
  inventoryVerify,
  run,
  validateProductCapture,
  validateUiLifecycle,
  validateUeAutomation,
  validateEarlyIdentityArtifact,
  verifyUeProductionArtifactConsistency,
  executeFixturePhase,
  executeOwnedLaunchReceiptFixture,
  executeLivePhase,
  verifyPhaseSummary,
  ROOT_PATTERN as FINAL_ROOT,
};
