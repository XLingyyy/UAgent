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

function formatCounts(errorCount: number, warningCount: number): string {
  return `${errorCount} ${errorCount === 1 ? "error" : "errors"} / ${warningCount} ${
    warningCount === 1 ? "warning" : "warnings"
  }`;
}

export function ReviewPanel() {
  const runtime = useOptionalRuntimeStore((state) => state);
  const activeTaskId = runtime?.activeTaskId ?? null;
  const activeTask = activeTaskId ? runtime?.tasksById[activeTaskId] : null;
  const runtimeEvents = activeTaskId ? (runtime?.eventsByTaskId[activeTaskId] ?? []) : [];
  const reviewEvents = extractRuntimeReview(runtimeEvents);
  const findings = runtimeFindings(reviewEvents);
  const mvp11 = runtime?.mvp11;
  const mvp13 = runtime?.mvp13;

  if (mvp13 && (mvp13.editorProposals.length > 0 || mvp13.mcpDryRuns.length > 0 || mvp13.assetPlans.length > 0)) {
    return (
      <section className="ua-review-panel" aria-label="Review panel">
        <div className="ua-review-panel__summary">
          <InspectorSummaryCard label="Editor" value={mvp13.editorSession?.status ?? mvp13.editorCapability.reason} />
          <InspectorSummaryCard label="MCP" value={mvp13.assetPlans.length > 0 ? "blocked plan" : "dry-run"} />
        </div>
        <div className="ua-review-panel__findings">
          <h3 className="ua-review-panel__section-title">MVP13 chain</h3>
          <InspectorFinding
            id="mvp13-editor-chain"
            severity="info"
            title="Operation proposal path"
            description="Editor state changes move through proposal, approval, execution, evidence, and replay summaries."
            scope="Editor"
            evidenceRef={mvp13.evidenceIds[0] ?? "editor_operation_summary"}
          />
          <InspectorFinding
            id="mvp13-mcp-chain"
            severity={mvp13.assetPlans.length > 0 ? "warning" : "info"}
            title="MCP mutation mapping"
            description="Mutating MCP tools are dry-run/proposal only; text-backed changes map to ChangeSet v2 and asset writes stay blocked."
            scope="MCP"
            evidenceRef="mcp_mutation_summary"
          />
        </div>
      </section>
    );
  }

  if (mvp11?.analysisRequested || (mvp11 && mvp11.diagnosticCounts.total > 0)) {
    const diagnosticSummary = formatCounts(mvp11.diagnosticCounts.error, mvp11.diagnosticCounts.warning);
    const topAffectedFile = Object.values(mvp11.affectedFiles)[0]?.path ?? "No affected files recorded";
    const nextChecks = mvp11.buildAnalysis?.nextChecks ?? [
      "Analyze recorded terminal output before requesting fixes.",
    ];

    return (
      <section className="ua-review-panel" aria-label="Review panel">
        <div className="ua-review-panel__summary">
          <InspectorSummaryCard label="Status" value={mvp11.metadataStatus} />
          <InspectorSummaryCard label="Diagnostics" value={diagnosticSummary} />
        </div>
        <div className="ua-review-panel__findings" aria-label="Diagnostic summary">
          <h3 className="ua-review-panel__section-title">Diagnostic summary</h3>
          <InspectorFinding
            id="mvp11-diagnostic-counts"
            severity={mvp11.diagnosticCounts.error > 0 ? "warning" : "info"}
            title={diagnosticSummary}
            description={`${mvp11.diagnosticCounts.total} diagnostics from real MVP11 runtime state.`}
            scope="Diagnostics"
            evidenceRef="ue_project_diagnostic"
          />
          <InspectorFinding
            id="mvp11-top-files"
            severity="info"
            title="Top affected file"
            description={topAffectedFile}
            scope="Diagnostics"
            evidenceRef="build_failure_summary"
          />
          {nextChecks.map((check, index) => (
            <InspectorFinding
              key={`${check}-${index}`}
              id={`mvp11-next-check-${index}`}
              severity="info"
              title={index === 0 ? "Next checks" : `Next check ${index + 1}`}
              description={check}
              scope="Diagnostics"
              evidenceRef={mvp11.contextPack?.id ?? "context_pack_summary"}
            />
          ))}
        </div>
      </section>
    );
  }

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
      <div className="ua-review-panel__findings" aria-label="Diagnostic summary">
        <h3 className="ua-review-panel__section-title">Diagnostic summary</h3>
        <InspectorFinding
          id="mvp11-diagnostic-counts"
          severity="info"
          title="Error and warning counts"
          description="Recorded MVP11 summaries expose error count, warning count, top files, and next checks without automatic fixes."
          scope="Diagnostics"
          evidenceRef="build_failure_summary"
        />
        <InspectorFinding
          id="mvp11-top-files"
          severity="info"
          title="Top files"
          description="[project-root]/Source and [project-root]/Config entries are surfaced from redacted diagnostics."
          scope="Diagnostics"
          evidenceRef="ue_project_diagnostic"
        />
        <InspectorFinding
          id="mvp11-next-checks"
          severity="info"
          title="Next checks"
          description="Open the first affected file, verify module references, then run an approved verification command manually."
          scope="Diagnostics"
          evidenceRef="context_pack_summary"
        />
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
