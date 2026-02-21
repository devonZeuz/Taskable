# Release Notes

## 2026-02-20

### Production Readiness Sprint (Cloud/Auth/Enterprise)

- Added provider-backed email delivery service for verification + password reset:
  - `server/src/email.js`
  - providers: `disabled`, `console`, `test`, `sendgrid`, `postmark`
  - sandbox/test log support and safe logging (no raw token logs)
- Wired auth flows to real delivery pipeline:
  - `POST /api/auth/register`
  - `POST /api/auth/resend-verification`
  - `POST /api/auth/request-password-reset`
  - delivery failure can be enforced with `EMAIL_REQUIRE_DELIVERY`.
- Hardened SSE auth path with one-time stream tokens:
  - new endpoint `POST /api/orgs/:orgId/stream-token`
  - `GET /api/orgs/:orgId/stream` now supports scoped one-time `streamToken` + `sessionId`
  - legacy query access-token path is explicitly gated for local fallback.
- Updated cloud client realtime connection logic:
  - fetch one-time stream token before EventSource connect
  - reconnect obtains a fresh stream token
  - stale/reused stream token reconnect loops are eliminated
  - fallback polling remains active when realtime is not connected.
- Expanded activity/audit visibility for admins:
  - `GET /api/orgs/:orgId/activity` now supports filters by user/task/action/date range + limit
  - Integration settings now exposes those filters and highlights conflict/takeover/presence counts.

### Security + Tests

- Added server integration tests for SSE auth hardening:
  - `tests/server/sse-stream-auth.test.ts`
  - validates one-time token replay rejection + org/session scoping.
- Added email delivery service tests:
  - `tests/server/email.test.ts`
- Updated Vitest config to project-based client/server environments (removes deprecated match-glob mode).

### Docs + Runbooks

- Updated `server/.env.example` with email, SSE hardening, and ops alert env vars.
- Updated `server/README.md` with:
  - stream-token endpoint
  - SSE auth model
  - activity filter query support
  - full env var reference for delivery/hardening.
- Updated `outlook-addin/README.md` with enterprise rollout guidance:
  - least-privilege scope notes
  - admin consent checklist
  - host support matrix (OWA/Windows/Mac).

### Dependency Pass

- Applied safe dependency override for `minimatch` (`10.2.1`) to reduce transitive risk without breaking lint/toolchain compatibility.
- Full `npm audit` no longer has high severity findings in this branch; remaining advisories are moderate/dev-toolchain scoped.

## 2026-02-19

### Execution Layer + Smart Alerts + Ops Telemetry

- Added adaptive execution prompt flow when running tasks hit planned end:
  - `Mark done`
  - `Keep running`
  - `Extend to now`
  - `Reschedule remaining`
- Added conflict decision path for extension without shove:
  - `Extend anyway` (overlap accepted)
  - `Cancel`
- Expanded Daily Planning execution actions:
  - `Pause` and `Extend` added to running sections
  - running-late handling aligned with adaptive extension behavior
- Switched runtime ticking to a single global execution ticker service (`executionTicker`) used by task execution state updates.
- Added local-first operational telemetry capture (`operationalTelemetry`) for:
  - sync success/fail
  - conflict occurrence
  - SSE reconnects/connected events
  - Outlook import success/fail
  - drag/resize latency samples
- Added cloud telemetry ingest endpoint:
  - `POST /api/ops/events`
- Added SLO metrics endpoint:
  - `GET /metrics/slo`
  - reports sync latency, sync error rate, SSE connected ratio, and drag/resize latency percentiles.
- Added cloud/local schema alignment for execution prompt field:
  - backend DB migration adds `last_end_prompt_at`
  - server and client payload mapping now handle `lastEndPromptAt` + legacy `lastPromptAt`
  - backup schema bumped to `CURRENT_BACKUP_SCHEMA_VERSION = 4`

### Test Updates

- Added unit tests:
  - `src/app/services/executionTicker.test.ts`
  - `src/app/services/operationalTelemetry.test.ts`
- Updated E2E expectations for current UI timing format (`HH:MM - HH:MM`) and compact quick-action labels.
- Verified deterministic shove undo remains one-step (`tests/e2e/planner-dnd.spec.ts`).

### Cloud Sync Stability + Multi-Client Test Harness

- Hardened cloud push/pull logic to prevent missed writes and stale overwrite loops:
  - queued push execution when a push is already in-flight
  - recovery for duplicate-create (`TASK_ALREADY_EXISTS`) and already-deleted (`404`) cases
  - unsynced local-change guard before silent pulls
  - hash-based `skipNextPush` handling so no real user edits are skipped
- Fixed server delete-path ordering to avoid `500` from audit FK timing on task deletes.
- Added no-cache API behavior and normalized audit timestamp parsing in UI surfaces.
- Added dedicated cloud Playwright harness:
  - `playwright.cloud.config.ts`
  - isolated e2e DB path via `TASKABLE_DB_PATH`
  - dedicated isolated ports (`4274` app / `4104` api) with fresh server boot (no stale server reuse)
  - `npm run test:e2e:cloud`
- Added deterministic two-client cloud sync e2e:
  - `tests/e2e/planner-cloud-sync.spec.ts`
  - verifies create -> update -> delete propagation across two browser clients without manual refresh.
  - uses test-only cloud sync hooks (`pullTasks`/`pushTasks`) for deterministic reconciliation in automation.

### Cloud Sync Sanity Checklist (Manual)

- Same account + same workspace on both clients.
- Auto sync enabled on both clients.
- Create task on client A -> appears on client B within 5 seconds.
- Update task time on client A -> updated range appears on client B within 5 seconds.
- Delete task on client A -> removed on client B within 5 seconds.
- Refresh either client -> state remains consistent (no revert).

### Collaboration + Sync Hardening

- Switched cloud sync behavior to SSE-first transport with active polling safety net for drift recovery.
- Added `syncTransport` state (`sse` | `polling` | `disconnected`) to cloud context.
- Added realtime presence/status badge to both `Personal` and `Team` top HUDs.

### Strict Conflict Resolution

- Added strict `VERSION_CONFLICT` review flow in cloud controls:
  - `Keep mine`
  - `Keep theirs`
  - `Merge selected` (field-level choice)
- Added merge accelerators in conflict dialog:
  - `Use mine for all`
  - `Use theirs for all`
- Added richer conflict context in UI:
  - local/server version display
  - conflict detected timestamp
  - dismiss-for-now action per conflict card
- Added conflict audit visibility directly in cloud controls.
- Added server endpoint `POST /api/orgs/:orgId/tasks/:taskId/conflict-resolution`.
- Added explicit `task.conflict_resolved` audit logging on conflict resolution paths.

### Sync Diagnostics Visibility

- Added structured cloud sync diagnostics in context and Integrations UI:
  - operation name (e.g. `tasks.push`, `tasks.pull`, `session.refresh`)
  - HTTP status + API error code
  - request correlation id (`X-Request-Id`) when available
  - timestamp for latest sync issue
- Added `Copy diagnostics` action in Integrations for faster debugging and support traces.

### Advanced DnD Test Coverage

- Kept stable e2e suite in `tests/e2e/planner.spec.ts`.
- Added deterministic advanced interaction suite in `tests/e2e/planner-dnd.spec.ts` for:
  - drag across day/time
  - resize duration
  - shove-on-drop behavior
- Added deterministic DnD hooks in e2e mode via `window.__TASKABLE_DND_HOOKS__`.

### Validation Status

- `npm run typecheck` passed
- `npm run lint` passed
- `npm run test` passed
- `npm run test:e2e` passed
- `npm run test:e2e:cloud` passed
