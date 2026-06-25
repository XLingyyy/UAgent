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
