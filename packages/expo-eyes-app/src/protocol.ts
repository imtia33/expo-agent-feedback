/**
 * Shared wire protocol between expo-eyes-app (phone) and expo-eyes-relay (laptop).
 *
 * All messages are JSON. Two channels:
 *   1. Phone → Relay: results, events
 *   2. Relay → Phone: tool calls
 *
 * Every message has a `type` field. Tool calls and results share a `callId`
 * so the relay can correlate them.
 */

// ─── Tool call (Relay → Phone) ────────────────────────────────────────

export interface ToolCall {
  type: 'tool-call';
  callId: string;
  tool: PrimitiveName;  // app only accepts the 5 primitives
  args: Record<string, any>;
}

// ─── Tool result (Phone → Relay) ──────────────────────────────────────

export interface ToolResultOk {
  type: 'tool-result';
  callId: string;
  ok: true;
  result: any;
  refsStillValid: boolean;
  durationMs: number;
}

export interface ToolResultErr {
  type: 'tool-result';
  callId: string;
  ok: false;
  error: {
    code: string;
    message: string;
    stack?: string;
  };
  durationMs: number;
}

export type ToolResult = ToolResultOk | ToolResultErr;

// ─── Events (Phone → Relay) ───────────────────────────────────────────

export interface LogEvent {
  type: 'event';
  event: 'log';
  level: 'log' | 'warn' | 'error' | 'info';
  args: any[];
  timestamp: number;
}

export interface ErrorEvent {
  type: 'event';
  event: 'error';
  message: string;
  stack?: string;
  timestamp: number;
}

export interface PhoneReadyEvent {
  type: 'event';
  event: 'phone-ready';
  app: { name: string; sdkVersion: string };
  timestamp: number;
}

export type PhoneEvent = LogEvent | ErrorEvent | PhoneReadyEvent;

// ─── Primitive names (app side) ───────────────────────────────────────
//
// The app SDK exposes only these 5 primitives. The relay implements the
// agent-facing tools (inspect, snapshot, tap, type, scrollTo, expandList,
// longPress) by composing these primitives.

export type PrimitiveName =
  | 'getTree'        // → raw fiber tree (no refs/stableIds/pruning)
  | 'dispatchEvent'  // → fire onPress/onChangeText/etc. on a fiber
  | 'readLayout'     // → x/y/width/height for a fiber
  | 'scroll'         // → scrollTo on a scrollable fiber
  | 'scrollToIndex'; // → scrollToIndex on a list fiber

// Backward-compat alias
export type ToolName = PrimitiveName;

// ─── Tree node shape (returned by inspect/snapshot) ───────────────────

export interface TreeNode {
  /** Stable opaque ID within the current inspection session. Use as ref. */
  ref: string;
  /**
   * Stable structural hash (6 chars), survives across inspect() calls and
   * re-renders. Computed from type + text + label + testID + path from root.
   * Use this when you want to refer to "the same element" across calls
   * even if its positional ref changes.
   * Falls back to testID if set (testID is the gold standard).
   */
  stableId?: string;
  /** Component type, e.g. 'View', 'Text', 'Pressable', 'TextInput', 'FlatList'. */
  type: string;
  /** Display name for composite components, e.g. 'SignInForm'. */
  name?: string;
  /** Text content (for Text / Button). */
  text?: string;
  /** testID prop value, if set. */
  testID?: string;
  /** Accessibility role. */
  role?: string;
  /** Accessibility label / name. */
  label?: string;
  /** Screen-absolute layout. */
  layout?: { x: number; y: number; width: number; height: number };
  /** Agent-relevant state. */
  state?: {
    disabled?: boolean;
    pressed?: boolean;
    checked?: boolean | 'mixed';
    selected?: boolean;
    focused?: boolean;
  };
  /** Props we surface (whitelisted only — never the full props bag). */
  props?: Record<string, any>;
  /** Children. Always present, possibly empty. */
  children: TreeNode[];
  /** True if this node was elided because of pruning. */
  truncated?: boolean;
  /** True if this is a virtualized list (FlatList / SectionList / FlashList). */
  virtualized?: boolean;
  /** For virtualized lists: total item count from props.data. */
  itemCount?: number;
  /** For virtualized lists: indices currently rendered. */
  renderedRange?: [number, number];
}

// ─── Auth handshake ───────────────────────────────────────────────────

export interface PhoneHello {
  type: 'hello';
  token: string;
  app: { name: string; sdkVersion: string };
}

export interface RelayHello {
  type: 'hello-ack';
  ok: boolean;
  reason?: string;
}

// ─── Top-level message union ──────────────────────────────────────────

export type PhoneToRelay = PhoneHello | ToolResult | PhoneEvent;
export type RelayToPhone = RelayHello | ToolCall;
