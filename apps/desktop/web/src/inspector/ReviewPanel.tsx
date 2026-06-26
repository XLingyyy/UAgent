import { InspectorSummaryCard } from "./InspectorSummaryCard";
import { InspectorFinding } from "./InspectorFinding";
import { reviewSummary, reviewFindings } from "./inspector-data";
import { extractRuntimeReview } from "../runtime/event-view-models";
import { useOptionalRuntimeStore } from "../stores/ui-store";
import "./ReviewPanel.css";

export function ReviewPanel() {
  const runtime = useOptionalRuntimeStore((state) => state);
  const activeTaskId = runtime?.activeTaskId ?? null;
  const activeTask = activeTaskId ? runtime?.tasksById[activeTaskId] : null;
  const runtimeEvents = activeTaskId ? (runtime?.eventsByTaskId[activeTaskId] ?? []) : [];
  const reviewEvents = extractRuntimeReview(runtimeEvents);

  if (activeTask && reviewEvents.length > 0) {
    return (
      <section className="ua-review-panel" aria-label="Review panel">
        <div className="ua-review-panel__summary">
          <InspectorSummaryCard label="Task" value={activeTask.title} />
          <InspectorSummaryCard label="Verdict" value={activeTask.state} />
        </div>
        <div className="ua-review-panel__findings">
          <h3 className="ua-review-panel__section-title">Findings</h3>
          {reviewEvents.map((event) => (
            <InspectorFinding
              key={event.id}
              id={event.id}
              severity={event.level === "success" ? "passed" : "info"}
              title={event.title}
              description={event.body ?? ""}
              scope="MockRuntime"
              evidenceRef={event.type}
            />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="ua-review-panel" aria-label="Review panel">
      <div className="ua-review-panel__summary">
        <InspectorSummaryCard label="Status" value={reviewSummary.status} />
        <InspectorSummaryCard label="Verdict" value={reviewSummary.verdict} />
      </div>
      <div className="ua-review-panel__findings">
        <h3 className="ua-review-panel__section-title">Findings</h3>
        {reviewFindings.map((finding) => (
          <InspectorFinding key={finding.id} {...finding} />
        ))}
      </div>
      <div className="ua-review-panel__evidence">
        <h3 className="ua-review-panel__section-title">Evidence checklist</h3>
        <p className="ua-review-panel__evidence-note">{reviewSummary.evidenceLabel}</p>
        <ul className="ua-review-panel__evidence-list">
          {reviewSummary.evidenceItems.map((item) => (
            <li
              key={item.id}
              className={`ua-review-panel__evidence-item ua-review-panel__evidence-item--${item.status}`}
            >
              <span className="ua-review-panel__evidence-icon" aria-hidden="true">
                {item.status === "checked"
                  ? "\u2713"
                  : item.status === "pending"
                    ? "\u25CB"
                    : "\u2717"}
              </span>
              <span className="ua-review-panel__evidence-label">{item.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
