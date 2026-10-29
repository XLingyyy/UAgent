import type { ProviderRuntimeErrorCode } from "@uagent/shared";

export class MessagesError extends Error {
  constructor(readonly code: ProviderRuntimeErrorCode = "malformed_response") {
    super("Anthropic Messages request failed.");
  }
}
export const invalid = (): never => {
  throw new MessagesError();
};
export const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
export const token = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function containsCredential(value: unknown, key: string): boolean {
  if (!key) return false;
  const pending = [value],
    seen = new Set<object>();
  while (pending.length) {
    const next = pending.pop();
    if (typeof next === "string") {
      if (next.includes(key)) return true;
    } else if (next && typeof next === "object" && !seen.has(next)) {
      seen.add(next);
      for (const [name, child] of Object.entries(next)) {
        if (name.includes(key)) return true;
        pending.push(child);
      }
    }
  }
  return false;
}
export function rejectEcho(value: unknown, key: string) {
  if (containsCredential(value, key)) invalid();
}
/** Exactly one protocol-defined JSON parse. Nested JSON-looking strings stay strings. */
export function argumentsObject(text: unknown): Record<string, unknown> {
  if (typeof text !== "string") return invalid();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return invalid();
  }
  if (!object(value)) return invalid();
  return value;
}
