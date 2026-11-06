import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ComposerDock } from "./ComposerDock";
import { UIProvider, useSettingsActions } from "../stores/ui-store";
import { I18nProvider, createLocaleStore } from "../i18n";
import { codexLeadSession } from "../runtime/codex-member-session";
import { initializeApplicationProfile } from "../runtime/application-profile";

function SettingsNavigation() {
  const { openSettings, closeSettings } = useSettingsActions();
  return <><button onClick={() => openSettings("provider")}>Open application settings</button><button onClick={closeSettings}>Return to workspace</button></>;
}

afterEach(() => {
  cleanup();
  codexLeadSession.close();
  vi.unstubAllGlobals();
});

it("keeps the Codex lead configured when closing settings, switching panels and changing composer mode", async () => {
  const invoke = vi.fn(async (command: string) => {
    if (command === "get_application_profile") return { isolated: true, offlineDemo: false };
    if (command === "read_codex_model_preference") return null;
    if (command === "discover_codex") return { executable: "E:/synthetic/codex.exe" };
    if (command === "list_codex_models") return [{ model: "test-model", displayName: "Test model", hidden: false, isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Medium" }] }];
    if (command === "save_codex_model_preference") return;
    throw Error(`Unexpected command: ${command}`);
  });
  vi.stubGlobal("__TAURI_INTERNALS__", { invoke });
  await initializeApplicationProfile();
  const locale = createLocaleStore({ initialLocale: "en", storage: null, eventTarget: null });
  const project = { id: "synthetic", name: "Synthetic", rootRef: "E:/Synthetic", displayRoot: "[project-root]", trustState: "trusted" as const, indexStatus: "ready" as const, engine: { label: "UE 5.8", association: "5.8", source: "uproject" as const }, createdAt: 1, updatedAt: 1 };
  const view = (mode: "welcome" | "thread") => <I18nProvider store={locale}><UIProvider initialState={{ provider: { providers: [] }, project: { activeProjectId: project.id, registeredProjects: [project] }, composer: { taskMode: "investigation", input: "Inspect lifecycle" } }}><SettingsNavigation/><ComposerDock mode={mode}/></UIProvider></I18nProvider>;
  const rendered = render(view("welcome"));
  expect(screen.queryByRole("dialog")).toBeNull();
  const toggle = screen.getByRole("checkbox", { name: /Multi-agent independent/ });
  fireEvent.click(toggle);
  const drawer = screen.getByRole("dialog", { name: "Agent collaboration" });
  fireEvent.change(screen.getByLabelText("Lead connection"), { target: { value: "codex" } });
  await waitFor(() => expect((screen.getByLabelText("Lead Codex executable") as HTMLInputElement).value).toContain("synthetic"));
  fireEvent.click(screen.getByRole("button", { name: "Load Lead Codex models" }));
  await waitFor(() => expect((screen.getByLabelText("Lead Codex model") as HTMLSelectElement).value).toBe("test-model"));
  fireEvent.click(screen.getByRole("button", { name: "Configure Lead Codex session" }));
  await waitFor(() => expect(codexLeadSession.getSnapshot().ready).toBe(true));
  const modelField = screen.getByLabelText("Lead Codex model");
  fireEvent.click(screen.getByRole("button", { name: "Close task settings" }));
  expect(drawer.hidden).toBe(true);
  expect(document.activeElement).toBe(toggle);
  expect(codexLeadSession.getSnapshot().ready).toBe(true);
  expect(modelField.isConnected).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Built-in workflows" }));
  expect(screen.getByRole("dialog", { name: "Built-in workflows" })).toBe(drawer);
  expect(codexLeadSession.getSnapshot().ready).toBe(true);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  rendered.rerender(view("thread"));
  fireEvent.click(screen.getByRole("button", { name: "Configure collaboration" }));
  expect(screen.getByLabelText("Lead Codex model")).toBe(modelField);
  expect(codexLeadSession.getSnapshot().ready).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Open application settings" }));
  expect(drawer.hidden).toBe(true);
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  document.dispatchEvent(escape);
  expect(escape.defaultPrevented).toBe(false);
  expect(codexLeadSession.getSnapshot().ready).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Return to workspace" }));
  fireEvent.click(screen.getByRole("button", { name: "Configure collaboration" }));
  expect(screen.getByLabelText("Lead Codex model")).toBe(modelField);
  expect(codexLeadSession.getSnapshot().ready).toBe(true);
  expect(invoke.mock.calls.filter(([command]) => command === "discover_codex")).toHaveLength(1);
  rendered.unmount();
  expect(codexLeadSession.getSnapshot().ready).toBe(false);
});
