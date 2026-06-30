import type { TaskEvent } from "@uagent/shared";
import { InspectorSummaryCard } from "./InspectorSummaryCard";
import { diagnosticSummary } from "./inspector-data";
import { extractRuntimeDiagnostics } from "../runtime/event-view-models";
import type { RuntimeStoreState } from "../runtime/runtime-store";
import { useOptionalRuntimeStore, useOptionalRuntimeActions } from "../stores/ui-store";
import "./DiagnosticsPanel.css";

const TONE_LABEL_CLASS: Record<string, string> = {
  default: "ua-diagnostics-item__state--default",
  warning: "ua-diagnostics-item__state--warning",
  accent: "ua-diagnostics-item__state--accent",
  success: "ua-diagnostics-item__state--success",
};

function uniqueDiagnostics(events: TaskEvent[]): TaskEvent[] {
  const diagnosticsByReason = new Map<string, TaskEvent>();

  for (const event of events) {
    const key = event.body ?? event.title;
    const current = diagnosticsByReason.get(key);
    if (!current || diagnosticPriority(event) > diagnosticPriority(current)) {
      diagnosticsByReason.set(key, event);
    }
  }

  return [...diagnosticsByReason.values()];
}

function diagnosticPriority(event: TaskEvent): number {
  if (event.type === "task_failed") return 5;
  if (event.type === "task_cancelled") return 4;
  if (event.type === "mcp_tool_blocked") return 3;
  if (event.type === "agent_step_failed") return 2;
  if (event.level === "error") return 1;
  return 0;
}

function hasMvp11State(runtime: RuntimeStoreState | null): boolean {
  const mvp11 = runtime?.mvp11;
  return Boolean(
    mvp11 &&
      (mvp11.analysisRequested ||
        mvp11.metadataStatus !== "idle" ||
        mvp11.buildAnalysisStatus !== "idle" ||
        mvp11.contextPackStatus !== "idle" ||
        mvp11.diagnosticCounts.total > 0 ||
        mvp11.contextPack),
  );
}

function formatCounts(errorCount: number, warningCount: number): string {
  return `${errorCount} ${errorCount === 1 ? "error" : "errors"} / ${warningCount} ${
    warningCount === 1 ? "warning" : "warnings"
  }`;
}

export function DiagnosticsPanel() {
  const runtime = useOptionalRuntimeStore((state) => state);
  const activeTaskId = runtime?.activeTaskId ?? null;
  const runtimeEvents = activeTaskId ? (runtime?.eventsByTaskId[activeTaskId] ?? []) : [];
  const diagnostics = uniqueDiagnostics(extractRuntimeDiagnostics(runtimeEvents));
  const mvp11 = runtime?.mvp11;
  const actions = useOptionalRuntimeActions();

  if (hasMvp11State(runtime) && mvp11) {
    const affectedFiles = Object.values(mvp11.affectedFiles).sort((left, right) =>
      left.path.localeCompare(right.path),
    );
    const kindEntries = Object.entries(mvp11.diagnosticCounts.byKind).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    const build = mvp11.buildAnalysis;

    return (
      <section className="ua-diagnostics-panel" aria-label="Diagnostics panel">
        <div className="ua-diagnostics-panel__summary">
          <InspectorSummaryCard
            label="Project diagnostics"
            value={formatCounts(mvp11.diagnosticCounts.error, mvp11.diagnosticCounts.warning)}
            tone={mvp11.diagnosticCounts.error > 0 ? "warning" : "success"}
          />
          <InspectorSummaryCard label="Context Pack" value={mvp11.contextPackStatus} />
        </div>

        <h3 className="ua-diagnostics-panel__section-title">Project diagnostics</h3>
        <div className="ua-diagnostics-panel__items">
          <div className="ua-diagnostics-item" aria-label="MVP11 diagnostic counts">
            <div className="ua-diagnostics-item__header">
              <span className="ua-diagnostics-item__label">
                {formatCounts(mvp11.diagnosticCounts.error, mvp11.diagnosticCounts.warning)}
              </span>
              <span className="ua-diagnostics-item__state ua-diagnostics-item__state--warning">
                {mvp11.metadataStatus}
              </span>
            </div>
            <p className="ua-diagnostics-item__description">
              {mvp11.diagnosticCounts.total} total diagnostics from UE metadata, project index,
              MCP read-only observations, and recorded build output.
            </p>
          </div>
          {kindEntries.map(([kind, count]) => (
            <div key={kind} className="ua-diagnostics-item" aria-label={`Diagnostic kind ${kind}`}>
              <div className="ua-diagnostics-item__header">
                <span className="ua-diagnostics-item__label">{kind}</span>
                <span className="ua-diagnostics-item__state ua-diagnostics-item__state--default">
                  {count}
                </span>
              </div>
            </div>
          ))}
          {[...mvp11.projectDiagnostics, ...mvp11.mcpDiagnostics, ...(mvp11.buildAnalysis?.diagnostics ?? [])]
            .filter((diagnostic) =>
              [
                "suspicious_build_dependency",
                "target_missing_module",
                "plugin_descriptor_missing",
                "config_secret_redacted",
                "malformed_descriptor",
                "compiler_error",
              ].includes(diagnostic.kind),
            )
            .slice(0, 6)
            .map((diagnostic) => (
              <div key={`repair-${diagnostic.id}`} className="ua-diagnostics-item" aria-label={`Repair ${diagnostic.id}`}>
                <div className="ua-diagnostics-item__header">
                  <span className="ua-diagnostics-item__label">
                    {"title" in diagnostic ? diagnostic.title : diagnostic.message}
                  </span>
                  <button
                    className="ua-diagnostics-item__state ua-diagnostics-item__state--accent"
                    type="button"
                    onClick={() => actions?.proposeRepairForDiagnostic(diagnostic.id)}
                  >
                    Propose fix
                  </button>
                </div>
                <p className="ua-diagnostics-item__description">
                  {diagnostic.displayPath ?? "No affected file"} · {diagnostic.kind}
                </p>
              </div>
            ))}
        </div>

        <h3 className="ua-diagnostics-panel__section-title">Affected files</h3>
        <div className="ua-diagnostics-panel__items">
          {affectedFiles.length > 0 ? (
            affectedFiles.slice(0, 8).map((file) => (
              <div key={file.path} className="ua-diagnostics-item" aria-label={file.path}>
                <div className="ua-diagnostics-item__header">
                  <span className="ua-diagnostics-item__label">{file.path}</span>
                  <span className="ua-diagnostics-item__state ua-diagnostics-item__state--accent">
                    {file.total}
                  </span>
                </div>
                <p className="ua-diagnostics-item__description">{file.kinds.join(", ")}</p>
              </div>
            ))
          ) : (
            <div className="ua-diagnostics-item" aria-label="No affected files">
              <p className="ua-diagnostics-item__description">No affected files recorded yet.</p>
            </div>
          )}
        </div>

        <h3 className="ua-diagnostics-panel__section-title">Build Failure Analysis</h3>
        <div className="ua-diagnostics-panel__items">
          <div className="ua-diagnostics-item" aria-label="Build diagnostics">
            <div className="ua-diagnostics-item__header">
              <span className="ua-diagnostics-item__label">
                {build ? `${build.errorCount} build errors / ${build.warningCount} warnings` : "No build analysis"}
              </span>
              <span className="ua-diagnostics-item__state ua-diagnostics-item__state--accent">
                {mvp11.buildAnalysisStatus}
              </span>
            </div>
            <p className="ua-diagnostics-item__description">
              {build?.topIssues[0] ?? "Analyze recorded terminal output to populate build diagnostics."}
            </p>
          </div>
        </div>

        <h3 className="ua-diagnostics-panel__section-title">Context Pack</h3>
        <div className="ua-diagnostics-panel__items">
          <div className="ua-diagnostics-item" aria-label="Context Pack">
            <div className="ua-diagnostics-item__header">
              <span className="ua-diagnostics-item__label">
                {mvp11.contextPack?.title ?? "Context Pack v1"}
              </span>
              <span className="ua-diagnostics-item__state ua-diagnostics-item__state--default">
                {mvp11.contextPackStatus}
              </span>
            </div>
            <p className="ua-diagnostics-item__description">
              Redaction: {mvp11.redactionSummary.replacedPaths} paths /{" "}
              {mvp11.redactionSummary.replacedSecrets} secrets
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (diagnostics.length > 0) {
    return (
      <section className="ua-diagnostics-panel" aria-label="Diagnostics panel">
        <div className="ua-diagnostics-panel__summary">
          <InspectorSummaryCard label="Diagnostics" value={runtime?.status ?? "ready"} tone="warning" />
        </div>
        <h3 className="ua-diagnostics-panel__section-title">Runtime health</h3>
        <div className="ua-diagnostics-panel__items">
          {diagnostics.map((event) => (
            <div key={event.id} className="ua-diagnostics-item" aria-label={event.title}>
              <div className="ua-diagnostics-item__header">
                <span className="ua-diagnostics-item__label">{event.title}</span>
                <span className="ua-diagnostics-item__state ua-diagnostics-item__state--warning">
                  {event.level ?? "warning"}
                </span>
              </div>
              <p className="ua-diagnostics-item__description">{event.body}</p>
              {event.type === "provider_request_failed" && event.payload && typeof event.payload === "object" && "code" in event.payload ? (
                <span className="ua-diagnostics-item__code">Error code: {String((event.payload as Record<string, unknown>).code)}</span>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="ua-diagnostics-panel" aria-label="Diagnostics panel">
      <div className="ua-diagnostics-panel__summary">
        <InspectorSummaryCard label="Diagnostics" value={diagnosticSummary.status} tone="warning" />
      </div>
      <h3 className="ua-diagnostics-panel__section-title">UE Project Diagnostics</h3>
      <div className="ua-diagnostics-panel__items">
        <div className="ua-diagnostics-item" aria-label="UE Project Diagnostics">
          <div className="ua-diagnostics-item__header">
            <span className="ua-diagnostics-item__label">Metadata checks</span>
            <span className="ua-diagnostics-item__state ua-diagnostics-item__state--success">
              Read-only
            </span>
          </div>
          <p className="ua-diagnostics-item__description">
            Metadata, module, plugin, target, Build.cs, Config, binary-preview, and permission diagnostics use indexed summaries only.
          </p>
        </div>
      </div>
      <h3 className="ua-diagnostics-panel__section-title">Build Failure Analysis</h3>
      <div className="ua-diagnostics-panel__items">
        <div className="ua-diagnostics-item" aria-label="Build Failure Analysis">
          <div className="ua-diagnostics-item__header">
            <span className="ua-diagnostics-item__label">Recorded output parser</span>
            <span className="ua-diagnostics-item__state ua-diagnostics-item__state--accent">
              User-triggered
            </span>
          </div>
          <p className="ua-diagnostics-item__description">
            Terminal output can be analyzed from recorded evidence summaries without re-running commands or storing raw stdout.
          </p>
        </div>
      </div>
      <h3 className="ua-diagnostics-panel__section-title">Context Pack</h3>
      <div className="ua-diagnostics-panel__items">
        <div className="ua-diagnostics-item" aria-label="Context Pack">
          <div className="ua-diagnostics-item__header">
            <span className="ua-diagnostics-item__label">Context Pack v1</span>
            <span className="ua-diagnostics-item__state ua-diagnostics-item__state--default">
              v1 summary
            </span>
          </div>
          <p className="ua-diagnostics-item__description">
            Context Pack v1 combines project overview, diagnostics, build failures, important files, MCP observations, and safety boundaries.
          </p>
        </div>
      </div>
      <h3 className="ua-diagnostics-panel__section-title">Runtime health</h3>
      <div className="ua-diagnostics-panel__items">
        {diagnosticSummary.items.map((item) => (
          <div key={item.id} className="ua-diagnostics-item" aria-label={item.label}>
            <div className="ua-diagnostics-item__header">
              <span className="ua-diagnostics-item__label">{item.label}</span>
              <span
                className={`ua-diagnostics-item__state ${
                  TONE_LABEL_CLASS[item.tone] ?? TONE_LABEL_CLASS.default
                }`}
              >
                {item.state}
              </span>
            </div>
            <p className="ua-diagnostics-item__description">{item.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
