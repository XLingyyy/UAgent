import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocaleStore, LOCALE_STORAGE_KEY, type LocaleStorage } from "./locale-store";

afterEach(() => {
  localStorage.removeItem(LOCALE_STORAGE_KEY);
});

describe("UI language preference", () => {
  it("defaults to Chinese and reads only its single non-secret preference key", () => {
    const read = vi.fn(() => null);
    const store = createLocaleStore({
      storage: { getItem: read, setItem: vi.fn() },
      eventTarget: null,
    });
    expect(read).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe("zh-CN");
    expect(read.mock.calls).toEqual([[LOCALE_STORAGE_KEY]]);
  });

  it("persists English and restores it in a new store without reloading the UI", () => {
    const storage: LocaleStorage = localStorage;
    const first = createLocaleStore({ storage, eventTarget: null });
    const changed = vi.fn();
    const stop = first.subscribe(changed);
    first.setLocale("en");
    expect(first.getSnapshot()).toBe("en");
    expect(changed).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
    const next = createLocaleStore({ storage, eventTarget: null });
    expect(next.getSnapshot()).toBe("en");
    stop();
    first.setLocale("zh-CN");
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("falls back for damaged values and still switches if storage throws", () => {
    const bad = createLocaleStore({
      storage: { getItem: () => "invalid", setItem: vi.fn() },
      eventTarget: null,
    });
    expect(bad.getSnapshot()).toBe("zh-CN");
    const blocked = createLocaleStore({
      storage: {
        getItem: () => {
          throw Error("blocked");
        },
        setItem: () => {
          throw Error("blocked");
        },
      },
      eventTarget: null,
    });
    expect(blocked.getSnapshot()).toBe("zh-CN");
    blocked.setLocale("en");
    expect(blocked.getSnapshot()).toBe("en");
  });

  it("synchronizes the exact language key across windows and ignores other storage", () => {
    const store = createLocaleStore({ storage: localStorage, eventTarget: window });
    const stop = store.subscribe(() => {});
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "other.setting",
        newValue: "en",
        storageArea: localStorage,
      }),
    );
    expect(store.getSnapshot()).toBe("zh-CN");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: LOCALE_STORAGE_KEY,
        newValue: "en",
        storageArea: sessionStorage,
      }),
    );
    expect(store.getSnapshot()).toBe("zh-CN");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: LOCALE_STORAGE_KEY,
        newValue: "en",
        storageArea: localStorage,
      }),
    );
    expect(store.getSnapshot()).toBe("en");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: LOCALE_STORAGE_KEY,
        newValue: null,
        storageArea: localStorage,
      }),
    );
    expect(store.getSnapshot()).toBe("zh-CN");
    stop();
  });
});
