import type {
  BrowserPreviewCapabilityStatus,
  BrowserPreviewRequest,
  BrowserPreviewResult,
  BrowserPreviewSession,
  BrowserPreviewTargetSummary,
  BrowserPreviewUrlPolicy,
  ScreenshotCaptureRequest,
  ScreenshotCaptureResult,
  ScreenshotMetadata,
  PreviewArtifact,
} from "@uagent/shared";

export function classifyBrowserUrl(
  url: string,
  allowedLocalPatterns: string[],
  options: { requireTrustedRootForFile?: boolean } = {},
): { policy: BrowserPreviewUrlPolicy; reason: string } {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      return {
        policy: "blocked_external",
        reason: "URL userinfo is blocked by browser preview policy",
      };
    }
    if (parsed.protocol === "file:" && options.requireTrustedRootForFile) {
      return {
        policy: "blocked_external",
        reason: "file:// preview requires an explicit trusted root",
      };
    }
    if (parsed.protocol === "file:" && allowedLocalPatterns.includes("file://")) {
      return { policy: "local_only", reason: "URL matches allowed local file pattern" };
    }
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      const host = parsed.hostname.toLowerCase();
      if (
        (host === "localhost" && allowedLocalPatterns.includes(`${parsed.protocol}//localhost`)) ||
        (host === "127.0.0.1" && allowedLocalPatterns.includes(`${parsed.protocol}//127.0.0.1`))
      ) {
        return { policy: "local_only", reason: "URL matches allowed local host policy" };
      }
    }
  } catch {
    return {
      policy: "blocked_external",
      reason: "Malformed URL blocked by browser preview policy",
    };
  }
  return {
    policy: "blocked_external",
    reason: "External URL blocked by default policy; requires user approval",
  };
}

function hashTarget(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return `browser-target:${Math.abs(hash).toString(16)}`;
}

export function displayBrowserTarget(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") {
      const parts = decodeURIComponent(parsed.pathname).split(/[/\\]/).filter(Boolean);
      return `[local file] ${parts.pop() ?? "file"}`;
    }
    if (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    ) {
      return `${parsed.protocol}//${parsed.host}`;
    }
    return "[blocked external]";
  } catch {
    return "[blocked target]";
  }
}

export function summarizeBrowserTarget(
  url: string,
  policy: BrowserPreviewUrlPolicy,
  reason: string,
  blocked = policy === "blocked_external",
  needsTrustedRoot = false,
): BrowserPreviewTargetSummary {
  const displayTarget = displayBrowserTarget(url);
  return {
    targetId: hashTarget(`${displayTarget}:${policy}:${reason}`),
    displayTarget,
    policy,
    blocked,
    reason,
    needsTrustedRoot,
  };
}

export interface FixtureBrowserPreviewAdapter {
  requestPreview(url: string, taskId: string | null): BrowserPreviewRequest;
  getSession(requestId: string): BrowserPreviewSession | null;
  createArtifact(sessionId: string): PreviewArtifact;
}

export interface NativeBrowserAdapter {
  getCapability(): BrowserPreviewCapabilityStatus;
  refreshCapability(): Promise<BrowserPreviewCapabilityStatus>;
  classifyUrl(url: string, rootRef?: string): Promise<BrowserPreviewResult>;
  openPreview(url: string, sessionId: string, rootRef?: string): Promise<string>;
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
      const target = summarizeBrowserTarget(url, policy, reason);
      const request: BrowserPreviewRequest = {
        id: `fixture-browser-req-${previewCounter}`,
        taskId,
        url,
        targetId: target.targetId,
        displayTarget: target.displayTarget,
        target,
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
          displayUrl: target.displayTarget,
          targetId: target.targetId,
          displayTarget: target.displayTarget,
          target,
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
