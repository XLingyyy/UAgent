import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { ProjectTreeNode as ProjectTreeNodeType } from "../types/ui";
import { ProjectTreeNode } from "./ProjectTreeNode";
import "./ProjectTree.css";

export interface ProjectTreeProps {
  nodes: ProjectTreeNodeType[];
  label?: string;
  ariaLabel?: string;
}

function getVisibleNodeIds(nodes: ProjectTreeNodeType[], expandedIds: Set<string>): string[] {
  const result: string[] = [];
  function walk(list: ProjectTreeNodeType[]) {
    for (const node of list) {
      result.push(node.id);
      if (node.children?.length && expandedIds.has(node.id)) {
        walk(node.children);
      }
    }
  }
  walk(nodes);
  return result;
}

function buildParentMap(nodes: ProjectTreeNodeType[]): Map<string, string | null> {
  const map = new Map<string, string | null>();
  function walk(list: ProjectTreeNodeType[], parentId: string | null) {
    for (const node of list) {
      map.set(node.id, parentId);
      if (node.children) {
        walk(node.children, node.id);
      }
    }
  }
  walk(nodes, null);
  return map;
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
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const visibleIds = useMemo(() => getVisibleNodeIds(nodes, expandedIds), [nodes, expandedIds]);
  const activeFocusedId =
    focusedId && visibleIds.includes(focusedId) ? focusedId : (visibleIds[0] ?? null);

  const parentMap = useRef<Map<string, string | null>>(buildParentMap(nodes));

  useEffect(() => {
    parentMap.current = buildParentMap(nodes);
  }, [nodes]);

  useEffect(() => {
    if (focusedId && !visibleIds.includes(focusedId)) {
      setFocusedId(visibleIds[0] ?? null);
    }
  }, [focusedId, visibleIds]);

  useEffect(() => {
    if (focusedId && treeRef.current) {
      const el = treeRef.current.querySelector(`[data-node-id="${focusedId}"]`);
      if (el instanceof HTMLElement) {
        el.focus();
      }
    }
  }, [focusedId]);

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

  const handleFocus = useCallback((nodeId: string) => {
    setFocusedId(nodeId);
  }, []);

  const findNodeInTree = useCallback(
    (id: string): ProjectTreeNodeType | undefined => {
      function walk(list: ProjectTreeNodeType[]): ProjectTreeNodeType | undefined {
        for (const n of list) {
          if (n.id === id) return n;
          if (n.children) {
            const found = walk(n.children);
            if (found) return found;
          }
        }
        return undefined;
      }
      return walk(nodes);
    },
    [nodes],
  );

  const handleTreeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (visibleIds.length === 0) {
        return;
      }

      const currentIndex = activeFocusedId ? visibleIds.indexOf(activeFocusedId) : -1;
      let targetIndex = currentIndex;

      switch (event.key) {
        case "ArrowDown": {
          event.preventDefault();
          targetIndex = Math.min(currentIndex + 1, visibleIds.length - 1);
          break;
        }
        case "ArrowUp": {
          event.preventDefault();
          targetIndex = Math.max(currentIndex - 1, 0);
          break;
        }
        case "Home": {
          event.preventDefault();
          targetIndex = 0;
          break;
        }
        case "End": {
          event.preventDefault();
          targetIndex = visibleIds.length - 1;
          break;
        }
        case "ArrowLeft": {
          if (currentIndex < 0) {
            return;
          }
          const currentNode = findNodeInTree(visibleIds[currentIndex]);
          const isExpanded = Boolean(
            currentNode?.children?.length && expandedIds.has(currentNode.id),
          );
          if (isExpanded) {
            return;
          }
          event.preventDefault();
          const parentId = parentMap.current.get(visibleIds[currentIndex]);
          if (parentId) {
            const parentIndex = visibleIds.indexOf(parentId);
            if (parentIndex >= 0) {
              targetIndex = parentIndex;
            }
          }
          if (targetIndex === currentIndex) {
            targetIndex = Math.max(currentIndex - 1, 0);
          }
          break;
        }
        default:
          return;
      }

      if (targetIndex !== currentIndex && targetIndex >= 0 && targetIndex < visibleIds.length) {
        setFocusedId(visibleIds[targetIndex]);
      }
    },
    [expandedIds, activeFocusedId, findNodeInTree, visibleIds],
  );

  return (
    <div className="ua-project-tree">
      <span className="ua-project-tree__label">{label}</span>
      <div
        ref={treeRef}
        className="ua-project-tree__scroll"
        role="tree"
        aria-label={ariaLabel}
        onKeyDown={handleTreeKeyDown}
      >
        {nodes.map((node) => (
          <ProjectTreeNode
            key={node.id}
            node={node}
            depth={0}
            expandedIds={expandedIds}
            selectedId={selectedId}
            focusedId={activeFocusedId}
            onToggle={handleToggle}
            onSelect={handleSelect}
            onFocus={handleFocus}
          />
        ))}
      </div>
    </div>
  );
}
