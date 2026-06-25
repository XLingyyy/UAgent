import { useUI } from "../app/providers";
import { getSettingsPage } from "./settings-pages";
import "./SettingsContent.css";

function GeneralPlaceholder() {
  return (
    <div className="ua-settings-content__placeholder">
      <p>
        General settings will allow you to configure work mode defaults, permission defaults,
        preferred language, and bottom-panel layout options.
      </p>
      <p className="ua-settings-content__note">
        This is a UI-only mock. No configuration is saved or applied.
      </p>
    </div>
  );
}

function AppearancePlaceholder() {
  return (
    <div className="ua-settings-content__placeholder">
      <p>
        Appearance settings will allow you to select a theme, accent color, font family, and
        contrast level.
      </p>
      <p className="ua-settings-content__note">
        This is a UI-only mock. No configuration is saved or applied.
      </p>
    </div>
  );
}

function ConfigPlaceholder() {
  return (
    <div className="ua-settings-content__placeholder">
      <p>
        Config settings will allow you to manage approval policies, sandbox permissions, and
        diagnostics configuration.
      </p>
      <p className="ua-settings-content__note">
        This is a UI-only mock. No configuration is saved or applied.
      </p>
    </div>
  );
}

function PersonalizationPlaceholder() {
  return (
    <div className="ua-settings-content__placeholder">
      <p>
        Personalization settings will allow you to define a default agent style and custom
        instructions that apply to all new conversations.
      </p>
      <p className="ua-settings-content__note">
        This is a UI-only mock. No configuration is saved or applied.
      </p>
    </div>
  );
}

function ArchivedChatsPlaceholder() {
  return (
    <div className="ua-settings-content__placeholder">
      <p>
        Archived chats will allow you to browse and search through your archived conversation
        history.
      </p>
      <p className="ua-settings-content__note">
        This is a UI-only mock. No real chat data is accessed.
      </p>
    </div>
  );
}

function ProviderPlaceholder() {
  return (
    <div className="ua-settings-content__placeholder">
      <p>
        Provider configuration form will be implemented in UI-014. This placeholder only marks the
        future provider settings location.
      </p>
      <p className="ua-settings-content__note">
        This is a UI-only mock. No provider is saved or connected.
      </p>
    </div>
  );
}

const PLACEHOLDERS: Record<string, () => React.ReactNode> = {
  general: GeneralPlaceholder,
  appearance: AppearancePlaceholder,
  config: ConfigPlaceholder,
  personalization: PersonalizationPlaceholder,
  "archived-chats": ArchivedChatsPlaceholder,
  provider: ProviderPlaceholder,
};

export function SettingsContent() {
  const { state } = useUI();
  const { activePageId } = state.settings;
  const page = getSettingsPage(activePageId);
  const Placeholder = page ? PLACEHOLDERS[page.id] : null;

  return (
    <main className="ua-settings-content" aria-label={`Settings: ${page?.title ?? activePageId}`}>
      <div className="ua-settings-content__header">
        <h2 className="ua-settings-content__title">{page?.title ?? activePageId}</h2>
        {page?.summary && <p className="ua-settings-content__summary">{page.summary}</p>}
      </div>
      <div className="ua-settings-content__body">{Placeholder ? <Placeholder /> : null}</div>
    </main>
  );
}
