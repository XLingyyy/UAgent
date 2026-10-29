# Desktop UI localization

Stable API:

```tsx
import { I18nProvider, useI18n, type Locale } from "../i18n";

// Add once near the app root. Hooks also work without this wrapper;
// the wrapper additionally synchronizes the HTML language attribute.
<I18nProvider>
  <AppShell />
</I18nProvider>;

function LanguageSetting() {
  const { locale, setLocale, t } = useI18n();
  return (
    <label>
      {t("settings.language")}
      <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
        <option value="zh-CN">简体中文</option>
        <option value="en">English</option>
      </select>
    </label>
  );
}

// Typed parameters (missing parameters are a TypeScript error):
t("workspace.welcomeProject", { project: project.name });

// Incremental integration of existing application-authored static copy:
const { text } = useI18n();
text("Confirm this exact outbound request");
```

Pure functions: `translate(locale, key, params?)`, `createTranslator(locale)`, `localizeText(locale, staticSource)`, `hasTranslationKey(key)`, `validateCatalog()`. Non-React callers can use `getLocale()` and `setLocale(locale)`; React callers should use the hook so they subscribe to changes.

Locales are `"zh-CN" | "en"`; default is Chinese, independent of browser language. The only preference stored is `localStorage["uagent.locale"]`. Reads are lazy and limited to that key. Restricted or damaged preference storage falls back to Chinese and never prevents an in-memory switch. Same-window subscribers update immediately; storage events update other windows. `createLocaleStore({ storage: null, initialLocale: "en", eventTarget: null })` creates an isolated test store.

`messages.ts` contains the main workflow and safety copy; the page, config, inspector, tool, and dynamic message files cover the audited interface. `legacy-fragments.ts` supports exact static fragments still present in the existing JSX. Every entry is a `[Chinese, English]` pair, so languages share exactly the same key set. Placeholder parity and nonempty text are checked by `validateCatalog()`. `source-map.ts` maps exact legacy phrases to keys when English copy has been shortened. Unknown sources are returned unchanged, without fuzzy matching or HTML mutation. Registered labels preserve their trailing colon in the selected language.

Use explicit keys for dynamic sentences, aria labels, titles, and placeholders. Do not send model replies, user input, logs, errors received from external tools, paths, model IDs, commands, saved conversations, or secret values through `text()`. Display those values verbatim inside translated labels. This module performs no model requests, network calls, filesystem changes, approval changes, or budget operations.

UI labels describe the active capability and approval boundary. Translation never changes transport availability, credentials, tool permissions, or request consent.

The catalogs cover navigation, composer, projects, settings, provider sessions, outbound review, attachments, tool proposals, local history, and utility panels. Use typed translation templates for dynamic copy and preserve raw technical identifiers.
