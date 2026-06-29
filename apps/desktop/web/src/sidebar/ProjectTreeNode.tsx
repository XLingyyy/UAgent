import type { KeyboardEvent } from "react";
import type { ProjectTreeNode } from "../types/ui";
import "./ProjectTreeNode.css";

const TYPE_LABEL: Record<string, string> = {
  Folder: "F",
  Map: "M",
  Blueprint: "Bp",
  Material: "Mat",
  Asset: "A",
  Config: "Cfg",
  Project: "Prj",
};

export interface ProjectTreeNodeProps {
  node: ProjectTreeNode;
  depth: number;
  expandedIds: Set<string>;
  selectedId: string | null;
  focusedId: string | null;
  diagnosticCounts: Record<string, number>;
  onToggle: (nodeId: string) => void;
  onSelect: (nodeId: string) => void;
  onFocus: (nodeId: string) => void;
}

export function ProjectTreeNode({
  node,
  depth,
  expandedIds,
  selectedId,
  focusedId,
  diagnosticCounts,
  onToggle,
  onSelect,
  onFocus,
}: ProjectTreeNodeProps) {
  const hasChildren = Boolean(node.children?.length);
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedId === node.id;
  const isFocused = focusedId === node.id;

  const classNames = ["ua-tree-node", isSelected ? "ua-tree-node--selected" : ""]
    .filter(Boolean)
    .join(" ");
  const displayPath = node.rootRelativePath
    ? `[project-root]/${node.rootRelativePath.replace(/\\/g, "/")}`
    : null;
  const diagnosticCount = displayPath ? diagnosticCounts[displayPath] ?? 0 : 0;

  const toggleClassNames = [
    "ua-tree-node__toggle",
    hasChildren
      ? isExpanded
        ? "ua-tree-node__toggle--expanded"
        : ""
      : "ua-tree-node__toggle--leaf",
  ]
    .filter(Boolean)
    .join(" ");

  const handleToggle = () => {
    if (hasChildren) {
      onToggle(node.id);
    }
  };

  const handleFocusCapture = () => {
    onFocus(node.id);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      onSelect(node.id);
      return;
    }

    if (event.key === "ArrowRight" && hasChildren) {
      event.preventDefault();
      if (isExpanded) {
        onFocus(node.children![0].id);
      } else {
        onToggle(node.id);
      }
      return;
    }

    if (event.key === "ArrowLeft" && hasChildren && isExpanded) {
      event.preventDefault();
      onToggle(node.id);
    }
  };

  return (
    <>
      <div
        className={classNames}
        style={{ paddingLeft: `calc(var(--ua-space-2) + ${depth * 14}px)` }}
        role="treeitem"
        data-node-id={node.id}
        tabIndex={isFocused ? 0 : -1}
        aria-level={depth + 1}
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-selected={isSelected}
        onClick={() => {
          onFocus(node.id);
          onSelect(node.id);
        }}
        onFocus={handleFocusCapture}
        onKeyDown={handleKeyDown}
      >
        {hasChildren ? (
          <button
            className={toggleClassNames}
            type="button"
            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${node.name}`}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              handleToggle();
            }}
          >
            ▸
          </button>
        ) : (
          <span className={toggleClassNames} aria-hidden>
            ▸
          </span>
        )}
        <span className="ua-tree-node__name" title={node.name}>
          {node.name}
        </span>
        {diagnosticCount > 0 && (
          <span
            className="ua-tree-node__diagnostics"
            aria-label={`${diagnosticCount} diagnostics for ${node.name}`}
            title={`${diagnosticCount} diagnostics`}
          >
            {diagnosticCount}
          </span>
        )}
        <span className="ua-tree-node__type">{TYPE_LABEL[node.type] ?? node.type}</span>
      </div>
      {hasChildren && isExpanded && (
        <div role="group">
          {node.children!.map((child) => (
            <ProjectTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              selectedId={selectedId}
              focusedId={focusedId}
              diagnosticCounts={diagnosticCounts}
              onToggle={onToggle}
              onSelect={onSelect}
              onFocus={onFocus}
            />
          ))}
        </div>
      )}
    </>
  );
}
