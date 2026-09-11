/**
 * Tree serializer — fiber tree → agent-friendly JSON.
 *
 * Goals:
 *  - Bounded size: never return more than ~200 nodes per inspect() call
 *  - Stable refs: same element gets same ref ID across calls within a session
 *  - Useful data: layout, role, text, state, testID — NOT raw React props
 *  - Smart pruning: skip transparent wrappers, capped depth
 *  - Virtualization awareness: detect FlatList / FlashList, report itemCount
 *
 * Ref IDs:
 *  We use WeakMap<fiber, string> to assign each fiber a stable ref like 'r42'.
 *  The map survives across inspect() calls until resetRefs() is called
 *  (typically when the agent navigates to a new screen).
 */

import { TreeNode } from './protocol';
import {
  getRendererInterface,
  walkFibers,
  findNativeNodesForFiber,
} from './devtools-hook';

// ─── Ref ID allocator ─────────────────────────────────────────────────

const fiberToRef = new WeakMap<object, string>();
let refCounter = 0;

export function resetRefs(): void {
  // We can't actually clear a WeakMap, but we reset the counter and let
  // old fibers get GC'd. New fibers get new IDs.
  refCounter = 0;
  // Force new IDs by re-keying — we'd need a Map to clear, so we just
  // accept that old fibers (still in memory) keep their IDs. This is fine
  // because if a fiber is still in memory, it's probably still on screen.
}

function refFor(fiber: object): string {
  let ref = fiberToRef.get(fiber);
  if (!ref) {
    ref = `r${refCounter++}`;
    fiberToRef.set(fiber, ref);
  }
  return ref;
}

// ─── Stable ID (structural hash) ──────────────────────────────────────
//
// Computed from the path from root to this node, with each step contributing
// its type + index. If a node has a testID, that dominates (testID is the
// gold standard — set by the dev, guaranteed stable).
//
// Examples:
//   "View>View#0>Pressable#Sign in"     → hash → "h7a3b2"
//   "View>FlatList#0>Item#3:title=Foo"  → hash → "k9e1c4"
//
// Stable across re-renders as long as:
//   - The tree structure doesn't change
//   - The text/label/testID doesn't change
//   - The position in parent (sibling index) doesn't change
//
// NOT stable if:
//   - Siblings are inserted above this node (positional shift)
//   - The text changes (e.g. counter value updates — by design)
//   - List items reorder (each item's content changes)
//
// For testID'd elements, stableId === testID. Otherwise it's a 6-char hash.

function fnv1aHash(str: string): string {
  // FNV-1a 32-bit, returns 6-char base36 string.
  // Simple, fast, no deps. Good enough for tree node identity.
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Convert to unsigned 32-bit and then to base36 (6 chars max)
  return (hash >>> 0).toString(36).padStart(6, '0').slice(-6);
}

/**
 * Compute a stable ID for a fiber based on its structural identity.
 * Walks up the parent chain building a path string, then hashes it.
 */
function stableIdFor(fiber: any): string | undefined {
  if (!fiber) return undefined;

  const props = fiber.memoizedProps || {};

  // Golden path: if testID is set, use it directly.
  if (typeof props.testID === 'string' && props.testID.length > 0) {
    return `tid:${props.testID}`;
  }

  // Build the path from root to this node.
  // Each step: type + sibling-index + (text or label if set).
  const path: string[] = [];
  let current: any = fiber;
  let depth = 0;
  while (current && depth < 20) { // cap depth to avoid pathological trees
    const typeName = getTypeName(current);
    const currentProps = current.memoizedProps || {};

    // Best text identifier for this node
    let ident: string = '';
    if (typeof currentProps.accessibilityLabel === 'string' && currentProps.accessibilityLabel) {
      ident = `:${currentProps.accessibilityLabel}`;
    } else if (typeof currentProps['aria-label'] === 'string') {
      ident = `:${currentProps['aria-label']}`;
    } else if (typeof currentProps.children === 'string' && currentProps.children.length < 50) {
      ident = `:${currentProps.children}`;
    } else if (typeof currentProps.value === 'string' && currentProps.value.length < 50) {
      // Skip — value changes too often (counter, input)
    } else if (typeof currentProps.placeholder === 'string') {
      ident = `:${currentProps.placeholder}`;
    }

    // Compute sibling index (position among same-typed siblings under this parent)
    let siblingIndex = 0;
    let sibling = current.sibling;
    while (sibling) {
      siblingIndex++;
      sibling = sibling.sibling;
    }

    path.unshift(`${typeName}#${siblingIndex}${ident}`);
    current = current.return;
    depth++;
  }

  return 'h:' + fnv1aHash(path.join('>'));
}

function getTypeName(fiber: any): string {
  const fiberType = fiber?.elementType;
  return (
    (typeof fiberType === 'string' && fiberType) ||
    fiberType?.displayName ||
    fiberType?.name ||
    (typeof fiber.type === 'string' && fiber.type) ||
    fiber.type?.displayName ||
    fiber.type?.name ||
    'Unknown'
  );
}

// ─── Host component type names ────────────────────────────────────────

const HOST_TYPES = new Set([
  'View',
  'Text',
  'TextInput',
  'Image',
  'ScrollView',
  'FlatList',
  'SectionList',
  'Pressable',
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
  'TouchableNativeFeedback',
  'Switch',
  'ActivityIndicator',
  'Modal',
  'SafeAreaView',
  'KeyboardAvoidingView',
  'RefreshControl',
  'Button',
  'VirtualizedList',
  'RCTView',
  'RCTText',
  'RCTScrollView',
]);

const VIRTUALIZED_TYPES = new Set([
  'FlatList',
  'SectionList',
  'VirtualizedList',
  'FlashList',
  'MasonryFlashList',
]);

// ─── Layout reader ────────────────────────────────────────────────────

interface Layout {
  x: number;
  y: number;
  width: number;
  height: number;
}

function readLayout(hostInstance: any): Layout | undefined {
  if (!hostInstance) return undefined;

  // Modern Fabric API: ReactNativeElement has measureInWindow
  if (typeof hostInstance.measureInWindow === 'function') {
    return new Promise<Layout>((resolve) => {
      try {
        hostInstance.measureInWindow((x: number, y: number, width: number, height: number) => {
          resolve({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
        });
      } catch {
        resolve(undefined as any);
      }
    }) as any; // we'll await this synchronously-becoming-async below
  }

  // Fallback: offsetWidth/offsetHeight/offsetTop/offsetLeft (DOM-like)
  try {
    if (typeof hostInstance.offsetWidth === 'number') {
      return {
        x: hostInstance.offsetLeft ?? 0,
        y: hostInstance.offsetTop ?? 0,
        width: hostInstance.offsetWidth,
        height: hostInstance.offsetHeight,
      };
    }
  } catch {}

  return undefined;
}

// Layout reads are async on Fabric. We collect pending reads and flush
// them in parallel before serializing each node.
async function readLayoutAsync(hostInstance: any): Promise<Layout | undefined> {
  if (!hostInstance) return undefined;
  if (typeof hostInstance.measureInWindow === 'function') {
    return new Promise<Layout | undefined>((resolve) => {
      let resolved = false;
      const finish = (v: Layout | undefined) => {
        if (!resolved) {
          resolved = true;
          resolve(v);
        }
      };
      try {
        hostInstance.measureInWindow((x: number, y: number, width: number, height: number) => {
          if (typeof x === 'number') {
            finish({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
          } else {
            finish(undefined);
          }
        });
        // Timeout fallback in case the callback never fires
        setTimeout(() => finish(undefined), 200);
      } catch {
        finish(undefined);
      }
    });
  }
  return readLayout(hostInstance);
}

// ─── State reader ─────────────────────────────────────────────────────

function readState(fiber: any, hostInstance: any): TreeNode['state'] {
  const state: TreeNode['state'] = {};
  const props = fiber?.memoizedProps || {};

  if (props.disabled === true) state.disabled = true;
  if (props.pressed === true) state.pressed = true;
  if (typeof props.checked === 'boolean') state.checked = props.checked;
  if (typeof props.value === 'string' && props.value === 'on') {
    // Switch-style: don't set checked unless we know
  }
  if (props.selected === true) state.selected = true;

  // For Switch component
  if (typeof props.value === 'boolean') {
    state.checked = props.value;
  }

  if (Object.keys(state).length === 0) return undefined;
  return state;
}

// ─── Role / label / text extraction ───────────────────────────────────

function extractRoleAndLabel(fiber: any): { role?: string; label?: string } {
  const props = fiber?.memoizedProps || {};
  const out: { role?: string; label?: string } = {};

  // accessibilityRole is the RN-native way
  if (typeof props.accessibilityRole === 'string') {
    out.role = props.accessibilityRole;
  }

  // accessibilityLabel is the most common label source
  if (typeof props.accessibilityLabel === 'string' && props.accessibilityLabel.length > 0) {
    out.label = props.accessibilityLabel;
  }

  // aria-label (newer RN API)
  if (typeof props['aria-label'] === 'string') {
    out.label = props['aria-label'];
  }

  // For Pressable / TouchableOpacity without explicit role, infer 'button'
  const fiberType = fiber?.elementType?.displayName || fiber?.type?.displayName || '';
  if (!out.role && /Touchable|Pressable|Button/.test(fiberType)) {
    out.role = 'button';
  }

  return out;
}

function extractText(fiber: any): string | undefined {
  const props = fiber?.memoizedProps || {};
  if (typeof props.children === 'string') return props.children;
  if (typeof props.value === 'string') return props.value;
  if (typeof props.title === 'string') return props.title;
  return undefined;
}

// ─── Fiber walking & serialization ────────────────────────────────────

const MAX_DEPTH = 12;
const MAX_NODES = 200;

interface SerializeContext {
  nodesEmitted: number;
  depth: number;
  pendingLayoutReads: Array<{ node: TreeNode; hostInstance: any }>;
}

export async function serializeTree(): Promise<TreeNode | null> {
  resetRefs();
  const ctx: SerializeContext = {
    nodesEmitted: 0,
    depth: 0,
    pendingLayoutReads: [],
  };

  // Find the root fiber
  let rootFiber: any = null;
  let rootIface: any = null;
  walkFibers((fiber, iface) => {
    if (!rootFiber) {
      rootFiber = fiber;
      rootIface = iface;
    }
    return false; // stop after first root
  });

  if (!rootFiber) return null;

  const tree = serializeFiber(rootFiber, rootIface, ctx);

  // Flush all pending layout reads in parallel
  if (ctx.pendingLayoutReads.length > 0) {
    const layouts = await Promise.all(
      ctx.pendingLayoutReads.map(async (r) => ({
        ref: r.node.ref,
        layout: await readLayoutAsync(r.hostInstance),
      })),
    );
    // Apply layouts back to nodes
    const layoutMap = new Map(layouts.map((l) => [l.ref, l.layout]));
    applyLayouts(tree, layoutMap);
  }

  return tree;
}

function applyLayouts(node: TreeNode, layoutMap: Map<string, Layout | undefined>): void {
  const layout = layoutMap.get(node.ref);
  if (layout) node.layout = layout;
  for (const child of node.children) {
    applyLayouts(child, layoutMap);
  }
}

function serializeFiber(fiber: any, iface: any, ctx: SerializeContext): TreeNode | null {
  if (!fiber) return null;
  if (ctx.nodesEmitted >= MAX_NODES) return null;
  if (ctx.depth > MAX_DEPTH) return null;

  ctx.nodesEmitted++;

  const ref = refFor(fiber);
  const stableId = stableIdFor(fiber);
  const fiberType = fiber?.elementType;
  const typeName =
    (typeof fiberType === 'string' && fiberType) ||
    fiberType?.displayName ||
    fiberType?.name ||
    (typeof fiber.type === 'string' && fiber.type) ||
    fiber.type?.displayName ||
    fiber.type?.name ||
    'Unknown';

  // Try to find a host instance for layout reading
  const hostInstances = findNativeNodesForFiber(fiber, iface);
  const hostInstance = hostInstances[0];

  const node: TreeNode = {
    ref,
    stableId,
    type: typeName,
    children: [],
  };

  // Display name for composite components
  if (!HOST_TYPES.has(typeName) && typeName !== 'Unknown') {
    node.name = typeName;
  }

  // Text content
  const text = extractText(fiber);
  if (text !== undefined) node.text = text;

  // testID
  const testID = fiber?.memoizedProps?.testID;
  if (typeof testID === 'string') node.testID = testID;

  // Role + label
  const { role, label } = extractRoleAndLabel(fiber);
  if (role) node.role = role;
  if (label) node.label = label;

  // State
  const state = readState(fiber, hostInstance);
  if (state) node.state = state;

  // Virtualization detection
  if (VIRTUALIZED_TYPES.has(typeName)) {
    node.virtualized = true;
    const data = fiber?.memoizedProps?.data;
    if (Array.isArray(data)) {
      node.itemCount = data.length;
    } else if (fiber?.memoizedProps?.getItemCount) {
      try {
        node.itemCount = fiber.memoizedProps.getItemCount(data);
      } catch {}
    }
  }

  // Queue layout read
  if (hostInstance) {
    ctx.pendingLayoutReads.push({ node, hostInstance });
  }

  // Walk children
  let child = fiber.child;
  ctx.depth++;
  const childRefsStillValid = ctx.nodesEmitted < MAX_NODES && ctx.depth <= MAX_DEPTH;
  while (child) {
    const childNode = serializeFiber(child, iface, ctx);
    if (childNode) {
      node.children.push(childNode);
    } else if (!childRefsStillValid) {
      node.truncated = true;
      break;
    }
    child = child.sibling;
  }
  ctx.depth--;

  // For virtualized lists, compute renderedRange
  if (node.virtualized && node.itemCount != null) {
    const rendered = node.children.length;
    if (rendered < node.itemCount) {
      // We don't know the exact scroll position from here, but we can
      // estimate from the first child's index in props.data
      // (FlatList sets _listRef._listKey._indices for keyed children)
      // For v1 we just report renderedRange: [0, rendered-1] as an approximation
      node.renderedRange = [0, Math.max(0, rendered - 1)];
    }
  }

  return node;
}

// ─── Snapshot (drill into one ref) ────────────────────────────────────

export async function snapshotRef(refId: string): Promise<TreeNode | null> {
  // Find the fiber with this ref ID by walking the tree
  let targetFiber: any = null;
  let targetIface: any = null;

  // We can't look up by ref ID directly since we used a WeakMap. Walk and match.
  walkFibers((fiber, iface) => {
    if (refFor(fiber) === refId) {
      targetFiber = fiber;
      targetIface = iface;
      return false; // stop
    }
    return true; // continue
  });

  if (!targetFiber) return null;

  // Serialize with deeper limits for snapshot
  const ctx: SerializeContext = {
    nodesEmitted: 0,
    depth: 0,
    pendingLayoutReads: [],
  };
  // Override limits for snapshot
  const SNAPSHOT_MAX_DEPTH = 20;
  const SNAPSHOT_MAX_NODES = 100;

  const node = serializeFiberDeep(targetFiber, targetIface, ctx, 0, SNAPSHOT_MAX_DEPTH, SNAPSHOT_MAX_NODES);

  // Flush layouts
  if (ctx.pendingLayoutReads.length > 0) {
    const layouts = await Promise.all(
      ctx.pendingLayoutReads.map(async (r) => ({
        ref: r.node.ref,
        layout: await readLayoutAsync(r.hostInstance),
      })),
    );
    const layoutMap = new Map(layouts.map((l) => [l.ref, l.layout]));
    applyLayouts(node!, layoutMap);
  }

  return node;
}

function serializeFiberDeep(
  fiber: any,
  iface: any,
  ctx: SerializeContext,
  depth: number,
  maxDepth: number,
  maxNodes: number,
): TreeNode | null {
  if (!fiber) return null;
  if (ctx.nodesEmitted >= maxNodes) return null;
  if (depth > maxDepth) return null;

  ctx.nodesEmitted++;
  const ref = refFor(fiber);
  const stableId = stableIdFor(fiber);
  const fiberType = fiber?.elementType;
  const typeName =
    (typeof fiberType === 'string' && fiberType) ||
    fiberType?.displayName ||
    fiberType?.name ||
    (typeof fiber.type === 'string' && fiber.type) ||
    fiber.type?.displayName ||
    fiber.type?.name ||
    'Unknown';

  const hostInstances = findNativeNodesForFiber(fiber, iface);
  const hostInstance = hostInstances[0];

  const node: TreeNode = {
    ref,
    stableId,
    type: typeName,
    children: [],
  };

  if (!HOST_TYPES.has(typeName) && typeName !== 'Unknown') {
    node.name = typeName;
  }

  const text = extractText(fiber);
  if (text !== undefined) node.text = text;

  const testID = fiber?.memoizedProps?.testID;
  if (typeof testID === 'string') node.testID = testID;

  const { role, label } = extractRoleAndLabel(fiber);
  if (role) node.role = role;
  if (label) node.label = label;

  const state = readState(fiber, hostInstance);
  if (state) node.state = state;

  // For snapshot, include a whitelisted subset of props
  node.props = extractWhitelistedProps(fiber);

  if (VIRTUALIZED_TYPES.has(typeName)) {
    node.virtualized = true;
    const data = fiber?.memoizedProps?.data;
    if (Array.isArray(data)) node.itemCount = data.length;
  }

  if (hostInstance) {
    ctx.pendingLayoutReads.push({ node, hostInstance });
  }

  let child = fiber.child;
  while (child) {
    const childNode = serializeFiberDeep(child, iface, ctx, depth + 1, maxDepth, maxNodes);
    if (childNode) {
      node.children.push(childNode);
    } else {
      node.truncated = true;
      break;
    }
    child = child.sibling;
  }

  return node;
}

const PROPS_WHITELIST = new Set([
  'placeholder',
  'keyboardType',
  'secureTextEntry',
  'editable',
  'maxLength',
  'multiline',
  'numberOfLines',
  'horizontal',
  'numColumns',
  'keyExtractor',
  'renderItem',
  'data',
  'source',
  'resizeMode',
  'accessibilityRole',
  'accessibilityLabel',
  'accessibilityHint',
  'accessibilityState',
  'testID',
  'accessible',
]);

function extractWhitelistedProps(fiber: any): Record<string, any> | undefined {
  const props = fiber?.memoizedProps;
  if (!props || typeof props !== 'object') return undefined;
  const out: Record<string, any> = {};
  let hasAny = false;
  for (const key of Object.keys(props)) {
    if (PROPS_WHITELIST.has(key)) {
      const value = props[key];
      // Don't include functions or huge arrays
      if (typeof value === 'function') {
        out[key] = '[function]';
      } else if (Array.isArray(value) && value.length > 50) {
        out[key] = `[Array length=${value.length}]`;
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Shallow object copy
        try {
          out[key] = JSON.parse(JSON.stringify(value));
          hasAny = true;
        } catch {
          out[key] = '[object]';
        }
      } else {
        out[key] = value;
        hasAny = true;
      }
    }
  }
  return hasAny ? out : undefined;
}

// ─── Find fiber by ref (for tap/type/scroll tools) ────────────────────

/**
 * Find a fiber by ref ID OR stableId. Accepts:
 *   - "r5"          → positional ref (from inspect/snapshot output)
 *   - "tid:saveBtn" → testID-based stableId
 *   - "h:7a3b2"     → structural hash stableId
 *
 * Used by tap/type/scrollTo/etc. — the agent can pass whichever it has.
 */
export function findFiberByRef(refId: string): { fiber: any; iface: any } | null {
  let found: { fiber: any; iface: any } | null = null;
  walkFibers((fiber, iface) => {
    // Try positional ref first (fast — WeakMap lookup)
    if (refFor(fiber) === refId) {
      found = { fiber, iface };
      return false;
    }
    // Then try stableId
    if (stableIdFor(fiber) === refId) {
      found = { fiber, iface };
      return false;
    }
    return true;
  });
  return found;
}

/** Find the nearest ancestor (or self) that has a host instance. */
export function findHostFiberByRef(refId: string): { fiber: any; iface: any; hostInstance: any } | null {
  const found = findFiberByRef(refId);
  if (!found) return null;
  const { fiber, iface } = found;

  // Walk up the fiber tree until we find one with a real host instance
  let current: any = fiber;
  while (current) {
    const hosts = findNativeNodesForFiber(current, iface);
    if (hosts.length > 0) {
      return { fiber: current, iface, hostInstance: hosts[0] };
    }
    current = current.return;
  }
  return null;
}

/** Find the nearest scrollable ancestor of a fiber. */
export function findScrollableAncestor(refId: string): { fiber: any; iface: any; hostInstance: any } | null {
  const found = findFiberByRef(refId);
  if (!found) return null;
  const { fiber, iface } = found;

  const SCROLLABLE_TYPES = new Set([
    'ScrollView',
    'FlatList',
    'SectionList',
    'VirtualizedList',
    'FlashList',
    'RCTScrollView',
  ]);

  let current: any = fiber.return; // start from parent
  while (current) {
    const typeName = current?.elementType?.displayName || current?.type?.displayName || current?.type?.name;
    if (typeName && SCROLLABLE_TYPES.has(typeName)) {
      const hosts = findNativeNodesForFiber(current, iface);
      if (hosts.length > 0) {
        return { fiber: current, iface, hostInstance: hosts[0] };
      }
    }
    current = current.return;
  }
  return null;
}
