import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => { vi.resetModules(); vi.stubGlobal("__TAURI_INTERNALS__", undefined); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("native application profile bootstrap", () => {
  it("defaults browsers to ordinary mode and ignores forged application flags", async () => {
    vi.stubGlobal("__UAGENT_OFFLINE_DEMO__", true);
    vi.stubGlobal("__UAGENT_APPLICATION_PROFILE__", { isolated: true, offlineDemo: true });
    const module = await import("./application-profile");
    expect(module.getApplicationProfile()).toEqual({ isolated: false, offlineDemo: false });
    expect(await module.initializeApplicationProfile()).toBe(module.getApplicationProfile());
    expect(Object.isFrozen(module.getApplicationProfile())).toBe(true);
  });

  it("awaits the actual native command once and freezes a copied profile", async () => {
    let resolve!: (value: unknown) => void;
    const invoke = vi.fn(() => new Promise<unknown>(done => { resolve = done; }));
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke });
    const module = await import("./application-profile");
    expect(() => module.getApplicationProfile()).toThrow("not_initialized");
    const pending = module.initializeApplicationProfile();
    expect(module.initializeApplicationProfile()).toBe(pending);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("get_application_profile");
    const nativeValue = { isolated: true, offlineDemo: true };
    resolve(nativeValue);
    expect(await pending).toEqual(nativeValue);
    nativeValue.offlineDemo = false;
    expect(module.getApplicationProfile().offlineDemo).toBe(true);
    expect(Object.isFrozen(module.getApplicationProfile())).toBe(true);
  });

  it("propagates native errors and never grants a fallback demo profile", async () => {
    const invoke = vi.fn(async () => { throw Error("native profile unavailable"); });
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke });
    const module = await import("./application-profile");
    await expect(module.initializeApplicationProfile()).rejects.toThrow("native profile unavailable");
    await expect(module.initializeApplicationProfile()).rejects.toThrow("native profile unavailable");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(() => module.getApplicationProfile()).toThrow("not_initialized");
  });

  it.each([{}, { isolated: true }, { isolated: "true", offlineDemo: true }, { isolated: false, offlineDemo: true }])(
    "rejects malformed or nonisolated native demo profiles: %j", async value => {
      vi.stubGlobal("__TAURI_INTERNALS__", { invoke: vi.fn(async () => value) });
      const module = await import("./application-profile");
      await expect(module.initializeApplicationProfile()).rejects.toThrow("application_profile_invalid");
    },
  );

  it("does not permit an added bridge to upgrade an initialized browser profile", async () => {
    const module = await import("./application-profile");
    await module.initializeApplicationProfile();
    const invoke = vi.fn(async () => ({ isolated: true, offlineDemo: true }));
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke });
    expect(await module.initializeApplicationProfile()).toEqual({ isolated: false, offlineDemo: false });
    expect(invoke).not.toHaveBeenCalled();
  });
});
