/**
 * HTTP client — typed wrapper around the relay's HTTP API.
 *
 * Responsibilities:
 *   - Send tool calls with bearer auth
 *   - Validate args before sending (catches agent mistakes early)
 *   - Validate results after receiving (catches relay/phone bugs)
 *   - Auto-retry on 503 (phone temporarily disconnected) — 1 retry, 1s delay
 *   - Throw structured errors (not strings) for the agent to handle
 *
 * Verified against express 5 response shapes (see docs/libraries/express-API-summary.md)
 * and the relay's own /tool/:name endpoint (see packages/expo-eyes-relay/src/http-server.js).
 */

import { TOOLS } from './schemas.js';
import type {
  InspectArgs, InspectResult,
  SnapshotArgs, SnapshotResult,
  TapArgs, TapResult,
  LongPressArgs, LongPressResult,
  TypeArgs, TypeResult,
  ScrollToArgs, ScrollToResult,
  ExpandListArgs, ExpandListResult,
  ToolName,
} from './types.js';

export interface EyesClientOptions {
  /** Base URL of the relay, e.g. 'http://localhost:8765' or 'https://relay.example.com' */
  relayUrl: string;
  /** Auth token. Sent as `Authorization: Bearer <token>`. */
  token: string;
  /** Per-call timeout in ms. Default 30000. */
  timeoutMs?: number;
  /** Max retries on 503 (phone disconnected). Default 1. */
  maxRetries?: number;
  /** Retry delay in ms. Default 1000. */
  retryDelayMs?: number;
  /** Optional fetch override (for testing). */
  fetch?: typeof fetch;
}

export class EyesError extends Error {
  code: string;
  statusCode?: number;
  tool?: string;
  constructor(message: string, code: string, opts: { statusCode?: number; tool?: string; cause?: unknown } = {}) {
    super(message);
    this.name = 'EyesError';
    this.code = code;
    this.statusCode = opts.statusCode;
    this.tool = opts.tool;
    if (opts.cause) (this as any).cause = opts.cause;
  }
}

export class EyesClient {
  private relayUrl: string;
  private token: string;
  private timeoutMs: number;
  private maxRetries: number;
  private retryDelayMs: number;
  private fetchImpl: typeof fetch;

  constructor(opts: EyesClientOptions) {
    if (!opts.relayUrl) throw new EyesError('relayUrl is required', 'BAD_CONFIG');
    if (!opts.token) throw new EyesError('token is required', 'BAD_CONFIG');
    this.relayUrl = opts.relayUrl.replace(/\/+$/, ''); // trim trailing slash
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs ?? 30000;
    this.maxRetries = opts.maxRetries ?? 1;
    this.retryDelayMs = opts.retryDelayMs ?? 1000;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  // ─── Public API: typed tool methods ──────────────────────────────────

  async inspect(args: InspectArgs = {}): Promise<InspectResult> {
    return this.callTool('inspect', args);
  }

  async snapshot(args: SnapshotArgs): Promise<SnapshotResult> {
    return this.callTool('snapshot', args);
  }

  async tap(args: TapArgs): Promise<TapResult> {
    return this.callTool('tap', args);
  }

  async longPress(args: LongPressArgs): Promise<LongPressResult> {
    return this.callTool('longPress', args);
  }

  async type(args: TypeArgs): Promise<TypeResult> {
    return this.callTool('type', args);
  }

  async scrollTo(args: ScrollToArgs): Promise<ScrollToResult> {
    return this.callTool('scrollTo', args);
  }

  async expandList(args: ExpandListArgs): Promise<ExpandListResult> {
    return this.callTool('expandList', args);
  }

  // ─── Health / status ─────────────────────────────────────────────────

  async health(): Promise<{
    ok: boolean;
    relay: { httpPort: number; wsPort: number };
    phone: {
      phoneConnected: boolean;
      phoneInfo: any;
      pendingCalls: number;
      eventLogSize: number;
    };
  }> {
    const res = await this.fetchImpl(`${this.relayUrl}/health`, { method: 'GET' });
    if (!res.ok) throw new EyesError(`health check failed: ${res.status}`, 'HEALTH_FAIL', { statusCode: res.status });
    return res.json() as Promise<any>;
  }

  async listTools(): Promise<Array<{ name: string; description: string; args: Record<string, string>; returns: string }>> {
    const res = await this.fetchImpl(`${this.relayUrl}/tools`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) throw new EyesError(`listTools failed: ${res.status}`, 'LIST_FAIL', { statusCode: res.status });
    const data = await res.json() as any;
    return data.tools;
  }

  // ─── Core tool call method ──────────────────────────────────────────

  private async callTool<T extends ToolName>(tool: T, args: any): Promise<any> {
    const spec = TOOLS[tool];
    if (!spec) throw new EyesError(`Unknown tool: ${tool}`, 'UNKNOWN_TOOL', { tool });

    // Validate args client-side (catches agent mistakes before network)
    const argsResult = spec.argsSchema.safeParse(args);
    if (!argsResult.success) {
      const issue = argsResult.error.issues[0];
      const path = issue.path.join('.');
      throw new EyesError(
        `Invalid args for ${tool}: ${path ? path + ' — ' : ''}${issue.message}`,
        'BAD_ARGS',
        { tool },
      );
    }
    const validatedArgs = argsResult.data;

    // Send with retry
    let lastError: EyesError | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.sendToolCall(tool, validatedArgs);
        // Validate result client-side (catches relay/phone bugs)
        const resultParse = spec.resultSchema.safeParse(result);
        if (!resultParse.success) {
          throw new EyesError(
            `Relay returned malformed result for ${tool}: ${resultParse.error.issues[0]?.message}`,
            'MALFORMED_RESULT',
            { tool },
          );
        }
        return resultParse.data;
      } catch (e: any) {
        if (e instanceof EyesError && (e.code === 'NO_PHONE' || e.statusCode === 503)) {
          lastError = e;
          if (attempt < this.maxRetries) {
            await sleep(this.retryDelayMs);
            continue;
          }
        }
        throw e;
      }
    }
    throw lastError ?? new EyesError('retry loop exhausted', 'RETRY_FAIL');
  }

  private async sendToolCall(tool: string, args: any): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.relayUrl}/tool/${tool}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(args ?? {}),
        signal: controller.signal,
      });

      const body = await res.json().catch(() => ({ error: 'invalid_json', message: 'Relay returned non-JSON response' })) as any;

      if (!res.ok) {
        const code = body?.error?.code || 'HTTP_ERROR';
        const message = body?.error?.message || body?.error || `HTTP ${res.status}`;
        throw new EyesError(message, code, { statusCode: res.status, tool });
      }

      if (body?.ok !== true) {
        // Some endpoints return ok:false for tool errors (e.g. NO_PHONE)
        const code = body?.error?.code || 'TOOL_ERROR';
        const message = body?.error?.message || 'Unknown tool error';
        throw new EyesError(message, code, { statusCode: res.status, tool });
      }

      return body.result;
    } finally {
      clearTimeout(timer);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
