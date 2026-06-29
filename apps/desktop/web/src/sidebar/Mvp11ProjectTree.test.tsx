import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProjectTree } from "./ProjectTree";
import type { ProjectTreeNode } from "../types/ui";

describe("MVP11 ProjectTree diagnostic markers", () => {
  it("shows affected-file marker counts from real MVP11 state maps", () => {
    const nodes: ProjectTreeNode[] = [
      {
        id: "content",
        name: "Content",
        type: "Folder",
        children: [
          {
            id: "hero",
            name: "Hero.uasset",
            type: "Blueprint",
            rootRelativePath: "Content/Hero.uasset",
          },
        ],
      },
    ];

    render(
      <ProjectTree
        nodes={nodes}
        diagnosticCounts={{ "[project-root]/Content/Hero.uasset": 3 }}
      />,
    );

    expect(screen.getByLabelText("3 diagnostics for Hero.uasset")).toBeTruthy();
  });
});
