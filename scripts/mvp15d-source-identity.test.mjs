/* global process */

// R7.3 deterministic transitive production-source identity regression.
//
// Proves that:
//  - a disposable repository/branch yields a clean committed identity;
//  - a same-branch commit changes the compiled-commit identity and the resolved
//    ref file, so a subsequent build would rerun and refresh;
//  - a dirty build can never report sourceDirty:false;
//  - missing, escaped, or non-file inventoried sources reject the identity.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
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
  PRODUCTION_SOURCE_BOUNDARY_VERSION,
  PRODUCTION_SOURCE_REQUIRED_FILES,
  PRODUCTION_SOURCE_ROOTS,
  SOURCE_EXCLUSION_RULES,
  computeSourceIdentity,
  computeSourceTreeSha256,
  enumerateProductionSources,
  resolveGitDirectory,
} from "./mvp15d-source-identity.mjs";

const git = ["git"];

function gitIn(cwd, args) {
  const result = spawnSync(git[0], ["-C", cwd, ...args], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  return result;
}

function expectCode(action, code) {
  assert.throws(action, (error) => error instanceof Error && error.message === code);
}

const REPRESENTATIVE_PRODUCTION_FILES = Object.freeze([
  "apps/desktop/src-tauri/src/lib.rs",
  "apps/desktop/src-tauri/src/mvp15d_runtime_bridge.rs",
  "apps/desktop/web/src/app/App.tsx",
  "apps/desktop/web/src/main.tsx",
  "apps/desktop/web/src/runtime/desktop-runtime-adapter.ts",
  "apps/desktop/web/src/runtime/mvp15d-runtime-bridge.ts",
  "apps/desktop/web/src/runtime/project-native-adapter.ts",
  "apps/desktop/web/src/settings/pages/ConfigSettings.tsx",
  "apps/desktop/web/src/settings/SettingsShell.tsx",
  "apps/desktop/web/src/shell/AppShell.tsx",
  "apps/desktop/web/src/stores/ui-store.ts",
  "apps/desktop/web/src/styles/globals.css",
  "integrations/unreal/UAgentAssetTools/Resources/uagent-asset-tools.schema.json",
  "integrations/unreal/UAgentAssetTools/Source/UAgentAssetTools/Private/UAgentAssetTool.cpp",
  "integrations/unreal/UAgentAssetTools/Source/UAgentAssetToolsTests/Private/UAgentAssetToolsTests.cpp",
  "integrations/unreal/UAgentAssetTools/Source/UAgentAssetToolsTests/Private/UAgentAssetToolsTestsModule.cpp",
  "integrations/unreal/UAgentAssetTools/Source/UAgentAssetToolsTests/UAgentAssetToolsTests.Build.cs",
  "packages/runtime/src/mvp15d-companion.ts",
  "scripts/mvp15d-final-live-producer-helper.mjs",
  "scripts/mvp15d-final-runner.mjs",
  "scripts/mvp15d-loaded-module-observer.mjs",
  "scripts/mvp15d-manifest.mjs",
  "scripts/mvp15d-plugin-build.mjs",
  "scripts/mvp15d-source-identity.mjs",
  "scripts/mvp15d-windows-job-process-runner.ps1",
]);

function writeInventoryTree(root) {
  for (const sourceRoot of PRODUCTION_SOURCE_ROOTS) {
    if (!sourceRoot.required) continue;
    const directory = resolve(root, ...sourceRoot.path.split("/"));
    mkdirSync(directory, { recursive: true });
    const seedName =
      sourceRoot.class === "final-tooling"
        ? "mvp15d-boundary-seed.mjs"
        : "uagent-boundary-seed.txt";
    writeFileSync(resolve(directory, seedName), `root:${sourceRoot.path}\n`, "utf8");
  }
  for (const logical of new Set([
    ...PRODUCTION_SOURCE_REQUIRED_FILES,
    ...REPRESENTATIVE_PRODUCTION_FILES,
  ])) {
    const destination = resolve(root, logical.split("/").join("\\"));
    mkdirSync(resolve(destination, ".."), { recursive: true });
    writeFileSync(destination, `content:${logical}\n`, "utf8");
  }
}

function createDisposableRepository() {
  const base = mkdtempSync(join(tmpdir(), "uagent-source-identity-"));
  const repo = resolve(base, "repo");
  mkdirSync(repo);
  writeInventoryTree(repo);
  assert.equal(gitIn(repo, ["init", "-q"]).status, 0);
  gitIn(repo, ["config", "user.email", "fixture@uagent.invalid"]);
  gitIn(repo, ["config", "user.name", "UAgent Fixture"]);
  gitIn(repo, ["config", "core.autocrlf", "false"]);
  gitIn(repo, ["add", "--", "."]);
  assert.equal(gitIn(repo, ["commit", "-q", "-m", "first"]).status, 0);
  return { base, repo };
}

function readableIdentity(identity) {
  return {
    compiledCommit: identity.compiledCommit,
    sourceTreeSha256: identity.sourceTreeSha256,
    sourceDirty: identity.sourceDirty,
    headSymbolic: identity.headSymbolic,
    headRef: identity.headRef,
    inventoriedFileCount: identity.inventoriedFileCount,
  };
}

test("R5.1 clean committed source reports sourceDirty:false and stable identity", () => {
  const fixture = createDisposableRepository();
  try {
    const identity = computeSourceIdentity(fixture.repo);
    assert.equal(identity.sourceDirty, false);
    assert.equal(identity.compiledCommitPresent, true);
    assert.match(identity.compiledCommit, /^[0-9a-f]{40}$/);
    assert.match(identity.sourceTreeSha256, /^[0-9a-f]{64}$/);
    assert.equal(identity.schemaVersion, "uagent.mvp15d.source-identity.v2");
    assert.equal(identity.productionBoundary.version, PRODUCTION_SOURCE_BOUNDARY_VERSION);
    assert.equal(
      identity.inventoriedFileCount,
      enumerateProductionSources(fixture.repo).inventory.length,
    );
    assert.equal(identity.headSymbolic, true);
    assert.match(identity.headRef, /^refs\/heads\/[A-Za-z0-9._-]+$/);

    // Same working-tree identity is deterministic.
    assert.deepEqual(
      readableIdentity(computeSourceIdentity(fixture.repo)),
      readableIdentity(identity),
    );
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("R5.1 an untracked or edited inventoried source can never report sourceDirty:false", () => {
  const fixture = createDisposableRepository();
  try {
    const clean = computeSourceIdentity(fixture.repo);
    assert.equal(clean.sourceDirty, false);

    // Modify one inventoried file without committing.
    const inventory = enumerateProductionSources(fixture.repo).inventory;
    const target = resolve(fixture.repo, inventory[0].split("/").join("\\"));
    writeFileSync(target, "edited-but-uncommitted\n", "utf8");
    const dirty = computeSourceIdentity(fixture.repo);
    assert.equal(dirty.sourceDirty, true);
    // The dirty tree binds the *new* working-tree bytes, never the committed ones.
    assert.notEqual(dirty.sourceTreeSha256, clean.sourceTreeSha256);
    // The compiled commit stays the same (nothing was committed), but must not be
    // presented as if HEAD contained the dirty diff.
    assert.equal(dirty.compiledCommit, clean.compiledCommit);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("R7.3 deleting a tracked production file changes the tree and reports sourceDirty:true", () => {
  const fixture = createDisposableRepository();
  try {
    const clean = computeSourceIdentity(fixture.repo);
    assert.equal(clean.sourceDirty, false);
    const logical = "apps/desktop/web/src/app/App.tsx";
    const target = resolve(fixture.repo, ...logical.split("/"));
    assert.equal(
      clean.inventoriedFiles.some(({ path }) => path === logical),
      true,
    );

    rmSync(target);
    const deleted = computeSourceIdentity(fixture.repo);
    assert.equal(
      deleted.inventoriedFiles.some(({ path }) => path === logical),
      false,
    );
    assert.equal(deleted.sourceDirty, true);
    assert.notEqual(deleted.sourceTreeSha256, clean.sourceTreeSha256);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("R7.3 deleting a tracked excluded test file leaves production identity clean", () => {
  const fixture = createDisposableRepository();
  try {
    const logical = "apps/desktop/web/src/app/App.test.tsx";
    const target = resolve(fixture.repo, ...logical.split("/"));
    writeFileSync(target, "export {};\n", "utf8");
    assert.equal(gitIn(fixture.repo, ["add", "--", logical]).status, 0);
    assert.equal(gitIn(fixture.repo, ["commit", "-q", "-m", "track excluded test"]).status, 0);

    const clean = computeSourceIdentity(fixture.repo);
    assert.equal(clean.sourceDirty, false);
    assert.equal(
      clean.inventoriedFiles.some(({ path }) => path === logical),
      false,
    );
    rmSync(target);
    const deleted = computeSourceIdentity(fixture.repo);
    assert.equal(deleted.sourceDirty, false);
    assert.equal(deleted.sourceTreeSha256, clean.sourceTreeSha256);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("R5.1 a same-branch commit changes the compiled commit and the resolved ref file", () => {
  const fixture = createDisposableRepository();
  try {
    const before = computeSourceIdentity(fixture.repo);
    assert.equal(before.sourceDirty, false);
    const refPathBefore = resolve(fixture.repo, before.headRefPath);

    // Amend the commit on the same branch with new inventoried content.
    const inventory = enumerateProductionSources(fixture.repo).inventory;
    const target = resolve(fixture.repo, inventory[0].split("/").join("\\"));
    writeFileSync(target, "same-branch-amend\n", "utf8");
    assert.equal(gitIn(fixture.repo, ["add", "--", "."]).status, 0);
    assert.equal(gitIn(fixture.repo, ["commit", "-q", "--amend", "-m", "amended"]).status, 0);

    const after = computeSourceIdentity(fixture.repo);
    assert.notEqual(after.compiledCommit, before.compiledCommit);
    assert.notEqual(after.sourceTreeSha256, before.sourceTreeSha256);
    assert.equal(after.sourceDirty, false);
    assert.equal(after.headRef, before.headRef);
    assert.equal(after.headRefPath, before.headRefPath);

    // A build would rerun because the resolved ref file content changed even
    // though `.git/HEAD` text ("ref: refs/heads/main") is unchanged.
    assert.equal(existsSync(refPathBefore), true);
    const headText = readFileSync(resolve(fixture.repo, ".git", "HEAD"), "utf8");
    assert.equal(headText.trim(), `ref: ${before.headRef}`);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("R7.3 missing required and linked production sources reject the identity", () => {
  const fixture = createDisposableRepository();
  try {
    const clean = computeSourceIdentity(fixture.repo);
    assert.equal(clean.sourceDirty, false);

    // Remove one inventoried file.
    const target = resolve(fixture.repo, PRODUCTION_SOURCE_REQUIRED_FILES[0].split("/").join("\\"));
    rmSync(target);
    expectCode(() => computeSourceIdentity(fixture.repo), "SOURCE_IDENTITY_REQUIRED_FILE_MISSING");

    // Restore and replace with a symlink (non-file).
    writeFileSync(target, "content\n", "utf8");
    gitIn(fixture.repo, ["add", "--", "."]);
    gitIn(fixture.repo, ["commit", "-q", "-m", "restore"]);
    const linkTarget = resolve(fixture.base, "elsewhere.txt");
    writeFileSync(linkTarget, "linked\n", "utf8");
    rmSync(target);
    try {
      symlinkSync(linkTarget, target, "file");
      expectCode(
        () => computeSourceIdentity(fixture.repo),
        "SOURCE_IDENTITY_BOUNDARY_LINK_INVALID",
      );
    } catch (error) {
      if (!["EPERM", "EACCES"].includes(error?.code)) throw error;
    }
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("R7.3 enumerated source-tree SHA is deterministic and sorted", () => {
  const fixture = createDisposableRepository();
  try {
    const root = fixture.repo;
    const inventory = enumerateProductionSources(root).inventory;
    const first = computeSourceTreeSha256(root, inventory);
    const second = computeSourceTreeSha256(root, [...inventory].reverse());
    assert.equal(first.sha256, second.sha256);
    assert.deepEqual(
      first.records.map(({ path }) => path),
      [...inventory].sort(),
    );

    // A missing path rejects deterministically.
    const missing = [...inventory, "apps/desktop/src-tauri/src/does-not-exist.rs"];
    expectCode(() => computeSourceTreeSha256(root, missing), "SOURCE_IDENTITY_INVENTORY_MISSING");
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("R5.1 a detached HEAD resolves to HEAD without a symbolic branch ref file", () => {
  const fixture = createDisposableRepository();
  try {
    const commit = gitIn(fixture.repo, ["rev-parse", "HEAD"]).stdout.trim();
    assert.equal(gitIn(fixture.repo, ["checkout", "-q", "--detach", commit]).status, 0);
    const identity = computeSourceIdentity(fixture.repo);
    assert.equal(identity.headSymbolic, false);
    assert.equal(identity.headRef, "HEAD");
    assert.equal(identity.compiledCommit, commit);
    assert.equal(identity.sourceDirty, false);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("R5.1 the identity helper is executable and self-describes its schema", () => {
  const fixture = createDisposableRepository();
  try {
    const result = spawnSync(
      process.execPath,
      [
        resolve(process.cwd(), "scripts", "mvp15d-source-identity.mjs"),
        "--repository",
        fixture.repo,
      ],
      { encoding: "utf8", shell: false, windowsHide: true },
    );
    assert.equal(result.status, 0, result.stderr);
    const identity = JSON.parse(result.stdout);
    assert.equal(identity.schemaVersion, "uagent.mvp15d.source-identity.v2");
    assert.equal(identity.productionBoundary.version, PRODUCTION_SOURCE_BOUNDARY_VERSION);
    assert.equal(identity.sourceDirty, false);
    assert.match(identity.sourceTreeSha256, /^[0-9a-f]{64}$/);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("R7.3 watch set covers Git resolution, production roots, and every inventoried file", () => {
  const fixture = createDisposableRepository();
  try {
    const branch = gitIn(fixture.repo, ["symbolic-ref", "--short", "HEAD"]).stdout.trim();
    assert.match(branch, /^[A-Za-z0-9._-]+$/);
    const identity = computeSourceIdentity(fixture.repo);
    const watch = new Set(identity.buildWatchSet);
    // The repository `.git` directory itself.
    assert.equal(watch.has(resolve(fixture.repo, ".git")), true);
    // The actual Git-dir HEAD file.
    assert.equal(watch.has(identity.headRefPath), true);
    // The resolved loose branch ref file in the correct git/common directory.
    assert.equal(watch.has(identity.resolvedRefPath), true);
    assert.equal(identity.resolvedRefPath, resolve(fixture.repo, ".git", "refs", "heads", branch));
    assert.equal(existsSync(identity.resolvedRefPath), true);
    // The applicable packed-refs file (watched even when currently absent).
    assert.equal(watch.has(resolve(fixture.repo, ".git", "packed-refs")), true);
    // Every root is watched, including currently absent optional asset roots,
    // so adding a production file invalidates Cargo.
    for (const sourceRoot of PRODUCTION_SOURCE_ROOTS) {
      assert.equal(
        watch.has(resolve(fixture.repo, ...sourceRoot.path.split("/"))),
        true,
        `watch set missing production root: ${sourceRoot.path}`,
      );
    }
    // Every inventoried production file, including the identity helper itself.
    for (const { path: logical } of identity.inventoriedFiles) {
      assert.equal(
        watch.has(resolve(fixture.repo, logical.split("/").join("\\"))),
        true,
        `watch set missing inventoried file: ${logical}`,
      );
    }
    // The watch set is exactly deterministic.
    const second = computeSourceIdentity(fixture.repo);
    assert.deepEqual(second.buildWatchSet, identity.buildWatchSet);
    assert.deepEqual(identity.gitWatchSet, identity.buildWatchSet);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("R6.3 same-branch commit changes the watched resolved ref bytes without touching source files", () => {
  const fixture = createDisposableRepository();
  try {
    const branch = gitIn(fixture.repo, ["symbolic-ref", "--short", "HEAD"]).stdout.trim();
    const before = computeSourceIdentity(fixture.repo);
    assert.equal(before.sourceDirty, false);
    assert.equal(before.headRef, `refs/heads/${branch}`);
    const resolvedRefPath = before.resolvedRefPath;
    const refBytesBefore = readFileSync(resolvedRefPath);
    const headText = readFileSync(resolve(fixture.repo, ".git", "HEAD"), "utf8").trim();
    assert.equal(headText, `ref: refs/heads/${branch}`);

    // A same-branch commit with no manual source-file change (the commit
    // message only) moves the resolved ref to a new commit.
    assert.equal(
      gitIn(fixture.repo, ["commit", "-q", "--allow-empty", "-m", "empty same-branch commit"])
        .status,
      0,
    );

    const after = computeSourceIdentity(fixture.repo);
    assert.notEqual(after.compiledCommit, before.compiledCommit);
    assert.notEqual(readFileSync(resolvedRefPath), refBytesBefore);
    // `.git/HEAD` text is unchanged, so only the exact resolved-ref watch
    // entry can invalidate the next build.
    assert.equal(
      readFileSync(resolve(fixture.repo, ".git", "HEAD"), "utf8").trim(),
      `ref: refs/heads/${branch}`,
    );
    assert.equal(after.resolvedRefPath, resolvedRefPath);
    assert.deepEqual(after.gitWatchSet, before.gitWatchSet);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("R6.3 packed refs resolve through the packed-refs file and watch the exact path", () => {
  const fixture = createDisposableRepository();
  try {
    const branch = gitIn(fixture.repo, ["symbolic-ref", "--short", "HEAD"]).stdout.trim();
    assert.equal(gitIn(fixture.repo, ["pack-refs", "--all"]).status, 0);
    const identity = computeSourceIdentity(fixture.repo);
    assert.equal(identity.sourceDirty, false);
    // The loose ref file is removed by pack-refs; resolution comes from the
    // packed-refs file and the watch set points at it.
    assert.equal(existsSync(resolve(fixture.repo, ".git", "refs", "heads", branch)), false);
    assert.equal(identity.resolvedRefPath, resolve(fixture.repo, ".git", "packed-refs"));
    assert.equal(identity.gitWatchSet.includes(identity.resolvedRefPath), true);

    // A packed same-branch commit changes the packed-refs bytes.
    const packedBefore = readFileSync(resolve(fixture.repo, ".git", "packed-refs"));
    assert.equal(
      gitIn(fixture.repo, ["commit", "-q", "--allow-empty", "-m", "packed same-branch commit"])
        .status,
      0,
    );
    const after = computeSourceIdentity(fixture.repo);
    assert.notEqual(after.compiledCommit, identity.compiledCommit);
    assert.notEqual(readFileSync(resolve(fixture.repo, ".git", "packed-refs")), packedBefore);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("R6.3 a linked worktree resolves the gitfile, common directory, and exact watch set", (t) => {
  const fixture = createDisposableRepository();
  const worktree = resolve(fixture.base, "worktree");
  try {
    const add = gitIn(fixture.repo, ["worktree", "add", "-q", "-b", "wt-branch", worktree]);
    if (add.status !== 0) {
      t.skip(`git worktree unavailable: ${add.stderr}`);
      return;
    }
    try {
      // In a linked worktree `.git` is a file, not a directory.
      assert.equal(lstatSync(resolve(worktree, ".git")).isFile(), true);
      const git = resolveGitDirectory(worktree);
      assert.notEqual(git.gitDir, git.commonDir);
      assert.equal(git.commonDir, resolve(fixture.repo, ".git"));

      const identity = computeSourceIdentity(worktree);
      assert.equal(identity.sourceDirty, false);
      assert.equal(identity.headSymbolic, true);
      assert.equal(identity.headRef, "refs/heads/wt-branch");
      // The HEAD file lives in the worktree git directory, not in the common
      // directory; the resolved loose ref lives in the common directory.
      assert.equal(identity.headRefPath, resolve(git.gitDir, "HEAD"));
      assert.equal(identity.resolvedRefPath, resolve(git.commonDir, "refs", "heads", "wt-branch"));
      const watch = new Set(identity.buildWatchSet);
      // The worktree gitfile is watched; no synthesized `.git/HEAD` children.
      assert.equal(watch.has(resolve(worktree, ".git")), true);
      assert.equal(watch.has(identity.headRefPath), true);
      assert.equal(watch.has(identity.resolvedRefPath), true);
      assert.equal(watch.has(resolve(git.commonDir, "packed-refs")), true);
      for (const sourceRoot of PRODUCTION_SOURCE_ROOTS) {
        assert.equal(watch.has(resolve(worktree, ...sourceRoot.path.split("/"))), true);
      }
      for (const { path: logical } of identity.inventoriedFiles) {
        assert.equal(watch.has(resolve(worktree, logical.split("/").join("\\"))), true);
      }

      // A same-branch commit in the worktree changes the identity without
      // touching source files.
      assert.equal(
        gitIn(worktree, ["commit", "-q", "--allow-empty", "-m", "worktree same-branch commit"])
          .status,
        0,
      );
      const after = computeSourceIdentity(worktree);
      assert.notEqual(after.compiledCommit, identity.compiledCommit);
      assert.equal(after.sourceDirty, false);
    } finally {
      gitIn(fixture.repo, ["worktree", "remove", "--force", worktree]);
    }
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("R7.3 every representative renderer/native/package/plugin/tooling input changes identity", () => {
  const fixture = createDisposableRepository();
  try {
    const clean = computeSourceIdentity(fixture.repo);
    assert.equal(clean.sourceDirty, false);
    for (const logical of [
      "apps/desktop/web/src/app/App.tsx",
      "apps/desktop/web/src/settings/SettingsShell.tsx",
      "apps/desktop/web/src/settings/pages/ConfigSettings.tsx",
      "apps/desktop/web/src/stores/ui-store.ts",
      "apps/desktop/web/src/styles/globals.css",
      "packages/runtime/src/mvp15d-companion.ts",
      "apps/desktop/web/src/runtime/project-native-adapter.ts",
      "apps/desktop/src-tauri/Cargo.lock",
      "pnpm-lock.yaml",
      "apps/desktop/src-tauri/tauri.conf.json",
      "integrations/unreal/UAgentAssetTools/Source/UAgentAssetTools/Private/UAgentAssetTool.cpp",
      "integrations/unreal/UAgentAssetTools/Resources/uagent-asset-tools.schema.json",
      "scripts/mvp15d-loaded-module-observer.mjs",
      "scripts/mvp15d-final-live-producer-helper.mjs",
      "scripts/mvp15d-windows-job-process-runner.ps1",
      "scripts/mvp15d-manifest.mjs",
      "scripts/mvp15d-plugin-build.mjs",
      "apps/desktop/src-tauri/build.rs",
    ]) {
      const target = resolve(fixture.repo, logical.split("/").join("\\"));
      const original = readFileSync(target);
      writeFileSync(target, `${original}\n// R7.3 mutation\n`, "utf8");
      const mutated = computeSourceIdentity(fixture.repo);
      assert.equal(mutated.sourceDirty, true, logical);
      assert.notEqual(mutated.sourceTreeSha256, clean.sourceTreeSha256, logical);
      writeFileSync(target, original);
    }
    // Restoring every file returns to the exact clean identity.
    const restored = computeSourceIdentity(fixture.repo);
    assert.equal(restored.sourceDirty, false);
    assert.equal(restored.sourceTreeSha256, clean.sourceTreeSha256);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("R7.3 a new untracked production file is inventoried, dirty, hashed, and root-watched", () => {
  const fixture = createDisposableRepository();
  try {
    const clean = computeSourceIdentity(fixture.repo);
    assert.equal(clean.sourceDirty, false);
    const logical = "apps/desktop/web/src/new-production-module.ts";
    const target = resolve(fixture.repo, ...logical.split("/"));
    writeFileSync(target, "export const newlyAdded = true;\n", "utf8");

    const mutated = computeSourceIdentity(fixture.repo);
    assert.equal(mutated.sourceDirty, true);
    assert.notEqual(mutated.sourceTreeSha256, clean.sourceTreeSha256);
    assert.equal(
      mutated.inventoriedFiles.some((record) => record.path === logical),
      true,
    );
    assert.equal(mutated.buildWatchSet.includes(target), true);
    assert.equal(
      mutated.buildWatchSet.includes(resolve(fixture.repo, "apps", "desktop", "web", "src")),
      true,
    );
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("R7.3 exact exclusions are reasoned and excluded test/output inputs do not change identity", () => {
  const fixture = createDisposableRepository();
  try {
    const clean = computeSourceIdentity(fixture.repo);
    const excludedFiles = [
      "apps/desktop/web/src/new-production.test.ts",
      "packages/runtime/src/fixtures/mvp11-ue-fixture/Content/Test.uasset",
      "scripts/side-effect-scan.mjs",
    ];
    for (const logical of excludedFiles) {
      const target = resolve(fixture.repo, ...logical.split("/"));
      mkdirSync(resolve(target, ".."), { recursive: true });
      writeFileSync(target, `excluded:${logical}\n`, "utf8");
    }

    const after = computeSourceIdentity(fixture.repo);
    assert.equal(after.sourceDirty, false);
    assert.equal(after.sourceTreeSha256, clean.sourceTreeSha256);
    const ruleIds = new Set(SOURCE_EXCLUSION_RULES.map(({ id }) => id));
    for (const rule of SOURCE_EXCLUSION_RULES) {
      assert.match(rule.id, /^[a-z0-9_]+$/);
      assert.equal(rule.matches.length > 0, true);
      assert.equal(rule.reason.length > 0, true);
    }
    assert.equal(after.productionBoundary.excludedEntries.length >= 3, true);
    for (const exclusion of after.productionBoundary.excludedEntries) {
      assert.equal(ruleIds.has(exclusion.ruleId), true, exclusion.path);
    }
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("R7.3 descriptor-loaded companion test module sources remain production inputs", () => {
  const fixture = createDisposableRepository();
  try {
    const identity = computeSourceIdentity(fixture.repo);
    const inventory = new Set(identity.inventoriedFiles.map(({ path }) => path));
    const expectedModuleInputs = [
      "integrations/unreal/UAgentAssetTools/Source/UAgentAssetToolsTests/Private/UAgentAssetToolsTests.cpp",
      "integrations/unreal/UAgentAssetTools/Source/UAgentAssetToolsTests/Private/UAgentAssetToolsTestsModule.cpp",
      "integrations/unreal/UAgentAssetTools/Source/UAgentAssetToolsTests/UAgentAssetToolsTests.Build.cs",
    ];
    for (const logical of expectedModuleInputs) {
      assert.equal(inventory.has(logical), true, logical);
      assert.equal(
        identity.productionBoundary.excludedEntries.some(({ path }) => path === logical),
        false,
        logical,
      );
    }
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("R7.3 absent optional roots watch their exact path and closest existing parent", () => {
  const fixture = createDisposableRepository();
  try {
    const clean = computeSourceIdentity(fixture.repo);
    assert.equal(clean.sourceDirty, false);
    const watch = new Set(clean.buildWatchSet);
    for (const sourceRoot of PRODUCTION_SOURCE_ROOTS.filter(({ required }) => !required)) {
      const rootPath = resolve(fixture.repo, ...sourceRoot.path.split("/"));
      assert.equal(existsSync(rootPath), false, sourceRoot.path);
      assert.equal(watch.has(rootPath), true, sourceRoot.path);
      assert.equal(watch.has(resolve(rootPath, "..")), true, sourceRoot.path);
    }

    const logical = "apps/desktop/web/public/accessibility.css";
    const added = resolve(fixture.repo, ...logical.split("/"));
    mkdirSync(resolve(added, ".."), { recursive: true });
    writeFileSync(added, ":root { color-scheme: light dark; }\n", "utf8");
    const after = computeSourceIdentity(fixture.repo);
    assert.equal(after.sourceDirty, true);
    assert.notEqual(after.sourceTreeSha256, clean.sourceTreeSha256);
    assert.equal(
      after.inventoriedFiles.some(({ path }) => path === logical),
      true,
    );
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("R7.3 an unclassified file under the final-tooling root rejects identity", () => {
  const fixture = createDisposableRepository();
  try {
    const target = resolve(fixture.repo, "scripts", "unclassified-helper.mjs");
    writeFileSync(target, "export {};\n", "utf8");
    expectCode(() => computeSourceIdentity(fixture.repo), "SOURCE_IDENTITY_UNCLASSIFIED_FILE");
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});

test("R7.3 the helper CLI emits the exact validated watch set in --watch-set mode", () => {
  const fixture = createDisposableRepository();
  try {
    const identity = computeSourceIdentity(fixture.repo);
    const result = spawnSync(
      process.execPath,
      [
        resolve(process.cwd(), "scripts", "mvp15d-source-identity.mjs"),
        "--repository",
        fixture.repo,
        "--watch-set",
      ],
      { encoding: "utf8", shell: false, windowsHide: true },
    );
    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.split(/\r?\n/).filter(Boolean);
    assert.deepEqual(lines, identity.buildWatchSet);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
});
