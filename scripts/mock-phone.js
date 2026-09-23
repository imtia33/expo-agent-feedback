#!/usr/bin/env node
/**
 * mock-phone.js — a fake "phone" for testing the expo-eyes chain without a
 * real device. Connects to the relay's phone-facing WebSocket, authenticates,
 * and answers every primitive the relay can send.
 *
 * Simulates a tiny screen:
 *   ┌──────────────────────────┐
 *   │  Welcome header          │
 *   │  email input (TextInput) │
 *   │  [ Sign in ]  (button)   │  ← pressing it toggles to "Signed in!"
 *   └──────────────────────────┘
 * Toggling the button text matters: `tapText --verify` checks that the
 * screen CHANGED after a press, so the mock proves the full loop works.
 *
 * Usage (from the repo root):
 *   npm run mock-phone                       # ws://localhost:8766, no token
 *   EXPO_EYES_WS_URL=ws://192.168.1.5:8766 EXPO_EYES_TOKEN=secret npm run mock-phone
 */

const WebSocket = require('ws');

const url = process.env.EXPO_EYES_WS_URL || process.env.URL || 'ws://localhost:8766';
const token = process.env.EXPO_EYES_TOKEN || process.env.TOKEN || '';
const startedAt = Date.now();

// ─── The fake screen (flat element list, mirrors listVisibleElements) ──

let pressCount = 0;

function screenElements() {
  return [
    {
      viewTag: 1,
      name: 'View',
      depth: 0,
      frame: { x: 0, y: 0, width: 360, height: 640 },
      hierarchy: ['View'],
      props: { testID: 'root' },
    },
    {
      viewTag: 2,
      name: 'Text',
      depth: 1,
      frame: { x: 16, y: 40, width: 328, height: 32 },
      hierarchy: ['View', 'Text'],
      props: { text: 'Welcome to the mock phone' },
    },
    {
      viewTag: 3,
      name: 'TextInput',
      depth: 1,
      frame: { x: 16, y: 100, width: 328, height: 44 },
      hierarchy: ['View', 'TextInput'],
      props: { placeholder: 'you@example.com', value: '', accessibilityRole: 'textinput' },
    },
    {
      viewTag: 4,
      name: 'Pressable',
      depth: 1,
      frame: { x: 16, y: 180, width: 328, height: 48 },
      hierarchy: ['View', 'Pressable'],
      props: {
        testID: 'sign-in',
        accessibilityRole: 'button',
        // Pressing toggles the label — screen-change verification depends on it.
        text: pressCount === 0 ? 'Sign in' : `Signed in! (×${pressCount})`,
      },
    },
    {
      viewTag: 5,
      name: 'ScrollView',
      depth: 1,
      frame: { x: 0, y: 260, width: 360, height: 380 },
      hierarchy: ['View', 'ScrollView'],
      props: {},
    },
  ];
}

// ─── Primitive handlers ────────────────────────────────────────────────

const handlers = {
  ping() {
    return { pong: true, phoneTime: Date.now(), uptimeMs: Date.now() - startedAt, appState: 'active' };
  },

  diagnostics() {
    return {
      ok: true,
      uptimeMs: Date.now() - startedAt,
      platform: 'mock',
      primitives: Object.keys(handlers),
      pressCount,
    };
  },

  listVisibleElements() {
    return { elements: screenElements(), scanned: Date.now(), renderTimeMs: 1 };
  },

  inspectAtPoint({ x, y }) {
    const hit = screenElements().find(
      (e) => x >= e.frame.x && x <= e.frame.x + e.frame.width && y >= e.frame.y && y <= e.frame.y + e.frame.height,
    );
    return { element: hit || null, renderTimeMs: 1 };
  },

  dispatchEvent({ viewTag, event, text }) {
    const el = screenElements().find((e) => e.viewTag === viewTag);
    if (!el) return { ok: false, debug: { reason: 'viewTag not found' } };
    if (el.props.testID === 'sign-in' && event === 'press') {
      pressCount++;
      return { ok: true, debug: { handler: 'onPress', newLabel: `Signed in! (×${pressCount})` } };
    }
    if (el.name === 'TextInput' && event === 'changeText') {
      el.props.value = text ?? '';
      return { ok: true, debug: { newValue: el.props.value } };
    }
    return { ok: true, debug: { handler: event, note: 'mock accepts all events' } };
  },

  scroll({ y }) {
    return { ok: true, scrolledTo: { x: 0, y: y || 0 } };
  },

  scrollToIndex({ index }) {
    return { ok: true, index: index ?? 0 };
  },

  swipe() {
    return { ok: true };
  },

  pinch() {
    return { ok: true };
  },

  screenshot() {
    // Expo Go has no native capture — mirror the tree-fallback shape.
    return { ok: true, format: 'tree-fallback', width: 360, height: 640, fallback: true };
  },

  waitForElement({ text, testID }) {
    const el = screenElements().find((e) => e.props.text === text || e.props.testID === testID);
    return { ok: true, found: !!el, element: el || null, waitedMs: 0 };
  },

  readScreen() {
    const texts = screenElements()
      .filter((e) => e.props.text)
      .map((e) => ({ text: e.props.text, testID: e.props.testID, frame: e.frame }));
    return { texts, count: texts.length };
  },

  layout({ testID }) {
    const el = screenElements().find((e) => e.props.testID === testID) || screenElements()[1];
    return { element: { frame: el.frame, issues: [] }, allIssues: [], totalElements: screenElements().length, elementsWithIssues: 0 };
  },

  navigate() {
    return { ok: true };
  },

  back() {
    return { ok: true };
  },

  assertVisible({ text, testID }) {
    const el = screenElements().find((e) => e.props.text === text || e.props.testID === testID);
    return { ok: true, passed: !!el, message: el ? `visible: ${el.props.testID || el.props.text}` : 'not found', details: el || undefined };
  },

  assertText({ testID, text }) {
    const el = screenElements().find((e) => e.props.testID === testID);
    const passed = !!el && el.props.text === text;
    return { ok: true, passed, message: passed ? 'match' : `expected ${JSON.stringify(text)}, got ${JSON.stringify(el?.props.text)}` };
  },

  assertEnabled({ testID }) {
    const el = screenElements().find((e) => e.props.testID === testID);
    return { ok: true, passed: !!el && el.props.disabled !== true, message: 'enabled' };
  },
};

// ─── WS wiring ─────────────────────────────────────────────────────────

function connect() {
  const ws = new WebSocket(url);
  let authenticated = false;

  ws.on('open', () => {
    ws.send(JSON.stringify({
      type: 'hello',
      token,
      app: {
        name: 'mock-phone',
        sdkVersion: '0.1.0-alpha.1',
        deviceId: `mock-${process.pid}`,
        deviceName: 'Mock Phone (Node.js)',
      },
    }));
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    if (msg.type === 'hello-ack') {
      if (msg.ok) {
        console.log('[mock-phone] authenticated — ready to receive tool calls');
        authenticated = true;
      } else {
        console.error('[mock-phone] auth failed:', msg.reason);
        process.exit(1);
      }
      return;
    }

    if (msg.type === 'tool-call' && authenticated) {
      const handler = handlers[msg.tool];
      let result;
      let ok = true;
      try {
        result = handler ? handler(msg.args || {}) : { mocked: true, note: `no handler for "${msg.tool}"` };
      } catch (e) {
        ok = false;
        result = null;
        ws.send(JSON.stringify({
          type: 'tool-result',
          callId: msg.callId,
          ok: false,
          error: { code: 'MOCK_ERROR', message: e.message },
          durationMs: 1,
        }));
        return;
      }
      console.log(`[mock-phone] ${msg.tool}(${JSON.stringify(msg.args || {}).slice(0, 80)}) → ok`);
      ws.send(JSON.stringify({
        type: 'tool-result',
        callId: msg.callId,
        ok,
        result,
        refsStillValid: true,
        durationMs: 1,
      }));
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[mock-phone] disconnected (code=${code}${reason ? ` ${reason.toString()}` : ''}) — reconnecting in 2s`);
    setTimeout(connect, 2000);
  });

  ws.on('error', (e) => {
    console.error('[mock-phone] ws error:', e.message);
  });
}

console.log(`[mock-phone] connecting to ${url}${token ? ' (with token)' : ' (no token)'}`);
connect();
