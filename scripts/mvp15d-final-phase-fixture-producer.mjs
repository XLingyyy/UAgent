#!/usr/bin/env node
/* global console, process */

import { createHash } from "node:crypto";

const TOOL_NAMES = [
  "ue.asset.create_folder",
  "ue.asset.duplicate",
  "ue.asset.rename",
  "ue.asset.move",
  "ue.asset.delete",
  "ue.asset.save",
];
const RETRACTIONS = [
  "disconnect",
  "endpoint_change",
  "failure",
  "reconnect",
  "renderer_restart",
  "newer_generation",
];

function stable(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
    .join(",")}}`;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseArgs(argv) {
  const supported = new Set(["phase", "task-id", "marker", "session", "generation", "port"]);
  const args = Object.create(null);
  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    const value = argv[index + 1];
    if (!token?.startsWith("--") || !supported.has(token.slice(2)) || !value) {
      throw new Error("FIXTURE_ARGUMENT_INVALID");
    }
    args[token.slice(2)] = value;
  }
  if (
    !["ue-automation", "product-capture", "ui-lifecycle"].includes(args.phase) ||
    !/^TASK-MVP15D-[A-Z0-9-]+$/.test(args["task-id"] ?? "") ||
    !/^[A-Za-z0-9._:-]{24,160}$/.test(args.marker ?? "") ||
    !/^[A-Za-z0-9._:-]{16,160}$/.test(args.session ?? "") ||
    !/^[1-9]\d*$/.test(args.generation ?? "") ||
    !/^\d{4,5}$/.test(args.port ?? "")
  ) {
    throw new Error("FIXTURE_ARGUMENT_INVALID");
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const common = {
    schemaVersion: "uagent.mvp15d.final.phase-event.v1",
    phase: args.phase,
    taskId: args["task-id"],
    marker: args.marker,
    sessionId: args.session,
    generation: Number(args.generation),
    producer: {
      id: "mvp15d-final-phase-fixture-producer",
      pid: process.pid,
      mode: "fixture",
    },
  };
  let sequence = 0;
  const emit = (type, data) => {
    sequence += 1;
    console.log(
      JSON.stringify({
        ...common,
        sequence,
        capturedAt: new Date(1_785_283_200_000 + sequence).toISOString(),
        type,
        data,
      }),
    );
  };
  emit("process_started", {
    port: Number(args.port),
    argumentVectorSha256: hash(stable(process.argv.slice(2))),
  });
  if (args.phase === "ue-automation") {
    emit("installed_loaded", {
      installed: ["UnrealEditor-UAgentAssetTools.dll"],
      loaded: ["UnrealEditor-UAgentAssetTools.dll"],
      manifest: ["UnrealEditor-UAgentAssetTools.dll"],
    });
    for (const name of [
      "UAgentAssetTools.Contracts",
      "UAgentAssetTools.ReadOnly",
      "UAgentAssetTools.Closeout",
    ]) {
      emit("automation_test", { name, status: "passed" });
    }
    emit("automation_summary", { expected: 3, passed: 3, failed: 0, skipped: 0 });
    emit("content_snapshot", { stage: "before", sha256: "a".repeat(64) });
    emit("mutation_observed", { count: 0 });
    emit("content_snapshot", { stage: "after", sha256: "a".repeat(64) });
  } else if (args.phase === "product-capture") {
    emit("capture_origin", {
      origin: "task_owned_fixture",
      fixtureUsed: true,
      manualDescriptorInjection: false,
      directMcpBypass: false,
    });
    for (const step of ["Connect", "Initialize", "Discover", "Normalize", "Fingerprint"]) {
      emit("product_step", { step });
    }
    emit("installed_loaded", {
      installed: ["UnrealEditor-UAgentAssetTools.dll"],
      loaded: ["UnrealEditor-UAgentAssetTools.dll"],
      manifest: ["UnrealEditor-UAgentAssetTools.dll"],
    });
    for (const name of TOOL_NAMES) {
      const descriptor = {
        name,
        schemaVersion: "mvp15d.asset-tools.v1",
        inputSchema: { additionalProperties: false, type: "object" },
      };
      emit("tool_published", { descriptor, canonicalSha256: hash(stable(descriptor)) });
    }
    for (const reason of RETRACTIONS) emit("tool_retracted", { reason, count: TOOL_NAMES.length });
    emit("mutation_observed", { count: 0 });
  } else {
    emit("capture_origin", { origin: "task_owned_fixture", fixtureUsed: true });
    for (const step of ["validate", "add", "confirmTrust"]) emit("rendered_step", { step });
    emit("installed_loaded", {
      installed: ["UnrealEditor-UAgentAssetTools.dll"],
      loaded: ["UnrealEditor-UAgentAssetTools.dll"],
      manifest: ["UnrealEditor-UAgentAssetTools.dll"],
    });
    emit("content_snapshot", { stage: "before", sha256: "b".repeat(64) });
    for (const action of [
      "create_run_root",
      "duplicate_test01",
      "rename_duplicate",
      "move_duplicate",
      "save_one_package",
    ]) {
      emit("lifecycle_action", { direction: "forward", action, sideEffectCount: 0 });
    }
    for (const action of ["move_back", "rename_back", "delete_duplicate", "cleanup_empty_folder"]) {
      emit("lifecycle_action", { direction: "inverse", action, sideEffectCount: 0 });
    }
    emit("negative_matrix", { caseCount: 8, passedCount: 8 });
    emit("partial_unknown_effect", { covered: true });
    emit("content_snapshot", { stage: "after", sha256: "b".repeat(64) });
    emit("run_root_state", { removed: true });
    emit("ownership_state", { closed: true });
  }
  emit("process_exited", { exitCode: 0 });
  emit("closeout", {
    processResidualCount: 0,
    portResidualCount: 0,
    markerResidualCount: 0,
    partialOutputCount: 0,
  });
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify({ status: "fixture_failed", reason: error?.message ?? "FIXTURE_FAILED" }),
  );
  process.exitCode = 2;
}
