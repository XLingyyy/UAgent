import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { SettingsShell } from "./SettingsShell";
import { UIProvider } from "../app/providers";
import { useLayoutStore } from "../stores/ui-store";

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

function ThemeStateProbe() {
  const theme = useLayoutStore((state) => state.theme);
  return <span data-testid="theme-state">{theme}</span>;
}

function renderSettingsShellWithThemeProbe(initialPage?: string) {
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
      <ThemeStateProbe />
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

  it("renders the six first-stage settings entries only", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    const navItems = within(sidebar)
      .getAllByRole("button")
      .filter((button) => {
        const text = button.textContent ?? "";
        return !text.includes("Back to app");
      });

    expect(navItems.map((button) => button.textContent)).toEqual([
      "ProfileMVP0",
      "GeneralMVP0",
      "AppearanceMVP0",
      "PersonalizationMVP0",
      "ConfigMVP0",
      "ProviderMVP0",
    ]);
    expect(within(sidebar).queryByText("Archived chats")).toBeNull();
    expect(within(sidebar).queryByText("MCP servers")).toBeNull();
    expect(within(sidebar).queryByText("Browser")).toBeNull();
    expect(within(sidebar).queryByText("Computer control")).toBeNull();
    expect(within(sidebar).queryByText("Git")).toBeNull();
    expect(within(sidebar).queryByText("Worktrees")).toBeNull();
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

  it("applies Light and Dark from the Appearance page", () => {
    renderSettingsShellWithThemeProbe();
    const sidebar = screen.getByLabelText("Settings navigation");
    fireEvent.click(within(sidebar).getByText("Appearance"));

    expect(screen.getByTestId("theme-state").textContent).toBe("dark");
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(screen.getByTestId("theme-state").textContent).toBe("light");
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(screen.getByTestId("theme-state").textContent).toBe("dark");
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

  it("switches to Profile page on click and shows local-only account sections", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    fireEvent.click(within(sidebar).getByText("Profile"));
    const content = document.querySelector(".ua-settings-content");
    expect(content?.getAttribute("data-settings-page")).toBe("profile");
    expect(screen.getByText("Local profile summary")).toBeTruthy();
    expect(screen.getByText("Account status")).toBeTruthy();
    expect(screen.getByText("Future account sync")).toBeTruthy();
    expect(screen.getAllByText("Local only").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not signed in").length).toBeGreaterThan(0);
  });

  it("switches to Provider page on click and shows sections", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    fireEvent.click(within(sidebar).getByText("Provider"));
    const content = document.querySelector(".ua-settings-content");
    expect(content?.getAttribute("data-settings-page")).toBe("provider");
    expect(screen.getByText("Available providers")).toBeTruthy();
    expect(screen.getByText("Selected provider detail")).toBeTruthy();
    expect(screen.getByText("Model defaults")).toBeTruthy();
    expect(screen.getByText("Local-only actions")).toBeTruthy();
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
    fireEvent.click(within(sidebar).getByText("Appearance"));
    expect(
      screen.getByText(
        "Theme is local to this preview. Provider and runtime settings remain mock-only.",
      ),
    ).toBeTruthy();
    fireEvent.click(within(sidebar).getByText("Profile"));
    expect(
      screen.getByText("This local profile is a UI-only mock. It is not synced or uploaded."),
    ).toBeTruthy();
    fireEvent.click(within(sidebar).getByText("Provider"));
    expect(
      screen.getByText(
        /Provider config is secret-safe: no raw API keys stored. Network mode controls transport behavior./,
        {
          exact: false,
        },
      ),
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

  it("shows Personalization memory rows as disabled with future phase labels", () => {
    renderSettingsShell();
    const sidebar = screen.getByLabelText("Settings navigation");
    fireEvent.click(within(sidebar).getByText("Personalization"));
    const memoryRows = screen.getAllByText("Coming in MVP4");
    expect(memoryRows.length).toBe(2);
  });

  it("shows Provider add/edit/delete actions and a fixture test connection button", () => {
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
      (b) => b.textContent === "Test connection (fixture)",
    ) as HTMLButtonElement;
    expect(testBtn).toBeTruthy();
    expect(testBtn.disabled).toBe(false);
  });
});
