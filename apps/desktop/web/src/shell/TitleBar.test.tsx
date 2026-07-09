import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
          pill.textContent?.startsWith("UE Editor:"),
        ),
      ).toBe(true);

      const css = readFileSync("web/src/shell/TitleBar.css", "utf8");
      expect(css).toMatch(/\.ua-titlebar__status\s*\{[^}]*overflow:\s*hidden;/s);
      expect(css).toMatch(/\.ua-titlebar__status-pill\s*\{[^}]*text-overflow:\s*ellipsis;/s);
      expect(css).toMatch(/\.ua-titlebar__controls\s*\{[^}]*flex:\s*0\s+0\s+auto;/s);
    });
  });
});
