import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppShell } from "./shell/AppShell";
import { UIProvider } from "./app/providers";
import { runMvp8ScenarioMatrix } from "@uagent/runtime";

const tauriGlobal = globalThis as typeof globalThis & {
  __TAURI_INTERNALS__?: { invoke?: (command: string, payload?: unknown) => Promise<unknown> };
};
const previousTauriInternals = tauriGlobal.__TAURI_INTERNALS__;

afterEach(() => {
  tauriGlobal.__TAURI_INTERNALS__ = previousTauriInternals;
  vi.restoreAllMocks();
});

function renderMvp8App() {
  return render(
    <UIProvider>
      <AppShell />
    </UIProvider>,
  );
}

function openConfigSettings() {
  fireEvent.click(screen.getByLabelText("Open profile menu"));
  fireEvent.click(screen.getByRole("menuitem", { name: "Open settings" }));
  fireEvent.click(within(screen.getByLabelText("Settings navigation")).getByText("Config"));
}

function readTextFile(...paths: string[]) {
  for (const path of paths) {
    try {
      return readFileSync(path, "utf-8");
    } catch {
      // Vitest runs from apps/desktop.
    }
  }
  throw new Error(`Unable to read any path: ${paths.join(", ")}`);
}

const scenarioNames = [
  "mvp8-stage-docs-current",
  "mvp8-mvp7-regression-lock",
  "mvp8-native-root-contracts",
  "mvp8-policy-defaults-readonly",
  "mvp8-root-validation-fixture",
  "mvp8-root-validation-real-temp",
  "mvp8-root-validation-dangerous-root",
  "mvp8-root-validation-relative-path",
  "mvp8-root-validation-network-path",
  "mvp8-root-validation-missing-uproject",
  "mvp8-root-trust-required-before-scan",
  "mvp8-trust-confirmation-recorded",
  "mvp8-scan-real-temp-project",
  "mvp8-scan-deterministic-order",
  "mvp8-scan-ignored-dirs",
  "mvp8-scan-depth-cap",
  "mvp8-scan-node-cap",
  "mvp8-scan-byte-cap",
  "mvp8-scan-permission-denied-warning",
  "mvp8-scan-symlink-inside-allowed",
  "mvp8-scan-symlink-escape-blocked",
  "mvp8-scan-cancel-keeps-stable-snapshot",
  "mvp8-scan-progress-batched",
  "mvp8-uproject-parser-valid",
  "mvp8-uproject-parser-malformed-warning",
  "mvp8-asset-map-classification",
  "mvp8-asset-config-classification",
  "mvp8-asset-source-classification",
  "mvp8-asset-binary-blocked-preview",
  "mvp8-asset-filter-no-rescan",
  "mvp8-preview-text-ready",
  "mvp8-preview-binary-blocked",
  "mvp8-preview-large-truncated",
  "mvp8-preview-root-escape-blocked",
  "mvp8-preview-secret-redacted",
  "mvp8-preview-home-path-redacted",
  "mvp8-preview-project-root-redacted",
  "mvp8-preview-cache-in-memory",
  "mvp8-preview-audit-event",
  "mvp8-preview-session-replay-no-read",
  "mvp8-capability-files-readonly-allow",
  "mvp8-capability-files-write-blocked",
  "mvp8-capability-terminal-still-no-exec",
  "mvp8-capability-browser-still-blocked",
  "mvp8-capability-screenshot-still-blocked",
  "mvp8-provider-live-still-manual",
  "mvp8-audit-native-events-redacted",
  "mvp8-session-native-events-redacted",
  "mvp8-evidence-native-summary",
  "mvp8-runtime-snapshot-no-raw-path",
  "mvp8-dom-no-raw-path",
  "mvp8-dom-no-raw-secret",
  "mvp8-config-root-workflow-ui",
  "mvp8-config-scan-cancel-ui",
  "mvp8-sidebar-real-index-source",
  "mvp8-sidebar-filter-no-scan",
  "mvp8-asset-detail-panel",
  "mvp8-file-preview-panel",
  "mvp8-workspace-status-native-index",
  "mvp8-runtime-dashboard-native-policy",
  "mvp8-titlebar-readonly-status",
  "mvp8-a11y-project-tree-keyboard",
  "mvp8-coming-soon-future-tools-disabled",
  "mvp8-reduced-motion",
  "mvp8-side-effect-scan-zero-blocked",
  "mvp8-no-new-state-management",
  "mvp8-no-direct-tauri-in-ui",
  "mvp8-no-write-command-registered",
  "mvp8-manual-smoke-doc-present",
  "mvp8-mvp9-handoff-doc-present",
  "mvp8-native-warning-no-raw-path",
  "mvp8-adapter-store-no-raw-path",
] as const;

describe("MVP8 desktop scenario matrix", () => {
  it("defines the required 72 unique scenario names", () => {
    expect(scenarioNames).toHaveLength(72);
    expect(new Set(scenarioNames).size).toBe(72);
    expect(scenarioNames[0]).toBe("mvp8-stage-docs-current");
    expect(scenarioNames.at(-1)).toBe("mvp8-adapter-store-no-raw-path");
  });

  it("keeps the default workspace and shows Native FS: fixture status", () => {
    const { container } = renderMvp8App();

    expect(container.querySelector('[data-workspace-mode="welcome"]')).toBeTruthy();
    expect(screen.getByText("Native FS: fixture")).toBeTruthy();
    expect(screen.getByText("No project root registered")).toBeTruthy();
  });

  it("validates, trusts, scans, filters, selects, and previews via MVP8 adapter", async () => {
    renderMvp8App();
    openConfigSettings();

    fireEvent.change(screen.getByLabelText("Project root reference"), {
      target: { value: "fixture://lyra-starter" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Validate project root" }));
    expect(await screen.findByText("Validation ready: LyraStarter")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Trust project root" }));
    expect(await screen.findByText("trusted")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Scan project index" }));
    expect(await screen.findByText("Index ready")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to app" }));

    fireEvent.click(screen.getByRole("tab", { name: "Asset Browser" }));
    expect(screen.getByRole("tree", { name: "LyraStarter indexed asset browser" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Filter indexed assets"), {
      target: { value: "starter" },
    });
    expect(screen.getByText("L_LyraStarterMap.umap")).toBeTruthy();
    expect(screen.getByText("Filter only; no scan triggered")).toBeTruthy();
    fireEvent.click(screen.getByText("DefaultGame.ini"));
    await waitFor(() => {
      expect(screen.getByLabelText("File preview panel").textContent).toContain("[REDACTED]");
    });
  });

  it("uses mock native scan index entries in the Asset Browser without fixture fallback", async () => {
    const rawRoot = "C:/Users/Ada/LyraStarter";
    const invoke = vi.fn(async (command: string) => {
      if (command === "validate_native_project_root") {
        return {
          ok: true,
          reason: "valid",
          displayRoot: "[user-home]/LyraStarter",
          projectName: "NativeLyra",
          engine: { label: "UE 5.8", association: "5.8", source: "uproject" },
        };
      }
      if (command === "trust_native_project_root") {
        return { displayRoot: "[user-home]/LyraStarter", trustState: "trusted" };
      }
      if (command === "scan_native_project_index") {
        return {
          id: "index:native-lyra",
          projectId: "native:lyra",
          status: "ready",
          directories: [
            {
              id: "dir:Config",
              displayName: "Config",
              nodeType: "directory",
              rootRelativePath: "Config",
              displayPath: "[project-root]/Config",
              childrenCount: 1,
              isIgnored: false,
              limitReason: "none",
            },
            {
              id: "dir:Source",
              displayName: "Source",
              nodeType: "directory",
              rootRelativePath: "Source",
              displayPath: "[project-root]/Source",
              childrenCount: 1,
              isIgnored: false,
              limitReason: "none",
            },
          ],
          files: [
            {
              id: "file:LyraStarter.uproject",
              displayName: "LyraStarter.uproject",
              nodeType: "file",
              rootRelativePath: "LyraStarter.uproject",
              displayPath: "[project-root]/LyraStarter.uproject",
              extension: ".uproject",
              byteSize: 42,
              isIgnored: false,
              limitReason: "none",
            },
            {
              id: "file:Config/DefaultGame.ini",
              displayName: "DefaultGame.ini",
              nodeType: "file",
              rootRelativePath: "Config/DefaultGame.ini",
              displayPath: "[project-root]/Config/DefaultGame.ini",
              extension: ".ini",
              byteSize: 128,
              isIgnored: false,
              limitReason: "none",
            },
            {
              id: "file:Content/Materials/M_Hero.uasset",
              displayName: "M_Hero.uasset",
              nodeType: "file",
              rootRelativePath: "Content/Materials/M_Hero.uasset",
              displayPath: "[project-root]/Content/Materials/M_Hero.uasset",
              extension: ".uasset",
              byteSize: 2048,
              isIgnored: false,
              limitReason: "none",
            },
          ],
          assets: [
            {
              id: "asset:Content/Materials/M_Hero.uasset",
              displayName: "M_Hero.uasset",
              rootRelativePath: "Content/Materials/M_Hero.uasset",
              displayPath: "[project-root]/Content/Materials/M_Hero.uasset",
              assetType: "material",
              extension: ".uasset",
              source: "project_index",
              indexedAt: 8100,
              tags: ["material", "uasset"],
              previewStatus: "blocked",
            },
          ],
          summary: {
            projectId: "native:lyra",
            scannedAt: 8100,
            status: "ready",
            directoryCount: 2,
            fileCount: 3,
            assetCount: 1,
            ignoredCount: 0,
            limitReasons: [],
            warnings: [],
            redactedRoot: "[user-home]/LyraStarter",
          },
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    tauriGlobal.__TAURI_INTERNALS__ = { invoke };

    renderMvp8App();
    openConfigSettings();

    fireEvent.change(screen.getByLabelText("Project root reference"), {
      target: { value: rawRoot },
    });
    fireEvent.click(screen.getByRole("button", { name: "Validate project root" }));
    expect(await screen.findByText("Validation ready: NativeLyra")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Trust project root" }));
    expect(await screen.findByText("trusted")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Scan project index" }));
    expect(await screen.findByText("Index ready")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to app" }));

    fireEvent.click(screen.getByRole("tab", { name: "Asset Browser" }));
    expect(screen.getByRole("tree", { name: "NativeLyra indexed asset browser" })).toBeTruthy();
    expect(screen.getByText("M_Hero.uasset")).toBeTruthy();
    expect(screen.queryByText("L_LyraStarterMap.umap")).toBeNull();
    expect(document.body.textContent).not.toContain("C:/Users/Ada");
  });

  it("shows capability cards, native FS fixture mode, and TitleBar status", () => {
    renderMvp8App();
    expect(screen.getByText("Native FS: fixture")).toBeTruthy();
    expect(screen.getByText(/No network/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open utility drawer" }));
    const drawer = screen.getByLabelText("Utility drawer");
    fireEvent.click(within(drawer).getByRole("tab", { name: "Runtime" }));
    for (const label of ["Files", "Terminal", "Browser", "Screenshot"]) {
      expect(within(drawer).getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(within(drawer).getAllByText(/blocked|fixture/i).length).toBeGreaterThan(3);
  });

  it("documents MVP8, side-effect scan, and manual smoke", () => {
    const readme = readTextFile("../../README.md", "README.md");
    const scan = readTextFile("../../scripts/side-effect-scan.mjs", "scripts/side-effect-scan.mjs");
    const manual = readTextFile("../../docs/mvp8-manual-smoke.md", "docs/mvp8-manual-smoke.md");

    expect(readme).toContain("Current Stage: MVP15");
    expect(readme).toContain("Real UE execution remains limited to `/Game/UAgentSandbox/**`");
    expect(scan).toContain("mvp8-native-fs-boundary");
    expect(scan).toContain("mvp8-real-scan-boundary");
    expect(manual).toContain("fixture://lyra");
  });
});

const mvp8Matrix = await runMvp8ScenarioMatrix();

describe("MVP8 runtime scenario matrix integration", () => {
  it("has 72 scenarios with 100+ assertions", () => {
    expect(mvp8Matrix.scenarios).toHaveLength(72);
    const total = mvp8Matrix.scenarios.reduce((s, sc) => s + sc.assertionCount, 0);
    expect(total).toBeGreaterThanOrEqual(100);
  });

  it.each(mvp8Matrix.scenarios)("$name ($assertionCount assertions)", ({ name, status }) => {
    expect(status, `${name} should pass`).toBe("pass");
  });
});
