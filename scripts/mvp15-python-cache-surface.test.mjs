/* global process */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { deserialize, serialize } from "node:v8";

import {
  computeAggregate,
  defaultInspectPath,
  runCli as runValidatorCli,
  validateCacheSurface,
  validateContract,
} from "./mvp15-python-cache-surface.mjs";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const VALIDATOR_PATH = join(SCRIPT_DIRECTORY, "mvp15-python-cache-surface.mjs");
const CONTRACT_PATH = join(SCRIPT_DIRECTORY, "mvp15-python-cache-contract.json");
const PRODUCTION_CONTRACT = JSON.parse(readFileSync(CONTRACT_PATH, "utf8"));
const structuredClone = (value) => deserialize(serialize(value));

function cloneContract() {
  return structuredClone(PRODUCTION_CONTRACT);
}

function nativePath(root, relativePath) {
  return resolve(root, ...relativePath.split("/"));
}

function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function writeTimestampCache(path, sourcePath, contract, payload = "synthetic-bytecode") {
  const source = statSync(sourcePath);
  const header = Buffer.alloc(16);
  Buffer.from(contract.cacheState.header.magicHex, "hex").copy(header, 0);
  header.writeUInt32LE(contract.cacheState.header.flags, 4);
  header.writeUInt32LE(Math.trunc(source.mtimeMs / 1000) >>> 0, 8);
  header.writeUInt32LE(source.size >>> 0, 12);
  writeFile(path, Buffer.concat([header, Buffer.from(payload, "utf8")]));
}

function createFixture(t) {
  const fixtureRoot = mkdtempSync(join(resolve(SCRIPT_DIRECTORY, ".."), ".uagent-cache-surface-"));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const pluginsRoot = join(fixtureRoot, "Plugins");
  mkdirSync(pluginsRoot, { recursive: true });
  const contract = cloneContract();
  const businessPaths = new Set();

  for (const [index, entry] of contract.cacheEntries.entries()) {
    const sourcePath = nativePath(pluginsRoot, entry.source);
    if (!businessPaths.has(entry.source)) {
      writeFile(sourcePath, `# synthetic source ${index}\nVALUE = ${index}\n`);
      businessPaths.add(entry.source);
    }
  }
  const descriptor = "Toolsets/EditorToolset/EditorToolset.uplugin";
  writeFile(nativePath(pluginsRoot, descriptor), '{"FileVersion":3}\n');
  businessPaths.add(descriptor);
  contract.businessAggregate = computeAggregate(
    pluginsRoot,
    [...businessPaths],
    contract.aggregateAlgorithm.pathPrefix,
  );

  for (const [index, entry] of contract.cacheEntries.entries()) {
    writeTimestampCache(
      nativePath(pluginsRoot, entry.cache),
      nativePath(pluginsRoot, entry.source),
      contract,
      `synthetic-bytecode-${index}`,
    );
  }
  const fixtureContractPath = join(fixtureRoot, "contract.json");
  writeFileSync(fixtureContractPath, JSON.stringify(contract, null, 2));
  return {
    fixtureRoot,
    pluginsRoot,
    contract,
    contractPath: fixtureContractPath,
    descriptor,
    businessPaths: [...businessPaths],
  };
}

function runCli(fixture) {
  return spawnSync(
    process.execPath,
    [
      VALIDATOR_PATH,
      "--plugins-root",
      fixture.pluginsRoot,
      "--contract",
      fixture.contractPath,
      "--cache-state",
      "generated",
      "--json",
    ],
    { encoding: "utf8" },
  );
}

function errorCodes(result) {
  return new Set(result.errors.map((error) => error.code));
}

function cacheResult(result, cache) {
  const entry = result.cacheEntries.find((candidate) => candidate.cache === cache);
  assert.ok(entry, `missing cache result for ${cache}`);
  return entry;
}

function mutateCacheHeader(fixture, entry, mutate) {
  const cachePath = nativePath(fixture.pluginsRoot, entry.cache);
  const content = readFileSync(cachePath);
  mutate(content);
  writeFileSync(cachePath, content);
}

function runInjectedCli(fixture, inspectPath) {
  const output = [];
  const status = runValidatorCli(
    [
      "--plugins-root",
      fixture.pluginsRoot,
      "--contract",
      fixture.contractPath,
      "--cache-state",
      "generated",
      "--json",
    ],
    { inspectPath, writeOutput: (value) => output.push(value) },
  );
  assert.equal(output.length, 1);
  return { status, result: JSON.parse(output[0]) };
}

test("valid generated-cache fixture succeeds and fully classifies Plugins", (t) => {
  const fixture = createFixture(t);
  const result = validateCacheSurface({
    pluginsRoot: fixture.pluginsRoot,
    contract: fixture.contract,
    cacheState: "generated",
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.contractValid, true);
  assert.equal(result.classificationComplete, true);
  assert.equal(result.aggregates.business.fileCount, 29);
  assert.equal(result.aggregates.cache.fileCount, 28);
  assert.equal(result.aggregates.full.fileCount, 57);
  assert.deepEqual(result.unclassified, []);
  assert.deepEqual(result.errors, []);
  assert.equal(result.cacheDirectories.length, 4);
  assert.equal(result.cacheEntries.length, 28);
  assert.ok(result.cacheEntries.every((entry) => entry.header?.sourceMetadataMatch));
  assert.ok(result.cacheEntries.every((entry) => entry.header?.valid === true));
});

test("native realpath inspection errors fail closed through the production inspector and CLI runner", (t) => {
  const fixture = createFixture(t);
  const deniedPath = resolve(fixture.pluginsRoot);
  const inspectPath = (path) =>
    defaultInspectPath(path, {
      realpath(candidate) {
        if (resolve(candidate) === deniedPath) {
          const error = new Error("AccessDenied while resolving Plugins root");
          error.code = "EACCES";
          throw error;
        }
        return realpathSync.native(candidate);
      },
    });

  const result = validateCacheSurface({
    pluginsRoot: fixture.pluginsRoot,
    contract: fixture.contract,
    inspectPath,
  });
  assert.equal(result.ok, false);
  assert.equal(result.classificationComplete, false);
  assert.deepEqual(result.cacheDirectories, []);
  assert.deepEqual(result.cacheEntries, []);
  assert.ok(errorCodes(result).has("PATH_INSPECTION_FAILED"));
  assert.ok(result.errors.some((error) => error.message.includes("AccessDenied")));
  assert.equal(errorCodes(result).has("ROOT_CHAIN_LINK_OR_REPARSE"), false);

  const cli = runInjectedCli(fixture, inspectPath);
  assert.equal(cli.status, 1);
  assert.equal(cli.result.ok, false);
  assert.equal(cli.result.classificationComplete, false);
  assert.ok(errorCodes(cli.result).has("PATH_INSPECTION_FAILED"));
});

test("cache magic mismatch reports header.valid false and a nonzero CLI exit", (t) => {
  const fixture = createFixture(t);
  const entry = fixture.contract.cacheEntries[0];
  mutateCacheHeader(fixture, entry, (header) => {
    header[0] ^= 0xff;
  });

  const result = validateCacheSurface({ pluginsRoot: fixture.pluginsRoot, contract: fixture.contract });
  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).has("CACHE_HEADER_MAGIC_MISMATCH"));
  assert.equal(cacheResult(result, entry.cache).header.valid, false);

  const cli = runCli(fixture);
  assert.equal(cli.status, 1);
  const cliResult = JSON.parse(cli.stdout);
  assert.equal(cliResult.ok, false);
  assert.ok(errorCodes(cliResult).has("CACHE_HEADER_MAGIC_MISMATCH"));
  assert.equal(cacheResult(cliResult, entry.cache).header.valid, false);
});

test("reserved and hash-mode flags report truthful invalid headers and nonzero CLI exits", async (t) => {
  const cases = [
    {
      name: "reserved flags",
      flags: 4,
      codes: ["CACHE_HEADER_FLAGS_RESERVED", "CACHE_HEADER_FLAGS_MISMATCH", "CACHE_HEADER_KIND_MISMATCH"],
    },
    {
      name: "hash-mode flags",
      flags: 1,
      codes: ["CACHE_HEADER_FLAGS_MISMATCH", "CACHE_HEADER_KIND_MISMATCH"],
    },
  ];

  for (const sample of cases) {
    await t.test(sample.name, (subtest) => {
      const fixture = createFixture(subtest);
      const entry = fixture.contract.cacheEntries[0];
      mutateCacheHeader(fixture, entry, (header) => header.writeUInt32LE(sample.flags, 4));

      const result = validateCacheSurface({ pluginsRoot: fixture.pluginsRoot, contract: fixture.contract });
      assert.equal(result.ok, false);
      for (const code of sample.codes) assert.ok(errorCodes(result).has(code));
      assert.equal(cacheResult(result, entry.cache).header.valid, false);

      const cli = runCli(fixture);
      assert.equal(cli.status, 1);
      const cliResult = JSON.parse(cli.stdout);
      assert.equal(cliResult.ok, false);
      for (const code of sample.codes) assert.ok(errorCodes(cliResult).has(code));
      assert.equal(cacheResult(cliResult, entry.cache).header.valid, false);
    });
  }
});

test("mapped source size drift isolates metadata mismatch and reports header.valid false", (t) => {
  const fixture = createFixture(t);
  const entry = fixture.contract.cacheEntries[0];
  const sourcePath = nativePath(fixture.pluginsRoot, entry.source);
  writeFileSync(sourcePath, Buffer.concat([readFileSync(sourcePath), Buffer.from("# size drift\n")]));
  fixture.contract.businessAggregate = computeAggregate(
    fixture.pluginsRoot,
    fixture.businessPaths,
    fixture.contract.aggregateAlgorithm.pathPrefix,
  );
  writeFileSync(fixture.contractPath, JSON.stringify(fixture.contract, null, 2));

  const result = validateCacheSurface({ pluginsRoot: fixture.pluginsRoot, contract: fixture.contract });
  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).has("CACHE_HEADER_SOURCE_METADATA_MISMATCH"));
  assert.equal(errorCodes(result).has("BUSINESS_AGGREGATE_MISMATCH"), false);
  assert.equal(cacheResult(result, entry.cache).header.sourceMetadataMatch, false);
  assert.equal(cacheResult(result, entry.cache).header.valid, false);

  const cli = runCli(fixture);
  assert.equal(cli.status, 1);
  const cliResult = JSON.parse(cli.stdout);
  assert.equal(cliResult.ok, false);
  assert.ok(errorCodes(cliResult).has("CACHE_HEADER_SOURCE_METADATA_MISMATCH"));
  assert.equal(cacheResult(cliResult, entry.cache).header.valid, false);
});

test("CLI JSON output and exit code are stable", (t) => {
  const fixture = createFixture(t);
  const first = runCli(fixture);
  const second = runCli(fixture);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stderr, "");
  assert.equal(first.stdout, second.stdout);
  const parsed = JSON.parse(first.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.classificationComplete, true);

  const roguePath = nativePath(
    fixture.pluginsRoot,
    `${fixture.contract.cacheDirectories[0]}/rogue.cpython-311.pyc`,
  );
  writeFile(roguePath, Buffer.alloc(16));
  const failedFirst = runCli(fixture);
  const failedSecond = runCli(fixture);
  assert.equal(failedFirst.status, 1);
  assert.equal(failedSecond.status, 1);
  assert.equal(failedFirst.stdout, failedSecond.stdout);
  assert.equal(JSON.parse(failedFirst.stdout).ok, false);
});

test("a 29th unlisted pyc is unclassified and fails closed", (t) => {
  const fixture = createFixture(t);
  const rogue = `${fixture.contract.cacheDirectories[0]}/rogue.cpython-311.pyc`;
  writeFile(nativePath(fixture.pluginsRoot, rogue), Buffer.alloc(16));
  const result = validateCacheSurface({
    pluginsRoot: fixture.pluginsRoot,
    contract: fixture.contract,
  });
  assert.equal(result.ok, false);
  assert.ok(result.unclassified.includes(rogue));
  assert.ok(errorCodes(result).has("UNCLASSIFIED_CACHE_FILE"));
  assert.ok(errorCodes(result).has("CLASSIFICATION_INCOMPLETE"));
});

test("wrong ABI tag is never accepted as a controlled cache", (t) => {
  const fixture = createFixture(t);
  const expected = fixture.contract.cacheEntries[0].cache;
  const wrong = expected.replace(".cpython-311.pyc", ".cpython-312.pyc");
  renameSync(nativePath(fixture.pluginsRoot, expected), nativePath(fixture.pluginsRoot, wrong));
  const result = validateCacheSurface({
    pluginsRoot: fixture.pluginsRoot,
    contract: fixture.contract,
  });
  assert.equal(result.ok, false);
  assert.ok(result.unclassified.includes(wrong));
  assert.ok(errorCodes(result).has("CACHE_FILE_MISSING"));
  assert.ok(errorCodes(result).has("UNCLASSIFIED_CACHE_FILE"));
});

test("missing mapped source fails source membership and header checks", (t) => {
  const fixture = createFixture(t);
  const source = fixture.contract.cacheEntries[2].source;
  rmSync(nativePath(fixture.pluginsRoot, source));
  const result = validateCacheSurface({
    pluginsRoot: fixture.pluginsRoot,
    contract: fixture.contract,
  });
  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).has("CACHE_SOURCE_MISSING"));
  assert.ok(errorCodes(result).has("CACHE_HEADER_SOURCE_METADATA_MISMATCH"));
  assert.ok(errorCodes(result).has("BUSINESS_AGGREGATE_MISMATCH"));
  assert.equal(cacheResult(result, fixture.contract.cacheEntries[2].cache).header.valid, false);
});

test("business content mutation changes the frozen aggregate", (t) => {
  const fixture = createFixture(t);
  writeFileSync(nativePath(fixture.pluginsRoot, fixture.descriptor), '{"FileVersion":4}\n');
  const result = validateCacheSurface({
    pluginsRoot: fixture.pluginsRoot,
    contract: fixture.contract,
  });
  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).has("BUSINESS_AGGREGATE_MISMATCH"));
});

test("business path mutation changes the frozen aggregate", (t) => {
  const fixture = createFixture(t);
  renameSync(
    nativePath(fixture.pluginsRoot, fixture.descriptor),
    nativePath(fixture.pluginsRoot, fixture.descriptor.replace(".uplugin", "-moved.uplugin")),
  );
  const result = validateCacheSurface({
    pluginsRoot: fixture.pluginsRoot,
    contract: fixture.contract,
  });
  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).has("BUSINESS_AGGREGATE_MISMATCH"));
});

test("injected reparse stat seam exercises the fail-closed path-chain branch", (t) => {
  const fixture = createFixture(t);
  const reparseTarget = nativePath(fixture.pluginsRoot, fixture.contract.cacheDirectories[0]);
  const result = validateCacheSurface({
    pluginsRoot: fixture.pluginsRoot,
    contract: fixture.contract,
    inspectPath(path) {
      const inspected = defaultInspectPath(path);
      return resolve(path) === reparseTarget ? { ...inspected, reparse: true } : inspected;
    },
  });
  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).has("LINK_OR_REPARSE_FORBIDDEN"));
  assert.ok(errorCodes(result).has("CACHE_DIRECTORY_MISSING"));
});

test("real directory link or junction in a cache path fails closed when supported", (t) => {
  const fixture = createFixture(t);
  const cacheDirectory = nativePath(fixture.pluginsRoot, fixture.contract.cacheDirectories[0]);
  const realDirectory = `${cacheDirectory}-target`;
  renameSync(cacheDirectory, realDirectory);
  try {
    symlinkSync(realDirectory, cacheDirectory, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`OS denied test link creation; injected reparse seam test remains authoritative: ${error.code ?? error}`);
    return;
  }
  const result = validateCacheSurface({
    pluginsRoot: fixture.pluginsRoot,
    contract: fixture.contract,
  });
  assert.equal(result.ok, false);
  assert.ok(errorCodes(result).has("LINK_OR_REPARSE_FORBIDDEN"));
});

test("bad contract paths, duplicates, and case collisions fail before inventory", async (t) => {
  const cases = [
    {
      name: "absolute cache path",
      code: "CONTRACT_PATH_ABSOLUTE",
      mutate(contract) {
        contract.cacheEntries[0].cache = resolve("absolute-cache.pyc").replaceAll("\\", "/");
      },
    },
    {
      name: "source traversal",
      code: "CONTRACT_PATH_TRAVERSAL",
      mutate(contract) {
        contract.cacheEntries[0].source = "Toolsets/../escaped.py";
      },
    },
    {
      name: "empty path segment",
      code: "CONTRACT_PATH_EMPTY_SEGMENT",
      mutate(contract) {
        contract.cacheEntries[0].source = "Toolsets//escaped.py";
      },
    },
    {
      name: "duplicate cache path",
      code: "CONTRACT_PATH_DUPLICATE",
      mutate(contract) {
        contract.cacheEntries.push(structuredClone(contract.cacheEntries[0]));
      },
    },
    {
      name: "cache path case collision",
      code: "CONTRACT_PATH_CASE_COLLISION",
      mutate(contract) {
        const collision = structuredClone(contract.cacheEntries[0]);
        collision.cache = collision.cache.replace("Toolsets", "TOOLSETS");
        collision.source = collision.source.replace("Toolsets", "TOOLSETS");
        contract.cacheEntries.push(collision);
      },
    },
    {
      name: "misplaced mapped source",
      code: "CONTRACT_SOURCE_MAPPING_INVALID",
      mutate(contract) {
        contract.cacheEntries[0].source = contract.cacheEntries[1].source;
      },
    },
  ];
  for (const sample of cases) {
    await t.test(sample.name, () => {
      const contract = cloneContract();
      sample.mutate(contract);
      const errors = validateContract(contract);
      assert.ok(
        errors.some((error) => error.code === sample.code),
        `expected ${sample.code}, got ${errors.map((error) => error.code).join(", ")}`,
      );
    });
  }
});

test("relative Plugins root and invalid cache state produce stable failure envelopes", () => {
  const relativeRoot = validateCacheSurface({
    pluginsRoot: "relative/Plugins",
    contract: cloneContract(),
  });
  assert.equal(relativeRoot.ok, false);
  assert.ok(errorCodes(relativeRoot).has("PLUGINS_ROOT_NOT_ABSOLUTE"));
  assert.deepEqual(Object.keys(relativeRoot.aggregates), ["full", "business", "cache"]);

  const invalidState = validateCacheSurface({
    pluginsRoot: resolve("Plugins"),
    contract: cloneContract(),
    cacheState: "ignored",
  });
  assert.equal(invalidState.ok, false);
  assert.ok(errorCodes(invalidState).has("CACHE_STATE_INVALID"));
});
