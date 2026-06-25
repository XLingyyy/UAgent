import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { SettingsShell } from "./SettingsShell";
import { UIProvider } from "../app/providers";

function renderSettingsShell(initialPage?: string) {
  return render(
    <UIProvider
      initialState={{
        settings: {
          open: true,
          activePageId: (initialPage as never) ?? "general",
        },
      }}
    >
      <SettingsShell />
    </UIProvider>,
  );
}

describe("SettingsShell", () => {
  it("renders settings shell root with aria-label", () => {
    const { container } = renderSettingsShell();
    const shell = container.querySelector(".ua-settings-shell");
    expect(shell).toBeTruthy();
    expect(shell?.getAttribute("aria-label")).toBe("Settings");
    expect(shell?.getAttribute("data-settings-state")).toBe("open");
  });

  it("renders the settings sidebar", () => {
    const { container } = renderSettingsShell();
    const sidebar = container.querySelector(".ua-settings-sidebar");
    expect(sidebar).toBeTruthy();
  });

  it("renders the Back to app button", () => {
    renderSettingsShell();
    expect(screen.getByLabelText("Back to app")).toBeTruthy();
  });

  it("renders the search input (disabled)", () => {
    renderSettingsShell();
    const search = screen.getByLabelText("Search settings") as HTMLInputElement;
    expect(search).toBeTruthy();
    expect(search.disabled).toBe(true);
  });

  it("renders six MVP0 enabled settings entries", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    expect(within(sidebar).getByText("General")).toBeTruthy();
    expect(within(sidebar).getByText("Appearance")).toBeTruthy();
    expect(within(sidebar).getByText("Config")).toBeTruthy();
    expect(within(sidebar).getByText("Personalization")).toBeTruthy();
    expect(within(sidebar).getByText("Archived chats")).toBeTruthy();
    expect(within(sidebar).getByText("Provider")).toBeTruthy();
  });

  it("renders disabled future entries", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    expect(within(sidebar).getByText("MCP servers")).toBeTruthy();
    expect(within(sidebar).getByText("Browser")).toBeTruthy();
    expect(within(sidebar).getByText("Computer control")).toBeTruthy();
    expect(within(sidebar).getByText("Git")).toBeTruthy();
    expect(within(sidebar).getByText("Worktrees")).toBeTruthy();
  });

  it("defaults active page to General", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    const generalBtn = within(sidebar).getByText("General").closest("button");
    expect(generalBtn?.classList.contains("ua-settings-sidebar__item--active")).toBe(true);
  });

  it("shows General content by default", () => {
    renderSettingsShell();
    const content = document.querySelector(".ua-settings-content");
    expect(content).toBeTruthy();
    const matches = screen.getAllByText(
      "General settings will allow you to configure work mode defaults",
      { exact: false },
    );
    expect(matches.length).toBeGreaterThan(0);
  });

  it("switches to Appearance page on click", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    fireEvent.click(within(sidebar).getByText("Appearance"));
    const appearanceBtn = within(sidebar).getByText("Appearance").closest("button");
    expect(appearanceBtn?.classList.contains("ua-settings-sidebar__item--active")).toBe(true);
    const matches = screen.getAllByText("Appearance settings will allow you to select a theme", {
      exact: false,
    });
    expect(matches.length).toBeGreaterThan(0);
  });

  it("switches to Config page on click", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    fireEvent.click(within(sidebar).getByText("Config"));
    const matches = screen.getAllByText(
      "Config settings will allow you to manage approval policies",
      { exact: false },
    );
    expect(matches.length).toBeGreaterThan(0);
  });

  it("switches to Personalization page on click", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    fireEvent.click(within(sidebar).getByText("Personalization"));
    const matches = screen.getAllByText(
      "Personalization settings will allow you to define a default agent style",
      { exact: false },
    );
    expect(matches.length).toBeGreaterThan(0);
  });

  it("switches to Archived chats page on click", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    fireEvent.click(within(sidebar).getByText("Archived chats"));
    const matches = screen.getAllByText("Archived chats will allow you to browse and search", {
      exact: false,
    });
    expect(matches.length).toBeGreaterThan(0);
  });

  it("switches to Provider page on click", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    fireEvent.click(within(sidebar).getByText("Provider"));
    const matches = screen.getAllByText(
      "Provider configuration form will be implemented in UI-014",
      { exact: false },
    );
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("disables MCP servers entry and does not switch page", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    const mcpBtn = within(sidebar).getByText("MCP servers").closest("button") as HTMLButtonElement;
    expect(mcpBtn.disabled).toBe(true);
    expect(mcpBtn.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(mcpBtn);
    const generalBtn = within(sidebar).getByText("General").closest("button");
    expect(generalBtn?.classList.contains("ua-settings-sidebar__item--active")).toBe(true);
  });

  it("shows disabled reason for disabled entries", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    expect(within(sidebar).getByText("Coming in MVP1")).toBeTruthy();
    const mvp3Reasons = within(sidebar).getAllByText("Coming in MVP3");
    expect(mvp3Reasons.length).toBe(2);
    const mvp2Reasons = within(sidebar).getAllByText("Coming in MVP2");
    expect(mvp2Reasons.length).toBe(2);
  });

  it("shows phase badges on enabled entries", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    const mvp0Badges = within(sidebar).getAllByText("MVP0");
    expect(mvp0Badges.length).toBe(6);
  });

  it("shows UI-only mock note on each placeholder content", () => {
    renderSettingsShell();
    const notes = screen.getAllByText("This is a UI-only mock.", { exact: false });
    expect(notes.length).toBeGreaterThan(0);
  });

  it("does not render a real Provider API key input", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    fireEvent.click(within(sidebar).getByText("Provider"));
    expect(screen.queryByLabelText("API key", { exact: false })).toBeNull();
    expect(screen.queryByText("API key input", { exact: false })).toBeNull();
    expect(screen.queryByText("connection testing", { exact: false })).toBeNull();
    expect(screen.queryByText(/^Save$/)).toBeNull();
    expect(screen.queryByText("Test connection")).toBeNull();
  });

  it("does not render microphone, voice, or record controls", () => {
    const { container } = renderSettingsShell();
    const micElements = container.querySelectorAll(
      '[aria-label*="mic" i], [aria-label*="voice" i], [aria-label*="record" i]',
    );
    expect(micElements.length).toBe(0);
  });
});
