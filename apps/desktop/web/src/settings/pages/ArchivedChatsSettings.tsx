import { SettingsPageLayout, SettingsSection } from "../SettingsPageLayout";
import { archivedChatsPageData } from "../settings-page-data";
import "../pages/SettingsPages.css";

export function ArchivedChatsSettings() {
  return (
    <SettingsPageLayout page={archivedChatsPageData}>
      {archivedChatsPageData.sections.map((section) => (
        <SettingsSection key={section.id} section={section}>
          {section.id === "filters" && <FiltersControls />}
          {section.id === "archived-list" && <ArchivedList />}
          {section.id === "actions" && <DeleteAllControl />}
        </SettingsSection>
      ))}
      <div className="ua-settings-page__note">
        This is a UI-only mock. No real chat data is accessed.
      </div>
    </SettingsPageLayout>
  );
}

const mockArchivedChats = [
  {
    id: "arch-1",
    title: "Fix Material Compilation Errors",
    project: "Lyra_Prototype",
    date: "2026-06-20",
  },
  {
    id: "arch-2",
    title: "Refactor Blueprint Nodes for Inventory",
    project: "MechArena_Testbed",
    date: "2026-06-18",
  },
  {
    id: "arch-3",
    title: "Level Streaming Performance Review",
    project: "CitySample_Sandbox",
    date: "2026-06-15",
  },
];

function FiltersControls() {
  return (
    <div className="ua-settings-page__filters">
      <input
        type="text"
        className="ua-settings-page__filter-input"
        placeholder="Search archives..."
        disabled
        aria-disabled="true"
        aria-label="Search archives"
      />
      <button type="button" className="ua-settings-page__filter-btn" disabled aria-disabled="true">
        All projects
      </button>
    </div>
  );
}

function ArchivedList() {
  return (
    <div className="ua-settings-page__archived-list">
      {mockArchivedChats.map((chat) => (
        <div key={chat.id} className="ua-settings-page__archived-item">
          <div className="ua-settings-page__archived-item-main">
            <span className="ua-settings-page__archived-item-title">{chat.title}</span>
            <div className="ua-settings-page__archived-item-meta">
              <span>{chat.project}</span>
              <span className="ua-settings-page__archived-item-sep" aria-hidden>
                &middot;
              </span>
              <span>{chat.date}</span>
            </div>
          </div>
          <span className="ua-settings-page__archived-item-badge">Read-only</span>
        </div>
      ))}
      <p className="ua-settings-page__archived-count">
        {mockArchivedChats.length} archived conversations
      </p>
    </div>
  );
}

function DeleteAllControl() {
  return (
    <button type="button" className="ua-settings-page__danger-btn" disabled aria-disabled="true">
      Delete all archived chats
    </button>
  );
}
