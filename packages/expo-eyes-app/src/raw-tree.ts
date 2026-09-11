/**
 * Raw tree walker — returns the fiber tree with minimal processing.
 *
 * This is the ONLY tree-related code in the app SDK. All higher-level
 * logic (ref allocation, stableId hashing, pruning, snapshot drill-in,
 * scrollable ancestor search) lives in the relay.
 *
 * What we return:
 *   - Every fiber's type name
 *   - memoizedProps (whitelisted subset — text, testID, accessibilityLabel, etc.)
 *   - Layout (x/y/width/height) read via host instance's measureInWindow
 *   - Children (recursive)
 *
 * What we DON'T do here (relay's job):
 *   - Assign ref IDs (r0, r1, ...)
 *   - Compute stableIds (h:XXXXXX)
 *   - Prune transparent wrappers
 *   - Detect virtualization
 *   - Cap depth or node count
 *   - Diff against previous calls
 *
 * The relay gets the full raw tree and decides how to present it to the agent.
 */

import { walkFibers, findHostInstancesForFiber } from './devtools-hook';

export interface RawNode {
  /** Internal fiber ID — opaque to the agent, used by dispatchEvent/readLayout. */
  fid: number;
  type: string;
  name?: string;
  text?: string;
  testID?: string;
  role?: string;
  label?: string;
  layout?: { x: number; y: number; width: number; height: number };
  state?: {
    disabled?: boolean;
    pressed?: boolean;
    checked?: boolean | 'mixed';
    selected?: boolean;
    focused?: boolean;
  };
  props?: Record<string, any>;
  children: RawNode[];
}

const HOST_TYPES = new Set([
  'View', 'Text', 'TextInput', 'Image', 'ScrollView', 'FlatList', 'SectionList',
  'Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback',
  'TouchableNativeFeedback', 'Switch', 'ActivityIndicator', 'Modal', 'SafeAreaView',
  'KeyboardAvoidingView', 'RefreshControl', 'Button', 'VirtualizedList',
  'RCTView', 'RCTText', 'RCTScrollView',
]);

// Fiber tag values (verified in React source)
// 5 = HostComponent (has a native stateNode)
// 0 = FunctionComponent
// 1 = ClassComponent
// 11 = ForwardRef
// 15 = SimpleMemoComponent
const HOST_TAG = 5;

// Whitelisted props we surface to the relay
const PROPS_WHITELIST = new Set([
  'placeholder', 'keyboardType', 'secureTextEntry', 'editable',
  'maxLength', 'multiline', 'numberOfLines', 'horizontal', 'numColumns',
  'keyExtractor', 'renderItem', 'data', 'source', 'resizeMode',
  'accessibilityRole', 'accessibilityLabel', 'accessibilityHint',
  'accessibilityState', 'testID', 'accessible', 'disabled', 'checked',
  'selected', 'value', 'title', 'children',
]);

let fidCounter = 0;
const fiberToFid = new WeakMap<object, number>();

function fidFor(fiber: object): number {
  let fid = fiberToFid.get(fiber) || 0;
  if (!fid) {
    fid = ++fidCounter;
    fiberToFid.set(fiber, fid);
  }
  return fid;
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

function extractText(fiber: any): string | undefined {
  const props = fiber?.memoizedProps || {};
  if (typeof props.children === 'string') return props.children;
  if (typeof props.value === 'string') return props.value;
  if (typeof props.title === 'string') return props.title;
  return undefined;
}

function extractRoleAndLabel(fiber: any): { role?: string; label?: string } {
  const props = fiber?.memoizedProps || {};
  const out: { role?: string; label?: string } = {};
  if (typeof props.accessibilityRole === 'string') out.role = props.accessibilityRole;
  if (typeof props.accessibilityLabel === 'string' && props.accessibilityLabel.length > 0) {
    out.label = props.accessibilityLabel;
  }
  if (typeof props['aria-label'] === 'string') out.label = props['aria-label'];
  const fiberType = fiber?.elementType?.displayName || fiber?.type?.displayName || '';
  if (!out.role && /Touchable|Pressable|Button/.test(fiberType)) {
    out.role = 'button';
  }
  return out;
}

function readState(fiber: any): RawNode['state'] {
  const props = fiber?.memoizedProps || {};
  const state: RawNode['state'] = {};
  if (props.disabled === true) state.disabled = true;
  if (props.pressed === true) state.pressed = true;
  if (typeof props.checked === 'boolean') state.checked = props.checked;
  if (props.selected === true) state.selected = true;
  if (typeof props.value === 'boolean') state.checked = props.value;
  if (Object.keys(state).length === 0) return undefined;
  return state;
}

function extractWhitelistedProps(fiber: any): Record<string, any> | undefined {
  const props = fiber?.memoizedProps;
  if (!props || typeof props !== 'object') return undefined;
  const out: Record<string, any> = {};
  let hasAny = false;
  for (const key of Object.keys(props)) {
    if (PROPS_WHITELIST.has(key)) {
      const value = props[key];
      if (typeof value === 'function') {
        out[key] = '[function]';
        hasAny = true;
      } else if (Array.isArray(value) && value.length > 50) {
        out[key] = `[Array length=${value.length}]`;
        hasAny = true;
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
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

async function readLayoutAsync(hostInstance: any): Promise<RawNode['layout'] | undefined> {
  if (!hostInstance) return undefined;
  if (typeof hostInstance.measureInWindow === 'function') {
    return new Promise<RawNode['layout'] | undefined>((resolve) => {
      let resolved = false;
      const finish = (v: RawNode['layout'] | undefined) => {
        if (!resolved) { resolved = true; resolve(v); }
      };
      try {
        hostInstance.measureInWindow((x: number, y: number, width: number, height: number) => {
          if (typeof x === 'number') {
            finish({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
          } else {
            finish(undefined);
          }
        });
        setTimeout(() => finish(undefined), 200);
      } catch {
        finish(undefined);
      }
    });
  }
  // DOM-like fallback (Fabric ReactNativeElement)
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

/**
 * Walk the entire fiber tree and return it as a raw nested structure.
 * Layouts are read in parallel for performance.
 *
 * @param maxDepth safety cap (default 30)
 * @param maxNodes safety cap (default 5000)
 */
export async function getRawTree(maxDepth = 30, maxNodes = 5000): Promise<RawNode | null> {
  fidCounter = 0; // reset for this walk
  const pendingLayouts: Array<{ node: RawNode; hostInstance: any }> = [];

  // Find root fiber
  let rootFiber: any = null;
  walkFibers((fiber) => {
    if (!rootFiber) {
      rootFiber = fiber;
      return false;
    }
    return true;
  });
  if (!rootFiber) return null;

  const nodeCount = { value: 0 };
  const tree = serializeFiber(rootFiber, 0, maxDepth, maxNodes, nodeCount, pendingLayouts);

  // Flush all pending layout reads in parallel
  if (pendingLayouts.length > 0) {
    const layouts = await Promise.all(
      pendingLayouts.map(async (r) => ({
        fid: r.node.fid,
        layout: await readLayoutAsync(r.hostInstance),
      })),
    );
    const layoutMap = new Map(layouts.map((l) => [l.fid, l.layout]));
    applyLayouts(tree, layoutMap);
  }

  return tree;
}

function serializeFiber(
  fiber: any,
  depth: number,
  maxDepth: number,
  maxNodes: number,
  nodeCount: { value: number },
  pendingLayouts: Array<{ node: RawNode; hostInstance: any }>,
): RawNode | null {
  if (!fiber) return null;
  if (depth > maxDepth) return null;
  if (nodeCount.value >= maxNodes) return null;
  nodeCount.value++;

  const fid = fidFor(fiber);
  const typeName = getTypeName(fiber);
  const node: RawNode = { fid, type: typeName, children: [] };

  if (!HOST_TYPES.has(typeName) && typeName !== 'Unknown') {
    node.name = typeName;
  }

  const text = extractText(fiber);
  if (text !== undefined) node.text = text;

  const props = fiber?.memoizedProps || {};
  if (typeof props.testID === 'string') node.testID = props.testID;

  const { role, label } = extractRoleAndLabel(fiber);
  if (role) node.role = role;
  if (label) node.label = label;

  const state = readState(fiber);
  if (state) node.state = state;

  node.props = extractWhitelistedProps(fiber);

  // Queue layout read for host components
  if (fiber.tag === HOST_TAG) {
    const hostInstance = fiber.stateNode;
    if (hostInstance) {
      pendingLayouts.push({ node, hostInstance });
    }
  }

  // Walk children
  let child = fiber.child;
  while (child) {
    const childNode = serializeFiber(child, depth + 1, maxDepth, maxNodes, nodeCount, pendingLayouts);
    if (childNode) node.children.push(childNode);
    child = child.sibling;
  }

  return node;
}

function applyLayouts(node: RawNode, layoutMap: Map<number, RawNode['layout'] | undefined>): void {
  const layout = layoutMap.get(node.fid);
  if (layout) node.layout = layout;
  for (const child of node.children) {
    applyLayouts(child, layoutMap);
  }
}

/**
 * Find a fiber by its fid (the opaque ID from getRawTree).
 * Used by dispatchEvent and readLayout.
 */
export function findFiberByFid(fid: number): any | null {
  let found: any = null;
  walkFibers((fiber) => {
    if (fidFor(fiber) === fid) {
      found = fiber;
      return false;
    }
    return true;
  });
  return found;
}

/**
 * Get the host instance for a fiber (or its nearest host ancestor).
 */
export function getHostInstanceForFiber(fiber: any): any | null {
  if (!fiber) return null;
  let current: any = fiber;
  while (current) {
    if (current.tag === HOST_TAG && current.stateNode) {
      return current.stateNode;
    }
    // Try via devtools hook
    const hosts = findHostInstancesForFiber(current);
    if (hosts.length > 0) return hosts[0];
    current = current.return;
  }
  return null;
}
