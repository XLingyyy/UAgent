#!/usr/bin/env node
/* global Buffer, clearTimeout, console, process, setTimeout */

/**
 * Rework-7 task-only D0 producer.
 *
 * It launches only a positively identified fresh task project, instantiates the
 * real desktop runtime adapter, routes every MCP HTTP request through the Rust
 * native transport bridge, executes one mutation-incapable D0 probe, and writes
 * the raw four-session snapshot consumed by mvp15d-d0-capture.mjs.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  D0_ADAPTER_ARTIFACT_SCHEMA_VERSION,
  D0_ADAPTER_METAFILE_SCHEMA_VERSION,
  D0_CAPTURE_ORIGIN,
  D0_COMBINATIONS,
  D0_DIRECT_PROBE_NAME,
  D0_RAW_TRANSCRIPT_SCHEMA_VERSION,
  D0_ROUTE_DECISION_SCHEMA_VERSION,
  D0_RUNNER_ARTIFACT_SCHEMA_VERSION,
  D0_TASK_ID,
  sha256Bytes,
  stable,
} from "./mvp15d-d0-spike.mjs";

const EDITOR = "G:\\UnrealEngine\\UE_5.8\\Engine\\Binaries\\Win64\\UnrealEditor-Cmd.exe";
const MAX_CAPTURED_EXCHANGES = 2_048;
const STARTUP_TIMEOUT_MS = 15 * 60_000;
const SHUTDOWN_TIMEOUT_MS = 45_000;
const POLL_MS = 500;
const NATIVE_BRIDGE_NAME = "mvp15d-native-invoke-bridge.exe";
const NATIVE_BRIDGE_SOURCE = "apps/desktop/src-tauri/src/bin/mvp15d-native-invoke-bridge.rs";
const ADAPTER_SOURCE = "apps/desktop/web/src/runtime/desktop-runtime-adapter.ts";
const D0_TOOLSET_ID = "UAgentAssetTools.UAgentAssetToolsD0Toolset";
const D0_QUALIFIED_PROBE_NAME = `${D0_TOOLSET_ID}.Probe`;
const D0_TOOLSET_META_NAMES = ["list_toolsets", "describe_toolset", "call_tool"];
const ADAPTER_BUNDLE_ARTIFACT_PATH = "artifacts/adapter-bundle.js";
const ADAPTER_METAFILE_PATH = "adapter-bundle.metafile.json";
const NATIVE_BRIDGE_ARTIFACT_PATH = "artifacts/native-bridge.exe";
const NATIVE_BRIDGE_SOURCE_ARTIFACT_PATH = "artifacts/native-bridge-source.rs";
const RUNNER_ARTIFACT_PATH = "runner.artifact.json";
const PRODUCT_PRODUCER = Object.freeze({
  kind: "real_product_adapter_runner",
  entrypoint: "scripts/mvp15d-product-adapter-runner.mjs",
  taskId: D0_TASK_ID,
});
const PRODUCT_PROVENANCE = Object.freeze({
  adapterEntrypoint: ADAPTER_SOURCE,
  captureBoundary: D0_CAPTURE_ORIGIN,
  nativeTransportCommand: "mcp_streamable_http_request",
  projectOwnership: "fresh_task_owned",
});
const activeTaskProcesses = new Map();
const activeImmutableHandles = new Set();
const activePersistentBridges = new Set();
const recentToolExchangeDiagnostics = [];

class ProductEvidenceError extends Error {
  constructor(code, diagnostic = null) {
    super(code);
    this.code = code;
    this.diagnostic = diagnostic;
  }
}

function fail(code, diagnostic = null) {
  throw new ProductEvidenceError(code, diagnostic);
}

function within(root, candidate) {
  const value = relative(root, candidate);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function samePath(left, right) {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function entryOrNull(path, code) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    fail(code);
  }
}

function requireFile(path, code) {
  if (!existsSync(path)) fail(code);
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink()) fail(code);
  return path;
}

function requireDirectory(path, code) {
  if (!existsSync(path)) fail(code);
  const stats = lstatSync(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) fail(code);
  return path;
}

function fileArtifact(path, code) {
  const file = requireFile(path, code);
  const bytes = readFileSync(file);
  return {
    path: file,
    name: basename(file),
    size: bytes.length,
    sha256: hash(bytes),
  };
}

function assertFileArtifact(artifact, code) {
  const current = fileArtifact(artifact.path, code);
  if (
    current.name !== artifact.name ||
    current.size !== artifact.size ||
    current.sha256 !== artifact.sha256
  ) {
    fail(code);
  }
}

function readOpenFile(fd, code) {
  let size;
  try {
    size = fstatSync(fd).size;
  } catch {
    fail(code);
  }
  if (!Number.isSafeInteger(size) || size < 0 || size > 512 * 1024 * 1024) fail(code);
  const bytes = Buffer.alloc(size);
  let offset = 0;
  try {
    while (offset < size) {
      const read = readSync(fd, bytes, offset, size - offset, offset);
      if (read <= 0) fail(code);
      offset += read;
    }
  } catch {
    fail(code);
  }
  return bytes;
}

function openHashedArtifact(path, code) {
  const file = requireFile(path, code);
  let fd;
  try {
    fd = openSync(file, "r");
    const bytes = readOpenFile(fd, code);
    return {
      fd,
      bytes,
      artifact: {
        path: file,
        name: basename(file),
        size: bytes.length,
        sha256: hash(bytes),
      },
    };
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    if (error instanceof ProductEvidenceError) throw error;
    fail(code);
  }
}

function materializeImmutableArtifact(source, immutableRoot, name, code, keepOpen = true) {
  const openedSource = openHashedArtifact(source.path, code);
  try {
    if (
      openedSource.artifact.size !== source.size ||
      openedSource.artifact.sha256 !== source.sha256
    ) {
      fail(code);
    }
    const contentRoot = join(immutableRoot, openedSource.artifact.sha256);
    mkdirSync(contentRoot, { recursive: true });
    const copyPath = join(contentRoot, name);
    writeFileSync(copyPath, openedSource.bytes, { flag: "wx" });
    const openedCopy = openHashedArtifact(copyPath, code);
    if (
      openedCopy.artifact.size !== openedSource.artifact.size ||
      openedCopy.artifact.sha256 !== openedSource.artifact.sha256
    ) {
      closeSync(openedCopy.fd);
      fail(code);
    }
    if (keepOpen) activeImmutableHandles.add(openedCopy.fd);
    else closeSync(openedCopy.fd);
    return {
      ...openedCopy.artifact,
      ...(keepOpen ? { fd: openedCopy.fd } : {}),
      source: {
        name: source.name,
        size: source.size,
        sha256: source.sha256,
      },
      copySha256: openedCopy.artifact.sha256,
    };
  } finally {
    closeSync(openedSource.fd);
  }
}

function assertImmutableArtifact(artifact, code) {
  const bytes = readOpenFile(artifact.fd, code);
  if (bytes.length !== artifact.size || hash(bytes) !== artifact.sha256) fail(code);
  assertFileArtifact(artifact, code);
}

function outputRelativePath(output, path, code) {
  const logicalPath = relative(output, path).replace(/\\/g, "/");
  if (
    logicalPath.length === 0 ||
    isAbsolute(logicalPath) ||
    logicalPath.includes("\\") ||
    logicalPath.split("/").includes("..")
  ) {
    fail(code);
  }
  return logicalPath;
}

function copyArtifactSnapshot(source, destination, output, code) {
  const opened = source.fd === undefined ? openHashedArtifact(source.path, code) : null;
  try {
    const bytes = source.fd === undefined ? opened.bytes : readOpenFile(source.fd, code);
    if (bytes.length !== source.size || hash(bytes) !== source.sha256) fail(code);
    writeFileSync(destination, bytes, { flag: "wx" });
    const copied = fileArtifact(destination, code);
    if (copied.size !== source.size || copied.sha256 !== source.sha256) fail(code);
    return {
      path: outputRelativePath(output, destination, code),
      size: copied.size,
      sha256: copied.sha256,
    };
  } finally {
    if (opened) closeSync(opened.fd);
  }
}

function writeJsonArtifact(output, logicalPath, value, code) {
  const destination = resolve(output, logicalPath);
  if (!within(output, destination)) fail(code);
  writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  const artifact = fileArtifact(destination, code);
  return {
    path: outputRelativePath(output, destination, code),
    size: artifact.size,
    sha256: artifact.sha256,
  };
}

function assertOutputArtifact(output, artifact, code) {
  const current = fileArtifact(resolve(output, artifact.path), code);
  if (current.size !== artifact.size || current.sha256 !== artifact.sha256) fail(code);
}

function closeImmutableHandles() {
  for (const fd of activeImmutableHandles) {
    try {
      closeSync(fd);
    } catch {
      // Closeout reports task process/port ownership; immutable read handles
      // have no external side effect and are released best-effort on failure.
    }
  }
  activeImmutableHandles.clear();
}

function parseArgs(argv) {
  const supported = new Set(["project", "output", "native-bridge"]);
  const args = Object.create(null);
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    const key = item?.startsWith("--") ? item.slice(2) : "";
    const value = argv[index + 1];
    if (!supported.has(key) || Object.hasOwn(args, key) || !value || value.startsWith("--")) {
      fail("D0_PRODUCT_RUNNER_ARGUMENT_INVALID");
    }
    args[key] = value;
    index += 1;
  }
  if (!args.project || !args.output || !args["native-bridge"]) {
    fail("D0_PRODUCT_RUNNER_ARGUMENT_REQUIRED");
  }
  return args;
}

function resolveTaskProject(value) {
  const project = requireFile(resolve(value), "D0_PRODUCT_PROJECT_INVALID");
  if (!project.toLowerCase().endsWith(".uproject")) fail("D0_PRODUCT_PROJECT_INVALID");
  const projectRoot = requireDirectory(dirname(project), "D0_PRODUCT_PROJECT_INVALID");
  const tempRoot = resolve(tmpdir());
  if (
    !samePath(dirname(projectRoot), tempRoot) ||
    !/^UAgent-MVP15D-Rework7-[A-Za-z0-9_-]+$/i.test(basename(projectRoot))
  ) {
    fail("D0_PRODUCT_PROJECT_NOT_TASK_OWNED");
  }
  requireDirectory(tempRoot, "D0_PRODUCT_PROJECT_INVALID");
  return { project, projectRoot };
}

function resolveNativeBridge(workspace, value) {
  const bridge = requireFile(resolve(value), "D0_PRODUCT_NATIVE_BRIDGE_INVALID");
  const targetRoot = resolve(workspace, "apps", "desktop", "src-tauri", "target");
  const allowed = new Set([
    resolve(targetRoot, "debug", NATIVE_BRIDGE_NAME).toLowerCase(),
    resolve(targetRoot, "release", NATIVE_BRIDGE_NAME).toLowerCase(),
  ]);
  if (!within(targetRoot, bridge) || !allowed.has(bridge.toLowerCase())) {
    fail("D0_PRODUCT_NATIVE_BRIDGE_NOT_EXPECTED_BINARY");
  }
  return {
    ...fileArtifact(bridge, "D0_PRODUCT_NATIVE_BRIDGE_INVALID"),
    profile: basename(dirname(bridge)).toLowerCase(),
  };
}

export function createD0ProductOutput(value) {
  const output = resolve(value);
  const tempRoot = resolve(tmpdir());
  if (
    !samePath(dirname(output), tempRoot) ||
    !/^UAgent-MVP15D-Rework7-[A-Za-z0-9_-]+$/i.test(basename(output))
  ) {
    fail("D0_PRODUCT_OUTPUT_NOT_TASK_OWNED");
  }
  requireDirectory(tempRoot, "D0_PRODUCT_OUTPUT_INVALID");
  if (entryOrNull(output, "D0_PRODUCT_OUTPUT_INVALID")) fail("D0_PRODUCT_OUTPUT_ALREADY_EXISTS");
  try {
    mkdirSync(output, { recursive: false });
    mkdirSync(join(output, "artifacts"), { recursive: false });
    mkdirSync(join(output, "artifacts", "adapter-inputs"), { recursive: false });
  } catch {
    fail("D0_PRODUCT_OUTPUT_INVALID");
  }
  return output;
}

function hash(value) {
  return sha256Bytes(Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8"));
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function allocatePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.unref();
    server.once("error", rejectPort);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close((error) => {
        if (error || port <= 0) rejectPort(error ?? new Error("port_unavailable"));
        else resolvePort(port);
      });
    });
  });
}

function listeningPids(port) {
  const result = spawnSync("netstat", ["-ano", "-p", "tcp"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) fail("D0_PRODUCT_PORT_INSPECTION_FAILED");
  const pids = new Set();
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
    if (match && Number(match[1]) === port) pids.add(Number(match[2]));
  }
  return pids;
}

async function waitForOwnedListener(port, ownership) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const pids = listeningPids(port);
    if (pids.size > 0) {
      const table = processTable();
      if (
        pids.size !== 1 ||
        !pids.has(ownership.root.pid) ||
        !findMatchingProcess(ownership.root, table)
      ) {
        fail("D0_PRODUCT_PORT_NOT_OWNED_BY_TASK_PROCESS");
      }
      return;
    }
    await sleep(POLL_MS);
  }
  fail("D0_PRODUCT_LISTENER_TIMEOUT");
}

async function waitForPortClosed(port) {
  const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (listeningPids(port).size === 0) return;
    await sleep(POLL_MS);
  }
  fail("D0_PRODUCT_PORT_CLOSEOUT_FAILED");
}

function processTable() {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath,CommandLine | ConvertTo-Json -Compress",
    ],
    {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) fail("D0_PRODUCT_PROCESS_TREE_INSPECTION_FAILED");
  let rows;
  try {
    const parsed = JSON.parse(result.stdout);
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    fail("D0_PRODUCT_PROCESS_TREE_INSPECTION_FAILED");
  }
  return rows
    .map((row) => ({
      pid: Number(row?.ProcessId),
      parentPid: Number(row?.ParentProcessId),
      creationDate: typeof row?.CreationDate === "string" ? row.CreationDate : "",
      executablePath: typeof row?.ExecutablePath === "string" ? row.ExecutablePath : "",
      commandLine: typeof row?.CommandLine === "string" ? row.CommandLine : "",
    }))
    .filter(
      ({ pid, parentPid }) =>
        Number.isSafeInteger(pid) && pid > 0 && Number.isSafeInteger(parentPid) && parentPid >= 0,
    );
}

function normalizedExecutable(path) {
  if (typeof path !== "string" || path.length === 0) return "";
  try {
    return resolve(path).toLowerCase();
  } catch {
    return "";
  }
}

function processIdentity(row) {
  if (
    !row ||
    !Number.isSafeInteger(row.pid) ||
    row.pid <= 0 ||
    !row.creationDate ||
    !row.executablePath ||
    !row.commandLine
  ) {
    return null;
  }
  const executablePath = normalizedExecutable(row.executablePath);
  if (!executablePath) return null;
  const identity = {
    pid: row.pid,
    parentPid: row.parentPid,
    creationDate: row.creationDate,
    executablePath,
    commandLine: row.commandLine,
  };
  return {
    ...identity,
    identitySha256: hash(stable(identity)),
  };
}

function sameProcessIdentity(left, right) {
  return Boolean(
    left &&
    right &&
    left.pid === right.pid &&
    left.creationDate === right.creationDate &&
    left.executablePath === right.executablePath &&
    left.commandLine === right.commandLine &&
    left.identitySha256 === right.identitySha256,
  );
}

function findMatchingProcess(identity, table = processTable()) {
  const row = table.find(({ pid }) => pid === identity.pid);
  return sameProcessIdentity(identity, processIdentity(row)) ? row : null;
}

async function claimSpawnedProcess(child, expectedExecutable, marker, code) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const row = processTable().find(({ pid }) => pid === child.pid);
    const identity = processIdentity(row);
    if (identity) {
      if (
        identity.executablePath !== normalizedExecutable(expectedExecutable) ||
        !identity.commandLine.includes(marker)
      ) {
        fail(code);
      }
      return {
        marker,
        root: identity,
        known: new Map([[identity.pid, identity]]),
      };
    }
    await sleep(25);
  }
  fail(code);
}

function resampleOwnedProcessTree(ownership) {
  const table = processTable();
  const currentRoot = findMatchingProcess(ownership.root, table);
  if (currentRoot) {
    const reachable = new Set([ownership.root.pid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of table) {
        if (!reachable.has(row.parentPid) || reachable.has(row.pid)) continue;
        const identity = processIdentity(row);
        if (!identity) continue;
        const previous = ownership.known.get(identity.pid);
        if (previous && !sameProcessIdentity(previous, identity)) continue;
        ownership.known.set(identity.pid, identity);
        reachable.add(identity.pid);
        changed = true;
      }
    }
  }
  return {
    table,
    matching: [...ownership.known.values()].filter((identity) =>
      findMatchingProcess(identity, table),
    ),
  };
}

function markerProcesses(marker, table = processTable()) {
  return table.filter(({ commandLine }) => commandLine.includes(marker));
}

function terminateExactProcess(identity) {
  if (!findMatchingProcess(identity)) return;
  const closed = spawnSync("taskkill", ["/PID", String(identity.pid), "/F"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if ((closed.error || closed.status !== 0) && findMatchingProcess(identity)) {
    fail("D0_PRODUCT_PROCESS_CLOSEOUT_FAILED");
  }
}

async function closeTaskProcess(launch, port) {
  const { ownership } = launch;
  if (!ownership) fail("D0_PRODUCT_PROCESS_OWNERSHIP_MISSING");
  // Two initial samples reduce the window in which a just-created child could
  // escape the task-owned identity set before the root is terminated.
  resampleOwnedProcessTree(ownership);
  await sleep(25);
  resampleOwnedProcessTree(ownership);
  const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { matching } = resampleOwnedProcessTree(ownership);
    if (matching.length === 0) break;
    const parentIds = new Set(matching.map(({ parentPid }) => parentPid));
    const deepestFirst = [...matching].sort((left, right) => {
      const leftIsParent = parentIds.has(left.pid) ? 1 : 0;
      const rightIsParent = parentIds.has(right.pid) ? 1 : 0;
      return leftIsParent - rightIsParent;
    });
    for (const identity of deepestFirst) terminateExactProcess(identity);
    await sleep(POLL_MS);
  }
  const finalSample = resampleOwnedProcessTree(ownership);
  if (finalSample.matching.length > 0) fail("D0_PRODUCT_PROCESS_CLOSEOUT_FAILED");
  if (markerProcesses(ownership.marker, finalSample.table).length > 0) {
    fail("D0_PRODUCT_PROCESS_MARKER_CLOSEOUT_FAILED");
  }
  await waitForPortClosed(port);
  const completed = listeningPids(port).size === 0;
  if (completed) activeTaskProcesses.delete(launch.child.pid);
  return completed;
}

async function closeOutstandingTaskProcesses() {
  let completed = true;
  for (const { launch, port } of [...activeTaskProcesses.values()]) {
    try {
      completed = (await closeTaskProcess(launch, port)) && completed;
    } catch {
      completed = false;
    }
  }
  return completed;
}

function launchEditor(binding, combination, port, logPath) {
  if (listeningPids(port).size !== 0) fail("D0_PRODUCT_PORT_ALREADY_IN_USE");
  const marker = `uagent-mvp15d-rework7-d0-${hash(`${binding.project}|${combination.id}|${port}|${Date.now()}`).slice(0, 32)}`;
  const ddcDirectory = join(
    tmpdir(),
    `UAgent-MVP15D-Rework7-d0-ddc-${process.pid}-${port}-${basename(logPath, ".log")}`,
  );
  if (existsSync(ddcDirectory)) fail("D0_PRODUCT_DDC_ALREADY_EXISTS");
  mkdirSync(ddcDirectory, { recursive: false });
  const ddcPath = ddcDirectory.replace(/\\/g, "/");
  const args = [
    binding.project,
    "-unattended",
    "-nop4",
    "-nosplash",
    "-NullRHI",
    "-NoSound",
    "-stdout",
    "-FullStdOutLogOutput",
    "-ModelContextProtocolStartServer",
    `-ModelContextProtocolPort=${port}`,
    "-UAgentMvp15D0Probe",
    `-UAgentMvp15D0Route=${combination.route}`,
    `-UAgentMvp15D0ToolSearch=${combination.toolSearch ? "on" : "off"}`,
    `-UAgentMvp15DTaskMarker=${marker}`,
    `-DDC=(Local=(Type=FileSystem,Path=${ddcPath}))`,
    `-abslog=${logPath}`,
  ];
  const child = spawn(EDITOR, args, {
    cwd: binding.projectRoot,
    env: {
      ...process.env,
      "UE-LocalDataCachePath": ddcPath,
      "UE-SharedDataCachePath": "None",
    },
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "ignore", "ignore"],
  });
  if (!child.pid) fail("D0_PRODUCT_EDITOR_SPAWN_FAILED");
  const launch = { child, args, marker, ownership: null };
  activeTaskProcesses.set(child.pid, { launch, port });
  return launch;
}

async function claimEditorProcess(launch) {
  launch.ownership = await claimSpawnedProcess(
    launch.child,
    EDITOR,
    launch.marker,
    "D0_PRODUCT_EDITOR_PROCESS_IDENTITY_INVALID",
  );
  return launch.ownership;
}

function aggregateContent(contentRoot) {
  if (!existsSync(contentRoot))
    return { fileCount: 0, aggregateSha256: hash("uagent.mvp15d.content.v1\0") };
  const entries = [];
  const walk = (directory) => {
    const stats = lstatSync(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) fail("D0_PRODUCT_CONTENT_INVALID");
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name, "en"),
    )) {
      const child = resolve(directory, entry.name);
      if (!within(contentRoot, child) || entry.isSymbolicLink()) fail("D0_PRODUCT_CONTENT_INVALID");
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) {
        const bytes = readFileSync(child);
        entries.push(
          `${relative(contentRoot, child).replace(/\\/g, "/")}\0${bytes.length}\0${hash(bytes)}`,
        );
      } else fail("D0_PRODUCT_CONTENT_INVALID");
    }
  };
  walk(contentRoot);
  return {
    fileCount: entries.length,
    aggregateSha256: hash(`uagent.mvp15d.content.v1\0${entries.join("\n")}`),
  };
}

function recursivelyFind(value, predicate, depth = 0) {
  if (depth > 14 || value === null || value === undefined) return null;
  if (predicate(value)) return value;
  if (typeof value === "string") {
    try {
      return recursivelyFind(JSON.parse(value), predicate, depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = recursivelyFind(item, predicate, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const nested of Object.values(value)) {
      const found = recursivelyFind(nested, predicate, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function exactKeys(value, keys) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(","),
  );
}

function jsonRpcId(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const id = payload.id;
  return typeof id === "string" || Number.isSafeInteger(id) ? `${typeof id}:${String(id)}` : null;
}

function validateJsonRpcRequest(payload, method) {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    payload.jsonrpc !== "2.0" ||
    payload.method !== method ||
    jsonRpcId(payload) === null ||
    Object.keys(payload).some((key) => !["jsonrpc", "id", "method", "params"].includes(key)) ||
    !["jsonrpc", "id", "method"].every((key) => Object.hasOwn(payload, key))
  ) {
    fail("D0_PRODUCT_JSONRPC_REQUEST_INVALID");
  }
}

function validateJsonRpcResponse(payload, requestPayload) {
  const hasResult = Boolean(payload && Object.hasOwn(payload, "result"));
  const hasError = Boolean(payload && Object.hasOwn(payload, "error"));
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    payload.jsonrpc !== "2.0" ||
    jsonRpcId(payload) === null ||
    jsonRpcId(payload) !== jsonRpcId(requestPayload) ||
    hasResult === hasError ||
    Object.keys(payload).some((key) => !["jsonrpc", "id", "result", "error"].includes(key)) ||
    !["jsonrpc", "id"].every((key) => Object.hasOwn(payload, key))
  ) {
    fail("D0_PRODUCT_JSONRPC_RESPONSE_INVALID");
  }
  if (hasError) fail("D0_PRODUCT_JSONRPC_ERROR_RESPONSE");
}

function jsonRpcExchangePair(exchanges, method, startIndex = 0) {
  const requests = exchanges
    .slice(startIndex)
    .filter((exchange) => exchange.direction === "request" && exchange.method === method);
  if (requests.length !== 1) {
    fail("D0_PRODUCT_JSONRPC_REQUEST_AMBIGUOUS", {
      method,
      requestCount: requests.length,
      startIndex,
    });
  }
  const request = requests[0];
  validateJsonRpcRequest(request.payload, method);
  const requestId = jsonRpcId(request.payload);
  const responses = exchanges
    .slice(startIndex)
    .filter(
      (exchange) =>
        exchange.direction === "response" &&
        exchange.method === method &&
        jsonRpcId(exchange.payload) === requestId,
    );
  if (responses.length !== 1) {
    fail("D0_PRODUCT_JSONRPC_RESPONSE_AMBIGUOUS", {
      method,
      responseCount: responses.length,
      startIndex,
    });
  }
  const response = responses[0];
  validateJsonRpcResponse(response.payload, request.payload);
  if (
    !Number.isSafeInteger(request.generation) ||
    request.generation < 1 ||
    response.generation !== request.generation
  ) {
    fail("D0_PRODUCT_EXCHANGE_GENERATION_INVALID");
  }
  return { request, response, generation: request.generation };
}

function adapterExchangeGenerationPair(exchanges, method, startIndex = 0) {
  const relevant = exchanges.slice(startIndex).filter((exchange) => exchange.method === method);
  const requests = relevant.filter(({ direction }) => direction === "request");
  const responses = relevant.filter(({ direction }) => direction === "response");
  if (requests.length !== 1 || responses.length !== 1 || relevant.length !== 2) {
    fail("D0_PRODUCT_ADAPTER_EXCHANGE_AMBIGUOUS");
  }
  if (
    !Number.isSafeInteger(requests[0].generation) ||
    requests[0].generation < 1 ||
    responses[0].generation !== requests[0].generation
  ) {
    fail("D0_PRODUCT_EXCHANGE_GENERATION_INVALID");
  }
  return {
    request: requests[0],
    response: responses[0],
    generation: requests[0].generation,
  };
}

function exchangeEvidence(pair) {
  return {
    request: pair.request.payload,
    requestSha256: hash(stable(pair.request.payload)),
    response: pair.response.payload,
    responseSha256: hash(stable(pair.response.payload)),
  };
}

function requestedToolName(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const params = payload.params;
  return params &&
    typeof params === "object" &&
    !Array.isArray(params) &&
    typeof params.name === "string"
    ? params.name
    : null;
}

function noOpExchangePair(exchanges, combination, startIndex = 0) {
  const expectedToolName =
    combination.route === "direct"
      ? D0_DIRECT_PROBE_NAME
      : combination.toolSearch
        ? "call_tool"
        : D0_QUALIFIED_PROBE_NAME;
  const requests = exchanges
    .slice(startIndex)
    .filter(
      (exchange) =>
        exchange.direction === "request" &&
        exchange.method === "tools/call" &&
        requestedToolName(exchange.payload) === expectedToolName,
    );
  if (requests.length !== 1) fail("D0_PRODUCT_NOOP_REQUEST_AMBIGUOUS");
  const request = requests[0];
  validateJsonRpcRequest(request.payload, "tools/call");
  const requestId = jsonRpcId(request.payload);
  if (!requestId) fail("D0_PRODUCT_NOOP_REQUEST_ID_MISSING");
  const responses = exchanges
    .slice(startIndex)
    .filter(
      (exchange) =>
        exchange.direction === "response" &&
        exchange.method === "tools/call" &&
        jsonRpcId(exchange.payload) === requestId,
    );
  if (responses.length !== 1) fail("D0_PRODUCT_NOOP_RESPONSE_AMBIGUOUS");
  const response = responses[0];
  validateJsonRpcResponse(response.payload, request.payload);
  if (response.generation !== request.generation) fail("D0_PRODUCT_EXCHANGE_GENERATION_INVALID");
  const params = request.payload.params;
  if (
    !exactKeys(params, ["name", "arguments"]) ||
    params.name !== expectedToolName ||
    !params.arguments ||
    typeof params.arguments !== "object" ||
    Array.isArray(params.arguments)
  ) {
    fail("D0_PRODUCT_NOOP_PARAMS_INVALID");
  }
  if (combination.route === "direct" || !combination.toolSearch) {
    if (Object.keys(params.arguments).length !== 0) fail("D0_PRODUCT_NOOP_PARAMS_INVALID");
  } else if (
    !exactKeys(params.arguments, ["toolset_name", "tool_name", "arguments"]) ||
    params.arguments.toolset_name !== D0_TOOLSET_ID ||
    params.arguments.tool_name !== "Probe" ||
    !exactKeys(params.arguments.arguments, [])
  ) {
    fail("D0_PRODUCT_TOOLSET_PARAMS_INVALID");
  }
  return { request, response, generation: request.generation };
}

function isEmptyInputSchema(value) {
  return Boolean(
    exactKeys(value, ["type", "properties", "required", "additionalProperties"]) &&
    value.type === "object" &&
    exactKeys(value.properties, []) &&
    Array.isArray(value.required) &&
    value.required.length === 0 &&
    value.additionalProperties === false,
  );
}

function isToolsetEmptyInputSchema(value) {
  return Boolean(exactKeys(value, ["type"]) && value.type === "object");
}

function discoveryDescriptors(exchange) {
  const tools = recursivelyFind(
    exchange?.payload,
    (value) =>
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => item && typeof item === "object" && typeof item.name === "string"),
  );
  if (!Array.isArray(tools)) fail("D0_PRODUCT_DISCOVERY_DESCRIPTOR_MISSING");
  return tools;
}

function findProbeDescriptor(combination, descriptors, exchanges) {
  const predicate = (value) =>
    Boolean(
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.name === "string" &&
      (combination.route === "direct"
        ? isEmptyInputSchema(value.inputSchema)
        : isToolsetEmptyInputSchema(value.inputSchema)) &&
      typeof value.description === "string" &&
      (combination.route === "direct"
        ? value.name === D0_DIRECT_PROBE_NAME
        : value.name === D0_QUALIFIED_PROBE_NAME),
    );
  const fromDiscovery = descriptors.find(predicate);
  if (fromDiscovery) return fromDiscovery;
  for (const exchange of exchanges) {
    const found = recursivelyFind(exchange.payload, predicate);
    if (found) return found;
  }
  fail("D0_PRODUCT_PROBE_DESCRIPTOR_MISSING");
}

const BRIDGE_COMMANDS = new Set([
  "trust_native_project_root",
  "discover_editor_processes",
  "attach_editor_process",
  "attest_mvp15_companion",
  "retract_mvp15_companion_approvals",
  "mcp_streamable_http_request",
]);

function bridgeCommandStatus(command, result, ok) {
  if (!ok) return "error";
  if (command === "trust_native_project_root") return result?.trustState ?? "invalid";
  return typeof result?.status === "string" ? result.status : "completed";
}

class PersistentBridge {
  constructor(artifact, marker, sessionState) {
    this.artifact = artifact;
    this.marker = marker;
    this.sessionState = sessionState;
    this.child = null;
    this.ownership = null;
    this.nextRequestId = 1;
    this.pending = new Map();
    this.nativeLifecycle = [];
    this.exitPromise = null;
    this.fatal = null;
  }

  async start() {
    assertImmutableArtifact(this.artifact, "D0_PRODUCT_NATIVE_BRIDGE_CHANGED");
    const child = spawn(
      this.artifact.path,
      ["--persistent-jsonl", `--task-marker=${this.marker}`],
      {
        cwd: dirname(this.artifact.path),
        env: {
          ...process.env,
          UAGENT_ENABLE_UE_EDITOR_BRIDGE: "1",
        },
        windowsHide: true,
        shell: false,
        stdio: ["pipe", "pipe", "ignore"],
      },
    );
    if (!child.pid || !child.stdin || !child.stdout) fail("D0_PRODUCT_NATIVE_BRIDGE_SPAWN_FAILED");
    this.child = child;
    this.exitPromise = new Promise((resolveExit) => {
      child.once("exit", (code, signal) => resolveExit({ code, signal }));
    });
    child.once("error", () => this.rejectAll("D0_PRODUCT_NATIVE_BRIDGE_FAILED"));
    child.once("exit", () => this.rejectAll("D0_PRODUCT_NATIVE_BRIDGE_CLOSED"));
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => this.receive(line));
    this.ownership = await claimSpawnedProcess(
      child,
      this.artifact.path,
      this.marker,
      "D0_PRODUCT_NATIVE_BRIDGE_PROCESS_IDENTITY_INVALID",
    );
    activePersistentBridges.add(this);
    return this;
  }

  rejectAll(code) {
    this.fatal = code;
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new ProductEvidenceError(code));
    }
    this.pending.clear();
  }

  receive(line) {
    let response;
    try {
      response = JSON.parse(line);
    } catch {
      this.rejectAll("D0_PRODUCT_NATIVE_BRIDGE_INVALID_RESULT");
      return;
    }
    const requestId = response?.requestId;
    const pending = typeof requestId === "string" ? this.pending.get(requestId) : null;
    if (
      !pending ||
      !response ||
      typeof response !== "object" ||
      Array.isArray(response) ||
      Object.keys(response).sort().join(",") !== "error,ok,requestId,result" ||
      typeof response.ok !== "boolean" ||
      (response.ok
        ? !Object.hasOwn(response, "result") || response.error !== null
        : !Object.hasOwn(response, "error") || response.result !== null)
    ) {
      this.rejectAll("D0_PRODUCT_NATIVE_BRIDGE_INVALID_RESULT");
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    pending.resolve(response);
  }

  async request(command, input) {
    if (!BRIDGE_COMMANDS.has(command)) fail("D0_PRODUCT_NATIVE_BRIDGE_COMMAND_BLOCKED");
    if (!this.child?.stdin || !this.ownership || this.fatal) {
      fail(this.fatal ?? "D0_PRODUCT_NATIVE_BRIDGE_UNAVAILABLE");
    }
    assertImmutableArtifact(this.artifact, "D0_PRODUCT_NATIVE_BRIDGE_CHANGED");
    const requestId = `mvp15d-bridge-${this.nextRequestId}`;
    this.nextRequestId += 1;
    const request = { requestId, command, input: input ?? null };
    const sessionId = input?.sessionId;
    if (typeof sessionId === "string" && sessionId.length > 0) {
      const sessionIdHash = hash(sessionId);
      this.sessionState.sessionIdHash = sessionIdHash;
      this.sessionState.observations.push({
        bridgeRequestId: requestId,
        sessionIdHash,
      });
    }
    const response = await new Promise((resolveResponse, rejectResponse) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        rejectResponse(new ProductEvidenceError("D0_PRODUCT_NATIVE_BRIDGE_TIMEOUT"));
      }, 30_000);
      this.pending.set(requestId, { resolve: resolveResponse, reject: rejectResponse, timer });
      this.child.stdin.write(`${JSON.stringify(request)}\n`, "utf8", (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(requestId);
        rejectResponse(new ProductEvidenceError("D0_PRODUCT_NATIVE_BRIDGE_FAILED"));
      });
    });
    if (command !== "mcp_streamable_http_request") {
      const attestationGeneration = Number.isSafeInteger(input?.attestationGeneration)
        ? input.attestationGeneration
        : null;
      const retractionResult =
        command === "retract_mvp15_companion_approvals" &&
        response.result &&
        typeof response.result === "object"
          ? response.result
          : null;
      this.nativeLifecycle.push({
        command,
        status: bridgeCommandStatus(command, response.result, response.ok),
        requestId,
        responseRequestId: response.requestId,
        requestSha256: hash(stable(request)),
        responseSha256: hash(stable(response)),
        bridgeProcessIdentityHash: this.ownership.root.identitySha256,
        attestationGeneration,
        applied: retractionResult ? retractionResult.applied === true : null,
        requestedAttestationGeneration: Number.isSafeInteger(
          retractionResult?.requestedAttestationGeneration,
        )
          ? retractionResult.requestedAttestationGeneration
          : null,
        minimumAttestationGeneration: Number.isSafeInteger(
          retractionResult?.minimumAttestationGeneration,
        )
          ? retractionResult.minimumAttestationGeneration
          : null,
        nativeGeneration: Number.isSafeInteger(retractionResult?.generation)
          ? retractionResult.generation
          : null,
        revokedApprovalCount: Number.isSafeInteger(retractionResult?.revokedApprovalCount)
          ? retractionResult.revokedApprovalCount
          : null,
      });
    }
    if (response.ok !== true || !Object.hasOwn(response, "result")) {
      throw new ProductEvidenceError("D0_PRODUCT_NATIVE_BRIDGE_REJECTED");
    }
    return response.result;
  }

  invoke() {
    return (command, args) => this.request(command, args?.input);
  }

  async close() {
    if (!this.child || !this.ownership) return;
    try {
      this.child.stdin?.end();
    } catch {
      // Exact process identity termination below is the fail-closed fallback.
    }
    await Promise.race([this.exitPromise, sleep(5_000)]);
    const { matching } = resampleOwnedProcessTree(this.ownership);
    for (const identity of matching) terminateExactProcess(identity);
    await Promise.race([this.exitPromise, sleep(5_000)]);
    const finalSample = resampleOwnedProcessTree(this.ownership);
    if (
      finalSample.matching.length > 0 ||
      markerProcesses(this.marker, finalSample.table).length > 0
    ) {
      fail("D0_PRODUCT_NATIVE_BRIDGE_CLOSEOUT_FAILED");
    }
    activePersistentBridges.delete(this);
  }
}

async function closeOutstandingPersistentBridges() {
  let completed = true;
  for (const bridge of [...activePersistentBridges]) {
    try {
      await bridge.close();
    } catch {
      completed = false;
    }
  }
  return completed;
}

async function bundleAdapter(workspace, binding, output) {
  const bundleRoot = join(binding.projectRoot, "Intermediate", "UAgentMvp15DRework7Adapter");
  if (existsSync(bundleRoot)) fail("D0_PRODUCT_ADAPTER_BUNDLE_ALREADY_EXISTS");
  mkdirSync(bundleRoot, { recursive: true });
  let desktopViteRoot;
  let esbuildRoot;
  try {
    desktopViteRoot = requireDirectory(
      realpathSync(join(workspace, "apps", "desktop", "node_modules", "vite")),
      "D0_PRODUCT_ESBUILD_UNAVAILABLE",
    );
    esbuildRoot = requireDirectory(
      realpathSync(resolve(dirname(desktopViteRoot), "esbuild")),
      "D0_PRODUCT_ESBUILD_UNAVAILABLE",
    );
  } catch (error) {
    if (error instanceof ProductEvidenceError) throw error;
    fail("D0_PRODUCT_ESBUILD_UNAVAILABLE");
  }
  const esbuildPackage = JSON.parse(
    readFileSync(
      requireFile(join(esbuildRoot, "package.json"), "D0_PRODUCT_ESBUILD_UNAVAILABLE"),
      "utf8",
    ),
  );
  const esbuildModulePath = requireFile(
    join(esbuildRoot, "lib", "main.js"),
    "D0_PRODUCT_ESBUILD_UNAVAILABLE",
  );
  const esbuild = await import(pathToFileURL(esbuildModulePath).href);
  if (typeof esbuild.build !== "function" || typeof esbuildPackage.version !== "string") {
    fail("D0_PRODUCT_ESBUILD_UNAVAILABLE");
  }

  const stagingRoot = join(bundleRoot, "staging");
  mkdirSync(stagingRoot, { recursive: false });
  const stagingPath = join(stagingRoot, "desktop-runtime-adapter.mjs");
  let result;
  try {
    result = await esbuild.build({
      absWorkingDir: workspace,
      entryPoints: [ADAPTER_SOURCE],
      outfile: stagingPath,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node20",
      metafile: true,
      sourcemap: false,
      write: true,
      logLevel: "silent",
    });
  } catch {
    fail("D0_PRODUCT_ADAPTER_BUNDLE_FAILED");
  }
  if (!result?.metafile?.inputs || !result.metafile.outputs) {
    fail("D0_PRODUCT_ADAPTER_METAFILE_INVALID");
  }
  const inputArtifactRoot = join(bundleRoot, "immutable-inputs");
  mkdirSync(inputArtifactRoot, { recursive: false });
  const inputGraph = Object.entries(result.metafile.inputs)
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([inputPath, metadata], index) => {
      const absolute = resolve(workspace, inputPath);
      if (!within(workspace, absolute)) fail("D0_PRODUCT_ADAPTER_INPUT_GRAPH_INVALID");
      const source = fileArtifact(absolute, "D0_PRODUCT_ADAPTER_INPUT_GRAPH_INVALID");
      const immutable = materializeImmutableArtifact(
        source,
        inputArtifactRoot,
        `${hash(inputPath).slice(0, 16)}-${basename(absolute)}`,
        "D0_PRODUCT_ADAPTER_INPUT_GRAPH_INVALID",
        false,
      );
      if (metadata.bytes !== source.size) fail("D0_PRODUCT_ADAPTER_INPUT_GRAPH_INVALID");
      const safeName = basename(absolute).replace(/[^A-Za-z0-9._-]/g, "_");
      if (safeName.length === 0) fail("D0_PRODUCT_ADAPTER_INPUT_GRAPH_INVALID");
      const artifact = copyArtifactSnapshot(
        immutable,
        join(
          output,
          "artifacts",
          "adapter-inputs",
          `${String(index).padStart(4, "0")}-${safeName}`,
        ),
        output,
        "D0_PRODUCT_ADAPTER_INPUT_GRAPH_INVALID",
      );
      return {
        sourcePath: relative(workspace, absolute).replace(/\\/g, "/"),
        artifactPath: artifact.path,
        size: artifact.size,
        sha256: artifact.sha256,
      };
    })
    .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath, "en"));
  if (
    inputGraph.length === 0 ||
    new Set(inputGraph.map(({ sourcePath }) => sourcePath)).size !== inputGraph.length
  ) {
    fail("D0_PRODUCT_ADAPTER_INPUT_GRAPH_INVALID");
  }
  const stagingArtifact = fileArtifact(stagingPath, "D0_PRODUCT_ADAPTER_BUNDLE_FAILED");
  const immutableRoot = join(bundleRoot, "immutable-bundle");
  mkdirSync(immutableRoot, { recursive: false });
  const artifact = materializeImmutableArtifact(
    stagingArtifact,
    immutableRoot,
    "desktop-runtime-adapter.mjs",
    "D0_PRODUCT_ADAPTER_BUNDLE_FAILED",
  );
  const outputArtifact = copyArtifactSnapshot(
    artifact,
    resolve(output, ADAPTER_BUNDLE_ARTIFACT_PATH),
    output,
    "D0_PRODUCT_ADAPTER_BUNDLE_FAILED",
  );
  return {
    artifact,
    outputArtifact,
    bundleRoot,
    build: {
      builder: "esbuild",
      version: esbuildPackage.version,
      inputGraph,
      esbuildMetafileSha256: hash(stable(result.metafile)),
    },
  };
}

async function waitForMcpState(adapter, expected, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (adapter.getMcpState().status === expected) return;
    await sleep(25);
  }
  fail("D0_PRODUCT_ADAPTER_STATE_TIMEOUT");
}

async function connectAndDiscover(adapter, endpoint) {
  adapter.setMcpEndpoint(endpoint);
  const deadline = Date.now() + 20_000;
  let connected = false;
  while (Date.now() < deadline) {
    await adapter.connectMcp();
    connected = adapter.getMcpState().status === "connected";
    if (connected) {
      await adapter.discoverMcp();
      if (adapter.getMcpState().status === "connected" && adapter.getMcpDiscovery()) return;
    }
    await sleep(100);
  }
  fail(connected ? "D0_PRODUCT_DISCOVERY_FAILED" : "D0_PRODUCT_CONNECT_FAILED");
}

function stageSessionHash(sessionState, startIndex, expectedPrevious = null, requireNew = false) {
  const hashes = [
    ...new Set(
      sessionState.observations.slice(startIndex).map(({ sessionIdHash }) => sessionIdHash),
    ),
  ];
  if (hashes.length !== 1) fail("D0_PRODUCT_STAGE_SESSION_ID_INVALID");
  const sessionIdHash = hashes[0];
  if (
    expectedPrevious &&
    (requireNew ? sessionIdHash === expectedPrevious : sessionIdHash !== expectedPrevious)
  ) {
    fail("D0_PRODUCT_STAGE_SESSION_GENERATION_INVALID");
  }
  return sessionIdHash;
}

async function trustTaskProject(bridge, binding) {
  const result = await bridge.request("trust_native_project_root", {
    rootRef: binding.projectRoot,
  });
  if (
    result?.trustState !== "trusted" ||
    typeof result.rootId !== "string" ||
    result.rootId.length === 0
  ) {
    fail("D0_PRODUCT_NATIVE_TRUST_FAILED");
  }
  return result.rootId;
}

async function attachCurrentEditor(bridge, binding) {
  const config = {
    projectId: D0_TASK_ID,
    rootRef: binding.projectRoot,
    uprojectRelativePath: basename(binding.project),
    editorExecutable: null,
    args: null,
  };
  const discovery = await bridge.request("discover_editor_processes", config);
  if (
    discovery?.status !== "ready" ||
    !Array.isArray(discovery.processes) ||
    discovery.processes.length !== 1
  ) {
    fail("D0_PRODUCT_NATIVE_EDITOR_DISCOVERY_FAILED");
  }
  const processDescriptor = discovery.processes[0];
  if (
    typeof processDescriptor?.id !== "string" ||
    typeof processDescriptor.pidHash !== "string" ||
    typeof processDescriptor.displayName !== "string"
  ) {
    fail("D0_PRODUCT_NATIVE_EDITOR_DESCRIPTOR_INVALID");
  }
  const attached = await bridge.request("attach_editor_process", {
    projectId: D0_TASK_ID,
    rootRef: binding.projectRoot,
    uprojectRelativePath: basename(binding.project),
    processId: processDescriptor.id,
    pidHash: processDescriptor.pidHash,
    processDisplayName: processDescriptor.displayName,
    mode: "attached",
  });
  if (
    attached?.status !== "attached" ||
    typeof attached.sessionId !== "string" ||
    attached.sessionId.length === 0
  ) {
    fail("D0_PRODUCT_NATIVE_EDITOR_ATTACH_FAILED");
  }
  return {
    editorSessionId: attached.sessionId,
    editorSessionIdHash: hash(attached.sessionId),
    processDescriptorHash: hash(stable(processDescriptor)),
  };
}

async function attestCurrentCompanion(adapter, trustedRootId, editorSessionId, exchanges) {
  if (typeof adapter.refreshMvp15DCompanionAttestation !== "function") {
    fail("D0_PRODUCT_COMPANION_ATTESTATION_UNAVAILABLE");
  }
  const exchangeStart = exchanges.length;
  const status = await adapter.refreshMvp15DCompanionAttestation(trustedRootId, editorSessionId);
  const nativeResponse = exchanges
    .slice(exchangeStart)
    .find(
      (exchange) =>
        exchange.direction === "response" && exchange.method === "native/attest_mvp15_companion",
    );
  const nativePayload =
    nativeResponse?.payload &&
    typeof nativeResponse.payload === "object" &&
    !Array.isArray(nativeResponse.payload)
      ? nativeResponse.payload
      : null;
  const fullyVerified =
    status?.status === "verified" &&
    status.identityAttested === true &&
    status.liveFingerprintReady === true;
  const revocationBound =
    status?.status === "incompatible" &&
    status.reason === "companion_live_identity_missing" &&
    nativePayload?.status === "native_observed_revocation_bound" &&
    nativePayload.bindingEstablished === true;
  if (!fullyVerified && !revocationBound) {
    console.error(
      JSON.stringify({
        status: "diagnostic",
        boundary: "native_companion_attestation",
        companionStatus: status?.status ?? null,
        blocker: status?.blocker ?? null,
        reason: status?.reason ?? null,
        identityAttested: status?.identityAttested === true,
        liveFingerprintReady: status?.liveFingerprintReady === true,
        toolNames: (adapter.getMcpDiscovery()?.tools ?? []).map(({ name }) => name),
      }),
    );
    fail("D0_PRODUCT_COMPANION_ATTESTATION_FAILED");
  }
  return {
    status: fullyVerified ? status.status : "native_observed_revocation_bound",
    currentGeneration: status.currentGeneration,
    manifestSha256Prefix: status.manifestSha256Prefix,
    liveFingerprintSha256Prefix: fullyVerified ? status.liveFingerprintSha256Prefix : null,
  };
}

async function validateCurrentPublicationAndNoOp(
  adapter,
  combination,
  exchanges,
  stageExchangeStart,
) {
  const discovery = adapter.getMcpDiscovery();
  if (!discovery || !Array.isArray(discovery.tools) || discovery.tools.length === 0) {
    fail("D0_PRODUCT_CURRENT_DISCOVERY_MISSING");
  }
  const names = discovery.tools.map(({ name }) => name);
  const duplicateNames = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicateNames.length > 0) fail("D0_PRODUCT_DUPLICATE_INVENTORY");
  const hasDirectProbe = names.includes(D0_DIRECT_PROBE_NAME);
  const hasQualifiedProbe = names.includes(D0_QUALIFIED_PROBE_NAME);
  const hasToolsetMeta = D0_TOOLSET_META_NAMES.some((name) => names.includes(name));
  if (
    combination.route === "direct"
      ? names.filter((name) => name === D0_DIRECT_PROBE_NAME).length !== 1 || hasQualifiedProbe
      : combination.toolSearch
        ? D0_TOOLSET_META_NAMES.some(
            (name) => names.filter((candidate) => candidate === name).length !== 1,
          ) ||
          hasDirectProbe ||
          hasQualifiedProbe
        : names.filter((name) => name === D0_QUALIFIED_PROBE_NAME).length !== 1 ||
          hasDirectProbe ||
          hasToolsetMeta
  ) {
    fail("D0_PRODUCT_CURRENT_INVENTORY_INVALID");
  }
  const fingerprint = adapter.getMvp15LiveAssetToolsetFingerprint?.();
  if (
    !fingerprint ||
    !Number.isSafeInteger(fingerprint.discoveryGeneration) ||
    fingerprint.discoveryGeneration < 1 ||
    !Number.isSafeInteger(fingerprint.binding?.generation) ||
    fingerprint.binding.generation < 1
  ) {
    fail("D0_PRODUCT_ADAPTER_GENERATION_MISSING");
  }
  const startIndex = exchanges.length;
  const raw = await adapter.runMvp15DProductNoOpProbe(combination.route, combination.toolSearch);
  const pair = noOpExchangePair(exchanges, combination, startIndex);
  const structured = recursivelyFind(
    raw,
    (value) =>
      value && typeof value === "object" && value.status === "noop" && value.mutationCount === 0,
  );
  const structuredResponse = recursivelyFind(
    pair.response.payload,
    (value) =>
      value && typeof value === "object" && value.status === "noop" && value.mutationCount === 0,
  );
  if (
    !structured ||
    !structuredResponse ||
    structured.route !== combination.route ||
    structured.toolSearchEnabled !== combination.toolSearch ||
    stable(structured) !== stable(structuredResponse) ||
    pair.generation !== fingerprint.discoveryGeneration
  ) {
    fail("D0_PRODUCT_NOOP_RESULT_INVALID");
  }
  const descriptor = findProbeDescriptor(
    combination,
    discovery.tools,
    exchanges.slice(stageExchangeStart),
  );
  return {
    ...pair,
    descriptor,
    raw,
    publication: {
      inventory: {
        toolNames: names,
        duplicateToolNames: [],
      },
      probe: {
        descriptor,
        descriptorSha256: hash(stable(descriptor)),
        schemaSha256: hash(stable(descriptor.inputSchema)),
      },
      noOp: {
        ...exchangeEvidence(pair),
        mutationCount: 0,
      },
      adapterGeneration: {
        discoveryGeneration: fingerprint.discoveryGeneration,
        bindingGeneration: fingerprint.binding.generation,
      },
    },
  };
}

function requirePublicationDiscoveryGeneration(publication, expectedGeneration) {
  if (
    !Number.isSafeInteger(expectedGeneration) ||
    expectedGeneration < 1 ||
    publication?.adapterGeneration?.discoveryGeneration !== expectedGeneration
  ) {
    fail("D0_PRODUCT_PUBLICATION_GENERATION_MISMATCH");
  }
}

async function runCombination({
  adapterFactory,
  binding,
  combination,
  index,
  nativeBridge,
  logRoot,
  runnerSource,
  assertIntegrity,
}) {
  assertIntegrity();
  const runDirectory = join(logRoot, combination.id);
  mkdirSync(runDirectory, { recursive: false });
  const contentRoot = join(binding.projectRoot, "Content");
  const contentBefore = aggregateContent(contentRoot);
  const port = await allocatePort();
  const endpoint = `http://127.0.0.1:${port}/mcp`;
  const sessionState = { sessionIdHash: null, observations: [] };
  const exchanges = [];
  const bridgeMarker = `uagent-mvp15d-rework7-bridge-${hash(`${binding.project}|${combination.id}|${port}`).slice(0, 32)}`;
  const bridge = await new PersistentBridge(nativeBridge, bridgeMarker, sessionState).start();
  const trustedRootId = await trustTaskProject(bridge, binding);
  const captureAdapterExchange = (exchange) => {
    if (exchanges.length >= MAX_CAPTURED_EXCHANGES) fail("D0_PRODUCT_EXCHANGE_LIMIT");
    exchanges.push(exchange);
    if (exchange.method === "tools/call") {
      recentToolExchangeDiagnostics.push(exchange);
      if (recentToolExchangeDiagnostics.length > 8) recentToolExchangeDiagnostics.shift();
    }
  };
  let adapter = adapterFactory({
    nativeInvoke: bridge.invoke(),
    onMvp15DProductAdapterExchange: captureAdapterExchange,
  });
  if (typeof adapter.runMvp15DProductNoOpProbe !== "function")
    fail("D0_PRODUCT_NOOP_RUNNER_UNAVAILABLE");
  for (let generationOffset = 0; generationOffset < index; generationOffset += 1) {
    adapter.setMcpEndpoint(`${endpoint}?uagent_generation=${generationOffset + 1}`);
  }

  const firstLog = join(runDirectory, "UnrealEditor-Cmd-initial.log");
  const first = launchEditor(binding, combination, port, firstLog);
  await claimEditorProcess(first);
  await waitForOwnedListener(port, first.ownership);
  let editorBinding = await attachCurrentEditor(bridge, binding);
  const initialExchangeStart = exchanges.length;
  const initialSessionStart = sessionState.observations.length;
  await connectAndDiscover(adapter, endpoint);
  const initialize = jsonRpcExchangePair(exchanges, "initialize", initialExchangeStart);
  const discovery = jsonRpcExchangePair(exchanges, "tools/list", initialExchangeStart);
  if (discovery.generation <= initialize.generation) fail("D0_PRODUCT_INITIAL_GENERATION_INVALID");
  const initialAttestation = await attestCurrentCompanion(
    adapter,
    trustedRootId,
    editorBinding.editorSessionId,
    exchanges,
  );
  const initialNoOp = await validateCurrentPublicationAndNoOp(
    adapter,
    combination,
    exchanges,
    initialExchangeStart,
  );
  requirePublicationDiscoveryGeneration(initialNoOp.publication, discovery.generation);
  const initialSessionIdHash = stageSessionHash(sessionState, initialSessionStart);
  const descriptors = discoveryDescriptors(discovery.response);
  const noOpRequest = initialNoOp.request;
  const noOpResponse = initialNoOp.response;
  const probeDescriptor = initialNoOp.descriptor;

  const refreshBefore = discovery.generation;
  const refreshExchangeStart = exchanges.length;
  const refreshSessionStart = sessionState.observations.length;
  await adapter.discoverMcp();
  const refreshDiscovery = jsonRpcExchangePair(exchanges, "tools/list", refreshExchangeStart);
  const refreshAfter = refreshDiscovery.generation;
  if (refreshAfter <= refreshBefore || !adapter.getMcpDiscovery()) {
    fail("D0_PRODUCT_REFRESH_FAILED");
  }
  const refreshAttestation = await attestCurrentCompanion(
    adapter,
    trustedRootId,
    editorBinding.editorSessionId,
    exchanges,
  );
  const refreshValidation = await validateCurrentPublicationAndNoOp(
    adapter,
    combination,
    exchanges,
    refreshExchangeStart,
  );
  requirePublicationDiscoveryGeneration(refreshValidation.publication, refreshAfter);
  if (
    refreshValidation.publication.adapterGeneration.bindingGeneration <=
      initialNoOp.publication.adapterGeneration.bindingGeneration ||
    refreshValidation.publication.adapterGeneration.discoveryGeneration <=
      initialNoOp.publication.adapterGeneration.discoveryGeneration
  ) {
    fail("D0_PRODUCT_REFRESH_GENERATION_REUSE");
  }
  const refreshSessionIdHash = stageSessionHash(
    sessionState,
    refreshSessionStart,
    initialSessionIdHash,
    false,
  );

  const reconnectBoundaryStart = exchanges.length;
  adapter.disconnectMcp();
  await waitForMcpState(adapter, "disconnected");
  const reconnectBefore = adapterExchangeGenerationPair(
    exchanges,
    "native/retract_mvp15_companion_approvals",
    reconnectBoundaryStart,
  ).generation;
  if (reconnectBefore <= refreshAfter) fail("D0_PRODUCT_RECONNECT_BOUNDARY_INVALID");
  const reconnectExchangeStart = exchanges.length;
  const reconnectSessionStart = sessionState.observations.length;
  await connectAndDiscover(adapter, endpoint);
  const reconnectInitialize = jsonRpcExchangePair(exchanges, "initialize", reconnectExchangeStart);
  const reconnectDiscovery = jsonRpcExchangePair(exchanges, "tools/list", reconnectExchangeStart);
  const reconnectAfter = reconnectDiscovery.generation;
  if (
    reconnectInitialize.generation <= reconnectBefore ||
    reconnectAfter <= reconnectInitialize.generation
  ) {
    fail("D0_PRODUCT_RECONNECT_FAILED");
  }
  const reconnectAttestation = await attestCurrentCompanion(
    adapter,
    trustedRootId,
    editorBinding.editorSessionId,
    exchanges,
  );
  const reconnectValidation = await validateCurrentPublicationAndNoOp(
    adapter,
    combination,
    exchanges,
    reconnectExchangeStart,
  );
  requirePublicationDiscoveryGeneration(reconnectValidation.publication, reconnectAfter);
  if (
    reconnectValidation.publication.adapterGeneration.bindingGeneration <=
      refreshValidation.publication.adapterGeneration.bindingGeneration ||
    reconnectValidation.publication.adapterGeneration.discoveryGeneration <=
      refreshValidation.publication.adapterGeneration.discoveryGeneration
  ) {
    fail("D0_PRODUCT_RECONNECT_GENERATION_REUSE");
  }
  const reconnectSessionIdHash = stageSessionHash(
    sessionState,
    reconnectSessionStart,
    refreshSessionIdHash,
    true,
  );

  let firstListenerState = null;
  const unsubscribe = adapter.subscribeMcp((state) => {
    if (!firstListenerState) {
      firstListenerState = {
        status: state.status,
        discoveryCleared: adapter.getMcpDiscovery() === null,
        companionVerified: adapter.getMvp15DCompanionStatus?.().status === "verified",
      };
    }
  });
  const retractionStart = bridge.nativeLifecycle.length;
  const listenerRetractionExchangeStart = exchanges.length;
  adapter.disconnectMcp();
  await waitForMcpState(adapter, "disconnected");
  unsubscribe();
  const listenerRetractionExchange = adapterExchangeGenerationPair(
    exchanges,
    "native/retract_mvp15_companion_approvals",
    listenerRetractionExchangeStart,
  );
  const retractions = bridge.nativeLifecycle
    .slice(retractionStart)
    .filter(({ command }) => command === "retract_mvp15_companion_approvals");
  if (
    retractions.length !== 1 ||
    retractions[0].status !== "retracted" ||
    !firstListenerState?.discoveryCleared ||
    firstListenerState.companionVerified !== false ||
    firstListenerState.status !== "disconnected"
  ) {
    fail("D0_PRODUCT_FIRST_LISTENER_RETRACTION_FAILED");
  }
  if (listenerRetractionExchange.generation <= reconnectAfter) {
    fail("D0_PRODUCT_RETRACTION_RECOVERY_FAILED");
  }
  const firstListenerStaleRetraction = {
    status: retractions[0].status,
    nativeRetractionCompleted: true,
    requestId: retractions[0].requestId,
    responseRequestId: retractions[0].responseRequestId,
    attestationGeneration: retractions[0].attestationGeneration,
  };

  const recoveryExchangeStart = exchanges.length;
  const recoverySessionStart = sessionState.observations.length;
  await connectAndDiscover(adapter, endpoint);
  const recoveryInitialize = jsonRpcExchangePair(exchanges, "initialize", recoveryExchangeStart);
  const recoveryDiscovery = jsonRpcExchangePair(exchanges, "tools/list", recoveryExchangeStart);
  if (
    recoveryInitialize.generation <= listenerRetractionExchange.generation ||
    recoveryDiscovery.generation <= recoveryInitialize.generation
  ) {
    fail("D0_PRODUCT_RETRACTION_RECOVERY_FAILED");
  }
  const recoveryAttestation = await attestCurrentCompanion(
    adapter,
    trustedRootId,
    editorBinding.editorSessionId,
    exchanges,
  );
  const recoveryValidation = await validateCurrentPublicationAndNoOp(
    adapter,
    combination,
    exchanges,
    recoveryExchangeStart,
  );
  requirePublicationDiscoveryGeneration(
    recoveryValidation.publication,
    recoveryDiscovery.generation,
  );
  if (
    recoveryValidation.publication.adapterGeneration.bindingGeneration <=
      reconnectValidation.publication.adapterGeneration.bindingGeneration ||
    recoveryValidation.publication.adapterGeneration.discoveryGeneration <=
      reconnectValidation.publication.adapterGeneration.discoveryGeneration
  ) {
    fail("D0_PRODUCT_RETRACTION_RECOVERY_GENERATION_REUSE");
  }
  const recoverySessionIdHash = stageSessionHash(
    sessionState,
    recoverySessionStart,
    reconnectSessionIdHash,
    true,
  );
  const retractionRecovery = {
    beforeGeneration: listenerRetractionExchange.generation,
    connectionGeneration: recoveryInitialize.generation,
    afterGeneration: recoveryDiscovery.generation,
    completed: true,
    sessionIdHash: recoverySessionIdHash,
    triggeringRetractionRequestId: retractions[0].requestId,
    initialize: exchangeEvidence(recoveryInitialize),
    discovery: exchangeEvidence(recoveryDiscovery),
    attestation: recoveryAttestation,
    publication: recoveryValidation.publication,
  };

  const staleRetractionStart = bridge.nativeLifecycle.length;
  const staleRetractionResult = await bridge.invoke()("retract_mvp15_companion_approvals", {
    input: { attestationGeneration: 1 },
  });
  const staleRetractionCommand = bridge.nativeLifecycle
    .slice(staleRetractionStart)
    .find(({ command }) => command === "retract_mvp15_companion_approvals");
  if (
    staleRetractionResult?.status !== "stale" ||
    staleRetractionResult?.applied !== false ||
    staleRetractionResult?.requestedAttestationGeneration !== 1 ||
    !Number.isSafeInteger(staleRetractionResult?.minimumAttestationGeneration) ||
    staleRetractionResult.minimumAttestationGeneration <= 1 ||
    staleRetractionCommand?.status !== "stale" ||
    staleRetractionCommand?.applied !== false
  ) {
    fail("D0_PRODUCT_STALE_RETRACTION_INVALID");
  }
  const staleRetraction = {
    status: staleRetractionResult.status,
    applied: staleRetractionResult.applied,
    requestedAttestationGeneration: staleRetractionResult.requestedAttestationGeneration,
    minimumAttestationGeneration: staleRetractionResult.minimumAttestationGeneration,
    nativeGeneration: staleRetractionResult.generation,
    requestId: staleRetractionCommand.requestId,
    responseRequestId: staleRetractionCommand.responseRequestId,
  };

  const priorAdapter = adapter;
  const reconstructionNativeStart = bridge.nativeLifecycle.length;
  const reconstructionExchangeStart = exchanges.length;
  const reconstructionSessionStart = sessionState.observations.length;
  let reconstructionFirstListener = null;
  const reconstructedAdapter = adapterFactory({
    nativeInvoke: bridge.invoke(),
    onMvp15DProductAdapterExchange: captureAdapterExchange,
  });
  const unsubscribeReconstruction = reconstructedAdapter.subscribeMcp((state) => {
    if (reconstructionFirstListener) return;
    const baseline = bridge.nativeLifecycle
      .slice(reconstructionNativeStart)
      .find(
        (command) =>
          command.command === "retract_mvp15_companion_approvals" &&
          command.attestationGeneration === null,
      );
    reconstructionFirstListener = {
      status: state.status,
      discoveryCleared: reconstructedAdapter.getMcpDiscovery() === null,
      companionVerified: reconstructedAdapter.getMvp15DCompanionStatus?.().status === "verified",
      nativeZeroAuthorityBaselineCompleted:
        baseline?.status === "retracted" && baseline?.applied === true,
    };
  });
  await connectAndDiscover(reconstructedAdapter, endpoint);
  unsubscribeReconstruction();
  const reconstructionInitialize = jsonRpcExchangePair(
    exchanges,
    "initialize",
    reconstructionExchangeStart,
  );
  const reconstructionDiscovery = jsonRpcExchangePair(
    exchanges,
    "tools/list",
    reconstructionExchangeStart,
  );
  const startupBaseline = bridge.nativeLifecycle
    .slice(reconstructionNativeStart)
    .find(
      (command) =>
        command.command === "retract_mvp15_companion_approvals" &&
        command.attestationGeneration === null,
    );
  if (
    startupBaseline?.status !== "retracted" ||
    startupBaseline?.applied !== true ||
    startupBaseline?.requestedAttestationGeneration !== null ||
    !reconstructionFirstListener?.nativeZeroAuthorityBaselineCompleted ||
    !reconstructionFirstListener.discoveryCleared ||
    reconstructionFirstListener.companionVerified !== false
  ) {
    fail("D0_PRODUCT_RENDERER_RECONSTRUCTION_BASELINE_FAILED");
  }
  adapter = reconstructedAdapter;
  const reconstructionAttestation = await attestCurrentCompanion(
    adapter,
    trustedRootId,
    editorBinding.editorSessionId,
    exchanges,
  );
  const reconstructionValidation = await validateCurrentPublicationAndNoOp(
    adapter,
    combination,
    exchanges,
    reconstructionExchangeStart,
  );
  requirePublicationDiscoveryGeneration(
    reconstructionValidation.publication,
    reconstructionDiscovery.generation,
  );
  if (
    reconstructionValidation.publication.adapterGeneration.bindingGeneration <=
      recoveryValidation.publication.adapterGeneration.bindingGeneration ||
    reconstructionValidation.publication.adapterGeneration.discoveryGeneration <=
      recoveryValidation.publication.adapterGeneration.discoveryGeneration
  ) {
    fail("D0_PRODUCT_RECONSTRUCTION_GENERATION_REUSE");
  }
  const reconstructionSessionIdHash = stageSessionHash(
    sessionState,
    reconstructionSessionStart,
    recoverySessionIdHash,
    true,
  );
  const rendererReconstruction = {
    completed: true,
    priorDiscoveryGeneration: recoveryDiscovery.generation,
    connectionGeneration: reconstructionInitialize.generation,
    discoveryGeneration: reconstructionDiscovery.generation,
    sessionIdHash: reconstructionSessionIdHash,
    firstListener: reconstructionFirstListener,
    startupRetraction: {
      status: startupBaseline.status,
      applied: startupBaseline.applied,
      requestedAttestationGeneration: startupBaseline.requestedAttestationGeneration,
      minimumAttestationGeneration: startupBaseline.minimumAttestationGeneration,
      nativeGeneration: startupBaseline.nativeGeneration,
      requestId: startupBaseline.requestId,
      responseRequestId: startupBaseline.responseRequestId,
    },
    initialize: exchangeEvidence(reconstructionInitialize),
    discovery: exchangeEvidence(reconstructionDiscovery),
    attestation: reconstructionAttestation,
    publication: reconstructionValidation.publication,
  };

  const restartBefore = reconstructionDiscovery.generation;
  const firstClosed = await closeTaskProcess(first, port);
  await adapter.discoverMcp();
  if (adapter.getMcpDiscovery() !== null) fail("D0_PRODUCT_RESTART_STALE_PUBLICATION");
  assertIntegrity();
  const secondLog = join(runDirectory, "UnrealEditor-Cmd-restarted.log");
  const second = launchEditor(binding, combination, port, secondLog);
  await claimEditorProcess(second);
  await waitForOwnedListener(port, second.ownership);
  editorBinding = await attachCurrentEditor(bridge, binding);
  const restartExchangeStart = exchanges.length;
  const restartSessionStart = sessionState.observations.length;
  await connectAndDiscover(adapter, endpoint);
  const restartInitialize = jsonRpcExchangePair(exchanges, "initialize", restartExchangeStart);
  const restartDiscovery = jsonRpcExchangePair(exchanges, "tools/list", restartExchangeStart);
  const restartAfter = restartDiscovery.generation;
  if (
    restartInitialize.generation <= restartBefore ||
    restartAfter <= restartInitialize.generation
  ) {
    fail("D0_PRODUCT_RESTART_FAILED");
  }
  const restartAttestation = await attestCurrentCompanion(
    adapter,
    trustedRootId,
    editorBinding.editorSessionId,
    exchanges,
  );
  const restartValidation = await validateCurrentPublicationAndNoOp(
    adapter,
    combination,
    exchanges,
    restartExchangeStart,
  );
  requirePublicationDiscoveryGeneration(restartValidation.publication, restartAfter);
  if (
    restartValidation.publication.adapterGeneration.bindingGeneration <=
      reconstructionValidation.publication.adapterGeneration.bindingGeneration ||
    restartValidation.publication.adapterGeneration.discoveryGeneration <=
      reconstructionValidation.publication.adapterGeneration.discoveryGeneration
  ) {
    fail("D0_PRODUCT_RESTART_GENERATION_REUSE");
  }
  const restartSessionIdHash = stageSessionHash(
    sessionState,
    restartSessionStart,
    reconstructionSessionIdHash,
    true,
  );

  adapter.disconnectMcp();
  await waitForMcpState(adapter, "disconnected");
  priorAdapter.disconnectMcp();
  await waitForMcpState(priorAdapter, "disconnected");
  const secondClosed = await closeTaskProcess(second, port);
  const nativeLifecycle = {
    bridgeProcessIdentityHash: bridge.ownership.root.identitySha256,
    commands: [...bridge.nativeLifecycle],
  };
  await bridge.close();
  assertIntegrity();
  const contentAfter = aggregateContent(contentRoot);
  const contentUnchanged = stable(contentBefore) === stable(contentAfter);
  const processClosed = firstClosed && secondClosed;
  const portClosed = listeningPids(port).size === 0;
  const markerClosed =
    markerProcesses(first.marker).length === 0 &&
    markerProcesses(second.marker).length === 0 &&
    markerProcesses(bridgeMarker).length === 0;
  if (!processClosed || !portClosed || !contentUnchanged || !markerClosed) {
    fail("D0_PRODUCT_CLOSEOUT_FAILED");
  }

  const names = descriptors.map(({ name }) => name);
  const duplicateToolNames = [
    ...new Set(names.filter((name, nameIndex) => names.indexOf(name) !== nameIndex)),
  ].sort();
  if (duplicateToolNames.length > 0) fail("D0_PRODUCT_DUPLICATE_INVENTORY");
  return {
    schemaVersion: D0_RAW_TRANSCRIPT_SCHEMA_VERSION,
    taskId: D0_TASK_ID,
    captureOrigin: D0_CAPTURE_ORIGIN,
    producer: {
      ...PRODUCT_PRODUCER,
      sourceSha256: runnerSource.sha256,
    },
    provenance: PRODUCT_PROVENANCE,
    combination: combination.id,
    route: combination.route,
    toolSearch: combination.toolSearch,
    session: {
      connectionGeneration: initialize.generation,
      discoveryGeneration: discovery.generation,
      sessionIdHash: initialSessionIdHash,
      process: {
        kind: "task_owned",
        pidHash: hash(
          stable([first.ownership.root.identitySha256, second.ownership.root.identitySha256]),
        ),
        portHash: hash(port),
      },
    },
    initialize: exchangeEvidence(initialize),
    discovery: exchangeEvidence(discovery),
    probe: {
      descriptor: probeDescriptor,
      descriptorSha256: hash(stable(probeDescriptor)),
      schema: probeDescriptor.inputSchema,
      schemaSha256: hash(stable(probeDescriptor.inputSchema)),
    },
    inventory: initialNoOp.publication.inventory,
    attestation: initialAttestation,
    nativeLifecycle,
    lifecycle: {
      refresh: {
        beforeGeneration: refreshBefore,
        afterGeneration: refreshAfter,
        completed: true,
        sessionIdHash: refreshSessionIdHash,
        discovery: exchangeEvidence(refreshDiscovery),
        attestation: refreshAttestation,
        publication: refreshValidation.publication,
      },
      reconnect: {
        beforeGeneration: reconnectBefore,
        afterGeneration: reconnectAfter,
        completed: true,
        connectionGeneration: reconnectInitialize.generation,
        sessionIdHash: reconnectSessionIdHash,
        initialize: exchangeEvidence(reconnectInitialize),
        discovery: exchangeEvidence(reconnectDiscovery),
        attestation: reconnectAttestation,
        publication: reconnectValidation.publication,
      },
      editorRestart: {
        beforeGeneration: restartBefore,
        afterGeneration: restartAfter,
        completed: true,
        connectionGeneration: restartInitialize.generation,
        sessionIdHash: restartSessionIdHash,
        editorSessionIdHash: editorBinding.editorSessionIdHash,
        processDescriptorHash: editorBinding.processDescriptorHash,
        initialize: exchangeEvidence(restartInitialize),
        discovery: exchangeEvidence(restartDiscovery),
        attestation: restartAttestation,
        publication: restartValidation.publication,
      },
      firstListenerStaleRetraction,
      retractionRecovery,
      rendererReconstruction,
      staleRetraction,
    },
    noOp: {
      ...exchangeEvidence({ request: noOpRequest, response: noOpResponse }),
      mutationCount: 0,
    },
    closeout: {
      completed: true,
      contentUnchanged,
      mutationCount: 0,
      portClosed,
      processClosed,
      markerClosed,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const binding = resolveTaskProject(args.project);
  const output = createD0ProductOutput(args.output);
  const runnerSource = fileArtifact(
    fileURLToPath(import.meta.url),
    "D0_PRODUCT_RUNNER_SOURCE_INVALID",
  );
  const nativeBridgeBinary = resolveNativeBridge(workspace, args["native-bridge"]);
  const nativeBridgeSource = fileArtifact(
    resolve(workspace, NATIVE_BRIDGE_SOURCE),
    "D0_PRODUCT_NATIVE_BRIDGE_SOURCE_INVALID",
  );
  const adapterSource = fileArtifact(
    resolve(workspace, ADAPTER_SOURCE),
    "D0_PRODUCT_ADAPTER_SOURCE_INVALID",
  );
  requireFile(resolve(EDITOR), "D0_PRODUCT_EDITOR_UNAVAILABLE");
  const adapterBuild = await bundleAdapter(workspace, binding, output);
  const adapterBundle = adapterBuild.artifact;
  const nativeBridgeRoot = join(adapterBuild.bundleRoot, "immutable-native-bridge");
  mkdirSync(nativeBridgeRoot, { recursive: false });
  const nativeBridge = {
    ...materializeImmutableArtifact(
      nativeBridgeBinary,
      nativeBridgeRoot,
      NATIVE_BRIDGE_NAME,
      "D0_PRODUCT_NATIVE_BRIDGE_INVALID",
    ),
    profile: nativeBridgeBinary.profile,
  };
  const nativeBridgeOutput = {
    ...copyArtifactSnapshot(
      nativeBridge,
      resolve(output, NATIVE_BRIDGE_ARTIFACT_PATH),
      output,
      "D0_PRODUCT_NATIVE_BRIDGE_INVALID",
    ),
    profile: nativeBridge.profile,
  };
  const nativeBridgeSourceOutput = {
    ...copyArtifactSnapshot(
      nativeBridgeSource,
      resolve(output, NATIVE_BRIDGE_SOURCE_ARTIFACT_PATH),
      output,
      "D0_PRODUCT_NATIVE_BRIDGE_SOURCE_INVALID",
    ),
    entrypoint: NATIVE_BRIDGE_SOURCE,
  };
  const adapterMetafile = {
    schemaVersion: D0_ADAPTER_METAFILE_SCHEMA_VERSION,
    taskId: D0_TASK_ID,
    entrypoint: ADAPTER_SOURCE,
    builder: adapterBuild.build.builder,
    builderVersion: adapterBuild.build.version,
    esbuildMetafileSha256: adapterBuild.build.esbuildMetafileSha256,
    output: adapterBuild.outputArtifact,
    inputs: adapterBuild.build.inputGraph,
  };
  const adapterMetafileOutput = writeJsonArtifact(
    output,
    ADAPTER_METAFILE_PATH,
    adapterMetafile,
    "D0_PRODUCT_ADAPTER_METAFILE_INVALID",
  );
  const runnerArtifact = {
    schemaVersion: D0_RUNNER_ARTIFACT_SCHEMA_VERSION,
    taskId: D0_TASK_ID,
    entrypoint: PRODUCT_PRODUCER.entrypoint,
    sourceSize: runnerSource.size,
    sourceSha256: runnerSource.sha256,
  };
  const runnerArtifactOutput = writeJsonArtifact(
    output,
    RUNNER_ARTIFACT_PATH,
    runnerArtifact,
    "D0_PRODUCT_RUNNER_ARTIFACT_INVALID",
  );
  const assertIntegrity = () => {
    assertFileArtifact(runnerSource, "D0_PRODUCT_RUNNER_SOURCE_CHANGED");
    assertFileArtifact(nativeBridgeBinary, "D0_PRODUCT_NATIVE_BRIDGE_SOURCE_BINARY_CHANGED");
    assertFileArtifact(nativeBridge, "D0_PRODUCT_NATIVE_BRIDGE_CHANGED");
    assertImmutableArtifact(nativeBridge, "D0_PRODUCT_NATIVE_BRIDGE_CHANGED");
    assertFileArtifact(nativeBridgeSource, "D0_PRODUCT_NATIVE_BRIDGE_SOURCE_CHANGED");
    assertFileArtifact(adapterSource, "D0_PRODUCT_ADAPTER_SOURCE_CHANGED");
    assertImmutableArtifact(adapterBundle, "D0_PRODUCT_ADAPTER_BUNDLE_CHANGED");
    assertOutputArtifact(output, adapterBuild.outputArtifact, "D0_PRODUCT_ADAPTER_BUNDLE_CHANGED");
    assertOutputArtifact(output, nativeBridgeOutput, "D0_PRODUCT_NATIVE_BRIDGE_CHANGED");
    assertOutputArtifact(
      output,
      nativeBridgeSourceOutput,
      "D0_PRODUCT_NATIVE_BRIDGE_SOURCE_CHANGED",
    );
    assertOutputArtifact(output, adapterMetafileOutput, "D0_PRODUCT_ADAPTER_METAFILE_CHANGED");
    assertOutputArtifact(output, runnerArtifactOutput, "D0_PRODUCT_RUNNER_ARTIFACT_CHANGED");
    for (const input of adapterBuild.build.inputGraph) {
      assertOutputArtifact(
        output,
        {
          path: input.artifactPath,
          size: input.size,
          sha256: input.sha256,
        },
        "D0_PRODUCT_ADAPTER_INPUT_GRAPH_CHANGED",
      );
    }
  };
  assertIntegrity();
  const adapterModule = await import(`${pathToFileURL(adapterBundle.path).href}?run=${Date.now()}`);
  if (typeof adapterModule.createDesktopRuntimeAdapter !== "function")
    fail("D0_PRODUCT_ADAPTER_ENTRYPOINT_INVALID");

  const logRoot = join(binding.projectRoot, "Saved", "UAgentMvp15DRework7D0");
  if (existsSync(logRoot)) fail("D0_PRODUCT_LOG_ROOT_ALREADY_EXISTS");
  mkdirSync(logRoot, { recursive: true });
  const transcriptRoot = join(output, "transcripts");
  const transcripts = [];
  for (let index = 0; index < D0_COMBINATIONS.length; index += 1) {
    const combination = D0_COMBINATIONS[index];
    const transcript = await runCombination({
      adapterFactory: adapterModule.createDesktopRuntimeAdapter,
      binding,
      combination,
      index,
      nativeBridge,
      logRoot,
      runnerSource,
      assertIntegrity,
    });
    if (index === 0) mkdirSync(transcriptRoot, { recursive: false });
    const transcriptPath = join(transcriptRoot, `${combination.id}.json`);
    writeFileSync(transcriptPath, `${JSON.stringify(transcript, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    transcripts.push({ id: combination.id, sha256: hash(readFileSync(transcriptPath)) });
  }

  assertIntegrity();
  writeJsonArtifact(
    output,
    "adapter.artifact.json",
    {
      schemaVersion: D0_ADAPTER_ARTIFACT_SCHEMA_VERSION,
      taskId: D0_TASK_ID,
      captureOrigin: D0_CAPTURE_ORIGIN,
      entrypoint: ADAPTER_SOURCE,
      sourceSha256: adapterSource.sha256,
      bundle: adapterBuild.outputArtifact,
      metafile: adapterMetafileOutput,
      nativeBridge: nativeBridgeOutput,
      nativeBridgeSource: nativeBridgeSourceOutput,
      producer: {
        ...PRODUCT_PRODUCER,
        sourceSha256: runnerSource.sha256,
      },
      provenance: PRODUCT_PROVENANCE,
    },
    "D0_PRODUCT_ADAPTER_ARTIFACT_INVALID",
  );
  writeJsonArtifact(
    output,
    "route-decision.json",
    {
      schemaVersion: D0_ROUTE_DECISION_SCHEMA_VERSION,
      taskId: D0_TASK_ID,
      selectedRoute: "direct",
      basisTranscriptIndexSha256: hash(stable(transcripts)),
      producer: {
        ...PRODUCT_PRODUCER,
        sourceSha256: runnerSource.sha256,
      },
      provenance: PRODUCT_PROVENANCE,
    },
    "D0_PRODUCT_ROUTE_DECISION_INVALID",
  );
  closeImmutableHandles();
  console.log(
    JSON.stringify({
      status: "completed",
      taskId: D0_TASK_ID,
      selectedRoute: "direct",
      sessionCount: transcripts.length,
      transcriptIndexSha256: hash(stable(transcripts)),
      mutationCount: 0,
    }),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch(async (error) => {
    const taskProcessesClosed = await closeOutstandingTaskProcesses();
    const persistentBridgesClosed = await closeOutstandingPersistentBridges();
    closeImmutableHandles();
    const processCloseoutCompleted = taskProcessesClosed && persistentBridgesClosed;
    const reason = error instanceof ProductEvidenceError ? error.code : "D0_PRODUCT_RUNNER_FAILED";
    const diagnostic =
      error instanceof ProductEvidenceError
        ? error.diagnostic
        : {
            name: error instanceof Error ? error.name : typeof error,
            message: error instanceof Error ? error.message : String(error),
            recentToolExchanges: recentToolExchangeDiagnostics,
          };
    console.error(
      JSON.stringify({
        status: "failed",
        reason,
        ...(diagnostic ? { diagnostic } : {}),
        mutationCount: 0,
        processCloseoutCompleted,
      }),
    );
    process.exitCode = 2;
  });
}
