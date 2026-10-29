import { describe, expect, it } from "vitest";
import { ToolCallAccumulator } from "./tool-call-stream.js";

describe("structured tool-call stream", () => {
  it("preserves long IDs and joins exact argument bytes", () => {
    const acc = new ToolCallAccumulator();
    const id = "call_identifier_that_must_never_be_redacted_0123456789";
    expect(
      acc.push({ index: 0, id, name: "project_read_file", argumentsDelta: '{"path":"Sour' })
        .started,
    ).toBe(true);
    acc.push({ index: 0, argumentsDelta: 'ce/Main.cpp"}' });
    expect(acc.finish("tool_calls")).toEqual([
      { id, name: "project_read_file", arguments: '{"path":"Source/Main.cpp"}' },
    ]);
  });
  it.each([
    [
      { index: 0, id: "same", name: "read", argumentsDelta: "{}" },
      { index: 1, id: "same", name: "read", argumentsDelta: "{}" },
    ],
    [
      { index: 0, id: "first", name: "read", argumentsDelta: "{" },
      { index: 0, id: "changed", argumentsDelta: "}" },
    ],
    [
      { index: 0, id: "first", name: "read", argumentsDelta: "{" },
      { index: 0, name: "write", argumentsDelta: "}" },
    ],
  ])("rejects duplicate IDs and identity changes", (first, second) => {
    const acc = new ToolCallAccumulator();
    acc.push(first);
    expect(() => acc.push(second)).toThrow();
  });
  it.each(['{"path":', "[]", "null", '"text"'])(
    "rejects unfinished/non-object arguments: %s",
    (argumentsDelta) => {
      const acc = new ToolCallAccumulator();
      acc.push({ index: 0, id: "id", name: "read", argumentsDelta });
      expect(() => acc.finish("tool_calls")).toThrow();
    },
  );
  it("does not turn truncated tools or a natural stop into executable calls", () => {
    const acc = new ToolCallAccumulator();
    acc.push({ index: 0, id: "id", name: "read", argumentsDelta: "{}" });
    expect(() => acc.finish("length")).toThrow();
    expect(() => acc.finish("stop")).toThrow();
    expect(() => new ToolCallAccumulator().finish("tool_calls")).toThrow();
  });
  it("rejects missing indices and oversized argument streams", () => {
    const acc = new ToolCallAccumulator();
    acc.push({ index: 1, id: "id", name: "read", argumentsDelta: "{}" });
    expect(() => acc.finish("tool_calls")).toThrow();
    expect(() =>
      new ToolCallAccumulator().push({
        index: 0,
        id: "id",
        name: "read",
        argumentsDelta: " ".repeat(16385),
      }),
    ).toThrow();
  });
});
