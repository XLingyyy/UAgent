import { describe, expect, it } from "vitest";
import { createNativeProjectAdapter, resolveTrustedNativeRootRef } from "./project-native-adapter";
import { createDesktopBrowserAdapter } from "./browser-native-adapter";
import { createDesktopTerminalAdapter } from "./terminal-native-adapter";

const RAW_PATH = "C:/Users/Dev/LyraStarter";

describe("project-native-adapter", () => {
  const nativeDirectories = [
    {
      id: "dir:Config",
      displayName: "Config",
      nodeType: "directory",
      rootRelativePath: "Config",
      displayPath: "[project-root]/Config",
      childrenCount: 1,
      isIgnored: false,
      limitReason: "none",
    },
    {
      id: "dir:Source",
      displayName: "Source",
      nodeType: "directory",
      rootRelativePath: "Source",
      displayPath: "[project-root]/Source",
      childrenCount: 1,
      isIgnored: false,
      limitReason: "none",
    },
  ] as const;
  const nativeFiles = [
    {
      id: "file:LyraStarter.uproject",
      displayName: "LyraStarter.uproject",
      nodeType: "file",
      rootRelativePath: "LyraStarter.uproject",
      displayPath: "[project-root]/LyraStarter.uproject",
      extension: ".uproject",
      byteSize: 42,
      isIgnored: false,
      limitReason: "none",
    },
    {
      id: "file:Config/DefaultGame.ini",
      displayName: "DefaultGame.ini",
      nodeType: "file",
      rootRelativePath: "Config/DefaultGame.ini",
      displayPath: "[project-root]/Config/DefaultGame.ini",
      extension: ".ini",
      byteSize: 128,
      isIgnored: false,
      limitReason: "none",
    },
    {
      id: "file:Source/LyraGame/LyraCharacter.cpp",
      displayName: "LyraCharacter.cpp",
      nodeType: "file",
      rootRelativePath: "Source/LyraGame/LyraCharacter.cpp",
      displayPath: "[project-root]/Source/LyraGame/LyraCharacter.cpp",
      extension: ".cpp",
      byteSize: 256,
      isIgnored: false,
      limitReason: "none",
    },
    {
      id: "file:Content/Materials/M_Hero.uasset",
      displayName: "M_Hero.uasset",
      nodeType: "file",
      rootRelativePath: "Content/Materials/M_Hero.uasset",
      displayPath: "[project-root]/Content/Materials/M_Hero.uasset",
      extension: ".uasset",
      byteSize: 2048,
      isIgnored: false,
      limitReason: "none",
    },
  ] as const;
  const nativeAssets = [
    {
      id: "asset:Content/Materials/M_Hero.uasset",
      displayName: "M_Hero.uasset",
      rootRelativePath: "Content/Materials/M_Hero.uasset",
      displayPath: "[project-root]/Content/Materials/M_Hero.uasset",
      assetType: "material",
      extension: ".uasset",
      source: "project_index",
      indexedAt: 8100,
      tags: ["material", "uasset"],
      previewStatus: "blocked",
    },
  ] as const;

  it("routes trusted real project operations through the MVP8 Tauri commands", async () => {
    const calls: { command: string; payload: unknown }[] = [];
    const adapter = createNativeProjectAdapter({
      invoke: async <T,>(command: string, payload: unknown): Promise<T> => {
        calls.push({ command, payload });
        if (command === "validate_native_project_root") {
          return {
            ok: true,
            reason: "valid",
            displayRoot: "[user-home]/LyraStarter",
            projectName: "LyraStarter",
            engine: { label: "UE 5.8", association: "5.8", source: "uproject" },
          } as T;
        }
        if (command === "trust_native_project_root") {
          return {
            displayRoot: "[user-home]/LyraStarter",
            trustState: "trusted",
          } as T;
        }
        if (command === "scan_native_project_index") {
          return {
            id: "index:native-lyra",
            projectId: "root:native-lyra",
            status: "ready",
            rootRef: RAW_PATH,
            directories: nativeDirectories,
            files: nativeFiles,
            assets: nativeAssets,
            summary: {
              projectId: "root:native-lyra",
              scannedAt: 8100,
              status: "ready",
              directoryCount: nativeDirectories.length,
              fileCount: nativeFiles.length,
              assetCount: nativeAssets.length,
              ignoredCount: 0,
              limitReasons: [],
              warnings: [],
              redactedRoot: "[user-home]/LyraStarter",
            },
          } as T;
        }
        if (command === "preview_native_project_file") {
          return {
            id: "preview:native",
            requestId: "preview:native",
            projectId: "root:native-lyra",
            rootRelativePath: "Config/DefaultGame.ini",
            displayPath: "[project-root]/Config/DefaultGame.ini",
            status: "ready",
            reason: "allowed_text_preview",
            content: "ProjectName=LyraStarter",
            truncation: {
              truncated: false,
              byteLimit: 4096,
              lineLimit: 80,
              originalBytes: 23,
              originalLines: 1,
            },
            redaction: { replacedSecrets: 0, replacedPaths: 0, redacted: false },
            createdAt: 8101,
          } as T;
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    });

    expect(adapter.source).toBe("native");

    const validation = await adapter.validateRoot(RAW_PATH);
    expect(validation.ok).toBe(true);

    const project = await adapter.addProject(RAW_PATH);
    // Project id must NOT contain raw path
    expect(project.id).not.toContain("C:/Users/Dev");
    expect(project.rootRef).not.toContain("C:/Users/Dev");
    expect(project.id).toMatch(/^native:root:/);
    expect(project.rootRef).toMatch(/^root:/);

    const trusted = await adapter.confirmTrust(project.id);
    expect(trusted.id).not.toContain("C:/Users/Dev");
    expect(trusted.rootRef).not.toContain("C:/Users/Dev");

    const scan = await adapter.scanProject(trusted.id);
    const preview = await adapter.previewFile(
      trusted.id,
      trusted.rootRef,
      "Config/DefaultGame.ini",
    );

    expect(scan.snapshot.status).toBe("ready");
    expect(scan.snapshot.directories).toHaveLength(nativeDirectories.length);
    expect(scan.snapshot.files).toHaveLength(nativeFiles.length);
    expect(scan.snapshot.assets).toHaveLength(nativeAssets.length);
    expect(scan.snapshot.files.some((file) => file.rootRelativePath === "LyraStarter.uproject")).toBe(true);
    expect(scan.snapshot.directories.some((dir) => dir.rootRelativePath === "Config")).toBe(true);
    expect(scan.snapshot.directories.some((dir) => dir.rootRelativePath === "Source")).toBe(true);
    expect(scan.snapshot.assets[0]?.source).toBe("project_index");
    expect(preview.status).toBe("ready");

    // Snapshot rootRef must be opaque token, never raw path
    const snapshotJson = JSON.stringify(scan.snapshot);
    expect(snapshotJson).not.toContain("C:/Users/Dev");
    expect(snapshotJson).not.toContain(RAW_PATH);
    expect(scan.snapshot.rootRef).toMatch(/^root:/);
    expect(scan.snapshot.rootRef).not.toContain("C:");

    // Stable snapshot also contains no raw paths
    const stableSnapshot = adapter.getStableSnapshot(trusted.id);
    expect(stableSnapshot).not.toBeNull();
    const stableJson = JSON.stringify(stableSnapshot);
    expect(stableJson).not.toContain("C:/Users/Dev");
    expect(stableJson).not.toContain(RAW_PATH);

    expect(calls.map((call) => call.command)).toEqual([
      "validate_native_project_root",
      "validate_native_project_root",
      "trust_native_project_root",
      "scan_native_project_index",
      "preview_native_project_file",
    ]);
  });

  it("serialized project list and snapshots contain no raw paths", async () => {
    const calls: { command: string; payload: unknown }[] = [];
    const adapter = createNativeProjectAdapter({
      invoke: async <T,>(command: string, payload: unknown): Promise<T> => {
        calls.push({ command, payload });
        if (command === "validate_native_project_root") {
          return {
            ok: true,
            reason: "valid",
            displayRoot: "[user-home]/LyraStarter",
            projectName: "LyraStarter",
            engine: { label: "UE 5.8", association: "5.8", source: "uproject" },
          } as T;
        }
        if (command === "trust_native_project_root") {
          return { displayRoot: "[user-home]/LyraStarter", trustState: "trusted" } as T;
        }
        if (command === "scan_native_project_index") {
          return {
            id: "index:native-lyra",
            projectId: "test",
            status: "ready",
            directories: nativeDirectories,
            files: nativeFiles,
            assets: nativeAssets,
            summary: {
              projectId: "test",
              scannedAt: 8100,
              status: "ready",
              directoryCount: nativeDirectories.length,
              fileCount: nativeFiles.length,
              assetCount: nativeAssets.length,
              ignoredCount: 0,
              limitReasons: [],
              warnings: [],
              redactedRoot: "[user-home]/LyraStarter",
            },
          } as T;
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    });

    const project = await adapter.addProject(RAW_PATH);
    const serializedProjects = JSON.stringify(adapter.listProjects());
    expect(serializedProjects).not.toContain("C:/Users/Dev");
    expect(serializedProjects).toContain("root:");
    expect(serializedProjects).toContain("[user-home]");

    const trusted = await adapter.confirmTrust(project.id);
    await adapter.scanProject(trusted.id);
    const serializedAfterScan = JSON.stringify(adapter.listProjects());
    expect(serializedAfterScan).not.toContain("C:/Users/Dev");
  });

  it("raw paths sent to Tauri invoke but absent from serialized adapter state", async () => {
    const invokePayloads: unknown[] = [];
    const adapter = createNativeProjectAdapter({
      invoke: async <T,>(command: string, payload: unknown): Promise<T> => {
        invokePayloads.push(payload);
        if (command === "validate_native_project_root") {
          return {
            ok: true,
            reason: "valid",
            displayRoot: "[user-home]/LyraStarter",
            projectName: "LyraStarter",
            engine: { label: "UE 5.8", association: "5.8", source: "uproject" },
          } as T;
        }
        if (command === "trust_native_project_root") {
          return { displayRoot: "[user-home]/LyraStarter", trustState: "trusted" } as T;
        }
        if (command === "scan_native_project_index") {
          return {
            id: "index:native-lyra",
            projectId: "test",
            status: "ready",
            directories: nativeDirectories,
            files: nativeFiles,
            assets: nativeAssets,
            summary: {
              projectId: "test",
              scannedAt: 8100,
              status: "ready",
              directoryCount: nativeDirectories.length,
              fileCount: nativeFiles.length,
              assetCount: nativeAssets.length,
              ignoredCount: 0,
              limitReasons: [],
              warnings: [],
              redactedRoot: "[user-home]/LyraStarter",
            },
          } as T;
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    });

    await adapter.addProject(RAW_PATH);
    // List all projects after add - no raw path
    expect(JSON.stringify(adapter.listProjects())).not.toContain("C:/Users/Dev");

    // Find the project with a deterministic token
    const projects = adapter.listProjects();
    expect(projects.length).toBe(1);
    const trusted = await adapter.confirmTrust(projects[0].id);

    // The validate call sent raw path to Tauri
    const validatePayload = invokePayloads[0] as { input?: { rootRef?: string } };
    expect(validatePayload).toBeDefined();
    const input = (validatePayload as Record<string, unknown>)?.input as Record<string, unknown> | undefined;
    if (input?.rootRef) {
      expect(input.rootRef).toBe(RAW_PATH);
    }

    // Scan sends raw path internally (adapter-private)
    await adapter.scanProject(trusted.id);
    // Just verify the trust payload still contained raw root
    const trustPayload = invokePayloads.find(
      (p) => {
        const pl = p as { input?: { rootRef?: string } };
        return pl?.input?.rootRef === RAW_PATH;
      },
    );
    expect(trustPayload).toBeDefined();
  });

  it("resolves trusted opaque root refs before terminal native invoke", async () => {
    const projectAdapter = createNativeProjectAdapter({
      invoke: async <T,>(command: string): Promise<T> => {
        if (command === "validate_native_project_root") {
          return {
            ok: true,
            reason: "valid",
            displayRoot: "[user-home]/LyraStarter",
            projectName: "LyraStarter",
            engine: { label: "UE 5.8", association: "5.8", source: "uproject" },
          } as T;
        }
        if (command === "trust_native_project_root") {
          return { displayRoot: "[user-home]/LyraStarter", trustState: "trusted" } as T;
        }
        throw new Error(`Unexpected project command: ${command}`);
      },
    });

    const project = await projectAdapter.addProject(RAW_PATH);
    const trusted = await projectAdapter.confirmTrust(project.id);
    expect(trusted.rootRef).toMatch(/^root:/);

    let terminalPayload: unknown = null;
    const terminalAdapter = createDesktopTerminalAdapter(async <T,>(
      command: string,
      payload: unknown,
    ): Promise<T> => {
      if (command === "propose_terminal_command") {
        terminalPayload = payload;
        return {
          proposalId: "native-proposal-root-resolution",
          command: "git status",
          risk: "allowlisted",
          reason: "allowed",
          canonicalCwd: RAW_PATH,
          redactedCwd: "[project-root]",
          timeoutMs: 60000,
          outputLimitBytes: 1024,
          outputLimitLines: 100,
        } as T;
      }
      throw new Error(`Unexpected terminal command: ${command}`);
    });

    await terminalAdapter.propose("git status", trusted.rootRef, null, trusted.rootRef, trusted.id);

    const input = (terminalPayload as { input?: { cwd?: string } }).input;
    expect(input?.cwd).toBe(RAW_PATH);
  });

  it("does not expose mutation root mappings until native trust succeeds and removes them with the project", async () => {
    const rawRoot = "C:/Projects/A20OnlyAfterTrust";
    const adapter = createNativeProjectAdapter({
      invoke: async <T,>(command: string): Promise<T> => {
        if (command === "validate_native_project_root") return { ok: true, reason: "valid", displayRoot: "[project-root]/A20OnlyAfterTrust", projectName: "A20OnlyAfterTrust", engine: { label: "UE", association: null, source: "fixture" } } as T;
        if (command === "trust_native_project_root") return { rootId: "trusted-root:a20-only-after-trust", displayRoot: "[project-root]/A20OnlyAfterTrust", trustState: "trusted" } as T;
        throw new Error(`Unexpected project command: ${command}`);
      },
    });
    const project = await adapter.addProject(rawRoot);
    expect(resolveTrustedNativeRootRef(project.id)).toBeUndefined();
    expect(resolveTrustedNativeRootRef(project.rootRef)).toBeUndefined();
    const trusted = await adapter.confirmTrust(project.id);
    expect(resolveTrustedNativeRootRef(trusted.id)).toBe(rawRoot);
    expect(resolveTrustedNativeRootRef(trusted.rootRef)).toBe(rawRoot);
    adapter.removeProject(trusted.id);
    expect(resolveTrustedNativeRootRef(trusted.id)).toBeUndefined();
    expect(resolveTrustedNativeRootRef(trusted.rootRef)).toBeUndefined();
  });

  it("does not expose mutation root mappings when native trust fails", async () => {
    const rawRoot = "C:/Projects/A20TrustFailure";
    const adapter = createNativeProjectAdapter({
      invoke: async <T,>(command: string): Promise<T> => {
        if (command === "validate_native_project_root") return { ok: true, reason: "valid", displayRoot: "[project-root]/A20TrustFailure", projectName: "A20TrustFailure", engine: { label: "UE", association: null, source: "fixture" } } as T;
        if (command === "trust_native_project_root") throw new Error("trust rejected");
        throw new Error(`Unexpected project command: ${command}`);
      },
    });
    const project = await adapter.addProject(rawRoot);
    await expect(adapter.confirmTrust(project.id)).rejects.toThrow("trust rejected");
    expect(resolveTrustedNativeRootRef(project.id)).toBeUndefined();
    expect(resolveTrustedNativeRootRef(project.rootRef)).toBeUndefined();
  });

  it("uses camelCase trusted root payloads for native browser preview", async () => {
    const projectAdapter = createNativeProjectAdapter({
      invoke: async <T,>(command: string): Promise<T> => {
        if (command === "validate_native_project_root") {
          return {
            ok: true,
            reason: "valid",
            displayRoot: "[user-home]/LyraStarter",
            projectName: "LyraStarter",
            engine: { label: "UE 5.8", association: "5.8", source: "uproject" },
          } as T;
        }
        if (command === "trust_native_project_root") {
          return { displayRoot: "[user-home]/LyraStarter", trustState: "trusted" } as T;
        }
        throw new Error(`Unexpected project command: ${command}`);
      },
    });

    const project = await projectAdapter.addProject(RAW_PATH);
    const trusted = await projectAdapter.confirmTrust(project.id);
    const browserPayloads: { command: string; payload: unknown }[] = [];
    const browserAdapter = createDesktopBrowserAdapter(async <T,>(
      command: string,
      payload: unknown,
    ): Promise<T> => {
      browserPayloads.push({ command, payload });
      if (command === "browser_preview") {
        return {
          sessionId: "session-browser",
          url: "[local file] report.html",
          targetId: "browser-target:file",
          policy: "local_only",
          blocked: false,
          reason: "",
          displayTarget: "[local file] report.html",
          displayUrl: "[local file] report.html",
          needsTrustedRoot: true,
        } as T;
      }
      if (command === "open_browser_preview") {
        return { windowId: "browser-preview-session-browser", status: "opened" } as T;
      }
      throw new Error(`Unexpected browser command: ${command}`);
    });

    await browserAdapter.classifyUrl("file:///C:/Users/Dev/LyraStarter/report.html", trusted.rootRef);
    await browserAdapter.openPreview("file:///C:/Users/Dev/LyraStarter/report.html", "session-browser", trusted.rootRef);

    const classifyInput = (browserPayloads[0].payload as { input?: Record<string, unknown> }).input;
    expect(classifyInput?.rootRef).toBe(RAW_PATH);
    expect(classifyInput?.taskId).toBeNull();
    expect(classifyInput).not.toHaveProperty("root_ref");
    expect(classifyInput).not.toHaveProperty("task_id");

    const openInput = (browserPayloads[1].payload as { input?: Record<string, unknown> }).input;
    expect(openInput?.rootRef).toBe(RAW_PATH);
    expect(openInput?.sessionId).toBe("session-browser");
    expect(openInput).not.toHaveProperty("root_ref");
    expect(openInput).not.toHaveProperty("session_id");
  });

  it("rejects legacy native scan results that contain counts without index entries", async () => {
    const adapter = createNativeProjectAdapter({
      invoke: async <T,>(command: string): Promise<T> => {
        if (command === "validate_native_project_root") {
          return {
            ok: true,
            reason: "valid",
            displayRoot: "[user-home]/LyraStarter",
            projectName: "LyraStarter",
            engine: { label: "UE 5.8", association: "5.8", source: "uproject" },
          } as T;
        }
        if (command === "trust_native_project_root") {
          return { displayRoot: "[user-home]/LyraStarter", trustState: "trusted" } as T;
        }
        if (command === "scan_native_project_index") {
          return {
            id: "index:native-lyra",
            projectId: "test",
            status: "ready",
            directory_count: 2,
            file_count: 3,
            asset_count: 1,
            ignored_count: 0,
            scanned_at: 8100,
            warnings: [],
          } as T;
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    });

    const project = await adapter.addProject(RAW_PATH);
    const trusted = await adapter.confirmTrust(project.id);

    await expect(adapter.scanProject(trusted.id)).rejects.toThrow(
      "Native scan did not return project index entries",
    );
  });
});
