import { describe, expect, it } from "vitest";
import { createSha256Hash } from "./mvp12-change-set.js";
import {
  BuildRepairCoordinator,
  createFixtureBuildRepairProposer,
  parseBuildRepairPath,
  BUILD_REPAIR_MAX_FILE_BYTES,
  BUILD_REPAIR_MAX_TOTAL_BYTES,
  type BuildRepairBinding,
  type BuildRepairBuildRequest,
  type BuildRepairNativePorts,
  type BuildRepairProposer,
  type BuildRepairApplyResult,
  type BuildRepairSnapshot,
  type BuildRepairPreview,
} from "./ue-build-repair.js";
import type { UEBuildExecutionResult, UEBuildOwner } from "./ue-build-profile.js";
const binding: BuildRepairBinding = {
  hostSessionId: "owned-host-session",
  projectId: "lab",
  rootObjectId: "held-root-id",
  runId: "run-t10",
  profileFingerprint: "a".repeat(64),
};
const initialOwner: UEBuildOwner = {
  runId: binding.runId,
  stepId: "initial-failed-build",
  fingerprint: binding.profileFingerprint,
};
const paths = ["Source/Lab/Lab.Build.cs", "Source/Lab/Private/Test.cpp"];
const initialContents = [
  'PublicDependencyModuleNames.AddRange(new [] { "Core" });\n',
  "int broken_symbol = 0;\n",
];
function build(
  owner = initialOwner,
  status: UEBuildExecutionResult["status"] = "failed",
): UEBuildExecutionResult {
  return {
    owner: { ...owner },
    status,
    reason: "process_exited",
    pid: 123,
    exitCode: status === "succeeded" ? 0 : 6,
    durationMs: 10,
    treeStopped: true,
    stdout: "Source/Lab/Private/Test.cpp(1): error C2065: 'broken_symbol': undeclared identifier\n",
    stderr: "",
    outputTruncated: false,
    outputComplete: true,
    effects: "possible",
  };
}
function fixture(
  options: {
    paths?: string[];
    contents?: string[];
    maxAttempts?: number;
    proposer?: BuildRepairProposer;
  } = {},
) {
  const selected = options.paths ?? paths,
    contents = options.contents ?? initialContents;
  const disk = new Map(
    selected.map((path, i) => [
      path,
      { content: contents[i] ?? "int value = 0;\n", id: `held-file-${i}` },
    ]),
  );
  const calls: {
    read: number;
    apply: number;
    build: number;
    query: number;
    active: number;
    previews: BuildRepairPreview[];
    owners: UEBuildOwner[];
    buildBindings: BuildRepairBuildRequest[];
  } = {
    read: 0,
    apply: 0,
    build: 0,
    query: 0,
    active: 0,
    previews: [],
    owners: [],
    buildBindings: [],
  };
  const usedApply = new Set<string>(),
    usedBuild = new Set<string>();
  let snapshot = 0;
  const ports: BuildRepairNativePorts = {
    async assertActive() {
      calls.active++;
    },
    async readSnapshots(request) {
      calls.read++;
      return {
        binding: { ...request.binding },
        diagnostic: structuredClone(request.diagnostic),
        snapshotId: `native-snapshot-${++snapshot}`,
        files: request.paths.map((path) => {
          const f = disk.get(path)!;
          return {
            path,
            content: f.content,
            sha256: createSha256Hash(f.content),
            objectIdentity: f.id,
          };
        }),
      };
    },
    async applyWithNativeApproval({ preview }) {
      calls.apply++;
      calls.previews.push(preview);
      if (usedApply.has(preview.previewId)) throw Error("native_one_use_replay");
      usedApply.add(preview.previewId);
      // This in-memory fixture models the trusted native boundary, never real user approval.
      const mismatch = preview.files.find(
        (f) =>
          disk.get(f.path)!.id !== f.beforeObjectIdentity ||
          createSha256Hash(disk.get(f.path)!.content) !== f.beforeHash,
      );
      if (mismatch)
        return receipt(
          preview,
          "conflict",
          preview.files.map((f) => ({
            ...effect(f, "not_started"),
            ...(f === mismatch
              ? {
                  status: "conflict" as const,
                  afterHash: createSha256Hash(disk.get(f.path)!.content),
                  afterObjectIdentity: disk.get(f.path)!.id,
                  reason: "native_preflight_changed",
                }
              : {}),
          })),
        );
      const effects = preview.files.map((f) => {
        const d = disk.get(f.path)!;
        d.content = f.after;
        d.id += ":replaced";
        return { ...effect(f, "applied"), afterHash: f.afterHash, afterObjectIdentity: d.id };
      });
      return receipt(preview, "applied", effects);
    },
    async buildWithNativeApproval(request) {
      const { owner } = request;
      calls.buildBindings.push(structuredClone(request));
      calls.build++;
      calls.owners.push(owner);
      if (usedBuild.has(owner.stepId)) throw Error("native_one_use_replay");
      usedBuild.add(owner.stepId);
      return {
        decision: "approved",
        execution: build(owner, "succeeded"),
        reason: "native_fixture_approved",
      };
    },
    async queryRecovery(request) {
      calls.query++;
      return {
        binding: { ...request.binding },
        diagnostic: structuredClone(request.diagnostic),
        previewId: request.previewId,
        queryId: `native-query-${calls.query}`,
        files: request.paths.map((path) => {
          const f = disk.get(path)!;
          return { path, sha256: createSha256Hash(f.content), objectIdentity: f.id };
        }),
      };
    },
  };
  const proposer =
    options.proposer ??
    (async ({ files, attempt }) => ({
      files: files.map(({ path, content }) => ({
        path,
        after: `${content}// explicit repair ${attempt}\n`,
      })),
    }));
  const coordinator = new BuildRepairCoordinator({
    repairId: "repair-t10",
    binding,
    initialBuildOwner: initialOwner,
    diagnosticRoots: { projectRoot: "E:/Lab", engineRoot: "G:/Engine", diagnosticCwd: "E:/Lab" },
    approvedReadPaths: selected,
    maxAttempts: options.maxAttempts,
    ports,
    proposer,
  });
  return { coordinator, ports, calls, disk };
}
function effect(
  file: BuildRepairPreview["files"][number],
  status: BuildRepairApplyResult["effects"][number]["status"],
): BuildRepairApplyResult["effects"][number] {
  return {
    path: file.path,
    status,
    beforeHash: file.beforeHash,
    beforeObjectIdentity: file.beforeObjectIdentity,
    afterHash: null,
    afterObjectIdentity: null,
    reason: "fixture",
  };
}
function receipt(
  preview: BuildRepairPreview,
  status: BuildRepairApplyResult["status"],
  effects: BuildRepairApplyResult["effects"],
  decision: BuildRepairApplyResult["decision"] = "approved",
): BuildRepairApplyResult {
  return {
    binding: preview.binding,
    diagnostic: preview.diagnostic,
    previewId: preview.previewId,
    decision,
    status,
    reason: "fixture",
    effects,
  };
}
const signal = () => new AbortController().signal;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("T10 closed source-only plans and native snapshots", () => {
  it("repairs two observed existing files, binds all preview values and verifies the owned build", async () => {
    const f = fixture();
    const result = await f.coordinator.run(build(), signal());
    expect(result.state).toBe("succeeded");
    expect(f.calls.apply).toBe(1);
    expect(f.calls.build).toBe(1);
    const preview = f.calls.previews[0]!;
    expect(preview.files.map((p) => p.path)).toEqual(paths);
    expect(preview.diagnostic.buildOwner).toEqual(initialOwner);
    expect(preview.diagnostic.diagnosticId).toMatch(/^[a-f0-9]{64}$/);
    for (const file of preview.files) {
      expect(file.beforeHash).toBe(createSha256Hash(file.before));
      expect(file.afterHash).toBe(createSha256Hash(file.after));
      expect(file.beforeObjectIdentity).toContain("held-file");
      expect(file.unifiedDiff).toContain("// explicit repair 1");
    }
    expect(f.calls.owners[0]).toEqual({
      runId: binding.runId,
      stepId: "repair-t10:build:1",
      fingerprint: binding.profileFingerprint,
    });
    expect(result.effects.every((e) => e.status === "applied")).toBe(true);
    expect(result.history).toHaveLength(1);
    expect(Object.isFrozen(result.preview!.files[0])).toBe(true);
  });
  it.each([
    "Source/../X.cpp",
    "Source/./X.cpp",
    "Source//X.cpp",
    "source/A.cpp",
    "Source\\A.cpp",
    "/Source/A.cpp",
    "E:/Source/A.cpp",
    "Source/A.cpp:stream",
    "Source/NUL.cpp",
    "Source/A.cpp.",
    "Source/A~1.cpp",
    "Source/Intermediate/A.cpp",
    "Config/A.ini",
    "Source/Lab.Target.cs",
    "Source/A.cs",
    "Source/A.umap",
  ])("rejects noncanonical/out-of-slice path %s", (path) => {
    expect(() => parseBuildRepairPath(path)).toThrow();
  });
  it("rejects too many files and attempts, while defaulting to two repair cycles", () => {
    expect(() =>
      fixture({ paths: Array.from({ length: 9 }, (_, i) => `Source/A${i}.cpp`) }),
    ).toThrow("read_scope_file_limit");
    for (const maxAttempts of [0, 4, 2.5, Infinity])
      expect(() => fixture({ maxAttempts })).toThrow("attempt_limit");
    expect(fixture().coordinator.checkpoint.maxAttempts).toBe(2);
  });
  it.each(["hash", "identity", "binding", "diagnostic", "duplicate"])(
    "rejects invalid native snapshot %s before apply",
    async (mode) => {
      const f = fixture(),
        read = f.ports.readSnapshots;
      f.ports.readSnapshots = async (...args) => {
        const r = await read(...args);
        if (mode === "hash") r.files[0]!.sha256 = "b".repeat(64);
        if (mode === "identity") r.files[0]!.objectIdentity = "";
        if (mode === "binding") r.binding.runId = "other";
        if (mode === "diagnostic") r.diagnostic.buildOwner.stepId = "other";
        if (mode === "duplicate") r.files[1] = structuredClone(r.files[0]!);
        return r;
      };
      // Ports are captured at construction: construct with the modified trusted fixture ports.
      const c = coordinatorWith(f.ports);
      const result = await c.run(build(), signal());
      expect(result.state).toBe("failed");
      expect(f.calls.apply).toBe(0);
      expect(f.calls.build).toBe(0);
    },
  );
  it("rejects binary, invalid Unicode, individual UTF-8 overflow and total snapshot overflow", async () => {
    for (const content of ["a\0b", "\ud800", "é".repeat(BUILD_REPAIR_MAX_FILE_BYTES / 2 + 1)]) {
      const f = fixture({ contents: [content, "int b;\n"] });
      expect((await f.coordinator.run(build(), signal())).state).toBe("failed");
      expect(f.calls.apply).toBe(0);
    }
    const f = fixture({
      paths: Array.from({ length: 5 }, (_, i) => `Source/A${i}.cpp`),
      contents: Array(5).fill("a".repeat(BUILD_REPAIR_MAX_FILE_BYTES)),
    });
    expect((await f.coordinator.run(build(), signal())).reason).toBe("snapshot_total_limit");
  });
  it.each([
    { files: [{ path: paths[0], after: "ok", hostPermit: "fake" }] },
    { files: [{ path: "Source/New.cpp", after: "new" }] },
    {
      files: [
        { path: paths[0], after: "ok" },
        { path: paths[0], after: "duplicate" },
      ],
    },
    { files: [{ path: paths[0], after: "a\0binary" }] },
    { files: [{ path: paths[0], after: "a".repeat(BUILD_REPAIR_MAX_FILE_BYTES + 1) }] },
    { files: [{ path: paths[0], after: "ok" }], approval: { token: "model" } },
  ])("rejects proposer scope/shape/binary/approval expansion %#", async (proposal) => {
    const f = fixture({ proposer: createFixtureBuildRepairProposer([proposal]) });
    const r = await f.coordinator.run(build(), signal());
    expect(r.state).toBe("failed");
    expect(f.calls.apply).toBe(0);
  });
  it("bounds total before plus replacement text and refuses no-op proposals", async () => {
    const selected = Array.from({ length: 5 }, (_, i) => `Source/A${i}.cpp`),
      f = fixture({
        paths: selected,
        contents: Array(5).fill("int a;\n"),
        proposer: async () => ({
          files: selected.map((path) => ({ path, after: "a".repeat(BUILD_REPAIR_MAX_FILE_BYTES) })),
        }),
      });
    expect((await f.coordinator.run(build(), signal())).reason).toBe("preview_total_limit");
    expect(f.calls.apply).toBe(0);
    expect(BUILD_REPAIR_MAX_TOTAL_BYTES).toBe(1024 * 1024);
    const noOp = fixture({
      proposer: async ({ files }) => ({
        files: files.map(({ path, content }) => ({ path, after: content })),
      }),
    });
    expect((await noOp.coordinator.run(build(), signal())).reason).toBe("proposal_has_no_changes");
  });
});
function coordinatorWith(
  ports: BuildRepairNativePorts,
  proposer: BuildRepairProposer = async ({ files, attempt }) => ({
    files: files.map(({ path, content }) => ({ path, after: `${content}// fix ${attempt}\n` })),
  }),
  maxAttempts?: number,
) {
  return new BuildRepairCoordinator({
    repairId: "repair-t10",
    binding,
    initialBuildOwner: initialOwner,
    diagnosticRoots: { projectRoot: "E:/Lab", engineRoot: "G:/Engine", diagnosticCwd: "E:/Lab" },
    approvedReadPaths: paths,
    ports,
    proposer,
    maxAttempts,
  });
}

describe("T10 native approval, effects and bounded retries", () => {
  it.each(["denied", "cancelled"] as const)(
    "never writes/builds after native apply approval %s",
    async (decision) => {
      const f = fixture();
      f.ports.applyWithNativeApproval = async ({ preview }) => {
        f.calls.apply++;
        return receipt(
          preview,
          "not_started",
          preview.files.map((file) => effect(file, "not_started")),
          decision,
        );
      };
      const r = await coordinatorWith(f.ports).run(build(), signal());
      expect(r.state).toBe(decision === "cancelled" ? "cancelled" : "failed");
      expect(r.effects.every((e) => e.status === "not_started")).toBe(true);
      expect(f.calls.build).toBe(0);
      expect(f.disk.get(paths[0]!)!.content).toBe(initialContents[0]);
    },
  );
  it("requires a separate native build approval even after a successful apply", async () => {
    const f = fixture();
    f.ports.buildWithNativeApproval = async () => {
      f.calls.build++;
      return { decision: "denied", execution: null, reason: "user_denied" };
    };
    const r = await coordinatorWith(f.ports).run(build(), signal());
    expect(r.state).toBe("failed");
    expect(r.reason).toBe("native_build_approval_denied");
    expect(r.effects.every((e) => e.status === "applied")).toBe(true);
    expect(r.pendingBuildOwner).toBeNull();
    expect(f.calls.apply).toBe(1);
  });
  it.each(["hash", "identity"])(
    "rejects external %s changes in the native whole-preview preflight",
    async (mode) => {
      const f = fixture();
      const proposer: BuildRepairProposer = async ({ files }) => {
        const d = f.disk.get(paths[0]!)!;
        if (mode === "hash") d.content = "external edit";
        else d.id = "replacement-file";
        return { files: files.map(({ path, content }) => ({ path, after: `${content}// fix\n` })) };
      };
      const r = await coordinatorWith(f.ports, proposer).run(build(), signal());
      expect(r.state).toBe("recovery_required");
      expect(r.reason).toBe("native_apply_conflict");
      expect(f.calls.build).toBe(0);
      expect(f.disk.get(paths[1]!)!.content).toBe(initialContents[1]);
    },
  );
  it("retains precise partial effects, queries them, and never automatically resumes or rolls back", async () => {
    const f = fixture();
    f.ports.applyWithNativeApproval = async ({ preview }) => {
      f.calls.apply++;
      const first = preview.files[0]!,
        d = f.disk.get(first.path)!;
      d.content = first.after;
      d.id += "-applied";
      return receipt(
        preview,
        "partial",
        preview.files.map((file, i) =>
          i === 0
            ? { ...effect(file, "applied"), afterHash: file.afterHash, afterObjectIdentity: d.id }
            : effect(file, "not_started"),
        ),
      );
    };
    const c = coordinatorWith(f.ports),
      r = await c.run(build(), signal());
    expect(r.state).toBe("recovery_required");
    expect(r.effects.map((e) => e.status)).toEqual(["applied", "not_started"]);
    expect(r.recoveryOptions).not.toContain("new_preview_and_native_approval");
    expect(f.calls.build).toBe(0);
    const queried = await c.queryRecovery(signal());
    expect(queried.state).toBe("recovery_checked");
    expect(queried.recovery!.files.map((f) => f.state)).toEqual([
      "verified_applied",
      "verified_not_started",
    ]);
    expect(f.calls.apply).toBe(1);
    expect(f.calls.build).toBe(0);
    expect(f.disk.get(paths[0]!)!.content).not.toBe(initialContents[0]);
  });
  it("does not infer ownership from matching after bytes when apply threw with unknown outcome", async () => {
    const f = fixture();
    f.ports.applyWithNativeApproval = async ({ preview }) => {
      f.calls.apply++;
      const p = preview.files[0]!;
      f.disk.set(p.path, { content: p.after, id: "unknown-replacement" });
      throw Error("transport_disconnected_after_write");
    };
    const c = coordinatorWith(f.ports),
      r = await c.run(build(), signal());
    expect(r.state).toBe("recovery_required");
    expect(r.effects.every((e) => e.status === "unknown")).toBe(true);
    expect(f.calls.build).toBe(0);
    const query = await c.queryRecovery(signal());
    expect(query.recovery!.files.map((f) => f.state)).toEqual([
      "matches_after_unowned",
      "verified_not_started",
    ]);
    expect(query.recoveryOptions).not.toContain("new_preview_and_native_approval");
    expect(f.calls.apply).toBe(1);
  });
  it.each(["missing_effect", "wrong_hash", "wrong_identity", "denied_but_applied", "diagnostic"])(
    "rejects contradictory native apply receipts: %s",
    async (mode) => {
      const f = fixture(),
        apply = f.ports.applyWithNativeApproval;
      f.ports.applyWithNativeApproval = async (...args) => {
        const r = await apply(...args);
        if (mode === "missing_effect") r.effects.pop();
        if (mode === "wrong_hash") r.effects[0]!.afterHash = "b".repeat(64);
        if (mode === "wrong_identity") r.effects[0]!.beforeObjectIdentity = "other";
        if (mode === "denied_but_applied") r.decision = "denied";
        if (mode === "diagnostic") r.diagnostic = { ...r.diagnostic, diagnosticId: "b".repeat(64) };
        return r;
      };
      const r = await coordinatorWith(f.ports).run(build(), signal());
      expect(r.state).toBe("recovery_required");
      expect(f.calls.build).toBe(0);
      expect(r.effects.every((e) => e.status === "unknown")).toBe(true);
    },
  );
  it.each([undefined, 3])(
    "caps confirmed-failure retry cycles at %s (default two)",
    async (maxAttempts) => {
      const f = fixture();
      f.ports.buildWithNativeApproval = async ({ owner }) => {
        f.calls.build++;
        f.calls.owners.push(owner);
        return { decision: "approved", execution: build(owner), reason: "owned_failed" };
      };
      const c = coordinatorWith(f.ports, undefined, maxAttempts),
        r = await c.run(build(), signal()),
        expected = maxAttempts ?? 2;
      expect(r.state).toBe("exhausted");
      expect(f.calls.apply).toBe(expected);
      expect(f.calls.build).toBe(expected);
      expect(r.history).toHaveLength(expected);
      expect(new Set(f.calls.previews.map((p) => p.previewId)).size).toBe(expected);
      expect(new Set(f.calls.owners.map((o) => o.stepId)).size).toBe(expected);
      expect(r.history[1]!.preview!.files[0]!.beforeHash).toBe(
        r.history[0]!.preview!.files[0]!.afterHash,
      );
    },
  );
  it("can succeed on the second separately approved cycle with new diagnostics/snapshots", async () => {
    const f = fixture();
    const nativeBuild = f.ports.buildWithNativeApproval;
    f.ports.buildWithNativeApproval = async (...args) => {
      const result = await nativeBuild(...args);
      if (f.calls.build === 1) result.execution = build(args[0].owner, "failed");
      return result;
    };
    const r = await coordinatorWith(f.ports).run(build(), signal());
    expect(r.state).toBe("succeeded");
    expect(f.calls.apply).toBe(2);
    expect(f.calls.read).toBe(2);
    expect(r.history[0]!.diagnostic.diagnosticId).not.toBe(r.history[1]!.diagnostic.diagnosticId);
    expect(f.calls.buildBindings).toHaveLength(2);
    for (let attempt = 0; attempt < 2; attempt++) {
      const request = f.calls.buildBindings[attempt]!,
        preview = f.calls.previews[attempt]!;
      expect(request.appliedPreviewId).toBe(preview.previewId);
      expect(request.expectedSources).toEqual(
        preview.files.map((file) => ({
          path: file.path,
          sha256: createSha256Hash(file.after),
          objectIdentity: r.history[attempt]!.effects.find((effect) => effect.path === file.path)!
            .afterObjectIdentity,
        })),
      );
      expect(
        request.expectedSources.every(
          (source) =>
            source.objectIdentity !==
            preview.files.find((file) => file.path === source.path)!.beforeObjectIdentity,
        ),
      ).toBe(true);
    }
    expect(f.calls.buildBindings[0]!.appliedPreviewId).not.toBe(
      f.calls.buildBindings[1]!.appliedPreviewId,
    );
    expect(f.calls.buildBindings[0]!.expectedSources[0]!.sha256).not.toBe(
      f.calls.buildBindings[1]!.expectedSources[0]!.sha256,
    );
    expect(f.calls.buildBindings[0]!.expectedSources[0]!.objectIdentity).not.toBe(
      f.calls.buildBindings[1]!.expectedSources[0]!.objectIdentity,
    );
  });
  it("keeps unknown build ownership separate from file recovery and never retries it", async () => {
    const f = fixture();
    f.ports.buildWithNativeApproval = async () => {
      f.calls.build++;
      throw Error("unknown_process_transport");
    };
    const c = coordinatorWith(f.ports),
      r = await c.run(build(), signal());
    expect(r.state).toBe("recovery_required");
    expect(r.pendingBuildOwner!.stepId).toBe("repair-t10:build:1");
    expect(r.recoveryOptions).toContain("query_owned_build");
    expect(f.calls.apply).toBe(1);
    const q = await c.queryRecovery(signal());
    expect(q.recovery!.requiresOwnedBuildQuery).toBe(true);
    expect(q.pendingBuildOwner).toEqual(r.pendingBuildOwner);
    expect(q.recoveryOptions).not.toContain("new_preview_and_native_approval");
    expect(f.calls.build).toBe(1);
  });
  it.each(["termination_unknown", "timed_out", "cancelled", "incomplete", "wrong_owner"])(
    "does not retry uncertain/cancelled/mismatched build %s",
    async (mode) => {
      const f = fixture();
      f.ports.buildWithNativeApproval = async ({ owner }) => {
        f.calls.build++;
        const result = build(owner);
        if (mode === "termination_unknown") {
          result.status = "termination_unknown";
          result.treeStopped = false;
        }
        if (mode === "timed_out") result.status = "timed_out";
        if (mode === "cancelled") result.status = "cancelled";
        if (mode === "incomplete") result.outputComplete = false;
        if (mode === "wrong_owner") result.owner = { ...owner, fingerprint: "b".repeat(64) };
        return { decision: "approved", execution: result, reason: "fixture" };
      };
      const r = await coordinatorWith(f.ports).run(build(), signal());
      expect(r.state).not.toBe("succeeded");
      expect(f.calls.build).toBe(1);
      expect(f.calls.apply).toBe(1);
      if (mode === "cancelled") expect(r.state).toBe("cancelled");
    },
  );
  it("requires real process evidence and current owner before using initial diagnostics", async () => {
    for (const initial of [
      { ...build(), owner: { ...initialOwner, stepId: "wrong" } },
      { ...build(), outputComplete: false },
      { ...build(), treeStopped: false },
      { ...build(), stdout: "BUILD SUCCESSFUL" },
    ]) {
      const f = fixture(),
        r = await f.coordinator.run(initial, signal());
      expect(r.state).not.toBe("succeeded");
      expect(f.calls.read).toBe(0);
      expect(f.calls.apply).toBe(0);
    }
  });
});

describe("T10 cancellation, async invalidation and one dispatch", () => {
  it("stops an already aborted signal before any host action", async () => {
    const f = fixture(),
      abort = new AbortController();
    abort.abort();
    expect((await f.coordinator.run(build(), abort.signal)).state).toBe("cancelled");
    expect(f.calls.active).toBe(0);
    expect(f.calls.read).toBe(0);
  });
  it("cancels during proposing without asking for mutation approval", async () => {
    const f = fixture(),
      abort = new AbortController();
    const c = coordinatorWith(f.ports, async ({ files }) => {
      abort.abort();
      return { files: files.map(({ path, content }) => ({ path, after: content + "// fix" })) };
    });
    expect((await c.run(build(), abort.signal)).state).toBe("cancelled");
    expect(f.calls.apply).toBe(0);
  });
  it("records apply effects before observing cancellation and prevents the following build", async () => {
    const f = fixture(),
      abort = new AbortController(),
      apply = f.ports.applyWithNativeApproval;
    f.ports.applyWithNativeApproval = async (...args) => {
      const result = await apply(...args);
      abort.abort();
      return result;
    };
    const r = await coordinatorWith(f.ports).run(build(), abort.signal);
    expect(r.state).toBe("cancelled");
    expect(r.effects.every((e) => e.status === "applied")).toBe(true);
    expect(f.calls.build).toBe(0);
  });
  it("does not claim success if cancellation arrives with a successful build receipt", async () => {
    const f = fixture(),
      abort = new AbortController(),
      run = f.ports.buildWithNativeApproval;
    f.ports.buildWithNativeApproval = async (...args) => {
      const r = await run(...args);
      abort.abort();
      return r;
    };
    const r = await coordinatorWith(f.ports).run(build(), abort.signal);
    expect(r.state).toBe("cancelled");
    expect(r.lastBuild!.status).toBe("succeeded");
  });
  it("rejects a concurrent run/query and permanently stops a late proposer after invalidation", async () => {
    const f = fixture(),
      entered = deferred<void>(),
      late = deferred<unknown>();
    const c = coordinatorWith(f.ports, async () => {
      entered.resolve();
      return late.promise;
    });
    const running = c.run(build(), signal());
    await entered.promise;
    await expect(c.run(build(), signal())).rejects.toThrow("coordinator_busy");
    await expect(c.queryRecovery(signal())).rejects.toThrow("coordinator_busy");
    c.invalidate();
    late.resolve({ files: [{ path: paths[0], after: "late edit" }] });
    expect((await running).state).toBe("invalidated");
    expect(f.calls.apply).toBe(0);
    await expect(c.run(build(), signal())).rejects.toThrow("already_started");
  });
  it("rechecks live scope after snapshots and after native apply", async () => {
    for (const phase of ["reading", "applying"]) {
      const f = fixture();
      let active = true;
      f.ports.assertActive = async () => {
        if (!active) throw Error("lease_revoked");
      };
      if (phase === "reading") {
        const read = f.ports.readSnapshots;
        f.ports.readSnapshots = async (...args) => {
          const r = await read(...args);
          active = false;
          return r;
        };
      } else {
        const apply = f.ports.applyWithNativeApproval;
        f.ports.applyWithNativeApproval = async (...args) => {
          const r = await apply(...args);
          active = false;
          return r;
        };
      }
      const r = await coordinatorWith(f.ports).run(build(), signal());
      expect(r.state).toBe("invalidated");
      expect(f.calls.build).toBe(0);
      expect(f.calls.apply).toBe(phase === "reading" ? 0 : 1);
    }
  });
  it("discards late snapshots on explicit scope invalidation", async () => {
    const f = fixture(),
      entered = deferred<void>(),
      late = deferred<BuildRepairSnapshot>(),
      read = f.ports.readSnapshots;
    let saved!: BuildRepairSnapshot;
    f.ports.readSnapshots = async (...args) => {
      saved = await read(...args);
      entered.resolve();
      return late.promise;
    };
    const c = coordinatorWith(f.ports),
      running = c.run(build(), signal());
    await entered.promise;
    c.invalidate();
    late.resolve(saved);
    expect((await running).state).toBe("invalidated");
    expect(f.calls.apply).toBe(0);
  });
  it("keeps query failures and changed file identity as recovery evidence without mutation", async () => {
    const f = fixture();
    f.ports.applyWithNativeApproval = async () => {
      f.calls.apply++;
      throw Error("unknown");
    };
    const c = coordinatorWith(f.ports);
    await c.run(build(), signal());
    f.disk.get(paths[0]!)!.id = "replaced-with-same-bytes";
    const q = await c.queryRecovery(signal());
    expect(q.recovery!.files[0]!.state).toBe("conflict");
    expect(f.calls.apply).toBe(1);
    expect(f.calls.build).toBe(0);
    const failed = fixture();
    failed.ports.applyWithNativeApproval = async () => {
      throw Error("unknown");
    };
    failed.ports.queryRecovery = async () => {
      throw Error("query_disconnected");
    };
    const d = coordinatorWith(failed.ports);
    await d.run(build(), signal());
    expect((await d.queryRecovery(signal())).state).toBe("recovery_required");
  });
});

describe("T10 final synchronous dispatch gates", () => {
  it("does not dispatch apply if cancellation lands between the async scope check and its caller continuation", async () => {
    const f = fixture(),
      abort = new AbortController();
    f.ports.assertActive = async () => {
      if (c.checkpoint.preview && c.checkpoint.state === "proposing")
        void Promise.resolve().then(() => {
          void Promise.resolve().then(() => abort.abort());
        });
    };
    const c = coordinatorWith(f.ports);
    expect((await c.run(build(), abort.signal)).state).toBe("cancelled");
    expect(f.calls.apply).toBe(0);
    expect(f.calls.build).toBe(0);
  });
  it("does not dispatch apply if host invalidation lands in the async scope-check continuation gap", async () => {
    const f = fixture();
    f.ports.assertActive = async () => {
      if (c.checkpoint.preview && c.checkpoint.state === "proposing")
        void Promise.resolve().then(() => {
          void Promise.resolve().then(() => c.invalidate());
        });
    };
    const c = coordinatorWith(f.ports);
    expect((await c.run(build(), signal())).state).toBe("invalidated");
    expect(f.calls.apply).toBe(0);
    expect(f.calls.build).toBe(0);
  });
});

describe("T10 unknown build evidence remains a process-query checkpoint", () => {
  it("retains an initial termination_unknown owner even if a contradictory stopped flag is present", async () => {
    const f = fixture(),
      r = await f.coordinator.run(
        { ...build(), status: "termination_unknown", treeStopped: true },
        signal(),
      );
    expect(r.state).toBe("recovery_required");
    expect(r.pendingBuildOwner).toEqual(initialOwner);
    expect(r.recoveryOptions).toContain("query_owned_build");
    expect(f.calls.read).toBe(0);
  });
  it("retains a repaired termination_unknown owner independently of file query results", async () => {
    const f = fixture();
    f.ports.buildWithNativeApproval = async ({ owner }) => {
      f.calls.build++;
      return {
        decision: "approved",
        execution: { ...build(owner), status: "termination_unknown", treeStopped: true },
        reason: "unknown",
      };
    };
    const c = coordinatorWith(f.ports),
      r = await c.run(build(), signal());
    expect(r.state).toBe("recovery_required");
    expect(r.pendingBuildOwner!.stepId).toBe("repair-t10:build:1");
    expect(f.calls.build).toBe(1);
    const query = await c.queryRecovery(signal());
    expect(query.recovery!.requiresOwnedBuildQuery).toBe(true);
    expect(query.recoveryOptions).toContain("query_owned_build");
  });
});
