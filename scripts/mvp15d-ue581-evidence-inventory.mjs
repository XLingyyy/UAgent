#!/usr/bin/env node
/* global console, process */

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  collectPackageArtifacts,
  manifestSelfHash,
  validateManifestShape,
} from "./mvp15d-manifest.mjs";

const ROOT_NAME = /^mvp15d-ue581-compat-\d{8}_\d{6}$/;
const SCHEMA = "uagent.mvp15d.ue581.evidence-inventory.v2";
const REDACTION_LEDGER_SCHEMA = "uagent.mvp15d.ue581.redaction-ledger.v1";
const REDACTION_RULES_VERSION = "uagent.mvp15d.ue581.redaction-rules.v1";
const PACKAGE_INVENTORY_SCHEMA = "uagent.mvp15d.ue581.package-artifact-inventory.v1";
const LOADED_MODULES_SCHEMA = "uagent.mvp15d.ue581.loaded-modules.v1";
const IDENTITY_SCHEMA = "uagent.ue-companion-plugin.identity.v2";
const MANIFEST_SCHEMA = "uagent.ue-companion-plugin.build-manifest.v3";
const BUILD_COMMAND_SCHEMA = "uagent.mvp15d.final.build-command.v3";
const BUILD_RESULT_SCHEMA = "uagent.mvp15d.final.build-result.v3";
const PRODUCER_LEDGER_SCHEMA = "uagent.mvp15d.final.producer-ledger.v1";
const EVENT_SCHEMA = "uagent.mvp15d.final.phase-event.v1";
const RUNTIME_EVENT_SCHEMA = "uagent.mvp15d.final.runtime-event.v2";
const JOB_CLOSEOUT_SCHEMA = "uagent.mvp15d.final.job-closeout.v1";
const PORT_CLOSEOUT_SCHEMA = "uagent.mvp15d.final.port-closeout.v1";
const TASK_GENERATION = "final-d13-d16";
const PHASES = ["ue-automation", "product-capture", "ui-lifecycle"];
const PHASE_SUMMARY_SCHEMAS = Object.freeze({
  "ue-automation": "uagent.mvp15d.final.ue-automation.v1",
  "product-capture": "uagent.mvp15d.final.product-capture.v2",
  "ui-lifecycle": "uagent.mvp15d.final.ui-lifecycle.v1",
});
const LIVE_PRODUCER_IDS = Object.freeze({
  "ue-automation": "mvp15d-final-ue-automation-producer",
  "product-capture": "mvp15d-final-product-capture-producer",
  "ui-lifecycle": "mvp15d-final-ui-lifecycle-producer",
});
const PACKAGE_ROOT = "package/UAgentAssetTools";
const PACKAGE_MANIFEST = `${PACKAGE_ROOT}/UAgentAssetTools.build.json`;
const REQUIRED_DIRECTORIES = Object.freeze([
  "captures",
  "logs",
  "metadata",
  "package",
  PACKAGE_ROOT,
  `${PACKAGE_ROOT}/Binaries`,
  `${PACKAGE_ROOT}/Binaries/Win64`,
  `${PACKAGE_ROOT}/Resources`,
  "summaries",
  "transcripts",
]);
const REQUIRED_LOGS = Object.freeze([
  "logs/runuat.stderr.redacted.log",
  "logs/runuat.stdout.redacted.log",
  ...PHASES.map((phase) => `logs/${phase}.stderr.log`),
]);
const REQUIRED_FILES = Object.freeze([
  "captures/loaded-modules.json",
  ...REQUIRED_LOGS,
  "metadata/build-command.json",
  "metadata/build-result.json",
  "metadata/identity.json",
  "metadata/package-artifacts.json",
  "metadata/redaction-ledger.json",
  ...PHASES.map((phase) => `metadata/${phase}.producer.json`),
  ...PHASES.map((phase) => `metadata/${phase}.job-closeout.json`),
  ...PHASES.map((phase) => `metadata/${phase}.port-closeout.json`),
  ...PHASES.map((phase) => `summaries/${phase}.json`),
  ...PHASES.map((phase) => `transcripts/${phase}.events.jsonl`),
  PACKAGE_MANIFEST,
  `${PACKAGE_ROOT}/UAgentAssetTools.uplugin`,
  `${PACKAGE_ROOT}/Binaries/Win64/UnrealEditor.modules`,
  `${PACKAGE_ROOT}/Resources/uagent-asset-tools.schema.json`,
]);
const OPTIONAL_FILES = Object.freeze([
  ...PHASES.map((phase) => `transcripts/${phase}.runtime-events.jsonl`),
]);
const STATIC_ALLOWED_FILES = new Set([...REQUIRED_FILES, ...OPTIONAL_FILES]);
const PACKAGE_MODULE_PATTERN = new RegExp(
  `^${PACKAGE_ROOT.replaceAll("/", "\\/")}\\/Binaries\\/Win64\\/UnrealEditor-[A-Za-z0-9_.-]+\\.dll$`,
);
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const TASK_ID_PATTERN = /^TASK-MVP15D-[A-Z0-9-]+$/;
const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const FILE_LIMIT = 64 * 1024 * 1024;
const MODULE_LIMIT = 2 * 1024 * 1024 * 1024;

const REDACTION_RULES = Object.freeze([
  {
    id: "credential-endpoint",
    pattern:
      /https?:\/\/(?:[^/\s:@]+:[^/\s@]+@|[^\s"'<>]*[?&](?:access_token|auth|authorization|api[-_]?key|credential|password|secret|token)=[^&#\s"'<>]+)/giu,
  },
  {
    id: "security-token",
    pattern:
      /(?:\bSecurityToken\b|["']SecurityToken["'])\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\]]+)/giu,
  },
  {
    id: "authorization",
    pattern:
      /(?:\bAuthorization\b|["']Authorization["'])\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n,;}]+)/giu,
  },
  {
    id: "bearer",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{4,}/giu,
  },
  {
    id: "api-key",
    pattern:
      /(?:\bX-Api-Key\b|\bApi[-_]?Key\b|["'](?:x-api-key|api[-_]?key)["'])\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\]]+)/giu,
  },
  {
    id: "token",
    pattern:
      /(?:\b(?:access[-_]?token|refresh[-_]?token|auth[-_]?token|token)\b|["'](?:access[-_]?token|refresh[-_]?token|auth[-_]?token|token)["'])\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[A-Za-z0-9._~+/=-]{4,})/giu,
  },
  {
    id: "credential",
    pattern:
      /(?:\b(?:credential|password|passwd|client[-_]?secret)\b|["'](?:credential|password|passwd|client[-_]?secret)["'])\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\]]+)/giu,
  },
  {
    id: "windows-home",
    pattern:
      /[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/\s"'<>:|?*]+(?:[\\/][^ \t\r\n"'<>|?*]*)?/giu,
  },
  {
    id: "unix-home",
    pattern: /(?:\/home\/|\/Users\/)[^/\s"'<>]+(?:\/[^ \t\r\n"'<>]*)?/gu,
  },
  {
    id: "user-profile-variable",
    pattern:
      /(?:%USERPROFILE%|\$\{?(?:HOME|USERPROFILE)\}?|\b(?:HOME|USERPROFILE)\s*=\s*[^\s,;]+)/giu,
  },
  {
    id: "file-url",
    pattern: /\bfile:\/\/\/[^\s"'<>]+/giu,
  },
  {
    id: "windows-absolute-path",
    pattern: /[A-Za-z]:[\\/](?![\\/])[^ \t\r\n"'<>|?*]+/gu,
  },
]);

const RETAINED_SECRET_PATTERNS = Object.freeze([
  /\bSecurityToken\b\s*[:=]\s*(?:"[^"]+"|'[^']+'|[^\s,;}\]]{4,})/iu,
  /\bAuthorization\b\s*[:=]\s*(?:"[^"]+"|'[^']+'|[^\r\n,;}]{4,})/iu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{4,}/iu,
  /\b(?:X-Api-Key|Api[-_]?Key)\b\s*[:=]\s*(?:"[^"]+"|'[^']+'|[^\s,;}\]]{4,})/iu,
  /\b(?:access[-_]?token|refresh[-_]?token|auth[-_]?token|token)\b\s*[:=]\s*(?:"[^"]+"|'[^']+'|[A-Za-z0-9._~+/=-]{4,})/iu,
  /\b(?:credential|password|passwd|client[-_]?secret)\b\s*[:=]\s*(?:"[^"]+"|'[^']+'|[^\s,;}\]]{4,})/iu,
  /https?:\/\/(?:[^/\s:@]+:[^/\s@]+@|[^\s"'<>]*[?&](?:access_token|auth|authorization|api[-_]?key|credential|password|secret|token)=[^&#\s"'<>]+)/iu,
  /[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/]/iu,
  /(?:\/home\/|\/Users\/)[^/\s"'<>]+/u,
  /(?:%USERPROFILE%|\$\{?(?:HOME|USERPROFILE)\}?|\b(?:HOME|USERPROFILE)\s*=)/iu,
  /\bfile:\/\/\/[^\s"'<>]+/iu,
  /[A-Za-z]:[\\/](?![\\/])[^ \t\r\n"'<>|?*]+/u,
]);

class InventoryError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new InventoryError(code);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isHex(value) {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function stable(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("UE581_INVENTORY_NONFINITE_NUMBER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  fail("UE581_INVENTORY_VALUE_INVALID");
}

function exactKeys(value, expected, code) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(code);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(code);
  }
  return value;
}

function isWithin(root, candidate) {
  const value = relative(root, candidate);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function samePhysicalPath(left, right) {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function requirePlainDirectory(path, rootDevice, code) {
  if (!existsSync(path)) fail(code);
  const info = lstatSync(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.dev !== rootDevice ||
    !samePhysicalPath(realpathSync.native(path), resolve(path))
  ) {
    fail("UE581_INVENTORY_LINK_REPARSE_MOUNT_REJECTED");
  }
  return info;
}

function requirePlainFile(path, rootDevice, code) {
  if (!existsSync(path)) fail(code);
  const info = lstatSync(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.dev !== rootDevice ||
    !samePhysicalPath(realpathSync.native(path), resolve(path))
  ) {
    fail("UE581_INVENTORY_LINK_REPARSE_MOUNT_REJECTED");
  }
  return info;
}

function repositoryExternal() {
  const repository = resolve(fileURLToPath(new URL("..", import.meta.url)));
  return resolve(repository, "external");
}

function resolveRoot(value) {
  if (typeof value !== "string" || !value) fail("UE581_INVENTORY_ROOT_INVALID");
  const root = resolve(value);
  const external = repositoryExternal();
  if (!ROOT_NAME.test(basename(root)) || resolve(root, "..") !== external || !existsSync(root)) {
    fail("UE581_INVENTORY_ROOT_INVALID");
  }
  const info = lstatSync(root);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    !samePhysicalPath(realpathSync.native(root), root)
  ) {
    fail("UE581_INVENTORY_LINK_REPARSE_MOUNT_REJECTED");
  }
  return { root, rootDevice: info.dev };
}

function canonicalLogical(value, code = "UE581_INVENTORY_PATH_NONCANONICAL") {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.normalize("NFC") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    isAbsolute(value) ||
    value
      .split("/")
      .some(
        (segment) =>
          !segment ||
          segment === "." ||
          segment === ".." ||
          segment.startsWith(".") ||
          segment.endsWith(".") ||
          segment.endsWith(" ") ||
          !SEGMENT_PATTERN.test(segment),
      )
  ) {
    fail(code);
  }
  return value;
}

function logicalPath(root, path) {
  const value = relative(root, path).replaceAll("\\", "/");
  canonicalLogical(value);
  const recomputed = resolve(root, ...value.split("/"));
  if (!isWithin(root, recomputed) || recomputed !== resolve(path)) {
    fail("UE581_INVENTORY_PATH_ESCAPE");
  }
  return value;
}

function readJson(path, code) {
  try {
    const bytes = readFileSync(path);
    if (bytes.includes(0)) fail(code);
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    if (error instanceof InventoryError) throw error;
    fail(code);
  }
}

function assertSecretFree(bytes, code = "UE581_INVENTORY_SENSITIVE_CONTENT", binary = false) {
  const text = bytes.toString(binary ? "latin1" : "utf8");
  if (
    (!binary && text.includes("\uFFFD")) ||
    RETAINED_SECRET_PATTERNS.some((pattern) => pattern.test(text)) ||
    /"(?:commandLine|rawArguments|processArguments|environment|userSettings)"\s*:/iu.test(text)
  ) {
    fail(code);
  }
}

function redactTransform(text, generic) {
  let output = String(text);
  const replacements = [];
  let sequence = 0;
  for (const rule of REDACTION_RULES) {
    let count = 0;
    output = output.replace(rule.pattern, () => {
      count += 1;
      sequence += 1;
      return generic ? "<<REDACTED>>" : `<<R${String(sequence).padStart(6, "0")}>>`;
    });
    if (count > 0) replacements.push({ rule: rule.id, count });
  }
  return { output, replacements };
}

function semanticSha256(text) {
  const normalized = String(text)
    .replace(/<<R\d{6}>>/gu, "<<REDACTED>>")
    .replaceAll("\r\n", "\n");
  return sha256(Buffer.from(normalized, "utf8"));
}

function sourceSemanticSha256(text) {
  return sha256(
    Buffer.from(redactTransform(String(text), true).output.replaceAll("\r\n", "\n"), "utf8"),
  );
}

function ledgerSelfHash(value) {
  const basis = { ...value };
  delete basis.ledgerSelfSha256;
  return sha256(Buffer.from(stable(basis), "utf8"));
}

function readRedactionLedger(root, rootDevice, allowMissing) {
  const path = resolve(root, "metadata", "redaction-ledger.json");
  if (!existsSync(path)) {
    if (allowMissing) {
      return {
        schemaVersion: REDACTION_LEDGER_SCHEMA,
        rulesVersion: REDACTION_RULES_VERSION,
        entries: [],
      };
    }
    fail("UE581_REDACTION_LEDGER_MISSING");
  }
  requirePlainFile(path, rootDevice, "UE581_REDACTION_LEDGER_INVALID");
  const ledger = readJson(path, "UE581_REDACTION_LEDGER_INVALID");
  exactKeys(
    ledger,
    ["schemaVersion", "rulesVersion", "entries", "ledgerSelfSha256"],
    "UE581_REDACTION_LEDGER_INVALID",
  );
  if (
    ledger.schemaVersion !== REDACTION_LEDGER_SCHEMA ||
    ledger.rulesVersion !== REDACTION_RULES_VERSION ||
    !Array.isArray(ledger.entries) ||
    !isHex(ledger.ledgerSelfSha256) ||
    ledger.ledgerSelfSha256 !== ledgerSelfHash(ledger)
  ) {
    fail("UE581_REDACTION_LEDGER_INVALID");
  }
  return ledger;
}

function validateRedactionEntry(root, rootDevice, entry) {
  exactKeys(
    entry,
    ["output", "replacements", "semanticSha256", "source"],
    "UE581_REDACTION_ENTRY_INVALID",
  );
  exactKeys(entry.source, ["sha256", "size"], "UE581_REDACTION_ENTRY_INVALID");
  exactKeys(entry.output, ["path", "sha256", "size"], "UE581_REDACTION_ENTRY_INVALID");
  if (
    !Number.isSafeInteger(entry.source.size) ||
    entry.source.size < 0 ||
    !isHex(entry.source.sha256) ||
    !Number.isSafeInteger(entry.output.size) ||
    entry.output.size < 0 ||
    !isHex(entry.output.sha256) ||
    !isHex(entry.semanticSha256) ||
    !Array.isArray(entry.replacements)
  ) {
    fail("UE581_REDACTION_ENTRY_INVALID");
  }
  const logical = canonicalLogical(entry.output.path, "UE581_REDACTION_ENTRY_INVALID");
  if (!REQUIRED_LOGS.includes(logical)) fail("UE581_REDACTION_OUTPUT_INVALID");
  let previousRule = -1;
  for (const replacement of entry.replacements) {
    exactKeys(replacement, ["count", "rule"], "UE581_REDACTION_ENTRY_INVALID");
    const ruleIndex = REDACTION_RULES.findIndex(({ id }) => id === replacement.rule);
    if (
      ruleIndex <= previousRule ||
      !Number.isSafeInteger(replacement.count) ||
      replacement.count < 1
    ) {
      fail("UE581_REDACTION_ENTRY_INVALID");
    }
    previousRule = ruleIndex;
  }
  const path = resolve(root, ...logical.split("/"));
  const info = requirePlainFile(path, rootDevice, "UE581_REDACTION_OUTPUT_INVALID");
  const bytes = readFileSync(path);
  assertSecretFree(bytes, "UE581_REDACTION_OUTPUT_SENSITIVE");
  if (
    info.size !== entry.output.size ||
    sha256(bytes) !== entry.output.sha256 ||
    semanticSha256(bytes.toString("utf8")) !== entry.semanticSha256
  ) {
    fail("UE581_REDACTION_OUTPUT_DRIFT");
  }
  const placeholders = bytes.toString("utf8").match(/<<R\d{6}>>/gu) ?? [];
  const replacementCount = entry.replacements.reduce(
    (total, replacement) => total + replacement.count,
    0,
  );
  if (
    placeholders.length !== replacementCount ||
    placeholders.some(
      (placeholder, index) => placeholder !== `<<R${String(index + 1).padStart(6, "0")}>>`,
    )
  ) {
    fail("UE581_REDACTION_PLACEHOLDER_INVALID");
  }
  return logical;
}

function validateRedactions(root, rootDevice) {
  const ledger = readRedactionLedger(root, rootDevice, false);
  const paths = ledger.entries.map((entry) => validateRedactionEntry(root, rootDevice, entry));
  const folded = new Set();
  for (const path of paths) {
    const key = path.toLowerCase();
    if (folded.has(key)) fail("UE581_REDACTION_ENTRY_DUPLICATE");
    folded.add(key);
  }
  if (
    paths.length !== REQUIRED_LOGS.length ||
    REQUIRED_LOGS.some((path) => !paths.includes(path))
  ) {
    fail("UE581_REDACTION_COVERAGE_INVALID");
  }
  return ledger;
}

function redactLog(rootValue, sourceValue, outputLogicalValue) {
  const { root, rootDevice } = resolveRoot(rootValue);
  const outputLogical = canonicalLogical(outputLogicalValue, "UE581_REDACTION_OUTPUT_INVALID");
  if (!REQUIRED_LOGS.includes(outputLogical)) {
    fail("UE581_REDACTION_OUTPUT_INVALID");
  }
  const source = resolve(sourceValue);
  const output = resolve(root, ...outputLogical.split("/"));
  if (
    isWithin(root, source) ||
    !existsSync(source) ||
    !lstatSync(source).isFile() ||
    lstatSync(source).isSymbolicLink() ||
    existsSync(output)
  ) {
    fail("UE581_REDACTION_SOURCE_INVALID");
  }
  requirePlainDirectory(resolve(output, ".."), rootDevice, "UE581_REDACTION_OUTPUT_INVALID");
  const raw = readFileSync(source);
  const rawText = raw.toString("utf8");
  if (rawText.includes("\uFFFD")) fail("UE581_REDACTION_SOURCE_INVALID");
  const transformed = redactTransform(rawText, false);
  const semantic = sourceSemanticSha256(rawText);
  if (semanticSha256(transformed.output) !== semantic) {
    fail("UE581_REDACTION_SEMANTIC_MISMATCH");
  }
  const bytes = Buffer.from(transformed.output, "utf8");
  assertSecretFree(bytes, "UE581_REDACTION_OUTPUT_SENSITIVE");
  const ledger = readRedactionLedger(root, rootDevice, true);
  if (ledger.entries.some((entry) => entry.output.path === outputLogical)) {
    fail("UE581_REDACTION_ENTRY_DUPLICATE");
  }
  writeFileSync(output, bytes, { flag: "wx" });
  try {
    const entry = {
      source: { size: raw.length, sha256: sha256(raw) },
      output: { path: outputLogical, size: bytes.length, sha256: sha256(bytes) },
      replacements: transformed.replacements,
      semanticSha256: semantic,
    };
    const next = {
      schemaVersion: REDACTION_LEDGER_SCHEMA,
      rulesVersion: REDACTION_RULES_VERSION,
      entries: [...ledger.entries, entry].sort((left, right) =>
        left.output.path.localeCompare(right.output.path, "en"),
      ),
    };
    next.ledgerSelfSha256 = ledgerSelfHash(next);
    const ledgerPath = resolve(root, "metadata", "redaction-ledger.json");
    writeFileSync(ledgerPath, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      flag: existsSync(ledgerPath) ? "w" : "wx",
    });
    return {
      status: "log_redacted",
      output: outputLogical,
      sourceSize: entry.source.size,
      sourceSha256: entry.source.sha256,
      outputSha256: entry.output.sha256,
      replacementCount: entry.replacements.reduce(
        (total, replacement) => total + replacement.count,
        0,
      ),
    };
  } catch (error) {
    unlinkSync(output);
    throw error;
  }
}

function packageInventorySelfHash(value) {
  const basis = { ...value };
  delete basis.ledgerSelfSha256;
  return sha256(Buffer.from(stable(basis), "utf8"));
}

function fileRecord(root, logical) {
  canonicalLogical(logical);
  const path = resolve(root, ...logical.split("/"));
  const info = statSync(path);
  return { path: logical, size: info.size, sha256: sha256(readFileSync(path)) };
}

function prefixedPackageRecords(records) {
  return records.map(({ path, size, sha256: digest }) => ({
    path: `${PACKAGE_ROOT}/${path}`,
    size,
    sha256: digest,
  }));
}

function manifestIdentity(manifest, manifestFileSha256, module) {
  return {
    schemaVersion: IDENTITY_SCHEMA,
    pluginId: manifest.pluginId,
    pluginVersion: manifest.pluginVersion,
    contractVersion: manifest.contractVersion,
    sourceCommit: manifest.sourceCommit,
    sourceTreeSha256: manifest.sourceTreeSha256,
    buildManifestSha256: manifestFileSha256,
    buildCommandFingerprint: manifest.buildCommandFingerprint,
    loadedModuleName: basename(module.path),
    loadedModuleSha256: module.sha256,
    engineVersion: manifest.engineVersion,
    engineChangelist: manifest.engineChangelist,
    compatibleChangelist: manifest.compatibleChangelist,
    moduleBuildId: manifest.moduleBuildId,
  };
}

function validateIdentityShape(identity) {
  exactKeys(
    identity,
    [
      "schemaVersion",
      "pluginId",
      "pluginVersion",
      "contractVersion",
      "sourceCommit",
      "sourceTreeSha256",
      "buildManifestSha256",
      "buildCommandFingerprint",
      "loadedModuleName",
      "loadedModuleSha256",
      "engineVersion",
      "engineChangelist",
      "compatibleChangelist",
      "moduleBuildId",
    ],
    "UE581_IDENTITY_INVALID",
  );
  if (
    identity.schemaVersion !== IDENTITY_SCHEMA ||
    identity.pluginId !== "UAgentAssetTools" ||
    identity.pluginVersion !== "0.1.0" ||
    identity.contractVersion !== "mvp15d.asset-tools.v1" ||
    typeof identity.sourceCommit !== "string" ||
    !/^[0-9a-f]{40}$/.test(identity.sourceCommit) ||
    !isHex(identity.sourceTreeSha256) ||
    !isHex(identity.buildManifestSha256) ||
    !isHex(identity.buildCommandFingerprint) ||
    !/^UnrealEditor-[A-Za-z0-9_.-]+\.dll$/.test(identity.loadedModuleName) ||
    !isHex(identity.loadedModuleSha256) ||
    identity.engineVersion !== "5.8.1" ||
    identity.engineChangelist !== 56057345 ||
    identity.compatibleChangelist !== 55116800 ||
    identity.moduleBuildId !== "55116800"
  ) {
    fail("UE581_IDENTITY_INVALID");
  }
  return identity;
}

function validateLoadedModules(root, rootDevice, taskId) {
  const path = resolve(root, "captures", "loaded-modules.json");
  requirePlainFile(path, rootDevice, "UE581_LOADED_MODULES_INVALID");
  const value = readJson(path, "UE581_LOADED_MODULES_INVALID");
  exactKeys(
    value,
    ["schemaVersion", "taskId", "sessionId", "generation", "processIdentitySha256", "modules"],
    "UE581_LOADED_MODULES_INVALID",
  );
  if (
    value.schemaVersion !== LOADED_MODULES_SCHEMA ||
    value.taskId !== taskId ||
    typeof value.sessionId !== "string" ||
    !/^[A-Za-z0-9._:-]{16,160}$/.test(value.sessionId) ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1 ||
    !isHex(value.processIdentitySha256) ||
    !Array.isArray(value.modules) ||
    value.modules.length < 1
  ) {
    fail("UE581_LOADED_MODULES_INVALID");
  }
  const folded = new Set();
  for (const module of value.modules) {
    exactKeys(module, ["name", "path", "sha256", "size"], "UE581_LOADED_MODULES_INVALID");
    canonicalLogical(module.path, "UE581_LOADED_MODULES_INVALID");
    if (
      !PACKAGE_MODULE_PATTERN.test(module.path) ||
      basename(module.path) !== module.name ||
      !Number.isSafeInteger(module.size) ||
      module.size < 1 ||
      !isHex(module.sha256) ||
      folded.has(module.name.toLowerCase())
    ) {
      fail("UE581_LOADED_MODULES_INVALID");
    }
    folded.add(module.name.toLowerCase());
  }
  return value;
}

function validateBuildEvidence(root, rootDevice, manifest) {
  const expected = [
    "metadata/build-command.json",
    "metadata/build-result.json",
    "logs/runuat.stdout.redacted.log",
    "logs/runuat.stderr.redacted.log",
  ]
    .map((path) => fileRecord(root, path))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  const observed = [...manifest.buildEvidenceArtifacts].sort((left, right) =>
    left.path.localeCompare(right.path, "en"),
  );
  if (stable(observed) !== stable(expected)) fail("UE581_BUILD_EVIDENCE_BINDING_INVALID");
  const commandPath = resolve(root, "metadata", "build-command.json");
  const resultPath = resolve(root, "metadata", "build-result.json");
  requirePlainFile(commandPath, rootDevice, "UE581_BUILD_COMMAND_INVALID");
  requirePlainFile(resultPath, rootDevice, "UE581_BUILD_RESULT_INVALID");
  const command = readJson(commandPath, "UE581_BUILD_COMMAND_INVALID");
  const result = readJson(resultPath, "UE581_BUILD_RESULT_INVALID");
  if (
    command?.schemaVersion !== BUILD_COMMAND_SCHEMA ||
    command?.taskGeneration !== TASK_GENERATION ||
    command?.taskId !== manifest.taskId ||
    command?.commandFingerprint !== manifest.buildCommandFingerprint ||
    result?.schemaVersion !== BUILD_RESULT_SCHEMA ||
    result?.taskGeneration !== TASK_GENERATION ||
    result?.status !== "build_completed" ||
    result?.commandFingerprint !== manifest.buildCommandFingerprint
  ) {
    fail("UE581_BUILD_EVIDENCE_SCHEMA_INVALID");
  }
}

function validatePackageSemanticIdentity(packageRoot, manifest) {
  const moduleIndex = readJson(
    resolve(packageRoot, "Binaries", "Win64", "UnrealEditor.modules"),
    "UE581_PACKAGE_MODULE_INDEX_INVALID",
  );
  exactKeys(moduleIndex, ["BuildId", "Modules"], "UE581_PACKAGE_MODULE_INDEX_INVALID");
  if (
    moduleIndex.BuildId !== manifest.moduleBuildId ||
    !moduleIndex.Modules ||
    typeof moduleIndex.Modules !== "object" ||
    Array.isArray(moduleIndex.Modules)
  ) {
    fail("UE581_PACKAGE_MODULE_INDEX_INVALID");
  }
  const expectedModules = Object.fromEntries(
    manifest.modules.map(({ path }) => {
      const name = basename(path);
      const match = name.match(/^UnrealEditor-([A-Za-z0-9_.-]+)\.dll$/);
      if (!match) fail("UE581_PACKAGE_MODULE_INDEX_INVALID");
      return [match[1], name];
    }),
  );
  exactKeys(
    moduleIndex.Modules,
    Object.keys(expectedModules),
    "UE581_PACKAGE_MODULE_INDEX_INVALID",
  );
  if (Object.entries(expectedModules).some(([name, file]) => moduleIndex.Modules[name] !== file)) {
    fail("UE581_PACKAGE_MODULE_INDEX_INVALID");
  }
  const descriptor = readJson(
    resolve(packageRoot, "UAgentAssetTools.uplugin"),
    "UE581_PACKAGE_DESCRIPTOR_INVALID",
  );
  if (descriptor?.FileVersion !== 3 || descriptor?.VersionName !== manifest.pluginVersion) {
    fail("UE581_PACKAGE_DESCRIPTOR_INVALID");
  }
  const contract = readJson(
    resolve(packageRoot, "Resources", "uagent-asset-tools.schema.json"),
    "UE581_PACKAGE_CONTRACT_SCHEMA_INVALID",
  );
  const identity = contract?.properties?.identitySchema?.properties;
  if (
    contract?.$id !== "uagent.ue-companion-plugin.asset-tools.v1" ||
    identity?.schemaVersion?.const !== IDENTITY_SCHEMA ||
    identity?.pluginId?.const !== manifest.pluginId ||
    identity?.contractVersion?.const !== manifest.contractVersion ||
    identity?.engineVersion?.const !== manifest.engineVersion ||
    identity?.engineChangelist?.const !== manifest.engineChangelist ||
    identity?.compatibleChangelist?.const !== manifest.compatibleChangelist ||
    identity?.moduleBuildId?.const !== manifest.moduleBuildId
  ) {
    fail("UE581_PACKAGE_CONTRACT_SCHEMA_INVALID");
  }
}

function derivePackageBinding(root, rootDevice) {
  const packageRoot = resolve(root, ...PACKAGE_ROOT.split("/"));
  requirePlainDirectory(packageRoot, rootDevice, "UE581_PACKAGE_ROOT_INVALID");
  const manifestPath = resolve(packageRoot, "UAgentAssetTools.build.json");
  requirePlainFile(manifestPath, rootDevice, "UE581_PACKAGE_MANIFEST_INVALID");
  const manifest = validateManifestShape(readJson(manifestPath, "UE581_PACKAGE_MANIFEST_INVALID"));
  if (manifest.schemaVersion !== MANIFEST_SCHEMA) fail("UE581_PACKAGE_MANIFEST_INVALID");
  const collected = collectPackageArtifacts(packageRoot, true);
  if (
    stable(collected.artifacts) !== stable(manifest.artifacts) ||
    stable(collected.modules) !== stable(manifest.modules)
  ) {
    fail("UE581_PACKAGE_MANIFEST_BINDING_INVALID");
  }
  validatePackageSemanticIdentity(packageRoot, manifest);
  validateBuildEvidence(root, rootDevice, manifest);
  const loaded = validateLoadedModules(root, rootDevice, manifest.taskId);
  const loadedRecords = [...loaded.modules].sort((left, right) =>
    left.path.localeCompare(right.path, "en"),
  );
  const expectedModules = prefixedPackageRecords(manifest.modules).sort((left, right) =>
    left.path.localeCompare(right.path, "en"),
  );
  if (
    stable(
      loadedRecords.map(({ path, size, sha256: digest }) => ({
        path,
        size,
        sha256: digest,
      })),
    ) !== stable(expectedModules)
  ) {
    fail("UE581_LOADED_MANIFEST_BINDING_INVALID");
  }
  const module = manifest.modules.find(
    ({ path }) => basename(path) === "UnrealEditor-UAgentAssetTools.dll",
  );
  if (!module) fail("UE581_PACKAGE_MODULE_MISSING");
  const manifestFileSha256 = sha256(readFileSync(manifestPath));
  return {
    manifest,
    manifestFileSha256,
    identity: manifestIdentity(manifest, manifestFileSha256, module),
    artifacts: prefixedPackageRecords(manifest.artifacts),
    modules: prefixedPackageRecords(manifest.modules),
  };
}

function bindPackageArtifacts(rootValue) {
  const { root, rootDevice } = resolveRoot(rootValue);
  const binding = derivePackageBinding(root, rootDevice);
  const ledgerPath = resolve(root, "metadata", "package-artifacts.json");
  const identityPath = resolve(root, "metadata", "identity.json");
  if (existsSync(ledgerPath) || existsSync(identityPath)) {
    fail("UE581_PACKAGE_BINDING_EXISTS");
  }
  const ledger = {
    schemaVersion: PACKAGE_INVENTORY_SCHEMA,
    taskGeneration: TASK_GENERATION,
    taskId: binding.manifest.taskId,
    manifest: {
      path: PACKAGE_MANIFEST,
      size: statSync(resolve(root, ...PACKAGE_MANIFEST.split("/"))).size,
      sha256: binding.manifestFileSha256,
      manifestSelfSha256: binding.manifest.manifestSelfSha256,
    },
    identity: binding.identity,
    artifacts: binding.artifacts,
    modules: binding.modules,
  };
  ledger.ledgerSelfSha256 = packageInventorySelfHash(ledger);
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  try {
    writeFileSync(identityPath, `${JSON.stringify(binding.identity, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    unlinkSync(ledgerPath);
    throw error;
  }
  return {
    status: "package_artifacts_bound",
    taskId: binding.manifest.taskId,
    manifestSha256: binding.manifestFileSha256,
    artifactCount: binding.artifacts.length,
    moduleCount: binding.modules.length,
  };
}

function validatePackageArtifactLedger(root, rootDevice, binding) {
  const path = resolve(root, "metadata", "package-artifacts.json");
  requirePlainFile(path, rootDevice, "UE581_PACKAGE_INVENTORY_INVALID");
  const ledger = readJson(path, "UE581_PACKAGE_INVENTORY_INVALID");
  exactKeys(
    ledger,
    [
      "schemaVersion",
      "taskGeneration",
      "taskId",
      "manifest",
      "identity",
      "artifacts",
      "modules",
      "ledgerSelfSha256",
    ],
    "UE581_PACKAGE_INVENTORY_INVALID",
  );
  exactKeys(
    ledger.manifest,
    ["path", "size", "sha256", "manifestSelfSha256"],
    "UE581_PACKAGE_INVENTORY_INVALID",
  );
  const expected = {
    schemaVersion: PACKAGE_INVENTORY_SCHEMA,
    taskGeneration: TASK_GENERATION,
    taskId: binding.manifest.taskId,
    manifest: {
      path: PACKAGE_MANIFEST,
      size: statSync(resolve(root, ...PACKAGE_MANIFEST.split("/"))).size,
      sha256: binding.manifestFileSha256,
      manifestSelfSha256: binding.manifest.manifestSelfSha256,
    },
    identity: binding.identity,
    artifacts: binding.artifacts,
    modules: binding.modules,
  };
  expected.ledgerSelfSha256 = packageInventorySelfHash(expected);
  if (stable(ledger) !== stable(expected)) fail("UE581_PACKAGE_INVENTORY_BINDING_INVALID");
  const identity = validateIdentityShape(
    readJson(resolve(root, "metadata", "identity.json"), "UE581_IDENTITY_INVALID"),
  );
  if (stable(identity) !== stable(binding.identity)) fail("UE581_IDENTITY_BINDING_INVALID");
}

function validateArtifactReference(root, rootDevice, value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  const logical = value.relativePath ?? value.path;
  const size = value.size;
  const digest = value.sha256;
  canonicalLogical(logical, code);
  if (
    !Number.isSafeInteger(size) ||
    size < 0 ||
    !isHex(digest) ||
    !isWithin(root, resolve(root, ...logical.split("/")))
  ) {
    fail(code);
  }
  const path = resolve(root, ...logical.split("/"));
  const info = requirePlainFile(path, rootDevice, code);
  if (info.size !== size || sha256(readFileSync(path)) !== digest) fail(code);
  return logical;
}

function validateProducerLedger(root, rootDevice, phase, taskId) {
  const path = resolve(root, "metadata", `${phase}.producer.json`);
  const value = readJson(path, "UE581_PRODUCER_LEDGER_INVALID");
  if (
    value?.schemaVersion !== PRODUCER_LEDGER_SCHEMA ||
    value?.phase !== phase ||
    value?.taskId !== taskId ||
    !value.producer ||
    value.producer.id !== LIVE_PRODUCER_IDS[phase] ||
    (value.producer.mode !== undefined && !["live", "fixture"].includes(value.producer.mode)) ||
    !value.outputs ||
    (value.exitCode ?? value.termination?.exitCode) !== 0
  ) {
    fail("UE581_PRODUCER_LEDGER_INVALID");
  }
  const outputRecords = Array.isArray(value.outputs) ? value.outputs : Object.values(value.outputs);
  const logicalOutputs = outputRecords.map((record) =>
    validateArtifactReference(root, rootDevice, record, "UE581_PRODUCER_OUTPUT_INVALID"),
  );
  for (const expected of [`transcripts/${phase}.events.jsonl`, `logs/${phase}.stderr.log`]) {
    if (!logicalOutputs.includes(expected)) fail("UE581_PRODUCER_OUTPUT_COVERAGE_INVALID");
  }
  const runtimeTranscript = `transcripts/${phase}.runtime-events.jsonl`;
  if (
    existsSync(resolve(root, ...runtimeTranscript.split("/"))) &&
    !logicalOutputs.includes(runtimeTranscript)
  ) {
    fail("UE581_PRODUCER_OUTPUT_COVERAGE_INVALID");
  }
  if (
    !Array.isArray(value.outputs) &&
    (value.outputs.stdout?.relativePath ?? value.outputs.stdout?.path) !==
      (value.outputs.events?.relativePath ?? value.outputs.events?.path)
  ) {
    fail("UE581_PRODUCER_OUTPUT_COVERAGE_INVALID");
  }
  return value;
}

function validateTranscript(root, rootDevice, phase, taskId) {
  const path = resolve(root, "transcripts", `${phase}.events.jsonl`);
  requirePlainFile(path, rootDevice, "UE581_TRANSCRIPT_INVALID");
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/u).filter((line) => line.length > 0);
  if (lines.length < 3) fail("UE581_TRANSCRIPT_INVALID");
  let events;
  try {
    events = lines.map((line) => JSON.parse(line));
  } catch {
    fail("UE581_TRANSCRIPT_INVALID");
  }
  const evidenceMode = events[0]?.producer?.mode ?? events[0]?.evidenceMode ?? events[0]?.mode;
  if (!["live", "fixture"].includes(evidenceMode)) fail("UE581_TRANSCRIPT_EVENT_INVALID");
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (
      event?.schemaVersion !== EVENT_SCHEMA ||
      event?.phase !== phase ||
      event?.taskId !== taskId ||
      event?.sequence !== index + 1 ||
      (event.producer?.mode ?? event.evidenceMode ?? event.mode) !== evidenceMode ||
      /fixture|manual|direct[-_]?mcp/i.test(String(event.producer?.id ?? ""))
    ) {
      fail("UE581_TRANSCRIPT_EVENT_INVALID");
    }
  }
  if (
    events[0]?.type !== "process_started" ||
    !["closeout", "process_closeout"].includes(events.at(-1)?.type)
  ) {
    fail("UE581_TRANSCRIPT_TERMINAL_INVALID");
  }
  if (
    evidenceMode === "live" &&
    events.some(
      (event) =>
        event?.data?.authorityLevel === "source_only" ||
        (typeof event?.data?.authorityLevel === "string" &&
          ![
            "fixed_producer",
            "native_observed",
            "parent_observed",
            "runtime_observed",
            "derived_only",
          ].includes(event.data.authorityLevel)),
    )
  ) {
    fail("UE581_TRANSCRIPT_AUTHORITY_INVALID");
  }
  if (
    evidenceMode === "fixture" &&
    events.some(
      (event) =>
        typeof event?.data?.authorityLevel === "string" &&
        !["source_only", "derived_only"].includes(event.data.authorityLevel),
    )
  ) {
    fail("UE581_TRANSCRIPT_AUTHORITY_INVALID");
  }
  if (phase === "product-capture" || phase === "ui-lifecycle") {
    const forbidden =
      phase === "product-capture"
        ? ["installed_loaded", "tool_published", "tool_retracted", "tool_search_observation"]
        : [
            "installed_loaded",
            "content_snapshot",
            "lifecycle_action",
            "negative_case",
            "partial_unknown_effect_record",
            "replay_observation",
          ];
    const required =
      phase === "product-capture"
        ? [
            "fixed_artifact_authority",
            "product_discovery_observation",
            "retraction_observation",
            "mutation_counter_observation",
          ]
        : [
            "fixed_artifact_authority",
            "lifecycle_operation_observation",
            "content_manifest_observation",
            "negative_case_observation",
            "partial_unknown_observation",
            "replay_inspection_observation",
          ];
    if (
      events.some(({ type }) => forbidden.includes(type)) ||
      required.some((type) => !events.some((event) => event.type === type))
    ) {
      fail("UE581_TRANSCRIPT_AUTHORITY_INVALID");
    }
    const closeout = events.at(-1).data;
    const runtime = events.find(({ type }) => type === "runtime_process_started")?.data;
    if (
      (evidenceMode === "live"
        ? closeout.authorityLevel !== "parent_observed"
        : closeout.authorityLevel !== "source_only") ||
      !isHex(closeout.jobCloseoutSha256) ||
      !isHex(closeout.portObservationSha256) ||
      closeout.runtimeProcessId !== runtime?.pid ||
      closeout.phaseSessionId !== events.at(-1).sessionId ||
      closeout.phaseGeneration !== events.at(-1).generation ||
      [
        closeout.processResidualCount,
        closeout.portResidualCount,
        closeout.markerResidualCount,
        closeout.partialOutputCount,
      ].some((count) => count !== 0)
    ) {
      fail("UE581_TRANSCRIPT_CLOSEOUT_INVALID");
    }
  }
  return events;
}

function validateRuntimeTranscript(root, rootDevice, phase, taskId) {
  const logical = `transcripts/${phase}.runtime-events.jsonl`;
  const path = resolve(root, ...logical.split("/"));
  if (!existsSync(path)) return null;
  requirePlainFile(path, rootDevice, "UE581_RUNTIME_TRANSCRIPT_INVALID");
  const lines = readFileSync(path, "utf8").split(/\r?\n/u).filter(Boolean);
  if (lines.length < 2) fail("UE581_RUNTIME_TRANSCRIPT_INVALID");
  let events;
  try {
    events = lines.map((line) => JSON.parse(line));
  } catch {
    fail("UE581_RUNTIME_TRANSCRIPT_INVALID");
  }
  if (
    events.some(
      (event) =>
        event?.schemaVersion !== RUNTIME_EVENT_SCHEMA ||
        event?.phase !== phase ||
        typeof event?.type !== "string" ||
        !event?.data ||
        typeof event.data !== "object" ||
        Array.isArray(event.data),
    ) ||
    events.filter(({ type }) => type === "evidence_origin").length !== 1 ||
    events.at(-1)?.type !== "closeout"
  ) {
    fail("UE581_RUNTIME_TRANSCRIPT_INVALID");
  }
  const origin = events.find(({ type }) => type === "evidence_origin");
  if (
    origin.data.origin !== "production_runtime" ||
    origin.data.fixtureUsed !== false ||
    /fixture|manual|direct[-_]?mcp/i.test(JSON.stringify(events))
  ) {
    fail("UE581_RUNTIME_TRANSCRIPT_ORIGIN_INVALID");
  }
  const identity = events.find(({ type }) => type === "runtime_process_identity")?.data;
  if (
    identity &&
    (identity.taskId !== taskId ||
      !/^[0-9a-f]{40}$/.test(identity.sourceCommit) ||
      !Number.isSafeInteger(identity.generation) ||
      identity.generation < 1 ||
      !isHex(identity.nonceSha256) ||
      !Number.isSafeInteger(identity.process?.pid) ||
      !isHex(identity.process?.executableSha256))
  ) {
    fail("UE581_RUNTIME_TRANSCRIPT_BINDING_INVALID");
  }
  const closeout = events.at(-1).data;
  if (phase === "product-capture" || phase === "ui-lifecycle") {
    if (
      stable(closeout) !==
      stable({
        authorityLevel: "runtime_observed",
        rendererCompleted: true,
        driverCommandConsumed: true,
      })
    ) {
      fail("UE581_RUNTIME_TRANSCRIPT_CLOSEOUT_INVALID");
    }
  } else if (Object.values(closeout).some((value) => value !== 0)) {
    fail("UE581_RUNTIME_TRANSCRIPT_CLOSEOUT_INVALID");
  }
  if (events.some((event) => event?.data?.authorityLevel === "source_only")) {
    fail("UE581_RUNTIME_TRANSCRIPT_AUTHORITY_INVALID");
  }
  return events;
}

function validateSummary(root, rootDevice, phase, taskId) {
  const path = resolve(root, "summaries", `${phase}.json`);
  const value = readJson(path, "UE581_SUMMARY_INVALID");
  if (
    value?.schemaVersion !== PHASE_SUMMARY_SCHEMAS[phase] ||
    value?.taskGeneration !== TASK_GENERATION ||
    value?.taskId !== taskId ||
    !["live", "fixture"].includes(value?.evidenceMode) ||
    (value.evidenceMode === "fixture" && value.fixtureUsed !== true) ||
    (value.evidenceMode === "live" && value.fixtureUsed === true) ||
    /fixture|manual|direct[-_]?mcp/i.test(String(value?.producer ?? "")) ||
    !Array.isArray(value?.sourceArtifacts)
  ) {
    fail("UE581_SUMMARY_INVALID");
  }
  const paths = value.sourceArtifacts.map((record) =>
    validateArtifactReference(root, rootDevice, record, "UE581_SUMMARY_SOURCE_INVALID"),
  );
  for (const expected of [
    `metadata/${phase}.producer.json`,
    `metadata/${phase}.job-closeout.json`,
    `metadata/${phase}.port-closeout.json`,
    `transcripts/${phase}.events.jsonl`,
    `logs/${phase}.stderr.log`,
  ]) {
    if (!paths.includes(expected)) fail("UE581_SUMMARY_SOURCE_COVERAGE_INVALID");
  }
  const runtimeTranscript = `transcripts/${phase}.runtime-events.jsonl`;
  if (
    existsSync(resolve(root, ...runtimeTranscript.split("/"))) &&
    !paths.includes(runtimeTranscript)
  ) {
    fail("UE581_SUMMARY_SOURCE_COVERAGE_INVALID");
  }
  return value;
}

function collectObservationReceipts(value, receipts, receiptSequences, code) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) collectObservationReceipts(entry, receipts, receiptSequences, code);
    return;
  }
  if (Object.hasOwn(value, "receiptId") || Object.hasOwn(value, "receiptSequence")) {
    if (
      typeof value.receiptId !== "string" ||
      !/^mvp15d-observation-receipt:[0-9a-f]{64}$/u.test(value.receiptId) ||
      !Number.isSafeInteger(value.receiptSequence) ||
      value.receiptSequence < 1 ||
      (receipts.has(value.receiptId) && receipts.get(value.receiptId) !== value.receiptSequence) ||
      (receiptSequences.has(value.receiptSequence) &&
        receiptSequences.get(value.receiptSequence) !== value.receiptId)
    ) {
      fail(code);
    }
    receipts.set(value.receiptId, value.receiptSequence);
    receiptSequences.set(value.receiptSequence, value.receiptId);
  }
  for (const key of Object.keys(value).filter(
    (candidate) => candidate !== "receiptId" && candidate.endsWith("ReceiptId"),
  )) {
    const sequenceKey = key.replace(/ReceiptId$/u, "ReceiptSequence");
    if (!Object.hasOwn(value, sequenceKey)) continue;
    if (
      typeof value[key] !== "string" ||
      !/^mvp15d-observation-receipt:[0-9a-f]{64}$/u.test(value[key]) ||
      !Number.isSafeInteger(value[sequenceKey]) ||
      value[sequenceKey] < 1 ||
      (receipts.has(value[key]) && receipts.get(value[key]) !== value[sequenceKey]) ||
      (receiptSequences.has(value[sequenceKey]) &&
        receiptSequences.get(value[sequenceKey]) !== value[key])
    ) {
      fail(code);
    }
    receipts.set(value[key], value[sequenceKey]);
    receiptSequences.set(value[sequenceKey], value[key]);
  }
  if (
    Object.hasOwn(value, "id") &&
    Object.hasOwn(value, "sequence")
  ) {
    if (
      typeof value.id !== "string" ||
      !/^mvp15d-observation-receipt:[0-9a-f]{64}$/u.test(value.id) ||
      !Number.isSafeInteger(value.sequence) ||
      value.sequence < 1 ||
      (receipts.has(value.id) && receipts.get(value.id) !== value.sequence) ||
      (receiptSequences.has(value.sequence) && receiptSequences.get(value.sequence) !== value.id)
    ) {
      fail(code);
    }
    receipts.set(value.id, value.sequence);
    receiptSequences.set(value.sequence, value.id);
  }
  for (const entry of Object.values(value)) {
    collectObservationReceipts(entry, receipts, receiptSequences, code);
  }
}

function validateLivePhaseCrossBinding(root, phase, ledger, events, runtimeEvents, summary) {
  if (
    summary.evidenceMode !== "live" ||
    (phase !== "product-capture" && phase !== "ui-lifecycle")
  ) return;
  const code = "UE581_LIVE_PHASE_CROSS_BINDING_INVALID";
  const binding = summary.ownedLaunchBinding;
  const fixedArtifact = events.find(({ type }) => type === "fixed_artifact_authority")?.data;
  const runtimeProcess = events.find(({ type }) => type === "runtime_process_started")?.data;
  const closeout = events.at(-1)?.data;
  const runtimeIdentity = runtimeEvents?.find(({ type }) => type === "runtime_process_identity")?.data;
  const rawPath = resolve(root, "transcripts", `${phase}.runtime-events.jsonl`);
  const jobPath = resolve(root, "metadata", `${phase}.job-closeout.json`);
  const portPath = resolve(root, "metadata", `${phase}.port-closeout.json`);
  const processIdentity = {
    pid: runtimeProcess?.pid,
    executableBasename: runtimeProcess?.executable?.basename,
    executableSha256: runtimeProcess?.executable?.sha256,
  };
  if (
    !binding ||
    summary.productionLaunchAuthorityVerified !== false ||
    summary.producerLedgerSha256 !== sha256(readFileSync(resolve(root, "metadata", `${phase}.producer.json`))) ||
    summary.sourceCommit !== ledger.sourceCommit ||
    summary.sessionId !== ledger.sessionId ||
    summary.generation !== ledger.generation ||
    events.some(
      (event) =>
        event.taskId !== ledger.taskId ||
        event.phase !== phase ||
        event.marker !== ledger.marker ||
        event.sessionId !== ledger.sessionId ||
        event.generation !== ledger.generation ||
        event.producer?.pid !== ledger.processOwnership?.childPid,
    ) ||
    binding.sourceCommit !== ledger.sourceCommit ||
    binding.sourceTreeSha256 !== fixedArtifact?.sourceTreeSha256 ||
    binding.phaseProducerPid !== ledger.processOwnership?.childPid ||
    binding.runtimePid !== ledger.runtimeProcess?.pid ||
    binding.runtimePid !== closeout?.runtimeProcessId ||
    binding.runtimePid !== runtimeIdentity?.process?.pid ||
    binding.runtimeProcessSha256 !== sha256(Buffer.from(stable(runtimeProcess), "utf8")) ||
    binding.processIdentitySha256 !== sha256(Buffer.from(stable(processIdentity), "utf8")) ||
    binding.fixedArtifactBindingSha256 !== fixedArtifact?.producerBindingSha256 ||
    binding.fixedArtifactBindingSha256 !== summary.artifactAuthorityBindingSha256 ||
    binding.phaseEventsSha256 !== sha256(Buffer.from(stable(events), "utf8")) ||
    binding.rawEventLedgerSha256 !== sha256(readFileSync(rawPath)) ||
    binding.rawEventLedgerSha256 !== ledger.runtimeTransport?.eventFile?.sha256 ||
    binding.rawEventNonceSha256 !== ledger.runtimeTransport?.nonceSha256 ||
    binding.parentCloseoutSha256 !== sha256(Buffer.from(stable(closeout), "utf8")) ||
    binding.jobCloseoutSha256 !== sha256(readFileSync(jobPath)) ||
    binding.jobCloseoutSha256 !== closeout?.jobCloseoutSha256 ||
    binding.portCloseoutSha256 !== sha256(readFileSync(portPath)) ||
    binding.portCloseoutSha256 !== closeout?.portObservationSha256 ||
    fixedArtifact?.sourceCommit !== ledger.sourceCommit ||
    fixedArtifact?.phaseSessionId !== ledger.sessionId ||
    fixedArtifact?.phaseGeneration !== ledger.generation ||
    fixedArtifact?.runtimeProcessId !== ledger.runtimeProcess?.pid ||
    runtimeIdentity?.sourceCommit !== ledger.sourceCommit ||
    runtimeIdentity?.session !== ledger.sessionId ||
    runtimeIdentity?.generation !== ledger.generation ||
    runtimeIdentity?.process?.executableBasename !== ledger.runtimeProcess?.executable?.basename ||
    runtimeIdentity?.process?.executableSha256 !== ledger.runtimeProcess?.executable?.sha256
  ) {
    fail(code);
  }
  const receipts = new Map();
  const receiptSequences = new Map();
  for (const event of events) {
    collectObservationReceipts(event.data, receipts, receiptSequences, code);
  }
  if (
    !Number.isSafeInteger(summary.nativeObservationReceiptCount) ||
    summary.nativeObservationReceiptCount < (phase === "product-capture" ? 36 : 112) ||
    receipts.size !== summary.nativeObservationReceiptCount
  ) {
    fail(code);
  }
  if (phase === "product-capture") {
    const handoff = summary.rendererRestartHandoff;
    const rendererRestartEvents = events.filter(
      (event) => event.type === "retraction_observation" && event.data?.reason === "renderer_restart",
    );
    const rawHandoff = rendererRestartEvents[0]?.data?.rendererHandoff;
    const expectedHandoffKeys = [
      "claimReceiptId",
      "claimReceiptSequence",
      "handoffId",
      "parentAcknowledgementReceiptId",
      "parentAcknowledgementReceiptSequence",
      "predecessorMcpGeneration",
      "predecessorMcpSessionId",
      "predecessorProcessIdentitySha256",
      "predecessorRendererInstanceId",
      "predecessorWindowIdentity",
      "requestReceiptId",
      "requestReceiptSequence",
      "successorMcpGeneration",
      "successorMcpSessionId",
      "successorProcessIdentitySha256",
      "successorRendererInstanceId",
    ].sort();
    const expectedWindowKeys = [
      "handoffId",
      "phase",
      "schemaVersion",
      "stableIdentitySha256",
      "status",
      "taskId",
      "windowLabel",
    ].sort();
    if (
      rendererRestartEvents.length !== 1 ||
      !handoff ||
      !rawHandoff ||
      stable(Object.keys(handoff).sort()) !== stable(expectedHandoffKeys) ||
      stable(Object.keys(handoff.predecessorWindowIdentity ?? {}).sort()) !==
        stable(expectedWindowKeys) ||
      handoff.predecessorWindowIdentity.schemaVersion !==
        "uagent.mvp15d.predecessor-window-identity.v1" ||
      handoff.predecessorWindowIdentity.status !== "observed" ||
      handoff.predecessorWindowIdentity.windowLabel !== "main" ||
      /[\\/]/u.test(handoff.predecessorWindowIdentity.windowLabel) ||
      handoff.predecessorWindowIdentity.taskId !== ledger.taskId ||
      handoff.predecessorWindowIdentity.phase !== phase ||
      handoff.predecessorWindowIdentity.handoffId !== handoff.handoffId ||
      !/^[0-9a-f]{64}$/u.test(handoff.predecessorWindowIdentity.stableIdentitySha256) ||
      handoff.handoffId !== rawHandoff.handoffId ||
      handoff.predecessorRendererInstanceId !== rawHandoff.predecessorRenderer?.rendererInstanceId ||
      handoff.successorRendererInstanceId !== rawHandoff.successorRenderer?.rendererInstanceId ||
      handoff.predecessorProcessIdentitySha256 !== rawHandoff.predecessorRenderer?.processIdentitySha256 ||
      handoff.successorProcessIdentitySha256 !== rawHandoff.successorRenderer?.processIdentitySha256 ||
      handoff.predecessorMcpSessionId !== rawHandoff.predecessorMcpSessionId ||
      handoff.successorMcpSessionId !== rawHandoff.successorMcpSessionId ||
      handoff.predecessorMcpGeneration !== rawHandoff.predecessorMcpGeneration ||
      handoff.successorMcpGeneration !== rawHandoff.successorMcpGeneration ||
      handoff.requestReceiptId !== rawHandoff.requestReceipt?.id ||
      handoff.requestReceiptSequence !== rawHandoff.requestReceipt?.sequence ||
      handoff.parentAcknowledgementReceiptId !== rawHandoff.parentAcknowledgementReceipt?.id ||
      handoff.parentAcknowledgementReceiptSequence !== rawHandoff.parentAcknowledgementReceipt?.sequence ||
      handoff.claimReceiptId !== rawHandoff.claimReceipt?.id ||
      handoff.claimReceiptSequence !== rawHandoff.claimReceipt?.sequence ||
      stable(handoff.predecessorWindowIdentity) !== stable(rawHandoff.predecessorWindow) ||
      receipts.get(handoff.requestReceiptId) !== handoff.requestReceiptSequence ||
      receipts.get(handoff.parentAcknowledgementReceiptId) !==
        handoff.parentAcknowledgementReceiptSequence ||
      receipts.get(handoff.claimReceiptId) !== handoff.claimReceiptSequence ||
      handoff.requestReceiptSequence >= handoff.parentAcknowledgementReceiptSequence ||
      handoff.parentAcknowledgementReceiptSequence >= handoff.claimReceiptSequence
    ) {
      fail(code);
    }
  }
}

function validateSchemas(root, rootDevice, taskId) {
  for (const phase of PHASES) {
    const ledger = validateProducerLedger(root, rootDevice, phase, taskId);
    const events = validateTranscript(root, rootDevice, phase, taskId);
    const runtimeEvents = validateRuntimeTranscript(root, rootDevice, phase, taskId);
    const summary = validateSummary(root, rootDevice, phase, taskId);
    validateLivePhaseCrossBinding(root, phase, ledger, events, runtimeEvents, summary);
  }
}

function fileType(logical) {
  if (PACKAGE_MODULE_PATTERN.test(logical)) return "ue-module";
  if (logical.endsWith(".events.jsonl")) return "jsonl";
  if (logical.endsWith(".log")) return "redacted-log";
  if (logical.endsWith(".uplugin")) return "ue-plugin-descriptor";
  if (logical.endsWith(".modules")) return "ue-module-index";
  if (logical.endsWith(".json")) return "json";
  fail("UE581_INVENTORY_FILE_TYPE_FORBIDDEN");
}

function expectedSchema(logical) {
  if (logical === "captures/loaded-modules.json") return LOADED_MODULES_SCHEMA;
  if (logical === "metadata/build-command.json") return BUILD_COMMAND_SCHEMA;
  if (logical === "metadata/build-result.json") return BUILD_RESULT_SCHEMA;
  if (logical === "metadata/identity.json") return IDENTITY_SCHEMA;
  if (logical === "metadata/package-artifacts.json") return PACKAGE_INVENTORY_SCHEMA;
  if (logical === "metadata/redaction-ledger.json") return REDACTION_LEDGER_SCHEMA;
  if (/^metadata\/(?:ue-automation|product-capture|ui-lifecycle)\.producer\.json$/.test(logical)) {
    return PRODUCER_LEDGER_SCHEMA;
  }
  if (/^metadata\/(?:ue-automation|product-capture|ui-lifecycle)\.job-closeout\.json$/.test(logical)) {
    return JOB_CLOSEOUT_SCHEMA;
  }
  if (/^metadata\/(?:ue-automation|product-capture|ui-lifecycle)\.port-closeout\.json$/.test(logical)) {
    return PORT_CLOSEOUT_SCHEMA;
  }
  const summary = logical.match(/^summaries\/(ue-automation|product-capture|ui-lifecycle)\.json$/);
  if (summary) return PHASE_SUMMARY_SCHEMAS[summary[1]];
  if (
    /^transcripts\/(?:ue-automation|product-capture|ui-lifecycle)\.events\.jsonl$/.test(logical)
  ) {
    return EVENT_SCHEMA;
  }
  if (
    /^transcripts\/(?:ue-automation|product-capture|ui-lifecycle)\.runtime-events\.jsonl$/.test(
      logical,
    )
  ) {
    return RUNTIME_EVENT_SCHEMA;
  }
  if (logical === PACKAGE_MANIFEST) return MANIFEST_SCHEMA;
  return null;
}

function assertAdmissiblePath(logical, kind) {
  canonicalLogical(logical);
  const lowered = logical.toLowerCase();
  if (
    /(?:^|\/)(?:saved|intermediate|deriveddatacache|ddc|autosdk|user(?:settings?|config)|cache|caches|hostproject|content|config|source)(?:\/|$)/i.test(
      logical,
    )
  ) {
    fail("UE581_INVENTORY_FORBIDDEN_PATH");
  }
  if (kind === "directory") {
    if (!REQUIRED_DIRECTORIES.includes(logical)) {
      fail("UE581_INVENTORY_UNKNOWN_DIRECTORY");
    }
    return;
  }
  if (!STATIC_ALLOWED_FILES.has(logical) && !PACKAGE_MODULE_PATTERN.test(logical)) {
    fail("UE581_INVENTORY_UNKNOWN_FILE");
  }
  if (
    lowered.endsWith(".exe") ||
    lowered.endsWith(".pdb") ||
    lowered.endsWith(".lib") ||
    lowered.endsWith(".pak") ||
    lowered.endsWith(".uproject")
  ) {
    fail("UE581_INVENTORY_BINARY_FORBIDDEN");
  }
}

function collect(root, rootDevice, current = "", state) {
  const output = state ?? { directories: [], files: [], folded: new Map(), rootDevice };
  const directoryPath = current ? resolve(root, ...current.split("/")) : root;
  requirePlainDirectory(directoryPath, rootDevice, "UE581_INVENTORY_DIRECTORY_INVALID");
  const entries = readdirSync(directoryPath, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name, "en"),
  );
  for (const entry of entries) {
    const path = resolve(directoryPath, entry.name);
    const logical = logicalPath(root, path);
    if (logical === "inventory.json") continue;
    const folded = logical.toLowerCase();
    if (output.folded.has(folded)) fail("UE581_INVENTORY_CASE_COLLISION");
    output.folded.set(folded, logical);
    if (!isWithin(root, path)) fail("UE581_INVENTORY_PATH_ESCAPE");
    const info = lstatSync(path);
    if (
      entry.isSymbolicLink() ||
      info.isSymbolicLink() ||
      info.dev !== rootDevice ||
      !samePhysicalPath(realpathSync.native(path), path)
    ) {
      fail("UE581_INVENTORY_LINK_REPARSE_MOUNT_REJECTED");
    }
    if (entry.isDirectory() && info.isDirectory()) {
      assertAdmissiblePath(logical, "directory");
      output.directories.push(logical);
      collect(root, rootDevice, logical, output);
    } else if (entry.isFile() && info.isFile()) {
      assertAdmissiblePath(logical, "file");
      const type = fileType(logical);
      const limit = type === "ue-module" ? MODULE_LIMIT : FILE_LIMIT;
      if (info.size > limit) fail("UE581_INVENTORY_FILE_SIZE_FORBIDDEN");
      const bytes = readFileSync(path);
      if (type !== "ue-module") {
        if (bytes.includes(0)) fail("UE581_INVENTORY_BINARY_FORBIDDEN");
        assertSecretFree(bytes);
      } else {
        assertSecretFree(bytes, "UE581_INVENTORY_SENSITIVE_CONTENT", true);
      }
      output.files.push({
        path: logical,
        size: info.size,
        sha256: sha256(bytes),
        type,
        schemaVersion: expectedSchema(logical),
      });
    } else {
      fail("UE581_INVENTORY_SPECIAL_ENTRY_REJECTED");
    }
  }
  return output;
}

function validateClosure(walked) {
  const directories = [...walked.directories].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  const expectedDirectories = [...REQUIRED_DIRECTORIES].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  if (stable(directories) !== stable(expectedDirectories)) {
    fail("UE581_INVENTORY_DIRECTORY_CLOSURE_INVALID");
  }
  const paths = walked.files.map(({ path }) => path);
  for (const required of REQUIRED_FILES) {
    if (!paths.includes(required)) fail("UE581_INVENTORY_REQUIRED_FILE_MISSING");
  }
  const modules = paths.filter((path) => PACKAGE_MODULE_PATTERN.test(path));
  if (
    modules.length < 1 ||
    !modules.includes(`${PACKAGE_ROOT}/Binaries/Win64/UnrealEditor-UAgentAssetTools.dll`)
  ) {
    fail("UE581_INVENTORY_PACKAGE_MODULE_MISSING");
  }
}

function validateJsonSchemaDeclarations(root, walked) {
  for (const record of walked.files) {
    if (!record.schemaVersion) continue;
    const path = resolve(root, ...record.path.split("/"));
    if (record.type === "jsonl") {
      const lines = readFileSync(path, "utf8").split(/\r?\n/u).filter(Boolean);
      if (
        lines.length === 0 ||
        lines.some((line) => {
          try {
            return JSON.parse(line)?.schemaVersion !== record.schemaVersion;
          } catch {
            return true;
          }
        })
      ) {
        fail("UE581_INVENTORY_SCHEMA_GATE_FAILED");
      }
    } else {
      const value = readJson(path, "UE581_INVENTORY_SCHEMA_GATE_FAILED");
      if (value?.schemaVersion !== record.schemaVersion) {
        fail("UE581_INVENTORY_SCHEMA_GATE_FAILED");
      }
    }
  }
}

function bundleHash(directories, files) {
  return sha256(
    Buffer.from(
      [
        ...directories.map((path) => `D\0${path}`),
        ...files.map(
          ({ path, size, sha256: digest, type, schemaVersion }) =>
            `F\0${path}\0${size}\0${digest}\0${type}\0${schemaVersion ?? ""}`,
        ),
      ].join("\n"),
      "utf8",
    ),
  );
}

function inventoryBase(taskId, walked) {
  const directories = [...walked.directories].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  const files = [...walked.files].sort((left, right) => left.path.localeCompare(right.path, "en"));
  return {
    schemaVersion: SCHEMA,
    taskGeneration: TASK_GENERATION,
    taskId,
    status: "complete",
    directoryCount: directories.length,
    fileCount: files.length,
    directories,
    files,
    bundleSha256: bundleHash(directories, files),
  };
}

function inventorySelfHash(value) {
  const basis = { ...value };
  delete basis.inventorySelfSha256;
  return sha256(Buffer.from(stable(basis), "utf8"));
}

function validateInventoryShape(inventory) {
  exactKeys(
    inventory,
    [
      "schemaVersion",
      "taskGeneration",
      "taskId",
      "status",
      "directoryCount",
      "fileCount",
      "directories",
      "files",
      "bundleSha256",
      "inventorySelfSha256",
    ],
    "UE581_INVENTORY_INVALID",
  );
  if (
    inventory.schemaVersion !== SCHEMA ||
    inventory.taskGeneration !== TASK_GENERATION ||
    !TASK_ID_PATTERN.test(inventory.taskId) ||
    inventory.status !== "complete" ||
    !Number.isSafeInteger(inventory.directoryCount) ||
    inventory.directoryCount < 1 ||
    !Number.isSafeInteger(inventory.fileCount) ||
    inventory.fileCount < 1 ||
    !Array.isArray(inventory.directories) ||
    !Array.isArray(inventory.files) ||
    !isHex(inventory.bundleSha256) ||
    !isHex(inventory.inventorySelfSha256)
  ) {
    fail("UE581_INVENTORY_INVALID");
  }
  const folded = new Map();
  for (const directory of inventory.directories) {
    canonicalLogical(directory, "UE581_INVENTORY_PATH_NONCANONICAL");
    const key = directory.toLowerCase();
    if (folded.has(key)) fail("UE581_INVENTORY_CASE_COLLISION");
    folded.set(key, directory);
    assertAdmissiblePath(directory, "directory");
  }
  for (const file of inventory.files) {
    exactKeys(file, ["path", "size", "sha256", "type", "schemaVersion"], "UE581_INVENTORY_INVALID");
    canonicalLogical(file.path, "UE581_INVENTORY_PATH_NONCANONICAL");
    const key = file.path.toLowerCase();
    if (folded.has(key)) fail("UE581_INVENTORY_CASE_COLLISION");
    folded.set(key, file.path);
    assertAdmissiblePath(file.path, "file");
    if (
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      !isHex(file.sha256) ||
      file.type !== fileType(file.path) ||
      file.schemaVersion !== expectedSchema(file.path)
    ) {
      fail("UE581_INVENTORY_INVALID");
    }
  }
  if (
    inventory.directoryCount !== inventory.directories.length ||
    inventory.fileCount !== inventory.files.length ||
    inventory.bundleSha256 !== bundleHash(inventory.directories, inventory.files) ||
    inventory.inventorySelfSha256 !== inventorySelfHash(inventory)
  ) {
    fail("UE581_INVENTORY_HASH_INVALID");
  }
}

function validateEvidence(root, rootDevice) {
  const walked = collect(root, rootDevice);
  validateClosure(walked);
  validateJsonSchemaDeclarations(root, walked);
  validateRedactions(root, rootDevice);
  const binding = derivePackageBinding(root, rootDevice);
  validatePackageArtifactLedger(root, rootDevice, binding);
  validateSchemas(root, rootDevice, binding.manifest.taskId);
  return { walked, taskId: binding.manifest.taskId };
}

function verifyInProcess(rootValue) {
  const { root, rootDevice } = resolveRoot(rootValue);
  const inventoryPath = resolve(root, "inventory.json");
  requirePlainFile(inventoryPath, rootDevice, "UE581_INVENTORY_INVALID");
  const inventory = readJson(inventoryPath, "UE581_INVENTORY_INVALID");
  validateInventoryShape(inventory);
  const { walked, taskId } = validateEvidence(root, rootDevice);
  const expected = inventoryBase(taskId, walked);
  const observedBase = { ...inventory };
  delete observedBase.inventorySelfSha256;
  if (stable(observedBase) !== stable(expected)) fail("UE581_INVENTORY_DRIFT");
  return {
    status: "inventory_verified",
    verificationProcess: "current-node-process",
    fileCount: inventory.fileCount,
    directoryCount: inventory.directoryCount,
    inventorySelfSha256: inventory.inventorySelfSha256,
    inventoryFileSha256: sha256(readFileSync(inventoryPath)),
    bundleSha256: inventory.bundleSha256,
  };
}

function verify(rootValue) {
  const { root } = resolveRoot(rootValue);
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url), "verify-internal", root],
    {
      cwd: resolve(fileURLToPath(new URL("..", import.meta.url))),
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      env: { ...process.env, UAGENT_UE581_INVENTORY_CHILD: "1" },
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    const code = String(result.stderr ?? "").trim();
    fail(/^UE581_[A-Z0-9_]+$/.test(code) ? code : "UE581_INVENTORY_CHILD_VERIFY_FAILED");
  }
  let verified;
  try {
    verified = JSON.parse(result.stdout);
  } catch {
    fail("UE581_INVENTORY_CHILD_VERIFY_FAILED");
  }
  if (verified?.status !== "inventory_verified") {
    fail("UE581_INVENTORY_CHILD_VERIFY_FAILED");
  }
  return { ...verified, verificationProcess: "new-node-process" };
}

function create(rootValue) {
  const { root, rootDevice } = resolveRoot(rootValue);
  const inventoryPath = resolve(root, "inventory.json");
  if (existsSync(inventoryPath)) fail("UE581_INVENTORY_EXISTS");
  const { walked, taskId } = validateEvidence(root, rootDevice);
  const base = inventoryBase(taskId, walked);
  const inventory = {
    ...base,
    inventorySelfSha256: inventorySelfHash(base),
  };
  writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  try {
    const verified = verify(root);
    return {
      ...verified,
      status: "inventory_created_and_verified",
    };
  } catch (error) {
    unlinkSync(inventoryPath);
    throw error;
  }
}

function main() {
  const [command, root, first, second] = process.argv.slice(2);
  let result;
  if (command === "create") result = create(root);
  else if (command === "verify") result = verify(root);
  else if (command === "verify-internal" && process.env.UAGENT_UE581_INVENTORY_CHILD === "1") {
    result = verifyInProcess(root);
  } else if (command === "redact-log") result = redactLog(root, first, second);
  else if (command === "bind-package") result = bindPackageArtifacts(root);
  else fail("UE581_INVENTORY_COMMAND_INVALID");
  console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(
      error instanceof InventoryError ? error.code : "UE581_INVENTORY_UNEXPECTED_FAILURE",
    );
    process.exitCode = 2;
  }
}

export {
  BUILD_COMMAND_SCHEMA,
  BUILD_RESULT_SCHEMA,
  EVENT_SCHEMA,
  IDENTITY_SCHEMA,
  InventoryError,
  JOB_CLOSEOUT_SCHEMA,
  LOADED_MODULES_SCHEMA,
  OPTIONAL_FILES,
  PACKAGE_INVENTORY_SCHEMA,
  PHASES,
  PHASE_SUMMARY_SCHEMAS,
  PORT_CLOSEOUT_SCHEMA,
  PRODUCER_LEDGER_SCHEMA,
  REDACTION_LEDGER_SCHEMA,
  REQUIRED_DIRECTORIES,
  REQUIRED_FILES,
  REQUIRED_LOGS,
  SCHEMA,
  TASK_GENERATION,
  bindPackageArtifacts,
  bundleHash,
  create,
  inventorySelfHash,
  ledgerSelfHash,
  manifestSelfHash,
  packageInventorySelfHash,
  redactLog,
  semanticSha256,
  sha256,
  stable,
  validateLivePhaseCrossBinding,
  verify,
  verifyInProcess,
};
