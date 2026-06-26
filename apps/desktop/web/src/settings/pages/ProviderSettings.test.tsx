import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { UIProvider } from "../../app/providers";
import { SettingsShell } from "../SettingsShell";
import { useComposerStore, useProviderStore } from "../../stores/ui-store";

function ComposerStateProbe() {
  const selectedModelId = useComposerStore((state) => state.selectedModelId);
  const reasoningEffort = useComposerStore((state) => state.reasoningEffort);

  return (
    <div>
      <span data-testid="composer-model">{selectedModelId}</span>
      <span data-testid="composer-reasoning">{reasoningEffort}</span>
    </div>
  );
}

function ProviderIsDefaultProbe() {
  const providers = useProviderStore((state) => state.providers);
  const infected = providers.filter((p) => Object.prototype.hasOwnProperty.call(p, "isDefault"));
  return <div data-testid="provider-isdefault-probe" data-infected={infected.length} />;
}

function renderProviderSettings() {
  return render(
    <UIProvider
      initialState={{
        settings: {
          open: true,
          activePageId: "provider",
        },
      }}
    >
      <SettingsShell />
      <ComposerStateProbe />
      <ProviderIsDefaultProbe />
    </UIProvider>,
  );
}

describe("ProviderSettings", () => {
  it("renders four clear local-only provider information sections", () => {
    renderProviderSettings();

    expect(screen.getByRole("heading", { name: "Available providers" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Selected provider detail" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Model defaults" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Local-only actions" })).toBeTruthy();
    expect(screen.getByText("Local only")).toBeTruthy();
    expect(screen.getByText("No network")).toBeTruthy();
    expect(screen.getByText("No secret storage")).toBeTruthy();
  });

  it("renders the seeded provider list and local-only detail form controls", () => {
    renderProviderSettings();

    expect(screen.getByText("Provider A")).toBeTruthy();
    expect(screen.getByText("Provider B")).toBeTruthy();
    expect(screen.getByLabelText("Display name")).toBeTruthy();
    expect(screen.getByLabelText("Base URL")).toBeTruthy();
    expect(screen.getByLabelText("Wire API")).toBeTruthy();
    expect(screen.getByLabelText("Environment key")).toBeTruthy();
    expect(screen.getByLabelText("Default model")).toBeTruthy();
    expect(screen.getByLabelText("Reasoning effort")).toBeTruthy();
  });

  it("edits the selected provider and saves mock defaults", () => {
    renderProviderSettings();

    fireEvent.click(screen.getByText("Edit provider"));
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Studio Mock" },
    });
    fireEvent.click(screen.getByLabelText("Use as default provider"));
    fireEvent.change(screen.getByLabelText("Default model"), {
      target: { value: "anthropic-claude-sonnet" },
    });
    fireEvent.change(screen.getByLabelText("Reasoning effort"), {
      target: { value: "high" },
    });
    fireEvent.click(screen.getByText("Save provider"));

    expect(screen.getAllByText("Studio Mock").length).toBeGreaterThan(0);
    expect(screen.getByText("Default")).toBeTruthy();
    expect((screen.getByLabelText("Display name") as HTMLInputElement).value).toBe("Studio Mock");
    expect(screen.getByTestId("composer-model").textContent).toBe("anthropic-claude-sonnet");
    expect(screen.getByTestId("composer-reasoning").textContent).toBe("high");
  });

  it("adds and deletes a local provider config", () => {
    renderProviderSettings();

    fireEvent.click(screen.getByText("Add provider"));
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Local Lab" },
    });
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "http://127.0.0.1:11434/v1" },
    });
    fireEvent.change(screen.getByLabelText("Environment key"), {
      target: { value: "LOCAL_LAB_KEY" },
    });
    fireEvent.click(screen.getByText("Save provider"));

    expect(screen.getByText("Local Lab")).toBeTruthy();

    fireEvent.click(screen.getByText("Delete provider"));
    expect(screen.queryByText("Local Lab")).toBeNull();
  });

  it("keeps inline key storage unavailable and test connection disabled", () => {
    renderProviderSettings();

    expect(screen.queryByLabelText("API key", { exact: false })).toBeNull();
    expect(screen.queryByPlaceholderText(/api key/i)).toBeNull();
    expect(screen.getByText("Local-only mock. No network request is sent.")).toBeTruthy();
    expect(screen.getByText("Environment key stores a variable name only.")).toBeTruthy();

    const testButton = screen.getByText("Test connection") as HTMLButtonElement;
    expect(testButton.disabled).toBe(true);
    expect(testButton.getAttribute("aria-disabled")).toBe("true");
  });

  it("does not leak isDefault into provider store config on save", () => {
    renderProviderSettings();

    fireEvent.click(screen.getByText("Edit provider"));
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Clean Provider" },
    });
    fireEvent.click(screen.getByLabelText("Use as default provider"));
    fireEvent.click(screen.getByText("Save provider"));

    const probe = screen.getByTestId("provider-isdefault-probe");
    expect(probe.getAttribute("data-infected")).toBe("0");
    expect(screen.getByText("Default")).toBeTruthy();
  });
});
