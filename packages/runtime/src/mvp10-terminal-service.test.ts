import { describe, it, expect } from "vitest";
import { createRealTerminalService, createRealTerminalServiceWithOptions } from "./mvp10-terminal-service.js";
import type { RealTerminalAdapter } from "./mvp10-terminal-service.js";

describe("createRealTerminalService", () => {
  it("starts in idle stage", () => {
    const svc = createRealTerminalService();
    const state = svc.getState();
    expect(state.stage).toBe("idle");
    expect(state.proposals).toEqual([]);
    expect(state.activeProposal).toBeNull();
    expect(state.token).toBeNull();
  });

  it("propose transitions to proposed stage", async () => {
    const svc = createRealTerminalService();
    const proposal = await svc.propose("pnpm typecheck", "/root", "task-1", "/root");
    expect(proposal.command).toBe("pnpm typecheck");
    expect(proposal.taskId).toBe("task-1");
    const state = svc.getState();
    expect(state.stage).toBe("proposed");
    expect(state.activeProposal?.id).toBe(proposal.id);
  });

  it("classifies cwd escape proposals as root escape", async () => {
    const svc = createRealTerminalService();
    const proposal = await svc.propose("git status", "/root-other", "task-1", "/root");
    expect(proposal.classification.risk).toBe("root_escape");
    expect(proposal.classification.cwdIsContained).toBe(false);
  });

  it("does not approve non-allowlisted proposals", async () => {
    const svc = createRealTerminalService();
    const proposal = await svc.propose("rm -rf /", "/root", "task-1", "/root");
    const token = await svc.approve(proposal.id, "actor-1", "approved");
    expect(token).toBeNull();
    expect(svc.getState().stage).toBe("rejected");
  });

  it("approve returns a token and transitions to approved stage", async () => {
    const svc = createRealTerminalService();
    const proposal = await svc.propose("pnpm test", "/root", "task-2", "/root");
    const token = await svc.approve(proposal.id, "actor-1", "approved");
    expect(token).not.toBeNull();
    expect(token!.status).toBe("issued");
    expect(token!.actor).toBe("actor-1");
    const state = svc.getState();
    expect(state.stage).toBe("approved");
    expect(state.token?.id).toBe(token!.id);
  });

  it("approve returns null for unknown proposal", async () => {
    const svc = createRealTerminalService();
    const token = await svc.approve("nonexistent", "actor-1", "ok");
    expect(token).toBeNull();
  });

  it("proposal is tracked in proposals list", async () => {
    const svc = createRealTerminalService();
    await svc.propose("pnpm lint", "/root", "task-3", "/root");
    await svc.propose("git status", "/root", "task-3", "/root");
    expect(svc.getState().proposals.length).toBe(2);
  });

  it("reject transitions to rejected stage", async () => {
    const svc = createRealTerminalService();
    const proposal = await svc.propose("pnpm typecheck", "/root", "task-4", "/root");
    svc.reject(proposal.id, "actor-2", "too risky");
    const state = svc.getState();
    expect(state.stage).toBe("rejected");
    expect(state.approvalState?.status).toBe("rejected");
    expect(state.approvalState?.reason).toBe("too risky");
  });

  it("cancel transitions to cancelled stage", async () => {
    const svc = createRealTerminalService();
    await svc.propose("pnpm test", "/root", "task-5", "/root");
    svc.cancel("exec-1");
    expect(svc.getState().stage).toBe("cancelled");
  });

  it("reset returns to idle with empty proposals", async () => {
    const svc = createRealTerminalService();
    await svc.propose("pnpm typecheck", "/root", "task-6", "/root");
    svc.reset();
    const state = svc.getState();
    expect(state.stage).toBe("idle");
    expect(state.proposals).toEqual([]);
    expect(state.activeProposal).toBeNull();
    expect(state.token).toBeNull();
  });

  it("subscribe receives state change events", async () => {
    const svc = createRealTerminalService();
    const events: string[] = [];
    const unsub = svc.subscribe((event) => {
      events.push(event.state.stage);
    });
    await svc.propose("pnpm typecheck", "/root", null, "/root");
    expect(events).toContain("proposed");
    unsub();
  });

  it("unsubscribe stops receiving events", async () => {
    const svc = createRealTerminalService();
    let count = 0;
    const unsub = svc.subscribe(() => { count++; });
    unsub();
    await svc.propose("pnpm test", "/root", null, "/root");
    expect(count).toBe(0);
  });

  it("refreshes adapter capability and notifies subscribers", async () => {
    const adapter: RealTerminalAdapter = {
      getCapability: () => ({
        enabled: false,
        mode: "disabled",
        reason: "feature_disabled",
        allowlistSummary: "MVP10 verification commands only",
        trustedRootRequired: true,
        approvalRequired: true,
        timeoutMs: 60_000,
        outputLimitBytes: 1_048_576,
        outputLimitLines: 5_000,
      }),
      refreshCapability: async () => ({
        enabled: true,
        mode: "native",
        reason: null,
        allowlistSummary: "MVP10 verification commands only",
        trustedRootRequired: true,
        approvalRequired: true,
        timeoutMs: 60_000,
        outputLimitBytes: 1_048_576,
        outputLimitLines: 5_000,
      }),
      propose: async () => {
        throw new Error("not used");
      },
      approve: async () => {
        throw new Error("not used");
      },
      execute: async () => {
        throw new Error("not used");
      },
    };
    const svc = createRealTerminalServiceWithOptions({ adapter });
    const updates: boolean[] = [];
    svc.subscribe((event) => {
      updates.push(Boolean(event.state.capability?.enabled));
    });

    await svc.refreshCapability();

    expect(svc.getState().capability?.enabled).toBe(true);
    expect(updates).toContain(true);
  });
});
