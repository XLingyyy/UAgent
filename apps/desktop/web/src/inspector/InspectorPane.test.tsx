import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InspectorPane } from "./InspectorPane";

describe("InspectorPane", () => {
  it("renders with open class when open=true", () => {
    const { container } = render(<InspectorPane open={true} />);
    const aside = container.querySelector(".ua-inspector");
    expect(aside?.classList.contains("ua-inspector--open")).toBe(true);
    expect(aside?.getAttribute("aria-hidden")).toBe("false");
  });

  it("renders with closed class when open=false", () => {
    const { container } = render(<InspectorPane open={false} />);
    const aside = container.querySelector(".ua-inspector");
    expect(aside?.classList.contains("ua-inspector--closed")).toBe(true);
    expect(aside?.getAttribute("aria-hidden")).toBe("true");
  });

  it("shows a close button when onClose is provided", () => {
    render(<InspectorPane open={true} onClose={() => {}} />);
    expect(screen.getByLabelText("Close inspector")).toBeTruthy();
  });

  it("does not show a close button when onClose is omitted", () => {
    render(<InspectorPane open={true} />);
    expect(screen.queryByLabelText("Close inspector")).toBeNull();
  });
});
