import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createTranslator, type Locale, type Translator } from "./core";
import { defaultLocaleStore, type LocaleStore } from "./locale-store";
import { localizeText } from "./source-map";

const LocaleStoreContext = createContext<LocaleStore>(defaultLocaleStore);

export interface I18nProviderProps {
  children: ReactNode;
  /** Optional isolated store for tests or a separately embedded app. */
  store?: LocaleStore;
}

export function I18nProvider({ children, store = defaultLocaleStore }: I18nProviderProps) {
  const locale = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = locale;
  }, [locale]);
  return <LocaleStoreContext.Provider value={store}>{children}</LocaleStoreContext.Provider>;
}

export interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translator;
  /** Exact matching of registered static UI text; unknown strings pass through. */
  text: (source: string) => string;
}

/** Works with the shared store even when an I18nProvider has not yet been added. */
export function useI18n(): I18nValue {
  const store = useContext(LocaleStoreContext);
  const locale = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return useMemo(
    () => ({
      locale,
      setLocale: store.setLocale,
      t: createTranslator(locale),
      text: (source: string) => localizeText(locale, source),
    }),
    [locale, store],
  );
}

export function useT(): Translator {
  return useI18n().t;
}
