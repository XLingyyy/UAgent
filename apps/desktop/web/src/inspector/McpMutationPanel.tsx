import { useOptionalRuntimeActions, useOptionalRuntimeStore } from "../stores/ui-store";
import "./UtilityPlaceholderPanel.css";

export function McpMutationPanel() {
  const mvp13 = useOptionalRuntimeStore((state) => state.mvp13);
  const mvp15 = useOptionalRuntimeStore((state) => state.mvp15);
  const actions = useOptionalRuntimeActions();
  const latestDryRun = mvp13?.mcpDryRuns[mvp13.mcpDryRuns.length - 1] ?? null;
  const latestProposal = mvp13?.mcpProposals[mvp13.mcpProposals.length - 1] ?? null;
  const latestAssetPlan = mvp13?.assetPlans[mvp13.assetPlans.length - 1] ?? null;
  const mvp15Inventory = mvp15?.mcpInventory ?? null;

  return (
    <section className="ua-utility-placeholder" aria-label="MCP mutation panel">
      <div className="ua-utility-placeholder__header">
        <div className="ua-utility-placeholder__title-group">
          <span className="ua-utility-placeholder__eyebrow">Dry-run only</span>
          <h3 className="ua-utility-placeholder__title">MCP Mutation</h3>
        </div>
        <span className="ua-utility-placeholder__state">
          {mvp15Inventory?.status ?? (latestDryRun ? "dry-run recorded" : "default blocked")}
        </span>
      </div>
      <ul className="ua-utility-placeholder__list">
        <li className="ua-utility-placeholder__item">
          Dry-runs: {mvp13?.mcpDryRuns.length ?? 0} / proposals {mvp13?.mcpProposals.length ?? 0} / blocked asset plans{" "}
          {mvp13?.assetPlans.length ?? 0}
        </li>
        <li className="ua-utility-placeholder__item">
          <button className="ua-utility-placeholder__button" type="button" aria-label="Run MCP mutation dry-run" onClick={() => actions?.runMvp13McpMutationDryRun()}>
            Dry-run
          </button>
        </li>
        {latestDryRun && (
          <li className="ua-utility-placeholder__item">
            Latest: {latestDryRun.toolName} / {latestDryRun.operationKind} /{" "}
            {latestDryRun.textBacked ? "ChangeSet v2" : latestDryRun.stateOnly ? "Editor proposal" : "blocked plan"}
          </li>
        )}
        {latestProposal && (
          <li className="ua-utility-placeholder__item">
            Proposal: {latestProposal.status} / {latestProposal.operationKind}
          </li>
        )}
        {latestAssetPlan && (
          <li className="ua-utility-placeholder__item">
            Asset plan: {latestAssetPlan.reason} / {latestAssetPlan.affectedAssets.length} assets
          </li>
        )}
        {mvp15Inventory?.missingTools.length ? (
          <li className="ua-utility-placeholder__item">MVP15 missing tools: {mvp15Inventory.missingTools.join(", ")}</li>
        ) : null}
        {mvp15Inventory?.missingSchemas.length ? (
          <li className="ua-utility-placeholder__item">MVP15 missing schema: {mvp15Inventory.missingSchemas.join(", ")}</li>
        ) : null}
        {mvp15Inventory?.missingDryRunSchemas.length ? (
          <li className="ua-utility-placeholder__item">MVP15 missing dry-run schema: {mvp15Inventory.missingDryRunSchemas.join(", ")}</li>
        ) : null}
        {mvp15Inventory?.missingRollbackContracts.length ? (
          <li className="ua-utility-placeholder__item">MVP15 missing rollback contract: {mvp15Inventory.missingRollbackContracts.join(", ")}</li>
        ) : null}
        {mvp15Inventory?.missingEvidenceQueries.length ? (
          <li className="ua-utility-placeholder__item">MVP15 missing evidence query: {mvp15Inventory.missingEvidenceQueries.join(", ")}</li>
        ) : null}
        {mvp13?.replayOnly && (
          <li className="ua-utility-placeholder__item">Replay: recorded summaries only</li>
        )}
      </ul>
    </section>
  );
}
