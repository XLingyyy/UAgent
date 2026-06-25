import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectSelector } from "./ProjectSelector";
import { MOCK_PROJECTS } from "../project/project-data";

function renderSelector(value: string | null = "lyra") {
  const onChange = vi.fn();
  const result = render(
    <ProjectSelector value={value} projects={MOCK_PROJECTS} onChange={onChange} />,
  );
  return { ...result, onChange };
}

function openDropdown(triggerLabel = "Project selector: Lyra_Prototype") {
  fireEvent.click(screen.getByLabelText(triggerLabel));
}

describe("ProjectSelector", () => {
  it("renders the trigger with the default project Lyra_Prototype", () => {
    renderSelector("lyra");
    expect(screen.getByLabelText("Project selector: Lyra_Prototype")).toBeTruthy();
  });

  it("renders the trigger with No project when value is null", () => {
    renderSelector(null);
    expect(screen.getByLabelText("Project selector: No project")).toBeTruthy();
    const trigger = screen.getByLabelText("Project selector: No project");
    expect(trigger.className).toContain("trigger--empty");
  });

  it("opens the dropdown on trigger click", () => {
    renderSelector();
    openDropdown();
    const dropdown = screen.getByRole("listbox", { name: "Select project" });
    expect(dropdown).toBeTruthy();
    expect(dropdown.getAttribute("data-motion")).toBe("layer");
  });

  it("renders the search input in the dropdown", () => {
    renderSelector();
    openDropdown();
    expect(screen.getByPlaceholderText("Search projects")).toBeTruthy();
  });

  it("shows three mock projects in the dropdown", () => {
    renderSelector();
    openDropdown();

    const options = screen.getAllByRole("option");
    const projectOptions = options.filter((o) => o.getAttribute("aria-disabled") !== "true");

    const names = projectOptions.map((o) => o.textContent ?? "");
    expect(names.some((n) => n.includes("Lyra_Prototype"))).toBe(true);
    expect(names.some((n) => n.includes("MechArena_Testbed"))).toBe(true);
    expect(names.some((n) => n.includes("CitySample_Sandbox"))).toBe(true);
  });

  it("shows project metadata: engine version, connection status, and path", () => {
    renderSelector();
    openDropdown();

    const options = screen.getAllByRole("option");
    const lyra = options.find((o) => o.textContent?.includes("Lyra_Prototype"));
    expect(lyra).toBeTruthy();
    expect(lyra!.textContent).toContain("UE 5.8");
    expect(lyra!.textContent).toContain("Not connected");
    expect(lyra!.textContent).toContain("Lyra_Prototype");
  });

  it("marks the current selected project with aria-selected", () => {
    renderSelector("lyra");
    openDropdown();

    const options = screen.getAllByRole("option");
    const selected = options.find((o) => o.getAttribute("aria-selected") === "true");
    expect(selected).toBeTruthy();
    expect(selected!.textContent).toContain("Lyra_Prototype");
  });

  it("shows a checkmark on the selected project", () => {
    renderSelector("lyra");
    openDropdown();

    const options = screen.getAllByRole("option");
    const lyra = options.find((o) => o.textContent?.includes("Lyra_Prototype"));
    expect(lyra).toBeTruthy();
    const check = lyra!.querySelector(".ua-project-selector__item-check");
    expect(check?.textContent?.trim()).toBe("\u2713");
  });

  it("selects another mock project and closes dropdown", async () => {
    const { onChange } = renderSelector("lyra");
    openDropdown();

    const options = screen.getAllByRole("option");
    const mech = options.find((o) => o.textContent?.includes("MechArena_Testbed"));
    fireEvent.click(mech!);

    expect(onChange).toHaveBeenCalledWith("mech");

    await vi.waitFor(() => {
      expect(screen.queryByRole("listbox")).toBeNull();
    });
  });

  it("selects No project and closes dropdown", async () => {
    const { onChange } = renderSelector("lyra");
    openDropdown();

    const options = screen.getAllByRole("option");
    const noneOption = options.find((o) => o.textContent?.includes("No project"));
    fireEvent.click(noneOption!);

    expect(onChange).toHaveBeenCalledWith(null);

    await vi.waitFor(() => {
      expect(screen.queryByRole("listbox")).toBeNull();
    });
  });

  it("shows No project option", () => {
    renderSelector();
    openDropdown();

    const options = screen.getAllByRole("option");
    const noneOption = options.find((o) => o.textContent?.includes("No project"));
    expect(noneOption).toBeTruthy();
    expect(noneOption!.textContent).toContain("Use no project");
  });

  it("marks No project with aria-selected when value is null", () => {
    renderSelector(null);
    openDropdown("Project selector: No project");

    const options = screen.getAllByRole("option");
    const noneOption = options.find((o) => o.textContent?.includes("No project"));
    expect(noneOption!.getAttribute("aria-selected")).toBe("true");
  });

  it("shows Add new project as disabled with coming later message", () => {
    renderSelector();
    openDropdown();

    const options = screen.getAllByRole("option");
    const addOption = options.find((o) => o.textContent?.includes("Add new project"));
    expect(addOption).toBeTruthy();
    expect(addOption!.getAttribute("aria-disabled")).toBe("true");
    expect(addOption!.textContent).toContain("Directory picker coming in MVP1");
    expect(addOption!.getAttribute("title")).toBe(
      "Coming in MVP1: Add a new project from a local directory.",
    );
  });

  it("filters projects by search text", () => {
    renderSelector();
    openDropdown();

    const searchInput = screen.getByPlaceholderText("Search projects");
    fireEvent.change(searchInput, { target: { value: "City" } });

    const options = screen.getAllByRole("option");
    const projectOptions = options.filter(
      (o) => o.getAttribute("aria-disabled") !== "true" && !o.textContent?.includes("No project"),
    );
    const names = projectOptions.map((o) => o.textContent ?? "");

    expect(names.some((n) => n.includes("CitySample_Sandbox"))).toBe(true);
    expect(names.some((n) => n.includes("Lyra_Prototype"))).toBe(false);
    expect(names.some((n) => n.includes("MechArena_Testbed"))).toBe(false);
  });

  it("shows empty message when search matches nothing", () => {
    renderSelector();
    openDropdown();

    const searchInput = screen.getByPlaceholderText("Search projects");
    fireEvent.change(searchInput, { target: { value: "zzz_nonexistent" } });

    expect(screen.getByText("No matching projects")).toBeTruthy();
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

    fireEvent.click(screen.getByLabelText("Project selector: Lyra_Prototype"));

    await vi.waitFor(() => {
      expect(screen.queryByRole("listbox")).toBeNull();
    });
  });

  it("sets aria-expanded on the trigger when open and closed", () => {
    renderSelector();
    const trigger = screen.getByLabelText("Project selector: Lyra_Prototype");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
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

  it("updates trigger label when value changes via rerender", () => {
    const { rerender } = render(
      <ProjectSelector value="lyra" projects={MOCK_PROJECTS} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText("Project selector: Lyra_Prototype")).toBeTruthy();

    rerender(<ProjectSelector value="mech" projects={MOCK_PROJECTS} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Project selector: MechArena_Testbed")).toBeTruthy();

    rerender(<ProjectSelector value={null} projects={MOCK_PROJECTS} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Project selector: No project")).toBeTruthy();
  });
});
