#!/usr/bin/env node
/* global console, fetch, process */

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, relative, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

const TASK_ROOT = /^mvp15d-ue581-compat-\d{8}_\d{6}$/;
const TOOL_SEARCH_META_TOOLS = ["call_tool", "describe_toolset", "list_toolsets"];
const UAGENT_TOOLS = [
  "ue.asset.create_folder",
  "ue.asset.duplicate",
  "ue.asset.rename",
  "ue.asset.move",
  "ue.asset.delete",
  "ue.asset.save",
];

class ProbeError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new ProbeError(code);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      fail("UE581_PROBE_ARGUMENT_INVALID");
    }
    result[key.slice(2)] = value;
  }
  return result;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stable(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("UE581_PROBE_NONFINITE_NUMBER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  fail("UE581_PROBE_VALUE_INVALID");
}

function resolveOutput(value) {
  const output = resolve(value);
  const repository = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const external = resolve(repository, "external");
  const root = resolve(output, "..");
  if (
    relative(external, root).startsWith("..") ||
    resolve(root, "..") !== external ||
    !TASK_ROOT.test(basename(root)) ||
    basename(output) !== "mcp-probe" ||
    !existsSync(root)
  ) {
    fail("UE581_PROBE_OUTPUT_INVALID");
  }
  if (existsSync(output)) fail("UE581_PROBE_OUTPUT_EXISTS");
  mkdirSync(output);
  return { output, root };
}

function parseTerminalResponse(contentType, body, expectedId) {
  let messages;
  if (contentType.includes("text/event-stream")) {
    messages = body
      .split(/\r?\n\r?\n/)
      .flatMap((event) =>
        event
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => JSON.parse(line.slice(5).trim())),
      );
  } else {
    messages = [JSON.parse(body)];
  }
  const terminal = messages.filter(
    (message) =>
      message &&
      message.jsonrpc === "2.0" &&
      message.id === expectedId &&
      (Object.hasOwn(message, "result") || Object.hasOwn(message, "error")),
  );
  if (terminal.length !== 1) fail("UE581_PROBE_TERMINAL_RESULT_INVALID");
  return { messages, terminal: terminal[0] };
}

async function exchange(endpoint, request, sessionId) {
  const headers = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": "2025-06-18",
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  });
  const body = await response.text();
  const responseHeaders = Object.fromEntries(
    [...response.headers.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    request,
    requestHeaders: headers,
    response: {
      status: response.status,
      headers: responseHeaders,
      body,
      bodySize: Buffer.byteLength(body),
      bodySha256: sha256(Buffer.from(body, "utf8")),
    },
  };
}

async function runProbe(argv) {
  const args = parseArgs(argv);
  const endpoint = args.endpoint;
  if (!/^http:\/\/127\.0\.0\.1:(?:[1-9]\d{3,4})\/mcp$/.test(endpoint ?? "")) {
    fail("UE581_PROBE_ENDPOINT_INVALID");
  }
  if (!/^[A-Za-z0-9._:-]{24,160}$/.test(args.marker ?? "")) {
    fail("UE581_PROBE_MARKER_INVALID");
  }
  const { output, root } = resolveOutput(args.output);
  const initialize = await exchange(
    endpoint,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "uagent-mvp15d-ue581-probe", version: "1.0.0" },
      },
    },
    null,
  );
  if (initialize.response.status !== 200) fail("UE581_INITIALIZE_HTTP_FAILED");
  const initializedMessage = parseTerminalResponse(
    initialize.response.headers["content-type"] ?? "",
    initialize.response.body,
    1,
  );
  const sessionId = initialize.response.headers["mcp-session-id"];
  if (!sessionId) fail("UE581_INITIALIZE_SESSION_MISSING");
  const notification = await exchange(
    endpoint,
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    sessionId,
  );
  if (![200, 202, 204].includes(notification.response.status)) {
    fail("UE581_INITIALIZED_NOTIFICATION_FAILED");
  }
  const discovery = await exchange(
    endpoint,
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    sessionId,
  );
  if (discovery.response.status !== 200) fail("UE581_DISCOVERY_HTTP_FAILED");
  const discoveryMessage = parseTerminalResponse(
    discovery.response.headers["content-type"] ?? "",
    discovery.response.body,
    2,
  );
  const tools = discoveryMessage.terminal?.result?.tools;
  if (!Array.isArray(tools)) fail("UE581_DISCOVERY_TOOLS_INVALID");
  const toolNames = tools.map((tool) => tool?.name);
  if (toolNames.some((name) => typeof name !== "string")) fail("UE581_DISCOVERY_TOOLS_INVALID");
  const sortedToolNames = [...toolNames].sort();
  const metaToolsPresent = TOOL_SEARCH_META_TOOLS.every((name) => toolNames.includes(name));
  const uagentTools = toolNames.filter((name) => name.startsWith("ue.asset."));
  const exactSix =
    uagentTools.length === UAGENT_TOOLS.length &&
    UAGENT_TOOLS.every((name, index) => uagentTools[index] === name);
  const capturedAt = new Date().toISOString();
  const transcript = {
    schemaVersion: "uagent.mvp15d.ue581.mcp-probe.v1",
    taskGeneration: "final-d13-d16",
    marker: args.marker,
    endpoint,
    capturedAt,
    processId: process.pid,
    sessionId,
    exchanges: { initialize, notification, discovery },
  };
  const transcriptPath = resolve(output, "transcript.json");
  writeFileSync(transcriptPath, `${JSON.stringify(transcript, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  const summary = {
    schemaVersion: "uagent.mvp15d.ue581.mcp-probe-summary.v1",
    taskGeneration: "final-d13-d16",
    marker: args.marker,
    endpoint,
    capturedAt,
    status: exactSix ? "compatible" : "partial",
    initializeProtocolVersion: initializedMessage.terminal?.result?.protocolVersion ?? null,
    sessionId,
    toolNames,
    sortedToolNames,
    toolNamesSha256: sha256(Buffer.from(stable(toolNames), "utf8")),
    metaToolsPresent,
    expectedToolSearchMetaTools: TOOL_SEARCH_META_TOOLS,
    uagentTools,
    exactSix,
    transcript: {
      path: relative(root, transcriptPath).replaceAll("\\", "/"),
      size: lstatSync(transcriptPath).size,
      sha256: sha256(readFileSync(transcriptPath)),
    },
  };
  writeFileSync(resolve(output, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runProbe(process.argv.slice(2))
    .then((result) => {
      console.log(JSON.stringify(result));
      process.exitCode = result.status === "compatible" ? 0 : 2;
    })
    .catch((error) => {
      console.error(error instanceof ProbeError ? error.code : error);
      process.exitCode = 1;
    });
}

export { ProbeError, parseTerminalResponse, runProbe };
