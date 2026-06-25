import { SettingsPageLayout, SettingsSection } from "../SettingsPageLayout";
import { appearancePageData } from "../settings-page-data";
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
        This is a UI-only mock. No configuration is saved or applied.
      </div>
    </SettingsPageLayout>
  );
}

function ThemeModeControls() {
  return (
    <div className="ua-settings-page__option-group" role="radiogroup" aria-label="Theme mode">
      <label className="ua-settings-page__option">
        <span className="ua-settings-page__option-radio" aria-hidden />
        <span>System</span>
      </label>
      <label className="ua-settings-page__option">
        <span className="ua-settings-page__option-radio" aria-hidden />
        <span>Light</span>
      </label>
      <label className="ua-settings-page__option ua-settings-page__option--selected">
        <span className="ua-settings-page__option-radio" aria-hidden />
        <span>Dark</span>
      </label>
    </div>
  );
}

const accentColors = [
  { id: "blue", hex: "#3d6ef0", label: "Blue" },
  { id: "violet", hex: "#7c5cf0", label: "Violet" },
  { id: "teal", hex: "#2eb89a", label: "Teal" },
  { id: "amber", hex: "#d9923a", label: "Amber" },
  { id: "crimson", hex: "#e5484d", label: "Crimson" },
  { id: "slate", hex: "#717a8c", label: "Slate" },
];

function AccentColorControls() {
  return (
    <div className="ua-settings-page__accent-group" role="radiogroup" aria-label="Accent color">
      {accentColors.map((c) => {
        const isSelected = c.id === "blue";
        return (
          <button
            key={c.id}
            type="button"
            className={`ua-settings-page__accent-swatch${isSelected ? " ua-settings-page__accent-swatch--selected" : ""}`}
            title={c.label}
            aria-label={c.label}
            aria-pressed={isSelected}
          >
            <span className="ua-settings-page__accent-fill" style={{ background: c.hex }} />
          </button>
        );
      })}
      <span className="ua-settings-page__accent-label">Blue</span>
    </div>
  );
}

function TypographyDisplay() {
  return (
    <div className="ua-settings-page__static-stack">
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">UI font</span>
        <span className="ua-settings-page__static-value">Inter</span>
      </div>
      <div className="ua-settings-page__static-row">
        <span className="ua-settings-page__static-label">Code font</span>
        <span className="ua-settings-page__static-value">JetBrains Mono</span>
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
