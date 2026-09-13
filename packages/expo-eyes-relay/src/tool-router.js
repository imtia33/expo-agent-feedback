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
  const result = await phoneCall('dispatchEvent', { viewTag, event: 'press' });
  return { ok: true, debug: result?.debug };
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

  // Relative scroll (direction + amount) → mode:'by' with dx/dy.
  // The phone computes tracked offset + delta → absolute scrollTo.
  // (The old behavior passed a DELTA as an absolute y — "scroll down 400"
  // scrolled to offset 400 once and then never moved again.)
  if (args.direction && args.amount) {
    const dx = { right: args.amount, left: -args.amount }[args.direction] ?? 0;
    const dy = { down: args.amount, up: -args.amount }[args.direction] ?? 0;
    const res = await phoneCall('scroll', { viewTag, dx, dy, mode: 'by', animated: args.animated ?? true });
    return { ok: true, scrolledTo: res.scrolledTo };
  }

  const x = args.x ?? 0;
  const y = args.y ?? 0;
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

// ═══ COMPOSITE TOOLS (agent convenience layer) ═══════════════════════
//
// These exist so agents never have to pull raw inspect() JSON and parse
// it by hand. Rule of thumb: if an agent repeats a multi-step dance twice,
// promote it into a composite tool here.
//   visibleText  — lean on-screen inventory with REAL frames
//   tapText      — find element by text and press it (with verify + ancestor retry)
//   tapXY        — press whatever is at a screen point (deepest containing element)
//   clickables   — inventory of tappable-looking elements (roles/names)
//   fill         — find a TextInput by placeholder/value and set its text
//   waitGone     — poll until a text disappears (sheet dismissed, alert cleared)

const TAPPABLE_ROLES = new Set(['button', 'tab', 'menuitem', 'adjustable', 'link', 'checkbox', 'radio', 'switch']);

function projectElement(e, i) {
  return {
    ref: `r${i}`,
    name: e.name,
    text: e.props?.text ?? e.props?.title ?? undefined,
    value: e.props?.value ?? undefined,
    placeholder: e.props?.placeholder ?? undefined,
    role: e.props?.accessibilityRole ?? undefined,
    testID: e.props?.testID ?? undefined,
    disabled: e.props?.disabled === true ? true : undefined,
    frame: e.frame,
    viewTag: e.viewTag,
  };
}

function frameVisible(f) {
  return f && typeof f.width === 'number' && typeof f.height === 'number' && (f.width > 0 || f.height > 0);
}

function norm(s) {
  return (s ?? '').toString().toLowerCase();
}

function textOf(e) {
  return e.props?.text ?? e.props?.value ?? e.props?.title ?? '';
}

async function visibleText(phoneCall) {
  const elements = await fetchElements(phoneCall, true);
  const rows = elements
    .map(projectElement)
    .filter((e) => (e.text || e.value || e.placeholder || e.role || e.testID) && frameVisible(e.frame));
  return { count: rows.length, elements: rows };
}

async function clickables(phoneCall) {
  const elements = await fetchElements(phoneCall, true);
  const rows = elements
    .map(projectElement)
    .filter((e) => TAPPABLE_ROLES.has(e.role) || /pressable|button|chip|tabitem/i.test(e.name || ''));
  return { count: rows.length, elements: rows };
}

function findMatches(elements, { text, contains, role, placeholder, value }) {
  let matches = elements;
  if (text != null) {
    matches = matches.filter((e) => norm(textOf(e)) === norm(text));
  }
  if (matches.length === 0 && contains != null) {
    matches = matches.filter((e) => norm(textOf(e)).includes(norm(contains)));
  }
  if (role != null) matches = matches.filter((e) => norm(e.props?.accessibilityRole) === norm(role));
  if (placeholder != null) matches = matches.filter((e) => norm(e.props?.placeholder).includes(norm(placeholder)));
  if (value != null) matches = matches.filter((e) => norm(e.props?.value) === norm(value));
  return matches;
}

function screenFingerprint(elements) {
  return elements.map((e) => [textOf(e), e.frame?.x, e.frame?.y, e.frame?.width, e.frame?.height].join(',')).join('|');
}

// Try pressing a viewTag, then (optionally) its hierarchy ancestors until the
// screen visibly changes. Handles cases where the deepest element itself has
// no handler (icons, labels inside Pressable/TabTrigger wrappers).
async function pressWithRetry(phoneCall, element, { verify = false, maxAncestors = 8 } = {}) {
  const attempts = [{ viewTag: element.viewTag, source: 'self' }];
  const hierarchyTags = element.hierarchyTags || [];
  for (let i = hierarchyTags.length - 1; i >= 0 && attempts.length < maxAncestors; i--) {
    const h = hierarchyTags[i];
    if (h?.viewTag && h.viewTag !== element.viewTag) attempts.push({ viewTag: h.viewTag, source: `ancestor[${i}] ${h.name || ''}` });
  }

  const before = verify ? screenFingerprint(await fetchElements(phoneCall, true)) : null;
  const debugs = [];

  for (const attempt of attempts) {
    try {
      const res = await phoneCall('dispatchEvent', { viewTag: attempt.viewTag, event: 'press' });
      if (res?.debug) debugs.push({ tried: attempt.source, ...res.debug });
    } catch (e) {
      debugs.push({ tried: attempt.source, error: e.message });
      continue; // stale tag / no handler — try next ancestor
    }
    resetCache();
    if (!verify) return { ok: true, pressed: attempt.source };
    await sleep(500);
    const after = screenFingerprint(await fetchElements(phoneCall, true));
    if (after !== before) return { ok: true, pressed: attempt.source, screenChanged: true, debug: debugs };
  }
  if (!verify) return { ok: true, pressed: attempts[0].source };
  return { ok: false, error: 'press dispatched but screen did not change', tried: attempts.map((a) => a.source), debug: debugs };
}

async function tapText(phoneCall, args) {
  const elements = await fetchElements(phoneCall, true);
  const matches = findMatches(elements, { text: args.text, contains: args.contains, role: args.role });
  if (matches.length === 0) {
    return { ok: false, error: `no visible element matching text=${JSON.stringify(args.text)} contains=${JSON.stringify(args.contains)}` };
  }
  const idx = Math.min(args.index ?? 0, matches.length - 1);
  const pick = matches[idx];
  const res = await pressWithRetry(phoneCall, pick, { verify: args.verify !== false });
  return { ok: res.ok, tapped: projectElement(pick, elements.indexOf(pick)), matchCount: matches.length, ...res };
}

async function tapXY(phoneCall, args) {
  const { x, y } = args;
  if (typeof x !== 'number' || typeof y !== 'number') {
    throw Object.assign(new Error('tapXY requires numeric x and y'), { code: 'BAD_ARGS' });
  }
  const elements = await fetchElements(phoneCall, true);
  const containing = elements.filter((e) => {
    const f = e.frame;
    return frameVisible(f) && x >= f.x && x <= f.x + f.width && y >= f.y && y <= f.y + f.height;
  });
  if (containing.length === 0) {
    return { ok: false, error: `no element at point (${x}, ${y})` };
  }
  // Deepest = smallest area wins.
  const deepest = containing.reduce((a, b) => (a.frame.width * a.frame.height <= b.frame.width * b.frame.height ? a : b));
  const res = await pressWithRetry(phoneCall, deepest, { verify: args.verify !== false });
  return { ok: res.ok, tapped: projectElement(deepest, elements.indexOf(deepest)), candidates: containing.length, ...res };
}

async function fill(phoneCall, args) {
  const elements = await fetchElements(phoneCall, true);
  const inputs = elements.filter(
    (e) => /textinput|textfield|textview/i.test(e.name || '') || e.props?.accessibilityRole === 'textinput' || e.props?.placeholder != null
  );
  if (inputs.length === 0) return { ok: false, error: 'no TextInput visible', hint: 'maybe keyboard covers it — scroll or check screen' };
  const matches = findMatches(inputs, { contains: args.contains, placeholder: args.placeholder, value: args.value });
  if (matches.length === 0) {
    return {
      ok: false,
      error: 'no matching TextInput',
      inputCount: inputs.length,
      inputs: inputs.map((e) => projectElement(e, elements.indexOf(e))),
    };
  }
  const idx = Math.min(args.index ?? 0, matches.length - 1);
  const pick = matches[idx];
  await phoneCall('dispatchEvent', { viewTag: pick.viewTag, event: 'changeText', text: args.text });
  resetCache();
  return { ok: true, filled: projectElement(pick, elements.indexOf(pick)), newValue: args.text, matchCount: matches.length };
}

async function waitGone(phoneCall, args) {
  const { text, contains, timeoutMs = 5000 } = args;
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const elements = await fetchElements(phoneCall, true);
    const still = elements.find((e) => (text != null ? norm(textOf(e)) === norm(text) : norm(textOf(e)).includes(norm(contains))));
    if (!still) return { ok: true, gone: true, elapsedMs: Date.now() - t0 };
    await sleep(300);
  }
  return { ok: false, gone: false, error: `text still visible after ${timeoutMs}ms` };
}

// ── find — targeted search without tapping (tapText presses; find just looks) ──

async function find(phoneCall, args) {
  const elements = await fetchElements(phoneCall, args.refresh === true);
  let matches = elements;
  if (args.text != null) {
    const n = norm(args.text);
    matches = matches.filter((e) => norm(textOf(e)).includes(n) || norm(e.props?.accessibilityLabel).includes(n));
  }
  if (args.testID != null) matches = matches.filter((e) => norm(e.props?.testID).includes(norm(args.testID)));
  if (args.name != null) matches = matches.filter((e) => norm(e.name).includes(norm(args.name)));
  if (args.role != null) matches = matches.filter((e) => norm(e.props?.accessibilityRole) === norm(args.role));
  if (args.pressable === true) {
    matches = matches.filter((e) => TAPPABLE_ROLES.has(e.props?.accessibilityRole) || /pressable|button|chip|tabitem|touchable/i.test(e.name || ''));
  }
  const limit = Math.min(args.limit ?? 10, 50);
  matches = matches.slice(0, limit);
  return {
    count: matches.length,
    matches: matches.map((e) => ({ ...projectElement(e, elements.indexOf(e)), onScreen: frameVisible(e.frame) })),
  };
}

// ── scrollIntoView — swipe until an element is on screen, then return its ref ──

async function scrollIntoView(phoneCall, args) {
  if (args.text == null && args.contains == null && args.testID == null && !args.ref) {
    throw Object.assign(new Error('scrollIntoView needs "text", "contains", "testID" or "ref"'), { code: 'BAD_ARGS' });
  }
  const maxSwipes = Math.min(args.maxSwipes ?? 8, 20);
  let swipes = 0;

  const locate = (elements) => {
    if (args.ref) {
      const i = elements.findIndex((_, idx) => `r${idx}` === args.ref);
      return i >= 0 ? { e: elements[i], i } : null;
    }
    if (args.testID != null) {
      const i = elements.findIndex((e) => norm(e.props?.testID).includes(norm(args.testID)));
      return i >= 0 ? { e: elements[i], i } : null;
    }
    // exact text first, then contains (same convention as tapText)
    let i = elements.findIndex((e) => norm(textOf(e)) === norm(args.text));
    if (i < 0 && args.contains != null) i = elements.findIndex((e) => norm(textOf(e)).includes(norm(args.contains)));
    if (i < 0 && args.text != null) i = elements.findIndex((e) => norm(textOf(e)).includes(norm(args.text)) || norm(e.props?.accessibilityLabel).includes(norm(args.text)));
    return i >= 0 ? { e: elements[i], i } : null;
  };

  for (let attempt = 0; attempt <= maxSwipes; attempt++) {
    const elements = await fetchElements(phoneCall, true);
    const hit = locate(elements);

    if (hit && frameVisible(hit.e.frame)) {
      return {
        ok: true,
        found: { ...projectElement(hit.e, hit.i), onScreen: true },
        swipes,
      };
    }
    if (attempt === maxSwipes) break;

    // Swipe up from an element in the middle band (drives its scrollable ancestor)
    const mid = elements.find((e) => {
      const f = e.frame;
      return frameVisible(f) && f.y > 300 && f.y < 1500 && f.height > 20;
    }) || elements.find((e) => frameVisible(e.frame));
    if (!mid) break;
    await phoneCall('swipe', { viewTag: mid.viewTag, dx: 0, dy: -(args.swipeDistance ?? 500), durationMs: 300, steps: 8 });
    swipes++;
    await sleep(400);
  }

  // Not found OR never visible — say which
  const elements = await fetchElements(phoneCall, true);
  const hit = locate(elements);
  throw Object.assign(
    new Error(hit
      ? `Element found but still off-screen after ${swipes} swipes (fiber-only element, frame=${JSON.stringify(hit.e.frame)})`
      : `Element not found in tree after ${swipes} swipes: ${JSON.stringify({ text: args.text, contains: args.contains, testID: args.testID, ref: args.ref })}`),
    { code: 'NOT_VISIBLE' },
  );
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
  visibleText,
  tapText,
  tapXY,
  clickables,
  fill,
  waitGone,
  find,
  scrollIntoView,
  resetSession,
};
