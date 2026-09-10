/**
 * Central configuration for the Local AI Chat Relay Server.
 *
 * Provider-specific values (selectors, network patterns, URLs) are now stored
 * in providers.json and injected at runtime by provider-manager + browser.js.
 * This file keeps the process-level / operational settings only.
 */
const env = process.env;

const config = {
  port:         Number(env.PORT || 3333),
  // Default target URL — overridden at runtime when a provider is selected
  targetUrl:    env.TARGET_URL || "https://chat.deepseek.com",
  userDataDir:  env.USER_DATA_DIR || "./chrome-profile",
  headless:     env.HEADLESS === "true" || process.argv.includes("--headless"),

  // Which provider to boot with (first in providers.json wins if not set)
  defaultProviderId: env.DEFAULT_PROVIDER || null,

  pollIntervalMs:          Number(env.POLL_INTERVAL_MS          || 200),
  completionDebounceMs:    Number(env.COMPLETION_DEBOUNCE_MS    || 1500),
  networkDebounceMs:       Number(env.NETWORK_DEBOUNCE_MS       || 60000),
  maxToolResultLength:     Number(env.MAX_TOOL_RESULT_LENGTH     || 15000),
  requestTimeoutMs:        Number(env.REQUEST_TIMEOUT_MS        || 180000),
  maxContextRestarts:      1,
  interRequestDelayMs:     Number(env.INTER_REQUEST_DELAY_MS    || 800),

  // ─── Delta mode ──────────────────────────────────────────────────────
  deltaMode:        env.DELTA_MODE !== "false",
  sessionMaxIdleMs: Number(env.SESSION_MAX_IDLE_MS || 600000),

  logRawSSE:        env.LOG_RAW_SSE !== "false",
  logRawSSEConsole: env.LOG_RAW_SSE_CONSOLE === "true",

  pressEnterToSend:  true,
  clickSendButton:   true,
  observationMode:   env.OBSERVATION_MODE || "network",

  // ─── Network patterns (overridden per-provider at runtime) ───────────
  network: {
    chatEndpointPattern:   env.CHAT_ENDPOINT_PATTERN   || "/api/v0/chat/completion",
    uploadEndpointPattern: env.UPLOAD_ENDPOINT_PATTERN || "/api/v0/file/upload_file",
  },

  // ─── Disabled auto-new-chat ──────────────────────────────────────────
  newChatPerRequest: env.NEW_CHAT_PER_REQUEST === "true",

  toolCallStartTag: env.TOOL_CALL_START_TAG || "<tool" + "_call>",
  toolCallEndTag:   env.TOOL_CALL_END_TAG   || "</tool" + "_call>",

  // modelName is updated at runtime when a provider is selected
  modelName: env.MODEL_NAME || "deepseek-chat",

  // ─── Selectors (runtime-patched from providers.json) ─────────────────
  selectors: {
    input:               env.INPUT_SELECTOR          || "textarea.ds-scroll-area.ds-scroll-area--show-on-focus-within.ds-scroll-area--enabled",
    sendButton:          env.SEND_BUTTON_SELECTOR    || "button.ds-button--primary.ds-button--filled.ds-button--circle",
    responseContainer:   env.RESPONSE_CONTAINER_SELECTOR || "div.ds-assistant-message-main-content",
    stopGeneratingButton: env.STOP_GENERATING_SELECTOR || "button.ds-button--primary.ds-button--filled.ds-button--circle.ds-button--disabled",
    newChatButton:       env.NEW_CHAT_BUTTON_SELECTOR || "TODO_FILL_NEW_CHAT_BUTTON_SELECTOR",
    textFileInput:       env.TEXT_FILE_INPUT_SELECTOR || 'input[type="file"][style*="display: none"]',
    imageFileInput:      env.IMAGE_FILE_INPUT_SELECTOR || 'input[type="file"][style*="display: none"]',
    webSearchButton:     env.WEB_SEARCH_BUTTON_SELECTOR || "TODO_FILL_WEB_SEARCH_BUTTON_SELECTOR",
  },

  fileUploadProcessingWaitMs: Number(env.FILE_UPLOAD_PROCESSING_WAIT_MS || 4000),
};

module.exports = config;
