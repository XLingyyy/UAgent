import { describe, expect, it } from "vitest";
import {
  dictionaries,
  hasTranslationKey,
  messageCatalog,
  translate,
  validateCatalog,
} from "./core";
import { localizeText, sourceAliases } from "./source-map";

describe("desktop translation catalog", () => {
  it("keeps both languages complete, nonempty, and interpolation-compatible", () => {
    expect(validateCatalog()).toEqual([]);
    expect(Object.keys(dictionaries.en)).toEqual(Object.keys(dictionaries["zh-CN"]));
    expect(Object.keys(messageCatalog).length).toBeGreaterThan(600);
    for (const key of Object.values(sourceAliases)) expect(hasTranslationKey(key)).toBe(true);
  });

  it("inserts opaque names and numeric values without evaluating or translating them", () => {
    const project = "G:\\Private\\Project {name} <b>Flash</b>";
    expect(translate("zh-CN", "workspace.welcomeProject", { project })).toBe(
      `想在 ${project} 中做什么？`,
    );
    expect(translate("en", "history.count", { count: 3 })).toBe("3 saved conversations");
    expect(translate("en", "budget.maximumReservation", { amount: "0.010000" })).toContain(
      "CNY 0.010000",
    );
  });

  it("maps only exact registered static copy and leaves arbitrary data untouched", () => {
    expect(localizeText("zh-CN", "Confirm this exact outbound request")).toBe("确认本次出站请求");
    expect(localizeText("en", "What would you like to investigate?")).toBe(
      "What would you like to work on?",
    );
    for (const raw of [
      "G:\\Source\\Config",
      "deepseek-chat",
      "Cancel: external log detail",
      "user arbitrary text",
      "<p>Settings</p>",
    ]) {
      expect(localizeText("zh-CN", raw)).toBe(raw);
    }
    expect(hasTranslationKey("missing.key")).toBe(false);
  });

  it("retains financial and permission boundaries in both languages", () => {
    expect(translate("en", "session.limits")).toContain("CNY 10");
    expect(translate("zh-CN", "session.limits")).toContain("仅限 Flash");
    expect(translate("en", "budget.reservationHint")).toContain("do not refund or reset");
    expect(translate("zh-CN", "budget.reservationHint")).toContain("不退回、不重置");
    expect(translate("en", "outbound.scopeHint")).toContain(
      "grants no file, terminal, or UE permission",
    );
    expect(translate("zh-CN", "proposal.scopeHint")).toContain("全量测试");
  });

  it("handles registered legacy labels without duplicate punctuation or broken entities", () => {
    expect(localizeText("zh-CN", "Approval:")).toBe("审批：");
    expect(localizeText("en", "Approval:")).toBe("Approval:");
    expect(localizeText("zh-CN", "MVP12 proposals:")).toBe("MVP12 建议：");
    expect(localizeText("en", "MVP12 proposals:")).toBe("MVP12 proposals:");
    expect(localizeText("zh-CN", "&middot; one-time token")).toBe("· 一次性令牌");
    expect(localizeText("en", "approval_required")).toBe("Approval required");
    expect(localizeText("zh-CN", "Maximum reservation: CNY")).toBe("本次最多预留：¥");
  });

  it("preserves every value in the complete dynamic cost and tool summaries", () => {
    expect(
      translate("zh-CN", "mcp.discoverySummary", { tools: 12, resources: 3, prompts: 4 }),
    ).toBe("12 项工具 / 3 项资源 / 4 个提示模板");
    const summary = translate("zh-CN", "changes.operationSummary", {
      phase: "verify",
      tool: "exact_tool_id",
      path: "/Game/Test",
      result: "blocked",
      evidence: "evidence-17",
    });
    for (const opaque of ["verify", "exact_tool_id", "/Game/Test", "blocked", "evidence-17"]) {
      expect(summary).toContain(opaque);
    }
    expect(
      localizeText(
        "zh-CN",
        "Changing language never changes authorization, sends a request or resets the budget.",
      ),
    ).toContain("不会改变授权");
  });
});

// Checked by the focused TypeScript check; these calls never execute.
export function checkTranslationTypes() {
  // @ts-expect-error Unknown keys are rejected.
  translate("en", "missing.key");
  // @ts-expect-error The project interpolation parameter is required.
  translate("en", "workspace.welcomeProject");
  // @ts-expect-error Incorrect parameter names are rejected.
  translate("en", "workspace.welcomeProject", { name: "Example" });
  // @ts-expect-error Parameter-free messages do not accept arbitrary values.
  translate("en", "common.cancel", { name: "Example" });
  // @ts-expect-error All discovered counts must be supplied.
  translate("en", "mcp.discoverySummary", { tools: 12, resources: 3 });
}
