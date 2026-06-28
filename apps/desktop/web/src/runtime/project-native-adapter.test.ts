import { describe, expect, it } from "vitest";
import { createNativeProjectAdapter } from "./project-native-adapter";

const RAW_PATH = "C:/Users/Dev/LyraStarter";

describe("project-native-adapter", () => {
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
            directories: [],
            files: [],
            assets: [],
            summary: {
              projectId: "root:native-lyra",
              scannedAt: 8100,
              status: "ready",
              directoryCount: 0,
              fileCount: 0,
              assetCount: 0,
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
          return { id: "index:native-lyra", projectId: "test", status: "ready", directory_count: 2, file_count: 3, asset_count: 1, ignored_count: 0, scanned_at: 8100, warnings: [] } as T;
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
          return { id: "index:native-lyra", projectId: "test", status: "ready", directory_count: 0, file_count: 0, asset_count: 0, ignored_count: 0, scanned_at: 8100, warnings: [] } as T;
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
});
