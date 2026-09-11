/**
 * inspect tool — return the visible tree (pruned, agent-friendly).
 *
 * Args:
 *  - since?: 'last'  → return only diff vs last inspect() (v2; v1 ignores)
 *
 * Returns:
 *  - tree: TreeNode (the root)
 *  - totalNodes: number
 *  - prunedNodes: number (always 0 in v1 — we don't track this yet)
 */

import { serializeTree } from '../tree-serializer';

export interface InspectResult {
  tree: any;
  totalNodes: number;
  prunedNodes: number;
  renderTimeMs: number;
}

export async function inspect(_args: Record<string, any>): Promise<InspectResult> {
  const t0 = Date.now();
  const tree = await serializeTree();
  const elapsed = Date.now() - t0;

  const totalNodes = tree ? countNodes(tree) : 0;

  return {
    tree,
    totalNodes,
    prunedNodes: 0,
    renderTimeMs: elapsed,
  };
}

function countNodes(node: any): number {
  if (!node) return 0;
  let count = 1;
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      count += countNodes(child);
    }
  }
  return count;
}
