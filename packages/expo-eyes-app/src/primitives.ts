/**
 * The 3 app-side primitives. Everything else lives in the relay.
 *
 *   getTree()                       → raw fiber tree (no refs, no stableIds)
 *   dispatchEvent(fid, event, ...)  → fire onPress / onChangeText / etc.
 *   readLayout(fid)                 → x/y/width/height
 *
 * The relay uses these to implement inspect / snapshot / tap / type /
 * scrollTo / expandList / longPress. None of that logic is here.
 */

import { getRawTree, findFiberByFid, getHostInstanceForFiber } from './raw-tree';
import { getAllFiberRoots } from './devtools-hook';

// ─── getTree ──────────────────────────────────────────────────────────

export async function getTree(): Promise<{
  tree: any | null;
  nodeCount: number;
  renderTimeMs: number;
}> {
  const t0 = Date.now();
  const tree = await getRawTree();
  const elapsed = Date.now() - t0;
  const nodeCount = tree ? countNodes(tree) : 0;
  return { tree, nodeCount, renderTimeMs: elapsed };
}

function countNodes(node: any): number {
  if (!node) return 0;
  let count = 1;
  if (Array.isArray(node.children)) {
    for (const child of node.children) count += countNodes(child);
  }
  return count;
}

// ─── dispatchEvent ────────────────────────────────────────────────────

export interface DispatchEventArgs {
  /** Fiber ID from getTree(). */
  fid: number;
  /** Event to dispatch. */
  event: 'press' | 'longPress' | 'changeText' | 'pressIn' | 'pressOut' | 'change' | 'focus' | 'blur';
  /** For changeText: the new text value. */
  text?: string;
  /** For longPress: hold duration in ms. */
  durationMs?: number;
}

export async function dispatchEvent(args: DispatchEventArgs): Promise<{ ok: boolean }> {
  const { fid, event, text, durationMs } = args;
  if (typeof fid !== 'number') throw Object.assign(new Error('fid is required (number)'), { code: 'BAD_ARGS' });

  const fiber = findFiberByFid(fid);
  if (!fiber) {
    throw Object.assign(new Error(`fid ${fid} not found — call getTree() to refresh.`), { code: 'FID_NOT_FOUND' });
  }

  // Find a pressable ancestor (for press/longPress events)
  const pressableFiber = event === 'press' || event === 'longPress' || event === 'pressIn' || event === 'pressOut'
    ? findPressableFiber(fiber)
    : fiber;
  if ((event === 'press' || event === 'longPress' || event === 'pressIn' || event === 'pressOut') && !pressableFiber) {
    throw Object.assign(
      new Error(`No pressable handler found for fid ${fid} (walked up 30 ancestors).`),
      { code: 'NOT_TAPPABLE' },
    );
  }

  // Find a TextInput ancestor (for changeText)
  const textInputFiber = event === 'changeText' || event === 'change'
    ? findTextInputFiber(fiber)
    : fiber;
  if ((event === 'changeText' || event === 'change') && !textInputFiber) {
    throw Object.assign(
      new Error(`No TextInput found at or above fid ${fid}.`),
      { code: 'NOT_TEXT_INPUT' },
    );
  }

  const targetFiber = pressableFiber || textInputFiber || fiber;
  const props = targetFiber.memoizedProps || {};

  const syntheticEvent = makeSyntheticEvent();

  switch (event) {
    case 'press':
      if (typeof props.onPressIn === 'function') { try { props.onPressIn(syntheticEvent); } catch {} }
      if (typeof props.onPressOut === 'function') { try { props.onPressOut(syntheticEvent); } catch {} }
      if (typeof props.onPress === 'function') { try { props.onPress(syntheticEvent); } catch {} }
      break;
    case 'longPress':
      if (typeof props.onPressIn === 'function') { try { props.onPressIn(syntheticEvent); } catch {} }
      // The relay waits durationMs before calling us — we just fire onLongPress
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

function makeSyntheticEvent(): any {
  const nativeEvent = {
    locationX: 0, locationY: 0, pageX: 0, pageY: 0,
    timestamp: Date.now(), identifier: 1, target: 0,
  };
  return {
    nativeEvent,
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

// ─── readLayout ───────────────────────────────────────────────────────

export async function readLayout(args: { fid: number }): Promise<{
  layout: { x: number; y: number; width: number; height: number } | null;
}> {
  const { fid } = args;
  if (typeof fid !== 'number') throw Object.assign(new Error('fid is required'), { code: 'BAD_ARGS' });

  const fiber = findFiberByFid(fid);
  if (!fiber) {
    throw Object.assign(new Error(`fid ${fid} not found`), { code: 'FID_NOT_FOUND' });
  }

  const hostInstance = getHostInstanceForFiber(fiber);
  if (!hostInstance) {
    return { layout: null };
  }

  // Try measureInWindow (Fabric ReactNativeElement)
  if (typeof hostInstance.measureInWindow === 'function') {
    return new Promise((resolve) => {
      let resolved = false;
      const finish = (layout: any) => {
        if (!resolved) { resolved = true; resolve({ layout }); }
      };
      try {
        hostInstance.measureInWindow((x: number, y: number, width: number, height: number) => {
          if (typeof x === 'number') {
            finish({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
          } else {
            finish(null);
          }
        });
        setTimeout(() => finish(null), 200);
      } catch {
        finish(null);
      }
    });
  }

  // DOM-like fallback
  try {
    if (typeof hostInstance.offsetWidth === 'number') {
      return {
        layout: {
          x: hostInstance.offsetLeft ?? 0,
          y: hostInstance.offsetTop ?? 0,
          width: hostInstance.offsetWidth,
          height: hostInstance.offsetHeight,
        },
      };
    }
  } catch {}

  return { layout: null };
}

// ─── scroll (also a primitive — needs direct host access) ─────────────

export async function scroll(args: {
  fid: number;
  x?: number;
  y?: number;
  animated?: boolean;
}): Promise<{ ok: boolean; scrolledTo: { x: number; y: number } }> {
  const { fid, x = 0, y = 0, animated = true } = args;
  if (typeof fid !== 'number') throw Object.assign(new Error('fid is required'), { code: 'BAD_ARGS' });

  const fiber = findFiberByFid(fid);
  if (!fiber) {
    throw Object.assign(new Error(`fid ${fid} not found`), { code: 'FID_NOT_FOUND' });
  }

  // Walk up to find the scrollable
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
    throw Object.assign(new Error(`No scrollable ancestor found for fid ${fid}`), { code: 'NOT_SCROLLABLE' });
  }

  const hostInstance = getHostInstanceForFiber(scrollableFiber);
  if (!hostInstance) {
    throw Object.assign(new Error(`No host instance for scrollable`), { code: 'NO_HOST' });
  }

  if (typeof hostInstance.scrollTo === 'function') {
    try {
      hostInstance.scrollTo({ x, y, animated });
      return { ok: true, scrolledTo: { x, y } };
    } catch (e) {
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

// ─── scrollToListIndex (for expandList) ───────────────────────────────

export async function scrollToIndex(args: {
  fid: number;
  index: number;
  viewOffset?: number;
  animated?: boolean;
}): Promise<{ ok: boolean }> {
  const { fid, index, viewOffset = 0, animated = false } = args;
  if (typeof fid !== 'number') throw Object.assign(new Error('fid is required'), { code: 'BAD_ARGS' });

  const fiber = findFiberByFid(fid);
  if (!fiber) {
    throw Object.assign(new Error(`fid ${fid} not found`), { code: 'FID_NOT_FOUND' });
  }

  const hostInstance = getHostInstanceForFiber(fiber);
  if (!hostInstance) {
    throw Object.assign(new Error(`No host instance for fid ${fid}`), { code: 'NO_HOST' });
  }

  if (typeof hostInstance.scrollToIndex === 'function') {
    try {
      hostInstance.scrollToIndex({ index, animated, viewOffset, viewPosition: 0 });
      return { ok: true };
    } catch (e) {
      // Fall through to offset
    }
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

// ─── debugFibers (diagnostic only — remove after fix) ─────────────────

/**
 * Raw diagnostic: dumps fiber root count and a shallow walk of every
 * fiber (tag, type name, hasChild, hasSibling, hasAlternate).
 * Used to diagnose the LinkPreviewContextProvider missing-children bug.
 */
export async function debugFibers(): Promise<any> {
  const hook = (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook) return { error: 'no hook' };

  const renderers = hook.renderers instanceof Map ? hook.renderers.size : 'n/a';
  const rendererInterfaces = hook.rendererInterfaces instanceof Map ? hook.rendererInterfaces.size : 'n/a';

  // Count roots per renderer
  const rootsPerRenderer: Record<string, number> = {};
  if (hook.renderers instanceof Map) {
    for (const [id] of hook.renderers.entries()) {
      try {
        const roots = hook.getFiberRoots(id);
        rootsPerRenderer[`renderer_${id}`] = roots ? roots.size : 0;
      } catch (e: any) {
        rootsPerRenderer[`renderer_${id}`] = -1;
      }
    }
  }

  // Walk all roots via our getAllFiberRoots helper
  const allRoots = getAllFiberRoots();
  const fiberDump: any[] = [];
  let count = 0;
  const MAX = 200;

  function getTypeName(fiber: any): string {
    const t = fiber?.elementType;
    return (
      (typeof t === 'string' && t) ||
      t?.displayName || t?.name ||
      (typeof fiber?.type === 'string' && fiber?.type) ||
      fiber?.type?.displayName || fiber?.type?.name ||
      `tag:${fiber?.tag}`
    );
  }

  function walk(fiber: any, depth: number) {
    if (!fiber || count >= MAX) return;
    count++;
    fiberDump.push({
      depth,
      tag: fiber.tag,
      type: getTypeName(fiber),
      hasChild: !!fiber.child,
      hasSibling: !!fiber.sibling,
      hasAlternate: !!fiber.alternate,
      stateNodeType: fiber.stateNode ? (typeof fiber.stateNode === 'object' ? Object.keys(fiber.stateNode).slice(0, 5).join(',') : typeof fiber.stateNode) : null,
    });
    if (fiber.child) walk(fiber.child, depth + 1);
    if (fiber.sibling) walk(fiber.sibling, depth);
  }

  for (const root of allRoots) {
    walk(root, 0);
    if (count >= MAX) break;
  }

  return {
    renderers,
    rendererInterfaces,
    rootsPerRenderer,
    allRootsCount: allRoots.length,
    fiberCount: count,
    fibers: fiberDump,
  };
}

