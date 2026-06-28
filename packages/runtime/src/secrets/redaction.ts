const DEFAULT_VISIBLE_CHARS = 4;
const DEFAULT_MASK_CHAR = "*";
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/g,
  /sk-[A-Za-z0-9]{32,}/g,
  /[A-Za-z0-9_-]{20,}/g,
];

export function redactSecret(value: string, visibleChars: number = DEFAULT_VISIBLE_CHARS): string {
  if (!value || value.length <= visibleChars + 4) {
    return value;
  }
  const visible = value.slice(0, visibleChars);
  const masked = DEFAULT_MASK_CHAR.repeat(Math.min(value.length - visibleChars, 20));
  return `${visible}${masked}`;
}

export function redactErrorMessage(message: string): string {
  let result = message;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (match) => redactSecret(match, 4));
  }
  result = result.replace(/Authorization:\s*Bearer\s+\S+/gi, "Authorization: Bearer [REDACTED]");
  result = result.replace(/api[_-]?key[=:]\s*\S+/gi, (match) => {
    const prefix = match.split(/[=:]/)[0];
    return `${prefix}=[REDACTED]`;
  });
  return result;
}

export function createRedactedString(label: string): string {
  return `${label} [REDACTED]`;
}

export function redactString(text: string): string {
  let result = text;
  result = result.replace(/(Authorization:\s*Bearer\s+)\S+/gi, "$1[REDACTED]");
  result = result.replace(/(api[_-]?key\s*[=:]\s*)\S+/gi, "$1[REDACTED]");
  result = result.replace(/((?:\b|_)token\s*[=:]\s*)\S+/gi, "$1[REDACTED]");
  result = result.replace(/(password\s*[=:]\s*)\S+/gi, "$1[REDACTED]");
  result = result.replace(/(secret\s*[=:]\s*)\S+/gi, "$1[REDACTED]");
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  result = redactPathsInString(result);
  return result;
}

const PATH_PATTERNS = [
  /[A-Za-z]:\/Users\/[^/\s]+(?:\/[^\s]*)*/g,
  /\/Users\/[^/\s]+(?:\/[^\s]*)*/g,
  /\/home\/[^/\s]+(?:\/[^\s]*)*/g,
];

export function redactPathsInString(text: string): string {
  let result = text;
  for (const pattern of PATH_PATTERNS) {
    result = result.replace(pattern, (match) => {
      if (match.startsWith("C:/Users/") || match.startsWith("D:/Users/")) {
        return match.replace(/^([A-Za-z]:\/Users\/)([^/]+)/, "$1[user-home]");
      }
      if (match.startsWith("/Users/")) {
        return match.replace(/^(\/Users\/)([^/]+)/, "$1[user-home]");
      }
      if (match.startsWith("/home/")) {
        return match.replace(/^(\/home\/)([^/]+)/, "$1[user-home]");
      }
      return match;
    });
  }
  return result;
}

export function recursiveRedactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => recursiveRedactValue(item));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = recursiveRedactValue(val);
    }
    return result;
  }
  return value;
}

export function redactAuditTitle(title: string): string {
  return redactString(title);
}

export function redactAuditBody(body: string): string {
  return redactString(body);
}

export function redactAuditSummary(summary: string): string {
  return redactString(summary);
}
