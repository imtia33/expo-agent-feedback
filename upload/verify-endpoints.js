/**
 * verify-endpoints.js — discover the REAL network endpoints, selectors and
 * SSE shapes for any provider in providers.json.
 *
 * USAGE
 *   node verify-endpoints.js [provider-id]
 *   node verify-endpoints.js gemini
 *   node verify-endpoints.js qwen
 *   node verify-endpoints.js deepseek   (default if omitted)
 *   node verify-endpoints.js --list     (show all configured providers)
 *
 * WHAT IT DOES
 *   1. Opens the provider's URL in a headed Chrome window (same persistent
 *      profile as the relay, so you stay logged in).
 *   2. Logs every API request the page makes.
 *   3. Highlights:
 *        ★ CHAT ENDPOINT  — any SSE / ndjson POST response (prints first 2KB
 *          of the stream so you can see the JSON shape).
 *        ★ UPLOAD ENDPOINT — multipart/form-data POST or JSON with url/file_id.
 *        ★ SELECTOR SCAN  — tries all selectors declared for this provider in
 *          providers.json and reports which ones are found in the DOM.
 *   4. On Ctrl+C prints a summary and OPTIONALLY writes the discovered
 *      chatEndpointPattern / uploadEndpointPattern back into providers.json.
 *
 * HOW TO USE
 *   1. Make sure the main relay server is NOT running (shared profile lock).
 *   2. Run:  node verify-endpoints.js gemini
 *   3. A Chrome window opens at gemini.google.com/app
 *   4. Log in if needed, then SEND A TEST MESSAGE → watch for ★ CHAT ENDPOINT.
 *   5. (Optional) Click attach / upload an image → watch for ★ UPLOAD ENDPOINT.
 *   6. Press Ctrl+C → summary prints; answer Y to auto-patch providers.json.
 */

"use strict";

const { chromium } = require("playwright");
const fs           = require("fs");
const path         = require("path");
const readline     = require("readline");

const config         = require("./config");
const PROVIDERS_PATH = path.join(__dirname, "providers.json");

// ── ANSI colours ──────────────────────────────────────────────────────────
const C = {
  reset:   "\x1b[0m",
  dim:     "\x1b[2m",
  bold:    "\x1b[1m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  cyan:    "\x1b[36m",
  red:     "\x1b[31m",
  magenta: "\x1b[35m",
  blue:    "\x1b[34m",
};
const log = (...a) => console.log(...a);
const hr  = (ch = "─", n = 70) => log(C.dim + ch.repeat(n) + C.reset);

// ── Load providers registry ────────────────────────────────────────────────
function loadRegistry() {
  return JSON.parse(fs.readFileSync(PROVIDERS_PATH, "utf8"));
}

// ── CLI arg ────────────────────────────────────────────────────────────────
const arg = process.argv[2] || "";

if (arg === "--list" || arg === "-l") {
  const reg = loadRegistry();
  log(`\n${C.bold}Configured providers:${C.reset}`);
  for (const p of reg.providers) {
    log(`  ${C.cyan}${p.id.padEnd(12)}${C.reset} ${p.name.padEnd(22)} ${C.dim}${p.url}${C.reset}`);
    log(`               models: ${(p.modelIds || []).join(", ")}`);
  }
  log(`\nUsage: node verify-endpoints.js [provider-id]\n`);
  process.exit(0);
}

const registry = loadRegistry();
const provider  = arg
  ? registry.providers.find((p) => p.id === arg)
  : registry.providers[0];

if (!provider) {
  log(`${C.red}Unknown provider "${arg}". Run with --list to see options.${C.reset}`);
  process.exit(1);
}

const TARGET  = provider.url;
const PROFILE = config.userDataDir;

// ── Findings accumulator ───────────────────────────────────────────────────
const findings = {
  chatEndpoints:   new Set(),
  uploadEndpoints: new Set(),
  sseShapes:       [],
  selectorResults: {},
};

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname + (u.search ? u.search.slice(0, 40) + "…" : "");
  } catch {
    return url.slice(0, 100);
  }
}

function fmtOrigin(url) {
  try { return new URL(url).origin; } catch { return ""; }
}

/** Scan all provider selectors and return {name: found/missing} */
async function scanSelectors(page) {
  const results = {};
  const sels    = provider.selectors || {};
  for (const [name, sel] of Object.entries(sels)) {
    if (!sel || sel.startsWith("TODO")) {
      results[name] = { found: false, note: "not configured (TODO)" };
      continue;
    }
    try {
      const el = await page.$(sel).catch(() => null);
      results[name] = { found: !!el, selector: sel };
    } catch (e) {
      results[name] = { found: false, error: e.message, selector: sel };
    }
  }
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════════════╗${C.reset}`);
  log(`${C.bold}${C.cyan}║  Chat-Relay Endpoint & Selector Verifier                         ║${C.reset}`);
  log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════════════╝${C.reset}\n`);

  log(`${C.bold}Provider:${C.reset} ${provider.name} ${C.dim}(${provider.id})${C.reset}`);
  log(`${C.bold}URL:${C.reset}      ${TARGET}`);
  log(`${C.bold}Profile:${C.reset}  ${PROFILE}  ${C.dim}(login persists here)${C.reset}\n`);
  log(`${C.bold}Instructions:${C.reset}`);
  log(`  1. ${C.green}Log in${C.reset} if the Chrome window asks for credentials.`);
  log(`  2. ${C.green}Send a test message${C.reset} → watch for ${C.bold}★ CHAT ENDPOINT${C.reset} below.`);
  log(`  3. ${C.green}Upload an image or file${C.reset} → watch for ${C.bold}★ UPLOAD ENDPOINT${C.reset}.`);
  log(`  4. Press ${C.bold}Ctrl+C${C.reset} to stop. The summary will offer to auto-patch providers.json.\n`);
  hr();

  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const page = context.pages()[0] || (await context.newPage());

  // ── Request logger ────────────────────────────────────────────────────
  page.on("request", (req) => {
    const method = req.method();
    const url    = req.url();

    // Skip static assets
    if (/\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|ico|map|wasm)(\?|$)/i.test(url)) return;
    if (method === "GET" && /\.(json|xml)(\?|$)/i.test(url)) return;

    const ct          = req.headers()["content-type"] || "";
    const isMultipart = ct.includes("multipart/form-data");
    const isPost      = method === "POST";

    if (isMultipart) {
      log(`${C.magenta}[UPLOAD?]${C.reset} ${C.bold}POST${C.reset} ${fmtUrl(url)} ${C.dim}(multipart)${C.reset}`);
      findings.uploadEndpoints.add(fmtUrl(url));
    } else if (isPost) {
      let bodyPreview = "";
      try {
        const body = req.postData();
        if (body) bodyPreview = body.length > 160 ? body.slice(0, 160) + "…" : body;
      } catch {}
      log(
        `${C.dim}[POST]${C.reset} ${fmtUrl(url)}` +
        (ct ? ` ${C.dim}${ct.split(";")[0]}${C.reset}` : "") +
        (bodyPreview ? `\n       ${C.dim}body: ${bodyPreview}${C.reset}` : "")
      );
    } else {
      log(`${C.dim}[${method}]${C.reset} ${fmtUrl(url)}`);
    }
  });

  // ── Response logger ───────────────────────────────────────────────────
  page.on("response", async (res) => {
    const url    = res.url();
    const method = res.request().method();
    const status = res.status();
    const ct     = res.headers()["content-type"] || "";

    if (/\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|ico|map|wasm)(\?|$)/i.test(url)) return;

    const isSSE = (ct.includes("text/event-stream") || ct.includes("application/x-ndjson"))
                  && method === "POST";
    const reqCt = res.request().headers()["content-type"] || "";
    const isMultipartResponse = reqCt.includes("multipart/form-data");

    // ── ★ CHAT ENDPOINT ───────────────────────────────────────────────
    if (isSSE) {
      const urlPath = fmtUrl(url);
      findings.chatEndpoints.add(urlPath);
      log("");
      log(`${C.bold}${C.green}★ CHAT ENDPOINT DETECTED${C.reset} ${C.green}POST ${urlPath}${C.reset} ${C.dim}(${status} ${ct})${C.reset}`);
      log(`  ${C.dim}Full URL: ${url.slice(0, 120)}${C.reset}`);

      try {
        const body = await res.body();
        const text = body.toString("utf8").slice(0, 2048);
        log(`  ${C.cyan}First SSE chunks (raw):${C.reset}`);
        for (const line of text.split("\n").slice(0, 20)) {
          if (line.trim()) log(`  ${C.cyan}  ${line}${C.reset}`);
        }
        findings.sseShapes.push({ urlPath, fullUrl: url, sample: text });

        log(`  ${C.dim}Shape hint:${C.reset}`);
        if (/"content"\s*:/.test(text))
          log(`  ${C.green}  → DeepSeek-style: { "content": "..." }${C.reset}`);
        else if (/"choices"\s*:/.test(text))
          log(`  ${C.green}  → OpenAI-style: { "choices": [{ "delta": { "content": "..." } }] }${C.reset}`);
        else if (/"text"\s*:/.test(text))
          log(`  ${C.yellow}  → Possible { "text": "..." } shape (check network-interceptor.js)${C.reset}`);
        else
          log(`  ${C.yellow}  → Unknown shape — inspect the raw lines above${C.reset}`);
      } catch (e) {
        log(`  ${C.red}(couldn't buffer body: ${e.message})${C.reset}`);
      }
      log("");
      return;
    }

    // ── ★ UPLOAD ENDPOINT (multipart response) ───────────────────────
    if (isMultipartResponse && status >= 200 && status < 300) {
      const urlPath = fmtUrl(url);
      findings.uploadEndpoints.add(urlPath);
      log("");
      log(`${C.bold}${C.magenta}★ UPLOAD ENDPOINT DETECTED${C.reset} ${C.magenta}POST ${urlPath}${C.reset} ${C.dim}(${status})${C.reset}`);
      try {
        const body = await res.body();
        log(`  ${C.magenta}Response: ${body.toString("utf8").slice(0, 400)}${C.reset}`);
      } catch {}
      log("");
      return;
    }

    // ── ★ POSSIBLE UPLOAD ENDPOINT (JSON with file id/url) ───────────
    if (method === "POST" && ct.includes("application/json") && status >= 200 && status < 300) {
      try {
        const body = await res.body();
        const text = body.toString("utf8").slice(0, 600);
        if (/"(url|fid|file_id|fileId|location|attachment_id|upload_id)"/i.test(text)) {
          const urlPath = fmtUrl(url);
          if (!findings.uploadEndpoints.has(urlPath)) {
            findings.uploadEndpoints.add(urlPath);
            log("");
            log(`${C.bold}${C.magenta}★ POSSIBLE UPLOAD ENDPOINT${C.reset} ${C.magenta}POST ${urlPath}${C.reset}`);
            log(`  ${C.magenta}Response: ${text}${C.reset}`);
            log("");
          }
        }
      } catch {}
    }
  });

  // ── Navigate ──────────────────────────────────────────────────────────
  log(`${C.dim}Navigating to ${TARGET}…${C.reset}`);
  await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 60000 });
  log(`${C.green}Page loaded. Interact with the site.${C.reset}`);
  hr();
  log("");

  // ── Run selector scan once after load ─────────────────────────────────
  await page.waitForTimeout(2000).catch(() => {});
  log(`${C.bold}${C.blue}── Selector scan (from providers.json) ──${C.reset}`);
  findings.selectorResults = await scanSelectors(page);
  for (const [name, r] of Object.entries(findings.selectorResults)) {
    const icon = r.found ? `${C.green}✔${C.reset}` : `${C.red}✘${C.reset}`;
    const note = r.note  ? ` ${C.dim}(${r.note})${C.reset}` : "";
    const sel  = r.selector ? ` ${C.dim}← ${r.selector}${C.reset}` : "";
    log(`  ${icon} ${name.padEnd(24)}${r.found ? C.green : C.yellow}${r.found ? "FOUND" : "NOT FOUND"}${C.reset}${sel}${note}`);
  }
  log("");
  log(`${C.dim}Tip: open DevTools (F12) → Elements to find correct selectors.${C.reset}`);
  hr();
  log("");

  // Keep running until Ctrl+C
  await new Promise(() => {});
}

// ── Summary + optional providers.json patch ────────────────────────────────
async function printSummaryAndMaybePatch() {
  log("");
  log(`${C.bold}${C.cyan}═══ SUMMARY for ${provider.name} ═══${C.reset}\n`);

  // ── Chat endpoints ────────────────────────────────────────────────────
  if (findings.chatEndpoints.size > 0) {
    log(`${C.bold}${C.green}Chat completion endpoint(s):${C.reset}`);
    for (const p of findings.chatEndpoints) {
      log(`  ${C.green}→${C.reset} ${p}`);
    }
    log("");
  }

  // ── SSE shapes ────────────────────────────────────────────────────────
  if (findings.sseShapes.length > 0) {
    log(`${C.bold}SSE response shape (first detected):${C.reset}`);
    const sample = findings.sseShapes[0].sample.slice(0, 300);
    log(`  ${C.dim}${sample.replace(/\n/g, "\n  ")}${C.reset}\n`);
  }

  // ── Upload endpoints ──────────────────────────────────────────────────
  if (findings.uploadEndpoints.size > 0) {
    log(`${C.bold}${C.magenta}Upload endpoint(s):${C.reset}`);
    for (const p of findings.uploadEndpoints) {
      log(`  ${C.magenta}→${C.reset} ${p}`);
    }
    log("");
  }

  // ── Selector results ──────────────────────────────────────────────────
  const missing = Object.entries(findings.selectorResults).filter(([, r]) => !r.found && !r.note);
  if (missing.length > 0) {
    log(`${C.bold}${C.yellow}Selectors NOT found in DOM:${C.reset}`);
    for (const [name, r] of missing) {
      log(`  ${C.yellow}✘ ${name}${C.reset}  ${C.dim}${r.selector || ""}${C.reset}`);
    }
    log(`\n${C.dim}Fix these in providers.json → selectors for ${provider.id}.${C.reset}\n`);
  }

  if (findings.chatEndpoints.size === 0 && findings.uploadEndpoints.size === 0) {
    log(`${C.yellow}No endpoints detected. Did you send a message in the browser?${C.reset}\n`);
    return;
  }

  // ── Offer to patch providers.json ─────────────────────────────────────
  const chatEp   = [...findings.chatEndpoints][0];
  const uploadEp = [...findings.uploadEndpoints][0];

  const changes = [];
  if (chatEp   && chatEp   !== provider.network?.chatEndpointPattern)   changes.push(`chatEndpointPattern   → "${chatEp}"`);
  if (uploadEp && uploadEp !== provider.network?.uploadEndpointPattern) changes.push(`uploadEndpointPattern → "${uploadEp}"`);

  if (changes.length === 0) {
    log(`${C.green}providers.json already has correct endpoint patterns. No changes needed.${C.reset}\n`);
    return;
  }

  log(`${C.bold}The following changes could be applied to providers.json:${C.reset}`);
  for (const ch of changes) log(`  ${C.cyan}${ch}${C.reset}`);
  log("");

  // Ask interactively
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve) => {
    rl.question(`${C.bold}Write these to providers.json? [Y/n] ${C.reset}`, (ans) => {
      rl.close();
      if (ans.trim().toLowerCase() !== "n") {
        patchProvidersJson({ providerId: provider.id, chatEp, uploadEp });
        log(`${C.green}✔ providers.json updated.${C.reset}\n`);
      } else {
        log(`${C.dim}Skipped.${C.reset}\n`);
      }
      resolve();
    });
  });
}

function patchProvidersJson({ providerId, chatEp, uploadEp }) {
  const reg = loadRegistry();
  const target = reg.providers.find((p) => p.id === providerId);
  if (!target) return;

  if (!target.network) target.network = {};
  if (chatEp)   target.network.chatEndpointPattern   = chatEp;
  if (uploadEp) target.network.uploadEndpointPattern = uploadEp;

  // Also mark validatedEndpoint
  if (chatEp) target.validatedEndpoint = chatEp;

  fs.writeFileSync(PROVIDERS_PATH, JSON.stringify(reg, null, 2) + "\n", "utf8");
}

// ── Graceful exit ──────────────────────────────────────────────────────────
process.on("SIGINT", async () => {
  log("\n");
  try {
    await printSummaryAndMaybePatch();
  } catch (e) {
    log(`${C.red}Summary error: ${e.message}${C.reset}`);
  }
  process.exit(0);
});

main().catch((e) => {
  log(`${C.red}Fatal: ${e.message}${C.reset}`);
  console.error(e);
  process.exit(1);
});
