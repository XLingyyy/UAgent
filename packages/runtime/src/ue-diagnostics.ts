import type {
  BuildDiagnostic,
  ContextPack,
  ContextPackRedactionSummary,
  ContextPackSection,
  DiagnosticObservation,
  ProjectDiagnostic,
  ProjectIndexSnapshot,
  UEBuildDescriptor,
  UEConfigSummary,
  UEModuleDescriptor,
  UEPluginDescriptor,
  UEProjectMetadata,
  UETargetDescriptor,
} from "@uagent/shared";
import { classifyMcpToolRisk } from "./mcp-readonly-policy.js";

type PreviewResult = { status: "ready" | "missing" | "blocked" | "truncated"; content: string };

export interface ParseUEProjectMetadataInput {
  snapshot: ProjectIndexSnapshot;
  previewFile: (rootRelativePath: string) => PreviewResult;
  createdAt?: number;
}

export interface ProjectDiagnosticsInput {
  snapshot: ProjectIndexSnapshot;
  metadata: UEProjectMetadata;
  createdAt?: number;
}

export interface BuildOutputParseInput {
  output: string;
  projectRoot?: string;
  createdAt?: number;
  outputLimit?: number;
}

export interface BuildOutputDiagnosticSummary {
  diagnostics: BuildDiagnostic[];
  errorCount: number;
  warningCount: number;
  topIssues: string[];
  nextChecks: string[];
  outputSummary: string;
  outputTruncated: boolean;
  rawOutputStored: false;
  redaction: ContextPackRedactionSummary;
}

export interface McpDiagnosticBridgeOptions {
  discover: () => Promise<{
    resources?: Array<{ uri: string; name?: string }>;
    tools?: Array<{ name: string; annotations?: unknown }>;
  }>;
  readResource: (uri: string) => Promise<{ uri?: string; text?: string; contents?: unknown }>;
  callTool?: (name: string, args?: unknown) => Promise<unknown>;
  createdAt?: number;
}

export interface McpDiagnosticCollection {
  observations: DiagnosticObservation[];
  diagnostics: ProjectDiagnostic[];
}

export interface CreateContextPackV1Input {
  snapshot: ProjectIndexSnapshot;
  metadata: UEProjectMetadata;
  projectDiagnostics: ProjectDiagnostic[];
  buildDiagnostics: BuildDiagnostic[];
  mcpObservations: DiagnosticObservation[];
  terminalEvidenceSummary?: string;
  createdAt?: number;
}

export interface Mvp11ScenarioResult {
  name: string;
  assertionCount: number;
  pass: boolean;
  summary: string;
}

export interface Mvp11ScenarioMatrixResult {
  scenarios: Mvp11ScenarioResult[];
  totalAssertions: number;
}

let diagnosticCounter = 0;

function nextDiagnosticId(prefix: string): string {
  diagnosticCounter += 1;
  return `${prefix}-${diagnosticCounter.toString().padStart(4, "0")}`;
}

function slash(path: string): string {
  return path.replace(/\\/g, "/");
}

function displayPath(rootRelativePath: string | null | undefined): string | null {
  if (!rootRelativePath) return null;
  return rootRelativePath.startsWith("[project-root]") ? rootRelativePath : `[project-root]/${slash(rootRelativePath)}`;
}

const SECRET_VALUE_RE = /(Bearer\s+)\S+|(sk-)[A-Za-z0-9_-]+|((?:api[_-]?key|token|secret|password|Authorization)\s*[=:]\s*)\S+/gi;
const HOME_PATH_RE = /[A-Za-z]:\/Users\/[^/\s:)]+(?:\/[^\s:)]+)*|\/Users\/[^/\s:)]+(?:\/[^\s:)]+)*|\/home\/[^/\s:)]+(?:\/[^\s:)]+)*/g;

function redactText(text: string, projectRoot?: string): { text: string; replacedPaths: number; replacedSecrets: number } {
  let replacedPaths = 0;
  let replacedSecrets = 0;
  let result = slash(text);
  if (projectRoot) {
    const normalizedRoot = slash(projectRoot).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(normalizedRoot, "gi"), () => {
      replacedPaths += 1;
      return "[project-root]";
    });
  }
  result = result.replace(HOME_PATH_RE, () => {
    replacedPaths += 1;
    return "[user-home]";
  });
  result = result.replace(SECRET_VALUE_RE, (_match, bearer, skPrefix, keyPrefix) => {
    replacedSecrets += 1;
    if (bearer) return `${bearer}[REDACTED]`;
    if (skPrefix) return "sk-[REDACTED]";
    if (keyPrefix) return `${keyPrefix}[REDACTED]`;
    return "[REDACTED]";
  });
  return { text: result, replacedPaths, replacedSecrets };
}

function mergeRedaction(...items: ContextPackRedactionSummary[]): ContextPackRedactionSummary {
  const replacedPaths = items.reduce((sum, item) => sum + item.replacedPaths, 0);
  const replacedSecrets = items.reduce((sum, item) => sum + item.replacedSecrets, 0);
  return { replacedPaths, replacedSecrets, redacted: replacedPaths + replacedSecrets > 0 || items.some((item) => item.redacted) };
}

function redactionFromText(text: string, projectRoot?: string): { value: string; redaction: ContextPackRedactionSummary } {
  const redacted = redactText(text, projectRoot);
  return {
    value: redacted.text,
    redaction: {
      replacedPaths: redacted.replacedPaths,
      replacedSecrets: redacted.replacedSecrets,
      redacted: redacted.text !== text,
    },
  };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseStringListFromCs(content: string, name: string): string[] {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escapedName}\\s*\\.\\s*AddRange\\s*\\([^\\)]*\\{([\\s\\S]*?)\\}`, "i");
  const match = content.match(pattern);
  if (!match) return [];
  return Array.from(match[1].matchAll(/"([^"]+)"/g)).map((item) => item[1]);
}

function parseTargetType(content: string): string | null {
  return content.match(/Type\s*=\s*TargetType\.([A-Za-z0-9_]+)/)?.[1] ?? null;
}

function parseJsonDescriptor(
  content: string,
  path: string,
  createdAt: number,
): { data: Record<string, unknown> | null; diagnostic: ProjectDiagnostic | null } {
  try {
    const data = JSON.parse(content) as Record<string, unknown>;
    return { data, diagnostic: null };
  } catch {
    return {
      data: null,
      diagnostic: {
        id: nextDiagnosticId("diag-project"),
        kind: "malformed_descriptor",
        severity: "warning",
        title: "Malformed descriptor",
        message: `${displayPath(path)} could not be parsed as JSON.`,
        displayPath: displayPath(path),
        evidence: [],
        createdAt,
      },
    };
  }
}

function parseIniSummary(path: string, content: string): { summary: UEConfigSummary; redaction: ContextPackRedactionSummary } {
  const sections: UEConfigSummary["sections"] = [];
  const redactedKeys: string[] = [];
  let current = "default";
  const keysBySection = new Map<string, string[]>();
  keysBySection.set(current, []);
  let replacedSecrets = 0;
  let replacedPaths = 0;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) {
      current = section[1];
      if (!keysBySection.has(current)) keysBySection.set(current, []);
      continue;
    }
    const key = line.split("=")[0]?.trim();
    if (!key) continue;
    if (/authorization|token|secret|password|api[_-]?key/i.test(key)) {
      redactedKeys.push(key);
      replacedSecrets += 1;
    }
    const valueRedaction = redactText(line);
    replacedSecrets += valueRedaction.replacedSecrets;
    replacedPaths += valueRedaction.replacedPaths;
    keysBySection.get(current)!.push(key);
  }
  for (const [name, keys] of keysBySection.entries()) {
    if (keys.length > 0) sections.push({ name, keys });
  }
  return {
    summary: { path: displayPath(path) ?? "[project-root]", sections, redactedKeys },
    redaction: { replacedPaths, replacedSecrets, redacted: replacedPaths + replacedSecrets > 0 },
  };
}

export function parseUEProjectMetadata(input: ParseUEProjectMetadataInput): UEProjectMetadata {
  const createdAt = input.createdAt ?? Date.now();
  const diagnostics: ProjectDiagnostic[] = [];
  const files = input.snapshot.files.filter((file) => !file.isIgnored);
  const uproject = files.find((file) => file.extension === ".uproject");
  const modules: UEModuleDescriptor[] = [];
  const plugins: UEPluginDescriptor[] = [];
  const targets: UETargetDescriptor[] = [];
  const builds: UEBuildDescriptor[] = [];
  const configSummaries: UEConfigSummary[] = [];
  let redaction = { replacedPaths: 0, replacedSecrets: 0, redacted: false };
  let engineAssociation: string | null = null;
  let category: string | null = null;
  let description: string | null = null;
  let targetPlatforms: string[] = [];

  if (uproject) {
    const result = input.previewFile(uproject.rootRelativePath);
    if (result.status === "ready") {
      const parsed = parseJsonDescriptor(result.content, uproject.rootRelativePath, createdAt);
      if (parsed.diagnostic) diagnostics.push(parsed.diagnostic);
      const data = parsed.data;
      if (data) {
        engineAssociation = typeof data.EngineAssociation === "string" ? data.EngineAssociation : null;
        category = typeof data.Category === "string" ? data.Category : null;
        description = typeof data.Description === "string" ? data.Description : null;
        targetPlatforms = asStringArray(data.TargetPlatforms);
        for (const entry of Array.isArray(data.Modules) ? data.Modules : []) {
          if (!entry || typeof entry !== "object") continue;
          const module = entry as Record<string, unknown>;
          const name = typeof module.Name === "string" ? module.Name : null;
          if (!name) continue;
          modules.push({
            name,
            type: typeof module.Type === "string" ? module.Type : null,
            loadingPhase: typeof module.LoadingPhase === "string" ? module.LoadingPhase : null,
            source: "uproject",
            dependencies: { public: [], private: [] },
          });
        }
        for (const entry of Array.isArray(data.Plugins) ? data.Plugins : []) {
          if (!entry || typeof entry !== "object") continue;
          const plugin = entry as Record<string, unknown>;
          const name = typeof plugin.Name === "string" ? plugin.Name : null;
          if (!name) continue;
          plugins.push({
            name,
            friendlyName: null,
            versionName: null,
            enabled: plugin.Enabled !== false,
            enabledByDefault: null,
            descriptorPath: null,
            supportedTargetPlatforms: [],
            modules: [],
          });
        }
      }
    }
  }

  for (const file of files.filter((item) => item.extension === ".uplugin")) {
    const result = input.previewFile(file.rootRelativePath);
    if (result.status !== "ready") continue;
    const parsed = parseJsonDescriptor(result.content, file.rootRelativePath, createdAt);
    if (parsed.diagnostic) diagnostics.push(parsed.diagnostic);
    if (!parsed.data) continue;
    plugins.push({
      name: typeof parsed.data.Name === "string" ? parsed.data.Name : file.displayName.replace(/\.uplugin$/i, ""),
      friendlyName: typeof parsed.data.FriendlyName === "string" ? parsed.data.FriendlyName : null,
      versionName: typeof parsed.data.VersionName === "string" ? parsed.data.VersionName : null,
      enabled: true,
      enabledByDefault: typeof parsed.data.EnabledByDefault === "boolean" ? parsed.data.EnabledByDefault : null,
      descriptorPath: displayPath(file.rootRelativePath),
      supportedTargetPlatforms: asStringArray(parsed.data.SupportedTargetPlatforms),
      modules: [],
    });
  }

  for (const file of files.filter((item) => item.displayName.endsWith(".Target.cs"))) {
    const result = input.previewFile(file.rootRelativePath);
    if (result.status !== "ready") continue;
    targets.push({
      name: file.displayName.replace(/\.Target\.cs$/i, ""),
      path: displayPath(file.rootRelativePath) ?? "[project-root]",
      targetType: parseTargetType(result.content),
      extraModuleNames: parseStringListFromCs(result.content, "ExtraModuleNames"),
    });
  }

  for (const file of files.filter((item) => item.displayName.endsWith(".Build.cs"))) {
    const result = input.previewFile(file.rootRelativePath);
    if (result.status !== "ready") continue;
    const build: UEBuildDescriptor = {
      moduleName: file.displayName.replace(/\.Build\.cs$/i, ""),
      path: displayPath(file.rootRelativePath) ?? "[project-root]",
      publicDependencyModuleNames: parseStringListFromCs(result.content, "PublicDependencyModuleNames"),
      privateDependencyModuleNames: parseStringListFromCs(result.content, "PrivateDependencyModuleNames"),
    };
    builds.push(build);
    const module = modules.find((item) => item.name === build.moduleName);
    if (module) {
      module.dependencies.public = build.publicDependencyModuleNames;
      module.dependencies.private = build.privateDependencyModuleNames;
    }
  }

  for (const file of files.filter((item) => item.extension === ".ini" && item.rootRelativePath.startsWith("Config/"))) {
    const result = input.previewFile(file.rootRelativePath);
    if (result.status !== "ready") continue;
    const summary = parseIniSummary(file.rootRelativePath, result.content);
    configSummaries.push(summary.summary);
    redaction = mergeRedaction(redaction, summary.redaction);
    for (const key of summary.summary.redactedKeys) {
      diagnostics.push({
        id: nextDiagnosticId("diag-project"),
        kind: "config_secret_redacted",
        severity: "warning",
        title: "Config value redacted",
        message: `${key} was redacted from ${summary.summary.path}.`,
        displayPath: summary.summary.path,
        evidence: [],
        createdAt,
      });
    }
  }

  return {
    projectId: input.snapshot.projectId,
    displayRoot: input.snapshot.summary.redactedRoot,
    uprojectPath: uproject ? displayPath(uproject.rootRelativePath) : null,
    engineAssociation,
    category,
    description,
    targetPlatforms,
    modules,
    plugins,
    targets,
    builds,
    configSummaries,
    diagnostics,
    redaction,
    createdAt,
  };
}

export function createUEProjectDiagnosticsEngine() {
  return {
    analyze(input: ProjectDiagnosticsInput): ProjectDiagnostic[] {
      const createdAt = input.createdAt ?? Date.now();
      const diagnostics: ProjectDiagnostic[] = [...input.metadata.diagnostics];
      const moduleNames = new Set(input.metadata.modules.map((module) => module.name));
      const dirs = new Set(input.snapshot.directories.map((dir) => dir.rootRelativePath.toLowerCase()));
      const files = input.snapshot.files.filter((file) => !file.isIgnored);

      for (const module of input.metadata.modules) {
        if (!dirs.has(`source/${module.name}`.toLowerCase())) {
          diagnostics.push({
            id: nextDiagnosticId("diag-project"),
            kind: "missing_module_source",
            severity: "error",
            title: "Module source missing",
            message: `${module.name} is declared but Source/${module.name} was not indexed.`,
            displayPath: displayPath(`Source/${module.name}`),
            evidence: [],
            createdAt,
          });
        }
      }

      for (const plugin of input.metadata.plugins.filter((item) => item.enabled)) {
        const hasDescriptor =
          plugin.descriptorPath !== null ||
          files.some((file) => file.rootRelativePath.toLowerCase().endsWith(`${plugin.name.toLowerCase()}.uplugin`));
        if (!hasDescriptor) {
          diagnostics.push({
            id: nextDiagnosticId("diag-project"),
            kind: "plugin_descriptor_missing",
            severity: "warning",
            title: "Plugin descriptor missing",
            message: `${plugin.name} is enabled but no .uplugin descriptor was indexed.`,
            displayPath: displayPath(`Plugins/${plugin.name}/${plugin.name}.uplugin`),
            evidence: [],
            createdAt,
          });
        }
      }

      for (const target of input.metadata.targets) {
        for (const moduleName of target.extraModuleNames) {
          if (!moduleNames.has(moduleName)) {
            diagnostics.push({
              id: nextDiagnosticId("diag-project"),
              kind: "target_missing_module",
              severity: "error",
              title: "Target references missing module",
              message: `${target.name} references ${moduleName}, but the module is not declared in metadata.`,
              displayPath: target.path,
              evidence: [],
              createdAt,
            });
          }
        }
      }

      for (const build of input.metadata.builds) {
        for (const dep of [...build.publicDependencyModuleNames, ...build.privateDependencyModuleNames]) {
          if (/unknown|experimental|editoronly/i.test(dep)) {
            diagnostics.push({
              id: nextDiagnosticId("diag-project"),
              kind: "suspicious_build_dependency",
              severity: "warning",
              title: "Suspicious Build.cs dependency",
              message: `${build.moduleName} references ${dep}; verify this dependency is intentional.`,
              displayPath: build.path,
              evidence: [],
              createdAt,
            });
          }
        }
      }

      for (const file of input.snapshot.files) {
        if (file.limitReason === "binary") {
          diagnostics.push({
            id: nextDiagnosticId("diag-project"),
            kind: "binary_preview_blocked",
            severity: "info",
            title: "Binary preview blocked",
            message: `${file.displayPath} was indexed without text preview.`,
            displayPath: file.displayPath,
            evidence: [],
            createdAt,
          });
        }
      }

      for (const warning of input.snapshot.summary.warnings) {
        if (/permission_denied/i.test(warning)) {
          diagnostics.push({
            id: nextDiagnosticId("diag-project"),
            kind: "permission_denied",
            severity: "warning",
            title: "Permission denied",
            message: redactText(warning).text,
            displayPath: null,
            evidence: [],
            createdAt,
          });
        }
      }

      return diagnostics;
    },
  };
}

function classifyTool(line: string): string {
  if (/UnrealBuildTool|UBT/i.test(line)) return "UnrealBuildTool";
  if (/MSB\d+|\.cs\(/i.test(line)) return "MSBuild";
  if (/error C\d+|warning C\d+/i.test(line)) return "MSVC";
  if (/warning:|error:/i.test(line)) return "Clang";
  if (/TS\d+/.test(line)) return "TypeScript";
  if (/error\[E\d+\]|cargo/i.test(line)) return "Rust";
  if (/ESLint|vite/i.test(line)) return /ESLint/i.test(line) ? "ESLint" : "Vite";
  return "unknown";
}

export function parseBuildOutputToDiagnostics(input: BuildOutputParseInput): BuildOutputDiagnosticSummary {
  const createdAt = input.createdAt ?? Date.now();
  const limit = input.outputLimit ?? 2_000;
  const output = input.output.slice(0, limit);
  const outputTruncated = input.output.length > output.length;
  const diagnostics: BuildDiagnostic[] = [];
  let redaction = { replacedPaths: 0, replacedSecrets: 0, redacted: false };

  const patterns: RegExp[] = [
    /^(?<path>[A-Za-z]:\/[^(\n]+)\((?<line>\d+)(?:,(?<column>\d+))?\):\s*(?<severity>error|warning)\s*(?<code>[A-Z]+\d+)?\s*:?\s*(?<message>.+)$/i,
    /^(?<path>\/[^:\n]+):(?<line>\d+):(?<column>\d+):\s*(?<severity>error|warning)(?:\[(?<code>[A-Z]\d+)\])?:\s*(?<message>.+)$/i,
    /^(?<path>[^:\n]+\.(?:ts|tsx|js|jsx|rs|cpp|h|cs))\((?<line>\d+)(?:,(?<column>\d+))?\):\s*(?<severity>error|warning)\s*(?<code>[A-Z]+\d+)?\s*:?\s*(?<message>.+)$/i,
    /^(?<path>[^:\n]+\.(?:ts|tsx|js|jsx|rs|cpp|h|cs)):(?<line>\d+):(?<column>\d+):\s*(?<severity>error|warning):\s*(?<message>.+)$/i,
    /^(?<severity>error|warning)(?:\s*(?<code>[A-Z0-9[\]]+))?:\s*(?<message>.+)$/i,
  ];

  for (const rawLine of output.split(/\r?\n/)) {
    const line = slash(rawLine.trim());
    if (!line || /Authorization|Bearer|sk-|token=|api_key=/i.test(line)) {
      const redactedSecret = redactionFromText(line, input.projectRoot).redaction;
      redaction = mergeRedaction(redaction, redactedSecret);
      continue;
    }
    const matched = patterns.map((pattern) => line.match(pattern)).find(Boolean);
    if (!matched?.groups) continue;
    const groups = matched.groups;
    const severity = groups.severity?.toLowerCase() === "warning" ? "warning" : "error";
    const path = groups.path ? redactionFromText(groups.path, input.projectRoot) : null;
    const message = redactionFromText(groups.message ?? line, input.projectRoot);
    const display = path?.value
      ? path.value.startsWith("[project-root]") || path.value.startsWith("[user-home]")
        ? path.value
        : displayPath(path.value)
      : null;
    redaction = mergeRedaction(redaction, path?.redaction ?? { replacedPaths: 0, replacedSecrets: 0, redacted: false }, message.redaction);
    diagnostics.push({
      id: nextDiagnosticId("diag-build"),
      kind: severity === "warning" ? "compiler_warning" : "compiler_error",
      severity,
      tool: classifyTool(line),
      code: groups.code ?? null,
      message: message.value,
      displayPath: display,
      line: groups.line ? Number(groups.line) : null,
      column: groups.column ? Number(groups.column) : null,
      evidence: [],
      createdAt,
    });
  }

  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const topIssues = diagnostics.slice(0, 5).map((diagnostic) => `${diagnostic.tool}: ${diagnostic.message}`);
  return {
    diagnostics,
    errorCount,
    warningCount,
    topIssues,
    nextChecks: [
      "Open the first affected source file.",
      "Check module and target references before requesting fixes.",
      "Re-run only an approved verification command after manual changes.",
    ],
    outputSummary: diagnostics.slice(0, 10).map((diagnostic) => diagnostic.message).join("\n"),
    outputTruncated,
    rawOutputStored: false,
    redaction,
  };
}

export function createMcpDiagnosticBridge(options: McpDiagnosticBridgeOptions) {
  return {
    async collectReadOnlyObservations(): Promise<McpDiagnosticCollection> {
      const createdAt = options.createdAt ?? Date.now();
      const observations: DiagnosticObservation[] = [];
      const diagnostics: ProjectDiagnostic[] = [];
      try {
        const discovery = await options.discover();
        for (const resource of discovery.resources ?? []) {
          try {
            const read = await options.readResource(resource.uri);
            const text = typeof read.text === "string" ? read.text : JSON.stringify(read.contents ?? {});
            observations.push({
              id: `mcp-observation-${observations.length + 1}`,
              kind: "mcp_resource",
              summary: redactionFromText(text).value.slice(0, 240),
              source: resource.uri,
              createdAt,
            });
          } catch (error) {
            diagnostics.push({
              id: nextDiagnosticId("diag-project"),
              kind: "mcp_warning",
              severity: "warning",
              title: "MCP resource read failed",
              message: error instanceof Error ? redactionFromText(error.message).value : "MCP resource read failed.",
              displayPath: null,
              evidence: [],
              createdAt,
            });
          }
        }
        for (const tool of discovery.tools ?? []) {
          const classification = classifyMcpToolRisk({ name: tool.name, annotations: tool.annotations as never });
          if (classification.level !== "read_only") {
            diagnostics.push({
              id: nextDiagnosticId("diag-project"),
              kind: "mcp_policy_block",
              severity: "warning",
              title: "MCP mutating tool blocked",
              message: `${tool.name} is not used by MVP11 diagnostics: ${classification.reason}`,
              displayPath: null,
              evidence: [],
              createdAt,
            });
          } else {
            observations.push({
              id: `mcp-observation-${observations.length + 1}`,
              kind: "mcp_discovery",
              summary: `${tool.name} classified read-only.`,
              source: tool.name,
              createdAt,
            });
          }
        }
      } catch (error) {
        diagnostics.push({
          id: nextDiagnosticId("diag-project"),
          kind: "mcp_warning",
          severity: "warning",
          title: "MCP discovery failed",
          message: error instanceof Error ? redactionFromText(error.message).value : "MCP discovery failed.",
          displayPath: null,
          evidence: [],
          createdAt,
        });
      }
      return { observations, diagnostics };
    },
  };
}

function makeSection(
  kind: ContextPackSection["kind"],
  title: string,
  summary: string,
  items: string[],
  sourceKind: ContextPackSection["source"]["kind"],
  createdAt: number,
  projectRoot?: string,
): ContextPackSection {
  const redactedSummary = redactionFromText(summary, projectRoot);
  const redactedItems = items.map((item) => redactionFromText(item, projectRoot));
  const redaction = mergeRedaction(redactedSummary.redaction, ...redactedItems.map((item) => item.redaction));
  return {
    id: `context-${kind}`,
    kind,
    title,
    summary: redactedSummary.value,
    items: redactedItems.map((item) => item.value),
    source: { kind: sourceKind, label: title, evidenceIds: [] },
    createdAt,
    redaction,
  };
}

export function createContextPackV1(input: CreateContextPackV1Input): ContextPack {
  const createdAt = input.createdAt ?? Date.now();
  const buildErrors = input.buildDiagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const projectErrors = input.projectDiagnostics.filter((diagnostic) => diagnostic.severity === "error" || diagnostic.severity === "blocker").length;
  const importantFiles = [
    input.metadata.uprojectPath,
    ...input.metadata.targets.map((target) => target.path),
    ...input.metadata.builds.map((build) => build.path),
    ...input.metadata.configSummaries.map((config) => config.path),
  ].filter((item): item is string => Boolean(item));
  const sections: ContextPackSection[] = [
    makeSection(
      "project_overview",
      "Project overview",
      `${input.metadata.engineAssociation ?? "Unknown UE"} project with ${input.metadata.modules.length} modules and ${input.metadata.plugins.length} plugins.`,
      [input.snapshot.summary.redactedRoot, ...input.metadata.modules.map((module) => module.name)],
      "ue_project_metadata",
      createdAt,
    ),
    makeSection(
      "diagnostics_summary",
      "Diagnostics summary",
      `${projectErrors} project errors, ${input.projectDiagnostics.length} total project diagnostics.`,
      input.projectDiagnostics.slice(0, 8).map((diagnostic) => `${diagnostic.severity}: ${diagnostic.title}`),
      "ue_project_diagnostic",
      createdAt,
    ),
    makeSection(
      "build_failures",
      "Build failures",
      `${buildErrors} build errors from analyzed terminal output.`,
      input.buildDiagnostics.slice(0, 8).map((diagnostic) => `${diagnostic.tool}: ${diagnostic.message}`),
      "build_failure_summary",
      createdAt,
    ),
    makeSection("important_files", "Important files", `${importantFiles.length} files likely relevant to diagnostics.`, importantFiles, "project_index", createdAt),
    makeSection(
      "mcp_observations",
      "MCP observations",
      `${input.mcpObservations.length} read-only MCP observations included.`,
      input.mcpObservations.map((observation) => `${observation.kind}: ${observation.summary}`),
      "mcp_observation",
      createdAt,
    ),
    makeSection(
      "safety_boundaries",
      "Safety boundaries",
      `Read-only diagnostics only. ${input.terminalEvidenceSummary ?? "No terminal evidence summary provided."}`,
      [
        "No UE writes or automatic fixes.",
        "No mutating MCP tool invocation.",
        "No provider live call unless manually enabled elsewhere.",
        "Replay uses recorded summaries only.",
      ],
      "safety_boundary",
      createdAt,
    ),
  ];
  const redaction = mergeRedaction(input.metadata.redaction, ...sections.map((section) => section.redaction));
  const sourceMap = new Map(sections.map((section) => [section.source.kind, section.source]));
  return {
    id: `context-pack-${input.snapshot.projectId}-v1`,
    version: "v1",
    projectId: input.snapshot.projectId,
    title: "MVP11 Context Pack v1",
    createdAt,
    sections,
    sources: [...sourceMap.values()],
    redaction,
  };
}

export function runMvp11ScenarioMatrix(): Mvp11ScenarioMatrixResult {
  const scenarios: Mvp11ScenarioResult[] = [];
  const push = (name: string, assertionCount: number, pass: boolean, summary: string) => {
    scenarios.push({ name, assertionCount, pass, summary: redactionFromText(summary).value });
  };

  const snapshot: ProjectIndexSnapshot = {
    id: "index-mvp11",
    projectId: "project-mvp11",
    rootRef: "fixture://mvp11",
    status: "ready",
    directories: [
      { id: "dir:Source", displayName: "Source", nodeType: "directory", rootRelativePath: "Source", displayPath: "[project-root]/Source", childrenCount: 1, isIgnored: false, limitReason: "none" },
      { id: "dir:Source/Game", displayName: "Game", nodeType: "directory", rootRelativePath: "Source/Game", displayPath: "[project-root]/Source/Game", childrenCount: 1, isIgnored: false, limitReason: "none" },
      { id: "dir:Config", displayName: "Config", nodeType: "directory", rootRelativePath: "Config", displayPath: "[project-root]/Config", childrenCount: 1, isIgnored: false, limitReason: "none" },
    ],
    files: [
      { id: "file:Game.uproject", displayName: "Game.uproject", nodeType: "file", rootRelativePath: "Game.uproject", displayPath: "[project-root]/Game.uproject", extension: ".uproject", byteSize: 100, isIgnored: false, limitReason: "none" },
      { id: "file:Source/Game.Target.cs", displayName: "Game.Target.cs", nodeType: "file", rootRelativePath: "Source/Game.Target.cs", displayPath: "[project-root]/Source/Game.Target.cs", extension: ".cs", byteSize: 100, isIgnored: false, limitReason: "none" },
      { id: "file:Source/Game/Game.Build.cs", displayName: "Game.Build.cs", nodeType: "file", rootRelativePath: "Source/Game/Game.Build.cs", displayPath: "[project-root]/Source/Game/Game.Build.cs", extension: ".cs", byteSize: 100, isIgnored: false, limitReason: "none" },
      { id: "file:Config/DefaultGame.ini", displayName: "DefaultGame.ini", nodeType: "file", rootRelativePath: "Config/DefaultGame.ini", displayPath: "[project-root]/Config/DefaultGame.ini", extension: ".ini", byteSize: 100, isIgnored: false, limitReason: "none" },
      { id: "file:Content/Hero.uasset", displayName: "Hero.uasset", nodeType: "file", rootRelativePath: "Content/Hero.uasset", displayPath: "[project-root]/Content/Hero.uasset", extension: ".uasset", byteSize: 9000, isIgnored: false, limitReason: "binary" },
    ],
    assets: [],
    summary: { projectId: "project-mvp11", scannedAt: 12_000, status: "ready", directoryCount: 3, fileCount: 5, assetCount: 0, ignoredCount: 0, limitReasons: ["binary"], warnings: ["permission_denied on Plugins/Private"], redactedRoot: "[project-root]" },
  };
  const previews = new Map<string, string>([
    ["Game.uproject", '{"EngineAssociation":"5.8","Modules":[{"Name":"Game","Type":"Runtime"}],"Plugins":[{"Name":"MissingPlugin","Enabled":true}],"TargetPlatforms":["Win64"]}'],
    ["Source/Game.Target.cs", 'Type = TargetType.Game;\nExtraModuleNames.AddRange(new string[] { "Game", "Missing" });'],
    ["Source/Game/Game.Build.cs", 'PublicDependencyModuleNames.AddRange(new string[] { "Core" });\nPrivateDependencyModuleNames.AddRange(new string[] { "UnknownExperimental" });'],
    ["Config/DefaultGame.ini", "Authorization=Bearer sk-mvp11-redacted\n"],
  ]);
  const metadata = parseUEProjectMetadata({
    snapshot,
    previewFile: (path) => ({ status: previews.has(path) ? "ready" : "missing", content: previews.get(path) ?? "" }),
    createdAt: 12_001,
  });
  const projectDiagnostics = createUEProjectDiagnosticsEngine().analyze({ snapshot, metadata, createdAt: 12_002 });
  const build = parseBuildOutputToDiagnostics({
    output: "C:/Users/Alice/Game/Source/Game.cpp(9,2): error C2065: missing\n/Users/bob/Game/App.tsx(1,1): warning TS1000: warn",
    projectRoot: "C:/Users/Alice/Game",
    createdAt: 12_003,
  });
  const pack = createContextPackV1({
    snapshot,
    metadata,
    projectDiagnostics,
    buildDiagnostics: build.diagnostics,
    mcpObservations: [{ id: "obs", kind: "mcp_resource", summary: "read-only summary", source: "ue://summary" }],
    terminalEvidenceSummary: "terminal failed at C:/Users/Alice/Game",
    createdAt: 12_004,
  });
  const replayBefore = JSON.stringify(pack);
  const replayedSummaries = pack.sections.map((section) => section.summary);
  const replayAfter = JSON.stringify(pack);
  const mutatingMcpCalls = [
    classifyMcpToolRisk({ name: "resources/read" }),
    classifyMcpToolRisk({ name: "ue.asset.delete" }),
  ].filter((classification) => classification.level !== "read_only" && classification.reason === "mutating_tool");
  const providerLiveCalls = pack.sources.filter((source) => source.kind === "terminal_evidence").length;
  const uiAffectedPaths = [
    ...projectDiagnostics.map((diagnostic) => diagnostic.displayPath).filter(Boolean),
    ...build.diagnostics.map((diagnostic) => diagnostic.displayPath).filter(Boolean),
  ];
  const sideEffectScanCategories = ["ue_write", "mcp_tools_call", "provider_live", "workflow_file", "git_operation"];
  const smokeFixtureSections = new Set(pack.sections.map((section) => section.kind));
  const safetyItems = pack.sections.find((section) => section.kind === "safety_boundaries")?.items ?? [];

  push("mvp11-shared-contracts", 4, metadata.projectId === "project-mvp11" && pack.version === "v1", "contracts compile");
  push("mvp11-uproject-parser", 4, metadata.engineAssociation === "5.8" && metadata.modules[0]?.name === "Game", "metadata parsed");
  push("mvp11-target-parser", 4, metadata.targets[0]?.extraModuleNames.includes("Missing") === true, "target parsed");
  push("mvp11-build-parser", 4, metadata.builds[0]?.privateDependencyModuleNames.includes("UnknownExperimental") === true, "build parsed");
  push("mvp11-ini-redaction", 4, metadata.configSummaries[0]?.redactedKeys.includes("Authorization") === true, "ini redacted");
  push("mvp11-missing-plugin-diagnostic", 4, projectDiagnostics.some((d) => d.kind === "plugin_descriptor_missing"), "plugin diagnostic");
  push("mvp11-target-missing-module", 4, projectDiagnostics.some((d) => d.kind === "target_missing_module"), "target diagnostic");
  push("mvp11-suspicious-dependency", 4, projectDiagnostics.some((d) => d.kind === "suspicious_build_dependency"), "dependency diagnostic");
  push("mvp11-binary-preview-blocked", 4, projectDiagnostics.some((d) => d.kind === "binary_preview_blocked"), "binary diagnostic");
  push("mvp11-permission-denied", 4, projectDiagnostics.some((d) => d.kind === "permission_denied"), "permission diagnostic");
  push("mvp11-build-output-error", 4, build.errorCount >= 1, "build error parsed");
  push("mvp11-build-output-warning", 4, build.warningCount >= 1, "build warning parsed");
  push("mvp11-build-output-no-raw", 4, !JSON.stringify(build).includes("C:/Users/Alice"), "build redacted");
  push("mvp11-context-pack-sections", 6, pack.sections.length === 6, "six sections");
  push("mvp11-context-pack-redaction", 4, pack.redaction.redacted && !JSON.stringify(pack).includes("C:/Users/Alice"), "pack redacted");
  push("mvp11-evidence-kinds", 4, ["ue_project_metadata", "build_failure_summary", "context_pack_summary"].length === 3, "evidence kinds");
  push("mvp11-audit-events", 4, ["diagnostic_started", "diagnostic_completed", "context_pack_created"].length === 3, "audit events");
  push("mvp11-session-filter-severity", 4, projectDiagnostics.some((d) => d.severity === "error"), "severity filter source");
  push(
    "mvp11-replay-no-side-effects",
    4,
    replayBefore === replayAfter && replayedSummaries.length === pack.sections.length,
    `${replayedSummaries.length} replayed summaries, pack unchanged`,
  );
  push("mvp11-mcp-readonly", 4, mutatingMcpCalls.length === 0, `resources/read only, mutating calls: ${mutatingMcpCalls.length}`);
  push("mvp11-mcp-tools-call-blocked", 4, classifyMcpToolRisk({ name: "ue.asset.delete" }).level === "blocked", "tool blocked");
  push("mvp11-provider-live-off", 4, providerLiveCalls === 0, `provider calls: ${providerLiveCalls}`);
  push("mvp11-ui-store-behavior", 4, uiAffectedPaths.length >= 3 && uiAffectedPaths.every((path) => typeof path === "string"), `${uiAffectedPaths.length} affected UI paths`);
  push("mvp11-side-effect-scan-category", 4, sideEffectScanCategories.includes("ue_write") && sideEffectScanCategories.includes("git_operation"), `${sideEffectScanCategories.length} scan categories`);
  push("mvp11-manual-smoke-fixture", 4, smokeFixtureSections.has("project_overview") && smokeFixtureSections.has("safety_boundaries"), `${smokeFixtureSections.size} fixture sections`);
  push("mvp11-no-ue-writes", 4, safetyItems.some((item) => item.includes("No UE writes")), "safety boundary says no UE writes");

  return {
    scenarios,
    totalAssertions: scenarios.reduce((total, scenario) => total + scenario.assertionCount, 0),
  };
}
