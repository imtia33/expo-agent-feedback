/**
 * DevTools hook attachment.
 *
 * React Native installs __REACT_DEVTOOLS_GLOBAL_HOOK__ at startup via
 * react-native@0.87/Libraries/Core/setUpReactDevTools.js (which calls
 * react-devtools-core's `initialize()`). We attach listeners to the
 * existing hook — we do NOT call initialize() ourselves.
 *
 * API verified against react-devtools-core@8.0.0 / RN 0.87.
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
 * Return all registered React renderers.
 *
 * Each renderer has `rendererConfig.getInspectorDataForViewAtPoint()` —
 * the same API RN's own Element Inspector uses. Returns a flat hierarchy
 * array, not a deep tree. No Hermes depth issues.
 *
 * Verified against react-native@0.86.3
 * src/private/devsupport/devmenu/elementinspector/getInspectorDataForViewAtPoint.js
 * — the same file RN's own Element Inspector ships.
 */
export function getRenderers(): any[] {
  const hook = getHook();
  if (!hook) return [];
  const renderers: any[] = [];
  // hook.renderers is a Map<number, ReactRenderer>
  if (hook.renderers instanceof Map) {
    for (const renderer of hook.renderers.values()) {
      renderers.push(renderer);
    }
  }
  return renderers;
}

// Fiber tag for portal fibers (React source: ReactWorkTags.js)
const HOST_PORTAL_TAG = 4;

/**
 * Collect ALL fiber root fibers from all registered renderers.
 *
 * This is the core fix for the Expo Router / React Navigation portal bug:
 * Expo Router's <Stack> mounts screen content via React portals, which
 * create SEPARATE FiberRoots. These portal roots ARE tracked by
 * hook.getFiberRoots() — they appear alongside the main app root — so
 * simply calling getFiberRoots() on all renderers is sufficient.
 *
 * As a belt-and-suspenders measure we also scan for HostPortal fibers
 * (tag=4) inside the discovered roots and resolve their
 * stateNode.containerInfo to find any roots that somehow escaped
 * getFiberRoots() (e.g., custom native portal implementations).
 *
 * Returns an array of HostRoot fibers (fiber.tag === 3), one per root.
 */
export function getAllFiberRoots(): any[] {
  const hook = getHook();
  if (!hook) return [];

  const seen = new Set<any>(); // track FiberRoot objects to avoid duplicates
  const rootFibers: any[] = [];

  function addRoot(fiberRoot: any) {
    if (!fiberRoot || seen.has(fiberRoot)) return;
    seen.add(fiberRoot);
    const hostRoot = fiberRoot.current;
    if (hostRoot) rootFibers.push(hostRoot);
  }

  // Primary: walk all roots from all renderers.
  for (const rendererID of rendererIds) {
    let roots: Set<any> | undefined;
    try {
      roots = hook.getFiberRoots(rendererID);
    } catch {
      continue;
    }
    if (!roots || typeof roots.forEach !== 'function') continue;
    for (const root of roots) {
      addRoot(root);
    }
  }

  // Secondary: scan each discovered root for HostPortal fibers (tag=4).
  // A HostPortal's stateNode.containerInfo holds the native container that
  // React rendered into — if that container has a ._reactRootContainer or
  // ._internalRoot, it's another FiberRoot we should walk.
  // This catches custom portal implementations that may not register with
  // the global hook's fiberRoots set.
  const knownRootCount = rootFibers.length;
  for (let i = 0; i < knownRootCount; i++) {
    scanForPortals(rootFibers[i], addRoot);
  }

  return rootFibers;
}

/**
 * Recursively scan a fiber subtree for HostPortal fibers (tag=4) and
 * resolve their stateNode.containerInfo to additional FiberRoots.
 */
function scanForPortals(fiber: any, addRoot: (root: any) => void): void {
  let node = fiber;
  while (node) {
    try {
      if (node.tag === HOST_PORTAL_TAG) {
        const containerInfo = node.stateNode?.containerInfo;
        if (containerInfo) {
          // React DOM puts the root at containerInfo._reactRootContainer._internalRoot
          // React Native Fabric puts it at containerInfo._internalRoot or _reactRootContainer
          const internalRoot =
            containerInfo._internalRoot ||
            containerInfo._reactRootContainer?._internalRoot ||
            containerInfo.__reactFiber?._internalRoot;
          if (internalRoot) {
            addRoot(internalRoot);
          }
        }
      }
    } catch {
      // Ignore errors traversing portal stateNodes.
    }
    if (node.child) {
      scanForPortals(node.child, addRoot);
    }
    node = node.sibling;
  }
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
  const rootFibers = getAllFiberRoots();
  for (const hostRoot of rootFibers) {
    walkFiberSiblings(hostRoot, visit);
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
