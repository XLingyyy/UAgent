import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectTree } from "./ProjectTree";
import type { ProjectTreeNode } from "../types/ui";

const mockNodes: ProjectTreeNode[] = [
  {
    id: "content",
    name: "Content",
    type: "Folder",
    children: [
      {
        id: "content-maps",
        name: "Maps",
        type: "Folder",
        children: [{ id: "map-main", name: "Main.umap", type: "Map" }],
      },
      {
        id: "content-characters",
        name: "Characters",
        type: "Folder",
        children: [{ id: "asset-hero", name: "Hero.uasset", type: "Blueprint" }],
      },
    ],
  },
  {
    id: "config",
    name: "Config",
    type: "Folder",
  },
];

function renderTree(nodes: ProjectTreeNode[] = mockNodes) {
  return render(<ProjectTree nodes={nodes} />);
}

describe("ProjectTree", () => {
  it("renders the tree with role tree and label", () => {
    renderTree();
    const tree = screen.getByRole("tree", { name: "Project tree" });
    expect(tree).toBeTruthy();
    expect(screen.getByText("Project Tree")).toBeTruthy();
  });

  it("renders root-level nodes", () => {
    renderTree();
    expect(screen.getByText("Content")).toBeTruthy();
    expect(screen.getByText("Config")).toBeTruthy();
  });

  it("renders top-level folder children by default (expanded)", () => {
    renderTree();
    expect(screen.getByText("Maps")).toBeTruthy();
    expect(screen.getByText("Characters")).toBeTruthy();
  });

  it("does not render grandchild nodes by default", () => {
    renderTree();
    expect(screen.queryByText("Main.umap")).toBeNull();
    expect(screen.queryByText("Hero.uasset")).toBeNull();
  });

  it("shows child nodes when a folder is toggled open", () => {
    renderTree();
    fireEvent.click(screen.getByLabelText("Expand Maps"));
    expect(screen.getByText("Main.umap")).toBeTruthy();
  });

  it("hides child nodes when an expanded folder is toggled closed", () => {
    renderTree();
    fireEvent.click(screen.getByLabelText("Collapse Content"));
    expect(screen.queryByText("Maps")).toBeNull();
    expect(screen.queryByText("Characters")).toBeNull();
  });

  it("selects a node on click", () => {
    renderTree();
    const contentTreeItem = screen.getByText("Content").closest('[role="treeitem"]')!;
    fireEvent.click(contentTreeItem);
    expect(contentTreeItem.getAttribute("aria-selected")).toBe("true");
  });

  it("changes selection when a different node is clicked", () => {
    renderTree();
    const contentTreeItem = screen.getByText("Content").closest('[role="treeitem"]')!;
    fireEvent.click(contentTreeItem);
    expect(contentTreeItem.getAttribute("aria-selected")).toBe("true");

    const configTreeItem = screen.getByText("Config").closest('[role="treeitem"]')!;
    fireEvent.click(configTreeItem);
    expect(configTreeItem.getAttribute("aria-selected")).toBe("true");
    expect(contentTreeItem.getAttribute("aria-selected")).toBe("false");
  });

  it("shows type badges on nodes", () => {
    renderTree();
    const badges = screen.getAllByText("F");
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  it("renders leaf node type badges", () => {
    renderTree();
    fireEvent.click(screen.getByLabelText("Expand Maps"));
    expect(screen.getByText("M")).toBeTruthy();
  });

  it("makes visible tree items keyboard focusable", () => {
    renderTree();
    const contentTreeItem = screen.getByText("Content").closest('[role="treeitem"]')!;
    const mapsTreeItem = screen.getByText("Maps").closest('[role="treeitem"]')!;

    expect(contentTreeItem.getAttribute("tabindex")).toBe("0");
    expect(mapsTreeItem.getAttribute("tabindex")).toBe("0");
  });

  it("selects a focused node with Enter and Space", () => {
    renderTree();
    const contentTreeItem = screen.getByText("Content").closest('[role="treeitem"]')!;
    const configTreeItem = screen.getByText("Config").closest('[role="treeitem"]')!;

    fireEvent.keyDown(configTreeItem, { key: "Enter" });
    expect(configTreeItem.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(contentTreeItem, { key: " " });
    expect(contentTreeItem.getAttribute("aria-selected")).toBe("true");
    expect(configTreeItem.getAttribute("aria-selected")).toBe("false");
  });

  it("expands and collapses folders with ArrowRight and ArrowLeft", () => {
    renderTree();
    const contentTreeItem = screen.getByText("Content").closest('[role="treeitem"]')!;

    fireEvent.keyDown(contentTreeItem, { key: "ArrowLeft" });
    expect(screen.queryByText("Maps")).toBeNull();

    fireEvent.keyDown(contentTreeItem, { key: "ArrowRight" });
    expect(screen.getByText("Maps")).toBeTruthy();
  });

  it("expands a collapsed child folder with ArrowRight", () => {
    renderTree();
    const mapsTreeItem = screen.getByText("Maps").closest('[role="treeitem"]')!;

    fireEvent.keyDown(mapsTreeItem, { key: "ArrowRight" });
    expect(screen.getByText("Main.umap")).toBeTruthy();
  });
});
