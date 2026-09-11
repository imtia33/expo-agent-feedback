/**
 * Tool router — implements agent-facing tools using app-side primitives.
 *
 * This is the "brain" of expo-eyes. All computation lives here:
 *   - ref allocation (r0, r1, ...)
 *   - stableId hashing
 *   - tree pruning
 *   - snapshot drill-in
 *   - tap resolution
 *   - scrollable ancestor search
 *   - virtualization detection
 *
 * The app SDK exposes only: getTree, dispatchEvent, readLayout, scroll,
 * scrollToIndex. We compose those into the agent-facing tools.
 */

// ─── Ref allocation ───────────────────────────────────────────────────

const fidToRef = new Map();
const fidToStableId = new Map();
let refCounter = 0;

function resetRefs() {
  fidToRef.clear();
  refCounter = 0;
  // Don't clear stableId cache — it's deterministic per fid
}

function refForFid(fid) {
  let ref = fidToRef.get(fid);
  if (!ref) {
    ref = `r${refCounter++}`;
    fidToRef.set(fid, ref);
  }
  return ref;
}

// ─── stableId computation ─────────────────────────────────────────────

function fnv1aHash(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(6, '0').slice(-6);
}

const VIRTUALIZED_TYPES = new Set([
  'FlatList', 'SectionList', 'VirtualizedList', 'FlashList', 'MasonryFlashList',
]);

const MAX_DEPTH = 12;
const MAX_NODES = 200;

// ─── Session state ────────────────────────────────────────────────────

let lastRawTree = null;
let lastTreeFetchAt = 0;

async function fetchTree(phoneCall, force) {
  const now = Date.now();
  if (!force && lastRawTree && now - lastTreeFetchAt < 1000) {
    return lastRawTree;
  }
  const res = await phoneCall('getTree', {});
  // session.callTool resolves with { ...result, refsStillValid, durationMs }
  // So the phone's result fields are at the top level of res.
  lastRawTree = res.tree;
  lastTreeFetchAt = now;
  return lastRawTree;
}

// ─── inspect ──────────────────────────────────────────────────────────

async function inspect(phoneCall) {
  const t0 = Date.now();
  const raw = await fetchTree(phoneCall, true);
  resetRefs();

  const stats = { emitted: 0, pruned: 0 };
  const tree = raw ? pruneTree(raw, 0, stats) : null;

  return {
    tree,
    totalNodes: stats.emitted,
    prunedNodes: stats.pruned,
    renderTimeMs: Date.now() - t0,
  };
}

function pruneTree(node, depth, stats) {
  if (!node) return null;
  if (depth > MAX_DEPTH) { stats.pruned++; return null; }
  if (stats.emitted >= MAX_NODES) { stats.pruned++; return null; }

  stats.emitted++;
  const ref = refForFid(node.fid);
  const stableId = stableIdForFid(node);

  const agentNode = {
    ref,
    stableId,
    type: node.type,
    children: [],
  };

  if (node.name) agentNode.name = node.name;
  if (node.text) agentNode.text = node.text;
  if (node.testID) agentNode.testID = node.testID;
  if (node.role) agentNode.role = node.role;
  if (node.label) agentNode.label = node.label;
  if (node.layout) agentNode.layout = node.layout;
  if (node.state) agentNode.state = node.state;

  if (VIRTUALIZED_TYPES.has(node.type)) {
    agentNode.virtualized = true;
    const data = node.props?.data;
    if (Array.isArray(data)) {
      agentNode.itemCount = data.length;
    }
    const rendered = (node.children || []).length;
    if (agentNode.itemCount && rendered < agentNode.itemCount) {
      agentNode.renderedRange = [0, Math.max(0, rendered - 1)];
    }
  }

  for (const child of (node.children || [])) {
    const childNode = pruneTree(child, depth + 1, stats);
    if (childNode) {
      agentNode.children.push(childNode);
    } else if (stats.emitted >= MAX_NODES) {
      agentNode.truncated = true;
      break;
    }
  }

  return agentNode;
}

// ─── stableId ─────────────────────────────────────────────────────────

function stableIdForFid(node) {
  if (!node) return undefined;

  const cached = fidToStableId.get(node.fid);
  if (cached) return cached;

  if (node.testID) {
    const id = `tid:${node.testID}`;
    fidToStableId.set(node.fid, id);
    return id;
  }

  const path = buildPathFromRoot(node);
  const id = 'h:' + fnv1aHash(path);
  fidToStableId.set(node.fid, id);
  return id;
}

function buildPathFromRoot(node) {
  const parts = [node.type];
  if (node.label) parts.push(`:${node.label}`);
  else if (node.text && node.text.length < 50) parts.push(`:${node.text}`);
  else if (node.props?.placeholder) parts.push(`:${node.props.placeholder}`);
  return parts.join('');
}

// ─── snapshot ─────────────────────────────────────────────────────────

async function snapshot(phoneCall, args) {
  const t0 = Date.now();
  const raw = await fetchTree(phoneCall, true);
  resetRefs();

  const stats = { emitted: 0, pruned: 0 };
  const pruned = raw ? pruneTree(raw, 0, stats) : null;
  if (!pruned) throw Object.assign(new Error('Empty tree'), { code: 'EMPTY_TREE' });

  const target = findInAgentTree(pruned, args.ref);
  if (!target) {
    throw Object.assign(
      new Error(`ref "${args.ref}" not found — call inspect() to refresh.`),
      { code: 'REF_NOT_FOUND' },
    );
  }

  const rawTarget = findInRawTree(raw, target);
  if (!rawTarget) {
    return { element: target, renderTimeMs: Date.now() - t0 };
  }

  const deepStats = { emitted: 0, pruned: 0 };
  const deep = deepPrune(rawTarget, 0, deepStats);
  return { element: deep || target, renderTimeMs: Date.now() - t0 };
}

function findInAgentTree(node, ref) {
  if (!node) return null;
  if (node.ref === ref || node.stableId === ref) return node;
  for (const child of node.children) {
    const found = findInAgentTree(child, ref);
    if (found) return found;
  }
  return null;
}

function findInRawTree(root, agentNode) {
  let targetFid = null;
  for (const [fid, ref] of fidToRef.entries()) {
    if (ref === agentNode.ref) { targetFid = fid; break; }
  }
  if (targetFid === null) return null;

  function walk(node) {
    if (!node) return null;
    if (node.fid === targetFid) return node;
    for (const child of (node.children || [])) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  }
  return walk(root);
}

function deepPrune(node, depth, stats) {
  if (!node) return null;
  if (depth > 20) { stats.pruned++; return null; }
  if (stats.emitted >= 100) { stats.pruned++; return null; }
  stats.emitted++;

  const ref = refForFid(node.fid);
  const stableId = stableIdForFid(node);

  const agentNode = {
    ref, stableId, type: node.type, children: [],
  };

  if (node.name) agentNode.name = node.name;
  if (node.text) agentNode.text = node.text;
  if (node.testID) agentNode.testID = node.testID;
  if (node.role) agentNode.role = node.role;
  if (node.label) agentNode.label = node.label;
  if (node.layout) agentNode.layout = node.layout;
  if (node.state) agentNode.state = node.state;
  if (node.props) agentNode.props = node.props;

  if (VIRTUALIZED_TYPES.has(node.type)) {
    agentNode.virtualized = true;
    const data = node.props?.data;
    if (Array.isArray(data)) agentNode.itemCount = data.length;
  }

  for (const child of (node.children || [])) {
    const childNode = deepPrune(child, depth + 1, stats);
    if (childNode) agentNode.children.push(childNode);
    else { agentNode.truncated = true; break; }
  }

  return agentNode;
}

// ─── tap / longPress ──────────────────────────────────────────────────

async function tap(phoneCall, args) {
  const fid = await resolveRefToFid(phoneCall, args.ref);
  if (fid === null) {
    throw Object.assign(new Error(`ref "${args.ref}" not found`), { code: 'REF_NOT_FOUND' });
  }
  await phoneCall('dispatchEvent', { fid, event: 'press' });
  return { ok: true };
}

async function longPress(phoneCall, args) {
  const fid = await resolveRefToFid(phoneCall, args.ref);
  if (fid === null) {
    throw Object.assign(new Error(`ref "${args.ref}" not found`), { code: 'REF_NOT_FOUND' });
  }
  const durationMs = args.durationMs ?? 500;
  await sleep(durationMs);
  await phoneCall('dispatchEvent', { fid, event: 'longPress', durationMs });
  return { ok: true };
}

// ─── type ─────────────────────────────────────────────────────────────

async function type(phoneCall, args) {
  const fid = await resolveRefToFid(phoneCall, args.ref);
  if (fid === null) {
    throw Object.assign(new Error(`ref "${args.ref}" not found`), { code: 'REF_NOT_FOUND' });
  }

  let newValue = args.text;
  if (args.append) {
    const tree = await fetchTree(phoneCall, true);
    const node = findFidInRawTree(tree, fid);
    const current = node?.props?.value ?? node?.text ?? '';
    newValue = current + args.text;
  }

  await phoneCall('dispatchEvent', { fid, event: 'changeText', text: newValue });
  return { ok: true, newValue };
}

// ─── scrollTo ─────────────────────────────────────────────────────────

async function scrollTo(phoneCall, args) {
  const fid = await resolveRefToFid(phoneCall, args.ref);
  if (fid === null) {
    throw Object.assign(new Error(`ref "${args.ref}" not found`), { code: 'REF_NOT_FOUND' });
  }

  let x = args.x ?? 0;
  let y = args.y ?? 0;
  if (args.direction && args.amount) {
    switch (args.direction) {
      case 'down': y = args.amount; break;
      case 'up': y = -args.amount; break;
      case 'right': x = args.amount; break;
      case 'left': x = -args.amount; break;
    }
  }

  const res = await phoneCall('scroll', { fid, x, y, animated: args.animated ?? true });
  return { ok: true, scrolledTo: res.scrolledTo };
}

// ─── expandList ───────────────────────────────────────────────────────

async function expandList(phoneCall, args) {
  const t0 = Date.now();
  const from = args.from ?? 0;
  const to = args.to ?? from + 14;

  const fid = await resolveRefToFid(phoneCall, args.listRef);
  if (fid === null) {
    throw Object.assign(new Error(`listRef "${args.listRef}" not found`), { code: 'REF_NOT_FOUND' });
  }

  await phoneCall('scrollToIndex', { fid, index: from, animated: false });
  await sleep(200);

  const raw = await fetchTree(phoneCall, true);
  resetRefs();
  const listNode = findFidInRawTree(raw, fid);
  if (!listNode) {
    throw Object.assign(new Error(`List fid ${fid} not in tree after scroll`), { code: 'REF_NOT_FOUND' });
  }

  const itemCount = listNode.props?.data?.length ?? listNode.children?.length ?? 0;
  const stats = { emitted: 0, pruned: 0 };
  const items = [];
  for (const child of (listNode.children || [])) {
    const item = deepPrune(child, 0, stats);
    if (item) items.push(item);
  }

  return {
    items,
    renderedRange: [from, from + items.length - 1],
    itemCount,
    renderTimeMs: Date.now() - t0,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────

async function resolveRefToFid(phoneCall, ref) {
  // Try the cached mapping first
  for (const [fid, cachedRef] of fidToRef.entries()) {
    if (cachedRef === ref) return fid;
  }

  // Ref might be a stableId — fetch tree and find by stableId
  const tree = await fetchTree(phoneCall, true);
  resetRefs();

  const stats = { emitted: 0, pruned: 0 };
  if (tree) pruneTree(tree, 0, stats);

  // Try positional ref
  for (const [fid, cachedRef] of fidToRef.entries()) {
    if (cachedRef === ref) return fid;
  }

  // Try stableId
  const found = findFidByStableIdInRawTree(tree, ref);
  return found;
}

function findFidByStableIdInRawTree(node, stableId) {
  if (!node) return null;

  if (stableId.startsWith('tid:')) {
    const targetTestId = stableId.slice(4);
    if (node.testID === targetTestId) return node.fid;
  }

  if (stableId.startsWith('h:')) {
    const computed = computeStableIdForRawNode(node);
    if (computed === stableId) return node.fid;
  }

  for (const child of (node.children || [])) {
    const found = findFidByStableIdInRawTree(child, stableId);
    if (found !== null) return found;
  }
  return null;
}

function computeStableIdForRawNode(node) {
  if (node.testID) return `tid:${node.testID}`;
  const path = buildPathFromRoot(node);
  return 'h:' + fnv1aHash(path);
}

function findFidInRawTree(node, fid) {
  if (!node) return null;
  if (node.fid === fid) return node;
  for (const child of (node.children || [])) {
    const found = findFidInRawTree(child, fid);
    if (found) return found;
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Reset session state ──────────────────────────────────────────────

function resetSession() {
  resetRefs();
  fidToStableId.clear();
  lastRawTree = null;
  lastTreeFetchAt = 0;
}

module.exports = {
  inspect,
  snapshot,
  tap,
  longPress,
  type,
  scrollTo,
  expandList,
  resetSession,
};
