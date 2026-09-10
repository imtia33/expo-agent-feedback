/**
 * Event stream — async iterator over phone events (logs, errors).
 *
 * Uses long-polling on /events?since=N. Yields events as they arrive.
 *
 * Usage:
 *   for await (const event of eyes.events()) {
 *     if (event.event === 'log' && event.level === 'error') {
 *       console.error('Phone error:', event.args);
 *     }
 *   }
 *
 * The iterator runs forever. Use AbortController to stop it.
 */

import type { PhoneEvent } from './types.js';

export interface EventsOptions {
  /** Abort the stream. */
  signal?: AbortSignal;
  /** Don't yield events older than this timestamp. Default: now. */
  since?: number;
  /** Poll interval fallback (ms). Default 2000. */
  pollIntervalMs?: number;
}

export async function* events(
  fetchImpl: typeof fetch,
  relayUrl: string,
  token: string,
  opts: EventsOptions = {},
): AsyncGenerator<PhoneEvent, void, void> {
  let since = opts.since ?? Date.now();
  const pollIntervalMs = opts.pollIntervalMs ?? 2000;
  const signal = opts.signal;

  while (true) {
    if (signal?.aborted) return;

    let url = `${relayUrl}/events?since=${since}&count=100`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

      const res = await fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        // Wait and retry on error
        await sleep(pollIntervalMs);
        continue;
      }

      const data = (await res.json()) as { events: PhoneEvent[] };
      for (const evt of data.events || []) {
        if (evt.timestamp > since) {
          since = evt.timestamp;
          yield evt;
        }
      }
    } catch (e: any) {
      if (signal?.aborted) return;
      // Network error or timeout — wait and retry
      await sleep(pollIntervalMs);
    }

    // Small delay between polls (we don't have true long-poll in v1)
    await sleep(pollIntervalMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
