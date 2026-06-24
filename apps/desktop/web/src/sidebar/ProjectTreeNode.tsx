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
  onToggle: (nodeId: string) => void;
  onSelect: (nodeId: string) => void;
}

export function ProjectTreeNode({
  node,
  depth,
  expandedIds,
  selectedId,
  onToggle,
  onSelect,
}: ProjectTreeNodeProps) {
  const hasChildren = Boolean(node.children?.length);
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedId === node.id;

  const classNames = ["ua-tree-node", isSelected ? "ua-tree-node--selected" : ""]
    .filter(Boolean)
    .join(" ");

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

  return (
    <>
      <div
        className={classNames}
        style={{ paddingLeft: `calc(var(--ua-space-2) + ${depth * 14}px)` }}
        role="treeitem"
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-selected={isSelected}
        onClick={() => onSelect(node.id)}
      >
        <span
          className={toggleClassNames}
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggle(node.id);
          }}
          aria-hidden
        >
          ▸
        </span>
        <span className="ua-tree-node__name" title={node.name}>
          {node.name}
        </span>
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
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </>
  );
}
