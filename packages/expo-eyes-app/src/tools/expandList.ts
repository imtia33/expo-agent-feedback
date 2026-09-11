/**
 * expandList tool — scroll a virtualized list to a given range, then return items.
 *
 * Virtualized lists (FlatList / SectionList / FlashList) only mount ~10-15
 * rows at a time. If the agent wants to inspect row 500, we have to scroll
 * there first, wait for render, then snapshot.
 *
 * Strategy:
 *   1. Find the list fiber by ref
 *   2. Call scrollToIndex({ index, animated: false }) on the host
 *   3. Wait a bit for render (~150ms)
 *   4. Snapshot the list — return only the items in [from, to]
 *
 * Args:
 *  - listRef: string (required) — ref of the FlatList/SectionList/etc.
 *  - from: number (default: 0)
 *  - to: number (default: from + 14) — inclusive
 *
 * Returns:
 *  - items: TreeNode[] (the rendered items in the requested range)
 *  - renderedRange: [number, number] — what's actually mounted now
 *  - itemCount: number
 */

import { findHostFiberByRef, findFiberByRef } from '../tree-serializer';
import { snapshotRef } from '../tree-serializer';

export async function expandList(args: Record<string, any>): Promise<{
  items: any[];
  renderedRange: [number, number];
  itemCount: number;
  renderTimeMs: number;
}> {
  const listRef = args.listRef;
  if (typeof listRef !== 'string' || !listRef) {
    throw Object.assign(new Error('expandList requires args.listRef (string)'), { code: 'BAD_ARGS' });
  }

  const from = typeof args.from === 'number' ? args.from : 0;
  const to = typeof args.to === 'number' ? args.to : from + 14;
  if (to < from) {
    throw Object.assign(new Error(`expandList: 'to' (${to}) must be >= 'from' (${from})`), { code: 'BAD_ARGS' });
  }

  const target = findHostFiberByRef(listRef);
  if (!target) {
    throw Object.assign(new Error(`listRef "${listRef}" not found — call inspect() to refresh.`), { code: 'REF_NOT_FOUND' });
  }

  const host = target.hostInstance;
  const t0 = Date.now();

  // Try scrollToIndex (FlatList / VirtualizedList expose this via ref)
  if (typeof host.scrollToIndex === 'function') {
    try {
      host.scrollToIndex({ index: from, animated: false, viewPosition: 0 });
    } catch (e) {
      // Some lists don't support scrollToIndex. Fall back to scrollToOffset.
      if (typeof host.scrollToOffset === 'function') {
        try {
          // Rough estimate: 80px per row. Agent can call again with a different offset.
          host.scrollToOffset({ offset: from * 80, animated: false });
        } catch {}
      }
    }
  } else if (typeof host.scrollToOffset === 'function') {
    try {
      host.scrollToOffset({ offset: from * 80, animated: false });
    } catch {}
  } else if (typeof host.scrollTo === 'function') {
    try {
      host.scrollTo({ y: from * 80, animated: false });
    } catch {}
  }

  // Wait for render
  await new Promise((resolve) => setTimeout(resolve, 200));

  // Snapshot the list to get its currently-rendered children
  const element = await snapshotRef(listRef);
  if (!element) {
    throw Object.assign(new Error(`After scrolling, listRef "${listRef}" was no longer found.`), { code: 'REF_NOT_FOUND' });
  }

  const itemCount = element.itemCount ?? element.children.length;
  const renderedCount = element.children.length;
  const renderedRange: [number, number] = [from, from + renderedCount - 1];

  return {
    items: element.children,
    renderedRange,
    itemCount,
    renderTimeMs: Date.now() - t0,
  };
}
