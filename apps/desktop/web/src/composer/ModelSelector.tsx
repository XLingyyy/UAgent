import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  type ComposerModelId,
  type ComposerReasoningEffort,
  type ComposerModelOption,
  type ComposerReasoningOption,
  getNetworkModeLabel,
} from "./composer-data";
import "./ModelSelector.css";

export interface ModelSelectorProps {
  modelId: ComposerModelId;
  reasoningEffort: ComposerReasoningEffort;
  models: ComposerModelOption[];
  reasoningOptionsList: ComposerReasoningOption[];
  onModelChange: (modelId: ComposerModelId) => void;
  onReasoningChange: (effort: ComposerReasoningEffort) => void;
  onManageProviders?: () => void;
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

export function ModelSelector({
  modelId,
  reasoningEffort,
  models,
  reasoningOptionsList,
  onModelChange,
  onReasoningChange,
  onManageProviders,
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<DropdownPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const currentModel = models.find((m) => m.id === modelId);
  const currentReasoning = reasoningOptionsList.find((r) => r.id === reasoningEffort);
  const modelLabel = currentModel?.label ?? "Model not configured";
  const reasoningLabel = currentReasoning?.label ?? "Medium";
  const triggerAriaLabel = `Model selector: ${modelLabel}, reasoning ${reasoningLabel.toLowerCase()}`;
  const isModelNotConfigured = modelId === "not-configured";

  const close = useCallback(() => {
    setIsOpen(false);
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
        const dropdown = document.querySelector(".ua-model-selector__dropdown");
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

  const handleModelSelect = (option: ComposerModelOption) => {
    if (!option.enabled) return;
    onModelChange(option.id);
    close();
  };

  const handleReasoningSelect = (option: ComposerReasoningOption) => {
    onReasoningChange(option.id);
    close();
  };

  const handleManageProviders = () => {
    onManageProviders?.();
    close();
  };

  return (
    <div className="ua-model-selector">
      <button
        ref={triggerRef}
        className={`ua-model-selector__trigger${
          isModelNotConfigured ? " ua-model-selector__trigger--warning" : ""
        }`}
        type="button"
        aria-label={triggerAriaLabel}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={handleTriggerClick}
      >
        <span className="ua-model-selector__trigger-label">
          <span className="ua-model-selector__trigger-model">{modelLabel}</span>
          <span className="ua-model-selector__trigger-sep" aria-hidden="true">
            {" "}
            ·{" "}
          </span>
          <span className="ua-model-selector__trigger-reasoning">{reasoningLabel}</span>
        </span>
        <span className="ua-model-selector__chevron" aria-hidden="true">
          {isOpen ? "\u25B4" : "\u25BE"}
        </span>
      </button>

      {isOpen &&
        position &&
        createPortal(
          <div
            className="ua-model-selector__dropdown ua-motion-layer"
            role="listbox"
            aria-label="Model and reasoning settings"
            data-motion="layer"
            style={{
              position: "fixed",
              left: `${position.left}px`,
              bottom: `${position.bottom}px`,
            }}
          >
            <div className="ua-model-selector__group-header">Reasoning</div>

            {reasoningOptionsList.map((option) => (
              <div
                key={option.id}
                className={`ua-model-selector__item${
                  option.id === reasoningEffort ? " ua-model-selector__item--selected" : ""
                }`}
                role="option"
                aria-selected={option.id === reasoningEffort}
                onClick={() => handleReasoningSelect(option)}
              >
                <span className="ua-model-selector__item-check" aria-hidden="true">
                  {option.id === reasoningEffort ? "\u2713" : ""}
                </span>
                <span className="ua-model-selector__item-body">
                  <span className="ua-model-selector__item-label">{option.label}</span>
                </span>
              </div>
            ))}

            <div className="ua-model-selector__section-divider" />

            <div className="ua-model-selector__group-header">Models</div>

            {models.map((option) => (
              <div
                key={option.id}
                className={`ua-model-selector__item${
                  option.id === modelId ? " ua-model-selector__item--selected" : ""
                }${!option.enabled ? " ua-model-selector__item--disabled" : ""}`}
                role="option"
                aria-selected={option.id === modelId}
                aria-disabled={!option.enabled || undefined}
                onClick={() => handleModelSelect(option)}
              >
                <span className="ua-model-selector__item-check" aria-hidden="true">
                  {option.id === modelId ? "\u2713" : ""}
                </span>
                <span className="ua-model-selector__item-body">
                  <span className="ua-model-selector__item-label">
                    {option.provider !== "None"
                      ? `${option.provider} / ${option.label}`
                      : option.label}
                  </span>
                  <span className="ua-model-selector__item-desc">
                    {option.contextWindow !== "N/A"
                      ? `Context: ${option.contextWindow} · ${getNetworkModeLabel(option.networkMode ?? "mock")}`
                      : "No model selected"}
                    {option.hasSecret === false && option.networkMode === "live" && (
                      <span className="ua-model-selector__item-warning"> · No secret</span>
                    )}
                  </span>
                </span>
              </div>
            ))}

            <div className="ua-model-selector__section-divider" />

            <div className="ua-model-selector__item" role="option" onClick={handleManageProviders}>
              <span className="ua-model-selector__item-body">
                <span className="ua-model-selector__item-label">Manage providers</span>
                <span className="ua-model-selector__item-desc">Open provider settings</span>
              </span>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
