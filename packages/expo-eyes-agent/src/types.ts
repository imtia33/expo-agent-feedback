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
}

export interface LongPressResult {
  ok: boolean;
  refsStillValid?: boolean;
  durationMs?: number;
}

export interface TypeResult {
  ok: boolean;
  newValue: string;
  refsStillValid?: boolean;
  durationMs?: number;
}

export interface ScrollToResult {
  ok: boolean;
  scrolledTo: { x: number; y: number };
  refsStillValid?: boolean;
  durationMs?: number;
}

export interface ExpandListResult {
  items: TreeNode[];
  renderedRange: [number, number];
  itemCount: number;
  renderTimeMs: number;
  refsStillValid?: boolean;
  durationMs?: number;
}

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
}

export type ToolName = keyof ToolMap;
