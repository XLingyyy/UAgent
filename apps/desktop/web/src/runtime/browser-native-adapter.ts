import type {
  BrowserPreviewCapabilityStatus,
  BrowserPreviewResult,
} from "@uagent/shared";
import { resolveTrustedNativeRootRef, type NativeInvoke } from "./project-native-adapter";

type NativeCapabilityResult = {
  enabled?: boolean;
  mode?: "native" | "fixture" | "disabled";
  reason?: string | null;
  localhostAllowed?: boolean;
  localhost_allowed?: boolean;
  loopbackAllowed?: boolean;
  loopback_allowed?: boolean;
  fileAllowed?: boolean;
  file_allowed?: boolean;
  externalBlocked?: boolean;
  external_blocked?: boolean;
};

export interface BrowserNativeAdapter {
  getCapability: () => BrowserPreviewCapabilityStatus;
  refreshCapability: () => Promise<BrowserPreviewCapabilityStatus>;
  classifyUrl: (url: string, rootRef?: string) => Promise<BrowserPreviewResult>;
  openPreview: (url: string, sessionId: string, rootRef?: string) => Promise<string>;
}

function getGlobalInvoke(): NativeInvoke | null {
  const tauriInternals = (globalThis as { __TAURI_INTERNALS__?: { invoke?: NativeInvoke } })
    .__TAURI_INTERNALS__;
  return tauriInternals?.invoke ?? null;
}

const DEFAULT_BROWSER_CAPABILITY: BrowserPreviewCapabilityStatus = {
  enabled: false,
  mode: "disabled",
  reason: "native_capability_status_pending",
  localhostAllowed: true,
  loopbackAllowed: true,
  fileAllowed: true,
  externalBlocked: true,
};

function normalizeCapability(raw: NativeCapabilityResult): BrowserPreviewCapabilityStatus {
  const enabled = Boolean(raw.enabled);
  return {
    enabled,
    mode: raw.mode ?? (enabled ? "native" : "disabled"),
    reason: raw.reason ?? (enabled ? null : "feature_disabled"),
    localhostAllowed: raw.localhostAllowed ?? raw.localhost_allowed ?? true,
    loopbackAllowed: raw.loopbackAllowed ?? raw.loopback_allowed ?? true,
    fileAllowed: raw.fileAllowed ?? raw.file_allowed ?? true,
    externalBlocked: raw.externalBlocked ?? raw.external_blocked ?? true,
  };
}

export function createDesktopBrowserAdapter(invoke: NativeInvoke): BrowserNativeAdapter {
  let capability = DEFAULT_BROWSER_CAPABILITY;

  return {
    getCapability() {
      return capability;
    },

    async refreshCapability(): Promise<BrowserPreviewCapabilityStatus> {
      try {
        const raw = await invoke<NativeCapabilityResult>("browser_capability_status");
        capability = normalizeCapability(raw);
      } catch {
        capability = {
          ...DEFAULT_BROWSER_CAPABILITY,
          reason: "native_capability_status_unavailable",
        };
      }
      return capability;
    },

    async classifyUrl(url: string, rootRef?: string): Promise<BrowserPreviewResult> {
      const resolvedRootRef = resolveTrustedNativeRootRef(rootRef) ?? rootRef;
      const raw = await invoke<BrowserPreviewResult>("browser_preview", {
        input: { url, taskId: null, rootRef: resolvedRootRef ?? null },
      });
      return raw;
    },

    async openPreview(url: string, sessionId: string, rootRef?: string): Promise<string> {
      const resolvedRootRef = resolveTrustedNativeRootRef(rootRef) ?? rootRef;
      const result = await invoke<{ windowId: string; status: string }>("open_browser_preview", {
        input: { url, sessionId, rootRef: resolvedRootRef ?? null },
      });
      return result.windowId;
    },
  };
}

export function createDesktopBrowserAdapterFromEnvironment(
  invoke: NativeInvoke | null = getGlobalInvoke(),
): BrowserNativeAdapter | null {
  return invoke ? createDesktopBrowserAdapter(invoke) : null;
}
