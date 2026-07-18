import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppShell } from "./shell/AppShell";
import { UIProvider } from "./app/providers";
import { ComingSoonGate } from "./components/ComingSoonGate";
import { createDesktopRuntimeAdapter } from "./runtime/desktop-runtime-adapter";
import {
  useComposerStore,
  useProviderActions,
  useProviderStore,
  useSettingsActions,
} from "./stores/ui-store";
import type { ProviderConfig } from "./types/provider";

const RAW_SECRET = "sk-abcdefghijklmnopqrstuvwxyz123456";

type ScenarioName =
  | "mvp6-default-welcome"
  | "mvp6-titlebar-tools-toggle"
  | "mvp6-titlebar-drag-region-safe"
  | "mvp6-left-sidebar-default"
  | "mvp6-left-sidebar-asset-browser"
  | "mvp6-project-tree-keyboard"
  | "mvp6-account-menu-settings-entry"
  | "mvp6-composer-compact-layout"
  | "mvp6-composer-no-voice"
  | "mvp6-model-reasoning-menu"
  | "mvp6-provider-model-sync"
  | "mvp6-attach-menu-disabled"
  | "mvp6-utility-drawer-default-closed"
  | "mvp6-utility-drawer-narrow-overlay"
  | "mvp6-safety-panel-regression"
  | "mvp6-audit-panel-regression"
  | "mvp6-changes-panel-regression"
  | "mvp6-placeholder-tools-disabled"
  | "mvp6-settings-six-pages"
  | "mvp6-general-page"
  | "mvp6-profile-page-readonly"
  | "mvp6-appearance-dark-only"
  | "mvp6-config-localhost-mcp"
  | "mvp6-personalization-staged-memory"
  | "mvp6-provider-secret-safe"
  | "mvp6-coming-soon-tooltip-focus"
  | "mvp6-reduced-motion"
  | "mvp6-no-new-state-management"
  | "mvp6-side-effect-scan"
  | "mvp6-mvp5-redaction-regression";

interface Mvp6Scenario {
  name: ScenarioName;
  assertionCount: number;
  run: () => void | Promise<void>;
}

function renderMvp6App() {
  return render(
    <UIProvider>
      <AppShell />
    </UIProvider>,
  );
}

function openSettingsPage(page: string) {
  fireEvent.click(screen.getByLabelText("Open profile menu"));
  fireEvent.click(screen.getByRole("menuitem", { name: "Open settings" }));
  fireEvent.click(within(screen.getByLabelText("Settings navigation")).getByText(page));
}

function openUtilityDrawer() {
  fireEvent.click(screen.getByRole("button", { name: "Open utility drawer" }));
  return screen.getByLabelText("Utility drawer");
}

function renderComingSoonTooltip() {
  render(
    <ComingSoonGate phase="MVP9" reason="Reserved post-MVP workspace capability.">
      <button type="button">Future tool</button>
    </ComingSoonGate>,
  );
}

function readTextFile(...paths: string[]) {
  for (const path of paths) {
    try {
      return readFileSync(path, "utf-8");
    } catch {
      // Try the next cwd variant. Vitest runs this package from apps/desktop.
    }
  }
  throw new Error(`Unable to read any test fixture path: ${paths.join(", ")}`);
}

const syncedProvider: ProviderConfig = {
  providerId: "provider-sync",
  displayName: "Provider Sync",
  baseUrl: "https://fixture.provider.local/v1",
  wireApi: "responses",
  authMode: "env_key",
  secretRef: "PROVIDER_SYNC_KEY",
  enabled: true,
  defaultModel: "provider-sync-model",
  defaultReasoningEffort: "high",
  models: [
    {
      id: "provider-sync-model",
      label: "Synced Model",
      contextWindow: 128000,
      supportsReasoning: true,
      reasoningEfforts: ["medium", "high"],
    },
  ],
};

function ProviderSyncProbe() {
  const composerModel = useComposerStore((state) => state.selectedModelId);
  const composerReasoning = useComposerStore((state) => state.reasoningEffort);
  const defaultProviderId = useProviderStore((state) => state.defaultProviderId ?? "null");
  const { saveProvider, setDefaultProvider } = useProviderActions();

  return (
    <div>
      <span data-testid="composer-model">{composerModel}</span>
      <span data-testid="composer-reasoning">{composerReasoning}</span>
      <span data-testid="default-provider">{defaultProviderId}</span>
      <button
        type="button"
        onClick={() => {
          saveProvider(syncedProvider);
          setDefaultProvider("provider-sync");
        }}
      >
        sync provider default
      </button>
    </div>
  );
}

function SettingsActionProbe() {
  const { openSettings } = useSettingsActions();
  return (
    <button type="button" onClick={() => openSettings("provider")}>
      open provider settings from store
    </button>
  );
}

const scenarios: Mvp6Scenario[] = [
  {
    name: "mvp6-default-welcome",
    assertionCount: 4,
    run: () => {
      const { container } = renderMvp6App();

      expect(container.querySelector('[data-workspace-mode="welcome"]')).toBeTruthy();
      expect(screen.getByRole("main", { name: "Workspace" })).toBeTruthy();
      expect(screen.getByLabelText("Composer dock")).toBeTruthy();
      expect(screen.getByText("Mock runtime / no provider call")).toBeTruthy();
    },
  },
  {
    name: "mvp6-titlebar-tools-toggle",
    assertionCount: 4,
    run: () => {
      const { container } = renderMvp6App();

      expect(screen.getByText("MVP15 Complete")).toBeTruthy();
      expect(container.querySelector('[data-utility-pane-state="closed"]')).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Open utility drawer" }));
      expect(screen.getByRole("button", { name: "Close utility drawer" })).toBeTruthy();
      expect(container.querySelector('[data-utility-pane-state="open"]')).toBeTruthy();
    },
  },
  {
    name: "mvp6-titlebar-drag-region-safe",
    assertionCount: 4,
    run: () => {
      const { container } = renderMvp6App();
      const titlebar = container.querySelector(".ua-titlebar") as HTMLElement;
      const toolsButton = screen.getByRole("button", { name: "Open utility drawer" });

      expect(titlebar.getAttribute("data-tauri-drag-region")).toBe("");
      expect(toolsButton.parentElement?.getAttribute("data-tauri-drag-region")).toBeNull();
      expect(screen.getByLabelText("Connection summary")).toBeTruthy();
      expect(within(screen.getByLabelText("Connection summary")).getByText("No net")).toBeTruthy();
    },
  },
  {
    name: "mvp6-left-sidebar-default",
    assertionCount: 5,
    run: () => {
      renderMvp6App();
      const sidebar = screen.getByLabelText("Sidebar");

      expect(sidebar.getAttribute("data-sidebar-view")).toBe("project");
      expect(within(sidebar).getByRole("tab", { name: "Project" })).toBeTruthy();
      expect(within(sidebar).getByRole("tab", { name: "Conversation" })).toBeTruthy();
      expect(within(sidebar).getByRole("tab", { name: "Asset Browser" })).toBeTruthy();
      expect(within(sidebar).getByText("Lyra_Prototype")).toBeTruthy();
    },
  },
  {
    name: "mvp6-left-sidebar-asset-browser",
    assertionCount: 6,
    run: () => {
      renderMvp6App();
      const sidebar = screen.getByLabelText("Sidebar");

      fireEvent.click(within(sidebar).getByRole("tab", { name: "Asset Browser" }));
      expect(sidebar.getAttribute("data-sidebar-view")).toBe("asset-browser");
      expect(within(sidebar).getByRole("tree", { name: "Lyra_Prototype asset browser" })).toBeTruthy();
      for (const label of ["Content", "Maps", "Characters", "Materials"]) {
        expect(within(sidebar).getByText(label)).toBeTruthy();
      }
    },
  },
  {
    name: "mvp6-project-tree-keyboard",
    assertionCount: 4,
    run: () => {
      renderMvp6App();
      const sidebar = screen.getByLabelText("Sidebar");

      fireEvent.click(within(sidebar).getByRole("tab", { name: "Asset Browser" }));
      const tree = within(sidebar).getByRole("tree", { name: "Lyra_Prototype asset browser" });
      const contentItem = within(tree).getByText("Content").closest('[role="treeitem"]')!;
      fireEvent.focus(contentItem);
      fireEvent.keyDown(tree, { key: "ArrowDown" });
      const mapsItem = within(tree).getByText("Maps").closest('[role="treeitem"]')!;
      expect(mapsItem.getAttribute("tabindex")).toBe("0");
      fireEvent.keyDown(mapsItem, { key: "Enter" });
      expect(mapsItem.getAttribute("aria-selected")).toBe("true");
      fireEvent.keyDown(mapsItem, { key: "ArrowRight" });
      expect(within(tree).getByText("L_LyraFrontEnd.umap")).toBeTruthy();
      expect(contentItem.getAttribute("tabindex")).toBe("-1");
    },
  },
  {
    name: "mvp6-account-menu-settings-entry",
    assertionCount: 3,
    run: () => {
      renderMvp6App();

      fireEvent.click(screen.getByLabelText("Open profile menu"));
      expect(screen.getByRole("menuitem", { name: "Open settings" })).toBeTruthy();
      fireEvent.click(screen.getByRole("menuitem", { name: "Open settings" }));
      expect(document.querySelector(".ua-app")?.getAttribute("data-shell-mode")).toBe("settings");
      expect(screen.getByLabelText("Settings navigation")).toBeTruthy();
    },
  },
  {
    name: "mvp6-composer-compact-layout",
    assertionCount: 5,
    run: () => {
      renderMvp6App();
      const dock = screen.getByLabelText("Composer dock");

      expect(dock.getAttribute("data-composer-mode")).toBe("welcome");
      expect(within(dock).getByLabelText("Open attach menu")).toBeTruthy();
      expect(within(dock).getByLabelText("Composer input")).toBeTruthy();
      expect(within(dock).getByLabelText(/Model selector:/)).toBeTruthy();
      expect(within(dock).getByLabelText("Send - disabled")).toBeTruthy();
    },
  },
  {
    name: "mvp6-composer-no-voice",
    assertionCount: 2,
    run: () => {
      const { container } = renderMvp6App();

      expect(screen.queryByLabelText(/voice|microphone|record/i)).toBeNull();
      expect(
        container.querySelectorAll('[aria-label*="mic" i], [aria-label*="voice" i], [aria-label*="record" i]'),
      ).toHaveLength(0);
    },
  },
  {
    name: "mvp6-model-reasoning-menu",
    assertionCount: 7,
    run: () => {
      renderMvp6App();

      fireEvent.click(screen.getByLabelText("Model selector: Model not configured, reasoning medium"));
      const dropdown = screen.getByRole("listbox", { name: "Model and reasoning settings" });
      expect(dropdown.getAttribute("data-motion")).toBe("layer");
      for (const option of ["Low", "Medium", "High", "XHigh"]) {
        expect(within(dropdown).getByText(option)).toBeTruthy();
      }
      fireEvent.click(within(dropdown).getByText("High").closest('[role="option"]')!);
      expect(screen.getByLabelText("Model selector: Model not configured, reasoning high")).toBeTruthy();
      expect(screen.queryByRole("listbox", { name: "Model and reasoning settings" })).toBeNull();
    },
  },
  {
    name: "mvp6-provider-model-sync",
    assertionCount: 4,
    run: () => {
      render(
        <UIProvider>
          <ProviderSyncProbe />
        </UIProvider>,
      );

      expect(screen.getByTestId("composer-model").textContent).toBe("not-configured");
      fireEvent.click(screen.getByText("sync provider default"));
      expect(screen.getByTestId("default-provider").textContent).toBe("provider-sync");
      expect(screen.getByTestId("composer-model").textContent).toBe("provider-sync-model");
      expect(screen.getByTestId("composer-reasoning").textContent).toBe("high");
    },
  },
  {
    name: "mvp6-attach-menu-disabled",
    assertionCount: 9,
    run: () => {
      renderMvp6App();

      fireEvent.click(screen.getByRole("button", { name: "Open attach menu" }));
      const menu = screen.getByRole("menu", { name: "Attach context" });
      const items = within(menu).getAllByRole("menuitem");

      expect(items).toHaveLength(4);
      for (const label of ["File", "Asset", "Screenshot", "Context Pack"]) {
        expect(within(menu).getByText(label)).toBeTruthy();
      }
      for (const item of items) {
        expect(item.getAttribute("aria-disabled")).toBe("true");
      }
    },
  },
  {
    name: "mvp6-utility-drawer-default-closed",
    assertionCount: 3,
    run: () => {
      const { container } = renderMvp6App();

      expect(container.querySelector('[data-utility-pane-state="closed"]')).toBeTruthy();
      expect(screen.getByLabelText("Utility drawer").getAttribute("data-state")).toBe("closed");
      expect(screen.getByRole("button", { name: "Open utility drawer" })).toBeTruthy();
    },
  },
  {
    name: "mvp6-utility-drawer-narrow-overlay",
    assertionCount: 4,
    run: () => {
      const mainLayoutCss = readTextFile(
        "web/src/shell/MainLayout.css",
        "apps/desktop/web/src/shell/MainLayout.css",
      );
      renderMvp6App();
      const drawer = openUtilityDrawer();

      expect(drawer.getAttribute("data-motion")).toBe("panel");
      expect(drawer.classList.contains("ua-inspector--open")).toBe(true);
      expect(mainLayoutCss).toContain("@media (max-width: 899px)");
      expect(mainLayoutCss).toContain("position: absolute");
    },
  },
  {
    name: "mvp6-safety-panel-regression",
    assertionCount: 3,
    run: () => {
      renderMvp6App();
      const drawer = openUtilityDrawer();

      fireEvent.click(within(drawer).getByRole("tab", { name: "Safety" }));
      expect(within(drawer).getByLabelText("Safety panel")).toBeTruthy();
      expect(within(drawer).getByText(/approval/i)).toBeTruthy();
      expect(within(drawer).getAllByText(/sandbox/i).length).toBeGreaterThan(0);
    },
  },
  {
    name: "mvp6-audit-panel-regression",
    assertionCount: 3,
    run: () => {
      renderMvp6App();
      const drawer = openUtilityDrawer();

      fireEvent.click(within(drawer).getByRole("tab", { name: "Audit" }));
      expect(within(drawer).getByLabelText("Audit panel")).toBeTruthy();
      expect(within(drawer).getByText(/append-only/i)).toBeTruthy();
      expect(within(drawer).getByText(/No active task/i)).toBeTruthy();
    },
  },
  {
    name: "mvp6-changes-panel-regression",
    assertionCount: 3,
    run: () => {
      renderMvp6App();
      const drawer = openUtilityDrawer();

      fireEvent.click(within(drawer).getByRole("tab", { name: "Changes" }));
      expect(within(drawer).getByLabelText("Changes panel")).toBeTruthy();
      expect(within(drawer).getByText(/ChangeSet/i)).toBeTruthy();
      expect(within(drawer).getByText(/No active task/i)).toBeTruthy();
    },
  },
  {
    name: "mvp6-placeholder-tools-disabled",
    assertionCount: 6,
    run: () => {
      renderMvp6App();
      const drawer = openUtilityDrawer();

      expect(within(drawer).getByRole("tablist", { name: "Utility tools" })).toBeTruthy();
      for (const label of ["Logs", "Asset Search"]) {
        const tab = within(drawer).getByRole("tab", { name: label });
        expect(tab.getAttribute("aria-disabled")).toBe("true");
        expect(tab.getAttribute("aria-describedby")).toMatch(/^ua-coming-soon-tooltip-/);
      }
      // Terminal, Browser, Screenshot, Files, and UE are now active later-MVP panels
      for (const label of ["Terminal", "Browser", "Screenshot", "Files", "UE"]) {
        const tab = within(drawer).getByRole("tab", { name: label });
        expect(tab.getAttribute("aria-disabled")).toBeNull();
      }
    },
  },
  {
    name: "mvp6-settings-six-pages",
    assertionCount: 8,
    run: () => {
      renderMvp6App();

      fireEvent.click(screen.getByLabelText("Open profile menu"));
      fireEvent.click(screen.getByRole("menuitem", { name: "Open settings" }));
      const nav = screen.getByLabelText("Settings navigation");
      for (const page of ["Profile", "General", "Appearance", "Personalization", "Config", "Provider"]) {
        expect(within(nav).getByText(page)).toBeTruthy();
      }
      expect(within(nav).getAllByText("MVP6")).toHaveLength(6);
      expect(within(nav).queryByText("Browser")).toBeNull();
    },
  },
  {
    name: "mvp6-general-page",
    assertionCount: 5,
    run: () => {
      renderMvp6App();
      openSettingsPage("General");

      expect(document.querySelector(".ua-settings-content")?.getAttribute("data-settings-page")).toBe("general");
      expect(screen.getByText("Work mode")).toBeTruthy();
      expect(screen.getByText("Permission defaults")).toBeTruthy();
      expect(screen.getByText("Bottom panel")).toBeTruthy();
      expect(screen.getByText("This is a UI-only mock. No configuration is saved or applied.")).toBeTruthy();
    },
  },
  {
    name: "mvp6-profile-page-readonly",
    assertionCount: 5,
    run: () => {
      renderMvp6App();
      openSettingsPage("Profile");

      expect(document.querySelector(".ua-settings-content")?.getAttribute("data-settings-page")).toBe("profile");
      expect(screen.getByText("Local profile summary")).toBeTruthy();
      expect(screen.getByText("Account status")).toBeTruthy();
      expect(screen.getAllByText("Local only").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Not signed in").length).toBeGreaterThan(0);
    },
  },
  {
    name: "mvp6-appearance-dark-only",
    assertionCount: 5,
    run: () => {
      renderMvp6App();
      openSettingsPage("Appearance");

      expect(screen.getByRole("radio", { name: "Dark" })).toBeTruthy();
      expect((screen.getByRole("radio", { name: "System (staged)" }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole("radio", { name: "Light (staged)" }) as HTMLButtonElement).disabled).toBe(true);
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(screen.queryByText(/light theme is active/i)).toBeNull();
    },
  },
  {
    name: "mvp6-config-localhost-mcp",
    assertionCount: 6,
    run: () => {
      renderMvp6App();
      openSettingsPage("Config");

      expect(screen.getByLabelText("MCP endpoint URL").getAttribute("placeholder")).toBe("http://127.0.0.1:8765/mcp");
      expect(screen.getByDisplayValue("http://127.0.0.1:8765/mcp")).toBeTruthy();
      expect(screen.getByText("disconnected")).toBeTruthy();
      expect(screen.getByText("Not initialized")).toBeTruthy();
      expect(screen.getByText("Not connected")).toBeTruthy();
      expect((screen.getByText("Discover") as HTMLButtonElement).disabled).toBe(true);
    },
  },
  {
    name: "mvp6-personalization-staged-memory",
    assertionCount: 5,
    run: () => {
      renderMvp6App();
      openSettingsPage("Personalization");

      expect(screen.getByText("Agent style")).toBeTruthy();
      expect(screen.getByText("Custom instructions")).toBeTruthy();
      expect(screen.getByText("Memory")).toBeTruthy();
      expect(screen.getAllByText("Enable agent memory")[1]?.closest("[aria-disabled='true']")).toBeTruthy();
      expect(screen.getAllByText("Coming in MVP4")).toHaveLength(2);
    },
  },
  {
    name: "mvp6-provider-secret-safe",
    assertionCount: 4,
    run: () => {
      renderMvp6App();
      openSettingsPage("Provider");

      fireEvent.click(screen.getByText("Edit provider"));
      fireEvent.change(screen.getByLabelText("Network mode"), { target: { value: "live" } });
      fireEvent.change(screen.getByLabelText("Secret ref"), { target: { value: "sk-live-raw-secret" } });
      fireEvent.click(screen.getByText("Test connection (fixture)"));
      expect(screen.queryByText("sk-live-raw-secret")).toBeNull();
      expect(screen.queryByDisplayValue("sk-live-raw-secret")).toBeNull();
      expect(screen.getByText("Fixture connection passed. No live network request was sent.")).toBeTruthy();
      expect(screen.queryByLabelText("API key", { exact: false })).toBeNull();
    },
  },
  {
    name: "mvp6-coming-soon-tooltip-focus",
    assertionCount: 4,
    run: () => {
      renderComingSoonTooltip();

      const trigger = screen.getByRole("button", { name: "Future tool" });
      const tooltip = screen.getByRole("tooltip");
      trigger.focus();
      expect(trigger.getAttribute("aria-disabled")).toBe("true");
      expect(trigger.getAttribute("aria-describedby")).toBe(tooltip.id);
      expect(tooltip.textContent).toBe("Coming in MVP9: Reserved post-MVP workspace capability.");
      expect(document.activeElement).toBe(trigger);
    },
  },
  {
    name: "mvp6-reduced-motion",
    assertionCount: 4,
    run: () => {
      const animationsCss = readTextFile(
        "web/src/styles/animations.css",
        "apps/desktop/web/src/styles/animations.css",
      );
      renderMvp6App();

      expect(animationsCss).toContain("@media (prefers-reduced-motion: reduce)");
      expect(animationsCss).toContain("animation-duration: 1ms !important");
      expect(animationsCss).toContain("transition-duration: 1ms !important");
      expect(screen.getByText("MVP15 Complete")).toBeTruthy();
    },
  },
  {
    name: "mvp6-no-new-state-management",
    assertionCount: 6,
    run: () => {
      const { container } = render(
        <UIProvider>
          <SettingsActionProbe />
          <AppShell />
        </UIProvider>,
      );

      expect(container.querySelector(".ua-app")).toBeTruthy();
      expect(container.querySelector("[data-shell-mode='app']")).toBeTruthy();
      expect(container.querySelector("[data-workspace-mode='welcome']")).toBeTruthy();
      expect(container.querySelector("[data-sidebar-view='project']")).toBeTruthy();
      fireEvent.click(screen.getByText("open provider settings from store"));
      expect(container.querySelector("[data-shell-mode='settings']")).toBeTruthy();
    },
  },
  {
    name: "mvp6-side-effect-scan",
    assertionCount: 5,
    run: () => {
      const scanSource = readTextFile(
        "../../scripts/side-effect-scan.mjs",
        "scripts/side-effect-scan.mjs",
      );

      expect(scanSource).toContain("mvp6-ui-product-side-effects");
      expect(scanSource).toContain("window.open()");
      expect(scanSource).toContain("localStorage.*");
      expect(scanSource).toContain("file picker");
      expect(scanSource).toContain("screen capture");
    },
  },
  {
    name: "mvp6-mvp5-redaction-regression",
    assertionCount: 5,
    run: async () => {
      const runtime = createDesktopRuntimeAdapter();
      const record = await runtime.submitTask({
        input: `Audit provider token api_key=${RAW_SECRET} Authorization: Bearer ${RAW_SECRET}`,
        projectId: "lyra",
        permissionMode: "request_approval",
        modelId: "not-configured",
        reasoningEffort: "medium",
        runMode: "local",
        branch: "main",
        contextPercent: 12,
        providerStatus: "not_configured",
      });

      await waitFor(() => {
        expect(runtime.getSnapshot().tasksById[record.id]).toBeTruthy();
      });
      const serialized = JSON.stringify(runtime.getSnapshot());
      expect(serialized).not.toContain(RAW_SECRET);
      expect(serialized).toContain("[REDACTED]");
      expect(serialized).toContain("task_submitted");
      expect(serialized).toContain("agent_plan_started");
    },
  },
];

describe("MVP6 scenario matrix", () => {
  it("defines 30 named scenarios with 60+ explicit behavior assertions", () => {
    expect(scenarios).toHaveLength(30);
    expect(new Set(scenarios.map((scenario) => scenario.name)).size).toBe(30);
    expect(scenarios.reduce((sum, scenario) => sum + scenario.assertionCount, 0)).toBeGreaterThanOrEqual(60);
    expect(scenarios[0]?.name).toBe("mvp6-default-welcome");
    expect(scenarios.at(-1)?.name).toBe("mvp6-mvp5-redaction-regression");
  });

  it.each(scenarios)("$name", async ({ run }) => {
    await run();
  });
});
