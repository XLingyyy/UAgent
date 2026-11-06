import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider, createLocaleStore } from "../i18n";
import { UIProvider, useSettingsActions } from "../stores/ui-store";
import { codexLeadSession } from "../runtime/codex-member-session";
import { AppShell } from "./AppShell";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps the composer and Codex configuration mounted across settings navigation", async () => {
  function Navigation() {
    const { openSettings, closeSettings } = useSettingsActions();
    return <><button onClick={() => openSettings("general")}>Open test settings</button><button onClick={closeSettings}>Close test settings</button></>;
  }
  const locale = createLocaleStore({ initialLocale: "en", storage: null, eventTarget: null });
  const { container } = render(
    <I18nProvider store={locale}>
      <UIProvider initialState={{ composer: { taskMode: "investigation" } }}>
        <Navigation />
        <AppShell />
      </UIProvider>
    </I18nProvider>,
  );
  const composer = container.querySelector(".ua-composer")!;
  const draft = composer.querySelector("textarea") as HTMLTextAreaElement;
  fireEvent.change(draft, { target: { value: "Investigate this project" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /Multi-agent independent/ }));
  fireEvent.change(screen.getByLabelText("Lead connection"), { target: { value: "codex" } });
  const executable = screen.getByLabelText("Lead Codex executable");
  await waitFor(() => expect((executable.closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false));
  const closeSession = vi.spyOn(codexLeadSession, "close");

  fireEvent.click(screen.getByRole("button", { name: "Open test settings" }));
  expect(container.querySelector(".ua-settings-shell")).not.toBeNull();
  expect(composer.closest("[hidden]")).not.toBeNull();
  expect(container.querySelector(".ua-composer")).toBe(composer);
  expect(closeSession).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Close test settings" }));
  expect(container.querySelector(".ua-settings-shell")).toBeNull();
  expect(container.querySelector(".ua-composer")).toBe(composer);
  expect(composer.closest("[hidden]")).toBeNull();
  expect(composer.querySelector("textarea")).toBe(draft);
  expect(draft.value).toBe("Investigate this project");
  expect(screen.getByRole("checkbox", { name: /Multi-agent independent/ })).toHaveProperty("checked", true);
  expect(screen.getByLabelText("Lead Codex executable")).toBe(executable);
  expect(closeSession).not.toHaveBeenCalled();
});

it("suspends the hidden tool drawer focus trap while settings are visible", () => {
  vi.stubGlobal("innerWidth", 1000);
  function Navigation() {
    const { openSettings, closeSettings } = useSettingsActions();
    return <><button onClick={() => openSettings("general")}>Open test settings</button><button onClick={closeSettings}>Close test settings</button></>;
  }
  const locale = createLocaleStore({ initialLocale: "en", storage: null, eventTarget: null });
  const { container } = render(<I18nProvider store={locale}><UIProvider initialState={{ layout: { inspector: { open: true } } }}><Navigation /><AppShell /></UIProvider></I18nProvider>);
  const inspector = container.querySelector(".ua-inspector")!;
  expect(inspector.getAttribute("data-state")).toBe("open");
  fireEvent.click(screen.getByRole("button", { name: "Open test settings" }));
  expect(inspector.getAttribute("data-state")).toBe("closed");
  const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  fireEvent(document, tab);
  expect(tab.defaultPrevented).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Close test settings" }));
  expect(inspector.getAttribute("data-state")).toBe("open");
});
