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
const PRODUCT_SCHEMA = "uagent.mvp15d.final.product-capture.v2";
const UI_SCHEMA = "uagent.mvp15d.final.ui-lifecycle.v1";
const UE_SCHEMA = "uagent.mvp15d.final.ue-automation.v1";
const INVENTORY_SCHEMA = "uagent.mvp15d.final.inventory.v1";
const CLOSEOUT_SCHEMA = "uagent.mvp15d.final.closeout.v1";
const EVENT_SCHEMA = "uagent.mvp15d.final.phase-event.v1";
const RUNTIME_EVENT_SCHEMA = "uagent.mvp15d.final.runtime-event.v2";
const FINGERPRINT_SCHEMA = "uagent.mvp15.live-asset-toolset-fingerprint.v1";
const LIVE_AUTHORITY_LEVELS = new Set([
  "fixed_producer",
  "native_observed",
  "parent_observed",
  "runtime_observed",
]);
const PRODUCER_LEDGER_SCHEMA = "uagent.mvp15d.final.producer-ledger.v1";
const FIXTURE_PRODUCER_ID = "mvp15d-final-phase-fixture-producer";
const FIRST_FAILURE_SCHEMA = "uagent.mvp15d.final.first-failure.v1";
const JOB_CLOSEOUT_SCHEMA = "uagent.mvp15d.final.job-closeout.v1";
const PORT_CLOSEOUT_SCHEMA = "uagent.mvp15d.final.port-closeout.v1";
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
const LIVE_DERIVATION_AUTHORITIES = new WeakMap();

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

function isObservationReceiptId(value) {
  return typeof value === "string" &&
    /^mvp15d-observation-receipt:[0-9a-f]{64}$/u.test(value);
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
    mutationAuthority: kind === "ui-lifecycle" ? "rendered_ui_native_guard" : "none",
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
          "endpoint_change",
          "failure",
          "newer_generation",
          "attestation_invalidation",
          "renderer_restart",
        ],
        zeroMutation: true,
      },
    };
  }
  return {
    status: "ui_lifecycle_planned",
    plan: {
      ...shared,
      renderedUiPath: [
        "validate",
        "add",
        "confirmTrust",
        "observationDiscover",
        "observationAttach",
        "observationReady",
        "mcpConnect",
        "mcpInitialize",
        "mcpDiscover",
        "mcpNormalize",
        "mcpFingerprint",
        "dryRun",
        "approve",
        "register",
        "execute",
        "verify",
        "crossTtl",
        "rollback",
        "finalVerify",
        "replay",
        "observationStop",
        "mcpDisconnect",
      ],
      readOnlySource: "/Game/Test01",
      sandboxPrefix: "/Game/UAgentSandbox/<run-id>/",
      forwardOrder: FORWARD_ORDER,
      inverseOrder: INVERSE_ORDER,
      ledger: {
        dryRunActions: 1,
        dryRunCalls: 5,
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
    binding.mode === "live"
      ? [
          "authorityLevel",
          "processResidualCount",
          "portResidualCount",
          "markerResidualCount",
          "partialOutputCount",
          "jobCloseoutSha256",
          "portObservationSha256",
          "runtimeProcessId",
          "phaseSessionId",
          "phaseGeneration",
        ]
      : ["processResidualCount", "portResidualCount", "markerResidualCount", "partialOutputCount"],
    "FINAL_PHASE_CLOSEOUT_INVALID",
  );
  if (
    processStarted.port !== binding.port ||
    !isHex(processStarted.argumentVectorSha256) ||
    processExited.exitCode !== 0 ||
    [
      closeout.processResidualCount,
      closeout.portResidualCount,
      closeout.markerResidualCount,
      closeout.partialOutputCount,
    ].some((count) => count !== 0) ||
    (binding.mode === "live" &&
      (closeout.authorityLevel !== "parent_observed" ||
        !isHex(closeout.jobCloseoutSha256) ||
        !isHex(closeout.portObservationSha256) ||
        closeout.phaseSessionId !== binding.sessionId ||
        closeout.phaseGeneration !== binding.generation))
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
    if (closeout.runtimeProcessId !== runtimeProcess.pid) {
      fail("FINAL_PHASE_CLOSEOUT_INVALID");
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
          : "uagent.mvp15d.runtime-bridge.v5") ||
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

function authorityData(event, keys, level, code) {
  const data = exactData(event, ["authorityLevel", ...keys], code);
  if (data.authorityLevel !== level) fail(code);
  return data;
}

function rejectSourceOnlyLiveEvents(events, code) {
  if (
    events.some(
      (event) =>
        event?.data?.authorityLevel === "source_only" ||
        (typeof event?.data?.authorityLevel === "string" &&
          !LIVE_AUTHORITY_LEVELS.has(event.data.authorityLevel) &&
          event.data.authorityLevel !== "derived_only"),
    )
  ) {
    fail(code);
  }
}

function canonicalToolDescriptor(descriptor, index, code) {
  assertExactKeys(
    descriptor,
    [
      "affectedAssetsSchema",
      "dryRunSchema",
      "evidenceQuery",
      "inputSchema",
      "methodId",
      "name",
      "rollbackContract",
      "schemaVersion",
      "source",
      "toolsetId",
    ],
    code,
  );
  if (
    descriptor.name !== TOOL_NAMES[index] ||
    typeof descriptor.schemaVersion !== "string" ||
    descriptor.schemaVersion.length === 0 ||
    !["direct", "facade"].includes(descriptor.source) ||
    !["affectedAssetsSchema", "dryRunSchema", "evidenceQuery", "inputSchema", "rollbackContract"].every(
      (key) =>
        descriptor[key] !== null &&
        typeof descriptor[key] === "object" &&
        !Array.isArray(descriptor[key]),
    ) ||
    !(descriptor.methodId === null || typeof descriptor.methodId === "string") ||
    !(descriptor.toolsetId === null || typeof descriptor.toolsetId === "string")
  ) {
    fail(code);
  }
  return descriptor;
}

function fixedArtifactAuthority(events, context, code) {
  const data = authorityData(
    oneEvent(events, "fixed_artifact_authority", code),
    [
      "sourceCommit",
      "sourceTreeSha256",
      "phaseSessionId",
      "phaseGeneration",
      "runtimeProcessId",
      "manifest",
      "packageInventory",
      "installedInventory",
      "loadedObserver",
      "modules",
      "producerBindingSha256",
    ],
    "fixed_producer",
    code,
  );
  for (const key of ["manifest", "packageInventory", "installedInventory", "loadedObserver"]) {
    assertExactKeys(
      data[key],
      key === "loadedObserver" ? ["ledgerSha256", "modulesSha256"] : ["sha256", "modulesSha256"],
      code,
    );
  }
  if (!Array.isArray(data.modules) || data.modules.length === 0) fail(code);
  for (const module of data.modules) {
    assertExactKeys(module, ["relativePath", "sha256"], code);
    if (
      typeof module.relativePath !== "string" ||
      module.relativePath.length === 0 ||
      module.relativePath.includes("\\") ||
      module.relativePath.startsWith("/") ||
      module.relativePath.split("/").includes("..") ||
      !isHex(module.sha256)
    ) {
      fail(code);
    }
  }
  const modulesSha256 = sha256Bytes(Buffer.from(stable(data.modules), "utf8"));
  const independentArtifactHashes = [
    data.manifest.sha256,
    data.packageInventory.sha256,
    data.installedInventory.sha256,
    data.loadedObserver.ledgerSha256,
  ];
  const bindingMaterial = Object.fromEntries(
    Object.entries(data).filter(([key]) => key !== "authorityLevel" && key !== "producerBindingSha256"),
  );
  if (
    !isHex(data.sourceCommit, 40) ||
    !isHex(data.sourceTreeSha256) ||
    data.sourceCommit !== context.sourceCommit ||
    data.sourceTreeSha256 !== context.sourceTreeSha256 ||
    data.phaseSessionId !== context.sessionId ||
    data.phaseGeneration !== context.generation ||
    data.runtimeProcessId !== context.runtimeProcessId ||
    independentArtifactHashes.some((value) => !isHex(value)) ||
    [
      data.manifest.modulesSha256,
      data.packageInventory.modulesSha256,
      data.installedInventory.modulesSha256,
      data.loadedObserver.modulesSha256,
    ].some((value) => value !== modulesSha256) ||
    data.producerBindingSha256 !== sha256Bytes(Buffer.from(stable(bindingMaterial), "utf8"))
  ) {
    fail(code);
  }
  return { data, modulesSha256 };
}

function issueLiveDerivationAuthority(scope, kind, parsed, context) {
  const processEvent = exactData(
    oneEvent(parsed.events, "runtime_process_started", "FINAL_PHASE_RUNTIME_PROCESS_INVALID"),
    ["pid", "endpoint", "marker", "executable", "argumentVectorSha256"],
    "FINAL_PHASE_RUNTIME_PROCESS_INVALID",
  );
  const fixedArtifact =
    kind === "product-capture" || kind === "ui-lifecycle"
      ? oneEvent(parsed.events, "fixed_artifact_authority", "FINAL_PHASE_FIXED_ARTIFACT_INVALID").data
      : null;
  const first = parsed.events[0];
  const receipt = Object.freeze({
    scope,
    kind,
    taskId: first.taskId,
    sessionId: first.sessionId,
    generation: first.generation,
    phaseProducerPid: first.producer.pid,
    sourceCommit: context.sourceCommit,
    sourceTreeSha256: context.sourceTreeSha256,
    runtimePid: parsed.runtimeProcess?.pid ?? processEvent.pid,
    runtimeProcessSha256: sha256Bytes(Buffer.from(stable(processEvent), "utf8")),
    processIdentitySha256: sha256Bytes(
      Buffer.from(
        stable({
          pid: parsed.runtimeProcess?.pid,
          executableBasename: parsed.runtimeProcess?.executable?.basename,
          executableSha256: parsed.runtimeProcess?.executable?.sha256,
        }),
        "utf8",
      ),
    ),
    fixedArtifactBindingSha256: fixedArtifact?.producerBindingSha256 ?? null,
    phaseEventsSha256: sha256Bytes(Buffer.from(stable(parsed.events), "utf8")),
    rawEventLedgerSha256: parsed.runtimeTransport?.eventFile?.sha256 ?? null,
    rawEventNonceSha256: parsed.runtimeTransport?.nonceSha256 ?? null,
    parentCloseoutSha256: sha256Bytes(Buffer.from(stable(parsed.closeout), "utf8")),
    jobCloseoutSha256: parsed.closeout?.jobCloseoutSha256 ?? null,
    portCloseoutSha256: parsed.closeout?.portObservationSha256 ?? null,
  });
  LIVE_DERIVATION_AUTHORITIES.set(receipt, { used: false });
  return receipt;
}

function verifyLiveDerivationAuthority(kind, events, closeout, context) {
  const code = kind === "product-capture" ? "FINAL_PRODUCT_LIVE_AUTHORITY_INVALID" : "FINAL_UI_LIVE_AUTHORITY_INVALID";
  const receipt = context?.ownedDerivationAuthority;
  const state = LIVE_DERIVATION_AUTHORITIES.get(receipt);
  const first = events[0];
  const processEvent = events.find(({ type }) => type === "runtime_process_started")?.data;
  const fixedArtifact = events.find(({ type }) => type === "fixed_artifact_authority")?.data;
  if (
    !state ||
    state.used ||
    !["owned-launch", "persisted-consistency"].includes(receipt.scope) ||
    receipt.kind !== kind ||
    receipt.taskId !== first?.taskId ||
    receipt.sessionId !== first?.sessionId ||
    receipt.generation !== first?.generation ||
    receipt.phaseProducerPid !== first?.producer?.pid ||
    receipt.sourceCommit !== context.sourceCommit ||
    receipt.sourceTreeSha256 !== context.sourceTreeSha256 ||
    receipt.runtimePid !== context.runtimeProcessId ||
    receipt.processIdentitySha256 !==
      sha256Bytes(
        Buffer.from(
          stable({
            pid: context.runtimeProcess?.pid,
            executableBasename: context.runtimeProcess?.executable?.basename,
            executableSha256: context.runtimeProcess?.executable?.sha256,
          }),
          "utf8",
        ),
      ) ||
    receipt.runtimeProcessSha256 !== sha256Bytes(Buffer.from(stable(processEvent), "utf8")) ||
    receipt.fixedArtifactBindingSha256 !== fixedArtifact?.producerBindingSha256 ||
    receipt.phaseEventsSha256 !== sha256Bytes(Buffer.from(stable(events), "utf8")) ||
    !isHex(receipt.rawEventLedgerSha256) ||
    !isHex(receipt.rawEventNonceSha256) ||
    receipt.parentCloseoutSha256 !== sha256Bytes(Buffer.from(stable(closeout), "utf8")) ||
    receipt.jobCloseoutSha256 !== closeout?.jobCloseoutSha256 ||
    receipt.portCloseoutSha256 !== closeout?.portObservationSha256
  ) {
    fail(code);
  }
  state.used = true;
  return receipt;
}

function persistedOwnedLaunchBinding(receipt) {
  if (!receipt || !LIVE_DERIVATION_AUTHORITIES.has(receipt)) {
    fail("FINAL_PHASE_OWNED_LAUNCH_RECEIPT_INVALID");
  }
  return {
    sourceCommit: receipt.sourceCommit,
    sourceTreeSha256: receipt.sourceTreeSha256,
    phaseProducerPid: receipt.phaseProducerPid,
    runtimePid: receipt.runtimePid,
    runtimeProcessSha256: receipt.runtimeProcessSha256,
    processIdentitySha256: receipt.processIdentitySha256,
    fixedArtifactBindingSha256: receipt.fixedArtifactBindingSha256,
    phaseEventsSha256: receipt.phaseEventsSha256,
    rawEventLedgerSha256: receipt.rawEventLedgerSha256,
    rawEventNonceSha256: receipt.rawEventNonceSha256,
    parentCloseoutSha256: receipt.parentCloseoutSha256,
    jobCloseoutSha256: receipt.jobCloseoutSha256,
    portCloseoutSha256: receipt.portCloseoutSha256,
  };
}

function deriveLiveProduct(events, closeout, context) {
  const code = "FINAL_PRODUCT_LIVE_AUTHORITY_INVALID";
  verifyLiveDerivationAuthority("product-capture", events, closeout, context);
  rejectSourceOnlyLiveEvents(events, code);
  for (const legacyType of [
    "installed_loaded",
    "tool_published",
    "tool_retracted",
    "tool_search_observation",
  ]) {
    if (events.some((event) => event.type === legacyType)) fail(code);
  }
  const origin = authorityData(
    oneEvent(events, "capture_origin", "FINAL_PRODUCT_ORIGIN_EVENT_INVALID"),
    ["origin", "fixtureUsed", "manualDescriptorInjection", "directMcpBypass"],
    "runtime_observed",
    "FINAL_PRODUCT_ORIGIN_EVENT_INVALID",
  );
  if (
    origin.origin !== "real_product_adapter" ||
    origin.fixtureUsed !== false ||
    origin.manualDescriptorInjection !== false ||
    origin.directMcpBypass !== false
  ) {
    fail("FINAL_PRODUCT_ORIGIN_EVENT_INVALID");
  }
  const productPath = events
    .filter((event) => event.type === "product_step")
    .map((event) => exactData(event, ["step"], "FINAL_PRODUCT_PATH_EVENT_INVALID").step);
  if (stable(productPath) !== stable(["Connect", "Initialize", "Discover", "Normalize", "Fingerprint"])) {
    fail("FINAL_PRODUCT_PATH_EVENT_INVALID");
  }
  const artifact = fixedArtifactAuthority(events, context, "FINAL_PRODUCT_ARTIFACT_AUTHORITY_INVALID");
  const observedReceipts = new Set();
  const observations = events
    .filter((event) => event.type === "product_discovery_observation")
    .map((event) =>
      authorityData(
        event,
        [
          "mode",
          "configInputSha256",
          "configOutputSha256",
          "mcpSessionId",
          "rendererInstanceId",
          "processIdentitySha256",
          "runtimePid",
          "generation",
          "descriptors",
          "fingerprintSha256",
          "mutationCount",
          "wireCalls",
          "receiptProvenance",
          "observationBindingSha256",
        ],
        "runtime_observed",
        "FINAL_PRODUCT_DISCOVERY_OBSERVATION_INVALID",
      ),
    );
  if (observations.length !== 2 || stable(observations.map(({ mode }) => mode)) !== stable(["on", "off"])) {
    fail("FINAL_PRODUCT_DISCOVERY_OBSERVATION_INVALID");
  }
  const normalized = observations.map((observation) => {
    if (!Array.isArray(observation.descriptors) || observation.descriptors.length !== TOOL_NAMES.length) {
      fail("FINAL_PRODUCT_DESCRIPTOR_FINGERPRINT_INVALID");
    }
    const descriptors = observation.descriptors.map((descriptor, index) =>
      canonicalToolDescriptor(descriptor, index, "FINAL_PRODUCT_DESCRIPTOR_FINGERPRINT_INVALID"),
    );
    const fingerprintSha256 = sha256Bytes(
      Buffer.from(stable({ schemaVersion: FINGERPRINT_SCHEMA, tools: descriptors }), "utf8"),
    );
    const bindingMaterial = Object.fromEntries(
      Object.entries(observation).filter(
        ([key]) => key !== "authorityLevel" && key !== "observationBindingSha256",
      ),
    );
    assertExactKeys(
      observation.receiptProvenance,
      [
        "config",
        "rendererInstance",
        "connect",
        "initialize",
        "discover",
        "normalize",
        "fingerprint",
        "attestation",
        "mutationCounter",
      ],
      "FINAL_PRODUCT_DISCOVERY_OBSERVATION_INVALID",
    );
    for (const receipt of Object.values(observation.receiptProvenance)) {
      receiptReference(receipt, "FINAL_PRODUCT_DISCOVERY_OBSERVATION_INVALID", observedReceipts);
    }
    if (!Array.isArray(observation.wireCalls)) {
      fail("FINAL_PRODUCT_TOOL_SEARCH_CROSS_BINDING_INVALID");
    }
    const wireNames = observation.wireCalls.map((wireCall) => {
      assertExactKeys(
        wireCall,
        ["id", "sequence", "name"],
        "FINAL_PRODUCT_TOOL_SEARCH_CROSS_BINDING_INVALID",
      );
      receiptReference(
        { id: wireCall.id, sequence: wireCall.sequence },
        "FINAL_PRODUCT_TOOL_SEARCH_CROSS_BINDING_INVALID",
        observedReceipts,
      );
      return wireCall.name;
    });
    if (
      stable(wireNames) !==
      stable(observation.mode === "on" ? ["list_toolsets", "describe_toolset"] : [])
    ) {
      fail("FINAL_PRODUCT_TOOL_SEARCH_CROSS_BINDING_INVALID");
    }
    if (
      !isHex(observation.configInputSha256) ||
      !isHex(observation.configOutputSha256) ||
      typeof observation.mcpSessionId !== "string" ||
      observation.mcpSessionId.length < 16 ||
      typeof observation.rendererInstanceId !== "string" ||
      observation.rendererInstanceId.length < 16 ||
      !isHex(observation.processIdentitySha256) ||
      observation.runtimePid !== context.runtimeProcessId ||
      !Number.isSafeInteger(observation.generation) ||
      observation.generation < 1 ||
      observation.fingerprintSha256 !== fingerprintSha256 ||
      observation.mutationCount !== 0 ||
      observation.observationBindingSha256 !==
        sha256Bytes(Buffer.from(stable(bindingMaterial), "utf8"))
    ) {
      fail("FINAL_PRODUCT_DESCRIPTOR_FINGERPRINT_INVALID");
    }
    return { observation, descriptors, fingerprintSha256 };
  });
  const semanticDescriptors = (descriptors) =>
    descriptors.map((descriptor) =>
      Object.fromEntries(
        Object.entries(descriptor).filter(
          ([key]) => !["source", "methodId", "toolsetId"].includes(key),
        ),
      ),
    );
  if (
    normalized[0].observation.mcpSessionId === normalized[1].observation.mcpSessionId ||
    normalized[0].observation.generation === normalized[1].observation.generation ||
    normalized[0].observation.configInputSha256 === normalized[1].observation.configInputSha256 ||
    stable(semanticDescriptors(normalized[0].descriptors)) !==
      stable(semanticDescriptors(normalized[1].descriptors)) ||
    normalized[0].observation.mode !== "on" ||
    normalized[1].observation.mode !== "off"
  ) {
    fail("FINAL_PRODUCT_TOOL_SEARCH_CROSS_BINDING_INVALID");
  }
  const expectedRetractions = [
    "disconnect",
    "endpoint_change",
    "failure",
    "newer_generation",
    "attestation_invalidation",
    "renderer_restart",
  ];
  const retractions = events
    .filter((event) => event.type === "retraction_observation")
    .map((event) =>
      authorityData(
        event,
        [
          "reason",
          "sessionIdBefore",
          "sessionIdAfter",
          "rendererInstanceIdBefore",
          "rendererInstanceIdAfter",
          "processIdentitySha256Before",
          "processIdentitySha256After",
          "generationBefore",
          "generationAfter",
          "fingerprintSha256",
          "count",
          "stateBeforeReceiptId",
          "stateAfterReceiptId",
          "readyStateReceipt",
          "readyAttestationReceipt",
          "actionReceipts",
          "transitionReceipt",
          "rendererInstanceReceipt",
          "nativeRetraction",
          "rendererHandoff",
          "observationBindingSha256",
        ],
        "runtime_observed",
        "FINAL_PRODUCT_RETRACTION_SOURCE_INVALID",
      ),
    );
  if (
    retractions.length !== expectedRetractions.length ||
    stable(retractions.map(({ reason }) => reason)) !== stable(expectedRetractions) ||
    new Set(retractions.map(({ sessionIdBefore }) => sessionIdBefore)).size !== retractions.length
  ) {
    fail("FINAL_PRODUCT_RETRACTION_SOURCE_INVALID");
  }
  const actionReceiptIds = new Set();
  for (const record of retractions) {
    assertExactKeys(
      record.nativeRetraction,
      [
        "api",
        "receiptId",
        "receiptSequence",
        "requestSha256",
        "responseSha256",
        "applied",
        "revokedApprovalCount",
        "generation",
      ],
      "FINAL_PRODUCT_RETRACTION_SOURCE_INVALID",
    );
    receiptReference(
      record.readyStateReceipt,
      "FINAL_PRODUCT_RETRACTION_SOURCE_INVALID",
      observedReceipts,
    );
    receiptReference(
      record.readyAttestationReceipt,
      "FINAL_PRODUCT_RETRACTION_SOURCE_INVALID",
      observedReceipts,
    );
    if (!Array.isArray(record.actionReceipts) || record.actionReceipts.length === 0) {
      fail("FINAL_PRODUCT_RETRACTION_SOURCE_INVALID");
    }
    const actions = record.actionReceipts.map((receipt) => {
      assertExactKeys(
        receipt,
        ["api", "id", "sequence"],
        "FINAL_PRODUCT_RETRACTION_SOURCE_INVALID",
      );
      if (
        typeof receipt.api !== "string" ||
        receipt.api.length === 0 ||
        !isObservationReceiptId(receipt.id) ||
        !Number.isSafeInteger(receipt.sequence) ||
        receipt.sequence <= record.readyAttestationReceipt.sequence ||
        actionReceiptIds.has(receipt.id)
      ) {
        fail("FINAL_PRODUCT_RETRACTION_SOURCE_INVALID");
      }
      actionReceiptIds.add(receipt.id);
      return receipt;
    });
    const actionApis = actions.map(({ api }) => api);
    const requiredActionApis = {
      disconnect: ["renderer_instance_begin", "mcp_disconnect", "retract_mvp15_companion_approvals"],
      endpoint_change: ["renderer_instance_begin", "mcp_connect", "retract_mvp15_companion_approvals"],
      failure: ["renderer_instance_begin", "mcp_transport_failure", "retract_mvp15_companion_approvals"],
      newer_generation: ["renderer_instance_begin", "mcp_fingerprint", "retract_mvp15_companion_approvals"],
      attestation_invalidation: ["renderer_instance_begin", "retract_mvp15_companion_approvals"],
      renderer_restart: [
        "renderer_restart_request",
        "renderer_parent_lifecycle_acknowledgement",
        "renderer_restart_successor",
        "renderer_instance_begin",
        "mcp_connect",
        "mcp_fingerprint",
        "retract_mvp15_companion_approvals",
      ],
    }[record.reason];
    if (
      !requiredActionApis ||
      requiredActionApis.some((api) => !actionApis.includes(api)) ||
      (record.reason === "renderer_restart" &&
        actionApis.filter((api) => api === "renderer_instance_begin").length < 2)
    ) {
      fail("FINAL_PRODUCT_RETRACTION_SOURCE_INVALID");
    }
    receiptReference(
      record.transitionReceipt,
      "FINAL_PRODUCT_RETRACTION_SOURCE_INVALID",
      observedReceipts,
    );
    receiptReference(
      record.rendererInstanceReceipt,
      "FINAL_PRODUCT_RETRACTION_SOURCE_INVALID",
      observedReceipts,
    );
    inlineReceipt(record.nativeRetraction, "FINAL_PRODUCT_RETRACTION_SOURCE_INVALID", observedReceipts);
    if (record.reason === "renderer_restart") {
      assertExactKeys(
        record.rendererHandoff,
        [
          "handoffId",
          "requestReceipt",
          "parentAcknowledgementReceipt",
          "claimReceipt",
          "parentRuntime",
          "destroyOutcome",
          "successorCreationOutcome",
          "predecessorWindow",
          "predecessorRenderer",
          "successorRenderer",
          "predecessorMcpSessionId",
          "successorMcpSessionId",
          "predecessorMcpGeneration",
          "successorMcpGeneration",
        ],
        "FINAL_PRODUCT_RENDERER_RESTART_INVALID",
      );
      receiptReference(
        record.rendererHandoff.requestReceipt,
        "FINAL_PRODUCT_RENDERER_RESTART_INVALID",
        observedReceipts,
      );
      receiptReference(
        record.rendererHandoff.parentAcknowledgementReceipt,
        "FINAL_PRODUCT_RENDERER_RESTART_INVALID",
        observedReceipts,
      );
      receiptReference(
        record.rendererHandoff.claimReceipt,
        "FINAL_PRODUCT_RENDERER_RESTART_INVALID",
        observedReceipts,
      );
      for (const renderer of [
        record.rendererHandoff.predecessorRenderer,
        record.rendererHandoff.successorRenderer,
      ]) {
        assertExactKeys(
          renderer,
          ["status", "rendererInstanceId", "processIdentitySha256", "process"],
          "FINAL_PRODUCT_RENDERER_RESTART_INVALID",
        );
        assertExactKeys(
          renderer.process,
          ["pid", "startTime", "executableBasename", "runtimePid"],
          "FINAL_PRODUCT_RENDERER_RESTART_INVALID",
        );
      }
      assertExactKeys(
        record.rendererHandoff.parentRuntime,
        [
          "pid",
          "executableBasename",
          "executableSha256",
          "sourceCommit",
          "processIdentitySha256",
        ],
        "FINAL_PRODUCT_RENDERER_RESTART_INVALID",
      );
      for (const outcome of [
        record.rendererHandoff.destroyOutcome,
        record.rendererHandoff.successorCreationOutcome,
      ]) {
        assertExactKeys(outcome, ["status", "reason"], "FINAL_PRODUCT_RENDERER_RESTART_INVALID");
      }
      assertExactKeys(
        record.rendererHandoff.predecessorWindow,
        [
          "schemaVersion",
          "status",
          "windowLabel",
          "taskId",
          "phase",
          "handoffId",
          "stableIdentitySha256",
        ],
        "FINAL_PRODUCT_RENDERER_RESTART_INVALID",
      );
      const predecessor = record.rendererHandoff.predecessorRenderer;
      const successor = record.rendererHandoff.successorRenderer;
      const predecessorWindow = record.rendererHandoff.predecessorWindow;
      if (
        typeof record.rendererHandoff.handoffId !== "string" ||
        !record.rendererHandoff.handoffId.startsWith("renderer-handoff:") ||
        record.rendererHandoff.requestReceipt.sequence >=
          record.rendererHandoff.parentAcknowledgementReceipt.sequence ||
        record.rendererHandoff.parentAcknowledgementReceipt.sequence >=
          record.rendererHandoff.claimReceipt.sequence ||
        !actions.some(({ api, id }) =>
          api === "renderer_restart_request" && id === record.rendererHandoff.requestReceipt.id) ||
        !actions.some(({ api, id }) =>
          api === "renderer_parent_lifecycle_acknowledgement" &&
          id === record.rendererHandoff.parentAcknowledgementReceipt.id) ||
        !actions.some(({ api, id }) =>
          api === "renderer_restart_successor" && id === record.rendererHandoff.claimReceipt.id) ||
        record.rendererHandoff.destroyOutcome.status !== "succeeded" ||
        record.rendererHandoff.destroyOutcome.reason !== null ||
        record.rendererHandoff.successorCreationOutcome.status !== "succeeded" ||
        record.rendererHandoff.successorCreationOutcome.reason !== null ||
        predecessorWindow.schemaVersion !== "uagent.mvp15d.predecessor-window-identity.v1" ||
        predecessorWindow.status !== "observed" ||
        predecessorWindow.windowLabel !== "main" ||
        /[\\/]/u.test(predecessorWindow.windowLabel) ||
        predecessorWindow.taskId !== events[0]?.taskId ||
        predecessorWindow.phase !== "product-capture" ||
        predecessorWindow.handoffId !== record.rendererHandoff.handoffId ||
        !isHex(predecessorWindow.stableIdentitySha256) ||
        !Number.isSafeInteger(record.rendererHandoff.parentRuntime.pid) ||
        record.rendererHandoff.parentRuntime.pid < 1 ||
        typeof record.rendererHandoff.parentRuntime.executableBasename !== "string" ||
        !isHex(record.rendererHandoff.parentRuntime.executableSha256) ||
        !isHex(record.rendererHandoff.parentRuntime.processIdentitySha256) ||
        typeof record.rendererHandoff.parentRuntime.sourceCommit !== "string" ||
        predecessor.status !== "begun" ||
        successor.status !== "begun" ||
        predecessor.rendererInstanceId !== record.rendererInstanceIdBefore ||
        successor.rendererInstanceId !== record.rendererInstanceIdAfter ||
        predecessor.processIdentitySha256 !== record.processIdentitySha256Before ||
        successor.processIdentitySha256 !== record.processIdentitySha256After ||
        predecessor.process.pid === successor.process.pid ||
        predecessor.process.startTime === successor.process.startTime ||
        record.rendererHandoff.predecessorMcpSessionId !== record.sessionIdBefore ||
        record.rendererHandoff.successorMcpSessionId !== record.sessionIdAfter ||
        record.rendererHandoff.predecessorMcpGeneration !== record.generationBefore ||
        record.rendererHandoff.successorMcpGeneration !== record.generationAfter ||
        record.rendererHandoff.successorMcpGeneration <=
          record.rendererHandoff.predecessorMcpGeneration
      ) {
        fail("FINAL_PRODUCT_RENDERER_RESTART_INVALID");
      }
    } else if (record.rendererHandoff !== null) {
      fail("FINAL_PRODUCT_RENDERER_RESTART_INVALID");
    }
    const bindingMaterial = Object.fromEntries(
      Object.entries(record).filter(
        ([key]) => key !== "authorityLevel" && key !== "observationBindingSha256",
      ),
    );
    if (
      typeof record.sessionIdBefore !== "string" ||
      record.sessionIdBefore.length < 16 ||
      !(record.sessionIdAfter === null || (typeof record.sessionIdAfter === "string" && record.sessionIdAfter.length >= 16)) ||
      typeof record.rendererInstanceIdBefore !== "string" ||
      typeof record.rendererInstanceIdAfter !== "string" ||
      !isHex(record.processIdentitySha256Before) ||
      !isHex(record.processIdentitySha256After) ||
      !Number.isSafeInteger(record.generationBefore) ||
      !Number.isSafeInteger(record.generationAfter) ||
      record.generationBefore < 1 ||
      record.generationAfter < record.generationBefore ||
      record.fingerprintSha256 !== normalized[1].fingerprintSha256 ||
      record.count !== TOOL_NAMES.length ||
      record.nativeRetraction.api !== "retract_mvp15_companion_approvals" ||
      !isHex(record.nativeRetraction.requestSha256) ||
      !isHex(record.nativeRetraction.responseSha256) ||
      record.nativeRetraction.applied !== true ||
      !Number.isSafeInteger(record.nativeRetraction.generation) ||
      record.nativeRetraction.generation < 1 ||
      !Number.isSafeInteger(record.nativeRetraction.revokedApprovalCount) ||
      record.nativeRetraction.revokedApprovalCount < 0 ||
      record.observationBindingSha256 !== sha256Bytes(Buffer.from(stable(bindingMaterial), "utf8"))
    ) {
      fail("FINAL_PRODUCT_RETRACTION_SOURCE_INVALID");
    }
    if (
      record.stateBeforeReceiptId !== record.readyStateReceipt.id ||
      record.readyAttestationReceipt.sequence <= record.readyStateReceipt.sequence ||
      record.stateAfterReceiptId !== record.nativeRetraction.receiptId ||
      record.transitionReceipt.id === record.stateAfterReceiptId ||
      !actions.some(({ id }) => id === record.rendererInstanceReceipt.id) ||
      !actions.some(({ id }) => id === record.nativeRetraction.receiptId)
    ) {
      fail("FINAL_PRODUCT_RETRACTION_SOURCE_INVALID");
    }
    const rendererBoundaryChanged =
      record.rendererInstanceIdBefore !== record.rendererInstanceIdAfter &&
      record.processIdentitySha256Before !== record.processIdentitySha256After &&
      record.sessionIdAfter !== null &&
      record.sessionIdBefore !== record.sessionIdAfter;
    if (
      record.reason === "renderer_restart"
        ? !rendererBoundaryChanged
        : record.rendererInstanceIdBefore !== record.rendererInstanceIdAfter ||
          record.processIdentitySha256Before !== record.processIdentitySha256After
    ) {
      fail("FINAL_PRODUCT_RENDERER_RESTART_INVALID");
    }
    const expectedSessionTransition =
      record.reason === "endpoint_change" || record.reason === "renderer_restart"
        ? typeof record.sessionIdAfter === "string" && record.sessionIdAfter !== record.sessionIdBefore
        : record.reason === "newer_generation"
          ? record.sessionIdAfter === record.sessionIdBefore && record.generationAfter > record.generationBefore
          : record.sessionIdAfter === null;
    if (!expectedSessionTransition) {
      fail("FINAL_PRODUCT_RETRACTION_SOURCE_INVALID");
    }
  }
  const mutation = authorityData(
    oneEvent(events, "mutation_counter_observation", "FINAL_PRODUCT_MUTATION_EVENT_INVALID"),
    ["before", "after"],
    "runtime_observed",
    "FINAL_PRODUCT_MUTATION_EVENT_INVALID",
  );
  assertExactKeys(mutation.before, ["dryRun", "execute", "rollback"], "FINAL_PRODUCT_MUTATION_EVENT_INVALID");
  assertExactKeys(mutation.after, ["dryRun", "execute", "rollback"], "FINAL_PRODUCT_MUTATION_EVENT_INVALID");
  if (Object.values(mutation.before).some((count) => count !== 0) || stable(mutation.before) !== stable(mutation.after)) {
    fail("FINAL_PRODUCT_MUTATION_EVENT_INVALID");
  }
  const toolSummaries = normalized[0].descriptors.map((descriptor) => ({
    name: descriptor.name,
    schemaVersion: descriptor.schemaVersion,
    canonicalSha256: sha256Bytes(Buffer.from(stable(descriptor), "utf8")),
  }));
  const rendererRestart = retractions.find(({ reason }) => reason === "renderer_restart");
  return {
    captureOrigin: origin.origin,
    fixtureUsed: false,
    manualDescriptorInjection: false,
    directMcpBypass: false,
    productPath,
    installedLoadedVerified: true,
    artifactAuthorityBindingSha256: artifact.data.producerBindingSha256,
    toolSearchSessions: normalized.map(({ observation }) => ({
      mode: observation.mode,
      sessionId: observation.mcpSessionId,
      generation: observation.generation,
    })),
    toolNames: TOOL_NAMES,
    toolNamesSha256: sha256Bytes(Buffer.from(stable(TOOL_NAMES), "utf8")),
    toolSummaries,
    toolsetSha256: normalized[0].fingerprintSha256,
    retractions: expectedRetractions,
    rendererRestartHandoff: {
      handoffId: rendererRestart.rendererHandoff.handoffId,
      predecessorRendererInstanceId: rendererRestart.rendererInstanceIdBefore,
      successorRendererInstanceId: rendererRestart.rendererInstanceIdAfter,
      predecessorProcessIdentitySha256: rendererRestart.processIdentitySha256Before,
      successorProcessIdentitySha256: rendererRestart.processIdentitySha256After,
      predecessorMcpSessionId: rendererRestart.sessionIdBefore,
      successorMcpSessionId: rendererRestart.sessionIdAfter,
      predecessorMcpGeneration: rendererRestart.generationBefore,
      successorMcpGeneration: rendererRestart.generationAfter,
      requestReceiptId: rendererRestart.rendererHandoff.requestReceipt.id,
      requestReceiptSequence: rendererRestart.rendererHandoff.requestReceipt.sequence,
      parentAcknowledgementReceiptId:
        rendererRestart.rendererHandoff.parentAcknowledgementReceipt.id,
      parentAcknowledgementReceiptSequence:
        rendererRestart.rendererHandoff.parentAcknowledgementReceipt.sequence,
      claimReceiptId: rendererRestart.rendererHandoff.claimReceipt.id,
      claimReceiptSequence: rendererRestart.rendererHandoff.claimReceipt.sequence,
      predecessorWindowIdentity: rendererRestart.rendererHandoff.predecessorWindow,
    },
    nativeObservationReceiptCount: new Set([
      ...observedReceipts,
      ...actionReceiptIds,
    ]).size,
    mutationCount: 0,
    processResidualCount: closeout.processResidualCount,
    portResidualCount: closeout.portResidualCount,
  };
}

function counterVector(value, code) {
  if (
    !Array.isArray(value) ||
    value.length !== 5 ||
    value.some((count) => !Number.isSafeInteger(count) || count < 0)
  ) {
    fail(code);
  }
  return value;
}

function receiptReference(value, code, observedReceipts) {
  assertExactKeys(value, ["id", "sequence"], code);
  if (
    !isObservationReceiptId(value.id) ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    observedReceipts.has(value.id)
  ) {
    fail(code);
  }
  observedReceipts.add(value.id);
  return value;
}

function inlineReceipt(value, code, observedReceipts) {
  if (
    !isObservationReceiptId(value.receiptId) ||
    !Number.isSafeInteger(value.receiptSequence) ||
    value.receiptSequence < 1 ||
    observedReceipts.has(value.receiptId)
  ) {
    fail(code);
  }
  observedReceipts.add(value.receiptId);
}

function counterReceipt(value, expectedValues, code, observedReceipts) {
  assertExactKeys(value, ["receiptId", "receiptSequence", "counterNames", "values"], code);
  inlineReceipt(value, code, observedReceipts);
  if (
    stable(value.counterNames) !== stable(["native", "mcp", "provider", "verify", "rollback"]) ||
    stable(counterVector(value.values, code)) !== stable(expectedValues)
  ) {
    fail(code);
  }
}

function identityReceipts(value, code, observedReceipts) {
  assertExactKeys(value, ["sessionBegin", "registration"], code);
  receiptReference(value.sessionBegin, code, observedReceipts);
  receiptReference(value.registration, code, observedReceipts);
}

function closeoutReceipts(value, code, observedReceipts) {
  assertExactKeys(
    value,
    [
      "observationStopReceiptId",
      "observationStopReceiptSequence",
      "mcpDisconnectReceiptId",
      "mcpDisconnectReceiptSequence",
      "mcpTerminationStatus",
      "mcpTerminationHttpStatus",
      "serverDisconnected",
    ],
    code,
  );
  inlineReceipt(
    {
      receiptId: value.observationStopReceiptId,
      receiptSequence: value.observationStopReceiptSequence,
    },
    code,
    observedReceipts,
  );
  inlineReceipt(
    {
      receiptId: value.mcpDisconnectReceiptId,
      receiptSequence: value.mcpDisconnectReceiptSequence,
    },
    code,
    observedReceipts,
  );
  if (
    !["accepted", "unsupported"].includes(value.mcpTerminationStatus) ||
    !Number.isSafeInteger(value.mcpTerminationHttpStatus) ||
    (value.mcpTerminationStatus === "accepted" &&
      (value.mcpTerminationHttpStatus < 200 || value.mcpTerminationHttpStatus >= 300)) ||
    (value.mcpTerminationStatus === "unsupported" && value.mcpTerminationHttpStatus !== 405) ||
    value.serverDisconnected !== (value.mcpTerminationStatus === "accepted")
  ) {
    fail(code);
  }
}

function observedCall(value, expectedApi, expectedStatus, code, observedReceipts) {
  assertExactKeys(
    value,
    [
      "api",
      "receiptId",
      "receiptSequence",
      "requestSha256",
      "responseSha256",
      "status",
      "reason",
      "evidenceId",
    ],
    code,
  );
  inlineReceipt(value, code, observedReceipts);
  if (
    value.api !== expectedApi ||
    value.status !== expectedStatus ||
    typeof value.reason !== "string" ||
    value.reason.length === 0 ||
    !isHex(value.requestSha256) ||
    !isHex(value.responseSha256) ||
    typeof value.evidenceId !== "string" ||
    value.evidenceId.length < 8
  ) {
    fail(code);
  }
  return value;
}

function deriveLiveUi(events, closeout, context) {
  const code = "FINAL_UI_LIVE_AUTHORITY_INVALID";
  verifyLiveDerivationAuthority("ui-lifecycle", events, closeout, context);
  rejectSourceOnlyLiveEvents(events, code);
  for (const legacyType of [
    "installed_loaded",
    "content_snapshot",
    "lifecycle_action",
    "negative_case",
    "partial_unknown_effect_record",
    "replay_observation",
  ]) {
    if (events.some((event) => event.type === legacyType)) fail(code);
  }
  const origin = authorityData(
    oneEvent(events, "capture_origin", "FINAL_UI_ORIGIN_EVENT_INVALID"),
    ["origin", "fixtureUsed"],
    "runtime_observed",
    "FINAL_UI_ORIGIN_EVENT_INVALID",
  );
  if (origin.origin !== "rendered_product_ui" || origin.fixtureUsed !== false) {
    fail("FINAL_UI_ORIGIN_EVENT_INVALID");
  }
  const renderedUiPath = events
    .filter((event) => event.type === "rendered_step")
    .map((event) => exactData(event, ["step"], "FINAL_UI_PATH_EVENT_INVALID").step);
  const expectedRenderedUiPath = [
    "validate",
    "add",
    "confirmTrust",
    "observationDiscover",
    "observationAttach",
    "observationReady",
    "mcpConnect",
    "mcpInitialize",
    "mcpDiscover",
    "mcpNormalize",
    "mcpFingerprint",
    "dryRun",
    "approve",
    "register",
    "execute",
    "verify",
    "crossTtl",
    "rollback",
    "finalVerify",
    "replay",
    "observationStop",
    "mcpDisconnect",
  ];
  if (stable(renderedUiPath) !== stable(expectedRenderedUiPath)) {
    fail("FINAL_UI_PATH_EVENT_INVALID");
  }
  const artifact = fixedArtifactAuthority(events, context, "FINAL_UI_ARTIFACT_AUTHORITY_INVALID");
  const operationRecords = events
    .filter((event) => event.type === "lifecycle_operation_observation")
    .map((event) =>
      authorityData(
        event,
        [
          "direction",
          "action",
          "operationId",
          "registrationId",
          "runId",
          "nativeCall",
          "mcpCall",
          "sideEffectCount",
        ],
        "runtime_observed",
        "FINAL_UI_ACTION_SOURCE_INVALID",
      ),
    );
  const forward = operationRecords.filter(({ direction }) => direction === "forward");
  const inverse = operationRecords.filter(({ direction }) => direction === "inverse");
  const registrationIds = new Set(operationRecords.map(({ registrationId }) => registrationId));
  const runIds = new Set(operationRecords.map(({ runId }) => runId));
  const operationIds = new Set(operationRecords.map(({ operationId }) => operationId));
  if (
    stable(forward.map(({ action }) => action)) !== stable(FORWARD_ORDER) ||
    stable(inverse.map(({ action }) => action)) !== stable(INVERSE_ORDER) ||
    operationRecords.length !== FORWARD_ORDER.length + INVERSE_ORDER.length ||
    registrationIds.size !== 1 ||
    runIds.size !== 1 ||
    operationIds.size !== operationRecords.length ||
    operationRecords.some(
      ({ registrationId, runId, operationId, sideEffectCount }) =>
        typeof registrationId !== "string" ||
        registrationId.length < 8 ||
        typeof runId !== "string" ||
        runId.length < 8 ||
        typeof operationId !== "string" ||
        operationId.length < 8 ||
        sideEffectCount !== 1,
    )
  ) {
    fail("FINAL_UI_ACTION_SOURCE_INVALID");
  }
  const rawCallEvidence = new Set();
  const observedReceipts = new Set();
  for (const record of operationRecords) {
    const nativeApi = record.direction === "forward" ? "execute_asset_mutation" : "rollback_asset_mutation";
    const nativeCall = observedCall(
      record.nativeCall,
      nativeApi,
      "accepted_by_native_guard",
      "FINAL_UI_ACTION_SOURCE_INVALID",
      observedReceipts,
    );
    const mcpCall = observedCall(
      record.mcpCall,
      "mcp_asset_tool_call",
      "succeeded",
      "FINAL_UI_ACTION_SOURCE_INVALID",
      observedReceipts,
    );
    for (const value of [nativeCall.evidenceId, mcpCall.evidenceId]) {
      if (rawCallEvidence.has(value)) fail("FINAL_UI_ACTION_SOURCE_INVALID");
      rawCallEvidence.add(value);
    }
  }
  const manifests = events
    .filter((event) => event.type === "content_manifest_observation")
    .map((event) =>
      authorityData(
        event,
        [
          "receiptId",
          "receiptSequence",
          "stage",
          "registrationId",
          "runId",
          "evidenceId",
          "sha256",
          "runRootPresent",
        ],
        "native_observed",
        "FINAL_UI_CONTENT_EVENT_INVALID",
      ),
    );
  if (
    manifests.length !== 2 ||
    manifests[0].stage !== "before" ||
    manifests[1].stage !== "after" ||
    manifests.some(
      (record) =>
        record.registrationId !== operationRecords[0].registrationId ||
        record.runId !== operationRecords[0].runId ||
        typeof record.evidenceId !== "string" ||
        record.evidenceId.length < 8 ||
        !isHex(record.sha256) ||
        record.runRootPresent !== false,
    ) ||
    manifests[0].evidenceId === manifests[1].evidenceId ||
    manifests[0].sha256 !== manifests[1].sha256
  ) {
    fail("FINAL_UI_CONTENT_EVENT_INVALID");
  }
  for (const manifest of manifests) {
    inlineReceipt(manifest, "FINAL_UI_CONTENT_EVENT_INVALID", observedReceipts);
  }
  const expectedNegativeReasons = [
    ["N1", "companion_attestation_retracted"],
    ["N2", "asset_mutation_gate_disabled"],
    ["N3", "observation_session_stopped"],
    ["N4", "process_exited"],
    ["N5", "stale_generation"],
    ["N6", "sandbox_path_required"],
    ["N7", "execute_replay"],
    ["N8", "rollback_replay"],
  ];
  const negativeCases = events
    .filter((event) => event.type === "negative_case_observation")
    .map((event) =>
      authorityData(
        event,
        [
          "caseId",
          "sessionId",
          "nativeSessionId",
          "runId",
          "registrationId",
          "identityReceipts",
          "setupReceipts",
          "guardCall",
          "contentBefore",
          "contentAfter",
          "countersBefore",
          "countersAfter",
          "counterReadBefore",
          "counterReadAfter",
          "observationStopped",
          "localMcpClosed",
          "serverMcpTerminated",
          "mcpDisconnected",
          "closeoutReceipts",
        ],
        "runtime_observed",
        "FINAL_UI_NEGATIVE_SOURCE_INVALID",
      ),
    );
  const negativeIdentities = negativeCases.flatMap(({ sessionId, nativeSessionId, runId, registrationId }) => [
    sessionId,
    nativeSessionId,
    runId,
    registrationId,
  ]);
  if (
    negativeCases.length !== expectedNegativeReasons.length ||
    stable(negativeCases.map(({ caseId, guardCall }) => [caseId, guardCall.reason])) !==
      stable(expectedNegativeReasons) ||
    new Set(negativeIdentities).size !== negativeIdentities.length
  ) {
    fail("FINAL_UI_NEGATIVE_SOURCE_INVALID");
  }
  for (const record of negativeCases) {
    const expectedSetupApis = {
      N1: ["retract_mvp15_companion_approvals"],
      N2: [],
      N3: ["stop_editor_observation_session"],
      N4: ["create_managed_editor_process", "terminate_managed_editor_process"],
      N5: ["attach_editor_process"],
      N6: [],
      N7: ["execute_asset_mutation", "record_asset_mutation_outcome"],
      N8: [
        "execute_asset_mutation",
        "record_asset_mutation_outcome",
        "rollback_asset_mutation",
        "record_asset_mutation_outcome",
      ],
    }[record.caseId];
    if (
      !Array.isArray(record.setupReceipts) ||
      stable(record.setupReceipts.map(({ api }) => api)) !== stable(expectedSetupApis)
    ) {
      fail("FINAL_UI_NEGATIVE_SOURCE_INVALID");
    }
    for (const setupReceipt of record.setupReceipts) {
      assertExactKeys(
        setupReceipt,
        [
          "api",
          "id",
          "sequence",
          "responseSha256",
          "status",
          "reason",
          "sessionId",
          "registrationId",
          "phase",
          "operationId",
          "processId",
          "ownerTaskId",
          "ownerPhase",
          "observationGeneration",
        ],
        "FINAL_UI_NEGATIVE_SOURCE_INVALID",
      );
      receiptReference(
        { id: setupReceipt.id, sequence: setupReceipt.sequence },
        "FINAL_UI_NEGATIVE_SOURCE_INVALID",
        observedReceipts,
      );
      if (typeof setupReceipt.api !== "string" || !isHex(setupReceipt.responseSha256)) {
        fail("FINAL_UI_NEGATIVE_SOURCE_INVALID");
      }
    }
    const setupSequenceValid = record.setupReceipts.every(
      (receipt, index) => index === 0 || record.setupReceipts[index - 1].sequence < receipt.sequence,
    );
    const setupResponseValid = (() => {
      const setup = record.setupReceipts;
      if (record.caseId === "N1") return setup[0]?.status === "retracted";
      if (record.caseId === "N2" || record.caseId === "N6") return setup.length === 0;
      if (record.caseId === "N3") {
        return setup[0]?.status === "stopped" && setup[0]?.sessionId === record.sessionId;
      }
      if (record.caseId === "N4") {
        return setup[0]?.status === "created" &&
          setup[0]?.reason === "task_owned_process_started" &&
          typeof setup[0]?.processId === "string" && setup[0].processId.length >= 8 &&
          typeof setup[0]?.ownerTaskId === "string" && setup[0].ownerTaskId.length >= 8 &&
          setup[0]?.ownerPhase === "ui-lifecycle" &&
          setup[1]?.status === "degraded" && setup[1]?.reason === "process_exited" &&
          setup[1]?.sessionId === record.sessionId;
      }
      if (record.caseId === "N5") {
        return setup[0]?.status === "attached" &&
          typeof setup[0]?.sessionId === "string" && setup[0].sessionId !== record.sessionId &&
          Number.isSafeInteger(setup[0]?.observationGeneration) &&
          setup[0].observationGeneration > 0;
      }
      const registrationMatches = setup.every(
        (receipt) => receipt.registrationId === record.registrationId,
      );
      if (record.caseId === "N7") {
        return registrationMatches && setup[0]?.status === "accepted_by_native_guard" &&
          setup[0]?.phase === "execute" && setup[1]?.status === "recorded" &&
          setup[1]?.phase === "execute" && setup[0]?.operationId === setup[1]?.operationId;
      }
      if (record.caseId === "N8") {
        return registrationMatches && setup[0]?.status === "accepted_by_native_guard" &&
          setup[0]?.phase === "execute" && setup[1]?.status === "recorded" &&
          setup[1]?.phase === "execute" && setup[0]?.operationId === setup[1]?.operationId &&
          setup[2]?.status === "accepted_by_native_guard" && setup[2]?.phase === "rollback" &&
          setup[3]?.status === "recorded" && setup[3]?.phase === "rollback" &&
          setup[2]?.operationId === setup[3]?.operationId;
      }
      return false;
    })();
    const call = observedCall(
      record.guardCall,
      record.caseId === "N2" || record.caseId === "N6"
        ? "dry_run_asset_mutation"
        : record.caseId === "N8"
          ? "rollback_asset_mutation"
          : "execute_asset_mutation",
      "blocked",
      "FINAL_UI_NEGATIVE_SOURCE_INVALID",
      observedReceipts,
    );
    assertExactKeys(
      record.contentBefore,
      ["evidenceId", "sha256", "receiptId", "receiptSequence"],
      "FINAL_UI_NEGATIVE_SOURCE_INVALID",
    );
    assertExactKeys(
      record.contentAfter,
      ["evidenceId", "sha256", "receiptId", "receiptSequence"],
      "FINAL_UI_NEGATIVE_SOURCE_INVALID",
    );
    identityReceipts(record.identityReceipts, "FINAL_UI_NEGATIVE_SOURCE_INVALID", observedReceipts);
    inlineReceipt(record.contentBefore, "FINAL_UI_NEGATIVE_SOURCE_INVALID", observedReceipts);
    inlineReceipt(record.contentAfter, "FINAL_UI_NEGATIVE_SOURCE_INVALID", observedReceipts);
    const before = counterVector(record.countersBefore, "FINAL_UI_NEGATIVE_SOURCE_INVALID");
    const after = counterVector(record.countersAfter, "FINAL_UI_NEGATIVE_SOURCE_INVALID");
    counterReceipt(
      record.counterReadBefore,
      before,
      "FINAL_UI_NEGATIVE_SOURCE_INVALID",
      observedReceipts,
    );
    counterReceipt(
      record.counterReadAfter,
      after,
      "FINAL_UI_NEGATIVE_SOURCE_INVALID",
      observedReceipts,
    );
    closeoutReceipts(record.closeoutReceipts, "FINAL_UI_NEGATIVE_SOURCE_INVALID", observedReceipts);
    const deltas = after.map((count, index) => count - before[index]);
    if (
      [record.sessionId, record.nativeSessionId, record.runId, record.registrationId].some(
        (value) => typeof value !== "string" || value.length < 8,
      ) ||
      call.reason !== expectedNegativeReasons.find(([caseId]) => caseId === record.caseId)?.[1] ||
      typeof record.contentBefore.evidenceId !== "string" ||
      typeof record.contentAfter.evidenceId !== "string" ||
      record.contentBefore.evidenceId === record.contentAfter.evidenceId ||
      !isHex(record.contentBefore.sha256) ||
      record.contentAfter.sha256 !== record.contentBefore.sha256 ||
      deltas.some((count) => count !== 0) ||
      !setupSequenceValid ||
      !setupResponseValid ||
      record.observationStopped !== true ||
      record.localMcpClosed !== true ||
      record.serverMcpTerminated !== record.closeoutReceipts.serverDisconnected ||
      record.mcpDisconnected !== record.serverMcpTerminated
    ) {
      fail("FINAL_UI_NEGATIVE_SOURCE_INVALID");
    }
  }
  const partial = authorityData(
    oneEvent(events, "partial_unknown_observation", "FINAL_UI_PARTIAL_SOURCE_INVALID"),
    [
      "sessionId",
      "nativeSessionId",
      "runId",
      "registrationId",
      "identityReceipts",
      "operationResults",
      "contentBefore",
      "contentAfter",
      "countersBefore",
      "countersAfter",
      "counterReadBefore",
      "counterReadAfter",
      "observationStopped",
      "localMcpClosed",
      "serverMcpTerminated",
      "mcpDisconnected",
      "closeoutReceipts",
    ],
    "runtime_observed",
    "FINAL_UI_PARTIAL_SOURCE_INVALID",
  );
  const expectedPartial = [
    ["forward", "create_run_root", "succeeded", "known_effect", "none"],
    ["forward", "duplicate_test01", "succeeded", "known_effect", "none"],
    ["forward", "rename_duplicate", "succeeded", "known_effect", "none"],
    ["forward", "move_duplicate", "failed", "unknown", "effect_unknown"],
    ["inverse", "rename_back", "succeeded", "known_effect", "none"],
    ["inverse", "delete_duplicate", "succeeded", "known_effect", "none"],
    ["inverse", "cleanup_empty_folder", "succeeded", "known_effect", "none"],
    ["control", "cross_ttl", "blocked", "known_none", "approval_expired"],
    ["control", "second_rollback", "blocked", "known_none", "rollback_replay"],
  ];
  if (!Array.isArray(partial.operationResults) || partial.operationResults.length !== expectedPartial.length) {
    fail("FINAL_UI_PARTIAL_SOURCE_INVALID");
  }
  const observedPartial = partial.operationResults.map((record, index) => {
    assertExactKeys(
      record,
      [
        "sequence",
        "direction",
        "action",
        "api",
        "receiptId",
        "receiptSequence",
        "requestSha256",
        "responseSha256",
        "status",
        "effectState",
        "reason",
        "evidenceId",
        "setupReceipts",
      ],
      "FINAL_UI_PARTIAL_SOURCE_INVALID",
    );
    inlineReceipt(record, "FINAL_UI_PARTIAL_SOURCE_INVALID", observedReceipts);
    const expectedSetupApis =
      index < 7
        ? []
        : index === 7
          ? ["attach_editor_process", "register_asset_mutation_approval"]
          : [
              "attach_editor_process",
              "register_asset_mutation_approval",
              "execute_asset_mutation",
              "record_asset_mutation_outcome",
              "rollback_asset_mutation",
              "record_asset_mutation_outcome",
            ];
    if (
      !Array.isArray(record.setupReceipts) ||
      stable(record.setupReceipts.map(({ api }) => api)) !== stable(expectedSetupApis)
    ) {
      fail("FINAL_UI_PARTIAL_SOURCE_INVALID");
    }
    for (const setupReceipt of record.setupReceipts) {
      assertExactKeys(
        setupReceipt,
        [
          "api",
          "id",
          "sequence",
          "status",
          "reason",
          "sessionId",
          "registrationId",
          "phase",
          "operationId",
          "requestSessionId",
          "requestRegistrationId",
        ],
        "FINAL_UI_PARTIAL_SOURCE_INVALID",
      );
      if (typeof setupReceipt.api !== "string") {
        fail("FINAL_UI_PARTIAL_SOURCE_INVALID");
      }
      receiptReference(
        { id: setupReceipt.id, sequence: setupReceipt.sequence },
        "FINAL_UI_PARTIAL_SOURCE_INVALID",
        observedReceipts,
      );
    }
    const setupSequenceValid = record.setupReceipts.every(
      (receipt, setupIndex) =>
        setupIndex === 0 || record.setupReceipts[setupIndex - 1].sequence < receipt.sequence,
    );
    let setupResponsesValid = record.setupReceipts.length === 0;
    if (index === 7) {
      const [attach, registration] = record.setupReceipts;
      setupResponsesValid = attach?.status === "attached" &&
        registration?.status === "registered" &&
        attach?.sessionId === registration?.requestSessionId;
    } else if (index === 8) {
      const [attach, registration, execute, executeOutcome, rollback, rollbackOutcome] =
        record.setupReceipts;
      const freshRegistration = registration?.registrationId;
      setupResponsesValid = attach?.status === "attached" &&
        registration?.status === "registered" &&
        attach?.sessionId === registration?.requestSessionId &&
        typeof freshRegistration === "string" && freshRegistration.length >= 8 &&
        [execute, executeOutcome, rollback, rollbackOutcome].every(
          (entry) => entry?.registrationId === freshRegistration &&
            entry?.requestRegistrationId === freshRegistration,
        ) &&
        execute?.status === "accepted_by_native_guard" && execute?.phase === "execute" &&
        executeOutcome?.status === "recorded" && executeOutcome?.phase === "execute" &&
        execute?.operationId === executeOutcome?.operationId &&
        rollback?.status === "accepted_by_native_guard" && rollback?.phase === "rollback" &&
        rollbackOutcome?.status === "recorded" && rollbackOutcome?.phase === "rollback" &&
        rollback?.operationId === rollbackOutcome?.operationId;
    }
    if (
      record.sequence !== index + 1 ||
      !setupSequenceValid ||
      !setupResponsesValid ||
      !isHex(record.requestSha256) ||
      !isHex(record.responseSha256) ||
      typeof record.api !== "string" ||
      record.api.length === 0 ||
      typeof record.evidenceId !== "string" ||
      record.evidenceId.length < 8
    ) {
      fail("FINAL_UI_PARTIAL_SOURCE_INVALID");
    }
    return [record.direction, record.action, record.status, record.effectState, record.reason];
  });
  assertExactKeys(
    partial.contentBefore,
    ["evidenceId", "sha256", "receiptId", "receiptSequence"],
    "FINAL_UI_PARTIAL_SOURCE_INVALID",
  );
  assertExactKeys(
    partial.contentAfter,
    ["evidenceId", "sha256", "receiptId", "receiptSequence"],
    "FINAL_UI_PARTIAL_SOURCE_INVALID",
  );
  identityReceipts(partial.identityReceipts, "FINAL_UI_PARTIAL_SOURCE_INVALID", observedReceipts);
  inlineReceipt(partial.contentBefore, "FINAL_UI_PARTIAL_SOURCE_INVALID", observedReceipts);
  inlineReceipt(partial.contentAfter, "FINAL_UI_PARTIAL_SOURCE_INVALID", observedReceipts);
  const partialBefore = counterVector(partial.countersBefore, "FINAL_UI_PARTIAL_SOURCE_INVALID");
  const partialAfter = counterVector(partial.countersAfter, "FINAL_UI_PARTIAL_SOURCE_INVALID");
  counterReceipt(
    partial.counterReadBefore,
    partialBefore,
    "FINAL_UI_PARTIAL_SOURCE_INVALID",
    observedReceipts,
  );
  counterReceipt(
    partial.counterReadAfter,
    partialAfter,
    "FINAL_UI_PARTIAL_SOURCE_INVALID",
    observedReceipts,
  );
  closeoutReceipts(partial.closeoutReceipts, "FINAL_UI_PARTIAL_SOURCE_INVALID", observedReceipts);
  if (
    stable(observedPartial) !== stable(expectedPartial) ||
    [partial.sessionId, partial.nativeSessionId, partial.runId, partial.registrationId].some(
      (value) => typeof value !== "string" || value.length < 8,
    ) ||
    !isHex(partial.contentBefore.sha256) ||
    partial.contentAfter.sha256 !== partial.contentBefore.sha256 ||
    partial.contentBefore.evidenceId === partial.contentAfter.evidenceId ||
    partialAfter.some((count, index) => count < partialBefore[index]) ||
    !partialAfter.some((count, index) => count > partialBefore[index]) ||
    partial.observationStopped !== true ||
    partial.localMcpClosed !== true ||
    partial.serverMcpTerminated !== partial.closeoutReceipts.serverDisconnected ||
    partial.mcpDisconnected !== partial.serverMcpTerminated
  ) {
    fail("FINAL_UI_PARTIAL_SOURCE_INVALID");
  }
  const replay = authorityData(
    oneEvent(events, "replay_inspection_observation", "FINAL_UI_REPLAY_EVENT_INVALID"),
    [
      "recordedRepresentationSha256",
      "recordedRepresentationReceiptId",
      "recordedRepresentationReceiptSequence",
      "recordedEventCount",
      "recordedActions",
      "counterNames",
      "countersBefore",
      "countersAfter",
      "counterReadBefore",
      "counterReadAfter",
      "sideEffectDelta",
    ],
    "runtime_observed",
    "FINAL_UI_REPLAY_EVENT_INVALID",
  );
  const expectedCounterNames = ["native", "mcp", "provider", "verify", "rollback"];
  const replayBefore = counterVector(replay.countersBefore, "FINAL_UI_REPLAY_EVENT_INVALID");
  const replayAfter = counterVector(replay.countersAfter, "FINAL_UI_REPLAY_EVENT_INVALID");
  const replayDelta = counterVector(replay.sideEffectDelta, "FINAL_UI_REPLAY_EVENT_INVALID");
  inlineReceipt(
    {
      receiptId: replay.recordedRepresentationReceiptId,
      receiptSequence: replay.recordedRepresentationReceiptSequence,
    },
    "FINAL_UI_REPLAY_EVENT_INVALID",
    observedReceipts,
  );
  counterReceipt(replay.counterReadBefore, replayBefore, "FINAL_UI_REPLAY_EVENT_INVALID", observedReceipts);
  counterReceipt(replay.counterReadAfter, replayAfter, "FINAL_UI_REPLAY_EVENT_INVALID", observedReceipts);
  if (
    !isHex(replay.recordedRepresentationSha256) ||
    !Number.isSafeInteger(replay.recordedEventCount) ||
    replay.recordedEventCount < 1 ||
    stable(replay.recordedActions) !== stable(["dry-run", "preview", "approval", "execute", "verify", "rollback"]) ||
    stable(replay.counterNames) !== stable(expectedCounterNames) ||
    stable(replayBefore) !== stable(replayAfter) ||
    replayDelta.some((count) => count !== 0)
  ) {
    fail("FINAL_UI_REPLAY_EVENT_INVALID");
  }
  const negativeSummary = authorityData(
    oneEvent(events, "negative_matrix", "FINAL_UI_NEGATIVE_EVENT_INVALID"),
    ["caseCount", "passedCount", "rawObservationCount"],
    "derived_only",
    "FINAL_UI_NEGATIVE_EVENT_INVALID",
  );
  const partialSummary = authorityData(
    oneEvent(events, "partial_unknown_effect", "FINAL_UI_PARTIAL_EVENT_INVALID"),
    ["covered", "rawOperationCount"],
    "derived_only",
    "FINAL_UI_PARTIAL_EVENT_INVALID",
  );
  const rootState = authorityData(
    oneEvent(events, "run_root_state", "FINAL_UI_ROOT_EVENT_INVALID"),
    ["removed", "contentEvidenceId"],
    "derived_only",
    "FINAL_UI_ROOT_EVENT_INVALID",
  );
  const ownership = authorityData(
    oneEvent(events, "ownership_state", "FINAL_UI_OWNERSHIP_EVENT_INVALID"),
    ["parentCloseoutRequired"],
    "derived_only",
    "FINAL_UI_OWNERSHIP_EVENT_INVALID",
  );
  if (
    negativeSummary.caseCount !== negativeCases.length ||
    negativeSummary.passedCount !== negativeCases.length ||
    negativeSummary.rawObservationCount !== negativeCases.length ||
    partialSummary.covered !== true ||
    partialSummary.rawOperationCount !== partial.operationResults.length ||
    rootState.removed !== true ||
    rootState.contentEvidenceId !== manifests[1].evidenceId ||
    ownership.parentCloseoutRequired !== true ||
    [
      closeout.processResidualCount,
      closeout.portResidualCount,
      closeout.markerResidualCount,
      closeout.partialOutputCount,
    ].some((count) => count !== 0)
  ) {
    fail("FINAL_UI_LIFECYCLE_EVENT_INVALID");
  }
  const n4Setup = negativeCases.find(({ caseId }) => caseId === "N4").setupReceipts;
  const n5Setup = negativeCases.find(({ caseId }) => caseId === "N5").setupReceipts;
  const secondRollbackSetup = partial.operationResults.find(
    ({ action }) => action === "second_rollback",
  ).setupReceipts;
  const closeouts = [...negativeCases, partial].map((record) => record.closeoutReceipts);
  return {
    captureOrigin: origin.origin,
    fixtureUsed: false,
    renderedUiPath,
    readOnlySource: "/Game/Test01",
    artifactAuthorityBindingSha256: artifact.data.producerBindingSha256,
    forwardOrder: FORWARD_ORDER,
    inverseOrder: INVERSE_ORDER,
    ledger: {
      forwardEventCount: FORWARD_ORDER.length,
      inverseEventCount: INVERSE_ORDER.length,
      sideEffectCount: FORWARD_ORDER.length + INVERSE_ORDER.length,
      forbiddenTotal: 0,
      replaySideEffectDelta: replayDelta,
    },
    negativeMatrixComplete: true,
    negativeCaseCount: negativeCases.length,
    partialUnknownEffectCovered: true,
    nativeLifecycleEvidence: {
      n4ManagedProcessId: n4Setup[0].processId,
      n4OwnerTaskId: n4Setup[0].ownerTaskId,
      n4OwnerPhase: n4Setup[0].ownerPhase,
      n5SuccessorSessionId: n5Setup[0].sessionId,
      n5ObservationGeneration: n5Setup[0].observationGeneration,
      secondRollbackSetupApis: secondRollbackSetup.map(({ api }) => api),
      secondRollbackSetupReceiptIds: secondRollbackSetup.map(({ id }) => id),
    },
    mcpTermination: {
      localCloseCount: closeouts.filter((_, index) =>
        (index < negativeCases.length ? negativeCases[index] : partial).localMcpClosed,
      ).length,
      acceptedCount: closeouts.filter(({ mcpTerminationStatus }) => mcpTerminationStatus === "accepted")
        .length,
      unsupportedCount: closeouts.filter(
        ({ mcpTerminationStatus }) => mcpTerminationStatus === "unsupported",
      ).length,
      receiptIds: closeouts.map(({ mcpDisconnectReceiptId }) => mcpDisconnectReceiptId),
    },
    nativeObservationReceiptCount: observedReceipts.size,
    contentSha256: manifests[0].sha256,
    contentRestored: true,
    runRootRemoved: true,
    ownershipClosed: true,
    processResidualCount: closeout.processResidualCount,
    portResidualCount: closeout.portResidualCount,
  };
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

function deriveProduct(events, closeout, mode, context = {}) {
  if (mode === "live") return deriveLiveProduct(events, closeout, context);
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
  if (mode === "live") {
    const observations = events
      .filter((event) => event.type === "retraction_observation")
      .map((event) => exactData(
        event,
        ["reason", "sessionId", "generationBefore", "generationAfter", "statusBefore", "statusAfter", "count"],
        "FINAL_PRODUCT_RETRACTION_SOURCE_INVALID",
      ));
    const sessions = new Set(observations.map(({ sessionId }) => sessionId));
    if (
      stable(observations.map(({ reason }) => reason)) !== stable(expectedRetractions) ||
      observations.length !== expectedRetractions.length ||
      sessions.size !== expectedRetractions.length ||
      observations.some((observation) =>
        typeof observation.sessionId !== "string" ||
        observation.sessionId.length === 0 ||
        !Number.isSafeInteger(observation.generationBefore) ||
        !Number.isSafeInteger(observation.generationAfter) ||
        observation.generationBefore < 1 ||
        observation.generationAfter <= observation.generationBefore ||
        observation.statusBefore !== "ready" ||
        observation.statusAfter !== "blocked" ||
        observation.count !== TOOL_NAMES.length
      )
    ) {
      fail("FINAL_PRODUCT_RETRACTION_SOURCE_INVALID");
    }
    const toolSearch = events
      .filter((event) => event.type === "tool_search_observation")
      .map((event) => exactData(event, ["mode", "status"], "FINAL_PRODUCT_TOOL_SEARCH_INVALID"));
    if (
      stable(toolSearch) !== stable([
        { mode: "on", status: "passed" },
        { mode: "off", status: "passed" },
      ])
    ) {
      fail("FINAL_PRODUCT_TOOL_SEARCH_INVALID");
    }
  }
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

function deriveUi(events, closeout, mode, context = {}) {
  if (mode === "live") return deriveLiveUi(events, closeout, context);
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
  const expectedRenderedUiPath =
    mode === "live"
      ? [
          "validate",
          "add",
          "confirmTrust",
          "observationDiscover",
          "observationAttach",
          "observationReady",
          "mcpConnect",
          "mcpInitialize",
          "mcpDiscover",
          "mcpNormalize",
          "mcpFingerprint",
          "dryRun",
          "approve",
          "register",
          "execute",
          "verify",
          "crossTtl",
          "rollback",
          "finalVerify",
          "replay",
          "observationStop",
          "mcpDisconnect",
        ]
      : ["validate", "add", "confirmTrust"];
  if (
    stable(renderedUiPath) !== stable(expectedRenderedUiPath)
  ) {
    fail("FINAL_UI_PATH_EVENT_INVALID");
  }
  installedLoaded(events);
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
    actions.some(({ direction, sideEffectCount }) =>
      sideEffectCount !== (mode === "live" && (direction === "forward" || direction === "inverse") ? 1 : 0),
    )
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
  if (mode === "live") {
    const expectedNegativeReasons = [
      ["N1", "untrusted_root"],
      ["N2", "feature_disabled"],
      ["N3", "observation_session_stopped"],
      ["N4", "process_exited"],
      ["N5", "stale_generation"],
      ["N6", "sandbox_path_required"],
      ["N7", "execute_replay"],
      ["N8", "rollback_replay"],
    ];
    const negativeCases = events
      .filter((event) => event.type === "negative_case")
      .map((event) => exactData(
        event,
        ["caseId", "sessionId", "runId", "registrationId", "blockedReason", "beforeContentSha256", "afterContentSha256", "counterDelta", "closeout"],
        "FINAL_UI_NEGATIVE_SOURCE_INVALID",
      ));
    const identityValues = negativeCases.flatMap(({ sessionId, runId, registrationId }) => [
      sessionId,
      runId,
      registrationId,
    ]);
    if (
      stable(negativeCases.map(({ caseId, blockedReason }) => [caseId, blockedReason])) !==
        stable(expectedNegativeReasons) ||
      negativeCases.length !== 8 ||
      new Set(identityValues).size !== identityValues.length ||
      negativeCases.some((record) => {
        assertExactKeys(
          record.closeout,
          ["observationStopped", "mcpDisconnected", "processResidualCount", "portResidualCount"],
          "FINAL_UI_NEGATIVE_SOURCE_INVALID",
        );
        return !isHex(record.beforeContentSha256) ||
          record.afterContentSha256 !== record.beforeContentSha256 ||
          stable(record.counterDelta) !== stable([1, 0, 0, 0, 0]) ||
          record.closeout.observationStopped !== true ||
          record.closeout.mcpDisconnected !== true ||
          record.closeout.processResidualCount !== 0 ||
          record.closeout.portResidualCount !== 0;
      })
    ) {
      fail("FINAL_UI_NEGATIVE_SOURCE_INVALID");
    }
    const partialRecord = exactData(
      oneEvent(events, "partial_unknown_effect_record", "FINAL_UI_PARTIAL_SOURCE_INVALID"),
      ["sessionId", "runId", "registrationId", "effectState", "successfulForward", "inverseRollbackOrder", "crossTtlRejected", "secondRollbackBlocked", "beforeContentSha256", "afterContentSha256", "closeout"],
      "FINAL_UI_PARTIAL_SOURCE_INVALID",
    );
    assertExactKeys(
      partialRecord.closeout,
      ["observationStopped", "mcpDisconnected", "processResidualCount", "portResidualCount"],
      "FINAL_UI_PARTIAL_SOURCE_INVALID",
    );
    if (
      partialRecord.effectState !== "unknown" ||
      stable(partialRecord.successfulForward) !== stable([
        "create_run_root",
        "duplicate_test01",
        "rename_duplicate",
      ]) ||
      stable(partialRecord.inverseRollbackOrder) !== stable([
        "rename_back",
        "delete_duplicate",
        "cleanup_empty_folder",
      ]) ||
      partialRecord.crossTtlRejected !== true ||
      partialRecord.secondRollbackBlocked !== true ||
      !isHex(partialRecord.beforeContentSha256) ||
      partialRecord.afterContentSha256 !== partialRecord.beforeContentSha256 ||
      partialRecord.closeout.observationStopped !== true ||
      partialRecord.closeout.mcpDisconnected !== true ||
      partialRecord.closeout.processResidualCount !== 0 ||
      partialRecord.closeout.portResidualCount !== 0
    ) {
      fail("FINAL_UI_PARTIAL_SOURCE_INVALID");
    }
  }
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
      sideEffectCount: mode === "live" ? FORWARD_ORDER.length + INVERSE_ORDER.length : 0,
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

function derivedFor(kind, events, closeout, mode, context = {}) {
  if (kind === "ue-automation") return deriveUe(events, closeout, mode);
  if (kind === "product-capture") return deriveProduct(events, closeout, mode, context);
  return deriveUi(events, closeout, mode, context);
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

function issueOwnedLaunchReceipt({
  kind,
  identity,
  taskId,
  launch,
  producerPath,
  paths,
  result,
  derivationAuthority,
}) {
  const requiresDerivationAuthority = kind === "product-capture" || kind === "ui-lifecycle";
  const derivationState = LIVE_DERIVATION_AUTHORITIES.get(derivationAuthority);
  if (
    requiresDerivationAuthority &&
    (derivationAuthority?.scope !== "owned-launch" || derivationState?.used !== true)
  ) {
    fail("FINAL_PHASE_OWNED_LAUNCH_RECEIPT_INVALID");
  }
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
    derivationAuthority,
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
      ((kind === "product-capture" || kind === "ui-lifecycle") &&
        stable(readJson(paths.summary, code).ownedLaunchBinding) !==
          stable(persistedOwnedLaunchBinding(receipt.derivationAuthority))) ||
      ((kind === "product-capture" || kind === "ui-lifecycle") &&
        (receipt.derivationAuthority?.scope !== "owned-launch" ||
          LIVE_DERIVATION_AUTHORITIES.get(receipt.derivationAuthority)?.used !== true)) ||
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
    LIVE_DERIVATION_AUTHORITIES.delete(receipt?.derivationAuthority);
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
  const sourceIdentity = computeSourceIdentity(identity.repository);
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
    artifactBinding(
      identity.root,
      resolve(identity.root, "metadata", `${kind}.job-closeout.json`),
      capturedAt,
      producer.id,
      "raw",
      JOB_CLOSEOUT_SCHEMA,
    ),
    artifactBinding(
      identity.root,
      resolve(identity.root, "metadata", `${kind}.port-closeout.json`),
      capturedAt,
      producer.id,
      "raw",
      PORT_CLOSEOUT_SCHEMA,
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
    );
  }
  const liveDerivationContext = {
    sourceCommit: launch.sourceCommit,
    sourceTreeSha256: sourceIdentity.sourceTreeSha256,
    sessionId: session.sessionId,
    generation: session.generation,
    runtimeProcessId: parsed.runtimeProcess.pid,
    runtimeProcess: parsed.runtimeProcess,
  };
  const ownedDerivationAuthority =
    kind === "product-capture" || kind === "ui-lifecycle"
      ? issueLiveDerivationAuthority("owned-launch", kind, parsed, liveDerivationContext)
      : null;
  let derived;
  try {
    derived = derivedFor(kind, parsed.events, parsed.closeout, "live", {
      ...liveDerivationContext,
      ownedDerivationAuthority,
    });
  } catch (error) {
    LIVE_DERIVATION_AUTHORITIES.delete(ownedDerivationAuthority);
    throw error;
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
    ...(ownedDerivationAuthority
      ? { ownedLaunchBinding: persistedOwnedLaunchBinding(ownedDerivationAuthority) }
      : {}),
    sessionId: session.sessionId,
    endpoint: launch.endpoint,
    generation: session.generation,
    producerLedgerSha256: sha256File(paths.ledger),
    ...derived,
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
      derivationAuthority: ownedDerivationAuthority,
    });
    return verifyOwnedLaunchAuthority(kind, { ...args, input: paths.summary }, receipt);
  } catch (error) {
    LIVE_DERIVATION_AUTHORITIES.delete(ownedDerivationAuthority);
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
      relativePath === `metadata/${kind}.job-closeout.json` && schema === JOB_CLOSEOUT_SCHEMA,
  );
  const portCloseoutArtifact = summary.sourceArtifacts.find(
    ({ relativePath, schema }) =>
      relativePath === `metadata/${kind}.port-closeout.json` && schema === PORT_CLOSEOUT_SCHEMA,
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
    (summary.evidenceMode === "live" && (!jobCloseoutArtifact || !portCloseoutArtifact)) ||
    (summary.evidenceMode === "live" &&
      kind === "ue-automation" &&
      (!loadedLedgerArtifact || !earlyIdentityArtifact))
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
      [
        "authorityLevel",
        "processResidualCount",
        "portResidualCount",
        "markerResidualCount",
        "partialOutputCount",
        "jobCloseoutSha256",
        "portObservationSha256",
        "runtimeProcessId",
        "phaseSessionId",
        "phaseGeneration",
      ],
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
        ledger.closeout.authorityLevel !== "parent_observed" ||
        !isHex(ledger.closeout.jobCloseoutSha256) ||
        !isHex(ledger.closeout.portObservationSha256) ||
        ledger.closeout.runtimeProcessId !== ledger.runtimeProcess.pid ||
        ledger.closeout.phaseSessionId !== ledger.sessionId ||
        ledger.closeout.phaseGeneration !== ledger.generation ||
        [
          ledger.closeout.processResidualCount,
          ledger.closeout.portResidualCount,
          ledger.closeout.markerResidualCount,
          ledger.closeout.partialOutputCount,
        ].some((count) => count !== 0)
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
  if (isLive) {
    const jobCloseout = readJson(
      resolve(root, "metadata", `${kind}.job-closeout.json`),
      "FINAL_PHASE_PARENT_CLOSEOUT_INVALID",
    );
    const portCloseout = readJson(
      resolve(root, "metadata", `${kind}.port-closeout.json`),
      "FINAL_PHASE_PARENT_CLOSEOUT_INVALID",
    );
    assertExactKeys(
      jobCloseout,
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
      "FINAL_PHASE_PARENT_CLOSEOUT_INVALID",
    );
    assertExactKeys(
      portCloseout,
      [
        "schemaVersion",
        "phase",
        "taskId",
        "marker",
        "sessionId",
        "generation",
        "port",
        "host",
        "observations",
        "residualCount",
      ],
      "FINAL_PHASE_PARENT_CLOSEOUT_INVALID",
    );
    if (
      jobCloseout.schemaVersion !== JOB_CLOSEOUT_SCHEMA ||
      jobCloseout.taskId !== taskId ||
      jobCloseout.marker !== ledger.marker ||
      jobCloseout.sessionId !== ledger.sessionId ||
      jobCloseout.generation !== ledger.generation ||
      jobCloseout.jobSchemaVersion !== "uagent.mvp15d.windows-job-process-run.v1" ||
      jobCloseout.rootPid !== parsed.runtimeProcess.pid ||
      jobCloseout.rootExitCode !== 0 ||
      jobCloseout.timedOut !== false ||
      jobCloseout.activeProcessZeroObserved !== true ||
      jobCloseout.finalResidualCount !== 0 ||
      jobCloseout.failureCode !== "" ||
      portCloseout.schemaVersion !== PORT_CLOSEOUT_SCHEMA ||
      portCloseout.phase !== kind ||
      portCloseout.taskId !== taskId ||
      portCloseout.marker !== ledger.marker ||
      portCloseout.sessionId !== ledger.sessionId ||
      portCloseout.generation !== ledger.generation ||
      portCloseout.port !== ledger.port ||
      portCloseout.host !== "127.0.0.1" ||
      portCloseout.residualCount !== 0 ||
      !Array.isArray(portCloseout.observations) ||
      portCloseout.observations.length !== 5 ||
      portCloseout.observations.some(
        (observation, index) =>
          stable(observation) !== stable({ attempt: index + 1, accepting: false }),
      ) ||
      parsed.closeout.jobCloseoutSha256 !== jobCloseoutArtifact.sha256 ||
      parsed.closeout.portObservationSha256 !== portCloseoutArtifact.sha256 ||
      parsed.closeout.runtimeProcessId !== parsed.runtimeProcess.pid ||
      parsed.closeout.phaseSessionId !== ledger.sessionId ||
      parsed.closeout.phaseGeneration !== ledger.generation
    ) {
      fail("FINAL_PHASE_PARENT_CLOSEOUT_INVALID");
    }
  }
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
  const verificationContext = {
    sourceCommit: ledger.sourceCommit,
    sourceTreeSha256: isLive ? computeSourceIdentity(repository).sourceTreeSha256 : undefined,
    sessionId: ledger.sessionId,
    generation: ledger.generation,
    runtimeProcessId: parsed.runtimeProcess?.pid,
    runtimeProcess: parsed.runtimeProcess,
  };
  const persistedAuthority =
    isLive && (kind === "product-capture" || kind === "ui-lifecycle")
      ? issueLiveDerivationAuthority("persisted-consistency", kind, parsed, verificationContext)
      : null;
  let verifiedDerived;
  try {
    verifiedDerived = derivedFor(kind, parsed.events, parsed.closeout, isLive ? "live" : "fixture", {
      ...verificationContext,
      ownedDerivationAuthority: persistedAuthority,
    });
  } finally {
    LIVE_DERIVATION_AUTHORITIES.delete(persistedAuthority);
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
          ...(persistedAuthority
            ? { ownedLaunchBinding: persistedOwnedLaunchBinding(persistedAuthority) }
            : {}),
        }
      : {}),
    sessionId: ledger.sessionId,
    ...(isLive ? { endpoint: ledger.endpoint } : {}),
    generation: ledger.generation,
    producerLedgerSha256: sha256File(paths.ledger),
    ...verifiedDerived,
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
    if (value.evidenceMode === "live" && summary.path === "summaries/product-capture.json") {
      const handoff = value.rendererRestartHandoff;
      if (
        value.schemaVersion !== PRODUCT_SCHEMA ||
        !handoff ||
        stable(Object.keys(handoff).sort()) !== stable([
          "claimReceiptId",
          "claimReceiptSequence",
          "handoffId",
          "parentAcknowledgementReceiptId",
          "parentAcknowledgementReceiptSequence",
          "predecessorMcpGeneration",
          "predecessorMcpSessionId",
          "predecessorProcessIdentitySha256",
          "predecessorRendererInstanceId",
          "predecessorWindowIdentity",
          "requestReceiptId",
          "requestReceiptSequence",
          "successorMcpGeneration",
          "successorMcpSessionId",
          "successorProcessIdentitySha256",
          "successorRendererInstanceId",
        ].sort()) ||
        typeof handoff.handoffId !== "string" ||
        !handoff.handoffId.startsWith("renderer-handoff:") ||
        handoff.predecessorRendererInstanceId === handoff.successorRendererInstanceId ||
        !isHex(handoff.predecessorProcessIdentitySha256) ||
        !isHex(handoff.successorProcessIdentitySha256) ||
        handoff.predecessorProcessIdentitySha256 === handoff.successorProcessIdentitySha256 ||
        handoff.predecessorMcpSessionId === handoff.successorMcpSessionId ||
        !Number.isSafeInteger(handoff.predecessorMcpGeneration) ||
        !Number.isSafeInteger(handoff.successorMcpGeneration) ||
        handoff.successorMcpGeneration <= handoff.predecessorMcpGeneration ||
        !isObservationReceiptId(handoff.requestReceiptId) ||
        !isObservationReceiptId(handoff.parentAcknowledgementReceiptId) ||
        !isObservationReceiptId(handoff.claimReceiptId) ||
        !Number.isSafeInteger(handoff.requestReceiptSequence) ||
        !Number.isSafeInteger(handoff.parentAcknowledgementReceiptSequence) ||
        !Number.isSafeInteger(handoff.claimReceiptSequence) ||
        handoff.requestReceiptSequence >= handoff.parentAcknowledgementReceiptSequence ||
        handoff.parentAcknowledgementReceiptSequence >= handoff.claimReceiptSequence ||
        stable(Object.keys(handoff.predecessorWindowIdentity ?? {}).sort()) !== stable([
          "handoffId",
          "phase",
          "schemaVersion",
          "stableIdentitySha256",
          "status",
          "taskId",
          "windowLabel",
        ].sort()) ||
        handoff.predecessorWindowIdentity.schemaVersion !==
          "uagent.mvp15d.predecessor-window-identity.v1" ||
        handoff.predecessorWindowIdentity.status !== "observed" ||
        handoff.predecessorWindowIdentity.windowLabel !== "main" ||
        /[\\/]/u.test(handoff.predecessorWindowIdentity.windowLabel) ||
        handoff.predecessorWindowIdentity.taskId !== value.taskId ||
        handoff.predecessorWindowIdentity.phase !== "product-capture" ||
        handoff.predecessorWindowIdentity.handoffId !== handoff.handoffId ||
        !isHex(handoff.predecessorWindowIdentity.stableIdentitySha256)
      ) {
        fail("FINAL_INVENTORY_PRODUCT_HANDOFF_INVALID");
      }
    }
    if (value.evidenceMode === "live" && value.schemaVersion === UI_SCHEMA) {
      const lifecycle = value.nativeLifecycleEvidence;
      const termination = value.mcpTermination;
      if (
        !lifecycle ||
        typeof lifecycle.n4ManagedProcessId !== "string" ||
        typeof lifecycle.n4OwnerTaskId !== "string" ||
        lifecycle.n4OwnerPhase !== "ui-lifecycle" ||
        typeof lifecycle.n5SuccessorSessionId !== "string" ||
        !Number.isSafeInteger(lifecycle.n5ObservationGeneration) ||
        lifecycle.n5ObservationGeneration < 1 ||
        stable(lifecycle.secondRollbackSetupApis) !== stable([
          "attach_editor_process",
          "register_asset_mutation_approval",
          "execute_asset_mutation",
          "record_asset_mutation_outcome",
          "rollback_asset_mutation",
          "record_asset_mutation_outcome",
        ]) ||
        !Array.isArray(lifecycle.secondRollbackSetupReceiptIds) ||
        lifecycle.secondRollbackSetupReceiptIds.length !== 6 ||
        lifecycle.secondRollbackSetupReceiptIds.some((id) => !isObservationReceiptId(id)) ||
        !termination ||
        termination.localCloseCount !== 9 ||
        termination.acceptedCount + termination.unsupportedCount !== 9 ||
        !Array.isArray(termination.receiptIds) ||
        termination.receiptIds.length !== 9 ||
        termination.receiptIds.some((id) => !isObservationReceiptId(id))
      ) {
        fail("FINAL_INVENTORY_UI_LIFECYCLE_INVALID");
      }
    }
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
  deriveProduct,
  deriveUi,
  ROOT_PATTERN as FINAL_ROOT,
};
