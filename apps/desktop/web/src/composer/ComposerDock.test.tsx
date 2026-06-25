import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ComposerDock } from "./ComposerDock";
import { UIProvider } from "../app/providers";
import type { ProviderConfig } from "../types/provider";

function renderDock() {
  return render(
    <UIProvider>
      <ComposerDock />
    </UIProvider>,
  );
}

describe("ComposerDock", () => {
  it("renders the composer dock with an input row and status row", () => {
    renderDock();

    const dock = screen.getByLabelText("Composer dock");
    expect(dock).toBeTruthy();

    expect(within(dock).getByLabelText("Add context - disabled")).toBeTruthy();
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

  it("renders the status row with ProjectSelector, mode, branch, and status items", () => {
    renderDock();

    const dock = screen.getByLabelText("Composer dock");

    expect(within(dock).getByLabelText("Project selector: Lyra_Prototype")).toBeTruthy();
    expect(within(dock).getByText("Mode")).toBeTruthy();
    expect(within(dock).getByText("Local mode")).toBeTruthy();
    expect(within(dock).getByText("Branch")).toBeTruthy();
    expect(within(dock).getByText("main")).toBeTruthy();

    expect(within(dock).getByText("UE")).toBeTruthy();
    expect(within(dock).getByText("Not connected")).toBeTruthy();
    expect(within(dock).getByText("Runtime")).toBeTruthy();
    expect(within(dock).getByText("Mock")).toBeTruthy();
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

  it("has a disabled send button that submits nothing", () => {
    renderDock();

    const sendBtn = screen.getByLabelText("Send - disabled") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it("has a disabled add button", () => {
    renderDock();

    const addBtn = screen.getByLabelText("Add context - disabled") as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
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
        envKey: "STUDIO_KEY",
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
});
