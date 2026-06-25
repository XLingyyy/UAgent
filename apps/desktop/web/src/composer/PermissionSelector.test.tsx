import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PermissionSelector } from "./PermissionSelector";
import type { ComposerPermission } from "./composer-data";

function renderSelector(value: ComposerPermission = "request-approval") {
  const onChange = vi.fn();
  const result = render(<PermissionSelector value={value} onChange={onChange} />);
  return { ...result, onChange };
}

function openDropdown() {
  fireEvent.click(screen.getByLabelText("Permission mode: Request approval"));
}

describe("PermissionSelector", () => {
  it("renders the trigger with the current permission label", () => {
    renderSelector("request-approval");
    expect(screen.getByLabelText("Permission mode: Request approval")).toBeTruthy();
  });

  it("renders the trigger with Full access label when selected", () => {
    renderSelector("full-access");
    const trigger = screen.getByLabelText("Permission mode: Full access");
    expect(trigger).toBeTruthy();
    expect(trigger.className).toContain("trigger--warning");
  });

  it("renders the trigger with Auto approve label when selected", () => {
    renderSelector("auto-approve");
    expect(screen.getByLabelText("Permission mode: Auto approve")).toBeTruthy();
  });

  it("opens the dropdown on trigger click", () => {
    renderSelector();
    openDropdown();
    const dropdown = screen.getByRole("listbox", { name: "Permission mode" });
    expect(dropdown).toBeTruthy();
  });

  it("shows four permission options in the dropdown", () => {
    renderSelector();
    openDropdown();
    const options = screen.getAllByRole("option");
    expect(options.length).toBe(4);

    const labels = options.map((o) => o.textContent ?? "");
    expect(labels.some((l) => l.includes("Request approval"))).toBe(true);
    expect(labels.some((l) => l.includes("Auto approve"))).toBe(true);
    expect(labels.some((l) => l.includes("Full access"))).toBe(true);
    expect(labels.some((l) => l.includes("Custom"))).toBe(true);
  });

  it("marks the current selected item with aria-selected", () => {
    renderSelector("request-approval");
    openDropdown();
    const options = screen.getAllByRole("option");
    const selected = options.find((o) => o.getAttribute("aria-selected") === "true");
    expect(selected).toBeTruthy();
    expect(selected?.textContent).toContain("Request approval");
  });

  it("shows a checkmark on the selected item", () => {
    renderSelector("request-approval");
    openDropdown();
    const options = screen.getAllByRole("option");
    const requestOption = options.find((o) => o.textContent?.includes("Request approval"));
    expect(requestOption).toBeTruthy();
    const check = requestOption!.querySelector(".ua-permission-selector__item-check");
    expect(check?.textContent?.trim()).toBe("\u2713");
  });

  it("selects Auto approve and closes dropdown on click", async () => {
    const { onChange } = renderSelector("request-approval");
    openDropdown();

    const autoOption = screen
      .getAllByRole("option")
      .find((o) => o.textContent?.includes("Auto approve"));
    fireEvent.click(autoOption!);

    expect(onChange).toHaveBeenCalledWith("auto-approve");

    await vi.waitFor(() => {
      expect(screen.queryByRole("listbox")).toBeNull();
    });
  });

  it("shows confirmation when Full access is clicked instead of direct switch", () => {
    const { onChange } = renderSelector("request-approval");
    openDropdown();

    const fullOption = screen
      .getAllByRole("option")
      .find((o) => o.textContent?.includes("Full access"));
    fireEvent.click(fullOption!);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("Confirm mock mode")).toBeTruthy();
  });

  it("displays MVP0 mock only warning in Full access confirmation", () => {
    renderSelector("request-approval");
    openDropdown();

    const fullOption = screen
      .getAllByRole("option")
      .find((o) => o.textContent?.includes("Full access"));
    fireEvent.click(fullOption!);

    const confirmation = screen.getByRole("listbox");
    expect(confirmation.textContent).toContain("MVP0 mock only");
    expect(confirmation.textContent).toContain("No runtime permission is changed");
    expect(confirmation.textContent).toContain("No filesystem");
  });

  it("confirms Full access and calls onChange only on confirm", async () => {
    const { onChange } = renderSelector("request-approval");
    openDropdown();

    fireEvent.click(
      screen.getAllByRole("option").find((o) => o.textContent?.includes("Full access"))!,
    );
    fireEvent.click(screen.getByText("Confirm mock mode"));

    expect(onChange).toHaveBeenCalledWith("full-access");

    await vi.waitFor(() => {
      expect(screen.queryByRole("listbox")).toBeNull();
    });
  });

  it("cancels Full access confirmation and returns to option list", () => {
    renderSelector("request-approval");
    openDropdown();

    fireEvent.click(
      screen.getAllByRole("option").find((o) => o.textContent?.includes("Full access"))!,
    );
    fireEvent.click(screen.getByText("Cancel"));

    expect(screen.getAllByRole("option").length).toBe(4);
  });

  it("does not call onChange when Custom is clicked (disabled)", () => {
    const { onChange } = renderSelector("request-approval");
    openDropdown();

    const customOption = screen
      .getAllByRole("option")
      .find((o) => o.textContent?.includes("Custom"));
    fireEvent.click(customOption!);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("marks Custom as disabled with future settings description", () => {
    renderSelector("request-approval");
    openDropdown();

    const customOption = screen
      .getAllByRole("option")
      .find((o) => o.textContent?.includes("Custom"));
    expect(customOption).toBeTruthy();
    expect(customOption!.getAttribute("aria-disabled")).toBe("true");
    expect(customOption!.textContent).toContain("Future settings-backed permissions");
    expect(customOption!.getAttribute("title")).toBe(
      "Coming in MVP1: Future settings-backed permissions",
    );
  });

  it("closes the dropdown on Escape key", async () => {
    renderSelector();
    openDropdown();
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    await vi.waitFor(() => {
      expect(screen.queryByRole("listbox")).toBeNull();
    });
  });

  it("closes the dropdown when trigger is clicked again", async () => {
    renderSelector();
    openDropdown();
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Permission mode: Request approval"));

    await vi.waitFor(() => {
      expect(screen.queryByRole("listbox")).toBeNull();
    });
  });

  it("does not render microphone, voice, or record controls", () => {
    renderSelector();
    openDropdown();

    const allElements = document.querySelectorAll("*");
    allElements.forEach((el) => {
      const label = (el.getAttribute("aria-label") ?? "").toLowerCase();
      expect(label).not.toMatch(/mic|voice|record|麦克风|语音/);
    });

    const { container: baseContainer } = renderSelector();
    expect(baseContainer.textContent).not.toMatch(/microphone|麦克风|语音/i);
  });

  it("does not contain real execution or network entry points", () => {
    renderSelector();
    openDropdown();

    const dropdownHtml = document.body.innerHTML;
    expect(dropdownHtml).not.toMatch(/fetch\s*\(/);
    expect(dropdownHtml).not.toMatch(/XMLHttpRequest/);
    expect(dropdownHtml).not.toMatch(/EventSource/);
    expect(dropdownHtml).not.toMatch(/WebSocket/);
  });

  it("sets aria-expanded on the trigger when open and closed", () => {
    renderSelector();
    const trigger = screen.getByLabelText("Permission mode: Request approval");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps the dropdown inside a narrow viewport", async () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;

    try {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 430 });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 760 });

      renderSelector();
      const trigger = screen.getByLabelText("Permission mode: Request approval");
      vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
        x: 296,
        y: 511,
        left: 296,
        top: 511,
        right: 410,
        bottom: 535,
        width: 114,
        height: 24,
        toJSON: () => ({}),
      } as DOMRect);

      fireEvent.click(trigger);

      await vi.waitFor(() => {
        const dropdown = screen.getByRole("listbox", { name: "Permission mode" });
        expect(Number.parseFloat((dropdown as HTMLElement).style.left)).toBe(118);
      });
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalHeight });
    }
  });
});
