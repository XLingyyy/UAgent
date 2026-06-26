import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ComingSoonGate } from "../components/ComingSoonGate";
import { type ComposerPermission, permissionOptions } from "./composer-data";
import "./PermissionSelector.css";

export interface PermissionSelectorProps {
  value: ComposerPermission;
  onChange: (value: ComposerPermission) => void;
}

interface DropdownPosition {
  left: number;
  bottom: number;
}

const DROPDOWN_MAX_WIDTH = 300;
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

export function PermissionSelector({ value, onChange }: PermissionSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [position, setPosition] = useState<DropdownPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const current = permissionOptions.find((o) => o.id === value);
  const label = current?.label ?? value;

  const close = useCallback(() => {
    setIsOpen(false);
    setIsConfirming(false);
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

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handleKeyDown);

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current && !triggerRef.current.contains(target)) {
        const dropdown = document.querySelector(".ua-permission-selector__dropdown");
        if (dropdown && !dropdown.contains(target)) {
          close();
        }
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
      clearTimeout(timer);
    };
  }, [isOpen, close]);

  const handleTriggerClick = () => {
    if (isOpen) {
      close();
    } else {
      setIsOpen(true);
    }
  };

  const handleSelect = (option: (typeof permissionOptions)[number]) => {
    if (!option.enabled) return;
    if (option.requiresConfirmation) {
      setIsConfirming(true);
      return;
    }
    onChange(option.id);
    close();
  };

  const iconMap: Record<string, string> = {
    "request-approval": "\u{1F6E1}",
    "auto-approve": "\u{26A1}",
    "full-access": "\u{26A0}",
    custom: "\u2699",
  };

  return (
    <div className="ua-permission-selector">
      <button
        ref={triggerRef}
        className={`ua-permission-selector__trigger ua-permission-selector__trigger--${current?.tone ?? "default"}`}
        type="button"
        aria-label={`Permission mode: ${label}`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={handleTriggerClick}
      >
        {current?.tone === "warning" && (
          <span className="ua-permission-selector__trigger-icon" aria-hidden="true">
            {iconMap[value] ?? ""}
          </span>
        )}
        <span className="ua-permission-selector__trigger-label">{label}</span>
        <span className="ua-permission-selector__chevron" aria-hidden="true">
          {isOpen ? "\u25B4" : "\u25BE"}
        </span>
      </button>

      {isOpen &&
        position &&
        createPortal(
          <div
            className="ua-permission-selector__dropdown ua-motion-layer"
            role="listbox"
            aria-label="Permission mode"
            data-motion="layer"
            style={{
              position: "fixed",
              left: `${position.left}px`,
              bottom: `${position.bottom}px`,
            }}
          >
            {isConfirming ? (
              <div className="ua-permission-selector__confirmation">
                <p className="ua-permission-selector__confirmation-text">
                  MVP0 mock only. No runtime permission is changed. No filesystem, network, UE/MCP,
                  or command execution is enabled.
                </p>
                <div className="ua-permission-selector__confirmation-actions">
                  <button
                    className="ua-permission-selector__confirm-btn"
                    type="button"
                    onClick={() => {
                      onChange("full-access");
                      close();
                    }}
                  >
                    Confirm mock mode
                  </button>
                  <button
                    className="ua-permission-selector__cancel-btn"
                    type="button"
                    onClick={() => {
                      setIsConfirming(false);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              permissionOptions.map((option) => {
                const optionNode = (
                  <div
                    key={option.id}
                    className={`ua-permission-selector__item${
                      option.id === value ? " ua-permission-selector__item--selected" : ""
                    }${!option.enabled ? " ua-permission-selector__item--disabled" : ""}`}
                    role="option"
                    aria-selected={option.id === value}
                    aria-disabled={!option.enabled || undefined}
                    onClick={() => handleSelect(option)}
                  >
                    <span className="ua-permission-selector__item-check" aria-hidden="true">
                      {option.id === value ? "\u2713" : iconMap[option.id]}
                    </span>
                    <span className="ua-permission-selector__item-body">
                      <span
                        className={`ua-permission-selector__item-label ua-permission-selector__item-label--${option.tone}`}
                      >
                        {option.label}
                      </span>
                      <span className="ua-permission-selector__item-desc">
                        {option.description}
                      </span>
                    </span>
                  </div>
                );

                if (!option.enabled && option.phase && option.comingSoonReason) {
                  return (
                    <ComingSoonGate
                      key={option.id}
                      blockChild
                      phase={option.phase}
                      reason={option.comingSoonReason}
                    >
                      {optionNode}
                    </ComingSoonGate>
                  );
                }

                return optionNode;
              })
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
