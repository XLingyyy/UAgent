import { DEFAULT_LOCALE, isLocale, normalizeLocale, type Locale } from "./core";

export const LOCALE_STORAGE_KEY = "uagent.locale";
export interface LocaleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface LocaleStore {
  getSnapshot: () => Locale;
  getServerSnapshot: () => Locale;
  subscribe: (listener: () => void) => () => void;
  setLocale: (locale: Locale) => void;
}
export interface LocaleStoreOptions {
  initialLocale?: Locale;
  /** null disables persistence; omitted uses browser storage when available. */
  storage?: LocaleStorage | null;
  /** null disables cross-window storage events. */
  eventTarget?: Window | null;
}

export function createLocaleStore(options: LocaleStoreOptions = {}): LocaleStore {
  let locale: Locale = options.initialLocale ?? DEFAULT_LOCALE;
  let initialized = false;
  let listeningTarget: Window | null = null;
  const listeners = new Set<() => void>();
  const storage = (): LocaleStorage | null => {
    if (options.storage !== undefined) return options.storage;
    try {
      return typeof window === "undefined" ? null : window.localStorage;
    } catch {
      return null;
    }
  };
  const initialize = () => {
    if (initialized) return;
    initialized = true;
    if (options.initialLocale !== undefined) return;
    try {
      locale = normalizeLocale(storage()?.getItem(LOCALE_STORAGE_KEY));
    } catch {
      locale = DEFAULT_LOCALE;
    }
  };
  const update = (next: Locale) => {
    if (next === locale) return;
    locale = next;
    listeners.forEach((listener) => listener());
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== LOCALE_STORAGE_KEY && event.key !== null) return;
    // Ignore sessionStorage and unrelated storage areas when supplied by the browser.
    if (event.storageArea && event.storageArea !== storage()) return;
    initialize();
    update(normalizeLocale(event.newValue));
  };
  return {
    getSnapshot: () => {
      initialize();
      return locale;
    },
    getServerSnapshot: () => options.initialLocale ?? DEFAULT_LOCALE,
    subscribe(listener) {
      initialize();
      listeners.add(listener);
      if (!listeningTarget) {
        const target =
          options.eventTarget !== undefined
            ? options.eventTarget
            : typeof window === "undefined"
              ? null
              : window;
        if (target) {
          listeningTarget = target;
          target.addEventListener("storage", onStorage);
        }
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size && listeningTarget) {
          listeningTarget.removeEventListener("storage", onStorage);
          listeningTarget = null;
        }
      };
    },
    setLocale(next) {
      if (!isLocale(next)) return;
      initialize();
      try {
        storage()?.setItem(LOCALE_STORAGE_KEY, next);
      } catch {
        /* The current view can still switch when storage is restricted. */
      }
      update(next);
    },
  };
}

export const defaultLocaleStore = createLocaleStore();
export const getLocale = defaultLocaleStore.getSnapshot;
export const setLocale = defaultLocaleStore.setLocale;
