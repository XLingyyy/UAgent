import { isRunPathAllowed, type RunContextSources } from "@uagent/runtime";
import type { NativeProjectAdapter } from "./project-native-adapter";
export function projectIndexVersion(
  adapter: NativeProjectAdapter,
  projectId: string,
): string | null {
  const snapshot = adapter.getStableSnapshot(projectId);
  return snapshot?.status === "ready"
    ? (adapter.getIndexRevision?.(projectId) ?? snapshot.id + ":" + snapshot.summary.scannedAt)
    : null;
}
/** Metadata checks read no file bodies and cannot restore a saved scope or approval. */
export function createProjectContextSources(adapter: NativeProjectAdapter): RunContextSources {
  return {
    async validate(sources, scope, signal) {
      if (signal.aborted) throw Error("context_cancelled");
      const current = () => {
        const p = adapter.getProject(scope.projectId);
        return (
          adapter.source === "native" && p?.trustState === "trusted" && p.rootRef === scope.rootRef
        );
      };
      if (!current() || !adapter.inspectSources) return false;
      for (const source of sources) {
        if (
          source.projectId !== scope.projectId ||
          !source.freshness ||
          !isRunPathAllowed(source.path, scope.readPrefixes) ||
          !isRunPathAllowed(source.path, scope.sharePrefixes)
        )
          return false;
        if (
          source.kind === "project_index" &&
          source.version !== projectIndexVersion(adapter, scope.projectId)
        )
          return false;
        if (!["project_index", "file_preview"].includes(source.kind)) return false;
      }
      const paths = [...new Set(sources.map((source) => source.path))];
      if (paths.length > 64) return false;
      const inspected = await adapter.inspectSources(scope.projectId, paths);
      if (signal.aborted || !current() || inspected.projectId !== scope.projectId) return false;
      const versions = new Map(
        inspected.sources.map((source) => [
          source.path,
          source.status === "ready" ? source.version : null,
        ]),
      );
      return sources.every(
        (source) =>
          versions.get(source.path) === source.freshness &&
          (source.kind !== "project_index" ||
            source.version === projectIndexVersion(adapter, scope.projectId)),
      );
    },
  };
}
export function checkedFreshness(
  sources: Awaited<ReturnType<NonNullable<NativeProjectAdapter["inspectSources"]>>>,
  path: string,
): string {
  const entry = sources.sources.find((source) => source.path === path);
  if (!entry || entry.status !== "ready" || !entry.version) throw Error("source_unavailable");
  return entry.version;
}
