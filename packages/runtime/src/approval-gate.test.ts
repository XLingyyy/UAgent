import { describe, expect, it } from "vitest";
import { createApprovalGate, type ApprovalRequestInput } from "./approval-gate.js";

function makeInput(overrides?: Partial<ApprovalRequestInput>): ApprovalRequestInput {
  return {
    taskId: "task-0001",
    stepId: "step-1",
    riskLevel: "medium_write",
    title: "Approve file write",
    summary: "This action will write a file to disk",
    scope: { assets: [], changedFiles: ["/tmp/test.txt"], commands: [], targetCapabilities: [] },
    checks: ["Verify file path is correct"],
    timeoutTicks: 100,
    ...overrides,
  };
}

describe("ApprovalGate", () => {
  it("requestApproval creates a pending request", () => {
    const gate = createApprovalGate(() => 1000);
    const req = gate.requestApproval(makeInput());

    expect(req.id).toBeTruthy();
    expect(req.taskId).toBe("task-0001");
    expect(req.state).toBe("pending");
    expect(req.createdAt).toBe(1000);
    expect(req.resolvedAt).toBeNull();
  });

  it("pending request appears in getPendingRequests", () => {
    const gate = createApprovalGate(() => 1000);
    gate.requestApproval(makeInput());

    const pending = gate.getPendingRequests();
    expect(pending).toHaveLength(1);
    expect(pending[0].state).toBe("pending");
  });

  it("submitDecision with approved resolves the request", () => {
    const gate = createApprovalGate(() => 1000);
    gate.requestApproval(makeInput({ taskId: "task-001", stepId: "step-1" }));

    gate.submitDecision({
      taskId: "task-001",
      stepId: "step-1",
      decision: "approved",
      actor: "human",
      reason: "Looks good",
      ticks: 10,
    });

    const pending = gate.getPendingRequests();
    expect(pending).toHaveLength(0);

    const decision = gate.getDecision("task-001", "step-1");
    expect(decision).not.toBeNull();
    expect(decision!.decision).toBe("approved");
    expect(decision!.actor).toBe("human");
    expect(decision!.reason).toBe("Looks good");
  });

  it("submitDecision with denied does not execute (request removed)", () => {
    const gate = createApprovalGate(() => 1000);
    gate.requestApproval(makeInput({ taskId: "task-002", stepId: "step-1" }));

    gate.submitDecision({
      taskId: "task-002",
      stepId: "step-1",
      decision: "denied",
      actor: "human",
      reason: "Unsafe operation",
      ticks: 10,
    });

    const pending = gate.getPendingRequests();
    expect(pending).toHaveLength(0);

    const decision = gate.getDecision("task-002", "step-1");
    expect(decision!.decision).toBe("denied");
  });

  it("submitDecision with cancelled resolves the request", () => {
    const gate = createApprovalGate(() => 1000);
    gate.requestApproval(makeInput({ taskId: "task-003", stepId: "step-1" }));

    gate.submitDecision({
      taskId: "task-003",
      stepId: "step-1",
      decision: "cancelled",
      actor: "system",
      reason: "Task aborted",
      ticks: 10,
    });

    const decision = gate.getDecision("task-003", "step-1");
    expect(decision!.decision).toBe("cancelled");
  });

  it("pending request times out after timeoutTicks", () => {
    let tick = 0;
    const gate = createApprovalGate(() => tick);

    gate.requestApproval(makeInput({ taskId: "task-004", stepId: "step-1", timeoutTicks: 50 }));

    tick = 51;
    const pending = gate.getPendingRequests();
    expect(pending).toHaveLength(0);

    const decision = gate.getDecision("task-004", "step-1");
    expect(decision).toBeNull();
  });

  it("pending request does not time out before timeoutTicks", () => {
    let tick = 0;
    const gate = createApprovalGate(() => tick);

    gate.requestApproval(makeInput({ taskId: "task-005", stepId: "step-1", timeoutTicks: 100 }));

    tick = 50;
    const pending = gate.getPendingRequests();
    expect(pending).toHaveLength(1);
    expect(pending[0].state).toBe("pending");
  });

  it("hasPendingRequest returns true for pending task", () => {
    const gate = createApprovalGate(() => 1000);
    gate.requestApproval(makeInput({ taskId: "task-006", stepId: "step-1" }));

    expect(gate.hasPendingRequest("task-006")).toBe(true);
    expect(gate.hasPendingRequest("non-existent")).toBe(false);
  });

  it("hasPendingRequest returns false after request is resolved", () => {
    const gate = createApprovalGate(() => 1000);
    gate.requestApproval(makeInput({ taskId: "task-007", stepId: "step-1" }));

    gate.submitDecision({
      taskId: "task-007",
      stepId: "step-1",
      decision: "approved",
      actor: "human",
      reason: "OK",
      ticks: 10,
    });

    expect(gate.hasPendingRequest("task-007")).toBe(false);
  });

  it("hasPendingRequest returns false after timeout", () => {
    let tick = 0;
    const gate = createApprovalGate(() => tick);

    gate.requestApproval(makeInput({ taskId: "task-008", stepId: "step-1", timeoutTicks: 50 }));
    tick = 100;

    expect(gate.hasPendingRequest("task-008")).toBe(false);
  });

  it("getDecision returns null for unresolved approval", () => {
    const gate = createApprovalGate(() => 1000);
    gate.requestApproval(makeInput({ taskId: "task-009", stepId: "step-1" }));

    expect(gate.getDecision("task-009", "step-1")).toBeNull();
  });

  it("getDecision returns null for non-existent approval", () => {
    const gate = createApprovalGate(() => 1000);
    expect(gate.getDecision("non-existent", "step-1")).toBeNull();
  });

  it("getDecision returns correct decision for approved request", () => {
    const gate = createApprovalGate(() => 1000);
    gate.requestApproval(makeInput({ taskId: "task-010", stepId: "step-1" }));

    gate.submitDecision({
      taskId: "task-010",
      stepId: "step-1",
      decision: "approved",
      actor: "admin",
      reason: "Safe operation",
      ticks: 25,
    });

    const decision = gate.getDecision("task-010", "step-1");
    expect(decision!.approvalId).toBeTruthy();
    expect(decision!.decision).toBe("approved");
    expect(decision!.actor).toBe("admin");
    expect(decision!.reason).toBe("Safe operation");
    expect(decision!.ticks).toBe(25);
  });

  it("supports multiple independent requests", () => {
    const gate = createApprovalGate(() => 1000);

    gate.requestApproval(makeInput({ taskId: "task-A", stepId: "step-1" }));
    gate.requestApproval(makeInput({ taskId: "task-B", stepId: "step-1" }));

    expect(gate.getPendingRequests()).toHaveLength(2);

    gate.submitDecision({
      taskId: "task-A",
      stepId: "step-1",
      decision: "approved",
      actor: "admin",
      reason: "OK",
      ticks: 5,
    });

    expect(gate.getPendingRequests()).toHaveLength(1);
    expect(gate.hasPendingRequest("task-A")).toBe(false);
    expect(gate.hasPendingRequest("task-B")).toBe(true);

    const decision = gate.getDecision("task-A", "step-1");
    expect(decision!.decision).toBe("approved");
  });

  it("uses Date.now() when no clock is provided", () => {
    const gate = createApprovalGate();
    const req = gate.requestApproval(makeInput({ taskId: "task-clock", stepId: "step-1" }));

    expect(req.createdAt).toBeGreaterThan(0);
    expect(req.state).toBe("pending");
  });
});
