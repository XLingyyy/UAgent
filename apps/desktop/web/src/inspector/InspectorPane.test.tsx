import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InspectorPane } from "./InspectorPane";
import { reviewFindings, diagnosticSummary } from "./inspector-data";

function renderInspector(open = true, onClose?: () => void) {
  return render(<InspectorPane open={open} onClose={onClose} />);
}

describe("InspectorPane", () => {
  it("renders with open class when open=true", () => {
    const { container } = renderInspector(true);
    const aside = container.querySelector(".ua-inspector");
    expect(aside?.classList.contains("ua-inspector--open")).toBe(true);
    expect(aside?.getAttribute("aria-hidden")).toBe("false");
  });

  it("renders with closed class when open=false", () => {
    const { container } = renderInspector(false);
    const aside = container.querySelector(".ua-inspector");
    expect(aside?.classList.contains("ua-inspector--closed")).toBe(true);
    expect(aside?.getAttribute("aria-hidden")).toBe("true");
  });

  it("shows a close button when onClose is provided", () => {
    renderInspector(true, () => {});
    expect(screen.getByLabelText("Close inspector")).toBeTruthy();
  });

  it("does not show a close button when onClose is omitted", () => {
    renderInspector(true);
    expect(screen.queryByLabelText("Close inspector")).toBeNull();
  });

  describe("tabs", () => {
    it("renders Review and Diagnostics tabs with tablist semantics", () => {
      renderInspector();
      const tablist = screen.getByRole("tablist", { name: "Inspector tabs" });
      expect(tablist).toBeTruthy();

      const tabs = screen.getAllByRole("tab");
      expect(tabs).toHaveLength(2);
      expect(tabs[0].textContent).toBe("Review");
      expect(tabs[1].textContent).toBe("Diagnostics");
    });

    it("marks Review as the default active tab", () => {
      renderInspector();
      const reviewTab = screen.getByRole("tab", { name: "Review" });
      expect(reviewTab.getAttribute("aria-selected")).toBe("true");
      expect(reviewTab.classList.contains("ua-inspector__tab--active")).toBe(true);
    });

    it("marks Diagnostics as not selected by default", () => {
      renderInspector();
      const diagTab = screen.getByRole("tab", { name: "Diagnostics" });
      expect(diagTab.getAttribute("aria-selected")).toBe("false");
    });

    it("switches to Diagnostics tab on click", () => {
      renderInspector();
      const diagTab = screen.getByRole("tab", { name: "Diagnostics" });
      fireEvent.click(diagTab);
      expect(diagTab.getAttribute("aria-selected")).toBe("true");
      expect(diagTab.classList.contains("ua-inspector__tab--active")).toBe(true);
      expect(screen.getByRole("tab", { name: "Review" }).getAttribute("aria-selected")).toBe(
        "false",
      );
    });

    it("switches back to Review tab from Diagnostics", () => {
      renderInspector();
      const diagTab = screen.getByRole("tab", { name: "Diagnostics" });
      fireEvent.click(diagTab);
      const reviewTab = screen.getByRole("tab", { name: "Review" });
      fireEvent.click(reviewTab);
      expect(reviewTab.getAttribute("aria-selected")).toBe("true");
      expect(diagTab.getAttribute("aria-selected")).toBe("false");
    });
  });

  describe("ReviewPanel", () => {
    it("renders review summary cards", () => {
      renderInspector();
      const panel = screen.getByLabelText("Review panel");
      expect(panel).toBeTruthy();
      expect(screen.getByText("Review: Mock ready")).toBeTruthy();
      expect(screen.getByText("No blocking issues")).toBeTruthy();
    });

    it("renders the Findings section with at least 2 findings", () => {
      renderInspector();
      expect(screen.getByText("Findings")).toBeTruthy();
      const articles = screen.getAllByRole("article");
      expect(articles.length).toBeGreaterThanOrEqual(2);
    });

    it("renders finding severities from mock data", () => {
      renderInspector();
      for (const finding of reviewFindings) {
        expect(screen.getByText(finding.title)).toBeTruthy();
      }
      expect(screen.getByText("Passed")).toBeTruthy();
      expect(screen.getAllByText("Info").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Warning")).toBeTruthy();
    });

    it("renders the evidence checklist section", () => {
      renderInspector();
      expect(screen.getByText("Evidence checklist")).toBeTruthy();
      expect(screen.getByText("Mock evidence", { exact: false })).toBeTruthy();
      expect(screen.getByText("Workspace skeleton render")).toBeTruthy();
      expect(screen.getByText("Sidebar nav & project tree")).toBeTruthy();
      expect(screen.getByText("No real UE/MCP/LLM calls")).toBeTruthy();
      expect(screen.getByText("Dark theme tokens applied")).toBeTruthy();
    });
  });

  describe("DiagnosticsPanel", () => {
    it("renders Diagnostics panel after tab switch", () => {
      renderInspector();
      fireEvent.click(screen.getByRole("tab", { name: "Diagnostics" }));
      const panel = screen.getByLabelText("Diagnostics panel");
      expect(panel).toBeTruthy();
    });

    it("shows diagnostic summary status", () => {
      renderInspector();
      fireEvent.click(screen.getByRole("tab", { name: "Diagnostics" }));
      expect(screen.getByText("Mock diagnostics — no live runtime")).toBeTruthy();
    });

    it("renders the Runtime health section with diagnostic items", () => {
      renderInspector();
      fireEvent.click(screen.getByRole("tab", { name: "Diagnostics" }));
      expect(screen.getByText("Runtime health")).toBeTruthy();
      for (const item of diagnosticSummary.items) {
        expect(screen.getByText(item.label)).toBeTruthy();
        expect(screen.getByText(item.state)).toBeTruthy();
        expect(screen.getByText(item.description)).toBeTruthy();
      }
    });

    it("shows UE Not connected and Verifier Offline states", () => {
      renderInspector();
      fireEvent.click(screen.getByRole("tab", { name: "Diagnostics" }));
      expect(screen.getByText("Not connected")).toBeTruthy();
      expect(screen.getByText("Offline")).toBeTruthy();
      expect(screen.getByText("None")).toBeTruthy();
      expect(screen.getByText("Not accessed")).toBeTruthy();
    });

    it("switches back to Review panel and hides Diagnostics content", () => {
      renderInspector();
      fireEvent.click(screen.getByRole("tab", { name: "Diagnostics" }));
      expect(screen.getByLabelText("Diagnostics panel")).toBeTruthy();

      fireEvent.click(screen.getByRole("tab", { name: "Review" }));
      expect(screen.queryByLabelText("Diagnostics panel")).toBeNull();
      expect(screen.getByLabelText("Review panel")).toBeTruthy();
    });
  });

  describe("close button behavior", () => {
    it("calls onClose when close button is clicked", () => {
      let closed = false;
      renderInspector(true, () => {
        closed = true;
      });
      fireEvent.click(screen.getByLabelText("Close inspector"));
      expect(closed).toBe(true);
    });
  });

  describe("forbidden content", () => {
    it("does not render microphone, voice, or record controls", () => {
      const { container } = renderInspector();
      const audioControls = container.querySelectorAll(
        '[aria-label*="mic" i], [aria-label*="voice" i], [aria-label*="record" i]',
      );
      expect(audioControls.length).toBe(0);
    });

    it("does not render real verifier execute, network, or file system controls", () => {
      const { container } = renderInspector();
      const execButtons = container.querySelectorAll(
        '[aria-label*="execute" i], [aria-label*="run verifier" i], [aria-label*="fetch" i], [aria-label*="upload" i]',
      );
      expect(execButtons.length).toBe(0);
      expect(container.querySelectorAll("form").length).toBe(0);
    });
  });
});
