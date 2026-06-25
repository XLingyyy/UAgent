import type { NavSection } from "../types/ui";
import "./PrimaryNav.css";

export interface NavItem {
  key: NavSection;
  label: string;
  symbol: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: "workspace", label: "Workspace", symbol: "◇" },
  { key: "projects", label: "Projects", symbol: "○" },
  { key: "settings", label: "Settings", symbol: "⚙" },
];

export interface PrimaryNavProps {
  activeNav: NavSection;
  onNavChange: (nav: NavSection) => void;
  onSettingsOpen?: () => void;
}

export function PrimaryNav({ activeNav, onNavChange, onSettingsOpen }: PrimaryNavProps) {
  return (
    <nav className="ua-primary-nav" aria-label="Primary navigation">
      <ul className="ua-primary-nav__list">
        {NAV_ITEMS.map((item) => (
          <li key={item.key}>
            <button
              className={`ua-primary-nav__item${activeNav === item.key ? " ua-primary-nav__item--active" : ""}`}
              onClick={() => {
                onNavChange(item.key);
                if (item.key === "settings" && onSettingsOpen) {
                  onSettingsOpen();
                }
              }}
              aria-current={activeNav === item.key ? "page" : undefined}
              type="button"
            >
              <span className="ua-primary-nav__icon" aria-hidden>
                {item.symbol}
              </span>
              <span className="ua-primary-nav__text">{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
