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
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TASK_GENERATION = "final-d13-d16";
const PHASE_EVENT_SCHEMA = "uagent.mvp15d.final.phase-event.v1";
const AUTOMATION_REPORT_VERIFICATION_SCHEMA =
  "uagent.mvp15d.final.automation-report-verification.v1";
const INVENTORY_BRIDGE_SCHEMA = "uagent.mvp15d.final.inventory-bridge.v1";
const FINAL_INVENTORY_SCHEMA = "uagent.mvp15d.final.inventory.v1";
const UE581_INVENTORY_SCHEMA = "uagent.mvp15d.ue581.evidence-inventory.v2";
const FINAL_ROOT_PATTERN = /^mvp15d-final-d13-d16-\d{8}_\d{6}(?:-[A-Za-z0-9]+)?$/u;
const UE581_ROOT_PATTERN = /^mvp15d-ue581-compat-\d{8}_\d{6}$/u;
const TASK_ID_PATTERN = /^TASK-MVP15D-[A-Z0-9-]+$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const PACKAGE_PREFIX = "package/UAgentAssetTools";
const PACKAGE_MANIFEST = `${PACKAGE_PREFIX}/UAgentAssetTools.build.json`;
const AUTOMATION_REPORT = "captures/ue-automation-report/index.json";
const AUTOMATION_EVENTS = "transcripts/ue-automation.events.jsonl";
const AUTOMATION_VERIFICATION = "metadata/automation-report-verification.json";
const INVENTORY_BRIDGE = "metadata/inventory-bridge.json";
const UE_AUTOMATION_TESTS = Object.freeze([
  "UAgentAssetTools.Contracts",
  "UAgentAssetTools.ReadOnly",
  "UAgentAssetTools.Closeout",
]);
const PHASES = Object.freeze(["ue-automation", "product-capture", "ui-lifecycle"]);
const SHARED_EVIDENCE_PATHS = Object.freeze([
  "captures/loaded-modules.json",
  AUTOMATION_VERIFICATION,
  "metadata/build-command.json",
  "metadata/build-result.json",
  ...PHASES.flatMap((phase) => [
    `metadata/${phase}.producer.json`,
    `metadata/${phase}.job-closeout.json`,
    `metadata/${phase}.port-closeout.json`,
    `summaries/${phase}.json`,
    `transcripts/${phase}.events.jsonl`,
    `transcripts/${phase}.runtime-events.jsonl`,
  ]),
]);

class FinalLiveVerifierError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new FinalLiveVerifierError(code);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stable(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("FINAL_LIVE_VERIFIER_NONFINITE_NUMBER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => stable(entry)).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  fail("FINAL_LIVE_VERIFIER_VALUE_INVALID");
}

function selfHash(value, field) {
  const basis = { ...value };
  delete basis[field];
  return sha256(Buffer.from(stable(basis), "utf8"));
}

function exactKeys(value, keys, code) {
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

function samePhysicalPath(left, right) {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function within(root, candidate) {
  const value = relative(root, candidate);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function validateLogicalPath(value, code) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\\") ||
    value.startsWith("/") ||
    isAbsolute(value) ||
    value.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    fail(code);
  }
  return value;
}

function requirePlainDirectory(path, expectedDevice, code) {
  if (!existsSync(path)) fail(code);
  const info = lstatSync(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (expectedDevice !== undefined && info.dev !== expectedDevice) ||
    !samePhysicalPath(realpathSync.native(path), resolve(path))
  ) {
    fail(code);
  }
  return info;
}

function requireExactFile(root, logical, code) {
  validateLogicalPath(logical, code);
  const rootInfo = requirePlainDirectory(root, undefined, code);
  let current = root;
  const segments = logical.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const matches = readdirSync(current).filter(
      (entry) => entry.toLowerCase() === segment.toLowerCase(),
    );
    if (matches.length !== 1 || matches[0] !== segment) fail(code);
    current = resolve(current, segment);
    if (!within(root, current) || !existsSync(current)) fail(code);
    const info = lstatSync(current);
    if (
      info.isSymbolicLink() ||
      info.dev !== rootInfo.dev ||
      !samePhysicalPath(realpathSync.native(current), current)
    ) {
      fail(code);
    }
    if (index < segments.length - 1) {
      if (!info.isDirectory()) fail(code);
    } else if (!info.isFile()) {
      fail(code);
    }
  }
  return current;
}

function descriptor(root, logical, code = "FINAL_LIVE_VERIFIER_FILE_INVALID") {
  const path = requireExactFile(root, logical, code);
  const bytes = readFileSync(path);
  return { path: logical, size: bytes.length, sha256: sha256(bytes) };
}

function readJsonFile(root, logical, code) {
  try {
    return JSON.parse(readFileSync(requireExactFile(root, logical, code), "utf8"));
  } catch (error) {
    if (error instanceof FinalLiveVerifierError) throw error;
    fail(code);
  }
}

function validateTaskSource(args) {
  const taskId = args["task-id"];
  const sourceCommit = args["source-commit"];
  if (!TASK_ID_PATTERN.test(taskId ?? "") || !COMMIT_PATTERN.test(sourceCommit ?? "")) {
    fail("FINAL_LIVE_VERIFIER_IDENTITY_INVALID");
  }
  return { taskId, sourceCommit };
}

function resolveRepository(value) {
  if (typeof value !== "string" || !value) fail("FINAL_LIVE_VERIFIER_REPOSITORY_INVALID");
  const repository = resolve(value);
  requirePlainDirectory(repository, undefined, "FINAL_LIVE_VERIFIER_REPOSITORY_INVALID");
  return repository;
}

function resolveEvidenceRoot(repository, value, pattern, code) {
  if (typeof value !== "string" || !value) fail(code);
  const root = resolve(value);
  const external = resolve(repository, "external");
  if (!pattern.test(basename(root)) || resolve(root, "..") !== external) fail(code);
  requirePlainDirectory(external, undefined, code);
  requirePlainDirectory(root, lstatSync(external).dev, code);
  return root;
}

function automationIdentity(args) {
  const repository = resolveRepository(args.repository);
  const root = resolveEvidenceRoot(
    repository,
    args["evidence-root"],
    FINAL_ROOT_PATTERN,
    "FINAL_LIVE_VERIFIER_FINAL_ROOT_INVALID",
  );
  return { repository, root, ...validateTaskSource(args) };
}

function bridgeIdentity(args) {
  const repository = resolveRepository(args.repository);
  const finalRoot = resolveEvidenceRoot(
    repository,
    args["evidence-root"],
    FINAL_ROOT_PATTERN,
    "FINAL_LIVE_VERIFIER_FINAL_ROOT_INVALID",
  );
  const ue581Root = resolveEvidenceRoot(
    repository,
    args["ue581-root"],
    UE581_ROOT_PATTERN,
    "FINAL_LIVE_VERIFIER_UE581_ROOT_INVALID",
  );
  if (finalRoot === ue581Root) fail("FINAL_LIVE_VERIFIER_BRIDGE_ROOT_INVALID");
  return { repository, finalRoot, ue581Root, ...validateTaskSource(args) };
}

function oneEvent(events, type, code) {
  const matches = events.filter((event) => event.type === type);
  if (matches.length !== 1) fail(code);
  return matches[0];
}

function parseAutomationEvents(root, taskId) {
  const logical = AUTOMATION_EVENTS;
  const path = requireExactFile(root, logical, "FINAL_LIVE_VERIFIER_EVENT_TRANSCRIPT_INVALID");
  const bytes = readFileSync(path);
  let events;
  try {
    const text = bytes.toString("utf8");
    if (text.includes("\uFFFD")) fail("FINAL_LIVE_VERIFIER_EVENT_TRANSCRIPT_INVALID");
    events = text
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error instanceof FinalLiveVerifierError) throw error;
    fail("FINAL_LIVE_VERIFIER_EVENT_TRANSCRIPT_INVALID");
  }
  if (events.length === 0) fail("FINAL_LIVE_VERIFIER_EVENT_TRANSCRIPT_INVALID");
  const first = events[0];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    exactKeys(
      event,
      [
        "schemaVersion",
        "phase",
        "taskId",
        "markerSha256",
        "sessionBindingSha256",
        "generation",
        "producer",
        "sequence",
        "capturedAt",
        "type",
        "data",
      ],
      "FINAL_LIVE_VERIFIER_EVENT_TRANSCRIPT_INVALID",
    );
    exactKeys(
      event.producer,
      ["id", "processIdBindingSha256", "mode"],
      "FINAL_LIVE_VERIFIER_EVENT_TRANSCRIPT_INVALID",
    );
    if (
      event.schemaVersion !== PHASE_EVENT_SCHEMA ||
      event.phase !== "ue-automation" ||
      event.taskId !== taskId ||
      !HASH_PATTERN.test(event.markerSha256) ||
      !HASH_PATTERN.test(event.sessionBindingSha256) ||
      !Number.isSafeInteger(event.generation) ||
      event.generation < 1 ||
      event.producer.id !== "mvp15d-final-ue-automation-producer" ||
      event.producer.mode !== "live" ||
      !HASH_PATTERN.test(event.producer.processIdBindingSha256) ||
      event.sequence !== index + 1 ||
      typeof event.type !== "string" ||
      Number.isNaN(Date.parse(event.capturedAt)) ||
      event.markerSha256 !== first.markerSha256 ||
      event.sessionBindingSha256 !== first.sessionBindingSha256 ||
      event.generation !== first.generation ||
      stable(event.producer) !== stable(first.producer)
    ) {
      fail("FINAL_LIVE_VERIFIER_EVENT_TRANSCRIPT_INVALID");
    }
  }
  return { events, descriptor: { path: logical, size: bytes.length, sha256: sha256(bytes) } };
}

function flattenReportTests(report) {
  const flattened = [];
  const visit = (entries) => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const name = entry.fullTestPath ?? entry.fullName ?? entry.testDisplayName ?? entry.name;
      const rawStatus = String(entry.state ?? entry.status ?? entry.result ?? "").toLowerCase();
      const status = ["success", "passed", "pass"].includes(rawStatus)
        ? "passed"
        : ["failed", "fail", "error"].includes(rawStatus)
          ? "failed"
          : ["skipped", "skip", "notrun", "not_run"].includes(rawStatus)
            ? "skipped"
            : null;
      if (typeof name === "string") flattened.push({ name, status });
      visit(entry.children);
      visit(entry.tests);
    }
  };
  visit(report.tests);
  return flattened;
}

function parseRawAutomationReport(root) {
  const path = requireExactFile(root, AUTOMATION_REPORT, "FINAL_LIVE_VERIFIER_REPORT_INVALID");
  const bytes = readFileSync(path);
  let report;
  try {
    const text = bytes.toString("utf8");
    if (text.includes("\uFFFD")) fail("FINAL_LIVE_VERIFIER_REPORT_INVALID");
    report = JSON.parse(text.replace(/^\uFEFF/u, ""));
  } catch (error) {
    if (error instanceof FinalLiveVerifierError) throw error;
    fail("FINAL_LIVE_VERIFIER_REPORT_INVALID");
  }
  if (
    report.succeeded !== 3 ||
    report.succeededWithWarnings !== 0 ||
    report.failed !== 0 ||
    report.notRun !== 0
  ) {
    fail("FINAL_LIVE_VERIFIER_REPORT_MATRIX_INVALID");
  }
  const flattened = flattenReportTests(report);
  const tests = UE_AUTOMATION_TESTS.map((name) => {
    const matches = flattened.filter((entry) => entry.name === name);
    if (matches.length !== 1 || matches[0].status !== "passed") {
      fail("FINAL_LIVE_VERIFIER_REPORT_MATRIX_INVALID");
    }
    return { name, status: "passed" };
  });
  if (flattened.length !== UE_AUTOMATION_TESTS.length) {
    fail("FINAL_LIVE_VERIFIER_REPORT_MATRIX_INVALID");
  }
  return {
    report,
    tests,
    summary: { expected: 3, passed: 3, failed: 0, skipped: 0 },
    descriptor: { path: AUTOMATION_REPORT, size: bytes.length, sha256: sha256(bytes) },
  };
}

function validateReportBinding(events, raw, sourceCommit) {
  const binding = oneEvent(
    events,
    "automation_report_binding",
    "FINAL_LIVE_VERIFIER_REPORT_BINDING_INVALID",
  ).data;
  exactKeys(
    binding,
    [
      "reportSha256",
      "taskBindingSha256",
      "projectSha256",
      "manifestSha256",
      "packageModulesSha256",
      "installedModulesSha256",
      "loadedModulesSha256",
      "executableSha256",
      "processIdBindingSha256",
    ],
    "FINAL_LIVE_VERIFIER_REPORT_BINDING_INVALID",
  );
  if (Object.values(binding).some((value) => !HASH_PATTERN.test(value))) {
    fail("FINAL_LIVE_VERIFIER_REPORT_BINDING_INVALID");
  }
  const runtimeProcess = oneEvent(
    events,
    "runtime_process_started",
    "FINAL_LIVE_VERIFIER_REPORT_BINDING_INVALID",
  ).data;
  const provenance = oneEvent(
    events,
    "production_provenance",
    "FINAL_LIVE_VERIFIER_REPORT_BINDING_INVALID",
  ).data;
  const summary = oneEvent(
    events,
    "automation_summary",
    "FINAL_LIVE_VERIFIER_REPORT_BINDING_INVALID",
  ).data;
  const tests = events
    .filter((event) => event.type === "automation_test")
    .map((event) => event.data);
  if (
    binding.reportSha256 !== raw.descriptor.sha256 ||
    binding.packageModulesSha256 !== binding.installedModulesSha256 ||
    binding.installedModulesSha256 !== binding.loadedModulesSha256 ||
    binding.processIdBindingSha256 !== runtimeProcess.processIdBindingSha256 ||
    binding.executableSha256 !== runtimeProcess.executable?.sha256 ||
    binding.projectSha256 !== provenance.projectSha256 ||
    binding.manifestSha256 !== provenance.manifestSha256 ||
    binding.loadedModulesSha256 !== provenance.loadedModulesSha256 ||
    provenance.sourceCommit !== sourceCommit ||
    provenance.sourceDirty !== false ||
    !HASH_PATTERN.test(provenance.sourceTreeSha256) ||
    stable(summary) !== stable(raw.summary) ||
    stable(tests) !== stable(raw.tests)
  ) {
    fail("FINAL_LIVE_VERIFIER_REPORT_BINDING_INVALID");
  }
  return { binding, provenance };
}

function automationVerificationRecord(identity) {
  const raw = parseRawAutomationReport(identity.root);
  const transcript = parseAutomationEvents(identity.root, identity.taskId);
  const { binding, provenance } = validateReportBinding(
    transcript.events,
    raw,
    identity.sourceCommit,
  );
  const record = {
    schemaVersion: AUTOMATION_REPORT_VERIFICATION_SCHEMA,
    taskGeneration: TASK_GENERATION,
    taskId: identity.taskId,
    sourceCommit: identity.sourceCommit,
    sourceTreeSha256: provenance.sourceTreeSha256,
    phase: "ue-automation",
    status: "verified",
    report: raw.descriptor,
    eventTranscript: transcript.descriptor,
    eventBinding: binding,
    automationSummary: raw.summary,
    tests: raw.tests,
    verifiedAt: transcript.events.at(-1).capturedAt,
  };
  record.verificationSelfSha256 = selfHash(record, "verificationSelfSha256");
  return record;
}

function validateDescriptor(value, expectedPath, code) {
  exactKeys(value, ["path", "size", "sha256"], code);
  if (
    value.path !== expectedPath ||
    !Number.isSafeInteger(value.size) ||
    value.size < 1 ||
    !HASH_PATTERN.test(value.sha256)
  ) {
    fail(code);
  }
}

function validateAutomationVerificationRecord(value, options = {}) {
  const code = "FINAL_LIVE_VERIFIER_AUTOMATION_RECORD_INVALID";
  exactKeys(
    value,
    [
      "schemaVersion",
      "taskGeneration",
      "taskId",
      "sourceCommit",
      "sourceTreeSha256",
      "phase",
      "status",
      "report",
      "eventTranscript",
      "eventBinding",
      "automationSummary",
      "tests",
      "verifiedAt",
      "verificationSelfSha256",
    ],
    code,
  );
  validateDescriptor(value.report, AUTOMATION_REPORT, code);
  validateDescriptor(value.eventTranscript, AUTOMATION_EVENTS, code);
  exactKeys(
    value.eventBinding,
    [
      "reportSha256",
      "taskBindingSha256",
      "projectSha256",
      "manifestSha256",
      "packageModulesSha256",
      "installedModulesSha256",
      "loadedModulesSha256",
      "executableSha256",
      "processIdBindingSha256",
    ],
    code,
  );
  if (
    value.schemaVersion !== AUTOMATION_REPORT_VERIFICATION_SCHEMA ||
    value.taskGeneration !== TASK_GENERATION ||
    !TASK_ID_PATTERN.test(value.taskId) ||
    !COMMIT_PATTERN.test(value.sourceCommit) ||
    !HASH_PATTERN.test(value.sourceTreeSha256) ||
    value.phase !== "ue-automation" ||
    value.status !== "verified" ||
    value.report.sha256 !== value.eventBinding.reportSha256 ||
    Object.values(value.eventBinding).some((entry) => !HASH_PATTERN.test(entry)) ||
    value.eventBinding.packageModulesSha256 !== value.eventBinding.installedModulesSha256 ||
    value.eventBinding.installedModulesSha256 !== value.eventBinding.loadedModulesSha256 ||
    stable(value.automationSummary) !== stable({ expected: 3, passed: 3, failed: 0, skipped: 0 }) ||
    stable(value.tests) !==
      stable(UE_AUTOMATION_TESTS.map((name) => ({ name, status: "passed" }))) ||
    Number.isNaN(Date.parse(value.verifiedAt)) ||
    !HASH_PATTERN.test(value.verificationSelfSha256) ||
    value.verificationSelfSha256 !== selfHash(value, "verificationSelfSha256") ||
    (options.taskId !== undefined && value.taskId !== options.taskId) ||
    (options.sourceCommit !== undefined && value.sourceCommit !== options.sourceCommit)
  ) {
    fail(code);
  }
  if (options.root !== undefined) {
    const observed = descriptor(options.root, AUTOMATION_EVENTS, code);
    if (stable(observed) !== stable(value.eventTranscript)) fail(code);
  }
  return value;
}

function createAutomationReportVerification(args) {
  const identity = automationIdentity(args);
  const output = resolve(identity.root, ...AUTOMATION_VERIFICATION.split("/"));
  if (existsSync(output)) fail("FINAL_LIVE_VERIFIER_AUTOMATION_RECORD_EXISTS");
  const record = automationVerificationRecord(identity);
  validateAutomationVerificationRecord(record, identity);
  writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return {
    status: "automation_report_binding_created",
    record: descriptor(identity.root, AUTOMATION_VERIFICATION),
    reportSha256: record.report.sha256,
    verificationSelfSha256: record.verificationSelfSha256,
  };
}

function verifyAutomationReportVerification(args) {
  const identity = automationIdentity(args);
  const expected = automationVerificationRecord(identity);
  const observed = readJsonFile(
    identity.root,
    AUTOMATION_VERIFICATION,
    "FINAL_LIVE_VERIFIER_AUTOMATION_RECORD_INVALID",
  );
  validateAutomationVerificationRecord(observed, identity);
  if (stable(observed) !== stable(expected)) fail("FINAL_LIVE_VERIFIER_AUTOMATION_RECORD_DRIFT");
  return {
    status: "automation_report_binding_verified",
    record: descriptor(identity.root, AUTOMATION_VERIFICATION),
    reportSha256: observed.report.sha256,
    verificationSelfSha256: observed.verificationSelfSha256,
  };
}

function validatePackageManifest(root, taskId, sourceCommit) {
  const manifest = readJsonFile(root, PACKAGE_MANIFEST, "FINAL_LIVE_VERIFIER_PACKAGE_INVALID");
  if (
    manifest.schemaVersion !== "uagent.ue-companion-plugin.build-manifest.v3" ||
    manifest.taskGeneration !== TASK_GENERATION ||
    manifest.taskId !== taskId ||
    manifest.sourceCommit !== sourceCommit ||
    !HASH_PATTERN.test(manifest.sourceTreeSha256) ||
    manifest.dirty !== false ||
    !Array.isArray(manifest.artifacts) ||
    manifest.artifacts.length < 1
  ) {
    fail("FINAL_LIVE_VERIFIER_PACKAGE_INVALID");
  }
  const folded = new Set();
  const artifacts = [...manifest.artifacts]
    .sort((left, right) => String(left.path).localeCompare(String(right.path), "en"))
    .map((artifact) => {
      exactKeys(artifact, ["path", "size", "sha256"], "FINAL_LIVE_VERIFIER_PACKAGE_INVALID");
      validateLogicalPath(artifact.path, "FINAL_LIVE_VERIFIER_PACKAGE_INVALID");
      const key = artifact.path.toLowerCase();
      if (folded.has(key)) fail("FINAL_LIVE_VERIFIER_PACKAGE_AMBIGUOUS");
      folded.add(key);
      const logical = `${PACKAGE_PREFIX}/${artifact.path}`;
      const observed = descriptor(root, logical, "FINAL_LIVE_VERIFIER_PACKAGE_INVALID");
      if (observed.size !== artifact.size || observed.sha256 !== artifact.sha256) {
        fail("FINAL_LIVE_VERIFIER_PACKAGE_INVALID");
      }
      return observed;
    });
  const manifestDescriptor = descriptor(
    root,
    PACKAGE_MANIFEST,
    "FINAL_LIVE_VERIFIER_PACKAGE_INVALID",
  );
  return {
    manifest,
    manifestDescriptor,
    artifacts,
    artifactInventorySha256: sha256(Buffer.from(stable(artifacts), "utf8")),
  };
}

function sharedDescriptors(root) {
  return [...SHARED_EVIDENCE_PATHS]
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((logical) => descriptor(root, logical, "FINAL_LIVE_VERIFIER_BRIDGE_FILE_MISSING"));
}

function inventoryBridgeRecord(identity, requireRawAuthority = false) {
  const finalShared = sharedDescriptors(identity.finalRoot);
  const ueShared = sharedDescriptors(identity.ue581Root);
  if (stable(finalShared) !== stable(ueShared)) fail("FINAL_LIVE_VERIFIER_BRIDGE_FILE_MISMATCH");
  const finalAutomation = validateAutomationVerificationRecord(
    readJsonFile(
      identity.finalRoot,
      AUTOMATION_VERIFICATION,
      "FINAL_LIVE_VERIFIER_AUTOMATION_RECORD_INVALID",
    ),
    { root: identity.finalRoot, taskId: identity.taskId, sourceCommit: identity.sourceCommit },
  );
  const ueAutomation = validateAutomationVerificationRecord(
    readJsonFile(
      identity.ue581Root,
      AUTOMATION_VERIFICATION,
      "FINAL_LIVE_VERIFIER_AUTOMATION_RECORD_INVALID",
    ),
    { root: identity.ue581Root, taskId: identity.taskId, sourceCommit: identity.sourceCommit },
  );
  if (stable(finalAutomation) !== stable(ueAutomation)) {
    fail("FINAL_LIVE_VERIFIER_AUTOMATION_RECORD_DRIFT");
  }
  if (requireRawAuthority) {
    const expectedAutomation = automationVerificationRecord({
      root: identity.finalRoot,
      taskId: identity.taskId,
      sourceCommit: identity.sourceCommit,
    });
    if (stable(finalAutomation) !== stable(expectedAutomation)) {
      fail("FINAL_LIVE_VERIFIER_AUTOMATION_RECORD_DRIFT");
    }
  }
  const finalPackage = validatePackageManifest(
    identity.finalRoot,
    identity.taskId,
    identity.sourceCommit,
  );
  const uePackage = validatePackageManifest(
    identity.ue581Root,
    identity.taskId,
    identity.sourceCommit,
  );
  if (
    stable(finalPackage.manifestDescriptor) !== stable(uePackage.manifestDescriptor) ||
    stable(finalPackage.artifacts) !== stable(uePackage.artifacts) ||
    finalPackage.artifactInventorySha256 !== uePackage.artifactInventorySha256 ||
    finalPackage.manifest.sourceTreeSha256 !== uePackage.manifest.sourceTreeSha256 ||
    finalAutomation.sourceCommit !== finalPackage.manifest.sourceCommit
  ) {
    fail("FINAL_LIVE_VERIFIER_BRIDGE_PACKAGE_MISMATCH");
  }
  const record = {
    schemaVersion: INVENTORY_BRIDGE_SCHEMA,
    taskGeneration: TASK_GENERATION,
    taskId: identity.taskId,
    sourceCommit: identity.sourceCommit,
    sourceTreeSha256: finalPackage.manifest.sourceTreeSha256,
    status: "verified",
    finalRootName: basename(identity.finalRoot),
    ue581RootName: basename(identity.ue581Root),
    sharedFiles: finalShared,
    sharedFilesSha256: sha256(Buffer.from(stable(finalShared), "utf8")),
    package: {
      manifest: finalPackage.manifestDescriptor,
      artifacts: finalPackage.artifacts,
      artifactInventorySha256: finalPackage.artifactInventorySha256,
    },
    automationReportVerificationSha256: finalAutomation.verificationSelfSha256,
  };
  record.bridgeSelfSha256 = selfHash(record, "bridgeSelfSha256");
  return record;
}

function validateInventoryBridgeRecord(value, options = {}) {
  const code = "FINAL_LIVE_VERIFIER_BRIDGE_RECORD_INVALID";
  exactKeys(
    value,
    [
      "schemaVersion",
      "taskGeneration",
      "taskId",
      "sourceCommit",
      "sourceTreeSha256",
      "status",
      "finalRootName",
      "ue581RootName",
      "sharedFiles",
      "sharedFilesSha256",
      "package",
      "automationReportVerificationSha256",
      "bridgeSelfSha256",
    ],
    code,
  );
  exactKeys(value.package, ["manifest", "artifacts", "artifactInventorySha256"], code);
  if (
    value.schemaVersion !== INVENTORY_BRIDGE_SCHEMA ||
    value.taskGeneration !== TASK_GENERATION ||
    !TASK_ID_PATTERN.test(value.taskId) ||
    !COMMIT_PATTERN.test(value.sourceCommit) ||
    !HASH_PATTERN.test(value.sourceTreeSha256) ||
    value.status !== "verified" ||
    !FINAL_ROOT_PATTERN.test(value.finalRootName) ||
    !UE581_ROOT_PATTERN.test(value.ue581RootName) ||
    !Array.isArray(value.sharedFiles) ||
    value.sharedFiles.length !== SHARED_EVIDENCE_PATHS.length ||
    !HASH_PATTERN.test(value.sharedFilesSha256) ||
    value.sharedFilesSha256 !== sha256(Buffer.from(stable(value.sharedFiles), "utf8")) ||
    !Array.isArray(value.package.artifacts) ||
    value.package.artifacts.length < 1 ||
    !HASH_PATTERN.test(value.package.artifactInventorySha256) ||
    value.package.artifactInventorySha256 !==
      sha256(Buffer.from(stable(value.package.artifacts), "utf8")) ||
    !HASH_PATTERN.test(value.automationReportVerificationSha256) ||
    !HASH_PATTERN.test(value.bridgeSelfSha256) ||
    value.bridgeSelfSha256 !== selfHash(value, "bridgeSelfSha256") ||
    (options.taskId !== undefined && value.taskId !== options.taskId) ||
    (options.sourceCommit !== undefined && value.sourceCommit !== options.sourceCommit)
  ) {
    fail(code);
  }
  validateDescriptor(value.package.manifest, PACKAGE_MANIFEST, code);
  const all = [...value.sharedFiles, ...value.package.artifacts];
  const folded = new Set();
  for (const item of all) {
    validateDescriptor(item, item.path, code);
    const key = item.path.toLowerCase();
    if (folded.has(key)) fail(code);
    folded.add(key);
  }
  const expectedShared = [...SHARED_EVIDENCE_PATHS].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  if (stable(value.sharedFiles.map(({ path }) => path)) !== stable(expectedShared)) fail(code);
  if (options.root !== undefined) {
    const expectedRootName = options.role === "final" ? value.finalRootName : value.ue581RootName;
    if (basename(resolve(options.root)) !== expectedRootName) fail(code);
    for (const item of all) {
      if (stable(descriptor(options.root, item.path, code)) !== stable(item)) fail(code);
    }
    if (
      stable(descriptor(options.root, PACKAGE_MANIFEST, code)) !== stable(value.package.manifest)
    ) {
      fail(code);
    }
  }
  return value;
}

function createInventoryBridge(args) {
  const identity = bridgeIdentity(args);
  const finalPath = resolve(identity.finalRoot, ...INVENTORY_BRIDGE.split("/"));
  const uePath = resolve(identity.ue581Root, ...INVENTORY_BRIDGE.split("/"));
  if (existsSync(finalPath) || existsSync(uePath)) fail("FINAL_LIVE_VERIFIER_BRIDGE_RECORD_EXISTS");
  const record = inventoryBridgeRecord(identity, true);
  validateInventoryBridgeRecord(record, {
    root: identity.finalRoot,
    role: "final",
    taskId: identity.taskId,
    sourceCommit: identity.sourceCommit,
  });
  writeFileSync(finalPath, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  try {
    writeFileSync(uePath, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    unlinkSync(finalPath);
    throw error;
  }
  return {
    status: "inventory_bridge_created",
    bridgeSelfSha256: record.bridgeSelfSha256,
    sharedFileCount: record.sharedFiles.length,
    packageArtifactCount: record.package.artifacts.length,
  };
}

function collectInventoryPayload(root, current = "", state) {
  const rootInfo = requirePlainDirectory(
    root,
    state?.rootDevice,
    "FINAL_LIVE_VERIFIER_INVENTORY_INVALID",
  );
  const output = state ?? {
    rootDevice: rootInfo.dev,
    directories: [],
    files: [],
    folded: new Set(),
  };
  const directory = current ? resolve(root, ...current.split("/")) : root;
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name, "en"),
  )) {
    const logical = current ? `${current}/${entry.name}` : entry.name;
    if (logical === "inventory.json") continue;
    validateLogicalPath(logical, "FINAL_LIVE_VERIFIER_INVENTORY_INVALID");
    const folded = logical.toLowerCase();
    if (output.folded.has(folded)) fail("FINAL_LIVE_VERIFIER_INVENTORY_INVALID");
    output.folded.add(folded);
    const path = resolve(root, ...logical.split("/"));
    const info = lstatSync(path);
    if (
      !within(root, path) ||
      entry.isSymbolicLink() ||
      info.isSymbolicLink() ||
      info.dev !== output.rootDevice ||
      !samePhysicalPath(realpathSync.native(path), path)
    ) {
      fail("FINAL_LIVE_VERIFIER_INVENTORY_INVALID");
    }
    if (entry.isDirectory() && info.isDirectory()) {
      output.directories.push(logical);
      collectInventoryPayload(root, logical, output);
    } else if (entry.isFile() && info.isFile()) {
      const bytes = readFileSync(path);
      output.files.push({ path: logical, size: bytes.length, sha256: sha256(bytes) });
    } else {
      fail("FINAL_LIVE_VERIFIER_INVENTORY_INVALID");
    }
  }
  return output;
}

function inventoryBundleHash(role, directories, files) {
  const material =
    role === "final"
      ? files.map(({ path, size, sha256: digest }) => `${path}\0${size}\0${digest}`).join("\n")
      : [
          ...directories.map((path) => `D\0${path}`),
          ...files.map(
            ({ path, size, sha256: digest, type, schemaVersion }) =>
              `F\0${path}\0${size}\0${digest}\0${type}\0${schemaVersion ?? ""}`,
          ),
        ].join("\n");
  return sha256(Buffer.from(material, "utf8"));
}

function validateSealedInventory(root, role, record) {
  const inventory = readJsonFile(root, "inventory.json", "FINAL_LIVE_VERIFIER_INVENTORY_INVALID");
  const isFinal = role === "final";
  exactKeys(
    inventory,
    isFinal
      ? [
          "schemaVersion",
          "taskGeneration",
          "taskId",
          "directoryCount",
          "fileCount",
          "directories",
          "files",
          "bundleSha256",
          "inventorySelfSha256",
        ]
      : [
          "schemaVersion",
          "taskGeneration",
          "taskId",
          "status",
          "directoryCount",
          "fileCount",
          "directories",
          "files",
          "bundleSha256",
          "inventorySelfSha256",
        ],
    "FINAL_LIVE_VERIFIER_INVENTORY_INVALID",
  );
  if (
    inventory.schemaVersion !== (isFinal ? FINAL_INVENTORY_SCHEMA : UE581_INVENTORY_SCHEMA) ||
    inventory.taskGeneration !== TASK_GENERATION ||
    inventory.taskId !== record.taskId ||
    (!isFinal && inventory.status !== "complete") ||
    !Number.isSafeInteger(inventory.directoryCount) ||
    !Number.isSafeInteger(inventory.fileCount) ||
    !Array.isArray(inventory.directories) ||
    !Array.isArray(inventory.files) ||
    !HASH_PATTERN.test(inventory.bundleSha256) ||
    !HASH_PATTERN.test(inventory.inventorySelfSha256)
  ) {
    fail("FINAL_LIVE_VERIFIER_INVENTORY_INVALID");
  }
  const folded = new Set();
  for (const directory of inventory.directories) {
    validateLogicalPath(directory, "FINAL_LIVE_VERIFIER_INVENTORY_INVALID");
    const key = directory.toLowerCase();
    if (folded.has(key)) fail("FINAL_LIVE_VERIFIER_INVENTORY_INVALID");
    folded.add(key);
  }
  for (const file of inventory.files) {
    exactKeys(
      file,
      isFinal ? ["path", "size", "sha256"] : ["path", "size", "sha256", "type", "schemaVersion"],
      "FINAL_LIVE_VERIFIER_INVENTORY_INVALID",
    );
    validateLogicalPath(file.path, "FINAL_LIVE_VERIFIER_INVENTORY_INVALID");
    if (
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      !HASH_PATTERN.test(file.sha256) ||
      (!isFinal && (typeof file.type !== "string" || file.type.length === 0)) ||
      (!isFinal && file.schemaVersion !== null && typeof file.schemaVersion !== "string")
    ) {
      fail("FINAL_LIVE_VERIFIER_INVENTORY_INVALID");
    }
    const key = file.path.toLowerCase();
    if (folded.has(key)) fail("FINAL_LIVE_VERIFIER_INVENTORY_INVALID");
    folded.add(key);
  }
  const walked = collectInventoryPayload(root);
  const directories = [...walked.directories].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  const files = [...inventory.files].sort((left, right) =>
    left.path.localeCompare(right.path, "en"),
  );
  const walkedFiles = [...walked.files].sort((left, right) =>
    left.path.localeCompare(right.path, "en"),
  );
  if (
    inventory.directoryCount !== directories.length ||
    inventory.fileCount !== files.length ||
    stable(inventory.directories) !== stable(directories) ||
    stable(inventory.files) !== stable(files) ||
    stable(files.map(({ path, size, sha256: digest }) => ({ path, size, sha256: digest }))) !==
      stable(walkedFiles) ||
    inventory.bundleSha256 !== inventoryBundleHash(role, directories, files) ||
    inventory.inventorySelfSha256 !== selfHash(inventory, "inventorySelfSha256")
  ) {
    fail("FINAL_LIVE_VERIFIER_INVENTORY_INVALID");
  }
  const matches = inventory.files.filter(
    (entry) => String(entry?.path ?? "").toLowerCase() === INVENTORY_BRIDGE.toLowerCase(),
  );
  const observed = descriptor(root, INVENTORY_BRIDGE, "FINAL_LIVE_VERIFIER_BRIDGE_RECORD_INVALID");
  if (
    matches.length !== 1 ||
    matches[0].path !== INVENTORY_BRIDGE ||
    matches[0].size !== observed.size ||
    matches[0].sha256 !== observed.sha256
  ) {
    fail("FINAL_LIVE_VERIFIER_INVENTORY_BRIDGE_ENTRY_INVALID");
  }
}

function verifyInventoryBridge(args) {
  const identity = bridgeIdentity(args);
  const finalRecord = readJsonFile(
    identity.finalRoot,
    INVENTORY_BRIDGE,
    "FINAL_LIVE_VERIFIER_BRIDGE_RECORD_INVALID",
  );
  const ueRecord = readJsonFile(
    identity.ue581Root,
    INVENTORY_BRIDGE,
    "FINAL_LIVE_VERIFIER_BRIDGE_RECORD_INVALID",
  );
  validateInventoryBridgeRecord(finalRecord, {
    root: identity.finalRoot,
    role: "final",
    taskId: identity.taskId,
    sourceCommit: identity.sourceCommit,
  });
  validateInventoryBridgeRecord(ueRecord, {
    root: identity.ue581Root,
    role: "ue581",
    taskId: identity.taskId,
    sourceCommit: identity.sourceCommit,
  });
  if (stable(finalRecord) !== stable(ueRecord)) fail("FINAL_LIVE_VERIFIER_BRIDGE_RECORD_MISMATCH");
  const expected = inventoryBridgeRecord(identity);
  if (stable(finalRecord) !== stable(expected)) fail("FINAL_LIVE_VERIFIER_BRIDGE_RECORD_DRIFT");
  validateSealedInventory(identity.finalRoot, "final", finalRecord);
  validateSealedInventory(identity.ue581Root, "ue581", finalRecord);
  return {
    status: "inventory_bridge_verified",
    bridgeSelfSha256: finalRecord.bridgeSelfSha256,
    sharedFileCount: finalRecord.sharedFiles.length,
    packageArtifactCount: finalRecord.package.artifacts.length,
  };
}

function parseArgs(argv) {
  const supported = new Set([
    "repository",
    "evidence-root",
    "ue581-root",
    "task-id",
    "source-commit",
  ]);
  const args = Object.create(null);
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) fail("FINAL_LIVE_VERIFIER_ARGUMENT_INVALID");
    const key = item.slice(2);
    const value = argv[index + 1];
    if (!supported.has(key) || Object.hasOwn(args, key) || !value || value.startsWith("--")) {
      fail("FINAL_LIVE_VERIFIER_ARGUMENT_INVALID");
    }
    args[key] = value;
    index += 1;
  }
  return args;
}

function run(command, args) {
  if (command === "automation-report-create") return createAutomationReportVerification(args);
  if (command === "automation-report-verify") return verifyAutomationReportVerification(args);
  if (command === "inventory-bridge-create") return createInventoryBridge(args);
  if (command === "inventory-bridge-verify") return verifyInventoryBridge(args);
  fail("FINAL_LIVE_VERIFIER_COMMAND_INVALID");
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  console.log(JSON.stringify(run(command, parseArgs(rest))));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    const reason =
      error instanceof FinalLiveVerifierError
        ? error.code
        : (error?.code ?? "FINAL_LIVE_VERIFIER_FAILED");
    console.error(JSON.stringify({ status: "final_live_verification_rejected", reason }));
    process.exitCode = 2;
  }
}

export {
  AUTOMATION_REPORT_VERIFICATION_SCHEMA,
  FinalLiveVerifierError,
  INVENTORY_BRIDGE_SCHEMA,
  SHARED_EVIDENCE_PATHS,
  createAutomationReportVerification,
  createInventoryBridge,
  run,
  selfHash,
  sha256,
  stable,
  validateAutomationVerificationRecord,
  validateInventoryBridgeRecord,
  verifyAutomationReportVerification,
  verifyInventoryBridge,
};
