import type {
  TerminalCommandProposal,
  TerminalExecutionRequest,
  TerminalExecutionResult,
  TerminalOutputChunk,
  TerminalExitState,
  TerminalCommandClassification,
} from "@uagent/shared";

export interface FixtureTerminalAdapter {
  propose(command: string, cwd: string, taskId: string | null): TerminalCommandProposal;
  execute(request: TerminalExecutionRequest): Promise<TerminalExecutionResult>;
  cancel(executionId: string): void;
}

let proposalCounter = 0;
let executionCounter = 0;

function simulateChunks(
  request: TerminalExecutionRequest,
  abortSignal: { aborted: boolean },
): TerminalOutputChunk[] {
  const chunks: TerminalOutputChunk[] = [];
  const lines = [
    `[fixture] Dry-run: ${request.command}`,
    `[fixture] Working directory: ${request.cwd}`,
    "[fixture] This is a simulated terminal output.",
    "[fixture] No real shell command was executed.",
    "[fixture] ---",
    "[fixture] > pnpm typecheck",
    "[fixture] TypeScript check passed (0 errors, 0 warnings)",
    "[fixture] > pnpm lint",
    "[fixture] ESLint passed (0 problems)",
    "[fixture] ---",
    "[fixture] Exit code: 0",
    "[fixture] Duration: 1.234s (simulated)",
  ];

  for (let i = 0; i < lines.length; i++) {
    if (abortSignal.aborted) break;
    chunks.push({
      index: i,
      stream: i % 3 === 2 ? "stderr" : "stdout",
      text: lines[i],
      truncated: false,
      timestamp: Date.now() + i * 50,
    });
  }
  return chunks;
}

export function createFixtureTerminalAdapter(): FixtureTerminalAdapter {
  const activeExecutions = new Map<string, { aborted: boolean }>();

  return {
    propose(command: string, cwd: string, taskId: string | null): TerminalCommandProposal {
      proposalCounter++;
      const classification: TerminalCommandClassification = {
        command,
        risk: "allowlisted",
        reason: "fixture adapter: dry-run classification",
        matchedKeyword: null,
        cwd,
        cwdIsContained: true,
        hasShellMetachar: false,
        envHints: [],
      };
      return {
        id: `fixture-proposal-${proposalCounter}`,
        taskId,
        command,
        cwd,
        classification,
        outputLimitBytes: 102400,
        outputLimitLines: 1000,
        timeoutMs: 30000,
        proposedAt: Date.now(),
      };
    },

    async execute(request: TerminalExecutionRequest): Promise<TerminalExecutionResult> {
      executionCounter++;
      const status = { aborted: false };
      activeExecutions.set(request.id, status);

      return new Promise((resolve) => {
        setTimeout(() => {
          const chunks = simulateChunks(request, status);
          const totalBytes = chunks.reduce((sum, c) => sum + c.text.length, 0);
          const exitState: TerminalExitState = {
            code: 0,
            signal: null,
            durationMs: 1234,
          };

          resolve({
            id: `fixture-exec-${executionCounter}`,
            requestId: request.id,
            status: status.aborted ? "cancelled" : "completed",
            chunks,
            exitState,
            outputSummary: chunks.map((c) => c.text).join("\n").slice(0, 500),
            outputTruncated: false,
            totalBytes,
            totalLines: chunks.length,
            redactionSummary: { replacedSecrets: 0, replacedPaths: 0 },
            createdAt: Date.now(),
            completedAt: Date.now(),
          });
          activeExecutions.delete(request.id);
        }, 500);
      });
    },

    cancel(executionId: string): void {
      const exec = activeExecutions.get(executionId);
      if (exec) {
        exec.aborted = true;
      }
    },
  };
}
