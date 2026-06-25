import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import { MainLayout } from "./MainLayout";
import { UIProvider } from "../app/providers";

function renderMainLayout(initialOpen?: boolean) {
  return render(
    <UIProvider
      initialState={
        initialOpen === undefined ? undefined : { layout: { inspector: { open: initialOpen } } }
      }
    >
      <MainLayout />
    </UIProvider>,
  );
}

function createMatchMediaMock(matches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql: MediaQueryList = {
    matches,
    media: "(max-width: 899px)",
    onchange: null,
    addEventListener: (_type: string, listener: EventListener) => {
      listeners.add(listener as (e: MediaQueryListEvent) => void);
    },
    removeEventListener: (_type: string, listener: EventListener) => {
      listeners.delete(listener as (e: MediaQueryListEvent) => void);
    },
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };

  const fireChange = (newMatches: boolean) => {
    const event = new Event("change") as MediaQueryListEvent;
    Object.defineProperty(event, "matches", { value: newMatches });
    listeners.forEach((fn) => fn(event));
  };

  return { mql, fireChange };
}

describe("MainLayout", () => {
  describe("layout state attribute", () => {
    it("defaults to data-inspector-state='closed'", () => {
      const { container } = renderMainLayout();
      const layout = container.querySelector(".ua-main-layout");
      expect(layout?.getAttribute("data-inspector-state")).toBe("closed");
    });

    it("exposes data-inspector-state='open' when inspector is open", () => {
      const { container } = renderMainLayout(true);
      const layout = container.querySelector(".ua-main-layout");
      expect(layout?.getAttribute("data-inspector-state")).toBe("open");
    });

    it("exposes data-inspector-state='closed' when inspector is closed", () => {
      const { container } = renderMainLayout(false);
      const layout = container.querySelector(".ua-main-layout");
      expect(layout?.getAttribute("data-inspector-state")).toBe("closed");
    });

    it("exposes data-utility-pane-state in sync with inspector state", () => {
      const { container } = renderMainLayout(true);
      const layout = container.querySelector(".ua-main-layout");
      expect(layout?.getAttribute("data-utility-pane-state")).toBe("open");
    });
  });

  describe("inspector pane data-state", () => {
    it("renders InspectorPane with data-state='closed' by default", () => {
      const { container } = renderMainLayout();
      const inspector = container.querySelector(".ua-inspector");
      expect(inspector?.getAttribute("data-state")).toBe("closed");
    });

    it("marks the inspector pane as a motion panel", () => {
      const { container } = renderMainLayout(true);
      const inspector = container.querySelector(".ua-inspector");
      expect(inspector?.getAttribute("data-motion")).toBe("panel");
    });

    it("renders InspectorPane with data-state='closed' when closed", () => {
      const { container } = renderMainLayout(false);
      const inspector = container.querySelector(".ua-inspector");
      expect(inspector?.getAttribute("data-state")).toBe("closed");
    });
  });

  describe("narrow screen auto-collapse", () => {
    let originalMatchMedia: typeof window.matchMedia;

    beforeEach(() => {
      originalMatchMedia = window.matchMedia;
    });

    afterEach(() => {
      window.matchMedia = originalMatchMedia;
    });

    it("auto-closes inspector on mount when viewport is narrow", async () => {
      const { mql } = createMatchMediaMock(true);
      window.matchMedia = vi.fn(() => mql);

      const { container } = renderMainLayout(true);
      const layout = container.querySelector(".ua-main-layout");
      await waitFor(() => {
        expect(layout?.getAttribute("data-inspector-state")).toBe("closed");
      });
    });

    it("keeps inspector open on mount when viewport is wide", async () => {
      const { mql } = createMatchMediaMock(false);
      window.matchMedia = vi.fn(() => mql);

      const { container } = renderMainLayout(true);
      const layout = container.querySelector(".ua-main-layout");
      await waitFor(() => {
        expect(layout?.getAttribute("data-inspector-state")).toBe("open");
      });
    });

    it("auto-closes inspector when viewport resizes from wide to narrow", async () => {
      const { mql, fireChange } = createMatchMediaMock(false);
      window.matchMedia = vi.fn(() => mql);

      const { container } = renderMainLayout(true);
      const layout = container.querySelector(".ua-main-layout");
      await waitFor(() => {
        expect(layout?.getAttribute("data-inspector-state")).toBe("open");
      });

      act(() => {
        fireChange(true);
      });
      await waitFor(() => {
        expect(layout?.getAttribute("data-inspector-state")).toBe("closed");
      });
    });

    it("stays open when viewport stays wide", () => {
      const { mql } = createMatchMediaMock(false);
      window.matchMedia = vi.fn(() => mql);

      const { container } = renderMainLayout(true);
      const layout = container.querySelector(".ua-main-layout");
      expect(layout?.getAttribute("data-inspector-state")).toBe("open");
    });
  });

  describe("forbidden content", () => {
    it("does not render microphone, voice, or record controls", () => {
      const { container } = renderMainLayout();
      const audioControls = container.querySelectorAll(
        '[aria-label*="mic" i], [aria-label*="voice" i], [aria-label*="record" i]',
      );
      expect(audioControls.length).toBe(0);
    });
  });
});
