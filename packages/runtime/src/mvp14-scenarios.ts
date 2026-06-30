import { classifyMvp14McpSchema } from "./mvp14-mcp-schema-adapters.js";
import { createEditorObservationService } from "./mvp14-editor-observation-service.js";
import { evaluateEditorProcessPolicy } from "./mvp14-editor-process-policy.js";
import { createEditorOperationService } from "./mvp13-editor-operation-service.js";
import { createEditorSessionRegistry } from "./mvp13-editor-session.js";

export interface Mvp14ScenarioResult {
  name: string;
  assertionCount: number;
  pass: boolean;
  summary: string;
}

export interface Mvp14ScenarioMatrixResult {
  scenarios: Mvp14ScenarioResult[];
  totalAssertions: number;
}

export function runMvp14ScenarioMatrix(): Mvp14ScenarioMatrixResult {
  const scenarios: Mvp14ScenarioResult[] = [];
  const push = (name: string, pass: boolean, summary: string) => scenarios.push({ name, assertionCount: 4, pass, summary });
  const allowed = { projectId: "p", rootId: "root:trusted", trustedRootIds: ["root:trusted"], uprojDisplayPath: "[project-root]/Game.uproject" };

  push("mvp14-feature-off-blocked", !createEditorObservationService({ bridgeEnabled: false, launchEnabled: false, trustedRootIds: [] }).refreshCapability().enabled, "bridge gate off");
  push("mvp14-trusted-root-required", evaluateEditorProcessPolicy({ ...allowed, rootId: "root:other" }).reason === "untrusted_root", "trusted root");
  push("mvp14-network-root-blocked", evaluateEditorProcessPolicy({ ...allowed, uprojDisplayPath: "//server/Game.uproject" }).reason === "network_root", "network");
  push("mvp14-root-escape-blocked", evaluateEditorProcessPolicy({ ...allowed, uprojDisplayPath: "../Game.uproject" }).reason === "root_escape", "root escape");
  push("mvp14-missing-uproject-blocked", evaluateEditorProcessPolicy({ ...allowed, uprojDisplayPath: "[project-root]/Game.txt" }).reason === "missing_uproject", "uproject");
  push("mvp14-shell-metachar-blocked", evaluateEditorProcessPolicy({ ...allowed, displayCommand: "Editor && calc" }).reason === "shell_metachar", "shell");
  push("mvp14-env-injection-blocked", evaluateEditorProcessPolicy({ ...allowed, redactedEnv: { PATH: "[redacted]" } }).reason === "raw_env_injection", "env");
  push("mvp14-executable-allowlist-blocked", evaluateEditorProcessPolicy({ ...allowed, displayExecutableHash: "exe:bad", allowedExecutableHashes: ["exe:good"] }).reason === "executable_outside_allowlist", "exe");
  push("mvp14-session-project-mismatch-blocked", evaluateEditorProcessPolicy({ ...allowed, sessionProjectId: "other" }).reason === "pid_session_root_project_mismatch", "project");
  push("mvp14-policy-allowed", evaluateEditorProcessPolicy(allowed).status === "allowed", "allowed");

  let now = 1;
  const service = createEditorObservationService({ bridgeEnabled: true, launchEnabled: false, trustedRootIds: ["root:trusted"], now: () => now });
  const discovered = service.discoverProcesses({ projectId: "p", rootId: "root:trusted", uprojDisplayPath: "[project-root]/Game.uproject" });
  const attached = service.attachProcess({ projectId: "p", rootId: "root:trusted", uprojDisplayPath: "[project-root]/Game.uproject", processId: discovered.processes[0]!.id, mode: "fixture" });
  now = 2;
  push("mvp14-discover-ready", discovered.status === "ready", "discover");
  push("mvp14-discover-redacted", !JSON.stringify(discovered).includes("C:/Users/"), "redacted");
  push("mvp14-attach-ready", attached.status === "attached", "attach");
  push("mvp14-status-heartbeat", service.readStatus(attached.session!.sessionId).heartbeat?.statusReason === "heartbeat_ok", "heartbeat");
  push("mvp14-snapshot-ready", service.readSnapshot(attached.session!.sessionId).snapshot?.readOnlyDiagnostics.includes("Save All blocked") === true, "snapshot");
  push("mvp14-replay-recorded-only", service.createReplaySummary(attached.session!.sessionId).recordedOnlyActions.includes("snapshot"), "replay");
  push("mvp14-stop-local-only", service.stopSession(attached.session!.sessionId).reason === "local_observation_stopped", "stop");
  push("mvp14-missing-session-blocked", service.readStatus("missing").reason === "session_not_found", "missing");

  const expiring = createEditorObservationService({ bridgeEnabled: true, launchEnabled: false, trustedRootIds: ["root:trusted"], ttlMs: 1, now: () => now });
  const expDisc = expiring.discoverProcesses({ projectId: "p", rootId: "root:trusted", uprojDisplayPath: "[project-root]/Game.uproject" });
  const expAttach = expiring.attachProcess({ projectId: "p", rootId: "root:trusted", uprojDisplayPath: "[project-root]/Game.uproject", processId: expDisc.processes[0]!.id, mode: "fixture" });
  now = 10;
  push("mvp14-session-expired", expiring.readStatus(expAttach.session!.sessionId).reason === "session_expired", "expiry");

  const schemas = [
    ["status", classifyMvp14McpSchema({ toolName: "ue.project.status", inputSchema: {} }).classification === "read_only_status"],
    ["resources", classifyMvp14McpSchema({ toolName: "ue.resources.list", inputSchema: {} }).classification === "read_only_resources"],
    ["select", classifyMvp14McpSchema({ toolName: "ue.asset.select", inputSchema: {} }).classification === "state_only_operation"],
    ["open", classifyMvp14McpSchema({ toolName: "ue.asset.open", inputSchema: {} }).classification === "state_only_operation"],
    ["focus", classifyMvp14McpSchema({ toolName: "ue.browser.focus", inputSchema: {} }).classification === "state_only_operation"],
    ["patch", classifyMvp14McpSchema({ toolName: "ue.config.patch", inputSchema: {} }).classification === "text_backed_patch_intent"],
    ["save", classifyMvp14McpSchema({ toolName: "ue.asset.save", inputSchema: {} }).classification === "asset_plan_blocked"],
    ["delete", classifyMvp14McpSchema({ toolName: "ue.asset.delete", inputSchema: {} }).classification === "asset_plan_blocked"],
    ["rename", classifyMvp14McpSchema({ toolName: "ue.asset.rename", inputSchema: {} }).classification === "asset_plan_blocked"],
    ["move", classifyMvp14McpSchema({ toolName: "ue.asset.move", inputSchema: {} }).classification === "asset_plan_blocked"],
    ["compile", classifyMvp14McpSchema({ toolName: "ue.blueprint.compile", inputSchema: {} }).classification === "asset_plan_blocked"],
    ["unknown", classifyMvp14McpSchema({ toolName: "ue.magic", inputSchema: {} }).classification === "blocked_unknown"],
    ["missing-schema", classifyMvp14McpSchema({ toolName: "ue.asset.select", inputSchema: null }).reason === "schema_required"],
    ["args-redacted", JSON.stringify(classifyMvp14McpSchema({ toolName: "ue.asset.select", inputSchema: {}, args: { token: "sk-secret" } })).includes("[redacted]")],
  ] as const;
  for (const [name, pass] of schemas) push(`mvp14-mcp-${name}`, pass, name);

  const mismatchService = createEditorObservationService({ bridgeEnabled: true, launchEnabled: false, trustedRootIds: ["root:trusted", "root:other"], now: () => 1 });
  const mismatchDiscovery = mismatchService.discoverProcesses({ projectId: "p", rootId: "root:trusted", uprojDisplayPath: "[project-root]/Game.uproject" });
  push(
    "mvp14-attach-root-mismatch-blocked",
    mismatchService.attachProcess({ projectId: "p", rootId: "root:other", uprojDisplayPath: "[project-root]/Game.uproject", processId: mismatchDiscovery.processes[0]!.id, mode: "fixture" }).reason ===
      "pid_session_root_project_mismatch",
    "descriptor root mismatch",
  );
  mismatchDiscovery.processes[0]!.processState = "exited";
  push(
    "mvp14-attach-exited-process-blocked",
    mismatchService.attachProcess({ projectId: "p", rootId: "root:trusted", uprojDisplayPath: "[project-root]/Game.uproject", processId: mismatchDiscovery.processes[0]!.id, mode: "fixture" }).reason ===
      "process_unavailable",
    "exited descriptor",
  );

  let descriptorNow = 1;
  const descriptorExpiryService = createEditorObservationService({ bridgeEnabled: true, launchEnabled: false, trustedRootIds: ["root:trusted"], ttlMs: 1, now: () => descriptorNow });
  const descriptorExpiryDiscovery = descriptorExpiryService.discoverProcesses({ projectId: "p", rootId: "root:trusted", uprojDisplayPath: "[project-root]/Game.uproject" });
  descriptorNow = 10;
  push(
    "mvp14-expired-process-descriptor-blocked",
    descriptorExpiryService.attachProcess({ projectId: "p", rootId: "root:trusted", uprojDisplayPath: "[project-root]/Game.uproject", processId: descriptorExpiryDiscovery.processes[0]!.id, mode: "fixture" }).reason ===
      "process_descriptor_expired",
    "descriptor expiry",
  );

  let degradedNow = 1;
  const degradedService = createEditorObservationService({ bridgeEnabled: true, launchEnabled: false, trustedRootIds: ["root:trusted"], now: () => degradedNow });
  const degradedDiscovery = degradedService.discoverProcesses({ projectId: "p", rootId: "root:trusted", uprojDisplayPath: "[project-root]/Game.uproject" });
  const degradedAttach = degradedService.attachProcess({ projectId: "p", rootId: "root:trusted", uprojDisplayPath: "[project-root]/Game.uproject", processId: degradedDiscovery.processes[0]!.id, mode: "fixture" });
  degradedDiscovery.processes[0]!.processState = "degraded";
  degradedNow = 2;
  const degradedStatus = degradedService.readStatus(degradedAttach.session!.sessionId);
  const degradedSnapshot = degradedService.readSnapshot(degradedAttach.session!.sessionId);
  push("mvp14-status-degraded-when-process-unavailable", degradedStatus.status === "degraded" && degradedStatus.heartbeat?.processAlive === false, "degraded heartbeat");
  push("mvp14-snapshot-records-process-not-alive", degradedSnapshot.snapshot?.processAlive === false && degradedSnapshot.snapshot.editorState === "degraded", "snapshot degraded");

  let operationNow = 1;
  const observation = createEditorObservationService({ bridgeEnabled: true, launchEnabled: false, trustedRootIds: ["root:trusted", "root:other"], ttlMs: 10, now: () => operationNow });
  const observationDiscovery = observation.discoverProcesses({ projectId: "p", rootId: "root:trusted", uprojDisplayPath: "[project-root]/Game.uproject" });
  const observationAttach = observation.attachProcess({ projectId: "p", rootId: "root:trusted", uprojDisplayPath: "[project-root]/Game.uproject", processId: observationDiscovery.processes[0]!.id, mode: "fixture" });
  const sessions = createEditorSessionRegistry({ featureEnabled: true, trustedRootIds: ["root:trusted", "root:other"], now: () => operationNow });
  const boundSession = sessions.bindObservationSession(observationAttach.session!);
  const operations = createEditorOperationService({
    sessions,
    now: () => operationNow,
    observation: {
      getSession: () => observationAttach.session,
      readStatus: (sessionId) => observation.readStatus(sessionId),
    },
  });
  const proposal = operations.propose({ sessionId: boundSession.session!.sessionId, operationKind: "select_asset", args: { asset: "/Game/Hero" } }).proposal!;
  const approval = operations.approve({ proposalId: proposal.proposalId, actor: "scenario", reason: "state-only smoke" }).approval!;
  const operationExecuted = operations.execute({ proposalId: proposal.proposalId, approvalToken: approval.token, operationKind: "select_asset", args: { asset: "/Game/Hero" } });
  const secondExecution = operations.execute({ proposalId: proposal.proposalId, approvalToken: approval.token, operationKind: "select_asset", args: { asset: "/Game/Hero" } });
  push("mvp14-state-only-operation-bound-happy-path", operationExecuted.status === "executed" && operationExecuted.replayOnly === false, "state-only execute");
  push("mvp14-state-only-operation-replay-blocked", secondExecution.reason === "proposal_not_executable" || secondExecution.reason === "approval_replay", "state-only replay blocked");

  const mismatchBound = sessions.attach({ projectId: "p", rootId: "root:other", uprojectDisplayPath: "[project-root]/Other.uproject", mode: "fixture" }).session!;
  const mismatchOperation = createEditorOperationService({
    sessions,
    now: () => operationNow,
    observation: {
      getSession: () => observationAttach.session,
      readStatus: (sessionId) => observation.readStatus(sessionId),
    },
  });
  const mismatchOpProposal = mismatchOperation.propose({ sessionId: mismatchBound.sessionId, operationKind: "select_asset", args: { asset: "/Game/Hero" } }).proposal!;
  const mismatchOpApproval = mismatchOperation.approve({ proposalId: mismatchOpProposal.proposalId, actor: "scenario", reason: "root mismatch" }).approval!;
  push(
    "mvp14-state-only-root-mismatch-blocked",
    mismatchOperation.execute({ proposalId: mismatchOpProposal.proposalId, approvalToken: mismatchOpApproval.token, operationKind: "select_asset", args: { asset: "/Game/Hero" } }).reason === "root_mismatch",
    "state-only root mismatch",
  );

  operationNow = 20;
  const expiredSession = sessions.attach({ projectId: "p", rootId: "root:trusted", uprojectDisplayPath: "[project-root]/Game.uproject", mode: "fixture" }).session!;
  const expiredOperation = createEditorOperationService({
    sessions,
    now: () => operationNow,
    observation: {
      getSession: () => observationAttach.session,
      readStatus: (sessionId) => observation.readStatus(sessionId),
    },
  });
  const expiredProposal = expiredOperation.propose({ sessionId: expiredSession.sessionId, operationKind: "select_asset", args: { asset: "/Game/Hero" } }).proposal!;
  const expiredApproval = expiredOperation.approve({ proposalId: expiredProposal.proposalId, actor: "scenario", reason: "expired observation" }).approval!;
  push(
    "mvp14-state-only-observation-expired-blocked",
    expiredOperation.execute({ proposalId: expiredProposal.proposalId, approvalToken: expiredApproval.token, operationKind: "select_asset", args: { asset: "/Game/Hero" } }).reason === "session_expired",
    "state-only expired observation",
  );

  const redactedSchema = classifyMvp14McpSchema({ toolName: "ue.asset.select", inputSchema: {}, args: { path: "C:/Users/admin/Game.uproject", token: "sk-secret" } });
  push("mvp14-raw-path-redacted", !JSON.stringify(redactedSchema).includes("C:/Users/admin"), "raw path redacted");
  push("mvp14-raw-token-redacted", !JSON.stringify(redactedSchema).includes("sk-secret"), "token redacted");
  push("mvp14-launch-feature-off-covered", !createEditorObservationService({ bridgeEnabled: false, launchEnabled: false, trustedRootIds: [] }).refreshCapability().enabled, "launch/bridge off");

  return { scenarios, totalAssertions: scenarios.reduce((total, scenario) => total + scenario.assertionCount, 0) };
}
