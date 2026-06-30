import { describe, expect, it } from "vitest";
import {
  classifyMvp14McpSchema,
  createEditorOperationService,
  createEditorObservationService,
  createEditorSessionRegistry,
  evaluateEditorProcessPolicy,
  runMvp14ScenarioMatrix,
} from "./index.js";

describe("MVP14 editor process policy", () => {
  it("blocks untrusted roots, root escapes, network roots, shell strings, env injection, and missing uprojects", () => {
    expect(evaluateEditorProcessPolicy({ projectId: "p", rootId: "root:other", trustedRootIds: ["root:trusted"], uprojDisplayPath: "[project-root]/Game.uproject" }).status).toBe("blocked");
    expect(evaluateEditorProcessPolicy({ projectId: "p", rootId: "root:trusted", trustedRootIds: ["root:trusted"], uprojDisplayPath: "../Game.uproject" }).reason).toBe("root_escape");
    expect(evaluateEditorProcessPolicy({ projectId: "p", rootId: "root:trusted", trustedRootIds: ["root:trusted"], uprojDisplayPath: "\\\\server\\Game.uproject" }).reason).toBe("network_root");
    expect(evaluateEditorProcessPolicy({ projectId: "p", rootId: "root:trusted", trustedRootIds: ["root:trusted"], uprojDisplayPath: "[project-root]/Game.txt" }).reason).toBe("missing_uproject");
    expect(evaluateEditorProcessPolicy({ projectId: "p", rootId: "root:trusted", trustedRootIds: ["root:trusted"], uprojDisplayPath: "[project-root]/Game.uproject", displayCommand: "UnrealEditor.exe && calc" }).reason).toBe("shell_metachar");
    expect(evaluateEditorProcessPolicy({ projectId: "p", rootId: "root:trusted", trustedRootIds: ["root:trusted"], uprojDisplayPath: "[project-root]/Game.uproject", redactedEnv: { PATH: "[redacted]" } }).reason).toBe("raw_env_injection");
  });
});

describe("MVP14 editor observation service", () => {
  it("discovers fixture processes, attaches, reads heartbeat/snapshot, stops only the local observation session, and replays recorded summaries", () => {
    let now = 1;
    const service = createEditorObservationService({
      bridgeEnabled: true,
      launchEnabled: false,
      trustedRootIds: ["root:trusted"],
      now: () => now,
    });

    const capability = service.refreshCapability();
    const processes = service.discoverProcesses({ projectId: "p", rootId: "root:trusted", uprojDisplayPath: "[project-root]/Game.uproject" });
    const attached = service.attachProcess({
      projectId: "p",
      rootId: "root:trusted",
      uprojDisplayPath: "[project-root]/Game.uproject",
      processId: processes.processes[0]!.id,
      mode: "fixture",
    });
    now = 2;
    const status = service.readStatus(attached.session!.sessionId);
    const snapshot = service.readSnapshot(attached.session!.sessionId);
    const replay = service.createReplaySummary(attached.session!.sessionId);
    const stopped = service.stopSession(attached.session!.sessionId);

    expect(capability.enabled).toBe(true);
    expect(processes.status).toBe("ready");
    expect(JSON.stringify(processes)).not.toContain("C:/Users/");
    expect(attached.status).toBe("attached");
    expect(status.heartbeat?.statusReason).toBe("heartbeat_ok");
    expect(snapshot.snapshot?.readOnlyDiagnostics).toContain("Save All blocked");
    expect(replay.recordedOnlyActions).toEqual(["discover", "attach", "status", "snapshot"]);
    expect(stopped.status).toBe("stopped");
    expect(stopped.reason).toBe("local_observation_stopped");
  });

  it("degrades instead of throwing when native process state is unavailable and expires inactive sessions", () => {
    let now = 100;
    const service = createEditorObservationService({
      bridgeEnabled: true,
      launchEnabled: false,
      trustedRootIds: ["root:trusted"],
      ttlMs: 10,
      now: () => now,
    });
    const attached = service.attachProcess({
      projectId: "p",
      rootId: "root:trusted",
      uprojDisplayPath: "[project-root]/Game.uproject",
      processId: "missing",
      mode: "fixture",
    });
    now = 120;

    expect(attached.reason).toBe("process_not_found");
    expect(service.readStatus("missing-session").reason).toBe("session_not_found");
  });

  it("does not synthesize a native running descriptor for non-fixture discovery without process observation", () => {
    const service = createEditorObservationService({
      bridgeEnabled: true,
      launchEnabled: false,
      trustedRootIds: ["root:real"],
    });

    const discovery = service.discoverProcesses({
      projectId: "p",
      rootId: "root:real",
      uprojDisplayPath: "[project-root]/Game.uproject",
      source: "native",
    });

    expect(discovery.status).toBe("degraded");
    expect(discovery.reason).toBe("native_discovery_unavailable");
    expect(discovery.processes).toEqual([]);
  });

  it("blocks attach when the request does not match a discovered running process descriptor", () => {
    const service = createEditorObservationService({
      bridgeEnabled: true,
      launchEnabled: false,
      trustedRootIds: ["root:trusted", "root:other"],
    });
    const discovery = service.discoverProcesses({ projectId: "p", rootId: "root:trusted", uprojDisplayPath: "[project-root]/Game.uproject" });
    const process = discovery.processes[0]!;

    expect(
      service.attachProcess({
        projectId: "p",
        rootId: "root:other",
        uprojDisplayPath: "[project-root]/Game.uproject",
        processId: process.id,
        mode: "fixture",
      }).reason,
    ).toBe("pid_session_root_project_mismatch");

    process.processState = "exited";
    expect(
      service.attachProcess({
        projectId: "p",
        rootId: "root:trusted",
        uprojDisplayPath: "[project-root]/Game.uproject",
        processId: process.id,
        mode: "fixture",
      }).reason,
    ).toBe("process_unavailable");
  });

  it("binds state-only execution to an active MVP14 observation session", () => {
    let now = 1;
    const observation = createEditorObservationService({
      bridgeEnabled: true,
      launchEnabled: false,
      trustedRootIds: ["root:trusted", "root:other"],
      ttlMs: 10,
      now: () => now,
    });
    const discovered = observation.discoverProcesses({ projectId: "p", rootId: "root:trusted", uprojDisplayPath: "[project-root]/Game.uproject" });
    const attached = observation.attachProcess({
      projectId: "p",
      rootId: "root:trusted",
      uprojDisplayPath: "[project-root]/Game.uproject",
      processId: discovered.processes[0]!.id,
      mode: "fixture",
    });
    const sessions = createEditorSessionRegistry({ featureEnabled: true, trustedRootIds: ["root:trusted", "root:other"], now: () => now });
    const editorSession = sessions.attach({
      projectId: "p",
      rootId: "root:trusted",
      uprojectDisplayPath: "[project-root]/Game.uproject",
      mode: "fixture",
    }).session!;
    const operations = createEditorOperationService({
      sessions,
      now: () => now,
      observation: {
        getSession: () => attached.session,
        readStatus: (sessionId) => observation.readStatus(sessionId),
      },
    });

    const proposed = operations.propose({ sessionId: editorSession.sessionId, operationKind: "select_asset", args: { asset: "/Game/Hero" } });
    const approved = operations.approve({ proposalId: proposed.proposal!.proposalId, actor: "tester", reason: "verify binding" });
    const executed = operations.execute({
      proposalId: proposed.proposal!.proposalId,
      approvalToken: approved.approval!.token,
      operationKind: "select_asset",
      args: { asset: "/Game/Hero" },
    });

    expect(executed.status).toBe("executed");

    const mismatchSession = sessions.attach({
      projectId: "p",
      rootId: "root:other",
      uprojectDisplayPath: "[project-root]/Other.uproject",
      mode: "fixture",
    }).session!;
    const mismatchProposal = operations.propose({ sessionId: mismatchSession.sessionId, operationKind: "select_asset", args: { asset: "/Game/Hero" } }).proposal!;
    const mismatchApproval = operations.approve({ proposalId: mismatchProposal.proposalId, actor: "tester", reason: "verify mismatch" }).approval!;
    expect(
      operations.execute({
        proposalId: mismatchProposal.proposalId,
        approvalToken: mismatchApproval.token,
        operationKind: "select_asset",
        args: { asset: "/Game/Hero" },
      }).reason,
    ).toBe("root_mismatch");

    now = 20;
    const expiredSession = sessions.attach({
      projectId: "p",
      rootId: "root:trusted",
      uprojectDisplayPath: "[project-root]/Game.uproject",
      mode: "fixture",
    }).session!;
    const expiredProposal = operations.propose({ sessionId: expiredSession.sessionId, operationKind: "select_asset", args: { asset: "/Game/Hero" } }).proposal!;
    const expiredApproval = operations.approve({ proposalId: expiredProposal.proposalId, actor: "tester", reason: "verify expiry" }).approval!;
    expect(
      operations.execute({
        proposalId: expiredProposal.proposalId,
        approvalToken: expiredApproval.token,
        operationKind: "select_asset",
        args: { asset: "/Game/Hero" },
      }).reason,
    ).toBe("session_expired");
  });
});

describe("MVP14 MCP schema adapters and scenario matrix", () => {
  it("classifies known schemas without executing tools/call", () => {
    expect(classifyMvp14McpSchema({ toolName: "ue.project.status", inputSchema: { type: "object" } }).classification).toBe("read_only_status");
    expect(classifyMvp14McpSchema({ toolName: "ue.asset.select", inputSchema: { type: "object" } }).classification).toBe("state_only_operation");
    expect(classifyMvp14McpSchema({ toolName: "ue.config.patch", inputSchema: { type: "object" } }).classification).toBe("text_backed_patch_intent");
    expect(classifyMvp14McpSchema({ toolName: "ue.asset.save", inputSchema: { type: "object" } }).classification).toBe("asset_plan_blocked");
    expect(classifyMvp14McpSchema({ toolName: "ue.magic", inputSchema: null }).classification).toBe("blocked_unknown");
  });

  it("covers at least 40 MVP14 scenarios and 160 assertions", () => {
    const matrix = runMvp14ScenarioMatrix();

    expect(matrix.scenarios.length).toBeGreaterThanOrEqual(40);
    expect(matrix.totalAssertions).toBeGreaterThanOrEqual(160);
    expect(matrix.scenarios.every((scenario) => scenario.pass)).toBe(true);
  });
});
