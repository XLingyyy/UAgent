import { describe, expect, it } from "vitest";
import type {
  AuditEventType,
  EvidenceKind,
  UEEditorAttachRequest,
  UEEditorHeartbeat,
  UEEditorLaunchPolicy,
  UEEditorObservationEvent,
  UEEditorObservationSnapshot,
  UEEditorProcessDescriptor,
  UEEditorProcessState,
  UEEditorSession,
  UEEditorStatusReason,
} from "./index.js";

describe("MVP14 editor observation shared contracts", () => {
  it("models process descriptors without raw executable paths or raw args", () => {
    const descriptor: UEEditorProcessDescriptor = {
      id: "process:fixture",
      pidHash: "pid:abc123",
      displayName: "UnrealEditor.exe",
      displayExecutableHash: "exe:abc123",
      displayProjectHint: "[project-root]/Game.uproject",
      processState: "running",
      discoveredAt: 1,
      expiresAt: 120_001,
      source: "fixture",
    };

    const serialized = JSON.stringify(descriptor);

    expect(descriptor.displayProjectHint).toBe("[project-root]/Game.uproject");
    expect(serialized).not.toContain("C:/Users/");
    expect(serialized).not.toContain("rawArgs");
    expect(serialized).not.toContain("token");
  });

  it("binds attach requests, heartbeat, snapshots, and events to redacted process state", () => {
    const request: UEEditorAttachRequest = {
      projectId: "project:fixture",
      rootId: "root:trusted",
      uprojDisplayPath: "[project-root]/Game.uproject",
      processId: "process:fixture",
      mode: "fixture",
    };
    const session: UEEditorSession = {
      sessionId: "editor-session:1",
      projectId: request.projectId,
      rootId: request.rootId,
      uprojectDisplayPath: request.uprojDisplayPath,
      pidHash: "pid:abc123",
      mode: "attached",
      status: "attached",
      createdAt: 1,
      expiresAt: 120_001,
      replayOnly: false,
    };
    const heartbeat: UEEditorHeartbeat = {
      sessionId: "editor-session:1",
      processState: "running",
      statusReason: "heartbeat_ok",
      processAlive: true,
      projectMatched: true,
      checkedAt: 2,
    };
    const snapshot: UEEditorObservationSnapshot = {
      sessionId: "editor-session:1",
      editorState: "attached",
      sessionState: "active",
      projectMatched: true,
      processAlive: true,
      lastHeartbeatAt: heartbeat.checkedAt,
      displayProject: request.uprojDisplayPath,
      displayProcess: "UnrealEditor.exe",
      readOnlyDiagnostics: ["process metadata only"],
      createdAt: 3,
    };
    const event: UEEditorObservationEvent = {
      type: "editor_observation_snapshot",
      sessionId: "editor-session:1",
      summary: "Snapshot recorded for [project-root]/Game.uproject",
      payload: {
        id: snapshot.sessionId,
        displayPath: snapshot.displayProject,
        summary: snapshot.readOnlyDiagnostics.join("; "),
        hash: "snapshot:hash",
      },
      createdAt: snapshot.createdAt,
    };

    expect(heartbeat.statusReason satisfies UEEditorStatusReason).toBe("heartbeat_ok");
    expect(session.pidHash).toBe("pid:abc123");
    expect(snapshot.editorState satisfies UEEditorProcessState).toBe("attached");
    expect(event.payload.displayPath).toBe("[project-root]/Game.uproject");
  });

  it("models native process discovery and lifecycle fallback reasons without raw paths", () => {
    const unavailableReason: UEEditorStatusReason = "process_not_found";
    const exitedSnapshot: UEEditorObservationSnapshot = {
      sessionId: "editor-session:native",
      editorState: "degraded",
      sessionState: "exited",
      projectMatched: false,
      processAlive: false,
      lastHeartbeatAt: null,
      displayProject: "[project-root]/Game.uproject",
      displayProcess: "UnrealEditor.exe",
      readOnlyDiagnostics: ["process_exited", "Save All blocked"],
      createdAt: 4,
    };

    const serialized = JSON.stringify(exitedSnapshot);

    expect(unavailableReason).toBe("process_not_found");
    expect(serialized).not.toContain("C:/Users/");
    expect(serialized).not.toContain("Program Files");
  });

  it("extends evidence and audit unions for MVP14 observation records", () => {
    const evidenceKinds: EvidenceKind[] = [
      "editor_process_observation",
      "editor_heartbeat",
      "editor_snapshot",
      "editor_state_operation",
      "asset_mutation_plan",
    ];
    const auditTypes: AuditEventType[] = [
      "editor_process_discovered",
      "editor_attached",
      "editor_heartbeat",
      "editor_observation_snapshot",
      "editor_session_expired",
      "editor_process_exited",
    ];
    const launchPolicy: UEEditorLaunchPolicy = {
      enabled: false,
      reason: "launch_feature_disabled",
      allowlistedArgs: [".uproject", "-Project=", "-NoSound", "-Unattended=false"],
      blockedArgs: ["-ExecCmds", "-run=pythonscript", "-run=automation"],
    };

    expect(evidenceKinds).toContain("editor_snapshot");
    expect(auditTypes).toContain("editor_process_exited");
    expect(launchPolicy.enabled).toBe(false);
  });
});
