/**
 * Zod schemas for runtime validation.
 *
 * Single source of truth is types.ts. These schemas derive from the same
 * shapes and are used to:
 *   - validate tool args coming from the agent (CLI / MCP / SDK)
 *   - validate tool results coming back from the relay
 *   - generate JSON schemas for the MCP server (via the MCP SDK)
 *
 * Design rules:
 *   - ARGS schemas are STRICT — catch agent mistakes before the network hop.
 *   - RESULT schemas for the 7 foundational tools are strict (stable shapes).
 *   - RESULT schemas for composite tools (visibleText, tapText, fill, …) are
 *     LOOSE (z.looseObject) — their payloads evolve with the relay; strict
 *     validation there would only produce false-positive MALFORMED_RESULT.
 *
 * Verified against zod 4.6.x.
 * Key v4 specifics:
 *   - z.enum(['a','b']) takes a string array (not a z.nativeEnum)
 *   - z.looseObject({}) == v3's z.object({}).passthrough()
 *   - safeParse returns { success, data } | { success, error }
 */

import { z } from 'zod';

// ─── Common schemas ───────────────────────────────────────────────────

export const LayoutSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export const ElementStateSchema = z.object({
  disabled: z.boolean().optional(),
  pressed: z.boolean().optional(),
  checked: z.union([z.boolean(), z.literal('mixed')]).optional(),
  selected: z.boolean().optional(),
  focused: z.boolean().optional(),
});

// TreeNode is recursive — Zod 4 supports z.lazy with registration.
// We use a forward-declared type with z.lazy to break the cycle.
export type TreeNodeRaw = {
  ref: string;
  stableId?: string;
  type: string;
  name?: string;
  text?: string;
  testID?: string;
  role?: string;
  label?: string;
  layout?: z.infer<typeof LayoutSchema>;
  state?: z.infer<typeof ElementStateSchema>;
  props?: Record<string, unknown>;
  children: TreeNodeRaw[];
  truncated?: boolean;
  virtualized?: boolean;
  itemCount?: number;
  renderedRange?: [number, number];
};

export const TreeNodeSchema: z.ZodType<TreeNodeRaw> = z.lazy(() =>
  z.object({
    ref: z.string(),
    stableId: z.string().optional(),
    type: z.string(),
    name: z.string().optional(),
    text: z.string().optional(),
    testID: z.string().optional(),
    role: z.string().optional(),
    label: z.string().optional(),
    layout: LayoutSchema.optional(),
    state: ElementStateSchema.optional(),
    props: z.record(z.string(), z.unknown()).optional(),
    children: z.array(TreeNodeSchema),
    truncated: z.boolean().optional(),
    virtualized: z.boolean().optional(),
    itemCount: z.number().optional(),
    renderedRange: z.tuple([z.number(), z.number()]).optional(),
  }),
);

/** Loose result — anything goes, `ok` if present must be boolean. */
export const LooseResultSchema = z.looseObject({ ok: z.boolean().optional() });

// ─── Tool arg schemas ─────────────────────────────────────────────────

export const InspectArgsSchema = z.object({
  since: z.literal('last').optional(),
});

export const SnapshotArgsSchema = z.object({
  ref: z.string().min(1, 'ref is required (get it from a prior inspect())'),
});

export const TapArgsSchema = z.object({
  ref: z.string().min(1, 'ref is required'),
});

export const LongPressArgsSchema = z.object({
  ref: z.string().min(1, 'ref is required'),
  durationMs: z.number().int().positive().default(500),
});

export const TypeArgsSchema = z.object({
  ref: z.string().min(1, 'ref is required'),
  text: z.string(),
  append: z.boolean().default(false),
});

export const ScrollDirectionSchema = z.enum(['up', 'down', 'left', 'right']);

export const ScrollToArgsSchema = z.object({
  ref: z.string().min(1, 'ref is required'),
  x: z.number().optional(),
  y: z.number().optional(),
  animated: z.boolean().default(true),
  direction: ScrollDirectionSchema.optional(),
  amount: z.number().optional(),
});

export const ExpandListArgsSchema = z.object({
  listRef: z.string().min(1, 'listRef is required'),
  from: z.number().int().min(0).default(0),
  to: z.number().int().min(0).optional(),
});

export const SwipeArgsSchema = z.object({
  ref: z.string().min(1, 'ref is required'),
  dx: z.number().default(0),
  dy: z.number().default(0),
  durationMs: z.number().int().positive().default(250),
  steps: z.number().int().positive().default(10),
});

export const ScreenshotArgsSchema = z.object({
  ref: z.string().optional(),
});

export const WaitForArgsSchema = z.object({
  testID: z.string().optional(),
  text: z.string().optional(),
  timeoutMs: z.number().int().positive().default(5000),
  intervalMs: z.number().int().positive().optional(),
});

export const ReadScreenArgsSchema = z.object({});

export const LayoutArgsSchema = z.object({
  ref: z.string().optional(),
  testID: z.string().optional(),
});

export const NavigateArgsSchema = z.object({
  route: z.string().min(1, 'route is required (e.g. "/playground")'),
  params: z.record(z.string(), z.unknown()).optional(),
});

export const BackArgsSchema = z.object({});

export const AssertVisibleArgsSchema = z.object({
  testID: z.string().optional(),
  text: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export const AssertTextArgsSchema = z.object({
  testID: z.string().min(1, 'testID is required'),
  text: z.string().min(1, 'text is required'),
  timeoutMs: z.number().int().positive().optional(),
});

export const AssertEnabledArgsSchema = z.object({
  testID: z.string().min(1, 'testID is required'),
  timeoutMs: z.number().int().positive().optional(),
});

export const PinchDirectionSchema = z.enum(['in', 'out']);

export const PinchArgsSchema = z.object({
  ref: z.string().min(1, 'ref is required'),
  direction: PinchDirectionSchema.optional(),
  scale: z.number().positive().default(2.0),
  durationMs: z.number().int().positive().default(300),
  steps: z.number().int().positive().default(10),
});

export const VisibleTextArgsSchema = z.object({});

export const TapTextArgsSchema = z.object({
  text: z.string().optional(),
  contains: z.string().optional(),
  index: z.number().int().min(0).default(0),
  role: z.string().optional(),
  verify: z.boolean().default(true),
});

export const TapXYArgsSchema = z.object({
  x: z.number('x is required (screen point)'),
  y: z.number('y is required (screen point)'),
  verify: z.boolean().default(true),
});

export const ClickablesArgsSchema = z.object({});

export const FillArgsSchema = z.object({
  text: z.string().min(1, 'text is required (the new value to set)'),
  placeholder: z.string().optional(),
  contains: z.string().optional(),
  value: z.string().optional(),
  index: z.number().int().min(0).default(0),
});

export const WaitGoneArgsSchema = z.object({
  text: z.string().optional(),
  contains: z.string().optional(),
  timeoutMs: z.number().int().positive().default(5000),
});

export const FindArgsSchema = z.object({
  text: z.string().optional(),
  testID: z.string().optional(),
  name: z.string().optional(),
  role: z.string().optional(),
  pressable: z.boolean().default(false),
  refresh: z.boolean().default(false),
  limit: z.number().int().min(1).max(50).default(10),
});

export const ScrollIntoViewArgsSchema = z.object({
  text: z.string().optional(),
  contains: z.string().optional(),
  testID: z.string().optional(),
  ref: z.string().optional(),
  maxSwipes: z.number().int().min(1).max(20).default(8),
  swipeDistance: z.number().default(500),
});

// ─── Tool result schemas ──────────────────────────────────────────────

const ResultExtras = z.object({
  refsStillValid: z.boolean().optional(),
  durationMs: z.number().optional(),
});

export const InspectResultSchema = z.object({
  tree: TreeNodeSchema.nullable(),
  totalNodes: z.number().int(),
  prunedNodes: z.number().int(),
  renderTimeMs: z.number(),
}).merge(ResultExtras);

export const SnapshotResultSchema = z.object({
  element: TreeNodeSchema,
  renderTimeMs: z.number(),
}).merge(ResultExtras);

export const TapResultSchema = z.object({
  ok: z.boolean(),
}).merge(ResultExtras);

export const LongPressResultSchema = z.object({
  ok: z.boolean(),
}).merge(ResultExtras);

export const TypeResultSchema = z.object({
  ok: z.boolean(),
  newValue: z.string(),
}).merge(ResultExtras);

export const ScrollToResultSchema = z.object({
  ok: z.boolean(),
  scrolledTo: z.object({ x: z.number(), y: z.number() }),
}).merge(ResultExtras);

export const ExpandListResultSchema = z.object({
  items: z.array(TreeNodeSchema),
  renderedRange: z.tuple([z.number(), z.number()]),
  itemCount: z.number().int(),
  renderTimeMs: z.number(),
}).merge(ResultExtras);

// ─── Tool registry ────────────────────────────────────────────────────

export interface ToolSpec {
  description: string;
  argsSchema: z.ZodType<any>;
  resultSchema: z.ZodType<any>;
}

/**
 * All 26 agent-facing tools — mirrors the relay's VALID_TOOLS exactly.
 * Descriptions match the relay's /tools endpoint.
 */
export const TOOLS: Record<string, ToolSpec> = {
  inspect: {
    description: 'Return the visible React Native tree as JSON (pruned, agent-friendly). Use this first to discover refs.',
    argsSchema: InspectArgsSchema,
    resultSchema: InspectResultSchema,
  },
  snapshot: {
    description: 'Drill into one element + its actual rendered children (deeper than inspect).',
    argsSchema: SnapshotArgsSchema,
    resultSchema: SnapshotResultSchema,
  },
  tap: {
    description: 'Tap (press) an element. Fires onPressIn → onPressOut → onPress on the nearest pressable ancestor.',
    argsSchema: TapArgsSchema,
    resultSchema: TapResultSchema,
  },
  longPress: {
    description: 'Long-press an element. Fires onPressIn → wait → onLongPress → onPressOut.',
    argsSchema: LongPressArgsSchema,
    resultSchema: LongPressResultSchema,
  },
  type: {
    description: 'Set text in a TextInput. Replaces the value (use append:true to append).',
    argsSchema: TypeArgsSchema,
    resultSchema: TypeResultSchema,
  },
  scrollTo: {
    description: 'Programmatically scroll a ScrollView/FlatList. Pass the ref of a scrollable OR an element inside one.',
    argsSchema: ScrollToArgsSchema,
    resultSchema: ScrollToResultSchema,
  },
  expandList: {
    description: 'Scroll a virtualized list (FlatList/SectionList) so items [from..to] are rendered, then return them.',
    argsSchema: ExpandListArgsSchema,
    resultSchema: ExpandListResultSchema,
  },
  swipe: {
    description: 'Swipe/drag from an element by (dx, dy). Fires pressIn → move → pressOut on the scrollable/pressable ancestor.',
    argsSchema: SwipeArgsSchema,
    resultSchema: LooseResultSchema,
  },
  screenshot: {
    description: 'Capture the screen. Returns base64 PNG (native) or a tree fallback.',
    argsSchema: ScreenshotArgsSchema,
    resultSchema: LooseResultSchema,
  },
  waitFor: {
    description: 'Poll inspect until an element with the given testID or text appears. Useful after navigation/async.',
    argsSchema: WaitForArgsSchema,
    resultSchema: LooseResultSchema,
  },
  readScreen: {
    description: 'Extract all visible text as a flat list (fast — no tree).',
    argsSchema: ReadScreenArgsSchema,
    resultSchema: LooseResultSchema,
  },
  layout: {
    description: 'Precise element measurement + overflow detection. The "is it broken?" check.',
    argsSchema: LayoutArgsSchema,
    resultSchema: LooseResultSchema,
  },
  navigate: {
    description: 'Navigate to a route via expo-router (deep link).',
    argsSchema: NavigateArgsSchema,
    resultSchema: LooseResultSchema,
  },
  back: {
    description: 'Go back in the navigation stack.',
    argsSchema: BackArgsSchema,
    resultSchema: LooseResultSchema,
  },
  assertVisible: {
    description: 'Assert an element is visible (waits up to timeoutMs). Throws if not found.',
    argsSchema: AssertVisibleArgsSchema,
    resultSchema: LooseResultSchema,
  },
  assertText: {
    description: "Assert an element's text matches exactly.",
    argsSchema: AssertTextArgsSchema,
    resultSchema: LooseResultSchema,
  },
  assertEnabled: {
    description: 'Assert an element is enabled (not disabled).',
    argsSchema: AssertEnabledArgsSchema,
    resultSchema: LooseResultSchema,
  },
  pinch: {
    description: 'Pinch/zoom gesture (multi-touch). For maps/images with zoom support.',
    argsSchema: PinchArgsSchema,
    resultSchema: LooseResultSchema,
  },
  visibleText: {
    description: 'Lean on-screen inventory: text/value/placeholder/role/testID with REAL frames. Use this instead of raw inspect() + JSON parsing.',
    argsSchema: VisibleTextArgsSchema,
    resultSchema: LooseResultSchema,
  },
  tapText: {
    description: 'Find a visible element by exact text (or contains) and press it. Verifies the screen actually changed; retries up the view hierarchy (icons/labels inside Pressables).',
    argsSchema: TapTextArgsSchema,
    resultSchema: LooseResultSchema,
  },
  tapXY: {
    description: 'Press whatever is at a screen point — deepest element containing (x,y), then its pressable ancestors. Use for icon-only buttons (no text).',
    argsSchema: TapXYArgsSchema,
    resultSchema: LooseResultSchema,
  },
  clickables: {
    description: 'Inventory of tappable-looking elements (accessibilityRole button/tab/etc or pressable-ish names) with refs and frames.',
    argsSchema: ClickablesArgsSchema,
    resultSchema: LooseResultSchema,
  },
  fill: {
    description: 'Find a visible TextInput by placeholder/value/text and set its value (fires onChangeText). No ref hunting.',
    argsSchema: FillArgsSchema,
    resultSchema: LooseResultSchema,
  },
  waitGone: {
    description: 'Poll until a text (exact or contains) disappears from the screen — sheet dismissed, alert cleared, navigation happened.',
    argsSchema: WaitGoneArgsSchema,
    resultSchema: LooseResultSchema,
  },
  find: {
    description: 'Search visible elements without tapping: filter by text (substring on text+accessibilityLabel), testID, name, role, pressable. Use to locate icons/inputs and get refs before acting.',
    argsSchema: FindArgsSchema,
    resultSchema: LooseResultSchema,
  },
  scrollIntoView: {
    description: 'Swipe-scroll until an element (text/contains/testID/ref) is on screen; returns its ref+frame. Throws NOT_VISIBLE if it never becomes visible (says whether it was found-but-offscreen vs not-in-tree).',
    argsSchema: ScrollIntoViewArgsSchema,
    resultSchema: LooseResultSchema,
  },
};
