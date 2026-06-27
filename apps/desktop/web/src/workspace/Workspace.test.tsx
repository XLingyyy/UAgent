import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Workspace } from "./Workspace";
import { UIProvider } from "../app/providers";
import { LeftSidebar } from "../sidebar/LeftSidebar";
import { mockThreads } from "../sidebar/sidebar-data";

function renderWorkspace() {
  return render(
    <UIProvider>
      <Workspace />
    </UIProvider>,
  );
}

function renderWorkspaceWithInspectorOpen(open: boolean) {
  return render(
    <UIProvider initialState={{ layout: { inspector: { open } } }}>
      <Workspace />
    </UIProvider>,
  );
}

function renderWorkspaceWithThread(threadId: string) {
  return render(
    <UIProvider initialState={{ thread: { activeThreadId: threadId } }}>
      <Workspace />
    </UIProvider>,
  );
}

function renderSidebarAndWorkspace() {
  return render(
    <UIProvider>
      <LeftSidebar />
      <Workspace />
    </UIProvider>,
  );
}

describe("Workspace", () => {
  it("renders a welcome prompt for the current Unreal project context", () => {
    renderWorkspace();

    expect(
      screen.getByRole("heading", { name: "What should UAgent do in Lyra_Prototype?" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Plan, inspect, or modify your Unreal project with local context."),
    ).toBeTruthy();
    expect(screen.getByText("UE not connected")).toBeTruthy();
  });

  it("renders a status strip with project, mode, runtime, and UE state", () => {
    renderWorkspace();

    const strip = screen.getByLabelText("Workspace status");
    expect(within(strip).getByText("Project")).toBeTruthy();
    expect(within(strip).getByText("Lyra_Prototype")).toBeTruthy();
    expect(within(strip).getByText("Mode")).toBeTruthy();
    expect(within(strip).getByText("Plan")).toBeTruthy();
    expect(within(strip).getByText("Runtime")).toBeTruthy();
    expect(within(strip).getByText("Mock")).toBeTruthy();
    expect(within(strip).getByText("UE")).toBeTruthy();
    expect(within(strip).getByText("Not connected")).toBeTruthy();
  });

  it("starts in welcome mode without rendering the activity timeline", () => {
    renderWorkspace();

    const workspace = screen.getByLabelText("Workspace");
    expect(workspace.getAttribute("data-workspace-mode")).toBe("welcome");
    expect(
      screen.getByRole("heading", { name: "What should UAgent do in Lyra_Prototype?" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Conversation activity")).toBeNull();
    expect(screen.queryByText("Conversation")).toBeNull();
  });

  it("renders mock conversation and activity messages when an active thread is seeded", () => {
    renderWorkspaceWithThread("thread-1");

    const workspace = screen.getByLabelText("Workspace");
    expect(workspace.getAttribute("data-workspace-mode")).toBe("thread");
    const viewport = screen.getByLabelText("Conversation activity");
    const messages = within(viewport).getAllByRole("article");
    expect(messages.length).toBeGreaterThanOrEqual(3);
    expect(within(viewport).getByText("User request")).toBeTruthy();
    expect(within(viewport).getByText("Agent plan")).toBeTruthy();
    expect(within(viewport).getByText("Tool event")).toBeTruthy();
    expect(within(viewport).getByText("Review summary")).toBeTruthy();
  });

  it("switches to thread mode after a recent sidebar conversation is selected", () => {
    renderSidebarAndWorkspace();

    expect(screen.getByLabelText("Workspace").getAttribute("data-workspace-mode")).toBe("welcome");
    expect(screen.queryByLabelText("Conversation activity")).toBeNull();

    fireEvent.click(screen.getByText(mockThreads[0].title).closest("button")!);

    expect(screen.getByLabelText("Workspace").getAttribute("data-workspace-mode")).toBe("thread");
    const viewport = screen.getByLabelText("Conversation activity");
    expect(viewport).toBeTruthy();
    expect(within(viewport).getByText("Conversation")).toBeTruthy();
  });

  it("submits a welcome composer request into runtime thread mode", async () => {
    renderWorkspace();

    fireEvent.change(screen.getByLabelText("Composer input"), {
      target: { value: "Review Lyra asset loading risks" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send mock task" }));

    const viewport = await screen.findByLabelText("Conversation activity");
    expect(screen.getByLabelText("Workspace").getAttribute("data-workspace-mode")).toBe("thread");
    expect(within(viewport).getAllByText("Review Lyra asset loading risks").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(within(viewport).getAllByText("Agent plan").length).toBeGreaterThanOrEqual(1);
    expect(
      (await within(viewport).findAllByText("Agent step completed")).length,
    ).toBeGreaterThanOrEqual(1);
    expect((await within(viewport).findAllByText("Evidence created")).length).toBeGreaterThanOrEqual(
      1,
    );
    expect((await within(viewport).findAllByText("Review summary")).length).toBeGreaterThanOrEqual(
      1,
    );
    expect((await within(viewport).findAllByText("Task completed")).length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("renders a failed runtime task when input includes #fail", async () => {
    renderWorkspace();

    fireEvent.change(screen.getByLabelText("Composer input"), {
      target: { value: "Review lighting #fail" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send mock task" }));

    const viewport = await screen.findByLabelText("Conversation activity");
    expect((await within(viewport).findAllByText("Task failed")).length).toBeGreaterThanOrEqual(1);
    expect(
      (await within(viewport).findAllByText("Agent step failed")).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      (await within(viewport).findAllByText("Mock failure injected by #fail.")).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("keeps static mock fallback for seeded non-runtime threads", () => {
    renderWorkspaceWithThread("thread-1");

    const viewport = screen.getByLabelText("Conversation activity");
    expect(within(viewport).getByText("User request")).toBeTruthy();
    expect(within(viewport).getByText("Review summary")).toBeTruthy();
  });

  it("renders the standalone ComposerDock input and status rows", () => {
    renderWorkspace();

    const dock = screen.getByLabelText("Composer dock");
    expect(dock.getAttribute("data-composer-mode")).toBe("welcome");
    expect(within(dock).getByLabelText("Composer input")).toBeTruthy();
    expect(within(dock).getByLabelText("Permission mode: Request approval")).toBeTruthy();
    expect(
      within(dock).getByLabelText("Context: 2,400 / 20,000 used (12%, 88% remaining)"),
    ).toBeTruthy();
    expect(within(dock).getByLabelText("Project selector: Lyra_Prototype")).toBeTruthy();

    const disabledSend = within(dock).getByRole("button", { name: "Send - disabled" });
    expect(disabledSend).toBeTruthy();
    expect((disabledSend as HTMLButtonElement).disabled).toBe(true);
    expect(dock.querySelector("form")).toBeNull();
  });

  describe("ComposerDock availability regardless of inspector state", () => {
    it("renders ComposerDock when inspector is open", () => {
      renderWorkspaceWithInspectorOpen(true);
      expect(screen.getByLabelText("Composer dock")).toBeTruthy();
      expect(screen.getByLabelText("Composer input")).toBeTruthy();
    });

    it("renders ComposerDock when inspector is closed", () => {
      renderWorkspaceWithInspectorOpen(false);
      expect(screen.getByLabelText("Composer dock")).toBeTruthy();
      expect(screen.getByLabelText("Composer input")).toBeTruthy();
    });
  });

  it("does not render microphone, voice, or record controls", () => {
    const { container } = renderWorkspace();

    const audioControls = container.querySelectorAll(
      '[aria-label*="mic" i], [aria-label*="voice" i], [aria-label*="record" i]',
    );
    expect(audioControls.length).toBe(0);
  });
});
