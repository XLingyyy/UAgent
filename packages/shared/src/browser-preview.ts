export interface BrowserPreviewCapabilityStatus {
  enabled: boolean;
  mode: "native" | "fixture" | "disabled";
  reason: string | null;
  localhostAllowed: boolean;
  loopbackAllowed: boolean;
  fileAllowed: boolean;
  externalBlocked: boolean;
}

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

export interface BrowserPreviewTargetSummary {
  targetId: string;
  displayTarget: string;
  policy: BrowserPreviewUrlPolicy;
  blocked: boolean;
  reason: string;
  needsTrustedRoot: boolean;
}

export interface BrowserPreviewRequest {
  id: string;
  taskId: string | null;
  url: string;
  targetId: string;
  displayTarget: string;
  target: BrowserPreviewTargetSummary;
  policy: BrowserPreviewUrlPolicy;
  policyReason: string;
  requestedAt: number;
}

export interface BrowserPreviewSession {
  id: string;
  requestId: string;
  url: string;
  displayUrl: string;
  targetId: string;
  displayTarget: string;
  target: BrowserPreviewTargetSummary;
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

export interface BrowserPreviewResult {
  sessionId: string;
  session_id: string;
  url: string;
  targetId?: string;
  target_id?: string;
  policy: string;
  blocked: boolean;
  reason: string;
  displayTarget?: string | null;
  display_target?: string | null;
  displayUrl: string | null;
  display_url: string | null;
  needsTrustedRoot: boolean;
  needs_trusted_root: boolean;
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
