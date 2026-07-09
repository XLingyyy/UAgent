import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorPanel } from "../inspector/EditorPanel";
import { createDesktopRuntimeAdapter } from "../runtime/desktop-runtime-adapter";
import type { NativeInvoke } from "../runtime/project-native-adapter";
import { UIProvider, useRuntimeStore } from "./ui-store";

function RuntimePidHashProbe() {
  const pidHash = useRuntimeStore((state) => state.mvp14.session?.pidHash ?? "missing");
  return <output aria-label="MVP14 session pid hash">{pidHash}</output>;
}

describe("MVP14 desktop editor observation UI", () => {
  it("renders observation status, heartbeat, snapshot, and safety boundaries from the runtime store", () => {
    render(
      <UIProvider>
        <EditorPanel />
      </UIProvider>,
    );

    expect(screen.getByText("UE Editor")).toBeTruthy();
    expect(screen.getByText(/MVP14 safe observation/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh editor observation capability" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Discover editor processes" })).toBeTruthy();
    expect(screen.getByText(/Save All blocked/)).toBeTruthy();
    expect(screen.getByText(/MCP mutation default blocked/)).toBeTruthy();
  });

  it("reports degraded discovery when the native observation adapter is unavailable", async () => {
    render(
      <UIProvider>
        <EditorPanel />
      </UIProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Discover editor processes" }));

    await waitFor(() => {
      expect(screen.getByText("native_adapter_unavailable")).toBeTruthy();
    });
  });

  it("uses the runtime native adapter for discovery, attach, heartbeat, and snapshot", async () => {
    const nativeInvoke = vi.fn(async <T,>(command: string): Promise<T> => {
      if (command === "editor_observation_capability_status") {
        return {
          enabled: true,
          mode: "native",
          reason: "ue_editor_bridge_feature_enabled",
          trustedRootRequired: true,
          mutationExecution: "blocked",
        } as T;
      }
      if (command === "discover_editor_processes") {
        return {
          status: "ready",
          reason: "native_metadata",
          processes: [
            {
              id: "process:native-1",
              pidHash: "pid:native-1",
              displayName: "UnrealEditor.exe",
              displayExecutableHash: "exe:native",
              displayProjectHint: "[project-root]/Game.uproject",
              processState: "running",
              discoveredAt: 1,
              expiresAt: 9_999_999_999_999,
              source: "native",
            },
          ],
        } as T;
      }
      if (command === "attach_editor_process") {
        return {
          sessionId: "editor-observation:native-1",
          projectId: "project:fixture",
          rootId: "root:fixture",
          uprojectDisplayPath: "[project-root]/Game.uproject",
          pidHash: "pid:native-1",
          mode: "attached",
          status: "attached",
          reason: "attached",
          createdAt: 1,
          expiresAt: 9_999_999_999_999,
          lastHeartbeatAt: null,
          replayOnly: false,
        } as T;
      }
      if (command === "read_editor_process_status") {
        return {
          sessionId: "editor-observation:native-1",
          projectId: "project:fixture",
          rootId: "root:fixture",
          uprojectDisplayPath: "[project-root]/Game.uproject",
          mode: "attached",
          status: "attached",
          reason: "heartbeat_ok",
          createdAt: 1,
          expiresAt: 9_999_999_999_999,
          lastHeartbeatAt: 2,
          replayOnly: false,
        } as T;
      }
      if (command === "read_editor_observation_snapshot") {
        return {
          sessionId: "editor-observation:native-1",
          editorState: "attached",
          sessionState: "active",
          projectMatched: true,
          processAlive: true,
          lastHeartbeatAt: 2,
          displayProject: "[project-root]/Game.uproject",
          displayProcess: "UnrealEditor.exe",
          readOnlyDiagnostics: ["process metadata only", "Save All blocked"],
          createdAt: 3,
        } as T;
      }
      return {
        enabled: false,
        mode: "disabled",
        reason: "native_unavailable",
        trustedRootRequired: true,
        approvalRequired: true,
        mutationExecution: "blocked",
        allowlistSummary: "disabled",
        timeoutMs: 0,
        outputLimitBytes: 0,
        outputLimitLines: 0,
      } as T;
    });
    const runtimeClient = createDesktopRuntimeAdapter({ nativeInvoke: nativeInvoke as NativeInvoke });

    render(
      <UIProvider runtimeClient={runtimeClient}>
        <EditorPanel />
        <RuntimePidHashProbe />
      </UIProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Discover editor processes" }));
    await waitFor(() => {
      expect(screen.getByText(/UnrealEditor.exe \/ running/)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Attach editor observation session" }));
    await waitFor(() => {
      expect(screen.getByText("attached")).toBeTruthy();
      expect(screen.getByLabelText("MVP14 session pid hash").textContent).toBe("pid:native-1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Read editor observation snapshot" }));
    await waitFor(() => {
      expect(screen.getByText(/heartbeat_ok \/ alive true/)).toBeTruthy();
      expect(screen.getByText(/attached \/ \[project-root\]\/Game.uproject/)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Propose state-only editor operation" }));
    await waitFor(() => {
      expect(screen.getByText(/Proposal: select_asset \/ approval_required \/ state_only/)).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve editor operation" }));
    await waitFor(() => {
      expect(screen.getByText(/Proposal: select_asset \/ approved \/ state_only/)).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Execute editor operation" }));
    await waitFor(() => {
      expect(screen.getByText(/Result: executed \/ recorded/)).toBeTruthy();
    });

    expect(nativeInvoke).toHaveBeenCalledWith("discover_editor_processes", expect.anything());
    expect(nativeInvoke).toHaveBeenCalledWith("attach_editor_process", expect.anything());
    expect(nativeInvoke).toHaveBeenCalledWith("read_editor_process_status", expect.anything());
    expect(nativeInvoke).toHaveBeenCalledWith("read_editor_observation_snapshot", expect.anything());
  });

  it("renders native degraded lifecycle reads as not alive instead of heartbeat ok", async () => {
    const nativeInvoke = vi.fn(async <T,>(command: string): Promise<T> => {
      if (command === "editor_observation_capability_status") {
        return {
          enabled: true,
          mode: "native",
          reason: "ue_editor_bridge_feature_enabled",
          trustedRootRequired: true,
          mutationExecution: "blocked",
        } as T;
      }
      if (command === "discover_editor_processes") {
        return {
          status: "ready",
          reason: "fixture_metadata",
          processes: [
            {
              id: "process:fixture-1",
              pidHash: "pid:fixture-1",
              displayName: "UnrealEditor.exe",
              displayExecutableHash: "exe:fixture",
              displayProjectHint: "[project-root]/Game.uproject",
              processState: "running",
              discoveredAt: 1,
              expiresAt: 9_999_999_999_999,
              source: "fixture",
            },
          ],
        } as T;
      }
      if (command === "attach_editor_process") {
        return {
          sessionId: "editor-observation:degraded-1",
          projectId: "project:fixture",
          rootId: "root:fixture",
          uprojectDisplayPath: "[project-root]/Game.uproject",
          mode: "attached",
          status: "attached",
          reason: "attached",
          createdAt: 1,
          expiresAt: 9_999_999_999_999,
          lastHeartbeatAt: null,
          replayOnly: false,
        } as T;
      }
      if (command === "read_editor_process_status") {
        return {
          sessionId: "editor-observation:degraded-1",
          projectId: "project:fixture",
          rootId: "root:fixture",
          uprojectDisplayPath: "[project-root]/Game.uproject",
          mode: "attached",
          status: "degraded",
          reason: "native_process_observation_unavailable",
          createdAt: 1,
          expiresAt: 9_999_999_999_999,
          lastHeartbeatAt: null,
          replayOnly: false,
        } as T;
      }
      if (command === "read_editor_observation_snapshot") {
        return {
          sessionId: "editor-observation:degraded-1",
          editorState: "degraded",
          sessionState: "degraded",
          projectMatched: true,
          processAlive: false,
          lastHeartbeatAt: null,
          displayProject: "[project-root]/Game.uproject",
          displayProcess: "UnrealEditor.exe",
          readOnlyDiagnostics: ["native_process_observation_unavailable", "Save All blocked"],
          createdAt: 3,
        } as T;
      }
      return {} as T;
    });
    const runtimeClient = createDesktopRuntimeAdapter({ nativeInvoke: nativeInvoke as NativeInvoke });

    render(
      <UIProvider runtimeClient={runtimeClient}>
        <EditorPanel />
      </UIProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Discover editor processes" }));
    await waitFor(() => {
      expect(screen.getByText(/UnrealEditor.exe \/ running/)).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Attach editor observation session" }));
    await waitFor(() => {
      expect(screen.getByText("attached")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Read editor observation snapshot" }));

    await waitFor(() => {
      expect(screen.getByText(/native_process_observation_unavailable \/ alive false/)).toBeTruthy();
      expect(screen.getByText(/degraded \/ \[project-root\]\/Game.uproject/)).toBeTruthy();
    });
  });
});
