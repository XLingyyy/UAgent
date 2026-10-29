import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, createLocaleStore, translate, localizeText, type Locale } from "../i18n";
import type { ProviderConfig } from "../types/provider";
import { ComposerDock } from "./ComposerDock";
import { ProviderSessionSetup } from "../settings/pages/ProviderSessionSetup";
import {
  sessionMatchesProviderModel,
  supportsProviderModel,
  createSupportedProvider,
  type ProviderSessionIdentity,
} from "../provider/runtime-availability";

const mocks = vi.hoisted(() => {
  const actions = {
    setComposerModel: vi.fn(),
    setComposerTaskMode: vi.fn(),
    setSavedRun: vi.fn(),
    setComposerInput: vi.fn(),
    setComposerAttachMenuOpen: vi.fn(),
    setComposerPermission: vi.fn(),
    setComposerReasoning: vi.fn(),
    submitComposerTask: vi.fn(async () => "task-fixture"),
    cancelRuntimeTask: vi.fn(async () => {}),
    pauseTaskRun: vi.fn(),
    resumeTaskRun: vi.fn(),
    openSettings: vi.fn(),
    setActiveProject: vi.fn(),
    setInspectorOpen: vi.fn(),
    proposeMvp10TerminalCommand: vi.fn(),
  };
  return {
    actions,
    profile: { isolated: true, offlineDemo: true },
    generation: 0,
    session: { ready: false } as ProviderSessionIdentity,
    composer: {} as Record<string, unknown>,
    provider: {} as Record<string, unknown>,
    project: {} as Record<string, unknown>,
    close: vi.fn(),
    enable: vi.fn(),
    openAccount: vi.fn(),
    openResponses: vi.fn(),
  };
});
vi.mock("../runtime/application-profile", () => ({ getApplicationProfile: () => mocks.profile }));
vi.mock("../runtime/safe-provider-session", () => ({
  safeProviderSession: {
    subscribe: () => () => {},
    getSnapshot: () => mocks.session,
    getSessionGeneration: () => mocks.generation,
    close: (...args: unknown[]) => mocks.close(...args),
    enable: () => mocks.enable(),
    openAccount: (...args: unknown[]) => mocks.openAccount(...args),
    openResponses: (...args: unknown[]) => mocks.openResponses(...args),
  },
}));
vi.mock("../stores/ui-store", () => ({
  useComposerStore: (selector: (state: unknown) => unknown) => selector(mocks.composer),
  useProviderStore: (selector: (state: unknown) => unknown) => selector(mocks.provider),
  useProjectStore: (selector: (state: unknown) => unknown) => selector(mocks.project),
  useRuntimeStore: (selector: (state: unknown) => unknown) =>
    selector({ activeTaskId: null, tasksById: {}, eventsByTaskId: {} }),
  useComposerActions: () => mocks.actions,
  useProjectActions: () => mocks.actions,
  useSettingsActions: () => mocks.actions,
  useRuntimeActions: () => mocks.actions,
  useLayoutActions: () => mocks.actions,
}));
vi.mock("./AttachmentPanel", () => ({ AttachmentPanel: () => null }));
vi.mock("./PermissionSelector", () => ({ PermissionSelector: () => null }));
vi.mock("./ProjectSelector", () => ({ ProjectSelector: () => null }));
vi.mock("./ModelSelector", () => ({
  ModelSelector: ({ modelId }: { modelId: string }) => (
    <span data-testid="selected-model">{modelId}</span>
  ),
}));

function provider(): ProviderConfig {
  return {
    providerId: "fixture-openai",
    displayName: "Configured Responses",
    baseUrl: "https://api.openai.com/v1",
    wireApi: "responses",
    authMode: "env_key",
    enabled: true,
    models: [
      {
        id: "configured-model",
        label: "Selected model",
        contextWindow: 32000,
        supportsReasoning: false,
      },
    ],
    defaultModel: "configured-model",
  };
}
function matching(p = provider()): ProviderSessionIdentity {
  return {
    ready: true,
    providerId: p.providerId,
    modelId: p.defaultModel,
    endpoint: "https://api.openai.com/v1/responses",
    wireApi: "responses",
    fixture: true,
  };
}
function mount(element: React.ReactElement, locale: Locale = "en") {
  const store = createLocaleStore({ initialLocale: locale, storage: null, eventTarget: null });
  return { ...render(<I18nProvider store={store}>{element}</I18nProvider>), store };
}
function keyField(locale: Locale = "en") {
  return screen.getByLabelText(
    translate(locale, "responses.fixtureCredential"),
  ) as HTMLInputElement;
}
function authorize(locale: Locale = "en") {
  fireEvent.change(keyField(locale), { target: { value: "offline-responses-fixture-only" } });
  fireEvent.click(
    screen.getByRole("checkbox", { name: translate(locale, "product.authorizeLabel") }),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.actions.setComposerModel.mockReset();
  mocks.openResponses.mockReset();
  mocks.openResponses.mockResolvedValue(true);
  mocks.generation = 0;
  mocks.profile.isolated = true;
  mocks.profile.offlineDemo = true;
  mocks.session = {
    ready: false,
    ...{ canConfigure: true, pendingSetup: false, enabled: true, expiresAt: null },
  };
  const p = provider();
  mocks.composer = {
    input: "Investigate the synthetic project.",
    taskMode: "investigation",
    selectedModelId: JSON.stringify([p.providerId, p.defaultModel]),
    reasoningEffort: "medium",
    permission: "request-approval",
    runMode: "local",
    submitting: false,
    attachMenuOpen: false,
    savedRun: undefined,
  };
  mocks.provider = {
    providers: [p],
    selectedProviderId: p.providerId,
    defaultProviderId: p.providerId,
    testStatus: "idle",
  };
  mocks.project = {
    activeProjectId: "root:fixture",
    registeredProjects: [
      {
        id: "root:fixture",
        name: "Fixture project",
        rootRef: "opaque-root",
        displayRoot: "[project-root]",
        trustState: "trusted",
        indexStatus: "ready",
        engine: { label: "UE fixture" },
      },
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw Error("NETWORK_FORBIDDEN");
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Responses desktop UI ownership and isolated fixture gating", () => {
  it.each([
    { isolated: false, offlineDemo: false },
    { isolated: true, offlineDemo: false },
    { isolated: false, offlineDemo: true },
  ])("ordinary or nonisolated profile %j cannot enable Responses", (profile) => {
    Object.assign(mocks.profile, profile);
    expect(supportsProviderModel(provider(), "configured-model")).toBe(false);
  });
  it.each([
    "https://api.openai.com",
    "https://api.openai.com/v1/responses",
    "https://api.openai.com.evil.invalid/v1",
    "http://127.0.0.1/v1",
  ])("does not expose a Responses endpoint outside the explicit API root: %s", (baseUrl) => {
    expect(supportsProviderModel({ ...provider(), baseUrl }, "configured-model")).toBe(false);
  });
  it("requires a configured enabled model with session authentication", () => {
    const p = provider();
    expect(supportsProviderModel(p, "configured-model")).toBe(true);
    expect(supportsProviderModel({ ...p, baseUrl: p.baseUrl + "/" }, "configured-model")).toBe(
      true,
    );
    expect(supportsProviderModel({ ...p, enabled: false }, "configured-model")).toBe(false);
    expect(supportsProviderModel({ ...p, authMode: "none" }, "configured-model")).toBe(false);
    expect(supportsProviderModel(p, "not-configured-in-this-provider")).toBe(false);
  });
  it("matches the exact Responses identity and never promotes a legacy ready flag", () => {
    const p = provider();
    expect(sessionMatchesProviderModel(matching(p), p, p.defaultModel)).toBe(true);
    for (const state of [
      { ready: true },
      { ...matching(p), providerId: "another-provider" },
      { ...matching(p), modelId: "another-model" },
      { ...matching(p), endpoint: "https://api.deepseek.com/chat/completions" },
      { ...matching(p), wireApi: "chat_completions" },
      { ...matching(p), fixture: false },
    ])
      expect(sessionMatchesProviderModel(state, p, p.defaultModel)).toBe(false);
    const deepseek = createSupportedProvider();
    expect(sessionMatchesProviderModel({ ready: true }, deepseek, deepseek.defaultModel)).toBe(
      true,
    );
    expect(
      sessionMatchesProviderModel(
        { ...matching(p), providerId: "deepseek" },
        deepseek,
        deepseek.defaultModel,
      ),
    ).toBe(false);
  });
  it("clearing a pending setup prevents late model-acknowledgement from opening a session", async () => {
    let acknowledge!: () => void;
    mocks.actions.setComposerModel.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        acknowledge = resolve;
      }),
    );
    mount(<ProviderSessionSetup provider={provider()} />);
    authorize();
    fireEvent.click(screen.getByRole("button", { name: translate("en", "demo.openSession") }));
    fireEvent.click(screen.getByRole("button", { name: translate("en", "demo.closeSession") }));
    await act(async () => acknowledge());
    expect(keyField().value).toBe("");
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(mocks.openResponses).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves the known DeepSeek legacy controller path without using Responses", async () => {
    const p = createSupportedProvider();
    mocks.session = {
      ready: true,
      ...{ canConfigure: true, pendingSetup: false, enabled: true, expiresAt: null },
    };
    mount(<ProviderSessionSetup provider={p} />);
    expect(screen.getByRole("status").textContent).toBe(translate("en", "product.sessionReady"));
    fireEvent.change(screen.getByLabelText(translate("en", "product.apiKey")), {
      target: { value: "synthetic-legacy-only" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: translate("en", "product.authorizeLabel") }),
    );
    fireEvent.click(screen.getByRole("button", { name: translate("en", "product.openSession") }));
    await waitFor(() => expect(mocks.openAccount).toHaveBeenCalledWith("synthetic-legacy-only"));
    expect(mocks.openResponses).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("unmounting an old pending form does not close a newer session generation", async () => {
    let reject!: (error: Error) => void;
    mocks.openResponses.mockReturnValueOnce(
      new Promise<boolean>((_, fail) => {
        reject = fail;
      }),
    );
    const view = mount(<ProviderSessionSetup provider={provider()} />);
    authorize();
    fireEvent.click(screen.getByRole("button", { name: translate("en", "demo.openSession") }));
    await waitFor(() => expect(mocks.openResponses).toHaveBeenCalledTimes(1));
    mocks.generation++;
    mocks.close.mockClear();
    view.unmount();
    await act(async () => reject(Error("superseded fixture")));
    expect(mocks.close).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("ordinary settings show unavailable without collecting credentials or claiming verification", () => {
    mocks.profile.isolated = false;
    mocks.profile.offlineDemo = false;
    mocks.session = matching();
    mount(<ProviderSessionSetup provider={provider()} />);
    expect(screen.getByText(translate("en", "responses.nativeUnavailable"))).toBeTruthy();
    expect(screen.queryByLabelText(translate("en", "responses.fixtureCredential"))).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(translate("en", "product.unsupported"));
    expect(mocks.openResponses).not.toHaveBeenCalled();
    expect(mocks.openAccount).not.toHaveBeenCalled();
  });
  it("does not display another provider's ready session as this session", () => {
    mocks.session = { ...mocks.session, ...matching(), providerId: "another-provider" };
    mount(<ProviderSessionSetup provider={provider()} />);
    expect(screen.getByRole("status").textContent).toBe(translate("en", "product.sessionClosed"));
  });
  it("awaits model-selection revocation acknowledgement, clears input and awaits the correct protocol setup", async () => {
    let acknowledge!: () => void, finish!: () => void;
    const barrier = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    const opened = new Promise<boolean>((resolve) => {
      finish = () => resolve(true);
    });
    mocks.actions.setComposerModel.mockReturnValueOnce(barrier);
    mocks.openResponses.mockReturnValueOnce(opened);
    mount(<ProviderSessionSetup provider={provider()} />);
    authorize();
    fireEvent.click(screen.getByRole("button", { name: translate("en", "demo.openSession") }));
    expect(keyField().value).toBe("");
    expect(keyField().disabled).toBe(true);
    expect(mocks.openResponses).not.toHaveBeenCalled();
    expect(mocks.openAccount).not.toHaveBeenCalled();
    await act(async () => acknowledge());
    await waitFor(() =>
      expect(mocks.openResponses).toHaveBeenCalledWith(
        "fixture-openai",
        "configured-model",
        "offline-responses-fixture-only",
      ),
    );
    expect(screen.getByRole("status").textContent).toBe(translate("en", "responses.opening"));
    await act(async () => finish());
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(mocks.openAccount).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps authorization unchecked across language and model changes and does not send", () => {
    const p = provider(),
      view = mount(<ProviderSessionSetup provider={p} />, "zh-CN");
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    act(() => view.store.setLocale("en"));
    expect(keyField().value).toBe("");
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    authorize();
    const changed = {
      ...p,
      models: [{ ...p.models[0], id: "second-model" }],
      defaultModel: "second-model",
    };
    view.rerender(
      <I18nProvider store={view.store}>
        <ProviderSessionSetup provider={changed} />
      </I18nProvider>,
    );
    expect(keyField().value).toBe("");
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(mocks.openResponses).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reports setup failure briefly and never falls back to DeepSeek", async () => {
    mocks.openResponses.mockRejectedValueOnce(Error("fixture-private-detail"));
    mount(<ProviderSessionSetup provider={provider()} />);
    authorize();
    fireEvent.click(screen.getByRole("button", { name: translate("en", "demo.openSession") }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      translate("en", "product.setupError"),
    );
    expect(screen.queryByText("fixture-private-detail")).toBeNull();
    expect(keyField().value).toBe("");
    expect(mocks.openAccount).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("shows dynamic Responses selection but blocks discussion without fallback", async () => {
    mocks.session = matching();
    mocks.composer.taskMode = "discussion";
    mount(<ComposerDock />);
    expect(screen.getByTestId("selected-model").textContent).toBe(
      JSON.stringify(["fixture-openai", "configured-model"]),
    );
    expect(screen.getByText(translate("en", "responses.discussionUnavailable"))).toBeTruthy();
    const send = screen.getByRole("button", {
      name: localizeText("en", "Send - disabled"),
    }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(send);
    expect(mocks.actions.submitComposerTask).not.toHaveBeenCalled();
  });
  it("allows only a matching session's investigation draft with trusted scanned project; scope is still reviewed by the store", async () => {
    mocks.session = matching();
    mount(<ComposerDock />);
    const send = screen.getByRole("button", { name: "Send task" }) as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() =>
      expect(mocks.actions.submitComposerTask).toHaveBeenCalledWith(
        expect.objectContaining({
          taskMode: "investigation",
          projectId: "root:fixture",
          providerId: "fixture-openai",
          modelId: "configured-model",
        }),
      ),
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["project", "session"] as const)(
    "blocks investigation when the selected %s is not current",
    (reason) => {
      mocks.session = matching();
      if (reason === "project") mocks.project.activeProjectId = null;
      else mocks.session = { ...matching(), modelId: "other" };
      mount(<ComposerDock />);
      expect(
        (
          screen.getByRole("button", {
            name: localizeText("en", "Send - disabled"),
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      expect(mocks.actions.submitComposerTask).not.toHaveBeenCalled();
    },
  );
});
