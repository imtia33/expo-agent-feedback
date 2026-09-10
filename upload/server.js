/**
 * server.js — Express app exposing an OpenAI-compatible Chat Completions
 * API that relays through a real, already-logged-in Chrome tab.
 *
 * New in this version:
 *  - Multi-provider routing: model ID in the request selects Gemini / Qwen /
 *    DeepSeek (or any future provider in providers.json).
 *  - New-chat detection: if the conversation starts from scratch (full send)
 *    we open a fresh chat on the provider tab.
 *  - Context switch: if the provider changes mid-conversation, the FULL
 *    history is sent to the new provider on the first message.
 *  - Character-limit enforcement: if the prompt (or a tool result) exceeds
 *    the provider's configured charLimit, it is uploaded as a .txt file.
 *  - /v1/providers  GET  — list all configured providers + validation status.
 *  - /v1/providers/:id/validate  POST  — trigger endpoint validation.
 */

const express    = require("express");
const config     = require("./config");
const browser    = require("./browser");
const adapter    = require("./openai-adapter");
const imageRelay = require("./image-relay");
const pm         = require("./provider-manager");

const app = express();
app.use(express.json({ limit: "50mb" }));

const log = (...a) => console.log("[server]", ...a);

// ── Session state (per-provider) ──────────────────────────────────────────
// We keep one sessionState per provider ID so that delta tracking is isolated.
const providerSessions = new Map();

function getSession(providerId) {
  if (!providerSessions.has(providerId)) {
    providerSessions.set(providerId, {
      active: false,
      systemHash: null,
      conversation: [],
      lastActivity: 0,
      // Full message history (for context-switch: send complete history to new provider)
      fullMessages: [],
    });
  }
  return providerSessions.get(providerId);
}

// ── Health ────────────────────────────────────────────────────────────────
app.get("/health", async (_req, res) => {
  const alive = await browser.isAlive().catch(() => false);
  const page  = browser.getPage();
  let url = null;
  try { if (page && !page.isClosed()) url = page.url(); } catch {}

  const activePid     = browser.activeProviderId();
  const activeSession = activePid ? getSession(activePid) : {};
  const sel = config.selectors;
  const configured = (v) => !imageRelay.isPlaceholder(v);

  res.json({
    status: alive ? "ok" : "degraded",
    browserAlive: alive,
    pageUrl: url,
    activeProvider: activePid,
    targetUrl: config.targetUrl,
    observationMode: config.observationMode,
    headless: config.headless,
    busy: browser.isBusy(),
    networkInterception: config.observationMode === "network",
    deltaMode: config.deltaMode,
    session: {
      active: activeSession.active,
      messagesTracked: activeSession.conversation ? activeSession.conversation.length : 0,
      systemHash: activeSession.systemHash
        ? activeSession.systemHash.slice(0, 8) + "…"
        : null,
      lastActivityAge: activeSession.lastActivity
        ? Date.now() - activeSession.lastActivity
        : null,
    },
    selectorsConfigured: {
      input: configured(sel.input),
      responseContainer: configured(sel.responseContainer),
      sendButton: configured(sel.sendButton),
      stopGeneratingButton: configured(sel.stopGeneratingButton),
      newChatButton: configured(sel.newChatButton),
      imageFileInput: configured(sel.imageFileInput),
      textFileInput: configured(sel.textFileInput),
      webSearchButton: configured(sel.webSearchButton),
    },
    networkPatterns: config.network,
  });
});

// ── Root info ─────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.type("text/plain").send(
    [
      "Local AI Chat Relay Server (OpenAI-compatible)",
      "",
      "Endpoints:",
      "  GET  /v1/models",
      "  POST /v1/chat/completions   (OpenAI: messages + tools + stream + images)",
      "  POST /v1/chat               (simple: { message } -> SSE { delta })",
      "  GET  /v1/providers          (list configured providers)",
      "  POST /v1/providers/:id/validate  (validate live network endpoint)",
      "  GET  /health",
      "",
      `activeProvider: ${browser.activeProviderId() || "(none)"}`,
      `observation:    ${config.observationMode}`,
      "",
      "Point any OpenAI-compatible client at:",
      `  baseURL = http://localhost:${config.port}/v1`,
      `  apiKey  = anything (ignored)`,
      `  model   = gemini | qwen | deepseek-chat | ...`,
      "",
    ].join("\n")
  );
});

// ── /v1/models ────────────────────────────────────────────────────────────
function modelsList() {
  const providers = pm.getProviders();
  const data = providers.flatMap((p) =>
    (p.modelIds || [p.id]).map((mid) => ({
      id: mid,
      object: "model",
      created: Math.floor(Date.now() / 1000),
      owned_by: p.id,
    }))
  );
  return { object: "list", data };
}
app.get("/v1/models", (_req, res) => res.json(modelsList()));
app.get("/models",    (_req, res) => res.json(modelsList()));

// ── /v1/providers ─────────────────────────────────────────────────────────
app.get("/v1/providers", (_req, res) => {
  const providers = pm.getProviders();
  res.json({
    active: pm.getCurrentProviderId(),
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      url: p.url,
      modelIds: p.modelIds,
      imageSupported: p.imageSupported,
      charLimit: p.charLimit,
      validatedEndpoint: p.validatedEndpoint || null,
    })),
  });
});

// ── /v1/providers/:id/validate ────────────────────────────────────────────
app.post("/v1/providers/:id/validate", async (req, res) => {
  const providers = pm.getProviders();
  const provider  = providers.find((p) => p.id === req.params.id);
  if (!provider) return res.status(404).json({ error: `Provider "${req.params.id}" not found` });

  try {
    const page = browser.getProviderPage(provider.id);
    if (!page || page.isClosed()) {
      return res.status(400).json({
        success: false,
        message: "Provider page not open yet. Send a message first to open the tab.",
      });
    }
    const result = await pm.validateEndpoint(provider, page);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── /v1/chat/completions ──────────────────────────────────────────────────
app.post("/v1/chat/completions", async (req, res) => {
  const { messages, tools, stream, stream_options, model: requestedModel } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: { message: "messages must be a non-empty array" } });
  }

  // ── 1. Resolve provider from model ID ──────────────────────────────────
  const provider       = pm.resolveProvider(requestedModel || config.modelName);
  const providerSwitched = pm.checkAndUpdateProvider(provider);

  log(`provider: ${provider.id} (switched=${providerSwitched}, model=${requestedModel || config.modelName})`);

  // ── 2. Switch browser tab to provider ─────────────────────────────────
  await browser.switchToProvider(provider.id, provider);

  // ── 3. Session state for this provider ────────────────────────────────
  const sessionState = getSession(provider.id);

  // ── 4. If provider switched, reset session → force full send ──────────
  if (providerSwitched) {
    log("provider switched — resetting session to force full history send");
    adapter.resetSession(sessionState);
    sessionState.fullMessages = [];
  }

  // ── 5. Store full message history for future context-switch use ───────
  //    We always keep the canonical incoming messages from Copilot.
  sessionState.fullMessages = messages.slice();

  const wantStream   = stream !== false;
  const includeUsage = !!(stream_options && stream_options.include_usage);

  // ── 6. Compute delta ──────────────────────────────────────────────────
  const delta = config.deltaMode
    ? adapter.computeDelta({
        messages,
        tools,
        sessionState,
        sessionMaxIdleMs: config.sessionMaxIdleMs,
      })
    : {
        type: "full",
        text: adapter.buildAgenticPrompt({ messages, tools }),
        systemHash: null,
        messageHashes: null,
      };

  const needNewChat = delta.type === "full";

  // ── 7. Determine subset of messages being sent ────────────────────────
  const matchCount =
    delta.type === "delta"
      ? (() => {
          const tracked       = sessionState.conversation;
          const incomingHashes = (messages || []).map(adapter.messageHash);
          let match = 0;
          for (let i = 0; i < Math.min(tracked.length, incomingHashes.length); i++) {
            if (tracked[i] === incomingHashes[i]) match++;
            else break;
          }
          return match;
        })()
      : 0;

  const subsetMessages =
    delta.type === "full" ? messages : messages.slice(matchCount);

  // ── 8. Extract images from subset (only if provider declares image support) ─
  const images = provider.imageSupported !== false
    ? imageRelay.extractImages(subsetMessages)
    : [];

  // ── 9. Character-limit check & text-file conversion ───────────────────
  let prompt    = delta.text;
  let textFiles = [];

  if (pm.exceedsLimit(provider, prompt)) {
    log(
      `prompt (${prompt.length} chars) exceeds provider limit (${provider.charLimit}); ` +
      `sending as text file`
    );
    const filePayload = pm.buildTextFilePayload(
      prompt,
      `relay-prompt-${Date.now()}.txt`
    );
    textFiles.push(filePayload);
    // Replace the prompt with a brief instruction pointing at the attachment
    prompt = "[See attached file for the full prompt/context]";
  } else {
    // Check if any individual tool result in the subset exceeds the limit
    for (const m of subsetMessages) {
      if (m.role !== "tool") continue;
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      if (pm.exceedsLimit(provider, content)) {
        log(
          `tool result (${content.length} chars) exceeds provider limit; ` +
          `attaching as text file`
        );
        textFiles.push(
          pm.buildTextFilePayload(content, `relay-tool-result-${Date.now()}.txt`)
        );
      }
    }
  }

  log(
    `POST /v1/chat/completions (msgs=${messages.length}, tools=${tools ? tools.length : 0}, ` +
    `images=${images.length}, textFiles=${textFiles.length}, stream=${wantStream}, ` +
    `mode=${delta.type}, newChat=${needNewChat}, promptLen=${prompt.length})`
  );

  const completionId  = adapter.chatcmplId();
  const modelLabel    = requestedModel || provider.modelIds[0] || provider.id;
  const promptTokens  = adapter.estimateTokens(prompt);

  log(`--- NEW REQUEST (streaming) ---`);
  log(`msgs: ${messages.length}, tools: ${tools ? tools.length : 0}`);

  if (messages.length > 0 && messages[messages.length - 1].role === "tool") {
    log("Delaying 2.5s for tool response to avoid rate limiting...");
    await new Promise((r) => setTimeout(r, 2500));
  }

  const responseCapture = { content: "", toolCall: null };

  try {
    if (!wantStream) {
      await handleNonStreaming({
        prompt, images, textFiles, tools, completionId, model: modelLabel,
        promptTokens, needNewChat, responseCapture, provider, res,
      });
    } else {
      await handleStreaming({
        prompt, images, textFiles, tools, completionId, model: modelLabel,
        promptTokens, includeUsage, needNewChat, responseCapture, provider, res,
      });
    }

    // ── Update session state ──────────────────────────────────────────
    if (config.deltaMode && delta.messageHashes) {
      adapter.recordAssistantResponse({
        content: responseCapture.content,
        toolCalls: responseCapture.toolCall
          ? [{
              function: {
                name: responseCapture.toolCall.name,
                arguments:
                  typeof responseCapture.toolCall.arguments === "string"
                    ? responseCapture.toolCall.arguments
                    : JSON.stringify(responseCapture.toolCall.arguments || {}),
              },
            }]
          : null,
        incomingMessageHashes: delta.messageHashes,
        systemHash: delta.systemHash,
        sessionState,
      });
      log(
        `session updated: ${sessionState.conversation.length} messages tracked, ` +
        `hash=${delta.systemHash?.slice(0, 8)}…`
      );
    }
  } catch (e) {
    if (config.deltaMode) {
      adapter.resetSession(sessionState);
      log("session state reset due to error");
    }
    if (!res.headersSent) {
      const status = e.code === "SELECTOR_NOT_FOUND" ? 500 : 502;
      res.status(status).json({ error: { message: e.message, code: e.code || "ERROR" } });
    }
  }
});

// ── Streaming handler ─────────────────────────────────────────────────────
async function handleStreaming({
  prompt, images, textFiles, tools,
  completionId, model, promptTokens, includeUsage,
  needNewChat, responseCapture, provider, res,
}) {
  let streamStarted = false;
  let finished      = false;
  let completionText = "";
  let parserError   = null;

  const controller = new AbortController();
  res.on("close", () => { if (!finished) { log("client disconnected mid-stream; aborting"); controller.abort(); } });

  const startStream = () => {
    if (streamStarted) return;
    res.setHeader("Content-Type",     "text/event-stream");
    res.setHeader("Cache-Control",    "no-cache, no-transform");
    res.setHeader("Connection",       "keep-alive");
    res.setHeader("X-Accel-Buffering","no");
    res.flushHeaders && res.flushHeaders();
    streamStarted = true;
    writeChunk(adapter.roleChunk({ id: completionId, model }));
  };

  const writeChunk = (obj) => { if (!streamStarted) return; res.write(`data: ${JSON.stringify(obj)}\n\n`); };

  const parser = adapter.createToolCallStreamParser({
    onContent: (text) => {
      completionText += text;
      writeChunk(adapter.contentChunk({ id: completionId, model, content: text }));
    },
    onToolCall: (parsed) => {
      responseCapture.toolCall = parsed;
      const name     = parsed.name;
      const argsJson = typeof parsed.arguments === "string" ? parsed.arguments : JSON.stringify(parsed.arguments ?? {});
      writeChunk(adapter.toolCallChunk({ id: completionId, model, callId: adapter.toolCallId(), name, argumentsJson: argsJson }));
    },
    onFinish: (reason) => { writeChunk(adapter.finishChunk({ id: completionId, model, reason })); },
    onError:  (msg)    => { parserError = msg; log("parser error:", msg); },
  });

  let deltaCount = 0;
  try {
    await browser.sendAndStream({
      message:    prompt,
      signal:     controller.signal,
      images,
      textFiles,
      newChat:    needNewChat,
      providerId: provider.id,
      provider,
      onReady:  startStream,
      onDelta: (delta, type) => {
        if (type === "reasoning") {
          if (responseCapture) responseCapture.reasoning = (responseCapture.reasoning || "") + delta;
          writeChunk(adapter.reasoningChunk({ id: completionId, model, content: delta }));
        } else {
          deltaCount++;
          parser.feed(delta);
        }
      },
    });

    if (parser.isIncomplete && parser.isIncomplete()) {
      const finalDomText = await browser.waitForDOMToSettle();
      parser.recoverFromFullText(finalDomText);
    }

    parser.finish("stop");

    if (includeUsage) {
      writeChunk(adapter.usageChunk({
        id: completionId, model, promptTokens,
        completionTokens: adapter.estimateTokens(completionText),
      }));
    }
    res.write("data: [DONE]\n\n");
    log(`completed; deltas=${deltaCount}, completionChars=${completionText.length}`);
  } catch (e) {
    log(`error: ${e.message} (code=${e.code || "ERROR"})`);
    if (!streamStarted) {
      const status = e.code === "SELECTOR_NOT_FOUND" ? 500 : 502;
      res.status(status).json({ error: { message: e.message, code: e.code || "ERROR" } });
    } else {
      writeChunk({
        id: completionId, object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000), model,
        choices: [{ index: 0, delta: {}, finish_reason: "error", error: { message: e.message, code: e.code || "ERROR" } }],
      });
      res.write("data: [DONE]\n\n");
    }
  } finally {
    finished = true;
    if (streamStarted) res.end();
  }
}

// ── Non-streaming handler ─────────────────────────────────────────────────
async function handleNonStreaming({
  prompt, images, textFiles, tools,
  completionId, model, promptTokens,
  needNewChat, responseCapture, provider, res,
}) {
  let finished = false;
  const controller = new AbortController();
  res.on("close", () => { if (!finished) controller.abort(); });

  let fullText = "";
  let pendingToolCall = null;
  const parser = adapter.createToolCallStreamParser({
    onContent:  (text) => { fullText += text; },
    onToolCall: (parsed) => { pendingToolCall = parsed; },
    onFinish:   () => {},
    onError:    (msg) => log("parser error:", msg),
  });
  let reasoningFull = "";

  try {
    await browser.sendAndStream({
      message:    prompt,
      signal:     controller.signal,
      images,
      textFiles,
      newChat:    needNewChat,
      providerId: provider.id,
      provider,
      onReady: () => {},
      onDelta: (delta, type) => {
        if (type === "reasoning") reasoningFull += delta;
        else parser.feed(delta);
      },
    });

    if (parser.isIncomplete && parser.isIncomplete()) {
      const finalDomText = await browser.waitForDOMToSettle();
      parser.recoverFromFullText(finalDomText);
    }
    parser.finish("stop");

    const hasToolCall = !!pendingToolCall;
    let toolCalls   = undefined;
    let content     = fullText;
    let finishReason = "stop";

    if (hasToolCall) {
      const name = pendingToolCall.name;
      const args = typeof pendingToolCall.arguments === "string"
        ? pendingToolCall.arguments
        : JSON.stringify(pendingToolCall.arguments ?? {});
      toolCalls    = [{ id: adapter.toolCallId(), type: "function", function: { name, arguments: args } }];
      content      = fullText || null;
      finishReason = "tool_calls";
    }

    if (responseCapture) {
      responseCapture.content   = fullText;
      responseCapture.toolCall  = pendingToolCall;
      responseCapture.reasoning = reasoningFull;
    }

    const completionTokens = adapter.estimateTokens(fullText + (toolCalls ? JSON.stringify(toolCalls) : ""));
    const response = adapter.buildCompletionResponse({
      id: completionId, model, content, toolCalls, finishReason,
      promptTokens, completionTokens,
      reasoning: reasoningFull || undefined,
    });
    log(`completed (non-stream); finish=${finishReason}, len=${fullText.length}`);
    res.json(response);
  } catch (e) {
    log(`error: ${e.message} (code=${e.code || "ERROR"})`);
    const status = e.code === "SELECTOR_NOT_FOUND" ? 500 : 502;
    res.status(status).json({ error: { message: e.message, code: e.code || "ERROR" } });
  } finally {
    finished = true;
  }
}

// ── /v1/chat (legacy) ─────────────────────────────────────────────────────
app.post("/v1/chat", async (req, res) => {
  const { message } = req.body || {};
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Missing 'message' (string) in JSON body" });
  }

  log(`POST /v1/chat (len=${message.length})`);

  let streamStarted = false;
  let finished      = false;
  const controller  = new AbortController();
  res.on("close", () => { if (!finished) controller.abort(); });

  const startStream = () => {
    if (streamStarted) return;
    res.setHeader("Content-Type",     "text/event-stream");
    res.setHeader("Cache-Control",    "no-cache, no-transform");
    res.setHeader("Connection",       "keep-alive");
    res.setHeader("X-Accel-Buffering","no");
    res.flushHeaders && res.flushHeaders();
    streamStarted = true;
  };
  const writeSSE = (obj) => { if (!streamStarted) return; res.write(`data: ${JSON.stringify(obj)}\n\n`); };

  let deltaCount = 0;
  try {
    await browser.sendAndStream({
      message, signal: controller.signal, onReady: startStream,
      onDelta: (delta) => { deltaCount++; writeSSE({ delta }); },
    });
    res.write("data: [DONE]\n\n");
    log(`completed; deltas=${deltaCount}`);
  } catch (e) {
    log(`error: ${e.message} (code=${e.code || "ERROR"})`);
    if (!streamStarted) {
      const status = e.code === "SELECTOR_NOT_FOUND" ? 500 : 502;
      res.status(status).json({ error: e.message, code: e.code || "ERROR" });
    } else {
      writeSSE({ error: e.message, code: e.code || "ERROR" });
      res.write("data: [DONE]\n\n");
    }
  } finally {
    finished = true;
    if (streamStarted) res.end();
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────
const server = app.listen(config.port, async () => {
  log(`listening on http://localhost:${config.port}`);
  log(`providers: ${pm.getProviders().map((p) => p.id).join(", ")}`);
  log(`observation: ${config.observationMode}`);
  log(`open http://localhost:${config.port}/health to check status`);

  try {
    // Boot with the default provider (first in list = deepseek)
    const defaultProvider = pm.getProviders()[0];
    pm.checkAndUpdateProvider(defaultProvider);
    await browser.switchToProvider(defaultProvider.id, defaultProvider);
  } catch (e) {
    log("browser launch failed:", e.message);
    log("server is still up; requests will retry launching lazily.");
  }
});

server.on("error", (e) => { log("server error:", e.message); });

function shutdown(signal) {
  log(`${signal} received, shutting down...`);
  server.close(() => {
    const page = browser.getPage();
    const ctx  = page && page.context ? page.context() : null;
    ctx ? ctx.close().then(() => process.exit(0)) : process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ── Terminal command listener ─────────────────────────────────────────────
const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

rl.on("line", (input) => {
  const cmd = input.trim().toUpperCase();

  if (cmd === "N") {
    log("━".repeat(50));
    log("NEW CHAT requested — navigating to root URL and resetting session");
    const pid      = browser.activeProviderId();
    const provider = pid ? pm.getProviders().find((p) => p.id === pid) : null;
    const session  = pid ? getSession(pid) : null;
    if (session) adapter.resetSession(session);
    browser
      .forceNewChat(pid, provider)
      .then(() => log(`✓ New chat session ready (${pid})`))
      .catch((e) => log("✗ Failed to start new chat:", e.message));
    log("━".repeat(50));

  } else if (cmd === "S") {
    const pid = browser.activeProviderId();
    const session = pid ? getSession(pid) : {};
    log("━".repeat(50));
    log("SESSION STATUS");
    log(`  activeProvider: ${pid || "(none)"}`);
    log(`  deltaMode:      ${config.deltaMode}`);
    log(`  active:         ${session.active}`);
    log(`  tracked:        ${session.conversation ? session.conversation.length : 0} messages`);
    log(`  systemHash:     ${session.systemHash ? session.systemHash.slice(0, 12) + "…" : "(none)"}`);
    log(`  lastActive:     ${session.lastActivity ? Math.round((Date.now() - session.lastActivity) / 1000) + "s ago" : "(never)"}`);
    log(`  busy:           ${browser.isBusy()}`);
    log("━".repeat(50));

  } else if (cmd === "P") {
    // List all providers
    log("━".repeat(50));
    log("PROVIDERS");
    for (const p of pm.getProviders()) {
      const current = p.id === browser.activeProviderId() ? " ← active" : "";
      log(`  ${p.id.padEnd(12)} ${p.name.padEnd(20)} models: ${(p.modelIds || []).join(", ")}${current}`);
    }
    log("━".repeat(50));

  } else if (cmd === "Q") {
    shutdown("QUIT");

  } else if (cmd === "?") {
    log("Commands: N=new chat, S=status, P=providers, Q=quit");
  }
});
