import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SidebarFooter } from "./SidebarFooter";
import { UIProvider } from "../app/providers";

function renderFooter() {
  return render(
    <UIProvider>
      <SidebarFooter />
    </UIProvider>,
  );
}

describe("SidebarFooter", () => {
  it("renders Settings entry button", () => {
    renderFooter();
    expect(screen.getByLabelText("Open settings")).toBeTruthy();
  });

  it("renders Account placeholder disabled", () => {
    renderFooter();
    const accountBtn = screen.getByLabelText("Account (coming soon)") as HTMLButtonElement;
    expect(accountBtn).toBeTruthy();
    expect(accountBtn.disabled).toBe(true);
    expect(accountBtn.getAttribute("aria-disabled")).toBe("true");
  });

  it("renders version and status", () => {
    renderFooter();
    expect(screen.getByText("UAgent MVP0")).toBeTruthy();
    expect(screen.getByText("Local · No UE connected")).toBeTruthy();
  });
});
