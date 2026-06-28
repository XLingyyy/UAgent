import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

    it("renders the MVP9 Prep badge", () => {
      renderTitleBar();
      expect(screen.getByText("MVP9 Prep")).toBeTruthy();
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
  });
});
