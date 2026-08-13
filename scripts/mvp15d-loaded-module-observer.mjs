#!/usr/bin/env node
/* global process */

// R6.2 production UE loaded-module ledger writer.
//
// The UE live producer must obtain `captures/loaded-modules.json` from a real
// process observation while that process is still alive, never from a
// caller-authored or fixture JSON. This repository-owned, task-only observer:
//
//  1. enumerates the actual task-owned live PID through the real Windows
//     process-module path (`Get-Process -Module`) and rechecks the process
//     creation identity against the Job runner's early identity before
//     accepting observations (PID-reuse rejection);
//  2. selects only modules that are candidates for the approved UAgent
//     companion set by exact canonical installed-root and approved manifest
//     identity, ignoring unrelated UE, Windows, graphics, runtime, and
//     third-party modules;
//  3. rejects missing approved modules, duplicate/shadow copies, extra
//     companion candidates, links/reparse points, path escape, inaccessible
//     observation, process-exit races, and PID reuse;
//  4. derives ledger `size` and `sha256` from the canonical on-disk file
//     (never `ModuleMemorySize`, which is a memory-resident image size);
//  5. binds the full R5.2 identity (task, marker, source, session/generation,
//     process creation identity, executable hash, redacted project identity,
//     manifest/package/installed-root identity, production origin) and
//     serializes only approved relative logical module facts;
//  6. publishes through one exclusive atomic writer: complete temp file in the
//     final directory with exclusive creation, flush/fsync, close, then rename
//     to the previously absent final pathname; a pre-existing temp or final
//     path is rejected and a failed temp file is cleaned up.

import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeSourceIdentity } from "./mvp15d-source-identity.mjs";

export const LOADED_LEDGER_SCHEMA = "uagent.mvp15d.final.loaded-modules.v2";
export const EARLY_IDENTITY_SCHEMA = "uagent.mvp15d.windows-job-process-identity.v1";
export const PRODUCTION_ORIGIN = "uagent.windows-job-module-observation.v1";
export const PRODUCTION_AUTHORITY_SCHEMA = "uagent.mvp15d.loaded-module-production-authority.v1";

const TASK_GENERATION = "final-d13-d16";
const STRUCTURAL_ORIGIN = "test_only_loaded_module_reduction";
const REAL_OBSERVATIONS = new WeakSet();
const PRODUCTION_LEDGERS = new WeakSet();
const PRODUCTION_SOURCE_PATHS = Object.freeze({
  producer: "scripts/mvp15d-final-ue-automation-producer.mjs",
  helper: "scripts/mvp15d-final-live-producer-helper.mjs",
  observer: "scripts/mvp15d-loaded-module-observer.mjs",
  jobRunner: "scripts/mvp15d-windows-job-process-runner.ps1",
});

// Any observed module path that is absolute is a raw-path leak candidate; the
// ledger must only ever serialize approved relative logical paths.
const RAW_PATH_PATTERN = /^[A-Za-z]:[\\/]|^\\\\|^\/|[\\/][A-Za-z]:[\\/]/;
const MODULE_NAME_PATTERN = /^UnrealEditor-[A-Za-z0-9_.-]+\.dll$/;
const FILETIME_PATTERN = /^[0-9]{1,30}$/;

class LoadedModuleError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new LoadedModuleError(code);
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function retainedBinding(kind, value) {
  return sha256Bytes(Buffer.from(`uagent.mvp15d.retained.${kind}.v1\0${String(value)}`, "utf8"));
}

function stable(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
    .join(",")}}`;
}

function isHex(value, length) {
  return typeof value === "string" && new RegExp(`^[0-9a-f]{${length}}$`).test(value);
}

function within(root, candidate) {
  const value = relative(root, candidate);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function samePath(left, right) {
  if (process.platform === "win32") return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

function requireDirectory(path, code) {
  if (!existsSync(path)) fail(code);
  const stats = lstatSync(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) fail(code);
  return resolve(path);
}

function requireRegularFile(path, code) {
  if (!existsSync(path)) fail(code);
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink()) fail(code);
  return path;
}

// Reject every link/reparse-like ancestor from the trusted root through the
// leaf. On Windows, Node exposes junctions and mount-point links through
// lstat().isSymbolicLink(); the real-path comparison additionally rejects an
// ancestor that resolves outside (or aliases away from) the trusted tree.
function requireContainedRegularFile(trustedRoot, candidate, code) {
  const root = requireDirectory(resolve(trustedRoot), code);
  const leaf = resolve(candidate);
  if (!within(root, leaf)) fail(code);
  const logical = relative(root, leaf);
  if (
    !logical ||
    isAbsolute(logical) ||
    logical.split(/[\\/]/u).some((part) => !part || part === "..")
  ) {
    fail(code);
  }
  let current = root;
  const components = logical.split(/[\\/]/u);
  for (let index = 0; index < components.length; index += 1) {
    current = resolve(current, components[index]);
    if (!existsSync(current)) fail(code);
    const stats = lstatSync(current);
    if (stats.isSymbolicLink()) fail(code);
    if (index === components.length - 1 ? !stats.isFile() : !stats.isDirectory()) fail(code);
  }
  const canonicalRoot = realpathSync.native(root);
  const canonicalLeaf = realpathSync.native(leaf);
  if (!within(canonicalRoot, canonicalLeaf) || !samePath(canonicalLeaf, leaf)) fail(code);
  return leaf;
}

function fileDescriptor(repository, logicalPath, code = "LOADED_WRITER_AUTHORITY_INVALID") {
  const path = requireContainedRegularFile(
    repository,
    resolve(repository, logicalPath.split("/").join("\\")),
    code,
  );
  const stats = lstatSync(path);
  return { relativePath: logicalPath, size: stats.size, sha256: sha256File(path) };
}

// Parse a manifest JSON and its `modules` (approved companion modules).
function readManifestModules(manifestPath) {
  if (!existsSync(manifestPath)) fail("LOADED_WRITER_MANIFEST_INVALID");
  let manifest;
  try {
    manifest = JSON.parse(
      readFileSync(requireRegularFile(manifestPath, "LOADED_WRITER_MANIFEST_INVALID"), "utf8"),
    );
  } catch {
    fail("LOADED_WRITER_MANIFEST_INVALID");
  }
  if (
    !manifest ||
    typeof manifest !== "object" ||
    !Array.isArray(manifest.modules) ||
    manifest.modules.length === 0
  ) {
    fail("LOADED_WRITER_MANIFEST_INVALID");
  }
  return manifest.modules.map((record, index) => {
    if (
      !record ||
      typeof record !== "object" ||
      typeof record.path !== "string" ||
      record.path.split("/").length !== 3 ||
      record.path.split("/")[0] !== "Binaries" ||
      !MODULE_NAME_PATTERN.test(record.path.split("/").pop()) ||
      !Number.isSafeInteger(record.size) ||
      record.size < 1 ||
      !isHex(record.sha256, 64)
    ) {
      fail("LOADED_WRITER_MANIFEST_INVALID");
    }
    return { index, path: record.path, size: record.size, sha256: record.sha256 };
  });
}

// ---- real Windows process-module observation -----------------------------

// Real enumeration of the task-owned live PID through the Windows
// process-module path. Returns the observation envelope:
//   { pid, alive, creationFileTimeUtc, modulesAccessible, modules }
// `modules` entries are `{ name, path, moduleMemorySize }`; `ModuleMemorySize`
// is a memory-resident image size observation fact and is never compared to or
// substituted for the on-disk byte length. A dead PID reports `alive: false` so
// callers can distinguish exit races from enumeration errors.
export function observeProcess(pid, { observe } = {}) {
  if (typeof observe === "function") {
    const observation = observe(pid);
    if (
      !observation ||
      typeof observation !== "object" ||
      typeof observation.alive !== "boolean" ||
      !Array.isArray(observation.modules)
    ) {
      fail("LOADED_WRITER_PROCESS_OBSERVATION_INVALID");
    }
    return { ...observation, fixtureUsed: true };
  }
  if (process.platform !== "win32") fail("LOADED_WRITER_WINDOWS_REQUIRED");
  const command =
    `$ErrorActionPreference='Stop'; ` +
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; ` +
    `if ($null -eq $p) { Write-Output '{"alive":false}'; exit 0 }; ` +
    `$modules = @(); $accessible = $true; ` +
    `try { ` +
    `$modules = @($p.Modules | ForEach-Object { [pscustomobject]@{ ModuleName = $_.ModuleName; FileName = $_.FileName; ModuleMemorySize = $_.ModuleMemorySize } }) ` +
    `} catch { $accessible = $false }; ` +
    `$creation = ''; try { $creation = $p.StartTime.ToUniversalTime().ToFileTimeUtc().ToString() } catch { }; ` +
    `[pscustomobject]@{ pid = $p.Id; alive = $true; creationFileTimeUtc = $creation; modulesAccessible = $accessible; modules = $modules } | ConvertTo-Json -Compress -Depth 4`;
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
    { encoding: "utf8", shell: false, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0) fail("LOADED_WRITER_PROCESS_OBSERVATION_INVALID");
  let parsed;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    fail("LOADED_WRITER_PROCESS_OBSERVATION_INVALID");
  }
  if (!parsed || typeof parsed !== "object" || typeof parsed.alive !== "boolean") {
    fail("LOADED_WRITER_PROCESS_OBSERVATION_INVALID");
  }
  if (!parsed.alive) return { pid, alive: false, modules: [] };
  const modules = Array.isArray(parsed.modules) ? parsed.modules : [];
  const observation = {
    pid: Number.isSafeInteger(parsed.pid) && parsed.pid > 0 ? parsed.pid : pid,
    alive: true,
    creationFileTimeUtc:
      typeof parsed.creationFileTimeUtc === "string" ? parsed.creationFileTimeUtc : "",
    modulesAccessible: parsed.modulesAccessible === true,
    modules: modules
      .filter((entry) => entry && typeof entry.FileName === "string" && entry.FileName.length > 0)
      .map((entry) => ({
        name: entry.ModuleName,
        path: entry.FileName,
        moduleMemorySize: Number.isSafeInteger(entry.ModuleMemorySize)
          ? entry.ModuleMemorySize
          : undefined,
      })),
  };
  REAL_OBSERVATIONS.add(observation);
  return observation;
}

// Recheck the observed live process against the Job runner's early identity
// before any observation is accepted: the process must still be alive, its
// module set must be accessible, and its creation identity must match (PID
// reuse rejection).
export function validateObservationIdentity(earlyIdentity, observation) {
  if (!observation || typeof observation !== "object") {
    fail("LOADED_WRITER_PROCESS_OBSERVATION_INVALID");
  }
  if (observation.alive !== true) fail("LOADED_WRITER_PROCESS_EXIT");
  if (observation.modulesAccessible !== true) {
    fail("LOADED_WRITER_PROCESS_OBSERVATION_INVALID");
  }
  if (
    !earlyIdentity ||
    !Number.isSafeInteger(earlyIdentity.rootPid) ||
    earlyIdentity.rootPid < 1 ||
    observation.pid !== earlyIdentity.rootPid
  ) {
    fail("LOADED_WRITER_PID_MISMATCH");
  }
  if (
    typeof earlyIdentity.rootCreationFileTimeUtc !== "string" ||
    observation.creationFileTimeUtc !== earlyIdentity.rootCreationFileTimeUtc
  ) {
    fail("LOADED_WRITER_PID_REUSE");
  }
  return true;
}

// ---- reduction -------------------------------------------------------------

// Reduce the actual observed module set against the approved manifest modules.
// Only modules that are candidates for the approved UAgent companion set by
// exact canonical installed-root and approved manifest identity are accepted;
// unrelated UE/Windows/graphics/runtime/third-party modules are ignored.
// Rejects missing approved modules, duplicate/shadow copies, extra companion
// candidates, links/reparse points, path escape, and expected-list
// substitution. `observed` entries carry `{ name, path, moduleMemorySize? }`.
function reduceLoadedModules(input) {
  const { manifestModules, installedRoot } = input;
  const installed = requireDirectory(installedRoot, "LOADED_WRITER_INSTALLED_INVALID");
  if (!Array.isArray(input.observed)) fail("LOADED_WRITER_OBSERVATION_INVALID");

  const approvedByLogical = new Map();
  const approvedByName = new Map();
  for (const module of manifestModules) {
    if (
      !module ||
      typeof module !== "object" ||
      typeof module.path !== "string" ||
      module.path.split("/").length !== 3 ||
      module.path.split("/")[0] !== "Binaries" ||
      !MODULE_NAME_PATTERN.test(module.path.split("/").pop()) ||
      !Number.isSafeInteger(module.size) ||
      module.size < 1 ||
      !isHex(module.sha256, 64)
    ) {
      fail("LOADED_WRITER_MANIFEST_INVALID");
    }
    const name = basename(module.path);
    const folded = name.toLowerCase();
    if (approvedByLogical.has(module.path) || approvedByName.has(folded)) {
      fail("LOADED_WRITER_MANIFEST_INVALID");
    }
    approvedByLogical.set(module.path, module);
    approvedByName.set(folded, module);
  }

  const installedLogical = installed.toLowerCase();
  const observedWithinRootByName = new Map();
  const seenNames = new Set();
  for (const entry of input.observed) {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.name !== "string" ||
      entry.name.length === 0 ||
      entry.name.includes("/") ||
      entry.name.includes("\\") ||
      typeof entry.path !== "string" ||
      !isAbsolute(entry.path)
    ) {
      fail("LOADED_WRITER_OBSERVATION_INVALID");
    }
    if (
      entry.moduleMemorySize !== undefined &&
      (!Number.isSafeInteger(entry.moduleMemorySize) || entry.moduleMemorySize < 1)
    ) {
      fail("LOADED_WRITER_OBSERVATION_INVALID");
    }
    const folded = entry.name.toLowerCase();
    if (seenNames.has(folded)) fail("LOADED_WRITER_OBSERVATION_INVALID");
    seenNames.add(folded);

    const canonicalPath = resolve(entry.path).toLowerCase();
    let relativeLogical = null;
    if (canonicalPath === installedLogical) {
      relativeLogical = "";
    } else if (
      canonicalPath.startsWith(`${installedLogical}\\`) ||
      canonicalPath.startsWith(`${installedLogical}/`)
    ) {
      relativeLogical = canonicalPath.slice(installedLogical.length + 1);
    }

    if (approvedByName.has(folded)) {
      // An approved name observed from any path other than its exact installed
      // file is a shadow copy. A duplicate observation of the approved name is
      // also a shadow copy.
      const approved = approvedByName.get(folded);
      const expectedLogical = approved.path.split("/").join("\\").toLowerCase();
      if (relativeLogical === null || relativeLogical.toLowerCase() !== expectedLogical) {
        fail("LOADED_WRITER_MODULE_SHADOW");
      }
      if (observedWithinRootByName.has(folded)) fail("LOADED_WRITER_MODULE_SHADOW");
      observedWithinRootByName.set(folded, { entry, approved });
    } else if (relativeLogical !== null) {
      // Any observed module inside the approved installed root that is not in
      // the approved manifest is an extra companion candidate.
      fail("LOADED_WRITER_MODULE_EXTRA");
    }
    // Every other observed module (UE, Windows, graphics, runtime, third-party)
    // is unrelated and deliberately ignored.
  }

  const modules = [];
  for (const module of manifestModules) {
    const folded = basename(module.path).toLowerCase();
    const observed = observedWithinRootByName.get(folded);
    if (!observed) fail("LOADED_WRITER_MODULE_MISSING");
    const expected = resolve(installed, module.path.split("/").join("\\"));
    if (!within(installed, expected)) fail("LOADED_WRITER_MODULE_ESCAPE");
    const real = requireContainedRegularFile(installed, expected, "LOADED_WRITER_MODULE_INVALID");
    if (!samePath(observed.entry.path, real)) fail("LOADED_WRITER_MODULE_SHADOW");
    const stats = lstatSync(real);
    if (stats.size !== module.size || sha256File(real) !== module.sha256) {
      fail("LOADED_WRITER_MODULE_INVALID");
    }
    modules.push({
      path: module.path,
      name: basename(module.path),
      size: stats.size,
      sha256: sha256File(real),
    });
  }
  modules.sort((left, right) => left.path.localeCompare(right.path, "en"));
  return modules;
}

// ---- ledger construction ---------------------------------------------------

// Pure reduction helper. Its result is deliberately fixture-labelled and has
// no production origin or authority proof. Production publication is only
// available through publishProductionLoadedLedger() below.
function buildLoadedLedger({ manifest, installedRoot, observed }) {
  const modules = reduceLoadedModules({
    manifestModules: manifest.modules,
    installedRoot,
    observed,
  });
  return {
    schemaVersion: LOADED_LEDGER_SCHEMA,
    origin: STRUCTURAL_ORIGIN,
    fixtureUsed: true,
    modules,
  };
}

function readJsonObject(path, code) {
  try {
    const value = JSON.parse(readFileSync(requireRegularFile(path, code), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
    return value;
  } catch (error) {
    if (error instanceof LoadedModuleError) throw error;
    fail(code);
  }
}

function inventoryFromManifest(root, records, code) {
  if (!Array.isArray(records) || records.length === 0) fail(code);
  const paths = new Set();
  const result = records.map((record) => {
    if (
      !record ||
      typeof record !== "object" ||
      Array.isArray(record) ||
      typeof record.path !== "string" ||
      record.path.includes("\\") ||
      isAbsolute(record.path) ||
      record.path.split("/").some((part) => !part || part === "." || part === "..") ||
      paths.has(record.path.toLowerCase()) ||
      !Number.isSafeInteger(record.size) ||
      record.size < 1 ||
      !isHex(record.sha256, 64)
    ) {
      fail(code);
    }
    paths.add(record.path.toLowerCase());
    const path = requireContainedRegularFile(
      root,
      resolve(root, record.path.split("/").join("\\")),
      code,
    );
    const stats = lstatSync(path);
    if (stats.size !== record.size || sha256File(path) !== record.sha256) fail(code);
    return { path: record.path, size: stats.size, sha256: sha256File(path) };
  });
  return result.sort((left, right) => left.path.localeCompare(right.path, "en"));
}

function validateEarlyAuthority(identity, inputs, executablePath) {
  const expectedKeys = [
    "executableBasename",
    "executableSha256",
    "generation",
    "rootCreationFileTimeUtc",
    "rootPid",
    "schemaVersion",
    "session",
    "taskMarker",
  ]
    .sort()
    .join(",");
  if (
    !identity ||
    typeof identity !== "object" ||
    Array.isArray(identity) ||
    Object.keys(identity).sort().join(",") !== expectedKeys ||
    identity.schemaVersion !== EARLY_IDENTITY_SCHEMA ||
    identity.taskMarker !== inputs.taskMarker ||
    identity.session !== inputs.sessionId ||
    identity.generation !== inputs.generation ||
    !Number.isSafeInteger(identity.rootPid) ||
    identity.rootPid < 1 ||
    !FILETIME_PATTERN.test(identity.rootCreationFileTimeUtc) ||
    identity.executableBasename !== basename(executablePath) ||
    identity.executableSha256 !== sha256File(executablePath)
  ) {
    fail("LOADED_WRITER_AUTHORITY_INVALID");
  }
  return identity;
}

function authorityBindingMaterial(ledger) {
  return {
    schemaVersion: ledger.schemaVersion,
    productionOrigin: ledger.productionOrigin,
    fixtureUsed: ledger.fixtureUsed,
    taskGeneration: ledger.taskGeneration,
    taskId: ledger.taskId,
    taskMarkerSha256: ledger.taskMarkerSha256,
    sessionBindingSha256: ledger.sessionBindingSha256,
    generation: ledger.generation,
    sourceCommit: ledger.sourceCommit,
    sourceTreeSha256: ledger.sourceTreeSha256,
    sourceDirty: ledger.sourceDirty,
    project: ledger.project,
    manifest: ledger.manifest,
    package: ledger.package,
    installedRoot: ledger.installedRoot,
    process: ledger.process,
    modules: ledger.modules,
    processIdentitySha256: ledger.authority.processIdentitySha256,
    sources: ledger.authority.sources,
  };
}

// The sole production constructor/publisher. All public identity values are
// cross-checked against task-owned files or independently recomputed here. The
// observation must be the live object returned by the real Windows observer;
// injected observations cannot acquire production authority.
export function publishProductionLoadedLedger(finalPath, inputs) {
  if (process.platform !== "win32" || !REAL_OBSERVATIONS.has(inputs?.observation)) {
    fail("LOADED_WRITER_PRODUCTION_OBSERVATION_REQUIRED");
  }
  const repository = requireDirectory(
    resolve(inputs.repository),
    "LOADED_WRITER_AUTHORITY_INVALID",
  );
  const evidenceRoot = requireDirectory(
    resolve(inputs.evidenceRoot),
    "LOADED_WRITER_AUTHORITY_INVALID",
  );
  const packageRoot = requireDirectory(
    resolve(inputs.packageRoot),
    "LOADED_WRITER_AUTHORITY_INVALID",
  );
  const installedRoot = requireDirectory(
    resolve(inputs.installedRoot),
    "LOADED_WRITER_AUTHORITY_INVALID",
  );
  const projectPath = requireContainedRegularFile(
    evidenceRoot,
    resolve(inputs.projectPath),
    "LOADED_WRITER_AUTHORITY_INVALID",
  );
  const manifestPath = requireContainedRegularFile(
    packageRoot,
    resolve(inputs.manifestPath),
    "LOADED_WRITER_AUTHORITY_INVALID",
  );
  const executablePath = requireRegularFile(
    resolve(inputs.executablePath),
    "LOADED_WRITER_AUTHORITY_INVALID",
  );
  if (
    !within(evidenceRoot, packageRoot) ||
    !within(evidenceRoot, installedRoot) ||
    resolve(inputs.earlyIdentityPath) !==
      resolve(evidenceRoot, "metadata", `ue-automation.${inputs.sessionId}.early-identity.json`) ||
    resolve(finalPath) !== resolve(evidenceRoot, "captures", "loaded-modules.json") ||
    inputs.producerRelativePath !== PRODUCTION_SOURCE_PATHS.producer ||
    !/^TASK-MVP15D-[A-Z0-9-]+$/.test(inputs.taskId) ||
    !/^[A-Za-z0-9._:-]{24,160}$/.test(inputs.taskMarker) ||
    !/^[A-Za-z0-9._:-]{16,160}$/.test(inputs.sessionId) ||
    !Number.isSafeInteger(inputs.generation) ||
    inputs.generation < 1 ||
    !isHex(inputs.sourceCommit, 40)
  ) {
    fail("LOADED_WRITER_AUTHORITY_INVALID");
  }
  const earlyIdentity = validateEarlyAuthority(inputs.earlyIdentity, inputs, executablePath);
  const publishedEarlyIdentity = readJsonObject(
    resolve(inputs.earlyIdentityPath),
    "LOADED_WRITER_AUTHORITY_INVALID",
  );
  if (stable(publishedEarlyIdentity) !== stable(earlyIdentity)) {
    fail("LOADED_WRITER_AUTHORITY_INVALID");
  }
  validateObservationIdentity(earlyIdentity, inputs.observation);
  const publicationObservation = observeProcess(earlyIdentity.rootPid);
  validateObservationIdentity(earlyIdentity, publicationObservation);

  const manifest = readJsonObject(manifestPath, "LOADED_WRITER_MANIFEST_INVALID");
  if (
    manifest.taskId !== inputs.taskId ||
    manifest.sourceCommit !== inputs.sourceCommit ||
    !Array.isArray(manifest.artifacts) ||
    !Array.isArray(manifest.modules)
  ) {
    fail("LOADED_WRITER_MANIFEST_INVALID");
  }
  const source = computeSourceIdentity(repository);
  if (source.compiledCommit !== inputs.sourceCommit) fail("LOADED_WRITER_SOURCE_INVALID");
  const packageArtifacts = inventoryFromManifest(
    packageRoot,
    manifest.artifacts,
    "LOADED_WRITER_PACKAGE_INVALID",
  );
  const installedArtifacts = inventoryFromManifest(
    installedRoot,
    manifest.artifacts,
    "LOADED_WRITER_INSTALLED_INVALID",
  );
  if (stable(packageArtifacts) !== stable(installedArtifacts)) {
    fail("LOADED_WRITER_INSTALLED_INVALID");
  }
  const installedManifest = requireContainedRegularFile(
    installedRoot,
    resolve(installedRoot, basename(manifestPath)),
    "LOADED_WRITER_INSTALLED_INVALID",
  );
  if (sha256File(installedManifest) !== sha256File(manifestPath)) {
    fail("LOADED_WRITER_INSTALLED_INVALID");
  }
  const modules = reduceLoadedModules({
    manifestModules: manifest.modules,
    installedRoot,
    observed: publicationObservation.modules,
  });
  const authority = {
    schemaVersion: PRODUCTION_AUTHORITY_SCHEMA,
    processIdentitySha256: sha256Bytes(
      Buffer.from(
        stable({
          pidBindingSha256: retainedBinding("pid", earlyIdentity.rootPid),
          creationFileTimeUtcBindingSha256: retainedBinding(
            "creation-filetime",
            earlyIdentity.rootCreationFileTimeUtc,
          ),
          executableBasename: earlyIdentity.executableBasename,
          executableSha256: earlyIdentity.executableSha256,
        }),
        "utf8",
      ),
    ),
    sources: {
      phaseProducer: fileDescriptor(repository, PRODUCTION_SOURCE_PATHS.producer),
      helper: fileDescriptor(repository, PRODUCTION_SOURCE_PATHS.helper),
      observer: fileDescriptor(repository, PRODUCTION_SOURCE_PATHS.observer),
      jobRunner: fileDescriptor(repository, PRODUCTION_SOURCE_PATHS.jobRunner),
    },
    bindingSha256: "",
  };
  const ledger = {
    schemaVersion: LOADED_LEDGER_SCHEMA,
    productionOrigin: PRODUCTION_ORIGIN,
    fixtureUsed: false,
    taskGeneration: TASK_GENERATION,
    taskId: inputs.taskId,
    taskMarkerSha256: retainedBinding("marker", inputs.taskMarker),
    sessionBindingSha256: retainedBinding("session", inputs.sessionId),
    generation: inputs.generation,
    sourceCommit: source.compiledCommit,
    sourceTreeSha256: source.sourceTreeSha256,
    sourceDirty: source.sourceDirty,
    project: { id: basename(projectPath, ".uproject"), sha256: sha256File(projectPath) },
    manifest: { sha256: sha256File(manifestPath) },
    package: {
      id: basename(packageRoot),
      artifactCount: packageArtifacts.length,
      sha256: sha256Bytes(Buffer.from(stable(packageArtifacts), "utf8")),
    },
    installedRoot: {
      id: basename(installedRoot),
      artifactCount: installedArtifacts.length,
      sha256: sha256Bytes(Buffer.from(stable(installedArtifacts), "utf8")),
    },
    process: {
      pidBindingSha256: retainedBinding("pid", earlyIdentity.rootPid),
      creationFileTimeUtcBindingSha256: retainedBinding(
        "creation-filetime",
        earlyIdentity.rootCreationFileTimeUtc,
      ),
      executableBasename: earlyIdentity.executableBasename,
      executableSha256: sha256File(executablePath),
    },
    modules,
    authority,
  };
  authority.bindingSha256 = sha256Bytes(
    Buffer.from(stable(authorityBindingMaterial(ledger)), "utf8"),
  );
  PRODUCTION_LEDGERS.add(ledger);
  return { ledger, output: publishLoadedLedger(finalPath, ledger) };
}

// ---- atomic exclusive publication -----------------------------------------

// Deep scan for absolute/raw path serialization leaks in the ledger.
function containsRawPath(value) {
  if (typeof value === "string") return RAW_PATH_PATTERN.test(value);
  if (Array.isArray(value)) return value.some(containsRawPath);
  if (value && typeof value === "object") return Object.values(value).some(containsRawPath);
  return false;
}

// One repository-owned writer path. Publishes a complete temp file in the
// final directory with exclusive creation, flush/fsync, close, then atomically
// renames to the previously absent final pathname. A pre-existing temp or
// final path is rejected and a failed temp file is cleaned up. Readers can
// never observe a partially written final pathname.
export function publishLoadedLedger(finalPath, ledger) {
  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)) {
    fail("LOADED_WRITER_LEDGER_INVALID");
  }
  if (containsRawPath(ledger)) fail("LOADED_WRITER_RAW_PATH_REJECTED");
  if (
    (ledger.productionOrigin !== undefined || ledger.fixtureUsed === false) &&
    !PRODUCTION_LEDGERS.has(ledger)
  ) {
    fail("LOADED_WRITER_PRODUCTION_AUTHORITY_REQUIRED");
  }
  const final = resolve(finalPath);
  if (existsSync(final)) fail("LOADED_WRITER_FINAL_EXISTS");
  const temp = `${final}.tmp`;
  if (existsSync(temp)) fail("LOADED_WRITER_TEMP_EXISTS");
  const serialized = `${JSON.stringify(ledger, null, 2)}\n`;
  const descriptor = openSync(temp, "wx");
  try {
    writeFileSync(descriptor, serialized, "utf8");
    fsyncSync(descriptor);
  } catch (error) {
    try {
      closeSync(descriptor);
    } catch {
      // The descriptor may already be closed by the write failure.
    }
    rmSync(temp, { force: true });
    throw error;
  }
  closeSync(descriptor);
  try {
    renameSync(temp, final);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
  return final;
}

// Backward-compatible exclusive writer entry point (direct create).
function writeLedger(path, ledger) {
  return publishLoadedLedger(path, ledger);
}

// ---- CLI --------------------------------------------------------------------

function runObserver() {
  fail("LOADED_WRITER_STANDALONE_PRODUCTION_ENTRY_REMOVED");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    runObserver();
  } catch (error) {
    const code =
      error instanceof LoadedModuleError ? error.code : (error?.code ?? "LOADED_WRITER_FAILED");
    process.stdout.write(
      `${JSON.stringify({ schemaVersion: LOADED_LEDGER_SCHEMA, status: "loaded_module_writer_rejected", reason: code })}\n`,
    );
    process.exitCode = 2;
  }
}

export {
  LoadedModuleError,
  buildLoadedLedger,
  readManifestModules,
  reduceLoadedModules,
  runObserver,
  writeLedger,
};
