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

  it("shows General page with sections by default", () => {
    renderSettingsShell();
    const content = document.querySelector(".ua-settings-content");
    expect(content).toBeTruthy();
    expect(content?.getAttribute("data-settings-page")).toBe("general");
    expect(screen.getByText("Work mode")).toBeTruthy();
    expect(screen.getByText("Permission defaults")).toBeTruthy();
    const languageHeadings = screen.getAllByText("Language");
    expect(languageHeadings.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Bottom panel")).toBeTruthy();
  });

  it("switches to Appearance page on click and shows sections", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    fireEvent.click(within(sidebar).getByText("Appearance"));
    const content = document.querySelector(".ua-settings-content");
    expect(content?.getAttribute("data-settings-page")).toBe("appearance");
    expect(screen.getByText("Theme")).toBeTruthy();
    expect(screen.getByText("Accent")).toBeTruthy();
    expect(screen.getByText("Typography")).toBeTruthy();
    expect(screen.getByText("Display")).toBeTruthy();
  });

  it("switches to Config page on click and shows sections", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    fireEvent.click(within(sidebar).getByText("Config"));
    const content = document.querySelector(".ua-settings-content");
    expect(content?.getAttribute("data-settings-page")).toBe("config");
    expect(screen.getByText("Approval policy")).toBeTruthy();
    expect(screen.getByText("Sandbox permissions")).toBeTruthy();
  });

  it("switches to Personalization page on click and shows sections", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    fireEvent.click(within(sidebar).getByText("Personalization"));
    const content = document.querySelector(".ua-settings-content");
    expect(content?.getAttribute("data-settings-page")).toBe("personalization");
    expect(screen.getByText("Agent style")).toBeTruthy();
    expect(screen.getByText("Custom instructions")).toBeTruthy();
    expect(screen.getByText("Memory")).toBeTruthy();
  });

  it("switches to Archived chats page on click and shows sections", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    fireEvent.click(within(sidebar).getByText("Archived chats"));
    const content = document.querySelector(".ua-settings-content");
    expect(content?.getAttribute("data-settings-page")).toBe("archived-chats");
    expect(screen.getByText("Search and filters")).toBeTruthy();
    expect(screen.getByText("Archived conversations")).toBeTruthy();
    expect(screen.getByText("Actions")).toBeTruthy();
  });

  it("switches to Provider page on click and shows sections", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    fireEvent.click(within(sidebar).getByText("Provider"));
    const content = document.querySelector(".ua-settings-content");
    expect(content?.getAttribute("data-settings-page")).toBe("provider");
    expect(screen.getByText("Connected providers")).toBeTruthy();
    expect(screen.getByText("Provider detail")).toBeTruthy();
    expect(screen.getByText("Provider actions")).toBeTruthy();
  });

  it("disables MCP servers entry and does not switch page", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    const mcpBtn = within(sidebar).getByText("MCP servers").closest("button") as HTMLButtonElement;
    expect(mcpBtn.getAttribute("aria-disabled")).toBe("true");
    expect(mcpBtn.getAttribute("title")).toBe(
      "Coming in MVP1: Manage MCP server configurations and connections.",
    );
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

  it("shows UI-only mock note on each settings page", () => {
    renderSettingsShell();
    expect(
      screen.getByText("This is a UI-only mock. No configuration is saved or applied."),
    ).toBeTruthy();
    const sidebar = screen.getByLabelText("Settings navigation");
    fireEvent.click(within(sidebar).getByText("Archived chats"));
    expect(screen.getByText("This is a UI-only mock. No real chat data is accessed.")).toBeTruthy();
    fireEvent.click(within(sidebar).getByText("Provider"));
    expect(
      screen.getByText(/Provider values live in memory only. No provider connection is tested./, {
        exact: false,
      }),
    ).toBeTruthy();
  });

  it("does not render a real Provider API key input", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    fireEvent.click(within(sidebar).getByText("Provider"));
    expect(screen.queryByLabelText("API key", { exact: false })).toBeNull();
    expect(screen.queryByPlaceholderText(/api key/i)).toBeNull();
    expect(screen.queryByText("apiKey", { exact: false })).toBeNull();
  });

  it("does not render microphone, voice, or record controls", () => {
    const { container } = renderSettingsShell();
    const micElements = container.querySelectorAll(
      '[aria-label*="mic" i], [aria-label*="voice" i], [aria-label*="record" i]',
    );
    expect(micElements.length).toBe(0);
  });

  it("shows Config reset workspace as disabled", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    fireEvent.click(within(sidebar).getByText("Config"));
    const resetBtn = screen.getByText("Reset all workspace data") as HTMLButtonElement;
    expect(resetBtn).toBeTruthy();
    expect(resetBtn.disabled).toBe(true);
    expect(resetBtn.getAttribute("aria-disabled")).toBe("true");
  });

  it("shows Archived chats delete all as disabled", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    fireEvent.click(within(sidebar).getByText("Archived chats"));
    const deleteBtns = screen.getAllByText("Delete all archived chats");
    const deleteBtn = deleteBtns.find((el) => el.tagName === "BUTTON") as HTMLButtonElement;
    expect(deleteBtn).toBeTruthy();
    expect(deleteBtn.disabled).toBe(true);
    expect(deleteBtn.getAttribute("aria-disabled")).toBe("true");
  });

  it("shows Personalization memory rows as disabled with future phase labels", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    fireEvent.click(within(sidebar).getByText("Personalization"));
    const memoryRows = screen.getAllByText("Coming in MVP4");
    expect(memoryRows.length).toBe(2);
  });

  it("shows Provider add/edit/delete actions and a disabled test connection placeholder", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    fireEvent.click(within(sidebar).getByText("Provider"));
    const allButtons = screen.getAllByRole("button");
    const addBtn = allButtons.find((b) => b.textContent === "Add provider") as HTMLButtonElement;
    expect(addBtn).toBeTruthy();
    expect(addBtn.disabled).toBe(false);
    const editBtn = allButtons.find((b) => b.textContent === "Edit provider") as HTMLButtonElement;
    expect(editBtn).toBeTruthy();
    expect(editBtn.disabled).toBe(false);
    const deleteBtn = allButtons.find(
      (b) => b.textContent === "Delete provider",
    ) as HTMLButtonElement;
    expect(deleteBtn).toBeTruthy();
    expect(deleteBtn.disabled).toBe(false);
    const testBtn = allButtons.find(
      (b) => b.textContent === "Test connection",
    ) as HTMLButtonElement;
    expect(testBtn).toBeTruthy();
    expect(testBtn.disabled).toBe(true);
  });

  it("shows Archived chats mock entries", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    fireEvent.click(within(sidebar).getByText("Archived chats"));
    expect(screen.getByText("Fix Material Compilation Errors")).toBeTruthy();
    expect(screen.getByText("3 archived conversations")).toBeTruthy();
  });

  it("does not switch to disabled future pages on click", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    fireEvent.click(within(sidebar).getByText("Git"));
    const content = document.querySelector(".ua-settings-content");
    expect(content?.getAttribute("data-settings-page")).toBe("general");
  });
});
