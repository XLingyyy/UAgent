import { describe, it, expect } from "vitest";
import {
  classifyBrowserUrl,
  createFixtureBrowserPreviewAdapter,
  createFixtureScreenshotAdapter,
} from "./mvp9-browser-screenshot.js";

describe("classifyBrowserUrl", () => {
  const ALLOWED_LOCAL = ["http://localhost", "http://127.0.0.1", "file://"];

  it("allows localhost URLs", () => {
    const { policy } = classifyBrowserUrl("http://localhost:3000/preview", ALLOWED_LOCAL);
    expect(policy).toBe("local_only");
  });

  it("blocks external URLs", () => {
    const { policy } = classifyBrowserUrl("https://example.com", ALLOWED_LOCAL);
    expect(policy).toBe("blocked_external");
  });

  it("blocks IPv6 loopback outside the MVP10 G8 browser boundary", () => {
    const { policy } = classifyBrowserUrl("http://[::1]:3000/preview", ALLOWED_LOCAL);
    expect(policy).toBe("blocked_external");
  });

  it("blocks URL userinfo tricks even when the host is localhost", () => {
    const { policy } = classifyBrowserUrl("http://example.com@localhost:3000", ALLOWED_LOCAL);
    expect(policy).toBe("blocked_external");
  });

  it("blocks file:// URLs without an explicit trusted root", () => {
    const { policy } = classifyBrowserUrl("file:///tmp/preview.html", ALLOWED_LOCAL, {
      requireTrustedRootForFile: true,
    });
    expect(policy).toBe("blocked_external");
  });
});

describe("createFixtureBrowserPreviewAdapter", () => {
  it("creates preview request for local URL", () => {
    const adapter = createFixtureBrowserPreviewAdapter();
    const req = adapter.requestPreview("http://localhost:3000", null);
    expect(req.policy).toBe("local_only");
    expect(req.id).toContain("fixture-browser-req");
  });

  it("creates preview request for blocked URL", () => {
    const adapter = createFixtureBrowserPreviewAdapter();
    const req = adapter.requestPreview("https://evil.com", null);
    expect(req.policy).toBe("blocked_external");
  });

  it("returns session for allowed URL", () => {
    const adapter = createFixtureBrowserPreviewAdapter();
    const req = adapter.requestPreview("http://localhost:3000", null);
    const session = adapter.getSession(req.id);
    expect(session).not.toBeNull();
    expect(session!.status).toBe("active");
  });

  it("creates artifact", () => {
    const adapter = createFixtureBrowserPreviewAdapter();
    const artifact = adapter.createArtifact("session-1");
    expect(artifact.kind).toBe("browser_snapshot");
  });
});

describe("createFixtureScreenshotAdapter", () => {
  it("creates capture request", () => {
    const adapter = createFixtureScreenshotAdapter();
    const req = adapter.requestCapture("UE viewport", "review", "task-001");
    expect(req.scope).toBe("UE viewport");
    expect(req.permissionPrompt).toContain("Allow screenshot");
  });

  it("returns completed result when approved", () => {
    const adapter = createFixtureScreenshotAdapter();
    const req = adapter.requestCapture("UE viewport", "review", "task-002");
    const result = adapter.captureResult(req.id, true);
    expect(result.status).toBe("completed");
    expect(result.artifactId).not.toBeNull();
  });

  it("returns denied result when rejected", () => {
    const adapter = createFixtureScreenshotAdapter();
    const req = adapter.requestCapture("UE viewport", "review", "task-003");
    const result = adapter.captureResult(req.id, false);
    expect(result.status).toBe("denied");
    expect(result.artifactId).toBeNull();
  });
});
