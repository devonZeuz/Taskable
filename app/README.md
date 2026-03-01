# Tareva (Taskable App Workspace)

Execution-first planner with web, desktop, and cloud/local modes.

## Product Snapshot

Tareva is built around one workflow: capture tasks, schedule realistically, then execute in real time.

Current strengths:
- Execution-first task cards with clear scheduled/running/paused/done states
- Deterministic stack-first overlap behavior on the timeline
- Local-first workflow with optional cloud sync
- Onboarding + first-session tutorial flow
- Personal/Team/Compact planner surfaces
- Web + Electron desktop targets from one codebase

## Workspace Layout

- `src/`: frontend (React + TypeScript)
- `server/`: backend API (Node + Express + SQLite)
- `tests/`: unit, server, and Playwright E2E coverage

## Quick Start (Local)

```bash
nvm use
npm ci
npm --prefix server ci
cp .env.example .env
cp server/.env.example server/.env
npm run server:dev
npm run dev
```

Optional desktop shell:

```bash
npm run desktop:dev
```

## Runbook Commands

- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Formatting check: `npm run format:check`
- Unit/server tests: `npm run test`
- E2E: `npm run test:e2e`
- Cloud E2E: `npm run test:e2e:cloud`

## Deployment

### Frontend (Vercel)

- Root directory: `app`
- Build command: `npm run build`
- Output: `dist`
- Required env: `VITE_API_URL`

### Backend (Render)

- Root directory: `app/server`
- Build command: `npm ci`
- Start command: `npm run start`
- Required env:
  - `NODE_ENV=production`
  - `JWT_SECRET`
  - `BASE_URL`
  - `CORS_ORIGIN`
  - `METRICS_ACCESS_TOKEN`

Recommended persistence:
- `TASKABLE_DB_PATH` pointing to persistent storage path (for durable data across restarts)

## Health and Ops

- Health endpoint: `GET /health`
- Metrics endpoints:
  - `GET /metrics/basic`
  - `GET /metrics/slo`
  - both require `x-metrics-token: <METRICS_ACCESS_TOKEN>`

## Launch Readiness

- Auth flow works in cloud and local modes
- Planner scroll, drag/drop, overlap, and execution controls are stable
- Onboarding only triggers for first-session conditions
- API v1 routes are used consistently (`/api/v1/...`)
- CI gates pass before release
