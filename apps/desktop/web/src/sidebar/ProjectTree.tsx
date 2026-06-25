import { useState, useCallback } from "react";
import type { ProjectTreeNode as ProjectTreeNodeType } from "../types/ui";
import { ProjectTreeNode } from "./ProjectTreeNode";
import "./ProjectTree.css";

export interface ProjectTreeProps {
  nodes: ProjectTreeNodeType[];
  label?: string;
  ariaLabel?: string;
}

export function ProjectTree({
  nodes,
  label = "Project Tree",
  ariaLabel = "Project tree",
}: ProjectTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    function collectTopLevel(node: ProjectTreeNodeType) {
      if (node.children?.length) {
        initial.add(node.id);
      }
    }
    nodes.forEach(collectTopLevel);
    return initial;
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleToggle = useCallback((nodeId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const handleSelect = useCallback((nodeId: string) => {
    setSelectedId(nodeId);
  }, []);

  return (
    <div className="ua-project-tree">
      <span className="ua-project-tree__label">{label}</span>
      <div className="ua-project-tree__scroll" role="tree" aria-label={ariaLabel}>
        {nodes.map((node) => (
          <ProjectTreeNode
            key={node.id}
            node={node}
            depth={0}
            expandedIds={expandedIds}
            selectedId={selectedId}
            onToggle={handleToggle}
            onSelect={handleSelect}
          />
        ))}
      </div>
    </div>
  );
}
