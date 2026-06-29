import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createEmptyMvp11State } from "../runtime/runtime-store";
import { UIProvider } from "../stores/ui-store";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { UtilityEvidencePanel } from "./UtilityPlaceholderPanel";

describe("MVP11 ContextPack desktop entry", () => {
  it("surfaces real Context Pack status and evidence after pack creation", () => {
    render(
      <UIProvider
        initialState={{
          runtime: {
            mvp11: {
              ...createEmptyMvp11State(),
              contextPackStatus: "completed",
              contextPack: {
                id: "context-pack-project-mvp11-ui-v1",
                version: "v1",
                projectId: "project-mvp11-ui",
                title: "MVP11 Context Pack v1",
                createdAt: 12_200,
                sections: [
                  {
                    id: "context-build_failures",
                    kind: "build_failures",
                    title: "Build failures",
                    summary: "1 build errors from analyzed terminal output.",
                    items: ["MSVC: missing symbol"],
                    source: { kind: "build_failure_summary", label: "Build failures", evidenceIds: [] },
                    createdAt: 12_200,
                    redaction: { replacedPaths: 1, replacedSecrets: 0, redacted: true },
                  },
                ],
                sources: [{ kind: "build_failure_summary", label: "Build failures", evidenceIds: [] }],
                redaction: { replacedPaths: 1, replacedSecrets: 0, redacted: true },
              },
            },
          },
        }}
      >
        <DiagnosticsPanel />
        <UtilityEvidencePanel />
      </UIProvider>,
    );

    expect(screen.getAllByText("Context Pack").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("MVP11 Context Pack v1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Context Pack: MVP11 Context Pack v1")).toBeTruthy();
  });
});
