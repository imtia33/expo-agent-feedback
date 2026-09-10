/**
 * DevTools hook attachment.
 *
 * React Native installs __REACT_DEVTOOLS_GLOBAL_HOOK__ at startup via
 * react-native@0.87/Libraries/Core/setUpReactDevTools.js. We just attach
 * listeners to the existing hook — we don't call initialize() ourselves.
 *
 * The hook exposes per-renderer interfaces (one per React root). Each
 * renderer interface has methods like:
 *   - walkTree(commitCallback, rootCommitCallback)
 *   - getFiberForID(id)
 *   - getDisplayNameForFiberID(id)
 *   - findNativeNodesForFiberID(id)
 *   - inspectElement(id)  → full props/state/hooks
 *
 * We keep a map of rendererID → rendererInterface. When the agent calls
 * inspect(), we walk the tree, calling findNativeNodesForFiberID() on each
 * fiber to get its host instance, then read layout via the DOM-like API.
 */

interface DevToolsHook {
  _renderers: Map<number, any>;
  rendererInterfaces?: Map<number, any>;
  on: (event: string, cb: (data: any) => void) => void;
  off?: (event: string, cb: (data: any) => void) => void;
  emit?: (event: string, data: any) => void;
  inject?: (config: any) => number;
  subs?: Map<string, Set<(data: any) => void>>;
}

function getHook(): DevToolsHook | null {
  const g = global as any;
  const hook = g.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook) return null;
  return hook as DevToolsHook;
}

/** Map of rendererID → rendererInterface. */
const rendererInterfaces = new Map<number, any>();

let isAttached = false;

export function attachDevToolsHook(): void {
  if (isAttached) return;
  const hook = getHook();
  if (!hook) {
    console.warn('[expo-eyes] __REACT_DEVTOOLS_GLOBAL_HOOK__ not found. Are you in production mode?');
    return;
  }

  // If renderers are already attached (RN has been running for a moment), capture them.
  if (hook.rendererInterfaces) {
    for (const [id, iface] of hook.rendererInterfaces.entries()) {
      rendererInterfaces.set(id, iface);
    }
  }
  if (hook._renderers) {
    for (const [id, renderer] of hook._renderers.entries()) {
      // The renderer interface may not be set yet — but the renderer is.
      // We'll catch it on the 'renderer-attached' event.
      if (!rendererInterfaces.has(id) && hook.rendererInterfaces) {
        const iface = hook.rendererInterfaces.get(id);
        if (iface) rendererInterfaces.set(id, iface);
      }
    }
  }

  // Listen for new renderers attaching (e.g. after a reload).
  try {
    hook.on('renderer-attached', ({ id, renderer }: { id: number; renderer: any }) => {
      // The interface is added to rendererInterfaces slightly after the event fires.
      setTimeout(() => {
        const iface = hook.rendererInterfaces?.get(id);
        if (iface) {
          rendererInterfaces.set(id, iface);
        }
      }, 0);
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

/** Return all renderer interfaces. */
export function getAllRendererInterfaces(): any[] {
  return Array.from(rendererInterfaces.values());
}

/**
 * Walk every fiber in every renderer. Callback returns false to skip
 * the subtree of this fiber.
 */
export function walkFibers(
  visit: (fiber: any, rendererInterface: any) => void | boolean,
): void {
  for (const iface of rendererInterfaces.values()) {
    if (!iface || typeof iface.walkTree !== 'function') continue;
    try {
      iface.walkTree((fiber: any) => {
        return visit(fiber, iface);
      });
    } catch (e) {
      // Some renderers throw if walked before mounting; skip.
    }
  }
}

/** Get the host instance(s) for a given fiber. */
export function findNativeNodesForFiber(fiber: any, iface: any): any[] {
  if (!iface) return [];
  try {
    if (typeof iface.findNativeNodesForFiberID === 'function') {
      const id = iface.getFiberID?.(fiber) ?? fiber?.['_debugID'] ?? null;
      if (id != null) {
        const nodes = iface.findNativeNodesForFiberID(id);
        return Array.isArray(nodes) ? nodes.filter(Boolean) : [];
      }
    }
  } catch {}
  // Fall back to the fiber's stateNode (host component).
  if (fiber?.stateNode && typeof fiber.stateNode === 'object') {
    return [fiber.stateNode];
  }
  return [];
}
