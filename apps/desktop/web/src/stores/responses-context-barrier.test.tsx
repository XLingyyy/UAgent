import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  UIProvider,
  useComposerActions,
  useComposerStore,
  useProjectActions,
  useProjectStore,
  useProviderActions,
  useProviderStore,
  useWorkspacePersistenceActions,
} from "./ui-store";
import { safeProviderSession } from "../runtime/safe-provider-session";
import { nativeProductSettings } from "../runtime/native-product-settings";
import { ProviderSettings } from "../settings/pages/ProviderSettings";
import { I18nProvider, createLocaleStore } from "../i18n";
import type { ProviderConfig } from "../types/provider";
const providerA:ProviderConfig={providerId:"fixture-provider",displayName:"Fixture A",baseUrl:"https://api.openai.com/v1",wireApi:"responses",authMode:"env_key",enabled:true,models:[{id:"model-a",label:"A",contextWindow:32768,supportsReasoning:false},{id:"model-b",label:"B",contextWindow:32768,supportsReasoning:false}],defaultModel:"model-a"};
const providerB:ProviderConfig={...providerA,providerId:"fixture-provider-b",displayName:"Fixture B",defaultModel:"model-b"};
const initialModel = JSON.stringify(["fixture-provider", "model-a"]),
  nextModel = JSON.stringify(["fixture-provider", "model-b"]);
function Probe() {
  const providers=useProviderActions(),workspace=useWorkspacePersistenceActions(),provider=useProviderStore(s=>s);
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
      <output data-testid="default-provider">{provider.defaultProviderId}</output>
      <output data-testid="default-model">{provider.providers[0]?.defaultModel}</output>
      <button onClick={()=>void Promise.resolve(providers.setDefaultProvider(providerB.providerId)).catch(()=>undefined)}>Default B</button>
      <button onClick={()=>void Promise.resolve(providers.saveProvider({...providerA,defaultModel:"model-b"})).catch(()=>undefined)}>Reconcile model B</button>
      <button onClick={()=>void workspace.restore({schemaVersion:1,theme:"dark",projectRoots:[],selectedProjectRoot:null,deepseekConfigured:false}).catch(()=>undefined)}>Restore workspace</button>
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
function mount(settings=false) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw Error("Network forbidden");
    }),
  );
  vi.spyOn(nativeProductSettings, "getBootstrap").mockReturnValue(null);
  vi.spyOn(nativeProductSettings, "enabled").mockReturnValue(false);
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
    <I18nProvider store={createLocaleStore({initialLocale:"en",storage:null,eventTarget:null})}><UIProvider
      initialState={{
        provider:{providers:[providerA,providerB],selectedProviderId:providerB.providerId,defaultProviderId:providerA.providerId,testStatus:"idle"},
        project: { activeProjectId: "A" },
        composer: { selectedModelId: initialModel },
      }}
    >
      <Probe />{settings&&<ProviderSettings/>}
    </UIProvider></I18nProvider>,
  );
}
describe("Responses UI context revocation barrier (synthetic acknowledgement)", () => {
  it.each(["default","reconcile","restore"] as const)("keeps old visible state until %s revocation acknowledges",async kind=>{
    let resolve!:()=>void;const ack=new Promise<void>(done=>{resolve=done;});
    const close=vi.spyOn(safeProviderSession,"closeAsync").mockReturnValue(ack);mount();
    fireEvent.click(screen.getByRole("button",{name:kind==="default"?"Default B":kind==="reconcile"?"Reconcile model B":"Restore workspace"}));
    expect(close).toHaveBeenCalledWith("project_changed");
    expect(screen.getByTestId("model").textContent).toBe(initialModel);
    expect(screen.getByTestId("default-provider").textContent).toBe(providerA.providerId);
    expect(screen.getByTestId("default-model").textContent).toBe("model-a");
    expect(screen.getByTestId("project").textContent).toBe("A");
    await act(async()=>{resolve();await ack;});
    await waitFor(()=>expect(screen.getByTestId(kind==="restore"?"project":"model").textContent).toBe(kind==="restore"?"":kind==="default"?JSON.stringify([providerB.providerId,"model-b"]):nextModel));
    if(kind==="default")expect(screen.getByTestId("default-provider").textContent).toBe(providerB.providerId);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["default","reconcile","restore"] as const)("retains old selection and defaults if %s revocation fails",async kind=>{
    vi.spyOn(safeProviderSession,"closeAsync").mockRejectedValue(Error("synthetic native failure"));mount();
    await act(async()=>fireEvent.click(screen.getByRole("button",{name:kind==="default"?"Default B":kind==="reconcile"?"Reconcile model B":"Restore workspace"})));
    expect(screen.getByTestId("model").textContent).toBe(initialModel);
    expect(screen.getByTestId("default-provider").textContent).toBe(providerA.providerId);
    expect(screen.getByTestId("default-model").textContent).toBe("model-a");
    expect(screen.getByTestId("project").textContent).toBe("A");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps provider settings busy until its default change acknowledges and reports failure",async()=>{
    let reject!:(e:Error)=>void;const ack=new Promise<void>((_,fail)=>{reject=fail;});
    vi.spyOn(safeProviderSession,"closeAsync").mockReturnValue(ack);mount(true);
    fireEvent.click(screen.getByRole("button",{name:"Edit provider"}));
    fireEvent.click(screen.getByRole("checkbox",{name:"Use as default provider"}));
    fireEvent.click(screen.getByRole("button",{name:"Save provider"}));
    await waitFor(()=>expect(vi.mocked(safeProviderSession.closeAsync)).toHaveBeenCalled());
    expect((screen.getByRole("button",{name:"Save provider"}) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("default-provider").textContent).toBe(providerA.providerId);
    expect(screen.getByTestId("model").textContent).toBe(initialModel);
    await act(async()=>{reject(Error("synthetic native failure"));await ack.catch(()=>undefined);});
    await waitFor(()=>expect(screen.getByRole("alert")).toBeTruthy());
    expect((screen.getByRole("button",{name:"Save provider"}) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("default-provider").textContent).toBe(providerA.providerId);
    expect(screen.getByTestId("model").textContent).toBe(initialModel);
    expect(fetch).not.toHaveBeenCalled();
  });
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
