import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { assessUEBuildRepair } from "@uagent/runtime";
import { I18nProvider, createLocaleStore } from "../i18n";
import { UEBuildFailureDiagnosis } from "./UEBuildFailureDiagnosis";
import { UEApprovedBuildAction } from "./UEApprovedBuildAction";
import type { UEBuildPreviewReceipt } from "../runtime/native-ue-build-preview";
const preview = { projectId: "root:abc", preparedId: "a".repeat(32), preview: {
  fingerprint: "b".repeat(64), projectRoot: "E:/SyntheticGame", cwd: "E:/SyntheticGame",
  profile: { engineRoot: "G:/SyntheticEngine" },
} } as UEBuildPreviewReceipt;
const run = "c".repeat(32);
const result = () => ({ owner: { runId: run, stepId: "build", fingerprint: preview.preview.fingerprint },
  status: "failed", exitCode: 6, treeStopped: true, outputComplete: true, outputTruncated: false,
  stdout: "E:/SyntheticGame/Source/Game/Foo.cpp(12,4): error C2065: 'Missing': undeclared identifier\n",
  stderr: "", reason: "exited", pid: 1, durationMs: 1, effects: "possible" });
function wrap(node: React.ReactNode) { return <I18nProvider store={createLocaleStore({ initialLocale: "en", storage: null })}>{node}</I18nProvider>; }
afterEach(cleanup);
it("analyzes the actual approved-build response without another IPC, provider or write", async () => {
  const invoke = vi.fn(async () => ({ schemaVersion: 1, projectId: preview.projectId, preparedId: preview.preparedId,
    runId: run, persisted: true, hostSettled: true, result: result() }));
  render(wrap(<UEApprovedBuildAction preview={preview} invoke={invoke as never} onActiveChange={() => {}} onConsumed={() => {}}/>));
  fireEvent.click(screen.getByRole("button", { name: "Request native approval and build once" }));
  fireEvent.click(await screen.findByRole("button", { name: "Analyze this build result" }));
  expect(screen.getByText("Source/Game/Foo.cpp")).toBeTruthy();
  expect(screen.getByText(/COMPILER.*C2065/)).toBeTruthy();
  expect(screen.getByText(/Errors from the failed build/)).toBeTruthy();
  expect(screen.getByText(/not connected yet. No files were changed/)).toBeTruthy();
  expect(invoke).toHaveBeenCalledTimes(1);
});
it.each([
  ["unknown termination", { treeStopped: false }, "termination_unconfirmed"],
  ["capture truncated", { outputTruncated: true }, "incomplete_diagnostics"],
  ["capture incomplete", { outputComplete: false }, "incomplete_diagnostics"],
  ["cancelled", { status: "cancelled" }, "not_failed_build"],
  ["no structured errors", { stdout: "build failed" }, "no_parsed_errors"],
] as const)("shares coordinator rejection for %s", (_, change, reason) => {
  const observed = { ...result(), ...change };
  const decision = assessUEBuildRepair(observed, { projectRoot: preview.preview.projectRoot });
  expect(decision.eligible).toBe(false); expect(decision.reason).toBe(reason);
  render(wrap(<UEBuildFailureDiagnosis result={observed} preview={preview} persisted hostSettled/>));
  fireEvent.click(screen.getByRole("button", { name: "Analyze this build result" }));
  expect(screen.queryByText(/Errors from the failed build have been identified/)).toBeNull();
});
it("shows unsaved receipt as blocked even when diagnostics contain an error", () => {
  render(wrap(<UEBuildFailureDiagnosis result={result()} preview={preview} persisted={false} hostSettled/>));
  fireEvent.click(screen.getByRole("button", { name: "Analyze this build result" }));
  expect(screen.getByText(/receipt persistence is unconfirmed/)).toBeTruthy();
  expect(screen.queryByText(/Errors from the failed build have been identified/)).toBeNull();
});
it("keeps external paths and markup inert without treating them as source permissions", () => {
  const observed = { ...result(), stdout: "Z:/Other/Secret.cpp(9): error C2065: <script>bad()</script>\n" };
  const { container } = render(wrap(<UEBuildFailureDiagnosis result={observed} preview={preview} persisted hostSettled/>));
  fireEvent.click(screen.getByRole("button", { name: "Analyze this build result" }));
  expect(screen.getByText(/External:/)).toBeTruthy(); expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector("a")).toBeNull();
});
