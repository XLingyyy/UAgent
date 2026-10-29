import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { UIProvider } from "../app/providers";
import { createLocaleStore, I18nProvider, type Locale } from "../i18n";
import { createDesktopRuntimeAdapter } from "../runtime/desktop-runtime-adapter";
import { TitleBar } from "./TitleBar";

const tauriWindow = window as unknown as Record<string, unknown>;
const originalTauri = tauriWindow.__TAURI_INTERNALS__;
let maximized = false;
const invoke = vi.fn(async (command: string) => {
  if (command === "plugin:window|is_maximized") return maximized;
  if (command === "plugin:window|maximize") maximized = true;
  if (command === "plugin:window|unmaximize") maximized = false;
  return undefined;
});

async function renderTitleBar(locale: Locale = "en") {
  const store = createLocaleStore({ initialLocale: locale, storage: null, eventTarget: null });
  const view = render(
    <I18nProvider store={store}>
      <UIProvider runtimeClient={createDesktopRuntimeAdapter({ nativeInvoke: null })}>
        <TitleBar />
      </UIProvider>
    </I18nProvider>,
  );
  await act(async () => { await Promise.resolve(); });
  return view;
}

beforeEach(() => {
  maximized = false;
  invoke.mockClear();
  tauriWindow.__TAURI_INTERNALS__ = { invoke };
});

afterEach(() => {
  cleanup();
  if (originalTauri === undefined) delete tauriWindow.__TAURI_INTERNALS__;
  else tauriWindow.__TAURI_INTERNALS__ = originalTauri;
});

describe("TitleBar drag boundary and controls", () => {
  it("includes non-interactive descendants and explicitly excludes each button", async () => {
    const { container } = await renderTitleBar();
    const header = container.querySelector("header")!;
    expect(header.getAttribute("data-tauri-drag-region")).toBe("deep");
    for (const child of header.querySelectorAll("[data-tauri-drag-region]")) {
      expect(child.tagName).toBe("BUTTON");
      expect(child.getAttribute("data-tauri-drag-region")).toBe("false");
    }
    for (const button of header.querySelectorAll("button")) {
      expect(button.getAttribute("data-tauri-drag-region")).toBe("false");
    }
  });

  it("keeps Tools and all window operations working after the drag boundary changes", async () => {
    await renderTitleBar();
    fireEvent.click(screen.getByRole("button", { name: "Open utility drawer" }));
    expect(screen.getByRole("button", { name: "Close utility drawer" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Close utility drawer" }));
    expect(screen.getByRole("button", { name: "Open utility drawer" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Minimize window" }));
    fireEvent.click(screen.getByRole("button", { name: "Maximize window" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Restore window" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Restore window" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Maximize window" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Close window" }));
    for (const command of ["minimize", "maximize", "unmaximize", "close"]) {
      expect(invoke).toHaveBeenCalledWith(`plugin:window|${command}`, { label: "main" });
    }
    expect(invoke.mock.calls.some(([command]) => /start_dragging|internal_toggle_maximize/.test(command))).toBe(false);
  });

  it("translates the dynamic Tools and maximize/restore accessible names in Chinese", async () => {
    await renderTitleBar("zh-CN");
    fireEvent.click(screen.getByRole("button", { name: "打开工具" }));
    expect(screen.getByRole("button", { name: "关闭工具" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "最大化窗口" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "还原窗口" })).toBeTruthy());
  });

  it("keeps unavailable window controls disabled and labels the state in Chinese", async () => {
    delete tauriWindow.__TAURI_INTERNALS__;
    await renderTitleBar("zh-CN");
    for (const name of ["最小化窗口", "无法获取窗口状态", "关闭窗口"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });
});

// Optional integration with the actual injected script from the locked Rust
// dependency. No network or copied matcher: machines without that Cargo cache
// still run the DOM/control regressions above and visibly skip this group.
function loadLockedTauriDragScript(): string | null {
  const lock = readFileSync("src-tauri/Cargo.lock", "utf8");
  const version = lock.match(/\[\[package\]\]\s+name = "tauri"\s+version = "([^"]+)"/)?.[1];
  const registry = join(process.env.CARGO_HOME ?? join(homedir(), ".cargo"), "registry", "src");
  if (!version || !existsSync(registry)) return null;
  for (const entry of readdirSync(registry, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const script = join(registry, entry.name, `tauri-${version}`, "src", "window", "scripts", "drag.js");
    if (existsSync(script)) return readFileSync(script, "utf8");
  }
  return null;
}

const nativeDragScript = loadLockedTauriDragScript();

describe.runIf(nativeDragScript)("TitleBar with the locally installed Tauri Windows drag script (DOM/IPC only)", () => {
  const listeners: EventListenerOrEventListenerObject[] = [];

  beforeEach(() => {
    const addListener = vi.spyOn(document, "addEventListener");
    try {
      // The Rust runtime fills this platform template before injection.
      new Function(nativeDragScript!.replace("__TEMPLATE_os_name__", '"windows"'))();
      for (const [type, listener] of addListener.mock.calls) {
        if (type === "mousedown") listeners.push(listener);
      }
    } finally {
      addListener.mockRestore();
    }
  });

  afterEach(() => {
    for (const listener of listeners.splice(0)) document.removeEventListener("mousedown", listener);
  });

  const dragTargets = [
    "header",
    ".ua-titlebar__left",
    ".ua-titlebar__brand",
    ".ua-titlebar__crumb",
    ".ua-titlebar__center",
    ".ua-titlebar__drag-hint",
    ".ua-titlebar__right",
    ".ua-titlebar__status",
    ".ua-titlebar__status-pill",
    ".ua-titlebar__controls",
    ".ua-titlebar__window-controls",
  ];

  it.each(dragTargets)("starts native dragging from the non-interactive target %s", async (selector) => {
    const { container } = await renderTitleBar();
    invoke.mockClear();
    for (const target of container.querySelectorAll(selector)) {
      const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, detail: 1 });
      fireEvent(target, event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(invoke).toHaveBeenCalledTimes(container.querySelectorAll(selector).length);
    expect(invoke).toHaveBeenCalledWith("plugin:window|start_dragging");
  });

  it.each(dragTargets)("preserves Tauri double-click maximization on %s", async (selector) => {
    const { container } = await renderTitleBar();
    invoke.mockClear();
    for (const target of container.querySelectorAll(selector)) {
      fireEvent.mouseDown(target, { button: 0, detail: 2 });
    }
    expect(invoke).toHaveBeenCalledTimes(container.querySelectorAll(selector).length);
    expect(invoke).toHaveBeenCalledWith("plugin:window|internal_toggle_maximize");
  });

  it("excludes every button and its icon/text child from dragging and double-click maximization", async () => {
    const { container } = await renderTitleBar();
    invoke.mockClear();
    for (const button of container.querySelectorAll("button")) {
      for (const target of [button, ...button.querySelectorAll("*")]) {
        fireEvent.mouseDown(target, { button: 0, detail: 1 });
        fireEvent.mouseDown(target, { button: 0, detail: 2 });
      }
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  it("covers nested non-interactive text and protects future input/editable controls", async () => {
    const { container } = await renderTitleBar();
    const right = container.querySelector(".ua-titlebar__right")!;
    const nested = document.createElement("span");
    nested.innerHTML = "<strong>Nested status</strong>";
    right.append(nested);
    invoke.mockClear();
    fireEvent.mouseDown(nested.firstElementChild!, { button: 0, detail: 1 });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("plugin:window|start_dragging");
    invoke.mockClear();
    for (const html of [
      '<input aria-label="Future title input">',
      "<select><option>Choice</option></select>",
      "<textarea></textarea>",
      '<a href="#"><span>Link text</span></a>',
      '<div contenteditable="true"><span>Editable text</span></div>',
      '<div role="button"><span>Custom button</span></div>',
      '<div tabindex="0"><span>Focusable control</span></div>',
    ]) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = html;
      right.append(wrapper);
      const control = wrapper.firstElementChild!;
      for (const target of [control, ...control.querySelectorAll("*")]) {
        fireEvent.mouseDown(target, { button: 0, detail: 1 });
        fireEvent.mouseDown(target, { button: 0, detail: 2 });
      }
      wrapper.remove();
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  it("ignores right/middle clicks on the drag region", async () => {
    const { container } = await renderTitleBar();
    invoke.mockClear();
    for (const button of [1, 2]) {
      fireEvent.mouseDown(container.querySelector(".ua-titlebar__right")!, { button, detail: 1 });
    }
    expect(invoke).not.toHaveBeenCalled();
  });
});
