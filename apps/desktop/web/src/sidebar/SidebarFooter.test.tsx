import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SidebarFooter } from "./SidebarFooter";
import { UIProvider } from "../app/providers";
import { useSettingsStore } from "../stores/ui-store";

function SettingsStateProbe() {
  const settingsOpen = useSettingsStore((state) => String(state.open));
  const activePage = useSettingsStore((state) => state.activePageId);

  return (
    <div>
      <span data-testid="settings-open">{settingsOpen}</span>
      <span data-testid="settings-page">{activePage}</span>
    </div>
  );
}

function renderFooter() {
  return render(
    <UIProvider>
      <SidebarFooter />
      <SettingsStateProbe />
    </UIProvider>,
  );
}

describe("SidebarFooter", () => {
  it("renders Settings entry button", () => {
    renderFooter();
    expect(screen.getByLabelText("Open settings")).toBeTruthy();
  });

  it("opens General settings from the Settings entry", () => {
    renderFooter();

    fireEvent.click(screen.getByLabelText("Open settings"));

    expect(screen.getByTestId("settings-open").textContent).toBe("true");
    expect(screen.getByTestId("settings-page").textContent).toBe("general");
  });

  it("opens local Profile settings from the Account entry", () => {
    renderFooter();
    const accountBtn = screen.getByLabelText("Open profile menu") as HTMLButtonElement;

    expect(accountBtn).toBeTruthy();
    expect(accountBtn.getAttribute("aria-disabled")).toBeNull();

    fireEvent.click(accountBtn);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open profile" }));

    expect(screen.getByTestId("settings-open").textContent).toBe("true");
    expect(screen.getByTestId("settings-page").textContent).toBe("profile");
  });

  it("renders version and status", () => {
    renderFooter();
    expect(screen.getByText("UAgent MVP6")).toBeTruthy();
    expect(screen.getByText("Local / No UE writes")).toBeTruthy();
  });
});
