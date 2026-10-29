import {useI18n} from "../i18n";
import { useOptionalRuntimeStore } from "../stores/ui-store";
import { createAgentTraceViewModel } from "../runtime/agent-trace-view-models";
import "./AgentTracePanel.css";

export function AgentTracePanel() {
  const {text: uiText} = useI18n();
  const runtime = useOptionalRuntimeStore((state) => state);
  const activeTaskId = runtime?.activeTaskId ?? null;
  const activeTask = activeTaskId ? runtime?.tasksById[activeTaskId] : undefined;
  const events = activeTaskId ? (runtime?.eventsByTaskId[activeTaskId] ?? []) : [];
  const trace = createAgentTraceViewModel(events, activeTask);

  if (trace.empty) {
    return (
      <section className="ua-agent-trace" aria-label={uiText("Agent trace panel")}>
        <div className="ua-agent-trace__header">
          <div>
            <span className="ua-agent-trace__eyebrow">{uiText("Trace")}</span>
            <h3 className="ua-agent-trace__title">{uiText("No active Agent trace")}</h3>
          </div>
          <span className="ua-agent-trace__state">{uiText("idle")}</span>
        </div>
      </section>
    );
  }

  return (
    <section className="ua-agent-trace" aria-label={uiText("Agent trace panel")}>
      <div className="ua-agent-trace__header">
        <div>
          <span className="ua-agent-trace__eyebrow">{uiText("Trace")}</span>
          <h3 className="ua-agent-trace__title">{uiText("Agent run trace")}</h3>
          <p className="ua-agent-trace__goal">{trace.goal}</p>
        </div>
        <span className="ua-agent-trace__state">{trace.status}</span>
      </div>

      <div className="ua-agent-trace__summary">{trace.summary}</div>

      <div className="ua-agent-trace__section">
        <h4 className="ua-agent-trace__section-title">{uiText("Steps")}</h4>
        <ul className="ua-agent-trace__list">
          {trace.steps.map((step) => (
            <li key={step.id} className="ua-agent-trace__item">
              <span className="ua-agent-trace__item-main">{step.title}</span>
              <span className="ua-agent-trace__item-meta">
                {step.state} / {step.detail}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="ua-agent-trace__section">
        <h4 className="ua-agent-trace__section-title">{uiText("Observations")}</h4>
        <ul className="ua-agent-trace__list">
          {trace.observations.map((observation) => (
            <li key={observation} className="ua-agent-trace__item">
              {observation}
            </li>
          ))}
          {trace.observations.length === 0 && (
            <li className="ua-agent-trace__item">{uiText("No observations recorded")}</li>
          )}
        </ul>
      </div>

      <div className="ua-agent-trace__section">
        <h4 className="ua-agent-trace__section-title">{uiText("Evidence")}</h4>
        <p className="ua-agent-trace__line">
          {uiText("Evidence refs:")}{" "}{trace.evidenceRefs.length > 0 ? trace.evidenceRefs.join(", ") : uiText("none")}
        </p>
      </div>

      <div className="ua-agent-trace__section">
        <h4 className="ua-agent-trace__section-title">{uiText("Report")}</h4>
        <p className="ua-agent-trace__line">{trace.reportSummary ?? uiText("No report created")}</p>
      </div>

      {trace.blockedActions.length > 0 && (
        <div className="ua-agent-trace__section">
          <h4 className="ua-agent-trace__section-title">{uiText("Blocked actions")}</h4>
          <ul className="ua-agent-trace__list">
            {trace.blockedActions.map((action) => (
              <li key={action} className="ua-agent-trace__item ua-agent-trace__item--warning">
                {action}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="ua-agent-trace__section">
        <h4 className="ua-agent-trace__section-title">{uiText("Events")}</h4>
        <ul className="ua-agent-trace__list">
          {trace.rows.map((row) => (
            <li key={row.id} className={`ua-agent-trace__item ua-agent-trace__item--${row.tone}`}>
              <span className="ua-agent-trace__item-main">{uiText(row.label)}</span>
              <span className="ua-agent-trace__item-meta">{row.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
