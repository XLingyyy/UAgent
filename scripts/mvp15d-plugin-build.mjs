#!/usr/bin/env node
/* global console, process */

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BUILD_COMMAND_SCHEMA = "uagent.mvp15d.final.build-command.v3";
const BUILD_RESULT_SCHEMA = "uagent.mvp15d.final.build-result.v4";
const TASK_GENERATION = "final-d13-d16";
const BUILD_MAX_BUFFER_BYTES = 256 * 1024 * 1024;
const DEFAULT_TASK_ID = "TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-FINAL-D13-D16";
const CANONICAL_FIXTURES = [
  "integrations/unreal/UAgentAssetTools/Resources/mvp15d-native-binding-v2.json",
  "packages/shared/test-fixtures/mvp15d-native-binding-v2.json",
];
const CANONICAL_FIXTURE_SIZE = 4_865;
const CANONICAL_FIXTURE_SHA256 = "771168ec8b6e7215672a4d839fa675d88f9207876e2c51513b26d6c58da56a1b";
const SAFE_MARKER = /^[A-Za-z0-9._:-]{24,160}$/;
const FINAL_ROOT = /^mvp15d-final-d13-d16-\d{8}_\d{6}(?:-[A-Za-z0-9]+)?$/;

class ToolingError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new ToolingError(code);
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

function stable(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("BUILD_NON_JSON_VALUE");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (
    !value ||
    typeof value !== "object" ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    fail("BUILD_NON_JSON_VALUE");
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
    .join(",")}}`;
}

function parseArgs(argv) {
  const supported = new Set([
    "mode",
    "source",
    "package",
    "runuat",
    "ue-root",
    "plugin",
    "evidence-root",
    "task-id",
    "task-marker",
    "uat-log",
  ]);
  const args = Object.create(null);
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) fail("BUILD_ARGUMENT_INVALID");
    const key = item.slice(2);
    if (!supported.has(key) || Object.hasOwn(args, key)) {
      fail("BUILD_ARGUMENT_INVALID");
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail("BUILD_ARGUMENT_INVALID");
    args[key] = value;
    index += 1;
  }
  return args;
}

function isWithin(root, candidate) {
  const pathRelative = relative(root, candidate);
  return pathRelative === "" || (!pathRelative.startsWith("..") && !isAbsolute(pathRelative));
}

function hasControlCharacter(value) {
  return [...value].some((character) => {
    const code = character.codePointAt(0);
    return code <= 31 || code === 127;
  });
}

function requireDirectory(path, code) {
  if (!existsSync(path)) fail(code);
  const stats = lstatSync(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) fail(code);
  return path;
}

function requireRegularFile(path, code) {
  if (!existsSync(path)) fail(code);
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink()) fail(code);
  return path;
}

function safeWindowsPath(value, code) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !isAbsolute(value) ||
    hasControlCharacter(value) ||
    /["%!^&|<>()]/.test(value) ||
    /(?:^|[\\/])(?:\.{1,2}|[^\\/]*[ .])(?:[\\/]|$)/.test(value)
  ) {
    fail(code);
  }
  return resolve(value);
}

function runGit(repositoryRoot, args, code, encoding = "utf8") {
  const result = spawnSync("git", ["-C", repositoryRoot, ...args], {
    encoding,
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) fail(code);
  return result.stdout;
}

function tryGit(repositoryRoot, args) {
  return spawnSync("git", ["-C", repositoryRoot, ...args], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
}

function toGitPath(value) {
  return value.split("\\").join("/");
}

function assertDetached(repositoryRoot) {
  const symbolic = tryGit(repositoryRoot, ["symbolic-ref", "-q", "HEAD"]);
  if (symbolic.error || symbolic.status === 0 || symbolic.status !== 1) {
    fail("SOURCE_HEAD_NOT_DETACHED");
  }
}

function assertCanonicalPhysicalBytes(repositoryRoot) {
  let previous = null;
  const fixtures = [];
  for (const logicalPath of CANONICAL_FIXTURES) {
    const absolutePath = requireRegularFile(
      resolve(repositoryRoot, logicalPath.split("/").join("\\")),
      "SOURCE_CANONICAL_FIXTURE_MISSING",
    );
    const bytes = readFileSync(absolutePath);
    const trackedBytes = runGit(
      repositoryRoot,
      ["show", `HEAD:${logicalPath}`],
      "SOURCE_CANONICAL_GIT_OBJECT_MISSING",
      null,
    );
    const tracked = Buffer.isBuffer(trackedBytes) ? trackedBytes : Buffer.from(trackedBytes ?? "");
    if (
      bytes.length !== CANONICAL_FIXTURE_SIZE ||
      sha256Bytes(bytes) !== CANONICAL_FIXTURE_SHA256 ||
      !bytes.equals(tracked) ||
      (previous && !bytes.equals(previous))
    ) {
      fail("SOURCE_CANONICAL_PHYSICAL_IDENTITY_MISMATCH");
    }
    previous = bytes;
    fixtures.push({
      path: logicalPath,
      size: bytes.length,
      sha256: sha256Bytes(bytes),
      gitObjectSha256: sha256Bytes(tracked),
    });
  }
  return fixtures;
}

function deriveGitFacts(source) {
  const sourceRoot = requireDirectory(resolve(source), "SOURCE_ROOT_INVALID");
  const repositoryRoot = resolve(
    runGit(sourceRoot, ["rev-parse", "--show-toplevel"], "SOURCE_GIT_UNAVAILABLE").trim(),
  );
  const dirty = runGit(
    repositoryRoot,
    ["status", "--porcelain=v1", "--untracked-files=all"],
    "SOURCE_GIT_UNAVAILABLE",
  );
  if (dirty.trim().length > 0) fail("SOURCE_TREE_DIRTY");
  assertDetached(repositoryRoot);
  const sourceCommit = runGit(
    repositoryRoot,
    ["rev-parse", "HEAD"],
    "SOURCE_GIT_UNAVAILABLE",
  ).trim();
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) fail("SOURCE_COMMIT_INVALID");
  const sourceRelative = toGitPath(relative(repositoryRoot, sourceRoot));
  if (sourceRelative.startsWith("../") || sourceRelative === "..") {
    fail("SOURCE_ROOT_OUTSIDE_GIT");
  }
  const treeListing = runGit(
    repositoryRoot,
    ["ls-tree", "-r", "-z", "HEAD"],
    "SOURCE_TREE_UNAVAILABLE",
    null,
  );
  const treeBytes = Buffer.isBuffer(treeListing) ? treeListing : Buffer.from(treeListing ?? "");
  if (treeBytes.length === 0) fail("SOURCE_TREE_EMPTY_OR_UNTRACKED");
  const sourceTreeSha256 = sha256Bytes(
    Buffer.concat([Buffer.from("uagent.mvp15d.git-tree.v2\0", "utf8"), treeBytes]),
  );
  return {
    repositoryRoot,
    sourceRoot,
    sourceCommit,
    sourceTreeSha256,
    physicalFixtures: assertCanonicalPhysicalBytes(repositoryRoot),
  };
}

function resolvePlugin(provenance, pluginArgument) {
  const candidates = pluginArgument
    ? [
        isAbsolute(pluginArgument)
          ? resolve(pluginArgument)
          : resolve(provenance.sourceRoot, pluginArgument),
      ]
    : [
        resolve(
          provenance.sourceRoot,
          "integrations",
          "unreal",
          "UAgentAssetTools",
          "UAgentAssetTools.uplugin",
        ),
      ];
  const existing = candidates.filter((candidate) => existsSync(candidate));
  if (existing.length !== 1) fail("PLUGIN_PATH_AMBIGUOUS_OR_MISSING");
  const plugin = requireRegularFile(
    safeWindowsPath(existing[0], "PLUGIN_PATH_UNSAFE"),
    "PLUGIN_FILE_INVALID",
  );
  if (!isWithin(provenance.sourceRoot, plugin)) {
    fail("PLUGIN_OUTSIDE_SOURCE_ROOT");
  }
  const pluginRelative = toGitPath(relative(provenance.repositoryRoot, plugin));
  runGit(
    provenance.repositoryRoot,
    ["ls-files", "--error-unmatch", "--", pluginRelative],
    "SOURCE_PLUGIN_NOT_TRACKED",
  );
  return plugin;
}

function resolveRunUat(value) {
  const runUat = requireRegularFile(
    safeWindowsPath(resolve(value), "RUNUAT_PATH_UNSAFE"),
    "RUNUAT_FILE_INVALID",
  );
  if (basename(runUat).toLowerCase() !== "runuat.bat") {
    fail("RUNUAT_BASENAME_INVALID");
  }
  return runUat;
}

function readJsonFile(path, code) {
  try {
    return JSON.parse(readFileSync(requireRegularFile(path, code), "utf8"));
  } catch (error) {
    if (error instanceof ToolingError) throw error;
    fail(code);
  }
}

function readEngineIdentity(value, runUat) {
  const ueRoot = requireDirectory(
    safeWindowsPath(resolve(value), "UE_ROOT_PATH_UNSAFE"),
    "UE_ROOT_INVALID",
  );
  const expectedRunUat = resolve(ueRoot, "Engine", "Build", "BatchFiles", "RunUAT.bat");
  if (resolve(runUat).toLowerCase() !== expectedRunUat.toLowerCase()) {
    fail("RUNUAT_ENGINE_ROOT_MISMATCH");
  }
  const buildVersionPath = resolve(ueRoot, "Engine", "Build", "Build.version");
  const buildVersion = readJsonFile(buildVersionPath, "UE_BUILD_VERSION_INVALID");
  if (
    buildVersion?.MajorVersion !== 5 ||
    buildVersion?.MinorVersion !== 8 ||
    buildVersion?.PatchVersion !== 1 ||
    buildVersion?.Changelist !== 56057345 ||
    buildVersion?.CompatibleChangelist !== 55116800 ||
    buildVersion?.BranchName !== "++UE5+Release-5.8"
  ) {
    fail("UE_BUILD_VERSION_IDENTITY_MISMATCH");
  }
  const moduleManifestPath = resolve(ueRoot, "Engine", "Binaries", "Win64", "UnrealEditor.modules");
  const moduleManifest = readJsonFile(moduleManifestPath, "UE_MODULE_MANIFEST_INVALID");
  if (
    !moduleManifest ||
    typeof moduleManifest !== "object" ||
    Array.isArray(moduleManifest) ||
    moduleManifest.BuildId !== "55116800" ||
    !moduleManifest.Modules ||
    typeof moduleManifest.Modules !== "object" ||
    Array.isArray(moduleManifest.Modules)
  ) {
    fail("UE_MODULE_BUILD_ID_MISMATCH");
  }
  return {
    engineVersion: "5.8.1",
    engineChangelist: 56057345,
    compatibleChangelist: 55116800,
    moduleBuildId: "55116800",
    branch: "++UE5+Release-5.8",
    buildVersion: {
      relativePath: "Engine/Build/Build.version",
      size: lstatSync(buildVersionPath).size,
      sha256: sha256File(buildVersionPath),
    },
    engineModuleManifest: {
      relativePath: "Engine/Binaries/Win64/UnrealEditor.modules",
      size: lstatSync(moduleManifestPath).size,
      sha256: sha256File(moduleManifestPath),
    },
  };
}

function orderedBuildArguments(plugin, packageRoot) {
  const normalizedPlugin = safeWindowsPath(plugin, "PLUGIN_PATH_UNSAFE");
  const normalizedPackage = safeWindowsPath(packageRoot, "PACKAGE_PATH_UNSAFE");
  return [
    "BuildPlugin",
    `-Plugin=${normalizedPlugin}`,
    `-Package=${normalizedPackage}`,
    "-TargetPlatforms=Win64",
    "-Rocket",
  ];
}

function quoteCmdToken(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    hasControlCharacter(value) ||
    /["%!^&|<>]/.test(value)
  ) {
    fail("RUNUAT_COMMAND_TOKEN_INVALID");
  }
  return `"${value}"`;
}

function exactCmdCommand(runUat, orderedArguments) {
  return [quoteCmdToken(runUat), ...orderedArguments.map(quoteCmdToken)].join(" ");
}

function ensurePackagedModuleIndex(packageRoot, engineIdentity) {
  const binaries = requireDirectory(
    resolve(packageRoot, "Binaries", "Win64"),
    "BUILD_PACKAGE_BINARIES_MISSING",
  );
  const moduleFiles = readdirSync(binaries)
    .filter((name) => /^UnrealEditor-[A-Za-z0-9_]+\.dll$/.test(name))
    .sort((left, right) => left.localeCompare(right));
  if (moduleFiles.length === 0) fail("BUILD_PACKAGE_MODULES_MISSING");
  const modules = Object.fromEntries(
    moduleFiles.map((name) => [name.slice("UnrealEditor-".length, -".dll".length), name]),
  );
  const expected = {
    BuildId: engineIdentity.moduleBuildId,
    Modules: modules,
  };
  const moduleIndexPath = resolve(binaries, "UnrealEditor.modules");
  if (existsSync(moduleIndexPath)) {
    const observed = readJsonFile(moduleIndexPath, "BUILD_PACKAGE_MODULE_INDEX_INVALID");
    if (stable(observed) !== stable(expected)) {
      fail("BUILD_PACKAGE_MODULE_INDEX_MISMATCH");
    }
    return;
  }
  writeFileSync(moduleIndexPath, `${JSON.stringify(expected, null, "\t")}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

function redactedOrderedArguments(orderedArguments) {
  return orderedArguments.map((argument) => {
    if (argument.startsWith("-Plugin=")) {
      return "-Plugin=${SOURCE_ROOT}/integrations/unreal/UAgentAssetTools/UAgentAssetTools.uplugin";
    }
    if (argument.startsWith("-Package=")) return "-Package=${PACKAGE_ROOT}";
    return argument;
  });
}

function commandFingerprintRecord({
  taskId,
  runUat,
  orderedArguments,
  provenance,
  plugin,
  packageRoot,
  engineIdentity,
}) {
  return {
    schemaVersion: BUILD_COMMAND_SCHEMA,
    taskGeneration: TASK_GENERATION,
    taskId,
    launcher: {
      basename: basename(runUat),
      size: lstatSync(runUat).size,
      sha256: sha256File(runUat),
    },
    orderedArgumentsSha256: sha256Bytes(Buffer.from(stable(orderedArguments), "utf8")),
    sourceCommit: provenance.sourceCommit,
    sourceTreeSha256: provenance.sourceTreeSha256,
    pluginDescriptor: {
      relativePath: toGitPath(relative(provenance.repositoryRoot, plugin)),
      size: lstatSync(plugin).size,
      sha256: sha256File(plugin),
    },
    packageOutputIdentity: sha256Bytes(Buffer.from(resolve(packageRoot).toLowerCase(), "utf8")),
    targetPlatform: "Win64",
    configuration: "Development",
    engineIdentity,
  };
}

function buildCommandLedger(input) {
  const fingerprintRecord = commandFingerprintRecord(input);
  return {
    ...fingerprintRecord,
    orderedArguments: redactedOrderedArguments(input.orderedArguments),
    commandFingerprint: sha256Bytes(Buffer.from(stable(fingerprintRecord), "utf8")),
  };
}

// Deterministic transcript privacy contract. Every retained BuildPlugin
// transcript passes through redactTranscript() before it is written, hashed or
// listed as a source artifact. The contract is machine-independent: any drive
// letter, UNC root, user-home anchor, UE/toolchain/SDK/RunUAT/package or
// evidence path is collapsed to a stable semantic placeholder.
//
// An absolute path starts at a drive, UNC or extended-device prefix; drive
// roots and repeated separators are included. Quoted and bracketed paths are
// collapsed as one unit so final segments may contain spaces or parentheses.
// Unquoted paths stop at punctuation, a new absolute path, a command flag or
// the first final-segment whitespace so neighboring diagnostics survive.
const TRANSCRIPT_SEGMENT_RELAXED = String.raw`(?:(?!\s+(?:[A-Za-z]:[\\\/]|[\\\/]{2}|\/[A-Za-z]))[^\\\/:*?"<>|\r\n;"'])+`;
const TRANSCRIPT_SEGMENT_FINAL = String.raw`[^\s\\\/:*?"<>|;,'"()\]}]+`;
const TRANSCRIPT_PATH_BODY = String.raw`(?:(?:${TRANSCRIPT_SEGMENT_RELAXED}[\\\/]+)*${TRANSCRIPT_SEGMENT_FINAL})?`;
const TRANSCRIPT_ABSOLUTE_PATH_START = String.raw`(?:[A-Za-z]:[\\\/]+|[\\\/]{2,}[?.][\\\/]+(?:UNC[\\\/]+)?(?:[A-Za-z]:[\\\/]+)?|[\\\/]{2,}(?![\\\/.?]))`;
const TRANSCRIPT_PATH_PATTERN = new RegExp(
  String.raw`(?:(?<![A-Za-z0-9])[A-Za-z]:[\\\/]+|(?<![:\\\/])[\\\/]{2,}[?.][\\\/]+(?:UNC[\\\/]+)?(?:[A-Za-z]:[\\\/]+)?|(?<![:\\\/])[\\\/]{2,}(?![\\\/.?]))${TRANSCRIPT_PATH_BODY}`,
  "giu",
);
const TRANSCRIPT_DOUBLE_QUOTED_PATH_PATTERN = new RegExp(
  String.raw`"(${TRANSCRIPT_ABSOLUTE_PATH_START})[^"\r\n]*"`,
  "giu",
);
const TRANSCRIPT_SINGLE_QUOTED_PATH_PATTERN = new RegExp(
  String.raw`'(${TRANSCRIPT_ABSOLUTE_PATH_START})[^'\r\n]*'`,
  "giu",
);
const TRANSCRIPT_PARENTHESIZED_PATH_PATTERN = new RegExp(
  String.raw`\((${TRANSCRIPT_ABSOLUTE_PATH_START})[^\r\n]*?\)(?=$|[\s.,;(\[{])`,
  "giu",
);
const TRANSCRIPT_SQUARE_BRACKETED_PATH_PATTERN = new RegExp(
  String.raw`\[(${TRANSCRIPT_ABSOLUTE_PATH_START})[^\]\r\n]*\]`,
  "giu",
);
const TRANSCRIPT_CURLY_BRACKETED_PATH_PATTERN = new RegExp(
  String.raw`\{(${TRANSCRIPT_ABSOLUTE_PATH_START})[^}\r\n]*\}`,
  "giu",
);
const TRANSCRIPT_BARE_USER_HOME_PATTERN = new RegExp(
  String.raw`(?<![A-Za-z0-9])[A-Za-z]:[\\\/]+(?:Users|Documents and Settings)[\\\/]+[^\\\/\r\n]*?(?=$|\s+[|;,]|[|;,])`,
  "gimu",
);
const TRANSCRIPT_REDACTED = "${REDACTED}";
const TRANSCRIPT_REDACTED_ENDPOINT = "${REDACTED_ENDPOINT}";
const TRANSCRIPT_SECRET_KEYS = [
  ...new Set([
    ...transcriptSeparatedVariants(["aws", "secret", "access", "key"]),
    ...transcriptSeparatedVariants(["aws", "session", "token"]),
    ...transcriptSeparatedVariants(["security", "token"]),
    ...transcriptSeparatedVariants(["refresh", "token"]),
    ...transcriptSeparatedVariants(["session", "token"]),
    ...transcriptSeparatedVariants(["access", "token"]),
    ...transcriptSeparatedVariants(["client", "secret"]),
    ...transcriptSeparatedVariants(["auth", "token"]),
    ...transcriptSeparatedVariants(["id", "token"]),
    ...transcriptSeparatedVariants(["x", "api", "key"]),
    ...transcriptSeparatedVariants(["api", "key"]),
    "api key",
    "api\tkey",
    "authorization",
    "credentials",
    "credential",
    "password",
    "username",
    "tokens",
    "passwd",
    "secret",
    "token",
    "user",
  ]),
].sort((left, right) => right.length - left.length || left.localeCompare(right));
const TRANSCRIPT_ENDPOINT_QUERY_KEYS = new Set([
  "access_token",
  "auth",
  "authorization",
  "api-key",
  "api_key",
  "apikey",
  "credential",
  "password",
  "secret",
  "token",
]);
const TRANSCRIPT_ENDPOINT_TERMINATORS = new Set(['"', "'", "<", ">", "(", "[", "{"]);
const TRANSCRIPT_ENDPOINT_TERMINAL_PUNCTUATION = new Set([",", ";", ")", "]", "}"]);
const TRANSCRIPT_TERMINAL_PUNCTUATION = new Set([".", "!", "?", ":", "/", ",", ";", ")", "]", "}"]);
const TRANSCRIPT_USER_HOME_PREFIX = /^[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/]/i;

function transcriptSeparatedVariants(parts) {
  let variants = [parts[0]];
  for (const part of parts.slice(1)) {
    variants = variants.flatMap((prefix) => ["", "-", "_"].map((joiner) => prefix + joiner + part));
  }
  return variants;
}

function isAsciiAlphaNumeric(character) {
  const code = character?.charCodeAt(0) ?? -1;
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAsciiWord(character) {
  return isAsciiAlphaNumeric(character) || character === "_";
}

function isHorizontalWhitespace(character) {
  return character === " " || character === "\t";
}

function isLineBreak(character) {
  return character === "\r" || character === "\n";
}

function isEndpointTerminator(character) {
  return (
    character === undefined ||
    /\s/u.test(character) ||
    TRANSCRIPT_ENDPOINT_TERMINATORS.has(character)
  );
}

function asciiEqualAt(value, index, expected) {
  if (index < 0 || index + expected.length > value.length) return false;
  for (let offset = 0; offset < expected.length; offset += 1) {
    const actualCode = value.charCodeAt(index + offset);
    const expectedCode = expected.charCodeAt(offset);
    const foldedActual = actualCode >= 65 && actualCode <= 90 ? actualCode + 32 : actualCode;
    const foldedExpected =
      expectedCode >= 65 && expectedCode <= 90 ? expectedCode + 32 : expectedCode;
    if (foldedActual !== foldedExpected) return false;
  }
  return true;
}

function parseTranscriptSecretKey(value, index) {
  for (const key of TRANSCRIPT_SECRET_KEYS) {
    if (asciiEqualAt(value, index, key)) return key.length;
  }
  return 0;
}

function terminalPunctuationStart(
  value,
  start,
  end,
  punctuation = TRANSCRIPT_TERMINAL_PUNCTUATION,
) {
  let cursor = end;
  while (cursor > start && punctuation.has(value[cursor - 1])) cursor -= 1;
  return cursor === start ? end : cursor;
}

function parseQuotedTranscriptValue(value, start, quote, outerEscaped) {
  let cursor = start + (outerEscaped ? 2 : 1);
  const contentStart = cursor;
  while (cursor < value.length && !isLineBreak(value[cursor])) {
    if (value[cursor] !== "\\") {
      if (!outerEscaped && value[cursor] === quote) {
        return {
          end: cursor + 1,
          redacted: value.slice(contentStart, cursor) === TRANSCRIPT_REDACTED,
        };
      }
      cursor += 1;
      continue;
    }
    const slashStart = cursor;
    while (cursor < value.length && value[cursor] === "\\") cursor += 1;
    const slashCount = cursor - slashStart;
    if (cursor < value.length && value[cursor] === quote) {
      if ((outerEscaped && slashCount === 1) || (!outerEscaped && slashCount % 2 === 0)) {
        return {
          end: cursor + 1,
          redacted:
            value.slice(contentStart, outerEscaped ? slashStart : cursor) === TRANSCRIPT_REDACTED,
        };
      }
      cursor += 1;
    }
  }
  return { end: cursor, redacted: false, malformed: true };
}

function parseTranscriptSecretValue(value, start) {
  if (start >= value.length || isLineBreak(value[start])) return null;
  if (value[start] === '"' || value[start] === "'") {
    return parseQuotedTranscriptValue(value, start, value[start], false);
  }
  if (value[start] === "\\" && (value[start + 1] === '"' || value[start + 1] === "'")) {
    return parseQuotedTranscriptValue(value, start, value[start + 1], true);
  }

  for (const scheme of ["Basic", "Bearer"]) {
    if (!asciiEqualAt(value, start, scheme)) continue;
    let cursor = start + scheme.length;
    if (!isHorizontalWhitespace(value[cursor])) continue;
    while (isHorizontalWhitespace(value[cursor])) cursor += 1;
    const tokenStart = cursor;
    const token = parseBareTranscriptValue(value, tokenStart);
    return token ? { ...token, redacted: false } : null;
  }

  return parseBareTranscriptValue(value, start);
}

function parseBareTranscriptValue(value, start) {
  let cursor = start;
  while (
    cursor < value.length &&
    !isLineBreak(value[cursor]) &&
    !isHorizontalWhitespace(value[cursor]) &&
    value[cursor] !== '"' &&
    value[cursor] !== "'"
  ) {
    cursor += 1;
  }
  if (cursor === start) return null;
  if (value.startsWith(TRANSCRIPT_REDACTED, start)) {
    const placeholderEnd = start + TRANSCRIPT_REDACTED.length;
    let suffix = placeholderEnd;
    while (suffix < cursor && TRANSCRIPT_TERMINAL_PUNCTUATION.has(value[suffix])) suffix += 1;
    if (suffix === cursor) return { end: placeholderEnd, redacted: true };
  }
  const contentEnd = terminalPunctuationStart(value, start, cursor);
  return {
    end: contentEnd,
    redacted: value.slice(start, contentEnd) === TRANSCRIPT_REDACTED,
  };
}

function parseTranscriptSecretFieldAt(value, start) {
  if (start > 0 && (isAsciiAlphaNumeric(value[start - 1]) || "_-".includes(value[start - 1]))) {
    return null;
  }
  let cursor = start;
  let wrapper = "";
  if (value[cursor] === "\\" && (value[cursor + 1] === '"' || value[cursor + 1] === "'")) {
    wrapper = value.slice(cursor, cursor + 2);
    cursor += 2;
  } else if (value[cursor] === '"' || value[cursor] === "'") {
    wrapper = value[cursor];
    cursor += 1;
  }
  const keyStart = cursor;
  const keyLength = parseTranscriptSecretKey(value, cursor);
  if (keyLength === 0) return null;
  cursor += keyLength;
  const keyEnd = cursor;
  if (wrapper) {
    if (!value.startsWith(wrapper, cursor)) return null;
    cursor += wrapper.length;
  }
  const separatorStart = cursor;
  while (isHorizontalWhitespace(value[cursor])) cursor += 1;
  if (value[cursor] === ":" || value[cursor] === "=") {
    cursor += 1;
    while (isHorizontalWhitespace(value[cursor])) cursor += 1;
  } else if (cursor === separatorStart) {
    return null;
  }
  const parsedValue = parseTranscriptSecretValue(value, cursor);
  if (!parsedValue) return null;
  return {
    start,
    end: parsedValue.end,
    redacted: parsedValue.redacted,
    replacement: wrapper
      ? `${value.slice(start, cursor)}${wrapper}${TRANSCRIPT_REDACTED}${wrapper}`
      : `${value.slice(keyStart, keyEnd)}=${TRANSCRIPT_REDACTED}`,
  };
}

function parseTranscriptSecretFlagAt(value, start) {
  if (value[start] !== "-" || value[start + 1] !== "-") return null;
  const keyStart = start + 2;
  const keyLength = parseTranscriptSecretKey(value, keyStart);
  if (keyLength === 0) return null;
  let cursor = keyStart + keyLength;
  const separatorStart = cursor;
  while (isHorizontalWhitespace(value[cursor])) cursor += 1;
  if (value[cursor] === "=") {
    cursor += 1;
    while (isHorizontalWhitespace(value[cursor])) cursor += 1;
  } else if (cursor === separatorStart) {
    return null;
  }
  const parsedValue = parseTranscriptSecretValue(value, cursor);
  if (!parsedValue) return null;
  return {
    start,
    end: parsedValue.end,
    redacted: parsedValue.redacted,
    replacement: `${value.slice(start, keyStart + keyLength)}=${TRANSCRIPT_REDACTED}`,
  };
}

function scanTranscriptMatches(value, parser) {
  const matches = [];
  let cursor = 0;
  while (cursor < value.length) {
    const match = parser(value, cursor);
    if (!match) {
      cursor += 1;
      continue;
    }
    matches.push(match);
    cursor = Math.max(cursor + 1, match.end);
  }
  return matches;
}

function endpointHasCredentials(value, start, schemeEnd, end) {
  let authorityEnd = schemeEnd;
  while (authorityEnd < end && !"/?#".includes(value[authorityEnd])) authorityEnd += 1;
  let colon = -1;
  for (let cursor = schemeEnd; cursor < authorityEnd; cursor += 1) {
    if (value[cursor] === ":" && colon < 0) colon = cursor;
    if (value[cursor] === "@" && colon > schemeEnd && colon < cursor) return true;
  }
  let cursor = schemeEnd;
  while (cursor < end && value[cursor] !== "?") cursor += 1;
  if (cursor >= end) return false;
  cursor += 1;
  while (cursor < end) {
    const nameStart = cursor;
    while (cursor < end && value[cursor] !== "=" && value[cursor] !== "&") cursor += 1;
    if (value[cursor] === "=") {
      const name = value.slice(nameStart, cursor).toLowerCase();
      if (TRANSCRIPT_ENDPOINT_QUERY_KEYS.has(name)) return true;
      cursor += 1;
      while (cursor < end && value[cursor] !== "&") cursor += 1;
    }
    if (value[cursor] === "&") cursor += 1;
  }
  return false;
}

function scanTranscriptCredentialEndpoints(value) {
  const matches = [];
  let cursor = 0;
  while (cursor < value.length) {
    const schemeLength = asciiEqualAt(value, cursor, "https://")
      ? 8
      : asciiEqualAt(value, cursor, "http://")
        ? 7
        : 0;
    if (schemeLength === 0 || (cursor > 0 && isAsciiWord(value[cursor - 1]))) {
      cursor += 1;
      continue;
    }
    let tokenEnd = cursor + schemeLength;
    while (tokenEnd < value.length && !isEndpointTerminator(value[tokenEnd])) tokenEnd += 1;
    const end = terminalPunctuationStart(
      value,
      cursor + schemeLength,
      tokenEnd,
      TRANSCRIPT_ENDPOINT_TERMINAL_PUNCTUATION,
    );
    if (endpointHasCredentials(value, cursor, cursor + schemeLength, end)) {
      matches.push({
        start: cursor,
        end,
        redacted: false,
        replacement: TRANSCRIPT_REDACTED_ENDPOINT,
      });
    }
    cursor = Math.max(cursor + 1, tokenEnd);
  }
  return matches;
}

function parseTranscriptBearerAt(value, start) {
  if (!asciiEqualAt(value, start, "Bearer") || (start > 0 && isAsciiWord(value[start - 1]))) {
    return null;
  }
  let cursor = start + "Bearer".length;
  if (!isHorizontalWhitespace(value[cursor])) return null;
  while (isHorizontalWhitespace(value[cursor])) cursor += 1;
  const tokenStart = cursor;
  const token = parseBareTranscriptValue(value, tokenStart);
  if (!token) return null;
  return {
    start,
    end: token.end,
    redacted: token.redacted,
    replacement: `Bearer ${TRANSCRIPT_REDACTED}`,
  };
}

function replaceTranscriptMatches(value, matches) {
  if (matches.length === 0) return value;
  const chunks = [];
  let cursor = 0;
  for (const match of matches) {
    chunks.push(value.slice(cursor, match.start), match.replacement);
    cursor = match.end;
  }
  chunks.push(value.slice(cursor));
  return chunks.join("");
}

function transcriptRootPattern(root) {
  return String(root)
    .replace(/[\\/]+$/u, "")
    .split(/[\\/]+/u)
    .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\\\/]");
}

function transcriptPathLabel(value) {
  return TRANSCRIPT_USER_HOME_PREFIX.test(String(value).replace(/^["'([{]/u, ""))
    ? "${USER_HOME}"
    : "${ABSOLUTE_PATH}";
}

function redactTranscript(text, roots) {
  let output = String(text ?? "").replaceAll("\uFFFD", "<<INVALID_UTF8_REPLACED>>");
  output = replaceTranscriptMatches(output, scanTranscriptCredentialEndpoints(output));
  output = replaceTranscriptMatches(
    output,
    scanTranscriptMatches(output, parseTranscriptSecretFlagAt),
  );
  output = replaceTranscriptMatches(
    output,
    scanTranscriptMatches(output, parseTranscriptSecretFieldAt),
  );
  output = replaceTranscriptMatches(output, scanTranscriptMatches(output, parseTranscriptBearerAt));
  for (const [root, replacement] of roots ?? []) {
    if (!root) continue;
    output = output.replace(
      new RegExp(
        String.raw`(?<![A-Za-z0-9_])${transcriptRootPattern(root)}(?=$|[\\\/\s)"',;])`,
        "giu",
      ),
      replacement,
    );
  }
  output = output
    .replace(TRANSCRIPT_DOUBLE_QUOTED_PATH_PATTERN, (match) => `"${transcriptPathLabel(match)}"`)
    .replace(TRANSCRIPT_SINGLE_QUOTED_PATH_PATTERN, (match) => `'${transcriptPathLabel(match)}'`)
    .replace(TRANSCRIPT_PARENTHESIZED_PATH_PATTERN, (match) => `(${transcriptPathLabel(match)})`)
    .replace(TRANSCRIPT_SQUARE_BRACKETED_PATH_PATTERN, (match) => `[${transcriptPathLabel(match)}]`)
    .replace(TRANSCRIPT_CURLY_BRACKETED_PATH_PATTERN, (match) => `{${transcriptPathLabel(match)}}`)
    .replace(TRANSCRIPT_BARE_USER_HOME_PATTERN, "${USER_HOME}");
  output = output.replace(TRANSCRIPT_PATH_PATTERN, (match) => {
    const trimmed = match.replace(/[).,\]}]+$/u, "");
    const label = transcriptPathLabel(match);
    return label + match.slice(trimmed.length);
  });
  return output;
}

function findTranscriptLeaks(text) {
  const value = String(text ?? "");
  const absolutePaths = (value.match(TRANSCRIPT_PATH_PATTERN) ?? []).length;
  const secrets = [
    ...scanTranscriptCredentialEndpoints(value),
    ...scanTranscriptMatches(value, parseTranscriptSecretFlagAt),
    ...scanTranscriptMatches(value, parseTranscriptBearerAt),
    ...scanTranscriptMatches(value, parseTranscriptSecretFieldAt),
  ].filter(({ redacted }) => !redacted).length;
  return { absolutePaths, secrets };
}

function writeRedactedTranscript(path, rawText, roots) {
  const redacted = redactTranscript(rawText, roots);
  const leaks = findTranscriptLeaks(redacted);
  if (leaks.absolutePaths > 0 || leaks.secrets > 0) {
    fail("BUILD_TRANSCRIPT_REDACTION_LEAK");
  }
  writeFileSync(path, redacted, "utf8");
}

function transcriptRoots({ provenance, packageRoot, ueRoot }) {
  return [
    [resolve(packageRoot), "${PACKAGE_ROOT}"],
    [resolve(ueRoot), "${UE_ROOT}"],
    [provenance.repositoryRoot, "${SOURCE_ROOT}"],
  ].sort((left, right) => right[0].length - left[0].length || left[1].localeCompare(right[1]));
}

function deriveToolchainFacts(text, engineIdentity) {
  const marker = String(text ?? "").match(
    /(?:^|\r?\n)UAGENT_TOOLCHAIN_JSON:(\{[^\r\n]+\})(?:\r?\n|$)/,
  );
  if (marker) {
    let value;
    try {
      value = JSON.parse(marker[1]);
    } catch {
      fail("BUILD_TOOLCHAIN_EVIDENCE_INVALID");
    }
    if (
      !value ||
      Object.keys(value).sort().join(",") !==
        "compatibleChangelist,compilerName,compilerVersion,engineChangelist,engineVersion,moduleBuildId,sdkName,sdkVersion" ||
      value.engineVersion !== engineIdentity.engineVersion ||
      value.engineChangelist !== engineIdentity.engineChangelist ||
      value.compatibleChangelist !== engineIdentity.compatibleChangelist ||
      value.moduleBuildId !== engineIdentity.moduleBuildId ||
      value.compilerName !== "MSVC" ||
      typeof value.compilerVersion !== "string" ||
      !/^\d+(?:\.\d+){1,3}$/.test(value.compilerVersion) ||
      value.sdkName !== "Windows SDK" ||
      typeof value.sdkVersion !== "string" ||
      !/^\d+(?:\.\d+){1,3}$/.test(value.sdkVersion)
    ) {
      fail("BUILD_TOOLCHAIN_EVIDENCE_INVALID");
    }
    return value;
  }
  const compiler =
    String(text ?? "").match(
      /Using Visual Studio[^\r\n]*?toolchain\s*\([^\r\n]*?(\d+(?:\.\d+){1,3})[^)\r\n]*\)/i,
    ) ?? String(text ?? "").match(/Using Visual Studio\s+(\d+(?:\.\d+){1,3})\s+toolchain/i);
  const sdk =
    String(text ?? "").match(/Windows\s+(\d+(?:\.\d+){1,3})\s+SDK\b/i) ??
    String(text ?? "").match(/Windows\s+(?:10|11)?\s*SDK\s*\(?(\d+(?:\.\d+){1,3})\)?/i);
  if (!compiler || !sdk) {
    fail("BUILD_TOOLCHAIN_EVIDENCE_MISSING");
  }
  return {
    engineVersion: engineIdentity.engineVersion,
    engineChangelist: engineIdentity.engineChangelist,
    compatibleChangelist: engineIdentity.compatibleChangelist,
    moduleBuildId: engineIdentity.moduleBuildId,
    compilerName: "MSVC",
    compilerVersion: compiler[1],
    sdkName: "Windows SDK",
    sdkVersion: sdk[1],
  };
}

function artifactRecord(root, path, capturedAt, producer, redactionStatus) {
  const logicalPath = toGitPath(relative(root, path));
  if (logicalPath.startsWith("../") || logicalPath === ".." || isAbsolute(logicalPath)) {
    fail("BUILD_SOURCE_ARTIFACT_OUTSIDE_EVIDENCE");
  }
  return {
    relativePath: logicalPath,
    size: lstatSync(path).size,
    sha256: sha256File(path),
    capturedAt,
    producer,
    redactionStatus,
  };
}

function validateEvidenceRoot(value, repositoryRoot, taskId) {
  const root = safeWindowsPath(resolve(value), "BUILD_EVIDENCE_ROOT_INVALID");
  const external = resolve(repositoryRoot, "external");
  if (
    !isWithin(external, root) ||
    !FINAL_ROOT.test(basename(root)) ||
    resolve(root, "..") !== external
  ) {
    fail("BUILD_EVIDENCE_ROOT_INVALID");
  }
  if (existsSync(root)) {
    requireDirectory(root, "BUILD_EVIDENCE_ROOT_INVALID");
    const preflightPath = resolve(root, "metadata", "preflight.json");
    const preflight = (() => {
      try {
        return JSON.parse(
          readFileSync(
            requireRegularFile(preflightPath, "BUILD_EVIDENCE_PREFLIGHT_MISSING"),
            "utf8",
          ),
        );
      } catch (error) {
        if (error instanceof ToolingError) throw error;
        fail("BUILD_EVIDENCE_PREFLIGHT_INVALID");
      }
    })();
    if (
      preflight?.taskGeneration !== TASK_GENERATION ||
      preflight?.taskId !== taskId ||
      existsSync(resolve(root, "metadata", "build-command.json")) ||
      existsSync(resolve(root, "metadata", "build-result.json"))
    ) {
      fail("BUILD_EVIDENCE_PREFLIGHT_INVALID");
    }
  }
  return root;
}

function executeBuild({
  runUat,
  orderedArguments,
  cwd,
  packageRoot,
  evidenceRoot,
  provenance,
  commandLedger,
  taskMarker,
  uatLog,
  ueRoot,
  engineIdentity,
  maxBuffer,
}) {
  mkdirSync(resolve(evidenceRoot, "logs"), { recursive: true });
  mkdirSync(resolve(evidenceRoot, "metadata"), { recursive: true });
  const result = spawnSync(
    process.platform === "win32" ? "cmd.exe" : runUat,
    process.platform === "win32"
      ? ["/d", "/s", "/c", runUat, ...orderedArguments]
      : orderedArguments,
    {
      cwd,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      maxBuffer,
    },
  );
  const capturedAt = new Date().toISOString();
  const childExitCode = result.error || !Number.isInteger(result.status) ? null : result.status;
  let toolchainFacts = null;
  let toolchainReason = null;
  if (!result.error && childExitCode === 0) {
    try {
      toolchainFacts = deriveToolchainFacts(
        `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
        engineIdentity,
      );
      ensurePackagedModuleIndex(packageRoot, engineIdentity);
    } catch (error) {
      toolchainReason =
        error instanceof ToolingError ? error.code : "BUILD_TOOLCHAIN_EVIDENCE_INVALID";
    }
  }
  let sourceArtifacts;
  try {
    const roots = transcriptRoots({ provenance, packageRoot, ueRoot });
    const stdoutPath = resolve(evidenceRoot, "logs", "runuat.stdout.redacted.log");
    const stderrPath = resolve(evidenceRoot, "logs", "runuat.stderr.redacted.log");
    writeRedactedTranscript(stdoutPath, result.stdout, roots);
    writeRedactedTranscript(stderrPath, result.stderr, roots);
    sourceArtifacts = [
      artifactRecord(
        evidenceRoot,
        stdoutPath,
        capturedAt,
        "mvp15d-plugin-build",
        "deterministically-redacted",
      ),
      artifactRecord(
        evidenceRoot,
        stderrPath,
        capturedAt,
        "mvp15d-plugin-build",
        "deterministically-redacted",
      ),
    ];
    if (uatLog) {
      const rawLog = requireRegularFile(
        safeWindowsPath(resolve(uatLog), "BUILD_UAT_LOG_PATH_UNSAFE"),
        "BUILD_UAT_LOG_MISSING",
      );
      const derivativePath = resolve(evidenceRoot, "logs", "runuat.external.redacted.log");
      writeRedactedTranscript(derivativePath, readFileSync(rawLog, "utf8"), roots);
      const derivative = artifactRecord(
        evidenceRoot,
        derivativePath,
        capturedAt,
        "mvp15d-plugin-build",
        "deterministically-redacted",
      );
      derivative.observedRawSize = lstatSync(rawLog).size;
      derivative.observedRawSha256 = sha256File(rawLog);
      sourceArtifacts.push(derivative);
    }
  } catch (error) {
    if (existsSync(packageRoot)) {
      rmSync(packageRoot, { recursive: true, force: true });
    }
    throw error;
  }
  const succeeded = !result.error && childExitCode === 0 && toolchainFacts !== null;
  if (!succeeded && existsSync(packageRoot)) {
    rmSync(packageRoot, { recursive: true, force: true });
  }
  const fingerprintBasis = {
    ...commandLedger,
    toolchainFacts,
  };
  delete fingerprintBasis.commandFingerprint;
  const finalCommandLedger = {
    ...commandLedger,
    toolchainFacts,
    commandFingerprint: sha256Bytes(Buffer.from(stable(fingerprintBasis), "utf8")),
  };
  const summary = {
    schemaVersion: BUILD_RESULT_SCHEMA,
    taskGeneration: TASK_GENERATION,
    taskMarkerSha256: sha256Bytes(
      Buffer.from(`uagent.mvp15d.retained.marker.v1\0${taskMarker}`, "utf8"),
    ),
    status: succeeded ? "build_completed" : "build_failed",
    reason: succeeded
      ? null
      : (toolchainReason ??
        (result.error?.code === "ENOBUFS"
          ? "RUNUAT_OUTPUT_TRUNCATED"
          : result.error
            ? "RUNUAT_SPAWN_FAILED"
            : "RUNUAT_EXIT_NONZERO")),
    commandFingerprint: finalCommandLedger.commandFingerprint,
    childPidBindingSha256: Number.isSafeInteger(result.pid)
      ? sha256Bytes(Buffer.from(`uagent.mvp15d.retained.pid.v1\0${result.pid}`, "utf8"))
      : null,
    childExitCode,
    wrapperExitCode: succeeded ? 0 : 1,
    sourceArtifacts,
    packagePresent: existsSync(packageRoot),
    successManifestPresent: existsSync(resolve(packageRoot, "UAgentAssetTools.build.json")),
    closeout: {
      wrapperPidBindingSha256: sha256Bytes(
        Buffer.from(`uagent.mvp15d.retained.pid.v1\0${process.pid}`, "utf8"),
      ),
      childExited: childExitCode !== null,
      taskOwnedResidualCount: 0,
    },
  };
  if (!succeeded && (summary.packagePresent || summary.successManifestPresent)) {
    fail("RUNUAT_FAILURE_RESIDUE");
  }
  writeFileSync(
    resolve(evidenceRoot, "metadata", "build-command.json"),
    `${JSON.stringify(finalCommandLedger, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  writeFileSync(
    resolve(evidenceRoot, "metadata", "build-result.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  return { summary, result };
}

function runBuild(argv, { maxBuffer = BUILD_MAX_BUFFER_BYTES } = {}) {
  if (!Number.isSafeInteger(maxBuffer) || maxBuffer <= 0 || maxBuffer > BUILD_MAX_BUFFER_BYTES) {
    fail("BUILD_MAX_BUFFER_INVALID");
  }
  const args = parseArgs(argv);
  if (!args.source || !args.package || !args.runuat || !args["ue-root"]) {
    fail("BUILD_ARGUMENT_REQUIRED");
  }
  const mode = args.mode ?? "live";
  if (!["plan", "live"].includes(mode)) fail("BUILD_MODE_INVALID");
  const provenance = deriveGitFacts(args.source);
  const plugin = resolvePlugin(provenance, args.plugin);
  const packageRoot = safeWindowsPath(resolve(args.package), "PACKAGE_PATH_UNSAFE");
  if (existsSync(packageRoot)) fail("PACKAGE_TARGET_ALREADY_EXISTS");
  const runUat = resolveRunUat(args.runuat);
  const ueRoot = safeWindowsPath(resolve(args["ue-root"]), "UE_ROOT_PATH_UNSAFE");
  const engineIdentity = readEngineIdentity(ueRoot, runUat);
  const orderedArguments = orderedBuildArguments(plugin, packageRoot);
  const taskId = args["task-id"] ?? DEFAULT_TASK_ID;
  if (typeof taskId !== "string" || !/^TASK-MVP15D-[A-Z0-9-]+$/.test(taskId)) {
    fail("BUILD_TASK_ID_INVALID");
  }
  const ledger = buildCommandLedger({
    taskId,
    runUat,
    orderedArguments,
    provenance,
    plugin,
    packageRoot,
    engineIdentity,
  });
  if (mode === "plan") {
    return {
      status: "build_planned",
      buildCompleted: false,
      runUat,
      orderedArguments,
      sanitizedCommand: exactCmdCommand(runUat, orderedArguments),
      commandLedger: ledger,
      physicalFixtures: provenance.physicalFixtures,
    };
  }
  if (!args["evidence-root"] || !args["task-marker"]) {
    fail("BUILD_LIVE_EVIDENCE_ARGUMENT_REQUIRED");
  }
  if (!SAFE_MARKER.test(args["task-marker"])) fail("BUILD_TASK_MARKER_INVALID");
  const evidenceRoot = validateEvidenceRoot(
    args["evidence-root"],
    provenance.repositoryRoot,
    taskId,
  );
  const execution = executeBuild({
    runUat,
    orderedArguments,
    cwd: provenance.sourceRoot,
    packageRoot,
    evidenceRoot,
    provenance,
    commandLedger: ledger,
    taskMarker: args["task-marker"],
    uatLog: args["uat-log"],
    ueRoot,
    engineIdentity,
    maxBuffer,
  });
  return execution.summary;
}

function main() {
  const output = runBuild(process.argv.slice(2));
  console.log(JSON.stringify(output));
  if (output.status === "build_failed") process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    const reason = error instanceof ToolingError ? error.code : "BUILD_TOOLING_FAILED";
    console.error(JSON.stringify({ status: "build_rejected", reason }));
    process.exitCode = 2;
  }
}

export {
  BUILD_COMMAND_SCHEMA,
  CANONICAL_FIXTURE_SHA256,
  CANONICAL_FIXTURE_SIZE,
  ToolingError,
  assertCanonicalPhysicalBytes,
  buildCommandLedger,
  deriveToolchainFacts,
  deriveGitFacts,
  exactCmdCommand,
  findTranscriptLeaks,
  orderedBuildArguments,
  readEngineIdentity,
  redactTranscript,
  runBuild,
  safeWindowsPath,
  stable,
};
