import {useI18n} from "../../i18n";
import { SettingsPageLayout, SettingsSection } from "../SettingsPageLayout";
import { appearancePageData } from "../settings-page-data";
import { useLayoutActions, useLayoutStore } from "../../stores/ui-store";
import type { UATheme } from "../../types/ui";
import "../pages/SettingsPages.css";

export function AppearanceSettings() {
  const {text: uiText} = useI18n();
  return (
    <SettingsPageLayout page={appearancePageData}>
      {appearancePageData.sections.map((section) => (
        <SettingsSection key={section.id} section={section}>
          {section.id === "theme" && <ThemeModeControls />}
          {section.id === "accent" && <AccentColorControls />}
          {section.id === "typography" && <TypographyDisplay />}
          {section.id === "display" && <ContrastDisplay />}
        </SettingsSection>
      ))}
      <div className="ua-settings-page__note">
        {uiText("Appearance is local. Save workspace preferences in Connections & safety.")}{" "}</div>
    </SettingsPageLayout>
  );
}

function ThemeModeControls() {
  const {text: uiText} = useI18n();
  const theme = useLayoutStore((state) => state.theme);
  const { setTheme } = useLayoutActions();
  const themeOptions: Array<{
    id: "system" | UATheme;
    label: string;
    disabled?: boolean;
    description?: string;
  }> = [
    {
      id: "system",
      label: "System (staged)",
      disabled: true,
      description: "Future system setting",
    },
    {
      id: "light",
      label: "Light (staged)",
      disabled: true,
      description: "Future light theme setting",
    },
    { id: "dark", label: "Dark" },
  ];

  return (
    <div className="ua-settings-page__option-group" role="radiogroup" aria-label={uiText("Theme mode")}>
      {themeOptions.map((option) => {
        const selected = option.id === theme;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={option.disabled || undefined}
            disabled={option.disabled}
            title={uiText(option.description ?? "")}
            className={[
              "ua-settings-page__option",
              selected ? "ua-settings-page__option--selected" : "",
              option.disabled ? "ua-settings-page__option--disabled" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => {
              if (option.id === "dark") {
                setTheme(option.id);
              }
            }}
          >
            <span className="ua-settings-page__option-radio" aria-hidden />
            <span>{uiText(option.label ?? "")}</span>
          </button>
        );
      })}
    </div>
  );
}

function AccentColorControls() {
  const {text: uiText} = useI18n();
  return (
    <div className="ua-settings-page__accent-group" role="radiogroup" aria-label={uiText("Accent color")}>
      <button
        type="button"
        role="radio"
        className="ua-settings-page__accent-swatch ua-settings-page__accent-swatch--selected"
        title={uiText("Sage accent")}
        aria-label={uiText("Sage accent")}
        aria-checked="true"
      >
        <span className="ua-settings-page__accent-fill" />
      </button>
      <span className="ua-settings-page__accent-label">{uiText("Sage accent")}</span>
    </div>
  );
}

function TypographyDisplay() {
  const {text: uiText} = useI18n();
  return (
    <div className="ua-settings-page__static-stack">
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("UI font")}</span>
        <span className="ua-settings-page__static-value">{uiText("System UI")}</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">{uiText("Code font")}</span>
        <span className="ua-settings-page__static-value">{uiText("SF Mono / Cascadia Code")}</span>
      </div>
    </div>
  );
}

function ContrastDisplay() {
  const {text: uiText} = useI18n();
  return (
    <div className="ua-settings-page__slider-skeleton">
      <span className="ua-settings-page__static-value">{uiText("Normal")}</span>
    </div>
  );
}
