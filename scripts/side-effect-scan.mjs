#!/usr/bin/env node

/**
 * UAgent Side-effect Scan
 *
 * Scans the codebase for potential boundary violations:
 * - Provider/secret/Authorization terms in non-contract code
 * - React components directly calling provider fetch/HTTP
 * - Raw API keys in state/events/traces
 * - UE write / mutating MCP tool paths
 * - Shell/browser/filesystem capability
 *
 * Usage: node scripts/side-effect-scan.mjs
 */

/* global console, process */
import { readFileSync, readdirSync, existsSync } from "fs";
import { join, resolve, extname } from "path";

const ROOT = resolve(import.meta.dirname, "..");

// ============================================================
// File walker (pure Node.js, no external deps)
// ============================================================

const SCAN_DIRS = ["packages", "apps", "scripts", "tools", "docs"];
const ALLOWED_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".md"]);
const EXCLUDE_DIRS = new Set(["node_modules", "dist", ".git", "__pycache__", "fixtures", "coverage"]);
const EXCLUDE_FILES = [/\.d\.ts$/, /\.test\./, /\.spec\./];

// Rust is intentionally not added to the general walker: legacy keyword scans were
// designed for TS/JS and would turn native implementation details into thousands of
// unrelated review findings. MVP15 authority scans below read only the production
// boundary files that own the native invariants.
const MVP15_AUTHORITY_FILES = [
  "apps/desktop/src-tauri/src/asset_mutation.rs",
  "apps/desktop/src-tauri/src/lib.rs",
  "apps/desktop/src-tauri/src/ue_editor_process.rs",
  "apps/desktop/web/src/runtime/project-native-adapter.ts",
  "apps/desktop/web/src/runtime/desktop-runtime-adapter.ts",
  "packages/runtime/src/mvp15-mcp-asset-adapter.ts",
  "packages/shared/src/asset-mutation.ts",
];

function collectFiles(dir, results = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.has(entry.name)) {
        collectFiles(fullPath, results);
      }
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      if (ALLOWED_EXTS.has(ext) && !EXCLUDE_FILES.some((r) => r.test(entry.name))) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

// Special: include README.md at root
function getFileList() {
  const files = [];
  for (const d of SCAN_DIRS) {
    const dirPath = join(ROOT, d);
    if (existsSync(dirPath)) {
      collectFiles(dirPath, files);
    }
  }
  const readme = join(ROOT, "README.md");
  if (existsSync(readme)) files.push(readme);
  return files;
}

// ============================================================
// Scan Categories
// ============================================================

function isTitleBarWindowInternals(rel, line) {
  return /apps\/desktop\/web\/src\/shell\/TitleBar/.test(rel)
    && /@tauri-apps\/api|plugin:window\||__TAURI_INTERNALS__/.test(line);
}

function isTitleBarMcpReadOnlyStatus(rel, line) {
  return /apps\/desktop\/web\/src\/shell\/TitleBar/.test(rel)
    && /read-only tools only.*MCP calls are blocked/.test(line);
}

function isMvp15SaveAllEvidenceSummary(rel, line) {
  return /packages\/runtime\/src\/mvp15-asset-changeset/.test(rel)
    && (/single sandbox asset save, not Save All/.test(line)
      || /evidenceQuery\(changeSetId, operation\.id, "saved"/.test(line));
}

const CATEGORIES = [
  {
    id: "provider-secret-boundary",
    title: "Provider / Secret Boundary",
    description: "Provider wire API, auth, and secret terms in UI/state code (excludes docs/tests/contracts)",
    patterns: [
      { re: /fetch\s*\(/gi, label: "fetch()" },
      { re: /process\.env\./gi, label: "process.env.*" },
      { re: /apiKey\s*[:=]/gi, label: "apiKey assignment" },
      { re: /Authorization\s*[:=]/gi, label: "Authorization header" },
      { re: /Bearer\s+[A-Za-z0-9]{8,}/g, label: "Bearer token literal" },
      { re: /import\s+\w+\s+from\s+["']openai["']/gi, label: "OpenAI SDK import" },
    ],
    allowWhen: [
      (rel) => /packages\/(shared|runtime|mcp-client)\/src\//.test(rel),
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /package\.json/.test(rel),
      (rel) => /scripts\//.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(composer|settings|workspace|app|components)\//.test(rel),
    ],
  },
  {
    id: "mcp-tool-calls",
    title: "MCP Tool Calls",
    description: "MCP tool call / resource read method calls outside runtime",
    patterns: [
      { re: /["']tools\/call["']/gi, label: "'tools/call'" },
      { re: /["']resources\/read["']/gi, label: "'resources/read'" },
    ],
    allowWhen: [
      (rel) => /packages\/(mcp-client|runtime)\/src\//.test(rel),
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\//.test(rel),
    ],
  },
  {
    id: "ue-write-mutating",
    title: "UE Write / Mutating",
    description: "UE write or mutating MCP tool method calls in non-policy code",
    patterns: [
      { re: /\bsave\s*\(/gi, label: "save()" },
      { re: /\bcompile\s*\(/gi, label: "compile()" },
      { re: /\bapply\s*\(/gi, label: "apply()" },
      { re: /\brun\s*\(/gi, label: "run()" },
      { re: /\blaunch\s*\(/gi, label: "launch()" },
      { re: /mutate/gi, label: "mutate" },
    ],
    allowWhen: [
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /mcp-readonly-policy/.test(rel),
      (rel) => /agent-planner/.test(rel),
      (rel) => /disabled/.test(rel),
      (rel) => /policy/.test(rel),
      (rel) => /blocked/.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(composer|settings|workspace|app|components)\//.test(rel),
    ],
  },
  {
    id: "os-capability",
    title: "OS Capability (Shell / Filesystem / Process)",
    description: "OS-level shell, filesystem, and process execution capability (excludes UI shell/browser labels)",
    patterns: [
      { re: /\bspawn(Sync)?\s*\(/gi, label: "spawn()" },
      { re: /\bexec(Sync|File)?\s*\(/gi, label: "exec()" },
      { re: /\bfork\s*\(/gi, label: "fork()" },
      { re: /child_process/gi, label: "child_process" },
      { re: /\bexecCommand\s*\(/gi, label: "execCommand()" },
      { re: /fs\.(writeFile|appendFile|unlink|rm|rmdir|mkdir)\s*\(/gi, label: "fs write/delete" },
    ],
    allowWhen: [
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /package\.json/.test(rel),
      (rel) => /scripts\//.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\//.test(rel),
      (rel) => /packages\/runtime\/src\//.test(rel),
    ],
  },
  {
    id: "react-direct-provider",
    title: "React Direct Provider Access",
    description: "React components must not directly import provider runtime classes",
    patterns: [
      { re: /ProviderRunner/gi, label: "ProviderRunner" },
      { re: /ProviderAdapter/gi, label: "ProviderAdapter" },
      { re: /McpSession/gi, label: "McpSession" },
      { re: /StreamableHttpTransport/gi, label: "StreamableHttpTransport" },
      { re: /LegacySseTransport/gi, label: "LegacySseTransport" },
    ],
    allowWhen: [
      (rel) => /packages\//.test(rel),
      (rel) => /apps\/desktop\/web\/src\/runtime\//.test(rel),
      (rel) => /apps\/desktop\/web\/src\/stores\//.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(composer|settings|workspace|inspector|sidebar|app|components)\//.test(rel),
    ],
  },
  {
    id: "mvp6-ui-product-side-effects",
    title: "MVP6 UI Product Side Effects",
    description: "React product UI must not directly open browser/storage/clipboard/project side effects",
    patterns: [
      { re: /window\.open\s*\(/gi, label: "window.open()" },
      { re: /location\.href\s*=/gi, label: "location.href assignment" },
      { re: /localStorage\./gi, label: "localStorage.*" },
      { re: /sessionStorage\./gi, label: "sessionStorage.*" },
      { re: /navigator\.clipboard/gi, label: "navigator.clipboard" },
      { re: /show(Open|Save)FilePicker\s*\(/gi, label: "file picker" },
      { re: /getDisplayMedia\s*\(/gi, label: "screen capture" },
    ],
    allowWhen: [
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\//.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(composer|settings|workspace|inspector|sidebar|shell|app|components)\//.test(rel),
    ],
  },
  {
    id: "mvp7-project-index-boundary",
    title: "MVP7 Project Index Boundary",
    description: "React UI must not directly scan local files, call Tauri project commands, or keep raw paths",
    patterns: [
      { re: /@tauri-apps\/api/gi, label: "Tauri API import" },
      { re: /\binvoke\s*\(\s*["'](validate_project_root|scan_project_index|preview_project_file)/gi, label: "Tauri project command" },
      { re: /\b(fs|path)\s+from\s+["']node:(fs|path)["']/gi, label: "node fs/path import" },
      { re: /C:\\Users\\/gi, label: "raw Windows home path" },
      { re: /\/home\/[A-Za-z0-9._-]+\//g, label: "raw Linux home path" },
    ],
    allowWhen: [
      (rel) => /packages\/(shared|runtime)\/src\//.test(rel),
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\//.test(rel),
      (rel) => /apps\/desktop\/src-tauri\//.test(rel),
      isTitleBarWindowInternals,
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(app|components|composer|inspector|settings|shell|sidebar|workspace)\//.test(rel),
    ],
  },
  {
    id: "mvp7-capability-bridge-boundary",
    title: "MVP7 Capability Bridge Boundary",
    description: "Capability UI must not execute shell, browser automation, screenshot capture, writes, or live provider fetch",
    patterns: [
      { re: /child_process|spawn\s*\(|exec\s*\(/gi, label: "shell execution" },
      { re: /window\.open\s*\(|location\.href\s*=/gi, label: "browser navigation side effect" },
      { re: /getDisplayMedia\s*\(/gi, label: "screen capture" },
      { re: /writeFile|appendFile|unlink|rename|mkdir|rmdir|rm\s*\(/gi, label: "filesystem mutation" },
      { re: /fetch\s*\([^)]*provider/gi, label: "provider live fetch" },
    ],
    allowWhen: [
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\//.test(rel),
      (rel) => /packages\/runtime\/src\/mvp7-project-index/.test(rel),
      (rel) => /packages\/runtime\/src\/mvp9-terminal-policy/.test(rel),
      (rel) => /packages\/runtime\/src\/mvp10-terminal-policy/.test(rel),
      (rel) => /packages\/runtime\/src\/mvp10-scenarios/.test(rel),
      (rel) => /packages\/runtime\/src\/mcp-readonly-policy/.test(rel),
      (rel) => /packages\/runtime\/src\/mvp13-/.test(rel),
      (rel) => /packages\/runtime\/src\/mvp14-/.test(rel),
      (rel) => /packages\/runtime\/src\/mvp15-/.test(rel),
      (rel) => /apps\/desktop\/web\/src\/(runtime\/runtime-store|stores\/ui-store)/.test(rel),
      (rel) => /packages\/runtime\/src\/sandbox-policy/.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\//.test(rel),
      (rel) => /packages\/runtime\/src\/(?!mvp7-project-index|mvp9-terminal-policy|mvp10-terminal-policy|mvp10-scenarios|mvp13-|mvp14-|mvp15-)/.test(rel),
    ],
  },
  {
    id: "mvp8-native-fs-boundary",
    title: "MVP8 Native FS Bridge Boundary",
    description: "React UI must not directly invoke Tauri native FS commands",
    patterns: [
      { re: /invoke\s*\(\s*["'](trust_native_project_root|cancel_native_project_scan|validate_native_project_root|scan_native_project_index|preview_native_project_file)/gi, label: "Tauri native FS command" },
      { re: /@tauri-apps\/api/gi, label: "Tauri API import" },
      { re: /node:fs\s*\(/gi, label: "direct fs access" },
      { re: /\bRawFsAdapter/gi, label: "RawFsAdapter" },
    ],
    allowWhen: [
      (rel) => /packages\/(shared|runtime)\/src\//.test(rel),
      (rel) => /apps\/desktop\/web\/src\/runtime\//.test(rel),
      (rel) => /apps\/desktop\/src-tauri\//.test(rel),
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\//.test(rel),
      isTitleBarWindowInternals,
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(app|components|composer|inspector|settings|shell|sidebar|workspace)\//.test(rel),
    ],
  },
  {
    id: "mvp9-terminal-exec-boundary",
    title: "MVP9 Terminal Exec Boundary",
    description: "React UI must not directly execute shell commands or terminal operations",
    patterns: [
      { re: /child_process/gi, label: "child_process" },
      { re: /\bspawn(Sync)?\s*\(/gi, label: "spawn()" },
      { re: /\bexec(Sync|File)?\s*\(/gi, label: "exec()" },
      { re: /\.execCommand\s*\(/gi, label: "execCommand()" },
      { re: /\bterminal\s*\.\s*execute\s*\(/gi, label: "terminal.execute()" },
    ],
    allowWhen: [
      (rel) => /packages\/runtime\/src\/mvp9-terminal/.test(rel),
      (rel) => /packages\/shared\/src\/terminal/.test(rel),
      (rel) => /apps\/desktop\/src-tauri\//.test(rel),
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\//.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(app|components|composer|inspector|settings|shell|sidebar|workspace)\//.test(rel),
    ],
  },
  {
    id: "mvp9-browser-preview-boundary",
    title: "MVP9 Browser Preview Boundary",
    description: "React UI must not directly open browser windows or navigate to URLs",
    patterns: [
      { re: /window\.open\s*\(/gi, label: "window.open()" },
      { re: /location\.href\s*=/gi, label: "location.href assignment" },
      { re: /\.open\(/gi, label: ".open()" },
    ],
    allowWhen: [
      (rel) => /packages\/runtime\/src\/mvp9-browser/.test(rel),
      (rel) => /packages\/shared\/src\/browser-preview/.test(rel),
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\//.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(app|components|composer|inspector|settings|shell|sidebar|workspace)\//.test(rel),
    ],
  },
  {
    id: "mvp9-screenshot-capture-boundary",
    title: "MVP9 Screenshot Capture Boundary",
    description: "React UI must not directly invoke screen capture APIs",
    patterns: [
      { re: /getDisplayMedia\s*\(/gi, label: "getDisplayMedia()" },
      { re: /screen\.capture\s*\(/gi, label: "screen.capture()" },
      { re: /desktopCapture/gi, label: "desktopCapture" },
    ],
    allowWhen: [
      (rel) => /packages\/runtime\/src\/mvp9-browser/.test(rel),
      (rel) => /packages\/shared\/src\/browser-preview/.test(rel),
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\//.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(app|components|composer|inspector|settings|shell|sidebar|workspace)\//.test(rel),
    ],
  },
  {
    id: "mvp9-watcher-boundary",
    title: "MVP9 Watcher Boundary",
    description: "React UI must not directly watch filesystem or trigger auto-rescan",
    patterns: [
      { re: /fs\.watch\s*\(/gi, label: "fs.watch()" },
      { re: /fs\.watchFile\s*\(/gi, label: "fs.watchFile()" },
      { re: /chokidar/gi, label: "chokidar" },
      { re: /FileWatcher/gi, label: "FileWatcher" },
    ],
    allowWhen: [
      (rel) => /packages\/runtime\/src\/mvp9-project-watcher/.test(rel),
      (rel) => /packages\/shared\/src\/project-watcher/.test(rel),
      (rel) => /apps\/desktop\/src-tauri\//.test(rel),
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\//.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(app|components|composer|inspector|settings|shell|sidebar|workspace)\//.test(rel),
    ],
  },
  {
    id: "mvp9-raw-output-boundary",
    title: "MVP9 Raw Output Boundary",
    description: "Terminal output, URLs, screenshot metadata, and watcher paths must be redacted",
    patterns: [
      { re: /C:\\Users\\[^/]+\\/gi, label: "raw Windows home path" },
      { re: /\/home\/[A-Za-z0-9._-]+\//g, label: "raw Linux home path" },
      { re: /Bearer\s+[A-Za-z0-9]{8,}/g, label: "Bearer token literal" },
      { re: /sk-[A-Za-z0-9]{8,}/g, label: "sk-* API key literal" },
    ],
    allowWhen: [
      (rel) => /packages\/shared\/src\//.test(rel),
      (rel) => /packages\/runtime\/src\/(mvp9-|mvp5-scenarios|mvp7-project-index|mvp8-project-index|mvp10-scenarios)/.test(rel),
      (rel) => /apps\/desktop\/src-tauri\//.test(rel),
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\//.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(app|components|composer|inspector|settings|shell|sidebar|workspace)\//.test(rel),
      (rel) => /packages\/runtime\/src\/(?!mvp9-|mvp5-scenarios|mvp7-project-index|mvp8-project-index|mvp14-)/.test(rel),
    ],
  },
  {
    id: "mvp8-real-scan-boundary",
    title: "MVP8 Real Scan Boundary",
    description: "Real scan/preview operations must not produce raw paths or execute side effects",
    patterns: [
      { re: /writeFile|appendFile|unlink|rename|mkdir|rmdir|rm\s*\(/gi, label: "filesystem mutation" },
      { re: /child_process|spawn\s*\(|exec\s*\(/gi, label: "shell execution" },
      { re: /window\.open\s*\(/gi, label: "window.open()" },
      { re: /getDisplayMedia\s*\(/gi, label: "screen capture" },
      { re: /C:\\Users\\[^/]+\\/gi, label: "raw Windows home path" },
      { re: /\/home\/[A-Za-z0-9._-]+\//g, label: "raw Linux home path" },
    ],
    allowWhen: [
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\//.test(rel),
      (rel) => /apps\/desktop\/src-tauri\//.test(rel),
      (rel) => /packages\/runtime\/src\/mvp8-project-index/.test(rel),
      (rel) => /packages\/runtime\/src\/mvp9-terminal-policy/.test(rel),
      (rel) => /packages\/runtime\/src\/mvp10-terminal-policy/.test(rel),
      (rel) => /packages\/runtime\/src\/mvp10-scenarios/.test(rel),
      (rel) => /packages\/runtime\/src\/mvp13-/.test(rel),
      (rel) => /packages\/runtime\/src\/mvp14-/.test(rel),
      (rel) => /packages\/runtime\/src\/mvp15-/.test(rel),
      (rel) => /packages\/shared\/src\/project/.test(rel),
      (rel) => /mcp-readonly-policy/.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(app|components|composer|inspector|settings|shell|sidebar|workspace)\//.test(rel),
      (rel) => /packages\/runtime\/src\/(?!mvp8-project-index|mvp9-terminal-policy|mvp10-terminal-policy|mvp13-|mvp14-|mvp15-)/.test(rel),
    ],
  },
  {
    id: "mvp10-real-terminal-exec-boundary",
    title: "MVP10 Real Terminal Exec Boundary",
    description: "React UI must not directly execute shell or spawn processes",
    patterns: [
      { re: /child_process/gi, label: "child_process" },
      { re: /spawn\s*\(/gi, label: "spawn(" },
      { re: /exec\s*\(/gi, label: "exec(" },
      { re: /execFile\s*\(/gi, label: "execFile(" },
      { re: /\.Command\s*\(/gi, label: "Command constructor" },
      { re: /"powershell"/gi, label: "powershell string" },
      { re: /"cmd"/gi, label: "cmd string" },
    ],
    allowWhen: [
      (rel) => /apps\/desktop\/src-tauri\/src\//.test(rel),
      (rel) => /mvp10-terminal-policy/.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\//.test(rel),
    ],
  },
  {
    id: "mvp10-approval-token-boundary",
    title: "MVP10 Approval Token Boundary",
    description: "Approval tokens must not leak into UI, test snapshots, or DOM",
    patterns: [
      { re: /approval.?token/gi, label: "approval_token ref" },
      { re: /approved.?token/gi, label: "approved_token ref" },
    ],
    allowWhen: [
      (rel) => /packages\/(shared|runtime)\/src\//.test(rel),
      (rel) => /apps\/desktop\/src-tauri\/src\//.test(rel),
      (rel) => /mvp10-terminal-service/.test(rel),
      (rel) => /mvp10-approval-token/.test(rel),
      (rel) => /\.test\./.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(composer|settings|workspace|components|app)\//.test(rel),
    ],
  },
  {
    id: "mvp10-build-loop-boundary",
    title: "MVP10 Build Loop Boundary",
    description: "Build loop must not auto-fix code, auto-commit, or auto-install dependencies",
    patterns: [
      { re: /git\s+commit/gi, label: "git commit" },
      { re: /git\s+push/gi, label: "git push" },
      { re: /npm\s+install/gi, label: "npm install" },
      { re: /pnpm\s+install/gi, label: "pnpm install" },
      { re: /--fix/gi, label: "--fix flag" },
    ],
    allowWhen: [
      (rel) => /mvp10-terminal-policy/.test(rel),
      (rel) => /mvp10-build-templates/.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
      (rel) => /docs\//.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(composer|settings|workspace)\//.test(rel),
    ],
  },
  {
    id: "mvp11-ui-native-diagnostics-boundary",
    title: "MVP11 UI Native Diagnostics Boundary",
    description: "React UI must not directly import Tauri, Node fs/path, child_process, or native diagnostic capabilities",
    patterns: [
      { re: /@tauri-apps\/api/gi, label: "@tauri-apps/api import" },
      { re: /node:fs|from\s+["']fs["']/gi, label: "fs import" },
      { re: /node:path|from\s+["']path["']/gi, label: "path import" },
      { re: /child_process/gi, label: "child_process" },
      { re: /invoke\s*\(\s*["'](?!terminal_capability_status|propose_terminal_command|approve_terminal_proposal|execute_terminal_command_real|browser_capability_status|browser_preview|open_browser_preview|watcher_capability_status|start_watcher|stop_watcher|watcher_diff|validate_native_project_root|scan_native_project_index|preview_native_project_file|trust_native_project_root|cancel_native_project_scan)/gi, label: "direct invoke()" },
    ],
    allowWhen: [
      (rel) => /apps\/desktop\/web\/src\/runtime\/.*-native-adapter/.test(rel),
      (rel) => /apps\/desktop\/src-tauri\/src\//.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
      (rel) => /\.test\./.test(rel),
      isTitleBarWindowInternals,
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(app|components|composer|inspector|settings|shell|sidebar|workspace)\//.test(rel),
    ],
  },
  {
    id: "mvp11-terminal-command-entry",
    title: "MVP11 Terminal Command Entry",
    description: "The only real terminal execution path is execute_terminal_command_real behind proposal approval and one-time token",
    patterns: [
      { re: /\bexecute_terminal_command\b/g, label: "old ambiguous execute_terminal_command" },
    ],
    allowWhen: [
      (rel) => /docs\//.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\//.test(rel),
      (rel) => /apps\/desktop\/src-tauri\/src\//.test(rel),
      (rel) => /packages\/runtime\/src\//.test(rel),
    ],
  },
  {
    id: "mvp11-diagnostic-redaction",
    title: "MVP11 Diagnostic Redaction",
    description: "Diagnostic payloads must not leak raw home paths, raw file URLs, Bearer tokens, sk- keys, token=, api_key, or Authorization values",
    patterns: [
      { re: /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`]+/g, label: "Windows home path" },
      { re: /\/Users\/[^/\s"'`]+/g, label: "macOS home path" },
      { re: /\/home\/[^/\s"'`]+/g, label: "Linux home path" },
      { re: /file:\/\/\/?[^\s"'`]+/gi, label: "raw file URL" },
      { re: /Bearer\s+[A-Za-z0-9._-]+/g, label: "Bearer literal" },
      { re: /sk-[A-Za-z0-9][A-Za-z0-9._-]{7,}/g, label: "sk key literal" },
      { re: /token\s*=\s*[^&\s"'`]+/gi, label: "token= literal" },
      { re: /api_key\s*=\s*[^&\s"'`]+/gi, label: "api_key= literal" },
      { re: /Authorization\s*[:=]\s*[^,\n]+/gi, label: "Authorization literal" },
    ],
    allowWhen: [
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
      (rel) => /packages\/shared\/src\/project/.test(rel),
      (rel) => /packages\/runtime\/src\/(secrets\/redaction|ue-diagnostics|mvp8-project-index|mvp10-scenarios)/.test(rel),
      (rel) => /packages\/runtime\/src\/provider\/mvp4-scenarios/.test(rel),
      (rel) => /apps\/desktop\/src-tauri\/src\//.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(app|components|composer|inspector|settings|shell|sidebar|workspace)\//.test(rel),
      (rel) => /packages\/runtime\/src\/provider\//.test(rel),
    ],
  },
  {
    id: "mvp11-no-auto-fix-or-provider-live",
    title: "MVP11 No Auto Fix Or Provider Live",
    description: "Diagnostics must not add automatic fixes, installs, commits, pushes, or default provider live network calls",
    patterns: [
      { re: /--fix/gi, label: "--fix" },
      { re: /npm\s+install|pnpm\s+install/gi, label: "install command" },
      { re: /git\s+commit|git\s+push/gi, label: "git write command" },
      { re: /networkMode\s*:\s*["']live["']/gi, label: "provider live default" },
      { re: /fetch\s*\(/gi, label: "fetch()" },
      { re: /tools\/call/gi, label: "MCP tools/call" },
    ],
    allowWhen: [
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
      (rel) => /packages\/runtime\/src\/provider\//.test(rel),
      (rel) => /packages\/runtime\/src\/provider\/mvp4-scenarios/.test(rel),
      (rel) => /packages\/mcp-client\/src\//.test(rel),
      (rel) => /packages\/runtime\/src\/mcp-readonly-policy/.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(app|components|composer|inspector|settings|shell|sidebar|workspace)\//.test(rel),
      (rel) => /packages\/runtime\/src\/ue-diagnostics/.test(rel),
    ],
  },
  {
    id: "mvp12-text-mutation-boundary",
    title: "MVP12 Text Mutation Boundary",
    description: "Controlled text mutation must stay in shared/runtime services, desktop runtime adapters, native bridge, docs, and tests",
    patterns: [
      { re: /apply_workspace_change|rollback_workspace_change|preview_workspace_change/gi, label: "native text mutation command" },
      { re: /applyChangeSet|rollbackChangeSet|previewChangeSet/gi, label: "change set UI action" },
      { re: /TextMutation|WorkspaceChangeSetV2|ChangeSetServiceV2/gi, label: "MVP12 text mutation type/service" },
    ],
    allowWhen: [
      (rel) => /packages\/(shared|runtime)\/src\//.test(rel),
      (rel) => /apps\/desktop\/web\/src\/(runtime|stores)\//.test(rel),
      (rel) => /apps\/desktop\/src-tauri\/src\//.test(rel),
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(app|components|composer|inspector|settings|shell|sidebar|workspace)\//.test(rel),
    ],
  },
  {
    id: "mvp12-binary-write-boundary",
    title: "MVP12 Binary Write Boundary",
    description: "Binary UE assets and executable/generated artifacts must remain blocked from text mutation",
    patterns: [
      { re: /\.(?:uasset|umap|ubulk|uexp|dll|exe)(?![A-Za-z0-9_])/gi, label: "blocked binary extension" },
      { re: /blocked_binary/gi, label: "blocked_binary reason" },
    ],
    allowWhen: [
      (rel) => /packages\/(shared|runtime)\/src\//.test(rel),
      (rel) => /apps\/desktop\/src-tauri\/src\//.test(rel),
      (rel) => /apps\/desktop\/web\/src\/sidebar\/project-tree-data/.test(rel),
      (rel, line) => /apps\/desktop\/web\/src\/inspector\/AssetMutationPanel/.test(rel) && /executeMvp15AssetChangeSet/.test(line),
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(app|components|composer|inspector|settings|shell|sidebar|workspace)\//.test(rel),
    ],
  },
  {
    id: "mvp12-root-containment-boundary",
    title: "MVP12 Root Containment Boundary",
    description: "Text mutation targets must check trusted root containment and stale hashes",
    patterns: [
      { re: /root_escape|stale_hash|trustedRootId|rootRelativePath/gi, label: "root containment or hash guard" },
    ],
    allowWhen: [
      (rel) => /packages\/(shared|runtime)\/src\//.test(rel),
      (rel) => /apps\/desktop\/web\/src\/(runtime|stores|sidebar)\//.test(rel),
      (rel) => /apps\/desktop\/web\/src\/inspector\/TerminalPanel/.test(rel),
      (rel) => /apps\/desktop\/src-tauri\/src\//.test(rel),
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(app|components|composer|inspector|settings|shell|workspace)\//.test(rel),
    ],
  },
  {
    id: "mvp12-replay-reapply-boundary",
    title: "MVP12 Replay Reapply Boundary",
    description: "Session replay may show recorded summaries only and must not reapply preview/apply/rollback",
    patterns: [
      { re: /recordedOnlyActions|replaySafe|session_replay_never_reapplies/gi, label: "recorded-only replay marker" },
    ],
    allowWhen: [
      (rel) => /packages\/runtime\/src\//.test(rel),
      (rel) => /apps\/desktop\/src-tauri\/src\//.test(rel),
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
      (rel, line) => /apps\/desktop\/web\/src\/inspector\/UtilityPlaceholderPanel/.test(rel) && /recordedOnlyActions/.test(line),
      (rel, line) => /apps\/desktop\/web\/src\/inspector\/AssetMutationPanel/.test(rel) && /recordedOnlyActions/.test(line),
      (rel, line) => /apps\/desktop\/web\/src\/inspector\/ChangesPanel/.test(rel) && /replaySummary|recordedOnlyActions/.test(line),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(app|components|composer|inspector|settings|shell|sidebar|workspace)\//.test(rel),
    ],
  },
  {
    id: "mvp12-no-auto-git-or-install",
    title: "MVP12 No Auto Git Or Install",
    description: "MVP12 repair and verification must not auto-install, auto-fix, commit, push, reset, checkout, clean, or create CI",
    patterns: [
      { re: /git\s+(commit|push|reset|checkout|clean)/gi, label: "git write command" },
      { re: /npm\s+install|pnpm\s+install|--fix/gi, label: "install or --fix" },
      { re: /\.github\/workflows/gi, label: "GitHub workflow path" },
    ],
    allowWhen: [
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
      (rel) => /packages\/runtime\/src\/mvp10-terminal-policy/.test(rel),
      (rel) => /packages\/runtime\/src\/mvp10-build-templates/.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\//.test(rel),
      (rel) => /packages\/runtime\/src\/mvp12-change-set/.test(rel),
    ],
  },
  {
    id: "mvp12-provider-live-boundary",
    title: "MVP12 Provider Live Boundary",
    description: "Repair proposals must be deterministic and must not call live providers by default",
    patterns: [
      { re: /networkMode\s*:\s*["']live["']|fetch\s*\(|ProviderRunner|runProvider/gi, label: "provider live path" },
    ],
    allowWhen: [
      (rel) => /packages\/runtime\/src\/provider\//.test(rel),
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
      (rel, line) => /apps\/desktop\/web\/src\/runtime\/runtime-store/.test(rel) && /Save All blocked/.test(line),
      (rel, line) => /packages\/runtime\/src\/mvp14-(editor-observation-service|scenarios)/.test(rel) && /Save All blocked/.test(line),
    ],
    blockWhen: [
      (rel) => /packages\/runtime\/src\/mvp12-change-set/.test(rel),
      (rel) => /apps\/desktop\/web\/src\//.test(rel),
    ],
  },
  {
    id: "mvp12-mcp-mutation-boundary",
    title: "MVP12 MCP Mutation Boundary",
    description: "MCP remains read-only diagnostic context; mutating tools/call must not be introduced for repair apply",
    patterns: [
      { re: /tools\/call|callTool\s*\(/gi, label: "MCP tool call" },
      { re: /mutating MCP|mutating_tool/gi, label: "mutating MCP marker" },
    ],
    allowWhen: [
      (rel) => /packages\/(mcp-client|runtime)\/src\/(mcp-readonly|ue-diagnostics|runtime-router|agent-loop-runtime)/.test(rel),
      (rel) => /apps\/desktop\/web\/src\/inspector\/ReviewPanel/.test(rel),
      (rel) => /apps\/desktop\/web\/src\/runtime\/desktop-runtime-adapter/.test(rel),
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
      isTitleBarMcpReadOnlyStatus,
    ],
    blockWhen: [
      (rel) => /packages\/runtime\/src\/mvp12-change-set/.test(rel),
      (rel) => /apps\/desktop\/web\/src\//.test(rel),
    ],
  },
  {
    id: "mvp12-redaction-boundary",
    title: "MVP12 Redaction Boundary",
    description: "Diff, evidence, audit, session, and status payloads must redact raw roots, home paths, secrets, and approval tokens",
    patterns: [
      { re: /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`]+/g, label: "Windows home path" },
      { re: /\/Users\/[^/\s"'`]+/g, label: "macOS home path" },
      { re: /\/home\/[^/\s"'`]+/g, label: "Linux home path" },
      { re: /Bearer\s+[A-Za-z0-9._-]+|sk-[A-Za-z0-9][A-Za-z0-9._-]{7,}/g, label: "secret literal" },
      { re: /approval-token:[A-Za-z0-9._-]+/g, label: "approval token literal" },
    ],
    allowWhen: [
      (rel) => /packages\/(shared|runtime)\/src\//.test(rel),
      (rel) => /apps\/desktop\/src-tauri\/src\//.test(rel),
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(app|components|composer|inspector|settings|shell|sidebar|workspace)\//.test(rel),
    ],
  },
  {
    id: "mvp13-ui-direct-native-editor-boundary",
    title: "MVP13 UI Direct Native Editor Boundary",
    description: "React UI must not invoke UE Editor native commands directly; runtime adapters/services own that boundary",
    patterns: [
      { re: /@tauri-apps\/api|invoke\s*\(\s*["'](?:editor_|ue_editor|launch_editor|attach_editor)/gi, label: "direct native editor invoke" },
      { re: /attach_editor_session|launch_editor_session|execute_editor_operation/gi, label: "native editor command name" },
    ],
    allowWhen: [
      (rel) => /apps\/desktop\/web\/src\/runtime\//.test(rel),
      (rel) => /apps\/desktop\/src-tauri\/src\/ue_editor/.test(rel),
      (rel) => /packages\/runtime\/src\/mvp13-/.test(rel),
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
      isTitleBarWindowInternals,
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(app|components|composer|inspector|settings|shell|sidebar|workspace)\//.test(rel),
    ],
  },
  {
    id: "mvp13-mcp-tools-call-boundary",
    title: "MVP13 MCP Tools Call Boundary",
    description: "MCP mutation pilot may classify and dry-run mutating tools, but must not add broad tools/call execution",
    patterns: [
      { re: /tools\/call|callTool\s*\(/gi, label: "MCP tools/call" },
      { re: /mutating\s+MCP|McpMutation/gi, label: "MCP mutation marker" },
    ],
    allowWhen: [
      (rel) => /packages\/shared\/src\/mcp-mutation/.test(rel),
      (rel) => /packages\/runtime\/src\/mvp13-mcp-mutation/.test(rel),
      (rel) => /packages\/runtime\/src\/mvp13-dry-run-adapter/.test(rel),
      (rel) => /packages\/runtime\/src\/mvp13-scenarios/.test(rel),
      (rel) => /packages\/runtime\/src\/mvp15-mcp-asset-adapter/.test(rel),
      (rel) => /packages\/runtime\/src\/mvp15-scenarios/.test(rel),
      (rel) => /packages\/runtime\/src\/index/.test(rel),
      (rel) => /packages\/runtime\/src\/(mcp-readonly-runtime|ue-diagnostics|prompt\/context-pack|prompt\/prompt-builder)/.test(rel),
      (rel) => /packages\/runtime\/src\/provider\/mvp4-scenarios/.test(rel),
      (rel) => /apps\/desktop\/web\/src\/inspector\/McpMutationPanel/.test(rel),
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
      isTitleBarMcpReadOnlyStatus,
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(app|components|composer|settings|shell|sidebar|workspace)\//.test(rel),
      (rel) => /packages\/runtime\/src\/(?!mvp13-mcp-mutation|mvp13-dry-run-adapter|mvp13-scenarios|index|mcp-readonly-runtime|ue-diagnostics|prompt\/context-pack|prompt\/prompt-builder|provider\/mvp4-scenarios)/.test(rel),
    ],
  },
  {
    id: "mvp13-asset-mutation-boundary",
    title: "MVP13 Asset Mutation Boundary",
    description: "UE asset save/delete/rename/move and Blueprint compile remain blocked in MVP13",
    patterns: [
      { re: /save_asset|delete_asset|rename_asset|move_asset|compile_blueprint/gi, label: "asset write operation" },
      { re: /asset_mutation_blocked|blocked_asset_write/gi, label: "asset mutation blocked marker" },
    ],
    allowWhen: [
      (rel) => /packages\/shared\/src\/(ue-editor|mcp-mutation)/.test(rel),
      (rel) => /packages\/runtime\/src\/mvp13-/.test(rel),
      (rel) => /apps\/desktop\/src-tauri\/src\/ue_editor/.test(rel),
      (rel) => /apps\/desktop\/web\/src\/(runtime|stores|inspector|sidebar)\//.test(rel),
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(app|components|composer|settings|shell|workspace)\//.test(rel),
    ],
  },
  {
    id: "mvp13-editor-save-boundary",
    title: "MVP13 Editor Save Boundary",
    description: "Editor operation execution must not call Save All or persist UE assets",
    patterns: [
      { re: /Save\s+All|save_all|SavePackage|EditorAssetLibrary\.save|UEditorLoadingAndSavingUtils/gi, label: "editor save path" },
    ],
    allowWhen: [
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
      (rel, line) => /apps\/desktop\/web\/src\/runtime\/runtime-store/.test(rel) && /Save All blocked/.test(line),
      (rel, line) => /packages\/runtime\/src\/mvp14-(editor-observation-service|scenarios)/.test(rel) && /Save All blocked/.test(line),
      isMvp15SaveAllEvidenceSummary,
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\//.test(rel),
      (rel) => /packages\/runtime\/src\//.test(rel),
      (rel) => /apps\/desktop\/src-tauri\/src\//.test(rel),
    ],
  },
  {
    id: "mvp13-provider-live-boundary",
    title: "MVP13 Provider Live Boundary",
    description: "Editor/MCP mutation pilot must not enable provider live mode by default or auto-apply provider output",
    patterns: [
      { re: /networkMode\s*:\s*["']live["']|autoApply|runProvider|ProviderRunner/gi, label: "provider live or auto apply" },
    ],
    allowWhen: [
      (rel) => /packages\/runtime\/src\/provider\//.test(rel),
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
    ],
    blockWhen: [
      (rel) => /packages\/runtime\/src\/mvp13-/.test(rel),
      (rel) => /apps\/desktop\/web\/src\//.test(rel),
    ],
  },
  {
    id: "mvp13-raw-args-secret-boundary",
    title: "MVP13 Raw Args Secret Boundary",
    description: "Editor/MCP evidence and replay payloads must not store raw MCP args, secrets, tokens, or absolute paths",
    patterns: [
      { re: /rawArgs|raw_args|approval-token:|editor-approval-token:/gi, label: "raw args or token marker" },
      { re: /Bearer\s+[A-Za-z0-9._-]+|sk-[A-Za-z0-9][A-Za-z0-9._-]{7,}/g, label: "secret literal" },
      { re: /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`]+|\/Users\/[^/\s"'`]+|\/home\/[^/\s"'`]+/g, label: "raw user path" },
    ],
    allowWhen: [
      (rel) => /packages\/runtime\/src\/(mvp13-editor-operation-service|mvp13-mcp-mutation-service|mvp12-change-set)/.test(rel),
      (rel) => /apps\/desktop\/src-tauri\/src\/ue_editor/.test(rel),
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(app|components|composer|inspector|settings|shell|sidebar|workspace)\//.test(rel),
      (rel) => /packages\/shared\/src\//.test(rel),
    ],
  },
  {
    id: "mvp13-replay-reexecute-boundary",
    title: "MVP13 Replay Re-execute Boundary",
    description: "Session replay may show editor/MCP/ChangeSet summaries only and must not execute operations, tools, apply, or rollback",
    patterns: [
      { re: /replayOnly|recordedOnlyActions/gi, label: "replay-only marker" },
      { re: /replay.*(?:execute|tools\/call|apply|rollback)/gi, label: "replay execution marker" },
    ],
    allowWhen: [
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
      (rel, line) => /packages\/shared\/src\/(ue-editor|session)/.test(rel) && /replayOnly|recordedOnlyActions/.test(line),
      (rel, line) => /packages\/runtime\/src\/mvp13-(editor-operation-service|editor-session|mcp-mutation-service)/.test(rel) && /replayOnly|recordedOnlyActions/.test(line),
      (rel, line) => /packages\/runtime\/src\/mvp13-scenarios/.test(rel) && /session-replay-only|approval-replay-blocked|mcp-replay-recorded/.test(line),
      (rel, line) => /apps\/desktop\/web\/src\/runtime\/runtime-store/.test(rel) && /replayOnly/.test(line),
      (rel, line) => /apps\/desktop\/web\/src\/stores\/ui-store/.test(rel) && /replayOnly:\s*true/.test(line),
      (rel, line) => /apps\/desktop\/web\/src\/inspector\/(EditorPanel|McpMutationPanel)/.test(rel) && /replayOnly|Replay: recorded summaries only/.test(line),
      (rel, line) => /apps\/desktop\/web\/src\/inspector\/AssetMutationPanel/.test(rel) && /replayOnly|Replay: recorded summaries only/.test(line),
      (rel, line) => /apps\/desktop\/web\/src\/inspector\/ChangesPanel/.test(rel) && /replayOnly|recordedOnlyActions|recorded-only/.test(line),
      (rel, line) => /apps\/desktop\/web\/src\/inspector\/UtilityPlaceholderPanel/.test(rel) && /recordedOnlyActions/.test(line),
      (rel, line) => /apps\/desktop\/web\/src\/runtime\/editor-observation-native-adapter/.test(rel) && /replayOnly/.test(line),
    ],
    blockWhen: [
      (rel) => /packages\/runtime\/src\/mvp13-/.test(rel),
      (rel) => /apps\/desktop\/web\/src\/(runtime|stores|inspector)\//.test(rel),
      (rel) => /apps\/desktop\/src-tauri\/src\//.test(rel),
      (rel) => /apps\/desktop\/web\/src\/(app|components|composer|settings|shell|sidebar|workspace)\//.test(rel),
    ],
  },
  {
    id: "editor_process_kill_boundary",
    title: "MVP14 Editor Process Kill Boundary",
    description: "Editor observation may stop UAgent sessions but must not kill, taskkill, or terminate UE processes",
    patterns: [
      { re: /taskkill|TerminateProcess|kill_process|\.kill\s*\(/gi, label: "process kill" },
    ],
    allowWhen: [
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
      (rel, line) => /apps\/desktop\/web\/src\/runtime\/runtime-store/.test(rel) && /Save All blocked/.test(line),
      (rel, line) => /packages\/runtime\/src\/mvp14-(editor-observation-service|scenarios)/.test(rel) && /Save All blocked/.test(line),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/src-tauri\/src\/ue_editor_process/.test(rel),
      (rel) => /packages\/runtime\/src\/mvp14-/.test(rel),
      (rel) => /apps\/desktop\/web\/src\//.test(rel),
    ],
  },
  {
    id: "editor_save_boundary",
    title: "MVP14 Editor Save Boundary",
    description: "Editor observation/status/snapshot paths must not save UE assets",
    patterns: [
      { re: /Save\s+All|save_all|SavePackage|EditorAssetLibrary\.save|UEditorLoadingAndSavingUtils/gi, label: "editor save path" },
    ],
    allowWhen: [
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
      (rel, line) => /apps\/desktop\/web\/src\/runtime\/runtime-store/.test(rel) && /Save All blocked/.test(line),
      (rel, line) => /packages\/runtime\/src\/mvp14-(editor-observation-service|scenarios)/.test(rel) && /Save All blocked/.test(line),
      isMvp15SaveAllEvidenceSummary,
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/src-tauri\/src\//.test(rel),
      (rel) => /packages\/runtime\/src\//.test(rel),
      (rel) => /apps\/desktop\/web\/src\//.test(rel),
    ],
  },
  {
    id: "editor_launch_shell_boundary",
    title: "MVP14 Editor Launch Shell Boundary",
    description: "Launch must use allowlisted Command::new paths and must not shell out",
    patterns: [
      { re: /Command::new|cmd\s*\/c|powershell|sh\s+-c|shell\s*:\s*true/gi, label: "launch shell boundary" },
    ],
    allowWhen: [
      (rel, line) => /apps\/desktop\/src-tauri\/src\/ue_editor_process/.test(rel) && /Command::new/.test(line),
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
      (rel) => /packages\/runtime\/src\/mvp10-terminal-policy/.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/src-tauri\/src\/(?!ue_editor_process)/.test(rel),
      (rel) => /apps\/desktop\/web\/src\//.test(rel),
      (rel) => /packages\/runtime\/src\/mvp14-/.test(rel),
    ],
  },
  {
    id: "mcp_tools_call_boundary",
    title: "MVP14 MCP Tools Call Boundary",
    description: "MVP14 MCP adapters classify schemas and dry-run summaries but do not execute broad tools/call",
    patterns: [
      { re: /tools\/call|callTool\s*\(/gi, label: "MCP tools/call" },
    ],
    allowWhen: [
      (rel) => /packages\/(mcp-client|runtime)\/src\/(mcp-readonly-runtime|runtime-router|agent-loop-runtime|ue-diagnostics|prompt\/)/.test(rel),
      (rel) => /apps\/desktop\/web\/src\/runtime\/desktop-runtime-adapter/.test(rel),
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
    ],
    blockWhen: [
      (rel) => /packages\/runtime\/src\/mvp14-/.test(rel),
      (rel) => /apps\/desktop\/web\/src\/(app|components|composer|inspector|settings|shell|sidebar|workspace)\//.test(rel),
    ],
  },
  {
    id: "raw_process_args_boundary",
    title: "MVP14 Raw Process Args Boundary",
    description: "Observation payloads must not persist raw process args, raw executable paths, tokens, or secrets",
    patterns: [
      { re: /rawArgs|raw_args|rawExecutable|raw_executable|approval-token:|editor-approval-token:/gi, label: "raw process args or token" },
      { re: /Bearer\s+[A-Za-z0-9._-]+|sk-[A-Za-z0-9][A-Za-z0-9._-]{7,}/g, label: "secret literal" },
      { re: /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`]+|\/Users\/[^/\s"'`]+|\/home\/[^/\s"'`]+/g, label: "raw user path" },
    ],
    allowWhen: [
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
      (rel) => /packages\/runtime\/src\/(mvp12-change-set|mvp13-editor-operation-service|mvp13-mcp-mutation-service|mvp14-mcp-schema-adapters)/.test(rel),
      (rel) => /apps\/desktop\/src-tauri\/src\/ue_editor/.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(app|components|composer|inspector|settings|shell|sidebar|workspace)\//.test(rel),
      (rel) => /packages\/shared\/src\//.test(rel),
      (rel) => /packages\/runtime\/src\/mvp14-editor-observation-service/.test(rel),
    ],
  },
  {
    id: "replay_reexecute_boundary",
    title: "MVP14 Replay Re-execute Boundary",
    description: "Replay may show recorded summaries only and must not attach, launch, execute, call MCP, apply, or rollback",
    patterns: [
      { re: /replay.*(?:attach|launch|execute|tools\/call|apply|rollback)/gi, label: "replay side effect marker" },
    ],
    allowWhen: [
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
      (rel, line) => /packages\/runtime\/src\/mvp14-(editor-observation-service|scenarios)/.test(rel) && /recordedOnlyActions|replay/.test(line),
    ],
    blockWhen: [
      (rel) => /packages\/runtime\/src\/mvp14-/.test(rel),
      (rel) => /apps\/desktop\/web\/src\//.test(rel),
      (rel) => /apps\/desktop\/src-tauri\/src\//.test(rel),
    ],
  },
  {
    id: "mvp15-asset-mutation-boundary",
    title: "MVP15 Asset Mutation Boundary",
    description: "Asset mutation must stay sandbox-only, exact-allowlisted, approval-bound, redacted, and replay-summary-only",
    patterns: [
      { re: /Save\s+All|save_all|SavePackage|EditorAssetLibrary\.save|UEditorLoadingAndSavingUtils/gi, label: "global editor save" },
      { re: /compile_blueprint|compile\s+blueprint/gi, label: "compile blueprint" },
      { re: /bulk_(?:delete|rename|save)|bulk\s+(?:delete|rename|save)/gi, label: "bulk asset operation" },
      { re: /\/Game\/(?!UAgentSandbox\b)[A-Za-z0-9_/.-]+|\/Content\/(?!UAgentSandbox\b)[A-Za-z0-9_/.-]+/g, label: "non-sandbox asset path" },
      { re: /tools\/call|callTool\s*\(/gi, label: "broad MCP tools/call" },
      { re: /@tauri-apps\/api|invoke\s*\(\s*["'](?:dry_run_asset_mutation|execute_asset_mutation|rollback_asset_mutation)/gi, label: "direct UI native asset invoke" },
      { re: /autoApply|provider.*apply|apply.*provider/gi, label: "provider auto apply" },
      { re: /rawArgs|rawCommandLine|approval-token:|asset-approval-token:|Bearer\s+[A-Za-z0-9._-]+|sk-[A-Za-z0-9][A-Za-z0-9._-]{7,}/gi, label: "raw args paths tokens" },
      { re: /if\s*\(\s*(?:approvalToken|token)\s*\)\s*(?:return\s+)?(?:accepted|true)|(?:approvalToken|token)\s*!==?\s*["']["'][^;\n]{0,80}(?:accepted|true)/gi, label: "non-empty token fake verification" },
      { re: /unknown[^;\n]{0,80}(?:accepted|executed|success|allow)|(?:accepted|executed|success|allow)[^;\n]{0,80}unknown/gi, label: "unknown result fail-open" },
      { re: /(?:audit|evidence|replay)[^;\n]{0,160}(?:rawProjectRoot|editorSessionId|pidHash|[A-Za-z]:[\\/]|\/home\/)|(?:rawProjectRoot|editorSessionId|pidHash|[A-Za-z]:[\\/]|\/home\/)[^;\n]{0,160}(?:audit|evidence|replay)/gi, label: "raw evidence identity or path" },
      { re: /replay.*(?:execute|dry[-_ ]?run|verify|rollback|tools\/call)/gi, label: "replay re-execute" },
      { re: /manifest[-_ ]?only.*real|real.*manifest[-_ ]?only/gi, label: "manifest-only real verification" },
      { re: /taskkill|TerminateProcess|kill_process|\.kill\s*\(/gi, label: "UE process kill" },
    ],
    allowWhen: [
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\/side-effect-scan/.test(rel),
      (rel) => /packages\/shared\/src\/asset-mutation/.test(rel),
      (rel) => /packages\/runtime\/src\/mvp15-/.test(rel),
      (rel) => /packages\/runtime\/src\/index/.test(rel),
      (rel) => /apps\/desktop\/src-tauri\/src\/asset_mutation/.test(rel),
      (rel) => /apps\/desktop\/src-tauri\/src\/lib/.test(rel),
      (rel) => /apps\/desktop\/web\/src\/runtime\/runtime-store/.test(rel),
      (rel) => /apps\/desktop\/web\/src\/stores\/ui-store/.test(rel),
      (rel, line, pattern) => /apps\/desktop\/web\/src\/inspector\/AssetMutationPanel/.test(rel)
        && pattern.label === "non-sandbox asset path"
        && /placeholder="\/Game\/Test01"/.test(line),
      isTitleBarWindowInternals,
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(app|components|composer|inspector|settings|shell|sidebar|workspace)\//.test(rel),
    ],
  },
];

// ============================================================
// MVP15 native-authority structural invariants
// ============================================================

function withoutComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

function authoritySource(relPath, content) {
  return withoutComments(content);
}

function structuralFinding(category, file, pattern, content) {
  return {
    category,
    catTitle: category,
    pattern,
    severity: "BLOCKED",
    file,
    line: 1,
    content,
  };
}

function functionSlice(source, startPattern, nextPattern) {
  const start = source.search(startPattern);
  if (start < 0) return "";
  const tail = source.slice(start);
  const next = nextPattern ? tail.slice(1).search(nextPattern) : -1;
  return next >= 0 ? tail.slice(0, next + 1) : tail;
}

const AUTHORITY_CATEGORIES = [
  {
    id: "mvp15-native-trust-authority-boundary",
    title: "MVP15 Native Trust Authority Boundary",
    description: "Asset approval registration must resolve the native trusted-root registry and must not mint a caller-derived root identity",
    inspect(rel, source) {
      if (rel !== "apps/desktop/src-tauri/src/asset_mutation.rs") return [];
      const registrationStart = /fn\s+register_asset_mutation_approval_with_gate_at\b/.test(source)
        ? /fn\s+register_asset_mutation_approval_with_gate_at\b/
        : /fn\s+register_asset_mutation_approval_at\b/;
      const body = functionSlice(source, registrationStart, /fn\s+authorize_asset_mutation_with_gate_at\b/);
      const findings = [];
      if (!/resolve_trusted_root_binding\s*\(/.test(body)) {
        findings.push(structuralFinding(this.id, rel, "missing native trusted-root resolver", "registration does not call resolve_trusted_root_binding"));
      }
      if (/trusted-root:|canonicalize\s*\(\s*&?input\.trusted_project_root/.test(body)) {
        findings.push(structuralFinding(this.id, rel, "caller-derived trusted-root identity", "registration canonicalizes or mints trust instead of resolving registry authority"));
      }
      return findings;
    },
  },
  {
    id: "mvp15-observation-authority-boundary",
    title: "MVP15 Observation Authority Boundary",
    description: "Registration and mutation guards must resolve the native observation/process registry rather than compare caller-declared session or PID duplicates",
    inspect(rel, source) {
      const findings = [];
      if (rel === "apps/desktop/src-tauri/src/asset_mutation.rs") {
        if (!/(?:resolve|validate)_asset_mutation_(?:observation|authority)(?:_binding)?(?:_at)?\s*\(/.test(source)) {
          findings.push(structuralFinding(this.id, rel, "missing native observation validator", "asset mutation does not call the ue_editor_process authority validator"));
        }
      }
      const contractSource = rel === "apps/desktop/src-tauri/src/asset_mutation.rs"
        ? functionSlice(source, /pub\s+struct\s+RegisterAssetMutationApprovalInput\b/, /pub\s+struct\s+RecordAssetMutationOutcomeInput\b/)
        : source;
      if ([
        "apps/desktop/src-tauri/src/asset_mutation.rs",
        "apps/desktop/web/src/runtime/desktop-runtime-adapter.ts",
        "packages/runtime/src/mvp15-mcp-asset-adapter.ts",
        "packages/shared/src/asset-mutation.ts",
      ].includes(rel) && /observedEditorSessionId|observedPidHash|observed_editor_session_id|observed_pid_hash/.test(contractSource)) {
        findings.push(structuralFinding(this.id, rel, "caller observation duplicate", "caller-declared observed session/PID remains in the production mutation contract"));
      }
      return findings;
    },
  },
  {
    id: "mvp15-native-gate-boundary",
    title: "MVP15 Native Gate Boundary",
    description: "Native registration and forward execution require the strict default-off UAGENT_ENABLE_ASSET_MUTATION=1 gate; caller booleans cannot enable it",
    inspect(rel, source) {
      const findings = [];
      if (rel === "apps/desktop/src-tauri/src/asset_mutation.rs") {
        if (!/UAGENT_ENABLE_ASSET_MUTATION/.test(source) || !/(?:==|matches!)[^\n]{0,120}["']1["']/.test(source)) {
          findings.push(structuralFinding(this.id, rel, "missing strict native gate", "native mutation source does not implement an exact value 1 environment gate"));
        }
      }
      if ([
        "apps/desktop/web/src/runtime/desktop-runtime-adapter.ts",
        "packages/shared/src/asset-mutation.ts",
      ].includes(rel) && /assetMutationGateEnabled|asset_mutation_gate_enabled/.test(source)) {
        findings.push(structuralFinding(this.id, rel, "caller mutation gate", "caller assetMutationGateEnabled remains in the production native-authority contract"));
      }
      return findings;
    },
  },
  {
    id: "mvp15-transaction-liveness-boundary",
    title: "MVP15 Transaction Liveness Boundary",
    description: "Every mutation phase must revalidate live authority and enforce absolute 15-minute forward and 20-minute recovery caps",
    inspect(rel, source) {
      if (rel !== "apps/desktop/src-tauri/src/asset_mutation.rs") return [];
      const findings = [];
      const hasCaps = /15\s*\*\s*(?:60\s*\*\s*1000|60_000)|900_000/.test(source)
        && /20\s*\*\s*(?:60\s*\*\s*1000|60_000)|1_200_000/.test(source)
        && /transaction_expired/.test(source)
        && /recovery_expired/.test(source);
      if (!hasCaps) {
        findings.push(structuralFinding(this.id, rel, "missing absolute transaction/recovery caps", "15-minute forward and 20-minute recovery deadlines or stable reasons are absent"));
      }
      const guardStart = /fn\s+authorize_asset_mutation_with_gate_at\b/.test(source)
        ? /fn\s+authorize_asset_mutation_with_gate_at\b/
        : /fn\s+authorize_asset_mutation_at\b/;
      const guardBody = functionSlice(source, guardStart, /fn\s+record_asset_mutation_outcome_at\b/);
      if (!/(?:revalidate|resolve|validate)_asset_mutation_(?:live_)?authority|(?:resolve|validate)_asset_mutation_observation/.test(guardBody)) {
        findings.push(structuralFinding(this.id, rel, "missing per-guard live recheck", "authorize_asset_mutation_at does not call a live authority/observation revalidator"));
      }
      return findings;
    },
  },
  {
    id: "mvp15-pretrust-root-ref-boundary",
    title: "MVP15 Pre-trust Root Reference Boundary",
    description: "Mutation-resolvable root mappings may be published only after confirmTrust succeeds",
    inspect(rel, source) {
      if (rel !== "apps/desktop/web/src/runtime/project-native-adapter.ts") return [];
      const findings = [];
      const addProject = functionSlice(source, /async\s+addProject\s*\(/, /async\s+confirmTrust\s*\(/);
      if (/register(?:Mutation)?TrustedRootRef\s*\(|trustedRootRefs\.set\s*\(/.test(addProject)) {
        findings.push(structuralFinding(this.id, rel, "pre-trust mutation root mapping", "addProject publishes a mutation-resolvable root before confirmTrust"));
      }
      const confirmTrust = functionSlice(source, /async\s+confirmTrust\s*\(/, /async\s+(?:removeProject|scanProject|scan)\s*\(/);
      const trustIndex = confirmTrust.search(/trust_native_project_root/);
      const publishIndex = confirmTrust.search(/register(?:Mutation)?TrustedRootRef\s*\(|trustedRootRefs\.set\s*\(/);
      if (publishIndex >= 0 && (trustIndex < 0 || publishIndex < trustIndex)) {
        findings.push(structuralFinding(this.id, rel, "root mapping precedes native trust", "confirmTrust publishes the mapping before the native trust command"));
      }
      return findings;
    },
  },
];

function scanAuthorityContent(relPath, content, categories = AUTHORITY_CATEGORIES) {
  const source = authoritySource(relPath, content);
  return categories.flatMap((category) => category.inspect(relPath, source));
}

function scanAuthorityFiles() {
  return MVP15_AUTHORITY_FILES.flatMap((relPath) => {
    const absPath = join(ROOT, relPath);
    if (!existsSync(absPath)) {
      return [structuralFinding("mvp15-native-trust-authority-boundary", relPath, "authority source missing", "required production boundary file is missing")];
    }
    try {
      return scanAuthorityContent(relPath, readFileSync(absPath, "utf-8"));
    } catch {
      return [structuralFinding("mvp15-native-trust-authority-boundary", relPath, "authority source unreadable", "required production boundary file could not be read")];
    }
  });
}

// ============================================================
// Scan Logic
// ============================================================

function normalizePath(p) {
  return p.replace(/\\/g, "/");
}

function getRelativePath(absPath) {
  return normalizePath(absPath).replace(normalizePath(ROOT) + "/", "");
}

function isAllowed(relPath, allowWhen, lineText, pattern) {
  return allowWhen.some((fn) => fn(relPath, lineText, pattern));
}

function isBlocked(relPath, blockWhen) {
  return blockWhen.some((fn) => fn(relPath));
}

function scanContent(relPath, content, categories) {
  const lines = content.split("\n");
  const findings = [];

  for (const cat of categories) {
    for (const pat of cat.patterns) {
      let match;
      while ((match = pat.re.exec(content)) !== null) {
        const lineNum = content.slice(0, match.index).split("\n").length;
        const lineText = lines[lineNum - 1]?.trim() ?? "";

        findings.push({
          category: cat.id,
          catTitle: cat.title,
          pattern: pat.label,
          severity: isAllowed(relPath, cat.allowWhen, lineText, pat) ? "ALLOWED"
            : isBlocked(relPath, cat.blockWhen) ? "BLOCKED"
            : "REVIEW",
          file: relPath,
          line: lineNum,
          content: lineText.slice(0, 140),
        });
      }
    }
  }

  return findings;
}

function scanFile(absPath, categories) {
  const relPath = getRelativePath(absPath);
  try {
    return scanContent(relPath, readFileSync(absPath, "utf-8"), categories);
  } catch {
    return [];
  }
}

function runScanSelfTests() {
  const replayCategory = CATEGORIES.find((cat) => cat.id === "mvp13-replay-reexecute-boundary");
  if (!replayCategory) throw new Error("mvp13 replay scan category missing");
  const unsafe = scanContent(
    "apps/desktop/web/src/runtime/replay-danger.ts",
    "export function replayExecuteOperation() { return executeEditorOperation(); }",
    [replayCategory],
  );
  if (!unsafe.some((finding) => finding.severity === "BLOCKED")) {
    throw new Error("mvp13 replay re-execute self-test did not block unsafe runtime sample");
  }
  const killCategory = CATEGORIES.find((cat) => cat.id === "editor_process_kill_boundary");
  if (!killCategory) throw new Error("mvp14 kill scan category missing");
  const unsafeKill = scanContent(
    "apps/desktop/src-tauri/src/ue_editor_process.rs",
    "pub fn stop_editor_observation_session() { taskkill(); }",
    [killCategory],
  );
  if (!unsafeKill.some((finding) => finding.severity === "BLOCKED")) {
    throw new Error("mvp14 process kill self-test did not block unsafe sample");
  }
  const rawArgsCategory = CATEGORIES.find((cat) => cat.id === "raw_process_args_boundary");
  if (!rawArgsCategory) throw new Error("mvp14 raw args scan category missing");
  const unsafeArgs = scanContent(
    "packages/shared/src/ue-editor.ts",
    "export interface Leak { rawArgs: string[]; token: 'sk-secret123'; }",
    [rawArgsCategory],
  );
  if (!unsafeArgs.some((finding) => finding.severity === "BLOCKED")) {
    throw new Error("mvp14 raw args self-test did not block unsafe sample");
  }
  const mvp15Category = CATEGORIES.find((cat) => cat.id === "mvp15-asset-mutation-boundary");
  if (!mvp15Category) throw new Error("mvp15 asset mutation scan category missing");
  const unsafeMvp15 = scanContent(
    "apps/desktop/web/src/inspector/AssetMutationPanel.tsx",
    "invoke('execute_asset_mutation'); callTool('tools/call'); replayExecuteAssetMutation(); const p='/Game/Hero'; const token='asset-approval-token:leak';",
    [mvp15Category],
  );
  if (!unsafeMvp15.some((finding) => finding.severity === "BLOCKED")) {
    throw new Error("mvp15 asset mutation self-test did not block direct UI native invoke sample");
  }
  const unsafeManifestOnly = scanContent(
    "apps/desktop/web/src/inspector/AssetMutationPanel.tsx",
    "const result = 'real verification manifest-only pass';",
    [mvp15Category],
  );
  if (!unsafeManifestOnly.some((finding) => finding.severity === "BLOCKED" && finding.pattern === "manifest-only real verification")) {
    throw new Error("mvp15 asset mutation self-test did not block manifest-only real verification sample");
  }
  // MVP15C live dry-run binding task regression: this task's harness/tests must never send
  // live execute:true, rollback:true, Save All, or any asset mutation API. The binding
  // boundary category must block these in any desktop source the scan reaches (inspector path).
  const unsafeLivePayload = scanContent(
    "apps/desktop/web/src/inspector/RejectLiveExecutePanel.tsx",
    "invoke('execute_asset_mutation'); const args={ execute:true, rollback:true, saveAll:true }; tools/call('ue.asset.save'); SavePackage();",
    [mvp15Category],
  );
  if (!unsafeLivePayload.some((finding) => finding.severity === "BLOCKED")) {
    throw new Error("mvp15 asset mutation self-test did not block live execute/rollback/Save All/mutation API sample");
  }
  const unsafeNonEmptyToken = scanContent(
    "apps/desktop/web/src/inspector/RejectFakeTokenPanel.tsx",
    "if (approvalToken) return accepted;",
    [mvp15Category],
  );
  if (!unsafeNonEmptyToken.some((finding) => finding.severity === "BLOCKED" && finding.pattern === "non-empty token fake verification")) {
    throw new Error("mvp15 asset mutation self-test did not block non-empty token fake verification");
  }
  const unsafeUnknownResult = scanContent(
    "apps/desktop/web/src/inspector/RejectUnknownResultPanel.tsx",
    "const result = unknownResult ? accepted : failed;",
    [mvp15Category],
  );
  if (!unsafeUnknownResult.some((finding) => finding.severity === "BLOCKED" && finding.pattern === "unknown result fail-open")) {
    throw new Error("mvp15 asset mutation self-test did not block unknown-result fail-open");
  }
  const unsafeRawEvidence = scanContent(
    "apps/desktop/web/src/inspector/RejectRawEvidencePanel.tsx",
    "const evidence = { rawProjectRoot: 'C:/Users/operator/project', editorSessionId, pidHash };",
    [mvp15Category],
  );
  if (!unsafeRawEvidence.some((finding) => finding.severity === "BLOCKED" && finding.pattern === "raw evidence identity or path")) {
    throw new Error("mvp15 asset mutation self-test did not block raw evidence path/session/pid");
  }

  const authorityCases = [
    {
      id: "mvp15-native-trust-authority-boundary",
      file: "apps/desktop/src-tauri/src/asset_mutation.rs",
      unsafe: "fn register_asset_mutation_approval_at(input: Input) { let root = canonicalize(&input.trusted_project_root); let id = format!(\"trusted-root:{}\", root); } fn authorize_asset_mutation_at() {}",
      safe: "fn register_asset_mutation_approval_at(input: Input) { let binding = resolve_trusted_root_binding(&input.trusted_project_root); } fn authorize_asset_mutation_at() {}",
    },
    {
      id: "mvp15-observation-authority-boundary",
      file: "packages/shared/src/asset-mutation.ts",
      unsafe: "export interface Guard { observedEditorSessionId: string; observedPidHash: string; }",
      safe: "export interface Guard { registrationId: string; operationId: string; }",
    },
    {
      id: "mvp15-native-gate-boundary",
      file: "packages/shared/src/asset-mutation.ts",
      unsafe: "export interface Register { assetMutationGateEnabled: boolean; }",
      safe: "export interface Register { registrationId: string; }",
    },
    {
      id: "mvp15-transaction-liveness-boundary",
      file: "apps/desktop/src-tauri/src/asset_mutation.rs",
      unsafe: "fn authorize_asset_mutation_at() { return accepted(); }",
      safe: "const FORWARD: u64 = 15 * 60 * 1000; const RECOVERY: u64 = 20 * 60 * 1000; const A: &str = \"transaction_expired\"; const B: &str = \"recovery_expired\"; fn authorize_asset_mutation_at() { revalidate_asset_mutation_live_authority(); } fn record_asset_mutation_outcome_at() {}",
    },
    {
      id: "mvp15-pretrust-root-ref-boundary",
      file: "apps/desktop/web/src/runtime/project-native-adapter.ts",
      unsafe: "async addProject(ref) { registerTrustedRootRef(ref, raw); } async confirmTrust(id) { await trust_native_project_root(id); } async removeProject() {}",
      safe: "async addProject(ref) { rawPaths.set(ref, raw); } async confirmTrust(id) { await trust_native_project_root(id); registerTrustedRootRef(id, raw); } async removeProject() {}",
    },
  ];
  for (const sample of authorityCases) {
    const category = AUTHORITY_CATEGORIES.find((candidate) => candidate.id === sample.id);
    if (!category) throw new Error(`${sample.id} scan category missing`);
    const unsafeFindings = scanAuthorityContent(sample.file, sample.unsafe, [category]);
    if (!unsafeFindings.some((finding) => finding.severity === "BLOCKED")) {
      throw new Error(`${sample.id} self-test did not block unsafe sample`);
    }
    const safeFindings = scanAuthorityContent(sample.file, sample.safe, [category]);
    if (safeFindings.some((finding) => finding.severity === "BLOCKED")) {
      throw new Error(`${sample.id} self-test blocked safe authoritative sample`);
    }
  }
}

// ============================================================
// Main
// ============================================================

function main() {
  runScanSelfTests();
  const fileSet = getFileList().sort();

  // Scan
  const allFindings = [];
  for (const absPath of fileSet) {
    const findings = scanFile(absPath, CATEGORIES);
    allFindings.push(...findings);
  }
  allFindings.push(...scanAuthorityFiles());

  const reportCategories = [...CATEGORIES, ...AUTHORITY_CATEGORIES];

  // Build report
  const report = {};

  for (const cat of reportCategories) {
    const catFindings = allFindings.filter((f) => f.category === cat.id);
    const allowed = catFindings.filter((f) => f.severity === "ALLOWED");
    const blocked = catFindings.filter((f) => f.severity === "BLOCKED");
    const review = catFindings.filter((f) => f.severity === "REVIEW");

    report[cat.id] = { cat, allowed, blocked, review };
  }

  // ========================================
  // Print Report
  // ========================================
  const hr = "=".repeat(80);

  console.log(hr);
  console.log("  UAgent Side-effect Scan Report");
  console.log(`  ${new Date().toISOString()}`);
  console.log(`  Files scanned: ${fileSet.length}`);
  console.log(hr);
  console.log();

  let totalAllowed = 0;
  let totalBlocked = 0;
  let totalReview = 0;

  for (const cat of reportCategories) {
    const r = report[cat.id];
    const a = r.allowed.length;
    const b = r.blocked.length;
    const rev = r.review.length;
    totalAllowed += a;
    totalBlocked += b;
    totalReview += rev;

    console.log(`\n## ${cat.title}`);
    console.log(`   ${cat.description}`);
    console.log(`   Allowed: ${a} | Blocked: ${b} | Review: ${rev}`);

    if (r.blocked.length > 0) {
      console.log("\n   BLOCKED:");
      for (const f of r.blocked) {
        console.log(`     ${f.file}:${f.line}`);
        console.log(`       pattern: ${f.pattern}`);
        console.log(`       ${f.content}`);
      }
    }
  }

  console.log();
  console.log(hr);
  console.log("  SUMMARY");
  console.log(`    Files scanned: ${fileSet.length}`);
  console.log(`    Total allowed: ${totalAllowed}`);
  console.log(`    Total blocked: ${totalBlocked}`);
  console.log(`    Total review:  ${totalReview}`);
  console.log(hr);

  if (totalBlocked > 0) {
    console.log(`\n  ⚠ WARNING: ${totalBlocked} blocked finding(s). Review before proceeding.`);
    process.exit(1);
  } else if (totalReview > 0) {
    console.log(`\n  ℹ ${totalReview} review finding(s) remain. No blocked findings.`);
    process.exit(0);
  } else {
    console.log("\n  ✅ No blocked or review findings. Side-effect scan passed.");
    process.exit(0);
  }
}

main();
