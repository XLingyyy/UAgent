import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, createLocaleStore, type Locale } from "../i18n";
import { OperationReview } from "./OperationReview";
import type { SceneBatchData } from "../../../../../packages/runtime/src/ue-scene-batch-v2.js";
import { reviewMessages } from "./messages";
import { reviewFileChanges, reviewSceneBatch, reviewEffectRecord } from "./adapters";
import {
  filePreview,
  fileResult,
  scenePlan,
  sceneResult,
  sceneFixtureData,
  parseSceneFixture,
  uncertainRecord,
  reviewFixtures,
} from "./fixtures";
import type { OperationReviewDocument, ReviewAction } from "./types";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount(
  document: OperationReviewDocument,
  patch: Partial<React.ComponentProps<typeof OperationReview>> = {},
  locale: Locale = "zh-CN",
) {
  const store = createLocaleStore({ storage: null, eventTarget: null, initialLocale: locale });
  const view = render(
    <I18nProvider store={store}>
      <OperationReview document={document} {...patch} />
    </I18nProvider>,
  );
  return { ...view, store };
}
function action(
  document: OperationReviewDocument,
  onRequest: ReviewAction["onRequest"] = vi.fn(async () => undefined),
): ReviewAction {
  return { reviewId: document.id, revision: document.revision, enabled: true, onRequest };
}
describe("operation review display adapters", () => {
  it("never counts previews as completed and keeps unknown/failed/missing file receipts distinct", () => {
    const all = reviewFixtures();
    expect(all.files.mode).toBe("preview");
    expect(all.files.items.every((i) => i.state === "planned")).toBe(true);
    expect(all.fileResult.items.map((i) => i.state)).toEqual(["completed", "failed", "unknown"]);
    expect(
      reviewFileChanges({ id: "x", revision: "1", title: "test" }, filePreview, {
        ...fileResult,
        effects: [],
      }).items.every((i) => i.state === "unknown"),
    ).toBe(true);
    const mismatch = reviewFileChanges({ id: "x", revision: "1", title: "test" }, filePreview, {
      ...fileResult,
      previewId: "stale",
    });
    expect(mismatch.integrity).toBe("incomplete");
    expect(mismatch.items.every((i) => i.state === "unknown")).toBe(true);
  });
  it("does not infer success from lastVerifiedOutcome or mayHaveBeenSent, and requires exact quiet attributed completion", () => {
    const id = { id: "effect", revision: "1", title: "effect" };
    expect(reviewEffectRecord(id, uncertainRecord).items.every((i) => i.state === "unknown")).toBe(
      true,
    );
    const verified = reviewEffectRecord(id, {
      ...uncertainRecord,
      state: "verifiedCompleted",
      manualReviewRequired: false,
      lastObservation: {
        outcome: "completed",
        execution: "quiescent",
        coverage: "exact",
        attribution: "operationBound",
      },
    });
    expect(verified.items.every((i) => i.state === "completed")).toBe(true);
    for (const invalid of [
      { ...uncertainRecord, state: "verifiedCompleted" as const },
      { ...uncertainRecord, manualReviewRequired: false, lastObservation: null },
    ])
      expect(reviewEffectRecord(id, invalid).items.every((i) => i.state === "unknown")).toBe(true);
  });
  it("derives scene counts from individual receipts and preserves cancellation/unsaved boundaries", () => {
    const data = reviewSceneBatch({ id: "s", revision: "1", title: "Scene" }, scenePlan, {
      ...sceneResult,
      appliedCount: 20,
    });
    expect(data.items.filter((i) => i.state === "completed")).toHaveLength(2);
    expect(data.items.filter((i) => i.state === "unknown")).toHaveLength(1);
    expect(data.notices).toContain("not-saved");
    expect(data.notices).toContain("cancelled-not-rollback");
    const missing = reviewSceneBatch({ id: "s", revision: "1", title: "Scene" }, scenePlan, {
      ...sceneResult,
      items: [],
    });
    expect(missing.items.every((i) => i.state === "unknown")).toBe(true);
    for (const patch of [{ actorGuid: "" }, { objectPath: "/Game/Other:PersistentLevel.Other" }]) {
      const detached = reviewSceneBatch({ id: "s", revision: "1", title: "Scene" }, scenePlan, {
        ...sceneResult,
        items: sceneResult.items.map((item, index) => (index === 0 ? { ...item, ...patch } : item)),
      });
      expect(detached.items[0]!.state).toBe("unknown");
    }
    expect(data.items[0]!.changes?.some((change) => change.label === "material")).toBe(true);
  });
  it("does not replace an empty sanitized display diff with raw unified content", () => {
    const document = reviewFileChanges(
      { id: "x", revision: "1", title: "x" },
      {
        ...filePreview,
        files: [{ ...filePreview.files[0]!, displayDiff: "", unifiedDiff: "DO_NOT_DISPLAY_RAW" }],
      },
    );
    expect(document.items[0]!.diff).toBe("");
  });
});

describe("T14 parsed scene review integration", () => {
  const identity = { id: "parsed-scene", revision: "1", title: "Parsed scene" };
  it.each([2, 20])("displays %i applied objects accepted by the actual scene parser", (count) => {
    const parsed = parseSceneFixture(scenePlan, sceneFixtureData(scenePlan, count));
    expect(parsed.appliedCount).toBe(count);
    const doc = reviewSceneBatch(identity, scenePlan, parsed);
    expect(doc.items.filter((item) => item.state === "completed")).toHaveLength(count);
    expect(doc.items.filter((item) => item.state === "not-started")).toHaveLength(20 - count);
    expect(doc.items.some((item) => item.state === "unknown")).toBe(false);
    const { container } = mount(doc);
    expect(container.querySelector(".ua-operation-review__count.is-completed b")?.textContent).toBe(
      String(count),
    );
  });
  const equivalent = [
    {
      name: "float tolerance and normalized pitch",
      approved: { pitch: 120, yaw: 0, roll: 0 },
      observed: { pitch: 60, yaw: 180, roll: 180 },
      delta: 0.0005,
    },
    {
      name: "wrapped yaw",
      approved: { pitch: 0, yaw: 180, roll: 0 },
      observed: { pitch: 0, yaw: -180, roll: 0 },
      delta: 0,
    },
    {
      name: "equivalent singular orientation",
      approved: { pitch: 90, yaw: 30, roll: 10 },
      observed: { pitch: 90, yaw: 60, roll: 40 },
      delta: 0,
    },
    {
      name: "whole-orientation tolerance",
      approved: { pitch: 0, yaw: 0, roll: 0 },
      observed: { pitch: 0.0005, yaw: 0.0005, roll: 0.0005 },
      delta: 0,
    },
  ];
  it.each(equivalent)("keeps parser-accepted $name completed", ({ approved, observed, delta }) => {
    const plan = structuredClone(scenePlan);
    plan.items[0]!.transform.rotation = approved;
    const raw = sceneFixtureData(plan, 20);
    raw.items[0]!.transform!.rotation = observed;
    raw.items[0]!.transform!.location.x += delta;
    raw.items[0]!.transform!.scale.y += delta;
    const parsed = parseSceneFixture(plan, raw);
    expect(parsed.appliedCount).toBe(20);
    expect(
      reviewSceneBatch(identity, plan, parsed).items.every((item) => item.state === "completed"),
    ).toBe(true);
  });
  const invalid: { name: string; mutate: (data: SceneBatchData) => void }[] = [
    {
      name: "old path missing map object",
      mutate: (data) => {
        data.items[0]!.objectPath = data.items[0]!.objectPath.replace(
          ".L_TrainingGround:PersistentLevel",
          ":PersistentLevel",
        );
      },
    },
    {
      name: "foreign map object",
      mutate: (data) => {
        data.items[0]!.objectPath = data.items[0]!.objectPath.replace(
          ".L_TrainingGround:PersistentLevel",
          ".L_Foreign:PersistentLevel",
        );
      },
    },
    {
      name: "unowned object",
      mutate: (data) => {
        data.items[0]!.owned = false;
      },
    },
    {
      name: "missing actor identity",
      mutate: (data) => {
        data.items[0]!.actorGuid = "";
      },
    },
    {
      name: "changed object name",
      mutate: (data) => {
        data.items[0]!.objectName = "UA14_Foreign";
      },
    },
    {
      name: "real location change",
      mutate: (data) => {
        data.items[0]!.transform!.location.x += 0.1;
      },
    },
    {
      name: "real scale change",
      mutate: (data) => {
        data.items[0]!.transform!.scale.y += 0.002;
      },
    },
    {
      name: "real orientation change",
      mutate: (data) => {
        data.items[0]!.transform!.rotation.yaw = 0.01;
      },
    },
    {
      name: "combined axes exceed orientation tolerance",
      mutate: (data) => {
        data.items[0]!.transform!.rotation = { pitch: 0.0007, yaw: 0.0007, roll: 0.0007 };
      },
    },
    {
      name: "nonfinite location",
      mutate: (data) => {
        data.items[0]!.transform!.location.x = NaN;
      },
    },
    {
      name: "missing observed transform",
      mutate: (data) => {
        delete data.items[0]!.transform;
      },
    },
  ];
  it.each(invalid)("keeps $name unknown and the real parser rejects it", ({ mutate }) => {
    const raw = sceneFixtureData(scenePlan, 20);
    mutate(raw);
    expect(() => parseSceneFixture(scenePlan, raw)).toThrow();
    expect(reviewSceneBatch(identity, scenePlan, raw).items[0]!.state).toBe("unknown");
  });
});

describe("operation review UI", () => {
  it("distinguishes empty display diffs from missing records in both locales without raw fallback", () => {
    const doc = reviewFileChanges(
      { id: "empty-diff", revision: "1", title: "Empty diff" },
      {
        ...filePreview,
        files: [{ ...filePreview.files[0]!, displayDiff: "", unifiedDiff: "RAW_PRIVATE_DIFF" }],
      },
    );
    const { store, container } = mount(doc);
    expect(screen.getByText("没有可显示的差异")).toBeTruthy();
    expect(screen.queryByText("未记录")).toBeNull();
    expect(container.textContent).not.toContain("RAW_PRIVATE_DIFF");
    act(() => store.setLocale("en"));
    expect(screen.getByText("No displayable diff")).toBeTruthy();
    expect(screen.queryByText("Not recorded")).toBeNull();
  });
  it.each([false, true])(
    "explains character clipping accurately with extra lines=%s",
    (extraLines) => {
      const value =
        "+" +
        "x".repeat(1500) +
        (extraLines ? "\n" + Array.from({ length: 170 }, (_, i) => "+" + i).join("\n") : "");
      const doc = {
        ...reviewFixtures().files,
        items: [{ ...reviewFixtures().files.items[0]!, diff: value }],
      };
      const { store, container } = mount(doc);
      expect(
        screen.getByText(
          extraLines
            ? "仅显示前 160 行 · 较长行仅显示前 1000 个字符"
            : "较长行仅显示前 1000 个字符",
        ),
      ).toBeTruthy();
      expect(screen.queryByText("仅显示前 1 行")).toBeNull();
      act(() => store.setLocale("en"));
      expect(
        screen.getByText(
          extraLines
            ? "Showing the first 160 lines · Long lines show only the first 1000 characters"
            : "Long lines show only the first 1000 characters",
        ),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Show full diff" }));
      expect(container.querySelector("pre")!.textContent).toBe(value);
    },
  );

  it("defaults to Chinese development preview, folded details and no executable approval", () => {
    const { container } = mount(reviewFixtures().files);
    expect(screen.getByRole("region", { name: reviewFixtures().files.title })).toBeTruthy();
    expect(screen.getByText("开发预览")).toBeTruthy();
    expect(screen.getByText("变更预览")).toBeTruthy();
    expect(screen.getByRole("button", { name: "模拟批准" }).hasAttribute("disabled")).toBe(true);
    expect([...container.querySelectorAll("details")].every((d) => !d.open)).toBe(true);
    expect(screen.queryByText("已完成")).toBeNull();
    const first = container.querySelector("summary")!;
    fireEvent.click(first);
    // jsdom does not implement native details activation; browser validation checks its actual keyboard behavior.
    expect(container.querySelector("pre")!.textContent).toContain("+bool CanInteract() const;");
  });
  it("switches through the real locale store while preserving user/path text", () => {
    const { store } = mount(reviewFixtures().fileResult);
    expect(screen.getByText("执行结果")).toBeTruthy();
    act(() => store.setLocale("en"));
    expect(screen.getByText("Execution results")).toBeTruthy();
    expect(screen.queryByText("执行结果")).toBeNull();
    expect(screen.getByText("Source/Gameplay/InteractionComponent.h")).toBeTruthy();
    for (const pair of Object.values(reviewMessages))
      expect(pair.every((value) => value.trim().length > 0)).toBe(true);
  });
  it("localizes known native semantic descriptions while preserving unknown authored notes", () => {
    const doc = reviewFixtures().semantic;
    const { store } = mount({
      ...doc,
      items: doc.items.map((item) => ({
        ...item,
        notes: [...(item.notes ?? []), "Custom authored note"],
      })),
    });
    expect(screen.getByText("按模板新建蓝图")).toBeTruthy();
    expect(screen.queryByText("create native-parent Blueprint")).toBeNull();
    act(() => store.setLocale("en"));
    expect(screen.getByText("Create Blueprint from template")).toBeTruthy();
    expect(screen.getByText("Custom authored note")).toBeTruthy();
  });
  it("requires explicit enabled matching binding and callback, and submits only one decision without implying execution", async () => {
    const doc = reviewFixtures().files,
      request = vi.fn(async () => undefined);
    const { rerender } = mount(doc, {
      environment: "host",
      approval: { ...action(doc, request), revision: "stale" },
    });
    expect(screen.getByRole("button", { name: "批准这些变更" }).hasAttribute("disabled")).toBe(
      true,
    );
    rerender(
      <I18nProvider store={createLocaleStore({ storage: null, eventTarget: null })}>
        <OperationReview document={doc} environment="host" approval={action(doc, request)} />
      </I18nProvider>,
    );
    const button = screen.getByRole("button", { name: "批准这些变更" });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ reviewId: doc.id, revision: doc.revision });
    expect(screen.getByText("审阅决定已提交")).toBeTruthy();
    expect(screen.getByText("变更预览")).toBeTruthy();
    expect(screen.queryByText("已完成")).toBeNull();
    expect(button.hasAttribute("disabled")).toBe(true);
  });
  it("never exposes raw callback error text and allows an explicit retry after failure", async () => {
    const doc = reviewFixtures().files,
      request = vi
        .fn()
        .mockRejectedValueOnce(new Error("SYNTHETIC_PRIVATE_DETAIL"))
        .mockResolvedValue(undefined);
    mount(doc, { approval: action(doc, request) });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "模拟批准" })));
    expect(screen.getByRole("alert").textContent).toBe("未能提交，请重试");
    expect(screen.queryByText("SYNTHETIC_PRIVATE_DETAIL")).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "模拟批准" })));
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("does not promote unknown effects to completion after an inspection callback resolves", async () => {
    const doc = reviewFixtures().effects,
      request = vi.fn(async () => undefined);
    const { container } = mount(doc, { inspection: action(doc, request) });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "模拟检查" })));
    expect(request).toHaveBeenCalledOnce();
    expect(screen.getByText("状态检查已请求")).toBeTruthy();
    expect(screen.getAllByText("待确认").length).toBeGreaterThan(0);
    expect(container.querySelector(".ua-operation-review__count.is-completed b")?.textContent).toBe(
      "0",
    );
  });
  it("ignores late callbacks after a changed binding, including delimiter-containing ids", async () => {
    let resolve!: () => void;
    const doc = { ...reviewFixtures().files, id: "a:b", revision: "c" },
      request = vi.fn(
        () =>
          new Promise<void>((done) => {
            resolve = done;
          }),
      );
    const { rerender } = mount(doc, { approval: action(doc, request) });
    fireEvent.click(screen.getByRole("button", { name: "模拟批准" }));
    const next = { ...doc, id: "a", revision: "b:c", title: "Another review" };
    rerender(
      <I18nProvider store={createLocaleStore({ storage: null, eventTarget: null })}>
        <OperationReview document={next} />
      </I18nProvider>,
    );
    await act(async () => resolve());
    expect(screen.queryByText("审阅决定已提交")).toBeNull();
    expect(screen.getByRole("button", { name: "模拟批准" }).hasAttribute("disabled")).toBe(true);
  });
  it("labels result counts, limits large lists, and exposes all objects on demand", () => {
    const { container } = mount(reviewFixtures().scene);
    expect(container.querySelectorAll("details")).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "再显示 14 项" }));
    expect(container.querySelectorAll("details")).toHaveLength(20);
    expect(screen.getByText("尚未保存到磁盘")).toBeTruthy();
    expect(screen.getByText("取消不等于回滚")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "收起列表" }));
    expect(container.querySelectorAll("details")).toHaveLength(6);
  });
  it("renders untrusted text as text, offers full long diffs and never uses color as the only status", () => {
    const doc = reviewFixtures().files;
    const unsafe = {
      ...doc,
      items: [
        {
          ...doc.items[0]!,
          diff:
            "<img src=x onerror=alert(1)>\\n" +
            Array.from({ length: 170 }, (_, i) => "+" + i).join("\n"),
        },
      ],
    };
    const { container } = mount(unsafe);
    expect(container.querySelector("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "显示完整差异" }));
    expect(screen.getByRole("button", { name: "收起差异" })).toBeTruthy();
    expect(container.querySelector("pre")!.textContent).toContain("+169");
    expect(screen.getAllByText("待执行").length).toBeGreaterThan(0);
  });
  it("withholds approval for incomplete/duplicate or preview data that claims completion", () => {
    const doc = reviewFixtures().files;
    const invalid: OperationReviewDocument[] = [
      { ...doc, items: [{ ...doc.items[0]!, state: "completed" }] },
      { ...doc, integrity: "incomplete" },
      { ...doc, items: [doc.items[0]!, doc.items[0]!] },
    ];
    for (const bad of invalid) {
      const view = mount(bad, { approval: action(bad) });
      expect(screen.getByRole("button", { name: "模拟批准" }).hasAttribute("disabled")).toBe(true);
      expect(screen.queryByText("已完成")).toBeNull();
      expect(screen.getByText("数据不完整，暂不能审批")).toBeTruthy();
      view.unmount();
    }
  });
});
