/**
 * scrollTo tool — programmatic scroll of a ScrollView/FlatList/etc.
 *
 * Strategy:
 *   1. If args.ref is a scrollable, scroll it directly
 *   2. Otherwise, find the nearest scrollable ancestor of args.ref
 *   3. Call scrollTo({x, y, animated}) on the host instance
 *
 * Fabric's ReactNativeElement exposes scrollTo directly (via ViewCommands).
 * Paper's RCTScrollView exposes it via the ref. We try both.
 *
 * Args:
 *  - ref: string (required) — ref ID of a scrollable OR an element inside one
 *  - x?: number (default: 0)
 *  - y?: number (default: 0)
 *  - animated?: boolean (default: true)
 *  - direction?: 'up' | 'down' | 'left' | 'right' — sugar, overrides x/y
 *  - amount?: number — pixels to scroll (used with direction)
 */

import { findHostFiberByRef, findScrollableAncestor } from '../tree-serializer';

export async function scrollTo(args: Record<string, any>): Promise<{ ok: boolean; scrolledTo: { x: number; y: number }; refsStillValid: boolean }> {
  const ref = args.ref;
  if (typeof ref !== 'string' || !ref) {
    throw Object.assign(new Error('scrollTo requires args.ref (string)'), { code: 'BAD_ARGS' });
  }

  // Try to find the scrollable. First, check if ref itself is a scrollable.
  // We do this by looking at the host instance's available methods.
  let target = findHostFiberByRef(ref);

  if (!target || !isScrollable(target.hostInstance)) {
    // Walk up to find a scrollable ancestor
    target = findScrollableAncestor(ref);
  }

  if (!target) {
    throw Object.assign(
      new Error(`No scrollable ancestor found for ref "${ref}". Make sure the element is inside a ScrollView / FlatList.`),
      { code: 'NOT_SCROLLABLE' },
    );
  }

  // Compute target x/y
  let x = typeof args.x === 'number' ? args.x : 0;
  let y = typeof args.y === 'number' ? args.y : 0;

  if (typeof args.direction === 'string' && typeof args.amount === 'number') {
    // We don't know current scroll offset here without reading state.
    // For direction mode, we use the host instance's scroll position via
    // measureLayout if available. For v1, we just trust x/y.
    // The agent can read current position from props.contentOffset if needed.
    switch (args.direction) {
      case 'down': y = args.amount; break;
      case 'up': y = -args.amount; break;
      case 'right': x = args.amount; break;
      case 'left': x = -args.amount; break;
    }
  }

  const animated = args.animated !== false;

  // Try multiple APIs in order of preference
  const host = target.hostInstance;

  // 1. Direct scrollTo on host instance (Fabric ReactNativeElement)
  if (typeof host.scrollTo === 'function') {
    try {
      host.scrollTo({ x, y, animated });
      return { ok: true, scrolledTo: { x, y }, refsStillValid: true };
    } catch (e) {
      // fall through
    }
  }

  // 2. getScrollResponder() — the legacy RN way
  if (typeof host.getScrollResponder === 'function') {
    try {
      const responder = host.getScrollResponder();
      if (responder && typeof responder.scrollTo === 'function') {
        responder.scrollTo({ x, y, animated });
        return { ok: true, scrolledTo: { x, y }, refsStillValid: true };
      }
    } catch {}
  }

  // 3. Call via UIManager dispatch (Paper fallback)
  // We'd need the reactTag here. For v1, skip.
  throw Object.assign(
    new Error(`Scrollable host for ref "${ref}" doesn't expose scrollTo. The component may be using a custom scroll implementation.`),
    { code: 'SCROLL_FAILED' },
  );
}

function isScrollable(hostInstance: any): boolean {
  if (!hostInstance) return false;
  return typeof hostInstance.scrollTo === 'function' ||
         typeof hostInstance.getScrollResponder === 'function' ||
         typeof hostInstance.scrollToEnd === 'function';
}
