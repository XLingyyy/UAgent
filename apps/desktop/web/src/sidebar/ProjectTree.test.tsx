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

  it("uses roving tabindex: only first visible node has tabIndex=0 by default", () => {
    renderTree();
    const contentItem = screen.getByText("Content").closest('[role="treeitem"]')!;
    const mapsItem = screen.getByText("Maps").closest('[role="treeitem"]')!;
    const charactersItem = screen.getByText("Characters").closest('[role="treeitem"]')!;
    const configItem = screen.getByText("Config").closest('[role="treeitem"]')!;

    expect(contentItem.getAttribute("tabindex")).toBe("0");
    expect(mapsItem.getAttribute("tabindex")).toBe("-1");
    expect(charactersItem.getAttribute("tabindex")).toBe("-1");
    expect(configItem.getAttribute("tabindex")).toBe("-1");
  });

  it("makes a clicked node the active treeitem", () => {
    renderTree();
    const contentItem = screen.getByText("Content").closest('[role="treeitem"]')!;
    const configItem = screen.getByText("Config").closest('[role="treeitem"]')!;

    fireEvent.click(configItem);

    expect(configItem.getAttribute("tabindex")).toBe("0");
    expect(contentItem.getAttribute("tabindex")).toBe("-1");
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

  it("moves focus to the first child with ArrowRight on an expanded folder", () => {
    renderTree();
    const contentItem = screen.getByText("Content").closest('[role="treeitem"]')!;

    fireEvent.focus(contentItem);
    fireEvent.keyDown(contentItem, { key: "ArrowRight" });

    const mapsItem = screen.getByText("Maps").closest('[role="treeitem"]')!;
    expect(mapsItem.getAttribute("tabindex")).toBe("0");
    expect(contentItem.getAttribute("tabindex")).toBe("-1");
  });

  it("moves focus to the parent with ArrowLeft on a collapsed child folder", () => {
    renderTree();
    const mapsItem = screen.getByText("Maps").closest('[role="treeitem"]')!;

    fireEvent.focus(mapsItem);
    fireEvent.keyDown(mapsItem, { key: "ArrowLeft" });

    const contentItem = screen.getByText("Content").closest('[role="treeitem"]')!;
    expect(contentItem.getAttribute("tabindex")).toBe("0");
    expect(mapsItem.getAttribute("tabindex")).toBe("-1");
  });

  it("keeps a visible active treeitem after the focused subtree is collapsed", () => {
    renderTree();
    const mapsItem = screen.getByText("Maps").closest('[role="treeitem"]')!;

    fireEvent.focus(mapsItem);
    fireEvent.click(screen.getByLabelText("Collapse Content"));

    const contentItem = screen.getByText("Content").closest('[role="treeitem"]')!;
    const configItem = screen.getByText("Config").closest('[role="treeitem"]')!;
    expect(screen.queryByText("Maps")).toBeNull();
    expect(contentItem.getAttribute("tabindex")).toBe("0");
    expect(configItem.getAttribute("tabindex")).toBe("-1");
  });

  it("moves focus with ArrowDown among visible nodes", () => {
    renderTree();
    const tree = screen.getByRole("tree");
    const contentItem = screen.getByText("Content").closest('[role="treeitem"]')!;

    fireEvent.focus(contentItem);
    fireEvent.keyDown(tree, { key: "ArrowDown" });

    const mapsItem = screen.getByText("Maps").closest('[role="treeitem"]')!;
    expect(mapsItem.getAttribute("tabindex")).toBe("0");
    expect(contentItem.getAttribute("tabindex")).toBe("-1");
  });

  it("moves focus with ArrowUp among visible nodes", () => {
    renderTree();
    const tree = screen.getByRole("tree");
    const configItem = screen.getByText("Config").closest('[role="treeitem"]')!;

    fireEvent.focus(configItem);
    fireEvent.keyDown(tree, { key: "ArrowUp" });

    const charactersItem = screen.getByText("Characters").closest('[role="treeitem"]')!;
    expect(charactersItem.getAttribute("tabindex")).toBe("0");
    expect(configItem.getAttribute("tabindex")).toBe("-1");
  });

  it("moves focus to first node with Home", () => {
    renderTree();
    const tree = screen.getByRole("tree");
    const configItem = screen.getByText("Config").closest('[role="treeitem"]')!;

    fireEvent.focus(configItem);
    fireEvent.keyDown(tree, { key: "Home" });

    const contentItem = screen.getByText("Content").closest('[role="treeitem"]')!;
    expect(contentItem.getAttribute("tabindex")).toBe("0");
    expect(configItem.getAttribute("tabindex")).toBe("-1");
  });

  it("moves focus to last node with End", () => {
    renderTree();
    const tree = screen.getByRole("tree");
    const contentItem = screen.getByText("Content").closest('[role="treeitem"]')!;

    fireEvent.focus(contentItem);
    fireEvent.keyDown(tree, { key: "End" });

    const configItem = screen.getByText("Config").closest('[role="treeitem"]')!;
    expect(configItem.getAttribute("tabindex")).toBe("0");
    expect(contentItem.getAttribute("tabindex")).toBe("-1");
  });
});
