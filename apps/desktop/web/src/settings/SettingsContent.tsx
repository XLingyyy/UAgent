import { getSettingsPage } from "./settings-pages";
import { GeneralSettings } from "./pages/GeneralSettings";
import { ProfileSettings } from "./pages/ProfileSettings";
import { AppearanceSettings } from "./pages/AppearanceSettings";
import { ConfigSettings } from "./pages/ConfigSettings";
import { PersonalizationSettings } from "./pages/PersonalizationSettings";
import { ProviderSettings } from "./pages/ProviderSettings";
import { useSettingsStore } from "../stores/ui-store";
import "./SettingsContent.css";

const PAGE_COMPONENTS: Record<string, () => React.ReactNode> = {
  general: GeneralSettings,
  profile: ProfileSettings,
  appearance: AppearanceSettings,
  config: ConfigSettings,
  personalization: PersonalizationSettings,
  provider: ProviderSettings,
};

export function SettingsContent() {
  const activePageId = useSettingsStore((state) => state.activePageId);
  const page = getSettingsPage(activePageId);
  const Page = page ? PAGE_COMPONENTS[page.id] : null;

  if (!page && !Page) {
    return (
      <main className="ua-settings-content" aria-label="Settings: unknown page">
        <div className="ua-settings-content__header">
          <h2 className="ua-settings-content__title">{activePageId}</h2>
        </div>
      </main>
    );
  }

  return Page ? <Page /> : null;
}
