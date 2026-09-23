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
// The app SDK exposes these primitives over WS. The relay composes them
// into the 26 agent-facing tools (inspect, tap, visibleText, fill, …).
// Keep this union in sync with PRIMITIVES in EyesProvider.tsx.

export type PrimitiveName =
  | 'inspectAtPoint'      // → element at a screen point (RN inspector API)
  | 'listVisibleElements' // → flat list of visible elements with frames
  | 'dispatchEvent'       // → fire onPress/onChangeText/etc. on a viewTag
  | 'scroll'              // → scrollTo / scrollBy on a scrollable
  | 'scrollToIndex'       // → scrollToIndex on a list
  | 'diagnostics'         // → runtime diagnostics dump
  | 'swipe'               // → drag gesture between two points
  | 'screenshot'          // → base64 PNG capture (tree fallback in Expo Go)
  | 'waitForElement'      // → poll for a testID/text to appear
  | 'readScreen'          // → flat list of visible texts
  | 'layout'              // → precise measurement + overflow audit
  | 'navigate'            // → expo-router deep link
  | 'back'                // → navigation goBack
  | 'assertVisible'       // → assert element on screen
  | 'assertText'          // → assert exact text
  | 'assertEnabled'       // → assert not disabled
  | 'pinch'               // → multi-touch zoom gesture
  | 'ping';               // → liveness pong + uptime + appState

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
