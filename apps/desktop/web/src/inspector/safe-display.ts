/** Apply to visible text and accessible labels; never put raw values in titles/data attributes. */
export function safeDisplay(value: unknown): string {
  return String(value ?? "not recorded")
    .replace(/\b(?:Bearer\s+|(?:api[_-]?key|password|secret|token|session(?:Id)?|pid(?:Hash)?|root(?:Id)?)\s*[:=]\s*)[^\s,;]+/gi, "[redacted]")
    .replace(/\bsk-[\w-]+/g, "[redacted]")
    .replace(/\b[A-Za-z]:[\\/][^\r\n,;]*/g, "[local path]")
    .replace(/\\\\[^\s,;]+/g, "[local path]")
    .replace(/\/(?:Users|home|tmp|private|mnt)\/[^\s,;]+/g, "[local path]")
    .replace(/\b(?:editor-session|session|pid|root|token):[^\s,;]+/gi, "[redacted identity]");
}
