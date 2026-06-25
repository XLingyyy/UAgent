import {
  type SettingsPageData,
  type SettingsSectionData,
  type SettingsRow,
} from "./settings-page-data";
import "./SettingsPageLayout.css";

export function SettingsPageLayout({
  page,
  children,
}: {
  page: SettingsPageData;
  children: React.ReactNode;
}) {
  return (
    <main
      className="ua-settings-content"
      aria-label={`Settings: ${page.title}`}
      data-settings-page={page.id}
    >
      <div className="ua-settings-content__header">
        <h2 className="ua-settings-content__title">{page.title}</h2>
        <p className="ua-settings-content__summary">{page.description}</p>
      </div>
      <div className="ua-settings-content__body">{children}</div>
    </main>
  );
}

export function SettingsSection({
  section,
  children,
}: {
  section: SettingsSectionData;
  children?: React.ReactNode;
}) {
  return (
    <section className="ua-settings-section" aria-labelledby={`section-${section.id}`}>
      <div className="ua-settings-section__header">
        <h3 id={`section-${section.id}`} className="ua-settings-section__title">
          {section.title}
        </h3>
        {section.description && (
          <p className="ua-settings-section__description">{section.description}</p>
        )}
      </div>
      <div className="ua-settings-section__body">
        {section.rows.map((row) => (
          <SettingsRowItem key={row.id} row={row} />
        ))}
        {children}
      </div>
    </section>
  );
}

export function SettingsRowItem({ row }: { row: SettingsRow }) {
  return (
    <div
      className={`ua-settings-row${row.disabled ? " ua-settings-row--disabled" : ""}`}
      data-row-id={row.id}
    >
      <div className="ua-settings-row__info">
        <span className="ua-settings-row__label">{row.label}</span>
        {row.description && <span className="ua-settings-row__description">{row.description}</span>}
      </div>
      <div className="ua-settings-row__control">
        {row.disabled && row.disabledReason && (
          <span className="ua-settings-row__disabled-reason">{row.disabledReason}</span>
        )}
      </div>
    </div>
  );
}
