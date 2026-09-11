/**
 * DevTools hook attachment.
 *
 * React Native installs __REACT_DEVTOOLS_GLOBAL_HOOK__ at startup via
 * react-native@0.87/Libraries/Core/setUpReactDevTools.js (which calls
 * react-devtools-core's `initialize()`). We attach listeners to the
 * existing hook — we do NOT call initialize() ourselves.
 *
 * API verified against react-devtools-core@8.0.0 / RN 0.87
 * (see docs/libraries/rn-devtools-hook-API.md).
 *
 * Key findings from research:
 *   - `iface.walkTree(cb)` does NOT exist (removed in v4.x / RN 0.66).
 *     We walk fibers manually via `hook.getFiberRoots(rendererID)`.
 *   - `iface.findNativeNodesForFiberID` renamed to
 *     `iface.findHostInstancesForElementID` in RN 0.82+ (React 19).
 *   - `iface.getFiberID` never existed publicly.
 *   - `hook._renderers` is the v3 name; modern hook uses `hook.renderers`.
 *   - `'renderer-attached'` payload is `{id, rendererInterface}` (NOT {id, renderer}).
 */

interface DevToolsHook {
  renderers: Map<number, any>;
  rendererInterfaces: Map<number, any>;
  on: (event: string, cb: (data: any) => void) => void;
  off?: (event: string, cb: (data: any) => void) => void;
  emit?: (event: string, data: any) => void;
  inject?: (config: any) => number | null;
  getFiberRoots: (rendererID: number) => Set<any>;
  supportsFiber: boolean;
}

function getHook(): DevToolsHook | null {
  const g = (globalThis as any);
  const hook = g.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook) return null;
  return hook as DevToolsHook;
}

/** Map of rendererID → rendererInterface. */
const rendererInterfaces = new Map<number, any>();
const rendererIds = new Set<number>();
let isAttached = false;

export function attachDevToolsHook(): void {
  if (isAttached) return;
  const hook = getHook();
  if (!hook) {
    console.warn('[expo-eyes] __REACT_DEVTOOLS_GLOBAL_HOOK__ not found. Are you in production mode?');
    return;
  }

  // Capture any renderers already attached.
  if (hook.rendererInterfaces instanceof Map) {
    for (const [id, iface] of hook.rendererInterfaces.entries()) {
      rendererInterfaces.set(id, iface);
      rendererIds.add(id);
    }
  }
  // `hook.renderers` is the lower-level registry (Map on modern versions).
  if (hook.renderers instanceof Map) {
    for (const id of hook.renderers.keys()) {
      rendererIds.add(id);
      if (!rendererInterfaces.has(id) && hook.rendererInterfaces) {
        const iface = hook.rendererInterfaces.get(id);
        if (iface) rendererInterfaces.set(id, iface);
      }
    }
  }

  // Listen for new renderers attaching (e.g. after a reload).
  // Per research: the 'renderer-attached' payload is { id, rendererInterface }.
  try {
    hook.on('renderer-attached', (data: any) => {
      const id = data?.id;
      if (typeof id !== 'number') return;
      const iface = data.rendererInterface || hook.rendererInterfaces?.get(id);
      if (iface) {
        rendererInterfaces.set(id, iface);
        rendererIds.add(id);
      }
    });
  } catch (e) {
    // Some hook versions emit different event names; ignore.
  }

  isAttached = true;
}

/** Return the first renderer interface we know about. */
export function getRendererInterface(): any | null {
  for (const iface of rendererInterfaces.values()) {
    return iface;
  }
  return null;
}

/** Return all renderer IDs (we walk roots per renderer). */
export function getRendererIds(): number[] {
  return Array.from(rendererIds);
}

/** Return the global hook (for getFiberRoots). */
export function getHookRef(): DevToolsHook | null {
  return getHook();
}

/**
 * Walk every fiber in every renderer by traversing `hook.getFiberRoots()`
 * and following `.child` / `.sibling` pointers.
 *
 * This is the modern replacement for the removed `iface.walkTree()`.
 * Pattern verified in react-devtools-shared/src/backend/fiber/renderer.js
 * (`flushInitialOperations`).
 *
 * @param visit Called for each fiber. Return false to skip its subtree.
 */
export function walkFibers(
  visit: (fiber: any) => void | boolean,
): void {
  const hook = getHook();
  if (!hook) return;

  for (const rendererID of rendererIds) {
    let roots: Set<any> | undefined;
    try {
      roots = hook.getFiberRoots(rendererID);
    } catch {
      continue;
    }
    if (!roots || typeof roots.forEach !== 'function') continue;

    for (const root of roots) {
      // root is a FiberRoot; root.current is the HostRoot fiber
      const hostRoot = root?.current;
      if (!hostRoot) continue;
      walkFiberSiblings(hostRoot, visit);
    }
  }
}

function walkFiberSiblings(fiber: any, visit: (fiber: any) => void | boolean): void {
  let node = fiber;
  while (node) {
    let skipSubtree = false;
    try {
      skipSubtree = visit(node) === false;
    } catch {
      // Skip this node but keep going.
      skipSubtree = true;
    }
    if (!skipSubtree && node.child) {
      walkFiberSiblings(node.child, visit);
    }
    node = node.sibling;
  }
}

/**
 * Find host instances for a given fiber.
 *
 * Modern API (RN 0.82+, React 19): `iface.findHostInstancesForElementID(id)`
 * — requires a DevTools element id.
 *
 * Legacy API (RN ≤ 0.81): `iface.findNativeNodesForFiberID(id)`.
 *
 * In both cases, we need the DevTools element id for the fiber. There's
 * no public API to convert fiber → element id. We fall back to reading
 * `fiber.stateNode` directly for HostComponent fibers (tag === 5), which
 * is the host instance.
 */
export function findHostInstancesForFiber(fiber: any): any[] {
  if (!fiber) return [];

  // Direct read: HostComponent fibers have a stateNode that IS the host instance.
  // Fiber tag 5 = HostComponent (verified in ReactWorkTags).
  if (fiber.tag === 5 && fiber.stateNode) {
    return [fiber.stateNode];
  }

  // For non-host fibers, try to find host children (descend .child tree).
  if (fiber.tag !== 5 && fiber.child) {
    const hosts: any[] = [];
    let child = fiber.child;
    while (child) {
      hosts.push(...findHostInstancesForFiber(child));
      child = child.sibling;
    }
    return hosts.slice(0, 1); // first host child only, for layout purposes
  }

  return [];
}
