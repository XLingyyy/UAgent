import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UIProvider } from "../app/providers";
import { TerminalPanel } from "./TerminalPanel";

function renderWithUI(component: React.ReactElement) {
  return render(<UIProvider>{component}</UIProvider>);
}

describe("TerminalPanel", () => {
  it("renders idle state with command input and propose button", () => {
    renderWithUI(<TerminalPanel />);
    expect(screen.getByPlaceholderText("Enter a command...")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Propose command" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quick action: pnpm typecheck" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quick action: pnpm lint" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quick action: pnpm test" })).toBeTruthy();
    expect(screen.getByText("No active proposal")).toBeTruthy();
  });

  it("quick action button creates proposal", () => {
    renderWithUI(<TerminalPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Quick action: pnpm typecheck" }));
    expect(screen.getByLabelText("Terminal proposal")).toBeTruthy();
    expect(screen.getByText("Command Proposal")).toBeTruthy();
    expect(screen.getByText("pnpm typecheck")).toBeTruthy();
  });

  it("proposal state shows risk classification", () => {
    renderWithUI(<TerminalPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Quick action: pnpm typecheck" }));
    const riskEl = screen.getByText(/allowlisted/);
    expect(riskEl).toBeTruthy();
  });

  it("approve button triggers execution", async () => {
    renderWithUI(<TerminalPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Quick action: pnpm typecheck" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve and execute command" }));

    expect(screen.getByText("Running...")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel execution" })).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("Completed")).toBeTruthy();
    });

    expect(screen.getByRole("button", { name: "Clear terminal" })).toBeTruthy();
  });

  it("reject button shows rejected state", () => {
    renderWithUI(<TerminalPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Quick action: pnpm typecheck" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject command proposal" }));

    expect(screen.getByText("Rejected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset terminal" })).toBeTruthy();
  });

  it("executing state shows output chunks", async () => {
    renderWithUI(<TerminalPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Quick action: pnpm typecheck" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve and execute command" }));

    await waitFor(() => {
      expect(screen.getByText("Completed")).toBeTruthy();
    });

    expect(screen.getByText(/\[fixture\] Dry-run/)).toBeTruthy();
    expect(screen.getByText(/TypeScript check passed/)).toBeTruthy();
  });

  it("cancel button works during execution", async () => {
    renderWithUI(<TerminalPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Quick action: pnpm typecheck" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve and execute command" }));

    expect(screen.getByText("Running...")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel execution" }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Enter a command...")).toBeTruthy();
    }, { timeout: 3000 });
  });
});
