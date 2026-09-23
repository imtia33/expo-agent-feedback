# AGENTS.md — Map for AI agents working in this repo

If you are an AI agent (Claude Code, Cursor, Aider, …) operating on this
codebase: **this file is your index. Do not list the file tree — everything
you need is pointed to below.**

## What this repo is

A monorepo (npm workspaces) with 3 publishable packages + 1 demo app:

| Path | Package | Purpose |
|---|---|---|
| `packages/expo-eyes-app` | `expo-eyes-app` | In-app SDK. `<EyesProvider>` + 18 WS primitives. Runs on the phone inside the user's Expo app. No-op in production (`__DEV__` gate). |
| `packages/expo-eyes-relay` | `expo-eyes-relay` | Node bridge. WS server (:8766, phone-facing) + Express 5 HTTP API (:8765, agent-facing). Composes primitives into 26 tools. |
| `packages/expo-eyes-agent` | `expo-eyes-agent` | Agent-side: typed client (`client.ts`), MCP server (`mcp-server.ts`), CLI (`cli.ts`), zod schemas (`schemas.ts`), types (`types.ts`). |
| `examples/demo-app` | private | Expo Router app with driver-friendly screens (list, playground). |

## Where to change what

| Task | Files |
|---|---|
| Add/modify an agent-facing tool | `expo-eyes-relay/src/tool-router.js` (impl) + `http-server.js` (`VALID_TOOLS`, `TOOL_SCHEMAS`) + agent's `schemas.ts`/`types.ts`/`client.ts`/`eyes.ts` (all 4 stay in lockstep) + `mcp-server.ts` & `cli.ts` come free |
| Add/modify a phone primitive | `expo-eyes-app/src/primitives.ts` (impl) + `EyesProvider.tsx` (`PRIMITIVES` + `HANDLERS`) + `protocol.ts` (`PrimitiveName`) |
| Change the wire protocol | `expo-eyes-app/src/protocol.ts` — relay's `ws-server.js`/`session-manager.js` must stay compatible |
| Config / env vars / ports | `expo-eyes-relay/src/config.js` (all `EXPO_EYES_*`) |
| Connection robustness | `expo-eyes-app/src/ws-client.ts` (reconnect, queue), `ws-server.js` (heartbeat 30s/10s) |
| Docs that must stay true | `README.md`, `docs/SETUP.md`, `docs/ARCHITECTURE.md`, package READMEs |

## Non-obvious invariants (do not break)

1. **Tool parity**: the relay's `VALID_TOOLS` (26), the agent's `TOOLS`
   registry (26), and MCP/CLI dispatch must always have the same names.
   `scripts/smoke-test.sh` fails if they drift.
2. **The phone dials OUT**: the phone's WS client connects *to* the relay —
   never the reverse. This is what makes tunnels/NAT work.
3. **Thin-client principle**: no ref allocation, pruning, or composite logic
   in the app SDK. Brains live in the relay (see ARCHITECTURE.md "why").
4. **Tool results that "fail softly"** (`tapText` no-match, `fill` no-input)
   return `ok:false` instead of throwing; the CLI maps that to exit 1.
5. **`refsStillValid`**: tools that mutate the screen reset the relay's
   element cache (`resetCache()`); element caches are per-session.
6. **Elements are positional** (`r5` = index 5 in the last `listVisibleElements`
   scan, 2s TTL cache) — any screen mutation invalidates them; composite
   tools re-scan before acting.

## Commands (from repo root)

```bash
npm install                          # once; single root lockfile
npm run build                        # tsc for app + agent packages
npm run relay                        # relay on :8765 (HTTP) / :8766 (WS)
npm run mock-phone                   # fake phone — no device needed
EXPO_EYES_TOKEN=x npx expo-eyes-agent health   # probe the chain
./scripts/smoke-test.sh              # 16 checks: full chain incl. MCP
npm pack --dry-run -w expo-eyes-relay # inspect publish tarball
```

## Verification protocol (for any change)

1. `npm run build` — both TS packages must compile.
2. `./scripts/smoke-test.sh` — all 16 checks green (relay+phone+CLI+MCP).
3. If you touched primitives/tools: run the real app in Expo Go against your
   relay and drive one full loop: `visibleText` → `tapText` → `assertVisible`.
4. Update docs in the same commit when behavior/user-visible args change.

## Versioning & release

- Packages use `0.x-alpha.N` + the npm `alpha` dist-tag until 1.0.
- `prepublishOnly` builds; tarballs ship `dist/` only (see `files` in each
  package.json). Never commit `dist/` or lockfiles besides the root one.
