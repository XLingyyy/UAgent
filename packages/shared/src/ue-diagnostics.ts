export type DiagnosticSeverity = "info" | "warning" | "error" | "blocker";

export type DiagnosticKind =
  | "metadata_summary"
  | "malformed_descriptor"
  | "missing_module_source"
  | "plugin_descriptor_missing"
  | "target_missing_module"
  | "suspicious_build_dependency"
  | "config_secret_redacted"
  | "binary_preview_blocked"
  | "permission_denied"
  | "compiler_error"
  | "compiler_warning"
  | "build_tool_error"
  | "mcp_observation"
  | "mcp_policy_block"
  | "mcp_warning"
  | "context_pack_created";

export interface DiagnosticEvidenceLink {
  evidenceId: string;
  label: string;
  displayPath?: string;
  line?: number | null;
  column?: number | null;
}

export interface UEModuleDescriptor {
  name: string;
  type: string | null;
  loadingPhase: string | null;
  source: "uproject" | "uplugin" | "build_cs" | "target_cs";
  dependencies: {
    public: string[];
    private: string[];
  };
}

export interface UEPluginDescriptor {
  name: string;
  friendlyName: string | null;
  versionName: string | null;
  enabled: boolean;
  enabledByDefault: boolean | null;
  descriptorPath: string | null;
  supportedTargetPlatforms: string[];
  modules: UEModuleDescriptor[];
}

export interface UETargetDescriptor {
  name: string;
  path: string;
  targetType: string | null;
  extraModuleNames: string[];
}

export interface UEBuildDescriptor {
  moduleName: string;
  path: string;
  publicDependencyModuleNames: string[];
  privateDependencyModuleNames: string[];
}

export interface UEConfigSectionSummary {
  name: string;
  keys: string[];
}

export interface UEConfigSummary {
  path: string;
  sections: UEConfigSectionSummary[];
  redactedKeys: string[];
}

export interface ContextPackRedactionSummary {
  replacedPaths: number;
  replacedSecrets: number;
  redacted: boolean;
}

export interface UEProjectMetadata {
  projectId: string;
  displayRoot: string;
  uprojectPath: string | null;
  engineAssociation: string | null;
  category: string | null;
  description: string | null;
  targetPlatforms: string[];
  modules: UEModuleDescriptor[];
  plugins: UEPluginDescriptor[];
  targets: UETargetDescriptor[];
  builds: UEBuildDescriptor[];
  configSummaries: UEConfigSummary[];
  diagnostics: ProjectDiagnostic[];
  redaction: ContextPackRedactionSummary;
  createdAt: number;
}

export interface ProjectDiagnostic {
  id: string;
  kind: DiagnosticKind;
  severity: DiagnosticSeverity;
  title: string;
  message: string;
  displayPath?: string | null;
  evidence: DiagnosticEvidenceLink[];
  createdAt: number;
}

export interface BuildDiagnostic {
  id: string;
  kind: DiagnosticKind;
  severity: DiagnosticSeverity;
  tool: string;
  code: string | null;
  message: string;
  displayPath: string | null;
  line: number | null;
  column: number | null;
  evidence: DiagnosticEvidenceLink[];
  createdAt: number;
}

export interface DiagnosticObservation {
  id: string;
  kind: "mcp_resource" | "mcp_discovery" | "mcp_policy";
  summary: string;
  source: string;
  createdAt?: number;
}

export type ContextPackSourceKind =
  | "project_index"
  | "ue_project_metadata"
  | "ue_project_diagnostic"
  | "build_failure_summary"
  | "mcp_observation"
  | "terminal_evidence"
  | "safety_boundary";

export interface ContextPackSource {
  kind: ContextPackSourceKind;
  label: string;
  evidenceIds: string[];
}

export type ContextPackSectionKind =
  | "project_overview"
  | "diagnostics_summary"
  | "build_failures"
  | "important_files"
  | "mcp_observations"
  | "safety_boundaries";

export interface ContextPackSection {
  id: string;
  kind: ContextPackSectionKind;
  title: string;
  summary: string;
  items: string[];
  source: ContextPackSource;
  createdAt: number;
  redaction: ContextPackRedactionSummary;
}

export interface ContextPack {
  id: string;
  version: "v1";
  projectId: string;
  title: string;
  createdAt: number;
  sections: ContextPackSection[];
  sources: ContextPackSource[];
  redaction: ContextPackRedactionSummary;
}
