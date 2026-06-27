import { describe, it, expect } from "vitest";
import { redactSecret, redactErrorMessage, createRedactedString } from "./redaction.js";

describe("redactSecret", () => {
  it("redacts long secret showing only first 4 chars", () => {
    const result = redactSecret("sk-test1234567890abcdef");
    expect(result).toBe("sk-t*******************");
    expect(result.startsWith("sk-t")).toBe(true);
    expect(result).not.toContain("1234567890");
  });

  it("returns short value unchanged", () => {
    expect(redactSecret("abc")).toBe("abc");
  });

  it("handles empty string", () => {
    expect(redactSecret("")).toBe("");
  });
});

describe("redactErrorMessage", () => {
  it("redacts sk- prefixed API keys in messages", () => {
    const msg = "Invalid API key: sk-test1234567890abcdef";
    const result = redactErrorMessage(msg);
    expect(result).not.toContain("sk-test1234567890abcdef");
    expect(result).toContain("sk-t");
    expect(result).toContain("***");
  });

  it("redacts Authorization header Bearer tokens", () => {
    const msg = "Authorization: Bearer sk-test-token-here";
    const result = redactErrorMessage(msg);
    expect(result).toContain("Bearer [REDACTED]");
    expect(result).not.toContain("sk-test-token-here");
  });

  it("redacts api_key parameters", () => {
    const msg = "api_key=sk-test-key-value";
    const result = redactErrorMessage(msg);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("sk-test-key-value");
  });
});

describe("createRedactedString", () => {
  it("creates redacted label", () => {
    expect(createRedactedString("API Key")).toBe("API Key [REDACTED]");
  });
});
