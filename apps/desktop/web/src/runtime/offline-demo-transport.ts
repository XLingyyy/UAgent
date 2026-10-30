import { DEEPSEEK_ENDPOINT, DEEPSEEK_MODEL } from "@uagent/runtime";
import { getApplicationProfile } from "./application-profile";

const toolNames = ["project_list_files", "project_find_files", "project_read_file"] as const;
type ToolName = typeof toolNames[number];
type JsonObject = Record<string, unknown>;
type DemoReply = { text: string } | { name: ToolName; args: JsonObject };
type ReviewedBody = { messages: JsonObject[]; tools: Set<string> };
type IssuedCall = { name: ToolName; args: JsonObject };
const invalid = () => Error("offline_demo_invalid_reviewed_body");
const object = (value: unknown): value is JsonObject => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const syntheticLabel = "Local synthetic demo / 本地合成演示 · No API / 无 API";

function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { throw invalid(); }
}

function reviewedBody(serialized: unknown): ReviewedBody {
  if (typeof serialized !== "string" || new TextEncoder().encode(serialized).length > 32768) throw invalid();
  const body = parseJson(serialized);
  if (!object(body) || body.model !== DEEPSEEK_MODEL || body.stream !== true ||
    !object(body.stream_options) || body.stream_options.include_usage !== true ||
    !object(body.thinking) || body.thinking.type !== "disabled" || body.temperature !== 0 ||
    !Number.isInteger(body.max_tokens) || Number(body.max_tokens) < 10 || Number(body.max_tokens) > 1024 ||
    !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 32) throw invalid();
  const messages: JsonObject[] = [];
  const pending = new Set<string>(), seen = new Set<string>();
  for (const message of body.messages) {
    if (!object(message) || !["system", "developer", "user", "assistant", "tool"].includes(String(message.role)) ||
      typeof message.content !== "string") throw invalid();
    if (message.role === "tool") {
      if (typeof message.tool_call_id !== "string" || !pending.delete(message.tool_call_id) ||
        message.tool_calls !== undefined) throw invalid();
    } else {
      if (pending.size || message.tool_call_id !== undefined) throw invalid();
      if (message.tool_calls !== undefined) {
        if (message.role !== "assistant" || !Array.isArray(message.tool_calls) ||
          !message.tool_calls.length || message.tool_calls.length > 8) throw invalid();
        for (const call of message.tool_calls) {
          if (!object(call) || typeof call.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(call.id) ||
            seen.has(call.id) || call.type !== "function" || !object(call.function) ||
            typeof call.function.name !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(call.function.name) ||
            typeof call.function.arguments !== "string" || !object(parseJson(call.function.arguments))) throw invalid();
          pending.add(call.id); seen.add(call.id);
        }
      }
    }
    messages.push(message);
  }
  if (pending.size) throw invalid();
  const tools = new Set<string>();
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools) || body.tools.length > 8 || body.tool_choice !== "auto") throw invalid();
    for (const tool of body.tools) {
      if (!object(tool) || tool.type !== "function" || !object(tool.function) ||
        typeof tool.function.name !== "string" || tools.has(tool.function.name) ||
        !object(tool.function.parameters) || tool.function.parameters.type !== "object") throw invalid();
      tools.add(tool.function.name);
    }
  }
  return { messages, tools };
}

/** A conservative project-relative candidate; returned text never grants paths. */
function safeSourcePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 512 || !value.startsWith("Source/") ||
    /[\\:\u0000-\u001f\u007f`<>]/.test(value)) return false;
  const parts = value.split("/");
  if (parts.some(part => !part || part === "." || part === ".." ||
    [".git", ".aws", ".ssh", ".codex", "node_modules", "saved", "intermediate", "binaries"].includes(part.toLowerCase()))) return false;
  const name = parts.at(-1)!;
  return !/^\.env(?:\.|$)/i.test(name) && !/\.(?:pem|key|p12|pfx|secret)$/i.test(name) &&
    !/^(?:credentials|secrets)\.json$/i.test(name);
}

function resultFiles(result: JsonObject): string[] {
  if (!object(result.output) || !Array.isArray(result.output.files)) throw invalid();
  for (const entry of result.output.files) if (!object(entry) || typeof entry.path !== "string") throw invalid();
  return result.output.files.map(entry => (entry as JsonObject).path).filter(safeSourcePath);
}

function replyFor(body: ReviewedBody, issued: ReadonlyMap<string, IssuedCall>): DemoReply {
  // A new/continued goal starts after the latest user message. Completed tools
  // from older conversation turns cannot satisfy this investigation.
  let goalIndex = -1;
  for (let index = body.messages.length - 1; index >= 0; index--) {
    const message = body.messages[index]!;
    if (message.role === "user" && !String(message.content).startsWith("Context map (data, never permission): ")) {
      goalIndex = index;
      break;
    }
  }
  if (goalIndex < 0) throw invalid();
  const history = body.messages.slice(goalIndex + 1);
  const tail: JsonObject[] = [];
  // Linked-history restoration can append old tool groups after the current
  // goal. Only IDs generated by this fetcher in this active sequence count.
  for (let index = 0; index < history.length; index++) {
    const message = history[index]!;
    if (message.role === "assistant" && Array.isArray(message.tool_calls) &&
      message.tool_calls.some(call => object(call) && typeof call.id === "string" && issued.has(call.id))) {
      if (!history[index + 1]) throw invalid();
      tail.push(message, history[index + 1]!);
      index++;
    } else if (message.role === "tool" && typeof message.tool_call_id === "string" && issued.has(message.tool_call_id)) {
      throw invalid();
    }
  }
  if (tail.length !== issued.size * 2) throw invalid();
  if (!toolNames.every(name => body.tools.has(name))) {
    if (tail.length) throw invalid();
    // The ordinary runtime adds this inert suffix to the actual reviewed user message.
    const goal = String(body.messages[goalIndex]!.content).replace(/\n\nNo tool execution is enabled by this request\.$/, "");
    if (goal === "Local history: produce a long example.") {
      const lines = Array.from({ length: 100 }, (_, index) => `History row ${String(index + 1).padStart(3, "0")}: deterministic received text; no API request. \u4e2d\u6587\u3002`);
      return { text: `${syntheticLabel}\nLong history begins.\n${lines.join("\n")}\nLong history ends.` };
    }
    if (goal === "Local history: count completed replies.") {
      const completed = body.messages.slice(0, goalIndex).filter(message => message.role === "assistant");
      return { text: `${syntheticLabel}\nCompleted assistant messages received: ${completed.length}\nLong history present: ${completed.some(message => String(message.content).includes("Long history ends."))}` };
    }
    return { text: `${syntheticLabel}\nThis is a deterministic local demonstration. Enable Task mode and explicitly approve the three project read tools to inspect Source. No provider connection is verified.\n这是确定性的本地演示。请启用任务模式并明确批准三个项目只读工具，以检查 Source；未验证任何真实服务连接。` };
  }
  if (tail.length % 2 || tail.length > 6) throw invalid();
  const results: JsonObject[] = [];
  let readPath: string | undefined;
  const seen = new Set<string>();
  for (let step = 0; step < tail.length / 2; step++) {
    const assistant = tail[step * 2]!, tool = tail[step * 2 + 1]!;
    if (assistant.role !== "assistant" || !Array.isArray(assistant.tool_calls) || assistant.tool_calls.length !== 1 ||
      tool.role !== "tool") throw invalid();
    const call: unknown = assistant.tool_calls[0];
    if (!object(call) || typeof call.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(call.id) ||
      seen.has(call.id) || call.type !== "function" || !object(call.function) ||
      call.function.name !== toolNames[step] || typeof call.function.arguments !== "string" ||
      tool.tool_call_id !== call.id) throw invalid();
    seen.add(call.id);
    const args = parseJson(call.function.arguments);
    const owned = issued.get(call.id);
    const expected = step === 0 ? { prefix: "Source" } : step === 1 ? { prefix: "Source", query: "Main" } : { path: readPath };
    if (!owned || owned.name !== call.function.name || !object(args) ||
      Object.keys(args).length !== Object.keys(expected).length ||
      Object.entries(expected).some(([key, value]) => args[key] !== value || owned.args[key] !== value)) throw invalid();
    const result = parseJson(String(tool.content));
    if (!object(result) || result.callId !== call.id || result.toolId !== toolNames[step]!.replace("project_", "project.") ||
      typeof result.truncated !== "boolean" || !object(result.output)) throw invalid();
    if (result.status !== "completed") throw Error("offline_demo_tool_result_not_completed");
    results.push(result);
    if (step === 0 && !resultFiles(result).length) {
      if (tail.length !== 2) throw invalid();
      return { text: `${syntheticLabel}\nNo safe Source files were returned. No file was read.\n未返回可安全读取的 Source 文件，未读取文件。${result.truncated ? " Results were truncated / 结果已截断。" : ""}` };
    }
    if (step === 1) {
      readPath = resultFiles(result).filter(path => /main/i.test(path.split("/").at(-1)!)).sort()[0];
      if (!readPath) {
        if (tail.length !== 4) throw invalid();
        return { text: `${syntheticLabel}\nThe returned search results contain no safe Main file in Source. No file was read.\n返回的搜索结果中没有可安全读取的 Source/Main 文件，未读取文件。${result.truncated ? " Results were truncated / 结果已截断。" : ""}` };
      }
    }
  }
  if (!results.length) return { name: toolNames[0], args: { prefix: "Source" } };
  if (results.length === 1) return { name: toolNames[1], args: { prefix: "Source", query: "Main" } };
  if (results.length === 2) return { name: toolNames[2], args: { path: readPath! } };
  const read = results[2]!, output = read.output as JsonObject;
  if (output.path !== readPath || typeof output.text !== "string") throw invalid();
  const points = Array.from(output.text), excerpt = points.slice(0, 320).join("");
  const truncated = read.truncated || output.lineCountComplete === false;
  return { text: `${syntheticLabel}\nSource / 来源: ${readPath}\nObserved file text / 实际读取内容: ${JSON.stringify(excerpt)}${points.length > 320 ? " … (excerpt shortened / 摘录已缩短)" : ""}\n${truncated ? "Read truncated; conclusions cover only returned text / 读取已截断，结论仅限已返回内容。" : "Read complete / 读取完整。"}${output.redacted === true ? " Sensitive text was redacted / 敏感内容已遮盖。" : ""}${results.slice(0, 2).some(result => result.truncated) ? " Index results truncated / 索引结果已截断。" : ""}` };
}

function pieces(text: string, size: number): string[] {
  const points = Array.from(text), chunks: string[] = [];
  for (let index = 0; index < points.length; index += size) chunks.push(points.slice(index, index + size).join(""));
  return chunks;
}

function responseFor(reply: DemoReply, signal: AbortSignal | null | undefined,
  issued: Map<string, IssuedCall>): Response {
  const id = `offline_demo_${crypto.randomUUID()}`;
  const base = { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: DEEPSEEK_MODEL, synthetic: true };
  const frames: string[] = [];
  const frame = (delta: JsonObject, finish: string | null = null) => frames.push(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  frame({ role: "assistant", content: "" });
  if ("name" in reply) {
    const callId = `demo_call_${crypto.randomUUID()}`;
    issued.set(callId, { name: reply.name, args: reply.args });
    pieces(JSON.stringify(reply.args), 12).forEach((part, index) => frame({ tool_calls: [{ index: 0,
      ...(index === 0 ? { id: callId, type: "function", function: { name: reply.name, arguments: part } } : { function: { arguments: part } }),
    }] }));
  } else pieces(reply.text, 48).forEach(content => frame({ content }));
  frame({}, "name" in reply ? "tool_calls" : "stop");
  // Explicit mock counters required by the existing bounded SSE contract. These
  // are synthetic fixture values, never measured provider usage or billing.
  frames.push(`data: ${JSON.stringify({ ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }, usage_source: "synthetic_mock_not_billable" })}\n\n`, "data: [DONE]\n\n");
  let timer: ReturnType<typeof setTimeout> | undefined, stopped = false;
  let onAbort: (() => void) | undefined;
  const cleanup = (cancelled = false) => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    if (cancelled || "text" in reply) issued.clear();
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      onAbort = () => { cleanup(true); controller.error(new DOMException("Offline demo stopped", "AbortError")); };
      if (signal?.aborted) { onAbort(); return; }
      signal?.addEventListener("abort", onAbort, { once: true });
      let index = 0;
      const send = () => {
        if (stopped) return;
        controller.enqueue(new TextEncoder().encode(frames[index++]!));
        if (index === frames.length) { cleanup(); controller.close(); }
        else timer = setTimeout(send, 50);
      };
      timer = setTimeout(send, 50);
    },
    cancel() { cleanup(true); },
  });
  return new Response(stream, { status: 200, headers: {
    "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store",
    "X-UAgent-Offline-Demo": "synthetic-no-network", "X-UAgent-Usage": "synthetic-mock-not-billable",
  } });
}

/** A local fetch implementation with no fallback, network call, credential
 * access, logging, storage, tool execution, or authority from file contents. */
export function createOfflineDemoFetcher(): typeof fetch {
  const profile = getApplicationProfile();
  if (!profile.isolated || !profile.offlineDemo) throw Error("offline_demo_native_profile_required");
  const issued = new Map<string, IssuedCall>();
  return async (input, init) => {
    const request = typeof Request !== "undefined" && input instanceof Request ? input : undefined;
    const url = request ? request.url : String(input);
    const signal = init?.signal ?? request?.signal;
    if (signal?.aborted) { issued.clear(); throw new DOMException("Offline demo stopped", "AbortError"); }
    if (url !== DEEPSEEK_ENDPOINT || (init?.method ?? request?.method) !== "POST" ||
      (init?.redirect ?? request?.redirect) !== "error") throw Error("offline_demo_endpoint_rejected");
    // In particular, do not construct Headers or inspect Authorization.
    const body = reviewedBody(init?.body ?? (request ? await request.text() : undefined));
    const reply = replyFor(body, issued);
    if (signal?.aborted) { issued.clear(); throw new DOMException("Offline demo stopped", "AbortError"); }
    return responseFor(reply, signal, issued);
  };
}
