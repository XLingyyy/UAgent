import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppShell } from "./shell/AppShell";
import { UIProvider } from "./app/providers";
import { runMvp7ScenarioMatrix } from "@uagent/runtime";

function renderMvp7App() {
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
  "mvp7-stage-docs-current",
  "mvp7-mvp6-regression-lock",
  "mvp7-project-registry-empty-default",
  "mvp7-project-root-validation-success",
  "mvp7-project-root-validation-missing-uproject",
  "mvp7-project-root-dangerous-root-blocked",
  "mvp7-path-traversal-blocked",
  "mvp7-symlink-escape-blocked",
  "mvp7-ignore-dirs-applied",
  "mvp7-scan-limit-node-cap",
  "mvp7-scan-cancel-keeps-stable-index",
  "mvp7-uproject-parser-valid",
  "mvp7-uproject-parser-malformed-warning",
  "mvp7-content-tree-indexed",
  "mvp7-config-source-plugins-indexed",
  "mvp7-asset-entry-classification",
  "mvp7-asset-browser-index-source",
  "mvp7-asset-search-filter-no-scan",
  "mvp7-file-preview-text-allowed",
  "mvp7-file-preview-binary-blocked",
  "mvp7-file-preview-large-truncated",
  "mvp7-file-preview-secret-redacted",
  "mvp7-file-preview-root-escape-blocked",
  "mvp7-capability-bridge-default-disabled",
  "mvp7-files-readonly-allow",
  "mvp7-files-write-blocked",
  "mvp7-terminal-proposal-no-exec",
  "mvp7-terminal-fixture-result",
  "mvp7-browser-preview-no-window-open",
  "mvp7-browser-external-url-blocked",
  "mvp7-screenshot-fixture-no-capture",
  "mvp7-provider-live-opt-in-required",
  "mvp7-provider-live-missing-secret-blocked",
  "mvp7-approval-required-for-sensitive-capability",
  "mvp7-approval-denied-no-adapter-call",
  "mvp7-capability-timeout-deterministic",
  "mvp7-capability-cancel-no-late-success",
  "mvp7-audit-project-events-redacted",
  "mvp7-session-replay-no-rescan",
  "mvp7-evidence-index-summary",
  "mvp7-runtime-snapshot-no-raw-path",
  "mvp7-dom-no-raw-secret",
  "mvp7-react-no-direct-fs",
  "mvp7-side-effect-scan-zero-blocked",
  "mvp7-settings-project-roots",
  "mvp7-settings-trust-confirmation",
  "mvp7-utility-capability-dashboard",
  "mvp7-reduced-motion",
  "mvp7-a11y-project-tree-keyboard",
  "mvp7-manual-smoke-doc-present",
] as const;

describe("MVP7 desktop scenario matrix", () => {
  it("defines the required 50 unique scenario names", () => {
    expect(scenarioNames).toHaveLength(50);
    expect(new Set(scenarioNames).size).toBe(50);
    expect(scenarioNames[0]).toBe("mvp7-stage-docs-current");
    expect(scenarioNames.at(-1)).toBe("mvp7-manual-smoke-doc-present");
  });

  it("keeps the default MVP8 welcome workspace and does not auto scan a project", () => {
    const { container } = renderMvp7App();

    expect(container.querySelector('[data-workspace-mode="welcome"]')).toBeTruthy();
    expect(screen.getByText("MVP14 In Progress")).toBeTruthy();
    expect(screen.getByText("Native FS: fixture") || screen.getByText("Read-only project index")).toBeTruthy();
    expect(screen.getByText("No project root registered")).toBeTruthy();
  });

  it("validates, trusts, scans, filters, selects, and previews the fixture project through UI actions", async () => {
    renderMvp7App();
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

  it("shows capability cards as disabled or fixture-only without direct side effects", () => {
    renderMvp7App();
    fireEvent.click(screen.getByRole("button", { name: "Open utility drawer" }));
    const drawer = screen.getByLabelText("Utility drawer");

    fireEvent.click(within(drawer).getByRole("tab", { name: "Runtime" }));
    expect(within(drawer).getByLabelText("MVP7 capability dashboard") || within(drawer).getByLabelText("Runtime panel")).toBeTruthy();
    for (const label of ["Files", "Terminal", "Browser", "Screenshot"]) {
      expect(within(drawer).getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(within(drawer).getAllByText(/blocked|fixture/i).length).toBeGreaterThan(3);
  });

  it("documents MVP7 regression, side-effect scan, and manual smoke", () => {
    const readme = readTextFile("../../README.md", "README.md");
    const scan = readTextFile("../../scripts/side-effect-scan.mjs", "scripts/side-effect-scan.mjs");
    const manual = readTextFile("../../docs/mvp7-manual-smoke.md", "docs/mvp7-manual-smoke.md");

    expect(readme).toContain("MVP9");
    expect(scan).toContain("mvp7-project-index-boundary");
    expect(scan).toContain("mvp7-capability-bridge-boundary");
    expect(manual).toContain("fixture://lyra");
  });
});

const mvp7Matrix = await runMvp7ScenarioMatrix();

describe("MVP7 runtime scenario matrix integration", () => {
  it("has 50 scenarios with 86+ assertions", () => {
    expect(mvp7Matrix.scenarios).toHaveLength(50);
    const total = mvp7Matrix.scenarios.reduce((s, sc) => s + sc.assertionCount, 0);
    expect(total).toBeGreaterThanOrEqual(86);
  });

  it.each(mvp7Matrix.scenarios)("$name ($assertionCount assertions)", ({ name, status }) => {
    expect(status, `${name} should pass`).toBe("pass");
  });
});
