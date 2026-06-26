import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ComingSoonGate } from "./ComingSoonGate";

describe("ComingSoonGate", () => {
  it("keeps the child visible and annotates it with phase tooltip copy", () => {
    render(
      <ComingSoonGate phase="MVP2" reason="Plugin marketplace and install flow.">
        <button type="button">Plugins</button>
      </ComingSoonGate>,
    );

    const trigger = screen.getByRole("button", { name: "Plugins" });
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute("aria-disabled")).toBe("true");
    expect(trigger.getAttribute("title")).toBe(
      "Coming in MVP2: Plugin marketplace and install flow.",
    );
  });

  it("renders tooltip element with role and aria-describedby linkage", () => {
    render(
      <ComingSoonGate phase="MVP2" reason="Plugin marketplace and install flow.">
        <button type="button">Plugins</button>
      </ComingSoonGate>,
    );

    const trigger = screen.getByRole("button", { name: "Plugins" });
    const tooltip = screen.getByRole("tooltip");

    expect(tooltip).toBeTruthy();
    expect(tooltip.textContent).toBe("Coming in MVP2: Plugin marketplace and install flow.");
    expect(trigger.getAttribute("aria-describedby")).toBe(tooltip.id);
    expect(tooltip.id).toMatch(/^ua-coming-soon-tooltip-/);
  });

  it("uses unique tooltip ids when multiple gates render together", () => {
    render(
      <>
        <ComingSoonGate phase="MVP1" reason="Future settings.">
          <button type="button">Settings</button>
        </ComingSoonGate>
        <ComingSoonGate phase="MVP2" reason="Plugin marketplace.">
          <button type="button">Plugins</button>
        </ComingSoonGate>
      </>,
    );

    const settingsTrigger = screen.getByRole("button", { name: "Settings" });
    const pluginsTrigger = screen.getByRole("button", { name: "Plugins" });
    const tooltips = screen.getAllByRole("tooltip");
    const tooltipIds = tooltips.map((tooltip) => tooltip.id);

    expect(tooltips).toHaveLength(2);
    expect(new Set(tooltipIds).size).toBe(2);
    expect(settingsTrigger.getAttribute("aria-describedby")).toBe(tooltipIds[0]);
    expect(pluginsTrigger.getAttribute("aria-describedby")).toBe(tooltipIds[1]);
  });

  it("keeps tooltip hidden by default and visible on hover", () => {
    render(
      <ComingSoonGate phase="MVP1" reason="Future settings.">
        <button type="button">HoverMe</button>
      </ComingSoonGate>,
    );

    const wrapper = screen.getByRole("button", { name: "HoverMe" }).parentElement!;
    const tooltip = screen.getByRole("tooltip");

    expect(tooltip).toBeTruthy();
    expect(wrapper.className).toContain("ua-coming-soon");
  });

  it("applies block-level display when blockChild is true", () => {
    render(
      <ComingSoonGate blockChild phase="MVP1" reason="Future settings.">
        <div>Block child</div>
      </ComingSoonGate>,
    );

    const wrapper = screen.getByText("Block child").parentElement!;
    expect(wrapper.className).toContain("ua-coming-soon");
    expect(wrapper.getAttribute("data-coming-soon-block")).toBe("");
  });

  it("omits data-coming-soon-block attribute when blockChild is not set", () => {
    render(
      <ComingSoonGate phase="MVP1" reason="Future settings.">
        <button type="button">Inline child</button>
      </ComingSoonGate>,
    );

    const wrapper = screen.getByRole("button", { name: "Inline child" }).parentElement!;
    expect(wrapper.className).toContain("ua-coming-soon");
    expect(wrapper.getAttribute("data-coming-soon-block")).toBeNull();
  });

  it("blocks click, Enter, and Space activation", () => {
    const onClick = vi.fn();
    render(
      <ComingSoonGate phase="MVP1" reason="Future settings-backed permissions.">
        <button type="button" onClick={onClick}>
          Custom
        </button>
      </ComingSoonGate>,
    );

    const trigger = screen.getByRole("button", { name: "Custom" });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.keyDown(trigger, { key: " " });

    expect(onClick).not.toHaveBeenCalled();
  });
});
