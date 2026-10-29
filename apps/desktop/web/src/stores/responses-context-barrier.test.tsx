import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  UIProvider,
  useComposerActions,
  useComposerStore,
  useProjectActions,
  useProjectStore,
} from "./ui-store";
import { safeProviderSession } from "../runtime/safe-provider-session";
import { nativeProductSettings } from "../runtime/native-product-settings";
const initialModel = JSON.stringify(["fixture-provider", "model-a"]),
  nextModel = JSON.stringify(["fixture-provider", "model-b"]);
function Probe() {
  const projects = useProjectActions(),
    composer = useComposerActions();
  const project = useProjectStore((s) => s.activeProjectId),
    model = useComposerStore((s) => s.selectedModelId);
  const error = useProjectStore((s) => s.lastError);
  return (
    <>
      <output data-testid="project">{project}</output>
      <output data-testid="model">{model}</output>
      <output data-testid="error">{error}</output>
      <button onClick={() => void projects.setActiveProject("B")}>Select B</button>
      <button onClick={() => void composer.setComposerModel(nextModel)}>Select model B</button>
    </>
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mount() {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw Error("Network forbidden");
    }),
  );
  vi.spyOn(nativeProductSettings, "getBootstrap").mockReturnValue(null);
  const base = safeProviderSession.getSnapshot();
  vi.spyOn(safeProviderSession, "getSnapshot").mockReturnValue({
    ...base,
    ready: true,
    wireApi: "responses",
    fixture: true,
    providerId: "fixture-provider",
    modelId: "model-a",
    endpoint: "https://api.openai.com/v1/responses",
  });
  render(
    <UIProvider
      initialState={{
        project: { activeProjectId: "A" },
        composer: { selectedModelId: initialModel },
      }}
    >
      <Probe />
    </UIProvider>,
  );
}
describe("Responses UI context revocation barrier (synthetic acknowledgement)", () => {
  it.each(["project", "model"] as const)(
    "keeps the old %s visible until native revocation acknowledges",
    async (kind) => {
      let resolve!: () => void;
      const ack = new Promise<void>((done) => {
        resolve = done;
      });
      const close = vi.spyOn(safeProviderSession, "closeAsync").mockReturnValue(ack);
      mount();
      fireEvent.click(
        screen.getByRole("button", { name: kind === "project" ? "Select B" : "Select model B" }),
      );
      expect(close).toHaveBeenCalledWith("project_changed");
      expect(screen.getByTestId(kind).textContent).toBe(kind === "project" ? "A" : initialModel);
      await act(async () => {
        resolve();
        await ack;
      });
      await waitFor(() =>
        expect(screen.getByTestId(kind).textContent).toBe(kind === "project" ? "B" : nextModel),
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each(["project", "model"] as const)(
    "keeps the old %s when native revocation fails",
    async (kind) => {
      vi.spyOn(safeProviderSession, "closeAsync").mockRejectedValue(
        Error("synthetic native failure"),
      );
      mount();
      await act(async () =>
        fireEvent.click(
          screen.getByRole("button", { name: kind === "project" ? "Select B" : "Select model B" }),
        ),
      );
      expect(screen.getByTestId(kind).textContent).toBe(kind === "project" ? "A" : initialModel);
      if (kind === "project")
        expect(screen.getByTestId("error").textContent).toBe("responses.switchFailed");
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
