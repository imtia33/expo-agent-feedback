/**
 * EyesProvider — wrap your app root to enable agent control.
 *
 * Usage:
 *   import { EyesProvider } from 'expo-eyes-app';
 *
 *   export default function App() {
 *     return (
 *       <EyesProvider relayUrl="ws://192.168.1.5:8766" token="">
 *         <RealApp />
 *       </EyesProvider>
 *     );
 *   }
 *
 * The provider is a THIN CLIENT. It exposes only 3 primitives to the relay:
 *   - getTree:           raw fiber tree (no refs, no stableIds, no pruning)
 *   - dispatchEvent:     fire onPress/onChangeText/etc. on a fiber
 *   - readLayout:        x/y/width/height for a fiber
 *
 * All higher-level logic (refs, stableIds, snapshot, tap resolution, scroll
 * ancestor search) lives in the relay.
 *
 * In production builds, the provider is a no-op.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Platform, findNodeHandle } from 'react-native';
import { WSClient } from './ws-client';
import { attachDevToolsHook } from './devtools-hook';
import { ToolCall, ToolResult } from './protocol';
import {
  inspectAtPoint,
  listVisibleElements,
  dispatchEvent,
  scroll,
  scrollToIndex,
  diagnostics,
  setRootViewInstance,
  swipe,
  screenshot,
  waitForElement,
  readScreen,
  layout,
  navigate,
  back,
  assertVisible,
  assertText,
  assertEnabled,
  pinch,
  ping,
} from './primitives';

export interface EyesProviderProps {
  /** WebSocket URL of the relay, e.g. ws://192.168.1.5:8766 */
  relayUrl: string;
  /** Auth token — must match the relay's --token flag. Empty string for no-auth. */
  token: string;
  children: React.ReactNode;
  /** Show a small status badge in the corner (default: true in dev) */
  showStatus?: boolean;
}

// Only these primitives are exposed. The relay implements inspect/snapshot/tap/etc.
// Using RN's own inspector API (renderer.rendererConfig.getInspectorDataForViewAtPoint)
// — flat hierarchy, no Hermes depth issues.
const PRIMITIVES = new Set([
  'inspectAtPoint',
  'listVisibleElements',
  'dispatchEvent',
  'scroll',
  'scrollToIndex',
  'diagnostics',
  'swipe',
  'screenshot',
  'waitForElement',
  'readScreen',
  'layout',
  'navigate',
  'back',
  'assertVisible',
  'assertText',
  'assertEnabled',
  'pinch',
  'ping',
]);

const HANDLERS: Record<string, (args: any) => Promise<any>> = {
  inspectAtPoint,
  listVisibleElements,
  dispatchEvent,
  scroll,
  scrollToIndex,
  diagnostics,
  swipe,
  screenshot,
  waitForElement,
  readScreen,
  layout,
  navigate,
  back,
  assertVisible,
  assertText,
  assertEnabled,
  pinch,
  ping,
};

// Best-effort device label for multi-phone sessions (Expo Go reports the
// device name, e.g. "V2333 - 16 - API 36"). Falls back to empty string.
function resolveDeviceName(): string {
  try {
    // Dynamic require — expo-constants ships inside the host app's expo package
    const Constants: any = require('expo-constants');
    return Constants?.default?.deviceName || Constants?.deviceName || Constants?.default?.expoConfig?.name || '';
  } catch {
    return '';
  }
}

export function EyesProvider({ relayUrl, token, children, showStatus = __DEV__ }: EyesProviderProps) {
  const clientRef = useRef<WSClient | null>(null);
  const rootViewRef = useRef<View | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');

  // Capture the root view's host instance so inspectAtPoint can pass it
  // as `inspectedView` to the renderer's getInspectorDataForViewAtPoint.
  // On Fabric (new architecture), passing null means "no view to search
  // within" → the native hit-test never runs → empty hierarchy.
  // We need the actual root host instance.
  const captureRootInstance = () => {
    const node = rootViewRef.current;
    if (!node) return;
    // findNodeHandle returns the native view tag; for the inspector API we
    // need the host instance itself. On Fabric, the ref IS the public
    // instance (has _internalInstanceHandle). On Paper, we get the
    // stateNode via the fiber.
    let hostInstance: any = null;
    try {
      // The ref on a View gives us the host component instance directly
      hostInstance = (node as any)._internalInstanceHandle
        ? node  // Fabric: the ref is the public instance
        : (node as any);  // Paper: same
    } catch {}
    if (hostInstance) {
      setRootViewInstance(hostInstance);
    }
  };

  useEffect(() => {
    if (!__DEV__) return; // no-op in production

    attachDevToolsHook();

    const client = new WSClient(relayUrl, token, resolveDeviceName());
    clientRef.current = client;

    client.onReady = () => setStatus('connected');
    client.onClose = () => setStatus('disconnected');

    // Capture JS runtime errors + unhandled rejections and forward to the relay.
    // This makes Expo CLI console errors visible in /tmp/relay.log (via the
    // event stream) so the agent can debug crashes without reading the Expo
    // terminal directly.
    const errorHandler = (event: any) => {
      const error = event?.error || event?.reason || event;
      const msg = error?.message || String(error);
      const stack = error?.stack;
      try {
        client.send({
          type: 'event',
          event: 'error',
          message: msg,
          stack: __DEV__ ? stack : undefined,
          timestamp: Date.now(),
        });
      } catch {}
    };
    const rejectionHandler = (event: any) => {
      const reason = event?.reason;
      const msg = reason?.message || String(reason);
      const stack = reason?.stack;
      try {
        client.send({
          type: 'event',
          event: 'error',
          message: `Unhandled rejection: ${msg}`,
          stack: __DEV__ ? stack : undefined,
          timestamp: Date.now(),
        });
      } catch {}
    };
    // Capture console.error too (React logs errors via console.error)
    const origConsoleError = console.error;
    const consoleErrorHandler = (...args: any[]) => {
      try {
        const msg = args.map(a => {
          if (typeof a === 'string') return a;
          if (a?.message) return a.message;
          if (a?.stack) return a.stack.split('\n')[0];
          try { return JSON.stringify(a).slice(0, 200); } catch { return String(a); }
        }).join(' ');
        // Only forward actual errors, not React warnings
        if (msg.includes('Error') || msg.includes('error') || msg.includes('TypeError') || msg.includes('undefined is not')) {
          client.send({
            type: 'event',
            event: 'error',
            message: `console.error: ${msg.slice(0, 500)}`,
            timestamp: Date.now(),
          });
        }
      } catch {}
      // Call original
      origConsoleError.apply(console, args as any);
    };

    // Install handlers (only on native — web is idle, no EyesProvider)
    if (Platform.OS !== 'web') {
      // ErrorUtils is RN's global error handler (not window.addEventListener,
      // which doesn't exist on RN native — it would crash the EyesProvider).
      try {
        (globalThis as any).ErrorUtils?.setErrorHandler?.(errorHandler);
        (globalThis as any).ErrorUtils?.setGlobalHandler?.(errorHandler);
      } catch {}
      console.error = consoleErrorHandler as any;
    }

    client.onToolCall = async (msg: ToolCall) => {
      const t0 = Date.now();
      const { callId, tool, args } = msg;

      if (!PRIMITIVES.has(tool)) {
        const result: ToolResult = {
          type: 'tool-result',
          callId,
          ok: false,
          error: {
            code: 'UNKNOWN_TOOL',
            message: `Unknown primitive "${tool}". Valid: ${Array.from(PRIMITIVES).join(', ')}`,
          },
          durationMs: Date.now() - t0,
        };
        client.send(result);
        return;
      }

      try {
        const handler = HANDLERS[tool];
        const result = await handler(args || {});
        client.send({
          type: 'tool-result',
          callId,
          ok: true,
          result,
          refsStillValid: true, // app doesn't know — relay decides
          durationMs: Date.now() - t0,
        });
      } catch (e: any) {
        client.send({
          type: 'tool-result',
          callId,
          ok: false,
          error: {
            code: e.code || 'TOOL_ERROR',
            message: e.message || String(e),
            stack: __DEV__ ? e.stack : undefined,
          },
          durationMs: Date.now() - t0,
        });
      }
    };

    client.connect();

    // Capture the root view instance after first render (refs are set by then).
    captureRootInstance();

    return () => {
      client.close();
      clientRef.current = null;
      setRootViewInstance(null);
      // Restore original console.error
      if (Platform.OS !== 'web') {
        console.error = origConsoleError as any;
      }
    };
  }, [relayUrl, token]);

  if (!__DEV__) {
    return <>{children}</>;
  }

  return (
    <View
      ref={rootViewRef as any}
      collapsable={false}
      style={styles.rootWrapper}
      onLayout={captureRootInstance}
    >
      {children}
      {showStatus && <StatusBadge status={status} />}
    </View>
  );
}

function StatusBadge({ status }: { status: 'connecting' | 'connected' | 'disconnected' }) {
  const color = status === 'connected' ? '#22c55e' : status === 'connecting' ? '#f59e0b' : '#ef4444';
  return (
    <View pointerEvents="none" style={[styles.badge, { backgroundColor: color }]}>
      <Text style={styles.text}>eyes:{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  rootWrapper: {
    flex: 1,
  },
  badge: {
    position: 'absolute',
    top: 50,
    right: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    zIndex: 9999,
    elevation: 9999,
  },
  text: {
    color: 'white',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});

export default EyesProvider;
