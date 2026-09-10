#!/usr/bin/env node
/**
 * Mock phone — simulates an expo-eyes-app connection for testing.
 *
 * Connects to ws://localhost:18766, sends hello, then handles one tool call
 * (inspect) by returning a fake tree, and echoes back any other tool with
 * a fake "ok" result.
 */

const WebSocket = require('ws');

const TOKEN = process.env.TOKEN || 'test123';
const URL = process.env.URL || 'ws://localhost:18766';

const ws = new WebSocket(URL);
let authenticated = false;

ws.on('open', () => {
  console.log('[mock-phone] connected, sending hello');
  ws.send(JSON.stringify({
    type: 'hello',
    token: TOKEN,
    app: { name: 'mock-phone', sdkVersion: '0.1.0' },
  }));
});

ws.on('message', (data, isBinary) => {
  if (isBinary) return;
  const msg = JSON.parse(data.toString());
  console.log('[mock-phone] ←', msg.type, msg.tool || '');

  if (msg.type === 'hello-ack') {
    if (msg.ok) {
      console.log('[mock-phone] authenticated ✓');
      authenticated = true;
    } else {
      console.error('[mock-phone] auth failed:', msg.reason);
      process.exit(1);
    }
    return;
  }

  if (msg.type === 'tool-call') {
    console.log('[mock-phone] tool-call:', msg.tool, msg.args);
    let result;
    if (msg.tool === 'inspect') {
      result = {
        tree: {
          ref: 'r0',
          type: 'View',
          layout: { x: 0, y: 0, width: 390, height: 844 },
          children: [
            { ref: 'r1', type: 'Text', text: 'Hello, world!', children: [] },
            { ref: 'r2', type: 'Pressable', testID: 'sign-in', role: 'button', label: 'Sign in', children: [], state: { disabled: false } },
          ],
        },
        totalNodes: 3,
        prunedNodes: 0,
        renderTimeMs: 5,
      };
    } else if (msg.tool === 'tap') {
      result = { ok: true, refsStillValid: true };
    } else {
      result = { ok: true, mocked: true };
    }
    ws.send(JSON.stringify({
      type: 'tool-result',
      callId: msg.callId,
      ok: true,
      result,
      refsStillValid: true,
      durationMs: 1,
    }));
    console.log('[mock-phone] → tool-result sent');
  }
});

ws.on('close', (code, reason) => {
  console.log(`[mock-phone] disconnected: ${code} ${reason.toString()}`);
  process.exit(0);
});

ws.on('error', (e) => {
  console.error('[mock-phone] error:', e.message);
  process.exit(1);
});

// Keep alive for 10 seconds then exit
setTimeout(() => {
  console.log('[mock-phone] 10s elapsed, closing');
  ws.close(1000, 'done');
  process.exit(0);
}, 10000);
