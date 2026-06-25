import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { MockProject } from "../types/ui";
import "./ProjectSelector.css";

export interface ProjectSelectorProps {
  value: string | null;
  projects: MockProject[];
  onChange: (projectId: string | null) => void;
}

interface DropdownPosition {
  left: number;
  bottom: number;
}

const DROPDOWN_MAX_WIDTH = 360;
const DROPDOWN_VIEWPORT_MARGIN = 12;

function getDropdownLeft(triggerLeft: number) {
  const dropdownWidth = Math.min(
    DROPDOWN_MAX_WIDTH,
    window.innerWidth - DROPDOWN_VIEWPORT_MARGIN * 2,
  );
  const maxLeft = Math.max(
    DROPDOWN_VIEWPORT_MARGIN,
    window.innerWidth - dropdownWidth - DROPDOWN_VIEWPORT_MARGIN,
  );
  return Math.min(Math.max(DROPDOWN_VIEWPORT_MARGIN, triggerLeft), maxLeft);
}

export function ProjectSelector({ value, projects, onChange }: ProjectSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [position, setPosition] = useState<DropdownPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const activeProject = projects.find((p) => p.id === value) ?? null;

  const triggerLabel = activeProject ? `Project: ${activeProject.name}` : "No project";

  const close = useCallback(() => {
    setIsOpen(false);
    setSearchText("");
    setPosition(null);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPosition({
        left: getDropdownLeft(rect.left),
        bottom: window.innerHeight - rect.top + 4,
      });
    }

    const timer = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handleKeyDown);

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current && !triggerRef.current.contains(target)) {
        const dropdown = document.querySelector(".ua-project-selector__dropdown");
        if (dropdown && !dropdown.contains(target)) {
          close();
        }
      }
    };
    const clickTimer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
      clearTimeout(timer);
      clearTimeout(clickTimer);
    };
  }, [isOpen, close]);

  const handleTriggerClick = () => {
    if (isOpen) {
      close();
    } else {
      setIsOpen(true);
    }
  };

  const handleSelect = (projectId: string | null) => {
    onChange(projectId);
    close();
  };

  const filteredProjects = searchText
    ? projects.filter((p) => p.name.toLowerCase().includes(searchText.toLowerCase()))
    : projects;

  return (
    <div className="ua-project-selector">
      <button
        ref={triggerRef}
        className={`ua-project-selector__trigger${!activeProject ? " ua-project-selector__trigger--empty" : ""}`}
        type="button"
        aria-label={`Project selector: ${activeProject ? activeProject.name : "No project"}`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={handleTriggerClick}
      >
        <span className="ua-project-selector__trigger-label">{triggerLabel}</span>
        <span className="ua-project-selector__chevron" aria-hidden="true">
          {isOpen ? "\u25B4" : "\u25BE"}
        </span>
      </button>

      {isOpen &&
        position &&
        createPortal(
          <div
            className="ua-project-selector__dropdown"
            role="listbox"
            aria-label="Select project"
            style={{
              position: "fixed",
              left: `${position.left}px`,
              bottom: `${position.bottom}px`,
            }}
          >
            <div className="ua-project-selector__search">
              <input
                ref={searchInputRef}
                className="ua-project-selector__search-input"
                type="text"
                placeholder="Search projects"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                aria-label="Search projects"
              />
            </div>

            <div className="ua-project-selector__list">
              {filteredProjects.length === 0 && (
                <div className="ua-project-selector__empty">No matching projects</div>
              )}

              {filteredProjects.map((project) => (
                <div
                  key={project.id}
                  className={`ua-project-selector__item${project.id === value ? " ua-project-selector__item--selected" : ""}`}
                  role="option"
                  aria-selected={project.id === value}
                  onClick={() => handleSelect(project.id)}
                >
                  <span className="ua-project-selector__item-check" aria-hidden="true">
                    {project.id === value ? "\u2713" : ""}
                  </span>
                  <span className="ua-project-selector__item-body">
                    <span className="ua-project-selector__item-name">{project.name}</span>
                    <span className="ua-project-selector__item-meta">
                      {project.engineVersion}
                      <span className="ua-project-selector__item-sep" aria-hidden="true">
                        {" "}
                        &middot;{" "}
                      </span>
                      <span className="ua-project-selector__item-status--warning">
                        {project.connectionStatus}
                      </span>
                    </span>
                    <span className="ua-project-selector__item-path" title={project.path}>
                      {project.path}
                    </span>
                  </span>
                </div>
              ))}
            </div>

            <div className="ua-project-selector__section-divider" />

            <div
              className="ua-project-selector__item ua-project-selector__item--none"
              role="option"
              aria-selected={value === null}
              onClick={() => handleSelect(null)}
            >
              <span className="ua-project-selector__item-check" aria-hidden="true">
                {value === null ? "\u2713" : ""}
              </span>
              <span className="ua-project-selector__item-body">
                <span className="ua-project-selector__item-name">No project</span>
                <span className="ua-project-selector__item-desc">Use no project</span>
              </span>
            </div>

            <div className="ua-project-selector__section-divider" />

            <div
              className="ua-project-selector__item ua-project-selector__item--disabled"
              role="option"
              aria-disabled="true"
            >
              <span className="ua-project-selector__item-plus" aria-hidden="true">
                +
              </span>
              <span className="ua-project-selector__item-body">
                <span className="ua-project-selector__item-name ua-project-selector__item-name--muted">
                  Add new project
                </span>
                <span className="ua-project-selector__item-desc">
                  Directory picker coming in MVP1
                </span>
              </span>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
