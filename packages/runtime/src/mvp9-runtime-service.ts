import {
  type TerminalServiceState,
  type TerminalService,
  createTerminalService,
} from "./mvp9-terminal-service.js";
import {
  type BrowserServiceState,
  type BrowserService,
  createBrowserService,
} from "./mvp9-browser-service.js";
import {
  type ScreenshotServiceState,
  type ScreenshotService,
  createScreenshotService,
} from "./mvp9-screenshot-service.js";
import {
  type WatcherServiceState,
  type WatcherService,
  createWatcherService,
} from "./mvp9-watcher-service.js";
import { createAuditProjection, type AuditProjectionEngine } from "./audit-projection.js";
import { createSessionHistory, type SessionHistoryEngine } from "./session-history.js";

export interface Mvp9RuntimeState {
  terminal: TerminalServiceState;
  browser: BrowserServiceState;
  screenshot: ScreenshotServiceState;
  watcher: WatcherServiceState;
}

export interface Mvp9RuntimeService {
  getState(): Mvp9RuntimeState;
  terminal: TerminalService;
  browser: BrowserService;
  screenshot: ScreenshotService;
  watcher: WatcherService;
  subscribe(listener: (state: Mvp9RuntimeState) => void): () => void;
  getAuditEngine(): AuditProjectionEngine;
  getSessionEngine(): SessionHistoryEngine;
  replayTask(taskId: string): Mvp9RuntimeState;
}

export function createMvp9RuntimeService(): Mvp9RuntimeService {
  const auditEngine = createAuditProjection();
  const sessionEngine = createSessionHistory();
  const listeners = new Set<(state: Mvp9RuntimeState) => void>();

  const terminalService = createTerminalService(auditEngine, sessionEngine);
  const browserService = createBrowserService(auditEngine, sessionEngine);
  const screenshotService = createScreenshotService(auditEngine, sessionEngine);
  const watcherService = createWatcherService(auditEngine, sessionEngine);

  function getCombinedState(): Mvp9RuntimeState {
    return {
      terminal: terminalService.getState(),
      browser: browserService.getState(),
      screenshot: screenshotService.getState(),
      watcher: watcherService.getState(),
    };
  }

  function notify() {
    const state = getCombinedState();
    for (const listener of listeners) {
      listener(state);
    }
  }

  terminalService.subscribe(() => notify());
  browserService.subscribe(() => notify());
  screenshotService.subscribe(() => notify());
  watcherService.subscribe(() => notify());

  return {
    getState: getCombinedState,

    terminal: terminalService,
    browser: browserService,
    screenshot: screenshotService,
    watcher: watcherService,

    subscribe(listener: (state: Mvp9RuntimeState) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getAuditEngine() {
      return auditEngine;
    },

    getSessionEngine() {
      return sessionEngine;
    },

    replayTask(taskId: string): Mvp9RuntimeState {
      return {
        terminal: terminalService.replayTask(taskId),
        browser: browserService.replayTask(taskId),
        screenshot: screenshotService.replayTask(taskId),
        watcher: watcherService.replayTask(taskId),
      };
    },
  };
}
