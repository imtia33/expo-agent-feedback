/**
 * network-interceptor.js — passively captures the target site's OWN API
 * calls by wrapping window.fetch and XMLHttpRequest before the site's code
 * loads (via page.addInitScript).
 *
 * WHY
 *   Instead of scraping rendered DOM text (fragile, plain-text-only), we
 *   tee the response stream of the site's chat-completion endpoint. This
 *   gives us the RAW SSE bytes the backend sends — real markdown, proper
 *   token boundaries, reasoning traces, and clean text for tool-call
 *   marker parsing.
 *
 * HOW
 *   1. page.exposeFunction("__relayCapture", handler) — Node callback.
 *   2. page.addInitScript(SCRIPT) — wraps fetch/XHR in the page context.
 *   3. When the site calls fetch("/api/.../chat/..."), our wrapper:
 *        - tees response.body into [forPage, forUs]
 *        - returns a new Response(forPage) so the site sees no difference
 *        - reads forUs chunk-by-chunk, calls window.__relayCapture({type:'chat-chunk', text})
 *   4. Node-side SSE parser accumulates `data: {...}` lines and extracts
 *      content deltas in a format-agnostic way (DeepSeek/OpenAI/Anthropic).
 *
 *   Also captures upload-endpoint responses (for image relay: we learn the
 *   uploaded image URL the site itself uses).
 */

const config = require("./config");

const log = (...a) => console.log("[network]", ...a);

// ── The script injected into the page (runs before site JS) ───────────────
// Built as a string so we can interpolate config values. Wrapped in an IIFE
// so it doesn't leak globals (except the buffer + capture hook).
function buildInjectScript() {
  const chatPattern = config.network.chatEndpointPattern;
  const uploadPattern = config.network.uploadEndpointPattern;
  return `
(function() {
  const CHAT_RE = new RegExp(${JSON.stringify(chatPattern)});
  const UPLOAD_RE = new RegExp(${JSON.stringify(uploadPattern)});

  // Buffer events until __relayCapture is bound (it usually is already,
  // because exposeFunction runs before addInitScript, but be safe).
  window.__relayBuffer = window.__relayBuffer || [];

  function emit(evt) {
    if (typeof window.__relayCapture === 'function') {
      try { window.__relayCapture(evt); return; } catch (e) {}
    }
    window.__relayBuffer.push(evt);
  }
  // If capture was bound before us, flush any buffered events now.
  if (typeof window.__relayCapture === 'function' && window.__relayBuffer.length) {
    const buf = window.__relayBuffer; window.__relayBuffer = [];
    buf.forEach(function(e) { try { window.__relayCapture(e); } catch(_){} });
  }

  // ── fetch wrapper ──────────────────────────────────────────────────
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = async function(input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      // Stash a truncated request body for debugging / payload inspection.
      let reqBodyPreview = null;
      try {
        if (init && init.body) {
          reqBodyPreview = typeof init.body === 'string'
            ? init.body.slice(0, 8000)
            : '[non-string body]';
        }
      } catch {}

      let response;
      try {
        response = await origFetch.apply(this, arguments);
      } catch (e) {
        emit({ type: 'request-error', url: url, method: method, error: String(e) });
        throw e;
      }

      // Chat-completion endpoint → tee the stream.
      if (CHAT_RE.test(url)) {
        emit({
          type: 'chat-start',
          url: url,
          method: method,
          requestBodyPreview: reqBodyPreview,
          status: response.status,
          contentType: response.headers.get('content-type') || ''
        });
        try {
          if (!response.body) {
            // Non-streaming response — read it whole, emit once.
            const text = await response.clone().text();
            emit({ type: 'chat-chunk', text: text });
            emit({ type: 'chat-done', url: url });
            return response;
          }
          const [forPage, forUs] = response.body.tee();
          (async function() {
            const reader = forUs.getReader();
            const decoder = new TextDecoder();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) {
                  // Flush any bytes the decoder held back for incomplete
                  // multi-byte sequences (stream:true defers them).
                  const remaining = decoder.decode();
                  if (remaining) emit({ type: 'chat-chunk', text: remaining });
                  break;
                }
                const text = decoder.decode(value, { stream: true });
                if (text) emit({ type: 'chat-chunk', text: text });
              }
            } catch (e) {
              emit({ type: 'capture-error', url: url, error: String(e) });
            } finally {
              emit({ type: 'chat-done', url: url });
            }
          })();
          // Return a Response with the page's copy of the body so the site
          // renders normally — it has no idea we're listening.
          return new Response(forPage, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        } catch (e) {
          emit({ type: 'capture-error', url: url, error: String(e) });
          return response;
        }
      }

      // Upload endpoint → capture the response (to learn the image URL etc.).
      if (UPLOAD_RE.test(url) && response.status >= 200 && response.status < 300) {
        try {
          const clone = response.clone();
          clone.text().then(function(t) {
            emit({
              type: 'upload-response',
              url: url,
              method: method,
              requestBodyPreview: reqBodyPreview,
              responseBody: t.slice(0, 16000)
            });
          }).catch(function(){});
        } catch {}
      }

      return response;
    };
  }

  // ── XMLHttpRequest wrapper (best-effort; some sites still use XHR) ──
  const OrigXHR = window.XMLHttpRequest;
  if (OrigXHR && !OrigXHR.__relayWrapped) {
    const origOpen = OrigXHR.prototype.open;
    const origSend = OrigXHR.prototype.send;
    OrigXHR.prototype.open = function(method, url) {
      this.__relayUrl = url;
      this.__relayMethod = (method || 'GET').toUpperCase();
      return origOpen.apply(this, arguments);
    };
    OrigXHR.prototype.send = function(body) {
      const self = this;
      const url = this.__relayUrl || '';
      if (CHAT_RE.test(url)) {
        let accumulated = '';
        emit({ type: 'chat-start', url: url, method: this.__relayMethod, via: 'xhr' });
        this.addEventListener('readystatechange', function() {
          if (self.readyState === 3 && self.responseText) {
            const newText = self.responseText.slice(accumulated.length);
            accumulated = self.responseText;
            if (newText) emit({ type: 'chat-chunk', text: newText });
          }
          if (self.readyState === 4) {
            emit({ type: 'chat-done', url: url, via: 'xhr' });
          }
        });
      }
      return origSend.apply(this, arguments);
    };
    OrigXHR.__relayWrapped = true;
  }
})();
`;
}

// ── Install on a page (call BEFORE page.goto) ────────────────────────────
async function installInterceptor(page, handlers) {
  const {
    onChatStart,
    onChatChunk,
    onChatDone,
    onUploadResponse,
    onEvent,
  } = handlers;

  // exposeFunction must be called before addInitScript so the binding exists
  // when the injected script runs on the new document.
  await page.exposeFunction("__relayCapture", (evt) => {
    if (onEvent) onEvent(evt);
    switch (evt.type) {
      case "chat-start":
        if (onChatStart) onChatStart(evt);
        break;
      case "chat-chunk":
        if (onChatChunk) onChatChunk(evt.text);
        break;
      case "chat-done":
        if (onChatDone) onChatDone(evt);
        break;
      case "upload-response":
        if (onUploadResponse) onUploadResponse(evt);
        break;
    }
  });

  await page.addInitScript(buildInjectScript());
}

// After a navigation, flush any events the page buffered before the capture
// binding was ready (rare, but happens on some SPA route changes).
async function flushBuffer(page) {
  try {
    await page.evaluate(() => {
      if (window.__relayBuffer && window.__relayBuffer.length) {
        const buf = window.__relayBuffer;
        window.__relayBuffer = [];
        buf.forEach((e) => {
          try {
            window.__relayCapture(e);
          } catch {}
        });
      }
    });
  } catch {}
}

// ── SSE parser (Node-side) ────────────────────────────────────────────────
// Accumulates raw chunk text, splits on newlines, parses `data: {...}` lines
// in a format-agnostic way: supports DeepSeek ({content:"..."}), OpenAI
// ({choices:[{delta:{content:"..."}}]}), and Anthropic-ish shapes.
function createSSEParser({ onDelta } = {}) {
  let lineBuffer = "";
  let fullText = "";

  // Stateful tracking for DeepSeek JSON-Patch protocol.
  // When thinking is enabled, DeepSeek sends fragments with different types:
  //   [{"type":"THINK","content":"reasoning..."}, {"type":"RESPONSE","content":"answer..."}]
  // (NOTE: the type is "THINK", not "THINKING" — verified from raw SSE log.)
  // APPEND operations target a specific fragment by index. We track which
  // fragment is currently being appended to so we can classify each delta
  // as either 'content' (RESPONSE) or 'reasoning' (THINK).
  // Current fragment index for DeepSeek JSON-Patch
  let fragments = []; // [{type, content}, ...]
  let currentFragmentIndex = -1;

  // Qwen cumulative reasoning tracker
  let qwenReasoningCount = 0;

  // Returns true if a fragment type is a reasoning/thinking type.
  // DeepSeek uses "THINK". We also accept "THINKING" / "REASONING" for
  // forward-compat / other providers.
  function isThinkingType(type) {
    return (
      type === "THINK" ||
      type === "THINKING" ||
      type === "REASONING"
    );
  }

  function parseDataLine(data) {
    if (!data) return null;
    const trimmed = data.trim();
    if (trimmed === "[DONE]") return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  // Returns {content: "", reasoning: ""} -- one field is populated.
  //
  // DeepSeek's wire format uses JSON-Patch ops:
  //
  //   1. Snapshot: {"v":{"response":{...,"fragments":[
  //        {"id":2,"type":"THINK","content":"We",...}]}}}
  //      → Sets our fragments[] tracking. Emit last fragment's content.
  //
  //   2. Token delta (explicit path + o:APPEND):
  //        {"p":"response/fragments/-1/content","o":"APPEND","v":" need"}
  //      → Classify by current fragment's type, emit delta.
  //
  //   3. Token delta (path but NO o field — DeepSeek shorthand):
  //        {"p":"response/fragments/-1/content","v":"!"}
  //      → Same as #2.
  //
  //   4. Token delta (shorthand, no p, no o):
  //        {"v":" to"}
  //      → Continue appending to currentFragmentIndex.
  //
  //   5. Fragment-array APPEND (THINK→RESPONSE transition):
  //        {"p":"response/fragments","o":"APPEND","v":[
  //          {"id":3,"type":"RESPONSE","content":"Hello",...}]}
  //      → v is an ARRAY. Update fragments[], set currentFragmentIndex
  //        to the new fragment, emit its initial content.
  //
  //   6. Metadata ops (BATCH, SET on non-content paths) — ignore.
  function extractDeltas(obj) {
    const result = { content: "", reasoning: "" };
    if (!obj || typeof obj !== "object") return result;

    // Shape 1: snapshot — v is an object wrapping the full response.
    if (obj.v && typeof obj.v === "object" && obj.v.response) {
      const frags = obj.v.response.fragments;
      if (Array.isArray(frags) && frags.length > 0) {
        fragments = frags.map((f) => ({
          type: f.type || "RESPONSE",
          content: f.content || "",
        }));
        for (let i = frags.length - 1; i >= 0; i--) {
          const f = frags[i];
          if (f && typeof f.content === "string" && f.content) {
            currentFragmentIndex = i;
            if (isThinkingType(f.type)) {
              result.reasoning = f.content;
            } else {
              result.content = f.content;
            }
            break;
          }
        }
      }
      return result;
    }

    // Shape 2: fragment-array APPEND (THINK→RESPONSE transition).
    if (
      obj.o === "APPEND" &&
      Array.isArray(obj.v) &&
      typeof obj.p === "string" &&
      /fragments$/.test(obj.p)
    ) {
      const newFrags = obj.v.filter((f) => f && typeof f === "object");
      if (newFrags.length > 0) {
        for (const f of newFrags) {
          fragments.push({
            type: f.type || "RESPONSE",
            content: f.content || "",
          });
        }
        const lastNew = newFrags[newFrags.length - 1];
        currentFragmentIndex = fragments.length - 1;
        if (typeof lastNew.content === "string" && lastNew.content) {
          if (isThinkingType(lastNew.type)) {
            result.reasoning = lastNew.content;
          } else {
            result.content = lastNew.content;
          }
        }
      }
      return result;
    }

    // Shape 3: content token APPEND — v is a string, p matches a fragment
    // content path. Handles BOTH forms (with and without "o" field).
    if (
      typeof obj.v === "string" &&
      typeof obj.p === "string" &&
      /fragments\/-?\d+\/content/.test(obj.p)
    ) {
      const match = obj.p.match(/fragments\/(-?\d+)\/content/);
      if (match) {
        let idx = parseInt(match[1], 10);
        if (idx === -1) idx = fragments.length - 1;
        currentFragmentIndex = idx;
      }
      const fragType =
        currentFragmentIndex >= 0 && fragments[currentFragmentIndex]
          ? fragments[currentFragmentIndex].type
          : "RESPONSE";
      if (isThinkingType(fragType)) {
        result.reasoning = obj.v;
      } else {
        result.content = obj.v;
      }
      return result;
    }

    // Shape 4: shorthand token delta — v is a string, no p, no o.
    if (typeof obj.v === "string" && !obj.p && !obj.o) {
      const fragType =
        currentFragmentIndex >= 0 && fragments[currentFragmentIndex]
          ? fragments[currentFragmentIndex].type
          : "RESPONSE";
      if (isThinkingType(fragType)) {
        result.reasoning = obj.v;
      } else {
        result.content = obj.v;
      }
      return result;
    }

    // OpenAI shape: { choices: [{ delta: { content / reasoning_content } }] }
    if (Array.isArray(obj.choices) && obj.choices[0]) {
      const c = obj.choices[0];
      if (c.delta) {
        if (typeof c.delta.content === "string") result.content = c.delta.content;
        if (typeof c.delta.reasoning_content === "string")
          result.reasoning = c.delta.reasoning_content;
        if (typeof c.delta.reasoning === "string")
          result.reasoning = c.delta.reasoning;
          
        // Qwen cumulative reasoning array
        if (c.delta.extra && c.delta.extra.summary_thought && Array.isArray(c.delta.extra.summary_thought.content)) {
          const arr = c.delta.extra.summary_thought.content;
          if (arr.length > qwenReasoningCount) {
            const newItems = arr.slice(qwenReasoningCount);
            result.reasoning = (qwenReasoningCount > 0 ? "\n\n" : "") + newItems.join("\n\n");
            qwenReasoningCount = arr.length;
          }
        }
      }
      if (c.message) {
        if (typeof c.message.content === "string")
          result.content = c.message.content;
        if (typeof c.message.reasoning_content === "string")
          result.reasoning = c.message.reasoning_content;
      }
      if (typeof c.text === "string") result.content = c.text;
      return result;
    }

    // Glm shape: {"type":"chat:completion","data":{"delta_content":"...","phase":"thinking"|"reply"}}
    if (obj.type === "chat:completion" && obj.data) {
      if (typeof obj.data.delta_content === "string") {
        if (obj.data.phase === "thinking") {
          result.reasoning = obj.data.delta_content;
        } else {
          result.content = obj.data.delta_content;
        }
      }
      return result;
    }

    if (typeof obj.content === "string") {
      result.content = obj.content;
      return result;
    }
    if (obj.delta && typeof obj.delta.text === "string") {
      result.content = obj.delta.text;
      return result;
    }
    if (typeof obj.text === "string") {
      result.content = obj.text;
      return result;
    }
    return result;
  }

  function feed(chunkText) {
    lineBuffer += chunkText;
    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop() || "";
    for (const line of lines) {
      const t = line.trim();
      if (!t || !t.startsWith("data:")) continue;
      const data = t.slice(5).trim();
      const obj = parseDataLine(data);
      if (!obj) continue;
      const { content, reasoning } = extractDeltas(obj);
      if (content) {
        fullText += content;
        if (onDelta) onDelta(content, "content");
      } else if (reasoning) {
        if (onDelta) onDelta(reasoning, "reasoning");
      }
    }
  }

  function flush() {
    if (!lineBuffer) return;
    // Process any remaining complete lines that weren't terminated with \n
    const lines = lineBuffer.split("\n");
    lineBuffer = "";
    for (const line of lines) {
      const t = line.trim();
      if (!t || !t.startsWith("data:")) continue;
      const data = t.slice(5).trim();
      const obj = parseDataLine(data);
      if (!obj) continue;
      const { content, reasoning } = extractDeltas(obj);
      if (content) {
        fullText += content;
        if (onDelta) onDelta(content, "content");
      } else if (reasoning) {
        if (onDelta) onDelta(reasoning, "reasoning");
      }
    }
  }

  return {
    feed,
    flush,
    getFullText() {
      return fullText;
    },
  };
}

module.exports = {
  installInterceptor,
  flushBuffer,
  createSSEParser,
  buildInjectScript,
};
