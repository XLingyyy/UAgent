import type { UEBuildExecutionResult } from "./ue-build-profile.js";

export interface UEBuildDiagnosticOptions {
  projectRoot?: string;
  engineRoot?: string;
  /** Trusted native command cwd, never a path supplied by a log line. */
  diagnosticCwd?: string;
}

export type UEBuildDiagnosticStage = "uht" | "ubt" | "compiler" | "linker";
export interface UEBuildDiagnostic {
  id: string;
  severity: "error" | "warning" | "note";
  stage: UEBuildDiagnosticStage;
  code?: string;
  message: string;
  location?: {
    displayPath: string;
    projectRelativePath?: string;
    scope: "project" | "engine" | "external";
    line?: number;
    column?: number;
  };
  module?: string;
  symbol?: string;
  stream: "stdout" | "stderr";
  occurrences: number;
}

export interface UEBuildDiagnosticSummary {
  diagnostics: UEBuildDiagnostic[];
  errorCount: number;
  warningCount: number;
  truncated: boolean;
  /** Original local logs are held by the execution result, not duplicated in diagnostics. */
  rawOutputStored: false;
}

function slash(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/\/\?\//, "");
}

function hasControl(value: string): boolean {
  return [...value].some(
    (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
}

function relativeTo(path: string, root: string | undefined): string | undefined {
  if (!root) return undefined;
  const normalized = slash(root).replace(/\/+$/, "");
  if (path.toLowerCase().startsWith(`${normalized.toLowerCase()}/`))
    return path.slice(normalized.length + 1);
  return undefined;
}

/** Incremental parser: bounded memory, separate stdout/stderr tails, no I/O or authority. */
export class UEBuildDiagnosticParser {
  private tails = { stdout: "", stderr: "" };
  private dropping = { stdout: false, stderr: false };
  private stages: Record<"stdout" | "stderr", UEBuildDiagnosticStage> = {
    stdout: "ubt",
    stderr: "ubt",
  };
  private issues = new Map<string, UEBuildDiagnostic>();
  private truncated = false;
  private readonly limit: number;

  constructor(
    private readonly options: UEBuildDiagnosticOptions & { maxDiagnostics?: number } = {},
  ) {
    this.limit =
      Number.isInteger(options.maxDiagnostics) && (options.maxDiagnostics ?? 0) > 0
        ? Math.min(2_000, options.maxDiagnostics!)
        : 500;
  }

  push(chunk: string, stream: "stdout" | "stderr" = "stdout"): void {
    // A corrupt/malicious unbroken line must not retain arbitrarily large output.
    for (const segment of chunk.split(/(?<=\n)/)) {
      if (!segment) continue;
      if (!this.dropping[stream]) {
        const combined = this.tails[stream] + segment;
        if (combined.length > 65_536) {
          this.truncated = true;
          this.dropping[stream] = true;
          this.tails[stream] = "";
        } else {
          this.tails[stream] = combined;
        }
      }
      if (segment.endsWith("\n")) {
        if (!this.dropping[stream]) this.parseLine(this.tails[stream], stream);
        this.tails[stream] = "";
        this.dropping[stream] = false;
      }
    }
  }

  finish(): UEBuildDiagnosticSummary {
    for (const stream of ["stdout", "stderr"] as const) {
      if (this.tails[stream]) this.parseLine(this.tails[stream], stream);
      this.tails[stream] = "";
    }
    const diagnostics = [...this.issues.values()];
    return {
      diagnostics,
      errorCount: diagnostics.filter((issue) => issue.severity === "error").length,
      warningCount: diagnostics.filter((issue) => issue.severity === "warning").length,
      truncated: this.truncated,
      rawOutputStored: false,
    };
  }

  private redact(message: string): string {
    let value = slash(message);
    for (const [root, replacement] of [
      [this.options.projectRoot, "[project]"],
      [this.options.engineRoot, "[engine]"],
    ] as const) {
      if (root)
        value = value.replace(
          new RegExp(
            slash(root)
              .replace(/\/+$/, "")
              .replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?=/|$)",
            "gi",
          ),
          replacement,
        );
    }
    return value
      .replace(/(?:Authorization\s*:\s*)?Bearer\s+\S+/gi, "[redacted]")
      .replace(
        /sk-[\w-]+|(?:api[_-]?key|token|secret|password|Authorization)\s*[=:]\s*(?:"[^"]*"|'[^']*'|\S+)/gi,
        "[redacted]",
      )
      .replace(/(?:[A-Za-z]:\/Users\/[^\s:]+|\/(?:home|Users)\/[^\s:]+)/g, "[user-path]")
      .slice(0, 4_096);
  }

  private location(path: string, line?: string, column?: string): UEBuildDiagnostic["location"] {
    const normalized = slash(path.trim().replace(/^"|"$/g, ""));
    const absolute = /^(?:[A-Za-z]:\/|\/|\/\/)/.test(normalized);
    const parts = normalized.split("/");
    const relative =
      !absolute &&
      !normalized.includes(":") &&
      parts.every((part) => part !== ".." && part !== "." && part.length > 0)
        ? normalized
        : undefined;
    const safeRelative = (value: string | undefined): string | undefined =>
      value &&
      !hasControl(value) &&
      !value.includes(":") &&
      value.split("/").every((part) => part && part !== ".." && part !== ".")
        ? value
        : undefined;
    const cwd = this.options.diagnosticCwd
      ? slash(this.options.diagnosticCwd).replace(/\/+$/, "")
      : undefined;
    const trustedCwd =
      cwd &&
      /^(?:[A-Za-z]:\/|\/(?!\/))/.test(cwd) &&
      !hasControl(cwd) &&
      !cwd.split("/").some((part) => part === "." || part === "..");
    // An unknown relative base cannot establish a project or engine location.
    const resolved = absolute
      ? normalized
      : relative && trustedCwd
        ? `${cwd}/${relative}`
        : undefined;
    const project = resolved
      ? safeRelative(relativeTo(resolved, this.options.projectRoot))
      : undefined;
    const engine = resolved
      ? safeRelative(relativeTo(resolved, this.options.engineRoot))
      : undefined;
    const number = (value: string | undefined): number | undefined =>
      value && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : undefined;
    return {
      displayPath: project
        ? `[project]/${project}`
        : engine
          ? `[engine]/${engine}`
          : `[external]/${parts.at(-1) ?? "unknown"}`,
      ...(project ? { projectRelativePath: project } : {}),
      scope: project ? "project" : engine ? "engine" : "external",
      ...(number(line) ? { line: number(line) } : {}),
      ...(number(column) ? { column: number(column) } : {}),
    };
  }

  private parseLine(raw: string, stream: "stdout" | "stderr"): void {
    const text = raw
      // eslint-disable-next-line no-control-regex -- Compiler output contains literal ANSI escape introducers.
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/^\s*\d+>/, "")
      .trim();
    if (/UnrealHeaderTool|Parsing headers/i.test(text)) this.stages[stream] = "uht";
    if (
      /Reflection code generated|Building \d+ action|\[\d+\/\d+\]\s*(?:Compile|Link)|Using .*toolchain/i.test(
        text,
      )
    )
      this.stages[stream] = "compiler";
    let path: string | undefined;
    let line: string | undefined;
    let column: string | undefined;
    let severity: string | undefined;
    let code: string | undefined;
    let message: string | undefined;
    const msvc = text.match(
      /^(.+?)\((\d+)(?:,(\d+)(?:,\d+,\d+)?)?\)\s*:\s*(fatal error|error|warning|note)\s*([A-Za-z]+\d+)?\s*:\s*(.+)$/i,
    );
    const clang = text.match(
      /^(.+?):(\d+)(?::(\d+))?:\s*(fatal error|error|warning|note):\s*(.+)$/i,
    );
    const linker = text.match(/^(?:(.*?)\s*:\s*)?(fatal error|error|warning)\s+(LNK\d+):\s*(.+)$/i);
    const general = text.match(
      /^(?:(?:UnrealBuildTool|UnrealHeaderTool|LogCompile)\s*:\s*)?(error|warning|fatal error)\s*([A-Za-z]+\d+)?\s*:\s*(.+)$/i,
    );
    if (msvc) [, path, line, column, severity, code, message] = msvc;
    else if (clang) [, path, line, column, severity, message] = clang;
    else if (linker) {
      [, path, severity, code, message] = linker;
      if (path && /(?:^|[/\\])(?:link|lld-link)(?:\.exe)?$/i.test(path.replace(/^"|"$/g, "")))
        path = undefined;
    } else if (general) {
      severity = general[1];
      code = general[2];
      message = general[3];
    } else return;
    const safeMessage = this.redact(message ?? "");
    const location = path ? this.location(path, line, column) : undefined;
    let stage = this.stages[stream];
    if (code?.startsWith("LNK")) stage = "linker";
    else if (
      /\.cs$/i.test(path ?? "") ||
      /(?:instantiate|find|load) (?:module|rules)|module rules|build rules|UnrealBuildTool/i.test(
        text,
      )
    )
      stage = "ubt";
    else if (
      /UnrealHeaderTool|LogCompile|UHT\d+/.test(text) ||
      (msvc && !code && severity === "Error" && /\.h$/i.test(path ?? ""))
    )
      stage = "uht";
    else if (clang) stage = "compiler";
    else if (/^C\d+$/i.test(code ?? "")) stage = "compiler";
    const module =
      safeMessage.match(/(?:module|module rules|rules for)\s+["']([^"']+)["']/i)?.[1] ??
      path?.match(/(?:^|[/\\])Source[/\\]([^/\\]+)[/\\]/i)?.[1];
    const symbol =
      safeMessage.match(
        /(?:symbol|identifier|function|type|class|struct)\s+["']([^"']+)["']/i,
      )?.[1] ?? safeMessage.match(/^['"]([^'"]+)['"]\s*:/)?.[1];
    const issue: UEBuildDiagnostic = {
      id: "",
      severity: /error/i.test(severity ?? "")
        ? "error"
        : severity?.toLowerCase() === "warning"
          ? "warning"
          : "note",
      stage,
      ...(code ? { code } : {}),
      message: safeMessage,
      ...(location ? { location } : {}),
      ...(module ? { module: this.redact(module) } : {}),
      ...(symbol ? { symbol } : {}),
      stream,
      occurrences: 1,
    };
    const key = JSON.stringify([
      issue.severity,
      issue.stage,
      issue.code,
      issue.message,
      issue.location,
    ]);
    const existing = this.issues.get(key);
    if (existing) {
      existing.occurrences += 1;
      return;
    }
    if (this.issues.size >= this.limit) {
      this.truncated = true;
      return;
    }
    issue.id = `ue-build-${this.issues.size + 1}`;
    this.issues.set(key, issue);
  }
}

export function parseUEBuildDiagnostics(
  output: string,
  options: UEBuildDiagnosticOptions = {},
): UEBuildDiagnosticSummary {
  const parser = new UEBuildDiagnosticParser(options);
  parser.push(output);
  return parser.finish();
}

/** Parse a completed native result without losing capture truncation or incomplete-output evidence. */
export function parseUEBuildExecutionDiagnostics(
  result: Pick<UEBuildExecutionResult, "stdout" | "stderr" | "outputTruncated" | "outputComplete">,
  options: UEBuildDiagnosticOptions = {},
): UEBuildDiagnosticSummary {
  const parser = new UEBuildDiagnosticParser(options);
  parser.push(result.stdout, "stdout");
  parser.push(result.stderr, "stderr");
  const summary = parser.finish();
  summary.truncated ||= result.outputTruncated || !result.outputComplete;
  return summary;
}

/** Shared decision for the repair coordinator and the production result view.
 * Diagnostic eligibility is an observation, never file scope or approval. */
export function assessUEBuildRepair(
  result: Pick<UEBuildExecutionResult, "exitCode" | "treeStopped" | "stdout" | "stderr" | "outputTruncated" | "outputComplete"> & { status: string },
  options: UEBuildDiagnosticOptions = {},
) {
  const summary = parseUEBuildExecutionDiagnostics(result, options);
  const reason = !result.treeStopped || result.status === "termination_unknown"
    ? "termination_unconfirmed"
    : result.status !== "failed" || result.exitCode === null || result.exitCode === 0
      ? "not_failed_build"
      : summary.truncated ? "incomplete_diagnostics"
        : summary.errorCount === 0 ? "no_parsed_errors" : "diagnosed_failure";
  return { summary, eligible: reason === "diagnosed_failure", reason } as const;
}
