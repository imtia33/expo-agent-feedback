/**
 * EyesProvider — wrap your app root to enable agent control.
 *
 * Usage:
 *   import { EyesProvider } from 'expo-eyes-app';
 *
 *   export default function App() {
 *     return (
 *       <EyesProvider relayUrl="ws://192.168.1.5:8766" token="abc123">
 *         <RealApp />
 *       </EyesProvider>
 *     );
 *   }
 *
 * The provider:
 *   1. Attaches to __REACT_DEVTOOLS_GLOBAL_HOOK__ on mount
 *   2. Opens a WS connection to the relay (auto-reconnect)
 *   3. Listens for tool calls and dispatches them to the right tool
 *   4. Sends results back to the relay
 *
 * In production builds, the provider is a no-op (returns children directly).
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { WSClient } from './ws-client';
import { attachDevToolsHook } from './devtools-hook';
import { ToolCall, ToolResult } from './protocol';

import { inspect } from './tools/inspect';
import { snapshot } from './tools/snapshot';
import { tap, longPress } from './tools/tap';
import { type as typeTool } from './tools/type';
import { scrollTo } from './tools/scroll';
import { expandList } from './tools/expandList';

export interface EyesProviderProps {
  /** WebSocket URL of the relay, e.g. ws://192.168.1.5:8766 */
  relayUrl: string;
  /** Auth token — must match the relay's --token flag */
  token: string;
  children: React.ReactNode;
  /** Show a small status badge in the corner (default: true in dev) */
  showStatus?: boolean;
}

const TOOL_HANDLERS: Record<string, (args: any) => Promise<any>> = {
  inspect,
  snapshot,
  tap,
  longPress,
  type: typeTool,
  scrollTo,
  expandList,
};

const VALID_TOOLS = new Set(Object.keys(TOOL_HANDLERS));

export function EyesProvider({ relayUrl, token, children, showStatus = __DEV__ }: EyesProviderProps) {
  const clientRef = useRef<WSClient | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');

  useEffect(() => {
    if (!__DEV__) return; // no-op in production

    // Attach to React DevTools hook
    attachDevToolsHook();

    // Set up WS client
    const client = new WSClient(relayUrl, token);
    clientRef.current = client;

    client.onReady = () => setStatus('connected');
    client.onClose = () => setStatus('disconnected');

    client.onToolCall = async (msg: ToolCall) => {
      const t0 = Date.now();
      const { callId, tool, args } = msg;

      if (!VALID_TOOLS.has(tool)) {
        const result: ToolResult = {
          type: 'tool-result',
          callId,
          ok: false,
          error: {
            code: 'UNKNOWN_TOOL',
            message: `Unknown tool "${tool}". Valid: ${Array.from(VALID_TOOLS).join(', ')}`,
          },
          durationMs: Date.now() - t0,
        };
        client.send(result);
        return;
      }

      try {
        const handler = TOOL_HANDLERS[tool];
        const handlerResult = await handler(args || {});

        // Tools return { ok, refsStillValid, ...rest }. Spread the rest as result.
        const { ok, refsStillValid = true, ...rest } = handlerResult as any;
        const result: ToolResult = {
          type: 'tool-result',
          callId,
          ok: true,
          result: rest,
          refsStillValid,
          durationMs: Date.now() - t0,
        };
        client.send(result);
      } catch (e: any) {
        const result: ToolResult = {
          type: 'tool-result',
          callId,
          ok: false,
          error: {
            code: e.code || 'TOOL_ERROR',
            message: e.message || String(e),
            stack: __DEV__ ? e.stack : undefined,
          },
          durationMs: Date.now() - t0,
        };
        client.send(result);
      }
    };

    client.connect();

    return () => {
      client.close();
      clientRef.current = null;
    };
  }, [relayUrl, token]);

  // In production, just render children
  if (!__DEV__) {
    return <>{children}</>;
  }

  return (
    <>
      {children}
      {showStatus && <StatusBadge status={status} />}
    </>
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
