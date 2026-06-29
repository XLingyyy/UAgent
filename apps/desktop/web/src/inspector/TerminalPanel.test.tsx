import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UIProvider } from "../app/providers";
import { TerminalPanel } from "./TerminalPanel";
import { createDesktopRuntimeAdapter } from "../runtime/desktop-runtime-adapter";
import type { NativeInvoke } from "../runtime/project-native-adapter";

function renderWithUI(component: React.ReactElement) {
  return render(<UIProvider>{component}</UIProvider>);
}

describe("TerminalPanel", () => {
  it("renders disabled state with feature gate off", () => {
    renderWithUI(<TerminalPanel />);
    expect(screen.getByText("Real terminal execution is disabled.")).toBeTruthy();
    expect(screen.getByText(/Enable in Settings/)).toBeTruthy();
    expect(screen.getByText(/Only allowlisted commands/)).toBeTruthy();
    expect(screen.getByText("MVP10")).toBeTruthy();
  });

  it("shows native proposal details and executes through approval token flow when native terminal is enabled", async () => {
    const calls: Array<{ command: string; payload: unknown }> = [];
    const nativeInvoke: NativeInvoke = async <T,>(command: string, payload: unknown): Promise<T> => {
      calls.push({ command, payload });
      if (command === "terminal_capability_status") {
        return {
          enabled: true,
          mode: "native",
          reason: null,
          allowlistSummary: "typecheck, lint, test, desktop web build, cargo test, git status/diff",
          trustedRootRequired: true,
          approvalRequired: true,
          timeoutMs: 60_000,
          outputLimitBytes: 1_048_576,
          outputLimitLines: 5_000,
        } as T;
      }
      if (command === "propose_terminal_command") {
        return {
          proposalId: "native-panel-proposal",
          command: "pnpm test",
          risk: "allowlisted",
          reason: "command classified as allowlisted",
          requiresApproval: true,
          featureFlag: "terminal",
          canonicalCwd: "G:\\UAgent",
          redactedCwd: "[project-root]",
          expiresAt: Date.now() + 300_000,
          timeoutMs: 60_000,
          outputLimitBytes: 1_048_576,
          outputLimitLines: 5_000,
        } as T;
      }
      if (command === "approve_terminal_proposal") {
        return { token: "raw-panel-token:native-panel-proposal", status: "approved" } as T;
      }
      if (command === "execute_terminal_command_real") {
        return {
          status: "completed",
          chunks: [{ index: 0, stream: "stdout", text: "panel ok\n", truncated: false, timestamp: Date.now() }],
          exitCode: 0,
          durationMs: 42,
          outputSummary: "panel ok\n",
          outputTruncated: false,
          totalBytes: 9,
          totalLines: 1,
          redactionSummary: { replacedSecrets: 0, replacedPaths: 1 },
        } as T;
      }
      throw new Error(`unexpected native command ${command}`);
    };
    const runtimeClient = createDesktopRuntimeAdapter({ nativeInvoke });
    const nativeProject = {
      id: "lyra",
      name: "Lyra_Prototype",
      rootRef: "G:\\UAgent",
      displayRoot: "[project-root]",
      trustState: "trusted" as const,
      indexStatus: "ready" as const,
      engine: { label: "UE 5.8", association: "5.8", source: "uproject" as const },
      createdAt: 1,
      updatedAt: 1,
    };

    render(
      <UIProvider
        runtimeClient={runtimeClient}
        initialState={{ project: { activeProjectId: "lyra", registeredProjects: [nativeProject] } }}
      >
        <TerminalPanel />
      </UIProvider>,
    );

    expect(await screen.findByRole("button", { name: "Quick action: pnpm test" })).toBeTruthy();
    expect(screen.queryByText("Real terminal execution is disabled.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Quick action: pnpm test" }));

    expect(await screen.findByText("native-panel-proposal")).toBeTruthy();
    expect(screen.getByText("[project-root]")).toBeTruthy();
    expect(screen.queryByText("raw-panel-token:native-panel-proposal")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Approve and execute command" }));

    await waitFor(() => {
      expect(screen.getByText("Completed")).toBeTruthy();
    });
    expect(screen.getByText("panel ok")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
    expect(calls.map((call) => call.command)).toEqual([
      "terminal_capability_status",
      "browser_capability_status",
      "propose_terminal_command",
      "approve_terminal_proposal",
      "execute_terminal_command_real",
    ]);
    expect(JSON.stringify(runtimeClient.getMvp9().mvp10.terminal.getState())).not.toContain("raw-panel-token");
    expect(JSON.stringify(runtimeClient.getMvp9().mvp10.terminal.getState())).not.toContain("G:\\UAgent");
  });
});
