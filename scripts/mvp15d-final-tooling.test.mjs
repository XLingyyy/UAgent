/* global process, structuredClone */

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import {
  EVENT_SCHEMA,
  TASK_GENERATION,
  UE_SCHEMA,
  TOOL_NAMES,
  FORWARD_ORDER,
  INVERSE_ORDER,
  deriveProduct,
  deriveUi,
  executeLivePhase,
  executeOwnedLaunchReceiptFixture,
  inventoryCreate,
  inventoryVerify,
  run as runFinal,
  verifyUeProductionArtifactConsistency,
  validateProductCapture,
  validateUeAutomation,
} from "./mvp15d-final-runner.mjs";
import {
  BRIDGE_VERSION,
  LiveProducerError,
  RUNTIME_EVENT_SCHEMA,
  parseOfficialAutomationReport,
  parseRuntimeEvents,
  runRuntimeCapabilityHandshake,
  runtimeCommand,
  validateBinding,
} from "./mvp15d-final-live-producer-helper.mjs";
import { runProductCaptureProducer } from "./mvp15d-final-product-capture-producer.mjs";
import {
  collectPackageArtifacts,
  LOADED_LEDGER_SCHEMA,
  create as createManifest,
  manifestSelfHash,
  verify as verifyManifest,
  verifyInstalled,
} from "./mvp15d-manifest.mjs";
import {
  EARLY_IDENTITY_SCHEMA,
  PRODUCTION_AUTHORITY_SCHEMA,
  PRODUCTION_ORIGIN,
} from "./mvp15d-loaded-module-observer.mjs";
import { computeSourceIdentity } from "./mvp15d-source-identity.mjs";
import {
  CANONICAL_FIXTURE_SHA256,
  CANONICAL_FIXTURE_SIZE,
  ToolingError,
  deriveToolchainFacts,
  findTranscriptLeaks,
  redactTranscript,
  runBuild,
} from "./mvp15d-plugin-build.mjs";
import { IconValidationError, validateIcon } from "./mvp15d-icon-validate.mjs";
import { ProbeError, parseTerminalResponse } from "./mvp15d-ue581-mcp-probe.mjs";

const REPOSITORY = resolve(process.cwd());
const TASK_ID = "TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-FINAL-D13-D16";
const CURRENT_REWORK_TASK_ID =
  "TASK-MVP15D-FINAL-PRE-LIVE-SOURCE-CLOSURE-REWORK-7-PRODUCTION-APP-NATIVE-HANDOFF-WINDOW-BINDING-AND-COMPLETE-TEMP-INVENTORY";
let handAuthoredFixtureSequence = 0;

test("structured runtime contracts reject mixed v1 evidence", () => {
  assert.equal(BRIDGE_VERSION, "uagent.mvp15d.runtime-bridge.v5");
  assert.equal(RUNTIME_EVENT_SCHEMA, "uagent.mvp15d.final.runtime-event.v2");
  assert.throws(
    () =>
      parseRuntimeEvents(
        [
          {
            schemaVersion: "uagent.mvp15d.final.runtime-event.v1",
            phase: "product-capture",
            type: "evidence_origin",
            data: { origin: "production_runtime", fixtureUsed: false },
          },
        ],
        { phase: "product-capture" },
      ),
    (error) =>
      error instanceof LiveProducerError && error.code === "FINAL_LIVE_RUNTIME_EVENT_INVALID",
  );
});

test("owned launch receipt fixture uses a private same-process brand without production authority", () => {
  const result = executeOwnedLaunchReceiptFixture();
  assert.equal(result.status, "owned_launch_receipt_fixture_verified");
  assert.equal(result.fixtureUsed, true);
  assert.equal(result.ownedLaunchReceiptVerified, true);
  assert.equal(result.persistedArtifactConsistencyVerified, false);
  assert.equal(result.productionLaunchAuthorityVerified, false);
  assert.equal(Number.isSafeInteger(result.childPid), true);
  assert.equal(Object.hasOwn(result, "receipt"), false);
  assert.equal(Object.hasOwn(result, "launchReceipt"), false);
  assert.throws(
    () => executeOwnedLaunchReceiptFixture({ productionLaunchAuthorityVerified: true }),
    (error) => error?.code === "FINAL_PHASE_ARGUMENT_INVALID",
  );
});

test(
  "actual release runtime owns all handshakes or is explicitly classified as the stale installed binary",
  { timeout: 180_000 },
  async () => {
    const executable = resolve(
      REPOSITORY,
      "apps",
      "desktop",
      "src-tauri",
      "target",
      "release",
      "uagent.exe",
    );
    assert.equal(existsSync(executable), true, "release uagent.exe must be built before this gate");
    const sourceCommit = git(REPOSITORY, ["rev-parse", "HEAD"]);
    const external = resolve(REPOSITORY, "external");
    mkdirSync(external, { recursive: true });
    const phases = ["capability-probe", "product-capture", "ui-lifecycle"];
    let staleInstalledReleaseObserved = false;
    let completedPhases = 0;
    for (const [index, phase] of phases.entries()) {
      const suffix = createHash("sha256")
        .update(`${phase}:${process.pid}:${Date.now()}:${index}`)
        .digest("hex")
        .slice(0, 10);
      const root = resolve(external, `mvp15d-final-d13-d16-20260731_12010${index}-${suffix}`);
      mkdirSync(root);
      try {
        let result;
        try {
          result = await runRuntimeCapabilityHandshake({
            phase,
            repository: REPOSITORY,
            evidenceRoot: root,
            taskId: CURRENT_REWORK_TASK_ID,
            sourceCommit,
            marker: `uagent-mvp15d-runtime-capability-${phase}-0001`,
            session: `uagent-mvp15d-runtime-capability-${phase}-session-0001`,
            generation: index + 1,
            port: 38_760 + index,
            endpoint: `http://127.0.0.1:${38_760 + index}/mcp`,
            timeoutMilliseconds: 90_000,
          });
        } catch (error) {
          const newestRuntimeSource = Math.max(
            ...[
              "apps/desktop/src-tauri/src/lib.rs",
              "apps/desktop/src-tauri/src/mvp15d_runtime_bridge.rs",
              "apps/desktop/src-tauri/src/mcp.rs",
            ].map((path) => lstatSync(resolve(REPOSITORY, path)).mtimeMs),
          );
          assert.equal(index, 0);
          assert.equal(error?.code, "FINAL_LIVE_RUNTIME_NONZERO");
          assert.equal(lstatSync(executable).mtimeMs < newestRuntimeSource, true);
          staleInstalledReleaseObserved = true;
          break;
        }
        assert.equal(result.status, "runtime_capability_verified");
        assert.equal(result.phase, phase);
        assert.equal(result.runtimeExecutable.basename, "uagent.exe");
        assert.match(result.runtimeExecutable.sha256, /^[0-9a-f]{64}$/);
        assert.match(result.eventFile.sha256, /^[0-9a-f]{64}$/);
        assert.match(result.nonceSha256, /^[0-9a-f]{64}$/);
        assert.equal(result.processCloseout.exitCode, 0);
        assert.equal(result.processCloseout.residualCount, 0);
        assert.equal(result.mcpCalls, 0);
        assert.equal(result.networkCalls, 0);
        assert.equal(result.assetOperations, 0);
        assert.equal(result.rendererStarted, phase !== "capability-probe");
        completedPhases += 1;
        for (const directory of ["metadata", "transcripts", "logs"]) {
          assert.deepEqual(readdirSync(resolve(root, directory)), []);
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
    assert.equal(staleInstalledReleaseObserved || completedPhases === phases.length, true);
  },
);

test("official UE Automation report derives the fixed pass matrix and rejects failed cases", () => {
  const directory = mkdtempSync(join(tmpdir(), "uagent-mvp15d-ue-report-"));
  const binding = {
    taskId: TASK_ID,
    sourceCommit: "1".repeat(40),
    marker: "uagent-mvp15d-ue-report-marker-0001",
    sessionId: "uagent-mvp15d-ue-report-session-0001",
    generation: 1,
  };
  const matrix = [
    "UAgentAssetTools.Contracts",
    "UAgentAssetTools.ReadOnly",
    "UAgentAssetTools.Closeout",
  ];
  try {
    writeFileSync(
      resolve(directory, "index.json"),
      `${JSON.stringify({
        tests: matrix.map((name) => ({ fullTestPath: name, state: "Success" })),
      })}\n`,
    );
    const parsed = parseOfficialAutomationReport(directory, binding);
    assert.deepEqual(parsed.summary, { expected: 3, passed: 3, failed: 0, skipped: 0 });
    assert.deepEqual(
      parsed.matrix,
      matrix.map((name) => ({ name, status: "passed" })),
    );
    writeFileSync(
      resolve(directory, "index.json"),
      `${JSON.stringify({
        tests: matrix.map((name, index) => ({
          fullTestPath: name,
          state: index === 1 ? "Failed" : "Success",
        })),
      })}\n`,
    );
    assert.throws(
      () => parseOfficialAutomationReport(directory, binding),
      (error) =>
        error instanceof LiveProducerError && error.code === "FINAL_LIVE_UE_REPORT_MATRIX_INVALID",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function git(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function expectCode(action, code) {
  assert.throws(action, (error) => error instanceof Error && error.message === code);
}

function sourceRecord(root, logicalPath, producer = "fixture-producer", schema = "text/plain") {
  const path = resolve(root, logicalPath.split("/").join("\\"));
  const bytes = readFileSync(path);
  return {
    relativePath: logicalPath,
    size: bytes.length,
    sha256: cryptoHash(bytes),
    capturedAt: "2026-07-28T12:00:00.000Z",
    producer,
    redactionStatus: "raw",
    schema,
  };
}

function cryptoHash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function retainedBindingForTest(kind, raw) {
  const canonical = typeof raw === "string" ? raw : stableForTest(raw);
  return cryptoHash(Buffer.from(`uagent.mvp15d.retained.${kind}.v1\0${canonical}`, "utf8"));
}

function stableForTest(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableForTest).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableForTest(value[key])}`)
    .join(",")}}`;
}

const LIVE_AUTHORITY_CONTEXT = Object.freeze({
  sourceCommit: "a".repeat(40),
  sourceTreeSha256: "b".repeat(64),
  sessionId: "phase-session-authority-0001",
  generation: 17,
  runtimeProcessId: 4517,
});

function hashStableForTest(value) {
  return cryptoHash(Buffer.from(stableForTest(value), "utf8"));
}

function authorityEvent(type, authorityLevel, data) {
  return { type, data: { authorityLevel, ...data } };
}

function rebindAuthorityData(data, bindingKey) {
  const material = Object.fromEntries(
    Object.entries(data).filter(([key]) => key !== "authorityLevel" && key !== bindingKey),
  );
  data[bindingKey] = hashStableForTest(material);
}

function liveFixedArtifactEvent(context = LIVE_AUTHORITY_CONTEXT) {
  const modules = [{ relativePath: "Binaries/Win64/UAgentAssetTools.dll", sha256: "c".repeat(64) }];
  const modulesSha256 = hashStableForTest(modules);
  const material = {
    sourceCommit: context.sourceCommit,
    sourceTreeSha256: context.sourceTreeSha256,
    phaseSessionId: context.sessionId,
    phaseGeneration: context.generation,
    runtimeProcessId: context.runtimeProcessId,
    manifest: { sha256: "1".repeat(64), modulesSha256 },
    packageInventory: { sha256: "2".repeat(64), modulesSha256 },
    installedInventory: { sha256: "3".repeat(64), modulesSha256 },
    loadedObserver: { ledgerSha256: "4".repeat(64), modulesSha256 },
    modules,
  };
  return authorityEvent("fixed_artifact_authority", "fixed_producer", {
    ...material,
    producerBindingSha256: hashStableForTest(material),
  });
}

function liveDescriptor(name, index) {
  return {
    affectedAssetsSchema: { type: "array", index },
    dryRunSchema: { type: "object", index },
    evidenceQuery: { type: "object", index },
    inputSchema: { type: "object", index },
    methodId: name,
    name,
    rollbackContract: { type: "object", index },
    schemaVersion: "mvp15d.asset-tools.v1",
    source: index === 0 ? "facade" : "direct",
    toolsetId: index === 0 ? "uagent.asset-tools" : null,
  };
}

function liveProductAuthorityFixture() {
  const descriptors = TOOL_NAMES.map(liveDescriptor);
  const fingerprintSha256 = hashStableForTest({
    schemaVersion: "uagent.mvp15.live-asset-toolset-fingerprint.v1",
    tools: descriptors,
  });
  const events = [
    authorityEvent("capture_origin", "runtime_observed", {
      origin: "real_product_adapter",
      fixtureUsed: false,
      manualDescriptorInjection: false,
      directMcpBypass: false,
    }),
    ...["Connect", "Initialize", "Discover", "Normalize", "Fingerprint"].map((step) => ({
      type: "product_step",
      data: { step },
    })),
    liveFixedArtifactEvent(),
  ];
  for (const [index, mode] of ["on", "off"].entries()) {
    const material = {
      mode,
      configInputSha256: `${index + 5}`.repeat(64),
      configOutputSha256: `${index + 7}`.repeat(64),
      mcpSessionId: `mcp-session-authority-${index + 1}`,
      rendererInstanceId: `renderer-authority-${index + 1}`,
      processIdentitySha256: `${index + 8}`.repeat(64),
      generation: index + 20,
      descriptors: structuredClone(descriptors),
      fingerprintSha256,
      mutationCount: 0,
    };
    events.push(
      authorityEvent("product_discovery_observation", "runtime_observed", {
        ...material,
        observationBindingSha256: hashStableForTest(material),
      }),
    );
  }
  const reasons = [
    "refresh_tools",
    "reconnect",
    "endpoint_change",
    "renderer_restart",
    "ue_restart",
    "stale_completion",
  ];
  for (const [index, reason] of reasons.entries()) {
    const rendererRestart = reason === "renderer_restart";
    const replacesSession = reason !== "refresh_tools";
    const material = {
      reason,
      sessionIdBefore: `retraction-session-before-${index + 1}`,
      sessionIdAfter: replacesSession
        ? `retraction-session-after-${index + 1}`
        : `retraction-session-before-${index + 1}`,
      rendererInstanceIdBefore: `renderer-before-${index + 1}`,
      rendererInstanceIdAfter: rendererRestart
        ? `renderer-after-${index + 1}`
        : `renderer-before-${index + 1}`,
      processIdentitySha256Before: `${index + 1}`.repeat(64),
      processIdentitySha256After: rendererRestart ? "f".repeat(64) : `${index + 1}`.repeat(64),
      generationBefore: index + 30,
      generationAfter: index + 31,
      fingerprintSha256,
      count: TOOL_NAMES.length,
      nativeRetraction: {
        api: "retract_mvp15_companion_approvals",
        requestSha256: `${index + 1}`.repeat(64),
        responseSha256: `${index + 2}`.repeat(64),
        applied: true,
        revokedApprovalCount: 0,
      },
    };
    events.push(
      authorityEvent("retraction_observation", "runtime_observed", {
        ...material,
        observationBindingSha256: hashStableForTest(material),
      }),
    );
  }
  events.push(
    authorityEvent("mutation_counter_observation", "runtime_observed", {
      before: { dryRun: 0, execute: 0, rollback: 0 },
      after: { dryRun: 0, execute: 0, rollback: 0 },
    }),
  );
  return events;
}

function liveObservedCall(api, status, reason, evidenceId) {
  return {
    api,
    requestSha256: hashStableForTest({ evidenceId, direction: "request" }),
    responseSha256: hashStableForTest({ evidenceId, direction: "response" }),
    status,
    reason,
    evidenceId,
  };
}

function liveUiAuthorityFixture() {
  const expectedPath = [
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
  const registrationId = "registration-happy-0001";
  const runId = "run-happy-authority-0001";
  const events = [
    authorityEvent("capture_origin", "runtime_observed", {
      origin: "rendered_product_ui",
      fixtureUsed: false,
    }),
    ...expectedPath.map((step) => ({ type: "rendered_step", data: { step } })),
    liveFixedArtifactEvent(),
  ];
  for (const [index, action] of [...FORWARD_ORDER, ...INVERSE_ORDER].entries()) {
    const direction = index < FORWARD_ORDER.length ? "forward" : "inverse";
    events.push(
      authorityEvent("lifecycle_operation_observation", "runtime_observed", {
        direction,
        action,
        operationId: `operation-happy-${index + 1}`,
        registrationId,
        runId,
        nativeCall: liveObservedCall(
          direction === "forward" ? "execute_asset_mutation" : "rollback_asset_mutation",
          "accepted_by_native_guard",
          "accepted",
          `native-happy-evidence-${index + 1}`,
        ),
        mcpCall: liveObservedCall(
          "mcp_asset_tool_call",
          "succeeded",
          "completed",
          `mcp-happy-evidence-${index + 1}`,
        ),
        sideEffectCount: 1,
      }),
    );
  }
  for (const stage of ["before", "after"]) {
    events.push(
      authorityEvent("content_manifest_observation", "native_observed", {
        stage,
        registrationId,
        runId,
        evidenceId: `manifest-happy-${stage}-0001`,
        sha256: "d".repeat(64),
        runRootPresent: false,
      }),
    );
  }
  const reasons = [
    "untrusted_root",
    "feature_disabled",
    "observation_session_stopped",
    "process_exited",
    "stale_generation",
    "sandbox_path_required",
    "execute_replay",
    "rollback_replay",
  ];
  for (const [index, reason] of reasons.entries()) {
    const caseId = `N${index + 1}`;
    events.push(
      authorityEvent("negative_case_observation", "runtime_observed", {
        caseId,
        sessionId: `session-${caseId}-authority`,
        nativeSessionId: `native-session-${caseId}-authority`,
        runId: `run-${caseId}-authority`,
        registrationId: `registration-${caseId}-authority`,
        guardCall: liveObservedCall(
          caseId === "N6"
            ? "dry_run_asset_mutation"
            : caseId === "N8"
              ? "rollback_asset_mutation"
              : "execute_asset_mutation",
          "blocked",
          reason,
          `guard-${caseId}-evidence`,
        ),
        contentBefore: { evidenceId: `content-${caseId}-before`, sha256: "e".repeat(64) },
        contentAfter: { evidenceId: `content-${caseId}-after`, sha256: "e".repeat(64) },
        countersBefore: [index, 0, 0, 0, 0],
        countersAfter: [index + 1, 0, 0, 0, 0],
        observationStopped: true,
        mcpDisconnected: true,
      }),
    );
  }
  const partialMatrix = [
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
  events.push(
    authorityEvent("partial_unknown_observation", "runtime_observed", {
      sessionId: "session-partial-authority",
      nativeSessionId: "native-session-partial-authority",
      runId: "run-partial-authority",
      registrationId: "registration-partial-authority",
      operationResults: partialMatrix.map(
        ([direction, action, status, effectState, reason], index) => ({
          sequence: index + 1,
          direction,
          action,
          api:
            index < 7
              ? "mcp_asset_tool_call"
              : index === 7
                ? "execute_asset_mutation"
                : "rollback_asset_mutation",
          requestSha256: hashStableForTest({ index, direction: "request" }),
          responseSha256: hashStableForTest({ index, direction: "response" }),
          status,
          effectState,
          reason,
          evidenceId: `partial-operation-evidence-${index + 1}`,
        }),
      ),
      contentBefore: { evidenceId: "partial-content-before", sha256: "f".repeat(64) },
      contentAfter: { evidenceId: "partial-content-after", sha256: "f".repeat(64) },
      countersBefore: [0, 0, 0, 0, 0],
      countersAfter: [9, 9, 0, 0, 4],
      observationStopped: true,
      mcpDisconnected: true,
    }),
    authorityEvent("replay_inspection_observation", "runtime_observed", {
      recordedRepresentationSha256: "9".repeat(64),
      recordedEventCount: 6,
      recordedActions: ["dry-run", "preview", "approval", "execute", "verify", "rollback"],
      counterNames: ["native", "mcp", "provider", "verify", "rollback"],
      countersBefore: [9, 9, 0, 0, 4],
      countersAfter: [9, 9, 0, 0, 4],
      sideEffectDelta: [0, 0, 0, 0, 0],
    }),
    authorityEvent("negative_matrix", "derived_only", {
      caseCount: 8,
      passedCount: 8,
      rawObservationCount: 8,
    }),
    authorityEvent("partial_unknown_effect", "derived_only", {
      covered: true,
      rawOperationCount: 9,
    }),
    authorityEvent("run_root_state", "derived_only", {
      removed: true,
      contentEvidenceId: "manifest-happy-after-0001",
    }),
    authorityEvent("ownership_state", "derived_only", { parentCloseoutRequired: true }),
  );
  return events;
}

function liveParentCloseout() {
  return {
    authorityLevel: "parent_observed",
    processResidualCount: 0,
    portResidualCount: 0,
    markerResidualCount: 0,
    partialOutputCount: 0,
    jobCloseoutSha256: "7".repeat(64),
    portObservationSha256: "8".repeat(64),
    runtimeProcessId: LIVE_AUTHORITY_CONTEXT.runtimeProcessId,
    phaseSessionId: LIVE_AUTHORITY_CONTEXT.sessionId,
    phaseGeneration: LIVE_AUTHORITY_CONTEXT.generation,
  };
}

test("live derivation rejects synthetic, renderer-authored and summary-only authority substitutions", () => {
  assert.throws(
    () =>
      deriveProduct(
        liveProductAuthorityFixture(),
        liveParentCloseout(),
        "live",
        LIVE_AUTHORITY_CONTEXT,
      ),
    (error) => error?.code === "FINAL_PRODUCT_LIVE_AUTHORITY_INVALID",
  );
  assert.throws(
    () => deriveUi(liveUiAuthorityFixture(), liveParentCloseout(), "live", LIVE_AUTHORITY_CONTEXT),
    (error) => error?.code === "FINAL_UI_LIVE_AUTHORITY_INVALID",
  );

  const cases = [
    [
      "Rework 1 synthetic N1-N8 and partial records",
      () => {
        const events = liveUiAuthorityFixture().filter(
          ({ type }) =>
            !["negative_case_observation", "partial_unknown_observation"].includes(type),
        );
        events.push(
          { type: "negative_case", data: { caseId: "N1" } },
          { type: "partial_unknown_effect_record", data: { effectState: "unknown" } },
        );
        return deriveUi(events, liveParentCloseout(), "live", LIVE_AUTHORITY_CONTEXT);
      },
    ],
    [
      "perfect source-only values",
      () => {
        const events = liveUiAuthorityFixture();
        for (const event of events) {
          if (event.data.authorityLevel && event.data.authorityLevel !== "derived_only") {
            event.data.authorityLevel = "source_only";
          }
        }
        return deriveUi(events, liveParentCloseout(), "live", LIVE_AUTHORITY_CONTEXT);
      },
    ],
    [
      "hardcoded Tool Search labels without observed sessions",
      () => {
        const events = liveProductAuthorityFixture().filter(
          ({ type }) => type !== "product_discovery_observation",
        );
        events.push(
          { type: "tool_search_observation", data: { mode: "on", status: "passed" } },
          { type: "tool_search_observation", data: { mode: "off", status: "passed" } },
        );
        return deriveProduct(events, liveParentCloseout(), "live", LIVE_AUTHORITY_CONTEXT);
      },
    ],
    [
      "copied renderer installed/load/manifest strings",
      () => {
        const events = liveProductAuthorityFixture().filter(
          ({ type }) => type !== "fixed_artifact_authority",
        );
        events.push({
          type: "installed_loaded",
          data: { installed: ["One.dll"], loaded: ["One.dll"], manifest: ["One.dll"] },
        });
        return deriveProduct(events, liveParentCloseout(), "live", LIVE_AUTHORITY_CONTEXT);
      },
    ],
    [
      "mismatched package/install/load hashes",
      () => {
        const events = liveProductAuthorityFixture();
        events.find(
          ({ type }) => type === "fixed_artifact_authority",
        ).data.loadedObserver.modulesSha256 = "0".repeat(64);
        return deriveProduct(events, liveParentCloseout(), "live", LIVE_AUTHORITY_CONTEXT);
      },
    ],
    [
      "unrelated descriptor fingerprint",
      () => {
        const events = liveProductAuthorityFixture();
        events.find(({ type }) => type === "product_discovery_observation").data.fingerprintSha256 =
          "0".repeat(64);
        return deriveProduct(events, liveParentCloseout(), "live", LIVE_AUTHORITY_CONTEXT);
      },
    ],
    [
      "retraction labels without actual sessions",
      () => {
        const events = liveProductAuthorityFixture();
        events.find(({ type }) => type === "retraction_observation").data.sessionIdBefore = "label";
        return deriveProduct(events, liveParentCloseout(), "live", LIVE_AUTHORITY_CONTEXT);
      },
    ],
    [
      "same-renderer transition labeled renderer_restart",
      () => {
        const events = liveProductAuthorityFixture();
        const restart = events.find(
          ({ type, data }) =>
            type === "retraction_observation" && data.reason === "renderer_restart",
        ).data;
        restart.rendererInstanceIdAfter = restart.rendererInstanceIdBefore;
        restart.processIdentitySha256After = restart.processIdentitySha256Before;
        rebindAuthorityData(restart, "observationBindingSha256");
        return deriveProduct(events, liveParentCloseout(), "live", LIVE_AUTHORITY_CONTEXT);
      },
    ],
    [
      "hardcoded stopped/disconnected and zero-residue summaries",
      () => {
        const events = liveUiAuthorityFixture().filter(
          ({ type }) => type !== "negative_case_observation",
        );
        events.push({
          type: "negative_case",
          data: {
            observationStopped: true,
            mcpDisconnected: true,
            processResidualCount: 0,
            portResidualCount: 0,
          },
        });
        return deriveUi(events, liveParentCloseout(), "live", LIVE_AUTHORITY_CONTEXT);
      },
    ],
    [
      "N1-N8 summaries without guard calls or Content snapshots",
      () => {
        const events = liveUiAuthorityFixture().filter(
          ({ type }) =>
            type !== "negative_case_observation" && type !== "content_manifest_observation",
        );
        return deriveUi(events, liveParentCloseout(), "live", LIVE_AUTHORITY_CONTEXT);
      },
    ],
    [
      "partial success lists without observed operation results",
      () => {
        const events = liveUiAuthorityFixture().filter(
          ({ type }) => type !== "partial_unknown_observation",
        );
        events.push({
          type: "partial_unknown_effect_record",
          data: { successfulForward: ["create_run_root"], effectState: "unknown" },
        });
        return deriveUi(events, liveParentCloseout(), "live", LIVE_AUTHORITY_CONTEXT);
      },
    ],
    [
      "replay-zero without reading recorded representation",
      () => {
        const events = liveUiAuthorityFixture().filter(
          ({ type }) => type !== "replay_inspection_observation",
        );
        events.push({ type: "replay_observation", data: { sideEffectDelta: 0 } });
        return deriveUi(events, liveParentCloseout(), "live", LIVE_AUTHORITY_CONTEXT);
      },
    ],
    [
      "renderer-authored transport response with a self-consistent binding hash",
      () => {
        const events = liveProductAuthorityFixture();
        const discovery = events.find(({ type }) => type === "product_discovery_observation").data;
        discovery.rendererAuthoredResponse = { status: 200, sessionId: discovery.mcpSessionId };
        rebindAuthorityData(discovery, "observationBindingSha256");
        return deriveProduct(events, liveParentCloseout(), "live", LIVE_AUTHORITY_CONTEXT);
      },
    ],
    [
      "six retraction labels sharing one non-fresh ready state",
      () => {
        const events = liveProductAuthorityFixture();
        for (const event of events.filter(({ type }) => type === "retraction_observation")) {
          event.data.stateBeforeReceiptId = "mvp15d-observation-receipt:shared-ready";
          rebindAuthorityData(event.data, "observationBindingSha256");
        }
        return deriveProduct(events, liveParentCloseout(), "live", LIVE_AUTHORITY_CONTEXT);
      },
    ],
    [
      "random renderer restart identity without native process receipt",
      () => {
        const events = liveProductAuthorityFixture();
        const restart = events.find(
          ({ type, data }) =>
            type === "retraction_observation" && data.reason === "renderer_restart",
        ).data;
        restart.rendererInstanceIdAfter = "renderer-random-uuid-0001";
        restart.processIdentitySha256After = "f".repeat(64);
        rebindAuthorityData(restart, "observationBindingSha256");
        return deriveProduct(events, liveParentCloseout(), "live", LIVE_AUTHORITY_CONTEXT);
      },
    ],
    [
      "N1-N8 reason table with self-consistent event hashes",
      () => {
        const events = liveUiAuthorityFixture();
        const record = events.find(({ type }) => type === "negative_case_observation").data;
        record.reasonTable = Object.fromEntries(
          events
            .filter(({ type }) => type === "negative_case_observation")
            .map(({ data }) => [data.caseId, data.guardCall.reason]),
        );
        rebindAuthorityData(record, "observationBindingSha256");
        return deriveUi(events, liveParentCloseout(), "live", LIVE_AUTHORITY_CONTEXT);
      },
    ],
    [
      "partial result table with self-consistent event hash",
      () => {
        const events = liveUiAuthorityFixture();
        const partial = events.find(({ type }) => type === "partial_unknown_observation").data;
        partial.resultTable = partial.operationResults.map(({ status, effectState, reason }) => ({
          status,
          effectState,
          reason,
        }));
        rebindAuthorityData(partial, "observationBindingSha256");
        return deriveUi(events, liveParentCloseout(), "live", LIVE_AUTHORITY_CONTEXT);
      },
    ],
  ];
  for (const [name, action] of cases) {
    assert.throws(action, (error) => Boolean(error?.code), `${name} must fail closed`);
  }
});

function loadedAuthorityBindingMaterialForTest(loaded) {
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

function livePhaseFixtureOutput({
  repository,
  phase,
  taskId,
  marker,
  sessionId,
  generation,
  port,
  producerPid,
  adapterVector,
  runtimeExecutable,
}) {
  const fixture = spawnSync(
    process.execPath,
    [
      resolve(repository, "scripts", "mvp15d-final-phase-fixture-producer.mjs"),
      "--phase",
      phase,
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
    ],
    { cwd: repository, encoding: "utf8", shell: false, windowsHide: true },
  );
  assert.equal(fixture.status, 0, fixture.stderr);
  const events = fixture.stdout
    .trimEnd()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  const producer = {
    id: `mvp15d-final-${phase}-producer`,
    processIdBindingSha256: retainedBindingForTest("process-id", producerPid),
    mode: "live",
  };
  for (const event of events) {
    event.producer = producer;
    delete event.marker;
    delete event.sessionId;
    event.markerSha256 = retainedBindingForTest("marker", marker);
    event.sessionBindingSha256 = retainedBindingForTest("session", sessionId);
  }
  delete events[0].data.port;
  events[0].data.portBindingSha256 = retainedBindingForTest("port", port);
  events[0].data.argumentVectorSha256 = cryptoHash(
    Buffer.from(stableForTest(adapterVector), "utf8"),
  );
  const runtime = {
    schemaVersion: events[0].schemaVersion,
    phase,
    taskId,
    markerSha256: retainedBindingForTest("marker", marker),
    sessionBindingSha256: retainedBindingForTest("session", sessionId),
    generation,
    producer,
    type: "runtime_process_started",
    data: {
      processIdBindingSha256: retainedBindingForTest("process-id", producerPid + 1),
      endpointSha256: retainedBindingForTest("endpoint", `http://127.0.0.1:${port}/mcp`),
      markerSha256: retainedBindingForTest("marker", marker),
      executable: {
        basename: basename(runtimeExecutable),
        size: lstatSync(runtimeExecutable).size,
        sha256: cryptoHash(readFileSync(runtimeExecutable)),
      },
      argumentVectorSha256: "e".repeat(64),
    },
  };
  const origin = {
    ...runtime,
    type: "evidence_origin",
    data: { origin: "live_runtime", fixtureUsed: false },
  };
  const evidenceRoot = adapterVector[adapterVector.indexOf("--evidence-root") + 1];
  const runtimeEventPath = resolve(evidenceRoot, "transcripts", `${phase}.runtime-events.jsonl`);
  const jobCloseoutPath = resolve(evidenceRoot, "metadata", `${phase}.job-closeout.json`);
  const portCloseoutPath = resolve(evidenceRoot, "metadata", `${phase}.port-closeout.json`);
  if (!existsSync(jobCloseoutPath)) {
    writeFileSync(
      jobCloseoutPath,
      `${JSON.stringify(
        {
          schemaVersion: "uagent.mvp15d.final.job-closeout.v1",
          taskId,
          markerSha256: retainedBindingForTest("marker", marker),
          sessionBindingSha256: retainedBindingForTest("session", sessionId),
          generation,
          jobSchemaVersion: "uagent.mvp15d.windows-job-process-run.v1",
          rootPidBindingSha256: retainedBindingForTest("pid", producerPid + 1),
          rootExitCode: 0,
          timedOut: false,
          activeProcessZeroObserved: true,
          finalResidualCount: 0,
          failureCode: "",
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", flag: "wx" },
    );
  }
  writeFileSync(
    portCloseoutPath,
    `${JSON.stringify(
      {
        schemaVersion: "uagent.mvp15d.final.port-closeout.v1",
        phase,
        taskId,
        markerSha256: retainedBindingForTest("marker", marker),
        sessionBindingSha256: retainedBindingForTest("session", sessionId),
        generation,
        portBindingSha256: retainedBindingForTest("port", port),
        observations: Array.from({ length: 5 }, (_, index) => ({
          attempt: index + 1,
          accepting: false,
        })),
        residualCount: 0,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  const runtimeEvents = [
    {
      schemaVersion: RUNTIME_EVENT_SCHEMA,
      phase,
      type: "evidence_origin",
      data: { origin: "production_runtime", fixtureUsed: false },
    },
    {
      schemaVersion: RUNTIME_EVENT_SCHEMA,
      phase,
      type: "closeout",
      data: {
        processResidualCount: 0,
        portResidualCount: 0,
        markerResidualCount: 0,
        nonceResidualCount: 0,
        driverResidualCount: 0,
        partialOutputCount: 0,
      },
    },
  ];
  writeFileSync(
    runtimeEventPath,
    `${runtimeEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  const runtimeBytes = readFileSync(runtimeEventPath);
  const transport = {
    ...runtime,
    type: "runtime_event_transport",
    data: {
      bridgeVersion:
        phase === "ue-automation"
          ? "uagent.mvp15d.ue-automation-report.v1"
          : "uagent.mvp15d.runtime-bridge.v5",
      eventFile: {
        relativePath: `transcripts/${phase}.runtime-events.jsonl`,
        size: runtimeBytes.length,
        sha256: cryptoHash(runtimeBytes),
      },
      nonceSha256: "f".repeat(64),
      asynchronous: phase !== "ue-automation",
      jobOwned: true,
    },
  };
  events.splice(1, 0, origin, runtime, transport);
  const captureOrigin = events.find((event) => event.type === "capture_origin");
  if (phase === "ue-automation") {
    const terminalIndex = events.findIndex((event) => event.type === "process_exited");
    events.splice(terminalIndex, 0, {
      ...runtime,
      type: "automation_report_binding",
      data: {
        reportSha256: "1".repeat(64),
        taskBindingSha256: "2".repeat(64),
        projectSha256: "3".repeat(64),
        manifestSha256: "4".repeat(64),
        packageModulesSha256: "5".repeat(64),
        installedModulesSha256: "5".repeat(64),
        loadedModulesSha256: "5".repeat(64),
        executableSha256: runtime.data.executable.sha256,
        processIdBindingSha256: runtime.data.processIdBindingSha256,
      },
    });
    const sourceDescriptor = (relativePath) => ({
      relativePath,
      size: 1,
      sha256: "8".repeat(64),
    });
    events.splice(terminalIndex + 1, 0, {
      ...runtime,
      type: "production_provenance",
      data: {
        loadedLedger: {
          relativePath: "captures/loaded-modules.json",
          size: 1,
          sha256: "6".repeat(64),
        },
        processIdentitySha256: "6".repeat(64),
        jobCloseout: {
          relativePath: "metadata/ue-automation.job-closeout.json",
          size: 1,
          sha256: "7".repeat(64),
        },
        authorityBindingSha256: "8".repeat(64),
        taskId,
        taskMarkerSha256: retainedBindingForTest("marker", marker),
        sessionBindingSha256: retainedBindingForTest("session", sessionId),
        generation,
        sourceCommit: "9".repeat(40),
        sourceTreeSha256: "a".repeat(64),
        sourceDirty: true,
        process: {
          pidBindingSha256: retainedBindingForTest("pid", producerPid + 1),
          creationFileTimeUtcBindingSha256: retainedBindingForTest(
            "creation-filetime",
            "133500000000000000",
          ),
          executableBasename: runtime.data.executable.basename,
          executableSha256: runtime.data.executable.sha256,
        },
        projectSha256: "3".repeat(64),
        manifestSha256: "4".repeat(64),
        packageInventorySha256: "b".repeat(64),
        installedInventorySha256: "b".repeat(64),
        loadedModulesSha256: "5".repeat(64),
        producerSources: {
          phaseProducer: sourceDescriptor("scripts/mvp15d-final-ue-automation-producer.mjs"),
          helper: sourceDescriptor("scripts/mvp15d-final-live-producer-helper.mjs"),
          observer: sourceDescriptor("scripts/mvp15d-loaded-module-observer.mjs"),
          jobRunner: sourceDescriptor("scripts/mvp15d-windows-job-process-runner.ps1"),
        },
      },
    });
  } else if (phase === "product-capture") {
    captureOrigin.data.origin = "real_product_adapter";
    captureOrigin.data.fixtureUsed = false;
    const terminalIndex = events.findIndex((event) => event.type === "process_exited");
    const reasons = [
      "refresh_tools",
      "reconnect",
      "endpoint_change",
      "renderer_restart",
      "ue_restart",
      "stale_completion",
    ];
    events.splice(
      terminalIndex,
      0,
      ...reasons.map((reason, index) => ({
        ...runtime,
        type: "retraction_observation",
        data: {
          reason,
          sessionId: `retraction-session-${index + 1}`,
          generationBefore: index + 1,
          generationAfter: index + 2,
          statusBefore: "ready",
          statusAfter: "blocked",
          count: 6,
        },
      })),
      {
        ...runtime,
        type: "tool_search_observation",
        data: { mode: "on", status: "passed" },
      },
      {
        ...runtime,
        type: "tool_search_observation",
        data: { mode: "off", status: "passed" },
      },
    );
  } else if (phase === "ui-lifecycle") {
    captureOrigin.data.origin = "rendered_product_ui";
    captureOrigin.data.fixtureUsed = false;
    const terminalIndex = events.findIndex((event) => event.type === "process_exited");
    events.splice(
      terminalIndex,
      0,
      ...[
        ["N1", "untrusted_root"],
        ["N2", "feature_disabled"],
        ["N3", "observation_session_stopped"],
        ["N4", "process_exited"],
        ["N5", "stale_generation"],
        ["N6", "sandbox_path_required"],
        ["N7", "execute_replay"],
        ["N8", "rollback_replay"],
      ].map(([caseId, blockedReason], index) => ({
        ...runtime,
        type: "negative_case",
        data: {
          caseId,
          sessionId: `negative-session-${index + 1}`,
          runId: `negative-run-${index + 1}`,
          registrationId: `negative-registration-${index + 1}`,
          blockedReason,
          beforeContentSha256: "a".repeat(64),
          afterContentSha256: "a".repeat(64),
          counterDelta: [1, 0, 0, 0, 0],
          closeout: {
            observationStopped: true,
            mcpDisconnected: true,
            processResidualCount: 0,
            portResidualCount: 0,
          },
        },
      })),
      {
        ...runtime,
        type: "partial_unknown_effect_record",
        data: {
          sessionId: "partial-session-1",
          runId: "partial-run-1",
          registrationId: "partial-registration-1",
          effectState: "unknown",
          successfulForward: ["create_run_root", "duplicate_test01", "rename_duplicate"],
          inverseRollbackOrder: ["rename_back", "delete_duplicate", "cleanup_empty_folder"],
          crossTtlRejected: true,
          secondRollbackBlocked: true,
          beforeContentSha256: "a".repeat(64),
          afterContentSha256: "a".repeat(64),
          closeout: {
            observationStopped: true,
            mcpDisconnected: true,
            processResidualCount: 0,
            portResidualCount: 0,
          },
        },
      },
      ...[
        "create_run_root",
        "duplicate_test01",
        "rename_duplicate",
        "move_duplicate",
        "save_one_package",
      ].map((action) => ({
        ...runtime,
        type: "replay_observation",
        data: { action, sideEffectDelta: 0 },
      })),
    );
  }
  events.at(-1).data = {
    authorityLevel: "parent_observed",
    processResidualCount: 0,
    portResidualCount: 0,
    markerResidualCount: 0,
    partialOutputCount: 0,
    jobCloseoutSha256: cryptoHash(readFileSync(jobCloseoutPath)),
    portObservationSha256: cryptoHash(readFileSync(portCloseoutPath)),
    runtimeProcessIdBindingSha256: runtime.data.processIdBindingSha256,
    phaseSessionBindingSha256: retainedBindingForTest("session", sessionId),
    phaseGeneration: generation,
  };
  const timestamp = Date.parse("2026-07-31T00:00:00.000Z");
  events.forEach((event, index) => {
    event.sequence = index + 1;
    event.capturedAt = new Date(timestamp + index + 1).toISOString();
  });
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

test("desktop icon is tracked-quality and rejects malformed or transparent payloads", () => {
  const directory = mkdtempSync(join(tmpdir(), "uagent-mvp15d-icon-"));
  try {
    const iconPath = resolve(REPOSITORY, "apps", "desktop", "src-tauri", "icons", "icon.ico");
    assert.deepEqual(validateIcon(iconPath).sizes, [16, 24, 32, 48, 64, 128, 256]);
    const malformedPath = resolve(directory, "wrong-format.ico");
    writeFileSync(malformedPath, Buffer.from("not an ico", "utf8"));
    assert.throws(
      () => validateIcon(malformedPath),
      (error) => error instanceof IconValidationError && error.code === "ICON_FORMAT_INVALID",
    );
    const transparentPath = resolve(directory, "transparent.ico");
    const transparent = Buffer.from(readFileSync(iconPath));
    const count = transparent.readUInt16LE(4);
    for (let index = 0; index < count; index += 1) {
      const entry = 6 + index * 16;
      const width = transparent[entry] || 256;
      const height = transparent[entry + 1] || 256;
      const offset = transparent.readUInt32LE(entry + 12) + 40;
      for (let pixel = 0; pixel < width * height; pixel += 1) {
        transparent[offset + pixel * 4 + 3] = 0;
      }
    }
    writeFileSync(transparentPath, transparent);
    assert.throws(
      () => validateIcon(transparentPath),
      (error) => error instanceof IconValidationError && error.code === "ICON_BLANK_OR_TRANSPARENT",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("UE 5.8.1 response framing accepts one terminal result and rejects duplicate or truncated frames", () => {
  const json = parseTerminalResponse(
    "application/json",
    JSON.stringify({ jsonrpc: "2.0", id: 7, result: { ok: true } }),
    7,
  );
  assert.equal(json.terminal.result.ok, true);
  const sse = parseTerminalResponse(
    "text/event-stream",
    [
      'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}',
      'event: message\ndata: {"jsonrpc":"2.0","id":8,"result":{"ok":true}}',
      "",
    ].join("\n\n"),
    8,
  );
  assert.equal(sse.messages.length, 2);
  assert.throws(
    () =>
      parseTerminalResponse(
        "text/event-stream",
        [
          'data: {"jsonrpc":"2.0","id":9,"result":{}}',
          'data: {"jsonrpc":"2.0","id":9,"result":{}}',
          "",
        ].join("\n\n"),
        9,
      ),
    (error) => error instanceof ProbeError && error.code === "UE581_PROBE_TERMINAL_RESULT_INVALID",
  );
  assert.throws(() => parseTerminalResponse("application/json", '{"jsonrpc":"2.0","id":10', 10));
});

test("UE 5.8.1 BuildPlugin output derives the MSVC version from its toolchain path", () => {
  const engineIdentity = {
    engineVersion: "5.8.1",
    engineChangelist: 56_057_345,
    compatibleChangelist: 55_116_800,
    moduleBuildId: "55116800",
  };
  const facts = deriveToolchainFacts(
    [
      "===== Toolchain Information =====",
      "Using Visual Studio 14.44.35228 toolchain (Z:\\Synthetic Toolchains\\VC\\Tools\\MSVC\\14.44.35207) and Windows 10.0.22621.0 SDK (Y:\\Synthetic SDK Root\\Windows Kits\\10).",
    ].join("\n"),
    engineIdentity,
  );

  assert.deepEqual(facts, {
    ...engineIdentity,
    compilerName: "MSVC",
    compilerVersion: "14.44.35207",
    sdkName: "Windows SDK",
    sdkVersion: "10.0.22621.0",
  });
});

test("transcript redaction collapses drive, UNC, user-home and secret bytes deterministically", () => {
  const roots = [
    ["Q:\\PkgRoot\\Out", "${PACKAGE_ROOT}"],
    ["T:\\UE_5.8\\Engine Root", "${UE_ROOT}"],
    ["S:\\Repo Root\\UAgent", "${SOURCE_ROOT}"],
  ];
  const cases = [
    [
      "actual-ue581-toolchain-line",
      String.raw`Using Visual Studio 14.44.35228 toolchain (Z:\Synthetic Toolchains\VC\Tools\MSVC\14.44.35207) and Windows 10.0.22621.0 SDK (Y:\Synthetic SDK Root\Windows Kits\10).`,
      "Using Visual Studio 14.44.35228 toolchain (${ABSOLUTE_PATH}) and Windows 10.0.22621.0 SDK (${ABSOLUTE_PATH}).",
      { absolutePaths: 2, secrets: 0 },
    ],
    [
      "drive-root-only",
      String.raw`root C:\ remains diagnostic`,
      "root ${ABSOLUTE_PATH} remains diagnostic",
      { absolutePaths: 1, secrets: 0 },
    ],
    [
      "json-escaped-drive-path",
      String.raw`json C:\\build root\\artifact.bin retained`,
      "json ${ABSOLUTE_PATH} retained",
      { absolutePaths: 1, secrets: 0 },
    ],
    [
      "extended-drive-path",
      String.raw`device \\?\C:\build\artifact.bin retained`,
      "device ${ABSOLUTE_PATH} retained",
      { absolutePaths: 1, secrets: 0 },
    ],
    [
      "extended-unc-path",
      String.raw`device \\?\UNC\server\share\artifact.bin retained`,
      "device ${ABSOLUTE_PATH} retained",
      { absolutePaths: 1, secrets: 0 },
    ],
    [
      "semicolon-separated-drives",
      String.raw`list C:\alpha\one.txt;D:\beta\two.txt end`,
      "list ${ABSOLUTE_PATH};${ABSOLUTE_PATH} end",
      { absolutePaths: 2, secrets: 0 },
    ],
    [
      "space-separated-drives",
      String.raw`copy C:\alpha\one.txt D:\beta\two.txt done`,
      "copy ${ABSOLUTE_PATH} ${ABSOLUTE_PATH} done",
      { absolutePaths: 2, secrets: 0 },
    ],
    [
      "punctuation-separated-drives",
      String.raw`pair (C:\alpha\one.txt)(D:\beta\two.txt),V:\gamma\three.txt done`,
      "pair (${ABSOLUTE_PATH})(${ABSOLUTE_PATH}),${ABSOLUTE_PATH} done",
      { absolutePaths: 3, secrets: 0 },
    ],
    [
      "quoted-path-with-spaces-and-parentheses",
      String.raw`quoted "S:\Program Files (x86)\Tool Kit\bin\tool.exe" ran ok`,
      'quoted "${ABSOLUTE_PATH}" ran ok',
      { absolutePaths: 1, secrets: 0 },
    ],
    [
      "quoted-final-segment-with-spaces",
      String.raw`quoted "S:\output\sensitive artifact.bin" diagnostic retained`,
      'quoted "${ABSOLUTE_PATH}" diagnostic retained',
      { absolutePaths: 1, secrets: 0 },
    ],
    [
      "parenthesized-final-directory-with-spaces",
      String.raw`directory (S:\Program Files (x86)) diagnostic retained`,
      "directory (${ABSOLUTE_PATH}) diagnostic retained",
      { absolutePaths: 1, secrets: 0 },
    ],
    [
      "forward-slash-flag-after-path-survives",
      String.raw`MSBuild Q:\MsBuild\Current\Bin\MSBuild.exe /p:Configuration=Development`,
      "MSBuild ${ABSOLUTE_PATH} /p:Configuration=Development",
      { absolutePaths: 1, secrets: 0 },
    ],
    [
      "unc-pair-with-spaced-segment",
      String.raw`unc \\host\share\dir with space\file.txt and \\other\share\z.dll end`,
      "unc ${ABSOLUTE_PATH} and ${ABSOLUTE_PATH} end",
      { absolutePaths: 2, secrets: 0 },
    ],
    [
      "user-home-collapses-username-and-subtree",
      String.raw`home T:\Users\Jane.Doe\AppData\Local\Temp\file.log rolled`,
      "home ${USER_HOME} rolled",
      { absolutePaths: 1, secrets: 0 },
    ],
    [
      "bare-user-home-collapses-the-ambiguous-tail",
      String.raw`home T:\Users\Jane Doe`,
      "home ${USER_HOME}",
      { absolutePaths: 1, secrets: 0 },
    ],
    [
      "bare-user-home-preserves-explicit-diagnostic-delimiter",
      String.raw`home T:\Users\Jane Doe | END_MARKER retained`,
      "home ${USER_HOME} | END_MARKER retained",
      { absolutePaths: 1, secrets: 0 },
    ],
    [
      "mixed-separator-drive",
      String.raw`mixed U:/Synthetic Toolchains/VC\Tools/MSVC\14.44.35207 ok`,
      "mixed ${ABSOLUTE_PATH} ok",
      { absolutePaths: 1, secrets: 0 },
    ],
    [
      "relative-paths-and-versions-survive",
      String.raw`relative Engine\Binaries\Win64\UnrealEditor.exe and version 14.44.35207 stay`,
      String.raw`relative Engine\Binaries\Win64\UnrealEditor.exe and version 14.44.35207 stay`,
      { absolutePaths: 0, secrets: 0 },
    ],
    [
      "urls-and-times-survive",
      "url https://example.com/build/feed and time 10:30:15 stay",
      "url https://example.com/build/feed and time 10:30:15 stay",
      { absolutePaths: 0, secrets: 0 },
    ],
    [
      "source-root-keeps-repo-relative-remainder",
      String.raw`read S:\Repo Root\UAgent\scripts\build.mjs ok`,
      "read ${SOURCE_ROOT}\\scripts\\build.mjs ok",
      { absolutePaths: 1, secrets: 0 },
    ],
    [
      "source-root-matches-case-insensitively",
      String.raw`read s:\REPO ROOT\uagent\scripts\x.mjs ok`,
      "read ${SOURCE_ROOT}\\scripts\\x.mjs ok",
      { absolutePaths: 1, secrets: 0 },
    ],
    [
      "ue-root-keeps-install-relative-remainder",
      String.raw`dotnet T:\UE_5.8\Engine Root\Engine\Binaries\DotNET\UnrealBuildTool\UnrealBuildTool.exe ran`,
      "dotnet ${UE_ROOT}\\Engine\\Binaries\\DotNET\\UnrealBuildTool\\UnrealBuildTool.exe ran",
      { absolutePaths: 1, secrets: 0 },
    ],
    [
      "package-root-keeps-package-relative-remainder",
      String.raw`out Q:\PkgRoot\Out\Binaries\Win64 written`,
      "out ${PACKAGE_ROOT}\\Binaries\\Win64 written",
      { absolutePaths: 1, secrets: 0 },
    ],
    [
      "keyword-bearer-secrets",
      "auth token=sekret123 password: hunter2 Bearer abc.def.ghi end",
      "auth token=${REDACTED} password=${REDACTED} Bearer ${REDACTED} end",
      { absolutePaths: 0, secrets: 3 },
    ],
    [
      "quoted-and-credential-secrets",
      'set password: "hunter2 x" and credential=zzz9 done',
      "set password=${REDACTED} and credential=${REDACTED} done",
      { absolutePaths: 0, secrets: 2 },
    ],
    [
      "authorization-bearer-combination",
      "header Authorization: Bearer eyJhbGciOi.payload.sig sent",
      "header Authorization=${REDACTED} sent",
      { absolutePaths: 0, secrets: 2 },
    ],
    [
      "authorization-basic-combination",
      "header Authorization: Basic Zm9vOmJhcg== sent",
      "header Authorization=${REDACTED} sent",
      { absolutePaths: 0, secrets: 1 },
    ],
    [
      "secret-command-flags",
      "invoke --token abc123 --password='local pass' completed",
      "invoke --token=${REDACTED} --password=${REDACTED} completed",
      { absolutePaths: 0, secrets: 2 },
    ],
    [
      "api-key-and-username",
      "api key=abc123 username: local-user retained",
      "api key=${REDACTED} username=${REDACTED} retained",
      { absolutePaths: 0, secrets: 2 },
    ],
    [
      "space-separated-secret-preserves-punctuation-and-marker",
      "token synthetic-space-value, END_MARKER retained",
      "token=${REDACTED}, END_MARKER retained",
      { absolutePaths: 0, secrets: 1 },
    ],
    [
      "tab-separated-secret-preserves-tab-suffix",
      "password\tsynthetic-tab-value\tTAB_MARKER retained",
      "password=${REDACTED}\tTAB_MARKER retained",
      { absolutePaths: 0, secrets: 1 },
    ],
    [
      "space-separated-quoted-secret",
      'credential "synthetic quoted value"; QUOTED_MARKER retained',
      "credential=${REDACTED}; QUOTED_MARKER retained",
      { absolutePaths: 0, secrets: 1 },
    ],
    [
      "space-separated-quoted-secret-with-an-escaped-inner-quote",
      String.raw`credential "synthetic \"quoted\" value"; QUOTED_INNER_MARKER retained`,
      "credential=${REDACTED}; QUOTED_INNER_MARKER retained",
      { absolutePaths: 0, secrets: 1 },
    ],
    [
      "escaped-json-space-separated-secret",
      String.raw`payload {\"api_key\" \"synthetic-escaped-value\",\"message\":\"retained\"}`,
      'payload {\\"api_key\\" \\"${REDACTED}\\",\\"message\\":\\"retained\\"}',
      { absolutePaths: 0, secrets: 1 },
    ],
    [
      "escaped-json-secret-with-an-escaped-inner-quote",
      String.raw`payload {\"token\" \"synthetic \\\"quoted\\\" value\",\"message\":\"retained\"}`,
      'payload {\\"token\\" \\"${REDACTED}\\",\\"message\\":\\"retained\\"}',
      { absolutePaths: 2, secrets: 1 },
    ],
    [
      "space-separated-secret-preserves-closing-punctuation",
      "username synthetic-user-value?!); PUNCTUATION_MARKER retained",
      "username=${REDACTED}?!); PUNCTUATION_MARKER retained",
      { absolutePaths: 0, secrets: 1 },
    ],
    [
      "space-separated-bare-secret-retains-internal-punctuation",
      "secret synthetic.part/path?mode=one! END_MARKER retained",
      "secret=${REDACTED}! END_MARKER retained",
      { absolutePaths: 0, secrets: 1 },
    ],
    [
      "space-separated-path-secret-is-redacted-before-path-placeholders",
      String.raw`password Q:\PkgRoot\Out\synthetic-private.bin END_MARKER retained`,
      "password=${REDACTED} END_MARKER retained",
      { absolutePaths: 1, secrets: 1 },
    ],
    [
      "authorization-bearer-preserves-terminal-punctuation",
      "Authorization Bearer synthetic.token. END_MARKER retained",
      "Authorization=${REDACTED}. END_MARKER retained",
      { absolutePaths: 0, secrets: 2 },
    ],
    [
      "multiple-secret-separators-preserve-trailing-marker",
      "token one\tpassword 'two words' credential=three username: four; MULTI_MARKER retained",
      "token=${REDACTED}\tpassword=${REDACTED} credential=${REDACTED} username=${REDACTED}; MULTI_MARKER retained",
      { absolutePaths: 0, secrets: 4 },
    ],
    [
      "whitespace-separated-placeholders-are-idempotent",
      'token ${REDACTED}\tpassword "${REDACTED}"; IDEMPOTENT_MARKER retained',
      "token=${REDACTED}\tpassword=${REDACTED}; IDEMPOTENT_MARKER retained",
      { absolutePaths: 0, secrets: 0 },
    ],
    [
      "unterminated-double-quoted-secret-at-eof",
      'password="synthetic-double-tail',
      "password=${REDACTED}",
      { absolutePaths: 0, secrets: 1 },
    ],
    [
      "unterminated-single-quoted-secret-before-line-feed",
      "credential='synthetic-single-tail\nNEXT_LINE_MARKER retained",
      "credential=${REDACTED}\nNEXT_LINE_MARKER retained",
      { absolutePaths: 0, secrets: 1 },
    ],
    [
      "unterminated-outer-escaped-secret-before-carriage-return-line-feed",
      String.raw`credential \"synthetic-outer-tail` + "\r\nNEXT_CRLF_MARKER retained",
      "credential=${REDACTED}\r\nNEXT_CRLF_MARKER retained",
      { absolutePaths: 0, secrets: 1 },
    ],
    [
      "unterminated-nested-escaped-secret-at-eof",
      String.raw`credential \"synthetic \\\"nested\\\" tail`,
      "credential=${REDACTED}",
      { absolutePaths: 2, secrets: 1 },
    ],
    [
      "unterminated-escaped-json-secret-at-eof",
      String.raw`payload {\"token\":\"synthetic-json-tail`,
      'payload {\\"token\\":\\"${REDACTED}\\"',
      { absolutePaths: 0, secrets: 1 },
    ],
    [
      "bare-secret-internal-comma",
      "password=synthetic,tail",
      "password=${REDACTED}",
      { absolutePaths: 0, secrets: 1 },
    ],
    [
      "bare-secret-internal-semicolon",
      "password=synthetic;tail",
      "password=${REDACTED}",
      { absolutePaths: 0, secrets: 1 },
    ],
    [
      "bare-secret-internal-closing-parenthesis",
      "password=synthetic)tail",
      "password=${REDACTED}",
      { absolutePaths: 0, secrets: 1 },
    ],
    [
      "bare-secret-internal-closing-square-bracket",
      "password=synthetic]tail",
      "password=${REDACTED}",
      { absolutePaths: 0, secrets: 1 },
    ],
    [
      "bare-secret-internal-closing-curly-bracket",
      "password=synthetic}tail",
      "password=${REDACTED}",
      { absolutePaths: 0, secrets: 1 },
    ],
    [
      "bare-secret-terminal-punctuation-and-marker",
      "password=synthetic?!,;)]} END_PUNCTUATION_MARKER retained",
      "password=${REDACTED}?!,;)]} END_PUNCTUATION_MARKER retained",
      { absolutePaths: 0, secrets: 1 },
    ],
    [
      "standalone-bearer-internal-punctuation",
      "Bearer synthetic,tail END_BEARER_MARKER retained",
      "Bearer ${REDACTED} END_BEARER_MARKER retained",
      { absolutePaths: 0, secrets: 1 },
    ],
    [
      "credential-endpoint-internal-punctuation",
      "connect https://example.com/api?token=synthetic,tail END_ENDPOINT_MARKER retained",
      "connect ${REDACTED_ENDPOINT} END_ENDPOINT_MARKER retained",
      { absolutePaths: 0, secrets: 2 },
    ],
    [
      "json-secret-values-preserve-neighbor-fields",
      '{"token":"abc123","authorization":"Bearer abc.def","message":"retained"}',
      '{"token":"${REDACTED}","authorization":"${REDACTED}","message":"retained"}',
      { absolutePaths: 0, secrets: 3 },
    ],
    [
      "escaped-json-secret-value",
      String.raw`payload {\"token\":\"abc123\",\"message\":\"retained\"}`,
      'payload {\\"token\\":\\"${REDACTED}\\",\\"message\\":\\"retained\\"}',
      { absolutePaths: 0, secrets: 1 },
    ],
    [
      "established-secret-key-variants",
      "SecurityToken=one X-Api-Key: two auth_token=three passwd=four AWS_SECRET_ACCESS_KEY=five session_token=six AWS_SESSION_TOKEN=seven id_token=eight x-api_key=nine aws-secret_access-key=ten api\tkey=eleven retained",
      "SecurityToken=${REDACTED} X-Api-Key=${REDACTED} auth_token=${REDACTED} passwd=${REDACTED} AWS_SECRET_ACCESS_KEY=${REDACTED} session_token=${REDACTED} AWS_SESSION_TOKEN=${REDACTED} id_token=${REDACTED} x-api_key=${REDACTED} aws-secret_access-key=${REDACTED} api\tkey=${REDACTED} retained",
      { absolutePaths: 0, secrets: 11 },
    ],
    [
      "credential-endpoint-userinfo",
      "connect https://alice:SENSITIVE_PASS@example.com/api failed",
      "connect ${REDACTED_ENDPOINT} failed",
      { absolutePaths: 0, secrets: 1 },
    ],
    [
      "credential-endpoint-query",
      "connect https://example.com/api?access_token=SENSITIVE_TOKEN&mode=live failed",
      "connect ${REDACTED_ENDPOINT} failed",
      { absolutePaths: 0, secrets: 2 },
    ],
    [
      "credential-endpoint-delimiters",
      "fetch (https://alice:one@example.com/api), [https://example.com/api?token=two]; END_MARKER",
      "fetch (${REDACTED_ENDPOINT}), [${REDACTED_ENDPOINT}]; END_MARKER",
      { absolutePaths: 0, secrets: 3 },
    ],
  ];
  for (const [name, input, expected, rawLeaks] of cases) {
    const redacted = redactTranscript(input, roots);
    assert.equal(redacted, expected, name);
    assert.equal(redactTranscript(redacted, roots), redacted, `${name} idempotence`);
    assert.deepEqual(findTranscriptLeaks(redacted), { absolutePaths: 0, secrets: 0 }, name);
    assert.deepEqual(findTranscriptLeaks(input), rawLeaks, `${name} raw detection`);
  }
  assert.equal(redactTranscript("", roots), "");
  assert.deepEqual(findTranscriptLeaks(undefined), { absolutePaths: 0, secrets: 0 });
});

test("malformed transcript quotes fail closed at EOF and every line boundary", () => {
  const slash = String.fromCharCode(92);
  const shapes = [
    ["double", 'password="synthetic-double-tail'],
    ["single", "password='synthetic-single-tail"],
    ["outer-escaped", `password=${slash}"synthetic-outer-tail`],
    [
      "nested-escaped",
      `password=${slash}"synthetic ${slash.repeat(3)}"nested${slash.repeat(3)}" tail`,
    ],
  ];
  const endings = [
    ["eof", ""],
    ["lf", "\nNEXT_LF_MARKER retained"],
    ["cr", "\rNEXT_CR_MARKER retained"],
    ["crlf", "\r\nNEXT_CRLF_MARKER retained"],
  ];
  for (const [shape, prefix] of shapes) {
    for (const [endingName, ending] of endings) {
      const input = prefix + ending;
      const redacted = redactTranscript(input, []);
      assert.equal(redacted, `password=\${REDACTED}${ending}`, `${shape} ${endingName}`);
      assert.equal(findTranscriptLeaks(input).secrets, 1, `${shape} ${endingName} raw`);
      assert.deepEqual(
        findTranscriptLeaks(redacted),
        { absolutePaths: 0, secrets: 0 },
        `${shape} ${endingName} post`,
      );
      assert.equal(redactTranscript(redacted, []), redacted, `${shape} ${endingName} idempotence`);
    }
  }
});

test("bare transcript punctuation distinguishes adjacent value bytes from terminal diagnostics", () => {
  for (const punctuation of [",", ";", ")", "]", "}"]) {
    const adjacent = `--token synthetic${punctuation}adjacent-tail`;
    const adjacentRedacted = redactTranscript(adjacent, []);
    assert.equal(adjacentRedacted, "--token=${REDACTED}", `${punctuation} adjacent`);
    assert.equal(findTranscriptLeaks(adjacent).secrets, 1, `${punctuation} adjacent raw`);
    assert.deepEqual(findTranscriptLeaks(adjacentRedacted), { absolutePaths: 0, secrets: 0 });

    const terminal = `--token synthetic${punctuation} END_MARKER retained`;
    const terminalRedacted = redactTranscript(terminal, []);
    assert.equal(
      terminalRedacted,
      `--token=\${REDACTED}${punctuation} END_MARKER retained`,
      `${punctuation} terminal`,
    );
    assert.equal(findTranscriptLeaks(terminal).secrets, 1, `${punctuation} terminal raw`);
    assert.deepEqual(findTranscriptLeaks(terminalRedacted), { absolutePaths: 0, secrets: 0 });
  }
});

test(
  "transcript secret parsing stays bounded for long ordinary and escaped malformed values",
  { timeout: 5_000 },
  () => {
    const slash = String.fromCharCode(92);
    for (const kind of ["ordinary", "escaped"]) {
      let previousElapsed = 0;
      for (const size of [25_000, 50_000, 100_000, 200_000]) {
        const input =
          kind === "ordinary"
            ? `password="${"x".repeat(size)}`
            : `password=${slash}"${slash.repeat(size)}`;
        const startedAt = performance.now();
        let redacted;
        let rawLeaks;
        for (let round = 0; round < 5; round += 1) {
          redacted = redactTranscript(input, []);
          rawLeaks = findTranscriptLeaks(input);
        }
        const elapsed = performance.now() - startedAt;
        assert.equal(redacted, "password=${REDACTED}", `${kind} ${size} redaction`);
        assert.equal(rawLeaks.secrets, 1, `${kind} ${size} raw detection`);
        assert.deepEqual(
          findTranscriptLeaks(redacted),
          { absolutePaths: 0, secrets: 0 },
          `${kind} ${size} post scan`,
        );
        assert.ok(elapsed < 2_000, `${kind} ${size} exceeded the conservative bound: ${elapsed}`);
        if (previousElapsed > 0) {
          assert.ok(
            elapsed <= previousElapsed * 3.25 + 20,
            `${kind} ${size} repeated the former superlinear growth: ${previousElapsed} -> ${elapsed}`,
          );
        }
        previousElapsed = elapsed;
      }
    }
  },
);

function writeBuilder(path, failExit = 0, { overflowChannel = null } = {}) {
  writeFileSync(
    path,
    [
      'import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";',
      'import { resolve } from "node:path";',
      "const args=process.argv.slice(2);",
      'if(args.length!==5||args[0]!=="BuildPlugin"||args[3]!=="-TargetPlatforms=Win64"||args[4]!=="-Rocket")process.exit(91);',
      'const plugin=args[1].slice("-Plugin=".length);',
      'const output=args[2].slice("-Package=".length);',
      'mkdirSync(resolve(output,"Resources"),{recursive:true});',
      'mkdirSync(resolve(output,"Binaries","Win64"),{recursive:true});',
      'copyFileSync(plugin,resolve(output,"UAgentAssetTools.uplugin"));',
      'copyFileSync(resolve(plugin,"..","Resources","uagent-asset-tools.schema.json"),resolve(output,"Resources","uagent-asset-tools.schema.json"));',
      'writeFileSync(resolve(output,"Binaries","Win64","UnrealEditor-UAgentAssetTools.dll"),Buffer.from("fixture-module-v1"));',
      'writeFileSync(resolve(output,"Binaries","Win64","UnrealEditor.modules"),JSON.stringify({BuildId:"55116800",Modules:{UAgentAssetTools:"UnrealEditor-UAgentAssetTools.dll"}},null,2)+"\\n");',
      'console.log(\'UAGENT_TOOLCHAIN_JSON:{"compatibleChangelist":55116800,"compilerName":"MSVC","compilerVersion":"14.44.35207","engineChangelist":56057345,"engineVersion":"5.8.1","moduleBuildId":"55116800","sdkName":"Windows SDK","sdkVersion":"10.0.26100.0"}\');',
      ...(overflowChannel
        ? [
            `console.${overflowChannel === "stdout" ? "log" : "error"}(${JSON.stringify(
              overflowChannel === "stdout" ? 'password="' : "credential='",
            )}+"x".repeat(200000));`,
          ]
        : []),
      `process.exit(${failExit});`,
      "",
    ].join("\n"),
    "utf8",
  );
}

function writeAdversarialBuilder(path, ueRoot) {
  const stdoutLines = [
    "===== Toolchain Information =====",
    String.raw`Using Visual Studio 14.44.35228 toolchain (Z:\Synthetic Toolchains\VC\Tools\MSVC\14.44.35207) and Windows 10.0.22621.0 SDK (Y:\Synthetic SDK Root\Windows Kits\10).`,
    String.raw`MSBuild Q:\MsBuild\Current\Bin\MSBuild.exe /p:Configuration=Development`,
    `dotnet ${ueRoot}\\Engine\\Binaries\\DotNET\\UnrealBuildTool\\UnrealBuildTool.exe running`,
    String.raw`cache T:\Users\Build User\AppData\Local\DDC hit`,
    String.raw`mirror \\buildshare\drop\latest build\UAgentAssetTools.dll and \\archive\ue\pkg.dll done`,
    String.raw`compiler X:/Synthetic Toolchains/VC\Tools/MSVC\14.44.35207\bin\Hostx64\x64\cl.exe invoked`,
    String.raw`device \\?\UNC\private-host\private-share\artifact.bin opened`,
    String.raw`drive-root C:\ checked`,
    String.raw`list C:\alpha\one.txt;D:\beta\two.txt end`,
    "auth token=sekret123 password: hunter2 Bearer abc.def.ghi end",
    "headers Authorization: Basic Zm9vOmJhcg== --token command-secret end",
    "whitespace token synthetic-stdout-value; END_STDOUT retained",
    'truncated password="synthetic-stdout-truncated',
    "punctuation token=synthetic,stdout-tail END_PUNCTUATION retained",
    "Tandem marker: build completed with 0 warnings and 0 errors",
    "feed https://example.com/build/feed at 10:30:15 ok",
  ];
  const stderrLines = [
    String.raw`warning Z:\warnings\some warning file\wb.txt stale`,
    String.raw`fatal \\dead\share\x.dll missing`,
    'password\t"synthetic stderr value"\tEND_STDERR retained',
    "truncated credential='synthetic-stderr-truncated",
    "note no absolute paths here",
  ];
  writeFileSync(
    path,
    [
      'import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";',
      'import { resolve } from "node:path";',
      "const args=process.argv.slice(2);",
      'if(args.length!==5||args[0]!=="BuildPlugin"||args[3]!=="-TargetPlatforms=Win64"||args[4]!=="-Rocket")process.exit(91);',
      'const plugin=args[1].slice("-Plugin=".length);',
      'const output=args[2].slice("-Package=".length);',
      'mkdirSync(resolve(output,"Resources"),{recursive:true});',
      'mkdirSync(resolve(output,"Binaries","Win64"),{recursive:true});',
      'copyFileSync(plugin,resolve(output,"UAgentAssetTools.uplugin"));',
      'copyFileSync(resolve(plugin,"..","Resources","uagent-asset-tools.schema.json"),resolve(output,"Resources","uagent-asset-tools.schema.json"));',
      'writeFileSync(resolve(output,"Binaries","Win64","UnrealEditor-UAgentAssetTools.dll"),Buffer.from("fixture-module-v1"));',
      'writeFileSync(resolve(output,"Binaries","Win64","UnrealEditor.modules"),JSON.stringify({BuildId:"55116800",Modules:{UAgentAssetTools:"UnrealEditor-UAgentAssetTools.dll"}},null,2)+"\\n");',
      `const stdoutLines=${JSON.stringify(stdoutLines)};`,
      `const stderrLines=${JSON.stringify(stderrLines)};`,
      "for(const line of stdoutLines)console.log(line);",
      "console.log(`writing ${output}\\\\Binaries\\\\Win64\\\\UnrealEditor-UAgentAssetTools.dll`);",
      "console.log(`reading ${plugin}`);",
      "for(const line of stderrLines)console.error(line);",
      "process.exit(0);",
      "",
    ].join("\n"),
    "utf8",
  );
}

function createCandidate() {
  const base = mkdtempSync(join(tmpdir(), "UAgentMVP15DFinal-"));
  const origin = resolve(base, "origin");
  const clone = resolve(base, "clone");
  mkdirSync(origin);
  for (const logicalPath of [
    ".gitattributes",
    "integrations/unreal/UAgentAssetTools/UAgentAssetTools.uplugin",
    "integrations/unreal/UAgentAssetTools/Resources/uagent-asset-tools.schema.json",
    "integrations/unreal/UAgentAssetTools/Resources/mvp15d-native-binding-v2.json",
    "packages/shared/test-fixtures/mvp15d-native-binding-v2.json",
    "scripts/mvp15d-final-phase-fixture-producer.mjs",
    "scripts/mvp15d-final-live-producer-helper.mjs",
    "scripts/mvp15d-final-ue-automation-producer.mjs",
    "scripts/mvp15d-final-product-capture-producer.mjs",
    "scripts/mvp15d-final-ui-lifecycle-producer.mjs",
  ]) {
    const destination = resolve(origin, logicalPath);
    mkdirSync(resolve(destination, ".."), { recursive: true });
    cpSync(resolve(REPOSITORY, logicalPath), destination);
  }
  writeFileSync(resolve(origin, ".gitignore"), "external/\n", "utf8");
  git(origin, ["init", "-q"]);
  git(origin, ["config", "user.email", "fixture@uagent.invalid"]);
  git(origin, ["config", "user.name", "UAgent Fixture"]);
  git(origin, ["config", "core.autocrlf", "false"]);
  git(origin, ["add", "--", "."]);
  git(origin, ["commit", "-q", "-m", "fixture"]);
  const commit = git(origin, ["rev-parse", "HEAD"]);
  const cloneResult = spawnSync(
    "git",
    ["clone", "--no-hardlinks", "--no-checkout", origin, clone],
    { encoding: "utf8", shell: false, windowsHide: true },
  );
  assert.equal(cloneResult.status, 0, cloneResult.stderr);
  git(clone, ["config", "core.autocrlf", "true"]);
  git(clone, ["checkout", "--detach", "-q", commit]);
  const toolRoot = resolve(base, "tooling");
  mkdirSync(toolRoot);
  const goodRoot = resolve(toolRoot, "good");
  const failRoot = resolve(toolRoot, "fail");
  mkdirSync(goodRoot);
  mkdirSync(failRoot);
  const goodBuilder = resolve(goodRoot, "builder.mjs");
  const failBuilder = resolve(failRoot, "builder.mjs");
  writeBuilder(goodBuilder, 0);
  writeBuilder(failBuilder, 17);
  for (const root of [goodRoot, failRoot]) {
    mkdirSync(resolve(root, "Engine", "Build", "BatchFiles"), { recursive: true });
    mkdirSync(resolve(root, "Engine", "Binaries", "Win64"), { recursive: true });
    writeFileSync(
      resolve(root, "Engine", "Build", "Build.version"),
      `${JSON.stringify(
        {
          MajorVersion: 5,
          MinorVersion: 8,
          PatchVersion: 1,
          Changelist: 56057345,
          CompatibleChangelist: 55116800,
          IsLicenseeVersion: 0,
          IsPromotedBuild: 1,
          BranchName: "++UE5+Release-5.8",
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      resolve(root, "Engine", "Binaries", "Win64", "UnrealEditor.modules"),
      `${JSON.stringify({ BuildId: "55116800", Modules: { Core: "UnrealEditor-Core.dll" } }, null, 2)}\n`,
    );
  }
  const goodRunUat = resolve(goodRoot, "Engine", "Build", "BatchFiles", "RunUAT.bat");
  const failRunUat = resolve(failRoot, "Engine", "Build", "BatchFiles", "RunUAT.bat");
  writeFileSync(goodRunUat, `@echo off\r\n"${process.execPath}" "${goodBuilder}" %*\r\n`, "utf8");
  writeFileSync(failRunUat, `@echo off\r\n"${process.execPath}" "${failBuilder}" %*\r\n`, "utf8");
  return {
    base,
    origin,
    clone,
    commit,
    goodRunUat,
    failRunUat,
    goodUeRoot: goodRoot,
    failUeRoot: failRoot,
  };
}

function manifestArgs(fixture, evidenceRoot, packageRoot) {
  return {
    source: fixture.clone,
    "package-root": packageRoot,
    runuat: fixture.goodRunUat,
    "ue-root": fixture.goodUeRoot,
    "build-ledger": resolve(evidenceRoot, "metadata", "build-command.json"),
    "build-result": resolve(evidenceRoot, "metadata", "build-result.json"),
    builder: "uagent-final-fixture",
    "builder-kind": "local",
  };
}

function fileDescriptorForTest(root, path, relativePath) {
  assert.equal(resolve(root, relativePath.split("/").join("\\")), resolve(path));
  const bytes = readFileSync(path);
  return { relativePath, size: bytes.length, sha256: cryptoHash(bytes) };
}

function createHandAuthoredProvenanceFixture() {
  handAuthoredFixtureSequence += 1;
  const root = resolve(
    REPOSITORY,
    "external",
    `mvp15d-final-d13-d16-20260803_000000-HandAuth${process.pid}${handAuthoredFixtureSequence}`,
  );
  const base = root;
  const projectRoot = resolve(root, "project", "FinalHost");
  const packageRoot = resolve(root, "package", "UAgentAssetTools");
  const installedRoot = resolve(projectRoot, "Plugins", "UAgentAssetTools");
  const capturesRoot = resolve(root, "captures");
  const metadataRoot = resolve(root, "metadata");
  for (const path of [
    resolve(packageRoot, "Binaries", "Win64"),
    resolve(packageRoot, "Resources"),
    projectRoot,
    capturesRoot,
    metadataRoot,
    resolve(root, "logs"),
    resolve(root, "summaries"),
    resolve(root, "transcripts"),
  ]) {
    mkdirSync(path, { recursive: true });
  }
  const projectPath = resolve(projectRoot, "FinalHost.uproject");
  const modulePath = resolve(packageRoot, "Binaries", "Win64", "UnrealEditor-UAgentAssetTools.dll");
  writeFileSync(projectPath, '{"FileVersion":3}\n', "utf8");
  writeFileSync(resolve(packageRoot, "UAgentAssetTools.uplugin"), '{"FileVersion":3}\n', "utf8");
  writeFileSync(
    resolve(packageRoot, "Resources", "uagent-asset-tools.schema.json"),
    '{"type":"object"}\n',
    "utf8",
  );
  writeFileSync(modulePath, Buffer.from("authoritative-module-fixture", "utf8"));
  writeFileSync(
    resolve(packageRoot, "Binaries", "Win64", "UnrealEditor.modules"),
    `${JSON.stringify(
      { BuildId: "55116800", Modules: { UAgentAssetTools: basename(modulePath) } },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const module = {
    path: `Binaries/Win64/${basename(modulePath)}`,
    size: lstatSync(modulePath).size,
    sha256: cryptoHash(readFileSync(modulePath)),
  };
  const manifestPath = resolve(packageRoot, "UAgentAssetTools.build.json");
  writeFileSync(manifestPath, `${JSON.stringify({ modules: [module] }, null, 2)}\n`, "utf8");
  mkdirSync(resolve(projectRoot, "Plugins"), { recursive: true });
  cpSync(packageRoot, installedRoot, { recursive: true });

  const identity = computeSourceIdentity(REPOSITORY);
  assert.match(identity.compiledCommit, /^[0-9a-f]{40}$/);
  const ueRoot = resolve(metadataRoot, "hand-authored-ue-root");
  const executablePath = resolve(ueRoot, "Engine", "Binaries", "Win64", "UnrealEditor-Cmd.exe");
  mkdirSync(resolve(executablePath, ".."), { recursive: true });
  writeFileSync(executablePath, Buffer.from("authoritative-executable-fixture", "utf8"));
  const marker = "uagent-mvp15d-final-authoritative-provenance-0001";
  const sessionId = "final-authoritative-provenance-session-0001";
  const generation = 7;
  const processIdentity = {
    pid: 45_678,
    creationFileTimeUtc: "133500000000000000",
    executableBasename: basename(executablePath),
    executableSha256: cryptoHash(readFileSync(executablePath)),
  };
  const earlyIdentityPath = resolve(metadataRoot, `ue-automation.${sessionId}.early-identity.json`);
  const loadedPath = resolve(capturesRoot, "loaded-modules.json");
  const jobPath = resolve(metadataRoot, "ue-automation.job-closeout.json");
  const portPath = resolve(metadataRoot, "ue-automation.port-closeout.json");
  const packageInventory = collectPackageArtifacts(packageRoot, true).artifacts;
  const installedInventory = collectPackageArtifacts(installedRoot, true).artifacts;
  const sources = {
    phaseProducer: fileDescriptorForTest(
      REPOSITORY,
      resolve(REPOSITORY, "scripts", "mvp15d-final-ue-automation-producer.mjs"),
      "scripts/mvp15d-final-ue-automation-producer.mjs",
    ),
    helper: fileDescriptorForTest(
      REPOSITORY,
      resolve(REPOSITORY, "scripts", "mvp15d-final-live-producer-helper.mjs"),
      "scripts/mvp15d-final-live-producer-helper.mjs",
    ),
    observer: fileDescriptorForTest(
      REPOSITORY,
      resolve(REPOSITORY, "scripts", "mvp15d-loaded-module-observer.mjs"),
      "scripts/mvp15d-loaded-module-observer.mjs",
    ),
    jobRunner: fileDescriptorForTest(
      REPOSITORY,
      resolve(REPOSITORY, "scripts", "mvp15d-windows-job-process-runner.ps1"),
      "scripts/mvp15d-windows-job-process-runner.ps1",
    ),
  };
  const state = {
    earlyIdentity: {
      schemaVersion: EARLY_IDENTITY_SCHEMA,
      taskMarker: marker,
      session: sessionId,
      generation,
      rootPid: processIdentity.pid,
      rootCreationFileTimeUtc: processIdentity.creationFileTimeUtc,
      executableBasename: processIdentity.executableBasename,
      executableSha256: processIdentity.executableSha256,
    },
    loaded: null,
    job: {
      schemaVersion: "uagent.mvp15d.final.job-closeout.v1",
      taskId: TASK_ID,
      markerSha256: retainedBindingForTest("marker", marker),
      sessionBindingSha256: retainedBindingForTest("session", sessionId),
      generation,
      jobSchemaVersion: "uagent.mvp15d.windows-job-process-run.v1",
      rootPidBindingSha256: retainedBindingForTest("pid", processIdentity.pid),
      rootExitCode: 0,
      timedOut: false,
      activeProcessZeroObserved: true,
      finalResidualCount: 0,
      failureCode: "",
    },
    provenance: null,
    phaseLedger: null,
  };
  writeFileSync(earlyIdentityPath, `${JSON.stringify(state.earlyIdentity, null, 2)}\n`, "utf8");
  state.loaded = {
    schemaVersion: LOADED_LEDGER_SCHEMA,
    productionOrigin: PRODUCTION_ORIGIN,
    fixtureUsed: false,
    taskGeneration: "final-d13-d16",
    taskId: TASK_ID,
    taskMarkerSha256: retainedBindingForTest("marker", marker),
    sessionBindingSha256: retainedBindingForTest("session", sessionId),
    generation,
    sourceCommit: identity.compiledCommit,
    sourceTreeSha256: identity.sourceTreeSha256,
    sourceDirty: identity.sourceDirty,
    project: { id: "FinalHost", sha256: cryptoHash(readFileSync(projectPath)) },
    manifest: { sha256: cryptoHash(readFileSync(manifestPath)) },
    package: {
      id: "UAgentAssetTools",
      artifactCount: packageInventory.length,
      sha256: cryptoHash(Buffer.from(stableForTest(packageInventory), "utf8")),
    },
    installedRoot: {
      id: "UAgentAssetTools",
      artifactCount: installedInventory.length,
      sha256: cryptoHash(Buffer.from(stableForTest(installedInventory), "utf8")),
    },
    process: {
      pidBindingSha256: retainedBindingForTest("pid", processIdentity.pid),
      creationFileTimeUtcBindingSha256: retainedBindingForTest(
        "creation-filetime",
        processIdentity.creationFileTimeUtc,
      ),
      executableBasename: processIdentity.executableBasename,
      executableSha256: processIdentity.executableSha256,
    },
    modules: [{ name: basename(module.path), ...module }],
    authority: {
      schemaVersion: PRODUCTION_AUTHORITY_SCHEMA,
      processIdentitySha256: "0".repeat(64),
      sources: structuredClone(sources),
      bindingSha256: "0".repeat(64),
    },
  };
  state.loaded.authority.processIdentitySha256 = cryptoHash(
    Buffer.from(stableForTest(state.loaded.process), "utf8"),
  );
  state.loaded.authority.bindingSha256 = cryptoHash(
    Buffer.from(stableForTest(loadedAuthorityBindingMaterialForTest(state.loaded)), "utf8"),
  );
  writeFileSync(loadedPath, `${JSON.stringify(state.loaded, null, 2)}\n`, "utf8");
  writeFileSync(jobPath, `${JSON.stringify(state.job, null, 2)}\n`, "utf8");
  const loadedModulesSha256 = cryptoHash(Buffer.from(stableForTest([module]), "utf8"));
  state.provenance = {
    loadedLedger: fileDescriptorForTest(root, loadedPath, "captures/loaded-modules.json"),
    processIdentitySha256: state.loaded.authority.processIdentitySha256,
    jobCloseout: fileDescriptorForTest(root, jobPath, "metadata/ue-automation.job-closeout.json"),
    authorityBindingSha256: state.loaded.authority.bindingSha256,
    taskId: TASK_ID,
    taskMarkerSha256: retainedBindingForTest("marker", marker),
    sessionBindingSha256: retainedBindingForTest("session", sessionId),
    generation,
    sourceCommit: state.loaded.sourceCommit,
    sourceTreeSha256: state.loaded.sourceTreeSha256,
    sourceDirty: state.loaded.sourceDirty,
    process: {
      pidBindingSha256: retainedBindingForTest("pid", processIdentity.pid),
      creationFileTimeUtcBindingSha256: retainedBindingForTest(
        "creation-filetime",
        processIdentity.creationFileTimeUtc,
      ),
      executableBasename: processIdentity.executableBasename,
      executableSha256: processIdentity.executableSha256,
    },
    projectSha256: state.loaded.project.sha256,
    manifestSha256: state.loaded.manifest.sha256,
    packageInventorySha256: state.loaded.package.sha256,
    installedInventorySha256: state.loaded.installedRoot.sha256,
    loadedModulesSha256,
    producerSources: structuredClone(sources),
  };
  state.phaseLedger = {
    taskId: TASK_ID,
    markerSha256: retainedBindingForTest("marker", marker),
    sessionBindingSha256: retainedBindingForTest("session", sessionId),
    generation,
    sourceCommit: state.loaded.sourceCommit,
    runtimeProcess: {
      processIdBindingSha256: retainedBindingForTest("process-id", processIdentity.pid),
      executable: {
        basename: processIdentity.executableBasename,
        size: lstatSync(executablePath).size,
        sha256: processIdentity.executableSha256,
      },
    },
    producer: {
      relativePath: sources.phaseProducer.relativePath,
      sha256: sources.phaseProducer.sha256,
      helper: {
        relativePath: sources.helper.relativePath,
        sha256: sources.helper.sha256,
      },
    },
  };
  const baseline = structuredClone(state);

  function writeLoaded() {
    state.loaded.authority.processIdentitySha256 = cryptoHash(
      Buffer.from(stableForTest(state.loaded.process), "utf8"),
    );
    state.provenance.processIdentitySha256 = state.loaded.authority.processIdentitySha256;
    state.loaded.authority.bindingSha256 = cryptoHash(
      Buffer.from(stableForTest(loadedAuthorityBindingMaterialForTest(state.loaded)), "utf8"),
    );
    writeFileSync(loadedPath, `${JSON.stringify(state.loaded, null, 2)}\n`, "utf8");
    state.provenance.loadedLedger = fileDescriptorForTest(
      root,
      loadedPath,
      "captures/loaded-modules.json",
    );
    state.provenance.authorityBindingSha256 = state.loaded.authority.bindingSha256;
  }

  function writeEarlyIdentity() {
    writeFileSync(earlyIdentityPath, `${JSON.stringify(state.earlyIdentity, null, 2)}\n`, "utf8");
  }

  function writeJob() {
    writeFileSync(jobPath, `${JSON.stringify(state.job, null, 2)}\n`, "utf8");
    state.provenance.jobCloseout = fileDescriptorForTest(
      root,
      jobPath,
      "metadata/ue-automation.job-closeout.json",
    );
  }

  function reset() {
    Object.assign(state, structuredClone(baseline));
    writeFileSync(earlyIdentityPath, `${JSON.stringify(state.earlyIdentity, null, 2)}\n`, "utf8");
    writeFileSync(loadedPath, `${JSON.stringify(state.loaded, null, 2)}\n`, "utf8");
    writeFileSync(jobPath, `${JSON.stringify(state.job, null, 2)}\n`, "utf8");
  }

  function verify() {
    return verifyUeProductionArtifactConsistency(
      REPOSITORY,
      root,
      state.phaseLedger,
      [{ type: "production_provenance", data: state.provenance }],
      executablePath,
    );
  }

  function writeFullChain() {
    const phase = "ue-automation";
    const port = 31428;
    const producerPid = processIdentity.pid - 1;
    const endpoint = `http://127.0.0.1:${port}/mcp`;
    const adapterVector = [
      "--repository",
      REPOSITORY,
      "--evidence-root",
      root,
      "--task-id",
      TASK_ID,
      "--task-generation",
      TASK_GENERATION,
      "--source-commit",
      identity.compiledCommit,
      "--marker",
      marker,
      "--session",
      sessionId,
      "--endpoint",
      endpoint,
      "--generation",
      String(generation),
      "--port",
      String(port),
      "--ue-root",
      ueRoot,
    ];
    const runtimeEventPath = resolve(root, "transcripts", `${phase}.runtime-events.jsonl`);
    const eventsPath = resolve(root, "transcripts", `${phase}.events.jsonl`);
    const stderrPath = resolve(root, "logs", `${phase}.stderr.log`);
    const ledgerPath = resolve(root, "metadata", `${phase}.producer.json`);
    const summaryPath = resolve(root, "summaries", `${phase}.json`);
    const events = livePhaseFixtureOutput({
      repository: REPOSITORY,
      phase,
      taskId: TASK_ID,
      marker,
      sessionId,
      generation,
      port,
      producerPid,
      adapterVector,
      runtimeExecutable: executablePath,
    })
      .trimEnd()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    const provenanceEvent = events.find((event) => event.type === "production_provenance");
    provenanceEvent.data = structuredClone(state.provenance);
    const reportBinding = events.find((event) => event.type === "automation_report_binding");
    reportBinding.data = {
      reportSha256: "1".repeat(64),
      taskBindingSha256: "2".repeat(64),
      projectSha256: state.provenance.projectSha256,
      manifestSha256: state.provenance.manifestSha256,
      packageModulesSha256: state.provenance.loadedModulesSha256,
      installedModulesSha256: state.provenance.loadedModulesSha256,
      loadedModulesSha256: state.provenance.loadedModulesSha256,
      executableSha256: processIdentity.executableSha256,
      processIdBindingSha256: retainedBindingForTest("process-id", processIdentity.pid),
    };
    writeFileSync(
      eventsPath,
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8",
    );
    writeFileSync(stderrPath, "", "utf8");
    const runtimeProcess = structuredClone(
      events.find((event) => event.type === "runtime_process_started").data,
    );
    const runtimeTransport = structuredClone(
      events.find((event) => event.type === "runtime_event_transport").data,
    );
    const closeout = structuredClone(events.at(-1).data);
    const outputDescriptor = (path, relativePath) => ({
      relativePath,
      size: lstatSync(path).size,
      sha256: cryptoHash(readFileSync(path)),
    });
    const redactions = new Map([
      [REPOSITORY.toLowerCase(), "<repository>"],
      [root.toLowerCase(), "<evidence-root>"],
      [ueRoot.toLowerCase(), "<ue-root>"],
    ]);
    const redactedVector = adapterVector.map(
      (value) =>
        redactions.get(value.toLowerCase()) ??
        new Map([
          [marker, retainedBindingForTest("marker", marker)],
          [sessionId, retainedBindingForTest("session", sessionId)],
          [endpoint, retainedBindingForTest("endpoint", endpoint)],
          [String(port), retainedBindingForTest("port", port)],
        ]).get(value) ??
        value,
    );
    const phaseProducer = state.loaded.authority.sources.phaseProducer;
    const helper = state.loaded.authority.sources.helper;
    const capturedAt = "2026-08-03T00:00:00.000Z";
    const eventOutput = outputDescriptor(eventsPath, `transcripts/${phase}.events.jsonl`);
    state.phaseLedger = {
      schemaVersion: "uagent.mvp15d.final.producer-ledger.v1",
      taskGeneration: TASK_GENERATION,
      phase,
      taskId: TASK_ID,
      evidenceRoot: basename(root),
      evidenceRootSha256: cryptoHash(Buffer.from(root.replaceAll("\\", "/").toLowerCase(), "utf8")),
      sourceCommit: identity.compiledCommit,
      markerSha256: retainedBindingForTest("marker", marker),
      sessionBindingSha256: retainedBindingForTest("session", sessionId),
      endpointSha256: retainedBindingForTest("endpoint", endpoint),
      generation,
      portBindingSha256: retainedBindingForTest("port", port),
      producer: {
        id: "mvp15d-final-ue-automation-producer",
        mode: "live",
        ...phaseProducer,
        helper: structuredClone(helper),
      },
      executable: {
        basename: basename(process.execPath),
        size: lstatSync(process.execPath).size,
        sha256: cryptoHash(readFileSync(process.execPath)),
      },
      argumentVector: redactedVector,
      argumentVectorSha256: cryptoHash(Buffer.from(stableForTest(adapterVector), "utf8")),
      outputs: {
        stdout: structuredClone(eventOutput),
        stderr: outputDescriptor(stderrPath, `logs/${phase}.stderr.log`),
        events: structuredClone(eventOutput),
        runtimeEvents: outputDescriptor(
          runtimeEventPath,
          `transcripts/${phase}.runtime-events.jsonl`,
        ),
      },
      processOwnership: {
        kind: "task_owned",
        markerSha256: retainedBindingForTest("marker", marker),
        parentPidBindingSha256: retainedBindingForTest("pid", process.pid),
        childPidBindingSha256: retainedBindingForTest("pid", producerPid),
        childProcessIdBindingSha256: retainedBindingForTest("process-id", producerPid),
        closed: true,
      },
      termination: { exitCode: 0, signal: null, errorCode: null },
      runtimeProcess,
      runtimeTransport,
      productionProvenance: structuredClone(state.provenance),
      closeout,
      firstFailure: null,
      capturedAt,
    };
    writeFileSync(ledgerPath, `${JSON.stringify(state.phaseLedger, null, 2)}\n`, "utf8");
    const sourceArtifact = (path, relativePath, producer, redactionStatus, schema) => ({
      ...outputDescriptor(path, relativePath),
      capturedAt,
      producer,
      redactionStatus,
      schema,
    });
    const sourceArtifacts = [
      sourceArtifact(
        eventsPath,
        `transcripts/${phase}.events.jsonl`,
        "mvp15d-final-ue-automation-producer",
        "raw",
        EVENT_SCHEMA,
      ),
      sourceArtifact(
        stderrPath,
        `logs/${phase}.stderr.log`,
        "mvp15d-final-ue-automation-producer",
        "deterministically-redacted",
        "text/plain",
      ),
      sourceArtifact(
        ledgerPath,
        `metadata/${phase}.producer.json`,
        "mvp15d-final-runner",
        "raw",
        "uagent.mvp15d.final.producer-ledger.v1",
      ),
      sourceArtifact(
        runtimeEventPath,
        `transcripts/${phase}.runtime-events.jsonl`,
        "mvp15d-final-ue-automation-producer",
        "raw",
        RUNTIME_EVENT_SCHEMA,
      ),
      sourceArtifact(
        loadedPath,
        "captures/loaded-modules.json",
        "mvp15d-final-ue-automation-producer",
        "raw",
        LOADED_LEDGER_SCHEMA,
      ),
      sourceArtifact(
        jobPath,
        "metadata/ue-automation.job-closeout.json",
        "mvp15d-final-ue-automation-producer",
        "raw",
        "uagent.mvp15d.final.job-closeout.v1",
      ),
      sourceArtifact(
        portPath,
        "metadata/ue-automation.port-closeout.json",
        "mvp15d-final-ue-automation-producer",
        "raw",
        "uagent.mvp15d.final.port-closeout.v1",
      ),
    ];
    const summary = {
      schemaVersion: UE_SCHEMA,
      taskGeneration: TASK_GENERATION,
      taskId: TASK_ID,
      sourceCommit: identity.compiledCommit,
      evidenceMode: "live",
      persistedOriginClaimConsistent: true,
      productionLaunchAuthorityVerified: false,
      sessionBindingSha256: retainedBindingForTest("session", sessionId),
      endpointSha256: retainedBindingForTest("endpoint", endpoint),
      generation,
      producerLedgerSha256: cryptoHash(readFileSync(ledgerPath)),
      installedLoadedVerified: true,
      matrixComplete: true,
      testNames: [
        "UAgentAssetTools.Contracts",
        "UAgentAssetTools.ReadOnly",
        "UAgentAssetTools.Closeout",
      ],
      expectedTestCount: 3,
      passedTestCount: 3,
      failedTestCount: 0,
      skippedTestCount: 0,
      mutationCount: 0,
      contentSha256: "a".repeat(64),
      contentUnchanged: true,
      processResidualCount: 0,
      productionArtifactConsistencyVerified: true,
      loadedLedgerSha256: state.provenance.loadedLedger.sha256,
      jobCloseoutSha256: state.provenance.jobCloseout.sha256,
      sourceArtifacts,
    };
    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    return {
      args: {
        repository: REPOSITORY,
        "evidence-root": root,
        "task-id": TASK_ID,
        marker,
        session: sessionId,
        generation: String(generation),
        port: String(port),
        "ue-root": ueRoot,
      },
      summaryPath,
    };
  }

  return {
    base,
    root,
    executablePath,
    ueRoot,
    earlyIdentityPath,
    loadedPath,
    jobPath,
    state,
    reset,
    verify,
    writeFullChain,
    writeEarlyIdentity,
    writeLoaded,
    writeJob,
  };
}

test(
  "final checkout remains byte-exact under core.autocrlf=true with no hardlinks",
  { skip: process.platform !== "win32" },
  () => {
    const fixture = createCandidate();
    const paths = [
      "integrations/unreal/UAgentAssetTools/Resources/mvp15d-native-binding-v2.json",
      "packages/shared/test-fixtures/mvp15d-native-binding-v2.json",
    ];
    try {
      const bytes = paths.map((path) => readFileSync(resolve(fixture.clone, path)));
      for (const value of bytes) {
        assert.equal(value.length, CANONICAL_FIXTURE_SIZE);
        assert.equal(cryptoHash(value), CANONICAL_FIXTURE_SHA256);
      }
      assert.deepEqual(bytes[0], bytes[1]);
      assert.equal(git(fixture.clone, ["status", "--porcelain=v1"]), "");
      assert.equal(lstatSync(resolve(fixture.clone, paths[0])).nlink, 1);
      assert.notEqual(
        lstatSync(resolve(fixture.clone, paths[0])).ino,
        lstatSync(resolve(fixture.origin, paths[0])).ino,
      );
    } finally {
      if (process.env.UAGENT_KEEP_CHECKOUT_FIXTURE === "1") {
        process.stdout.write(
          `${JSON.stringify({
            status: "retained_checkout_fixture",
            base: fixture.base,
            clone: fixture.clone,
            commit: fixture.commit,
            coreAutocrlf: git(fixture.clone, ["config", "--get", "core.autocrlf"]),
            gitStatus: git(fixture.clone, ["status", "--porcelain=v1"]),
            files: paths.map((path) => ({
              path,
              size: lstatSync(resolve(fixture.clone, path)).size,
              sha256: cryptoHash(readFileSync(resolve(fixture.clone, path))),
              linkCount: lstatSync(resolve(fixture.clone, path)).nlink,
              sourceFileId: String(lstatSync(resolve(fixture.origin, path)).ino),
              cloneFileId: String(lstatSync(resolve(fixture.clone, path)).ino),
            })),
          })}\n`,
        );
      } else {
        rmSync(fixture.base, { recursive: true, force: true });
      }
    }
  },
);

test(
  "final build plan and live fixture use exact RunUAT.bat ordered -Rocket arguments",
  { skip: process.platform !== "win32" },
  () => {
    const fixture = createCandidate();
    try {
      const packageRoot = resolve(
        fixture.clone,
        "external",
        "mvp15d-final-d13-d16-20260728_120001",
        "package",
        "UAgentAssetTools",
      );
      const plan = runBuild([
        "--mode",
        "plan",
        "--source",
        fixture.clone,
        "--package",
        packageRoot,
        "--runuat",
        fixture.goodRunUat,
        "--ue-root",
        fixture.goodUeRoot,
        "--task-id",
        TASK_ID,
      ]);
      assert.equal(plan.status, "build_planned");
      assert.equal(plan.buildCompleted, false);
      assert.equal(basename(plan.runUat), "RunUAT.bat");
      assert.deepEqual(plan.orderedArguments, [
        "BuildPlugin",
        `-Plugin=${resolve(
          fixture.clone,
          "integrations",
          "unreal",
          "UAgentAssetTools",
          "UAgentAssetTools.uplugin",
        )}`,
        `-Package=${packageRoot}`,
        "-TargetPlatforms=Win64",
        "-Rocket",
      ]);
      assert.match(plan.sanitizedCommand, /RunUAT\.bat"/i);
      assert.match(plan.sanitizedCommand, /"-Rocket"$/);

      const evidenceRoot = resolve(
        fixture.clone,
        "external",
        "mvp15d-final-d13-d16-20260728_120001",
      );
      const live = runBuild([
        "--mode",
        "live",
        "--source",
        fixture.clone,
        "--package",
        packageRoot,
        "--runuat",
        fixture.goodRunUat,
        "--ue-root",
        fixture.goodUeRoot,
        "--task-id",
        TASK_ID,
        "--evidence-root",
        evidenceRoot,
        "--task-marker",
        "uagent-mvp15d-final-build-fixture-0001",
      ]);
      assert.equal(live.status, "build_completed", JSON.stringify(live));
      assert.equal(live.childExitCode, 0);
      assert.equal(live.wrapperExitCode, 0);
      assert.equal(live.packagePresent, true);
      assert.equal(live.successManifestPresent, false);
      assert.equal(
        live.sourceArtifacts.some(({ size }) => size > 0),
        true,
      );
      const ledger = JSON.parse(
        readFileSync(resolve(evidenceRoot, "metadata", "build-command.json"), "utf8"),
      );
      assert.equal(ledger.launcher.basename, "RunUAT.bat");
      assert.equal(ledger.orderedArguments.at(-1), "-Rocket");
      assert.equal(ledger.toolchainFacts.engineVersion, "5.8.1");
      assert.equal(ledger.toolchainFacts.engineChangelist, 56057345);
      assert.equal(ledger.toolchainFacts.compatibleChangelist, 55116800);
      assert.equal(ledger.toolchainFacts.moduleBuildId, "55116800");
    } finally {
      rmSync(fixture.base, { recursive: true, force: true });
    }
  },
);

test(
  "final build rejects command metacharacters and deletes nonzero partial packages",
  { skip: process.platform !== "win32" },
  () => {
    const fixture = createCandidate();
    try {
      expectCode(
        () =>
          runBuild([
            "--mode",
            "plan",
            "--source",
            fixture.clone,
            "--package",
            `${resolve(fixture.base, "unsafe")}&whoami`,
            "--runuat",
            fixture.goodRunUat,
            "--ue-root",
            fixture.goodUeRoot,
          ]),
        "PACKAGE_PATH_UNSAFE",
      );
      const evidenceRoot = resolve(
        fixture.clone,
        "external",
        "mvp15d-final-d13-d16-20260728_120002",
      );
      const packageRoot = resolve(evidenceRoot, "package", "UAgentAssetTools");
      const failed = runBuild([
        "--mode",
        "live",
        "--source",
        fixture.clone,
        "--package",
        packageRoot,
        "--runuat",
        fixture.failRunUat,
        "--ue-root",
        fixture.failUeRoot,
        "--task-id",
        TASK_ID,
        "--evidence-root",
        evidenceRoot,
        "--task-marker",
        "uagent-mvp15d-final-build-fixture-0002",
      ]);
      assert.equal(failed.status, "build_failed");
      assert.equal(failed.childExitCode, 17, JSON.stringify(failed));
      assert.equal(failed.wrapperExitCode, 1);
      assert.equal(existsSync(packageRoot), false);
      assert.equal(failed.successManifestPresent, false);
    } finally {
      rmSync(fixture.base, { recursive: true, force: true });
    }
  },
);

test(
  "final build redacts captured stdout and stderr when spawn reports maxBuffer truncation",
  { skip: process.platform !== "win32" },
  () => {
    const fixture = createCandidate();
    try {
      const externalLogPath = resolve(fixture.goodUeRoot, "uat-truncated-external.log");
      writeFileSync(
        externalLogPath,
        String.raw`credential \"synthetic-external-truncated-tail`,
        "utf8",
      );
      expectCode(
        () => runBuild([], { maxBuffer: 256 * 1024 * 1024 + 1 }),
        "BUILD_MAX_BUFFER_INVALID",
      );
      for (const [channel, prefix] of [
        ["stdout", 'password="'],
        ["stderr", "credential='"],
      ]) {
        writeBuilder(resolve(fixture.goodUeRoot, "builder.mjs"), 0, {
          overflowChannel: channel,
        });
        const evidenceRoot = resolve(
          fixture.clone,
          "external",
          channel === "stdout"
            ? "mvp15d-final-d13-d16-20260728_120012"
            : "mvp15d-final-d13-d16-20260728_120013",
        );
        const packageRoot = resolve(evidenceRoot, "package", "UAgentAssetTools");
        const failed = runBuild(
          [
            "--mode",
            "live",
            "--source",
            fixture.clone,
            "--package",
            packageRoot,
            "--runuat",
            fixture.goodRunUat,
            "--ue-root",
            fixture.goodUeRoot,
            "--task-id",
            TASK_ID,
            "--evidence-root",
            evidenceRoot,
            "--task-marker",
            `uagent-mvp15d-final-${channel}-overflow-0012`,
            "--uat-log",
            externalLogPath,
          ],
          { maxBuffer: 1_024 },
        );
        assert.equal(failed.status, "build_failed");
        assert.equal(failed.reason, "RUNUAT_OUTPUT_TRUNCATED");
        assert.equal(failed.childExitCode, null);
        assert.equal(failed.wrapperExitCode, 1);
        assert.equal(failed.closeout.childExited, false);
        assert.equal(failed.packagePresent, false);
        assert.equal(existsSync(packageRoot), false);
        assert.equal(failed.sourceArtifacts.length, 3);
        for (const artifact of failed.sourceArtifacts) {
          const retained = readFileSync(
            resolve(evidenceRoot, artifact.relativePath.split("/").join("\\")),
            "utf8",
          );
          assert.deepEqual(
            findTranscriptLeaks(retained),
            { absolutePaths: 0, secrets: 0 },
            `${channel} ${artifact.relativePath}`,
          );
          assert.equal(retained.includes("synthetic-external-truncated-tail"), false);
          assert.equal(retained.includes(prefix), false);
        }
      }
    } finally {
      rmSync(fixture.base, { recursive: true, force: true });
    }
  },
);

test(
  "final build removes a partial package when transcript retention fails closed",
  { skip: process.platform !== "win32" },
  () => {
    const fixture = createCandidate();
    try {
      const evidenceRoot = resolve(
        fixture.clone,
        "external",
        "mvp15d-final-d13-d16-20260728_120011",
      );
      const packageRoot = resolve(evidenceRoot, "package", "UAgentAssetTools");
      expectCode(
        () =>
          runBuild([
            "--mode",
            "live",
            "--source",
            fixture.clone,
            "--package",
            packageRoot,
            "--runuat",
            fixture.goodRunUat,
            "--ue-root",
            fixture.goodUeRoot,
            "--task-id",
            TASK_ID,
            "--evidence-root",
            evidenceRoot,
            "--task-marker",
            "uagent-mvp15d-final-retention-fixture-0011",
            "--uat-log",
            resolve(fixture.base, "missing-uat.log"),
          ]),
        "BUILD_UAT_LOG_MISSING",
      );
      assert.equal(existsSync(packageRoot), false);
    } finally {
      rmSync(fixture.base, { recursive: true, force: true });
    }
  },
);

test(
  "final build retained transcripts deterministically redact drive, UNC, user-home and secret bytes",
  { skip: process.platform !== "win32" },
  () => {
    const fixture = createCandidate();
    try {
      writeAdversarialBuilder(resolve(fixture.goodUeRoot, "builder.mjs"), fixture.goodUeRoot);
      for (const rawSecret of [
        "whitespace token synthetic-stdout-value; END_STDOUT retained",
        'password\t"synthetic stderr value"\tEND_STDERR retained',
        'LogPrivacy: credential\t\\"synthetic-external-value\\"; END_EXTERNAL retained',
        'truncated password="synthetic-stdout-truncated',
        "truncated credential='synthetic-stderr-truncated",
        String.raw`LogTruncated: credential=\"synthetic-external-truncated`,
        "punctuation token=synthetic,stdout-tail END_PUNCTUATION retained",
      ]) {
        assert.deepEqual(findTranscriptLeaks(rawSecret), { absolutePaths: 0, secrets: 1 });
      }
      const externalLogPath = resolve(fixture.goodUeRoot, "uat-external-raw.log");
      writeFileSync(
        externalLogPath,
        [
          String.raw`LogInit: Y:\Synthetic SDK Root\Windows Kits\10 extension loaded`,
          String.raw`LogTemp: W:\Synthetic Legacy Engine\file.uasset referenced`,
          "LogAuth: api_key=abcdef123456 present",
          'LogPrivacy: credential\t\\"synthetic-external-value\\"; END_EXTERNAL retained',
          String.raw`LogTruncated: credential=\"synthetic-external-truncated`,
          "",
        ].join("\r\n"),
        "utf8",
      );
      const evidenceRoot = resolve(
        fixture.clone,
        "external",
        "mvp15d-final-d13-d16-20260728_120010",
      );
      const packageRoot = resolve(evidenceRoot, "package", "UAgentAssetTools");
      const build = runBuild([
        "--mode",
        "live",
        "--source",
        fixture.clone,
        "--package",
        packageRoot,
        "--runuat",
        fixture.goodRunUat,
        "--ue-root",
        fixture.goodUeRoot,
        "--task-id",
        TASK_ID,
        "--evidence-root",
        evidenceRoot,
        "--task-marker",
        "uagent-mvp15d-final-redaction-fixture-0010",
        "--uat-log",
        externalLogPath,
      ]);
      assert.equal(build.status, "build_completed", JSON.stringify(build));
      assert.equal(build.childExitCode, 0);
      const ledger = JSON.parse(
        readFileSync(resolve(evidenceRoot, "metadata", "build-command.json"), "utf8"),
      );
      assert.equal(ledger.toolchainFacts.compilerName, "MSVC");
      assert.equal(ledger.toolchainFacts.compilerVersion, "14.44.35207");
      assert.equal(ledger.toolchainFacts.sdkName, "Windows SDK");
      assert.equal(ledger.toolchainFacts.sdkVersion, "10.0.22621.0");

      const logs = {
        stdout: readFileSync(resolve(evidenceRoot, "logs", "runuat.stdout.redacted.log"), "utf8"),
        stderr: readFileSync(resolve(evidenceRoot, "logs", "runuat.stderr.redacted.log"), "utf8"),
        external: readFileSync(
          resolve(evidenceRoot, "logs", "runuat.external.redacted.log"),
          "utf8",
        ),
      };
      for (const [name, content] of Object.entries(logs)) {
        assert.equal(
          /(?<![A-Za-z])[A-Za-z]:[\\/](?![\\/])/.test(content),
          false,
          `${name} drive prefix`,
        );
        assert.equal(/(?<![:\\/])[\\/]{2}(?![\\/])\S/.test(content), false, `${name} unc prefix`);
        assert.deepEqual(
          findTranscriptLeaks(content),
          { absolutePaths: 0, secrets: 0 },
          `${name} leak scan`,
        );
        for (const prohibited of [
          "sekret123",
          "hunter2",
          "abc.def.ghi",
          "abcdef123456",
          "synthetic-stdout-value",
          "synthetic-stdout-truncated",
          "synthetic,stdout-tail",
          "synthetic stderr value",
          "synthetic-stderr-truncated",
          "synthetic-external-value",
          "synthetic-external-truncated",
          "Zm9vOmJhcg==",
          "command-secret",
          "Build User",
          "Synthetic Toolchains",
          String.raw`MsBuild\Current`,
          "buildshare",
          "Synthetic SDK Root",
        ]) {
          assert.equal(content.includes(prohibited), false, `${name} must not contain it`);
        }
      }

      assert.match(
        logs.stdout,
        /Using Visual Studio 14\.44\.35228 toolchain \(\$\{ABSOLUTE_PATH\}\) and Windows 10\.0\.22621\.0 SDK \(\$\{ABSOLUTE_PATH\}\)\./,
      );
      assert.match(logs.stdout, /MSBuild \$\{ABSOLUTE_PATH\} \/p:Configuration=Development/);
      assert.match(
        logs.stdout,
        /dotnet \$\{UE_ROOT\}\\Engine\\Binaries\\DotNET\\UnrealBuildTool\\UnrealBuildTool\.exe running/,
      );
      assert.match(
        logs.stdout,
        /writing \$\{PACKAGE_ROOT\}\\Binaries\\Win64\\UnrealEditor-UAgentAssetTools\.dll/,
      );
      assert.match(
        logs.stdout,
        /reading \$\{SOURCE_ROOT\}\\integrations\\unreal\\UAgentAssetTools\\UAgentAssetTools\.uplugin/,
      );
      assert.match(logs.stdout, /cache \$\{USER_HOME\} hit/);
      assert.match(logs.stdout, /mirror \$\{ABSOLUTE_PATH\} and \$\{ABSOLUTE_PATH\} done/);
      assert.match(logs.stdout, /compiler \$\{ABSOLUTE_PATH\} invoked/);
      assert.match(logs.stdout, /device \$\{ABSOLUTE_PATH\} opened/);
      assert.match(logs.stdout, /drive-root \$\{ABSOLUTE_PATH\} checked/);
      assert.match(logs.stdout, /list \$\{ABSOLUTE_PATH\};\$\{ABSOLUTE_PATH\} end/);
      assert.match(
        logs.stdout,
        /auth token=\$\{REDACTED\} password=\$\{REDACTED\} Bearer \$\{REDACTED\} end/,
      );
      assert.match(logs.stdout, /headers Authorization=\$\{REDACTED\} --token=\$\{REDACTED\} end/);
      assert.match(logs.stdout, /whitespace token=\$\{REDACTED\}; END_STDOUT retained/);
      assert.match(logs.stdout, /truncated password=\$\{REDACTED\}/);
      assert.match(logs.stdout, /punctuation token=\$\{REDACTED\} END_PUNCTUATION retained/);
      assert.match(logs.stdout, /Tandem marker: build completed with 0 warnings and 0 errors/);
      assert.match(logs.stdout, /feed https:\/\/example\.com\/build\/feed at 10:30:15 ok/);
      assert.match(logs.stderr, /warning \$\{ABSOLUTE_PATH\} stale/);
      assert.match(logs.stderr, /fatal \$\{ABSOLUTE_PATH\} missing/);
      assert.match(logs.stderr, /password=\$\{REDACTED\}\tEND_STDERR retained/);
      assert.match(logs.stderr, /truncated credential=\$\{REDACTED\}/);
      assert.match(logs.stderr, /note no absolute paths here/);
      assert.match(logs.external, /LogInit: \$\{ABSOLUTE_PATH\} extension loaded/);
      assert.match(logs.external, /LogTemp: \$\{ABSOLUTE_PATH\} referenced/);
      assert.match(logs.external, /LogAuth: api_key=\$\{REDACTED\} present/);
      assert.match(logs.external, /LogPrivacy: credential=\$\{REDACTED\}; END_EXTERNAL retained/);
      assert.match(logs.external, /LogTruncated: credential=\$\{REDACTED\}/);

      assert.equal(build.sourceArtifacts.length, 3);
      for (const artifact of build.sourceArtifacts) {
        assert.equal(artifact.redactionStatus, "deterministically-redacted");
        const retained = readFileSync(
          resolve(evidenceRoot, artifact.relativePath.split("/").join("\\")),
        );
        assert.equal(artifact.size, retained.length, artifact.relativePath);
        assert.equal(
          artifact.sha256,
          createHash("sha256").update(retained).digest("hex"),
          artifact.relativePath,
        );
      }
    } finally {
      rmSync(fixture.base, { recursive: true, force: true });
    }
  },
);

test(
  "final manifest recomputes artifacts while hand-authored loaded JSON remains structural-only",
  { skip: process.platform !== "win32" },
  () => {
    const fixture = createCandidate();
    try {
      const evidenceRoot = resolve(
        fixture.clone,
        "external",
        "mvp15d-final-d13-d16-20260728_120003",
      );
      const packageRoot = resolve(evidenceRoot, "package", "UAgentAssetTools");
      const build = runBuild([
        "--mode",
        "live",
        "--source",
        fixture.clone,
        "--package",
        packageRoot,
        "--runuat",
        fixture.goodRunUat,
        "--ue-root",
        fixture.goodUeRoot,
        "--task-id",
        TASK_ID,
        "--evidence-root",
        evidenceRoot,
        "--task-marker",
        "uagent-mvp15d-final-manifest-fixture-0003",
      ]);
      assert.equal(build.status, "build_completed", JSON.stringify(build));
      const args = manifestArgs(fixture, evidenceRoot, packageRoot);
      const created = createManifest(args);
      assert.equal(created.status, "manifest_created");
      assert.notEqual(created.manifestSelfSha256, created.manifestFileSha256);
      assert.equal(verifyManifest(args).status, "manifest_verified");

      const rawLogPath = resolve(evidenceRoot, "logs", "runuat.stdout.redacted.log");
      const rawLogBytes = readFileSync(rawLogPath);
      writeFileSync(rawLogPath, "tampered transcript\n");
      expectCode(() => verifyManifest(args), "BUILD_SOURCE_ARTIFACT_HASH_MISMATCH");
      writeFileSync(rawLogPath, rawLogBytes);

      const buildResultPath = resolve(evidenceRoot, "metadata", "build-result.json");
      const buildResultText = readFileSync(buildResultPath, "utf8");
      for (const coherentLeak of [
        Buffer.from(String.raw`coherent C:\private\artifact.bin`),
        Buffer.from("X-Api-Key: coherent-secret"),
        Buffer.from("token synthetic-coherent-value"),
        Buffer.from('password="synthetic-double-truncated'),
        Buffer.from("credential='synthetic-single-truncated"),
        Buffer.from(String.raw`credential \"synthetic-outer-truncated`),
        Buffer.from(String.raw`credential \"synthetic \\\"nested\\\" truncated`),
        ...[",", ";", ")", "]", "}"].map((punctuation) =>
          Buffer.from(`password=synthetic${punctuation}adjacent-tail`),
        ),
      ]) {
        writeFileSync(rawLogPath, coherentLeak);
        const coherentResult = JSON.parse(buildResultText);
        const coherentArtifact = coherentResult.sourceArtifacts.find(
          ({ relativePath }) => relativePath === "logs/runuat.stdout.redacted.log",
        );
        coherentArtifact.size = coherentLeak.length;
        coherentArtifact.sha256 = cryptoHash(coherentLeak);
        writeFileSync(buildResultPath, `${JSON.stringify(coherentResult, null, 2)}\n`);
        expectCode(() => verifyManifest(args), "BUILD_SOURCE_ARTIFACT_PRIVACY_INVALID");
        writeFileSync(rawLogPath, rawLogBytes);
        writeFileSync(buildResultPath, buildResultText);
      }

      const sourceDirectory = resolve(packageRoot, "Source");
      mkdirSync(sourceDirectory);
      writeFileSync(resolve(sourceDirectory, "unexpected.cpp"), "forbidden");
      expectCode(() => verifyManifest(args), "PACKAGE_ARTIFACT_EXTRA_OR_FORBIDDEN");
      rmSync(sourceDirectory, { recursive: true, force: true });

      const manifestPath = resolve(packageRoot, "UAgentAssetTools.build.json");
      const originalManifestText = readFileSync(manifestPath, "utf8");
      const tamperedManifest = JSON.parse(originalManifestText);
      tamperedManifest.compiler.version = "99.99.99999";
      tamperedManifest.manifestSelfSha256 = manifestSelfHash(tamperedManifest);
      writeFileSync(manifestPath, `${JSON.stringify(tamperedManifest, null, 2)}\n`);
      expectCode(() => verifyManifest(args), "MANIFEST_RECOMPUTE_MISMATCH");
      writeFileSync(manifestPath, originalManifestText);

      const projectRoot = resolve(evidenceRoot, "project", "FinalHost");
      const installedRoot = resolve(projectRoot, "Plugins", "UAgentAssetTools");
      mkdirSync(resolve(projectRoot, "Plugins"), { recursive: true });
      cpSync(packageRoot, installedRoot, { recursive: true });
      const modulePath = resolve(
        installedRoot,
        "Binaries",
        "Win64",
        "UnrealEditor-UAgentAssetTools.dll",
      );
      const loadedLedger = resolve(evidenceRoot, "captures", "loaded-modules.json");
      mkdirSync(resolve(loadedLedger, ".."));
      const legacyLoaded = {
        schemaVersion: LOADED_LEDGER_SCHEMA,
        productionOrigin: PRODUCTION_ORIGIN,
        fixtureUsed: false,
        taskId: TASK_ID,
        taskMarkerSha256: retainedBindingForTest(
          "marker",
          "uagent-mvp15d-final-manifest-fixture-0003",
        ),
        sessionBindingSha256: retainedBindingForTest("session", "final-session-00000001"),
        generation: 1,
        sourceCommit: fixture.commit,
        sourceTreeSha256: "a".repeat(64),
        sourceDirty: true,
        project: { id: "FinalHost", sha256: "c".repeat(64) },
        manifest: { sha256: "d".repeat(64) },
        package: { id: "UAgentAssetTools", sha256: "e".repeat(64) },
        installedRoot: { id: "UAgentAssetTools", sha256: "f".repeat(64) },
        process: {
          pidBindingSha256: retainedBindingForTest("pid", 4567),
          creationFileTimeUtcBindingSha256: retainedBindingForTest(
            "creation-filetime",
            "133500000000000000",
          ),
          executableBasename: "UnrealEditor-Cmd.exe",
          executableSha256: "b".repeat(64),
        },
        modules: [
          {
            name: basename(modulePath),
            path: `Binaries/Win64/${basename(modulePath)}`,
            size: lstatSync(modulePath).size,
            sha256: cryptoHash(readFileSync(modulePath)),
          },
        ],
      };
      writeFileSync(loadedLedger, `${JSON.stringify(legacyLoaded, null, 2)}\n`, "utf8");
      const enginePlugins = resolve(fixture.base, "engine-plugins");
      const userPlugins = resolve(fixture.base, "user-plugins");
      mkdirSync(enginePlugins);
      mkdirSync(userPlugins);
      const installed = verifyInstalled({
        ...args,
        "project-root": projectRoot,
        "loaded-ledger": loadedLedger,
        "engine-plugin-root": enginePlugins,
        "user-plugin-root": userPlugins,
      });
      assert.equal(installed.status, "installed_loaded_structural_verified");
      assert.equal(installed.productionLaunchAuthorityVerified, false);
      assert.notEqual(installed.status, "installed_loaded_verified");
      assert.equal(installed.installedCopyCount, 1);
      assert.equal(installed.loadedModuleCount, 1);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const installedArtifacts = collectPackageArtifacts(installedRoot, true).artifacts;
      const descriptor = (relativePath, fill) => ({
        relativePath,
        size: 1,
        sha256: fill.repeat(64),
      });
      const currentLoaded = {
        ...legacyLoaded,
        taskGeneration: "final-d13-d16",
        package: {
          id: "UAgentAssetTools",
          artifactCount: manifest.artifacts.length,
          sha256: cryptoHash(Buffer.from(stableForTest(manifest.artifacts), "utf8")),
        },
        installedRoot: {
          id: "UAgentAssetTools",
          artifactCount: installedArtifacts.length,
          sha256: cryptoHash(Buffer.from(stableForTest(installedArtifacts), "utf8")),
        },
        authority: {
          schemaVersion: PRODUCTION_AUTHORITY_SCHEMA,
          processIdentitySha256: "1".repeat(64),
          sources: {
            phaseProducer: descriptor("scripts/mvp15d-final-ue-automation-producer.mjs", "2"),
            helper: descriptor("scripts/mvp15d-final-live-producer-helper.mjs", "3"),
            observer: descriptor("scripts/mvp15d-loaded-module-observer.mjs", "4"),
            jobRunner: descriptor("scripts/mvp15d-windows-job-process-runner.ps1", "5"),
          },
          bindingSha256: "0".repeat(64),
        },
      };
      currentLoaded.authority.bindingSha256 = cryptoHash(
        Buffer.from(stableForTest(loadedAuthorityBindingMaterialForTest(currentLoaded)), "utf8"),
      );
      writeFileSync(loadedLedger, `${JSON.stringify(currentLoaded, null, 2)}\n`, "utf8");
      const currentInstalled = verifyInstalled({
        ...args,
        "project-root": projectRoot,
        "loaded-ledger": loadedLedger,
        "engine-plugin-root": enginePlugins,
        "user-plugin-root": userPlugins,
      });
      assert.equal(currentInstalled.status, "installed_loaded_structural_verified");
      assert.equal(currentInstalled.productionLaunchAuthorityVerified, false);
      const loadedOriginal = readFileSync(loadedLedger, "utf8");
      const loadedTampered = JSON.parse(loadedOriginal);
      loadedTampered.modules[0].sha256 = "b".repeat(64);
      loadedTampered.authority.bindingSha256 = cryptoHash(
        Buffer.from(stableForTest(loadedAuthorityBindingMaterialForTest(loadedTampered)), "utf8"),
      );
      writeFileSync(loadedLedger, `${JSON.stringify(loadedTampered, null, 2)}\n`);
      expectCode(
        () =>
          verifyInstalled({
            ...args,
            "project-root": projectRoot,
            "loaded-ledger": loadedLedger,
            "engine-plugin-root": enginePlugins,
            "user-plugin-root": userPlugins,
          }),
        "LOADED_MODULE_INVALID",
      );
      writeFileSync(loadedLedger, loadedOriginal);

      const shadow = resolve(enginePlugins, "UAgentAssetTools", "UAgentAssetTools.uplugin");
      mkdirSync(resolve(shadow, ".."));
      writeFileSync(shadow, "{}", "utf8");
      expectCode(
        () =>
          verifyInstalled({
            ...args,
            "project-root": projectRoot,
            "loaded-ledger": loadedLedger,
            "engine-plugin-root": enginePlugins,
            "user-plugin-root": userPlugins,
          }),
        "INSTALLED_SHADOW_COPY_DETECTED",
      );

      const ledgerPath = args["build-ledger"];
      const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
      ledger.orderedArguments = [...ledger.orderedArguments].reverse();
      writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
      expectCode(() => verifyManifest(args), "MANIFEST_BUILD_LEDGER_INVALID");
    } finally {
      rmSync(fixture.base, { recursive: true, force: true });
    }
  },
);

test(
  "hand-authored UE provenance proves only persisted consistency and rejects fact replacement",
  { skip: process.platform !== "win32", timeout: 180_000 },
  () => {
    const fixture = createHandAuthoredProvenanceFixture();
    const code = "FINAL_UE_PRODUCTION_PROVENANCE_INVALID";
    try {
      const persisted = fixture.verify();
      assert.equal(persisted.status, "ue_production_artifact_consistency_verified");
      assert.equal(persisted.persistedArtifactConsistencyVerified, true);
      assert.equal(persisted.productionLaunchAuthorityVerified, false);

      fixture.reset();
      writeFileSync(fixture.loadedPath, `${readFileSync(fixture.loadedPath, "utf8")} `, "utf8");
      expectCode(() => fixture.verify(), code);

      for (const [name, mutate] of [
        [
          "project",
          () => {
            fixture.state.loaded.project.sha256 = "1".repeat(64);
            fixture.state.provenance.projectSha256 = "1".repeat(64);
            fixture.writeLoaded();
          },
        ],
        [
          "manifest",
          () => {
            fixture.state.loaded.manifest.sha256 = "2".repeat(64);
            fixture.state.provenance.manifestSha256 = "2".repeat(64);
            fixture.writeLoaded();
          },
        ],
        [
          "package inventory",
          () => {
            fixture.state.loaded.package.sha256 = "3".repeat(64);
            fixture.state.provenance.packageInventorySha256 = "3".repeat(64);
            fixture.writeLoaded();
          },
        ],
        [
          "installed inventory",
          () => {
            fixture.state.loaded.installedRoot.sha256 = "4".repeat(64);
            fixture.state.provenance.installedInventorySha256 = "4".repeat(64);
            fixture.writeLoaded();
          },
        ],
        [
          "source identity",
          () => {
            fixture.state.loaded.sourceTreeSha256 = "5".repeat(64);
            fixture.state.provenance.sourceTreeSha256 = "5".repeat(64);
            fixture.writeLoaded();
          },
        ],
        [
          "source descriptor",
          () => {
            fixture.state.loaded.authority.sources.observer.sha256 = "6".repeat(64);
            fixture.state.provenance.producerSources.observer.sha256 = "6".repeat(64);
            fixture.writeLoaded();
          },
        ],
        [
          "executable",
          () => {
            const changed = "7".repeat(64);
            fixture.state.loaded.process.executableSha256 = changed;
            fixture.state.provenance.process.executableSha256 = changed;
            fixture.state.phaseLedger.runtimeProcess.executable.sha256 = changed;
            fixture.state.earlyIdentity.executableSha256 = changed;
            fixture.writeEarlyIdentity();
            fixture.writeLoaded();
          },
        ],
        [
          "producer",
          () => {
            fixture.state.phaseLedger.producer.sha256 = "8".repeat(64);
          },
        ],
        [
          "Job closeout",
          () => {
            fixture.state.job.rootExitCode = 9;
            fixture.writeJob();
          },
        ],
      ]) {
        fixture.reset();
        mutate();
        assert.throws(
          () => fixture.verify(),
          (error) => error?.code === code,
          `${name} replacement must fail closed`,
        );
      }
    } finally {
      rmSync(fixture.base, { recursive: true, force: true });
    }
  },
);

test(
  "fully hand-authored coherent chain cannot mint owned launch authority through exports or CLI",
  { skip: process.platform !== "win32", timeout: 180_000 },
  () => {
    const fixture = createHandAuthoredProvenanceFixture();
    try {
      const chain = fixture.writeFullChain();
      const direct = validateUeAutomation(chain.args);
      assert.equal(direct.status, "ue_automation_persisted_consistency_verified");
      assert.equal(direct.persistedArtifactConsistencyVerified, true);
      assert.equal(direct.productionLaunchAuthorityVerified, false);
      assert.equal(Object.hasOwn(direct, "launchReceipt"), false);
      assert.notEqual(direct.status, "ue_automation_owned_launch_verified");

      const callerObjectAttempt = validateUeAutomation(chain.args, {
        productionLaunchAuthorityVerified: true,
        authorityBindingSha256: fixture.state.loaded.authority.bindingSha256,
      });
      assert.deepEqual(callerObjectAttempt, direct);

      const cli = spawnSync(
        process.execPath,
        [
          resolve(REPOSITORY, "scripts", "mvp15d-final-runner.mjs"),
          "ue-automation",
          "--mode",
          "verify",
          "--repository",
          REPOSITORY,
          "--evidence-root",
          fixture.root,
          "--task-id",
          TASK_ID,
          "--marker",
          chain.args.marker,
          "--session",
          chain.args.session,
          "--generation",
          chain.args.generation,
          "--port",
          chain.args.port,
          "--ue-root",
          fixture.ueRoot,
        ],
        { cwd: REPOSITORY, encoding: "utf8", shell: false, windowsHide: true },
      );
      assert.equal(cli.status, 0, cli.stderr);
      const cliResult = JSON.parse(cli.stdout);
      assert.equal(cliResult.status, "ue_automation_persisted_consistency_verified");
      assert.equal(cliResult.persistedArtifactConsistencyVerified, true);
      assert.equal(cliResult.productionLaunchAuthorityVerified, false);
      assert.equal(Object.hasOwn(cliResult, "launchReceipt"), false);
    } finally {
      rmSync(fixture.base, { recursive: true, force: true });
    }
  },
);

test(
  "final generation fixture validators bind raw sources and fail closed on lifecycle drift",
  { skip: process.platform !== "win32" },
  () => {
    const fixture = createCandidate();
    try {
      const root = resolve(fixture.clone, "external", "mvp15d-final-d13-d16-20260728_120004");
      const preflightArgs = {
        mode: "plan",
        repository: fixture.clone,
        "evidence-root": root,
        "task-id": TASK_ID,
        "source-commit": fixture.commit,
        "ue-root": fixture.base,
        marker: "uagent-mvp15d-final-phase-fixture-0004",
        port: "31415",
      };
      assert.equal(runFinal("preflight", preflightArgs).status, "preflight_planned");
      assert.equal(
        runFinal("preflight", { ...preflightArgs, mode: "create" }).status,
        "preflight_created",
      );
      assert.equal(
        runFinal("project-create", {
          mode: "plan",
          repository: fixture.clone,
          "evidence-root": root,
        }).status,
        "project_create_planned",
      );
      for (const command of ["ue-automation", "product-capture", "ui-lifecycle"]) {
        const planned = runFinal(command, {
          mode: "plan",
          repository: fixture.clone,
          "evidence-root": root,
          "task-id": TASK_ID,
          marker: preflightArgs.marker,
          port: preflightArgs.port,
        });
        assert.match(planned.status, /_planned$/);
        if (command === "product-capture") {
          assert.deepEqual(planned.plan.retractions, [
            "refresh_tools",
            "reconnect",
            "endpoint_change",
            "renderer_restart",
            "ue_restart",
            "stale_completion",
          ]);
        }
        if (command === "ui-lifecycle") {
          assert.deepEqual(planned.plan.ledger, {
            uiDryRunActions: 1,
            dryRunCalls: 5,
            nativeRegistrations: 1,
            opaqueTokensIssued: 1,
            nativeExecuteGuards: 5,
            executeCalls: 5,
            verifyMutations: 0,
            nativeRollbackGuards: 4,
            rollbackCalls: 4,
            secondExecuteCalls: 0,
            secondRollbackCalls: 0,
            replaySideEffectDelta: [0, 0, 0, 0, 0],
            waitElapsedMilliseconds: { minimum: 65_000, maximum: 90_000 },
          });
        }
      }
      {
        const results = new Map();
        for (const command of ["ue-automation", "product-capture", "ui-lifecycle"]) {
          const result = runFinal(command, {
            mode: "fixture",
            repository: fixture.clone,
            "evidence-root": root,
            "task-id": TASK_ID,
            marker: preflightArgs.marker,
            port: preflightArgs.port,
            session: `final-${command}-fixture-session-0004`,
            generation: "1",
          });
          assert.equal(result.status, `${command.replaceAll("-", "_")}_fixture_verified`);
          assert.ok(result.eventCount > 4);
          results.set(command, result);
        }

        const ueSummaryPath = resolve(root, "summaries", "ue-automation.json");
        const ueOriginal = readFileSync(ueSummaryPath, "utf8");
        const editedSummary = JSON.parse(ueOriginal);
        editedSummary.passedTestCount += 1;
        writeFileSync(ueSummaryPath, `${JSON.stringify(editedSummary, null, 2)}\n`);
        expectCode(
          () =>
            validateUeAutomation({
              repository: fixture.clone,
              "evidence-root": root,
              "task-id": TASK_ID,
            }),
          "FINAL_PHASE_SUMMARY_SOURCE_DISAGREEMENT",
        );
        writeFileSync(ueSummaryPath, ueOriginal);

        const productEventsPath = resolve(root, "transcripts", "product-capture.events.jsonl");
        const productOriginal = readFileSync(productEventsPath, "utf8");
        const productLines = productOriginal.trimEnd().split(/\r?\n/);
        const mixed = JSON.parse(productLines[3]);
        mixed.generation += 1;
        productLines[3] = JSON.stringify(mixed);
        writeFileSync(productEventsPath, `${productLines.join("\n")}\n`);
        expectCode(
          () =>
            validateProductCapture({
              repository: fixture.clone,
              "evidence-root": root,
              "task-id": TASK_ID,
            }),
          "FINAL_PHASE_SOURCE_INVALID",
        );
        writeFileSync(productEventsPath, productOriginal);

        const rejectProductEvents = (mutate) => {
          const lines = productOriginal.trimEnd().split(/\r?\n/);
          mutate(lines);
          writeFileSync(productEventsPath, `${lines.join("\n")}\n`);
          expectCode(
            () =>
              validateProductCapture({
                repository: fixture.clone,
                "evidence-root": root,
                "task-id": TASK_ID,
              }),
            "FINAL_PHASE_SOURCE_INVALID",
          );
          writeFileSync(productEventsPath, productOriginal);
        };
        rejectProductEvents((lines) => lines.splice(4, 1));
        rejectProductEvents((lines) => {
          [lines[3], lines[4]] = [lines[4], lines[3]];
        });
        rejectProductEvents((lines) => lines.splice(4, 0, lines[3]));
        for (const field of ["taskId", "sessionId", "producerPid"]) {
          rejectProductEvents((lines) => {
            const event = JSON.parse(lines[3]);
            if (field === "producerPid") event.producer.pid += 1;
            else event[field] = `${event[field]}-wrong`;
            lines[3] = JSON.stringify(event);
          });
        }
        rejectProductEvents((lines) => {
          const event = JSON.parse(lines[3]);
          event.producer.mode = "live";
          lines[3] = JSON.stringify(event);
        });
        rejectProductEvents((lines) => {
          const event = JSON.parse(lines.find((line) => line.includes('"type":"capture_origin"')));
          event.data.origin = "real_product_adapter";
          const index = lines.findIndex((line) => line.includes('"type":"capture_origin"'));
          lines[index] = JSON.stringify(event);
        });
        rejectProductEvents((lines) => {
          const index = lines.findIndex((line) => line.includes('"type":"process_exited"'));
          const event = JSON.parse(lines[index]);
          event.data.exitCode = 9;
          lines[index] = JSON.stringify(event);
        });
        rejectProductEvents((lines) => {
          const index = lines.findIndex((line) => line.includes('"type":"closeout"'));
          const event = JSON.parse(lines[index]);
          event.data.portResidualCount = 1;
          lines[index] = JSON.stringify(event);
        });
        writeFileSync(productEventsPath, "generic text log\n");
        expectCode(
          () =>
            validateProductCapture({
              repository: fixture.clone,
              "evidence-root": root,
              "task-id": TASK_ID,
            }),
          "FINAL_PHASE_SOURCE_INVALID",
        );
        writeFileSync(productEventsPath, productOriginal);

        const productSummaryPath = resolve(root, "summaries", "product-capture.json");
        const productSummaryOriginal = readFileSync(productSummaryPath, "utf8");
        for (const mutate of [
          (summary) => {
            summary.installedLoadedVerified = false;
          },
          (summary) => {
            summary.toolNamesSha256 = "a".repeat(64);
          },
          (summary) => {
            summary.captureOrigin = "real_product_adapter";
          },
          (summary) => {
            summary.manualDescriptorInjection = true;
          },
          (summary) => {
            summary.directMcpBypass = true;
          },
          (summary) => {
            summary.retractions[0] = "failure";
          },
          (summary) => {
            summary.mutationCount = 1;
          },
        ]) {
          const summary = JSON.parse(productSummaryOriginal);
          mutate(summary);
          writeFileSync(productSummaryPath, `${JSON.stringify(summary, null, 2)}\n`);
          expectCode(
            () =>
              validateProductCapture({
                repository: fixture.clone,
                "evidence-root": root,
                "task-id": TASK_ID,
              }),
            "FINAL_PHASE_SUMMARY_SOURCE_DISAGREEMENT",
          );
        }
        writeFileSync(productSummaryPath, productSummaryOriginal);

        expectCode(
          () =>
            runFinal("ui-lifecycle", {
              mode: "live",
              repository: fixture.clone,
              "evidence-root": root,
              "task-id": TASK_ID,
              marker: preflightArgs.marker,
              port: preflightArgs.port,
              input: resolve(root, "summaries", "ui-lifecycle.json"),
            }),
          "FINAL_PHASE_ARGUMENT_INVALID",
        );
        assert.equal(results.size, 3);
      }
    } finally {
      rmSync(fixture.base, { recursive: true, force: true });
    }
  },
);

test(
  "final live phases expose fixed adapters and reject fixture, input, ordering and nonzero bypasses",
  { skip: process.platform !== "win32" },
  () => {
    const fixture = createCandidate();
    const createRoot = (stamp, marker, port) => {
      const root = resolve(fixture.clone, "external", `mvp15d-final-d13-d16-${stamp}`);
      runFinal("preflight", {
        mode: "create",
        repository: fixture.clone,
        "evidence-root": root,
        "task-id": TASK_ID,
        "source-commit": fixture.commit,
        "ue-root": fixture.goodUeRoot,
        marker,
        port: String(port),
      });
      runFinal("project-create", {
        mode: "create",
        repository: fixture.clone,
        "evidence-root": root,
      });
      return root;
    };
    try {
      const marker = "uagent-mvp15d-final-live-adapter-0005";
      const port = 31416;
      const root = createRoot("20260728_120006", marker, port);
      const livePlans = new Map();
      for (const phase of ["ue-automation", "product-capture", "ui-lifecycle"]) {
        const plan = runFinal(phase, {
          mode: "plan",
          repository: fixture.clone,
          "evidence-root": root,
          "task-id": TASK_ID,
          "source-commit": fixture.commit,
          "ue-root": fixture.goodUeRoot,
          marker,
          port: String(port),
          session: `final-live-${phase}-session-0005`,
          generation: "5",
        });
        assert.equal(plan.plan.liveCommand.executable, process.execPath);
        assert.equal(plan.plan.liveCommand.shell, false);
        assert.equal(
          basename(plan.plan.liveCommand.orderedArguments[0]),
          `mvp15d-final-${phase}-producer.mjs`,
        );
        assert.equal(plan.plan.liveCommand.endpoint, `http://127.0.0.1:${port}/mcp`);
        livePlans.set(phase, plan.plan.liveCommand);
      }
      assert.equal(existsSync(resolve(root, "logs", "product-capture.stdout.log")), false);

      const productPlan = livePlans.get("product-capture");
      const adapterVector = productPlan.orderedArguments.slice(1);
      const binding = validateBinding("product-capture", adapterVector);
      const desktopExecutable = resolve(
        fixture.clone,
        "apps",
        "desktop",
        "src-tauri",
        "target",
        "release",
        "uagent.exe",
      );
      mkdirSync(resolve(desktopExecutable, ".."), { recursive: true });
      writeFileSync(desktopExecutable, Buffer.from("deterministic-desktop-executable-fixture"));
      const productCommand = runtimeCommand(binding);
      assert.equal(productCommand.executable, desktopExecutable);
      assert.deepEqual(productCommand.args.slice(0, 2), ["mvp15d-final-runtime-bridge", "--phase"]);
      assert.equal(productCommand.args.includes("--event-file"), true);
      assert.equal(productCommand.args.includes("--nonce-file"), true);
      assert.equal(productCommand.args.includes("--driver-file"), true);
      const uiCommand = runtimeCommand(
        validateBinding("ui-lifecycle", livePlans.get("ui-lifecycle").orderedArguments.slice(1)),
      );
      assert.equal(uiCommand.executable, desktopExecutable);
      assert.deepEqual(uiCommand.args.slice(-2), [
        "--rendered-product-path",
        "validate,add,confirmTrust,observationDiscover,observationAttach,observationReady,mcpConnect,mcpInitialize,mcpDiscover,mcpNormalize,mcpFingerprint,dryRun,approve,register,execute,verify,crossTtl,rollback,finalVerify,replay,observationStop,mcpDisconnect",
      ]);
      assert.equal(uiCommand.env.UAGENT_ENABLE_ASSET_MUTATION, "1");
      assert.equal(productCommand.env.UAGENT_ENABLE_ASSET_MUTATION, "0");
      const ueExecutable = resolve(
        fixture.goodUeRoot,
        "Engine",
        "Binaries",
        "Win64",
        "UnrealEditor-Cmd.exe",
      );
      writeFileSync(ueExecutable, Buffer.from("deterministic-ue-commandlet-executable-fixture"));
      const ueCommand = runtimeCommand(
        validateBinding("ue-automation", livePlans.get("ue-automation").orderedArguments.slice(1)),
      );
      assert.equal(ueCommand.executable, ueExecutable);
      assert.equal(
        ueCommand.args.includes(
          "-ExecCmds=Automation RunTests UAgentAssetTools.Contracts+UAgentAssetTools.ReadOnly+UAgentAssetTools.Closeout;Quit",
        ),
        true,
      );
      assert.equal(
        ueCommand.args.some((value) => String(value).startsWith("-ReportExportPath=")),
        true,
      );
      for (const prefix of [
        "-UAgentTaskId=",
        "-UAgentTaskGeneration=",
        "-UAgentSourceCommit=",
        "-UAgentTaskMarker=",
        "-UAgentSession=",
        "-UAgentGeneration=",
      ]) {
        assert.equal(
          ueCommand.args.some((value) => String(value).startsWith(prefix)),
          true,
        );
      }
      assert.throws(
        () =>
          validateBinding("product-capture", [...adapterVector, "--executable", process.execPath]),
        (error) =>
          error instanceof LiveProducerError && error.code === "FINAL_LIVE_ARGUMENT_VECTOR_INVALID",
      );
      const reordered = [...adapterVector];
      [reordered[0], reordered[2]] = [reordered[2], reordered[0]];
      assert.throws(
        () => validateBinding("product-capture", reordered),
        (error) =>
          error instanceof LiveProducerError && error.code === "FINAL_LIVE_ARGUMENT_VECTOR_INVALID",
      );

      const runtimeFixture = resolve(fixture.clone, "runtime-origin-fixture.mjs");
      writeFileSync(
        runtimeFixture,
        [
          `console.log(${JSON.stringify(
            JSON.stringify({
              schemaVersion: RUNTIME_EVENT_SCHEMA,
              phase: "product-capture",
              type: "evidence_origin",
              data: { origin: "task_owned_fixture", fixtureUsed: true },
            }),
          )});`,
          `console.log(${JSON.stringify(
            JSON.stringify({
              schemaVersion: RUNTIME_EVENT_SCHEMA,
              phase: "product-capture",
              type: "closeout",
              data: {
                processResidualCount: 0,
                portResidualCount: 0,
                markerResidualCount: 0,
                partialOutputCount: 0,
              },
            }),
          )});`,
          "",
        ].join("\n"),
        "utf8",
      );
      assert.throws(
        () =>
          runProductCaptureProducer(adapterVector, {
            launch: (_command, _args, options) =>
              spawnSync(process.execPath, [runtimeFixture], options),
          }),
        (error) =>
          error instanceof LiveProducerError && error.code === "FINAL_LIVE_FIXTURE_ORIGIN_REJECTED",
      );

      const liveArgs = {
        mode: "live",
        repository: fixture.clone,
        "evidence-root": root,
        "task-id": TASK_ID,
        "source-commit": fixture.commit,
        marker,
        port: String(port),
        session: "final-live-product-capture-session-0005",
        generation: "5",
      };
      let injectedLaunchCalled = false;
      for (const injected of [
        () => {
          injectedLaunchCalled = true;
        },
        { pid: 51_000, status: 0 },
        true,
        "serialized-launch-token",
      ]) {
        expectCode(
          () => executeLivePhase("product-capture", liveArgs, injected),
          "FINAL_PHASE_PRODUCTION_LAUNCH_REQUIRED",
        );
      }
      assert.equal(injectedLaunchCalled, false);
      assert.equal(existsSync(resolve(root, "transcripts", "product-capture.events.jsonl")), false);
      assert.equal(existsSync(resolve(root, "metadata", "product-capture.producer.json")), false);
      assert.equal(existsSync(resolve(root, "summaries", "product-capture.json")), false);

      const bypassRoot = createRoot("20260728_120007", `${marker}-bypass`, port + 1);
      for (const bypass of [
        { input: resolve(bypassRoot, "manual-success.json") },
        { "producer-mode": "direct" },
      ]) {
        expectCode(
          () =>
            executeLivePhase("ui-lifecycle", {
              ...liveArgs,
              ...bypass,
              "evidence-root": bypassRoot,
              marker: `${marker}-bypass`,
              port: String(port + 1),
            }),
          "FINAL_PHASE_ARGUMENT_INVALID",
        );
      }
      expectCode(
        () =>
          executeLivePhase("ui-lifecycle", {
            ...liveArgs,
            "evidence-root": bypassRoot,
            "source-commit": "0".repeat(40),
            marker: `${marker}-bypass`,
            port: String(port + 1),
          }),
        "FINAL_SOURCE_COMMIT_MISMATCH",
      );
      assert.equal(existsSync(resolve(bypassRoot, "summaries", "ui-lifecycle.json")), false);
    } finally {
      rmSync(fixture.base, { recursive: true, force: true });
    }
  },
);

test(
  "final inventory verifies directories, payloads and raw-source links in a new pass",
  { skip: process.platform !== "win32" },
  () => {
    const fixture = createCandidate();
    try {
      const root = resolve(fixture.clone, "external", "mvp15d-final-d13-d16-20260728_120005");
      mkdirSync(resolve(root, "logs"), { recursive: true });
      mkdirSync(resolve(root, "summaries"));
      writeFileSync(resolve(root, "logs", "raw.log"), "retained transcript\n");
      writeFileSync(
        resolve(root, "summaries", "phase.json"),
        `${JSON.stringify(
          {
            status: "fixture_complete",
            sourceArtifacts: [sourceRecord(root, "logs/raw.log")],
          },
          null,
          2,
        )}\n`,
      );
      const created = inventoryCreate({
        repository: fixture.clone,
        "evidence-root": root,
        "task-id": TASK_ID,
      });
      assert.equal(created.status, "inventory_created");
      assert.equal(
        inventoryVerify({
          repository: fixture.clone,
          "evidence-root": root,
          "task-id": TASK_ID,
        }).status,
        "inventory_verified",
      );
      const summaryPath = resolve(root, "summaries", "phase.json");
      const originalSummary = readFileSync(summaryPath, "utf8");
      const mismatchedSummary = JSON.parse(originalSummary);
      mismatchedSummary.sourceArtifacts[0].sha256 = "c".repeat(64);
      writeFileSync(summaryPath, `${JSON.stringify(mismatchedSummary, null, 2)}\n`);
      expectCode(
        () =>
          inventoryVerify({
            repository: fixture.clone,
            "evidence-root": root,
            "task-id": TASK_ID,
          }),
        "FINAL_INVENTORY_SOURCE_LINK_INVALID",
      );
      writeFileSync(summaryPath, originalSummary);
      const transcriptPath = resolve(root, "logs", "raw.log");
      const transcriptBytes = readFileSync(transcriptPath);
      rmSync(transcriptPath);
      expectCode(
        () =>
          inventoryVerify({
            repository: fixture.clone,
            "evidence-root": root,
            "task-id": TASK_ID,
          }),
        "FINAL_INVENTORY_TRANSCRIPT_EMPTY",
      );
      writeFileSync(transcriptPath, transcriptBytes);

      writeFileSync(resolve(root, "logs", "extra.log"), "unexpected\n");
      expectCode(
        () =>
          inventoryVerify({
            repository: fixture.clone,
            "evidence-root": root,
            "task-id": TASK_ID,
          }),
        "FINAL_INVENTORY_RECOMPUTE_MISMATCH",
      );
      rmSync(resolve(root, "logs", "extra.log"));
      mkdirSync(resolve(root, "unknown-root"));
      writeFileSync(resolve(root, "unknown-root", "payload.bin"), "unknown");
      expectCode(
        () =>
          inventoryVerify({
            repository: fixture.clone,
            "evidence-root": root,
            "task-id": TASK_ID,
          }),
        "FINAL_INVENTORY_UNKNOWN_PATH",
      );
      rmSync(resolve(root, "unknown-root"), { recursive: true, force: true });

      const inventoryPath = resolve(root, "inventory.json");
      const originalInventory = readFileSync(inventoryPath, "utf8");
      const collidingInventory = JSON.parse(originalInventory);
      collidingInventory.files.push({
        ...collidingInventory.files[0],
        path: collidingInventory.files[0].path.toUpperCase(),
      });
      collidingInventory.fileCount += 1;
      writeFileSync(inventoryPath, `${JSON.stringify(collidingInventory, null, 2)}\n`);
      expectCode(
        () =>
          inventoryVerify({
            repository: fixture.clone,
            "evidence-root": root,
            "task-id": TASK_ID,
          }),
        "FINAL_INVENTORY_RECOMPUTE_MISMATCH",
      );
      writeFileSync(inventoryPath, originalInventory);

      try {
        symlinkSync(resolve(root, "logs"), resolve(root, "captures"), "junction");
        expectCode(
          () =>
            inventoryVerify({
              repository: fixture.clone,
              "evidence-root": root,
              "task-id": TASK_ID,
            }),
          "FINAL_INVENTORY_LINK_REPARSE",
        );
      } catch (error) {
        if (!["EPERM", "EACCES"].includes(error?.code) && !(error instanceof ToolingError)) {
          throw error;
        }
      }
    } finally {
      rmSync(fixture.base, { recursive: true, force: true });
    }
  },
);
