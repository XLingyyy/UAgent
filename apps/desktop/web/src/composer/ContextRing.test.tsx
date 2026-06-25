import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContextRing } from "./ContextRing";

describe("ContextRing", () => {
  it("renders the percentage text", () => {
    render(<ContextRing used={2400} total={20000} percent={12} />);

    expect(screen.getByText("12%")).toBeTruthy();
  });

  it("shows full tooltip with used, total, percent, and remaining", () => {
    render(<ContextRing used={2400} total={20000} percent={12} />);

    const ring = screen.getByText("12%").closest(".ua-context-ring")!;
    const title = ring.getAttribute("title");
    expect(title).toContain("2,400");
    expect(title).toContain("20,000");
    expect(title).toContain("12%");
    expect(title).toContain("88% remaining");
  });

  it("sets aria-label with full tooltip", () => {
    render(<ContextRing used={2400} total={20000} percent={12} />);

    const ring = screen.getByText("12%").closest(".ua-context-ring")!;
    const ariaLabel = ring.getAttribute("aria-label");
    expect(ariaLabel).toContain("2,400");
    expect(ariaLabel).toContain("20,000");
    expect(ariaLabel).toContain("12%");
    expect(ariaLabel).toContain("88% remaining");
  });

  it("renders SVG with circle elements", () => {
    render(<ContextRing used={2400} total={20000} percent={12} />);

    const ring = screen.getByText("12%").closest(".ua-context-ring")!;
    const svg = ring.querySelector("svg");
    expect(svg).toBeTruthy();

    const circles = svg!.querySelectorAll("circle");
    expect(circles.length).toBe(2);

    const progress = circles[1];
    expect(progress.getAttribute("stroke-dasharray")).toBeTruthy();
    expect(progress.getAttribute("stroke-dashoffset")).toBeTruthy();
  });

  it("applies normal status class for percent <= 60", () => {
    render(<ContextRing used={1200} total={20000} percent={6} />);

    const ring = screen.getByText("6%").closest(".ua-context-ring")!;
    expect(ring.classList.contains("ua-context-ring--normal")).toBe(true);
    expect(ring.getAttribute("data-context-status")).toBe("normal");
  });

  it("applies attention status class for percent between 61 and 85", () => {
    render(<ContextRing used={14000} total={20000} percent={70} />);

    const ring = screen.getByText("70%").closest(".ua-context-ring")!;
    expect(ring.classList.contains("ua-context-ring--attention")).toBe(true);
    expect(ring.getAttribute("data-context-status")).toBe("attention");
  });

  it("applies warning status class for percent above 85", () => {
    render(<ContextRing used={18400} total={20000} percent={92} />);

    const ring = screen.getByText("92%").closest(".ua-context-ring")!;
    expect(ring.classList.contains("ua-context-ring--warning")).toBe(true);
    expect(ring.getAttribute("data-context-status")).toBe("warning");
  });

  it("handles 0% correctly", () => {
    render(<ContextRing used={0} total={20000} percent={0} />);

    const ring = screen.getByText("0%").closest(".ua-context-ring")!;
    expect(ring.classList.contains("ua-context-ring--normal")).toBe(true);
  });

  it("handles 100% with warning status", () => {
    render(<ContextRing used={20000} total={20000} percent={100} />);

    const ring = screen.getByText("100%").closest(".ua-context-ring")!;
    expect(ring.classList.contains("ua-context-ring--warning")).toBe(true);
    expect(ring.getAttribute("data-context-status")).toBe("warning");
  });

  it("handles boundary values: 60% is normal", () => {
    render(<ContextRing used={12000} total={20000} percent={60} />);

    const ring = screen.getByText("60%").closest(".ua-context-ring")!;
    expect(ring.classList.contains("ua-context-ring--normal")).toBe(true);
  });

  it("handles boundary values: 61% is attention", () => {
    render(<ContextRing used={12200} total={20000} percent={61} />);

    const ring = screen.getByText("61%").closest(".ua-context-ring")!;
    expect(ring.classList.contains("ua-context-ring--attention")).toBe(true);
  });

  it("handles boundary values: 85% is attention", () => {
    render(<ContextRing used={17000} total={20000} percent={85} />);

    const ring = screen.getByText("85%").closest(".ua-context-ring")!;
    expect(ring.classList.contains("ua-context-ring--attention")).toBe(true);
  });

  it("handles boundary values: 86% is warning", () => {
    render(<ContextRing used={17200} total={20000} percent={86} />);

    const ring = screen.getByText("86%").closest(".ua-context-ring")!;
    expect(ring.classList.contains("ua-context-ring--warning")).toBe(true);
  });

  it("formats large numbers with commas", () => {
    render(<ContextRing used={150000} total={1000000} percent={15} />);

    const ring = screen.getByText("15%").closest(".ua-context-ring")!;
    const title = ring.getAttribute("title")!;
    expect(title).toContain("150,000");
    expect(title).toContain("1,000,000");
  });
});
