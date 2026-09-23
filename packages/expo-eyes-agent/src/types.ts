/**
 * Type definitions for expo-eyes-agent.
 *
 * This file is the single source of truth for the tool API.
 * - schemas.ts derives zod schemas from these
 * - client.ts uses these for return types
 * - mcp-server.ts uses the zod schemas for tool registration
 * - cli.ts uses these for arg parsing
 *
 * If you change a tool's args or return shape, change it HERE first.
 * The tool set mirrors the relay's /tools endpoint exactly (26 tools).
 */

// ─── Common ───────────────────────────────────────────────────────────

export interface Layout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementState {
  disabled?: boolean;
  pressed?: boolean;
  checked?: boolean | 'mixed';
  selected?: boolean;
  focused?: boolean;
}

export interface TreeNode {
  ref: string;
  /**
   * Stable structural ID — survives re-renders. Use this when you want
   * to refer to "the same element" across inspect() calls.
   *   - "tid:saveBtn"  → testID-based (gold standard, set by dev)
   *   - "h:7a3b2"      → structural hash (computed by SDK)
   * Either can be passed as the `ref` argument to tap/type/etc.
   */
  stableId?: string;
  type: string;
  name?: string;
  text?: string;
  testID?: string;
  role?: string;
  label?: string;
  layout?: Layout;
  state?: ElementState;
  props?: Record<string, unknown>;
  children: TreeNode[];
  truncated?: boolean;
  virtualized?: boolean;
  itemCount?: number;
  renderedRange?: [number, number];
}

/** Flat projected element (visibleText / find / clickables rows). */
export interface ElementRow {
  ref: string;
  name?: string;
  text?: string;
  value?: string;
  placeholder?: string;
  role?: string;
  testID?: string;
  disabled?: boolean;
  frame?: Layout;
  onScreen?: boolean;
  [key: string]: unknown;
}

// ─── Tool arg shapes ──────────────────────────────────────────────────

export interface InspectArgs {
  /** Reserved for v2 (diff mode). v1 ignores. */
  since?: 'last';
}

export interface SnapshotArgs {
  /** Ref ID from a prior inspect() call. */
  ref: string;
}

export interface TapArgs {
  /** Ref ID of the element to tap. */
  ref: string;
}

export interface LongPressArgs {
  /** Ref ID of the element to long-press. */
  ref: string;
  /** Hold duration in milliseconds. Default 500. */
  durationMs?: number;
}

export interface TypeArgs {
  /** Ref ID of a TextInput. */
  ref: string;
  /** Text to set. Replaces existing value unless append=true. */
  text: string;
  /** If true, append to existing value instead of replacing. */
  append?: boolean;
}

export type ScrollDirection = 'up' | 'down' | 'left' | 'right';

export interface ScrollToArgs {
  /** Ref ID of a scrollable OR an element inside one. */
  ref: string;
  /** Target x offset. Default 0. */
  x?: number;
  /** Target y offset. Default 0. */
  y?: number;
  /** Animate the scroll. Default true. */
  animated?: boolean;
  /** Direction mode — overrides x/y. Used with `amount`. */
  direction?: ScrollDirection;
  /** Pixel amount (used with direction). */
  amount?: number;
}

export interface ExpandListArgs {
  /** Ref ID of a FlatList / SectionList / FlashList. */
  listRef: string;
  /** First item index to render. Default 0. */
  from?: number;
  /** Last item index to render (inclusive). Default from + 14. */
  to?: number;
}

export interface SwipeArgs {
  /** Ref ID of the element to start the swipe from. */
  ref: string;
  /** Horizontal offset in px. */
  dx?: number;
  /** Vertical offset in px (negative = up). */
  dy?: number;
  /** Gesture duration. Default 250. */
  durationMs?: number;
  /** Interpolation steps. Default 10. */
  steps?: number;
}

export interface ScreenshotArgs {
  /** Optional ref — capture a specific view instead of the whole screen. */
  ref?: string;
}

export interface WaitForArgs {
  testID?: string;
  /** Substring match. */
  text?: string;
  timeoutMs?: number;
  intervalMs?: number;
}

export interface ReadScreenArgs {
  // no args
}

export interface LayoutArgs {
  /** Element ref (tid:xxx, r5, or name). Omit to audit ALL elements. */
  ref?: string;
  testID?: string;
}

export interface NavigateArgs {
  /** Route path, e.g. "/playground". */
  route: string;
  params?: Record<string, unknown>;
}

export interface BackArgs {
  // no args
}

export interface AssertVisibleArgs {
  testID?: string;
  /** Substring match. */
  text?: string;
  timeoutMs?: number;
}

export interface AssertTextArgs {
  testID: string;
  /** Expected exact text. */
  text: string;
  timeoutMs?: number;
}

export interface AssertEnabledArgs {
  testID: string;
  timeoutMs?: number;
}

export type PinchDirection = 'in' | 'out';

export interface PinchArgs {
  ref: string;
  /** "in" = zoom out, "out" = zoom in. */
  direction?: PinchDirection;
  scale?: number;
  durationMs?: number;
  steps?: number;
}

export interface VisibleTextArgs {
  // no args
}

export interface TapTextArgs {
  /** Exact text match. */
  text?: string;
  /** Substring fallback. */
  contains?: string;
  index?: number;
  /** accessibilityRole filter. */
  role?: string;
  /** Verify the screen actually changed. Default true. */
  verify?: boolean;
}

export interface TapXYArgs {
  x: number;
  y: number;
  /** Verify the screen actually changed. Default true. */
  verify?: boolean;
}

export interface ClickablesArgs {
  // no args
}

export interface FillArgs {
  /** REQUIRED — the new value to set. */
  text: string;
  /** Substring match on placeholder. */
  placeholder?: string;
  /** Substring match on current value. */
  contains?: string;
  /** Exact match on current value. */
  value?: string;
  index?: number;
}

export interface WaitGoneArgs {
  /** Exact text. */
  text?: string;
  /** Substring. */
  contains?: string;
  timeoutMs?: number;
}

export interface FindArgs {
  /** Substring on text or accessibilityLabel. */
  text?: string;
  /** Substring on testID. */
  testID?: string;
  /** Component type substring, e.g. "Pressable". */
  name?: string;
  /** Exact accessibilityRole. */
  role?: string;
  /** Only likely-tappable elements. Default false. */
  pressable?: boolean;
  /** Force re-scan. Default false. */
  refresh?: boolean;
  /** Max results (1–50). Default 10. */
  limit?: number;
}

export interface ScrollIntoViewArgs {
  /** Exact text first, then substring fallback. */
  text?: string;
  contains?: string;
  testID?: string;
  ref?: string;
  maxSwipes?: number;
  /** Pixels per swipe. Default 500. */
  swipeDistance?: number;
}

// ─── Tool result shapes ───────────────────────────────────────────────

export interface InspectResult {
  tree: TreeNode | null;
  totalNodes: number;
  prunedNodes: number;
  renderTimeMs: number;
  /** Added by the relay — whether refs are still valid after this call. */
  refsStillValid?: boolean;
  /** Added by the relay — round-trip duration. */
  durationMs?: number;
}

export interface SnapshotResult {
  element: TreeNode;
  renderTimeMs: number;
  refsStillValid?: boolean;
  durationMs?: number;
}

export interface TapResult {
  ok: boolean;
  refsStillValid?: boolean;
  durationMs?: number;
  [key: string]: unknown;
}

export interface LongPressResult {
  ok: boolean;
  refsStillValid?: boolean;
  durationMs?: number;
  [key: string]: unknown;
}

export interface TypeResult {
  ok: boolean;
  newValue: string;
  refsStillValid?: boolean;
  durationMs?: number;
  [key: string]: unknown;
}

export interface ScrollToResult {
  ok: boolean;
  scrolledTo: { x: number; y: number };
  refsStillValid?: boolean;
  durationMs?: number;
  [key: string]: unknown;
}

export interface ExpandListResult {
  items: TreeNode[];
  renderedRange: [number, number];
  itemCount: number;
  renderTimeMs: number;
  refsStillValid?: boolean;
  durationMs?: number;
  [key: string]: unknown;
}

/**
 * Composite / newer tools return heterogeneous payloads that evolve with the
 * relay. They share `ok` when applicable but are intentionally loose — use
 * the relay's /tools endpoint for the authoritative shape.
 */
export interface LooseResult {
  ok?: boolean;
  [key: string]: unknown;
}

export type SwipeResult = LooseResult;
export type ScreenshotResult = LooseResult;
export type WaitForResult = LooseResult;
export type ReadScreenResult = LooseResult;
export type LayoutResult = LooseResult;
export type NavigateResult = LooseResult;
export type BackResult = LooseResult;
export type AssertVisibleResult = LooseResult;
export type AssertTextResult = LooseResult;
export type AssertEnabledResult = LooseResult;
export type PinchResult = LooseResult;
export type VisibleTextResult = LooseResult;
export type TapTextResult = LooseResult;
export type TapXYResult = LooseResult;
export type ClickablesResult = LooseResult;
export type FillResult = LooseResult;
export type WaitGoneResult = LooseResult;
export type FindResult = LooseResult;
export type ScrollIntoViewResult = LooseResult;

// ─── Events ───────────────────────────────────────────────────────────

export interface LogEvent {
  type: 'event';
  event: 'log';
  level: 'log' | 'warn' | 'error' | 'info';
  args: unknown[];
  timestamp: number;
}

export interface ErrorEvent {
  type: 'event';
  event: 'error';
  message: string;
  stack?: string;
  timestamp: number;
}

export type PhoneEvent = LogEvent | ErrorEvent;

// ─── Tool name → args/result mapping ──────────────────────────────────

export interface ToolMap {
  inspect: { args: InspectArgs; result: InspectResult };
  snapshot: { args: SnapshotArgs; result: SnapshotResult };
  tap: { args: TapArgs; result: TapResult };
  longPress: { args: LongPressArgs; result: LongPressResult };
  type: { args: TypeArgs; result: TypeResult };
  scrollTo: { args: ScrollToArgs; result: ScrollToResult };
  expandList: { args: ExpandListArgs; result: ExpandListResult };
  swipe: { args: SwipeArgs; result: SwipeResult };
  screenshot: { args: ScreenshotArgs; result: ScreenshotResult };
  waitFor: { args: WaitForArgs; result: WaitForResult };
  readScreen: { args: ReadScreenArgs; result: ReadScreenResult };
  layout: { args: LayoutArgs; result: LayoutResult };
  navigate: { args: NavigateArgs; result: NavigateResult };
  back: { args: BackArgs; result: BackResult };
  assertVisible: { args: AssertVisibleArgs; result: AssertVisibleResult };
  assertText: { args: AssertTextArgs; result: AssertTextResult };
  assertEnabled: { args: AssertEnabledArgs; result: AssertEnabledResult };
  pinch: { args: PinchArgs; result: PinchResult };
  visibleText: { args: VisibleTextArgs; result: VisibleTextResult };
  tapText: { args: TapTextArgs; result: TapTextResult };
  tapXY: { args: TapXYArgs; result: TapXYResult };
  clickables: { args: ClickablesArgs; result: ClickablesResult };
  fill: { args: FillArgs; result: FillResult };
  waitGone: { args: WaitGoneArgs; result: WaitGoneResult };
  find: { args: FindArgs; result: FindResult };
  scrollIntoView: { args: ScrollIntoViewArgs; result: ScrollIntoViewResult };
}

export type ToolName = keyof ToolMap;
