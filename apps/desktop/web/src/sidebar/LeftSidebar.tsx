import "./LeftSidebar.css";

/**
 * Left sidebar placeholder.
 *
 * Will host the PrimaryNav, project list, and conversation list
 * in subsequent UI tasks. For now it renders a static structural
 * placeholder so the AppShell layout is testable.
 */
export function LeftSidebar() {
  return (
    <aside className="ua-sidebar" aria-label="Sidebar">
      <nav className="ua-sidebar__nav">
        <span className="ua-sidebar__label">Navigation</span>
        <ul className="ua-sidebar__nav-list">
          <li className="ua-sidebar__nav-item ua-sidebar__nav-item--active">
            <span className="ua-sidebar__nav-icon" aria-hidden>
              ◇
            </span>
            <span className="ua-sidebar__nav-text">Workspace</span>
          </li>
          <li className="ua-sidebar__nav-item">
            <span className="ua-sidebar__nav-icon" aria-hidden>
              ○
            </span>
            <span className="ua-sidebar__nav-text">Projects</span>
          </li>
          <li className="ua-sidebar__nav-item">
            <span className="ua-sidebar__nav-icon" aria-hidden>
              ○
            </span>
            <span className="ua-sidebar__nav-text">Settings</span>
          </li>
        </ul>
      </nav>
      <div className="ua-sidebar__footer">
        <span className="ua-sidebar__placeholder">Sidebar placeholder</span>
      </div>
    </aside>
  );
}
