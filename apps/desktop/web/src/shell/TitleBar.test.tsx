import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { TitleBar } from "./TitleBar";
import { UIProvider } from "../app/providers";

function renderTitleBar() {
  return render(
    <UIProvider>
      <TitleBar />
    </UIProvider>,
  );
}

describe("TitleBar", () => {
  describe("branding", () => {
    it("renders the application title", () => {
      renderTitleBar();
      expect(screen.getByText("UAgent")).toBeTruthy();
    });

    it("renders a custom title when provided", () => {
      render(
        <UIProvider>
          <TitleBar title="Custom" />
        </UIProvider>,
      );
      expect(screen.getByText("Custom")).toBeTruthy();
    });

    it("renders the MVP14 In Progress badge", () => {
      renderTitleBar();
      expect(screen.getByText("MVP14 In Progress")).toBeTruthy();
    });

    it("renders the Native FS OK badge", () => {
      renderTitleBar();
      expect(screen.getByText("Native FS OK")).toBeTruthy();
    });
  });

  describe("Tools button", () => {
    it("renders Tools as the utility pane entry", () => {
      renderTitleBar();
      const btn = screen.getByRole("button", { name: "Open utility drawer" });
      expect(btn).toBeTruthy();
      expect(btn.textContent).toContain("Tools");
    });

    it("has aria-pressed 'false' when tools are closed by default", () => {
      renderTitleBar();
      const btn = screen.getByRole("button", { name: "Open utility drawer" });
      expect(btn.getAttribute("aria-pressed")).toBe("false");
    });

    it("changes aria-label to 'Close utility drawer' and aria-pressed to 'true' after click", () => {
      renderTitleBar();
      const btn = screen.getByRole("button", { name: "Open utility drawer" });
      fireEvent.click(btn);

      const updatedBtn = screen.getByRole("button", { name: "Close utility drawer" });
      expect(updatedBtn).toBeTruthy();
      expect(updatedBtn.getAttribute("aria-pressed")).toBe("true");
    });

    it("toggles back to 'Open utility drawer' and aria-pressed 'false' on second click", () => {
      renderTitleBar();
      const btn = screen.getByRole("button", { name: "Open utility drawer" });
      fireEvent.click(btn);
      fireEvent.click(screen.getByRole("button", { name: "Close utility drawer" }));

      const updatedBtn = screen.getByRole("button", { name: "Open utility drawer" });
      expect(updatedBtn).toBeTruthy();
      expect(updatedBtn.getAttribute("aria-pressed")).toBe("false");
    });

    it("keeps status pills in a shrinkable region separate from the Tools hit target", () => {
      const { container } = renderTitleBar();
      const right = container.querySelector(".ua-titlebar__right");
      const status = container.querySelector(".ua-titlebar__status");
      const controls = container.querySelector(".ua-titlebar__controls");
      const btn = screen.getByRole("button", { name: "Open utility drawer" });

      expect(right).toBeTruthy();
      expect(status).toBeTruthy();
      expect(controls).toBeTruthy();
      expect(controls?.contains(btn)).toBe(true);
      expect(status?.contains(btn)).toBe(false);
      expect(
        Array.from(status?.querySelectorAll(".ua-titlebar__status-pill") ?? []).some((pill) =>
          pill.textContent?.startsWith("UE:"),
        ),
      ).toBe(true);

      const css = readFileSync("web/src/shell/TitleBar.css", "utf8");
      expect(css).toMatch(/\.ua-titlebar__status\s*\{[^}]*overflow:\s*hidden;/s);
      expect(css).toMatch(/\.ua-titlebar__status-pill\s*\{[^}]*text-overflow:\s*ellipsis;/s);
      expect(css).toMatch(/\.ua-titlebar__controls\s*\{[^}]*flex:\s*0\s+0\s+auto;/s);
    });

    it("renders short readable status pill labels, each with a full title tooltip", () => {
      const { container } = renderTitleBar();
      const pills = Array.from(
        container.querySelectorAll<HTMLElement>(".ua-titlebar__status-pill"),
      );

      // No pill should read as an unreadable ellipsis-truncated remnant.
      expect(pills.length).toBeGreaterThanOrEqual(6);
      for (const pill of pills) {
        const text = pill.textContent ?? "";
        // Each visible pill label is a complete short word (at least "Mock"),
        // never a 1-4 char fragment ending in an ellipsis truncation.
        expect(text.length).toBeGreaterThanOrEqual(4);
        expect(text.endsWith("...")).toBe(false);
      }

      // Each pill carries a full explanation via title for hover/AT access.
      for (const pill of pills) {
        const title = pill.getAttribute("title") ?? "";
        expect(title.length).toBeGreaterThan(0);
        expect(title.length).toBeGreaterThanOrEqual((pill.textContent ?? "").length);
      }

      // Specific short labels are present.
      const labels = pills.map((pill) => pill.textContent ?? "");
      expect(labels).toContain("Mock");
      expect(labels).toContain("MCP: RO");
      expect(labels).toContain("Provider: off");
      expect(labels).toContain("No net");
      expect(labels.some((label) => label.startsWith("Native FS"))).toBe(true);
      expect(labels.some((label) => label.startsWith("UE:"))).toBe(true);
    });

    it("tags pills with priority classes so low-priority entries hide as whole units", () => {
      const { container } = renderTitleBar();
      const pills = container.querySelectorAll(".ua-titlebar__status-pill");

      // Core summary pills are always shown.
      const keyPills = container.querySelectorAll(
        ".ua-titlebar__status-pill--key",
      );
      expect(keyPills.length).toBe(2);

      // Provider / No net are the lowest priority (drop first).
      const providerPill = Array.from(pills).find(
        (pill) => pill.textContent === "Provider: off",
      );
      const noNetPill = Array.from(pills).find(
        (pill) => pill.textContent === "No net",
      );
      expect(providerPill?.classList.contains("ua-titlebar__status-pill--p4")).toBe(true);
      expect(noNetPill?.classList.contains("ua-titlebar__status-pill--p4")).toBe(true);

      // UE and Native FS pills carry their own priority tiers.
      const uePill = Array.from(pills).find((pill) =>
        pill.textContent?.startsWith("UE:"),
      );
      const nativePill = Array.from(pills).find((pill) =>
        pill.textContent?.startsWith("Native FS"),
      );
      expect(uePill?.classList.contains("ua-titlebar__status-pill--p2")).toBe(true);
      expect(nativePill?.classList.contains("ua-titlebar__status-pill--p3")).toBe(true);
    });

    it("status-pill CSS refuses to shrink so flex pressure cannot fracture a label", () => {
      const css = readFileSync("web/src/shell/TitleBar.css", "utf8");
      // Pills must not shrink below content (`0 0 auto`), unlike the old
      // `0 1 auto` value that compressed them into "M..." fragments.
      expect(css).toMatch(
        /\.ua-titlebar__status-pill\s*\{[^}]*flex:\s*0\s+0\s+auto;/s,
      );
      expect(css).toMatch(/\.ua-titlebar__status-pill\s*\{[^}]*white-space:\s*nowrap;/s);
      // No max-width clamp shrinks a pill's text.
      expect(css).not.toMatch(/\.ua-titlebar__status-pill\s*\{[^}]*max-width:/s);
    });

    it("status CSS hides whole low-priority pills at narrow widths rather than clipping text", () => {
      const css = readFileSync("web/src/shell/TitleBar.css", "utf8");
      // Below 1700px the status slot shrinks below the full 6-pill total; to
      // avoid `justify-content: flex-end` + `overflow: hidden` clipping the
      // left edge, drop everything except the core key summary.
      expect(css).toMatch(
        /@media\s*\(max-width:\s*1700px\)\s*\{[^}]*\.ua-titlebar__status-pill--p4[\s\S]*?display:\s*none;/s,
      );
      expect(css).toMatch(
        /@media\s*\(max-width:\s*1700px\)\s*\{[\s\S]*?\.ua-titlebar__status-pill--p3[\s\S]*?display:\s*none;/s,
      );
      expect(css).toMatch(
        /@media\s*\(max-width:\s*1700px\)\s*\{[\s\S]*?\.ua-titlebar__status-pill--p2[\s\S]*?display:\s*none;/s,
      );
      // Core key pills are never individually hidden by responsive rules...
      expect(css).not.toMatch(/\.ua-titlebar__status-pill--key\s*\{[^}]*display:\s*none;/s);
    });

    it("status CSS hides the entire status summary at very narrow widths so no pill is left clipped by the parent", () => {
      const css = readFileSync("web/src/shell/TitleBar.css", "utf8");
      // When even the key summary (Mock + MCP: RO ≈ 106px) no longer fits in
      // the status slot, the whole region is hidden together (not left to be
      // parent-clipped on its left edge).
      expect(css).toMatch(
        /@media\s*\(max-width:\s*1200px\)\s*\{[^}]*\.ua-titlebar__status\s*\{[^}]*display:\s*none;/s,
      );
    });

    it("status container keeps overflow hidden so overflow never escapes into Tools/badges/window controls", () => {
      const css = readFileSync("web/src/shell/TitleBar.css", "utf8");
      expect(css).toMatch(/\.ua-titlebar__status\s*\{[^}]*overflow:\s*hidden;/s);
      // Status never overlaps the controls region: controls is a non-shrinking
      // flex item with min-width: max-content next to status.
      expect(css).toMatch(/\.ua-titlebar__controls\s*\{[^}]*flex:\s*0\s+0\s+auto;/s);
      expect(css).toMatch(/\.ua-titlebar__controls\s*\{[^}]*min-width:\s*max-content;/s);
    });
  });

  describe("window controls", () => {
    it("renders minimize, maximize/restore, and close buttons with aria-labels", () => {
      renderTitleBar();

      expect(screen.getByRole("button", { name: "Minimize window" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Maximize window" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Close window" })).toBeTruthy();
    });

    it("renders all buttons as type=button", () => {
      renderTitleBar();

      const minimize = screen.getByRole("button", { name: "Minimize window" });
      const maximize = screen.getByRole("button", { name: "Maximize window" });
      const close = screen.getByRole("button", { name: "Close window" });
      expect(minimize.getAttribute("type")).toBe("button");
      expect(maximize.getAttribute("type")).toBe("button");
      expect(close.getAttribute("type")).toBe("button");
    });

    it("renders window controls in a dedicated region separate from status and Tools", () => {
      const { container } = renderTitleBar();

      const controls = container.querySelector(".ua-titlebar__controls");
      const windowControls = container.querySelector(".ua-titlebar__window-controls");
      const status = container.querySelector(".ua-titlebar__status");
      expect(windowControls).toBeTruthy();

      const minimize = screen.getByRole("button", { name: "Minimize window" });
      const maximize = screen.getByRole("button", { name: "Maximize window" });
      const close = screen.getByRole("button", { name: "Close window" });

      // All three live in the window-controls region.
      expect(windowControls?.contains(minimize)).toBe(true);
      expect(windowControls?.contains(maximize)).toBe(true);
      expect(windowControls?.contains(close)).toBe(true);

      // window controls are not in the Tools controls or status region.
      expect(controls?.contains(minimize)).toBe(false);
      expect(controls?.contains(maximize)).toBe(false);
      expect(controls?.contains(close)).toBe(false);
      expect(status?.contains(minimize)).toBe(false);
      expect(status?.contains(maximize)).toBe(false);
      expect(status?.contains(close)).toBe(false);

      // Tools button still present and still inside .ua-titlebar__controls.
      const tools = screen.getByRole("button", { name: "Open utility drawer" });
      expect(controls?.contains(tools)).toBe(true);
    });

    it("clicking window control buttons does not throw when Tauri API is absent", () => {
      renderTitleBar();

      expect(() => {
        fireEvent.click(screen.getByRole("button", { name: "Minimize window" }));
        fireEvent.click(screen.getByRole("button", { name: "Maximize window" }));
        fireEvent.click(screen.getByRole("button", { name: "Close window" }));
      }).not.toThrow();
    });

    it("calls the Tauri window IPC when __TAURI_INTERNALS__ is mocked", async () => {
      const calls: string[] = [];
      const original = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
        invoke: async (command: string, args?: unknown) => {
          calls.push(`${command}:${JSON.stringify(args)}`);
          if (command === "plugin:window|is_maximized") return false;
          return undefined;
        },
      };

      try {
        renderTitleBar();

        fireEvent.click(screen.getByRole("button", { name: "Minimize window" }));
        fireEvent.click(screen.getByRole("button", { name: "Maximize window" }));
        fireEvent.click(screen.getByRole("button", { name: "Close window" }));

        // Let the async invokes flush.
        await Promise.resolve();
        await Promise.resolve();

        expect(calls).toContain('plugin:window|minimize:{"label":"main"}');
        expect(calls).toContain('plugin:window|maximize:{"label":"main"}');
        expect(calls).toContain('plugin:window|is_maximized:{"label":"main"}');
        expect(calls).toContain('plugin:window|close:{"label":"main"}');
      } finally {
        if (original === undefined) {
          delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
        } else {
          (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = original;
        }
      }
    });

    it("window-controls CSS has stable button sizing and a non-drag region separated from controls", () => {
      const css = readFileSync("web/src/shell/TitleBar.css", "utf8");
      expect(css).toMatch(/\.ua-titlebar__window-controls\s*\{[^}]*height:\s*var\(--ua-titlebar-height\);/s);
      expect(css).toMatch(/\.ua-titlebar__window-btn\s*\{[^}]*width:\s*44px;/s);
      expect(css).toMatch(/\.ua-titlebar__window-btn--close:hover[\s\S]*?background:\s*var\(--ua-danger\);/s);
    });

    it("restore icon CSS draws a stable, centered two-square glyph", () => {
      const css = readFileSync("web/src/shell/TitleBar.css", "utf8");
      expect(css).toMatch(/\.ua-titlebar__win-icon--restore::after\s*\{[^}]*border:\s*1\.5px\s+solid\s+currentColor;/s);
      expect(css).toMatch(/\.ua-titlebar__win-icon--restore::before\s*\{[^}]*border-top:\s*1\.5px\s+solid\s+currentColor;/s);
      // Front square fills with the titlebar background so it sits cleanly in
      // front of the back frame (no transparent overlap artifacts).
      expect(css).toMatch(/\.ua-titlebar__win-icon--restore::after\s*\{[^}]*background:\s*var\(--ua-bg-sidebar\);/s);
    });

    it("swaps the maximize/restore aria-label and icon class to restore when the window reports maximized", async () => {
      const original = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
        invoke: async (command: string) => {
          if (command === "plugin:window|is_maximized") return true;
          return undefined;
        },
      };

      try {
        renderTitleBar();
        // Let the initial is_maximized probe resolve and flip state.
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });

        const restoreBtn = screen.getByRole("button", { name: "Restore window" });
        const icon = restoreBtn.querySelector(".ua-titlebar__win-icon");
        expect(icon?.classList.contains("ua-titlebar__win-icon--restore")).toBe(true);
        expect(icon?.classList.contains("ua-titlebar__win-icon--maximize")).toBe(false);

        // Toggle: maximized -> unmaximize, then re-probe returns false -> back to maximize.
        (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
          invoke: async (command: string) => {
            if (command === "plugin:window|is_maximized") return false;
            return undefined;
          },
        };
        fireEvent.click(restoreBtn);
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });

        const maximizeBtn = screen.getByRole("button", { name: "Maximize window" });
        const iconAfter = maximizeBtn.querySelector(".ua-titlebar__win-icon");
        expect(iconAfter?.classList.contains("ua-titlebar__win-icon--maximize")).toBe(true);
        expect(iconAfter?.classList.contains("ua-titlebar__win-icon--restore")).toBe(false);
      } finally {
        if (original === undefined) {
          delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
        } else {
          (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = original;
        }
      }
    });

    it("window-controls are not flagged as part of the tauri drag region", () => {
      const { container } = renderTitleBar();
      const windowControls = container.querySelector(".ua-titlebar__window-controls");
      expect(windowControls?.hasAttribute("data-tauri-drag-region")).toBe(false);

      const buttons = windowControls?.querySelectorAll("button");
      expect(buttons?.length).toBe(3);
      for (const btn of Array.from(buttons ?? [])) {
        expect(btn.hasAttribute("data-tauri-drag-region")).toBe(false);
      }
    });
  });
});
