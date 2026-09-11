/**
 * Tool router — implements agent-facing tools using the new RN inspector API.
 *
 * Agent tools (unchanged from outside):
 *   inspect, snapshot, tap, longPress, type, scrollTo, expandList
 *
 * Phone primitives (new, flat — no deep tree):
 *   inspectAtPoint({x,y})    → element at a screen point
 *   listVisibleElements()    → flat list of visible elements
 *   dispatchEvent(viewTag, event, ...)  → fire onPress/etc.
 *   scroll(viewTag, x, y)    → scrollTo
 *   scrollToIndex(viewTag, n) → scrollToIndex
 *
 * The relay caches the listVisibleElements result so tap/type/etc can resolve
 * viewTags without re-scanning the screen.
 */

// ─── Session state ────────────────────────────────────────────────────

let cachedElements = null; // result of last listVisibleElements
let cacheExpiry = 0;
const CACHE_TTL_MS = 2000; // 2 seconds

function resetCache() {
  cachedElements = null;
  cacheExpiry = 0;
}

async function fetchElements(phoneCall, force = false) {
  const now = Date.now();
  if (!force && cachedElements && now < cacheExpiry) {
    return cachedElements;
  }
  const res = await phoneCall('listVisibleElements', {});
  cachedElements = res.elements || [];
  cacheExpiry = now + CACHE_TTL_MS;
  return cachedElements;
}

/**
 * Find an element by ref (positional like "r5") or stableId (testID-based).
 * Returns the viewTag.
 */
async function resolveRefToViewTag(phoneCall, ref) {
  const elements = await fetchElements(phoneCall);

  // Positional ref: "r5" → index 5
  if (typeof ref === 'string' && ref.startsWith('r') && /^r\d+$/.test(ref)) {
    const idx = parseInt(ref.slice(1), 10);
    if (idx >= 0 && idx < elements.length) {
      return elements[idx].viewTag;
    }
    throw Object.assign(new Error(`ref "${ref}" out of range (have ${elements.length} elements)`), { code: 'REF_NOT_FOUND' });
  }

  // StableId: "tid:saveBtn" → find by testID
  if (typeof ref === 'string' && ref.startsWith('tid:')) {
    const testID = ref.slice(4);
    const found = elements.find((e) => e.props?.testID === testID);
    if (found) return found.viewTag;
    throw Object.assign(new Error(`testID "${testID}" not found`), { code: 'REF_NOT_FOUND' });
  }

  // StableId: "h:xxxxxx" → find by structural hash (currently same as name-based lookup)
  if (typeof ref === 'string' && ref.startsWith('h:')) {
    // For now, we don't compute structural hashes in this version.
    // Fall through to name-based lookup.
  }

  // By name (case-insensitive substring match)
  if (typeof ref === 'string') {
    const lower = ref.toLowerCase();
    const found = elements.find((e) => e.name?.toLowerCase().includes(lower));
    if (found) return found.viewTag;
  }

  throw Object.assign(new Error(`ref "${ref}" not found. Call inspect() to see available elements.`), { code: 'REF_NOT_FOUND' });
}

// ─── inspect ──────────────────────────────────────────────────────────

async function inspect(phoneCall) {
  const t0 = Date.now();
  const elements = await fetchElements(phoneCall, true);

  // Build a tree-like structure from the flat list.
  // Each element has a hierarchy array (names from root → this element).
  // We group by depth and parent to reconstruct a tree.
  const tree = buildTreeFromFlatList(elements);

  return {
    tree,
    totalNodes: elements.length,
    prunedNodes: 0,
    renderTimeMs: Date.now() - t0,
  };
}

function buildTreeFromFlatList(elements) {
  // The flat list is sorted by y, then x. We build a tree by matching
  // hierarchy arrays — an element is a child of the previous element
  // whose hierarchy is a prefix of this one.
  if (elements.length === 0) return null;

  // Assign positional refs (r0, r1, ...)
  const withRefs = elements.map((e, i) => ({
    ref: `r${i}`,
    stableId: e.props?.testID ? `tid:${e.props.testID}` : undefined,
    type: e.name,
    name: e.name,
    text: e.props?.text || e.props?.value || e.props?.title,
    testID: e.props?.testID,
    role: e.props?.accessibilityRole,
    label: e.props?.accessibilityLabel,
    layout: e.frame,
    state: extractState(e.props),
    viewTag: e.viewTag,
    depth: e.depth,
    children: [],
  }));

  // Build tree by hierarchy depth
  const root = withRefs[0];
  const stack = [root];

  for (let i = 1; i < withRefs.length; i++) {
    const el = withRefs[i];

    // Pop stack until we find a parent (depth < this element's depth)
    while (stack.length > 0 && stack[stack.length - 1].depth >= el.depth) {
      stack.pop();
    }

    if (stack.length === 0) {
      // Sibling of root — attach to root
      root.children.push(el);
    } else {
      stack[stack.length - 1].children.push(el);
    }
    stack.push(el);
  }

  return root;
}

function extractState(props) {
  if (!props) return undefined;
  const state = {};
  if (props.disabled === true) state.disabled = true;
  if (typeof props.checked === 'boolean') state.checked = props.checked;
  if (typeof props.value === 'boolean') state.checked = props.value;
  if (props.selected === true) state.selected = true;
  if (Object.keys(state).length === 0) return undefined;
  return state;
}

// ─── snapshot ─────────────────────────────────────────────────────────
//
// With the new flat-list approach, "snapshot" is the same as inspect —
// we return the element + its position in the hierarchy. No deep tree to drill into.

async function snapshot(phoneCall, args) {
  const t0 = Date.now();
  const elements = await fetchElements(phoneCall, true);

  // Find the element by ref
  let target = null;
  let targetIndex = -1;

  // Positional ref
  if (typeof args.ref === 'string' && args.ref.startsWith('r') && /^r\d+$/.test(args.ref)) {
    const idx = parseInt(args.ref.slice(1), 10);
    if (idx >= 0 && idx < elements.length) {
      target = elements[idx];
      targetIndex = idx;
    }
  }

  // testID
  if (!target && typeof args.ref === 'string' && args.ref.startsWith('tid:')) {
    const testID = args.ref.slice(4);
    targetIndex = elements.findIndex((e) => e.props?.testID === testID);
    if (targetIndex >= 0) target = elements[targetIndex];
  }

  // Name match
  if (!target && typeof args.ref === 'string') {
    const lower = args.ref.toLowerCase();
    targetIndex = elements.findIndex((e) => e.name?.toLowerCase().includes(lower));
    if (targetIndex >= 0) target = elements[targetIndex];
  }

  if (!target) {
    throw Object.assign(new Error(`ref "${args.ref}" not found`), { code: 'REF_NOT_FOUND' });
  }

  return {
    element: {
      ref: `r${targetIndex}`,
      stableId: target.props?.testID ? `tid:${target.props.testID}` : undefined,
      type: target.name,
      name: target.name,
      text: target.props?.text || target.props?.value || target.props?.title,
      testID: target.props?.testID,
      role: target.props?.accessibilityRole,
      label: target.props?.accessibilityLabel,
      layout: target.frame,
      state: extractState(target.props),
      props: target.props,
      hierarchy: target.hierarchy,
      viewTag: target.viewTag,
      children: [],
    },
    renderTimeMs: Date.now() - t0,
  };
}

// ─── tap / longPress ──────────────────────────────────────────────────

async function tap(phoneCall, args) {
  const viewTag = await resolveRefToViewTag(phoneCall, args.ref);
  await phoneCall('dispatchEvent', { viewTag, event: 'press' });
  return { ok: true };
}

async function longPress(phoneCall, args) {
  const viewTag = await resolveRefToViewTag(phoneCall, args.ref);
  const durationMs = args.durationMs ?? 500;
  await sleep(durationMs);
  await phoneCall('dispatchEvent', { viewTag, event: 'longPress', durationMs });
  return { ok: true };
}

// ─── type ─────────────────────────────────────────────────────────────

async function type(phoneCall, args) {
  const viewTag = await resolveRefToViewTag(phoneCall, args.ref);

  // For append mode, we'd need to read the current value first.
  // For now, just set the new value (replace mode).
  let newValue = args.text;
  if (args.append) {
    // Find the current value from cached elements
    const elements = await fetchElements(phoneCall);
    const el = elements.find((e) => e.viewTag === viewTag);
    const current = el?.props?.value || el?.props?.text || '';
    newValue = current + args.text;
  }

  await phoneCall('dispatchEvent', { viewTag, event: 'changeText', text: newValue });
  return { ok: true, newValue };
}

// ─── scrollTo ─────────────────────────────────────────────────────────

async function scrollTo(phoneCall, args) {
  const viewTag = await resolveRefToViewTag(phoneCall, args.ref);

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

  const res = await phoneCall('scroll', { viewTag, x, y, animated: args.animated ?? true });
  return { ok: true, scrolledTo: res.scrolledTo };
}

// ─── expandList ───────────────────────────────────────────────────────

async function expandList(phoneCall, args) {
  const t0 = Date.now();
  const from = args.from ?? 0;
  const to = args.to ?? from + 14;

  const viewTag = await resolveRefToViewTag(phoneCall, args.listRef);
  await phoneCall('scrollToIndex', { viewTag, index: from, animated: false });
  await sleep(200);

  // Re-fetch elements after scroll
  const elements = await fetchElements(phoneCall, true);

  // Filter to list items (elements whose name matches 'Item' or are inside the list)
  // For now, return all elements — the agent can filter.
  return {
    items: elements.map((e, i) => ({
      ref: `r${i}`,
      stableId: e.props?.testID ? `tid:${e.props.testID}` : undefined,
      type: e.name,
      name: e.name,
      text: e.props?.text || e.props?.value,
      testID: e.props?.testID,
      layout: e.frame,
    })),
    renderedRange: [from, from + elements.length - 1],
    itemCount: elements.length,
    renderTimeMs: Date.now() - t0,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resetSession() {
  resetCache();
}

// ─── swipe ────────────────────────────────────────────────────────────

async function swipe(phoneCall, args) {
  const viewTag = await resolveRefToViewTag(phoneCall, args.ref);
  const result = await phoneCall('swipe', {
    viewTag,
    dx: args.dx ?? 0,
    dy: args.dy ?? 0,
    durationMs: args.durationMs ?? 250,
    steps: args.steps ?? 10,
  });
  return { ok: result.ok };
}

// ─── screenshot ──────────────────────────────────────────────────────

async function screenshot(phoneCall, args) {
  let viewTag;
  if (args.ref) {
    viewTag = await resolveRefToViewTag(phoneCall, args.ref);
  }
  const result = await phoneCall('screenshot', viewTag ? { viewTag } : {});
  return result;
}

// ─── waitFor ─────────────────────────────────────────────────────────

async function waitFor(phoneCall, args) {
  const result = await phoneCall('waitForElement', {
    testID: args.testID,
    text: args.text,
    timeoutMs: args.timeoutMs ?? 5000,
    intervalMs: args.intervalMs ?? 300,
  });
  // Invalidate the elements cache — the screen changed during the wait
  resetCache();
  return result;
}

// ─── readScreen ──────────────────────────────────────────────────────

async function readScreen(phoneCall) {
  const result = await phoneCall('readScreen', {});
  return result;
}

// ─── layout (precise measurement + overflow detection) ────────────────

async function layout(phoneCall, args) {
  const result = await phoneCall('layout', { ref: args.ref, testID: args.testID });
  return result;
}

// ─── navigate / back ──────────────────────────────────────────────────

async function navigate(phoneCall, args) {
  const result = await phoneCall('navigate', { route: args.route, params: args.params });
  // Invalidate cache (screen changed)
  resetCache();
  return result;
}

async function back(phoneCall) {
  const result = await phoneCall('back', {});
  resetCache();
  return result;
}

// ─── assertions ───────────────────────────────────────────────────────

async function assertVisible(phoneCall, args) {
  const result = await phoneCall('assertVisible', {
    testID: args.testID,
    text: args.text,
    timeoutMs: args.timeoutMs,
  });
  return result;
}

async function assertText(phoneCall, args) {
  const result = await phoneCall('assertText', {
    testID: args.testID,
    text: args.text,
    timeoutMs: args.timeoutMs,
  });
  return result;
}

async function assertEnabled(phoneCall, args) {
  const result = await phoneCall('assertEnabled', {
    testID: args.testID,
    timeoutMs: args.timeoutMs,
  });
  return result;
}

// ─── pinch ───────────────────────────────────────────────────────────

async function pinch(phoneCall, args) {
  const viewTag = await resolveRefToViewTag(phoneCall, args.ref);
  const result = await phoneCall('pinch', {
    viewTag,
    direction: args.direction,
    scale: args.scale ?? 2.0,
    durationMs: args.durationMs ?? 300,
    steps: args.steps ?? 10,
  });
  return { ok: result.ok };
}

module.exports = {
  inspect,
  snapshot,
  tap,
  longPress,
  type,
  scrollTo,
  expandList,
  swipe,
  screenshot,
  waitFor,
  readScreen,
  layout,
  navigate,
  back,
  assertVisible,
  assertText,
  assertEnabled,
  pinch,
  resetSession,
};
