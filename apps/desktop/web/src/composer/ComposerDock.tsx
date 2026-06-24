import { useState } from "react";
import { ContextRing } from "./ContextRing";
import { composerMock } from "./composer-data";
import "./ComposerDock.css";

export function ComposerDock() {
  const [input, setInput] = useState("");
  const {
    permission,
    runMode,
    project,
    branch,
    model,
    context,
    statusItems,
    placeholder,
    addButtonLabel,
    sendButtonLabel,
  } = composerMock;

  return (
    <footer className="ua-composer" aria-label="Composer dock">
      <div className="ua-composer__input-row">
        <button
          className="ua-composer__add-btn"
          type="button"
          disabled
          aria-label="Add context - disabled"
          title="Add context attachment (future)"
        >
          {addButtonLabel}
        </button>

        <span className="ua-composer__permission" aria-label="Permission: Request approval">
          {permission === "request-approval" ? "Request approval" : "Auto approve"}
        </span>

        <textarea
          className="ua-composer__textarea"
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="Composer input"
        />

        <ContextRing percent={context.percent} />

        <span className="ua-composer__model" aria-label={`Model: ${model.label}`}>
          {model.label}
        </span>

        <button
          className="ua-composer__send-btn"
          type="button"
          disabled
          aria-label="Send - disabled"
        >
          {sendButtonLabel}
        </button>
      </div>

      <div className="ua-composer__status-row">
        <span className="ua-composer__status-item">
          <span className="ua-composer__status-label">Project</span>
          <span className="ua-composer__status-value">{project}</span>
        </span>

        <span className="ua-composer__status-item">
          <span className="ua-composer__status-label">Mode</span>
          <span className="ua-composer__status-value">
            {runMode === "local" ? "Local mode" : "Sandbox"}
          </span>
        </span>

        <span className="ua-composer__status-item">
          <span className="ua-composer__status-label">Branch</span>
          <span className="ua-composer__status-value ua-text-mono">{branch}</span>
        </span>

        {statusItems.map((item) => (
          <span
            key={item.id}
            className={`ua-composer__status-item ua-composer__status-item--${item.tone ?? "default"}`}
          >
            <span className="ua-composer__status-label">{item.label}</span>
            <span className="ua-composer__status-value">{item.value}</span>
          </span>
        ))}
      </div>
    </footer>
  );
}
