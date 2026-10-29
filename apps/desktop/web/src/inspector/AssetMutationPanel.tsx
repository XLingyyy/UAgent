import {useI18n} from "../i18n";
import { useState } from "react";
import { MVP15_ASSET_TOOL_ALLOWLIST } from "@uagent/runtime";
import { useOptionalRuntimeActions, useOptionalRuntimeStore } from "../stores/ui-store";
import "./UtilityPlaceholderPanel.css";

export function formatMvp15UiBlocker(reason: string): string {
  const value = reason.trim();
  if (!value || value.length > 192 || !/^[a-z0-9_.:-]+$/.test(value) || /^(?:pid|session|token|root|trusted-root):/i.test(value)) {
    return "asset_mutation_blocked";
  }
  return value;
}

export function AssetMutationPanel() {
  const {text: uiText} = useI18n();
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
  const companion = mvp15?.companion ?? null;
  const bindingStatus = changeSet?.externalBindingStatus ?? dryRun?.externalBindingStatus ?? "local_fixture";
  const runtimeMode = mvp15?.["executionMode"];
  const realMode = runtimeMode === "real";
  const bindingBound = bindingStatus === "external_bound";
  const activeObservation =
    mvp14?.session?.mode === "attached" &&
    mvp14?.status?.status === "ready" &&
    mvp14.status.heartbeat?.processAlive === true;
  const nativeRegistrationStatus = changeSet?.nativeApprovalRegistrationStatus ?? (realMode ? "required" : "not_required");
  const bindingApprovable = realMode ? bindingBound : changeSet?.state === "approval_required";
  const companionReady = !realMode || (companion?.status === "verified" && companion.liveFingerprintReady);
  const canApprove = changeSet?.state === "approval_required" && bindingApprovable && companionReady;
  const canExecute = changeSet?.state === "approved"
    && (!realMode || (bindingBound && activeObservation && nativeRegistrationStatus === "registered" && companionReady));
  const canVerify = (changeSet?.state === "executed" || changeSet?.state === "rollback_available")
    && (!realMode || bindingBound);
  const hasReversibleRollbackAction = changeSet?.rollbackPlan.actions.some((action) => (
    action.action !== "none"
    && action.status !== "not_applicable"
    && changeSet.operations.some((operation) => operation.id === action.operationId && Boolean(operation.manifestEntryId))
  )) === true;
  const canRollback = ["executed", "verified", "rollback_available"].includes(changeSet?.state ?? "")
    && hasReversibleRollbackAction
    && (!realMode || bindingBound);
  const canFinalVerify = realMode
    && changeSet?.state === "rolled_back"
    && mvp15?.finalVerification.status !== "passed";
  const canInspectReplay = realMode
    && mvp15?.finalVerification.status === "passed";
  const realReady =
    mvp15?.gate.mode === "sandbox-enabled" &&
    activeObservation;
  const stateLabel = changeSet?.state ?? (realReady ? "real-ready" : (mvp15?.gate.mode ?? "disabled"));
  const bindingLabel = realMode
    ? bindingStatus
    : runtimeMode === "fixture" ? "local_fixture" : "not_bound";
  const aggregatePrefix = changeSet?.aggregateDryRunHash ? String(changeSet.aggregateDryRunHash).slice(0, 12) : null;
  const mcpInventory = mvp15?.mcpInventory ?? null;
  const readyMcpInventory =
    mcpInventory?.status === "ready" &&
    mcpInventory.availableTools.length === MVP15_ASSET_TOOL_ALLOWLIST.length &&
    mcpInventory.availableTools.every((toolName, index) => toolName === MVP15_ASSET_TOOL_ALLOWLIST[index])
    ? mcpInventory
    : null;

  return (
    <section className="ua-utility-placeholder" aria-label={uiText("Asset mutation panel")}>
      <div className="ua-utility-placeholder__header">
        <div className="ua-utility-placeholder__title-group">
          <span className="ua-utility-placeholder__eyebrow">{uiText("MVP15 sandbox-only")}</span>
          <h3 className="ua-utility-placeholder__title">{uiText("Asset Mutation")}</h3>
        </div>
        <span className="ua-utility-placeholder__state">{stateLabel}</span>
      </div>
      <ul className="ua-utility-placeholder__list">
        <li className="ua-utility-placeholder__item">{uiText("Sandbox root:")}{" "}{mvp15?.gate.sandboxRoot ?? "/Game/UAgentSandbox"}</li>
        <li className="ua-utility-placeholder__item">
          <label>
            {uiText("Source asset path")}{" "}
            <input
              aria-label={uiText("Source asset path")}
              className="ua-utility-placeholder__input"
              type="text"
              value={sourceAssetPath}
              onChange={(event) => setSourceAssetPath(event.currentTarget.value)}
              placeholder="/Game/Test01"
            />
          </label>
        </li>
        <li className="ua-utility-placeholder__item">
          {uiText("Gate modes: disabled / dry-run-only / sandbox-enabled / supervisor-local-smoke-required")}{" "}</li>
        <li className="ua-utility-placeholder__item">
          <span className="ua-utility-placeholder__action-row">
            <button
              className="ua-utility-placeholder__button"
              type="button"
              aria-label={uiText("Dry-run sandbox asset mutation")}
              disabled={mvp15?.busy}
              onClick={() => {
                void actions?.runMvp15AssetDryRun(sourceAssetPath);
              }}
            >
              {uiText("Dry-run")}{" "}</button>
            <button
              className="ua-utility-placeholder__button"
              type="button"
              aria-label={uiText("Approve sandbox asset mutation")}
              disabled={mvp15?.busy || !canApprove}
              onClick={() => {
                void actions?.approveMvp15AssetChangeSet();
              }}
            >
              {uiText("Approve")}{" "}</button>
            <button
              className="ua-utility-placeholder__button"
              type="button"
              aria-label={uiText("Execute sandbox asset mutation")}
              disabled={mvp15?.busy || !canExecute}
              onClick={() => {
                void actions?.executeMvp15AssetChangeSet();
              }}
            >
              {uiText("Execute")}{" "}</button>
            <button
              className="ua-utility-placeholder__button"
              type="button"
              aria-label={uiText("Verify sandbox asset mutation")}
              disabled={mvp15?.busy || !canVerify}
              onClick={() => {
                void actions?.verifyMvp15AssetChangeSet();
              }}
            >
              {uiText("Verify")}{" "}</button>
            <button
              className="ua-utility-placeholder__button"
              type="button"
              aria-label={uiText("Rollback sandbox asset mutation")}
              disabled={mvp15?.busy || !canRollback}
              onClick={() => {
                void actions?.rollbackMvp15AssetChangeSet();
              }}
            >
              {uiText("Rollback")}{" "}</button>
            <button
              className="ua-utility-placeholder__button"
              type="button"
              aria-label={uiText("Final verify restored Content")}
              disabled={mvp15?.busy || !canFinalVerify}
              onClick={() => {
                void actions?.finalVerifyMvp15AssetChangeSet();
              }}
            >
              {uiText("Final verify")}{" "}</button>
            <button
              className="ua-utility-placeholder__button"
              type="button"
              aria-label={uiText("Inspect recorded asset replay")}
              disabled={mvp15?.busy || !canInspectReplay}
              onClick={() => {
                actions?.inspectMvp15AssetReplay();
              }}
            >
              {uiText("Inspect replay")}{" "}</button>
          </span>
        </li>
        {runtimeMode && <li className="ua-utility-placeholder__item" data-mvp15d-observation="asset-execution-mode" data-mvp15d-value={runtimeMode}>{uiText("Execution mode:")}{" "}{runtimeMode}</li>}
        <li className="ua-utility-placeholder__item" data-mvp15d-observation="asset-binding" data-mvp15d-value={bindingLabel}>{uiText("Binding:")}{" "}{bindingLabel}</li>
        {companion && (
          <>
            <li className="ua-utility-placeholder__item">{uiText("Companion plugin:")}{" "}{companion.status}</li>
            <li className="ua-utility-placeholder__item">
              {uiText("Companion contract:")}{" "}{companion.pluginVersion ?? uiText("unverified")} / {companion.contractVersion ?? uiText("unverified")}
            </li>
            <li className="ua-utility-placeholder__item">
              {uiText("Manifest SHA:")}{" "}{companion.manifestSha256Prefix ? `${companion.manifestSha256Prefix}…` : uiText("unverified")}
            </li>
            <li className="ua-utility-placeholder__item">
              {uiText("Live fingerprint:")}{" "}{companion.liveFingerprintSha256Prefix ? `${companion.liveFingerprintSha256Prefix}…` : uiText("unverified")}
            </li>
            <li className="ua-utility-placeholder__item">{uiText("Current generation:")}{" "}{companion.currentGeneration}</li>
            {companion.blocker && <li className="ua-utility-placeholder__item">{uiText("Companion blocker:")}{" "}{companion.blocker}</li>}
          </>
        )}
        {aggregatePrefix && <li className="ua-utility-placeholder__item">{uiText("Aggregate dry-run:")}{" "}{aggregatePrefix}…</li>}
        {realMode && (
          <li className="ua-utility-placeholder__item" data-mvp15d-observation="asset-registration" data-mvp15d-value={nativeRegistrationStatus}>
            {uiText("Native registration:")}{" "}{nativeRegistrationStatus}
          </li>
        )}
        {mvp15?.sourceAssetPath && <li className="ua-utility-placeholder__item">{uiText("Source:")}{" "}{mvp15.sourceAssetPath}</li>}
        {mvp15?.runId && <li className="ua-utility-placeholder__item">{uiText("Run:")}{" "}{mvp15.runId}</li>}
        {readyMcpInventory && (
          <>
            <li className="ua-utility-placeholder__item">
              {uiText("Live exact-six contract:")}{" "}{companion?.liveFingerprintReady ? uiText("ready") : uiText("attestation required")}
            </li>
            <li className="ua-utility-placeholder__item">
              {uiText("Exact-six tools (")}{readyMcpInventory.availableTools.length}/6): {readyMcpInventory.availableTools.join(", ")}
            </li>
            <li className="ua-utility-placeholder__item">{uiText("Input schemas: ready")}</li>
            <li className="ua-utility-placeholder__item">{uiText("Dry-run schemas: ready")}</li>
            <li className="ua-utility-placeholder__item">{uiText("Rollback metadata: ready")}</li>
            <li className="ua-utility-placeholder__item">{uiText("Affected-assets schemas: ready")}</li>
            <li className="ua-utility-placeholder__item">{uiText("Read-only evidence queries: ready")}</li>
          </>
        )}
        {mvp15?.mcpInventory?.missingTools.length ? (
          <li className="ua-utility-placeholder__item">{uiText("Missing MCP tools:")}{" "}{mvp15.mcpInventory.missingTools.join(", ")}</li>
        ) : null}
        {mvp15?.mcpInventory?.missingSchemas.length ? (
          <li className="ua-utility-placeholder__item">{uiText("Missing MCP schema:")}{" "}{mvp15.mcpInventory.missingSchemas.join(", ")}</li>
        ) : null}
        {mvp15?.mcpInventory?.missingDryRunSchemas.length ? (
          <li className="ua-utility-placeholder__item">{uiText("Missing MCP dry-run schema:")}{" "}{mvp15.mcpInventory.missingDryRunSchemas.join(", ")}</li>
        ) : null}
        {mvp15?.mcpInventory?.missingRollbackContracts.length ? (
          <li className="ua-utility-placeholder__item">{uiText("Missing MCP rollback contract:")}{" "}{mvp15.mcpInventory.missingRollbackContracts.join(", ")}</li>
        ) : null}
        {mvp15?.mcpInventory?.missingEvidenceQueries.length ? (
          <li className="ua-utility-placeholder__item">{uiText("Missing MCP evidence query:")}{" "}{mvp15.mcpInventory.missingEvidenceQueries.join(", ")}</li>
        ) : null}
        {dryRun && <li className="ua-utility-placeholder__item">{uiText("Dry-run:")}{" "}{dryRun.status}</li>}
        {changeSet && <li className="ua-utility-placeholder__item">{uiText("Risk:")}{" "}{changeSet.risk}</li>}
        {approval && <li className="ua-utility-placeholder__item">{uiText("Approval:")}{" "}{approval.status}</li>}
        {execution && <li className="ua-utility-placeholder__item" data-mvp15d-observation="asset-execution" data-mvp15d-value={execution.status}>{uiText("Execution:")}{" "}{execution.status}</li>}
        {verification && <li className="ua-utility-placeholder__item" data-mvp15d-observation="asset-verification" data-mvp15d-value={verification.status}>{uiText("Verification:")}{" "}{verification.status}</li>}
        {changeSet?.state === "rolled_back" && <li className="ua-utility-placeholder__item" data-mvp15d-observation="asset-rollback" data-mvp15d-value="rolled_back">{uiText("Rollback: rolled_back")}</li>}
        {mvp15 && (
          <li className="ua-utility-placeholder__item" data-mvp15d-observation="asset-final-verification" data-mvp15d-value={mvp15.finalVerification.status}>
            {uiText("Final Content verification:")}{" "}{mvp15.finalVerification.status}
          </li>
        )}
        {mvp15 && (
          <li className="ua-utility-placeholder__item" data-mvp15d-observation="asset-replay-inspection" data-mvp15d-value={mvp15.replayInspection.status}>
            {uiText("Replay inspection:")}{" "}{mvp15.replayInspection.status} / [{mvp15.replayInspection.sideEffectDelta.join(", ")}]
          </li>
        )}
        {changeSet?.operations.map((operation) => (
          <li key={operation.id} className="ua-utility-placeholder__item">
            {operation.kind}: {operation.assetPathBefore ?? uiText("new")} -&gt; {operation.assetPathAfter ?? uiText("removed")}
          </li>
        ))}
        {replay?.replayOnly && (
          <li className="ua-utility-placeholder__item" data-mvp15d-observation="asset-replay">
            {uiText("Replay: recorded summaries only /")}{" "}{replay.recordedOnlyActions?.join(", ")} {uiText("/ 0 runtime side effects")}{" "}</li>
        )}
        {mvp15?.lastError && (
          <li
            className="ua-utility-placeholder__item"
            data-mvp15d-observation="asset-last-error"
            data-mvp15d-value={formatMvp15UiBlocker(mvp15.lastError)}
          >
            {uiText("Last issue:")}{" "}{formatMvp15UiBlocker(mvp15.lastError)}
          </li>
        )}
      </ul>
    </section>
  );
}
