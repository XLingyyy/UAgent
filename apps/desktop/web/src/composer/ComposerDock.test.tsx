import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { ComposerDock } from "./ComposerDock";
import { UIProvider } from "../app/providers";
import type { ProviderConfig } from "../types/provider";
import { createDesktopRuntimeAdapter } from "../runtime/desktop-runtime-adapter";
import type { NativeInvoke } from "../runtime/project-native-adapter";

function renderDock() {
  return render(
    <UIProvider>
      <ComposerDock />
    </UIProvider>,
  );
}

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

describe("ComposerDock", () => {
  it("renders the composer dock with an input row and status row", () => {
    renderDock();

    const dock = screen.getByLabelText("Composer dock");
    expect(dock).toBeTruthy();

    expect(within(dock).getByLabelText("Open attach menu")).toBeTruthy();
    expect(within(dock).getByLabelText("Permission mode: Request approval")).toBeTruthy();
    expect(within(dock).getByLabelText("Composer input")).toBeTruthy();
    expect(
      within(dock).getByLabelText("Context: 2,400 / 20,000 used (12%, 88% remaining)"),
    ).toBeTruthy();
    expect(
      within(dock).getByLabelText("Model selector: Model not configured, reasoning medium"),
    ).toBeTruthy();
    expect(within(dock).getByLabelText("Send - disabled")).toBeTruthy();
  });

  it("groups controls into left tools, primary input, and right tools", () => {
    const { container } = renderDock();

    const leftTools = container.querySelector(".ua-composer__left-tools") as HTMLElement;
    const inputZone = container.querySelector(".ua-composer__input-zone") as HTMLElement;
    const rightTools = container.querySelector(".ua-composer__right-tools") as HTMLElement;

    expect(leftTools).toBeTruthy();
    expect(inputZone).toBeTruthy();
    expect(rightTools).toBeTruthy();
    expect(within(leftTools).getByLabelText("Open attach menu")).toBeTruthy();
    expect(within(leftTools).getByLabelText("Permission mode: Request approval")).toBeTruthy();
    expect(within(inputZone).getByLabelText("Composer input")).toBeTruthy();
    expect(
      within(rightTools).getByLabelText("Context: 2,400 / 20,000 used (12%, 88% remaining)"),
    ).toBeTruthy();
    expect(
      within(rightTools).getByLabelText("Model selector: Model not configured, reasoning medium"),
    ).toBeTruthy();
    expect(within(rightTools).getByLabelText("Send - disabled")).toBeTruthy();
  });

  it("renders the status row with ProjectSelector, runtime chip, local mode, branch, and mock-only warning", () => {
    renderDock();

    const dock = screen.getByLabelText("Composer dock");

    expect(within(dock).getByLabelText("Project selector: Lyra_Prototype")).toBeTruthy();
    expect(within(dock).getByText("Runtime")).toBeTruthy();
    expect(within(dock).getByText("Mock only")).toBeTruthy();
    expect(within(dock).getByText("Mode")).toBeTruthy();
    expect(within(dock).getByText("Local mode")).toBeTruthy();
    expect(within(dock).getByText("Safety")).toBeTruthy();
    expect(within(dock).getByText("Approval required / fixture ready")).toBeTruthy();
    expect(within(dock).getByText("Branch")).toBeTruthy();
    expect(within(dock).getByText("main")).toBeTruthy();

    expect(within(dock).queryByText("UE")).toBeNull();
    expect(within(dock).queryByText("Not connected")).toBeNull();
    expect(within(dock).getByText("Model")).toBeTruthy();
    expect(within(dock).getByText("Mock runtime / no provider call")).toBeTruthy();
  });

  it("shows a textarea with placeholder and allows local input", () => {
    renderDock();

    const textarea = screen.getByLabelText("Composer input") as HTMLTextAreaElement;
    expect(textarea.placeholder).toBe(
      "Ask UAgent to plan, inspect, or modify the current Unreal project...",
    );

    fireEvent.change(textarea, { target: { value: "test input" } });
    expect(textarea.value).toBe("test input");
    expect(textarea.closest("form")).toBeNull();
  });

  it("keeps Send disabled for empty input", () => {
    renderDock();

    const sendBtn = screen.getByLabelText("Send - disabled") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it("enables Send for non-empty input and clears input after mock runtime submit", async () => {
    renderDock();

    const textarea = screen.getByLabelText("Composer input") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Review Lyra asset loading risks" } });

    const sendBtn = screen.getByRole("button", { name: "Send mock task" }) as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(false);

    fireEvent.click(sendBtn);

    expect(await screen.findByText("Mock runtime / no provider call")).toBeTruthy();
    expect(textarea.value).toBe("");
  });

  it("shows staged attach menu entries through ComingSoonGate", () => {
    renderDock();

    const addBtn = screen.getByLabelText("Open attach menu") as HTMLButtonElement;
    fireEvent.click(addBtn);

    const menu = screen.getByRole("menu", { name: "Attach context" });
    expect(within(menu).getByText("File")).toBeTruthy();
    expect(within(menu).getByText("Asset")).toBeTruthy();
    expect(within(menu).getByText("Screenshot")).toBeTruthy();
    expect(within(menu).getByText("Context Pack")).toBeTruthy();
    for (const item of within(menu).getAllByRole("menuitem")) {
      expect(item.getAttribute("aria-disabled")).toBe("true");
      expect(item.getAttribute("title")).toContain("Coming in MVP7");
    }
  });

  it("renders the ContextRing with correct percentage and tooltip", () => {
    renderDock();

    const ring = screen.getByText("12%").closest(".ua-context-ring")! as HTMLElement;
    expect(ring).toBeTruthy();
    const title = ring.getAttribute("title");
    expect(title).toContain("2,400");
    expect(title).toContain("20,000");
    expect(title).toContain("12%");
    expect(title).toContain("88% remaining");
    expect(within(ring).getByText("12%")).toBeTruthy();
  });

  it("opens the project selector dropdown", () => {
    renderDock();

    const trigger = screen.getByLabelText("Project selector: Lyra_Prototype");
    fireEvent.click(trigger);

    const dropdown = screen.getByRole("listbox", { name: "Select project" });
    expect(dropdown).toBeTruthy();
    expect(dropdown.textContent).toContain("MechArena_Testbed");
    expect(dropdown.textContent).toContain("CitySample_Sandbox");
    expect(dropdown.textContent).toContain("Add new project");
    expect(dropdown.textContent).toContain("No project");
  });

  it("syncs project change to ComposerDock trigger label", () => {
    renderDock();

    const trigger = screen.getByLabelText("Project selector: Lyra_Prototype");
    fireEvent.click(trigger);

    const options = screen.getAllByRole("option");
    const mech = options.find((o) => o.textContent?.includes("MechArena_Testbed"));
    fireEvent.click(mech!);

    expect(screen.getByLabelText("Project selector: MechArena_Testbed")).toBeTruthy();
  });

  it("does not render microphone, voice, or record controls", () => {
    const { container } = renderDock();

    const audioControls = container.querySelectorAll(
      '[aria-label*="mic" i], [aria-label*="voice" i], [aria-label*="record" i]',
    );
    expect(audioControls.length).toBe(0);
  });

  it("has no form element", () => {
    const { container } = renderDock();
    expect(container.querySelector("form")).toBeNull();
  });

  it("opens the ModelSelector dropdown and shows model and reasoning options", () => {
    renderDock();

    const trigger = screen.getByLabelText("Model selector: Model not configured, reasoning medium");
    fireEvent.click(trigger);

    const dropdown = screen.getByRole("listbox", {
      name: "Model and reasoning settings",
    });
    expect(dropdown).toBeTruthy();
    expect(dropdown.textContent).toContain("Reasoning");
    expect(dropdown.textContent).toContain("Models");
    expect(dropdown.textContent).toContain("GPT-5 Mock");
    expect(dropdown.textContent).toContain("Claude Sonnet Mock");
    expect(dropdown.textContent).toContain("Local Qwen Mock");
    expect(dropdown.textContent).toContain("Manage providers");
    expect(dropdown.textContent).toContain("Open provider settings");
  });

  it("syncs model change to ComposerDock ModelSelector trigger label", () => {
    renderDock();

    const trigger = screen.getByLabelText("Model selector: Model not configured, reasoning medium");
    fireEvent.click(trigger);

    const gptOption = screen.getByText("Provider A / GPT-5 Mock").closest('[role="option"]')!;
    fireEvent.click(gptOption);

    expect(screen.getByLabelText("Model selector: GPT-5 Mock, reasoning medium")).toBeTruthy();
  });

  it("reads provider-backed defaults from UI state", () => {
    const customProviders: ProviderConfig[] = [
      {
        providerId: "studio",
        displayName: "Studio",
        baseUrl: "https://mock.studio.local/v1",
        wireApi: "responses",
        authMode: "env_key",
        secretRef: "STUDIO_KEY",
        enabled: true,
        models: [
          {
            id: "studio-gpt-5-1",
            label: "GPT-5.1 Custom",
            contextWindow: 256000,
            supportsReasoning: true,
            reasoningEfforts: ["medium", "high", "xhigh"],
          },
        ],
        defaultModel: "studio-gpt-5-1",
        defaultReasoningEffort: "high",
      },
    ];

    render(
      <UIProvider
        initialState={{
          provider: {
            providers: customProviders,
            selectedProviderId: "studio",
            defaultProviderId: "studio",
          },
        }}
      >
        <ComposerDock />
      </UIProvider>,
    );

    const trigger = screen.getByLabelText("Model selector: GPT-5.1 Custom, reasoning high");
    expect(trigger).toBeTruthy();

    fireEvent.click(trigger);

    const dropdown = screen.getByRole("listbox", {
      name: "Model and reasoning settings",
    });
    expect(within(dropdown).getByText("Studio / GPT-5.1 Custom")).toBeTruthy();
  });

  it("shows Runtime Mock only chip when model is configured", () => {
    const customProviders: ProviderConfig[] = [
      {
        providerId: "studio",
        displayName: "Studio",
        baseUrl: "https://mock.studio.local/v1",
        wireApi: "responses",
        authMode: "env_key",
        secretRef: "STUDIO_KEY",
        enabled: true,
        models: [
          {
            id: "studio-gpt-5-1",
            label: "GPT-5.1 Custom",
            contextWindow: 256000,
            supportsReasoning: true,
            reasoningEfforts: ["medium", "high", "xhigh"],
          },
        ],
        defaultModel: "studio-gpt-5-1",
        defaultReasoningEffort: "high",
      },
    ];

    render(
      <UIProvider
        initialState={{
          provider: {
            providers: customProviders,
            selectedProviderId: "studio",
            defaultProviderId: "studio",
          },
        }}
      >
        <ComposerDock />
      </UIProvider>,
    );

    const dock = screen.getByLabelText("Composer dock");
    expect(within(dock).getByText("Runtime")).toBeTruthy();
    expect(within(dock).getByText("Mock only")).toBeTruthy();
    expect(within(dock).queryByText("Model")).toBeNull();
  });

  it("shows Runtime Mock only chip and Model warning when model is not configured", () => {
    renderDock();

    const dock = screen.getByLabelText("Composer dock");
    expect(within(dock).getByText("Runtime")).toBeTruthy();
    expect(within(dock).getByText("Mock only")).toBeTruthy();
    expect(within(dock).getByText("Model")).toBeTruthy();
    expect(within(dock).getByText("Mock runtime / no provider call")).toBeTruthy();
  });

  it("creates MVP10 native terminal proposals with canonical rootRef while showing only redacted root", async () => {
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
      return {
        proposalId: "native-proposal-composer",
        command: "pnpm test",
        risk: "allowlisted",
        reason: "command classified as allowlisted",
        requiresApproval: true,
        featureFlag: "terminal",
        canonicalCwd: "G:\\UAgent",
        redactedCwd: "[project-root]",
        expiresAt: 1_700_000_300_000,
        timeoutMs: 60_000,
        outputLimitBytes: 1_048_576,
        outputLimitLines: 5_000,
      } as T;
    };
    const runtimeClient = createDesktopRuntimeAdapter({ nativeInvoke });

    render(
      <UIProvider
        runtimeClient={runtimeClient}
        initialState={{ project: { activeProjectId: "lyra", registeredProjects: [nativeProject] } }}
      >
        <ComposerDock />
      </UIProvider>,
    );

    fireEvent.change(screen.getByLabelText("Composer input"), { target: { value: "pnpm test" } });
    fireEvent.click(screen.getByRole("button", { name: "Propose command: pnpm test" }));

    await waitFor(() => {
      expect(calls.map((call) => call.command)).toEqual([
        "terminal_capability_status",
        "browser_capability_status",
        "propose_terminal_command",
      ]);
    });
    const proposeIdx = calls.findIndex((c) => c.command === "propose_terminal_command");
    expect(calls[proposeIdx]).toEqual({
      command: "propose_terminal_command",
      payload: { input: { command: "pnpm test", cwd: "G:\\UAgent", projectId: "lyra" } },
    });
    expect(JSON.stringify(runtimeClient.getMvp9().mvp10.terminal.getState())).not.toContain("G:\\UAgent");
    expect(runtimeClient.getMvp9().mvp10.terminal.getState().activeProposal?.cwd).toBe("[project-root]");
  });
});
