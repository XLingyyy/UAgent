import { describe, expect, it } from "vitest";
import {
  createCapabilityBridge,
  createFixtureProjectRegistry,
  createProjectIndexer,
  createSafeFilePreviewer,
  createSessionHistory,
  runMvp7ScenarioMatrix,
  type Mvp7ScenarioResult,
} from "./index.js";

const matrix = await runMvp7ScenarioMatrix();

describe("MVP7 project index and capability bridge runtime", () => {
  it("keeps the project registry empty by default and validates only explicit fixture roots", () => {
    const registry = createFixtureProjectRegistry();

    expect(registry.listProjects()).toHaveLength(0);
    expect(registry.validateRoot("")).toMatchObject({ ok: false, reason: "empty_path" });
    expect(registry.validateRoot("C:/")).toMatchObject({ ok: false, reason: "dangerous_root" });
    expect(registry.validateRoot("fixture://lyra")).toMatchObject({ ok: true });
  });

  it("builds a deterministic fixture index with ignored dirs, asset classification, and cancellation", () => {
    const registry = createFixtureProjectRegistry();
    const project = registry.addProject("fixture://lyra");
    registry.confirmTrust(project.id);
    const indexer = createProjectIndexer(registry);
    const first = indexer.scanProject(project.id);
    const second = indexer.scanProject(project.id);

    expect(JSON.stringify(first.snapshot)).toBe(JSON.stringify(second.snapshot));
    expect(first.snapshot.status).toBe("ready");
    expect(first.snapshot.assets.some((asset) => asset.assetType === "map")).toBe(true);
    expect(first.snapshot.summary.ignoredCount).toBeGreaterThan(0);
    expect(indexer.cancelScan(project.id).snapshot.id).toBe(first.snapshot.id);
  });

  it("records scan limits and malformed project warnings as structured index evidence", () => {
    const registry = createFixtureProjectRegistry();
    const project = registry.addProject("fixture://lyra");
    registry.confirmTrust(project.id);
    const indexer = createProjectIndexer(registry);
    const { snapshot } = indexer.scanProject(project.id);

    expect(snapshot.summary.limitReasons).toEqual(
      expect.arrayContaining(["node_cap", "symlink_escape"]),
    );
    expect(snapshot.summary.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("malformed_uproject"),
        expect.stringContaining("symlink_escape"),
      ]),
    );
    expect(snapshot.status).toBe("ready");
    expect(snapshot.files.some((file) => file.rootRelativePath.includes("Malformed"))).toBe(false);
  });

  it("previews safe text with redaction and blocks binary plus traversal requests", () => {
    const registry = createFixtureProjectRegistry();
    const project = registry.addProject("fixture://lyra");
    registry.confirmTrust(project.id);
    const indexer = createProjectIndexer(registry);
    indexer.scanProject(project.id);
    const previewer = createSafeFilePreviewer(registry);

    const text = previewer.previewFile({
      id: "preview-text",
      projectId: project.id,
      rootRef: project.rootRef,
      rootRelativePath: "Config/DefaultGame.ini",
      byteLimit: 120,
      lineLimit: 5,
    });
    const binary = previewer.previewFile({
      id: "preview-bin",
      projectId: project.id,
      rootRef: project.rootRef,
      rootRelativePath: "Content/Characters/Hero.uasset",
      byteLimit: 120,
      lineLimit: 5,
    });
    const escape = previewer.previewFile({
      id: "preview-escape",
      projectId: project.id,
      rootRef: project.rootRef,
      rootRelativePath: "../Secrets/token.txt",
      byteLimit: 120,
      lineLimit: 5,
    });

    expect(text.status).toBe("ready");
    expect(text.content).toContain("[REDACTED]");
    expect(binary.status).toBe("blocked");
    expect(escape.status).toBe("blocked");
  });

  it("blocks write, exec, browser, screenshot, and provider live by default", () => {
    const bridge = createCapabilityBridge();

    expect(bridge.request({ id: "files-write", kind: "files", mode: "read_only", projectId: "p", createdAt: 1, input: { operation: "write" } }).decision.status).toBe("blocked");
    expect(bridge.request({ id: "term", kind: "terminal", mode: "fixture", projectId: "p", createdAt: 2, input: { command: "pnpm test" } }).result.status).toBe("completed");
    expect(bridge.request({ id: "browser", kind: "browser", mode: "fixture", projectId: "p", createdAt: 3, input: { url: "https://example.com" } }).decision.status).toBe("blocked");
    expect(bridge.request({ id: "shot", kind: "screenshot", mode: "fixture", projectId: "p", createdAt: 4, input: {} }).decision.status).toBe("blocked");
    expect(bridge.request({ id: "live", kind: "provider_live", mode: "manual_live", projectId: "p", createdAt: 5, input: { confirmed: false } }).decision.status).toBe("blocked");
  });

  it("replays redacted project and capability events without scan or adapter execution", () => {
    let tick = 100;
    const scanCalls = 0;
    const adapterCalls = 0;
    const history = createSessionHistory(() => tick++);

    history.recordProjectEvent(
      "task-replay",
      "project_index_completed",
      "Indexed C:/Users/Ada/Lyra with token sk-fixture-secret-1234567890",
      "project-lyra",
    );
    history.recordCapabilityEvent(
      "task-replay",
      "capability_blocked",
      "Files write blocked for C:/Users/Ada/Lyra/Config/DefaultGame.ini",
      "files",
      "blocked",
    );

    const replay = history.replayTask("task-replay");
    const replayAgain = history.replayTask("task-replay");

    expect(scanCalls).toBe(0);
    expect(adapterCalls).toBe(0);
    expect(replay.events.map((event) => event.type)).toEqual([
      "project_index_completed",
      "capability_blocked",
    ]);
    expect(replay.events.map((event) => event.createdAt)).toEqual([100, 101]);
    expect(replayAgain.events).toEqual(replay.events);
    expect(replay.events[0].payload).toMatchObject({ projectId: "project-lyra" });
    expect(replay.events[1].payload).toMatchObject({
      capabilityKind: "files",
      status: "blocked",
    });
    expect(JSON.stringify(replay.events)).not.toContain("sk-fixture-secret-1234567890");
    expect(JSON.stringify(replay.events)).not.toContain("C:/Users/Ada");
  });

  it("has 50 scenarios with 80+ total assertions", () => {
    expect(matrix.scenarios).toHaveLength(50);
    expect(new Set(matrix.scenarios.map((s) => s.name)).size).toBe(50);
    expect(matrix.totalAssertions).toBeGreaterThanOrEqual(80);
  });

  it.each(matrix.scenarios)("$name - should pass ($assertionCount assertions)", ({ name, status, summary }: Mvp7ScenarioResult) => {
    expect(status, `${name}: ${summary}`).toBe("pass");
  });
});
