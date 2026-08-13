// R7.1/R7.4 real Windows live-process/module-observer integration regression.
//
// Starts harmless task-owned fixture processes through the actual Windows Job
// runner (`mvp15d-windows-job-process-runner.ps1`), loads task-owned
// copied/renamed DLLs from a temporary approved install root, and executes the
// real PowerShell process-module enumeration path while the process is alive.
// Proves:
//
//   - the early process identity is published while the process is alive;
//   - unrelated process modules are ignored;
//   - the exact observed fixture module is accepted through the sole branded
//     production authority publisher, while injected/direct ledgers fail;
//   - disk byte size/hash are recorded (never ModuleMemorySize);
//   - a shadow/extra companion candidate, PID creation mismatch, process exit,
//     inaccessible process, raw path, and pre-authored final ledger are
//     rejected;
//   - real intermediate Binaries/Win64 junction ancestors are rejected;
//   - final publication is absent until the complete file is ready;
//   - every task-owned fixture process and temporary file closes cleanly.

/* global process, Buffer */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { clearTimeout as clearTimer, setTimeout as setTimer } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import {
  EARLY_IDENTITY_SCHEMA,
  LOADED_LEDGER_SCHEMA,
  PRODUCTION_ORIGIN,
  buildLoadedLedger,
  observeProcess,
  publishLoadedLedger,
  publishProductionLoadedLedger,
  reduceLoadedModules,
  validateObservationIdentity,
} from "./mvp15d-loaded-module-observer.mjs";
import { computeSourceIdentity } from "./mvp15d-source-identity.mjs";

const RUNNER = resolve(process.cwd(), "scripts", "mvp15d-windows-job-process-runner.ps1");
const POWERSHELL_EXE = resolve(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
let markerSequence = 0;
function nextMarker() {
  markerSequence += 1;
  return `uagent-mvp15d-observer-integration-marker-${String(markerSequence).padStart(4, "0")}-${process.pid}`;
}
const TASK_ID = "TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-FINAL-D13-D16";
const SESSION = "uagent-mvp15d-observer-integration-session-0001";
const GENERATION = 1;
const FIXTURE_DIRECTORY_PREFIX = "uagent-observer-integration-";
const CLOSEOUT_GRACE_MILLISECONDS = 20_000;
const PROCESS_RELEASE_TIMEOUT_MILLISECONDS = 10_000;
const CLEANUP_RETRY_COUNT = 20;

function retainedBinding(kind, value) {
  return createHash("sha256")
    .update(`uagent.mvp15d.retained.${kind}.v1\0${String(value)}`, "utf8")
    .digest("hex");
}
const CLEANUP_RETRY_DELAY_MILLISECONDS = 250;

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function expectCode(action, code) {
  assert.throws(action, (error) => error instanceof Error && error.code === code);
}

// Compile a real managed DLL at `path` via the same Add-Type compiler that the
// Windows Job runner itself uses. The produced image is loadable and appears
// in the process module list.
function compileFixtureDll(path, className) {
  const source = `public class ${className} { public static string Ping() { return "uagent-fixture"; } }`;
  const result = runPowershell([
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `Add-Type -TypeDefinition '${source}' -OutputAssembly '${path}' -OutputType Library`,
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(path), true, `fixture DLL was not produced: ${path}`);
}

function runPowershell(args) {
  const result = spawnSync("powershell.exe", args, {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// Task-owned fixture loader script. PowerShell `-File` mode binds only the
// first value of a named array parameter, and quotes/backslashes do not
// survive the CreateProcess + `-File` parsing chain, so the DLL list travels
// as one base64-encoded JSON argument. The DLLs are loaded natively so they
// appear in the real Windows process-module list while the process is alive.
const FIXTURE_LOADER = `param([string]$ModulesBase64, [string]$StopPathBase64)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class UAgentNativeLoad {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr LoadLibrary(string path);
}
'@
$modules = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ModulesBase64)) | ConvertFrom-Json
$stopPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($StopPathBase64))
foreach ($module in $modules) {
    $handle = [UAgentNativeLoad]::LoadLibrary([string]$module)
    if ($handle -eq [IntPtr]::Zero) {
        Write-Error ("LOAD_FAILED: " + $module + " error=" + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
        exit 3
    }
    Write-Output ("LOADED: " + $module)
}
$deadline = [DateTime]::UtcNow.AddSeconds(30)
while (-not [IO.File]::Exists($stopPath) -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 100
}
`;

function fixtureCommand(base, dllPaths, stopPath, label) {
  const loaderPath = resolve(base, `${label}-fixture-load.ps1`);
  writeFileSync(loaderPath, FIXTURE_LOADER, "utf8");
  const modulesBase64 = Buffer.from(JSON.stringify(dllPaths), "utf8").toString("base64");
  const stopPathBase64 = Buffer.from(stopPath, "utf8").toString("base64");
  return {
    loaderPath,
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      loaderPath,
      "-ModulesBase64",
      modulesBase64,
      "-StopPathBase64",
      stopPathBase64,
    ],
  };
}

function spawnFixtureRunner(
  base,
  { dllPaths, timeoutMilliseconds, marker, identityPath, stdoutPath, stderrPath, stopPath, label },
) {
  const command = fixtureCommand(base, dllPaths, stopPath, label);
  const encodedArguments = Buffer.from(JSON.stringify(command.args), "utf8").toString("base64");
  return spawn(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      RUNNER,
      "-Executable",
      POWERSHELL_EXE,
      "-WorkingDirectory",
      base,
      "-ArgumentsBase64",
      encodedArguments,
      "-StdoutPath",
      stdoutPath,
      "-StderrPath",
      stderrPath,
      "-TaskMarker",
      marker,
      "-IdentityPath",
      identityPath,
      "-Session",
      SESSION,
      "-Generation",
      String(GENERATION),
      "-TimeoutMilliseconds",
      String(timeoutMilliseconds),
    ],
    { cwd: base, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
}

function waitForChild(child) {
  return new Promise((resolveChild) => {
    child.once("error", (error) => resolveChild({ status: null, error }));
    child.once("close", (status) => resolveChild({ status, error: null }));
  });
}

function withTimeout(promise, timeoutMilliseconds, message) {
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimer(() => reject(new Error(message)), timeoutMilliseconds);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimer(timeoutHandle));
}

async function waitForIdentity(identityPath, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (existsSync(identityPath)) {
      return JSON.parse(readFileSync(identityPath, "utf8"));
    }
    await delay(100);
  }
  throw new Error("early identity file not published");
}

async function waitAlive(pid, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const observation = observeProcess(pid);
    if (observation.alive) return observation;
    await delay(250);
  }
  throw new Error("fixture process never became observable");
}

// Poll observations until `predicate` holds. The fixture process compiles its
// loader and then loads the DLLs, so approved modules may only become visible
// after a bounded delay — exactly the live-polling semantics of the UE
// observation path.
async function waitForObservation(pid, predicate, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const observation = observeProcess(pid);
    if (observation.alive && predicate(observation)) return observation;
    await delay(500);
  }
  throw new Error("observation predicate never satisfied");
}

function parseJobLedger(stdout) {
  let ledger;
  try {
    ledger = JSON.parse(stdout.trim());
  } catch {
    assert.fail(`job ledger is not valid JSON: ${stdout}`);
  }
  return ledger;
}

function scanFixtureProcesses({ marker, base }) {
  const command = [
    "$ErrorActionPreference='Stop'",
    "$marker=[Environment]::GetEnvironmentVariable('UAGENT_FIXTURE_MARKER','Process')",
    "$base=[Environment]::GetEnvironmentVariable('UAGENT_FIXTURE_BASE','Process')",
    "$ids=@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {",
    "  $_.CommandLine -is [string] -and (",
    "    ($marker.Length -gt 0 -and $_.CommandLine.IndexOf($marker,[StringComparison]::Ordinal) -ge 0) -or",
    "    ($base.Length -gt 0 -and $_.CommandLine.IndexOf($base,[StringComparison]::OrdinalIgnoreCase) -ge 0)",
    "  )",
    "} | ForEach-Object { [int]$_.ProcessId })",
    "[pscustomobject]@{ processIds=@($ids) } | ConvertTo-Json -Compress -Depth 3",
  ].join("\n");
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
    {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        UAGENT_FIXTURE_MARKER: marker ?? "",
        UAGENT_FIXTURE_BASE: base ?? "",
      },
    },
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout.trim());
  assert.equal(
    Array.isArray(parsed.processIds),
    true,
    "fixture process scan did not return an array",
  );
  return parsed.processIds;
}

async function waitForNoFixtureProcesses(criteria) {
  const deadline = Date.now() + PROCESS_RELEASE_TIMEOUT_MILLISECONDS;
  let processIds = scanFixtureProcesses(criteria);
  while (processIds.length > 0 && Date.now() < deadline) {
    await delay(CLEANUP_RETRY_DELAY_MILLISECONDS);
    processIds = scanFixtureProcesses(criteria);
  }
  assert.deepEqual(processIds, [], `fixture process residue: ${processIds.join(",")}`);
}

async function removeDirectoryWithRetry(base) {
  let lastError;
  for (let attempt = 1; attempt <= CLEANUP_RETRY_COUNT; attempt += 1) {
    try {
      rmSync(base, { recursive: true, force: true });
      if (!existsSync(base)) return;
      lastError = new Error(`fixture directory still exists: ${base}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < CLEANUP_RETRY_COUNT) await delay(CLEANUP_RETRY_DELAY_MILLISECONDS);
  }
  throw lastError ?? new Error(`fixture directory cleanup failed: ${base}`);
}

function removeDirectoryWithRetrySync(base) {
  rmSync(base, {
    recursive: true,
    force: true,
    maxRetries: CLEANUP_RETRY_COUNT,
    retryDelay: CLEANUP_RETRY_DELAY_MILLISECONDS,
  });
  assert.equal(existsSync(base), false, `fixture directory still exists: ${base}`);
}

function startOwnedRunner(
  base,
  { dllPaths, timeoutMilliseconds, marker, identityPath, stdoutPath, stderrPath, label },
) {
  const stopPath = resolve(base, "metadata", `${label}.stop`);
  assert.equal(existsSync(stopPath), false, `fixture stop path already exists: ${stopPath}`);
  const child = spawnFixtureRunner(base, {
    dllPaths,
    timeoutMilliseconds,
    marker,
    identityPath,
    stdoutPath,
    stderrPath,
    stopPath,
    label,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  // Register the completion promise immediately. An awaited identity/assertion
  // failure must never lose the child `close` event or its Job closeout ledger.
  const childPromise = waitForChild(child);
  const runner = {
    base,
    marker,
    identityPath,
    stopPath,
    timeoutMilliseconds,
    child,
    childPromise,
    stdout: () => stdout,
    stderr: () => stderr,
    early: null,
    closePromise: null,
  };
  runner.ready = waitForIdentity(identityPath, 30_000).then((early) => {
    runner.early = early;
    return runner;
  });
  runner.close = () => {
    if (runner.closePromise) return runner.closePromise;
    runner.closePromise = (async () => {
      if (!existsSync(stopPath)) {
        writeFileSync(stopPath, `${marker}\n`, { encoding: "utf8", flag: "wx" });
      }
      let result;
      try {
        result = await withTimeout(
          childPromise,
          timeoutMilliseconds + CLOSEOUT_GRACE_MILLISECONDS,
          `fixture Job runner closeout timed out: ${marker}`,
        );
      } catch (error) {
        child.kill();
        await withTimeout(
          childPromise,
          CLOSEOUT_GRACE_MILLISECONDS,
          `fixture Job runner did not terminate: ${marker}`,
        );
        throw error;
      }
      assert.equal(result.error, null, result.error?.message);
      assert.equal(result.status, 0, `${stdout}\n${stderr}`);
      const ledger = parseJobLedger(stdout);
      assert.equal(ledger.TaskMarker, marker);
      assert.equal(ledger.ActiveProcessZeroObserved, true);
      assert.equal(ledger.FinalResidualCount, 0);
      assert.equal(ledger.FailureCode, "");
      return ledger;
    })();
    return runner.closePromise;
  };
  return runner;
}

async function finalizeRunner(runner) {
  const errors = [];
  let closeout;
  try {
    closeout = await runner.close();
  } catch (error) {
    errors.push(error);
  }
  try {
    await waitForNoFixtureProcesses({ marker: runner.marker });
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0)
    throw new AggregateError(errors, `fixture runner closeout failed: ${runner.marker}`);
  return closeout;
}

async function finalizeFixture(fixture) {
  const errors = [];
  let closeout;
  try {
    closeout = await finalizeRunner(fixture.runner);
  } catch (error) {
    errors.push(error);
  }
  try {
    await waitForNoFixtureProcesses({ base: fixture.base });
  } catch (error) {
    errors.push(error);
  }
  try {
    await removeDirectoryWithRetry(fixture.base);
  } catch (error) {
    errors.push(error);
  }
  if (existsSync(fixture.base)) {
    errors.push(new Error(`fixture directory residue: ${fixture.base}`));
  }
  try {
    await waitForNoFixtureProcesses({ marker: fixture.runner.marker, base: fixture.base });
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0)
    throw new AggregateError(errors, `fixture cleanup failed: ${fixture.base}`);
  return closeout;
}

// A complete fixture environment: approved install root, manifest, compiled
// DLLs, and one running fixture process with its early identity.
function createLiveFixture({ dlls, timeoutMilliseconds = 90_000 }) {
  const base = mkdtempSync(join(tmpdir(), FIXTURE_DIRECTORY_PREFIX));
  try {
    const repository = resolve(process.cwd());
    const sourceCommit = computeSourceIdentity(repository).compiledCommit;
    const projectPath = resolve(base, "FinalHost.uproject");
    writeFileSync(projectPath, `${JSON.stringify({ FileVersion: 3 })}\n`, "utf8");
    const packageRoot = resolve(base, "package", "UAgentAssetTools");
    const installed = resolve(base, "Plugins", "UAgentAssetTools");
    mkdirSync(resolve(packageRoot, "Binaries", "Win64"), { recursive: true });
    mkdirSync(resolve(installed, "Binaries", "Win64"), { recursive: true });
    const files = [];
    for (const [name, className] of dlls) {
      const path = resolve(installed, "Binaries", "Win64", name);
      compileFixtureDll(path, className);
      writeFileSync(resolve(packageRoot, "Binaries", "Win64", name), readFileSync(path));
      files.push({ name, path, size: readFileSync(path).length, sha256: sha256File(path) });
    }
    const manifestModules = files.map((item) => ({
      path: `Binaries/Win64/${item.name}`,
      size: item.size,
      sha256: item.sha256,
    }));
    const manifest = {
      taskId: TASK_ID,
      sourceCommit,
      artifacts: manifestModules,
      modules: manifestModules,
    };
    const manifestName = "UAgentAssetTools.mvp15-manifest.json";
    const manifestPath = resolve(packageRoot, manifestName);
    const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
    writeFileSync(manifestPath, manifestBytes, "utf8");
    writeFileSync(resolve(installed, manifestName), manifestBytes, "utf8");
    const identityPath = resolve(base, "metadata", `ue-automation.${SESSION}.early-identity.json`);
    const stdoutPath = resolve(base, "runtime.stdout.log");
    const stderrPath = resolve(base, "runtime.stderr.log");
    mkdirSync(resolve(identityPath, ".."), { recursive: true });
    const runner = startOwnedRunner(base, {
      dllPaths: files.map(({ path }) => path),
      timeoutMilliseconds,
      marker: nextMarker(),
      identityPath,
      stdoutPath,
      stderrPath,
      label: "primary",
    });
    return {
      base,
      repository,
      sourceCommit,
      projectPath,
      packageRoot,
      installed,
      manifest,
      manifestPath,
      files,
      manifestModules,
      identityPath,
      stdoutPath,
      stderrPath,
      runner,
      ready: runner.ready,
      get early() {
        return runner.early;
      },
      close: () => runner.close(),
    };
  } catch (error) {
    try {
      removeDirectoryWithRetrySync(base);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `fixture setup and cleanup failed: ${base}`);
    }
    throw error;
  }
}

function createJunctionAncestryFixture(component) {
  const base = mkdtempSync(join(tmpdir(), FIXTURE_DIRECTORY_PREFIX));
  try {
    const installed = resolve(base, "Plugins", "UAgentAssetTools");
    const targetRoot = resolve(base, "junction-target");
    const name = "UnrealEditor-UAgentAssetTools.dll";
    let junctionPath;
    let targetPath;
    if (component === "Binaries") {
      mkdirSync(installed, { recursive: true });
      targetPath = resolve(targetRoot, "Binaries");
      mkdirSync(resolve(targetPath, "Win64"), { recursive: true });
      junctionPath = resolve(installed, "Binaries");
    } else {
      mkdirSync(resolve(installed, "Binaries"), { recursive: true });
      targetPath = resolve(targetRoot, "Win64");
      mkdirSync(targetPath, { recursive: true });
      junctionPath = resolve(installed, "Binaries", "Win64");
    }
    symlinkSync(targetPath, junctionPath, "junction");
    const physicalPath = resolve(targetPath, component === "Binaries" ? "Win64" : "", name);
    compileFixtureDll(physicalPath, `UAgent${component}JunctionFixture`);
    const logicalPath = resolve(installed, "Binaries", "Win64", name);
    const module = {
      path: `Binaries/Win64/${name}`,
      size: readFileSync(physicalPath).length,
      sha256: sha256File(physicalPath),
    };
    return { base, installed, logicalPath, module };
  } catch (error) {
    try {
      removeDirectoryWithRetrySync(base);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `junction fixture setup and cleanup failed: ${base}`,
      );
    }
    throw error;
  }
}

function productionPublisherInputs(fixture, observation) {
  return {
    repository: fixture.repository,
    evidenceRoot: fixture.base,
    taskId: TASK_ID,
    taskMarker: fixture.early.taskMarker,
    sessionId: fixture.early.session,
    generation: fixture.early.generation,
    sourceCommit: fixture.sourceCommit,
    projectPath: fixture.projectPath,
    manifestPath: fixture.manifestPath,
    packageRoot: fixture.packageRoot,
    installedRoot: fixture.installed,
    executablePath: POWERSHELL_EXE,
    earlyIdentityPath: fixture.identityPath,
    earlyIdentity: fixture.early,
    observation,
    producerRelativePath: "scripts/mvp15d-final-ue-automation-producer.mjs",
  };
}

test(
  "R7.1/R7.4 real Windows fixture process: live authority, exact reduction, atomic ledger, zero residue",
  { skip: process.platform !== "win32", timeout: 240_000 },
  async () => {
    const fixture = createLiveFixture({
      dlls: [
        ["UnrealEditor-UAgentAssetTools.dll", "UAgentFixtureModule"],
        ["UnrealEditor-UAgentAssetToolsCore.dll", "UAgentFixtureCore"],
      ],
    });
    try {
      await fixture.ready;
      // The early identity binds every required fact and was published while
      // the process was alive.
      assert.equal(fixture.early.schemaVersion, EARLY_IDENTITY_SCHEMA);
      assert.match(
        fixture.early.taskMarker,
        /^uagent-mvp15d-observer-integration-marker-\d{4,}-\d+$/,
      );
      assert.equal(fixture.early.session, SESSION);
      assert.equal(fixture.early.generation, GENERATION);
      assert.ok(fixture.early.rootPid > 0);
      assert.match(String(fixture.early.rootCreationFileTimeUtc), /^[0-9]{1,30}$/);
      assert.equal(fixture.early.executableBasename, "powershell.exe");
      assert.match(fixture.early.executableSha256, /^[0-9a-f]{64}$/);

      // Real enumeration while the process is alive: creation identity
      // matches, module set is accessible, and the fixture process necessarily
      // loads many unrelated .NET/Windows modules. The fixture loader compiles
      // and then loads the approved DLLs, so the observation polls until the
      // approved modules are actually loaded (live-poll semantics).
      const observation = await waitForObservation(
        fixture.early.rootPid,
        (obs) =>
          fixture.files.every(({ name }) =>
            obs.modules.some((module) => module.name.toLowerCase() === name.toLowerCase()),
          ),
        30_000,
      );
      assert.equal(observation.creationFileTimeUtc, fixture.early.rootCreationFileTimeUtc);
      assert.equal(observation.modulesAccessible, true);
      assert.ok(observation.modules.length > 2, "fixture process should load unrelated modules");
      validateObservationIdentity(
        {
          rootPid: fixture.early.rootPid,
          rootCreationFileTimeUtc: fixture.early.rootCreationFileTimeUtc,
        },
        observation,
      );

      // Unrelated modules are ignored; only the exact approved companion
      // modules survive with their on-disk byte size/hash.
      const reduced = reduceLoadedModules({
        manifestModules: fixture.manifestModules,
        installedRoot: fixture.installed,
        observed: observation.modules,
      });
      assert.equal(reduced.length, 2);
      const reducedByName = new Map(reduced.map(({ name }) => [name, { size: 0, sha256: "" }]));
      for (const module of reduced) {
        reducedByName.set(module.name, module);
        assert.equal(module.path.startsWith("Binaries/Win64/"), true);
        assert.equal(module.path.split("/").length, 3);
        const onDisk = resolve(fixture.installed, module.path.split("/").join("\\"));
        assert.equal(module.size, readFileSync(onDisk).length, "disk byte length");
        assert.equal(module.sha256, sha256File(onDisk), "disk SHA-256");
      }
      for (const file of fixture.files) {
        assert.equal(reducedByName.has(file.name), true, file.name);
      }

      // The final ledger pathname is absent until the complete file is
      // published atomically (temp file + rename; no visible partial path).
      const ledgerPath = resolve(fixture.base, "captures", "loaded-modules.json");
      mkdirSync(resolve(ledgerPath, ".."), { recursive: true });
      assert.equal(existsSync(ledgerPath), false);
      assert.equal(existsSync(`${ledgerPath}.tmp`), false);
      const structuralLedger = buildLoadedLedger({
        manifest: { modules: fixture.manifestModules },
        installedRoot: fixture.installed,
        observed: observation.modules,
      });
      assert.equal(structuralLedger.fixtureUsed, true);
      assert.equal(structuralLedger.productionOrigin, undefined);
      assert.equal(structuralLedger.authority, undefined);
      expectCode(
        () =>
          publishLoadedLedger(ledgerPath, {
            ...structuralLedger,
            productionOrigin: PRODUCTION_ORIGIN,
            fixtureUsed: false,
          }),
        "LOADED_WRITER_PRODUCTION_AUTHORITY_REQUIRED",
      );

      // Injected observations are structurally valid test inputs but cannot
      // acquire the private brand issued by the real Win32 observation path.
      const injectedObservation = observeProcess(fixture.early.rootPid, {
        observe: () => observation,
      });
      expectCode(
        () =>
          publishProductionLoadedLedger(
            ledgerPath,
            productionPublisherInputs(fixture, injectedObservation),
          ),
        "LOADED_WRITER_PRODUCTION_OBSERVATION_REQUIRED",
      );

      const { ledger } = publishProductionLoadedLedger(
        ledgerPath,
        productionPublisherInputs(fixture, observation),
      );
      assert.equal(existsSync(ledgerPath), true);
      assert.equal(existsSync(`${ledgerPath}.tmp`), false);
      const written = JSON.parse(readFileSync(ledgerPath, "utf8"));
      assert.equal(written.schemaVersion, LOADED_LEDGER_SCHEMA);
      assert.equal(written.productionOrigin, PRODUCTION_ORIGIN);
      assert.equal(written.fixtureUsed, false);
      assert.equal(
        written.process.pidBindingSha256,
        retainedBinding("pid", fixture.early.rootPid),
      );
      assert.equal(
        written.process.creationFileTimeUtcBindingSha256,
        retainedBinding("creation-filetime", fixture.early.rootCreationFileTimeUtc),
      );
      assert.equal(written.process.executableSha256, fixture.early.executableSha256);

      // Copying every public production field does not copy the in-process
      // authority brand, so a hand-authored structurally exact ledger fails.
      const forgedPath = resolve(fixture.base, "captures", "forged-loaded-modules.json");
      expectCode(
        () => publishLoadedLedger(forgedPath, JSON.parse(JSON.stringify(ledger))),
        "LOADED_WRITER_PRODUCTION_AUTHORITY_REQUIRED",
      );
      assert.equal(existsSync(forgedPath), false);

      // Pre-authored final ledger paths remain exclusive.
      expectCode(() => publishLoadedLedger(ledgerPath, ledger), "LOADED_WRITER_FINAL_EXISTS");

      // The Job runner closes with zero residual processes.
      const closeout = await fixture.close();
      assert.equal(closeout.TaskMarker, fixture.early.taskMarker);
      assert.equal(closeout.ActiveProcessZeroObserved, true);
      assert.equal(closeout.FinalResidualCount, 0);
      assert.equal(closeout.FailureCode, "");
      assert.equal(closeout.RootPid, fixture.early.rootPid);
    } finally {
      await finalizeFixture(fixture);
    }
  },
);

test(
  "R7.4 real Windows fixture process: extra companion candidate and shadow copy are rejected",
  { skip: process.platform !== "win32", timeout: 240_000 },
  async () => {
    // Scenario A: an extra candidate inside the approved installed root that
    // is not in the manifest.
    const extraFixture = createLiveFixture({
      dlls: [
        ["UnrealEditor-UAgentAssetTools.dll", "UAgentFixtureModule"],
        ["UnrealEditor-UAgentAssetToolsExtra.dll", "UAgentFixtureExtra"],
      ],
    });
    try {
      await extraFixture.ready;
      const manifestModules = [extraFixture.manifestModules[0]];
      const approvedName = "UnrealEditor-UAgentAssetTools.dll";
      const observation = await waitForObservation(
        extraFixture.early.rootPid,
        (obs) => obs.modules.some((module) => module.name === approvedName),
        30_000,
      );
      assert.equal(observation.alive, true);
      expectCode(
        () =>
          reduceLoadedModules({
            manifestModules,
            installedRoot: extraFixture.installed,
            observed: observation.modules,
          }),
        "LOADED_WRITER_MODULE_EXTRA",
      );
    } finally {
      await finalizeFixture(extraFixture);
    }

    // Scenario B: a shadow copy of an approved name loaded from outside the
    // installed root.
    const shadowFixture = createLiveFixture({
      dlls: [["UnrealEditor-UAgentAssetTools.dll", "UAgentFixtureModule"]],
    });
    try {
      await shadowFixture.ready;
      const shadowRoot = resolve(shadowFixture.base, "shadow-root");
      mkdirSync(shadowRoot, { recursive: true });
      const shadowCopy = resolve(shadowRoot, "UnrealEditor-UAgentAssetTools.dll");
      const original = shadowFixture.files[0];
      writeFileSync(shadowCopy, readFileSync(original.path));
      // Load the shadow copy from outside the installed root in a second
      // fixture process.
      const shadowIdentityPath = resolve(shadowFixture.base, "metadata", "shadow-identity.json");
      const shadowStdoutPath = resolve(shadowFixture.base, "shadow.stdout.log");
      const shadowStderrPath = resolve(shadowFixture.base, "shadow.stderr.log");
      const shadowRunner = startOwnedRunner(shadowFixture.base, {
        dllPaths: [shadowCopy],
        timeoutMilliseconds: 60_000,
        marker: nextMarker(),
        identityPath: shadowIdentityPath,
        stdoutPath: shadowStdoutPath,
        stderrPath: shadowStderrPath,
        label: "shadow",
      });
      try {
        await shadowRunner.ready;
        const shadowEarly = shadowRunner.early;
        // Wait until the shadow copy is actually loaded, then reduce: the
        // installed root still holds the approved file, so the approved name
        // observed from outside the root is rejected as a shadow copy.
        const shadowObservation = await waitForObservation(
          shadowEarly.rootPid,
          (obs) =>
            obs.modules.some((module) => module.name === "UnrealEditor-UAgentAssetTools.dll"),
          30_000,
        );
        expectCode(
          () =>
            reduceLoadedModules({
              manifestModules: [shadowFixture.manifestModules[0]],
              installedRoot: shadowFixture.installed,
              observed: shadowObservation.modules,
            }),
          "LOADED_WRITER_MODULE_SHADOW",
        );
      } finally {
        await finalizeRunner(shadowRunner);
      }
    } finally {
      await finalizeFixture(shadowFixture);
    }
  },
);

test(
  "R7.1/R7.4 real Windows observation rejects PID mismatch/reuse, process exit, and inaccessible processes",
  { skip: process.platform !== "win32", timeout: 240_000 },
  async () => {
    const fixture = createLiveFixture({
      dlls: [["UnrealEditor-UAgentAssetTools.dll", "UAgentFixtureModule"]],
    });
    try {
      await fixture.ready;
      const observation = await waitAlive(fixture.early.rootPid, 15_000);

      // Correct creation identity with a different expected PID is rejected.
      expectCode(
        () =>
          validateObservationIdentity(
            {
              rootPid: fixture.early.rootPid + 1,
              rootCreationFileTimeUtc: fixture.early.rootCreationFileTimeUtc,
            },
            observation,
          ),
        "LOADED_WRITER_PID_MISMATCH",
      );

      // PID reuse: a different creation identity is rejected.
      expectCode(
        () =>
          validateObservationIdentity(
            { rootPid: fixture.early.rootPid, rootCreationFileTimeUtc: "123" },
            observation,
          ),
        "LOADED_WRITER_PID_REUSE",
      );

      // Process exit: after the fixture exits, the real enumeration reports
      // alive:false and the observation is rejected.
      const closeout = await fixture.close();
      assert.equal(closeout.FinalResidualCount, 0);
      assert.equal(closeout.FailureCode, "");
      const afterExit = observeProcess(fixture.early.rootPid);
      assert.equal(afterExit.alive, false);
      expectCode(
        () =>
          validateObservationIdentity(
            {
              rootPid: fixture.early.rootPid,
              rootCreationFileTimeUtc: fixture.early.rootCreationFileTimeUtc,
            },
            afterExit,
          ),
        "LOADED_WRITER_PROCESS_EXIT",
      );

      // Inaccessible process: PID 4 (System) module enumeration is denied for
      // a non-elevated observer. When the environment cannot provide this
      // case, the check is recorded rather than failing the regression.
      const systemProbe = observeProcess(4);
      if (systemProbe.alive) {
        if (systemProbe.modulesAccessible === false) {
          expectCode(
            () =>
              validateObservationIdentity(
                { rootPid: 4, rootCreationFileTimeUtc: "0" },
                systemProbe,
              ),
            "LOADED_WRITER_PROCESS_OBSERVATION_INVALID",
          );
        } else {
          process.stdout.write(
            `${JSON.stringify({
              status: "integration_inaccessible_probe_elevated",
              note: "PID 4 module enumeration was accessible; access-denied path already proven by injected unit tests",
            })}\n`,
          );
        }
      }
    } finally {
      await finalizeFixture(fixture);
    }
  },
);

test(
  "R7.4 real Windows junction ancestry: intermediate Binaries and Win64 are rejected",
  { skip: process.platform !== "win32", timeout: 120_000 },
  async (context) => {
    for (const component of ["Binaries", "Win64"]) {
      await context.test(`${component} junction`, async () => {
        const fixture = createJunctionAncestryFixture(component);
        try {
          expectCode(
            () =>
              reduceLoadedModules({
                manifestModules: [fixture.module],
                installedRoot: fixture.installed,
                observed: [
                  {
                    name: "UnrealEditor-UAgentAssetTools.dll",
                    path: fixture.logicalPath,
                    moduleMemorySize: fixture.module.size,
                  },
                ],
              }),
            "LOADED_WRITER_MODULE_INVALID",
          );
        } finally {
          await removeDirectoryWithRetry(fixture.base);
          assert.equal(
            existsSync(fixture.base),
            false,
            `junction fixture residue: ${fixture.base}`,
          );
        }
      });
    }
  },
);

test.after(async () => {
  if (process.platform !== "win32") return;
  const residualDirectories = readdirSync(tmpdir(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(FIXTURE_DIRECTORY_PREFIX))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));
  assert.deepEqual(residualDirectories, [], "observer integration temporary directory residue");
  await waitForNoFixtureProcesses({ marker: "uagent-mvp15d-observer-integration-marker-" });
});
