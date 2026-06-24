import { describe, it, expect } from "vitest";
import type { ChatMessage, PlanItem, ToolCall, Evidence } from "./index.js";

describe("@uagent/shared types", () => {
  it("should match ChatMessage shape", () => {
    const msg: ChatMessage = {
      id: "1",
      role: "user",
      content: "hello",
      timestamp: Date.now(),
    };
    expect(msg.role).toBe("user");
  });

  it("should match PlanItem shape", () => {
    const item: PlanItem = {
      id: "1",
      status: "pending",
      title: "test",
      description: "a test item",
      parentId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(item.status).toBe("pending");
  });

  it("should match ToolCall shape", () => {
    const call: ToolCall = {
      id: "1",
      toolName: "test",
      args: {},
      status: "pending",
      startedAt: Date.now(),
      finishedAt: null,
      result: null,
      error: null,
    };
    expect(call.toolName).toBe("test");
  });

  it("should match Evidence shape", () => {
    const ev: Evidence = {
      id: "1",
      type: "log",
      source: "test",
      data: "hello",
      capturedAt: Date.now(),
    };
    expect(ev.type).toBe("log");
  });
});
