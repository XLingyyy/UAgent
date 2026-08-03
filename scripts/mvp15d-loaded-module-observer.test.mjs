// R6.2 production loaded-module ledger writer regression.
//
// Exercises the real observer/writer implementation with deterministic native
// fixture files and proves that directly authored JSON cannot satisfy the
// production origin: the reducer only accepts modules actually observed from
// the approved installed files while ignoring unrelated UE/Windows/graphics
// modules, and the ledger is published exclusively and atomically. The real
// Windows process-module enumeration path is proven separately by the
// integration regression (`mvp15d-loaded-module-observer.integration.test.mjs`).

/* global structuredClone */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import { join, resolve } from "node:path";
import test from "node:test";

import {
  LOADED_LEDGER_SCHEMA,
  PRODUCTION_ORIGIN,
  buildLoadedLedger,
  observeProcess,
  publishLoadedLedger,
  publishProductionLoadedLedger,
  reduceLoadedModules,
  runObserver,
  validateObservationIdentity,
} from "./mvp15d-loaded-module-observer.mjs";

const TASK_ID = "TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-FINAL-D13-D16";
const MARKER = "uagent-mvp15d-loaded-observer-marker-0001";
const SESSION = "uagent-mvp15d-loaded-observer-session-0001";

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function expectCode(action, code) {
  assert.throws(action, (error) => error instanceof Error && error.code === code);
}

// Build a fixture installed root with two approved modules, a matching
// manifest modules list, and a set of unrelated observed modules.
function createFixture() {
  const base = mkdtempSync(join(tmpdir(), "uagent-loaded-observer-"));
  const installed = resolve(base, "Plugins", "UAgentAssetTools");
  mkdirSync(resolve(installed, "Binaries", "Win64"), { recursive: true });
  const moduleNames = [
    "UnrealEditor-UAgentAssetTools.dll",
    "UnrealEditor-UAgentAssetToolsCore.dll",
  ];
  const installedFiles = moduleNames.map((name) => {
    const path = resolve(installed, "Binaries", "Win64", name);
    writeFileSync(path, `module:${name}\n`, "utf8");
    return { name, path, size: readFileSync(path).length, sha256: sha256File(path) };
  });
  const manifestModules = installedFiles.map((item) => ({
    path: `Binaries/Win64/${item.name}`,
    size: item.size,
    sha256: item.sha256,
  }));
  const unrelated = [
    { name: "kernel32.dll", path: "C:\\Windows\\System32\\kernel32.dll", moduleMemorySize: 512 },
    { name: "msvcp140.dll", path: "C:\\Windows\\System32\\msvcp140.dll", moduleMemorySize: 256 },
    {
      name: "UnrealEditor-Engine.dll",
      path: "D:\\UE\\Engine\\Binaries\\Win64\\UnrealEditor-Engine.dll",
      moduleMemorySize: 1024,
    },
    {
      name: "nvngx_dlss.dll",
      path: "C:\\Windows\\System32\\nvngx_dlss.dll",
      moduleMemorySize: 128,
    },
    {
      name: "UnrealEditor-UAgentAssetToolsTest.dll",
      path: "D:\\UE\\Engine\\Plugins\\Test\\UnrealEditor-UAgentAssetToolsTest.dll",
      moduleMemorySize: 64,
    },
  ];
  const observed = [
    ...installedFiles.map((item) => ({
      name: item.name,
      path: item.path,
      moduleMemorySize: 4096,
    })),
    ...unrelated,
  ];
  const manifestPath = resolve(base, "manifest.json");
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ taskId: TASK_ID, modules: manifestModules }, null, 2)}\n`,
    "utf8",
  );
  return { base, installed, installedFiles, manifestModules, observed, manifestPath };
}

function identity() {
  return {
    taskId: TASK_ID,
    taskMarker: MARKER,
    sessionId: SESSION,
    generation: 1,
    sourceCommit: "d".repeat(40),
    sourceTreeSha256: "a".repeat(64),
    sourceDirty: true,
    projectId: "FinalHost",
    projectSha256: "c".repeat(64),
    manifestSha256: "e".repeat(64),
    packageId: "UAgentAssetTools",
    packageSha256: "f".repeat(64),
    installedRootId: "UAgentAssetTools",
    installedRootSha256: "1".repeat(64),
    productionOrigin: PRODUCTION_ORIGIN,
  };
}

function processFacts() {
  return {
    pid: 4567,
    creationFileTimeUtc: "133500000000000000",
    executableBasename: "UnrealEditor-Cmd.exe",
    executableSha256: "b".repeat(64),
  };
}

function fixtureObservation(fixture) {
  return {
    pid: 4567,
    alive: true,
    creationFileTimeUtc: "133500000000000000",
    modulesAccessible: true,
    modules: fixture.observed,
  };
}

test("R7.1 pure reduction remains structural and cannot claim production authority", () => {
  const fixture = createFixture();
  try {
    const ledger = buildLoadedLedger({
      manifest: { modules: fixture.manifestModules },
      installedRoot: fixture.installed,
      observed: fixture.observed,
      identity: identity(),
      process: processFacts(),
    });
    assert.equal(ledger.schemaVersion, LOADED_LEDGER_SCHEMA);
    assert.equal(ledger.origin, "test_only_loaded_module_reduction");
    assert.equal(ledger.fixtureUsed, true);
    assert.equal("productionOrigin" in ledger, false);
    assert.equal("authority" in ledger, false);
    assert.deepEqual(Object.keys(ledger).sort(), [
      "fixtureUsed",
      "modules",
      "origin",
      "schemaVersion",
    ]);
    // Only the two approved companion modules survive; every unrelated UE,
    // Windows, graphics, and third-party module is ignored.
    assert.equal(ledger.modules.length, 2);
    const names = new Set(ledger.modules.map(({ name }) => name));
    assert.deepEqual(names, new Set(fixture.installedFiles.map(({ name }) => name)));
    // Ledger module facts are the exact on-disk byte length/hash, relative
    // logical paths only, no absolute paths and no ModuleMemorySize.
    for (const module of ledger.modules) {
      assert.equal(module.path.split("/").length, 3);
      assert.equal(module.path.startsWith("Binaries/"), true);
      assert.equal(module.name, module.path.split("/").pop());
      const onDisk = resolve(fixture.installed, module.path.split("/").join("\\"));
      assert.equal(module.size, readFileSync(onDisk).length);
      assert.equal(module.sha256, sha256File(onDisk));
      assert.equal("moduleMemorySize" in module, false);
    }

    const output = resolve(fixture.base, "captures", "loaded-modules.json");
    mkdirSync(resolve(output, ".."));
    publishLoadedLedger(output, ledger);
    const written = JSON.parse(readFileSync(output, "utf8"));
    assert.deepEqual(written, ledger);
    // The temp file is gone after atomic publication.
    assert.equal(existsSync(`${output}.tmp`), false);

    // Exclusive: a second publication refuses to overwrite the final path.
    expectCode(() => publishLoadedLedger(output, ledger), "LOADED_WRITER_FINAL_EXISTS");
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("R6.2 a missing, extra, or shadow module rejects the reducer", () => {
  const fixture = createFixture();
  try {
    // Missing one approved module (even with all unrelated modules present).
    expectCode(
      () =>
        reduceLoadedModules({
          manifestModules: fixture.manifestModules,
          installedRoot: fixture.installed,
          observed: fixture.observed.filter(
            (entry) => entry.name !== fixture.installedFiles[1].name,
          ),
        }),
      "LOADED_WRITER_MODULE_MISSING",
    );

    // Extra companion candidate inside the approved installed root.
    const extraPath = resolve(
      fixture.installed,
      "Binaries",
      "Win64",
      "UnrealEditor-Unexpected.dll",
    );
    writeFileSync(extraPath, "extra-candidate\n", "utf8");
    expectCode(
      () =>
        reduceLoadedModules({
          manifestModules: fixture.manifestModules,
          installedRoot: fixture.installed,
          observed: [
            ...fixture.observed,
            { name: "UnrealEditor-Unexpected.dll", path: extraPath, moduleMemorySize: 128 },
          ],
        }),
      "LOADED_WRITER_MODULE_EXTRA",
    );

    // Shadow copy: approved name observed from a path outside the installed root.
    const shadowPath = resolve(fixture.base, "shadow-dir");
    mkdirSync(shadowPath);
    const shadow = resolve(shadowPath, fixture.installedFiles[0].name);
    writeFileSync(shadow, "shadow\n", "utf8");
    expectCode(
      () =>
        reduceLoadedModules({
          manifestModules: fixture.manifestModules,
          installedRoot: fixture.installed,
          observed: fixture.observed.map((entry) =>
            entry.name === fixture.installedFiles[0].name ? { ...entry, path: shadow } : entry,
          ),
        }),
      "LOADED_WRITER_MODULE_SHADOW",
    );

    // Duplicate observation of the same basename rejects the observation.
    expectCode(
      () =>
        reduceLoadedModules({
          manifestModules: fixture.manifestModules,
          installedRoot: fixture.installed,
          observed: [...fixture.observed, fixture.observed[0]],
        }),
      "LOADED_WRITER_OBSERVATION_INVALID",
    );
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("R6.2 a reparse/link installed module rejects the reducer", () => {
  const fixture = createFixture();
  try {
    const linkPath = resolve(fixture.installed, "Binaries", "Win64", "UnrealEditor-Linked.dll");
    const target = resolve(fixture.base, "linked-target.bin");
    writeFileSync(target, "linked-target-bytes\n", "utf8");
    try {
      symlinkSync(target, linkPath, "file");
    } catch (error) {
      if (!["EPERM", "EACCES"].includes(error?.code)) throw error;
      return;
    }
    const resolvedSize = readFileSync(linkPath).length;
    expectCode(
      () =>
        reduceLoadedModules({
          manifestModules: [
            {
              path: "Binaries/Win64/UnrealEditor-Linked.dll",
              size: resolvedSize,
              sha256: sha256File(linkPath),
            },
          ],
          installedRoot: fixture.installed,
          observed: [{ name: "UnrealEditor-Linked.dll", path: linkPath, moduleMemorySize: 64 }],
        }),
      "LOADED_WRITER_MODULE_INVALID",
    );
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("R7.1 caller bindings, injected observation, and standalone writer cannot mint production", () => {
  const fixture = createFixture();
  try {
    const structural = buildLoadedLedger({
      manifest: { modules: fixture.manifestModules },
      installedRoot: fixture.installed,
      observed: fixture.observed,
      identity: identity(),
      process: processFacts(),
    });
    const forged = {
      ...structural,
      productionOrigin: PRODUCTION_ORIGIN,
      fixtureUsed: false,
    };
    mkdirSync(resolve(fixture.base, "captures"));
    expectCode(
      () => publishLoadedLedger(resolve(fixture.base, "captures", "loaded-modules.json"), forged),
      "LOADED_WRITER_PRODUCTION_AUTHORITY_REQUIRED",
    );
    const injected = observeProcess(4567, { observe: () => fixtureObservation(fixture) });
    assert.equal(injected.fixtureUsed, true);
    expectCode(
      () =>
        publishProductionLoadedLedger(resolve(fixture.base, "captures", "loaded-modules.json"), {
          observation: injected,
        }),
      "LOADED_WRITER_PRODUCTION_OBSERVATION_REQUIRED",
    );
    expectCode(() => runObserver([]), "LOADED_WRITER_STANDALONE_PRODUCTION_ENTRY_REMOVED");
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("R6.2 observation identity validation rejects exit, inaccessible, and PID reuse", () => {
  const fixture = createFixture();
  try {
    const early = {
      rootPid: 4567,
      rootCreationFileTimeUtc: "133500000000000000",
    };
    // A live, accessible, matching observation is accepted.
    validateObservationIdentity(early, fixtureObservation(fixture));

    // Process exit race.
    expectCode(
      () => validateObservationIdentity(early, { alive: false, modules: [] }),
      "LOADED_WRITER_PROCESS_EXIT",
    );

    // Inaccessible module enumeration.
    expectCode(
      () =>
        validateObservationIdentity(early, {
          alive: true,
          modulesAccessible: false,
          creationFileTimeUtc: "133500000000000000",
          modules: [],
        }),
      "LOADED_WRITER_PROCESS_OBSERVATION_INVALID",
    );

    // PID reuse: creation identity changed while PID remains correct.
    expectCode(
      () =>
        validateObservationIdentity(early, {
          alive: true,
          pid: 4567,
          modulesAccessible: true,
          creationFileTimeUtc: "133599999999999999",
          modules: [],
        }),
      "LOADED_WRITER_PID_REUSE",
    );

    // A matching creation identity cannot substitute for the owned PID.
    expectCode(
      () =>
        validateObservationIdentity(early, {
          alive: true,
          pid: 7654,
          modulesAccessible: true,
          creationFileTimeUtc: early.rootCreationFileTimeUtc,
          modules: [],
        }),
      "LOADED_WRITER_PID_MISMATCH",
    );

    // The observer injection path returns the observation envelope.
    const observed = observeProcess(4567, { observe: () => fixtureObservation(fixture) });
    assert.equal(observed.alive, true);
    assert.equal(observed.modules.length, fixture.observed.length);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("R6.2 publication is exclusive, atomic, and rejects raw paths and pre-existing state", () => {
  const fixture = createFixture();
  try {
    const ledger = buildLoadedLedger({
      manifest: { modules: fixture.manifestModules },
      installedRoot: fixture.installed,
      observed: fixture.observed,
      identity: identity(),
      process: processFacts(),
    });
    const output = resolve(fixture.base, "captures", "loaded-modules.json");
    mkdirSync(resolve(output, ".."));

    // A raw absolute path anywhere in the ledger is rejected before writing.
    const rawLedger = structuredClone(ledger);
    rawLedger.modules[0].path = "C:\\installed\\Binaries\\Win64\\UnrealEditor-UAgentAssetTools.dll";
    expectCode(() => publishLoadedLedger(output, rawLedger), "LOADED_WRITER_RAW_PATH_REJECTED");
    assert.equal(existsSync(output), false);
    assert.equal(existsSync(`${output}.tmp`), false);

    // A pre-existing temp path is rejected without touching the final path.
    writeFileSync(`${output}.tmp`, "residue\n", "utf8");
    expectCode(() => publishLoadedLedger(output, ledger), "LOADED_WRITER_TEMP_EXISTS");
    rmSync(`${output}.tmp`, { force: true });

    // The final pathname is absent until the complete file is published.
    assert.equal(existsSync(output), false);
    publishLoadedLedger(output, ledger);
    assert.equal(existsSync(output), true);
    assert.equal(existsSync(`${output}.tmp`), false);

    // A pre-existing final path is rejected.
    expectCode(() => publishLoadedLedger(output, ledger), "LOADED_WRITER_FINAL_EXISTS");

    // A failed write cleans up its temp file (circular ledger cannot serialize).
    const circular = { name: "x" };
    circular.self = circular;
    const failedOutput = resolve(fixture.base, "captures", "failed.json");
    assert.throws(() => publishLoadedLedger(failedOutput, circular));
    assert.equal(existsSync(failedOutput), false);
    assert.equal(existsSync(`${failedOutput}.tmp`), false);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("R7.1 standalone observer is non-writing and exact-module structural JSON stays non-production", () => {
  const fixture = createFixture();
  try {
    const output = resolve(fixture.base, "captures", "loaded-modules.json");
    mkdirSync(resolve(output, ".."));
    expectCode(() => runObserver([]), "LOADED_WRITER_STANDALONE_PRODUCTION_ENTRY_REMOVED");
    const ledger = buildLoadedLedger({
      manifest: { modules: fixture.manifestModules },
      installedRoot: fixture.installed,
      observed: fixture.observed,
    });
    publishLoadedLedger(output, ledger);
    const written = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(written.schemaVersion, LOADED_LEDGER_SCHEMA);
    assert.equal(written.modules.length, 2);
    assert.equal(written.fixtureUsed, true);
    assert.equal("productionOrigin" in written, false);

    // Directly authored JSON cannot pass as production origin: a hand-written
    // manifest record whose SHA-256 does not match the installed file on disk
    // is rejected by the reducer, so no pre-authored ledger can claim to come
    // from a real process observation.
    const fakeManifest = fixture.manifestModules.map((item) => ({
      ...item,
      sha256: "f".repeat(64),
    }));
    expectCode(
      () =>
        reduceLoadedModules({
          manifestModules: fakeManifest,
          installedRoot: fixture.installed,
          observed: fixture.observed,
        }),
      "LOADED_WRITER_MODULE_INVALID",
    );
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});
