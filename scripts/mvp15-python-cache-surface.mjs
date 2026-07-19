#!/usr/bin/env node

/* global console, process */
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, join, parse, posix, relative, resolve, sep, win32 } from "node:path";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = 1;
const EXPECTED_ENTRY_COUNT = 28;
const EXPECTED_DIRECTORY_COUNT = 4;
const REQUIRED_MODE = "generated";

function addError(errors, code, path, message) {
  errors.push({ code, path: path ?? null, message });
}

function sortErrors(errors) {
  errors.sort((left, right) => {
    const a = `${left.code}\0${left.path ?? ""}\0${left.message}`;
    const b = `${right.code}\0${right.path ?? ""}\0${right.message}`;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function lowerPathCompare(left, right) {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  return a < b ? -1 : a > b ? 1 : left < right ? -1 : left > right ? 1 : 0;
}

function normalizedNativePath(value) {
  let normalized = resolve(value).replaceAll("\\", "/");
  if (normalized.startsWith("//?/")) normalized = normalized.slice(4);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isWithinRoot(root, candidate) {
  const rootResolved = resolve(root);
  const candidateResolved = resolve(candidate);
  const rel = relative(rootResolved, candidateResolved);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function isAnyPlatformAbsolute(value) {
  return isAbsolute(value) || posix.isAbsolute(value) || win32.isAbsolute(value);
}

function validateRelativePath(value, field, errors) {
  if (typeof value !== "string" || value.length === 0) {
    addError(errors, "CONTRACT_PATH_INVALID", field, "path must be a non-empty string");
    return false;
  }
  if (value.includes("\\")) {
    addError(errors, "CONTRACT_PATH_BACKSLASH", field, "path must use forward slashes");
    return false;
  }
  if (isAnyPlatformAbsolute(value)) {
    addError(errors, "CONTRACT_PATH_ABSOLUTE", field, "absolute paths are forbidden");
    return false;
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0)) {
    addError(errors, "CONTRACT_PATH_EMPTY_SEGMENT", field, "empty path segments are forbidden");
    return false;
  }
  if (segments.includes("..")) {
    addError(errors, "CONTRACT_PATH_TRAVERSAL", field, "parent traversal is forbidden");
    return false;
  }
  if (segments.includes(".")) {
    addError(errors, "CONTRACT_PATH_DOT_SEGMENT", field, "dot path segments are forbidden");
    return false;
  }
  if (posix.normalize(value) !== value) {
    addError(errors, "CONTRACT_PATH_NOT_NORMALIZED", field, "path is not normalized");
    return false;
  }
  return true;
}

function validateUnique(values, field, errors) {
  const exact = new Map();
  const folded = new Map();
  for (const [index, value] of values.entries()) {
    if (typeof value !== "string") continue;
    if (exact.has(value)) {
      addError(
        errors,
        "CONTRACT_PATH_DUPLICATE",
        `${field}[${index}]`,
        `duplicates ${field}[${exact.get(value)}]`,
      );
    } else {
      exact.set(value, index);
    }
    const key = value.toLowerCase();
    if (folded.has(key) && folded.get(key).value !== value) {
      addError(
        errors,
        "CONTRACT_PATH_CASE_COLLISION",
        `${field}[${index}]`,
        `case-collides with ${field}[${folded.get(key).index}]`,
      );
    } else if (!folded.has(key)) {
      folded.set(key, { index, value });
    }
  }
}

function expectedSourceForCache(cachePath, tag) {
  if (posix.basename(posix.dirname(cachePath)) !== "__pycache__") return null;
  const suffix = `.${tag}.pyc`;
  const fileName = posix.basename(cachePath);
  if (!fileName.endsWith(suffix) || fileName.length === suffix.length) return null;
  const stem = fileName.slice(0, -suffix.length);
  return posix.join(posix.dirname(posix.dirname(cachePath)), `${stem}.py`);
}

export function validateContract(contract) {
  const errors = [];
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    addError(errors, "CONTRACT_INVALID", null, "contract must be a JSON object");
    return errors;
  }
  if (contract.schemaVersion !== SCHEMA_VERSION) {
    addError(errors, "CONTRACT_SCHEMA_UNSUPPORTED", "schemaVersion", `expected ${SCHEMA_VERSION}`);
  }
  if (contract.validationMode !== REQUIRED_MODE) {
    addError(errors, "CONTRACT_MODE_INVALID", "validationMode", `expected ${REQUIRED_MODE}`);
  }
  const algorithm = contract.aggregateAlgorithm;
  if (
    !algorithm ||
    algorithm.version !== "uagent-relative-path-size-content-sha256-v1" ||
    algorithm.pathPrefix !== "Plugins" ||
    algorithm.pathSeparator !== "/" ||
    algorithm.sort !== "normalized-relative-path-lowercase-ascending" ||
    algorithm.recordFormat !== "<path>\\0<size-as-ascii>\\0<content-sha256-lowercase>\\n" ||
    algorithm.digest !== "sha256"
  ) {
    addError(errors, "CONTRACT_AGGREGATE_ALGORITHM_INVALID", "aggregateAlgorithm", "unsupported aggregate algorithm");
  }
  const normalization = contract.pathNormalization;
  if (
    !normalization ||
    normalization.separator !== "/" ||
    normalization.caseCollisionPolicy !== "reject" ||
    normalization.absolutePaths !== "reject" ||
    normalization.parentTraversal !== "reject" ||
    normalization.emptySegments !== "reject" ||
    normalization.dotSegments !== "reject" ||
    normalization.backslashes !== "reject"
  ) {
    addError(errors, "CONTRACT_NORMALIZATION_INVALID", "pathNormalization", "fail-closed path normalization is required");
  }

  const pythonRootValid = validateRelativePath(
    contract.pluginPythonRelativeRoot,
    "pluginPythonRelativeRoot",
    errors,
  );
  if (contract.cpythonTag !== "cpython-311") {
    addError(errors, "CONTRACT_CPYTHON_TAG_INVALID", "cpythonTag", "only cpython-311 is allowed");
  }
  const header = contract.cacheState?.header;
  if (
    contract.cacheState?.mode !== REQUIRED_MODE ||
    !header ||
    header.magicHex !== "a70d0d0a" ||
    header.flags !== 0 ||
    header.kind !== "timestamp" ||
    header.requireSourceMetadataMatch !== true
  ) {
    addError(errors, "CONTRACT_HEADER_MODE_INVALID", "cacheState", "expected CPython 3.11 timestamp header contract");
  }
  const business = contract.businessAggregate;
  if (
    !business ||
    !Number.isSafeInteger(business.fileCount) ||
    business.fileCount < 0 ||
    !Number.isSafeInteger(business.bytes) ||
    business.bytes < 0 ||
    !/^[0-9a-f]{64}$/.test(business.sha256 ?? "")
  ) {
    addError(errors, "CONTRACT_BUSINESS_AGGREGATE_INVALID", "businessAggregate", "exact count, bytes, and SHA-256 are required");
  }

  const directories = Array.isArray(contract.cacheDirectories) ? contract.cacheDirectories : [];
  const entries = Array.isArray(contract.cacheEntries) ? contract.cacheEntries : [];
  if (!Array.isArray(contract.cacheDirectories)) {
    addError(errors, "CONTRACT_CACHE_DIRECTORIES_INVALID", "cacheDirectories", "must be an array");
  }
  if (!Array.isArray(contract.cacheEntries)) {
    addError(errors, "CONTRACT_CACHE_ENTRIES_INVALID", "cacheEntries", "must be an array");
  }
  if (directories.length !== EXPECTED_DIRECTORY_COUNT) {
    addError(errors, "CONTRACT_CACHE_DIRECTORY_COUNT", "cacheDirectories", `expected ${EXPECTED_DIRECTORY_COUNT}`);
  }
  if (entries.length !== EXPECTED_ENTRY_COUNT) {
    addError(errors, "CONTRACT_CACHE_ENTRY_COUNT", "cacheEntries", `expected ${EXPECTED_ENTRY_COUNT}`);
  }

  directories.forEach((value, index) => {
    const valid = validateRelativePath(value, `cacheDirectories[${index}]`, errors);
    if (valid && posix.basename(value) !== "__pycache__") {
      addError(errors, "CONTRACT_CACHE_DIRECTORY_NAME", `cacheDirectories[${index}]`, "directory must be named __pycache__");
    }
    if (valid && pythonRootValid && value !== contract.pluginPythonRelativeRoot && !value.startsWith(`${contract.pluginPythonRelativeRoot}/`)) {
      addError(errors, "CONTRACT_PATH_OUTSIDE_PYTHON_ROOT", `cacheDirectories[${index}]`, "cache directory is outside plugin Python root");
    }
  });
  validateUnique(directories, "cacheDirectories", errors);
  const directorySet = new Set(directories);

  const cachePaths = [];
  const sourcePaths = [];
  entries.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      addError(errors, "CONTRACT_CACHE_ENTRY_INVALID", `cacheEntries[${index}]`, "entry must be an object");
      return;
    }
    const keys = Object.keys(entry).sort();
    if (keys.length !== 2 || keys[0] !== "cache" || keys[1] !== "source") {
      addError(errors, "CONTRACT_CACHE_ENTRY_FIELDS", `cacheEntries[${index}]`, "only cache and source stable paths are allowed");
    }
    const cacheValid = validateRelativePath(entry.cache, `cacheEntries[${index}].cache`, errors);
    const sourceValid = validateRelativePath(entry.source, `cacheEntries[${index}].source`, errors);
    if (typeof entry.cache === "string") cachePaths.push(entry.cache);
    if (typeof entry.source === "string") sourcePaths.push(entry.source);
    if (cacheValid && pythonRootValid && !entry.cache.startsWith(`${contract.pluginPythonRelativeRoot}/`)) {
      addError(errors, "CONTRACT_PATH_OUTSIDE_PYTHON_ROOT", `cacheEntries[${index}].cache`, "cache is outside plugin Python root");
    }
    if (sourceValid && pythonRootValid && !entry.source.startsWith(`${contract.pluginPythonRelativeRoot}/`)) {
      addError(errors, "CONTRACT_PATH_OUTSIDE_PYTHON_ROOT", `cacheEntries[${index}].source`, "source is outside plugin Python root");
    }
    if (cacheValid && !directorySet.has(posix.dirname(entry.cache))) {
      addError(errors, "CONTRACT_CACHE_DIRECTORY_UNLISTED", `cacheEntries[${index}].cache`, "cache parent is not an allowed cache directory");
    }
    if (cacheValid && sourceValid) {
      const expectedSource = expectedSourceForCache(entry.cache, contract.cpythonTag);
      if (expectedSource !== entry.source) {
        addError(errors, "CONTRACT_SOURCE_MAPPING_INVALID", `cacheEntries[${index}]`, `expected source ${expectedSource ?? "<invalid cache path>"}`);
      }
    }
  });
  validateUnique(cachePaths, "cacheEntries.cache", errors);
  validateUnique(sourcePaths, "cacheEntries.source", errors);
  sortErrors(errors);
  return errors;
}

export function defaultInspectPath(
  path,
  { lstat = lstatSync, realpath = realpathSync.native } = {},
) {
  const stats = lstat(path);
  const symbolicLink = stats.isSymbolicLink();
  const realPathMismatch = normalizedNativePath(realpath(path)) !== normalizedNativePath(path);
  return {
    regular: stats.isFile(),
    directory: stats.isDirectory(),
    symbolicLink,
    reparse: symbolicLink || realPathMismatch,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  };
}

function inspectOrError(path, displayPath, inspectPath, errors) {
  try {
    return inspectPath(path);
  } catch (error) {
    addError(errors, "PATH_INSPECTION_FAILED", displayPath, error instanceof Error ? error.message : String(error));
    return null;
  }
}

function absolutePathChain(path) {
  const absolute = resolve(path);
  const parsed = parse(absolute);
  const tail = absolute.slice(parsed.root.length).split(sep).filter(Boolean);
  const chain = [parsed.root];
  let current = parsed.root;
  for (const segment of tail) {
    current = join(current, segment);
    chain.push(current);
  }
  return chain;
}

function inspectRootChain(pluginsRoot, inspectPath, errors) {
  const chain = absolutePathChain(pluginsRoot);
  let valid = true;
  for (const path of chain) {
    const info = inspectOrError(path, path, inspectPath, errors);
    if (!info) {
      valid = false;
      continue;
    }
    if (!info.directory) {
      addError(errors, "ROOT_CHAIN_NOT_DIRECTORY", path, "root path chain must contain directories only");
      valid = false;
    }
    if (info.symbolicLink || info.reparse) {
      addError(errors, "ROOT_CHAIN_LINK_OR_REPARSE", path, "root path chain must not contain links or reparse points");
      valid = false;
    }
  }
  return valid;
}

function hashRegularFile(path) {
  const descriptor = openSync(path, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let header = Buffer.alloc(0);
  try {
    const before = fstatSync(descriptor);
    let position = 0;
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, position);
      if (count === 0) break;
      if (header.length < 16) {
        const needed = 16 - header.length;
        header = Buffer.concat([header, buffer.subarray(0, Math.min(needed, count))]);
      }
      hash.update(buffer.subarray(0, count));
      position += count;
    }
    const after = fstatSync(descriptor);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || position !== after.size) {
      throw new Error("file changed while being read");
    }
    return { size: after.size, mtimeMs: after.mtimeMs, sha256: hash.digest("hex"), header };
  } finally {
    closeSync(descriptor);
  }
}

function aggregateRows(rows, pathPrefix) {
  const ordered = [...rows].sort((left, right) => lowerPathCompare(left.relativePath, right.relativePath));
  const aggregate = createHash("sha256");
  let bytes = 0;
  for (const row of ordered) {
    const recordPath = `${pathPrefix}/${row.relativePath}`;
    bytes += row.size;
    aggregate.update(recordPath, "utf8");
    aggregate.update("\0", "ascii");
    aggregate.update(String(row.size), "ascii");
    aggregate.update("\0", "ascii");
    aggregate.update(row.sha256, "ascii");
    aggregate.update("\n", "ascii");
  }
  return { fileCount: ordered.length, bytes, sha256: aggregate.digest("hex") };
}

export function computeAggregate(pluginsRoot, relativePaths, pathPrefix = "Plugins") {
  const rows = relativePaths.map((relativePath) => {
    const absolutePath = resolve(pluginsRoot, ...relativePath.split("/"));
    if (!isWithinRoot(pluginsRoot, absolutePath)) throw new Error(`path escapes plugins root: ${relativePath}`);
    const info = hashRegularFile(absolutePath);
    return { relativePath, size: info.size, sha256: info.sha256 };
  });
  return aggregateRows(rows, pathPrefix);
}

function emptyAggregate() {
  return { fileCount: 0, bytes: 0, sha256: createHash("sha256").digest("hex") };
}

function parseHeader(header, sourceRow, expectedHeader, errors, cachePath) {
  const headerErrorBaseline = errors.length;
  if (header.length < 16) {
    addError(errors, "CACHE_HEADER_SHORT", cachePath, "CPython header must be at least 16 bytes");
    return { valid: false, bytesRead: header.length };
  }
  const magicHex = header.subarray(0, 4).toString("hex");
  const flags = header.readUInt32LE(4);
  const reservedFlags = flags & ~0x3;
  let kind;
  const metadata = {};
  if (reservedFlags !== 0) {
    kind = "invalid";
    addError(errors, "CACHE_HEADER_FLAGS_RESERVED", cachePath, `reserved flags are set: ${flags}`);
  } else if ((flags & 0x1) !== 0) {
    kind = (flags & 0x2) !== 0 ? "checked-hash" : "unchecked-hash";
    metadata.sourceHash8 = header.subarray(8, 16).toString("hex");
  } else {
    kind = "timestamp";
    metadata.sourceMtime32 = header.readUInt32LE(8);
    metadata.sourceSize32 = header.readUInt32LE(12);
    if (sourceRow) {
      metadata.actualSourceMtime32 = Math.trunc(sourceRow.mtimeMs / 1000) >>> 0;
      metadata.actualSourceSize32 = sourceRow.size >>> 0;
      metadata.sourceMetadataMatch =
        metadata.sourceMtime32 === metadata.actualSourceMtime32 &&
        metadata.sourceSize32 === metadata.actualSourceSize32;
    } else {
      metadata.sourceMetadataMatch = false;
    }
  }
  if (magicHex !== expectedHeader.magicHex) {
    addError(errors, "CACHE_HEADER_MAGIC_MISMATCH", cachePath, `expected ${expectedHeader.magicHex}, got ${magicHex}`);
  }
  if (flags !== expectedHeader.flags) {
    addError(errors, "CACHE_HEADER_FLAGS_MISMATCH", cachePath, `expected ${expectedHeader.flags}, got ${flags}`);
  }
  if (kind !== expectedHeader.kind) {
    addError(errors, "CACHE_HEADER_KIND_MISMATCH", cachePath, `expected ${expectedHeader.kind}, got ${kind}`);
  }
  if (expectedHeader.requireSourceMetadataMatch && metadata.sourceMetadataMatch !== true) {
    addError(errors, "CACHE_HEADER_SOURCE_METADATA_MISMATCH", cachePath, "timestamp metadata does not match mapped source");
  }
  return {
    valid: errors.length === headerErrorBaseline,
    magicHex,
    flags,
    kind,
    ...metadata,
  };
}

function failureResult(pluginsRoot, cacheState, contractErrors, errors = []) {
  return {
    ok: false,
    schemaVersion: SCHEMA_VERSION,
    cacheState,
    pluginsRoot,
    contractValid: contractErrors.length === 0,
    classificationComplete: false,
    aggregates: { full: emptyAggregate(), business: emptyAggregate(), cache: emptyAggregate() },
    cacheDirectories: [],
    cacheEntries: [],
    unclassified: [],
    errors: [...contractErrors, ...errors],
  };
}

export function validateCacheSurface({
  pluginsRoot,
  contract,
  cacheState = REQUIRED_MODE,
  inspectPath = defaultInspectPath,
}) {
  const contractErrors = validateContract(contract);
  if (typeof pluginsRoot !== "string" || !isAbsolute(pluginsRoot)) {
    const errors = [];
    addError(errors, "PLUGINS_ROOT_NOT_ABSOLUTE", pluginsRoot ?? null, "--plugins-root must be absolute");
    const result = failureResult(pluginsRoot ?? null, cacheState, contractErrors, errors);
    sortErrors(result.errors);
    return result;
  }
  const root = resolve(pluginsRoot);
  if (cacheState !== REQUIRED_MODE || cacheState !== contract?.cacheState?.mode) {
    const errors = [];
    addError(errors, "CACHE_STATE_INVALID", cacheState, `expected ${REQUIRED_MODE}`);
    const result = failureResult(root, cacheState, contractErrors, errors);
    sortErrors(result.errors);
    return result;
  }
  if (contractErrors.length > 0) {
    const result = failureResult(root, cacheState, contractErrors);
    sortErrors(result.errors);
    return result;
  }

  const errors = [];
  if (!inspectRootChain(root, inspectPath, errors)) {
    const result = failureResult(root, cacheState, [], errors);
    sortErrors(result.errors);
    return result;
  }

  const expectedCache = new Set(contract.cacheEntries.map((entry) => entry.cache));
  const expectedDirectories = new Set(contract.cacheDirectories);
  const observedDirectories = new Map();
  const rows = [];
  const unclassified = [];

  function walkDirectory(absoluteDirectory, relativeDirectory = "") {
    let entries;
    try {
      entries = readdirSync(absoluteDirectory, { withFileTypes: true }).sort((left, right) => lowerPathCompare(left.name, right.name));
    } catch (error) {
      addError(errors, "DIRECTORY_READ_FAILED", relativeDirectory || ".", error instanceof Error ? error.message : String(error));
      return;
    }
    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = resolve(absoluteDirectory, entry.name);
      if (!isWithinRoot(root, absolutePath)) {
        addError(errors, "PATH_ESCAPES_ROOT", relativePath, "resolved path escapes Plugins root");
        unclassified.push(relativePath);
        continue;
      }
      const inspection = inspectOrError(absolutePath, relativePath, inspectPath, errors);
      if (!inspection) {
        unclassified.push(relativePath);
        continue;
      }
      if (inspection.symbolicLink || inspection.reparse) {
        addError(errors, "LINK_OR_REPARSE_FORBIDDEN", relativePath, "links and reparse points are forbidden");
        unclassified.push(relativePath);
        continue;
      }
      if (inspection.directory) {
        if (entry.name === "__pycache__") {
          observedDirectories.set(relativePath, inspection);
          if (!expectedDirectories.has(relativePath)) {
            addError(errors, "UNCLASSIFIED_CACHE_DIRECTORY", relativePath, "cache directory is not listed by the contract");
            unclassified.push(`${relativePath}/`);
          }
        }
        walkDirectory(absolutePath, relativePath);
        continue;
      }
      if (!inspection.regular) {
        addError(errors, "NON_REGULAR_FILE", relativePath, "all Plugins files must be ordinary regular files");
        unclassified.push(relativePath);
        continue;
      }
      try {
        const file = hashRegularFile(absolutePath);
        rows.push({ relativePath, absolutePath, inspection, ...file });
      } catch (error) {
        addError(errors, "FILE_READ_FAILED", relativePath, error instanceof Error ? error.message : String(error));
        unclassified.push(relativePath);
      }
    }
  }

  walkDirectory(root);
  const rowByPath = new Map(rows.map((row) => [row.relativePath, row]));
  const businessRows = [];
  const cacheRows = [];
  for (const row of rows) {
    if (expectedCache.has(row.relativePath)) {
      cacheRows.push(row);
    } else if (row.relativePath.endsWith(".pyc") || row.relativePath.split("/").includes("__pycache__")) {
      addError(errors, "UNCLASSIFIED_CACHE_FILE", row.relativePath, "cache-like file is not listed by the contract");
      unclassified.push(row.relativePath);
    } else {
      businessRows.push(row);
    }
  }

  const directoryResults = contract.cacheDirectories.map((relativePath) => {
    const inspection = observedDirectories.get(relativePath);
    if (!inspection) {
      addError(errors, "CACHE_DIRECTORY_MISSING", relativePath, "allowed cache directory is missing or not ordinary");
      return { relativePath, present: false, ordinary: false, symbolicLink: false, reparse: false };
    }
    return {
      relativePath,
      present: true,
      ordinary: inspection.directory,
      symbolicLink: inspection.symbolicLink,
      reparse: inspection.reparse,
    };
  });

  const cacheEntryResults = contract.cacheEntries.map((entry) => {
    const cacheRow = rowByPath.get(entry.cache);
    const sourceRow = rowByPath.get(entry.source);
    if (!cacheRow) {
      addError(errors, "CACHE_FILE_MISSING", entry.cache, "contract cache file is missing or not ordinary");
    }
    if (!sourceRow) {
      addError(errors, "CACHE_SOURCE_MISSING", entry.source, "mapped source file is missing or not ordinary");
    } else if (!businessRows.includes(sourceRow)) {
      addError(errors, "CACHE_SOURCE_NOT_BUSINESS", entry.source, "mapped source is not part of the business aggregate");
    }
    const mappedSource = expectedSourceForCache(entry.cache, contract.cpythonTag);
    if (mappedSource !== entry.source) {
      addError(errors, "CACHE_SOURCE_MAPPING_MISMATCH", entry.cache, `expected ${mappedSource ?? "<invalid>"}`);
    }
    const suffix = `.${contract.cpythonTag}.pyc`;
    if (!entry.cache.endsWith(suffix)) {
      addError(errors, "CACHE_ABI_TAG_MISMATCH", entry.cache, `expected ${contract.cpythonTag}`);
    }
    const header = cacheRow
      ? parseHeader(cacheRow.header, sourceRow, contract.cacheState.header, errors, entry.cache)
      : null;
    return {
      cache: entry.cache,
      source: entry.source,
      present: Boolean(cacheRow),
      sourcePresent: Boolean(sourceRow),
      sourceInBusiness: Boolean(sourceRow && businessRows.includes(sourceRow)),
      size: cacheRow?.size ?? null,
      sha256: cacheRow?.sha256 ?? null,
      ordinary: cacheRow?.inspection.regular ?? false,
      symbolicLink: cacheRow?.inspection.symbolicLink ?? false,
      reparse: cacheRow?.inspection.reparse ?? false,
      header,
    };
  });

  const pathPrefix = contract.aggregateAlgorithm.pathPrefix;
  const fullAggregate = aggregateRows(rows, pathPrefix);
  const businessAggregate = aggregateRows(businessRows, pathPrefix);
  const cacheAggregate = aggregateRows(cacheRows, pathPrefix);
  if (
    businessAggregate.fileCount !== contract.businessAggregate.fileCount ||
    businessAggregate.bytes !== contract.businessAggregate.bytes ||
    businessAggregate.sha256 !== contract.businessAggregate.sha256
  ) {
    addError(
      errors,
      "BUSINESS_AGGREGATE_MISMATCH",
      null,
      `expected ${contract.businessAggregate.fileCount}/${contract.businessAggregate.bytes}/${contract.businessAggregate.sha256}, got ${businessAggregate.fileCount}/${businessAggregate.bytes}/${businessAggregate.sha256}`,
    );
  }
  if (cacheRows.length !== contract.cacheEntries.length) {
    addError(errors, "CACHE_COUNT_MISMATCH", null, `expected ${contract.cacheEntries.length}, got ${cacheRows.length}`);
  }
  const classificationComplete =
    unclassified.length === 0 &&
    fullAggregate.fileCount === businessAggregate.fileCount + cacheAggregate.fileCount;
  if (!classificationComplete) {
    addError(errors, "CLASSIFICATION_INCOMPLETE", null, "Plugins inventory is not fully explained by business plus controlled cache files");
  }

  sortErrors(errors);
  unclassified.sort(lowerPathCompare);
  return {
    ok: errors.length === 0,
    schemaVersion: SCHEMA_VERSION,
    contractId: contract.contractId,
    cacheState,
    pluginsRoot: root,
    contractValid: true,
    classificationComplete,
    aggregates: { full: fullAggregate, business: businessAggregate, cache: cacheAggregate },
    cacheDirectories: directoryResults,
    cacheEntries: cacheEntryResults,
    unclassified,
    errors,
  };
}

function parseArguments(argv) {
  const options = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      options.json = true;
    } else if (["--plugins-root", "--contract", "--cache-state"].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`missing value for ${argument}`);
      options[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (!options.pluginsRoot) throw new Error("--plugins-root is required");
  if (!options.contract) throw new Error("--contract is required");
  if (!options.cacheState) throw new Error("--cache-state is required");
  return options;
}

function printResult(result, json, writeOutput) {
  if (json) {
    writeOutput(JSON.stringify(result, null, 2));
    return;
  }
  writeOutput(
    `${result.ok ? "OK" : "ERROR"}: full=${result.aggregates.full.fileCount}, business=${result.aggregates.business.fileCount}, cache=${result.aggregates.cache.fileCount}, unclassified=${result.unclassified.length}, errors=${result.errors.length}`,
  );
}

export function runCli(
  argv = process.argv.slice(2),
  { inspectPath = defaultInspectPath, writeOutput = (value) => console.log(value) } = {},
) {
  let options;
  try {
    options = parseArguments(argv);
    const contractPath = resolve(options.contract);
    const contract = JSON.parse(readFileSync(contractPath, "utf8"));
    const result = validateCacheSurface({
      pluginsRoot: options.pluginsRoot,
      contract,
      cacheState: options.cacheState,
      inspectPath,
    });
    printResult(result, options.json, writeOutput);
    return result.ok ? 0 : 1;
  } catch (error) {
    const result = failureResult(options?.pluginsRoot ?? null, options?.cacheState ?? null, [], [
      {
        code: "VALIDATOR_EXCEPTION",
        path: null,
        message: error instanceof Error ? error.message : String(error),
      },
    ]);
    printResult(result, options?.json ?? argv.includes("--json"), writeOutput);
    return 2;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) process.exitCode = runCli();
