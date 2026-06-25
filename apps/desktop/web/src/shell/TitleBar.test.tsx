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

    it("renders the MVP0 badge", () => {
      renderTitleBar();
      expect(screen.getByText("MVP0")).toBeTruthy();
    });
  });

  describe("Inspect button", () => {
    it("has aria-label 'Close inspector' when inspector is open by default", () => {
      renderTitleBar();
      const btn = screen.getByRole("button", { name: "Close inspector" });
      expect(btn).toBeTruthy();
    });

    it("has aria-pressed 'true' when inspector is open by default", () => {
      renderTitleBar();
      const btn = screen.getByRole("button", { name: "Close inspector" });
      expect(btn.getAttribute("aria-pressed")).toBe("true");
    });

    it("changes aria-label to 'Open inspector' and aria-pressed to 'false' after click", () => {
      renderTitleBar();
      const btn = screen.getByRole("button", { name: "Close inspector" });
      fireEvent.click(btn);

      const updatedBtn = screen.getByRole("button", { name: "Open inspector" });
      expect(updatedBtn).toBeTruthy();
      expect(updatedBtn.getAttribute("aria-pressed")).toBe("false");
    });

    it("toggles back to 'Close inspector' and aria-pressed 'true' on second click", () => {
      renderTitleBar();
      const btn = screen.getByRole("button", { name: "Close inspector" });
      fireEvent.click(btn);
      fireEvent.click(screen.getByRole("button", { name: "Open inspector" }));

      const updatedBtn = screen.getByRole("button", { name: "Close inspector" });
      expect(updatedBtn).toBeTruthy();
      expect(updatedBtn.getAttribute("aria-pressed")).toBe("true");
    });
  });
});
