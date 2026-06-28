import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UIProvider } from "../app/providers";
import { BrowserPanel } from "./BrowserPanel";
import { ScreenshotPanel } from "./ScreenshotPanel";
import { WatcherPanel } from "./WatcherPanel";

function renderWithUI(component: React.ReactElement) {
  return render(<UIProvider>{component}</UIProvider>);
}

describe("BrowserPanel", () => {
  it("renders URL input", () => {
    renderWithUI(<BrowserPanel />);
    expect(screen.getByLabelText("URL input")).toBeTruthy();
    expect(screen.getByLabelText("Preview URL")).toBeTruthy();
  });

  it("classifies local URL as allowed and shows active", () => {
    renderWithUI(<BrowserPanel />);
    const input = screen.getByLabelText("URL input");
    fireEvent.change(input, {
      target: { value: "http://localhost:3000/test" },
    });
    fireEvent.click(screen.getByLabelText("Preview URL"));
    expect(screen.getByText(/local_only/)).toBeTruthy();
    expect(screen.getByText(/active/)).toBeTruthy();
  });

  it("blocks external URL and shows reason", () => {
    renderWithUI(<BrowserPanel />);
    const input = screen.getByLabelText("URL input");
    fireEvent.change(input, {
      target: { value: "https://external-site.com" },
    });
    fireEvent.click(screen.getByLabelText("Preview URL"));
    expect(screen.getByText("blocked_external")).toBeTruthy();
    expect(screen.getByLabelText("Clear blocked URL")).toBeTruthy();
  });

  it("does not auto-navigate on mount", () => {
    renderWithUI(<BrowserPanel />);
    expect(screen.getByText(/Enter a local URL/)).toBeTruthy();
    expect(screen.queryByLabelText("Launch Preview")).toBeNull();
  });
});

describe("ScreenshotPanel", () => {
  it("requests capture and shows pending state", () => {
    renderWithUI(<ScreenshotPanel />);
    fireEvent.click(screen.getByLabelText("Request screenshot capture"));
    expect(screen.getByText(/Capture requires approval/)).toBeTruthy();
    expect(screen.getByText("Approve")).toBeTruthy();
    expect(screen.getByText("Deny")).toBeTruthy();
  });

  it("creates artifact on approve", () => {
    renderWithUI(<ScreenshotPanel />);
    fireEvent.click(screen.getByLabelText("Request screenshot capture"));
    fireEvent.click(screen.getByLabelText("Approve screenshot capture"));
    expect(screen.getByText("Capture completed")).toBeTruthy();
    expect(screen.getByText(/1920x1080/)).toBeTruthy();
    expect(screen.getByText(/image\/png/)).toBeTruthy();
  });

  it("blocks artifact on deny", () => {
    renderWithUI(<ScreenshotPanel />);
    fireEvent.click(screen.getByLabelText("Request screenshot capture"));
    fireEvent.click(screen.getByLabelText("Deny screenshot capture"));
    expect(screen.getByText("Capture denied")).toBeTruthy();
    expect(screen.getByText(/User denied screenshot capture request/)).toBeTruthy();
  });

  it("does not auto-capture on mount", () => {
    renderWithUI(<ScreenshotPanel />);
    expect(screen.getByText(/No active capture/)).toBeTruthy();
    expect(screen.queryByText("Approve")).toBeNull();
    expect(screen.queryByText("Deny")).toBeNull();
  });
});

describe("WatcherPanel", () => {
  it("starts session and shows active state", () => {
    renderWithUI(<WatcherPanel />);
    fireEvent.click(screen.getByLabelText("Start watching project root"));
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByLabelText("Generate change events")).toBeTruthy();
    expect(screen.getByLabelText("Stop watching project root")).toBeTruthy();
  });

  it("generates change events when active", () => {
    renderWithUI(<WatcherPanel />);
    fireEvent.click(screen.getByLabelText("Start watching project root"));
    fireEvent.click(screen.getByLabelText("Generate change events"));
    expect(screen.getByText(/Change Events/)).toBeTruthy();
  });

  it("computes diff from generated events", () => {
    renderWithUI(<WatcherPanel />);
    fireEvent.click(screen.getByLabelText("Start watching project root"));
    fireEvent.click(screen.getByLabelText("Generate change events"));
    fireEvent.click(screen.getByLabelText("Compute diff"));
    expect(screen.getByText("Diff Summary")).toBeTruthy();
  });

  it("stops session and shows stopped state", () => {
    renderWithUI(<WatcherPanel />);
    fireEvent.click(screen.getByLabelText("Start watching project root"));
    fireEvent.click(screen.getByLabelText("Stop watching project root"));
    expect(screen.getByText("Stopped")).toBeTruthy();
  });

  it("does not auto-scan on mount", () => {
    renderWithUI(<WatcherPanel />);
    expect(screen.getByText("Idle")).toBeTruthy();
    expect(screen.queryByLabelText("Generate change events")).toBeNull();
    expect(screen.queryByLabelText("Compute diff")).toBeNull();
  });
});
