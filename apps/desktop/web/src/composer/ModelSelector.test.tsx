import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ModelSelector } from "./ModelSelector";
import { modelOptions, reasoningOptions } from "./composer-data";

function renderSelector(
  props?: Partial<{
    modelId: Parameters<typeof ModelSelector>[0]["modelId"];
    reasoningEffort: Parameters<typeof ModelSelector>[0]["reasoningEffort"];
    onModelChange: Parameters<typeof ModelSelector>[0]["onModelChange"];
    onReasoningChange: Parameters<typeof ModelSelector>[0]["onReasoningChange"];
  }>,
) {
  const defaultProps = {
    modelId: "not-configured" as const,
    reasoningEffort: "medium" as const,
    models: modelOptions,
    reasoningOptionsList: reasoningOptions,
    onModelChange: vi.fn(),
    onReasoningChange: vi.fn(),
  };
  return {
    ...render(<ModelSelector {...defaultProps} {...props} />),
    props: { ...defaultProps, ...props },
  };
}

describe("ModelSelector", () => {
  it("renders trigger with default Model not configured and reasoning medium", () => {
    renderSelector();

    const trigger = screen.getByLabelText("Model selector: Model not configured, reasoning medium");
    expect(trigger).toBeTruthy();
    expect((trigger as HTMLButtonElement).tagName).toBe("BUTTON");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
  });

  it("shows selected model label and reasoning in trigger", () => {
    renderSelector({ modelId: "openai-gpt-5", reasoningEffort: "high" });

    const trigger = screen.getByLabelText("Model selector: GPT-5 Mock, reasoning high");
    expect(trigger).toBeTruthy();
  });

  it("uses provided option lists for selected trigger labels", () => {
    const customModels = modelOptions.map((option) =>
      option.id === "openai-gpt-5" ? { ...option, label: "Custom GPT Mock" } : option,
    );
    const customReasoning = reasoningOptions.map((option) =>
      option.id === "high" ? { ...option, label: "Deep" } : option,
    );

    render(
      <ModelSelector
        modelId="openai-gpt-5"
        reasoningEffort="high"
        models={customModels}
        reasoningOptionsList={customReasoning}
        onModelChange={vi.fn()}
        onReasoningChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Model selector: Custom GPT Mock, reasoning deep")).toBeTruthy();
  });

  it("opens dropdown on trigger click", () => {
    renderSelector();

    const trigger = screen.getByLabelText("Model selector: Model not configured, reasoning medium");
    fireEvent.click(trigger);

    const dropdown = screen.getByRole("listbox", {
      name: "Model and reasoning settings",
    });
    expect(dropdown).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("renders Reasoning group header", () => {
    renderSelector();

    fireEvent.click(
      screen.getByLabelText("Model selector: Model not configured, reasoning medium"),
    );

    const dropdown = screen.getByRole("listbox", {
      name: "Model and reasoning settings",
    });
    const headerTexts = dropdown.querySelectorAll(".ua-model-selector__group-header");
    const headers = Array.from(headerTexts).map((h) => h.textContent);
    expect(headers).toContain("Reasoning");
  });

  it("renders all four reasoning options", () => {
    renderSelector();

    fireEvent.click(
      screen.getByLabelText("Model selector: Model not configured, reasoning medium"),
    );

    const dropdown = screen.getByRole("listbox", {
      name: "Model and reasoning settings",
    });

    reasoningOptions.forEach((opt) => {
      expect(within(dropdown).getByText(opt.label)).toBeTruthy();
    });
  });

  it("highlights current reasoning with checkmark and aria-selected", () => {
    renderSelector({ reasoningEffort: "medium" });

    fireEvent.click(
      screen.getByLabelText("Model selector: Model not configured, reasoning medium"),
    );

    const options = screen.getAllByRole("option");
    const mediumOption = options.find((o) => o.textContent?.includes("Medium"));
    expect(mediumOption).toBeTruthy();
    expect(mediumOption!.getAttribute("aria-selected")).toBe("true");
    expect(mediumOption!.textContent).toContain("\u2713");
  });

  it("renders Models group header", () => {
    renderSelector();

    fireEvent.click(
      screen.getByLabelText("Model selector: Model not configured, reasoning medium"),
    );

    const dropdown = screen.getByRole("listbox", {
      name: "Model and reasoning settings",
    });
    const headerTexts = dropdown.querySelectorAll(".ua-model-selector__group-header");
    const headers = Array.from(headerTexts).map((h) => h.textContent);
    expect(headers).toContain("Models");
  });

  it("renders all model options with provider prefixes", () => {
    renderSelector();

    fireEvent.click(
      screen.getByLabelText("Model selector: Model not configured, reasoning medium"),
    );

    const dropdown = screen.getByRole("listbox", {
      name: "Model and reasoning settings",
    });

    expect(within(dropdown).getByText("Model not configured")).toBeTruthy();
    expect(within(dropdown).getByText("Provider A / GPT-5 Mock")).toBeTruthy();
    expect(within(dropdown).getByText("Provider A / Claude Sonnet Mock")).toBeTruthy();
    expect(within(dropdown).getByText("Provider B / Local Qwen Mock")).toBeTruthy();
  });

  it("highlights current model with checkmark and aria-selected", () => {
    renderSelector({ modelId: "not-configured" });

    fireEvent.click(
      screen.getByLabelText("Model selector: Model not configured, reasoning medium"),
    );

    const options = screen.getAllByRole("option");
    const notConfigured = options.find((o) => o.textContent?.includes("Model not configured"));
    expect(notConfigured).toBeTruthy();
    expect(notConfigured!.getAttribute("aria-selected")).toBe("true");
    expect(notConfigured!.textContent).toContain("\u2713");
  });

  it("updates trigger label after selecting a mock model", () => {
    const onModelChange = vi.fn();
    renderSelector({ onModelChange });

    fireEvent.click(
      screen.getByLabelText("Model selector: Model not configured, reasoning medium"),
    );

    const gptOption = screen.getByText("Provider A / GPT-5 Mock").closest('[role="option"]')!;
    fireEvent.click(gptOption);

    expect(onModelChange).toHaveBeenCalledWith("openai-gpt-5");
  });

  it("updates reasoning after selecting a reasoning option", () => {
    const onReasoningChange = vi.fn();
    renderSelector({ onReasoningChange });

    fireEvent.click(
      screen.getByLabelText("Model selector: Model not configured, reasoning medium"),
    );

    const highOption = screen.getByText("High").closest('[role="option"]')!;
    fireEvent.click(highOption);

    expect(onReasoningChange).toHaveBeenCalledWith("high");
  });

  it("renders Manage providers entry disabled", () => {
    renderSelector();

    fireEvent.click(
      screen.getByLabelText("Model selector: Model not configured, reasoning medium"),
    );

    const manageEntry = screen.getByText("Manage providers").closest('[role="option"]')!;
    expect(manageEntry.getAttribute("aria-disabled")).toBe("true");
    expect(manageEntry.textContent).toContain("Provider settings coming later");
    expect(manageEntry.classList.contains("ua-model-selector__item--disabled")).toBe(true);
  });

  it("closes dropdown on Escape key", () => {
    renderSelector();

    const trigger = screen.getByLabelText("Model selector: Model not configured, reasoning medium");
    fireEvent.click(trigger);

    const dropdown = screen.getByRole("listbox", {
      name: "Model and reasoning settings",
    });
    expect(dropdown).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("listbox", { name: "Model and reasoning settings" })).toBeNull();
  });

  it("closes dropdown on second trigger click", () => {
    renderSelector();

    const trigger = screen.getByLabelText("Model selector: Model not configured, reasoning medium");
    fireEvent.click(trigger);

    const dropdown2 = screen.getByRole("listbox", {
      name: "Model and reasoning settings",
    });
    expect(dropdown2).toBeTruthy();

    fireEvent.click(trigger);

    expect(screen.queryByRole("listbox", { name: "Model and reasoning settings" })).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes dropdown after model selection", () => {
    const onModelChange = vi.fn();
    renderSelector({ onModelChange });

    fireEvent.click(
      screen.getByLabelText("Model selector: Model not configured, reasoning medium"),
    );

    const gptOption = screen.getByText("Provider A / GPT-5 Mock").closest('[role="option"]')!;
    fireEvent.click(gptOption);

    expect(screen.queryByRole("listbox", { name: "Model and reasoning settings" })).toBeNull();
  });

  it("closes dropdown after reasoning selection", () => {
    const onReasoningChange = vi.fn();
    renderSelector({ onReasoningChange });

    fireEvent.click(
      screen.getByLabelText("Model selector: Model not configured, reasoning medium"),
    );

    const highOption = screen.getByText("High").closest('[role="option"]')!;
    fireEvent.click(highOption);

    expect(screen.queryByRole("listbox", { name: "Model and reasoning settings" })).toBeNull();
  });

  it("does not render microphone, voice, or record controls", () => {
    const { container } = renderSelector();

    const audioControls = container.querySelectorAll(
      '[aria-label*="mic" i], [aria-label*="voice" i], [aria-label*="record" i]',
    );
    expect(audioControls.length).toBe(0);
  });

  it("shows context window info in model option descriptions", () => {
    renderSelector();

    fireEvent.click(
      screen.getByLabelText("Model selector: Model not configured, reasoning medium"),
    );

    const dropdown = screen.getByRole("listbox", {
      name: "Model and reasoning settings",
    });

    const context200k = within(dropdown).getAllByText("Context window: 200k tokens");
    expect(context200k.length).toBe(2);
    expect(within(dropdown).getByText("Context window: 64k tokens")).toBeTruthy();
    expect(within(dropdown).getByText("No model selected")).toBeTruthy();
  });

  it("default state shows Model not configured trigger", () => {
    const { container } = renderSelector();
    expect(container.textContent).toContain("Model not configured");
    expect(container.textContent).toContain("Medium");
  });
});
