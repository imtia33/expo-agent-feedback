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
// Scans the screen in a grid, calls inspectAtPoint at each point, dedupes
// by viewTag. Returns a flat list of all visible elements.
//
// Grid resolution: 20px steps. For a 390×844 screen that's ~820 calls.
// Takes ~2-4 seconds total. Could be optimized by walking the native view
// hierarchy directly via UIManager, but this approach uses the public API.

export async function listVisibleElements(args: { step?: number } = {}): Promise<{
  elements: VisibleElement[];
  renderTimeMs: number;
  scanned: number;
}> {
  const t0 = Date.now();
  const step = args.step ?? 30; // px between grid points
  const screen = Dimensions.get('window');
  const seen = new Map<number, VisibleElement>(); // viewTag → element
  let scanned = 0;

  // Scan in a grid
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

export async function scroll(args: {
  viewTag: number;
  x?: number;
  y?: number;
  animated?: boolean;
}): Promise<{ ok: boolean; scrolledTo: { x: number; y: number } }> {
  const { viewTag, x = 0, y = 0, animated = true } = args;
  if (typeof viewTag !== 'number') throw Object.assign(new Error('viewTag is required'), { code: 'BAD_ARGS' });

  const fiber = await findFiberByViewTag(viewTag);
  if (!fiber) {
    throw Object.assign(new Error(`viewTag ${viewTag} not found`), { code: 'VIEW_NOT_FOUND' });
  }

  const SCROLLABLE_TYPES = new Set(['ScrollView', 'FlatList', 'SectionList', 'VirtualizedList', 'FlashList', 'RCTScrollView']);
  let current: any = fiber;
  let scrollableFiber: any = null;
  while (current) {
    const typeName = current?.elementType?.displayName || current?.type?.displayName || current?.type?.name;
    if (typeName && SCROLLABLE_TYPES.has(typeName)) {
      scrollableFiber = current;
      break;
    }
    current = current.return;
  }
  if (!scrollableFiber) {
    throw Object.assign(new Error(`No scrollable ancestor for viewTag ${viewTag}`), { code: 'NOT_SCROLLABLE' });
  }

  const hostInstance = getHostInstanceForFiber(scrollableFiber);
  if (!hostInstance) {
    throw Object.assign(new Error(`No host instance for scrollable`), { code: 'NO_HOST' });
  }

  if (typeof hostInstance.scrollTo === 'function') {
    try {
      hostInstance.scrollTo({ x, y, animated });
      return { ok: true, scrolledTo: { x, y } };
    } catch (e: any) {
      throw Object.assign(new Error(`scrollTo failed: ${e.message}`), { code: 'SCROLL_FAILED' });
    }
  }

  if (typeof hostInstance.getScrollResponder === 'function') {
    try {
      const responder = hostInstance.getScrollResponder();
      if (responder && typeof responder.scrollTo === 'function') {
        responder.scrollTo({ x, y, animated });
        return { ok: true, scrolledTo: { x, y } };
      }
    } catch {}
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

