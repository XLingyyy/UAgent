import { useState } from "react";
import { useOptionalRuntimeActions, useOptionalRuntimeStore } from "../stores/ui-store";
import "./UtilityPlaceholderPanel.css";

export function AssetMutationPanel() {
  const mvp15 = useOptionalRuntimeStore((state) => state.mvp15);
  const mvp14 = useOptionalRuntimeStore((state) => state.mvp14);
  const actions = useOptionalRuntimeActions();
  const [sourceAssetPath, setSourceAssetPath] = useState("");
  const changeSet = mvp15?.activeChangeSet ?? null;
  const dryRun = mvp15?.latestDryRun ?? null;
  const approval = changeSet?.approval ?? null;
  const execution = mvp15?.latestExecution ?? null;
  const verification = mvp15?.latestVerification ?? null;
  const replay = mvp15?.replaySummary ?? null;
  const canApprove = changeSet?.state === "approval_required";
  const canExecute = changeSet?.state === "approved";
  const canVerify = changeSet?.state === "executed";
  const canRollback = changeSet?.state === "verified" || changeSet?.state === "rollback_available";
  const runtimeMode = mvp15?.["executionMode"];
  const realReady =
    mvp15?.gate.mode === "sandbox-enabled" &&
    mvp14?.session?.mode === "attached" &&
    mvp14?.status?.status === "ready" &&
    mvp14.status.heartbeat?.processAlive === true;
  const stateLabel = changeSet?.state ?? (realReady ? "real-ready" : (mvp15?.gate.mode ?? "disabled"));

  return (
    <section className="ua-utility-placeholder" aria-label="Asset mutation panel">
      <div className="ua-utility-placeholder__header">
        <div className="ua-utility-placeholder__title-group">
          <span className="ua-utility-placeholder__eyebrow">MVP15 sandbox-only</span>
          <h3 className="ua-utility-placeholder__title">Asset Mutation</h3>
        </div>
        <span className="ua-utility-placeholder__state">{stateLabel}</span>
      </div>
      <ul className="ua-utility-placeholder__list">
        <li className="ua-utility-placeholder__item">Sandbox root: {mvp15?.gate.sandboxRoot ?? "/Game/UAgentSandbox"}</li>
        <li className="ua-utility-placeholder__item">
          <label>
            Source asset path{" "}
            <input
              aria-label="Source asset path"
              className="ua-utility-placeholder__input"
              type="text"
              value={sourceAssetPath}
              onChange={(event) => setSourceAssetPath(event.currentTarget.value)}
              placeholder="/Game/UAgentSandbox/SourceAsset"
            />
          </label>
        </li>
        <li className="ua-utility-placeholder__item">
          Gate modes: disabled / dry-run-only / sandbox-enabled / supervisor-local-smoke-required
        </li>
        <li className="ua-utility-placeholder__item">
          <button
            className="ua-utility-placeholder__button"
            type="button"
            aria-label="Dry-run sandbox asset mutation"
            onClick={() => {
              void actions?.runMvp15AssetDryRun(sourceAssetPath);
            }}
          >
            Dry-run
          </button>{" "}
          <button
            className="ua-utility-placeholder__button"
            type="button"
            aria-label="Approve sandbox asset mutation"
            disabled={!canApprove}
            onClick={() => actions?.approveMvp15AssetChangeSet()}
          >
            Approve
          </button>{" "}
          <button
            className="ua-utility-placeholder__button"
            type="button"
            aria-label="Execute sandbox asset mutation"
            disabled={!canExecute}
            onClick={() => {
              void actions?.executeMvp15AssetChangeSet();
            }}
          >
            Execute
          </button>{" "}
          <button
            className="ua-utility-placeholder__button"
            type="button"
            aria-label="Verify sandbox asset mutation"
            disabled={!canVerify}
            onClick={() => {
              void actions?.verifyMvp15AssetChangeSet();
            }}
          >
            Verify
          </button>{" "}
          <button
            className="ua-utility-placeholder__button"
            type="button"
            aria-label="Rollback sandbox asset mutation"
            disabled={!canRollback}
            onClick={() => {
              void actions?.rollbackMvp15AssetChangeSet();
            }}
          >
            Rollback
          </button>
        </li>
        {runtimeMode && <li className="ua-utility-placeholder__item">Execution mode: {runtimeMode}</li>}
        {mvp15?.sourceAssetPath && <li className="ua-utility-placeholder__item">Source: {mvp15.sourceAssetPath}</li>}
        {mvp15?.runId && <li className="ua-utility-placeholder__item">Run: {mvp15.runId}</li>}
        {mvp15?.mcpInventory?.missingTools.length ? (
          <li className="ua-utility-placeholder__item">Missing MCP tools: {mvp15.mcpInventory.missingTools.join(", ")}</li>
        ) : null}
        {mvp15?.mcpInventory?.missingSchemas.length ? (
          <li className="ua-utility-placeholder__item">Missing MCP schema: {mvp15.mcpInventory.missingSchemas.join(", ")}</li>
        ) : null}
        {mvp15?.mcpInventory?.missingDryRunSchemas.length ? (
          <li className="ua-utility-placeholder__item">Missing MCP dry-run schema: {mvp15.mcpInventory.missingDryRunSchemas.join(", ")}</li>
        ) : null}
        {dryRun && <li className="ua-utility-placeholder__item">Dry-run: {dryRun.status}</li>}
        {changeSet && <li className="ua-utility-placeholder__item">Risk: {changeSet.risk}</li>}
        {approval && <li className="ua-utility-placeholder__item">Approval: {approval.status}</li>}
        {execution && <li className="ua-utility-placeholder__item">Execution: {execution.status}</li>}
        {verification && <li className="ua-utility-placeholder__item">Verification: {verification.status}</li>}
        {changeSet?.state === "rolled_back" && <li className="ua-utility-placeholder__item">Rollback: rolled_back</li>}
        {changeSet?.operations.map((operation) => (
          <li key={operation.id} className="ua-utility-placeholder__item">
            {operation.kind}: {operation.assetPathBefore ?? "new"} -&gt; {operation.assetPathAfter ?? "removed"}
          </li>
        ))}
        {replay?.replayOnly && (
          <li className="ua-utility-placeholder__item">
            Replay: recorded summaries only / {replay.recordedOnlyActions?.join(", ")}
          </li>
        )}
        {mvp15?.lastError && <li className="ua-utility-placeholder__item">Last issue: {mvp15.lastError}</li>}
      </ul>
    </section>
  );
}
