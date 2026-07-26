#!/usr/bin/env node
/* global console, process */

/**
 * Rework-7 D0 hash-index writer.
 *
 * The desktop/native product adapter must first emit four redacted session
 * transcripts at its real connection/session/discovery boundary.  This utility
 * only copies that already-produced snapshot into a fresh task-owned temporary
 * directory and writes hashes for independent review.  It never launches UE or
 * manufactures a product-session result.
 */
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  D0_ADAPTER_ARTIFACT_SCHEMA_VERSION,
  D0_ADAPTER_METAFILE_SCHEMA_VERSION,
  D0_CAPTURE_ORIGIN,
  D0_COMBINATIONS,
  D0_EVIDENCE_SCHEMA_VERSION,
  D0_PRODUCT_ADAPTER_ENTRYPOINT,
  D0_RAW_TRANSCRIPT_SCHEMA_VERSION,
  D0_ROUTE_DECISION_SCHEMA_VERSION,
  D0_RUNNER_ARTIFACT_SCHEMA_VERSION,
  D0_TASK_ID,
  currentD0ProductProvenance,
  sha256Bytes,
  stable,
  validateTaskOwnedD0Bundle,
} from "./mvp15d-d0-spike.mjs";

const BUNDLE_DIRECTORY = "d0-product-adapter";
const TRANSCRIPTS_DIRECTORY = "transcripts";
const ADAPTER_ARTIFACT_FILE = "adapter.artifact.json";
const ROUTE_DECISION_FILE = "route-decision.json";
const RUNNER_ARTIFACT_FILE = "runner.artifact.json";
const ADAPTER_METAFILE = "adapter-bundle.metafile.json";
const ARTIFACT_DIRECTORY = "artifacts";
const ADAPTER_INPUT_DIRECTORY = "adapter-inputs";
const FIXED_ARTIFACT_FILES = ["adapter-bundle.js", "native-bridge.exe", "native-bridge-source.rs"];

class CaptureError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new CaptureError(code);
}

function isWithin(root, candidate) {
  const pathRelative = relative(root, candidate);
  return pathRelative === "" || (!pathRelative.startsWith("..") && !isAbsolute(pathRelative));
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

function taskOwnedRootPath(value, code) {
  const root = resolve(value);
  const parent = dirname(root);
  const tempRoot = resolve(tmpdir());
  const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const externalRoot = resolve(workspace, "external");
  const temporary =
    samePath(parent, tempRoot) && /^UAgent-MVP15D-Rework7-[A-Za-z0-9_-]+$/i.test(basename(root));
  const durable =
    samePath(parent, externalRoot) && /^mvp15d-rework7-[A-Za-z0-9_-]+$/i.test(basename(root));
  if (!temporary && !durable) fail(code);
  const allowedParent = temporary ? tempRoot : externalRoot;
  const parentStats = entryOrNull(allowedParent, "D0_CAPTURE_TASK_ROOT_INVALID");
  if (!parentStats?.isDirectory() || parentStats.isSymbolicLink())
    fail("D0_CAPTURE_TASK_ROOT_INVALID");
  return root;
}

function regularFile(path, code) {
  if (!existsSync(path)) fail(code);
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink()) fail(code);
  return path;
}

function directory(path, code) {
  if (!existsSync(path)) fail(code);
  const stats = lstatSync(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) fail(code);
  return path;
}

function child(root, name, code) {
  const path = resolve(root, name);
  if (!isWithin(root, path)) fail(code);
  return path;
}

function readJsonBytes(bytes, code) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(code);
  }
}

function assertExactKeys(value, expected, code) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index]))
    fail(code);
}

function sameFileSnapshot(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function readOpenedRegular(path, code) {
  regularFile(path, code);
  let descriptor;
  try {
    descriptor = openSync(path, "r");
    const before = fstatSync(descriptor);
    if (!before.isFile()) fail(code);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const pathAfter = lstatSync(path);
    if (
      !after.isFile() ||
      pathAfter.isSymbolicLink() ||
      !pathAfter.isFile() ||
      bytes.length !== after.size ||
      !sameFileSnapshot(before, after) ||
      !sameFileSnapshot(after, pathAfter)
    )
      fail(code);
    return { bytes, sha256: sha256Bytes(bytes), size: bytes.length };
  } catch (error) {
    if (error instanceof CaptureError) throw error;
    fail(code);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function requireSourceSnapshot(root) {
  const sourceRoot = directory(
    taskOwnedRootPath(root, "D0_CAPTURE_SESSION_ROOT_NOT_TASK_OWNED"),
    "D0_CAPTURE_SESSION_ROOT_INVALID",
  );
  const transcriptRoot = directory(
    child(sourceRoot, TRANSCRIPTS_DIRECTORY, "D0_CAPTURE_SESSION_ROOT_INVALID"),
    "D0_CAPTURE_SESSION_ROOT_INVALID",
  );
  const artifactRoot = directory(
    child(sourceRoot, ARTIFACT_DIRECTORY, "D0_CAPTURE_SESSION_ROOT_INVALID"),
    "D0_CAPTURE_SESSION_ROOT_INVALID",
  );
  const adapterInputRoot = directory(
    child(artifactRoot, ADAPTER_INPUT_DIRECTORY, "D0_CAPTURE_SESSION_ROOT_INVALID"),
    "D0_CAPTURE_SESSION_ROOT_INVALID",
  );
  const rootFiles = new Set([
    ADAPTER_ARTIFACT_FILE,
    ROUTE_DECISION_FILE,
    RUNNER_ARTIFACT_FILE,
    ADAPTER_METAFILE,
  ]);
  const rootEntries = readdirSync(sourceRoot, { withFileTypes: true });
  if (
    rootEntries.some((entry) => entry.isSymbolicLink()) ||
    rootEntries.filter((entry) => entry.isFile()).length !== rootFiles.size ||
    rootEntries.filter((entry) => entry.isFile()).some((entry) => !rootFiles.has(entry.name)) ||
    stable(
      rootEntries
        .filter((entry) => entry.isDirectory())
        .map(({ name }) => name)
        .sort(),
    ) !== stable([ARTIFACT_DIRECTORY, TRANSCRIPTS_DIRECTORY].sort()) ||
    rootEntries.some((entry) => !entry.isFile() && !entry.isDirectory())
  )
    fail("D0_CAPTURE_SESSION_ROOT_INVALID");
  const transcriptEntries = readdirSync(transcriptRoot, { withFileTypes: true });
  const transcriptFiles = new Set(D0_COMBINATIONS.map(({ id }) => `${id}.json`));
  if (
    transcriptEntries.some((entry) => !entry.isFile() || entry.isSymbolicLink()) ||
    transcriptEntries.length !== D0_COMBINATIONS.length ||
    transcriptEntries.some((entry) => !transcriptFiles.has(entry.name))
  )
    fail("D0_CAPTURE_SESSION_ROOT_INVALID");
  const artifactEntries = readdirSync(artifactRoot, { withFileTypes: true });
  if (
    artifactEntries.some((entry) => entry.isSymbolicLink()) ||
    stable(
      artifactEntries
        .filter((entry) => entry.isFile())
        .map(({ name }) => name)
        .sort(),
    ) !== stable([...FIXED_ARTIFACT_FILES].sort()) ||
    stable(artifactEntries.filter((entry) => entry.isDirectory()).map(({ name }) => name)) !==
      stable([ADAPTER_INPUT_DIRECTORY]) ||
    artifactEntries.some((entry) => !entry.isFile() && !entry.isDirectory())
  )
    fail("D0_CAPTURE_SESSION_ROOT_INVALID");
  const inputEntries = readdirSync(adapterInputRoot, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name, "en"),
  );
  if (
    inputEntries.length === 0 ||
    inputEntries.some(
      (entry, index) =>
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        !new RegExp(`^${String(index).padStart(4, "0")}-[A-Za-z0-9._-]+$`).test(entry.name),
    )
  )
    fail("D0_CAPTURE_SESSION_ROOT_INVALID");
  const logicalPaths = [
    ...rootFiles,
    ...FIXED_ARTIFACT_FILES.map((name) => `${ARTIFACT_DIRECTORY}/${name}`),
    ...inputEntries.map(({ name }) => `${ARTIFACT_DIRECTORY}/${ADAPTER_INPUT_DIRECTORY}/${name}`),
    ...D0_COMBINATIONS.map(({ id }) => `${TRANSCRIPTS_DIRECTORY}/${id}.json`),
  ];
  return {
    sourceRoot,
    files: new Map(
      logicalPaths.map((logicalPath) => [
        logicalPath,
        readOpenedRegular(
          child(sourceRoot, logicalPath, "D0_CAPTURE_SESSION_ROOT_INVALID"),
          "D0_CAPTURE_SESSION_ROOT_INVALID",
        ),
      ]),
    ),
  };
}

export function createFreshD0CaptureOutput(value) {
  const output = taskOwnedRootPath(value, "D0_CAPTURE_OUTPUT_NOT_TASK_OWNED");
  if (entryOrNull(output, "D0_CAPTURE_OUTPUT_INVALID")) fail("D0_CAPTURE_OUTPUT_ALREADY_EXISTS");
  try {
    mkdirSync(output, { recursive: false });
  } catch {
    fail("D0_CAPTURE_OUTPUT_INVALID");
  }
  const outputStats = entryOrNull(output, "D0_CAPTURE_OUTPUT_INVALID");
  if (!outputStats?.isDirectory() || outputStats.isSymbolicLink())
    fail("D0_CAPTURE_OUTPUT_INVALID");
  return output;
}

function assertTaskIdentity(value, expectedSchemaVersion, code) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schemaVersion !== expectedSchemaVersion ||
    value.taskId !== D0_TASK_ID
  ) {
    fail(code);
  }
  const visit = (current) => {
    if (!current || typeof current !== "object") return;
    if (
      !Array.isArray(current) &&
      Object.hasOwn(current, "taskId") &&
      current.taskId !== D0_TASK_ID
    )
      fail(code);
    for (const childValue of Array.isArray(current) ? current : Object.values(current))
      visit(childValue);
  };
  visit(value);
}

function writeAndVerifySnapshot(snapshot, destination, logicalPath, code) {
  writeFileSync(destination, snapshot.bytes, { flag: "wx" });
  const copied = readOpenedRegular(destination, code);
  if (copied.size !== snapshot.size || copied.sha256 !== snapshot.sha256) fail(code);
  return { path: logicalPath, size: copied.size, sha256: copied.sha256 };
}

function copyProductBoundarySnapshot(snapshot, outputRoot) {
  const bundle = child(outputRoot, BUNDLE_DIRECTORY, "D0_CAPTURE_OUTPUT_INVALID");
  const transcripts = child(bundle, TRANSCRIPTS_DIRECTORY, "D0_CAPTURE_OUTPUT_INVALID");
  const artifacts = child(bundle, ARTIFACT_DIRECTORY, "D0_CAPTURE_OUTPUT_INVALID");
  const adapterInputs = child(artifacts, ADAPTER_INPUT_DIRECTORY, "D0_CAPTURE_OUTPUT_INVALID");
  mkdirSync(bundle, { recursive: false });
  mkdirSync(transcripts, { recursive: false });
  mkdirSync(artifacts, { recursive: false });
  mkdirSync(adapterInputs, { recursive: false });
  const artifactRecords = [...snapshot.files.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([logicalPath, source]) =>
      writeAndVerifySnapshot(
        source,
        child(bundle, logicalPath, "D0_CAPTURE_OUTPUT_INVALID"),
        logicalPath,
        "D0_CAPTURE_COPY_FAILED",
      ),
    );
  const transcriptHashes = D0_COMBINATIONS.map(({ id }) => ({
    id,
    sha256: snapshot.files.get(`${TRANSCRIPTS_DIRECTORY}/${id}.json`).sha256,
  }));
  const transcriptIndexSha256 = sha256Bytes(stable(transcriptHashes));
  const { producer, provenance } = currentD0ProductProvenance();
  const evidence = {
    schemaVersion: D0_EVIDENCE_SCHEMA_VERSION,
    taskId: D0_TASK_ID,
    captureOrigin: D0_CAPTURE_ORIGIN,
    producer,
    provenance,
    captureVerification: {
      sourceReadMode: "single_open_file_descriptor",
      destinationRecomputed: true,
    },
    artifacts: artifactRecords,
    adapterArtifactSha256: snapshot.files.get(ADAPTER_ARTIFACT_FILE).sha256,
    transcriptIndexSha256,
    routeDecisionSha256: snapshot.files.get(ROUTE_DECISION_FILE).sha256,
    combinations: transcriptHashes,
  };
  writeFileSync(
    child(bundle, "hashes.json", "D0_CAPTURE_OUTPUT_INVALID"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  return { bundle, evidence };
}

export function indexD0ProductAdapterCapture({ sessionRoot, output }) {
  const snapshot = requireSourceSnapshot(sessionRoot);
  // Fail early on an accidentally supplied legacy/UE-Automation capture.  The
  // full verifier below performs the remaining structural and hash checks.
  const artifact = readJsonBytes(
    snapshot.files.get(ADAPTER_ARTIFACT_FILE).bytes,
    "D0_CAPTURE_ADAPTER_ARTIFACT_INVALID",
  );
  assertExactKeys(
    artifact,
    [
      "bundle",
      "captureOrigin",
      "entrypoint",
      "metafile",
      "nativeBridge",
      "nativeBridgeSource",
      "producer",
      "provenance",
      "schemaVersion",
      "sourceSha256",
      "taskId",
    ],
    "D0_CAPTURE_ADAPTER_ARTIFACT_INVALID",
  );
  const expectedOrigin = currentD0ProductProvenance();
  if (
    artifact.schemaVersion !== D0_ADAPTER_ARTIFACT_SCHEMA_VERSION ||
    artifact.taskId !== D0_TASK_ID ||
    artifact.captureOrigin !== D0_CAPTURE_ORIGIN ||
    artifact.entrypoint !== D0_PRODUCT_ADAPTER_ENTRYPOINT ||
    stable(artifact.producer) !== stable(expectedOrigin.producer) ||
    stable(artifact.provenance) !== stable(expectedOrigin.provenance)
  ) {
    fail("D0_CAPTURE_ADAPTER_ARTIFACT_INVALID");
  }
  assertTaskIdentity(
    artifact,
    D0_ADAPTER_ARTIFACT_SCHEMA_VERSION,
    "D0_CAPTURE_ADAPTER_ARTIFACT_INVALID",
  );
  const route = readJsonBytes(
    snapshot.files.get(ROUTE_DECISION_FILE).bytes,
    "D0_CAPTURE_ROUTE_DECISION_INVALID",
  );
  assertExactKeys(
    route,
    [
      "basisTranscriptIndexSha256",
      "producer",
      "provenance",
      "schemaVersion",
      "selectedRoute",
      "taskId",
    ],
    "D0_CAPTURE_ROUTE_DECISION_INVALID",
  );
  if (
    route.schemaVersion !== D0_ROUTE_DECISION_SCHEMA_VERSION ||
    route.taskId !== D0_TASK_ID ||
    stable(route.producer) !== stable(expectedOrigin.producer) ||
    stable(route.provenance) !== stable(expectedOrigin.provenance)
  )
    fail("D0_CAPTURE_ROUTE_DECISION_INVALID");
  assertTaskIdentity(route, D0_ROUTE_DECISION_SCHEMA_VERSION, "D0_CAPTURE_ROUTE_DECISION_INVALID");
  for (const [logicalPath, schemaVersion, code] of [
    [RUNNER_ARTIFACT_FILE, D0_RUNNER_ARTIFACT_SCHEMA_VERSION, "D0_CAPTURE_RUNNER_ARTIFACT_INVALID"],
    [ADAPTER_METAFILE, D0_ADAPTER_METAFILE_SCHEMA_VERSION, "D0_CAPTURE_ADAPTER_METAFILE_INVALID"],
    ...D0_COMBINATIONS.map(({ id }) => [
      `${TRANSCRIPTS_DIRECTORY}/${id}.json`,
      D0_RAW_TRANSCRIPT_SCHEMA_VERSION,
      "D0_CAPTURE_TRANSCRIPT_TASK_ID_INVALID",
    ]),
  ]) {
    assertTaskIdentity(
      readJsonBytes(snapshot.files.get(logicalPath).bytes, code),
      schemaVersion,
      code,
    );
  }
  const outputRoot = createFreshD0CaptureOutput(output);
  const copied = copyProductBoundarySnapshot(snapshot, outputRoot);
  const verified = validateTaskOwnedD0Bundle({ taskRoot: outputRoot });
  return { outputRoot, ...copied, verified };
}

function parseArgs(argv) {
  const supported = new Set(["session-root", "output"]);
  const args = Object.create(null);
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    const key = item?.startsWith("--") ? item.slice(2) : "";
    const value = argv[index + 1];
    if (!supported.has(key) || Object.hasOwn(args, key) || !value || value.startsWith("--"))
      fail("D0_CAPTURE_ARGUMENT_INVALID");
    args[key] = value;
    index += 1;
  }
  return args;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args["session-root"] || !args.output) fail("D0_CAPTURE_ARGUMENT_REQUIRED");
    const result = indexD0ProductAdapterCapture({
      sessionRoot: args["session-root"],
      output: args.output,
    });
    console.log(
      JSON.stringify({
        status: "indexed",
        reason: "hash_index_written_from_product_boundary_transcripts",
        taskId: D0_TASK_ID,
        selectedRoute: result.verified.selectedRoute,
        transcriptIndexSha256: result.verified.transcriptIndexSha256,
        mutationCount: 0,
      }),
    );
  } catch (error) {
    const reason = error instanceof CaptureError ? error.code : "D0_CAPTURE_FAILED";
    console.error(JSON.stringify({ status: "d0_capture_rejected", reason, mutationCount: 0 }));
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
