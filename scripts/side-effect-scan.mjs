#!/usr/bin/env node

/**
 * UAgent MVP7 Side-effect Scan
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
      (rel) => /packages\/runtime\/src\/mcp-readonly-policy/.test(rel),
      (rel) => /packages\/runtime\/src\/sandbox-policy/.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\//.test(rel),
      (rel) => /packages\/runtime\/src\/(?!mvp7-project-index|mvp9-terminal-policy)/.test(rel),
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
      (rel) => /packages\/runtime\/src\/(mvp9-|mvp5-scenarios|mvp7-project-index|mvp8-project-index)/.test(rel),
      (rel) => /apps\/desktop\/src-tauri\//.test(rel),
      (rel) => /docs\//.test(rel),
      (rel) => /\.test\./.test(rel),
      (rel) => /scripts\//.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(app|components|composer|inspector|settings|shell|sidebar|workspace)\//.test(rel),
      (rel) => /packages\/runtime\/src\/(?!mvp9-|mvp5-scenarios|mvp7-project-index|mvp8-project-index)/.test(rel),
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
      (rel) => /packages\/shared\/src\/project/.test(rel),
      (rel) => /mcp-readonly-policy/.test(rel),
    ],
    blockWhen: [
      (rel) => /apps\/desktop\/web\/src\/(app|components|composer|inspector|settings|shell|sidebar|workspace)\//.test(rel),
      (rel) => /packages\/runtime\/src\/(?!mvp8-project-index|mvp9-terminal-policy)/.test(rel),
    ],
  },
];

// ============================================================
// Scan Logic
// ============================================================

function normalizePath(p) {
  return p.replace(/\\/g, "/");
}

function getRelativePath(absPath) {
  return normalizePath(absPath).replace(normalizePath(ROOT) + "/", "");
}

function isAllowed(relPath, allowWhen) {
  return allowWhen.some((fn) => fn(relPath));
}

function isBlocked(relPath, blockWhen) {
  return blockWhen.some((fn) => fn(relPath));
}

function scanFile(absPath, categories) {
  const relPath = getRelativePath(absPath);
  let content;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }

  const lines = content.split("\n");
  const findings = [];

  for (const cat of categories) {
    for (const pat of cat.patterns) {
      let match;
      while ((match = pat.re.exec(content)) !== null) {
        const lineNum = content.slice(0, match.index).split("\n").length;
        const lineText = lines[lineNum - 1]?.trim() ?? "";
        const severity = isAllowed(relPath, cat.allowWhen) ? "ALLOWED"
          : isBlocked(relPath, cat.blockWhen) ? "BLOCKED"
          : "REVIEW";

        findings.push({
          category: cat.id,
          catTitle: cat.title,
          pattern: pat.label,
          severity,
          file: relPath,
          line: lineNum,
          content: lineText.slice(0, 140),
        });
      }
    }
  }

  return findings;
}

// ============================================================
// Main
// ============================================================

function main() {
  const fileSet = getFileList().sort();

  // Scan
  const allFindings = [];
  for (const absPath of fileSet) {
    const findings = scanFile(absPath, CATEGORIES);
    allFindings.push(...findings);
  }

  // Build report
  const report = {};

  for (const cat of CATEGORIES) {
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
  console.log("  UAgent MVP9 Side-effect Scan Report");
  console.log(`  ${new Date().toISOString()}`);
  console.log(`  Files scanned: ${fileSet.length}`);
  console.log(hr);
  console.log();

  let totalAllowed = 0;
  let totalBlocked = 0;
  let totalReview = 0;

  for (const cat of CATEGORIES) {
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
