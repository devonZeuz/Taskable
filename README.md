# Tareva (Taskable)

**Live:** [taskable-fawn.vercel.app](https://taskable-fawn.vercel.app) · **Repo:** [github.com/devonZeuz/Taskable](https://github.com/devonZeuz/Taskable)

Tareva is a local-first, execution-focused daily planning system with optional real-time cloud sync and conflict-safe collaboration.

It is not a basic to-do list. It is a deterministic scheduling engine with drift awareness, presence locks, and versioned sync.

---

## Live Architecture

### Frontend — Vercel

- React 18 + TypeScript + Vite
- UI system with density contracts and tokenised theme architecture
- Drag-and-drop scheduling grid (15-minute snap) with pixel-accurate coordinate math
- Execution lifecycle: start → pause → overrun → extend → complete
- Adaptive duration learning from historical completion data
- Bounded undo/redo state model for safe scheduling reversals
- Deterministic Playwright E2E drag-and-drop test harness

### Backend — Render

- Node.js + Express
- SQLite with persistent disk in production
- Optimistic concurrency control (task versioning with `ifVersion` guards)
- SSE-first real-time sync with reconnect fallback polling
- Presence locks with takeover control
- Conflict resolution system — 409 handling with UI resolver and lifecycle telemetry
- MFA (TOTP), email verification, password reset
- RBAC: owner / admin / member / viewer
- Metrics + SLO endpoints (token-protected)
- Operational telemetry ingestion

### Desktop (Optional Shell)

- Electron wrapper with hardened `BrowserWindow` config:
  - `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
  - External navigation blocked
- Compact always-on-top execution window
- Deep link support (`taskable://task/:id`)
- CI tag-based signing job via `electron-builder`

---

## Core Engineering Highlights

### Conflict-Safe Sync Model

The sync layer is designed to handle concurrent edits without data loss:

- Versioned task writes with `ifVersion` guards — stale writes are rejected
- 409 conflict handling surfaces a UI resolver so users choose the winning state
- Lock suppression prevents write storms during high-frequency edits
- Conflict lifecycle events feed into telemetry for observability

### Real-Time Transport

- SSE-first design; polling fallback on reconnect
- One-time scoped stream tokens per session
- Presence claim/release endpoints with takeover control
- Retry suppression to prevent redundant inflight requests

### Execution Engine

- Drift-aware timer model detects when a task has run over
- Overrun detection triggers end-of-task action prompts
- Adaptive duration suggestions derived from completion history
- Deterministic state machine: scheduled → running → paused → done

---

## Security & Production Hardening

| Layer | Measure |
|---|---|
| Auth | httpOnly cookie sessions — tokens never in localStorage or response body |
| MFA | TOTP enrollment + verification flow |
| Rate limiting | SQLite-backed auth rate limiter (survives process restarts) |
| Admin access | Env-only flag — no runtime or localStorage overrides |
| Metrics | Token-protected endpoints (`x-metrics-token`) |
| CSP | Helmet CSP in production |
| CORS | Strict allow-list |
| Boot | JWT secret validation + env validation before startup |
| Desktop | Sandboxed Electron shell, external navigation blocked |
| CI | gitleaks secret scanning on every push |
| IDs | `crypto.randomUUID()` for all entity ID generation |

---

## Test & Quality Discipline

Every PR must pass all gates before merge:

| Gate | Tool |
|---|---|
| Typecheck | TypeScript |
| Lint | ESLint |
| Format | Prettier |
| Unit tests | Vitest |
| E2E suite | Playwright (80+ specs) |
| Cloud E2E | Dual-client sync regression suite |
| Desktop regressions | Playwright + Electron |
| Performance budget | CI check |
| Secret scanning | gitleaks |
| Build verification | CI |

---

## Deployment

### Frontend (Vercel)

```
Root:    app
Build:   npm run build
Output:  dist
Env:     VITE_API_URL
```

SPA fallback configured. Environment-based feature flags.

### Backend (Render)

```
Root:    app/server
Build:   npm ci
Start:   npm run start
Env:     NODE_ENV, JWT_SECRET, BASE_URL, CORS_ORIGIN,
         METRICS_ACCESS_TOKEN, TASKABLE_DB_PATH (persistent disk)
```

Env-validated boot — server refuses to start with missing critical config.

### Desktop

```bash
cd app && npm run desktop:dev   # dev
# CI: tag-based signing job via electron-builder
```

---

## API Reference

All routes are versioned under `/api/v1/`.

| Endpoint | Description |
|---|---|
| `POST /api/v1/auth/login` | Login — sets httpOnly session cookie |
| `POST /api/v1/auth/signup` | Register with email verification |
| `POST /api/v1/auth/refresh` | Refresh session token |
| `DELETE /api/v1/auth/account` | Account deletion with org ownership transfer |
| `GET /api/v1/orgs/:id/tasks` | Task list with `limit/since` incremental pagination |
| `GET /api/v1/sse` | Real-time sync stream (SSE, scoped token auth) |
| `GET /health` | Health check |
| `GET /metrics/basic` | Ops metrics (token-protected) |
| `GET /metrics/slo` | SLO metrics (token-protected) |

---

## Running Locally

```bash
cd app
nvm use
npm ci
npm --prefix server ci
cp .env.example .env
cp server/.env.example server/.env
npm run server:dev   # API on :3001
npm run dev          # Frontend on :5173
```

Optional Electron shell:

```bash
npm run desktop:dev
```

---

## Runbook

From `app/`:

| Command | Purpose |
|---|---|
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run format:check` | Prettier |
| `npm run test` | Unit + server tests |
| `npm run test:e2e` | Full Playwright suite |
| `npm run test:e2e:cloud` | Cloud sync regression |

---

## What This Project Demonstrates

- **Distributed system thinking** — conflict resolution, presence locking, optimistic concurrency, versioned writes
- **UI determinism under real-time pressure** — drag-and-drop coordinate math that stays correct under scroll, density changes, and live sync updates
- **Production readiness discipline** — env validation, CI gates, telemetry, metrics, SLO endpoints
- **Defensive sync architecture** — retry suppression, write storm prevention, fallback transport
- **Security-first engineering** — auth hardened from localStorage tokens to httpOnly cookies, audited and tested
- **Desktop distribution** — Electron packaging with sandboxed, CSP-compliant shell and CI signing
