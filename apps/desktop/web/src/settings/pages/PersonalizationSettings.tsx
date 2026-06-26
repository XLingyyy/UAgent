import { ComingSoonGate, getComingSoonPhase } from "../../components/ComingSoonGate";
import { SettingsPageLayout, SettingsSection } from "../SettingsPageLayout";
import { personalizationPageData } from "../settings-page-data";
import "../pages/SettingsPages.css";

export function PersonalizationSettings() {
  return (
    <SettingsPageLayout page={personalizationPageData}>
      {personalizationPageData.sections.map((section) => (
        <SettingsSection key={section.id} section={section}>
          {section.id === "agent-style" && <AgentStyleDisplay />}
          {section.id === "instructions" && <InstructionsDisplay />}
          {section.id === "memory" && <MemoryDisplay />}
        </SettingsSection>
      ))}
      <div className="ua-settings-page__note">
        This is a UI-only mock. No configuration is saved or applied.
      </div>
    </SettingsPageLayout>
  );
}

function AgentStyleDisplay() {
  return (
    <div
      className="ua-settings-page__option-group"
      role="radiogroup"
      aria-label="Default agent style"
    >
      <label className="ua-settings-page__option ua-settings-page__option--selected">
        <span className="ua-settings-page__option-radio" aria-hidden />
        <span>Concise</span>
      </label>
      <label className="ua-settings-page__option">
        <span className="ua-settings-page__option-radio" aria-hidden />
        <span>Detailed</span>
      </label>
      <label className="ua-settings-page__option">
        <span className="ua-settings-page__option-radio" aria-hidden />
        <span>Exploratory</span>
      </label>
    </div>
  );
}

function InstructionsDisplay() {
  const instructionsSection = personalizationPageData.sections.find(
    (section) => section.id === "instructions",
  )!;
  const projectPhase = getComingSoonPhase(instructionsSection.rows[0]?.disabledReason);
  const globalPhase = getComingSoonPhase(instructionsSection.rows[1]?.disabledReason);

  return (
    <div className="ua-settings-page__instructions-group">
      {projectPhase ? (
        <ComingSoonGate
          blockChild
          phase={projectPhase}
          reason={instructionsSection.rows[0].description ?? ""}
        >
          <div className="ua-settings-page__instructions-field">
            <span className="ua-settings-page__instructions-label">
              Project custom instructions
            </span>
            <textarea
              className="ua-settings-page__textarea"
              disabled
              aria-disabled="true"
              rows={3}
              placeholder="Project-specific instructions will be editable here in MVP1."
              value=""
              readOnly
            />
          </div>
        </ComingSoonGate>
      ) : null}
      {globalPhase ? (
        <ComingSoonGate
          blockChild
          phase={globalPhase}
          reason={instructionsSection.rows[1].description ?? ""}
        >
          <div className="ua-settings-page__instructions-field">
            <span className="ua-settings-page__instructions-label">Global custom instructions</span>
            <textarea
              className="ua-settings-page__textarea"
              disabled
              aria-disabled="true"
              rows={3}
              placeholder="Global custom instructions will be editable here in MVP1."
              value=""
              readOnly
            />
          </div>
        </ComingSoonGate>
      ) : null}
    </div>
  );
}

function MemoryDisplay() {
  const memorySection = personalizationPageData.sections.find(
    (section) => section.id === "memory",
  )!;
  const memoryPhase = getComingSoonPhase(memorySection.rows[0]?.disabledReason);

  return (
    <div className="ua-settings-page__toggle-group">
      {memoryPhase ? (
        <ComingSoonGate phase={memoryPhase} reason={memorySection.description ?? ""}>
          <label className="ua-settings-page__toggle-item">
            <span
              className="ua-settings-page__toggle-icon ua-settings-page__toggle-icon--off"
              aria-hidden
            />
            <span>Enable agent memory</span>
          </label>
        </ComingSoonGate>
      ) : null}
      {memoryPhase ? (
        <ComingSoonGate phase={memoryPhase} reason={memorySection.description ?? ""}>
          <label className="ua-settings-page__toggle-item">
            <span
              className="ua-settings-page__toggle-icon ua-settings-page__toggle-icon--off"
              aria-hidden
            />
            <span>Memory scope: Global</span>
          </label>
        </ComingSoonGate>
      ) : null}
    </div>
  );
}
