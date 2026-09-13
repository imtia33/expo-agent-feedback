/**
 * http-server.js — agent-facing HTTP API.
 *
 * Pattern verified against Express 5.2.1 (see docs/libraries/express-API-summary.md).
 *
 * Key Express 5 specifics we use:
 *   - `app.listen(port, host, callback)` — callback receives errors (v5 breaking change)
 *   - `express.json()` middleware must be mounted BEFORE routes
 *   - 4-arg error handler signature
 *   - Async handlers auto-forward rejections to error handler
 *   - `res.status(code).json(obj)` (not `res.json(obj, code)`)
 *
 * Endpoints:
 *   GET  /health                → relay + phone status
 *   GET  /tools                 → list available tools + their arg schemas
 *   POST /tool/:name            → invoke a tool by name, body = args
 *   GET  /events?since=N        → recent phone events (log/error stream)
 *   GET  /status                → session status (alias for /health)
 *
 * Auth: every request must carry `Authorization: Bearer <token>` matching
 * config.token. /health is exempt so basic monitoring works.
 */

const express = require('express');
const config = require('./config');
const session = require('./session-manager');

const VALID_TOOLS = new Set([
  'inspect',
  'snapshot',
  'tap',
  'longPress',
  'type',
  'scrollTo',
  'expandList',
  'swipe',
  'screenshot',
  'waitFor',
  'readScreen',
  'layout',
  'navigate',
  'back',
  'assertVisible',
  'assertText',
  'assertEnabled',
  'pinch',
  'visibleText',
  'tapText',
  'tapXY',
  'clickables',
  'fill',
  'waitGone',
  'find',
  'scrollIntoView',
]);

const TOOL_SCHEMAS = {
  inspect: {
    description: 'Return the visible React tree as JSON (pruned, agent-friendly).',
    args: {},
    returns: '{ tree, totalNodes, prunedNodes, renderTimeMs }',
  },
  snapshot: {
    description: 'Drill into one element + its actual rendered children (deeper than inspect).',
    args: { ref: 'string (required) — ref ID from a prior inspect()' },
    returns: '{ element, renderTimeMs }',
  },
  tap: {
    description: 'Tap (press) an element. Fires onPressIn → onPressOut → onPress on the nearest pressable ancestor.',
    args: { ref: 'string (required)' },
    returns: '{ ok, refsStillValid }',
  },
  longPress: {
    description: 'Long-press an element. Fires onPressIn → wait → onLongPress → onPressOut.',
    args: { ref: 'string (required)', durationMs: 'number (default 500)' },
    returns: '{ ok, refsStillValid }',
  },
  type: {
    description: 'Set text in a TextInput. Replaces the value (use append:true to append).',
    args: { ref: 'string (required)', text: 'string (required)', append: 'boolean (default false)' },
    returns: '{ ok, refsStillValid, newValue }',
  },
  scrollTo: {
    description: 'Programmatically scroll a ScrollView/FlatList. Pass the ref of a scrollable OR an element inside one.',
    args: {
      ref: 'string (required)',
      x: 'number (default 0)',
      y: 'number (default 0)',
      animated: 'boolean (default true)',
      direction: "'up'|'down'|'left'|'right' (optional, overrides x/y)",
      amount: 'number (used with direction)',
    },
    returns: '{ ok, scrolledTo: {x, y}, refsStillValid }',
  },
  expandList: {
    description: 'Scroll a virtualized list (FlatList/SectionList) so items [from..to] are rendered, then return them.',
    args: {
      listRef: 'string (required) — ref of the FlatList',
      from: 'number (default 0)',
      to: 'number (default from + 14)',
    },
    returns: '{ items, renderedRange: [from, to], itemCount, renderTimeMs }',
  },
  swipe: {
    description: 'Swipe/drag from an element by (dx, dy). Fires pressIn → move → pressOut on the scrollable/pressable ancestor.',
    args: {
      ref: 'string (required) — element to start the swipe from',
      dx: 'number (required) — horizontal offset in px',
      dy: 'number (required) — vertical offset in px (negative = up)',
      durationMs: 'number (default 250)',
      steps: 'number (default 10)',
    },
    returns: '{ ok }',
  },
  screenshot: {
    description: 'Capture the screen. Returns base64 PNG (native) or a tree fallback.',
    args: { ref: 'string (optional — capture a specific view instead of the whole screen)' },
    returns: '{ ok, dataUrl?, format, width, height, fallback? }',
  },
  waitFor: {
    description: 'Poll inspect until an element with the given testID or text appears. Useful after navigation/async.',
    args: {
      testID: 'string (optional)',
      text: 'string (optional — substring match)',
      timeoutMs: 'number (default 5000)',
      intervalMs: 'number (default 300)',
    },
    returns: '{ ok, found, element?, waitedMs }',
  },
  readScreen: {
    description: 'Extract all visible text as a flat list (fast — no tree).',
    args: {},
    returns: '{ texts: [{text, testID?, frame?}], count }',
  },
  layout: {
    description: 'Precise element measurement + overflow detection. The "is it broken?" check.',
    args: {
      ref: 'string (optional) — element ref (tid:xxx, r5, or name). If omitted, audits ALL elements.',
      testID: 'string (optional) — element testID',
    },
    returns: '{ element: {frame, issues}, allIssues: [...], totalElements, elementsWithIssues }',
  },
  navigate: {
    description: 'Navigate to a route via expo-router (deep link).',
    args: {
      route: 'string (required) — route path, e.g. "/playground"',
      params: 'object (optional) — route params',
    },
    returns: '{ ok }',
  },
  back: {
    description: 'Go back in the navigation stack.',
    args: {},
    returns: '{ ok }',
  },
  assertVisible: {
    description: 'Assert an element is visible (waits up to timeoutMs). Throws if not found.',
    args: {
      testID: 'string (optional)',
      text: 'string (optional — substring match)',
      timeoutMs: 'number (default 3000)',
    },
    returns: '{ ok, passed, message, details? }',
  },
  assertText: {
    description: 'Assert an element\'s text matches exactly.',
    args: {
      testID: 'string (required)',
      text: 'string (required) — expected text',
      timeoutMs: 'number (default 3000)',
    },
    returns: '{ ok, passed, message, details? }',
  },
  assertEnabled: {
    description: 'Assert an element is enabled (not disabled).',
    args: {
      testID: 'string (required)',
      timeoutMs: 'number (default 3000)',
    },
    returns: '{ ok, passed, message }',
  },
  visibleText: {
    description: 'Lean on-screen inventory: text/value/placeholder/role/testID with REAL frames. Use this instead of raw inspect() + JSON parsing.',
    args: {},
    returns: '{ count, elements: [{ ref, name, text, value, placeholder, role, testID, disabled, frame }] }',
  },
  tapText: {
    description: 'Find a visible element by exact text (or contains) and press it. Verifies the screen actually changed; retries up the view hierarchy (icons/labels inside Pressables).',
    args: { text: 'string (exact match)', contains: 'string (substring, fallback)', index: 'number (default 0)', role: 'string (accessibilityRole filter)', verify: 'boolean (default true — screen-change check)' },
    returns: '{ ok, tapped, matchCount, pressed, screenChanged }',
  },
  tapXY: {
    description: 'Press whatever is at a screen point — deepest element containing (x,y), then its pressable ancestors. Use for icon-only buttons (no text).',
    args: { x: 'number (required)', y: 'number (required)', verify: 'boolean (default true)' },
    returns: '{ ok, tapped, candidates, pressed, screenChanged }',
  },
  clickables: {
    description: 'Inventory of tappable-looking elements (accessibilityRole button/tab/etc or pressable-ish names) with refs and frames.',
    args: {},
    returns: '{ count, elements: [{ ref, name, text, role, frame }] }',
  },
  fill: {
    description: 'Find a visible TextInput by placeholder/value/text and set its value (fires onChangeText). No ref hunting.',
    args: { text: 'string (REQUIRED — the new value)', placeholder: 'string (substring match on placeholder)', contains: 'string (substring match on current value)', value: 'string (exact match on current value)', index: 'number (default 0)' },
    returns: '{ ok, filled, newValue, matchCount }',
  },
  waitGone: {
    description: 'Poll until a text (exact or contains) disappears from the screen — sheet dismissed, alert cleared, navigation happened.',
    args: { text: 'string (exact)', contains: 'string (substring)', timeoutMs: 'number (default 5000)' },
    returns: '{ ok, gone, elapsedMs }',
  },
  find: {
    description: 'Search visible elements without tapping: filter by text (substring on text+accessibilityLabel), testID, name, role, pressable. Use to locate icons/inputs and get refs before acting.',
    args: {
      text: 'string (optional — substring on text or accessibilityLabel)',
      testID: 'string (optional — substring on testID)',
      name: 'string (optional — component type substring, e.g. "Pressable")',
      role: 'string (optional — exact accessibilityRole)',
      pressable: 'boolean (default false — only likely-tappable elements)',
      refresh: 'boolean (default false — force re-scan)',
      limit: 'number (default 10, max 50)',
    },
    returns: '{ count, matches: [{ ref, name, text, value, placeholder, role, testID, disabled, frame, viewTag, onScreen }] }',
  },
  scrollIntoView: {
    description: 'Swipe-scroll until an element (text/contains/testID/ref) is on screen; returns its ref+frame. Throws NOT_VISIBLE if it never becomes visible (says whether it was found-but-offscreen vs not-in-tree).',
    args: {
      text: 'string (exact first, then substring fallback)',
      contains: 'string (substring)',
      testID: 'string (substring)',
      ref: 'string (r-style ref)',
      maxSwipes: 'number (default 8, max 20)',
      swipeDistance: 'number (default 500 px per swipe)',
    },
    returns: '{ ok, found: { ref, name, text, frame, viewTag, onScreen }, swipes }',
  },
  pinch: {
    description: 'Pinch/zoom gesture (multi-touch). For maps/images with zoom support.',
    args: {
      ref: 'string (required) — element to pinch',
      direction: '"in" | "out" (in = zoom out, out = zoom in)',
      scale: 'number (default 2.0)',
      durationMs: 'number (default 300)',
      steps: 'number (default 10)',
    },
    returns: '{ ok }',
  },
};

function authMiddleware(req, res, next) {
  // /, /health, /status, /ping, /diagnostics are exempt (read-only monitoring)
  if (req.path === '/' || req.path === '/health' || req.path === '/status' || req.path === '/ping' || req.path === '/diagnostics') {
    return next();
  }
  // If no token is configured, skip auth (open relay, LAN-only mode).
  if (config.token === null) {
    return next();
  }
  const auth = req.get('Authorization') || '';
  const expected = `Bearer ${config.token}`;
  if (auth !== expected) {
    return res.status(401).json({ error: 'unauthorized', message: 'Missing or invalid Authorization header. Expected: Bearer <token>' });
  }
  next();
}

function corsMiddleware(req, res, next) {
  if (config.corsEnabled) {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
  }
  next();
}

function startHttpServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(corsMiddleware);
  app.use(authMiddleware);

  // ─── Root & Health (no auth required) ─────────────────────────────────
  app.get('/', (_req, res) => {
    res.json({
      ok: true,
      service: 'expo-eyes-relay',
      relay: { httpPort: config.httpPort, wsPort: config.wsPort, tunnel: !!config.tunnel },
      appUrl: session.appUrl || null,
      phone: session.getStatus(),
      endpoints: ['/health', '/status', '/tools', '/tool/:name', '/events'],
    });
  });

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      relay: { httpPort: config.httpPort, wsPort: config.wsPort, tunnel: !!config.tunnel },
      appUrl: session.appUrl || null,
      phone: session.getStatus(),
    });
  });

  // ─── Diagnostics (calls the phone's diagnostics primitive directly) ──
  app.get('/diagnostics', async (_req, res) => {
    try {
      const result = await session.callTool('diagnostics', {});
      res.json({ ok: true, diagnostics: result });
    } catch (e) {
      res.status(500).json({ ok: false, error: { code: e.code || 'ERROR', message: e.message } });
    }
  });

  app.get('/status', (_req, res) => {
    res.json(session.getStatus());
  });

  // ─── Ping (end-to-end liveness: relay → WS → phone → back) ─────────
  app.get('/ping', async (req, res) => {
    const timeoutMs = Math.min(parseInt(req.query.timeout, 10) || 4000, 10000);
    const result = await session.pingPhone(req.query.session || undefined, timeoutMs);
    const status = session.getStatus();
    const ok = result.phoneReplied === true;
    res.json({
      ok,
      ...result,
      phones: status.phones,
      pendingCalls: status.pendingCalls,
      hint: ok
        ? undefined
        : result.phoneConnected
          ? 'WS open but phone did not answer ping — app likely frozen/backgrounded or SDK too old (no ping primitive); reload the app'
          : status.phones.length > 0
            ? 'WS entries exist but none OPEN — zombie connections, wait for heartbeat prune or restart relay'
            : (result.lastDisconnect
              ? `No phone connected (last disconnect ${Math.round(result.lastDisconnect.agoMs / 1000)}s ago). Open the app in Expo Go / bring it to foreground — the client auto-reconnects`
              : 'No phone has ever connected to this relay. Check the app is running and relayUrl/token match'),
    });
  });

  // ─── Tool list ────────────────────────────────────────────────────────
  app.get('/tools', (_req, res) => {
    res.json({
      tools: Object.entries(TOOL_SCHEMAS).map(([name, schema]) => ({
        name,
        ...schema,
      })),
    });
  });

  // ─── Tool invocation ──────────────────────────────────────────────────
  app.post('/tool/:name', async (req, res) => {
    const tool = req.params.name;
    if (!VALID_TOOLS.has(tool)) {
      return res.status(404).json({
        error: 'unknown_tool',
        message: `Tool "${tool}" not found. Valid tools: ${Array.from(VALID_TOOLS).join(', ')}`,
        validTools: Array.from(VALID_TOOLS),
      });
    }

    const args = req.body || {};

    // Multi-phone targeting: ?session=<sessionId> routes this call to a
    // specific phone (from /health's phones[].sessionId). Omit = active phone.
    const targetSession = req.query.session || req.query.sessionId || null;

    // The phone-call function passed to tool-router.
    // It calls session.callTool (low-level primitive call to the phone).
    const phoneCall = (primitive, primArgs) =>
      targetSession
        ? session.callToolOn(targetSession, primitive, primArgs)
        : session.callTool(primitive, primArgs);

    try {
      // Dispatch to the right tool-router function
      let result;
      switch (tool) {
        case 'inspect':     result = await require('./tool-router').inspect(phoneCall); break;
        case 'snapshot':    result = await require('./tool-router').snapshot(phoneCall, args); break;
        case 'tap':         result = await require('./tool-router').tap(phoneCall, args); break;
        case 'longPress':   result = await require('./tool-router').longPress(phoneCall, args); break;
        case 'type':        result = await require('./tool-router').type(phoneCall, args); break;
        case 'scrollTo':    result = await require('./tool-router').scrollTo(phoneCall, args); break;
        case 'expandList':  result = await require('./tool-router').expandList(phoneCall, args); break;
        case 'swipe':       result = await require('./tool-router').swipe(phoneCall, args); break;
        case 'screenshot':  result = await require('./tool-router').screenshot(phoneCall, args); break;
        case 'waitFor':     result = await require('./tool-router').waitFor(phoneCall, args); break;
        case 'readScreen':  result = await require('./tool-router').readScreen(phoneCall, args); break;
        case 'layout':      result = await require('./tool-router').layout(phoneCall, args); break;
        case 'navigate':    result = await require('./tool-router').navigate(phoneCall, args); break;
        case 'back':        result = await require('./tool-router').back(phoneCall, args); break;
        case 'assertVisible': result = await require('./tool-router').assertVisible(phoneCall, args); break;
        case 'assertText':  result = await require('./tool-router').assertText(phoneCall, args); break;
        case 'assertEnabled': result = await require('./tool-router').assertEnabled(phoneCall, args); break;
        case 'pinch':       result = await require('./tool-router').pinch(phoneCall, args); break;
        case 'visibleText': result = await require('./tool-router').visibleText(phoneCall); break;
        case 'tapText':     result = await require('./tool-router').tapText(phoneCall, args); break;
        case 'tapXY':       result = await require('./tool-router').tapXY(phoneCall, args); break;
        case 'clickables':  result = await require('./tool-router').clickables(phoneCall); break;
        case 'fill':        result = await require('./tool-router').fill(phoneCall, args); break;
        case 'waitGone':    result = await require('./tool-router').waitGone(phoneCall, args); break;
        case 'find':        result = await require('./tool-router').find(phoneCall, args); break;
        case 'scrollIntoView': result = await require('./tool-router').scrollIntoView(phoneCall, args); break;
        default:
          return res.status(404).json({ error: 'unknown_tool', message: `Tool ${tool} not in router` });
      }
      res.json({ ok: true, tool, result });
    } catch (e) {
      const status = e.code === 'NO_PHONE' ? 503 :
                     e.code === 'TIMEOUT' ? 504 :
                     e.code === 'REF_NOT_FOUND' ? 410 :
                     e.code === 'BAD_ARGS' ? 400 :
                     500;
      res.status(status).json({
        ok: false,
        tool,
        error: {
          code: e.code || 'TOOL_ERROR',
          message: e.message,
          ...(config.verbose && e.stack ? { stack: e.stack } : {}),
        },
      });
    }
  });

  // ─── Events ───────────────────────────────────────────────────────────
  app.get('/events', (req, res) => {
    const since = parseInt(req.query.since, 10);
    const count = Math.min(parseInt(req.query.count, 10) || 100, 1000);
    let events = session.getRecentEvents(count);
    if (!isNaN(since)) {
      events = events.filter((e) => (e.timestamp || 0) >= since);
    }
    res.json({ events });
  });

  // ─── 404 (must come before error handler) ─────────────────────────────
  app.use((req, res) => {
    res.status(404).json({ error: 'not_found', path: req.path });
  });

  // ─── Error handler (4-arg = error handler in Express 5) ───────────────
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'payload_too_large', message: 'Request body exceeds 1MB limit.' });
    }
    if (err.type === 'entity.parse.failed' || err.type === 'entity.parse.empty') {
      return res.status(400).json({ error: 'bad_json', message: 'Request body must be valid JSON.' });
    }
    console.error('[http] unhandled error:', err);
    res.status(err.status || 500).json({
      error: 'internal_error',
      message: err.message || 'Unknown error',
    });
  });

  // ─── Start listening (Express 5: callback receives errors) ────────────
  const server = app.listen(config.httpPort, config.host, (error) => {
    if (error) {
      console.error(`[http] failed to listen on ${config.host}:${config.httpPort}:`, error);
      process.exit(1);
    }
    console.log(`[http] agent-facing API listening on http://${config.host}:${config.httpPort}`);
  });

  return server;
}

module.exports = { startHttpServer };
