/* global process, structuredClone */

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import test from "node:test";
import "./mvp15d-final-tooling.test.mjs";
import "./mvp15d-ue581-evidence-inventory.test.mjs";
import {
  D0_COMBINATIONS,
  D0_ADAPTER_ARTIFACT_SCHEMA_VERSION,
  D0_ADAPTER_METAFILE_SCHEMA_VERSION,
  D0_CAPTURE_ORIGIN,
  D0_DIRECT_PROBE_NAME,
  D0_EVIDENCE_SCHEMA_VERSION,
  D0_RAW_TRANSCRIPT_SCHEMA_VERSION,
  D0_ROUTE_DECISION_SCHEMA_VERSION,
  D0_RUNNER_ARTIFACT_SCHEMA_VERSION,
  D0_TASK_ID,
  D0_TOOL_NAMES,
  isD0ExactEmptyInputSchema,
  isD0ExactToolsetEmptyInputSchema,
  sha256Bytes,
  stable,
  validateD0CapturedJsonRpcExchange,
  validateD0DirectInventory,
  validateD0LifecycleGenerationSequence,
  validateD0LifecyclePublicationGeneration,
  validateD0NativeLifecycle,
  validateD0NoOpEvidence,
} from "./mvp15d-d0-spike.mjs";
import { createFreshD0CaptureOutput, indexD0ProductAdapterCapture } from "./mvp15d-d0-capture.mjs";
import { createD0ProductOutput } from "./mvp15d-product-adapter-runner.mjs";
import {
  UE_AUTOMATION_BASELINE_TESTS,
  UE_AUTOMATION_CAPTURE_SCHEMA_VERSION,
  UE_AUTOMATION_COMBINATION_SESSIONS,
  UE_AUTOMATION_EXPECTED_TESTS,
  UE_AUTOMATION_PROCESS_LEDGER_SCHEMA_VERSION,
  UE_AUTOMATION_SESSIONS,
  UE_AUTOMATION_TASK_ID,
  createFreshUeAutomationOutput,
  createUeSessionProcessLedger,
  parseAutomationLog,
  validateExpectedTestMatrix,
  validateTaskOwnedUeAutomationBundle,
  validateUeAutomationCapture,
  validateUeSessionProcessLedger,
} from "./mvp15d-ue-automation.mjs";

const root = process.cwd();
const manifestScript = join(root, "scripts", "mvp15d-manifest.mjs");
const buildScript = join(root, "scripts", "mvp15d-plugin-build.mjs");
const d0Script = join(root, "scripts", "mvp15d-d0-spike.mjs");
const d0CaptureScript = join(root, "scripts", "mvp15d-d0-capture.mjs");
const d0ProductRunnerScript = join(root, "scripts", "mvp15d-product-adapter-runner.mjs");
const automationScript = join(root, "scripts", "mvp15d-ue-automation.mjs");
const windowsJobHelperScript = join(root, "scripts", "mvp15d-windows-job-process-runner.ps1");
const canonicalNativeBindingFixture = join(
  root,
  "packages",
  "shared",
  "test-fixtures",
  "mvp15d-native-binding-v2.json",
);
const unrealNativeBindingResource = join(
  root,
  "integrations",
  "unreal",
  "UAgentAssetTools",
  "Resources",
  "mvp15d-native-binding-v2.json",
);

function runNode(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
}

function expectReason(result, reason) {
  assert.notEqual(result.status, 0, result.stdout);
  const output = JSON.parse(result.stderr.trim());
  assert.equal(typeof output.status, "string");
  assert.equal(output.reason, reason);
}

function uniqueTaskSuffix(label) {
  return `${label}-${Date.now()}-${process.pid}-${randomBytes(4).toString("hex")}`;
}

function expectThrownReason(run, reason) {
  assert.throws(run, (error) => error?.message === reason);
}

function writeD0CaptureFixture(sourceRoot, taskId = D0_TASK_ID) {
  const transcriptsRoot = join(sourceRoot, "transcripts");
  const artifactsRoot = join(sourceRoot, "artifacts");
  const inputsRoot = join(artifactsRoot, "adapter-inputs");
  mkdirSync(transcriptsRoot);
  mkdirSync(artifactsRoot);
  mkdirSync(inputsRoot);
  writeFileSync(
    join(sourceRoot, "adapter.artifact.json"),
    JSON.stringify({
      schemaVersion: D0_ADAPTER_ARTIFACT_SCHEMA_VERSION,
      taskId,
      captureOrigin: D0_CAPTURE_ORIGIN,
      entrypoint: "apps/desktop/web/src/runtime/desktop-runtime-adapter.ts",
      sourceSha256: "a".repeat(64),
      producer: { kind: "test_only" },
      provenance: { source: "caller_authored_fixture" },
      bundle: { path: "artifacts/adapter-bundle.js", size: 1, sha256: "b".repeat(64) },
      metafile: { path: "adapter-bundle.metafile.json", size: 1, sha256: "c".repeat(64) },
      nativeBridge: {
        path: "artifacts/native-bridge.exe",
        profile: "debug",
        size: 1,
        sha256: "d".repeat(64),
      },
      nativeBridgeSource: {
        entrypoint: "apps/desktop/src-tauri/src/bin/mvp15d-native-invoke-bridge.rs",
        path: "artifacts/native-bridge-source.rs",
        size: 1,
        sha256: "e".repeat(64),
      },
    }),
  );
  writeFileSync(join(sourceRoot, "adapter-bundle.metafile.json"), "{}");
  writeFileSync(join(sourceRoot, "runner.artifact.json"), "{}");
  writeFileSync(
    join(sourceRoot, "route-decision.json"),
    JSON.stringify({
      schemaVersion: D0_ROUTE_DECISION_SCHEMA_VERSION,
      taskId,
      selectedRoute: "direct",
      basisTranscriptIndexSha256: "f".repeat(64),
    }),
  );
  writeFileSync(join(artifactsRoot, "adapter-bundle.js"), "x");
  writeFileSync(join(artifactsRoot, "native-bridge.exe"), "x");
  writeFileSync(join(artifactsRoot, "native-bridge-source.rs"), "x");
  writeFileSync(join(inputsRoot, "0000-desktop-runtime-adapter.ts"), "x");
  for (const { id } of D0_COMBINATIONS) writeFileSync(join(transcriptsRoot, `${id}.json`), "{}");
}

function fixtureExecutable(path, role, minimumCount, maximumCount) {
  const normalizedPath = resolve(path).toLowerCase();
  return {
    role,
    executable: basename(path),
    executablePathSha256: sha256Bytes(Buffer.from(normalizedPath, "utf8")),
    executableFileSha256: sha256Bytes(Buffer.from(`fixture:${normalizedPath}`, "utf8")),
    byteLength: 1,
    minimumCount,
    maximumCount,
  };
}

function fixtureRawProcess({
  pid,
  parentPid,
  creation,
  path,
  commandLine,
  firstSequence,
  exitSequence,
}) {
  return {
    Pid: pid,
    ParentPid: parentPid,
    CreationFileTimeUtc: creation,
    ExecutablePath: path,
    CommandLine: commandLine,
    IdentityComplete: true,
    JobMembershipVerified: true,
    JobNewProcessObserved: true,
    FirstObservationSequence: firstSequence,
    FirstObservedAt: `2026-07-25T00:00:0${firstSequence}.000Z`,
    ExitObserved: true,
    ExitSequence: exitSequence,
    ExitedAt: `2026-07-25T00:00:0${exitSequence}.000Z`,
    ExitCode: 0,
    ExitKind: "exit",
  };
}

function fixtureUeJob({ sessionId = "baseline", markerSuffix = "1".repeat(32) } = {}) {
  const marker = `uagent-mvp15d-rework7-ue-${sessionId}-${markerSuffix}`;
  const editorPath = "C:\\fixture\\UnrealEditor-Cmd.exe";
  const crashReportClientPath = "C:\\fixture\\CrashReportClient.exe";
  const conhostPath = "C:\\Windows\\System32\\conhost.exe";
  const validatorShellPath = "C:\\Windows\\System32\\cmd.exe";
  const validatorDotnetPath = "C:\\fixture\\dotnet.exe";
  const expectedExecutables = [
    fixtureExecutable(editorPath, "editor_root", 1, 1),
    fixtureExecutable(crashReportClientPath, "crash_report_client", 1, null),
    fixtureExecutable(conhostPath, "console_host", 0, null),
    fixtureExecutable(validatorShellPath, "platform_validator_shell", 0, null),
    fixtureExecutable(validatorDotnetPath, "platform_validator_dotnet", 0, null),
  ];
  const rawJobResult = {
    SchemaVersion: "uagent.mvp15d.windows-job-process-run.v1",
    TaskMarker: marker,
    JobName: `Local\\UAgentMvp15D-${marker}`,
    Launcher: {
      Pid: 50,
      ParentPid: 49,
      CreationFileTimeUtc: "133977024000000000",
      ExecutablePath: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      CommandLine: `powershell.exe -TaskMarker ${marker}`,
    },
    RootPid: 100,
    RootExitCode: 0,
    ActiveProcessZeroObserved: true,
    ActiveProcessZeroObservedAt: "2026-07-25T00:00:08.000Z",
    TimedOut: false,
    ForcedJobTermination: false,
    ResidualCountBeforeCleanup: 0,
    FinalResidualCount: 0,
    AccountingTotalProcessCount: 3,
    UnexpectedJobMessageCount: 0,
    FailureCode: "",
    Processes: [
      fixtureRawProcess({
        pid: 100,
        parentPid: 50,
        creation: "133977024000000100",
        path: editorPath,
        commandLine: `${editorPath} -UAgentMvp15DTaskMarker=${marker}`,
        firstSequence: 0,
        exitSequence: 4,
      }),
      fixtureRawProcess({
        pid: 200,
        parentPid: 100,
        creation: "133977024000000200",
        path: crashReportClientPath,
        commandLine: `${crashReportClientPath} -abslog=${marker}.log`,
        firstSequence: 1,
        exitSequence: 3,
      }),
      fixtureRawProcess({
        pid: 201,
        parentPid: 200,
        creation: "133977024000000300",
        path: crashReportClientPath,
        commandLine: `${crashReportClientPath} -abslog=${marker}.log`,
        firstSequence: 2,
        exitSequence: 5,
      }),
    ],
  };
  return {
    marker,
    expectedExecutables,
    rawJobResult,
    crashReportClientPids: [200],
  };
}

function fixtureProcessLedger(options = {}) {
  const fixture = fixtureUeJob(options);
  return createUeSessionProcessLedger({
    rawJobResult: fixture.rawJobResult,
    helperExitCode: 0,
    helperSourceSha256: "f".repeat(64),
    sessionId: options.sessionId ?? "baseline",
    taskMarker: fixture.marker,
    expectedExecutables: fixture.expectedExecutables,
    crashReportClientPids: fixture.crashReportClientPids,
    markerResiduals: [],
  });
}

function writeRetainedLog(rootPath, name, text) {
  const bytes = Buffer.from(text, "utf8");
  writeFileSync(join(rootPath, name), bytes);
  return {
    name,
    exists: true,
    sha256: sha256Bytes(bytes),
    byteLength: bytes.length,
  };
}

function writeRetainedUeFixture(outputRoot) {
  const sessions = UE_AUTOMATION_SESSIONS.map((expected, index) => {
    const processLedger = fixtureProcessLedger({
      sessionId: expected.id,
      markerSuffix: (index + 1).toString(16).padStart(32, "0"),
    });
    const completedTests = expected.expectedTests.map((name) => ({ name, result: "Success" }));
    const tests = {
      namedTests: [...expected.expectedTests],
      completedTests,
      crashReportClientPids: [200],
      expectedMatrix: validateExpectedTestMatrix(
        expected.expectedTests,
        completedTests,
        expected.expectedTests,
      ),
      summaryObserved: true,
      failureObserved: false,
    };
    const editor = writeRetainedLog(
      outputRoot,
      `UnrealEditor-Cmd-${expected.id}.log`,
      `editor:${expected.id}`,
    );
    const stdout = writeRetainedLog(
      outputRoot,
      `UnrealEditor-Cmd-${expected.id}.stdout.log`,
      `stdout:${expected.id}`,
    );
    const stderr = writeRetainedLog(
      outputRoot,
      `UnrealEditor-Cmd-${expected.id}.stderr.log`,
      `stderr:${expected.id}`,
    );
    const processLogs = {
      editor,
      stdout,
      stderr,
      crashReportClient: {
        name: `CrashReportClient-${expected.id}-${processLedger.taskMarker}.log`,
        exists: false,
        sha256: null,
        byteLength: 0,
      },
    };
    return {
      id: expected.id,
      route: expected.route,
      toolSearch: expected.toolSearch,
      filter: expected.filter,
      expectedTests: expected.expectedTests,
      processLedger,
      tests,
      log: editor,
      processLogs,
      contentUnchanged: true,
      status: "completed",
      reason: "ue_automation_session_completed",
    };
  });
  const content = { fileCount: 0, aggregateSha256: "a".repeat(64) };
  const report = {
    schemaVersion: UE_AUTOMATION_CAPTURE_SCHEMA_VERSION,
    taskId: UE_AUTOMATION_TASK_ID,
    captureKind: "supporting_ue_automation",
    productAdapterEvidence: "not_produced_by_this_runner",
    filter: "UAgentAssetTools",
    sessions,
    tests: {
      expectedTests: UE_AUTOMATION_EXPECTED_TESTS,
      expectedCount: UE_AUTOMATION_EXPECTED_TESTS.length,
      discoveredCount: UE_AUTOMATION_EXPECTED_TESTS.length,
      complete: true,
    },
    contentBefore: content,
    contentAfter: { ...content },
    contentUnchanged: true,
    processCloseout: {
      sessionCount: UE_AUTOMATION_SESSIONS.length,
      completedSessionCount: UE_AUTOMATION_SESSIONS.length,
      finalResidualCount: 0,
      complete: true,
    },
    portCloseout: "not_applicable_no_network_listener",
    status: "completed",
    reason: "ue_automation_completed",
  };
  writeFileSync(
    join(outputRoot, "automation-capture.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}

test("provenance tooling fails closed before any source or package mutation", () => {
  expectReason(runNode(manifestScript, ["create"]), "MANIFEST_ARGUMENT_REQUIRED");
  expectReason(runNode(manifestScript, ["verify"]), "MANIFEST_ARGUMENT_REQUIRED");
  expectReason(runNode(buildScript, []), "BUILD_ARGUMENT_REQUIRED");
});

test("canonical native binding and Unreal resource are byte-exact with a fixed document SHA", () => {
  const canonicalBytes = readFileSync(canonicalNativeBindingFixture);
  const resourceBytes = readFileSync(unrealNativeBindingResource);
  const canonicalSha256 = sha256Bytes(canonicalBytes);
  const binding = JSON.parse(canonicalBytes.toString("utf8"));

  assert.equal(Buffer.compare(canonicalBytes, resourceBytes), 0);
  assert.equal(canonicalSha256, "771168ec8b6e7215672a4d839fa675d88f9207876e2c51513b26d6c58da56a1b");
  assert.equal(sha256Bytes(resourceBytes), canonicalSha256);
  assert.equal(
    binding.nativeGuardFacts.acceptedPlanBinding,
    "0ba61fe88d86a20cb8ccf4d4296ef10f68cf7bc896c29513e58569b02ab13698",
  );
  assert.notEqual(canonicalSha256, binding.nativeGuardFacts.acceptedPlanBinding);
});

test("D0 validation requires hash-indexed product-boundary evidence and never starts UE", () => {
  assert.deepEqual(D0_TOOL_NAMES, [
    "ue.asset.create_folder",
    "ue.asset.duplicate",
    "ue.asset.rename",
    "ue.asset.move",
    "ue.asset.delete",
    "ue.asset.save",
  ]);
  assert.deepEqual(
    D0_COMBINATIONS.map((combination) => combination.id),
    [
      "direct-tool-search-on",
      "direct-tool-search-off",
      "toolset-registry-tool-search-on",
      "toolset-registry-tool-search-off",
    ],
  );
  expectReason(runNode(d0Script, []), "D0_PRODUCT_RUN_EVIDENCE_REQUIRED");
  expectReason(runNode(d0Script, ["--evidence", "caller-authored.json"]), "D0_ARGUMENT_INVALID");
  expectReason(runNode(d0CaptureScript, []), "D0_CAPTURE_ARGUMENT_REQUIRED");
  expectReason(runNode(d0ProductRunnerScript, []), "D0_PRODUCT_RUNNER_ARGUMENT_REQUIRED");
  const verifierSource = readFileSync(d0Script, "utf8");
  const indexerSource = readFileSync(d0CaptureScript, "utf8");
  const productRunnerSource = readFileSync(d0ProductRunnerScript, "utf8");
  assert.equal(verifierSource.includes("UnrealEditor-Cmd"), false);
  assert.equal(indexerSource.includes("UnrealEditor-Cmd"), false);
  assert.equal(verifierSource.includes("createPublicKey"), false);
  assert.equal(verifierSource.includes("verify as verifySignature"), false);
  assert.match(productRunnerSource, /createDesktopRuntimeAdapter/);
  assert.match(productRunnerSource, /mcp_streamable_http_request/);
  assert.match(productRunnerSource, /UnrealEditor-Cmd\.exe/);
  assert.match(productRunnerSource, /mutationCount:\s*0/);
  expectReason(runNode(automationScript, []), "UE_AUTOMATION_ARGUMENT_REQUIRED");
});

test("D0 indexer rejects a caller-authored test-only bundle before creating output", () => {
  const sourceRoot = mkdtempSync(join(tmpdir(), "UAgent-MVP15D-Rework7-index-source-"));
  const outputRoot = join(tmpdir(), `UAgent-MVP15D-Rework7-index-${Date.now()}-${process.pid}`);
  try {
    writeD0CaptureFixture(sourceRoot);

    assert.throws(
      () => indexD0ProductAdapterCapture({ sessionRoot: sourceRoot, output: outputRoot }),
      (error) => error?.message === "D0_CAPTURE_ADAPTER_ARTIFACT_INVALID",
    );
    assert.equal(existsSync(outputRoot), false);
  } finally {
    rmSync(sourceRoot, { recursive: true, force: true });
    rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("Rework-7 evidence identity and schema versions are exact", () => {
  assert.equal(D0_TASK_ID, "TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-SOURCE-CHECKPOINT-REWORK-7");
  assert.equal(D0_EVIDENCE_SCHEMA_VERSION, "uagent.mvp15d.d0-product-adapter-hash-index.v7");
  assert.equal(D0_RAW_TRANSCRIPT_SCHEMA_VERSION, "uagent.mvp15d.d0-product-adapter-transcript.v7");
  assert.equal(D0_ROUTE_DECISION_SCHEMA_VERSION, "uagent.mvp15d.d0-route-decision.v6");
  assert.equal(D0_ADAPTER_ARTIFACT_SCHEMA_VERSION, "uagent.mvp15d.d0-desktop-adapter-artifact.v7");
  assert.equal(D0_RUNNER_ARTIFACT_SCHEMA_VERSION, "uagent.mvp15d.runner-artifact.v2");
  assert.equal(D0_ADAPTER_METAFILE_SCHEMA_VERSION, "uagent.mvp15d.adapter-metafile.v2");
});

test("Rework-7 evidence output allowlist accepts only fresh direct TEMP and durable external roots", () => {
  const suffix = uniqueTaskSuffix("allowlist");
  const roots = [
    join(tmpdir(), `UAgent-MVP15D-Rework7-product-${suffix}`),
    join(tmpdir(), `UAgent-MVP15D-Rework7-index-${suffix}`),
    join(root, "external", `mvp15d-rework7-d0-${suffix}`),
    join(tmpdir(), `UAgent-MVP15D-Rework7-ue-${suffix}`),
    join(root, "external", `mvp15d-rework7-ue-${suffix}`),
  ];
  try {
    assert.equal(createD0ProductOutput(roots[0]), resolve(roots[0]));
    assert.equal(createFreshD0CaptureOutput(roots[1]), resolve(roots[1]));
    assert.equal(createFreshD0CaptureOutput(roots[2]), resolve(roots[2]));
    assert.equal(createFreshUeAutomationOutput(roots[3]), resolve(roots[3]));
    assert.equal(createFreshUeAutomationOutput(roots[4]), resolve(roots[4]));
    for (const path of roots) assert.equal(existsSync(path), true);
  } finally {
    for (const path of roots) rmSync(path, { recursive: true, force: true });
  }
});

test("Rework-7 evidence outputs reject arbitrary workspace paths and escapes before writing", () => {
  const suffix = uniqueTaskSuffix("escape");
  const arbitraryD0 = join(root, `mvp15d-rework7-d0-${suffix}`);
  const arbitraryProduct = join(root, `UAgent-MVP15D-Rework7-product-${suffix}`);
  const arbitraryUe = join(root, `mvp15d-rework7-ue-${suffix}`);
  const escapedD0 = join(root, "external", "..", `mvp15d-rework7-d0-escaped-${suffix}`);
  const nestedUe = join(root, "external", "nested", `mvp15d-rework7-ue-${suffix}`);
  expectThrownReason(
    () => createFreshD0CaptureOutput(arbitraryD0),
    "D0_CAPTURE_OUTPUT_NOT_TASK_OWNED",
  );
  expectThrownReason(
    () => createD0ProductOutput(arbitraryProduct),
    "D0_PRODUCT_OUTPUT_NOT_TASK_OWNED",
  );
  expectThrownReason(
    () => createFreshUeAutomationOutput(arbitraryUe),
    "UE_AUTOMATION_OUTPUT_NOT_TASK_OWNED",
  );
  expectThrownReason(
    () => createFreshD0CaptureOutput(escapedD0),
    "D0_CAPTURE_OUTPUT_NOT_TASK_OWNED",
  );
  expectThrownReason(
    () => createFreshUeAutomationOutput(nestedUe),
    "UE_AUTOMATION_OUTPUT_NOT_TASK_OWNED",
  );
  for (const path of [arbitraryD0, arbitraryProduct, arbitraryUe, escapedD0, nestedUe])
    assert.equal(existsSync(path), false);
});

test("Rework-7 evidence outputs reject existing destinations and overwrite", () => {
  const suffix = uniqueTaskSuffix("existing");
  const externalOutput = join(root, "external", `mvp15d-rework7-existing-${suffix}`);
  const productOutput = join(tmpdir(), `UAgent-MVP15D-Rework7-existing-${suffix}`);
  const sentinel = "retain-existing-bytes";
  mkdirSync(externalOutput);
  mkdirSync(productOutput);
  writeFileSync(join(externalOutput, "sentinel.txt"), sentinel);
  writeFileSync(join(productOutput, "sentinel.txt"), sentinel);
  try {
    expectThrownReason(
      () => createFreshD0CaptureOutput(externalOutput),
      "D0_CAPTURE_OUTPUT_ALREADY_EXISTS",
    );
    expectThrownReason(
      () => createFreshUeAutomationOutput(externalOutput),
      "UE_AUTOMATION_OUTPUT_ALREADY_EXISTS",
    );
    expectThrownReason(
      () => createD0ProductOutput(productOutput),
      "D0_PRODUCT_OUTPUT_ALREADY_EXISTS",
    );
    assert.equal(readFileSync(join(externalOutput, "sentinel.txt"), "utf8"), sentinel);
    assert.equal(readFileSync(join(productOutput, "sentinel.txt"), "utf8"), sentinel);
  } finally {
    rmSync(externalOutput, { recursive: true, force: true });
    rmSync(productOutput, { recursive: true, force: true });
  }
});

test("Rework-7 evidence outputs reject symlink or reparse destinations", () => {
  const suffix = uniqueTaskSuffix("reparse");
  const target = mkdtempSync(join(tmpdir(), "uagent-mvp15d-rework7-link-target-"));
  const externalLink = join(root, "external", `mvp15d-rework7-link-${suffix}`);
  const temporaryLink = join(tmpdir(), `UAgent-MVP15D-Rework7-link-${suffix}`);
  try {
    writeFileSync(join(target, "sentinel.txt"), "target-unchanged");
    symlinkSync(target, externalLink, process.platform === "win32" ? "junction" : "dir");
    symlinkSync(target, temporaryLink, process.platform === "win32" ? "junction" : "dir");
    expectThrownReason(
      () => createFreshD0CaptureOutput(externalLink),
      "D0_CAPTURE_OUTPUT_ALREADY_EXISTS",
    );
    expectThrownReason(
      () => createFreshUeAutomationOutput(externalLink),
      "UE_AUTOMATION_OUTPUT_ALREADY_EXISTS",
    );
    expectThrownReason(
      () => createD0ProductOutput(temporaryLink),
      "D0_PRODUCT_OUTPUT_ALREADY_EXISTS",
    );
    assert.equal(readFileSync(join(target, "sentinel.txt"), "utf8"), "target-unchanged");
  } finally {
    rmSync(externalLink, { recursive: true, force: true });
    rmSync(temporaryLink, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});

test("D0 indexer rejects a Rework-6 task mismatch before creating durable output", () => {
  const sourceRoot = mkdtempSync(join(tmpdir(), "UAgent-MVP15D-Rework7-d0-task-mismatch-source-"));
  const outputRoot = join(
    root,
    "external",
    `mvp15d-rework7-d0-task-mismatch-${uniqueTaskSuffix("fixture")}`,
  );
  try {
    writeD0CaptureFixture(
      sourceRoot,
      "TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-SOURCE-CHECKPOINT-REWORK-6",
    );
    expectThrownReason(
      () => indexD0ProductAdapterCapture({ sessionRoot: sourceRoot, output: outputRoot }),
      "D0_CAPTURE_ADAPTER_ARTIFACT_INVALID",
    );
    assert.equal(existsSync(outputRoot), false);
  } finally {
    rmSync(sourceRoot, { recursive: true, force: true });
    rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("D0 indexer rejects arbitrary and escaping source roots before creating output", () => {
  const arbitrarySource = mkdtempSync(join(tmpdir(), "uagent-d0-arbitrary-source-"));
  const outputRoot = join(
    root,
    "external",
    `mvp15d-rework7-d0-source-boundary-${uniqueTaskSuffix("arbitrary")}`,
  );
  try {
    writeD0CaptureFixture(arbitrarySource);
    expectThrownReason(
      () => indexD0ProductAdapterCapture({ sessionRoot: arbitrarySource, output: outputRoot }),
      "D0_CAPTURE_SESSION_ROOT_NOT_TASK_OWNED",
    );
    expectThrownReason(
      () =>
        indexD0ProductAdapterCapture({
          sessionRoot: join(root, "external", ".."),
          output: outputRoot,
        }),
      "D0_CAPTURE_SESSION_ROOT_NOT_TASK_OWNED",
    );
    assert.equal(existsSync(outputRoot), false);
  } finally {
    rmSync(arbitrarySource, { recursive: true, force: true });
    rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("D0 indexer rejects a symlink or reparse source root before creating output", () => {
  const suffix = uniqueTaskSuffix("source-link");
  const target = mkdtempSync(join(tmpdir(), "uagent-d0-source-link-target-"));
  const sourceLink = join(tmpdir(), `UAgent-MVP15D-Rework7-source-link-${suffix}`);
  const outputRoot = join(root, "external", `mvp15d-rework7-d0-source-link-${suffix}`);
  try {
    writeD0CaptureFixture(target);
    symlinkSync(target, sourceLink, process.platform === "win32" ? "junction" : "dir");
    expectThrownReason(
      () => indexD0ProductAdapterCapture({ sessionRoot: sourceLink, output: outputRoot }),
      "D0_CAPTURE_SESSION_ROOT_INVALID",
    );
    assert.equal(existsSync(outputRoot), false);
  } finally {
    rmSync(sourceLink, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
    rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("D0 format validators accept only complete JSON-RPC exchanges and exact schemas", () => {
  const request = {
    jsonrpc: "2.0",
    id: "init-17",
    method: "initialize",
    params: { protocolVersion: "2025-06-18" },
  };
  const response = {
    jsonrpc: "2.0",
    id: "init-17",
    result: { protocolVersion: "2025-06-18" },
  };
  const exchange = {
    request,
    requestSha256: sha256Bytes(stable(request)),
    response,
    responseSha256: sha256Bytes(stable(response)),
  };
  assert.equal(validateD0CapturedJsonRpcExchange(exchange, "initialize"), true);
  const ambiguous = structuredClone(exchange);
  ambiguous.response.error = { code: -32603, message: "failure" };
  ambiguous.responseSha256 = sha256Bytes(stable(ambiguous.response));
  assert.throws(() => validateD0CapturedJsonRpcExchange(ambiguous, "initialize"));
  assert.equal(
    isD0ExactEmptyInputSchema({
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    }),
    true,
  );
  assert.equal(isD0ExactEmptyInputSchema({ type: "object", properties: {} }), false);
  assert.equal(isD0ExactToolsetEmptyInputSchema({ type: "object" }), true);
  assert.equal(
    isD0ExactToolsetEmptyInputSchema({ type: "object", additionalProperties: true }),
    false,
  );
});

test("D0 no-op, inventory, lifecycle generation, and native ledger formats reject collisions", () => {
  const request = {
    jsonrpc: "2.0",
    id: "call-31",
    method: "tools/call",
    params: { name: D0_DIRECT_PROBE_NAME, arguments: {} },
  };
  const response = {
    jsonrpc: "2.0",
    id: "call-31",
    result: {
      status: "noop",
      route: "direct",
      toolSearchEnabled: true,
      registrationGeneration: 7,
      mutationCount: 0,
    },
  };
  const noOp = {
    request,
    requestSha256: sha256Bytes(stable(request)),
    response,
    responseSha256: sha256Bytes(stable(response)),
    mutationCount: 0,
  };
  assert.equal(validateD0NoOpEvidence(noOp, { route: "direct", toolSearch: true }), true);
  const extraParams = structuredClone(noOp);
  extraParams.request.params.toolset_name = "collision";
  extraParams.requestSha256 = sha256Bytes(stable(extraParams.request));
  assert.throws(() => validateD0NoOpEvidence(extraParams, { route: "direct", toolSearch: true }));
  const toolsetRequest = {
    jsonrpc: "2.0",
    id: "call-32",
    method: "tools/call",
    params: {
      name: "call_tool",
      arguments: {
        toolset_name: "UAgentAssetTools.UAgentAssetToolsD0Toolset",
        tool_name: "Probe",
        arguments: {},
      },
    },
  };
  const toolsetResponse = {
    jsonrpc: "2.0",
    id: "call-32",
    result: {
      status: "noop",
      route: "toolset_registry",
      toolSearchEnabled: true,
      registrationGeneration: 8,
      mutationCount: 0,
    },
  };
  const toolsetNoOp = {
    request: toolsetRequest,
    requestSha256: sha256Bytes(stable(toolsetRequest)),
    response: toolsetResponse,
    responseSha256: sha256Bytes(stable(toolsetResponse)),
    mutationCount: 0,
  };
  assert.equal(
    validateD0NoOpEvidence(toolsetNoOp, { route: "toolset_registry", toolSearch: true }),
    true,
  );
  const toolsetCollision = structuredClone(toolsetNoOp);
  toolsetCollision.request.params.arguments.extra = true;
  toolsetCollision.requestSha256 = sha256Bytes(stable(toolsetCollision.request));
  assert.throws(() =>
    validateD0NoOpEvidence(toolsetCollision, { route: "toolset_registry", toolSearch: true }),
  );
  assert.equal(validateD0DirectInventory([D0_DIRECT_PROBE_NAME]), true);
  assert.equal(
    validateD0DirectInventory([
      D0_DIRECT_PROBE_NAME,
      "list_toolsets",
      "describe_toolset",
      "call_tool",
    ]),
    true,
  );
  assert.throws(() =>
    validateD0DirectInventory([
      D0_DIRECT_PROBE_NAME,
      "UAgentAssetTools.UAgentAssetToolsD0Toolset.Probe",
    ]),
  );
  assert.equal(
    validateD0LifecycleGenerationSequence({
      refresh: { beforeGeneration: 1, afterGeneration: 2 },
      reconnect: { beforeGeneration: 3, afterGeneration: 4 },
      retractionRecovery: {
        beforeGeneration: 5,
        connectionGeneration: 6,
        afterGeneration: 7,
      },
      rendererReconstruction: {
        priorDiscoveryGeneration: 7,
        connectionGeneration: 8,
        discoveryGeneration: 9,
      },
      editorRestart: { beforeGeneration: 9, afterGeneration: 11 },
    }),
    true,
  );
  assert.throws(() =>
    validateD0LifecycleGenerationSequence({
      refresh: { beforeGeneration: 1, afterGeneration: 2 },
      reconnect: { beforeGeneration: 3, afterGeneration: 4 },
      retractionRecovery: {
        beforeGeneration: 5,
        connectionGeneration: 6,
        afterGeneration: 7,
      },
      rendererReconstruction: {
        priorDiscoveryGeneration: 6,
        connectionGeneration: 8,
        discoveryGeneration: 9,
      },
      editorRestart: { beforeGeneration: 9, afterGeneration: 11 },
    }),
  );
  assert.throws(() =>
    validateD0LifecycleGenerationSequence({
      refresh: { beforeGeneration: 1, afterGeneration: 2 },
      reconnect: { beforeGeneration: 3, afterGeneration: 4 },
      retractionRecovery: {
        beforeGeneration: 5,
        connectionGeneration: 6,
        afterGeneration: 7,
      },
      rendererReconstruction: {
        priorDiscoveryGeneration: 7,
        connectionGeneration: 7,
        discoveryGeneration: 8,
      },
      editorRestart: { beforeGeneration: 8, afterGeneration: 10 },
    }),
  );
  assert.equal(
    validateD0LifecyclePublicationGeneration({ adapterGeneration: { discoveryGeneration: 7 } }, 7),
    true,
  );
  assert.throws(() =>
    validateD0LifecyclePublicationGeneration({ adapterGeneration: { discoveryGeneration: 6 } }, 7),
  );

  const nativeCommand = (command, status, requestId, attestationGeneration, retraction = null) => ({
    command,
    status,
    requestId,
    responseRequestId: requestId,
    requestSha256: sha256Bytes(`request:${requestId}`),
    responseSha256: sha256Bytes(`response:${requestId}`),
    bridgeProcessIdentityHash: "a".repeat(64),
    attestationGeneration,
    applied: retraction?.applied ?? null,
    requestedAttestationGeneration: retraction?.requestedAttestationGeneration ?? null,
    minimumAttestationGeneration: retraction?.minimumAttestationGeneration ?? null,
    nativeGeneration: retraction?.nativeGeneration ?? null,
    revokedApprovalCount: retraction?.revokedApprovalCount ?? null,
  });
  const nativeLifecycle = {
    bridgeProcessIdentityHash: "a".repeat(64),
    commands: [
      nativeCommand("trust_native_project_root", "trusted", 1, null),
      nativeCommand("discover_editor_processes", "ready", 2, null),
      nativeCommand("attach_editor_process", "attached", 3, null),
      nativeCommand("attest_mvp15_companion", "observed", 4, 10),
      nativeCommand("retract_mvp15_companion_approvals", "stale", 5, 1, {
        applied: false,
        requestedAttestationGeneration: 1,
        minimumAttestationGeneration: 10,
        nativeGeneration: 4,
        revokedApprovalCount: 0,
      }),
      nativeCommand("retract_mvp15_companion_approvals", "retracted", 6, 11, {
        applied: true,
        requestedAttestationGeneration: 11,
        minimumAttestationGeneration: 11,
        nativeGeneration: 5,
        revokedApprovalCount: 0,
      }),
      nativeCommand("discover_editor_processes", "ready", 7, null),
      nativeCommand("attach_editor_process", "attached", 8, null),
      nativeCommand("attest_mvp15_companion", "observed", 9, 12),
      nativeCommand("retract_mvp15_companion_approvals", "retracted", 10, 13, {
        applied: true,
        requestedAttestationGeneration: 13,
        minimumAttestationGeneration: 13,
        nativeGeneration: 7,
        revokedApprovalCount: 0,
      }),
    ],
  };
  assert.equal(validateD0NativeLifecycle(nativeLifecycle), true);
  const mismatchedIdentity = structuredClone(nativeLifecycle);
  mismatchedIdentity.commands[3].bridgeProcessIdentityHash = "b".repeat(64);
  assert.throws(() => validateD0NativeLifecycle(mismatchedIdentity));
  const staleApplied = structuredClone(nativeLifecycle);
  staleApplied.commands[4].applied = true;
  assert.throws(() => validateD0NativeLifecycle(staleApplied));
});

test("supporting UE Automation has a Rework-7 exact named matrix", () => {
  assert.equal(
    UE_AUTOMATION_TASK_ID,
    "TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-SOURCE-CHECKPOINT-REWORK-7",
  );
  assert.equal(
    UE_AUTOMATION_CAPTURE_SCHEMA_VERSION,
    "uagent.mvp15d.rework7.supporting-ue-automation-capture.v3",
  );
  assert.equal(
    UE_AUTOMATION_PROCESS_LEDGER_SCHEMA_VERSION,
    "uagent.mvp15d.rework7.ue-session-process-ledger.v2",
  );
  assert.deepEqual(UE_AUTOMATION_EXPECTED_TESTS, [
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
    "UAgentMvp15D0Matrix.DirectToolSearchOn",
    "UAgentMvp15D0Matrix.DirectToolSearchOff",
    "UAgentMvp15D0Matrix.ToolsetRegistryToolSearchOn",
    "UAgentMvp15D0Matrix.ToolsetRegistryToolSearchOff",
  ]);
  assert.equal(UE_AUTOMATION_BASELINE_TESTS.length, 44);
  assert.equal(UE_AUTOMATION_EXPECTED_TESTS.length, 48);
  assert.deepEqual(
    UE_AUTOMATION_COMBINATION_SESSIONS.map(({ id, route, toolSearch, expectedTests }) => ({
      id,
      route,
      toolSearch,
      expectedTests,
    })),
    [
      {
        id: "direct-tool-search-on",
        route: "direct",
        toolSearch: "on",
        expectedTests: ["UAgentMvp15D0Matrix.DirectToolSearchOn"],
      },
      {
        id: "direct-tool-search-off",
        route: "direct",
        toolSearch: "off",
        expectedTests: ["UAgentMvp15D0Matrix.DirectToolSearchOff"],
      },
      {
        id: "toolset-registry-tool-search-on",
        route: "toolset_registry",
        toolSearch: "on",
        expectedTests: ["UAgentMvp15D0Matrix.ToolsetRegistryToolSearchOn"],
      },
      {
        id: "toolset-registry-tool-search-off",
        route: "toolset_registry",
        toolSearch: "off",
        expectedTests: ["UAgentMvp15D0Matrix.ToolsetRegistryToolSearchOff"],
      },
    ],
  );
  assert.deepEqual(
    UE_AUTOMATION_SESSIONS.map((session) => session.id),
    [
      "baseline",
      "direct-tool-search-on",
      "direct-tool-search-off",
      "toolset-registry-tool-search-on",
      "toolset-registry-tool-search-off",
    ],
  );

  const allPassedLog = [
    ...UE_AUTOMATION_EXPECTED_TESTS.map(
      (name) =>
        `LogAutomationController: Display: Test Completed. Result={Success} Name={${name}} Path={${name}}`,
    ),
    "Automation Test Queue Empty",
  ].join("\n");
  const passed = parseAutomationLog(allPassedLog);
  assert.equal(passed.summaryObserved, true);
  assert.equal(passed.expectedMatrix.complete, true);
  assert.equal(passed.failureObserved, false);

  const missingOne = parseAutomationLog(
    allPassedLog.replace(
      `Path={${UE_AUTOMATION_EXPECTED_TESTS.at(-1)}}`,
      "Path={Other.Namespace.Test}",
    ),
  );
  assert.equal(missingOne.expectedMatrix.complete, false);
  assert.deepEqual(missingOne.expectedMatrix.missingFromCompletion, [
    UE_AUTOMATION_EXPECTED_TESTS.at(-1),
  ]);

  const routeSession = UE_AUTOMATION_COMBINATION_SESSIONS[0];
  const routeLog = [
    `LogAutomationController: Display: Test Completed. Result={Success} Name={${routeSession.expectedTests[0]}} Path={${routeSession.expectedTests[0]}}`,
    "Automation Test Queue Empty",
  ].join("\n");
  assert.equal(
    parseAutomationLog(routeLog, routeSession.expectedTests).expectedMatrix.complete,
    true,
  );

  const contractSource = readFileSync(
    join(
      root,
      "integrations",
      "unreal",
      "UAgentAssetTools",
      "Source",
      "UAgentAssetTools",
      "Private",
      "UAgentAssetToolsContract.cpp",
    ),
    "utf8",
  );
  const staticSchema = JSON.parse(
    readFileSync(
      join(
        root,
        "integrations",
        "unreal",
        "UAgentAssetTools",
        "Resources",
        "uagent-asset-tools.schema.json",
      ),
      "utf8",
    ),
  );
  const inputSchema = staticSchema.$defs.input;
  assert.match(contractSource, /accepted_plan_binding_required/);
  assert.match(contractSource, /NativeCallFactFields/);
  assert.match(contractSource, /native_call_facts_forbidden_in_dry_run/);
  assert.equal(inputSchema.properties.acceptedPlanBinding.pattern, "^[0-9a-f]{64}$");
  const nativeCallFactFields = [
    "acceptedPlanBinding",
    "nativeRegistrationId",
    "nativePhase",
    "nativeOperationIndex",
    "nativeOperationCount",
    "nativeCreatedAt",
    "connectionGeneration",
    "sessionGeneration",
    "nativeSourceIdentity",
    "nativeManifestIdentity",
    "nativePluginIdentity",
    "nativePackageIdentity",
  ];
  assert.ok(
    inputSchema.allOf.some((condition) =>
      nativeCallFactFields.every((field) => condition.then?.required?.includes(field)),
    ),
  );
  for (const field of nativeCallFactFields) {
    assert.ok(inputSchema.properties[field]);
  }
});

test("UE session process ledger preserves parent identity after parent exit", () => {
  const ledger = fixtureProcessLedger();
  assert.equal(ledger.status, "completed");
  assert.equal(validateUeSessionProcessLedger(ledger), true);
  const rootProcess = ledger.processes.find(({ role }) => role === "editor_root");
  const finalCrashReportClient = ledger.processes.find(({ pid }) => pid === 201);
  assert.ok(rootProcess);
  assert.ok(finalCrashReportClient);
  assert.ok(rootProcess.exit.sequence < finalCrashReportClient.exit.sequence);
  assert.equal(
    finalCrashReportClient.parentIdentitySha256,
    ledger.processes.find(({ pid }) => pid === 200).identitySha256,
  );
  assert.equal(ledger.closeout.finalResidualCount, 0);
  assert.equal(ledger.closeout.markerResidualCount, 0);
});

test("UE session process ledger fails closed on missing lifecycle events and residues", () => {
  const missing = fixtureUeJob();
  missing.rawJobResult.Processes = missing.rawJobResult.Processes.filter(
    ({ ExecutablePath }) => !/CrashReportClient\.exe$/i.test(ExecutablePath),
  );
  const missingLedger = createUeSessionProcessLedger({
    rawJobResult: missing.rawJobResult,
    helperExitCode: 0,
    helperSourceSha256: "f".repeat(64),
    sessionId: "baseline",
    taskMarker: missing.marker,
    expectedExecutables: missing.expectedExecutables,
    crashReportClientPids: missing.crashReportClientPids,
    markerResiduals: [],
  });
  assert.equal(missingLedger.status, "failed");
  assert.equal(missingLedger.reason, "UE_AUTOMATION_PROCESS_EVENT_ACCOUNTING_MISMATCH");
  assert.equal(missingLedger.closeout.recordedProcessCount, 1);
  assert.equal(missingLedger.closeout.accountingTotalProcessCount, 3);
  assert.equal(missingLedger.closeout.accountingProcessCountMatches, false);
  assert.throws(() => validateUeSessionProcessLedger(missingLedger));

  const residual = fixtureUeJob();
  residual.rawJobResult.FinalResidualCount = 1;
  const residualLedger = createUeSessionProcessLedger({
    rawJobResult: residual.rawJobResult,
    helperExitCode: 0,
    helperSourceSha256: "f".repeat(64),
    sessionId: "baseline",
    taskMarker: residual.marker,
    expectedExecutables: residual.expectedExecutables,
    crashReportClientPids: residual.crashReportClientPids,
    markerResiduals: [{ pid: 900, identitySha256: "e".repeat(64) }],
  });
  assert.equal(residualLedger.status, "failed");
  assert.equal(residualLedger.reason, "UE_AUTOMATION_PROCESS_RESIDUAL");
  assert.throws(() => validateUeSessionProcessLedger(residualLedger));
});

test("UE session process ledger rejects marker mismatch and executable spoofing", () => {
  const markerMismatch = fixtureUeJob();
  markerMismatch.rawJobResult.Processes[0].CommandLine =
    "C:\\fixture\\UnrealEditor-Cmd.exe -unattended";
  const markerMismatchLedger = createUeSessionProcessLedger({
    rawJobResult: markerMismatch.rawJobResult,
    helperExitCode: 0,
    helperSourceSha256: "f".repeat(64),
    sessionId: "baseline",
    taskMarker: markerMismatch.marker,
    expectedExecutables: markerMismatch.expectedExecutables,
    crashReportClientPids: markerMismatch.crashReportClientPids,
    markerResiduals: [],
  });
  assert.equal(markerMismatchLedger.status, "failed");
  assert.equal(markerMismatchLedger.reason, "UE_AUTOMATION_PROCESS_MARKER_MISMATCH");
  assert.throws(() => validateUeSessionProcessLedger(markerMismatchLedger));

  const spoofed = fixtureUeJob();
  spoofed.rawJobResult.Processes[1].ExecutablePath = "C:\\foreign\\CrashReportClient.exe";
  const spoofedLedger = createUeSessionProcessLedger({
    rawJobResult: spoofed.rawJobResult,
    helperExitCode: 0,
    helperSourceSha256: "f".repeat(64),
    sessionId: "baseline",
    taskMarker: spoofed.marker,
    expectedExecutables: spoofed.expectedExecutables,
    crashReportClientPids: spoofed.crashReportClientPids,
    markerResiduals: [],
  });
  assert.equal(spoofedLedger.status, "failed");
  assert.equal(spoofedLedger.reason, "UE_AUTOMATION_PROCESS_EXECUTABLE_UNEXPECTED");
  assert.throws(() => validateUeSessionProcessLedger(spoofedLedger));

  const wrongJobMarker = fixtureUeJob();
  wrongJobMarker.rawJobResult.JobName += "-collision";
  assert.throws(() =>
    createUeSessionProcessLedger({
      rawJobResult: wrongJobMarker.rawJobResult,
      helperExitCode: 0,
      helperSourceSha256: "f".repeat(64),
      sessionId: "baseline",
      taskMarker: wrongJobMarker.marker,
      expectedExecutables: wrongJobMarker.expectedExecutables,
      crashReportClientPids: wrongJobMarker.crashReportClientPids,
      markerResiduals: [],
    }),
  );
});

test("UE session process ledger rejects stale PID overlap and unknown descendants", () => {
  const stalePid = fixtureProcessLedger();
  const intermediate = stalePid.processes.find(({ pid }) => pid === 200);
  const finalCrashReportClient = stalePid.processes.find(({ pid }) => pid === 201);
  finalCrashReportClient.pid = intermediate.pid;
  finalCrashReportClient.parentPid = stalePid.root.pid;
  finalCrashReportClient.parentIdentitySha256 = stalePid.root.identitySha256;
  finalCrashReportClient.identitySha256 = sha256Bytes(
    Buffer.from(
      stable({
        pid: finalCrashReportClient.pid,
        parentPid: finalCrashReportClient.parentPid,
        creationFileTimeUtc: finalCrashReportClient.creationFileTimeUtc,
        executablePathSha256: finalCrashReportClient.executablePathSha256,
        commandLineSha256: finalCrashReportClient.commandLineSha256,
      }),
      "utf8",
    ),
  );
  assert.throws(
    () => validateUeSessionProcessLedger(stalePid),
    (error) => error?.message === "UE_AUTOMATION_PROCESS_PID_REUSE_OVERLAP",
  );

  const unknown = fixtureUeJob();
  unknown.rawJobResult.Processes[0].ExitSequence = 6;
  unknown.rawJobResult.Processes[0].ExitedAt = "2026-07-25T00:00:06.000Z";
  unknown.rawJobResult.Processes[1].ExitSequence = 4;
  unknown.rawJobResult.Processes[1].ExitedAt = "2026-07-25T00:00:04.000Z";
  unknown.rawJobResult.Processes[2].ExitSequence = 7;
  unknown.rawJobResult.Processes[2].ExitedAt = "2026-07-25T00:00:07.000Z";
  unknown.rawJobResult.Processes.push(
    fixtureRawProcess({
      pid: 300,
      parentPid: 100,
      creation: "133977024000000400",
      path: "C:\\fixture\\unexpected-child.exe",
      commandLine: `unexpected-child.exe ${unknown.marker}`,
      firstSequence: 3,
      exitSequence: 5,
    }),
  );
  unknown.rawJobResult.AccountingTotalProcessCount = 4;
  const unknownLedger = createUeSessionProcessLedger({
    rawJobResult: unknown.rawJobResult,
    helperExitCode: 0,
    helperSourceSha256: "f".repeat(64),
    sessionId: "baseline",
    taskMarker: unknown.marker,
    expectedExecutables: unknown.expectedExecutables,
    crashReportClientPids: unknown.crashReportClientPids,
    markerResiduals: [],
  });
  assert.equal(unknownLedger.status, "failed");
  assert.equal(unknownLedger.reason, "UE_AUTOMATION_PROCESS_EXECUTABLE_UNEXPECTED");
  assert.throws(() => validateUeSessionProcessLedger(unknownLedger));
});

test("completed UE capture validator requires five unique session ledgers", () => {
  const sessions = UE_AUTOMATION_SESSIONS.map((session, index) => ({
    id: session.id,
    status: "completed",
    processLedger: fixtureProcessLedger({
      sessionId: session.id,
      markerSuffix: (index + 1).toString(16).padStart(32, "0"),
    }),
  }));
  const capture = {
    schemaVersion: UE_AUTOMATION_CAPTURE_SCHEMA_VERSION,
    taskId: UE_AUTOMATION_TASK_ID,
    captureKind: "supporting_ue_automation",
    status: "completed",
    sessions,
    processCloseout: {
      sessionCount: 5,
      completedSessionCount: 5,
      finalResidualCount: 0,
      complete: true,
    },
  };
  assert.equal(validateUeAutomationCapture(capture), true);
  const missingLedger = structuredClone(capture);
  delete missingLedger.sessions[2].processLedger;
  assert.throws(() => validateUeAutomationCapture(missingLedger));
});

test("retained Rework-7 UE bundle validates in place and recomputes logs, matrix, and Content", () => {
  const suffix = uniqueTaskSuffix("ue-retained");
  const validRoot = join(root, "external", `mvp15d-rework7-ue-valid-${suffix}`);
  const logTamperRoot = join(root, "external", `mvp15d-rework7-ue-log-tamper-${suffix}`);
  const contentTamperRoot = join(root, "external", `mvp15d-rework7-ue-content-tamper-${suffix}`);
  const taskMismatchRoot = join(root, "external", `mvp15d-rework7-ue-task-mismatch-${suffix}`);
  const roots = [validRoot, logTamperRoot, contentTamperRoot, taskMismatchRoot];
  try {
    for (const outputRoot of roots) {
      createFreshUeAutomationOutput(outputRoot);
      writeRetainedUeFixture(outputRoot);
    }
    const validated = validateTaskOwnedUeAutomationBundle({ taskRoot: validRoot });
    assert.equal(validated.taskId, UE_AUTOMATION_TASK_ID);
    assert.equal(validated.sessionCount, UE_AUTOMATION_SESSIONS.length);
    assert.equal(validated.testCount, UE_AUTOMATION_EXPECTED_TESTS.length);
    assert.match(validated.captureSha256, /^[0-9a-f]{64}$/);
    const cli = runNode(automationScript, ["--task-root", validRoot]);
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).taskId, UE_AUTOMATION_TASK_ID);

    writeFileSync(join(logTamperRoot, "UnrealEditor-Cmd-baseline.stdout.log"), "tampered");
    expectThrownReason(
      () => validateTaskOwnedUeAutomationBundle({ taskRoot: logTamperRoot }),
      "UE_AUTOMATION_RETAINED_LOG_INVALID",
    );

    const contentReportPath = join(contentTamperRoot, "automation-capture.json");
    const contentReport = JSON.parse(readFileSync(contentReportPath, "utf8"));
    contentReport.contentAfter.fileCount += 1;
    writeFileSync(contentReportPath, `${JSON.stringify(contentReport, null, 2)}\n`);
    expectThrownReason(
      () => validateTaskOwnedUeAutomationBundle({ taskRoot: contentTamperRoot }),
      "UE_AUTOMATION_RETAINED_CONTENT_INVALID",
    );

    const taskReportPath = join(taskMismatchRoot, "automation-capture.json");
    const taskReport = JSON.parse(readFileSync(taskReportPath, "utf8"));
    taskReport.taskId = "TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-SOURCE-CHECKPOINT-REWORK-6";
    writeFileSync(taskReportPath, `${JSON.stringify(taskReport, null, 2)}\n`);
    expectThrownReason(
      () => validateTaskOwnedUeAutomationBundle({ taskRoot: taskMismatchRoot }),
      "UE_AUTOMATION_CAPTURE_INVALID",
    );
  } finally {
    for (const outputRoot of roots) rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("Windows Job helper excludes active-zero sessions from timeout closeout", () => {
  const helperSource = readFileSync(windowsJobHelperScript, "utf8");
  assert.match(
    helperSource,
    /if \(!result\.TimedOut\s*&&\s*!result\.ActiveProcessZeroObserved\s*&&\s*elapsed\.ElapsedMilliseconds >= timeoutMilliseconds\)/,
  );
  assert.match(helperSource, /AccountingTotalProcessCount = TotalProcessCount\(job\)/);
});

test(
  "Windows Job helper observes a detached child after its parent exits",
  { skip: process.platform !== "win32" },
  () => {
    const testRoot = mkdtempSync(join(tmpdir(), "UAgent-MVP15D-Rework7-job-helper-test-"));
    const stdoutPath = join(testRoot, "root.stdout.log");
    const stderrPath = join(testRoot, "root.stderr.log");
    const identityPath = join(testRoot, "metadata", "early-identity.json");
    mkdirSync(resolve(identityPath, ".."), { recursive: true });
    const marker = `uagent-mvp15d-rework7-helper-${randomBytes(16).toString("hex")}`;
    const childScript = "setTimeout(() => process.exit(0), 1500)";
    const parentScript = [
      'const { spawn } = require("node:child_process");',
      `const child = spawn(process.execPath, ["-e", ${JSON.stringify(childScript)}, ${JSON.stringify(marker)}], { detached: true, stdio: "ignore" });`,
      "child.unref();",
    ].join("");
    const argumentsBase64 = Buffer.from(
      JSON.stringify(["-e", parentScript, marker]),
      "utf8",
    ).toString("base64");
    try {
      const result = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          windowsJobHelperScript,
          "-Executable",
          process.execPath,
          "-WorkingDirectory",
          root,
          "-ArgumentsBase64",
          argumentsBase64,
          "-StdoutPath",
          stdoutPath,
          "-StderrPath",
          stderrPath,
          "-TaskMarker",
          marker,
          "-IdentityPath",
          identityPath,
          "-Session",
          `uagent-mvp15d-rework7-helper-${randomBytes(8).toString("hex")}`,
          "-Generation",
          "1",
          "-TimeoutMilliseconds",
          "10000",
        ],
        {
          cwd: root,
          encoding: "utf8",
          shell: false,
          windowsHide: true,
          maxBuffer: 4 * 1024 * 1024,
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const raw = JSON.parse(result.stdout.trim());
      const nodePath = resolve(process.execPath).toLowerCase();
      const nodeProcesses = raw.Processes.filter(
        ({ ExecutablePath }) => resolve(ExecutablePath).toLowerCase() === nodePath,
      );
      const rootProcess = nodeProcesses.find(({ Pid }) => Pid === raw.RootPid);
      const detachedChild = nodeProcesses.find(({ ParentPid }) => ParentPid === raw.RootPid);
      assert.ok(rootProcess);
      assert.ok(detachedChild);
      assert.ok(rootProcess.ExitSequence < detachedChild.ExitSequence);
      assert.equal(raw.ActiveProcessZeroObserved, true);
      assert.equal(raw.FinalResidualCount, 0);
      assert.equal(raw.AccountingTotalProcessCount, raw.Processes.length);
      assert.equal(raw.UnexpectedJobMessageCount, 0);
      assert.equal(
        raw.Processes.every(
          ({ ExitObserved, JobMembershipVerified }) => ExitObserved && JobMembershipVerified,
        ),
        true,
      );
    } finally {
      rmSync(testRoot, { recursive: true, force: true });
    }
  },
);
