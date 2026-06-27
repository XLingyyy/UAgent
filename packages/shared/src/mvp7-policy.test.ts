import { describe, expect, it } from "vitest";
import {
  redactPathForUi,
  isInsideProjectRoot,
  isTextPreviewAllowed,
  normalizeProjectPath,
  shouldIgnoreProjectPath,
  type CapabilityRequest,
  type ProjectProfile,
  type SafeFilePreviewRequest,
} from "./index.js";

describe("MVP7 shared project and capability contracts", () => {
  it("defines serializable project profile and capability request contracts", () => {
    const profile: ProjectProfile = {
      id: "project-lyra",
      name: "Lyra_Prototype",
      rootRef: "fixture://lyra",
      displayRoot: "[project-root]/Lyra_Prototype",
      trustState: "trusted",
      indexStatus: "ready",
      engine: { label: "UE 5.8", association: "5.8", source: "uproject" },
      createdAt: 1,
      updatedAt: 1,
    };
    const request: CapabilityRequest = {
      id: "cap-1",
      kind: "terminal",
      mode: "fixture",
      projectId: profile.id,
      createdAt: 2,
      input: { command: "UnrealEditor-Cmd.exe -run=DerivedDataCache" },
    };
    const preview: SafeFilePreviewRequest = {
      id: "preview-1",
      projectId: profile.id,
      rootRef: profile.rootRef,
      rootRelativePath: "Config/DefaultGame.ini",
      byteLimit: 4096,
      lineLimit: 80,
    };

    expect(profile.displayRoot).not.toContain("C:\\Users");
    expect(request.mode).toBe("fixture");
    expect(preview.rootRelativePath).toBe("Config/DefaultGame.ini");
  });

  it("normalizes relative paths and blocks traversal outside the registered root", () => {
    const root = normalizeProjectPath("C:/Projects/Lyra");

    expect(isInsideProjectRoot(root, normalizeProjectPath("C:/Projects/Lyra/Content/Hero.uasset"))).toBe(true);
    expect(isInsideProjectRoot(root, normalizeProjectPath("C:/Projects/Lyra/../Secrets/token.txt"))).toBe(false);
    expect(isInsideProjectRoot(root, normalizeProjectPath("C:/Projects/LyraSymlink/Content/Hero.uasset"))).toBe(false);
  });

  it("applies ignore directories, preview allowlist, and UI path redaction", () => {
    expect(shouldIgnoreProjectPath("Content/Hero.uasset")).toBe(false);
    expect(shouldIgnoreProjectPath("Saved/Logs/session.log")).toBe(true);
    expect(shouldIgnoreProjectPath("Plugins/Foo/node_modules/package.json")).toBe(true);
    expect(isTextPreviewAllowed("Config/DefaultGame.ini", 1024)).toBe(true);
    expect(isTextPreviewAllowed("Content/Hero.uasset", 1024)).toBe(false);
    expect(isTextPreviewAllowed("Source/Huge.cpp", 1024 * 1024 * 8)).toBe(false);
    expect(redactPathForUi("C:/Users/Ada/Projects/Lyra/Config/DefaultGame.ini")).toBe(
      "[user-home]/Projects/Lyra/Config/DefaultGame.ini",
    );
  });
});
