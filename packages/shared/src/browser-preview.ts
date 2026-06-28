export type BrowserPreviewUrlPolicy =
  | "local_only"
  | "approved_external"
  | "blocked_external";

export type BrowserPreviewStatus =
  | "pending"
  | "blocked"
  | "active"
  | "completed"
  | "failed";

export interface BrowserPreviewRequest {
  id: string;
  taskId: string | null;
  url: string;
  policy: BrowserPreviewUrlPolicy;
  policyReason: string;
  requestedAt: number;
}

export interface BrowserPreviewSession {
  id: string;
  requestId: string;
  url: string;
  displayUrl: string;
  status: BrowserPreviewStatus;
  policy: BrowserPreviewUrlPolicy;
  blockedReason: string | null;
  artifactId: string | null;
  createdAt: number;
  completedAt: number | null;
}

export type ScreenshotCaptureStatus =
  | "pending"
  | "requires_approval"
  | "approved"
  | "denied"
  | "capturing"
  | "completed"
  | "failed";

export interface ScreenshotCaptureRequest {
  id: string;
  taskId: string | null;
  scope: string;
  reason: string;
  permissionPrompt: string;
  requestedAt: number;
}

export interface ScreenshotCaptureResult {
  id: string;
  requestId: string;
  status: ScreenshotCaptureStatus;
  artifactId: string | null;
  metadata: ScreenshotMetadata;
  blockedReason: string | null;
  createdAt: number;
}

export interface ScreenshotMetadata {
  captureTime: number;
  width: number;
  height: number;
  mimeType: string;
  byteSize: number;
  redacted: boolean;
  redactionSummary: { replacedSecrets: number; replacedWindowsPaths: number };
}

export interface PreviewArtifact {
  id: string;
  kind: "browser_snapshot" | "screenshot";
  source: string;
  displayLabel: string;
  mimeType: string;
  byteSize: number;
  capturedAt: number;
  redacted: boolean;
  thumbnailRef: string | null;
}

export type BrowserScreenshotAction =
  | { type: "browser_request"; request: BrowserPreviewRequest }
  | { type: "browser_blocked"; sessionId: string; reason: string }
  | { type: "browser_started"; session: BrowserPreviewSession }
  | { type: "browser_completed"; sessionId: string; artifactId: string }
  | { type: "browser_failed"; sessionId: string; error: string }
  | { type: "screenshot_request"; request: ScreenshotCaptureRequest }
  | { type: "screenshot_denied"; requestId: string; reason: string }
  | { type: "screenshot_captured"; result: ScreenshotCaptureResult }
  | { type: "screenshot_failed"; requestId: string; error: string };
