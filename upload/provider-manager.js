/**
 * provider-manager.js — Loads providers.json and resolves the active provider
 * from a model ID string. Also manages per-provider browser pages so that
 * Gemini, Qwen and DeepSeek can each keep their own persistent tab open.
 *
 * Adding a new LLM website:
 *   1. Add an entry to providers.json  ← that's it, no JS changes needed.
 *
 * Provider-switch semantics (used by server.js):
 *   - When the incoming model ID maps to a DIFFERENT provider than the last
 *     request, markProviderSwitch() is called so that server.js knows to send
 *     the FULL conversation history on the first message to the new provider.
 */

const fs   = require("fs");
const path = require("path");

// ── Load & validate registry ──────────────────────────────────────────────

const REGISTRY_PATH = path.join(__dirname, "providers.json");

function loadRegistry() {
  const raw = fs.readFileSync(REGISTRY_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.providers) || parsed.providers.length === 0) {
    throw new Error("providers.json must contain a non-empty 'providers' array");
  }
  return parsed.providers;
}

let _providers = loadRegistry();

/** Return the full provider list (re-read each time for hot-reload support). */
function getProviders() {
  return _providers;
}

// ── Resolution ────────────────────────────────────────────────────────────

/**
 * Resolve a provider by model ID.
 * Match strategy (in order):
 *   1. Exact match on one of the provider's modelIds.
 *   2. Prefix/substring match (e.g. "gemini-2.5-pro" → "gemini" entry).
 *   3. Fall back to the first entry (DeepSeek by default).
 *
 * @param {string} modelId
 * @returns {object} provider config object from providers.json
 */
function resolveProvider(modelId) {
  if (!modelId) return _providers[0];
  const lower = String(modelId).toLowerCase();

  // 1. Exact
  for (const p of _providers) {
    if ((p.modelIds || []).some((m) => m.toLowerCase() === lower)) return p;
  }

  // 2. Substring (model name starts with or contains provider model alias)
  for (const p of _providers) {
    if ((p.modelIds || []).some((m) => lower.startsWith(m.toLowerCase()) || lower.includes(m.toLowerCase()))) {
      return p;
    }
  }

  // 3. Fallback — first provider
  return _providers[0];
}

// ── Provider-switch tracking ───────────────────────────────────────────────

let _currentProviderId = null;

/**
 * Call with the resolved provider BEFORE processing a request.
 * Returns true if the provider changed (caller should send full history).
 *
 * @param {object} provider
 * @returns {boolean} switched
 */
function checkAndUpdateProvider(provider) {
  const switched = _currentProviderId !== null && _currentProviderId !== provider.id;
  _currentProviderId = provider.id;
  return switched;
}

function getCurrentProviderId() {
  return _currentProviderId;
}

// ── Character-limit helpers ───────────────────────────────────────────────

/**
 * Returns true when text exceeds the provider's character limit.
 * Providers with charLimit === null have no limit.
 *
 * @param {object} provider
 * @param {string} text
 * @returns {boolean}
 */
function exceedsLimit(provider, text) {
  if (provider.charLimit === null || provider.charLimit === undefined) return false;
  return typeof text === "string" && text.length > provider.charLimit;
}

/**
 * Build a text-file payload (compatible with image-relay.uploadTextFiles) from
 * the given string content.
 *
 * @param {string} content
 * @param {string} [filename]
 * @returns {{ name: string, mimeType: string, buffer: Buffer }}
 */
function buildTextFilePayload(content, filename) {
  const name = filename || `relay-context-${Date.now()}.txt`;
  return {
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(content, "utf8"),
  };
}

// ── Endpoint validation ───────────────────────────────────────────────────

/**
 * Attempt to validate the provider's configured network endpoint by checking
 * whether the browser page (already navigated to the provider URL) actually
 * makes requests matching the pattern.
 *
 * Returns { success, message }.
 * This is a best-effort check — it does NOT make standalone HTTP requests
 * (since many endpoints require cookies/session tokens) and instead relies on
 * the network interceptor having seen traffic to the endpoint.
 *
 * @param {object} provider
 * @param {import('playwright').Page} page  — provider's page
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function validateEndpoint(provider, page) {
  const pattern = provider.network && provider.network.chatEndpointPattern;
  if (!pattern) {
    return { success: false, message: "No chatEndpointPattern configured." };
  }

  try {
    // Intercept the next request matching the pattern for up to 5 s.
    const seen = await Promise.race([
      page.waitForRequest(
        (req) => req.url().includes(pattern),
        { timeout: 5000 }
      ).then(() => true),
      new Promise((res) => setTimeout(() => res(false), 5000)),
    ]);

    if (seen) {
      return {
        success: true,
        message: `Endpoint pattern "${pattern}" was observed in live traffic.`,
      };
    }
    return {
      success: false,
      message: `No request to "${pattern}" observed within 5 s. The pattern may be incorrect or not yet triggered.`,
    };
  } catch (e) {
    return { success: false, message: `Validation error: ${e.message}` };
  }
}

module.exports = {
  getProviders,
  resolveProvider,
  checkAndUpdateProvider,
  getCurrentProviderId,
  exceedsLimit,
  buildTextFilePayload,
  validateEndpoint,
};
