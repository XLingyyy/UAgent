import {localizeText,getLocale} from "../../i18n";
const uiText=(source:string)=>localizeText(getLocale(),source);
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UIProvider } from "../../stores/ui-store";
import { DeepSeekSessionSetup } from "./DeepSeekSessionSetup";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function mount(input = "Explain a synthetic cube") {
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK FORBIDDEN"); }));
  const save = vi.spyOn(Storage.prototype, "setItem");
  const view = render(<UIProvider initialState={{ composer: { input } }}><DeepSeekSessionSetup /></UIProvider>);
  return { ...view, save };
}
describe("session setup without an opened memory session", () => {
  it("previews only the selected draft and never sends or persists", () => {
    const { save } = mount();
    expect(screen.getByLabelText("仅本次会话使用的 API 密钥")).toBeTruthy();
    fireEvent.click(screen.getByText(uiText("Preview selected draft only")));
    expect(screen.getByLabelText(uiText("Outbound draft preview")).textContent).toContain("Explain a synthetic cube");
    expect(screen.getByLabelText(uiText("Outbound draft preview")).textContent).toContain("deepseek-flash");
    expect((screen.getByText(uiText("Open memory-only session")) as HTMLButtonElement).disabled).toBe(true);
    expect(fetch).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  });
  it("excludes the supplied synthetic key from outbound preview", () => {
    mount("Explain synthetic-preview-key");
    fireEvent.change(screen.getByLabelText(uiText("Session-only API key")), { target: { value: "synthetic-preview-key" } });
    fireEvent.click(screen.getByText(uiText("Preview selected draft only")));
    expect(screen.getByLabelText(uiText("Outbound draft preview")).textContent).not.toContain("synthetic-preview-key");
    expect(screen.getByLabelText(uiText("Outbound draft preview")).textContent).toContain("[REDACTED]");
  });
  it("clears the field and preview explicitly and on unmount", () => {
    const view = mount();
    const field = screen.getByLabelText(uiText("Session-only API key")) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "synthetic-preview-key" } });
    fireEvent.click(screen.getByText(uiText("Preview selected draft only")));
    fireEvent.click(screen.getByText(uiText("Clear session input")));
    expect(field.value).toBe(""); expect(screen.queryByLabelText(uiText("Outbound draft preview"))).toBeNull();
    fireEvent.change(field, { target: { value: "synthetic-preview-key" } });
    view.unmount(); expect(field.value).toBe("");
  });
});
