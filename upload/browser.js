/**
 * browser.js — Playwright context/page management + send/observe logic.
 *
 * Multi-provider support:
 *   - One persistent BrowserContext is shared across all providers.
 *   - Each provider gets its own Page (tab), keyed by provider.id.
 *   - The active page is swapped when the provider changes.
 *   - All other behaviour (queuing, network interception, observation modes,
 *     text-file upload, image upload) is unchanged.
 */

const { chromium } = require("playwright");
const config = require("./config");
const {
  installInterceptor,
  flushBuffer,
  createSSEParser,
} = require("./network-interceptor");
const imageRelay = require("./image-relay");

const log = (...a) => console.log("[browser]", ...a);

// ── Module state ──────────────────────────────────────────────────────────
let context       = null;
let launchingPromise = null;

/**
 * Per-provider page registry.
 * Map<providerId, { page, exposed, interceptorInstalled,
 *                   currentCallback, currentNetworkParser,
 *                   currentNetworkResolver }>
 */
const providerPages = new Map();

/** Currently active provider id & page. */
let activeProviderId = null;

function _pageState(providerId) {
  if (!providerPages.has(providerId)) {
    providerPages.set(providerId, {
      page: null,
      exposed: false,
      interceptorInstalled: false,
      currentCallback: null,
      currentNetworkParser: null,
      currentNetworkResolver: null,
    });
  }
  return providerPages.get(providerId);
}

// ── Simple single-slot queue (one message at a time) ──────────────────────
let busy = false;
const queue = [];

function enqueue(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    processQueue();
  });
}

async function processQueue() {
  if (busy) return;
  const next = queue.shift();
  if (!next) return;
  busy = true;
  try {
    const r = await next.task();
    next.resolve(r);
  } catch (e) {
    next.reject(e);
  } finally {
    busy = false;
    if (queue.length) processQueue();
  }
}

function isBusy() {
  return busy;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────

async function ensureBrowser() {
  // Ensure context is alive
  if (!context) {
    if (launchingPromise) return launchingPromise;
    launchingPromise = launchContext().finally(() => (launchingPromise = null));
    await launchingPromise;
  }

  // Return the active page (or the first provider page if none selected yet)
  const providerId = activeProviderId || config.defaultProviderId || "deepseek";
  const state = _pageState(providerId);
  if (state.page && !state.page.isClosed()) return state.page;

  // Page missing — open it
  await ensureProviderPage(providerId, config.getProvider ? config.getProvider(providerId) : null);
  return _pageState(providerId).page;
}

async function launchContext() {
  log(`launching persistent context (headless=${config.headless}, dir=${config.userDataDir})`);
  context = await chromium.launchPersistentContext(config.userDataDir, {
    headless: config.headless,
    viewport: { width: 1280, height: 900 },
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  context.on("close", () => {
    log("context closed — clearing all provider page states");
    for (const state of providerPages.values()) {
      state.page = null;
      state.exposed = false;
      state.currentCallback = null;
      state.interceptorInstalled = false;
    }
    context = null;
  });

  log("browser context ready");
}

/**
 * Ensure a page exists for the given provider. Re-uses an existing open page
 * or creates a new one. Installs the network interceptor and navigates if needed.
 *
 * @param {string} providerId
 * @param {object|null} provider  — full provider config (from providers.json)
 */
async function ensureProviderPage(providerId, provider) {
  if (!context) await launchContext();

  const state = _pageState(providerId);

  if (state.page && !state.page.isClosed()) {
    // Already open — nothing to do
    return state.page;
  }

  // Try to reuse an existing context page by URL, otherwise open a new tab
  const targetUrl = (provider && provider.url) || config.targetUrl;
  const existingPages = context.pages();
  let page = existingPages.find((p) => {
    try { return !p.isClosed() && p.url().startsWith(targetUrl.replace(/\/$/, "")); }
    catch { return false; }
  }) || null;

  if (!page) {
    page = await context.newPage();
  }

  state.page = page;
  state.exposed = false;
  state.interceptorInstalled = false;

  // Install network interceptor if in network mode
  if (config.observationMode === "network" && !state.interceptorInstalled) {
    await installInterceptor(page, {
      onChatStart: (evt) => log(`[${providerId}] network: chat stream started (${evt.url})`),
      onChatChunk: (text) => {
        if (state.currentNetworkParser) state.currentNetworkParser.feed(text);
      },
      onChatDone: () => {
        log(`[${providerId}] network: chat stream done`);
        if (state.currentNetworkResolver) state.currentNetworkResolver("network-done");
      },
      onUploadResponse: (evt) => {
        log(`[${providerId}] network: upload response (${evt.url})`);
        if (page.__relayUploadWaiters && page.__relayUploadWaiters.length) {
          const fn = page.__relayUploadWaiters.shift();
          fn(evt);
        }
      },
      onEvent: (evt) => {
        if (evt.type === "request-error" || evt.type === "capture-error") {
          log(`[${providerId}] network:`, evt.type, evt.error || "");
        }
      },
    });
    state.interceptorInstalled = true;
    log(`[${providerId}] network interceptor installed`);
  }

  // Navigate if needed
  if (!page.url().startsWith(targetUrl.replace(/\/$/, ""))) {
    log(`[${providerId}] navigating to ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  }

  if (state.interceptorInstalled) await flushBuffer(page);

  log(`[${providerId}] page ready`);
  return page;
}

/**
 * Switch the active provider. Returns the page for the new provider.
 * The caller is responsible for bringing that page to the front if desired
 * (Playwright doesn't have a true "bringToFront" across contexts, but the
 * automation still works on background tabs).
 *
 * @param {string} providerId
 * @param {object} provider   — from providers.json
 * @returns {Promise<import('playwright').Page>}
 */
async function switchToProvider(providerId, provider) {
  log(`switching active provider: ${activeProviderId || "(none)"} → ${providerId}`);
  activeProviderId = providerId;

  // Update config selectors + network patterns from provider definition
  _applyProviderConfig(provider);

  const page = await ensureProviderPage(providerId, provider);

  // Try to bring tab to front (best-effort)
  try { await page.bringToFront(); } catch {}

  return page;
}

/**
 * Patch runtime config with provider-specific selectors, network patterns,
 * and observation mode.
 */
function _applyProviderConfig(provider) {
  if (!provider) return;
  if (provider.selectors) {
    Object.assign(config.selectors, provider.selectors);
  }
  if (provider.network) {
    Object.assign(config.network, provider.network);
  }
  // Per-provider observation mode (e.g. Gemini needs "mutation" because it
  // uses batchexecute, not SSE — network interception won't fire there).
  if (provider.observationMode) {
    config.observationMode = provider.observationMode;
  }
  // Keep modelName in sync for health / logs
  if (provider.modelIds && provider.modelIds.length) {
    config.modelName = provider.modelIds[0];
  }
  config.targetUrl = provider.url || config.targetUrl;
}

// ── Page helpers (forward to active page) ─────────────────────────────────

function getPage() {
  if (!activeProviderId) return null;
  const state = _pageState(activeProviderId);
  return state ? state.page : null;
}

function _getActiveState() {
  const id = activeProviderId;
  if (!id) throw new Error("No active provider set");
  return _pageState(id);
}

async function isAlive() {
  try {
    const page = getPage();
    if (!page || page.isClosed()) return false;
    await page.evaluate(() => true);
    return true;
  } catch {
    return false;
  }
}

// ── New-chat support ──────────────────────────────────────────────────────

async function startNewChat(providerId, provider) {
  const pid = providerId || activeProviderId;
  const targetUrl = (provider && provider.url) || config.targetUrl;
  const sel = config.selectors.newChatButton;

  const state = _pageState(pid);
  const p = state && state.page;
  if (!p) {
    log("startNewChat: no page for provider", pid);
    return false;
  }

  if (!isPlaceholder(sel)) {
    try {
      const btn = await p.$(sel).catch(() => null);
      if (btn) {
        await btn.click();
        await p.waitForTimeout(400).catch(() => {});
        log(`[${pid}] started new chat (button click)`);
        return true;
      }
    } catch (e) {
      log(`[${pid}] new-chat button click failed, falling back to navigation:`, e.message);
    }
  }

  try {
    await p.goto("about:blank", { waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
    await p.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await p.waitForSelector(config.selectors.input, { timeout: 10000 }).catch(() => {});
    log(`[${pid}] started new chat (page navigated to root)`);
    return true;
  } catch (e) {
    log(`[${pid}] startNewChat navigation failed:`, e.message);
    return false;
  }
}

async function forceNewChat(providerId, provider) {
  await ensureBrowser();
  return startNewChat(providerId || activeProviderId, provider);
}

// ── Helpers ───────────────────────────────────────────────────────────────

function selectorError(name) {
  const e = new Error(
    `Selector not found: ${name} — site UI may have changed, check providers.json`
  );
  e.code = "SELECTOR_NOT_FOUND";
  return e;
}

function isPlaceholder(sel) {
  return !sel || String(sel).startsWith("TODO");
}

function validateRequiredSelectors() {
  for (const name of ["input", "responseContainer"]) {
    if (isPlaceholder(config.selectors[name])) {
      throw selectorError(name);
    }
  }
}

function abortError() {
  const e = new Error("Request aborted (client disconnected)");
  e.code = "ABORTED";
  return e;
}

function abortPromise(signal) {
  if (!signal) return new Promise(() => {});
  return new Promise((_, reject) => {
    if (signal.aborted) reject(abortError());
    else signal.addEventListener("abort", () => reject(abortError()), { once: true });
  });
}

function readLatestText(p) {
  return p.evaluate((sel) => {
    const nodes = document.querySelectorAll(sel);
    if (!nodes.length) return "";
    return nodes[nodes.length - 1].textContent || "";
  }, config.selectors.responseContainer);
}

async function ensureExposed(p, state) {
  if (state.exposed) return;
  await p.exposeFunction("__relayPush", (fullText) => {
    if (state.currentCallback) state.currentCallback(fullText);
  });
  state.exposed = true;
}

// ── Observation strategies ────────────────────────────────────────────────

async function installMutationObserver(p) {
  await p.evaluate((sel) => {
    let lastText = "";
    function readLatest() {
      const nodes = document.querySelectorAll(sel);
      if (!nodes.length) return null;
      return nodes[nodes.length - 1].textContent || "";
    }
    function pushIfChanged() {
      const t = readLatest();
      if (t == null) return;
      if (t !== lastText) { lastText = t; window.__relayPush(t); }
    }
    const init = readLatest();
    if (init != null) lastText = init;
    const observer = new MutationObserver(() => pushIfChanged());
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.__relayObserverCleanup = () => {
      try { observer.disconnect(); } catch {}
      delete window.__relayObserverCleanup;
    };
  }, config.selectors.responseContainer);

  return async () => {
    try {
      await p.evaluate(() => {
        if (window.__relayObserverCleanup) window.__relayObserverCleanup();
      });
    } catch {}
  };
}

function installPolling(p, state) {
  const interval = setInterval(async () => {
    try {
      const t = await p.evaluate((sel) => {
        const nodes = document.querySelectorAll(sel);
        if (!nodes.length) return null;
        return nodes[nodes.length - 1].textContent || "";
      }, config.selectors.responseContainer);
      if (t != null && state.currentCallback) state.currentCallback(t);
    } catch {}
  }, config.pollIntervalMs);
  return async () => clearInterval(interval);
}

async function setupObserver({ p, state, onDelta, previousText }) {
  let lastSent = previousText;
  let deltaCount = 0;
  let debounceTimer = null;
  let stopWatcher = null;
  let sawStopButton = false;
  let done = false;
  let resolveCompletion;
  const promise = new Promise((res) => { resolveCompletion = res; });

  const finish = (reason) => {
    if (done) return;
    done = true;
    log(`completion: ${reason}`);
    resolveCompletion();
  };

  const handleText = (fullText) => {
    if (done) return;
    let delta = "";
    if (fullText.length > lastSent.length && fullText.startsWith(lastSent)) {
      delta = fullText.slice(lastSent.length);
    } else if (fullText !== lastSent) {
      delta = fullText.slice(lastSent.length);
    }
    lastSent = fullText;

    if (delta) { deltaCount++; onDelta(delta, "content"); }

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(
      () => finish(`debounce (no text change for ${config.completionDebounceMs}ms)`),
      config.completionDebounceMs
    );
  };

  await ensureExposed(p, state);
  state.currentCallback = handleText;

  const removeObserver =
    config.observationMode === "mutation"
      ? await installMutationObserver(p)
      : installPolling(p, state);

  log(`observing via ${config.observationMode} mode`);

  if (!isPlaceholder(config.selectors.stopGeneratingButton)) {
    stopWatcher = setInterval(async () => {
      try {
        const visible = await p
          .locator(config.selectors.stopGeneratingButton)
          .isVisible()
          .catch(() => false);
        if (visible) sawStopButton = true;
        else if (sawStopButton) finish("stop-generating button disappeared");
      } catch {}
    }, config.pollIntervalMs);
  } else {
    log("stop-generating selector not configured; relying on debounce only");
  }

  const cleanup = async () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (stopWatcher) clearInterval(stopWatcher);
    state.currentCallback = null;
    await removeObserver();
  };

  return {
    promise, cleanup,
    get deltaCount() { return deltaCount; },
  };
}

// ── Network-mode observer ─────────────────────────────────────────────────

function setupNetworkObserver({ state, onDelta }) {
  let deltaCount = 0;
  let done = false;
  let debounceTimer = null;
  let resolveCompletion;
  const promise = new Promise((res) => { resolveCompletion = res; });

  const finish = (reason) => {
    if (done) return;
    done = true;
    log(`completion: ${reason}`);
    if (debounceTimer) clearTimeout(debounceTimer);
    setTimeout(() => {
      if (parser) parser.flush();
      resolveCompletion();
    }, 300);
  };

  const parser = createSSEParser({
    onDelta: (delta, type) => {
      if (done) return;
      deltaCount++;
      onDelta(delta, type);
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => finish("network-debounce"), config.networkDebounceMs);
    },
  });

  state.currentNetworkParser = parser;
  state.currentNetworkResolver = finish;

  const cleanup = async () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    state.currentNetworkParser = null;
    state.currentNetworkResolver = null;
  };

  return {
    promise, cleanup,
    get deltaCount() { return deltaCount; },
  };
}

// ── Core: send one message and stream its response ────────────────────────

async function _sendOnce({
  message,
  onDelta,
  onReady,
  signal,
  images,
  textFiles,
  newChat,
  providerId,
  provider,
}) {
  // Ensure we are on the right provider page
  const pid = providerId || activeProviderId;
  const p = await ensureProviderPage(pid, provider);
  const state = _pageState(pid);

  const checkAbort = () => { if (signal && signal.aborted) throw abortError(); };

  checkAbort();
  validateRequiredSelectors();

  // 0. Optionally start a fresh chat thread
  if (newChat && config.newChatPerRequest) {
    await startNewChat(pid, provider);
    checkAbort();
  }

  // 0b. Log prompt size
  const promptKb = (message.length / 1024).toFixed(1);
  if (message.length > 20000) log(`note: prompt is ${promptKb}KB (${message.length} chars)`);

  // 0c. Human-like pacing
  if (newChat && config.newChatPerRequest && config.interRequestDelayMs > 0) {
    await p.waitForTimeout(config.interRequestDelayMs).catch(() => {});
  }

  // 0d. Upload images
  if (images && images.length > 0) {
    await imageRelay.uploadImages(p, images);
    checkAbort();
  }

  // 0e. Upload text files (large payloads)
  if (textFiles && textFiles.length > 0) {
    try {
      await imageRelay.uploadTextFiles(p, textFiles);
    } catch (e) {
      log("text file upload failed:", e.message);
    }
    checkAbort();
  }

  // 0f. Web search toggle (best-effort)
  if (!imageRelay.isPlaceholder(config.selectors.webSearchButton)) {
    try {
      const webSearchBtn = await p.$(config.selectors.webSearchButton).catch(() => null);
      if (webSearchBtn) { await webSearchBtn.click().catch(() => {}); log("clicked native web search toggle"); }
    } catch {}
  }

  // 1. Locate + focus input
  let inputEl;
  try {
    inputEl = await p.waitForSelector(config.selectors.input, { state: "attached", timeout: 15000 });
  } catch (e) {
    throw selectorError("input");
  }

  await inputEl.click();

  // 2. Clear + set new message
  await p.keyboard.press("Control+A").catch(() => {});
  await p.keyboard.press("Delete").catch(() => {});

  let valueSet = false;

  // (a) fill()
  try { await inputEl.fill(message); valueSet = true; } catch {}

  // (b) insertText
  if (!valueSet) {
    try { await inputEl.click(); await p.keyboard.insertText(message); valueSet = true; log("set input via insertText"); } catch {}
  }

  // (c) Native setter
  if (!valueSet) {
    try {
      await inputEl.evaluate((el, val) => {
        const proto =
          el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype :
          el.tagName === "INPUT"    ? window.HTMLInputElement.prototype    : null;
        if (proto) {
          const setter = Object.getOwnPropertyDescriptor(proto, "value");
          if (setter && setter.set) setter.set.call(el, val); else el.value = val;
        } else { el.textContent = val; }
        el.dispatchEvent(new Event("input",  { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, message);
      valueSet = true;
      log("set input via native setter");
    } catch {}
  }

  // (d) Keyboard type (last resort)
  if (!valueSet) {
    if (message.includes("\n")) {
      log("⚠️  WARNING: falling back to keyboard.type for multi-line message");
      await p.keyboard.type(message.split("\n")[0] || " ", { delay: 8 });
    } else {
      await p.keyboard.type(message, { delay: 8 });
    }
  }

  checkAbort();

  // 3. Set up observation strategy
  let completion;
  if (config.observationMode === "network" && state.interceptorInstalled) {
    completion = setupNetworkObserver({ state, onDelta });
  } else {
    if (config.observationMode === "network") {
      log("network mode requested but interceptor not installed; falling back to DOM");
    }
    const previousText = await readLatestText(p).catch(() => "");
    completion = await setupObserver({ p, state, onDelta, previousText });
  }

  // 4. Commit SSE headers
  if (onReady) await onReady();

  // 5. Send
  const sendSel = config.selectors.sendButton;
  const sendSelValid = !isPlaceholder(sendSel);
  let sent = false;
  if (config.clickSendButton && sendSelValid) {
    const btn = await p.$(sendSel).catch(() => null);
    if (btn) { await btn.click(); sent = true; }
    else log("send-button selector matched nothing; falling back to Enter");
  }
  if (!sent && config.pressEnterToSend) { await p.keyboard.press("Enter"); sent = true; }
  if (!sent) throw selectorError("sendButton");

  log("message sent; streaming started");

  // 6. Race: completion vs. timeout vs. abort
  const timeout = new Promise((_, reject) => {
    setTimeout(() => {
      const e = new Error(`Request timed out after ${config.requestTimeoutMs}ms`);
      e.code = "TIMEOUT";
      reject(e);
    }, config.requestTimeoutMs);
  });

  try {
    await Promise.race([completion.promise, timeout, abortPromise(signal)]);
  } finally {
    await completion.cleanup();
  }

  log(`request finished; delta count = ${completion.deltaCount}`);
}

// ── Public entry ──────────────────────────────────────────────────────────

async function sendAndStream({
  message,
  onDelta,
  onReady,
  signal,
  images,
  textFiles,
  newChat,
  providerId,
  provider,
}) {
  return enqueue(async () => {
    let attempts = 0;
    while (true) {
      try {
        return await _sendOnce({ message, onDelta, onReady, signal, images, textFiles, newChat, providerId, provider });
      } catch (e) {
        if (e.code === "SELECTOR_NOT_FOUND" || e.code === "ABORTED" || e.code === "TIMEOUT") throw e;
        attempts++;
        if (attempts > config.maxContextRestarts) throw e;
        log(`request crashed (${e.message}); restarting context (attempt ${attempts}/${config.maxContextRestarts})`);
        await restartProvider(providerId || activeProviderId, provider);
      }
    }
  });
}

async function restartProvider(providerId, provider) {
  log(`restarting page for provider ${providerId}`);
  const state = _pageState(providerId);
  try { if (state.page) await state.page.close(); } catch {}
  state.page = null;
  state.exposed = false;
  state.interceptorInstalled = false;
  state.currentCallback = null;
  state.currentNetworkParser = null;
  state.currentNetworkResolver = null;
  await ensureProviderPage(providerId, provider);
}

async function restart() {
  log("restarting entire browser context");
  try { if (context) await context.close(); } catch (e) { log("error closing context:", e.message); }
  context = null;
  providerPages.clear();
  activeProviderId = null;
  await launchContext();
}

async function continueFromDOM({ previousText, onDelta }) {
  log("Falling back to DOM observation to recover incomplete stream...");
  const p = await ensureBrowser();
  const state = _pageState(activeProviderId);
  let completion;
  try {
    const startText = await readLatestText(p).catch(() => "");
    let baseText = previousText;
    if (startText.length > previousText.length && startText.startsWith(previousText)) {
      baseText = startText;
      const missing = startText.slice(previousText.length);
      onDelta(missing, "content");
    }
    completion = await setupObserver({ p, state, onDelta, previousText: baseText });
    await completion.promise;
  } finally {
    if (completion && completion.cleanup) await completion.cleanup();
  }
}

async function waitForDOMToSettle() {
  log("Waiting for DOM to settle to recover incomplete stream...");
  const p = await ensureBrowser();
  let lastText = await readLatestText(p).catch(() => "");
  while (true) {
    await p.waitForTimeout(config.completionDebounceMs);
    const currentText = await readLatestText(p).catch(() => "");
    if (currentText === lastText && currentText.length > 0) {
      log("DOM settled, returning full text.");
      return currentText;
    }
    lastText = currentText;
  }
}

module.exports = {
  ensureBrowser,
  launchContext,
  restart,
  restartProvider,
  switchToProvider,
  getPage,
  isAlive,
  isBusy,
  sendAndStream,
  waitForDOMToSettle,
  startNewChat,
  forceNewChat,
  config,
  getProviderPage: (pid) => { const s = _pageState(pid); return s ? s.page : null; },
  activeProviderId: () => activeProviderId,
};