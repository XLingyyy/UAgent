export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  createTranslator,
  dictionaries,
  en,
  hasTranslationKey,
  interpolate,
  isLocale,
  messageCatalog,
  normalizeLocale,
  translate,
  validateCatalog,
  zhCN,
  type Locale,
  type TranslationArgs,
  type TranslationDictionary,
  type TranslationKey,
  type TranslationParams,
  type Translator,
} from "./core";
export {
  LOCALE_STORAGE_KEY,
  createLocaleStore,
  defaultLocaleStore,
  getLocale,
  setLocale,
  type LocaleStorage,
  type LocaleStore,
  type LocaleStoreOptions,
} from "./locale-store";
export {
  I18nProvider,
  useI18n,
  useT,
  type I18nProviderProps,
  type I18nValue,
} from "./I18nProvider";
export { getSourceTranslationKey, localizeText, sourceAliases } from "./source-map";
