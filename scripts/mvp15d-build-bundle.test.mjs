/* global Buffer, URL, process */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BundleError,
  safeLogicalPath,
  sourceInventory,
  validateInventory,
  validateProcessLedger,
} from "./mvp15d-build-bundle.mjs";

const TASK_ID = "TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-SOURCE-CHECKPOINT-REWORK-7";
const INVENTORY_SCHEMA = "uagent.mvp15d.rework7.build-inventory.v1";
const SCRIPT = fileURLToPath(new URL("./mvp15d-build-bundle.mjs", import.meta.url));
const REPOSITORY = resolve(dirname(SCRIPT), "..");

function stable(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
    .join(",")}}`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function entry(root, path) {
  const bytes = readFileSync(join(root, ...path.split("/")));
  return { path, size: bytes.length, sha256: sha256(bytes) };
}

function writeInventory(root, entries) {
  const bundleSha256 = sha256(
    Buffer.from(
      entries.map((item) => `${item.path}\0${item.size}\0${item.sha256}`).join("\n"),
      "utf8",
    ),
  );
  const base = {
    schemaVersion: INVENTORY_SCHEMA,
    taskId: TASK_ID,
    entries,
    bundleSha256,
  };
  writeFileSync(
    join(root, "inventory.json"),
    `${JSON.stringify(
      { ...base, inventorySha256: sha256(Buffer.from(stable(base), "utf8")) },
      null,
      2,
    )}\n`,
    { encoding: "utf8", flag: "w" },
  );
}

function fixtureBundle() {
  const root = mkdtempSync(join(tmpdir(), "UAgent-MVP15D-Rework7-build-inventory-test-"));
  mkdirSync(join(root, "logs"));
  mkdirSync(join(root, "metadata"));
  writeFileSync(join(root, "logs", "build.log"), "Result: Succeeded\n", "utf8");
  writeFileSync(join(root, "metadata", "record.json"), "{}\n", "utf8");
  const entries = [entry(root, "logs/build.log"), entry(root, "metadata/record.json")].sort(
    (left, right) => left.path.localeCompare(right.path, "en"),
  );
  writeInventory(root, entries);
  return { root, entries };
}

function safeRemove(path) {
  const absolute = resolve(path);
  const temp = resolve(tmpdir());
  assert.equal(dirname(absolute), temp);
  assert.match(absolute.slice(temp.length + 1), /^UAgent-MVP15D-Rework7-[A-Za-z0-9_-]+$/i);
  rmSync(absolute, { recursive: true, force: true });
}

function expectCode(action, code) {
  assert.throws(action, (error) => error instanceof BundleError && error.code === code);
}

test("build bundle logical inventory paths reject absolute, escaping, dot, and backslash forms", () => {
  assert.equal(safeLogicalPath("metadata/build-review.json"), true);
  for (const value of [
    "",
    "/absolute",
    "C:/absolute",
    "metadata\\record.json",
    "../escape",
    "metadata/../escape",
    "./metadata",
    "metadata//record",
    "metadata/",
  ]) {
    assert.equal(safeLogicalPath(value), false, value);
  }
});

test("build bundle inventory validates exact files, hashes, order, and directory closure", async (t) => {
  await t.test("accepts a sealed fixture", () => {
    const fixture = fixtureBundle();
    try {
      const inventory = validateInventory(fixture.root);
      assert.equal(inventory.entries.length, 2);
    } finally {
      safeRemove(fixture.root);
    }
  });

  await t.test("rejects a changed file", () => {
    const fixture = fixtureBundle();
    try {
      writeFileSync(join(fixture.root, "logs", "build.log"), "changed\n", "utf8");
      expectCode(() => validateInventory(fixture.root), "BUILD_BUNDLE_INVENTORY_DIGEST_MISMATCH");
    } finally {
      safeRemove(fixture.root);
    }
  });

  await t.test("rejects missing and extra files", () => {
    const missing = fixtureBundle();
    try {
      unlinkSync(join(missing.root, "logs", "build.log"));
      expectCode(() => validateInventory(missing.root), "BUILD_BUNDLE_INVENTORY_FILE_SET_MISMATCH");
    } finally {
      safeRemove(missing.root);
    }
    const extra = fixtureBundle();
    try {
      writeFileSync(join(extra.root, "extra.txt"), "extra", "utf8");
      expectCode(() => validateInventory(extra.root), "BUILD_BUNDLE_INVENTORY_FILE_SET_MISMATCH");
    } finally {
      safeRemove(extra.root);
    }
  });

  await t.test("rejects duplicate, case-colliding, unsafe, and unordered entries", () => {
    for (const mutate of [
      (entries) => [entries[0], entries[0], entries[1]],
      (entries) => [entries[0], { ...entries[0], path: entries[0].path.toUpperCase() }, entries[1]],
      (entries) => [{ ...entries[0], path: "../escape" }, entries[1]],
      (entries) => [...entries].reverse(),
    ]) {
      const fixture = fixtureBundle();
      try {
        writeInventory(fixture.root, mutate(fixture.entries));
        assert.throws(() => validateInventory(fixture.root), BundleError);
      } finally {
        safeRemove(fixture.root);
      }
    }
  });

  await t.test("rejects an extra empty directory and a junction", () => {
    const extraDirectory = fixtureBundle();
    try {
      mkdirSync(join(extraDirectory.root, "empty"));
      expectCode(
        () => validateInventory(extraDirectory.root),
        "BUILD_BUNDLE_INVENTORY_DIRECTORY_SET_MISMATCH",
      );
    } finally {
      safeRemove(extraDirectory.root);
    }
    const junction = fixtureBundle();
    const target = mkdtempSync(join(tmpdir(), "UAgent-MVP15D-Rework7-junction-target-"));
    try {
      symlinkSync(target, join(junction.root, "linked"), "junction");
      expectCode(() => validateInventory(junction.root), "BUILD_BUNDLE_TREE_INVALID");
    } finally {
      safeRemove(junction.root);
      safeRemove(target);
    }
  });
});

test("build prepare accepts only a fresh Rework-7 TEMP direct child", () => {
  const suffix = `${Date.now()}-${process.pid}-${randomBytes(4).toString("hex")}`;
  const projectRoot = join(tmpdir(), `UAgent-MVP15D-Rework7-build-boundary-${suffix}`);
  const nestedParent = join(tmpdir(), `UAgent-MVP15D-Rework7-nested-${suffix}`);
  const nestedProject = join(nestedParent, `UAgent-MVP15D-Rework7-build-${suffix}`);
  const junction = join(tmpdir(), `UAgent-MVP15D-Rework7-build-junction-${suffix}`);
  const junctionTarget = join(tmpdir(), `UAgent-MVP15D-Rework7-junction-target-${suffix}`);
  try {
    const stdout = execFileSync(
      process.execPath,
      [SCRIPT, "prepare", "--repository", REPOSITORY, "--project-root", projectRoot],
      { cwd: REPOSITORY, encoding: "utf8", windowsHide: true },
    );
    assert.equal(JSON.parse(stdout).status, "prepared");
    const existing = spawnSync(
      process.execPath,
      [SCRIPT, "prepare", "--repository", REPOSITORY, "--project-root", projectRoot],
      { cwd: REPOSITORY, encoding: "utf8", windowsHide: true },
    );
    assert.equal(existing.status, 2);
    assert.match(existing.stderr, /BUILD_BUNDLE_PROJECT_DESTINATION_INVALID/);

    mkdirSync(nestedParent);
    const nested = spawnSync(
      process.execPath,
      [SCRIPT, "prepare", "--repository", REPOSITORY, "--project-root", nestedProject],
      { cwd: REPOSITORY, encoding: "utf8", windowsHide: true },
    );
    assert.equal(nested.status, 2);
    assert.equal(
      spawnSync(
        process.execPath,
        [
          SCRIPT,
          "prepare",
          "--repository",
          REPOSITORY,
          "--project-root",
          join(REPOSITORY, "external", `mvp15d-rework7-build-${suffix}`),
        ],
        { cwd: REPOSITORY, encoding: "utf8", windowsHide: true },
      ).status,
      2,
    );

    mkdirSync(junctionTarget);
    symlinkSync(junctionTarget, junction, "junction");
    const reparse = spawnSync(
      process.execPath,
      [SCRIPT, "prepare", "--repository", REPOSITORY, "--project-root", junction],
      { cwd: REPOSITORY, encoding: "utf8", windowsHide: true },
    );
    assert.equal(reparse.status, 2);
  } finally {
    for (const path of [projectRoot, nestedParent, junction, junctionTarget]) {
      safeRemove(path);
    }
  }
});

test("source inventory rejects additional project source, config, or resource bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "UAgent-MVP15D-Rework7-source-set-test-"));
  const paths = [
    "Config/FilterPlugin.ini",
    "README.md",
    "Resources/mvp15d-native-binding-v2.json",
    "Resources/uagent-asset-tools.schema.json",
    "Resources/uagent-companion-build-manifest.schema.json",
    "Source/UAgentAssetTools/Private/UAgentAssetTool.cpp",
    "Source/UAgentAssetTools/Private/UAgentAssetTool.h",
    "Source/UAgentAssetTools/Private/UAgentAssetToolsContract.cpp",
    "Source/UAgentAssetTools/Private/UAgentAssetToolsD0Toolset.cpp",
    "Source/UAgentAssetTools/Private/UAgentAssetToolsModule.cpp",
    "Source/UAgentAssetTools/Private/UAgentAssetToolsModule.h",
    "Source/UAgentAssetTools/Public/UAgentAssetToolsContract.h",
    "Source/UAgentAssetTools/Public/UAgentAssetToolsD0Probe.h",
    "Source/UAgentAssetTools/Public/UAgentAssetToolsD0Toolset.h",
    "Source/UAgentAssetTools/UAgentAssetTools.Build.cs",
    "Source/UAgentAssetToolsTests/Private/UAgentAssetToolsTests.cpp",
    "Source/UAgentAssetToolsTests/Private/UAgentAssetToolsTestsModule.cpp",
    "Source/UAgentAssetToolsTests/UAgentAssetToolsTests.Build.cs",
    "UAgentAssetTools.uplugin",
  ];
  try {
    for (const path of paths) {
      const destination = join(root, ...path.split("/"));
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, `${path}\n`, "utf8");
    }
    assert.equal(sourceInventory(root).files.length, 19);
    const extra = join(root, "Source", "UAgentAssetTools", "Private", "Injected.cpp");
    writeFileSync(extra, "int injected;\n", "utf8");
    expectCode(() => sourceInventory(root), "BUILD_BUNDLE_SOURCE_FILE_COUNT_INVALID");
  } finally {
    safeRemove(root);
  }
});

test("process ledger discloses incomplete identity and missing exit events", () => {
  const marker = "uagent-mvp15d-rework7-build-full-0123456789abcdef0123456789abcdef";
  const processes = [
    {
      JobNewProcessObserved: true,
      ExitObserved: true,
      IdentityComplete: true,
      JobMembershipVerified: true,
    },
    {
      JobNewProcessObserved: true,
      ExitObserved: false,
      IdentityComplete: false,
      JobMembershipVerified: false,
    },
  ];
  const raw = {
    SchemaVersion: "uagent.mvp15d.windows-job-process-run.v1",
    TaskMarker: marker,
    RootExitCode: 0,
    ActiveProcessZeroObserved: true,
    TimedOut: false,
    ForcedJobTermination: false,
    ForcedUnassignedRootTermination: false,
    UnassignedRootResidualAfterCleanup: false,
    FinalResidualCount: 0,
    UnexpectedJobMessageCount: 0,
    FailureCode: "",
    AccountingTotalProcessCount: 2,
    Processes: processes,
  };
  const ledger = {
    schemaVersion: "uagent.mvp15d.rework7.build-process-ledger.v2",
    taskId: TASK_ID,
    phase: "full",
    taskMarker: marker,
    raw,
    closeout: {
      capturedAt: "2026-07-26T12:00:00.000Z",
      marker,
      ports: [1345],
      listeners: [],
      markerProcesses: [],
      processResidualCount: 0,
      portScanComplete: true,
      markerScanComplete: true,
      jobEventMembershipCount: 2,
      identityCompleteCount: 1,
      identityIncompleteCount: 1,
      exitEventCount: 1,
      exitEventMissingCount: 1,
    },
  };
  assert.equal(validateProcessLedger(ledger, "full"), ledger);
  expectCode(
    () =>
      validateProcessLedger(
        { ...ledger, closeout: { ...ledger.closeout, exitEventMissingCount: 0 } },
        "full",
      ),
    "BUILD_BUNDLE_PROCESS_LEDGER_INVALID",
  );
});
