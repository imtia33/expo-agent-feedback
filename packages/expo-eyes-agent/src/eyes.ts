/**
 * Eyes — main entry point for the agent SDK.
 *
 * Wraps EyesClient with the event stream and convenience methods.
 *
 * Usage:
 *   import { Eyes } from 'expo-eyes-agent';
 *
 *   const eyes = new Eyes({ relayUrl: 'http://localhost:8765', token: 'abc' });
 *
 *   // Inspect the tree
 *   const { tree } = await eyes.inspect();
 *   console.log(tree);
 *
 *   // Tap a button
 *   await eyes.tap({ ref: 'r5' });
 *
 *   // Stream events (logs, errors) from the phone
 *   for await (const evt of eyes.events()) {
 *     console.log(evt);
 *   }
 */

import { EyesClient, EyesError, type EyesClientOptions } from './client.js';
import { events, type EventsOptions } from './events.js';
import type { PhoneEvent } from './types.js';

export class Eyes {
  private client: EyesClient;
  private relayUrl: string;
  private token: string;

  constructor(opts: EyesClientOptions) {
    this.client = new EyesClient(opts);
    this.relayUrl = opts.relayUrl.replace(/\/+$/, '');
    this.token = opts.token;
  }

  // ─── Tool methods (proxied to client) ───────────────────────────────

  inspect = (args?: Parameters<EyesClient['inspect']>[0]) => this.client.inspect(args ?? {});
  snapshot = (args: Parameters<EyesClient['snapshot']>[0]) => this.client.snapshot(args);
  tap = (args: Parameters<EyesClient['tap']>[0]) => this.client.tap(args);
  longPress = (args: Parameters<EyesClient['longPress']>[0]) => this.client.longPress(args);
  type = (args: Parameters<EyesClient['type']>[0]) => this.client.type(args);
  scrollTo = (args: Parameters<EyesClient['scrollTo']>[0]) => this.client.scrollTo(args);
  expandList = (args: Parameters<EyesClient['expandList']>[0]) => this.client.expandList(args);

  // ─── Status ─────────────────────────────────────────────────────────

  health = () => this.client.health();
  listTools = () => this.client.listTools();

  // ─── Events ─────────────────────────────────────────────────────────

  /**
   * Async iterator over phone events. Yields events forever; use an
   * AbortController (via opts.signal) to stop.
   *
   * Example:
   *   const ac = new AbortController();
   *   setTimeout(() => ac.abort(), 60000); // stop after 1 min
   *   for await (const evt of eyes.events({ signal: ac.signal })) {
   *     console.log(evt);
   *   }
   */
  events(opts: EventsOptions = {}): AsyncGenerator<PhoneEvent, void, void> {
    return events(fetch, this.relayUrl, this.token, opts);
  }

  // ─── Convenience: composite helpers (v2 placeholders) ───────────────

  /**
   * Inspect, find a node by testID, tap it, inspect again.
   * Returns the new tree after the tap.
   */
  async tapByTestId(testID: string): Promise<{ tapped: boolean; newTree: any }> {
    const { tree } = await this.inspect();
    const node = findNodeByTestId(tree, testID);
    if (!node) return { tapped: false, newTree: tree };
    await this.tap({ ref: node.ref });
    const { tree: newTree } = await this.inspect();
    return { tapped: true, newTree };
  }
}

function findNodeByTestId(node: any, testID: string): any {
  if (!node) return null;
  if (node.testID === testID) return node;
  for (const child of node.children || []) {
    const found = findNodeByTestId(child, testID);
    if (found) return found;
  }
  return null;
}

export { EyesError } from './client.js';
export type { EyesClientOptions } from './client.js';
export type { EventsOptions } from './events.js';
export * from './types.js';
export { TOOLS } from './schemas.js';
