import type {
  BrowserPreviewRequest,
  BrowserPreviewSession,
  BrowserPreviewUrlPolicy,
  ScreenshotCaptureRequest,
  ScreenshotCaptureResult,
  ScreenshotMetadata,
  PreviewArtifact,
} from "@uagent/shared";

export function classifyBrowserUrl(
  url: string,
  allowedLocalPatterns: string[],
): { policy: BrowserPreviewUrlPolicy; reason: string } {
  const isLocal = allowedLocalPatterns.some((p) => url.startsWith(p));
  if (isLocal) {
    return { policy: "local_only", reason: "URL matches allowed local pattern" };
  }
  return {
    policy: "blocked_external",
    reason: "External URL blocked by default policy; requires user approval",
  };
}

export interface FixtureBrowserPreviewAdapter {
  requestPreview(url: string, taskId: string | null): BrowserPreviewRequest;
  getSession(requestId: string): BrowserPreviewSession | null;
  createArtifact(sessionId: string): PreviewArtifact;
}

let previewCounter = 0;
let sessionCounter = 0;

export function createFixtureBrowserPreviewAdapter(
  allowedLocalPatterns = ["http://localhost", "http://127.0.0.1", "file://"],
): FixtureBrowserPreviewAdapter {
  const sessions = new Map<string, BrowserPreviewSession>();

  return {
    requestPreview(url: string, taskId: string | null): BrowserPreviewRequest {
      previewCounter++;
      const { policy, reason } = classifyBrowserUrl(url, allowedLocalPatterns);
      const request: BrowserPreviewRequest = {
        id: `fixture-browser-req-${previewCounter}`,
        taskId,
        url,
        policy,
        policyReason: reason,
        requestedAt: Date.now(),
      };

      if (policy !== "blocked_external") {
        sessionCounter++;
        const session: BrowserPreviewSession = {
          id: `fixture-browser-session-${sessionCounter}`,
          requestId: request.id,
          url,
          displayUrl: url,
          status: "active",
          policy,
          blockedReason: null,
          artifactId: null,
          createdAt: Date.now(),
          completedAt: null,
        };
        sessions.set(request.id, session);
      }

      return request;
    },

    getSession(requestId: string): BrowserPreviewSession | null {
      return sessions.get(requestId) ?? null;
    },

    createArtifact(): PreviewArtifact {
      return {
        id: `fixture-artifact-${Date.now()}`,
        kind: "browser_snapshot",
        source: "fixture-adapter",
        displayLabel: "Fixture Browser Preview",
        mimeType: "text/html",
        byteSize: 1024,
        capturedAt: Date.now(),
        redacted: false,
        thumbnailRef: null,
      };
    },
  };
}

let screenshotCounter = 0;

export interface FixtureScreenshotAdapter {
  requestCapture(scope: string, reason: string, taskId: string | null): ScreenshotCaptureRequest;
  captureResult(requestId: string, approved: boolean): ScreenshotCaptureResult;
}

export function createFixtureScreenshotAdapter(): FixtureScreenshotAdapter {
  return {
    requestCapture(scope: string, reason: string, taskId: string | null): ScreenshotCaptureRequest {
      screenshotCounter++;
      return {
        id: `fixture-screenshot-req-${screenshotCounter}`,
        taskId,
        scope,
        reason,
        permissionPrompt: `Allow screenshot capture for: ${reason}`,
        requestedAt: Date.now(),
      };
    },

    captureResult(requestId: string, approved: boolean): ScreenshotCaptureResult {
      const metadata: ScreenshotMetadata = {
        captureTime: Date.now(),
        width: approved ? 1920 : 0,
        height: approved ? 1080 : 0,
        mimeType: "image/png",
        byteSize: approved ? 256000 : 0,
        redacted: true,
        redactionSummary: { replacedSecrets: 0, replacedWindowsPaths: 0 },
      };

      return {
        id: `fixture-screenshot-result-${Date.now()}`,
        requestId,
        status: approved ? "completed" : "denied",
        artifactId: approved ? `fixture-artifact-${Date.now()}` : null,
        metadata,
        blockedReason: approved ? null : "User denied screenshot capture request",
        createdAt: Date.now(),
      };
    },
  };
}
