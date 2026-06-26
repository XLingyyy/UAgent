import type { AgentReport, TaskEvent } from "@uagent/shared";
import { InspectorSummaryCard } from "./InspectorSummaryCard";
import { InspectorFinding, type ReviewFinding } from "./InspectorFinding";
import { reviewSummary, reviewFindings } from "./inspector-data";
import { extractRuntimeReview } from "../runtime/event-view-models";
import { useOptionalRuntimeStore } from "../stores/ui-store";
import "./ReviewPanel.css";

function extractReport(event: TaskEvent): AgentReport | null {
  const payload =
    event.payload && typeof event.payload === "object"
      ? (event.payload as Record<string, unknown>)
      : null;
  return payload?.report && typeof payload.report === "object"
    ? (payload.report as AgentReport)
    : null;
}

function runtimeFinding(event: TaskEvent, report: AgentReport | null): ReviewFinding[] {
  if (!report) {
    return [
      {
        id: event.id,
        severity: event.level === "success" ? "passed" : "info",
        title: event.title,
        description: event.body ?? "",
        scope: "AgentLoop",
        evidenceRef: event.type,
      },
    ];
  }

  const summary: ReviewFinding = {
    id: `${event.id}-summary`,
    severity: report.blockedActions.length > 0 ? "warning" : "passed",
    title: event.title,
    description: report.summary,
    scope: "AgentLoop",
    evidenceRef: report.id,
  };
  const findings = report.findings.map((finding, index): ReviewFinding => ({
    id: `${event.id}-finding-${index}`,
    severity: report.blockedActions.length > 0 ? "warning" : "info",
    title: `Finding ${index + 1}`,
    description: finding,
    scope: "AgentLoop",
    evidenceRef: report.evidenceRefs[index] ?? report.id,
  }));
  const blocked = report.blockedActions.map((action, index): ReviewFinding => ({
    id: `${event.id}-blocked-${index}`,
    severity: "warning",
    title: "Blocked action",
    description: action.reason,
    scope: action.toolName ?? action.stepId,
    evidenceRef: action.riskLevel ?? "policy",
  }));
  return [summary, ...findings, ...blocked];
}

function runtimeFindings(events: TaskEvent[]): ReviewFinding[] {
  const seenReportIds = new Set<string>();
  const findings: ReviewFinding[] = [];

  for (const event of events) {
    const report = extractReport(event);
    if (report) {
      if (seenReportIds.has(report.id)) {
        continue;
      }
      seenReportIds.add(report.id);
    }
    findings.push(...runtimeFinding(event, report));
  }

  return findings;
}

export function ReviewPanel() {
  const runtime = useOptionalRuntimeStore((state) => state);
  const activeTaskId = runtime?.activeTaskId ?? null;
  const activeTask = activeTaskId ? runtime?.tasksById[activeTaskId] : null;
  const runtimeEvents = activeTaskId ? (runtime?.eventsByTaskId[activeTaskId] ?? []) : [];
  const reviewEvents = extractRuntimeReview(runtimeEvents);
  const findings = runtimeFindings(reviewEvents);

  if (activeTask && reviewEvents.length > 0) {
    return (
      <section className="ua-review-panel" aria-label="Review panel">
        <div className="ua-review-panel__summary">
          <InspectorSummaryCard label="Task" value={activeTask.title} />
          <InspectorSummaryCard label="Verdict" value={activeTask.state} />
        </div>
        <div className="ua-review-panel__findings">
          <h3 className="ua-review-panel__section-title">Findings</h3>
          {findings.map((finding) => (
            <InspectorFinding key={finding.id} {...finding} />
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
