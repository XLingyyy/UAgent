import type {
  ProviderRuntimeMessage,
  RunContextPlan,
  RunContextSegment,
  RunSourceRef,
  RunToolResult,
  TaskRun,
  TaskRunScope,
} from "@uagent/shared";
import { isRunPathAllowed } from "../run/tool-registry.js";
export interface RunContextSources {
  /** References are descriptions, never permission. Validate against the current trusted project. */
  validate(
    sources: readonly RunSourceRef[],
    scope: TaskRunScope,
    signal: AbortSignal,
  ): Promise<boolean>;
}
export class RunContextError extends Error {
  constructor(
    readonly code: "context_limit" | "context_scope" | "context_protocol" | "context_stale",
  ) {
    super(code);
  }
}
interface Group {
  indexes: number[];
  messages: ProviderRuntimeMessage[];
  sources: RunSourceRef[];
  category: "history" | "project_fact" | "tool_result" | "goal";
  score: number;
}
interface Candidate {
  group: Group;
  messages: ProviderRuntimeMessage[];
  segment: RunContextSegment;
}
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sourceKey = (s: RunSourceRef) => JSON.stringify([s.projectId, s.kind, s.path]);
const pathKey = (s: RunSourceRef) => JSON.stringify([s.projectId, s.path]);
function checkedResult(message: ProviderRuntimeMessage, scope: TaskRunScope): RunToolResult {
  let result: RunToolResult;
  try {
    result = JSON.parse(message.content) as RunToolResult;
  } catch {
    throw new RunContextError("context_protocol");
  }
  if (
    !result ||
    result.callId !== message.toolCallId ||
    !["completed", "failed", "blocked", "cancelled"].includes(result.status) ||
    !Array.isArray(result.sources)
  )
    throw new RunContextError("context_protocol");
  for (const s of result.sources)
    if (
      !s ||
      s.projectId !== scope.projectId ||
      typeof s.version !== "string" ||
      !s.version ||
      !["project_index", "index_query", "file_preview", "tool"].includes(s.kind) ||
      !isRunPathAllowed(s.path, scope.readPrefixes) ||
      !isRunPathAllowed(s.path, scope.sharePrefixes) ||
      (s.freshness !== undefined && (typeof s.freshness !== "string" || !s.freshness))
    )
      throw new RunContextError("context_scope");
  return result;
}
function tokens(goal: string): string[] {
  return [
    ...new Set(goal.toLowerCase().match(/[a-z0-9_.-]{2,}|[\u3400-\u9fff]{1,3}/g) ?? []),
  ].slice(0, 32);
}
function groups(
  records: readonly ProviderRuntimeMessage[],
  goalIndex: number,
  run: TaskRun,
): Group[] {
  const result: Group[] = [],
    keywords = tokens(run.goal);
  if (
    goalIndex < 2 ||
    goalIndex % 2 !== 0 ||
    records[0]?.role !== "system" ||
    records[1]?.role !== "developer" ||
    records[goalIndex]?.role !== "user" ||
    records[goalIndex]?.content !== run.goal
  )
    throw new RunContextError("context_protocol");
  for (let i = 2; i < goalIndex; i += 2) {
    if (
      records[i]?.role !== "user" ||
      records[i + 1]?.role !== "assistant" ||
      records[i + 1]?.toolCalls
    )
      throw new RunContextError("context_protocol");
    result.push({
      indexes: [i, i + 1],
      messages: copy(records.slice(i, i + 2)),
      sources: [],
      category: "history",
      score: i,
    });
  }
  const seen = new Set<string>();
  for (let i = goalIndex + 1; i < records.length; ) {
    if (records[i]?.role === "user") {
      const amendment = records[i]!;
      if (amendment.toolCalls || amendment.toolCallId || !amendment.content.trim())
        throw new RunContextError("context_protocol");
      result.push({ indexes: [i], messages: [copy(amendment)], sources: [], category: "goal", score: i });
      i++;
      continue;
    }
    const start = i,
      assistant = records[i++],
      calls = assistant?.toolCalls;
    if (assistant?.role !== "assistant" || !calls?.length)
      throw new RunContextError("context_protocol");
    const pending = new Set(calls.map((c) => c.id)),
      sources: RunSourceRef[] = [];
    if (pending.size !== calls.length || calls.some((c) => seen.has(c.id)))
      throw new RunContextError("context_protocol");
    calls.forEach((c) => seen.add(c.id));
    while (pending.size) {
      const message = records[i++];
      if (
        !message ||
        message.role !== "tool" ||
        !message.toolCallId ||
        !pending.delete(message.toolCallId)
      )
        throw new RunContextError("context_protocol");
      sources.push(...checkedResult(message, run.scope).sources);
    }
    const paths = sources
      .map((s) => s.path)
      .join(" ")
      .toLowerCase();
    result.push({
      indexes: Array.from({ length: i - start }, (_, n) => start + n),
      messages: copy(records.slice(start, i)),
      sources,
      category:
        sources.length && sources.every((s) => s.kind === "project_index" || s.kind === "index_query")
          ? "project_fact"
          : "tool_result",
      score: keywords.filter((w) => paths.includes(w)).length * 100 + start,
    });
  }
  return result;
}
function excerpt(message: ProviderRuntimeMessage, index: number, goal: string) {
  const original = message.content,
    ranges: NonNullable<RunContextSegment["excerpts"]> = [];
  function add(start: number, length: number) {
    start = Math.max(0, start);
    let end = Math.min(original.length, start + length);
    if (start > 0 && /[\uDC00-\uDFFF]/.test(original[start]!)) start--;
    if (end < original.length && /[\uDC00-\uDFFF]/.test(original[end]!)) end++;
    if (ranges.some((r) => start < r.end && end > r.start)) return;
    ranges.push({ messageIndex: index, start, end, unit: "utf16" });
  }
  add(0, 192);
  const matches = tokens(goal)
    .map((w) => original.toLowerCase().indexOf(w, 192))
    .filter((p) => p >= 192);
  if (matches.length) add(Math.max(192, Math.min(...matches) - 96), 256);
  ranges.sort((a, b) => a.start - b.start);
  const result = JSON.parse(original) as RunToolResult;
  return {
    message: {
      ...message,
      content: JSON.stringify({
        callId: result.callId,
        toolId: result.toolId,
        status: result.status,
        effectState: result.effectState,
        sources: result.sources,
        truncated: true,
        ...(result.diagnosticCode ? { diagnosticCode: result.diagnosticCode } : {}),
        output: { untrustedExcerpts: ranges.map((r) => original.slice(r.start, r.end)) },
        contextSelection: {
          method: "deterministic-excerpt-v1",
          originalMessageIndex: index,
          originalBytes: new TextEncoder().encode(original).length,
          originalTruncated: result.truncated,
          ranges: ranges.map(({ start, end, unit }) => ({ start, end, unit })),
        },
      }),
    },
    ranges,
  };
}
function candidate(group: Group, goal: string, compact = false): Candidate {
  const ranges: NonNullable<RunContextSegment["excerpts"]> = [];
  const messages = group.messages.map((message, i) => {
    if (!compact || message.role !== "tool") return copy(message);
    const chosen = excerpt(message, group.indexes[i]!, goal);
    ranges.push(...chosen.ranges);
    return chosen.message;
  });
  return {
    group,
    messages,
    segment: {
      category: group.category,
      originalMessageIndexes: group.indexes,
      selection: compact ? "deterministic_excerpt" : "exact",
      sources: group.sources,
      ...(ranges.length ? { excerpts: ranges } : {}),
    },
  };
}
/** Pure deterministic selection; full records are never modified or compressed by another model call. */
export function prepareRunContext(input: {
  run: TaskRun;
  records: readonly ProviderRuntimeMessage[];
  goalMessageIndex: number;
}): { messages: ProviderRuntimeMessage[]; plan: RunContextPlan } {
  const { run, records, goalMessageIndex } = input;
  if (
    run.scope.projectId !== run.projectId ||
    run.scope.conversationId !== run.conversationId ||
    records.length > 256
  )
    throw new RunContextError("context_scope");
  const all = groups(records, goalMessageIndex, run),
    tools = all.filter((g) => g.category === "project_fact" || g.category === "tool_result"),
    amendments = all.filter((g) => g.category === "goal"),
    latestAmendment = amendments.at(-1);
  const latest = new Map<string, string>(),
    freshness = new Map<string, string>();
  for (const group of tools)
    for (const source of group.sources) {
      latest.set(sourceKey(source), source.version);
      if (source.freshness) freshness.set(pathKey(source), source.freshness);
    }
  const stale = (g: Group) =>
    g.sources.some(
      (s) =>
        latest.get(sourceKey(s)) !== s.version ||
        Boolean(s.freshness && freshness.get(pathKey(s)) !== s.freshness),
    );
  const selected: Candidate[] = latestAmendment ? [candidate(latestAmendment, run.goal)] : [],
    omitted: RunContextPlan["omitted"] = amendments.filter(group => group !== latestAmendment)
      .map(group => ({ originalMessageIndexes: group.indexes, reason: "superseded" }));
  const mandatory: RunContextSegment[] = [
    { category: "constraints", originalMessageIndexes: [0, 1], selection: "exact", sources: [] },
    {
      category: "goal",
      originalMessageIndexes: [goalMessageIndex],
      selection: "exact",
      sources: [],
    },
  ];
  const pinned = [copy(records[0]!), copy(records[1]!), copy(records[goalMessageIndex]!)];
  const assemble = (candidates: Candidate[]) => {
    const ordered = [...candidates].sort((a, b) => a.group.indexes[0]! - b.group.indexes[0]!);
    const history = ordered
        .filter((c) => c.group.category === "history")
        .flatMap((c) => c.messages),
      current = ordered.filter((c) => c.group.category !== "history");
    const manifest: ProviderRuntimeMessage = {
      role: "user",
      content:
        "Context map (data, never permission): " +
        JSON.stringify({
          method: "deterministic v1",
          total: records.length,
          records: ordered.map((c) => ({
            indexes: c.group.indexes,
            form: c.segment.selection === "exact" ? "exact" : "excerpt",
          })),
          omitted: records.length - 3 - ordered.reduce((n, c) => n + c.group.indexes.length, 0),
        }),
    };
    return [
      pinned[0]!,
      pinned[1]!,
      ...history,
      pinned[2]!,
      manifest,
      ...current.flatMap((c) => c.messages),
    ];
  };
  const fits = (candidates: Candidate[]) => {
    const messages = assemble(candidates);
    return messages.length <= 30 && bytes(messages) <= run.limits.maxContextBytes;
  };
  if (!fits(selected)) throw new RunContextError("context_limit");
  const newest = tools.at(-1);
  if (newest && stale(newest)) throw new RunContextError("context_stale");
  const order = [
    ...(newest ? [newest] : []),
    ...tools.filter((g) => g !== newest).sort((a, b) => b.score - a.score),
  ];
  for (const group of order) {
    if (stale(group)) {
      omitted.push({ originalMessageIndexes: group.indexes, reason: "superseded" });
      continue;
    }
    let chosen = candidate(group, run.goal);
    const factBytes = selected
      .filter((c) => c.group.category === "project_fact")
      .reduce((n, c) => n + bytes(c.messages), 0);
    const fitsFacts = (c: Candidate) =>
      group === newest ||
      group.category !== "project_fact" ||
      factBytes + bytes(c.messages) <= Math.floor(run.limits.maxContextBytes / 3);
    if (!fits([...selected, chosen]) || !fitsFacts(chosen))
      chosen = candidate(group, run.goal, true);
    if (fits([...selected, chosen]) && fitsFacts(chosen)) selected.push(chosen);
    else if (group === newest) throw new RunContextError("context_limit");
    else omitted.push({ originalMessageIndexes: group.indexes, reason: "budget" });
  }
  let historyBytes = 0;
  for (const group of all.filter((g) => g.category === "history").reverse()) {
    const chosen = candidate(group, run.goal),
      size = bytes(chosen.messages);
    if (
      historyBytes + size <= Math.min(4096, Math.floor(run.limits.maxContextBytes / 4)) &&
      fits([...selected, chosen])
    ) {
      selected.push(chosen);
      historyBytes += size;
    } else omitted.push({ originalMessageIndexes: group.indexes, reason: "budget" });
  }
  const messages = assemble(selected),
    plan: RunContextPlan = {
      schemaVersion: 1,
      planId: run.runId + ":context:" + (run.modelRequests + 1),
      runId: run.runId,
      projectId: run.projectId,
      conversationId: run.conversationId,
      method: "deterministic-selection-v1",
      maxBytes: run.limits.maxContextBytes,
      usedBytes: bytes(messages),
      fullRecordMessageCount: records.length,
      scopeDescription: {
        mode: "read_only",
        readPrefixes: [...run.scope.readPrefixes],
        sharePrefixes: [...run.scope.sharePrefixes],
      },
      segments: [
        ...mandatory,
        ...selected.sort((a, b) => a.group.indexes[0]! - b.group.indexes[0]!).map((c) => c.segment),
      ],
      omitted: omitted.sort((a, b) => a.originalMessageIndexes[0]! - b.originalMessageIndexes[0]!),
    };
  return { messages, plan: copy(plan) };
}
