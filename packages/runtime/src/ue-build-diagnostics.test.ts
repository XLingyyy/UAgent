import { describe, expect, it } from "vitest";
import {
  parseUEBuildDiagnostics,
  parseUEBuildExecutionDiagnostics,
  UEBuildDiagnosticParser,
} from "./ue-build-diagnostics.js";

describe("UE build diagnostics, synthetic logs only", () => {
  it("maps MSVC compiler locations, error codes, module and symbol", () => {
    const summary = parseUEBuildDiagnostics(
      "C:\\Game\\Source\\Game\\Foo.cpp(12,4): error C2065: 'Missing': undeclared identifier\n",
      { projectRoot: "C:/Game" },
    );
    expect(summary.errorCount).toBe(1);
    expect(summary.diagnostics[0]).toMatchObject({
      stage: "compiler",
      code: "C2065",
      module: "Game",
      symbol: "Missing",
      location: {
        projectRelativePath: "Source/Game/Foo.cpp",
        line: 12,
        column: 4,
        scope: "project",
      },
    });
  });
  it("maps UHT reflection diagnostics and independent UBT module failures", () => {
    const summary = parseUEBuildDiagnostics(
      [
        "Running UnrealHeaderTool Game.uproject",
        "C:/Game/Source/Game/Foo.h(9): Error: UPROPERTY is not allowed here",
        "Error: Unable to instantiate module 'MissingModule': rules could not be found",
        "LogCompile: Warning: reflected field is deprecated",
      ].join("\n"),
      { projectRoot: "C:/Game" },
    );
    expect(summary.errorCount).toBe(2);
    expect(summary.warningCount).toBe(1);
    expect(summary.diagnostics[0]).toMatchObject({ stage: "uht", location: { line: 9 } });
    expect(summary.diagnostics[1]).toMatchObject({ stage: "ubt", module: "MissingModule" });
    expect(summary.diagnostics[2]).toMatchObject({ stage: "uht", severity: "warning" });
  });
  it("handles Clang paths, linker symbols and C# build rules", () => {
    const summary = parseUEBuildDiagnostics(
      [
        "C:/Game/Source/Game/Foo.cpp:10:2: error: use of undeclared identifier 'Thing'",
        'Module.Game.cpp.obj : error LNK2019: unresolved external symbol "MissingFunction" referenced in function main',
        "C:/Game/Source/Game/Game.Build.cs(3,4): error CS0103: The name 'BadDependency' does not exist",
      ].join("\n"),
      { projectRoot: "C:/Game" },
    );
    expect(summary.diagnostics.map((d) => d.stage)).toEqual(["compiler", "linker", "ubt"]);
    expect(summary.diagnostics[1]).toMatchObject({ code: "LNK2019", symbol: "MissingFunction" });
  });
  it("parses chunks on separate streams, ANSI/MSBuild prefixes and final unterminated lines", () => {
    const parser = new UEBuildDiagnosticParser({
      projectRoot: "E:/Game",
      diagnosticCwd: "E:/Game",
    });
    parser.push("1>\u001b[31mSource/Foo.cpp(2,3): err");
    parser.push("Warning: diagnostic from stderr\n", "stderr");
    parser.push("or C2065: missing\u001b[0m");
    const summary = parser.finish();
    expect(summary.errorCount).toBe(1);
    expect(summary.warningCount).toBe(1);
    expect(summary.diagnostics[0]?.stream).toBe("stderr");
    expect(summary.diagnostics[1]?.location?.projectRelativePath).toBe("Source/Foo.cpp");
  });
  it("does not link escaped or external paths as project files and redacts credentials", () => {
    const summary = parseUEBuildDiagnostics(
      [
        "../Other.cpp(1): error C1: token=top-secret Authorization: Bearer abc",
        "C:/GameOther/Foo.cpp(1): error C2: C:/Users/Alice/secret.txt sk-test-secret",
        "C:/UE/Engine/Foo.h(7): warning C4996: deprecated",
        "C:/Game/../Other.cpp(1): error C3: escaped absolute path",
        "C:/Game/Foo.cpp:stream(1): error C4: alternate data stream",
      ].join("\n"),
      { projectRoot: "C:/Game", engineRoot: "C:/UE" },
    );
    expect(summary.diagnostics.map((d) => d.location?.scope)).toEqual([
      "external",
      "external",
      "engine",
      "external",
      "external",
    ]);
    expect(summary.diagnostics[0]?.location?.projectRelativePath).toBeUndefined();
    expect(JSON.stringify(summary)).not.toMatch(/top-secret|Bearer abc|Alice|sk-test-secret/);
    expect(JSON.stringify(summary)).not.toContain("abc");
  });
  it("normalizes native Windows verbatim root prefixes", () => {
    const summary = parseUEBuildDiagnostics("C:/Game/Source/Foo.cpp(1): error C1: missing", {
      projectRoot: "\\\\?\\C:\\Game",
    });
    expect(summary.diagnostics[0]?.location?.scope).toBe("project");
  });
  it("deduplicates repeated diagnostics and reports truncation honestly", () => {
    const parser = new UEBuildDiagnosticParser({ maxDiagnostics: 1 });
    parser.push("Error: first\nError: first\nError: second\n");
    const summary = parser.finish();
    expect(summary.errorCount).toBe(1);
    expect(summary.diagnostics[0]?.occurrences).toBe(2);
    expect(summary.truncated).toBe(true);
  });
  it("discards overlong lines across chunks and resumes after newline", () => {
    const parser = new UEBuildDiagnosticParser();
    parser.push("x".repeat(40_000));
    parser.push("y".repeat(40_000));
    parser.push("Error: fake suffix\nError: real\n");
    const summary = parser.finish();
    expect(summary.errorCount).toBe(1);
    expect(summary.diagnostics[0]?.message).toBe("real");
    expect(summary.truncated).toBe(true);
  });
  it.each([
    ["LINK : fatal error LNK1104: cannot open file 'Missing.lib'", "LNK1104"],
    ["link.exe : fatal error LNK1181: cannot open input file 'Other.lib'", "LNK1181"],
    ["fatal error LNK1120: 2 unresolved externals", "LNK1120"],
  ])("maps no-file linker diagnostics %s", (output, code) => {
    const summary = parseUEBuildDiagnostics(output);
    expect(summary.diagnostics[0]).toMatchObject({ stage: "linker", severity: "error", code });
    expect(summary.diagnostics[0]?.location).toBeUndefined();
  });
  it("resolves relative diagnostics only against a trusted native cwd", () => {
    const known = parseUEBuildDiagnostics("Runtime/Core/Private/Foo.cpp(7): error C2065: missing", {
      projectRoot: "E:/Game",
      engineRoot: "G:/UE",
      diagnosticCwd: "G:/UE/Engine/Source",
    });
    expect(known.diagnostics[0]?.location).toMatchObject({
      scope: "engine",
      displayPath: "[engine]/Engine/Source/Runtime/Core/Private/Foo.cpp",
    });
    expect(known.diagnostics[0]?.location?.projectRelativePath).toBeUndefined();
    const output = "Source/Game/Foo.cpp(7): error C2065: missing";
    const unknown = parseUEBuildDiagnostics(output, { projectRoot: "E:/Game" });
    expect(unknown.diagnostics[0]?.location).toMatchObject({ scope: "external" });
    expect(unknown.diagnostics[0]?.location?.projectRelativePath).toBeUndefined();
    const project = parseUEBuildDiagnostics(output, {
      projectRoot: "E:/Game",
      diagnosticCwd: "E:/Game",
    });
    expect(project.diagnostics[0]?.location?.projectRelativePath).toBe("Source/Game/Foo.cpp");
  });
  it("does not infer success from plain log text", () => {
    expect(parseUEBuildDiagnostics("BUILD SUCCESSFUL\nExitCode=0").diagnostics).toEqual([]);
  });
  it("preserves native capture truncation and incomplete-output evidence", () => {
    const captured = {
      stdout: "Error: first\n",
      stderr: "Warning: second\n",
      outputTruncated: true,
      outputComplete: true,
    };
    const summary = parseUEBuildExecutionDiagnostics(captured);
    expect(summary.truncated).toBe(true);
    expect(summary.errorCount).toBe(1);
    expect(summary.warningCount).toBe(1);
    expect(summary.diagnostics[1]?.stream).toBe("stderr");
    expect(
      parseUEBuildExecutionDiagnostics({
        ...captured,
        outputTruncated: false,
        outputComplete: false,
      }).truncated,
    ).toBe(true);
  });
});
