import { describe, expect, it } from "vitest";
import {
  isVerifiedUEBuildSuccess,
  validateUEBuildProfileShape,
  type UEBuildExecutionResult,
  type UEBuildProfile,
} from "./ue-build-profile.js";

const profile: UEBuildProfile = {
  schemaVersion: 1,
  profileId: "game_editor",
  projectId: "game",
  engineRoot: "C:/Engine 5.8",
  uprojectRelativePath: "Game.uproject",
  target: "GameEditor",
  platform: "Win64",
  configuration: "Development",
  method: "ubt",
  bundledDotnetVersion: "10.0",
  timeoutMs: 60_000,
};

describe("UEBuildProfile shape (not filesystem authorization)", () => {
  it("accepts a fixed UBT profile", () => {
    expect(validateUEBuildProfileShape(profile)).toEqual([]);
  });
  it.each(["GameEditor -Clean", "GameEditor&whoami", "../Other", "-Target"])(
    "rejects target injection %s",
    (target) => {
      expect(validateUEBuildProfileShape({ ...profile, target })).toContain("invalid_target");
    },
  );
  it.each([
    "../Game.uproject",
    "C:/Other.uproject",
    "Game.uproject -Clean",
    "folder//Game.uproject",
    "a/./Game.uproject",
  ])("rejects ambiguous project path %s", (uprojectRelativePath) => {
    expect(validateUEBuildProfileShape({ ...profile, uprojectRelativePath })).toContain(
      "invalid_uproject_path",
    );
  });
  it("bounds execution time and pins the bundled SDK", () => {
    expect(
      validateUEBuildProfileShape({
        ...profile,
        timeoutMs: Infinity,
        bundledDotnetVersion: "../../system",
      }),
    ).toEqual(["invalid_timeout", "invalid_bundled_dotnet_version"]);
  });
  it("never upgrades cancellation, incomplete output, or unknown termination to success", () => {
    const result: UEBuildExecutionResult = {
      owner: { runId: "r", stepId: "s", fingerprint: "f" },
      status: "succeeded",
      reason: "process_exited",
      pid: 12,
      exitCode: 0,
      durationMs: 1,
      treeStopped: true,
      stdout: "BUILD SUCCESSFUL",
      stderr: "",
      outputTruncated: false,
      outputComplete: true,
      effects: "possible",
    };
    expect(isVerifiedUEBuildSuccess(result)).toBe(true);
    for (const status of [
      "cancelled",
      "timed_out",
      "failed",
      "not_started",
      "termination_unknown",
    ] as const) {
      expect(isVerifiedUEBuildSuccess({ ...result, status })).toBe(false);
    }
    expect(isVerifiedUEBuildSuccess({ ...result, exitCode: 6 })).toBe(false);
    expect(isVerifiedUEBuildSuccess({ ...result, treeStopped: false })).toBe(false);
    expect(isVerifiedUEBuildSuccess({ ...result, outputComplete: false })).toBe(false);
  });
});
