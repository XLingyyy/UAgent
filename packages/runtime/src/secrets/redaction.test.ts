import { describe, it, expect } from "vitest";
import { redactSecret, redactErrorMessage, createRedactedString, redactString, recursiveRedactValue } from "./redaction.js";

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

describe("redactString", () => {
  it("redacts api_key with sk- value", () => {
    const input = 'api_key=sk-abcdefghijklmnopqrstuvwxyz123456';
    const result = redactString(input);
    expect(result).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
    expect(result).toContain('[REDACTED]');
  });

  it("redacts Authorization Bearer token", () => {
    const input = 'Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz123456';
    const result = redactString(input);
    expect(result).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
    expect(result).toBe('Authorization: Bearer [REDACTED]');
  });

  it("redacts token= with hex value", () => {
    const input = 'token=abcdef1234567890abcdef1234567890';
    const result = redactString(input);
    expect(result).not.toContain('abcdef1234567890abcdef1234567890');
    expect(result).toContain('[REDACTED]');
  });

  it("redacts password= pattern", () => {
    const input = 'password=super_secret_12345';
    const result = redactString(input);
    expect(result).not.toContain('super_secret_12345');
    expect(result).toContain('[REDACTED]');
  });

  it("redacts secret= pattern", () => {
    const input = 'secret=my_deep_dark_secret';
    const result = redactString(input);
    expect(result).not.toContain('my_deep_dark_secret');
    expect(result).toContain('[REDACTED]');
  });

  it("leaves normal text unchanged", () => {
    const input = 'Hello, this is a normal message';
    expect(redactString(input)).toBe(input);
  });
});

describe("recursiveRedactValue", () => {
  it("redacts string values in nested objects", () => {
    const input = {
      title: 'api_key=sk-abcdefghijklmnopqrstuvwxyz123456',
      inner: {
        token: 'token=abcdef1234567890abcdef1234567890',
        safe: 'hello',
      },
    };
    const result = recursiveRedactValue(input) as Record<string, unknown>;
    expect(result.title as string).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
    expect((result.inner as Record<string, unknown>).token as string).not.toContain('abcdef1234567890abcdef1234567890');
    expect((result.inner as Record<string, unknown>).safe as string).toBe('hello');
  });

  it("redacts string values in arrays", () => {
    const input = [
      'safe text',
      'Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz123456',
      { nested: 'token=abcdef1234567890abcdef1234567890' },
    ];
    const result = recursiveRedactValue(input) as unknown[];
    expect(result[0] as string).toBe('safe text');
    expect(result[1] as string).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
    expect((result[2] as Record<string, unknown>).nested as string).not.toContain('abcdef1234567890abcdef1234567890');
  });

  it("preserves non-string primitives", () => {
    const input = { num: 42, bool: true, nil: null };
    const result = recursiveRedactValue(input) as Record<string, unknown>;
    expect(result.num).toBe(42);
    expect(result.bool).toBe(true);
    expect(result.nil).toBeNull();
  });

  it("handles array of primitives safely", () => {
    const input = [1, true, null, 'api_key=sk-abcdefghijklmnopqrstuvwxyz123456'];
    const result = recursiveRedactValue(input) as unknown[];
    expect(result[0]).toBe(1);
    expect(result[1]).toBe(true);
    expect(result[2]).toBeNull();
    expect(result[3] as string).toContain('[REDACTED]');
  });

  it("redacts C:/Users/ windows home paths from strings", () => {
    const result = redactString('Path: C:/Users/Dev/LyraStarter/Config');
    expect(result).not.toContain('C:/Users/Dev');
    expect(result).toContain('C:/Users/[user-home]');
  });

  it("redacts /Users/ macOS home paths from strings", () => {
    const result = redactString('Path: /Users/alice/project/file.ini');
    expect(result).not.toContain('/Users/alice');
    expect(result).toContain('/Users/[user-home]');
  });

  it("redacts /home/ linux home paths from strings", () => {
    const result = redactString('Path: /home/bob/dev/project/config.ini');
    expect(result).not.toContain('/home/bob');
    expect(result).toContain('/home/[user-home]');
  });

  it("redacts paths in nested recursiveRedactValue objects", () => {
    const input = {
      title: 'Home is C:/Users/Dev/LyraStarter',
      config: { iniPath: '/Users/alice/project/config.ini' },
    };
    const result = recursiveRedactValue(input) as Record<string, unknown>;
    expect(result.title as string).not.toContain('C:/Users/Dev');
    expect(result.title as string).toContain('[user-home]');
    expect((result.config as Record<string, unknown>).iniPath as string).not.toContain('/Users/alice');
    expect((result.config as Record<string, unknown>).iniPath as string).toContain('[user-home]');
  });

  it("redacts both secrets and paths in the same string", () => {
    const result = redactString('api_key=sk-abcdefghijklmnopqrstuvwxyz123456 at C:/Users/Dev/file.ini');
    expect(result).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
    expect(result).not.toContain('C:/Users/Dev');
    expect(result).toContain('[REDACTED]');
    expect(result).toContain('[user-home]');
  });
});
