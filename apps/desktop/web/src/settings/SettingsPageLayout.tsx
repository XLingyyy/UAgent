import {useI18n} from "../i18n";
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
  const {text: uiText,t} = useI18n();
  return (
    <main
      className="ua-settings-content"
      aria-label={t("settings.pageLabel",{page:uiText(page.title)})}
      data-settings-page={page.id}
    >
      <div className="ua-settings-content__header">
        <h2 className="ua-settings-content__title">{uiText(page.title)}</h2>
        <p className="ua-settings-content__summary">{uiText(page.description)}</p>
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
  const {text: uiText} = useI18n();
  return (
    <section className="ua-settings-section" aria-labelledby={`section-${section.id}`}>
      <div className="ua-settings-section__header">
        <h3 id={`section-${section.id}`} className="ua-settings-section__title">
          {uiText(section.title)}
        </h3>
        {section.description && (
          <p className="ua-settings-section__description">{uiText(section.description)}</p>
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
  const {text: uiText} = useI18n();
  return (
    <div
      className={`ua-settings-row${row.disabled ? " ua-settings-row--disabled" : ""}`}
      data-row-id={row.id}
    >
      <div className="ua-settings-row__info">
        <span className="ua-settings-row__label">{uiText(row.label)}</span>
        {row.description && <span className="ua-settings-row__description">{uiText(row.description)}</span>}
      </div>
      <div className="ua-settings-row__control">
        {row.disabled && row.disabledReason && (
          <span className="ua-settings-row__disabled-reason">{uiText(row.disabledReason)}</span>
        )}
      </div>
    </div>
  );
}
