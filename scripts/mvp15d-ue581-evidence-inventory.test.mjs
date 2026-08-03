/* global process */

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import test from "node:test";
import {
  BUILD_COMMAND_SCHEMA,
  BUILD_RESULT_SCHEMA,
  EVENT_SCHEMA,
  LOADED_MODULES_SCHEMA,
  PHASES,
  PHASE_SUMMARY_SCHEMAS,
  PRODUCER_LEDGER_SCHEMA,
  REQUIRED_DIRECTORIES,
  REQUIRED_LOGS,
  TASK_GENERATION,
  bindPackageArtifacts,
  bundleHash,
  create,
  inventorySelfHash,
  ledgerSelfHash,
  redactLog,
  sha256,
  verify,
} from "./mvp15d-ue581-evidence-inventory.mjs";
import { collectPackageArtifacts, manifestSelfHash } from "./mvp15d-manifest.mjs";

const repository = process.cwd();
const external = resolve(repository, "external");
const TASK_ID =
  "TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-FINAL-SOURCE-TOOLING-REWORK-3-CHECKPOINT-READINESS";
const COMMAND_FINGERPRINT = "c".repeat(64);
let rootCounter = 0;

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
    mode: "live",
  };
  const events = [
    {
      schemaVersion: EVENT_SCHEMA,
      phase,
      taskId: TASK_ID,
      producer,
      sequence: 1,
      type: "process_started",
      data: { markerSha256: "5".repeat(64) },
    },
    {
      schemaVersion: EVENT_SCHEMA,
      phase,
      taskId: TASK_ID,
      producer,
      sequence: 2,
      type: "observation",
      data: { status: "verified" },
    },
    {
      schemaVersion: EVENT_SCHEMA,
      phase,
      taskId: TASK_ID,
      producer,
      sequence: 3,
      type: "closeout",
      data: { residualCount: 0 },
    },
  ];
  const transcriptLogical = `transcripts/${phase}.events.jsonl`;
  writeFileSync(
    resolve(root, ...transcriptLogical.split("/")),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
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
    evidenceMode: "live",
    sessionId: `ue581-${phase}-session-0001`,
    generation: 1,
    sourceArtifacts: [
      sourceRecord(transcriptLogical, root),
      sourceRecord(logLogical, root),
      sourceRecord(ledgerLogical, root),
    ],
    status: "verified",
  };
  writeJson(resolve(root, "summaries", `${phase}.json`), summary);
}

function makeFixture() {
  const root = nextRoot();
  const rawRoot = mkdtempSync(resolve(tmpdir(), "uagent-ue581-redaction-source-"));
  mkdirSync(root);
  for (const directory of REQUIRED_DIRECTORIES) {
    mkdirSync(resolve(root, ...directory.split("/")), { recursive: true });
  }
  try {
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
      taskMarker: "uagent-mvp15d-ue581-build-marker-0001",
      status: "build_completed",
      reason: null,
      commandFingerprint: COMMAND_FINGERPRINT,
      childPid: 100,
      childExitCode: 0,
      wrapperExitCode: 0,
      sourceArtifacts: [
        sourceRecord("logs/runuat.stdout.redacted.log", root),
        sourceRecord("logs/runuat.stderr.redacted.log", root),
      ],
      packagePresent: true,
      successManifestPresent: false,
      closeout: {
        wrapperPid: 99,
        childExited: true,
        taskOwnedResidualCount: 0,
      },
    });
    const { collected } = createManifest(root);
    writeJson(resolve(root, "captures", "loaded-modules.json"), {
      schemaVersion: LOADED_MODULES_SCHEMA,
      taskId: TASK_ID,
      sessionId: "ue581-loaded-session-0001",
      generation: 1,
      processIdentitySha256: "d".repeat(64),
      modules: collected.modules.map(({ path, size, sha256: digest }) => ({
        name: basename(path),
        path: `package/UAgentAssetTools/${path}`,
        size,
        sha256: digest,
      })),
    });
    bindPackageArtifacts(root);
    for (const phase of PHASES) writePhaseEvidence(root, phase);
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
    expectCode(() => create(fixture.root), "UE581_PACKAGE_INVENTORY_BINDING_INVALID");
  } finally {
    cleanup(fixture);
  }
});
