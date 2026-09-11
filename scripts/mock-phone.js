const WebSocket = require('ws');
const TOKEN = process.env.TOKEN || '';
const URL = process.env.URL || 'ws://localhost:18766';

const ws = new WebSocket(URL);
let authenticated = false;

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'hello',
    token: TOKEN,
    app: { name: 'mock-phone', sdkVersion: '0.1.0' },
  }));
});

ws.on('message', (data, isBinary) => {
  if (isBinary) return;
  const msg = JSON.parse(data.toString());

  if (msg.type === 'hello-ack') {
    if (msg.ok) {
      console.log('[mock-phone] authenticated');
      authenticated = true;
    } else {
      console.error('[mock-phone] auth failed:', msg.reason);
      process.exit(1);
    }
    return;
  }

  if (msg.type === 'tool-call') {
    console.log('[mock-phone] ←', msg.tool, JSON.stringify(msg.args).slice(0, 100));
    let result;
    if (msg.tool === 'getTree') {
      result = {
        tree: {
          fid: 1, type: 'View',
          children: [
            { fid: 2, type: 'Text', text: 'Hello, world!', children: [] },
            { fid: 3, type: 'Pressable', testID: 'sign-in', role: 'button', label: 'Sign in',
              state: { disabled: false }, children: [] },
          ],
        },
        nodeCount: 3,
        renderTimeMs: 5,
      };
    } else if (msg.tool === 'dispatchEvent') {
      result = { ok: true };
    } else if (msg.tool === 'scroll' || msg.tool === 'scrollToIndex') {
      result = { ok: true, scrolledTo: { x: 0, y: msg.args.y || 0 } };
    } else {
      result = { mocked: true };
    }
    ws.send(JSON.stringify({
      type: 'tool-result',
      callId: msg.callId,
      ok: true,
      result,
      refsStillValid: true,
      durationMs: 1,
    }));
  }
});

ws.on('close', () => process.exit(0));
ws.on('error', (e) => { console.error('[mock-phone]', e.message); process.exit(1); });
setTimeout(() => { ws.close(); process.exit(0); }, 15000);
