import { describe, expect, it, vi } from "vitest";
import { createMvp10RuntimeService } from "./mvp10-runtime-service.js";
import type { RealTerminalAdapter } from "./mvp10-terminal-service.js";

describe("createMvp10RuntimeService native terminal lifecycle", () => {
  it("records native execution lifecycle and replays without invoking native execution again", async () => {
    const execute = vi.fn(async () => ({
      id: "native-exec-1",
      requestId: "native-proposal-1",
      status: "completed" as const,
      chunks: [{ index: 0, stream: "stdout" as const, text: "ok\n", truncated: false, timestamp: 1 }],
      exitState: { code: 0, signal: null, durationMs: 20 },
      outputSummary: "ok\n",
      outputTruncated: false,
      totalBytes: 3,
      totalLines: 1,
      redactionSummary: { replacedSecrets: 0, replacedPaths: 1 },
      createdAt: 1,
      completedAt: 2,
    }));
    const adapter: RealTerminalAdapter = {
      getCapability: () => ({
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
      propose: vi.fn(async () => ({
        id: "native-proposal-1",
        taskId: "task-native",
        projectId: "lyra",
        command: "pnpm test",
        cwd: "[project-root]",
        classification: {
          command: "pnpm test",
          risk: "allowlisted" as const,
          reason: "command classified as allowlisted",
          matchedKeyword: null,
          cwd: "[project-root]",
          cwdIsContained: true,
          hasShellMetachar: false,
          envHints: [],
        },
        outputLimitBytes: 1_048_576,
        outputLimitLines: 5_000,
        timeoutMs: 60_000,
        proposedAt: 1,
        expiresAt: 1_700_000_300_000,
      })),
      approve: vi.fn(async () => ({
        id: "[native-issued]",
        proposalId: "native-proposal-1",
        taskId: "task-native",
        status: "issued" as const,
        actor: "user",
        createdAt: 1,
        usedAt: null,
        expiresAt: 1_700_000_300_000,
      })),
      execute,
    };

    const service = createMvp10RuntimeService({ terminalAdapter: adapter });
    const proposal = await service.terminal.propose("pnpm test", "G:\\UAgent", "task-native", "G:\\UAgent", "lyra");
    await service.terminal.approve(proposal.id, "user", "approve");

    expect(execute).toHaveBeenCalledTimes(1);
    expect(service.terminal.getState().stage).toBe("completed");

    const replay = service.replayTask("task-native");
    expect(replay.terminal.stage).toBe("completed");
    expect(replay.terminal.executionResult?.outputSummary).toBe("ok\n");
    expect(execute).toHaveBeenCalledTimes(1);

    const serializedAudit = JSON.stringify(service.getAuditEngine().getProjection());
    const serializedReplay = JSON.stringify(service.getSessionEngine().replayTask("task-native"));
    expect(serializedAudit).not.toContain("G:\\UAgent");
    expect(serializedReplay).not.toContain("G:\\UAgent");
    expect(serializedAudit).not.toContain("raw");
    expect(serializedReplay).not.toContain("raw");
  });
});
