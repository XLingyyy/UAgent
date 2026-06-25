import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ComposerDock } from "./ComposerDock";

describe("ComposerDock", () => {
  it("renders the composer dock with an input row and status row", () => {
    render(<ComposerDock />);

    const dock = screen.getByLabelText("Composer dock");
    expect(dock).toBeTruthy();

    expect(within(dock).getByLabelText("Add context - disabled")).toBeTruthy();
    expect(within(dock).getByLabelText("Permission mode: Request approval")).toBeTruthy();
    expect(within(dock).getByLabelText("Composer input")).toBeTruthy();
    expect(within(dock).getByLabelText("context: 12% used")).toBeTruthy();
    expect(within(dock).getByLabelText("Model: Model not configured")).toBeTruthy();
    expect(within(dock).getByLabelText("Send - disabled")).toBeTruthy();
  });

  it("renders the status row with project, mode, branch, and status items", () => {
    render(<ComposerDock />);

    const dock = screen.getByLabelText("Composer dock");

    expect(within(dock).getByText("Project")).toBeTruthy();
    expect(within(dock).getByText("Lyra_Prototype")).toBeTruthy();
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
    render(<ComposerDock />);

    const textarea = screen.getByLabelText("Composer input") as HTMLTextAreaElement;
    expect(textarea.placeholder).toBe(
      "Ask UAgent to plan, inspect, or modify the current Unreal project...",
    );

    fireEvent.change(textarea, { target: { value: "test input" } });
    expect(textarea.value).toBe("test input");
    expect(textarea.closest("form")).toBeNull();
  });

  it("has a disabled send button that submits nothing", () => {
    render(<ComposerDock />);

    const sendBtn = screen.getByLabelText("Send - disabled") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it("has a disabled add button", () => {
    render(<ComposerDock />);

    const addBtn = screen.getByLabelText("Add context - disabled") as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
  });

  it("renders the context ring with correct percentage", () => {
    render(<ComposerDock />);

    const ring = screen.getByLabelText("context: 12% used");
    expect(ring).toBeTruthy();
    expect(ring.getAttribute("title")).toBe("Context: 12% used");
    expect(within(ring).getByText("12%")).toBeTruthy();
  });

  it("does not render microphone, voice, or record controls", () => {
    const { container } = render(<ComposerDock />);

    const audioControls = container.querySelectorAll(
      '[aria-label*="mic" i], [aria-label*="voice" i], [aria-label*="record" i]',
    );
    expect(audioControls.length).toBe(0);
  });

  it("has no form element", () => {
    const { container } = render(<ComposerDock />);
    expect(container.querySelector("form")).toBeNull();
  });
});
