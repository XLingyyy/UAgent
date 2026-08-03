#!/usr/bin/env node
/* global process */

// R7.3 deterministic transitive production-source identity helper.
//
// The MVP15D runtime bridge must never embed a stale compiled commit while the
// working tree still contains the task diff. This helper produces a single
// exact, sorted source inventory from explicit production roots and exclusion
// rules. The boundary covers renderer/native/package/plugin/config/lock inputs
// plus the final tooling chain, binds a SHA-256 over the resulting files, and
// records the base/compiled commit and dirty state separately. Both the Tauri
// build script and the deterministic regression tests execute this helper.
//
// The helper also resolves the complete build watch set: the repository `.git`
// directory or worktree gitfile, the actual Git-dir HEAD file, the resolved
// loose branch ref file in the correct git/common directory, the applicable
// packed-refs file, every production root (so new files invalidate Cargo), and
// every inventoried production file (including the identity helper itself).
// `build.rs` consumes this validated watch set and never synthesizes
// `.git/HEAD` child paths when `.git` is a file.

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCTION_SOURCE_BOUNDARY_VERSION = "uagent.mvp15d.production-source-boundary.v2";

// Exact files outside recursively walked production roots. These inputs control
// workspace/package resolution, compiler/bundler behavior, the Tauri release,
// and the companion descriptor. Every file is required.
const PRODUCTION_SOURCE_REQUIRED_FILES = Object.freeze(
  [
    ".editorconfig",
    ".gitattributes",
    ".npmrc",
    ".prettierignore",
    "apps/desktop/package.json",
    "apps/desktop/src-tauri/Cargo.lock",
    "apps/desktop/src-tauri/Cargo.toml",
    "apps/desktop/src-tauri/build.rs",
    "apps/desktop/src-tauri/tauri.conf.json",
    "apps/desktop/tsconfig.json",
    "apps/desktop/web/index.html",
    "apps/desktop/web/tsconfig.json",
    "apps/desktop/web/vite.config.ts",
    "eslint.config.mjs",
    "integrations/unreal/UAgentAssetTools/UAgentAssetTools.uplugin",
    "package.json",
    "packages/mcp-client/package.json",
    "packages/mcp-client/tsconfig.json",
    "packages/runtime/package.json",
    "packages/runtime/tsconfig.json",
    "packages/shared/package.json",
    "packages/shared/tsconfig.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "prettier.config.mjs",
    "tsconfig.json",
    "tsconfig.node.json",
    "vitest.workspace.ts",
  ].sort(compareLogicalPaths),
);

// Every file below a production root is included unless an exact rule below
// classifies it as a non-production input. Optional roots are watched even when
// absent so the first production asset added there invalidates a Cargo build.
const PRODUCTION_SOURCE_ROOTS = Object.freeze(
  [
    { path: "apps/desktop/src-tauri/capabilities", required: true, class: "native-capabilities" },
    { path: "apps/desktop/src-tauri/icons", required: true, class: "native-icons" },
    { path: "apps/desktop/src-tauri/resources", required: false, class: "native-resources" },
    { path: "apps/desktop/src-tauri/src", required: true, class: "native-rust" },
    { path: "apps/desktop/web/public", required: false, class: "renderer-public-assets" },
    { path: "apps/desktop/web/src", required: true, class: "renderer" },
    {
      path: "integrations/unreal/UAgentAssetTools/Build",
      required: false,
      class: "companion-build",
    },
    {
      path: "integrations/unreal/UAgentAssetTools/Config",
      required: true,
      class: "companion-config",
    },
    {
      path: "integrations/unreal/UAgentAssetTools/Resources",
      required: true,
      class: "companion-resources",
    },
    {
      path: "integrations/unreal/UAgentAssetTools/Source",
      required: true,
      class: "companion-source",
    },
    { path: "packages/mcp-client/src", required: true, class: "mcp-client" },
    { path: "packages/runtime/src", required: true, class: "runtime" },
    { path: "packages/shared/src", required: true, class: "shared" },
    { path: "scripts", required: true, class: "final-tooling" },
  ]
    .sort((left, right) => compareLogicalPaths(left.path, right.path))
    .map((entry) => Object.freeze(entry)),
);

// Each excluded class has one stable identifier, an exact path/name matcher,
// and a reason suitable for verification/reporting. Repository roots outside
// the production boundary are listed even though the walker never opens them.
const SOURCE_EXCLUSION_RULES = Object.freeze([
  Object.freeze({
    id: "test_sources",
    matches:
      "*.test.*, *.spec.*, test(s)/**, __tests__/**, __snapshots__/**; excludes no UAgentAssetToolsTests module input",
    reason:
      "Automated test sources and snapshots do not ship; the descriptor-loaded companion Editor test module remains production input.",
  }),
  Object.freeze({
    id: "test_fixture_projects",
    matches: "packages/runtime/src/fixtures/{mvp11-ue-fixture,mvp12-repair-fixture}/**",
    reason: "Synthetic UE fixture project bytes are test data and are never bundled into UAgent.",
  }),
  Object.freeze({
    id: "generated_output",
    matches:
      "node_modules, target, dist, out, coverage, Binaries, Intermediate, Saved, DerivedDataCache",
    reason: "Dependencies and generated build/package output are derived from inventoried inputs.",
  }),
  Object.freeze({
    id: "evidence_logs_caches_installers",
    matches: "evidence, captures, logs, cache, installers, output, tmp directories and *.log/*.tmp",
    reason:
      "Run evidence, logs, caches, installers, and temporary output are task results, not source.",
  }),
  Object.freeze({
    id: "documentation",
    matches: "*.md, *.mdx",
    reason:
      "Repository documentation does not alter the compiled release or final tooling behavior.",
  }),
  Object.freeze({
    id: "local_metadata",
    matches: ".gitignore, .DS_Store, desktop.ini",
    reason: "Local ignore and operating-system metadata do not determine production bytes.",
  }),
  Object.freeze({
    id: "secret_material",
    matches: ".env*, *.pem, *.key, credentials.json, secrets.json, *.secret",
    reason: "Secret and credential material is prohibited from the production source identity.",
  }),
  Object.freeze({
    id: "unrelated_validation_tooling",
    matches: "scripts/mvp15-python-cache-* and scripts/side-effect-scan.mjs",
    reason:
      "Historical Python-cache and repository scan validators are outside the final production chain.",
  }),
  Object.freeze({
    id: "repository_outside_boundary",
    matches:
      "docs/**, .agent-bus/**, .agent-bus-c/**, .agents/**, 监工文档/**, external/**, root output/tmp, desktop workflow/process files",
    reason:
      "Documentation, local workflow/process material, evidence roots, and external inputs are excluded.",
  }),
]);

class SourceIdentityError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new SourceIdentityError(code);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function sha256Text(value) {
  return sha256(Buffer.from(value, "utf8"));
}

function compareLogicalPaths(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function logicalPath(root, logical) {
  return resolve(root, ...logical.split("/"));
}

function pathSegments(logical) {
  return logical.toLowerCase().split("/");
}

function validatePathComponents(root, candidate) {
  if (!isPathWithin(root, candidate)) fail("SOURCE_IDENTITY_INVENTORY_ESCAPE");
  const value = relative(root, candidate);
  let current = root;
  for (const segment of value.split(/[\\/]/).filter(Boolean)) {
    current = resolve(current, segment);
    if (!existsSync(current)) return;
    const stats = lstatSync(current);
    if (stats.isSymbolicLink()) fail("SOURCE_IDENTITY_BOUNDARY_LINK_INVALID");
  }
}

function exclusionRuleId(logical, isDirectory) {
  const lower = logical.toLowerCase();
  const segments = pathSegments(logical);
  const basename = segments.at(-1) ?? "";
  const isCompanionLoadedTestModule = lower.startsWith(
    "integrations/unreal/uagentassettools/source/uagentassettoolstests/",
  );

  if (
    !isCompanionLoadedTestModule &&
    (segments.includes("test") ||
      segments.includes("tests") ||
      segments.includes("__tests__") ||
      segments.includes("__snapshots__") ||
      /\.(?:test|spec)\.[^/]+$/i.test(basename))
  ) {
    return "test_sources";
  }

  if (
    lower === "packages/runtime/src/fixtures/mvp11-ue-fixture" ||
    lower.startsWith("packages/runtime/src/fixtures/mvp11-ue-fixture/") ||
    lower === "packages/runtime/src/fixtures/mvp12-repair-fixture" ||
    lower.startsWith("packages/runtime/src/fixtures/mvp12-repair-fixture/")
  ) {
    return "test_fixture_projects";
  }

  const generatedDirectories = new Set([
    "node_modules",
    "target",
    "dist",
    "out",
    "coverage",
    "binaries",
    "intermediate",
    "saved",
    "deriveddatacache",
  ]);
  if (segments.some((segment) => generatedDirectories.has(segment))) {
    return "generated_output";
  }

  const resultDirectories = new Set([
    "evidence",
    "evidences",
    "captures",
    "logs",
    "cache",
    "caches",
    "installers",
    "installer",
    "output",
    "tmp",
    "temp",
  ]);
  if (
    segments.some((segment) => resultDirectories.has(segment)) ||
    (!isDirectory && /\.(?:log|tmp)$/i.test(basename))
  ) {
    return "evidence_logs_caches_installers";
  }

  if (!isDirectory && /\.(?:md|mdx)$/i.test(basename)) return "documentation";
  if ([".gitignore", ".ds_store", "desktop.ini"].includes(basename)) return "local_metadata";

  if (
    !isDirectory &&
    (/^\.env(?:\..+)?$/i.test(basename) ||
      /\.(?:pem|key|secret)$/i.test(basename) ||
      ["credentials.json", "secrets.json"].includes(basename))
  ) {
    return "secret_material";
  }

  if (lower === "scripts/side-effect-scan.mjs" || lower.startsWith("scripts/mvp15-python-cache-")) {
    return "unrelated_validation_tooling";
  }

  return null;
}

function isScriptProductionFile(logical) {
  const basename = logical.split("/").at(-1) ?? "";
  return /^mvp15d-[a-z0-9._-]+\.(?:mjs|ps1|json)$/i.test(basename);
}

function validateScriptProductionFile(logical) {
  if (!isScriptProductionFile(logical)) {
    fail("SOURCE_IDENTITY_UNCLASSIFIED_FILE");
  }
}

function isProductionLogicalPath(logical) {
  if (PRODUCTION_SOURCE_REQUIRED_FILES.includes(logical)) return true;
  const sourceRoot = PRODUCTION_SOURCE_ROOTS.find(
    ({ path }) => logical.startsWith(`${path}/`) && logical.length > path.length + 1,
  );
  if (!sourceRoot || exclusionRuleId(logical, false)) return false;
  return sourceRoot.class !== "final-tooling" || isScriptProductionFile(logical);
}

function nearestExistingWatchDirectory(root, candidate) {
  let current = candidate;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current || !isPathWithin(root, parent)) {
      fail("SOURCE_IDENTITY_WATCH_PARENT_INVALID");
    }
    current = parent;
  }
  validatePathComponents(root, current);
  const stats = lstatSync(current);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    fail("SOURCE_IDENTITY_WATCH_PARENT_INVALID");
  }
  return current;
}

function enumerateProductionSources(repoRoot) {
  const root = resolve(repoRoot);
  const inventory = [];
  const exclusions = [];

  const includeFile = (logical) => {
    const absolute = logicalPath(root, logical);
    if (!isPathWithin(root, absolute)) fail("SOURCE_IDENTITY_INVENTORY_ESCAPE");
    if (!existsSync(absolute)) fail("SOURCE_IDENTITY_REQUIRED_FILE_MISSING");
    validatePathComponents(root, absolute);
    const stats = lstatSync(absolute);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      fail("SOURCE_IDENTITY_INVENTORY_NOT_FILE");
    }
    inventory.push(logical);
  };

  for (const logical of PRODUCTION_SOURCE_REQUIRED_FILES) includeFile(logical);

  const walk = (absoluteDirectory, logicalDirectory, rootClass) => {
    const entries = readdirSync(absoluteDirectory, { withFileTypes: true }).sort((left, right) =>
      compareLogicalPaths(left.name, right.name),
    );
    for (const entry of entries) {
      if (/[\0\r\n]/.test(entry.name)) fail("SOURCE_IDENTITY_BOUNDARY_NAME_INVALID");
      const logical = `${logicalDirectory}/${entry.name}`;
      const isDirectory = entry.isDirectory();
      const ruleId = exclusionRuleId(logical, isDirectory);
      if (ruleId) {
        exclusions.push({ path: isDirectory ? `${logical}/` : logical, ruleId });
        continue;
      }

      const absolute = logicalPath(root, logical);
      validatePathComponents(root, absolute);
      const stats = lstatSync(absolute);
      if (stats.isSymbolicLink()) fail("SOURCE_IDENTITY_BOUNDARY_LINK_INVALID");
      if (stats.isDirectory()) {
        walk(absolute, logical, rootClass);
      } else if (stats.isFile()) {
        if (rootClass === "final-tooling") validateScriptProductionFile(logical);
        inventory.push(logical);
      } else {
        fail("SOURCE_IDENTITY_INVENTORY_NOT_FILE");
      }
    }
  };

  for (const sourceRoot of PRODUCTION_SOURCE_ROOTS) {
    const absolute = logicalPath(root, sourceRoot.path);
    if (!existsSync(absolute)) {
      if (sourceRoot.required) fail("SOURCE_IDENTITY_REQUIRED_ROOT_MISSING");
      continue;
    }
    validatePathComponents(root, absolute);
    const stats = lstatSync(absolute);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      fail("SOURCE_IDENTITY_BOUNDARY_ROOT_INVALID");
    }
    walk(absolute, sourceRoot.path, sourceRoot.class);
  }

  inventory.sort(compareLogicalPaths);
  exclusions.sort((left, right) => compareLogicalPaths(left.path, right.path));
  const seen = new Set();
  for (const logical of inventory) {
    const folded = logical.toLowerCase();
    if (seen.has(folded)) fail("SOURCE_IDENTITY_INVENTORY_CASE_COLLISION");
    seen.add(folded);
  }

  return {
    version: PRODUCTION_SOURCE_BOUNDARY_VERSION,
    inventory,
    exclusions,
    roots: PRODUCTION_SOURCE_ROOTS.map(({ path, required, class: rootClass }) => ({
      path,
      required,
      class: rootClass,
    })),
  };
}

// ---- git resolution -----------------------------------------------------

// Resolve the repository's real git directory. Supports a `.git` directory and
// a `.git` file (worktrees). Returns { gitFile, gitDir, commonDir } where the
// two dirs are real directories (`gitDir` may equal `commonDir`).
function resolveGitDirectory(repoRoot) {
  const gitPath = resolve(repoRoot, ".git");
  if (!existsSync(gitPath)) fail("SOURCE_IDENTITY_REPOSITORY_INVALID");
  const stats = lstatSync(gitPath);
  if (stats.isDirectory()) {
    return { gitFile: gitPath, gitDir: gitPath, commonDir: gitPath };
  }
  if (stats.isSymbolicLink()) fail("SOURCE_IDENTITY_GIT_LINK_INVALID");
  if (!stats.isFile()) fail("SOURCE_IDENTITY_GIT_INVALID");
  const text = readFileSync(gitPath, "utf8").trim();
  const match = /^gitdir:\s*(.+)$/.exec(text);
  if (!match) fail("SOURCE_IDENTITY_GIT_INVALID");
  const gitDir = resolve(repoRoot, match[1].trim());
  if (!lstatSync(gitDir).isDirectory()) fail("SOURCE_IDENTITY_GIT_INVALID");
  const commonPath = resolve(gitDir, "commondir");
  let commonDir = gitDir;
  if (existsSync(commonPath)) {
    const commonRel = readFileSync(commonPath, "utf8").trim();
    commonDir = isAbsolute(commonRel) ? commonRel : resolve(gitDir, commonRel);
  }
  return { gitFile: gitPath, gitDir, commonDir };
}

// Read a ref file directly at `baseDir/name`, returning the pointed 40-hex or
// a symbolic `ref:` value. Returns null when absent.
function readRefFile(baseDir, name) {
  const path = resolve(baseDir, name.split("/").join("\\"));
  if (!existsSync(path)) return null;
  const stats = lstatSync(path);
  if (stats.isSymbolicLink()) fail("SOURCE_IDENTITY_REF_LINK_INVALID");
  const text = readFileSync(path, "utf8").trim();
  const hex = /^[0-9a-f]{40}$/.exec(text);
  if (hex) return { kind: "hex", value: hex[0], path };
  const sym = /^ref:\s*(.+)$/.exec(text);
  if (sym) return { kind: "sym", value: sym[1].trim(), path };
  fail("SOURCE_IDENTITY_REF_INVALID");
}

// Parse packed-refs into a map of ref name -> 40-hex.
function readPackedRefs(commonDir) {
  const path = resolve(commonDir, "packed-refs");
  if (!existsSync(path)) return new Map();
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const map = new Map();
  for (const line of lines) {
    if (!line || line.startsWith("#") || line.startsWith("^")) continue;
    const match = /^([0-9a-f]{40})\s+(.+)$/.exec(line.trim());
    if (match) map.set(match[2], match[1]);
  }
  return map;
}

// Resolve symbolic refs (bounded depth) through the git ref namespace, falling
// back to packed refs for refs not written as loose files (common in monorepo
// clones and after `git pack-refs`).
function resolveSymbolicRef(commonDir, gitDir, name) {
  const packed = readPackedRefs(commonDir);
  let current = name;
  for (let depth = 0; depth < 16; depth += 1) {
    const direct = readRefFile(gitDir, current);
    const value = direct ?? readRefFile(commonDir, current);
    if (value && value.kind === "hex") {
      return { name: current, commit: value.value, path: value.path };
    }
    if (packed.has(current)) {
      return {
        name: current,
        commit: packed.get(current),
        path: resolve(commonDir, "packed-refs"),
      };
    }
    if (!value) return null;
    current = value.value;
  }
  fail("SOURCE_IDENTITY_REF_DEPTH_INVALID");
}

// Resolve HEAD to
// { headPath, headName, resolvedName, resolvedPath, commit }. `resolvedPath`
// is the exact file whose bytes resolve the ref: the loose branch ref file in
// the correct git/common directory, the applicable packed-refs file, or null
// for detached/unborn HEAD.
function resolveHead(commonDir, gitDir) {
  const head = readRefFile(gitDir, "HEAD");
  if (!head) fail("SOURCE_IDENTITY_HEAD_INVALID");
  if (head.kind === "hex") {
    return {
      headPath: head.path,
      headName: "HEAD",
      resolvedName: "HEAD",
      resolvedPath: null,
      commit: head.value,
    };
  }
  const resolved = resolveSymbolicRef(commonDir, gitDir, head.value);
  if (!resolved) {
    // Symbolic HEAD whose ref has no commit yet (unborn branch with empty repo).
    return {
      headPath: head.path,
      headName: "HEAD",
      resolvedName: head.value,
      resolvedPath: null,
      commit: null,
    };
  }
  return {
    headPath: head.path,
    headName: "HEAD",
    resolvedName: resolved.name,
    resolvedPath: resolved.path,
    commit: resolved.commit,
  };
}

// Deterministic, sorted, directory-closed inventory SHA-256. Rejects symlinks,
// case collisions, missing files, non-files, and paths escaping the repository.
function computeSourceTreeSha256(root, inventory) {
  const records = [];
  const folded = new Set();
  for (const logical of inventory) {
    const foldedName = logical.toLowerCase();
    if (folded.has(foldedName)) fail("SOURCE_IDENTITY_INVENTORY_CASE_COLLISION");
    folded.add(foldedName);
    const path = logicalPath(root, logical);
    if (!isPathWithin(root, path)) fail("SOURCE_IDENTITY_INVENTORY_ESCAPE");
    if (!existsSync(path)) fail("SOURCE_IDENTITY_INVENTORY_MISSING");
    validatePathComponents(root, path);
    const stats = lstatSync(path);
    if (!stats.isFile() || stats.isSymbolicLink()) fail("SOURCE_IDENTITY_INVENTORY_NOT_FILE");
    records.push({ path: logical, size: stats.size, sha256: sha256File(path) });
  }
  records.sort((left, right) => compareLogicalPaths(left.path, right.path));
  const bundle = records.map(({ path, size, sha256 }) => `${path}\0${size}\0${sha256}`).join("\n");
  return { records, sha256: sha256Text(bundle) };
}

function isPathWithin(root, candidate) {
  const value = relative(root, candidate);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

let gitBinary = ["git"];
function setGitBinary(value) {
  gitBinary = value;
}

function gitCommand(root, args, encoding = "utf8") {
  const child = spawnSync(gitBinary[0], [...gitBinary.slice(1), "-C", root, ...args], {
    encoding,
    shell: false,
    windowsHide: true,
  });
  if (child.error || child.status !== 0) fail("SOURCE_IDENTITY_GIT_OBJECT_READ_FAILED");
  return child.stdout;
}

function readHeadBlobIds(root, commit) {
  const output = gitCommand(root, ["ls-tree", "-r", "-z", "--full-tree", commit], null);
  const records = output.toString("utf8").split("\0").filter(Boolean);
  const blobs = new Map();
  for (const record of records) {
    const tab = record.indexOf("\t");
    if (tab < 0) fail("SOURCE_IDENTITY_GIT_TREE_INVALID");
    const metadata = record.slice(0, tab).split(" ");
    if (metadata.length !== 3) fail("SOURCE_IDENTITY_GIT_TREE_INVALID");
    const [mode, type, objectId] = metadata;
    if (type === "blob" && /^100[0-7]{3}$/.test(mode)) {
      blobs.set(record.slice(tab + 1), objectId);
    }
  }
  return blobs;
}

function readGitObjectFormat(root) {
  const value = gitCommand(root, ["rev-parse", "--show-object-format"]).trim();
  if (value !== "sha1" && value !== "sha256") fail("SOURCE_IDENTITY_GIT_OBJECT_FORMAT_INVALID");
  return value;
}

function gitBlobId(bytes, objectFormat) {
  const header = Buffer.from(`blob ${bytes.length}\0`, "utf8");
  return createHash(objectFormat).update(header).update(bytes).digest("hex");
}

// Compare the current inventory against the Git HEAD production set and bytes
// in one tree read. This catches edits, additions, and deletions. HEAD paths are
// classified through the same current boundary so removed tests/fixtures or
// other exact exclusion classes do not make the production identity dirty.
function isSourceDirty(root, commit, records) {
  if (!commit) return true;
  const blobs = readHeadBlobIds(root, commit);
  const objectFormat = readGitObjectFormat(root);
  const currentPaths = new Set(records.map(({ path }) => path));
  for (const headPath of blobs.keys()) {
    if (isProductionLogicalPath(headPath) && !currentPaths.has(headPath)) return true;
  }
  for (const record of records) {
    const current = readFileSync(logicalPath(root, record.path));
    if (blobs.get(record.path) !== gitBlobId(current, objectFormat)) return true;
  }
  return false;
}

// ---- public identity ------------------------------------------------------

/**
 * Compute the deterministic task-source identity for a repository root.
 * @returns {{
 *   collectedAtUtc: string,
 *   schemaVersion: string,
 *   repositoryClosed: boolean,
 *   headRefPath: string,
 *   headSymbolic: boolean,
 *   headRef: string,
 *   resolvedRefPath: string|null,
 *   compiledCommit: string|null,
 *   compiledCommitPresent: boolean,
 *   sourceTreeSha256: string,
 *   sourceDirty: boolean,
 *   inventoriedFileCount: number,
 *   inventoriedFiles: Array<{path:string,size:number,sha256:string}>,
 *   excludedEntryCount: number,
 *   productionBoundary: object,
 *   buildWatchSet: string[],
 *   gitWatchSet: string[]
 * }}
 */
function computeSourceIdentity(repoRoot, options = {}) {
  if (options.gitBinary) setGitBinary(options.gitBinary);
  const root = resolve(repoRoot);
  const git = resolveGitDirectory(root);
  const head = resolveHead(git.commonDir, git.gitDir);
  const compiledCommit = head.commit;
  const boundary = enumerateProductionSources(root);
  const { records, sha256 } = computeSourceTreeSha256(root, boundary.inventory);
  const sourceDirty = isSourceDirty(root, compiledCommit, records);

  // Exact build watch set: the `.git` directory or worktree gitfile, the actual
  // Git-dir HEAD file, the resolved loose branch ref file (git or common
  // directory) or the applicable packed-refs file, the packed-refs file
  // itself (even when currently absent), every declared production root, and
  // every inventoried production file. Watching the roots makes an untracked
  // newly added production file invalidate Cargo. No synthesized `.git/HEAD`
  // child paths are used when `.git` is a file.
  const watch = new Set([git.gitFile, head.headPath]);
  if (head.resolvedPath) watch.add(head.resolvedPath);
  watch.add(resolve(git.commonDir, "packed-refs"));
  for (const sourceRoot of PRODUCTION_SOURCE_ROOTS) {
    const rootPath = logicalPath(root, sourceRoot.path);
    watch.add(rootPath);
    if (!existsSync(rootPath)) {
      // Cargo cannot reliably observe creation beneath a path that does not
      // exist yet. Watching the closest validated existing parent captures the
      // optional root's first creation; the exact root remains in the set too.
      watch.add(nearestExistingWatchDirectory(root, rootPath));
    }
  }
  for (const record of records) {
    watch.add(logicalPath(root, record.path));
  }
  const buildWatchSet = [...watch].sort(compareLogicalPaths);

  return {
    collectedAtUtc: "fixed-2026-07-31T00:00:00.000Z",
    schemaVersion: "uagent.mvp15d.source-identity.v2",
    repositoryClosed: true,
    headRefPath: head.headPath,
    headSymbolic: head.resolvedName !== "HEAD",
    headRef: head.resolvedName,
    resolvedRefPath: head.resolvedPath,
    compiledCommit,
    compiledCommitPresent: compiledCommit !== null,
    sourceTreeSha256: sha256,
    sourceDirty,
    inventoriedFileCount: records.length,
    inventoriedFiles: records,
    excludedEntryCount: boundary.exclusions.length,
    productionBoundary: {
      version: boundary.version,
      exactFiles: [...PRODUCTION_SOURCE_REQUIRED_FILES],
      roots: boundary.roots,
      exclusionRules: SOURCE_EXCLUSION_RULES,
      excludedEntries: boundary.exclusions,
    },
    buildWatchSet,
    // Compatibility alias retained for Rework 6 callers. It now contains the
    // complete production-root/file build watch set in addition to Git refs.
    gitWatchSet: buildWatchSet,
  };
}

function identityFromPaths() {
  const start = process.argv.indexOf("--repository");
  const value = start >= 0 ? process.argv[start + 1] : null;
  return resolve(value ?? process.cwd());
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const root = identityFromPaths();
    if (process.argv.includes("--watch-set")) {
      const identity = computeSourceIdentity(root);
      process.stdout.write(`${identity.buildWatchSet.join("\n")}\n`);
    } else {
      const identity = computeSourceIdentity(root);
      process.stdout.write(`${JSON.stringify(identity, null, 2)}\n`);
    }
  } catch (error) {
    const code =
      error instanceof SourceIdentityError ? error.code : (error?.code ?? "SOURCE_IDENTITY_FAILED");
    process.stdout.write(
      `${JSON.stringify(
        {
          schemaVersion: "uagent.mvp15d.source-identity.v2",
          status: "source_identity_rejected",
          reason: code,
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 2;
  }
}

export {
  PRODUCTION_SOURCE_BOUNDARY_VERSION,
  PRODUCTION_SOURCE_REQUIRED_FILES,
  PRODUCTION_SOURCE_ROOTS,
  SOURCE_EXCLUSION_RULES,
  SourceIdentityError,
  computeSourceIdentity,
  computeSourceTreeSha256,
  enumerateProductionSources,
  resolveGitDirectory,
  resolveHead,
};
