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
