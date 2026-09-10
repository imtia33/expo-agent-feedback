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
};

function authMiddleware(req, res, next) {
  // /health is exempt
  if (req.path === '/health' || req.path === '/status') {
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

  // ─── Health (no auth required) ────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      relay: { httpPort: config.httpPort, wsPort: config.wsPort },
      phone: session.getStatus(),
    });
  });

  app.get('/status', (_req, res) => {
    res.json(session.getStatus());
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
    try {
      const result = await session.callTool(tool, args);
      res.json({
        ok: true,
        tool,
        result,
      });
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
