import { redactPathsInString } from "./redaction.js";

export function redactProjectFile(text: string): { text: string; redacted: boolean } {
  const original = text;
  text = text.replace(
    /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z ]+ )?PRIVATE KEY-----|$)/g,
    "[REDACTED PRIVATE KEY]",
  );
  text = text
    .split("\n")
    .map((line) =>
      /["']?(?:api[_-]?key|authorization|password|secret|approval[_-]?token|execution[_-]?token)["']?\s*[:=]/i.test(
        line,
      )
        ? "[REDACTED SENSITIVE LINE]"
        : line,
    )
    .join("\n");
  text = text.replace(
    /\b(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g,
    "[REDACTED]",
  );
  text = text.replace(/https?:\/\/[^\s/]+:[^\s/@]+@[^\s]+/g, "[REDACTED CREDENTIAL URL]");
  text = redactPathsInString(text).replace(
    /[A-Za-z]:\\Users\\[^\\\s]+(?:\\[^\s]*)*/g,
    "[user-home]",
  );
  return { text, redacted: text !== original };
}
