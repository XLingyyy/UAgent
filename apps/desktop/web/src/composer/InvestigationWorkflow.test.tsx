import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, createLocaleStore } from "../i18n";
import { InvestigationWorkflow, investigationWorkflowDraft } from "./InvestigationWorkflow";
afterEach(cleanup);
function mount(disabled = false, hasDraft = false) {
  const apply = vi.fn();
  render(<I18nProvider store={createLocaleStore({ initialLocale: "en", storage: null, eventTarget: null })}>
    <InvestigationWorkflow disabled={disabled} hasDraft={hasDraft} onApply={apply}/>
  </I18nProvider>);
  fireEvent.click(screen.getByText("Built-in workflows"));
  return apply;
}
describe("built-in investigation task entry", () => {
  it("prepares a task description without scope, saved authority or execution", () => {
    const apply = mount(false, true);
    fireEvent.change(screen.getByLabelText("Investigation question"), { target: { value: "Where is NPC dialogue configured?" } });
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Replace draft with template" }));
    const draft = apply.mock.calls[0][0];
    expect(Object.keys(draft).sort()).toEqual(["input", "taskMode"]);
    expect(draft.taskMode).toBe("investigation");
    expect(draft.input).toContain("Where is NPC dialogue configured?");
    expect(draft.input).toContain("unverified scope");
  });
  it.each(["blueprint", "scene"])("does not expose a run action for %s", template => {
    const apply = mount();
    fireEvent.change(screen.getByLabelText("Workflow template"), { target: { value: template } });
    expect(screen.getByRole("status").textContent).toContain("cannot run");
    expect(screen.queryByRole("button", { name: "Prepare investigation task" })).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });
  it("rejects path escapes without changing the existing draft", () => {
    const apply = mount();
    fireEvent.change(screen.getByLabelText("Investigation question"), { target: { value: "Find entry points" } });
    fireEvent.change(screen.getByLabelText("Focus directory (relative, optional)"), { target: { value: "../outside" } });
    fireEvent.click(screen.getByRole("button", { name: "Prepare investigation task" }));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(apply).not.toHaveBeenCalled();
    expect(() => investigationWorkflowDraft("q", "E:/outside", false)).toThrow();
  });
  it("disables editing while a task is active and produces localized reports", () => {
    mount(true);
    expect((screen.getByLabelText("Workflow template").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    const draft = investigationWorkflowDraft("对话入口在哪里？", "", true);
    expect(draft.input).toContain("项目根目录");
    expect(draft.input).toContain("未验证");
  });
});

it("prepares the background workflow with a path-bound draft and keeps collaborative drafting separate",()=>{
  const hosted=vi.fn(),apply=vi.fn();
  render(<I18nProvider store={createLocaleStore({initialLocale:"en",storage:null,eventTarget:null})}>
    <InvestigationWorkflow disabled={false} hasDraft={false} onApply={apply} onPrepareHosted={hosted}/>
  </I18nProvider>);
  fireEvent.click(screen.getByText("Built-in workflows"));
  fireEvent.change(screen.getByLabelText("Investigation question"),{target:{value:"Find repair declarations"}});
  fireEvent.click(screen.getByRole("button",{name:"Prepare background investigation"}));
  expect(hosted).toHaveBeenCalledWith(expect.objectContaining({prefix:"Source",taskMode:"investigation",input:expect.stringContaining("Find repair declarations")}));
  expect(apply).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Focus directory (relative, optional)"),{target:{value:"../outside"}});
  fireEvent.click(screen.getByRole("button",{name:"Prepare background investigation"}));
  expect(hosted).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("alert")).toBeTruthy();
});
