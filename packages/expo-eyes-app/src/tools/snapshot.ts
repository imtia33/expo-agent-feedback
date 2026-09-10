/**
 * snapshot tool — drill into one element + its actual rendered children.
 *
 * Args:
 *  - ref: string (required) — ref ID from a prior inspect()
 *
 * Returns:
 *  - element: TreeNode (the requested element with deep children)
 *  - renderTimeMs: number
 */

import { snapshotRef } from '../tree-serializer';

export interface SnapshotResult {
  element: any;
  renderTimeMs: number;
}

export async function snapshot(args: Record<string, any>): Promise<SnapshotResult> {
  const ref = args.ref;
  if (typeof ref !== 'string' || !ref) {
    throw Object.assign(new Error('snapshot requires args.ref (string)'), { code: 'BAD_ARGS' });
  }

  const t0 = Date.now();
  const element = await snapshotRef(ref);
  const elapsed = Date.now() - t0;

  if (!element) {
    throw Object.assign(new Error(`ref "${ref}" not found — it may have been invalidated by a re-render. Call inspect() to refresh.`), { code: 'REF_NOT_FOUND' });
  }

  return {
    element,
    renderTimeMs: elapsed,
  };
}
