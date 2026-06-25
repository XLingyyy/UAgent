import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useMotionKey } from "./useMotionKey";

function Probe() {
  const [mode, setMode] = useState<"app" | "settings">("app");
  const motionKey = useMotionKey(mode);

  return (
    <div>
      <span data-testid="motion-key">{motionKey}</span>
      <button type="button" onClick={() => setMode("settings")}>
        switch
      </button>
    </div>
  );
}

describe("useMotionKey", () => {
  it("increments when the tracked value changes", () => {
    render(<Probe />);

    expect(screen.getByTestId("motion-key").textContent).toBe("0");
    fireEvent.click(screen.getByText("switch"));
    expect(screen.getByTestId("motion-key").textContent).toBe("1");
  });
});
