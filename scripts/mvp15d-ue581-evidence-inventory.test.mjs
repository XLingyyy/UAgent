/* global process, structuredClone */

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import {
  cpSync,
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
import {
  BUILD_COMMAND_SCHEMA,
  BUILD_RESULT_SCHEMA,
  EVENT_SCHEMA,
  JOB_CLOSEOUT_SCHEMA,
  LOADED_MODULES_SCHEMA,
  PHASES,
  PHASE_SUMMARY_SCHEMAS,
  PORT_CLOSEOUT_SCHEMA,
  PRODUCER_LEDGER_SCHEMA,
  REQUIRED_DIRECTORIES,
  REQUIRED_LOGS,
  TASK_GENERATION,
  assertSecretFree,
  bindPackageArtifacts,
  bundleHash,
  create,
  inventorySelfHash,
  ledgerSelfHash,
  redactLog,
  sha256,
  stable,
  validateLivePhaseCrossBinding,
  validateRetainedValueCanary,
  verify,
} from "./mvp15d-ue581-evidence-inventory.mjs";
import { collectPackageArtifacts, manifestSelfHash } from "./mvp15d-manifest.mjs";
import {
  createAutomationReportVerification,
  createInventoryBridge,
} from "./mvp15d-final-live-verifier.mjs";

const repository = process.cwd();
const external = resolve(repository, "external");
const TASK_ID =
  "TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-FINAL-SOURCE-TOOLING-REWORK-3-CHECKPOINT-READINESS";
const COMMAND_FINGERPRINT = "c".repeat(64);
let rootCounter = 0;
const UE_AUTOMATION_TESTS = [
  "UAgentAssetTools.Contracts",
  "UAgentAssetTools.ReadOnly",
  "UAgentAssetTools.Closeout",
];

function automationReportBytes() {
  return Buffer.from(
    `${JSON.stringify(
      {
        succeeded: 3,
        succeededWithWarnings: 0,
        failed: 0,
        notRun: 0,
        tests: UE_AUTOMATION_TESTS.map((fullTestPath) => ({
          fullTestPath,
          state: "Success",
        })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function automationAuthorityEvents(root) {
  const manifestBytes = readFileSync(
    resolve(root, "package", "UAgentAssetTools", "UAgentAssetTools.build.json"),
  );
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const loaded = JSON.parse(readFileSync(resolve(root, "captures", "loaded-modules.json"), "utf8"));
  const reportSha256 = sha256(automationReportBytes());
  const producer = {
    id: "mvp15d-final-ue-automation-producer",
    processIdBindingSha256: loaded.process.pidBindingSha256,
    mode: "live",
  };
  const base = (type, data, sequence) => ({
    schemaVersion: EVENT_SCHEMA,
    phase: "ue-automation",
    taskId: TASK_ID,
    markerSha256: loaded.taskMarkerSha256,
    sessionBindingSha256: loaded.sessionBindingSha256,
    generation: loaded.generation,
    producer,
    sequence,
    capturedAt: `2099-12-31T23:59:${String(sequence).padStart(2, "0")}.000Z`,
    type,
    data,
  });
  const moduleSha256 = loaded.package.sha256;
  const facts = [
    ["process_started", { markerSha256: loaded.taskMarkerSha256 }],
    [
      "runtime_process_started",
      {
        processIdBindingSha256: loaded.process.pidBindingSha256,
        executable: { sha256: loaded.process.executableSha256 },
      },
    ],
    [
      "production_provenance",
      {
        sourceCommit: manifest.sourceCommit,
        sourceDirty: false,
        sourceTreeSha256: manifest.sourceTreeSha256,
        projectSha256: loaded.project.sha256,
        manifestSha256: sha256(manifestBytes),
        loadedModulesSha256: moduleSha256,
      },
    ],
    [
      "automation_report_binding",
      {
        reportSha256,
        taskBindingSha256: "2".repeat(64),
        projectSha256: loaded.project.sha256,
        manifestSha256: sha256(manifestBytes),
        packageModulesSha256: moduleSha256,
        installedModulesSha256: moduleSha256,
        loadedModulesSha256: moduleSha256,
        executableSha256: loaded.process.executableSha256,
        processIdBindingSha256: loaded.process.pidBindingSha256,
      },
    ],
    ["automation_summary", { expected: 3, passed: 3, failed: 0, skipped: 0 }],
    ...UE_AUTOMATION_TESTS.map((name) => ["automation_test", { name, status: "passed" }]),
    ["closeout", { processResidualCount: 0, portResidualCount: 0 }],
  ];
  return facts.map(([type, data], index) => base(type, data, index + 1));
}

function retainedBinding(kind, value) {
  return sha256(Buffer.from(`uagent.mvp15d.retained.${kind}.v1\0${value}`, "utf8"));
}

function repositorySource(relativePath) {
  const bytes = readFileSync(resolve(repository, ...relativePath.split("/")));
  return { relativePath, size: bytes.length, sha256: sha256(bytes) };
}

function loadedAuthorityBindingMaterial(value) {
  return {
    schemaVersion: value.schemaVersion,
    productionOrigin: value.productionOrigin,
    fixtureUsed: value.fixtureUsed,
    taskGeneration: value.taskGeneration,
    taskId: value.taskId,
    taskMarkerSha256: value.taskMarkerSha256,
    sessionBindingSha256: value.sessionBindingSha256,
    generation: value.generation,
    sourceCommit: value.sourceCommit,
    sourceTreeSha256: value.sourceTreeSha256,
    sourceDirty: value.sourceDirty,
    project: value.project,
    manifest: value.manifest,
    package: value.package,
    installedRoot: value.installedRoot,
    process: value.process,
    modules: value.modules,
    processIdentitySha256: value.authority.processIdentitySha256,
    sources: value.authority.sources,
  };
}

function nextRoot() {
  rootCounter += 1;
  const day = String((process.pid % 20) + 1).padStart(2, "0");
  const seconds = String(rootCounter).padStart(6, "0");
  return resolve(external, `mvp15d-ue581-compat-209912${day}_${seconds}`);
}

function record(path, root) {
  const bytes = readFileSync(resolve(root, ...path.split("/")));
  return { path, size: bytes.length, sha256: sha256(bytes) };
}

function sourceRecord(path, root) {
  const value = record(path, root);
  return {
    relativePath: value.path,
    size: value.size,
    sha256: value.sha256,
  };
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createManifest(root) {
  const packageRoot = resolve(root, "package", "UAgentAssetTools");
  writeJson(resolve(packageRoot, "UAgentAssetTools.uplugin"), {
    FileVersion: 3,
    Version: 1,
    VersionName: "0.1.0",
    FriendlyName: "UAgent Asset Tools",
  });
  writeJson(resolve(packageRoot, "Resources", "uagent-asset-tools.schema.json"), {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "uagent.ue-companion-plugin.asset-tools.v1",
    type: "object",
    properties: {
      identitySchema: {
        properties: {
          schemaVersion: { const: "uagent.ue-companion-plugin.identity.v2" },
          pluginId: { const: "UAgentAssetTools" },
          contractVersion: { const: "mvp15d.asset-tools.v1" },
          engineVersion: { const: "5.8.1" },
          engineChangelist: { const: 56057345 },
          compatibleChangelist: { const: 55116800 },
          moduleBuildId: { const: "55116800" },
        },
      },
    },
  });
  writeFileSync(
    resolve(packageRoot, "Resources", "mvp15d-native-binding-v2.json"),
    readFileSync(
      resolve(
        repository,
        "integrations",
        "unreal",
        "UAgentAssetTools",
        "Resources",
        "mvp15d-native-binding-v2.json",
      ),
    ),
  );
  writeFileSync(
    resolve(packageRoot, "Binaries", "Win64", "UnrealEditor-UAgentAssetTools.dll"),
    Buffer.concat([
      Buffer.from([0x4d, 0x5a, 0x00, 0xff]),
      Buffer.from("fixture-module-without-host-paths", "utf8"),
    ]),
  );
  writeJson(resolve(packageRoot, "Binaries", "Win64", "UnrealEditor.modules"), {
    BuildId: "55116800",
    Modules: {
      UAgentAssetTools: "UnrealEditor-UAgentAssetTools.dll",
    },
  });
  const collected = collectPackageArtifacts(packageRoot, false);
  const manifest = {
    schemaVersion: "uagent.ue-companion-plugin.build-manifest.v3",
    taskGeneration: TASK_GENERATION,
    taskId: TASK_ID,
    pluginId: "UAgentAssetTools",
    pluginVersion: "0.1.0",
    contractVersion: "mvp15d.asset-tools.v1",
    sourceCommit: "a".repeat(40),
    sourceTreeSha256: "b".repeat(64),
    physicalFixtures: [
      {
        path: "packages/shared/test-fixtures/mvp15d-native-binding-v2.json",
        size: 1,
        sha256: "1".repeat(64),
        gitObjectSha256: "2".repeat(64),
      },
      {
        path: "integrations/unreal/UAgentAssetTools/Resources/mvp15d-native-binding-v2.json",
        size: 1,
        sha256: "3".repeat(64),
        gitObjectSha256: "4".repeat(64),
      },
    ],
    dirty: false,
    engineVersion: "5.8.1",
    engineChangelist: 56057345,
    compatibleChangelist: 55116800,
    moduleBuildId: "55116800",
    targetPlatform: "Win64",
    configuration: "Development",
    compiler: { name: "MSVC", version: "14.44.35207" },
    windowsSdk: { name: "Windows SDK", version: "10.0.26100.0" },
    buildCommandFingerprint: COMMAND_FINGERPRINT,
    buildEvidenceArtifacts: [
      record("metadata/build-command.json", root),
      record("metadata/build-result.json", root),
      record("logs/runuat.stdout.redacted.log", root),
      record("logs/runuat.stderr.redacted.log", root),
    ],
    artifacts: collected.artifacts,
    modules: collected.modules,
    toolNames: [
      "ue.asset.create_folder",
      "ue.asset.duplicate",
      "ue.asset.rename",
      "ue.asset.move",
      "ue.asset.delete",
      "ue.asset.save",
    ],
    generatedAt: "2026-07-31T00:00:00.000Z",
    builder: { kind: "local", name: "uagent-mvp15d-final" },
  };
  manifest.manifestSelfSha256 = manifestSelfHash(manifest);
  writeJson(resolve(packageRoot, "UAgentAssetTools.build.json"), manifest);
  return { manifest, collected };
}

function writePhaseEvidence(root, phase) {
  const producer = {
    id: `mvp15d-final-${phase}-producer`,
    mode: "fixture",
  };
  const sessionId = `ue581-${phase}-session-0001`;
  const generation = 1;
  const marker = `uagent-${phase}-marker-0001`;
  const runtimeProcessId = 4100 + PHASES.indexOf(phase);
  const jobLogical = `metadata/${phase}.job-closeout.json`;
  const portLogical = `metadata/${phase}.port-closeout.json`;
  writeJson(resolve(root, ...jobLogical.split("/")), {
    schemaVersion: JOB_CLOSEOUT_SCHEMA,
    taskId: TASK_ID,
    marker,
    sessionId,
    generation,
    jobSchemaVersion: "uagent.mvp15d.windows-job-process-run.v1",
    rootPid: runtimeProcessId,
    rootExitCode: 0,
    timedOut: false,
    activeProcessZeroObserved: true,
    finalResidualCount: 0,
    failureCode: "",
  });
  writeJson(resolve(root, ...portLogical.split("/")), {
    schemaVersion: PORT_CLOSEOUT_SCHEMA,
    phase,
    taskId: TASK_ID,
    marker,
    sessionId,
    generation,
    port: 18900 + PHASES.indexOf(phase),
    host: "127.0.0.1",
    observations: Array.from({ length: 5 }, (_, index) => ({
      attempt: index + 1,
      accepting: false,
    })),
    residualCount: 0,
  });
  let events = [
    {
      schemaVersion: EVENT_SCHEMA,
      phase,
      taskId: TASK_ID,
      producer,
      sequence: 1,
      type: "process_started",
      data: { markerSha256: "5".repeat(64) },
    },
  ];
  if (phase === "product-capture" || phase === "ui-lifecycle") {
    events.push({
      schemaVersion: EVENT_SCHEMA,
      phase,
      taskId: TASK_ID,
      producer,
      sequence: events.length + 1,
      type: "runtime_process_started",
      data: { authorityLevel: "source_only", pid: runtimeProcessId },
    });
    const requiredTypes =
      phase === "product-capture"
        ? [
            ["fixed_artifact_authority", "fixed_producer"],
            ["product_discovery_observation", "native_observed"],
            ["retraction_observation", "native_observed"],
            ["mutation_counter_observation", "native_observed"],
          ]
        : [
            ["fixed_artifact_authority", "fixed_producer"],
            ["lifecycle_operation_observation", "native_observed"],
            ["content_manifest_observation", "native_observed"],
            ["negative_case_observation", "native_observed"],
            ["partial_unknown_observation", "native_observed"],
            ["replay_inspection_observation", "native_observed"],
          ];
    for (const [type] of requiredTypes) {
      events.push({
        schemaVersion: EVENT_SCHEMA,
        phase,
        taskId: TASK_ID,
        producer,
        sequence: events.length + 1,
        type,
        data: { authorityLevel: "source_only" },
      });
    }
    events.push({
      schemaVersion: EVENT_SCHEMA,
      phase,
      taskId: TASK_ID,
      producer,
      sequence: events.length + 1,
      sessionId,
      generation,
      type: "closeout",
      data: {
        authorityLevel: "source_only",
        processResidualCount: 0,
        portResidualCount: 0,
        markerResidualCount: 0,
        partialOutputCount: 0,
        jobCloseoutSha256: record(jobLogical, root).sha256,
        portObservationSha256: record(portLogical, root).sha256,
        runtimeProcessId,
        phaseSessionId: sessionId,
        phaseGeneration: generation,
      },
    });
  } else {
    events.push({
      schemaVersion: EVENT_SCHEMA,
      phase,
      taskId: TASK_ID,
      producer,
      sequence: events.length + 1,
      type: "observation",
      data: { status: "verified" },
    });
    events.push({
      schemaVersion: EVENT_SCHEMA,
      phase,
      taskId: TASK_ID,
      producer,
      sequence: events.length + 1,
      type: "closeout",
      data: { residualCount: 0 },
    });
  }
  if (phase === "ue-automation") events = automationAuthorityEvents(root);
  const transcriptLogical = `transcripts/${phase}.events.jsonl`;
  writeFileSync(
    resolve(root, ...transcriptLogical.split("/")),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    "utf8",
  );
  const runtimeTranscriptLogical = `transcripts/${phase}.runtime-events.jsonl`;
  const runtimeEvents = [
    {
      schemaVersion: "uagent.mvp15d.final.runtime-event.v2",
      phase,
      type: "evidence_origin",
      data: { origin: "production_runtime", fixtureUsed: false },
    },
    {
      schemaVersion: "uagent.mvp15d.final.runtime-event.v2",
      phase,
      type: "closeout",
      data:
        phase === "ue-automation"
          ? { processResidualCount: 0, portResidualCount: 0 }
          : {
              authorityLevel: "runtime_observed",
              rendererCompleted: true,
              driverCommandConsumed: true,
            },
    },
  ];
  writeFileSync(
    resolve(root, ...runtimeTranscriptLogical.split("/")),
    `${runtimeEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
    "utf8",
  );
  const logLogical = `logs/${phase}.stderr.log`;
  const producerLedger = {
    schemaVersion: PRODUCER_LEDGER_SCHEMA,
    taskGeneration: TASK_GENERATION,
    phase,
    taskId: TASK_ID,
    producer,
    executable: {
      basename: "fixture-live-boundary.exe",
      size: 17,
      sha256: "6".repeat(64),
    },
    argumentVectorSha256: "7".repeat(64),
    outputs: {
      events: sourceRecord(transcriptLogical, root),
      stdout: sourceRecord(transcriptLogical, root),
      runtimeEvents: sourceRecord(runtimeTranscriptLogical, root),
      stderr: sourceRecord(logLogical, root),
    },
    exitCode: 0,
  };
  const ledgerLogical = `metadata/${phase}.producer.json`;
  writeJson(resolve(root, ...ledgerLogical.split("/")), producerLedger);
  const summary = {
    schemaVersion: PHASE_SUMMARY_SCHEMAS[phase],
    taskGeneration: TASK_GENERATION,
    taskId: TASK_ID,
    evidenceMode: "fixture",
    fixtureUsed: true,
    sessionId,
    generation,
    sourceArtifacts: [
      sourceRecord(transcriptLogical, root),
      sourceRecord(runtimeTranscriptLogical, root),
      sourceRecord(logLogical, root),
      sourceRecord(ledgerLogical, root),
      sourceRecord(jobLogical, root),
      sourceRecord(portLogical, root),
    ],
    status: "verified",
  };
  writeJson(resolve(root, "summaries", `${phase}.json`), summary);
}

function makeFixture() {
  const root = nextRoot();
  const rawRoot = mkdtempSync(resolve(tmpdir(), "uagent-ue581-redaction-source-"));
  try {
    mkdirSync(root);
    for (const directory of REQUIRED_DIRECTORIES) {
      mkdirSync(resolve(root, ...directory.split("/")), { recursive: true });
    }
    for (const [index, logical] of REQUIRED_LOGS.entries()) {
      const source = resolve(rawRoot, `${index}.log`);
      writeFileSync(
        source,
        [
          `phase=${basename(logical)}`,
          "semantic-event=completed",
          `SecurityToken=generated-${randomBytes(8).toString("hex")}`,
          "source=C:\\Users\\fixture-user\\project\\file.txt",
          "",
        ].join("\n"),
        "utf8",
      );
      redactLog(root, source, logical);
    }
    writeJson(resolve(root, "metadata", "build-command.json"), {
      schemaVersion: BUILD_COMMAND_SCHEMA,
      taskGeneration: TASK_GENERATION,
      taskId: TASK_ID,
      launcher: {
        basename: "RunUAT.bat",
        size: 1,
        sha256: "8".repeat(64),
      },
      orderedArguments: [
        "BuildPlugin",
        "-Plugin=${SOURCE_ROOT}/integrations/unreal/UAgentAssetTools/UAgentAssetTools.uplugin",
        "-Package=${PACKAGE_ROOT}",
        "-TargetPlatforms=Win64",
        "-Rocket",
      ],
      orderedArgumentsSha256: "9".repeat(64),
      sourceCommit: "a".repeat(40),
      sourceTreeSha256: "b".repeat(64),
      pluginDescriptor: {
        relativePath: "integrations/unreal/UAgentAssetTools/UAgentAssetTools.uplugin",
        size: 1,
        sha256: "a".repeat(64),
      },
      packageOutputIdentity: "b".repeat(64),
      targetPlatform: "Win64",
      configuration: "Development",
      engineIdentity: {
        engineVersion: "5.8.1",
        engineChangelist: 56057345,
        compatibleChangelist: 55116800,
        moduleBuildId: "55116800",
      },
      commandFingerprint: COMMAND_FINGERPRINT,
    });
    writeJson(resolve(root, "metadata", "build-result.json"), {
      schemaVersion: BUILD_RESULT_SCHEMA,
      taskGeneration: TASK_GENERATION,
      taskMarkerSha256: retainedBinding("marker", "uagent-mvp15d-ue581-build-marker-0001"),
      status: "build_completed",
      reason: null,
      commandFingerprint: COMMAND_FINGERPRINT,
      childPidBindingSha256: retainedBinding("pid", 100),
      childExitCode: 0,
      wrapperExitCode: 0,
      sourceArtifacts: [
        sourceRecord("logs/runuat.stdout.redacted.log", root),
        sourceRecord("logs/runuat.stderr.redacted.log", root),
      ],
      packagePresent: true,
      successManifestPresent: false,
      closeout: {
        wrapperPidBindingSha256: retainedBinding("pid", 99),
        childExited: true,
        taskOwnedResidualCount: 0,
      },
    });
    const { manifest, collected } = createManifest(root);
    const taskMarker = "uagent-mvp15d-ue581-loaded-marker-0001";
    const sessionId = "ue581-loaded-session-0001";
    const pidBindingSha256 = retainedBinding("pid", 100);
    const creationFileTimeUtcBindingSha256 = retainedBinding(
      "creation-filetime",
      "133987008000000000",
    );
    const executableSha256 = "e".repeat(64);
    const processIdentitySha256 = sha256(
      Buffer.from(
        stable({
          pidBindingSha256,
          creationFileTimeUtcBindingSha256,
          executableBasename: "UnrealEditor-Cmd.exe",
          executableSha256,
        }),
        "utf8",
      ),
    );
    const packageSha256 = sha256(Buffer.from(stable(collected.artifacts), "utf8"));
    const loaded = {
      schemaVersion: LOADED_MODULES_SCHEMA,
      productionOrigin: "uagent.windows-job-module-observation.v1",
      fixtureUsed: false,
      taskGeneration: TASK_GENERATION,
      taskId: TASK_ID,
      taskMarkerSha256: retainedBinding("marker", taskMarker),
      sessionBindingSha256: retainedBinding("session", sessionId),
      generation: 1,
      sourceCommit: manifest.sourceCommit,
      sourceTreeSha256: manifest.sourceTreeSha256,
      sourceDirty: false,
      project: { id: "Mvp15Final", sha256: "f".repeat(64) },
      manifest: {
        sha256: sha256(
          readFileSync(resolve(root, "package", "UAgentAssetTools", "UAgentAssetTools.build.json")),
        ),
      },
      package: {
        id: "UAgentAssetTools",
        artifactCount: collected.artifacts.length,
        sha256: packageSha256,
      },
      installedRoot: {
        id: "UAgentAssetTools",
        artifactCount: collected.artifacts.length,
        sha256: packageSha256,
      },
      process: {
        pidBindingSha256,
        creationFileTimeUtcBindingSha256,
        executableBasename: "UnrealEditor-Cmd.exe",
        executableSha256,
      },
      modules: collected.modules.map((module) => ({
        ...module,
        name: basename(module.path),
      })),
      authority: {
        schemaVersion: "uagent.mvp15d.loaded-module-production-authority.v1",
        processIdentitySha256,
        sources: {
          phaseProducer: repositorySource("scripts/mvp15d-final-ue-automation-producer.mjs"),
          helper: repositorySource("scripts/mvp15d-final-live-producer-helper.mjs"),
          observer: repositorySource("scripts/mvp15d-loaded-module-observer.mjs"),
          jobRunner: repositorySource("scripts/mvp15d-windows-job-process-runner.ps1"),
        },
        bindingSha256: "",
      },
    };
    loaded.authority.bindingSha256 = sha256(
      Buffer.from(stable(loadedAuthorityBindingMaterial(loaded)), "utf8"),
    );
    writeJson(resolve(root, "captures", "loaded-modules.json"), loaded);
    bindPackageArtifacts(root);
    for (const phase of PHASES) writePhaseEvidence(root, phase);
    const stamp = basename(root).slice("mvp15d-ue581-compat-".length);
    const finalRoot = resolve(external, `mvp15d-final-d13-d16-${stamp}-ue581`);
    cpSync(root, finalRoot, { recursive: true });
    try {
      rmSync(resolve(finalRoot, "metadata", "identity.json"));
      const rawReportPath = resolve(finalRoot, "captures", "ue-automation-report", "index.json");
      mkdirSync(resolve(rawReportPath, ".."), { recursive: true });
      writeFileSync(rawReportPath, automationReportBytes());
      createAutomationReportVerification({
        repository,
        "evidence-root": finalRoot,
        "task-id": TASK_ID,
        "source-commit": manifest.sourceCommit,
      });
      cpSync(
        resolve(finalRoot, "metadata", "automation-report-verification.json"),
        resolve(root, "metadata", "automation-report-verification.json"),
      );
      createInventoryBridge({
        repository,
        "evidence-root": finalRoot,
        "ue581-root": root,
        "task-id": TASK_ID,
        "source-commit": manifest.sourceCommit,
      });
    } finally {
      rmSync(finalRoot, { recursive: true, force: true });
    }
    return { root, rawRoot };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    rmSync(rawRoot, { recursive: true, force: true });
    throw error;
  }
}

function cleanup(fixture) {
  rmSync(fixture.root, { recursive: true, force: true });
  rmSync(fixture.rawRoot, { recursive: true, force: true });
}

function expectCode(run, code) {
  assert.throws(run, (error) => error?.code === code || error?.message === code);
}

function rewriteInventory(root, change) {
  const path = resolve(root, "inventory.json");
  const inventory = JSON.parse(readFileSync(path, "utf8"));
  change(inventory);
  inventory.directoryCount = inventory.directories.length;
  inventory.fileCount = inventory.files.length;
  inventory.bundleSha256 = bundleHash(inventory.directories, inventory.files);
  inventory.inventorySelfSha256 = inventorySelfHash(inventory);
  writeJson(path, inventory);
}

function rewritePhaseEvents(root, phase, change) {
  const logical = `transcripts/${phase}.events.jsonl`;
  const path = resolve(root, ...logical.split("/"));
  const events = readFileSync(path, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const changed = change(events);
  for (const [index, event] of changed.entries()) event.sequence = index + 1;
  writeFileSync(path, `${changed.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
  const updatedRecord = sourceRecord(logical, root);
  const producerPath = resolve(root, "metadata", `${phase}.producer.json`);
  const producer = JSON.parse(readFileSync(producerPath, "utf8"));
  producer.outputs.events = updatedRecord;
  producer.outputs.stdout = updatedRecord;
  writeJson(producerPath, producer);
  const summaryPath = resolve(root, "summaries", `${phase}.json`);
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  const summaryRecord = summary.sourceArtifacts.find(
    ({ relativePath }) => relativePath === logical,
  );
  Object.assign(summaryRecord, updatedRecord);
  writeJson(summaryPath, summary);
}

test("UE 5.8.1 inventory creates a directory-closed bundle and verifies it in a new process", () => {
  const fixture = makeFixture();
  try {
    const created = create(fixture.root);
    assert.equal(created.status, "inventory_created_and_verified");
    assert.equal(created.verificationProcess, "new-node-process");
    assert.equal(created.directoryCount, REQUIRED_DIRECTORIES.length);
    assert.ok(created.fileCount > 20);
    assert.match(created.inventorySelfSha256, /^[0-9a-f]{64}$/);
    assert.match(created.inventoryFileSha256, /^[0-9a-f]{64}$/);
    assert.match(created.bundleSha256, /^[0-9a-f]{64}$/);
    const verified = verify(fixture.root);
    assert.equal(verified.status, "inventory_verified");
    assert.equal(verified.verificationProcess, "new-node-process");
    assert.equal(verified.inventorySelfSha256, created.inventorySelfSha256);
    assert.equal(verified.bundleSha256, created.bundleSha256);
  } finally {
    cleanup(fixture);
  }
});

test("redaction ledger retains raw size/hash only and independently binds non-sensitive semantics", () => {
  const fixture = makeFixture();
  try {
    const ledger = JSON.parse(
      readFileSync(resolve(fixture.root, "metadata", "redaction-ledger.json"), "utf8"),
    );
    assert.equal(ledger.entries.length, REQUIRED_LOGS.length);
    for (const entry of ledger.entries) {
      assert.deepEqual(Object.keys(entry.source).sort(), ["sha256", "size"]);
      assert.match(entry.source.sha256, /^[0-9a-f]{64}$/);
      assert.equal(JSON.stringify(entry).includes("fixture-user"), false);
      assert.equal(JSON.stringify(entry).includes("generated-"), false);
    }
    create(fixture.root);
    const output = resolve(fixture.root, ...REQUIRED_LOGS[0].split("/"));
    const changed = readFileSync(output, "utf8").replace(
      "semantic-event=completed",
      "semantic-event=failed",
    );
    writeFileSync(output, changed, "utf8");
    const ledgerPath = resolve(fixture.root, "metadata", "redaction-ledger.json");
    const edited = JSON.parse(readFileSync(ledgerPath, "utf8"));
    const entry = edited.entries.find(({ output: value }) => value.path === REQUIRED_LOGS[0]);
    const bytes = readFileSync(output);
    entry.output.size = bytes.length;
    entry.output.sha256 = sha256(bytes);
    edited.ledgerSelfSha256 = ledgerSelfHash(edited);
    writeJson(ledgerPath, edited);
    rewriteInventory(fixture.root, (inventory) => {
      for (const record of inventory.files) {
        if (record.path === REQUIRED_LOGS[0]) {
          record.size = bytes.length;
          record.sha256 = sha256(bytes);
        } else if (record.path === "metadata/redaction-ledger.json") {
          const ledgerBytes = readFileSync(ledgerPath);
          record.size = ledgerBytes.length;
          record.sha256 = sha256(ledgerBytes);
        }
      }
    });
    expectCode(() => verify(fixture.root), "UE581_REDACTION_OUTPUT_DRIFT");
  } finally {
    cleanup(fixture);
  }
});

test("retained generated SecurityToken and raw home paths are rejected before inventory creation", async (t) => {
  for (const [name, payload] of [
    ["SecurityToken", "SecurityToken=generated-retained-value"],
    ["Windows home", "source=C:\\Users\\retained-user\\project\\file.log"],
  ]) {
    await t.test(name, () => {
      const fixture = makeFixture();
      try {
        writeFileSync(
          resolve(fixture.root, ...REQUIRED_LOGS[0].split("/")),
          `${payload}\n`,
          "utf8",
        );
        expectCode(() => create(fixture.root), "UE581_INVENTORY_SENSITIVE_CONTENT");
      } finally {
        cleanup(fixture);
      }
    });
  }
});

test("Authorization, Bearer, API-key and token values are rejected", async (t) => {
  for (const [name, payload] of [
    ["Authorization", "Authorization: Basic dXNlcjpwYXNz"],
    ["Bearer", "Bearer abcdefghijklmnop"],
    ["API key", "X-Api-Key: api-key-value-1234"],
    ["token", "access_token=access-value-1234"],
  ]) {
    await t.test(name, () => {
      const fixture = makeFixture();
      try {
        writeFileSync(
          resolve(fixture.root, ...REQUIRED_LOGS[1].split("/")),
          `${payload}\n`,
          "utf8",
        );
        expectCode(() => create(fixture.root), "UE581_INVENTORY_SENSITIVE_CONTENT");
      } finally {
        cleanup(fixture);
      }
    });
  }
});

test("credential-bearing endpoints are rejected", () => {
  const fixture = makeFixture();
  try {
    writeFileSync(
      resolve(fixture.root, ...REQUIRED_LOGS[2].split("/")),
      "endpoint=https://service.invalid/api?token=credential-value\n",
      "utf8",
    );
    expectCode(() => create(fixture.root), "UE581_INVENTORY_SENSITIVE_CONTENT");
  } finally {
    cleanup(fixture);
  }
});

test("package modules allow compiler paths while retaining home-path rejection", () => {
  assert.doesNotThrow(() =>
    assertSecretFree(Buffer.from("MZ D:\\build\\obj\\module.pdb", "latin1"), undefined, true),
  );
  expectCode(
    () =>
      assertSecretFree(
        Buffer.from("MZ C:\\Users\\retained-user\\module.pdb", "latin1"),
        undefined,
        true,
      ),
    "UE581_INVENTORY_SENSITIVE_CONTENT",
  );
});

test("Saved, Intermediate, DDC, AutoSDK, user settings and cache entries are rejected", async (t) => {
  for (const directory of [
    "Saved",
    "Intermediate",
    "DerivedDataCache",
    "DDC",
    "AutoSDK",
    "UserSettings",
    "Cache",
  ]) {
    await t.test(directory, () => {
      const fixture = makeFixture();
      try {
        const forbidden = resolve(fixture.root, directory);
        mkdirSync(forbidden);
        writeFileSync(resolve(forbidden, "metadata.json"), "{}\n", "utf8");
        expectCode(() => create(fixture.root), "UE581_INVENTORY_FORBIDDEN_PATH");
      } finally {
        cleanup(fixture);
      }
    });
  }
});

test("whole project trees and unexpected binaries are rejected outside explicit package inventory", async (t) => {
  await t.test("whole project", () => {
    const fixture = makeFixture();
    try {
      mkdirSync(resolve(fixture.root, "Content"));
      writeFileSync(resolve(fixture.root, "Content", "asset.uasset"), "x");
      expectCode(() => create(fixture.root), "UE581_INVENTORY_FORBIDDEN_PATH");
    } finally {
      cleanup(fixture);
    }
  });
  await t.test("unexpected binary", () => {
    const fixture = makeFixture();
    try {
      writeFileSync(resolve(fixture.root, "captures", "foreign.exe"), "x");
      expectCode(() => create(fixture.root), "UE581_INVENTORY_UNKNOWN_FILE");
    } finally {
      cleanup(fixture);
    }
  });
});

test("an extra benign file or empty directory breaks closure", async (t) => {
  await t.test("file", () => {
    const fixture = makeFixture();
    try {
      writeFileSync(resolve(fixture.root, "logs", "notes.txt"), "benign\n");
      expectCode(() => create(fixture.root), "UE581_INVENTORY_UNKNOWN_FILE");
    } finally {
      cleanup(fixture);
    }
  });
  await t.test("empty directory", () => {
    const fixture = makeFixture();
    try {
      mkdirSync(resolve(fixture.root, "logs", "empty"));
      expectCode(() => create(fixture.root), "UE581_INVENTORY_UNKNOWN_DIRECTORY");
    } finally {
      cleanup(fixture);
    }
  });
});

test("missing required log or summary is rejected", async (t) => {
  for (const logical of [REQUIRED_LOGS[0], "summaries/product-capture.json"]) {
    await t.test(logical, () => {
      const fixture = makeFixture();
      try {
        rmSync(resolve(fixture.root, ...logical.split("/")));
        expectCode(() => create(fixture.root), "UE581_INVENTORY_REQUIRED_FILE_MISSING");
      } finally {
        cleanup(fixture);
      }
    });
  }
});

test("case-colliding inventory records are rejected even with recomputed hashes", () => {
  const fixture = makeFixture();
  try {
    create(fixture.root);
    rewriteInventory(fixture.root, (inventory) => {
      const original = inventory.files.find(({ path }) => path === "summaries/ue-automation.json");
      inventory.files.push({
        ...original,
        path: "SUMMARIES/ue-automation.json",
      });
    });
    expectCode(() => verify(fixture.root), "UE581_INVENTORY_CASE_COLLISION");
  } finally {
    cleanup(fixture);
  }
});

test("symlink, junction and reparse entries are rejected", async (t) => {
  for (const [name, type, targetKind] of [
    ["directory link", "junction", "directory"],
    ["junction", "junction", "directory"],
    ["reparse point", "junction", "directory"],
  ]) {
    await t.test(name, () => {
      const fixture = makeFixture();
      const target =
        targetKind === "file"
          ? resolve(fixture.rawRoot, "link-target.txt")
          : resolve(fixture.rawRoot, "link-target");
      try {
        if (targetKind === "file") writeFileSync(target, "target");
        else mkdirSync(target);
        symlinkSync(
          target,
          resolve(fixture.root, "logs", `${name.replaceAll(" ", "-")}.link`),
          type,
        );
        expectCode(() => create(fixture.root), "UE581_INVENTORY_LINK_REPARSE_MOUNT_REJECTED");
      } finally {
        cleanup(fixture);
      }
    });
  }
});

test("escaping, backslash, dot and absolute inventory paths are rejected", async (t) => {
  for (const [name, path] of [
    ["escape", "../escape.json"],
    ["backslash", "logs\\runuat.stdout.redacted.log"],
    ["dot", "logs/../runuat.stdout.redacted.log"],
    ["absolute", "C:/outside/evidence.json"],
  ]) {
    await t.test(name, () => {
      const fixture = makeFixture();
      try {
        create(fixture.root);
        rewriteInventory(fixture.root, (inventory) => {
          inventory.files[0].path = path;
        });
        expectCode(() => verify(fixture.root), "UE581_INVENTORY_PATH_NONCANONICAL");
      } finally {
        cleanup(fixture);
      }
    });
  }
});

test("edited redacted output and edited redaction ledger are rejected", async (t) => {
  await t.test("output", () => {
    const fixture = makeFixture();
    try {
      create(fixture.root);
      writeFileSync(resolve(fixture.root, ...REQUIRED_LOGS[0].split("/")), "benign but edited\n");
      expectCode(() => verify(fixture.root), "UE581_REDACTION_OUTPUT_DRIFT");
    } finally {
      cleanup(fixture);
    }
  });
  await t.test("ledger", () => {
    const fixture = makeFixture();
    try {
      create(fixture.root);
      const path = resolve(fixture.root, "metadata", "redaction-ledger.json");
      const ledger = JSON.parse(readFileSync(path, "utf8"));
      ledger.entries[0].source.size += 1;
      writeJson(path, ledger);
      expectCode(() => verify(fixture.root), "UE581_REDACTION_LEDGER_INVALID");
    } finally {
      cleanup(fixture);
    }
  });
});

test("a hash-valid inventory with an inadmissible path is rejected", () => {
  const fixture = makeFixture();
  try {
    create(fixture.root);
    rewriteInventory(fixture.root, (inventory) => {
      const record = inventory.files.find(({ path }) => path === "logs/runuat.stdout.redacted.log");
      record.path = "Saved/curated-looking.log";
    });
    expectCode(() => verify(fixture.root), "UE581_INVENTORY_FORBIDDEN_PATH");
  } finally {
    cleanup(fixture);
  }
});

test("package artifact inventory and identity remain bound to manifest v3", () => {
  const fixture = makeFixture();
  try {
    const path = resolve(
      fixture.root,
      "package",
      "UAgentAssetTools",
      "UAgentAssetTools.build.json",
    );
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    manifest.sourceCommit = "e".repeat(40);
    manifest.manifestSelfSha256 = manifestSelfHash(manifest);
    writeJson(path, manifest);
    const loadedPath = resolve(fixture.root, "captures", "loaded-modules.json");
    const loaded = JSON.parse(readFileSync(loadedPath, "utf8"));
    loaded.sourceCommit = manifest.sourceCommit;
    loaded.manifest.sha256 = sha256(readFileSync(path));
    loaded.authority.bindingSha256 = sha256(
      Buffer.from(stable(loadedAuthorityBindingMaterial(loaded)), "utf8"),
    );
    writeJson(loadedPath, loaded);
    expectCode(() => create(fixture.root), "UE581_PACKAGE_INVENTORY_BINDING_INVALID");
  } finally {
    cleanup(fixture);
  }
});

test("product inventory rejects mixed/source-only authority, missing raw observations, and copied legacy identity", async (t) => {
  const substitutions = [
    [
      "mixed authority",
      (events) => {
        events.find(({ type }) => type === "product_discovery_observation").data.authorityLevel =
          "runtime_observed";
        return events;
      },
    ],
    [
      "source only presented as live",
      (events) => {
        for (const event of events) {
          event.producer.mode = "live";
        }
        return events;
      },
    ],
    [
      "missing raw discovery",
      (events) => events.filter(({ type }) => type !== "product_discovery_observation"),
    ],
    [
      "copied legacy installed/load/manifest",
      (events) =>
        events.map((event) =>
          event.type === "fixed_artifact_authority"
            ? {
                ...event,
                type: "installed_loaded",
                data: {
                  authorityLevel: "runtime_observed",
                  installed: ["One.dll"],
                  loaded: ["One.dll"],
                  manifest: ["One.dll"],
                },
              }
            : event,
        ),
    ],
  ];
  for (const [name, change] of substitutions) {
    await t.test(name, () => {
      const fixture = makeFixture();
      try {
        rewritePhaseEvents(fixture.root, "product-capture", change);
        expectCode(
          () => create(fixture.root),
          name === "source only presented as live"
            ? "UE581_RETAINED_SENSITIVE_VALUE"
            : "FINAL_LIVE_VERIFIER_BRIDGE_RECORD_INVALID",
        );
      } finally {
        cleanup(fixture);
      }
    });
  }
});

test("recursive retained JSON and JSONL canaries reject raw live bindings and absolute paths", async (t) => {
  const canaries = [
    ["marker", { marker: "uagent-raw-marker" }],
    ["session", { nested: { sessionId: "raw-session-0001" } }],
    ["pid", { nested: [{ pid: 4412 }] }],
    ["creation FILETIME", { process: { creationFileTimeUtc: "133987008000000000" } }],
    ["endpoint", { transport: { endpoint: "http://127.0.0.1:18765/mcp" } }],
    ["port", { transport: { port: 18765 } }],
    ["absolute path", { diagnostic: { value: "C:\\Users\\fixture\\secret.txt" } }],
  ];
  for (const [name, canary] of canaries) {
    await t.test(name, () => {
      expectCode(
        () => validateRetainedValueCanary({ envelope: { entries: [canary] } }),
        "UE581_RETAINED_SENSITIVE_VALUE",
      );
      expectCode(
        () => validateRetainedValueCanary([{ data: { nested: canary } }]),
        "UE581_RETAINED_SENSITIVE_VALUE",
      );
    });
  }

  await t.test("retained JSON integration", () => {
    const fixture = makeFixture();
    try {
      const loadedPath = resolve(fixture.root, "captures", "loaded-modules.json");
      const loaded = JSON.parse(readFileSync(loadedPath, "utf8"));
      loaded.authority.sources.observer.canary = { sessionId: "raw-session-0001" };
      writeJson(loadedPath, loaded);
      expectCode(() => create(fixture.root), "UE581_RETAINED_SENSITIVE_VALUE");
    } finally {
      cleanup(fixture);
    }
  });

  await t.test("retained JSONL integration", () => {
    const fixture = makeFixture();
    try {
      rewritePhaseEvents(fixture.root, "product-capture", (events) => {
        events[0].producer.mode = "live";
        events[0].data.nested = { endpoint: "http://127.0.0.1:18765/mcp" };
        return events;
      });
      expectCode(() => create(fixture.root), "UE581_RETAINED_SENSITIVE_VALUE");
    } finally {
      cleanup(fixture);
    }
  });
});

test("live phase cross-binding rejects raw ledger, process, artifact, and parent closeout drift", () => {
  const root = mkdtempSync(join(tmpdir(), "uagent-mvp15d-live-cross-binding-"));
  try {
    const phase = "product-capture";
    const taskId = "TASK-MVP15D-LIVE-CROSS-BINDING-TEST";
    const marker = "uagent-mvp15d-live-cross-binding-marker";
    const sessionId = "uagent-mvp15d-live-cross-binding-session";
    const generation = 7;
    const childPid = 41001;
    const runtimePid = 41002;
    const sourceCommit = "1".repeat(40);
    const sourceTreeSha256 = "2".repeat(64);
    const executableSha256 = "3".repeat(64);
    const fixedArtifactBindingSha256 = "4".repeat(64);
    const nonceSha256 = "5".repeat(64);
    const markerSha256 = retainedBinding("marker", marker);
    const sessionBindingSha256 = retainedBinding("session", sessionId);
    const endpointSha256 = retainedBinding("endpoint", "http://127.0.0.1:18765/mcp");
    const childProcessIdBindingSha256 = retainedBinding("process-id", childPid);
    const runtimeProcessIdBindingSha256 = retainedBinding("process-id", runtimePid);
    const runtimePidBindingSha256 = retainedBinding("pid", runtimePid);
    const metadata = resolve(root, "metadata");
    const transcripts = resolve(root, "transcripts");
    mkdirSync(metadata, { recursive: true });
    mkdirSync(transcripts, { recursive: true });

    const rawPath = resolve(transcripts, `${phase}.runtime-events.jsonl`);
    const producerPath = resolve(metadata, `${phase}.producer.json`);
    const jobPath = resolve(metadata, `${phase}.job-closeout.json`);
    const portPath = resolve(metadata, `${phase}.port-closeout.json`);
    writeFileSync(rawPath, "runtime-ledger\n", "utf8");
    writeFileSync(producerPath, "producer-ledger\n", "utf8");
    writeFileSync(jobPath, "job-closeout\n", "utf8");
    writeFileSync(portPath, "port-closeout\n", "utf8");

    const runtimeProcess = {
      processIdBindingSha256: runtimeProcessIdBindingSha256,
      endpointSha256,
      markerSha256,
      executable: { basename: "uagent.exe", size: 1, sha256: executableSha256 },
      argumentVectorSha256: "8".repeat(64),
    };
    const fixedArtifact = {
      sourceCommit,
      sourceTreeSha256,
      phaseSessionBindingSha256: sessionBindingSha256,
      phaseGeneration: generation,
      runtimeProcessIdBindingSha256,
      producerBindingSha256: fixedArtifactBindingSha256,
    };
    const closeout = {
      runtimeProcessIdBindingSha256,
      phaseSessionBindingSha256: sessionBindingSha256,
      phaseGeneration: generation,
      jobCloseoutSha256: sha256(readFileSync(jobPath)),
      portObservationSha256: sha256(readFileSync(portPath)),
    };
    const envelope = (type, data) => ({
      taskId,
      phase,
      markerSha256,
      sessionBindingSha256,
      generation,
      producer: { processIdBindingSha256: childProcessIdBindingSha256 },
      type,
      data,
    });
    const receiptId = (sequence) =>
      `mvp15d-observation-receipt:${sequence.toString(16).padStart(64, "0")}`;
    const predecessorWindowIdentity = {
      schemaVersion: "uagent.mvp15d.predecessor-window-identity.v1",
      status: "observed",
      windowLabel: "main",
      taskId,
      phase,
      handoffId: `renderer-handoff:${"a".repeat(64)}`,
      stableIdentitySha256: "b".repeat(64),
    };
    const rendererHandoff = {
      handoffId: predecessorWindowIdentity.handoffId,
      requestReceipt: { id: receiptId(1), sequence: 1 },
      parentAcknowledgementReceipt: { id: receiptId(2), sequence: 2 },
      claimReceipt: { id: receiptId(3), sequence: 3 },
      predecessorWindow: predecessorWindowIdentity,
      predecessorRenderer: {
        rendererInstanceId: "renderer-before",
        processIdentitySha256: "6".repeat(64),
      },
      successorRenderer: {
        rendererInstanceId: "renderer-after",
        processIdentitySha256: "7".repeat(64),
      },
      predecessorMcpSessionBindingSha256: retainedBinding("session", "mcp-session-before"),
      successorMcpSessionBindingSha256: retainedBinding("session", "mcp-session-after"),
      predecessorMcpGeneration: 10,
      successorMcpGeneration: 11,
    };
    const events = [
      envelope("runtime_process_started", runtimeProcess),
      envelope("fixed_artifact_authority", fixedArtifact),
      envelope("retraction_observation", {
        reason: "renderer_restart",
        rendererHandoff,
        receipts: Array.from({ length: 48 }, (_, index) => ({
          receiptId: receiptId(index + 1),
          receiptSequence: index + 1,
        })),
      }),
      envelope("closeout", closeout),
    ];
    const runtimeEvents = [
      {
        type: "runtime_process_identity",
        data: {
          sourceCommit,
          markerSha256,
          sessionBindingSha256,
          generation,
          portBindingSha256: retainedBinding("port", 18765),
          endpointSha256,
          nonceSha256,
          process: {
            pidBindingSha256: runtimePidBindingSha256,
            executableBasename: runtimeProcess.executable.basename,
            executableSha256,
          },
        },
      },
    ];
    const ledger = {
      taskId,
      sourceCommit,
      markerSha256,
      sessionBindingSha256,
      generation,
      processOwnership: { childProcessIdBindingSha256 },
      runtimeProcess,
      runtimeTransport: {
        eventFile: { sha256: sha256(readFileSync(rawPath)) },
        nonceSha256,
      },
    };
    const processIdentity = {
      processIdBindingSha256: runtimeProcessIdBindingSha256,
      executableBasename: runtimeProcess.executable.basename,
      executableSha256,
    };
    const summary = {
      schemaVersion: "uagent.mvp15d.final.product-capture.v2",
      evidenceMode: "live",
      productionLaunchAuthorityVerified: false,
      producerLedgerSha256: sha256(readFileSync(producerPath)),
      sourceCommit,
      sessionBindingSha256,
      endpointSha256,
      generation,
      nativeObservationReceiptCount: 48,
      artifactAuthorityBindingSha256: fixedArtifactBindingSha256,
      rendererRestartHandoff: {
        handoffId: rendererHandoff.handoffId,
        predecessorRendererInstanceId: rendererHandoff.predecessorRenderer.rendererInstanceId,
        successorRendererInstanceId: rendererHandoff.successorRenderer.rendererInstanceId,
        predecessorProcessIdentitySha256: rendererHandoff.predecessorRenderer.processIdentitySha256,
        successorProcessIdentitySha256: rendererHandoff.successorRenderer.processIdentitySha256,
        predecessorMcpSessionBindingSha256: rendererHandoff.predecessorMcpSessionBindingSha256,
        successorMcpSessionBindingSha256: rendererHandoff.successorMcpSessionBindingSha256,
        predecessorMcpGeneration: rendererHandoff.predecessorMcpGeneration,
        successorMcpGeneration: rendererHandoff.successorMcpGeneration,
        requestReceiptId: receiptId(1),
        requestReceiptSequence: 1,
        parentAcknowledgementReceiptId: receiptId(2),
        parentAcknowledgementReceiptSequence: 2,
        claimReceiptId: receiptId(3),
        claimReceiptSequence: 3,
        predecessorWindowIdentity,
      },
      ownedLaunchBinding: {
        sourceCommit,
        sourceTreeSha256,
        phaseProducerProcessIdBindingSha256: childProcessIdBindingSha256,
        runtimeProcessIdBindingSha256,
        runtimeProcessSha256: sha256(Buffer.from(stable(runtimeProcess), "utf8")),
        processIdentitySha256: sha256(Buffer.from(stable(processIdentity), "utf8")),
        fixedArtifactBindingSha256,
        phaseEventsSha256: sha256(Buffer.from(stable(events), "utf8")),
        rawEventLedgerSha256: sha256(readFileSync(rawPath)),
        rawEventNonceSha256: nonceSha256,
        parentCloseoutSha256: sha256(Buffer.from(stable(closeout), "utf8")),
        jobCloseoutSha256: sha256(readFileSync(jobPath)),
        portCloseoutSha256: sha256(readFileSync(portPath)),
      },
    };

    assert.doesNotThrow(() =>
      validateLivePhaseCrossBinding(root, phase, ledger, events, runtimeEvents, summary),
    );
    const missingParentAcknowledgement = structuredClone(summary);
    delete missingParentAcknowledgement.rendererRestartHandoff.parentAcknowledgementReceiptId;
    expectCode(
      () =>
        validateLivePhaseCrossBinding(
          root,
          phase,
          ledger,
          events,
          runtimeEvents,
          missingParentAcknowledgement,
        ),
      "UE581_LIVE_PHASE_CROSS_BINDING_INVALID",
    );
    for (const mutate of [
      (changedSummary) => {
        changedSummary.rendererRestartHandoff.predecessorWindowIdentity.windowLabel = "secondary";
      },
      (changedSummary) => {
        changedSummary.rendererRestartHandoff.requestReceiptSequence = 3;
      },
      (changedSummary) => {
        changedSummary.rendererRestartHandoff.predecessorWindowIdentity.taskId =
          "TASK-MVP15D-CROSS-TASK";
      },
    ]) {
      const changed = structuredClone(summary);
      mutate(changed);
      expectCode(
        () => validateLivePhaseCrossBinding(root, phase, ledger, events, runtimeEvents, changed),
        "UE581_LIVE_PHASE_CROSS_BINDING_INVALID",
      );
    }
    for (const mutate of [
      (changedEvents) => {
        changedEvents[2].data.rendererHandoff.handoffId = `renderer-handoff:${"c".repeat(64)}`;
      },
      (changedEvents) => {
        delete changedEvents[2].data.rendererHandoff.parentAcknowledgementReceipt;
      },
      (changedEvents) => {
        changedEvents[2].type = "receipt_observations";
      },
    ]) {
      const changedEvents = structuredClone(events);
      mutate(changedEvents);
      const changedSummary = structuredClone(summary);
      changedSummary.ownedLaunchBinding.phaseEventsSha256 = sha256(
        Buffer.from(stable(changedEvents), "utf8"),
      );
      expectCode(
        () =>
          validateLivePhaseCrossBinding(
            root,
            phase,
            ledger,
            changedEvents,
            runtimeEvents,
            changedSummary,
          ),
        "UE581_LIVE_PHASE_CROSS_BINDING_INVALID",
      );
    }
    const duplicateReceiptEvents = structuredClone(events);
    duplicateReceiptEvents[2].data.receipts[1].receiptSequence = 1;
    const duplicateReceiptSummary = structuredClone(summary);
    duplicateReceiptSummary.ownedLaunchBinding.phaseEventsSha256 = sha256(
      Buffer.from(stable(duplicateReceiptEvents), "utf8"),
    );
    expectCode(
      () =>
        validateLivePhaseCrossBinding(
          root,
          phase,
          ledger,
          duplicateReceiptEvents,
          runtimeEvents,
          duplicateReceiptSummary,
        ),
      "UE581_LIVE_PHASE_CROSS_BINDING_INVALID",
    );
    for (const field of [
      "rawEventLedgerSha256",
      "runtimeProcessSha256",
      "fixedArtifactBindingSha256",
      "parentCloseoutSha256",
    ]) {
      const changed = structuredClone(summary);
      changed.ownedLaunchBinding[field] = "0".repeat(64);
      expectCode(
        () => validateLivePhaseCrossBinding(root, phase, ledger, events, runtimeEvents, changed),
        "UE581_LIVE_PHASE_CROSS_BINDING_INVALID",
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
