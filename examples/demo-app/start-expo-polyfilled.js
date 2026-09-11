#!/usr/bin/env node
/**
 * Expo CLI launcher with Node-side polyfills for SSR safety.
 *
 * PROBLEM:
 *   @gorhom/bottom-sheet + react-native-reanimated call `requestAnimationFrame`
 *   at module-evaluation time. On native (Expo Go) this is fine. But Expo CLI
 *   also runs a Node-side SSR render to produce the web HTML, and Node has no
 *   `requestAnimationFrame`. The call throws `ReferenceError: requestAnimationFrame
 *   is not defined`, which crashes the entire Expo process — killing native
 *   bundle serving too (Expo Go disconnects).
 *
 * FIX:
 *   Polyfill `requestAnimationFrame` / `cancelAnimationFrame` on the global
 *   object BEFORE requiring @expo/cli. The SSR render then no-ops the rAF
 *   call (it just schedules a setTimeout that never fires because the SSR
 *   response is sent synchronously). The native bundle is unaffected.
 *
 * USAGE (replaces `node node_modules/expo/bin/cli`):
 *   node start-expo-polyfilled.js start --port 8081 --host lan --clear
 */

// ── Polyfills (must run before any require that touches reanimated) ──
if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = function (cb) {
    return setTimeout(function () { cb(Date.now()); }, 0);
  };
}
if (typeof globalThis.cancelAnimationFrame !== 'function') {
  globalThis.cancelAnimationFrame = function (id) {
    clearTimeout(id);
  };
}

// ── Launch the real Expo CLI ──
require('expo/bin/cli');
