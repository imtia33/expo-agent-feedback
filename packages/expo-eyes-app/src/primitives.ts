/**
 * App-side primitives — uses RN's own inspector API.
 *
 * Architecture:
 *   Instead of walking the fiber tree (which fights Hermes' JSON depth limit),
 *   we use React renderer's `rendererConfig.getInspectorDataForViewAtPoint()` —
 *   the SAME API RN's Element Inspector uses. Returns a flat hierarchy array,
 *   not a deep recursive tree. No serialize issues.
 *
 * Primitives exposed to the relay:
 *   inspectAtPoint({ x, y })     → element at a screen point
 *   listVisibleElements()        → flat list of all visible elements
 *   dispatchEvent(viewTag, ...)  → fire onPress/onChangeText on a viewTag
 *   scroll(viewTag, x, y)        → scrollTo on a scrollable
 *   scrollToIndex(viewTag, n)    → scrollToIndex on a list
 *
 * Reference: docs/libraries/rn-element-inspector-API.md
 *            react-native@0.86.3/src/private/devsupport/devmenu/elementinspector/
 */

import { getRenderers, getAllFiberRoots } from './devtools-hook';
import { getTypeName } from './raw-tree';
import { findNodeHandle, UIManager, Platform, Dimensions } from 'react-native';

// ─── Root view instance (for Fabric inspector) ───────────────────────
//
// On Fabric (RN new architecture), getInspectorDataForViewAtPoint requires
// a non-null `inspectedView` argument — it calls getNodeFromPublicInstance
// on it to get the fabric node, then runs nativeFabricUIManager.findNodeAtPoint.
// If inspectedView is null, no hit-test happens → empty hierarchy.
//
// The EyesProvider captures its root View ref and calls setRootViewInstance
// so inspectAtPoint can pass it to the inspector API.

let rootViewInstance: any = null;

export function setRootViewInstance(instance: any): void {
  rootViewInstance = instance;
}

export function getRootViewInstance(): any {
  return rootViewInstance;
}

// ─── Types ────────────────────────────────────────────────────────────

export interface VisibleElement {
  /** Native view tag — used by dispatchEvent/scroll/etc. Stable for the element's lifetime. */
  viewTag: number;
  /** Component name from hierarchy. */
  name: string;
  /** Full hierarchy path (array of names, root → this element). */
  hierarchy: string[];
  /** Screen layout. */
  frame: { x: number; y: number; width: number; height: number };
  /** Shallow props (testID, accessibilityLabel, etc.) — already filtered to serializable values. */
  props: Record<string, any>;
  /** Depth in the hierarchy (root = 0). */
  depth: number;
}

export interface InspectAtPointResult {
  element: VisibleElement | null;
  hierarchy: Array<{ name: string; viewTag: number }>;
  renderTimeMs: number;
}

// ─── inspectAtPoint ───────────────────────────────────────────────────

export async function inspectAtPoint(args: { x: number; y: number }): Promise<InspectAtPointResult> {
  const { x, y } = args;
  if (typeof x !== 'number' || typeof y !== 'number') {
    throw Object.assign(new Error('x and y are required (numbers)'), { code: 'BAD_ARGS' });
  }

  const t0 = Date.now();
  const renderers = getRenderers();

  // On Fabric, we must pass a non-null inspectedView (the root view instance)
  // so the renderer can resolve it to a fabric node and run the native
  // hit-test. Without this, getInspectorDataForViewAtPoint returns empty.
  const inspectedView = rootViewInstance;

  // Try each renderer — only one will have a view at this point.
  for (const renderer of renderers) {
    const inspector = renderer?.rendererConfig?.getInspectorDataForViewAtPoint;
    if (typeof inspector !== 'function') continue;

    try {
      const viewData = await new Promise<any>((resolve) => {
        try {
          inspector(inspectedView, x, y, (data: any) => {
            resolve(data);
          });
        } catch (e) {
          resolve(null);
        }
      });

      if (!viewData || !viewData.hierarchy || viewData.hierarchy.length === 0) continue;

      // Build the VisibleElement from viewData
      const hierarchyNames: string[] = [];
      const hierarchyWithTags: Array<{ name: string; viewTag: number }> = [];

      for (let i = 0; i < viewData.hierarchy.length; i++) {
        const item = viewData.hierarchy[i];
        const name = item?.name || `node_${i}`;
        hierarchyNames.push(name);
        // Get the viewTag for this hierarchy item via getInspectorData
        let viewTag = 0;
        try {
          const inspectorData = item.getInspectorData(findNodeHandle);
          // inspectorData.props sometimes has the viewTag, or we measure to get it
          if (inspectorData?.props) {
            // The native tag is sometimes on props or via the measure callback target
            viewTag = inspectorData.props.nativeTag || 0;
          }
        } catch {}
        hierarchyWithTags.push({ name, viewTag });
      }

      // The touched view is the last in the hierarchy
      const touchedViewTag = viewData.touchedViewTag || hierarchyWithTags[hierarchyWithTags.length - 1]?.viewTag || 0;
      const selectedIndex = viewData.selectedIndex ?? viewData.hierarchy.length - 1;

      // Update the hierarchy's last entry with the touchedViewTag
      if (hierarchyWithTags.length > 0) {
        hierarchyWithTags[hierarchyWithTags.length - 1].viewTag = touchedViewTag;
      }

      // Extract shallow props from viewData.props
      const props = sanitizeProps(viewData.props || {});

      // Extract a testID if present
      const testID = props.testID || extractTestIDFromHierarchy(viewData.hierarchy);

      const element: VisibleElement = {
        viewTag: touchedViewTag,
        name: hierarchyNames[hierarchyNames.length - 1] || 'Unknown',
        hierarchy: hierarchyNames,
        frame: {
          x: viewData.frame?.left ?? 0,
          y: viewData.frame?.top ?? 0,
          width: viewData.frame?.width ?? 0,
          height: viewData.frame?.height ?? 0,
        },
        props,
        depth: selectedIndex,
      };

      return {
        element,
        hierarchy: hierarchyWithTags,
        renderTimeMs: Date.now() - t0,
      };
    } catch (e) {
      // Try next renderer
      continue;
    }
  }

  return { element: null, hierarchy: [], renderTimeMs: Date.now() - t0 };
}

// ─── listVisibleElements ──────────────────────────────────────────────
//
// Two-strategy approach:
//   1. Fiber tree walk (finds ALL elements including off-screen ones in
//      ScrollViews — essential for finding buttons below the fold)
//   2. Grid scan via inspectAtPoint (gets accurate frames for on-screen
//      elements via the native inspector API)
//
// We merge both: the fiber walk finds elements the grid misses (below fold),
// the grid scan provides accurate layouts for visible elements.

export async function listVisibleElements(args: { step?: number } = {}): Promise<{
  elements: VisibleElement[];
  renderTimeMs: number;
  scanned: number;
}> {
  const t0 = Date.now();
  const step = args.step ?? 30;
  const screen = Dimensions.get('window');
  const seen = new Map<number, VisibleElement>(); // viewTag → element
  let scanned = 0;

  // Strategy 1: grid scan (accurate frames for on-screen elements)
  for (let y = step; y < screen.height; y += step) {
    for (let x = step; x < screen.width; x += step) {
      scanned++;
      try {
        const { element } = await inspectAtPoint({ x, y });
        if (element && element.viewTag && !seen.has(element.viewTag)) {
          seen.set(element.viewTag, element);
        }
      } catch {}
    }
  }

  // Strategy 2: fiber tree walk (finds off-screen elements)
  // This catches elements in ScrollViews that are below/above the fold.
  try {
    const fiberElements = walkFiberTreeForElements();
    for (const el of fiberElements) {
      if (el.viewTag && !seen.has(el.viewTag)) {
        seen.set(el.viewTag, el);
      }
    }
  } catch {}

  // Sort by y, then x (top-to-bottom, left-to-right)
  const elements = Array.from(seen.values()).sort((a, b) => {
    if (Math.abs(a.frame.y - b.frame.y) > 10) return a.frame.y - b.frame.y;
    return a.frame.x - b.frame.x;
  });

  return {
    elements,
    renderTimeMs: Date.now() - t0,
    scanned,
  };
}

// Walk the fiber tree directly to find ALL host components (including
// off-screen ones in ScrollViews). Uses getAllFiberRoots() which handles
// both Paper and Fabric + portals.
function walkFiberTreeForElements(): VisibleElement[] {
  const elements: VisibleElement[] = [];
  const rootFibers = getAllFiberRoots();

  for (const hostRoot of rootFibers) {
    walkFiberForElements(hostRoot, [], elements);
  }

  return elements;
}

function walkFiberForElements(
  fiber: any,
  hierarchy: string[],
  out: VisibleElement[],
): void {
  if (!fiber) return;

  const typeName = getTypeName(fiber);
  const newHierarchy = [...hierarchy, typeName];

  // HostComponent (tag === 5) — has a native stateNode with a viewTag
  if (fiber.tag === 5 && fiber.stateNode) {
    let viewTag =
      fiber.stateNode._nativeTag ||
      fiber.stateNode.__nativeTag ||
      fiber.stateNode.canonical?.nativeTag;
    if (viewTag === undefined && typeof fiber.stateNode.getViewTag === 'function') {
      try { viewTag = fiber.stateNode.getViewTag(); } catch {}
    }

    if (viewTag !== undefined && viewTag !== null) {
      const props = sanitizeProps(fiber.memoizedProps || {});
      const element: VisibleElement = {
        viewTag: viewTag as number,
        name: typeName,
        hierarchy: newHierarchy,
        frame: { x: 0, y: 0, width: 0, height: 0 }, // filled by grid scan if visible
        props,
        depth: newHierarchy.length - 1,
      };
      out.push(element);
    }
  }

  // Walk children
  let child = fiber.child;
  while (child) {
    walkFiberForElements(child, newHierarchy, out);
    child = child.sibling;
  }
}

// ─── dispatchEvent (by viewTag, not fid) ──────────────────────────────

export interface DispatchEventArgs {
  viewTag: number;
  event: 'press' | 'longPress' | 'changeText' | 'pressIn' | 'pressOut' | 'change' | 'focus' | 'blur';
  text?: string;
  durationMs?: number;
  /** Optional: x/y for the synthetic event (defaults to center of the view) */
  x?: number;
  y?: number;
}

export async function dispatchEvent(args: DispatchEventArgs): Promise<{ ok: boolean }> {
  const { viewTag, event, text, durationMs, x, y } = args;
  if (typeof viewTag !== 'number') throw Object.assign(new Error('viewTag is required (number)'), { code: 'BAD_ARGS' });

  // Resolve the viewTag to a host instance, then find its fiber
  const fiber = await findFiberByViewTag(viewTag);
  if (!fiber) {
    throw Object.assign(new Error(`viewTag ${viewTag} not found in fiber tree`), { code: 'VIEW_NOT_FOUND' });
  }

  // Find a pressable ancestor (for press/longPress events)
  const pressableFiber = event === 'press' || event === 'longPress' || event === 'pressIn' || event === 'pressOut'
    ? findPressableFiber(fiber)
    : fiber;
  if ((event === 'press' || event === 'longPress' || event === 'pressIn' || event === 'pressOut') && !pressableFiber) {
    throw Object.assign(
      new Error(`No pressable handler found for viewTag ${viewTag}`),
      { code: 'NOT_TAPPABLE' },
    );
  }

  // Find a TextInput ancestor (for changeText)
  const textInputFiber = event === 'changeText' || event === 'change'
    ? findTextInputFiber(fiber)
    : fiber;
  if ((event === 'changeText' || event === 'change') && !textInputFiber) {
    throw Object.assign(
      new Error(`No TextInput found at or above viewTag ${viewTag}`),
      { code: 'NOT_TEXT_INPUT' },
    );
  }

  const targetFiber = pressableFiber || textInputFiber || fiber;
  const props = targetFiber.memoizedProps || {};
  const syntheticEvent = makeSyntheticEvent(x, y);

  switch (event) {
    case 'press':
      if (typeof props.onPressIn === 'function') { try { props.onPressIn(syntheticEvent); } catch {} }
      if (typeof props.onPressOut === 'function') { try { props.onPressOut(syntheticEvent); } catch {} }
      if (typeof props.onPress === 'function') { try { props.onPress(syntheticEvent); } catch {} }
      break;
    case 'longPress':
      if (typeof props.onPressIn === 'function') { try { props.onPressIn(syntheticEvent); } catch {} }
      if (typeof props.onLongPress === 'function') {
        try { props.onLongPress(syntheticEvent); } catch {}
      } else if (typeof props.onPress === 'function') {
        try { props.onPress(syntheticEvent); } catch {}
      }
      if (typeof props.onPressOut === 'function') { try { props.onPressOut(syntheticEvent); } catch {} }
      break;
    case 'pressIn':
      if (typeof props.onPressIn === 'function') { try { props.onPressIn(syntheticEvent); } catch {} }
      break;
    case 'pressOut':
      if (typeof props.onPressOut === 'function') { try { props.onPressOut(syntheticEvent); } catch {} }
      break;
    case 'changeText':
      if (typeof props.onChangeText === 'function' && typeof text === 'string') {
        try { props.onChangeText(text); } catch {}
      }
      break;
    case 'change':
      if (typeof props.onChange === 'function' && typeof text === 'string') {
        try { props.onChange(makeChangeEvent(text)); } catch {}
      }
      break;
    case 'focus':
      if (typeof props.onFocus === 'function') { try { props.onFocus(syntheticEvent); } catch {} }
      break;
    case 'blur':
      if (typeof props.onBlur === 'function') { try { props.onBlur(syntheticEvent); } catch {} }
      break;
    default:
      throw Object.assign(new Error(`Unknown event: ${event}`), { code: 'BAD_ARGS' });
  }

  return { ok: true };
}

// ─── scroll / scrollToIndex (by viewTag) ──────────────────────────────

/**
 * Last-known scroll offsets per scrollable viewTag. Android Fabric exposes
 * NO 'scrollBy' native command — only absolute 'scrollTo' — so relative
 * scrolls (mode:'by') are computed as (tracked offset + delta) → absolute
 * scrollTo. Tracking is accurate as long as all scrolling goes through us;
 * manual finger scrolling can make tracked offsets stale (swipe gesture
 * synthesis is the fallback in that case).
 */
const scrollOffsetMap = new Map<number, { x: number; y: number }>();

// Composite (JS) scrollable names AND Fabric/Paper string-typed host names.
// Host fibers (tag 5) have `type` as a plain STRING (e.g. 'RCTScrollView'),
// which `type.name`/`displayName` checks silently miss.
const SCROLLABLE_NAMES = new Set([
  'ScrollView', 'FlatList', 'SectionList', 'VirtualizedList', 'FlashList',
  'RCTScrollView', 'AndroidScrollView', 'AndroidHorizontalScrollView',
]);

function findScrollableAncestorFiber(fiber: any): any | null {
  let current: any = fiber;
  let iterations = 0;
  while (current && iterations < 60) {
    if (SCROLLABLE_NAMES.has(getTypeName(current))) return current;
    current = current.return;
    iterations++;
  }
  return null;
}

/**
 * Resolve a scrollable fiber to (hostFiber, hostInstance, classInstance).
 *
 * The native scrollable host is a DESCENDANT of composite wrappers
 * (FlatList → VirtualizedList → ScrollView → RCTScrollView), so we walk
 * DOWN for the first tag-5 host fiber. (getHostInstanceForFiber walks UP
 * the parent chain, which returns an unrelated wrapper view for composites
 * — dispatching scrollTo on it silently fails.)
 *
 * classInstance: RN's JS ScrollView is a class component whose fiber
 * (tag 1) carries the instance with .scrollTo in stateNode. We walk UP from
 * the host fiber to find it — works on both Paper and Fabric (Animated
 * wrappers in between don't have .scrollTo, so they're skipped).
 */
function findScrollableHostInfo(scrollableFiber: any): {
  hostFiber: any;
  hostInstance: any;
  classInstance: any;
} {
  let hostFiber: any = null;
  if (scrollableFiber.tag === 5 && scrollableFiber.stateNode) {
    hostFiber = scrollableFiber;
  } else {
    // BFS down: first (shallowest) host fiber = the native scrollable itself
    const queue: any[] = [scrollableFiber.child];
    let guard = 0;
    while (queue.length && guard < 300) {
      guard++;
      const node = queue.shift();
      if (!node) continue;
      if (node.tag === 5 && node.stateNode) { hostFiber = node; break; }
      queue.push(node.child, node.sibling);
    }
  }

  let classInstance: any = null;
  if (scrollableFiber.tag === 1 && typeof scrollableFiber.stateNode?.scrollTo === 'function') {
    classInstance = scrollableFiber.stateNode;
  }
  if (!classInstance) {
    let cur: any = (hostFiber ?? scrollableFiber).return;
    let hops = 0;
    while (cur && hops < 25) {
      if (cur.tag === 1 && cur.stateNode && typeof cur.stateNode.scrollTo === 'function') {
        classInstance = cur.stateNode;
        break;
      }
      cur = cur.return;
      hops++;
    }
  }

  return { hostFiber, hostInstance: hostFiber?.stateNode ?? null, classInstance };
}

function clampOffset(v: number): number {
  return Number.isFinite(v) ? Math.max(0, v) : 0;
}

export async function scroll(args: {
  viewTag: number;
  /** Absolute target X (mode 'to', default) */
  x?: number;
  /** Absolute target Y (mode 'to', default) */
  y?: number;
  /** Delta X (mode 'by') */
  dx?: number;
  /** Delta Y (mode 'by') */
  dy?: number;
  /** 'to' = absolute (default), 'by' = relative to last tracked offset */
  mode?: 'to' | 'by';
  animated?: boolean;
}): Promise<{ ok: boolean; scrolledTo: { x: number; y: number } }> {
  const { viewTag, animated = true } = args;
  if (typeof viewTag !== 'number') throw Object.assign(new Error('viewTag is required'), { code: 'BAD_ARGS' });

  const fiber = await findFiberByViewTag(viewTag);
  if (!fiber) {
    throw Object.assign(new Error(`viewTag ${viewTag} not found`), { code: 'VIEW_NOT_FOUND' });
  }

  const scrollableFiber = findScrollableAncestorFiber(fiber);
  if (!scrollableFiber) {
    throw Object.assign(new Error(`No scrollable ancestor for viewTag ${viewTag}`), { code: 'NOT_SCROLLABLE' });
  }

  // Compute ABSOLUTE target offset (relative scrolls rely on tracked offsets)
  const last = scrollOffsetMap.get(viewTag) ?? { x: 0, y: 0 };
  let targetX: number;
  let targetY: number;
  if (args.mode === 'by' || args.dx !== undefined || args.dy !== undefined) {
    targetX = clampOffset(last.x + (args.dx ?? 0));
    targetY = clampOffset(last.y + (args.dy ?? 0));
  } else {
    targetX = clampOffset(args.x ?? 0);
    targetY = clampOffset(args.y ?? 0);
  }

  const { hostInstance, classInstance } = findScrollableHostInfo(scrollableFiber);
  if (!hostInstance) {
    throw Object.assign(new Error(`No host instance for scrollable`), { code: 'NO_HOST' });
  }

  const record = () => scrollOffsetMap.set(viewTag, { x: targetX, y: targetY });

  // 1) RN's real ScrollView class instance — works on Paper AND Fabric
  if (classInstance && typeof classInstance.scrollTo === 'function') {
    try {
      classInstance.scrollTo({ x: targetX, y: targetY, animated });
      record();
      return { ok: true, scrolledTo: { x: targetX, y: targetY } };
    } catch {}
  }

  // 2) Legacy scroll responder (Paper)
  if (typeof hostInstance.getScrollResponder === 'function') {
    try {
      const responder = hostInstance.getScrollResponder();
      if (responder && typeof responder.scrollTo === 'function') {
        responder.scrollTo({ x: targetX, y: targetY, animated });
        record();
        return { ok: true, scrolledTo: { x: targetX, y: targetY } };
      }
    } catch {}
  }

  // 3) Fabric: RN's public dispatchCommand API
  try {
    const rn: any = require('react-native');
    if (typeof rn.dispatchCommand === 'function') {
      rn.dispatchCommand(hostInstance, 'scrollTo', [targetX, targetY, animated]);
      record();
      return { ok: true, scrolledTo: { x: targetX, y: targetY } };
    }
  } catch {}

  // 4) Legacy UIManager dispatch (Paper fallback)
  try {
    const nativeTag = (hostInstance as any)._nativeTag ||
                      (hostInstance as any).__nativeTag ||
                      (hostInstance as any).canonical?.nativeTag;
    if (nativeTag !== undefined && typeof (UIManager as any).dispatchViewManagerCommand === 'function') {
      (UIManager as any).dispatchViewManagerCommand(nativeTag, 'scrollTo', [targetX, targetY, animated]);
      record();
      return { ok: true, scrolledTo: { x: targetX, y: targetY } };
    }
  } catch (e: any) {
    // last resort failed
  }

  throw Object.assign(new Error(`Scrollable doesn't expose scrollTo`), { code: 'SCROLL_FAILED' });
}

export async function scrollToIndex(args: {
  viewTag: number;
  index: number;
  viewOffset?: number;
  animated?: boolean;
}): Promise<{ ok: boolean }> {
  const { viewTag, index, viewOffset = 0, animated = false } = args;
  if (typeof viewTag !== 'number') throw Object.assign(new Error('viewTag is required'), { code: 'BAD_ARGS' });

  const fiber = await findFiberByViewTag(viewTag);
  if (!fiber) {
    throw Object.assign(new Error(`viewTag ${viewTag} not found`), { code: 'VIEW_NOT_FOUND' });
  }

  const hostInstance = getHostInstanceForFiber(fiber);
  if (!hostInstance) {
    throw Object.assign(new Error(`No host instance for viewTag ${viewTag}`), { code: 'NO_HOST' });
  }

  if (typeof hostInstance.scrollToIndex === 'function') {
    try {
      hostInstance.scrollToIndex({ index, animated, viewOffset, viewPosition: 0 });
      return { ok: true };
    } catch {}
  }
  if (typeof hostInstance.scrollToOffset === 'function') {
    try {
      hostInstance.scrollToOffset({ offset: index * 80, animated });
      return { ok: true };
    } catch {}
  }
  if (typeof hostInstance.scrollTo === 'function') {
    try {
      hostInstance.scrollTo({ y: index * 80, animated });
      return { ok: true };
    } catch {}
  }

  throw Object.assign(new Error(`List doesn't expose scrollToIndex/scrollToOffset/scrollTo`), { code: 'SCROLL_FAILED' });
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Find the fiber for a given native viewTag.
 * Walks all fiber roots, looking for host components whose stateNode has the matching nativeTag.
 */
async function findFiberByViewTag(viewTag: number): Promise<any | null> {
  // getAllFiberRoots() handles both Paper and Fabric — it walks
  // hook.getFiberRoots(rendererID) for all renderers AND scans for
  // HostPortal fibers (tag=4) to find portal roots.
  const rootFibers = getAllFiberRoots();
  for (const hostRoot of rootFibers) {
    const found = findFiberByViewTagInTree(hostRoot, viewTag);
    if (found) return found;
  }
  return null;
}

function findFiberByViewTagInTree(fiber: any, viewTag: number): any | null {
  if (!fiber) return null;

  // Check if this fiber's host instance has the matching viewTag
  if (fiber.tag === 5 && fiber.stateNode) { // HostComponent
    // Paper (old arch): stateNode._nativeTag
    // Fabric (new arch): stateNode.canonical.nativeTag
    //   OR stateNode.__nativeTag (older Fabric)
    //   OR stateNode.getViewTag() (some versions)
    let nativeTag =
      fiber.stateNode._nativeTag ||
      fiber.stateNode.__nativeTag ||
      fiber.stateNode.canonical?.nativeTag;
    if (nativeTag === undefined && typeof fiber.stateNode.getViewTag === 'function') {
      try { nativeTag = fiber.stateNode.getViewTag(); } catch {}
    }
    if (nativeTag === viewTag) return fiber;
  }

  // Walk children
  let child = fiber.child;
  while (child) {
    const found = findFiberByViewTagInTree(child, viewTag);
    if (found) return found;
    child = child.sibling;
  }

  return null;
}

function getHostInstanceForFiber(fiber: any): any | null {
  if (!fiber) return null;
  let current: any = fiber;
  while (current) {
    if (current.tag === 5 && current.stateNode) {
      return current.stateNode;
    }
    current = current.return;
  }
  return null;
}

function findPressableFiber(fiber: any): any | null {
  let current: any = fiber;
  let iterations = 0;
  while (current && iterations < 30) {
    const props = current.memoizedProps;
    if (props && typeof props === 'object') {
      if (typeof props.onPress === 'function' ||
          typeof props.onPressIn === 'function' ||
          typeof props.onPressOut === 'function' ||
          typeof props.onLongPress === 'function') {
        return current;
      }
    }
    current = current.return;
    iterations++;
  }
  return null;
}

function findTextInputFiber(fiber: any): any | null {
  let current: any = fiber;
  let iterations = 0;
  while (current && iterations < 30) {
    const typeName = current?.elementType?.displayName || current?.type?.displayName || current?.type?.name;
    if (typeName === 'TextInput' || typeName === 'RCTTextInput' || typeName === 'AndroidTextInput') {
      return current;
    }
    current = current.return;
    iterations++;
  }
  return null;
}

function makeSyntheticEvent(x?: number, y?: number): any {
  const locationX = x ?? 0;
  const locationY = y ?? 0;
  return {
    nativeEvent: {
      locationX, locationY, pageX: locationX, pageY: locationY,
      timestamp: Date.now(), identifier: 1, target: 0,
    },
    currentTarget: null, target: null,
    bubbles: false, cancelable: false, defaultPrevented: false,
    eventPhase: 0, isTrusted: false,
    isDefaultPrevented: () => false, isPropagationStopped: () => false,
    persist: () => {}, preventDefault: () => {}, stopPropagation: () => {},
    timeStamp: Date.now(), type: 'press',
  };
}

function makeChangeEvent(text: string): any {
  return {
    nativeEvent: { text, target: 0, eventCount: 0 },
    text, target: null, currentTarget: null,
    bubbles: false, cancelable: false, defaultPrevented: false,
    eventPhase: 0, isTrusted: false,
    isDefaultPrevented: () => false, isPropagationStopped: () => false,
    persist: () => {}, preventDefault: () => {}, stopPropagation: () => {},
    timeStamp: Date.now(), type: 'changeText',
  };
}

// Whitelisted props (shallow, no React elements)
const PROPS_WHITELIST = new Set([
  'testID', 'accessible', 'accessibilityRole', 'accessibilityLabel',
  'accessibilityHint', 'accessibilityState', 'disabled', 'checked', 'selected',
  'placeholder', 'value', 'title', 'text',
  'keyboardType', 'secureTextEntry', 'editable', 'maxLength', 'multiline',
  'numberOfLines', 'horizontal', 'numColumns',
]);

function sanitizeProps(props: any): Record<string, any> {
  if (!props || typeof props !== 'object') return {};
  const out: Record<string, any> = {};
  for (const key of Object.keys(props)) {
    if (!PROPS_WHITELIST.has(key)) continue;
    const val = props[key];
    if (val === null || val === undefined) continue;
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      out[key] = val;
    } else if (typeof val === 'object' && !Array.isArray(val)) {
      // Shallow copy of plain objects (e.g. accessibilityState)
      try {
        out[key] = JSON.parse(JSON.stringify(val));
      } catch {
        // skip non-serializable
      }
    }
  }
  // Extract text content: RN Text components store their text in props.children
  // (string, number, or array of strings). TextInput stores it in props.value
  // or props.text. Surface both as `text` for the agent.
  if (out.text === undefined && out.value === undefined) {
    const children = props.children;
    if (typeof children === 'string' && children.length > 0) {
      out.text = children;
    } else if (typeof children === 'number') {
      out.text = String(children);
    } else if (Array.isArray(children)) {
      // Join string/number children (skip React elements / functions)
      const parts = children
        .filter((c) => typeof c === 'string' || typeof c === 'number')
        .map((c) => String(c));
      if (parts.length > 0) out.text = parts.join('');
    }
  }
  return out;
}

function extractTestIDFromHierarchy(hierarchy: any[]): string | undefined {
  for (let i = hierarchy.length - 1; i >= 0; i--) {
    const item = hierarchy[i];
    try {
      const inspectorData = item.getInspectorData(findNodeHandle);
      if (inspectorData?.props?.testID) {
        return inspectorData.props.testID;
      }
    } catch {}
  }
  return undefined;
}

// ─── diagnostics ──────────────────────────────────────────────────────
//
// Returns info about what the phone SDK actually sees — used to debug
// why inspectAtPoint returns nothing.

export async function diagnostics(): Promise<any> {
  const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook) {
    return { error: '__REACT_DEVTOOLS_GLOBAL_HOOK__ not found' };
  }

  const renderers = getRenderers();
  const rendererInfo = renderers.map((r: any, i: number) => ({
    index: i,
    hasRendererConfig: !!r?.rendererConfig,
    hasGetInspectorDataForViewAtPoint: typeof r?.rendererConfig?.getInspectorDataForViewAtPoint === 'function',
    rendererConfigKeys: r?.rendererConfig ? Object.keys(r.rendererConfig) : [],
    rendererType: typeof r,
  }));

  // Try one inspectAtPoint call at screen center
  const screen = Dimensions.get('window');
  const centerX = Math.floor(screen.width / 2);
  const centerY = Math.floor(screen.height / 2);

  let centerProbe: any = null;
  try {
    const result = await inspectAtPoint({ x: centerX, y: centerY });
    centerProbe = {
      x: centerX,
      y: centerY,
      foundElement: !!result.element,
      hierarchyLength: result.hierarchy.length,
      firstHierarchyItem: result.hierarchy[0] || null,
    };
  } catch (e: any) {
    centerProbe = { error: e.message };
  }

  return {
    hookExists: true,
    renderersCount: renderers.length,
    renderers: rendererInfo,
    rootViewInstanceSet: rootViewInstance !== null,
    rootViewInstanceType: rootViewInstance ? typeof rootViewInstance : 'null',
    screen: { width: screen.width, height: screen.height },
    centerProbe,
    platform: Platform.OS,
    reactNativeVersion: Platform.constants?.reactNativeVersion || 'unknown',
  };
}

// ─── swipe (synthetic gesture: pressIn → move → pressOut) ────────────
//
// Fires the Pressability touch sequence that simulates a swipe/drag.
// RN's Pressability (Pressable, ScrollView, FlatList) listens to
// onResponderGrant → onResponderMove → onResponderRelease. We synthesize
// these via the fiber's memoizedProps handlers.

export interface SwipeArgs {
  /** Starting viewTag (swipe begins at center of this view) */
  viewTag: number;
  /** Relative offset from the start point. e.g. {dx: 0, dy: -200} = swipe up */
  dx: number;
  dy: number;
  /** Total duration of the swipe in ms (default 250) */
  durationMs?: number;
  /** Number of move steps (default 10 — more = smoother) */
  steps?: number;
}

export async function swipe(args: SwipeArgs): Promise<{ ok: boolean }> {
  const { viewTag, dx, dy, durationMs = 250, steps = 10 } = args;
  if (typeof viewTag !== 'number') throw Object.assign(new Error('viewTag is required'), { code: 'BAD_ARGS' });

  const fiber = await findFiberByViewTag(viewTag);
  if (!fiber) throw Object.assign(new Error(`viewTag ${viewTag} not found`), { code: 'VIEW_NOT_FOUND' });

  // Find the scrollable/pressable ancestor that handles touch
  const responderFiber = findScrollableOrPressableFiber(fiber);
  if (!responderFiber) {
    throw Object.assign(new Error(`No scrollable/pressable ancestor for viewTag ${viewTag}`), { code: 'NOT_SCROLLABLE' });
  }

  // Read the view's frame to compute the start point (center of the view)
  const hostInstance = getHostInstanceForFiber(responderFiber);
  let startX = 0, startY = 0;
  if (hostInstance && typeof hostInstance.measureInWindow === 'function') {
    await new Promise<void>((resolve) => {
      try {
        hostInstance.measureInWindow((x: number, y: number, w: number, h: number) => {
          startX = x + w / 2;
          startY = y + h / 2;
          resolve();
        });
        setTimeout(resolve, 200);
      } catch { resolve(); }
    });
  }

  const props = responderFiber.memoizedProps || {};

  // Synthetic touch events
  const makeTouchEvent = (x: number, y: number, phase: 'began' | 'moved' | 'ended') => ({
    nativeEvent: {
      touches: [{ locationX: x, locationY: y, pageX: x, pageY: y, identifier: 1, timestamp: Date.now() }],
      changedTouches: [{ locationX: x, locationY: y, pageX: x, pageY: y, identifier: 1, timestamp: Date.now() }],
      locationX: x, locationY: y, pageX: x, pageY: y,
      timestamp: Date.now(), identifier: 1, target: viewTag,
    },
    currentTarget: null, target: null,
    bubbles: false, cancelable: false, defaultPrevented: false,
    eventPhase: 0, isTrusted: false,
    isDefaultPrevented: () => false, isPropagationStopped: () => false,
    persist: () => {}, preventDefault: () => {}, stopPropagation: () => {},
    timeStamp: Date.now(), type: 'touch' + phase,
  });

  // Fire pressIn
  if (typeof props.onTouchStart === 'function') { try { props.onTouchStart(makeTouchEvent(startX, startY, 'began')); } catch {} }
  if (typeof props.onResponderGrant === 'function') { try { props.onResponderGrant(makeTouchEvent(startX, startY, 'began')); } catch {} }
  if (typeof props.onPressIn === 'function') { try { props.onPressIn(makeTouchEvent(startX, startY, 'began')); } catch {} }

  // Fire move steps
  const stepMs = durationMs / steps;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = startX + dx * t;
    const y = startY + dy * t;
    if (typeof props.onTouchMove === 'function') { try { props.onTouchMove(makeTouchEvent(x, y, 'moved')); } catch {} }
    if (typeof props.onResponderMove === 'function') { try { props.onResponderMove(makeTouchEvent(x, y, 'moved')); } catch {} }
    // Use setTimeout via await to space out the moves
    await new Promise((r) => setTimeout(r, stepMs));
  }

  // Fire pressOut
  const endX = startX + dx;
  const endY = startY + dy;
  if (typeof props.onTouchEnd === 'function') { try { props.onTouchEnd(makeTouchEvent(endX, endY, 'ended')); } catch {} }
  if (typeof props.onResponderRelease === 'function') { try { props.onResponderRelease(makeTouchEvent(endX, endY, 'ended')); } catch {} }
  if (typeof props.onPressOut === 'function') { try { props.onPressOut(makeTouchEvent(endX, endY, 'ended')); } catch {} }

  return { ok: true };
}

function findScrollableOrPressableFiber(fiber: any): any | null {
  const SCROLLABLE_TYPES = new Set([
    'ScrollView', 'FlatList', 'SectionList', 'VirtualizedList', 'FlashList',
    'RCTScrollView', 'KeyboardAvoidingView',
  ]);
  let current: any = fiber;
  let iterations = 0;
  while (current && iterations < 40) {
    const typeName = current?.elementType?.displayName || current?.type?.displayName || current?.type?.name;
    if (typeName && SCROLLABLE_TYPES.has(typeName)) return current;
    const props = current.memoizedProps;
    if (props && typeof props === 'object') {
      // If it has any touch responder handlers, use it
      if (typeof props.onResponderGrant === 'function' ||
          typeof props.onTouchStart === 'function' ||
          typeof props.onPressIn === 'function') {
        return current;
      }
    }
    current = current.return;
    iterations++;
  }
  return null;
}

// ─── screenshot (capture the screen as base64 PNG) ───────────────────
//
// Uses the native captureView API. On Paper: UIManager.captureViewSnapshot.
// On Fabric: takeSnapshot via the renderer. Falls back to a tree-based
// "virtual screenshot" (just the inspect tree) if native capture fails.

export async function screenshot(args: { viewTag?: number } = {}): Promise<{
  ok: boolean;
  dataUrl?: string;
  format: string;
  width: number;
  height: number;
  fallback?: string;
}> {
  const screen = Dimensions.get('window');
  const targetViewTag = args.viewTag;

  // Try native capture (Android/iOS)
  try {
    const capture = (UIManager as any)?.captureViewSnapshot;
    if (typeof capture === 'function') {
      const tag = targetViewTag ?? (rootViewInstance ? (findNodeHandle(rootViewInstance) as number) : null);
      if (tag) {
        const result = await new Promise<any>((resolve) => {
          try {
            capture(tag, (data: any) => resolve(data));
          } catch (e: any) {
            resolve({ error: e.message });
          }
        });
        if (result && !result.error) {
          return {
            ok: true,
            dataUrl: result.dataURL || result.uri,
            format: 'png',
            width: result.width || screen.width,
            height: result.height || screen.height,
          };
        }
      }
    }
  } catch {}

  // Fallback: virtual screenshot (the inspect tree, serialized)
  try {
    const { elements } = await listVisibleElements({ step: 40 });
    return {
      ok: true,
      format: 'tree',
      width: screen.width,
      height: screen.height,
      fallback: JSON.stringify(elements.map((e: any) => ({
        name: e.name,
        testID: e.props?.testID,
        text: e.props?.text,
        frame: e.frame,
      }))),
    };
  } catch (e: any) {
    return { ok: false, format: 'error', width: 0, height: 0, fallback: e.message };
  }
}

// ─── waitForElement (poll inspect until an element matching testID appears) ──

export async function waitForElement(args: {
  testID?: string;
  text?: string;
  /** Max time to wait in ms (default 5000) */
  timeoutMs?: number;
  /** Poll interval in ms (default 300) */
  intervalMs?: number;
}): Promise<{ ok: boolean; found: boolean; element?: any; waitedMs: number }> {
  const { testID, text, timeoutMs = 5000, intervalMs = 300 } = args;
  if (!testID && !text) throw Object.assign(new Error('testID or text is required'), { code: 'BAD_ARGS' });

  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const { elements } = await listVisibleElements({ step: 40 });
      const found = elements.find((e: any) => {
        if (testID && e.props?.testID === testID) return true;
        if (text && typeof e.props?.text === 'string' && e.props.text.includes(text)) return true;
        return false;
      });
      if (found) {
        return { ok: true, found: true, element: found, waitedMs: Date.now() - t0 };
      }
    } catch {}
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { ok: true, found: false, waitedMs: Date.now() - t0 };
}

// ─── readScreen (extract all visible text as a flat list) ────────────

export async function readScreen(): Promise<{
  texts: Array<{ text: string; testID?: string; frame?: any }>;
  count: number;
}> {
  const { elements } = await listVisibleElements({ step: 30 });
  const texts: Array<{ text: string; testID?: string; frame?: any }> = [];
  for (const e of elements) {
    const text = e.props?.text || e.props?.value || e.props?.title;
    if (typeof text === 'string' && text.length > 0) {
      texts.push({ text, testID: e.props?.testID, frame: e.frame });
    }
  }
  return { texts, count: texts.length };
}

// ─── layout (precise measurement + overflow detection) ───────────────
//
// Returns the precise frame of an element (via measureInWindow) AND
// analyzes it for overflow:
//   - viewport overflow: element extends beyond the screen
//   - text truncation: text is clipped (numberOfLines exceeded)
//   - zero-size: element has width=0 or height=0 (not rendered / hidden)
//   - off-screen: element is scrolled out of view (y > screen height)
//
// This is the "is it broken?" check — verify intended vs actual layout.

export interface LayoutResult {
  testID?: string;
  type: string;
  frame: { x: number; y: number; width: number; height: number };
  screen: { width: number; height: number };
  issues: string[];
  // Overflow details
  overflowsRight?: number;  // px beyond right edge
  overflowsBottom?: number; // px beyond bottom edge
  overflowsLeft?: number;   // px beyond left edge (negative x)
  overflowsTop?: number;    // px beyond top edge (negative y)
  // Text info (if it's a Text element)
  text?: string;
  textTruncated?: boolean;
  numberOfLines?: number;
}

export async function layout(args: { ref?: string; testID?: string }): Promise<{
  element: LayoutResult | null;
  allIssues: LayoutResult[];
  totalElements: number;
  elementsWithIssues: number;
}> {
  const screen = Dimensions.get('window');
  const { elements } = await listVisibleElements({ step: 25 });

  // Find the target element (by testID or name)
  let target: VisibleElement | null = null;
  if (args.testID) {
    target = elements.find((e) => e.props?.testID === args.testID) || null;
  } else if (args.ref) {
    // ref can be "tid:xxx" or "r5" (positional)
    if (args.ref.startsWith('tid:')) {
      const tid = args.ref.slice(4);
      target = elements.find((e) => e.props?.testID === tid) || null;
    } else if (args.ref.startsWith('r') && /^r\d+$/.test(args.ref)) {
      const idx = parseInt(args.ref.slice(1), 10);
      target = elements[idx] || null;
    } else {
      const lower = args.ref.toLowerCase();
      target = elements.find((e) => e.name?.toLowerCase().includes(lower)) || null;
    }
  }

  // Analyze ALL elements for issues (the "layout audit")
  const allIssues: LayoutResult[] = [];
  for (const e of elements) {
    const issues: string[] = [];
    const f = e.frame;
    let overflowsRight: number | undefined;
    let overflowsBottom: number | undefined;
    let overflowsLeft: number | undefined;
    let overflowsTop: number | undefined;

    // Zero-size check
    if (f.width === 0 || f.height === 0) {
      issues.push('zero-size');
    }

    // Viewport overflow checks
    if (f.x < 0) {
      overflowsLeft = Math.abs(f.x);
      issues.push(`overflows-left:${Math.abs(f.x)}px`);
    }
    if (f.y < 0) {
      overflowsTop = Math.abs(f.y);
      issues.push(`overflows-top:${Math.abs(f.y)}px`);
    }
    if (f.x + f.width > screen.width) {
      overflowsRight = (f.x + f.width) - screen.width;
      issues.push(`overflows-right:${overflowsRight}px`);
    }
    if (f.y + f.height > screen.height) {
      overflowsBottom = (f.y + f.height) - screen.height;
      issues.push(`overflows-bottom:${overflowsBottom}px`);
    }

    // Off-screen (entirely below viewport)
    if (f.y > screen.height) {
      issues.push('off-screen-below');
    }
    if (f.y + f.height < 0) {
      issues.push('off-screen-above');
    }

    // Text truncation heuristic: if it's a Text/TextInput with text
    // and numberOfLines is set, the text might be truncated.
    const text = e.props?.text || e.props?.value;
    const numberOfLines = e.props?.numberOfLines;
    let textTruncated: boolean | undefined;
    if (text && typeof text === 'string' && text.length > 0) {
      // Can't definitively detect truncation without measuring text layout,
      // but if numberOfLines is set and the text is long, flag it
      if (numberOfLines && text.length > numberOfLines * 40) {
        textTruncated = true;
        issues.push('text-possibly-truncated');
      }
    }

    if (issues.length > 0) {
      allIssues.push({
        testID: e.props?.testID,
        type: e.name,
        frame: f,
        screen: { width: screen.width, height: screen.height },
        issues,
        overflowsRight,
        overflowsBottom,
        overflowsLeft,
        overflowsTop,
        text: text || undefined,
        textTruncated,
        numberOfLines,
      });
    }
  }

  // Build the target element's result
  let elementResult: LayoutResult | null = null;
  if (target) {
    const f = target.frame;
    const issues: string[] = [];
    if (f.width === 0 || f.height === 0) issues.push('zero-size');
    if (f.x < 0) issues.push(`overflows-left:${Math.abs(f.x)}px`);
    if (f.y < 0) issues.push(`overflows-top:${Math.abs(f.y)}px`);
    if (f.x + f.width > screen.width) issues.push(`overflows-right:${(f.x + f.width) - screen.width}px`);
    if (f.y + f.height > screen.height) issues.push(`overflows-bottom:${(f.y + f.height) - screen.height}px`);

    elementResult = {
      testID: target.props?.testID,
      type: target.name,
      frame: f,
      screen: { width: screen.width, height: screen.height },
      issues,
      text: target.props?.text || target.props?.value,
    };
  }

  return {
    element: elementResult,
    allIssues,
    totalElements: elements.length,
    elementsWithIssues: allIssues.length,
  };
}

// ─── navigate (deep link navigation via expo-router) ──────────────────
//
// Uses expo-router's navigation API to push a route. On Expo Go, this
// works via the router's imperative API (router.push/replace).

export async function navigate(args: {
  route: string;
  params?: Record<string, any>;
}): Promise<{ ok: boolean }> {
  const { route, params } = args;
  if (!route) throw Object.assign(new Error('route is required'), { code: 'BAD_ARGS' });

  // Try expo-router's imperative API
  try {
    const { router } = require('expo-router');
    if (params) {
      router.push({ pathname: route, params });
    } else {
      router.push(route);
    }
    return { ok: true };
  } catch (e: any) {
    throw Object.assign(new Error(`Navigation failed: ${e.message}`), { code: 'NAV_FAILED' });
  }
}

// ─── back (go back in navigation stack) ──────────────────────────────

export async function back(): Promise<{ ok: boolean }> {
  try {
    const { router } = require('expo-router');
    router.back();
    return { ok: true };
  } catch (e: any) {
    throw Object.assign(new Error(`Back failed: ${e.message}`), { code: 'NAV_FAILED' });
  }
}

// ─── assert (verification primitives) ────────────────────────────────
//
// Throws if the assertion fails. Returns { ok: true, details } if it passes.

export interface AssertResult {
  ok: boolean;
  passed: boolean;
  message: string;
  details?: any;
}

export async function assertVisible(args: { testID?: string; text?: string; timeoutMs?: number }): Promise<AssertResult> {
  const { testID, text, timeoutMs = 3000 } = args;
  if (!testID && !text) throw Object.assign(new Error('testID or text required'), { code: 'BAD_ARGS' });

  const result = await waitForElement({ testID, text, timeoutMs });
  if (result.found) {
    return {
      ok: true,
      passed: true,
      message: `Element ${testID ? `testID="${testID}"` : `text~="${text}"`} is visible`,
      details: result.element,
    };
  }
  return {
    ok: false,
    passed: false,
    message: `Element ${testID ? `testID="${testID}"` : `text~="${text}"`} NOT found within ${timeoutMs}ms`,
  };
}

export async function assertText(args: { testID: string; text: string; timeoutMs?: number }): Promise<AssertResult> {
  const { testID, text, timeoutMs = 3000 } = args;

  // Wait for the element, then check its text
  const result = await waitForElement({ testID, timeoutMs });
  if (!result.found) {
    return { ok: false, passed: false, message: `testID="${testID}" NOT found within ${timeoutMs}ms` };
  }
  const actualText = result.element?.props?.text || result.element?.props?.value || '';
  if (actualText === text) {
    return { ok: true, passed: true, message: `testID="${testID}" text matches: "${text}"` };
  }
  return {
    ok: false,
    passed: false,
    message: `testID="${testID}" text mismatch: expected "${text}", got "${actualText}"`,
    details: { expected: text, actual: actualText },
  };
}

export async function assertEnabled(args: { testID: string; timeoutMs?: number }): Promise<AssertResult> {
  const { testID, timeoutMs = 3000 } = args;

  const result = await waitForElement({ testID, timeoutMs });
  if (!result.found) {
    return { ok: false, passed: false, message: `testID="${testID}" NOT found within ${timeoutMs}ms` };
  }
  const disabled = result.element?.props?.disabled === true;
  if (!disabled) {
    return { ok: true, passed: true, message: `testID="${testID}" is enabled` };
  }
  return { ok: false, passed: false, message: `testID="${testID}" is disabled` };
}

// ─── pinch/zoom (multi-touch synthesis) ──────────────────────────────
//
// Synthesizes a pinch gesture by firing two parallel touch sequences
// moving toward (pinch in/zoom out) or away from (pinch out/zoom in)
// the center of a view.

export interface PinchArgs {
  viewTag: number;
  /** 'in' = zoom out (fingers move together), 'out' = zoom in (fingers move apart) */
  direction: 'in' | 'out';
  /** Scale factor (e.g. 2.0 = zoom in 2x). Used to compute finger spread. */
  scale?: number;
  /** Duration in ms (default 300) */
  durationMs?: number;
  steps?: number;
}

export async function pinch(args: PinchArgs): Promise<{ ok: boolean }> {
  const { viewTag, direction, scale = 2.0, durationMs = 300, steps = 10 } = args;
  if (typeof viewTag !== 'number') throw Object.assign(new Error('viewTag is required'), { code: 'BAD_ARGS' });

  const fiber = await findFiberByViewTag(viewTag);
  if (!fiber) throw Object.assign(new Error(`viewTag ${viewTag} not found`), { code: 'VIEW_NOT_FOUND' });

  const responderFiber = findScrollableOrPressableFiber(fiber);
  if (!responderFiber) {
    throw Object.assign(new Error(`No scrollable/pressable ancestor for viewTag ${viewTag}`), { code: 'NOT_SCROLLABLE' });
  }

  // Get the view's center point
  const hostInstance = getHostInstanceForFiber(responderFiber);
  let cx = 0, cy = 0, viewWidth = 200, viewHeight = 200;
  if (hostInstance && typeof hostInstance.measureInWindow === 'function') {
    await new Promise<void>((resolve) => {
      try {
        hostInstance.measureInWindow((x: number, y: number, w: number, h: number) => {
          cx = x + w / 2; cy = y + h / 2;
          viewWidth = w; viewHeight = h;
          resolve();
        });
        setTimeout(resolve, 200);
      } catch { resolve(); }
    });
  }

  // Compute start and end positions for two fingers
  const spread = Math.min(viewWidth, viewHeight) / 2;
  const startSpread = direction === 'out' ? spread / scale : spread;
  const endSpread = direction === 'out' ? spread : spread * scale;

  const props = responderFiber.memoizedProps || {};

  const makeTouchEvent = (x: number, y: number, id: number) => ({
    nativeEvent: {
      touches: [
        { locationX: x, locationY: y, pageX: x, pageY: y, identifier: id, timestamp: Date.now() },
      ],
      changedTouches: [
        { locationX: x, locationY: y, pageX: x, pageY: y, identifier: id, timestamp: Date.now() },
      ],
      locationX: x, locationY: y, pageX: x, pageY: y,
      timestamp: Date.now(), identifier: id, target: viewTag,
    },
    currentTarget: null, target: null,
    bubbles: false, cancelable: false, defaultPrevented: false,
    eventPhase: 0, isTrusted: false,
    isDefaultPrevented: () => false, isPropagationStopped: () => false,
    persist: () => {}, preventDefault: () => {}, stopPropagation: () => {},
    timeStamp: Date.now(), type: 'touch' + id,
  });

  // Finger 1 starts at (cx - startSpread, cy), Finger 2 at (cx + startSpread, cy)
  const f1Start = { x: cx - startSpread, y: cy };
  const f2Start = { x: cx + startSpread, y: cy };
  const f1End = { x: cx - endSpread, y: cy };
  const f2End = { x: cx + endSpread, y: cy };

  // Begin
  if (typeof props.onTouchStart === 'function') { try { props.onTouchStart(makeTouchEvent(f1Start.x, f1Start.y, 1)); } catch {} }
  if (typeof props.onResponderGrant === 'function') { try { props.onResponderGrant(makeTouchEvent(f1Start.x, f1Start.y, 1)); } catch {} }

  const stepMs = durationMs / steps;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x1 = f1Start.x + (f1End.x - f1Start.x) * t;
    const x2 = f2Start.x + (f2End.x - f2Start.x) * t;
    if (typeof props.onTouchMove === 'function') { try { props.onTouchMove(makeTouchEvent(x1, cy, 1)); } catch {} }
    if (typeof props.onResponderMove === 'function') { try { props.onResponderMove(makeTouchEvent(x2, cy, 2)); } catch {} }
    await new Promise((r) => setTimeout(r, stepMs));
  }

  // End
  if (typeof props.onTouchEnd === 'function') { try { props.onTouchEnd(makeTouchEvent(f1End.x, cy, 1)); } catch {} }
  if (typeof props.onResponderRelease === 'function') { try { props.onResponderRelease(makeTouchEvent(f2End.x, cy, 2)); } catch {} }

  return { ok: true };
}



