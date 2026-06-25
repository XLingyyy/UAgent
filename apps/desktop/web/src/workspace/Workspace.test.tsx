import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Workspace } from "./Workspace";
import { UIProvider } from "../app/providers";

function renderWorkspace() {
  return render(
    <UIProvider>
      <Workspace />
    </UIProvider>,
  );
}

describe("Workspace", () => {
  it("renders a compact WelcomeHero for the current Unreal project context", () => {
    renderWorkspace();

    expect(screen.getByRole("heading", { name: "Lyra_Prototype workspace" })).toBeTruthy();
    expect(screen.getByText("Plan / Build / Review mock workflows")).toBeTruthy();
    expect(screen.getByText("Local UI preview")).toBeTruthy();
    expect(screen.getByText("UE not connected")).toBeTruthy();
  });

  it("renders a status strip with project, mode, runtime, and UE state", () => {
    renderWorkspace();

    const strip = screen.getByLabelText("Workspace status");
    expect(within(strip).getByText("Project")).toBeTruthy();
    expect(within(strip).getByText("Lyra_Prototype")).toBeTruthy();
    expect(within(strip).getByText("Mode")).toBeTruthy();
    expect(within(strip).getByText("Plan")).toBeTruthy();
    expect(within(strip).getByText("Runtime")).toBeTruthy();
    expect(within(strip).getByText("Mock")).toBeTruthy();
    expect(within(strip).getByText("UE")).toBeTruthy();
    expect(within(strip).getByText("Not connected")).toBeTruthy();
  });

  it("renders at least three mock conversation and activity messages", () => {
    renderWorkspace();

    const viewport = screen.getByLabelText("Conversation activity");
    const messages = within(viewport).getAllByRole("article");
    expect(messages.length).toBeGreaterThanOrEqual(3);
    expect(within(viewport).getByText("User request")).toBeTruthy();
    expect(within(viewport).getByText("Agent plan")).toBeTruthy();
    expect(within(viewport).getByText("Tool event")).toBeTruthy();
    expect(within(viewport).getByText("Review summary")).toBeTruthy();
  });

  it("renders the standalone ComposerDock input and status rows", () => {
    renderWorkspace();

    const dock = screen.getByLabelText("Composer dock");
    expect(within(dock).getByLabelText("Composer input")).toBeTruthy();
    expect(within(dock).getByLabelText("Permission mode: Request approval")).toBeTruthy();
    expect(
      within(dock).getByLabelText("Context: 2,400 / 20,000 used (12%, 88% remaining)"),
    ).toBeTruthy();
    expect(within(dock).getByLabelText("Project selector: Lyra_Prototype")).toBeTruthy();

    const disabledSend = within(dock).getByRole("button", { name: "Send - disabled" });
    expect(disabledSend).toBeTruthy();
    expect((disabledSend as HTMLButtonElement).disabled).toBe(true);
    expect(dock.querySelector("form")).toBeNull();
  });

  it("does not render microphone, voice, or record controls", () => {
    const { container } = renderWorkspace();

    const audioControls = container.querySelectorAll(
      '[aria-label*="mic" i], [aria-label*="voice" i], [aria-label*="record" i]',
    );
    expect(audioControls.length).toBe(0);
  });
});
