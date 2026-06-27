import { SettingsPageLayout, SettingsSection } from "../SettingsPageLayout";
import { appearancePageData } from "../settings-page-data";
import { useLayoutActions, useLayoutStore } from "../../stores/ui-store";
import type { UATheme } from "../../types/ui";
import "../pages/SettingsPages.css";

export function AppearanceSettings() {
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
        Theme is local to this preview. Provider and runtime settings remain mock-only.
      </div>
    </SettingsPageLayout>
  );
}

function ThemeModeControls() {
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
    <div className="ua-settings-page__option-group" role="radiogroup" aria-label="Theme mode">
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
            title={option.description}
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
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function AccentColorControls() {
  return (
    <div className="ua-settings-page__accent-group" role="radiogroup" aria-label="Accent color">
      <button
        type="button"
        role="radio"
        className="ua-settings-page__accent-swatch ua-settings-page__accent-swatch--selected"
        title="Pale blue accent is locked for this preview"
        aria-label="Pale blue accent"
        aria-checked="true"
      >
        <span className="ua-settings-page__accent-fill" />
      </button>
      <span className="ua-settings-page__accent-label">Pale blue, fixed for MVP6</span>
    </div>
  );
}

function TypographyDisplay() {
  return (
    <div className="ua-settings-page__static-stack">
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">UI font</span>
        <span className="ua-settings-page__static-value">System UI</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Code font</span>
        <span className="ua-settings-page__static-value">SF Mono / Cascadia Code</span>
      </div>
    </div>
  );
}

function ContrastDisplay() {
  return (
    <div className="ua-settings-page__slider-skeleton">
      <span className="ua-settings-page__static-value">Normal</span>
    </div>
  );
}
