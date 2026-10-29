import {chatMessages} from "./chat-messages";
import {productUiMessages} from "./product-ui-messages";
import {productMessages} from "./product-messages";
import {stage2Messages} from "./stage2-messages";
import { messages } from "./messages";
import { toolMessages } from "./tool-messages";
import { pageMessages } from "./page-messages";
import { configMessages } from "./config-messages";
import { inspectorMessages } from "./inspector-messages";
import { legacyFragments } from "./legacy-fragments";
import { dynamicMessages } from "./dynamic-messages";

export type Locale = "zh-CN" | "en";
export const DEFAULT_LOCALE: Locale = "zh-CN";
export const SUPPORTED_LOCALES: readonly Locale[] = ["zh-CN", "en"];
export const messageCatalog = {
  ...messages,
  ...toolMessages,
  ...pageMessages,
  ...configMessages,
  ...inspectorMessages,
  ...legacyFragments,
  ...dynamicMessages,
  ...stage2Messages,
  ...productMessages,
  ...chatMessages,
  ...productUiMessages,
} as const;
export type TranslationKey = keyof typeof messageCatalog;

type PlaceholderNames<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | PlaceholderNames<Rest>
  : never;
export type TranslationParams<K extends TranslationKey> = Record<
  PlaceholderNames<(typeof messageCatalog)[K][1]>,
  string | number
>;
export type TranslationArgs<K extends TranslationKey> = [
  PlaceholderNames<(typeof messageCatalog)[K][1]>,
] extends [never]
  ? [params?: never]
  : [params: TranslationParams<K>];
export type Translator = <K extends TranslationKey>(key: K, ...args: TranslationArgs<K>) => string;
export type TranslationDictionary = { readonly [K in TranslationKey]: string };

function dictionaryAt(index: 0 | 1): TranslationDictionary {
  return Object.freeze(
    Object.fromEntries(Object.entries(messageCatalog).map(([key, pair]) => [key, pair[index]])),
  ) as TranslationDictionary;
}

export const zhCN = dictionaryAt(0);
export const en = dictionaryAt(1);
export const dictionaries: Readonly<Record<Locale, TranslationDictionary>> = { "zh-CN": zhCN, en };

export function isLocale(value: unknown): value is Locale {
  return value === "zh-CN" || value === "en";
}

export function normalizeLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function hasTranslationKey(value: string): value is TranslationKey {
  return Object.prototype.hasOwnProperty.call(messageCatalog, value);
}

/** Text interpolation only. Values are never evaluated or treated as HTML. */
export function interpolate(
  template: string,
  params?: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (token, name: string) =>
    params && Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : token,
  );
}

export function translate<K extends TranslationKey>(
  locale: Locale,
  key: K,
  ...args: TranslationArgs<K>
): string {
  // JS callers may bypass the key type. Keep unknown keys visible for diagnosis.
  if (!hasTranslationKey(key)) return key;
  return interpolate(dictionaries[normalizeLocale(locale)][key], args[0]);
}

export function createTranslator(locale: Locale): Translator {
  return <K extends TranslationKey>(key: K, ...args: TranslationArgs<K>) =>
    translate(locale, key, ...args);
}

/** Suitable for a focused test or a translation maintenance check. */
export function validateCatalog(): string[] {
  const issues: string[] = [];
  const placeholders = (text: string) =>
    [...new Set([...text.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((m) => m[1]))]
      .sort()
      .join(",");
  for (const [key, [zh, english]] of Object.entries(messageCatalog)) {
    if (!zh.trim() || !english.trim()) issues.push(`${key}: empty translation`);
    if (placeholders(zh) !== placeholders(english)) issues.push(`${key}: placeholder mismatch`);
  }
  return issues;
}
