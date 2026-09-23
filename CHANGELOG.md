# Changelog

All notable changes to the expo-eyes packages are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/) ·
Versioning: [SemVer](https://semver.org/) — pre-1.0 `0.x` versions may break.

## [Unreleased]

## [0.1.0-alpha.1] / [0.2.1-alpha.1] — first public alpha

The first release of the three packages together as a public monorepo
(`expo-eyes-app` carries its own version line — 0.2.x — from its earlier
private iterations).

### Added

- **expo-eyes-app 0.2.1-alpha.1** — in-app SDK:
  `<EyesProvider>` with 18 WS primitives (inspect, dispatch, scroll, swipe,
  pinch, screenshot, asserts, navigate, ping, diagnostics…), auto-reconnect
  WS client with outbound queue, per-process device identity for multi-phone
  relays, runtime error forwarding to the relay's event stream, production
  no-op.
- **expo-eyes-relay 0.1.0-alpha.1** — bridge server:
  26 agent tools over a bearer-auth Express 5 API, multi-phone session
  manager (native-over-web preference, `?session=` targeting), heartbeat +
  zombie pruning, full-chain `GET /ping` with actionable hints, `GET /tools`
  live schemas, `GET /events` phone log/error stream, `--tunnel` support
  (cloudflared/ngrok/localtunnel) with mandatory-token safety.
- **expo-eyes-agent 0.1.0-alpha.1** — agent SDK + MCP + CLI:
  typed client with zod validation and 503 retry, MCP server exposing all 26
  tools to Claude Desktop / Cursor, CLI with composite-tool support and
  exit-code semantics.
- Monorepo: npm workspaces (single root lockfile), CI (build + full-chain
  smoke test with a mock phone), `AGENTS.md` agent map, tiered docs
  (README → SETUP.md scenarios → ARCHITECTURE.md).

### Changed

- Agent tools expanded from 7 to 26 — the SDK/MCP/CLI previously only knew
  the foundational tools; all composite tools added in earlier relay rounds
  are now exposed everywhere.
- Demo app and SDK wiring are environment-driven only (`EXPO_PUBLIC_*`);
  no baked-in credentials.

### Removed

- The install-time `postinstall` build step from `expo-eyes-app` — published
  tarballs now ship prebuilt `dist/` (built by `prepublishOnly`).
- Private sandbox tooling, vendored third-party docs, and scratch artifacts
  from the public repository history.
