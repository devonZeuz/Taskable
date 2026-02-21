# AppAuditStructure

Last updated: 2026-02-21 (rev 7)

This document is the current source of truth for GPT-style product/architecture audits of Taskable.

## 1. Executive Summary

Taskable is now a hybrid local-first + cloud-enabled planning app:

- Frontend: React + Vite + TypeScript single-page app with `Personal` and `Team` routes.
- Core UX: drag/drop scheduling grid with 15-minute snapping, resizing, stacking, hover-dwell shove, inbox unscheduling, and daily planning workflow.
- Compact UX: `/compact` route for fast visual tracking with simplified read-only task cards (title + time only) and deep-link back to full editor.
- Capture UX: external drag/drop capture from Outlook/email payloads into Inbox or directly onto day/time grid (subject/title parsed into task title).
- Visual system: theme-driven HUD/cards with `default`, `mono` (true black/white, readability-tuned), and `sugar-plum` palettes.
- Persistence: localStorage by default, optional cloud sync to a Node/Express/SQLite backend with auth, MFA, and org scoping.
- Quality gates: typecheck, lint, format check, unit tests, E2E tests, and CI workflow are wired; all current unit + e2e suites are passing, including advanced deterministic drag/resize/shove coverage.
- Collaboration: SSE-first realtime transport with reconnect/polling fallback, optimistic concurrency on task writes, strict conflict-resolution UI, server-enforced presence locks with takeover flow, and one-time scoped SSE stream tokens.
- Conflict guardrails: mutation surfaces now hard-stop on conflict-locked tasks with resolver handoff, persistent planner conflict banner, and conflict entered/resolved telemetry timings.
- Execution layer: adaptive run-state model (`idle/running/paused/completed`), overrun visuals, and end-of-task prompt actions.
- Operations baseline: request IDs in responses/logs, local-first operational telemetry capture, cloud telemetry ingest (`/api/ops/events`), retained telemetry storage (`ops_events`), SLO metrics endpoint (`/metrics/slo`), alert endpoint (`/api/ops/alerts`), and CI bundle-size budget check.
- API security baseline: production security headers/CSP via Helmet, explicit `Permissions-Policy`/`Referrer-Policy`, and env-driven CORS allow-list.
- Email delivery: verification/reset flows support real provider-backed delivery (`sendgrid` / `postmark`) with test/console/sandbox modes and dev token preview gating.
- Outlook: add-in scaffold supports metadata-only inbox capture with Office SSO, MSAL popup fallback, and password fallback.
- Desktop shell: minimal Electron wrapper (`/desktop`) now ships as an optional personal-use shell with main + compact windows, tray controls, deep-link routing, and enforced Electron security defaults (`contextIsolation/nodeIntegration/webSecurity/sandbox`).

## 2. Repository Structure

```text
app/
  .github/workflows/ci.yml
  AppAuditStructure.md
  desktop/
    main.cjs
    preload.cjs
    localServer.cjs
    store.cjs
    electron-builder.yml
    scripts/
      dev.mjs
    assets/
      tray.png
  playwright.cloud.config.ts
  outlook-addin/
    manifest.xml
    taskpane.html
    taskpane.js
    README.md
  server/
    src/
      auth.js
      db.js
      index.js
    data/taskable.db
    README.md
  src/
    main.tsx
    styles/
    app/
      App.tsx
      routes.ts
      components/
      context/
      data/
      services/
  tests/e2e/planner.spec.ts
  tests/e2e/planner-dnd.spec.ts
  tests/e2e/planner-cloud-sync.spec.ts
```

## 3. Runtime Architecture

### 3.1 Frontend boot

1. `src/main.tsx` mounts app.
2. `src/app/App.tsx` renders router + global toaster.
3. `src/app/routes.ts` defines:
   - `/` -> `PersonalView`
   - `/team` -> `TeamView`
   - `/compact` -> `CompactView`
   - root + child route `errorElement` boundaries for branded recovery UI on lazy/runtime failures

### 3.2 Provider stack

Defined in `src/app/components/Root.tsx`:

```text
AppThemeProvider
  DndProvider(HTML5Backend)
    WorkdayProvider
      TeamMembersProvider
        TaskProvider
          CloudSyncProvider
            NotificationSettingsProvider
              Route Outlet
```

Also in `Root.tsx`:

- global bottom route switcher (`Personal` / `Team`)
- global keyboard undo/redo (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl/Cmd+Y`)

## 4. Domain Model

### 4.1 Frontend entities

`Task` in `src/app/context/TaskContext.tsx`:

- `id`
- `title`
- `description`
- `startDateTime` (optional ISO)
- `durationMinutes`
- `timeZone`
- `completed`
- `color`
- `subtasks: SubTask[]`
- `type: 'quick' | 'large'`
- `assignedTo` (optional)
- `status: 'scheduled' | 'inbox'`
- `focus` (optional boolean)
- `version` (optional optimistic-concurrency integer from server)
- `executionStatus: 'idle' | 'running' | 'paused' | 'completed'`
- `actualMinutes`
- `lastStartAt` (optional ISO)
- `completedAt` (optional ISO)
- `lastEndPromptAt` (optional ISO prompt marker)

`Workday`:

- `startHour`, `endHour` (same-day window)

`TeamMember`:

- local: default + custom members (`all` and `unassigned` buckets included)
- cloud mode: workspace members from backend + synthetic `all` and `unassigned`

### 4.2 Backend entities

Tables in `server/src/db.js`:

- `users`
- `orgs`
- `org_members`
- `tasks`
- `subtasks`
- `task_audit_events`
- `user_sessions`
- `auth_tokens`
- `ops_events`

## 5. Persistence and Sync

### 5.1 Local storage

- `taskable-tasks` (schemaVersioned task snapshot + migration support)
- `taskable-workday`
- `taskable-custom-team-members`
- `taskable-removed-default-team-members`
- `taskable:app-theme`
- `taskable:notifications-enabled`
- cloud session keys (`taskable:cloud-token`, `taskable:cloud-refresh-token`, `taskable:cloud-org-id`, `taskable:cloud-auto-sync`)

### 5.2 Backup import/export

`src/app/services/plannerBackup.ts`:

- `CURRENT_BACKUP_SCHEMA_VERSION = 4`
- creates schemaVersioned JSON export
- imports:
  - current payloads
  - task-array payloads
  - legacy task shapes
- restores tasks/workday/theme/custom members/removed-default-members/notifications

### 5.3 Cloud sync behavior

`src/app/context/CloudSyncContext.tsx`:

- feature-flagged by `VITE_ENABLE_CLOUD_SYNC`
- auth: register/login/logout + `/api/me` session refresh
- refresh-token rotation endpoint support (`/api/auth/refresh`) with persisted refresh token
- lifecycle controls exposed in cloud UI:
- resend verification
- verify by token
- request password reset
- reset password by token
- MFA enroll/confirm/disable with TOTP
- email delivery provider abstraction (`disabled|console|test|sendgrid|postmark`) with safe logging
- workspace selection + member refresh
- pull: `/api/orgs/:orgId/tasks`
- diff-based push through task CRUD (`POST/PUT/DELETE`) with `ifVersion` checks
- strict `VERSION_CONFLICT` flow with keep-mine / keep-theirs / merge-selected resolution actions
- conflict retry suppression: unresolved conflict task IDs are excluded from background autosync writes to prevent repeated 409 request storms while keeping non-conflict task sync active
- conflict lock enforcement: when a task enters `VERSION_CONFLICT`, all primary mutation surfaces are blocked for that task until resolution (drag/resize, edit-save, quick actions, daily planning actions, and end-prompt actions)
- persistent planner conflict banner is shown while conflicts exist, with a single resolver entrypoint per active conflict focus
- conflict UI includes local/server versions, detected timestamps, and merge presets (`use mine/theirs for all`)
- field incident context (app runtime, 2026-02-20): repeated `PUT /api/orgs/:orgId/tasks/:taskId -> 409` was observed for the same task IDs (`o0aobykln`, `al430wb65`, `nd755n9id`, `bufwlmzg3`) with audible snap cue but task position reverting ("snap back"); mitigation now shipped through conflict-write suppression and conflict lock guards
- structured latest-sync diagnostics exposed in Integrations (operation, status, code, request-id, timestamp)
- conflict-resolution audit logging endpoint (`POST /api/orgs/:orgId/tasks/:taskId/conflict-resolution`) and conflict audit visibility in UI
- execution end-prompt acknowledgement endpoint (`POST /api/orgs/:orgId/tasks/:taskId/end-prompt`) used for cloud-wide prompt de-duplication
- SSE stream subscription (`/api/orgs/:orgId/stream`) for push updates
- one-time stream-token issuance endpoint (`POST /api/orgs/:orgId/stream-token`) with org/session scoped token consumption
- presence lock claim/release flow (`task` + `day`) with heartbeat TTL and realtime lock broadcast
- server hard write gate for task/day writes with `423 PRESENCE_LOCKED` when another user holds lock
- owner/admin force-takeover flow with audit events (`presence.lock_taken_over`)
- edit-lock cues surfaced in `TaskCard`, `DayColumn`, and `AddTaskDialog`
- realtime status + collaborator presence badge in main planner HUDs (`Personal` / `Team`)
- SSE-first with polling fallback when SSE is not connected
- auto-sync debounce (~900ms) with pending-push guard, queued push replay, and hash-based skip protection
- conflict-safe recoveries for duplicate create (`TASK_ALREADY_EXISTS`) and delete-not-found (`404`)
- deterministic cloud test hooks (`window.__taskableCloudSyncTest`) in `e2e-cloud` mode for controlled `pullTasks`/`pushTasks` automation
- integration settings activity feed now supports admin filters (`action`, `userId`, `taskId`, date range) and highlights conflict/takeover/presence counts
- cross-window storage subscription keeps cloud token/org/auto-sync state synchronized across open app windows without manual refresh
- integration credentials/actions render in an inline desktop-safe panel (`desktop-no-drag`) to avoid click-through in Electron frameless contexts
- conflict lifecycle telemetry is emitted as `conflict_entered` and `conflict_resolved` (with resolution duration and strategy metadata)

## 6. Core UX and Scheduling Engine

### 6.1 Scheduling primitives

`src/app/services/scheduling.ts`:

- time conversions
- day key conversions
- workday slot generation
- interval merging
- conflict checks against workday bounds
- capacity calculations
- next available slot suggestions

### 6.2 Drag/resize/stack/shove

`src/app/components/DayColumn.tsx` + `src/app/services/shovePlanning.ts`:

- drag/drop across day/time
- 15-minute snap grid
- resize handles for start/end
- stacking on same time/day
- shove activation:
  - hold `Shift`, or
  - hover dwell (`SHOVE_HOVER_MS = 550`)
- preview overlays for target and shove candidates
- current time vertical indicator on today column
- deterministic DnD hook registry in e2e mode (`window.__TASKABLE_DND_HOOKS__`) for stable advanced interaction tests

### 6.3 Daily workflow loop

`src/app/components/DailyPlanningPanel.tsx`:

- Inbox triage
- one-click auto-place (`findNextAvailableSlot` / `findNextAvailableSlotAfter`)
- Today focus list sorted by start time
- Overdue actions (carry tomorrow, next slot, mark done)
- End-of-day review summary and carryover action
- panel can collapse/expand and persist collapsed state

### 6.4 Quick creation path

`src/app/components/QuickAddButton.tsx`:

- click in grid creates immediate 1-hour scheduled `New Task`
- opens edit dialog immediately

External capture paths:

- `src/app/components/InboxPanel.tsx`: drop external email/text/html payload into Inbox -> creates unscheduled inbox task and opens edit dialog.
- `src/app/components/DayColumn.tsx`: drop external email/text/html payload on a day/time grid -> creates scheduled task at drop time and opens edit dialog.
- `src/app/services/externalDrop.ts`: parses subject/title heuristically from Outlook/browser drag payloads (`text/plain`, `text/html`, `text/uri-list`, file names).

### 6.5 Notifications

`src/app/context/NotificationSettingsContext.tsx`:

- browser permission-based reminders
- configurable near-start lead-time windows (`15/10/5/30`)
- best-effort background tab delivery
- end-of-task action prompt with:
  - Mark done
  - Keep running
  - Extend schedule to now
  - Reschedule remaining work
- in cloud mode, prompt display is coordinated through server ack (`lastEndPromptAt`) to avoid duplicate end prompts across clients
- end prompt UI is a compact glass HUD (2x2 action layout) with queue navigation (`prev/next`) when multiple prompts are active
- end prompt HUD is compact and auto-anchors near the active task card row with viewport-safe clamping fallback
- quick-action task HUD is suppressed while end-prompt HUD is active to avoid duplicate stacked action surfaces
- overrun follow-ups (`+5/+10/+15/+30`) and in-app fallback when browser permission is denied
- add/edit task submit snap cue is intentionally delayed until dialog close animation completes (prevents premature click-sound feel)

### 6.6 Compact mode

`src/app/components/CompactView.tsx`:

- compact planner layout with configurable day count (`3/5/7`) from user preferences in web mode
- desktop compact route enforces a focused 2-day view (layout scope only)
- compact uses the same theme-token surfaces as full planner (no desktop-only visual skin/overrides)
- compact typography and spacing are now token-aligned with full board scale (day-title/subtitle classes + spacing markers), without behavioral changes
- compact view colors update across windows through the shared theme storage-sync listener
- visual-only task blocks (title + time) for high-density tracking
- task actions intentionally removed from compact cards to reduce clutter
- clicking a compact task deep-links to full app editor for edits/actions
- explicit "Open Full" control remains in compact HUD
- compact launcher enters compact mode immediately; secondary controls (always-on-top and related toggles) remain in Settings/Tray

## 7. Backend/API Surface

Defined in `server/src/index.js`:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/microsoft/exchange`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `POST /api/auth/mfa/enroll/start`
- `POST /api/auth/mfa/enroll/confirm`
- `POST /api/auth/mfa/disable`
- `POST /api/auth/resend-verification`
- `POST /api/auth/verify-email`
- `POST /api/auth/request-password-reset`
- `POST /api/auth/reset-password`
- `GET /api/auth/sessions`
- `GET /metrics/basic`
- `GET /metrics/slo`
- `GET /api/me`
- `POST /api/ops/events`
- `GET /api/ops/alerts`
- `GET /api/orgs`
- `POST /api/orgs`
- `GET /api/orgs/:orgId/members`
- `POST /api/orgs/:orgId/members`
- `PATCH /api/orgs/:orgId/members/:userId`
- `DELETE /api/orgs/:orgId/members/:userId`
- `POST /api/orgs/:orgId/stream-token`
- `GET /api/orgs/:orgId/stream`
- `GET /api/orgs/:orgId/presence`
- `POST /api/orgs/:orgId/presence/claim`
- `POST /api/orgs/:orgId/presence/release`
- `POST /api/orgs/:orgId/presence/release-all`
- `GET /api/orgs/:orgId/tasks`
- `POST /api/orgs/:orgId/tasks`
- `PUT /api/orgs/:orgId/tasks/:taskId`
- `DELETE /api/orgs/:orgId/tasks/:taskId`
- `POST /api/orgs/:orgId/tasks/:taskId/end-prompt`
- `POST /api/orgs/:orgId/tasks/:taskId/conflict-resolution`
- `GET /api/orgs/:orgId/activity`
- `POST /api/orgs/:orgId/import-local`
- `POST /api/orgs/:orgId/inbox-from-email`

Notes:

- org membership is enforced on org-scoped routes
- role gating is server-enforced (`owner/admin/member/viewer`)
- write routes require `owner/admin/member`; destructive delete routes are `owner/admin`
- audit entries are written for task and member events
- unknown assignees are sanitized in imports
- task writes support optimistic concurrency via `version` + `ifVersion`
- version conflicts return `409` with `serverTask` payload and audit event
- auth endpoints include rate limiting and coded error responses
- local auth supports MFA login challenge (`mfaTicket` + TOTP code) and in-session MFA enrollment
- request tracing baseline via `X-Request-Id` response header + server logs
- operational SLO metrics are exposed via `/metrics/slo` (sync latency/error rate, SSE connected ratio) using retained telemetry data
- operational alerts endpoint `/api/ops/alerts` evaluates sync error spikes, SSE reconnect spikes, and Outlook import failure spikes
- activity audit endpoint supports filtered admin queries by user/task/action/date range
- SSE query access-token fallback is gated and disabled by default in production
- startup env validation now hard-fails production boot if `JWT_SECRET` is missing/weak (no static fallback secret)
- production responses include explicit security headers/CSP (`default-src 'self'`, restricted `script-src`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data:`, `connect-src` allow-list)
- `Permissions-Policy` and `Referrer-Policy` are explicitly set in production middleware
- CORS is driven by `CORS_ALLOWED_ORIGINS` (with loopback-only relaxed behavior in non-production)

## 8. Team/Ownership Behavior

- Team view now uses effective member source:
  - local members in local mode
  - real org members in cloud mode
- Team editor:
  - local mode: add/remove custom and built-in members
  - cloud mode: add/remove by email via backend endpoints
  - owner/admin enforcement for cloud membership management
- Cloud roles are normalized to:
  - `owner`
  - `admin`
  - `member`
  - `viewer`

## 9. Outlook Add-in Scaffold

Folder: `outlook-addin/`

- `manifest.xml` for Outlook command + task pane
- `taskpane.html` lightweight session/workspace UI
- `taskpane.js` handles Office SSO sign-in, MSAL popup fallback, password fallback, workspace loading, and reads selected email metadata to call:
  - `POST /api/orgs/:orgId/inbox-from-email`

Current scope:

- metadata capture only (subject/from/received time/link fields when available)
- Microsoft identity token exchange (`/api/auth/microsoft/exchange`) + workspace picker
- MSAL popup fallback is available for hosts where Office SSO is unavailable
- password fallback remains available
- planner-side external drag/drop capture from Outlook/web email payloads is implemented for local/cloud task creation flows
- enterprise packaging and tenant rollout hardening are still pending

## 9.1 Desktop Wrapper (Electron v1)

Folder: `desktop/`

Scope:

- thin shell only; renderer stays the existing web app (`/`, `/team`, `/compact`)
- no duplicated planner/sync/scheduling/domain logic in desktop code

Windows:

- `mainWindow`
  - framed
  - remembers bounds
  - loads `/`
- `compactWindow`
  - frameless
  - resizable
  - remembers bounds
  - always-on-top toggle
  - loads `/compact`

Tray:

- Toggle Compact
- Always on top (checkbox)
- Open Taskable
- Quit

IPC channels:

- `desktop:getState`
- `desktop:toggleCompact`
- `desktop:openCompact`
- `desktop:closeCompact`
- `desktop:setAlwaysOnTop`
- `desktop:openFull`
- `desktop:focusMain`
- `desktop:openTask`

Deep-link protocol:

- `taskable://task/<taskId>` -> focuses main window and routes to `/?taskId=<taskId>`

Desktop persistence (separate file in Electron `userData`):

- `mainBounds`
- `compactBounds`
- `compactAlwaysOnTop`
- `compactVisible`

Desktop runtime/security hardening (2026-02-21):

- removed capture-phase desktop wheel interception in planner views (`Personal`/`Team`) and restored native browser scroll ownership for day-grid vertical movement
- timeline/header wheel handling is now intentionally minimal: only `Shift+wheel` is intercepted to move horizontal timeline scroll
- wheel-axis remapping helpers were removed from runtime path (`scrollAxis` mapping retired) to avoid Electron-specific vertical hijack regressions
- layout contract now enforces bounded planner viewport geometry (`html/body/#root` height chain + `h-full/flex-1/min-h-0` on shell/view wrappers) so `.board-scroll` is overflow-bound and owns vertical scrolling
- board scroll containers explicitly own native scrolling with `overflow-y:auto` + `overflow-x:auto` on planner surfaces
- desktop overlays and form surfaces (dialogs/popovers/integration controls) use `desktop-no-drag` guards to prevent click-through while editing inputs
- sound/haptic cue path now warms SFX via `fetch(..., { cache: 'no-store' })`, avoids cache-dependent media path assumptions, and falls back to WebAudio tone when file playback fails
- theme/preferences/cloud session values subscribe to `storage` events so multi-window desktop/web combinations update without manual refresh
- BrowserWindow webPreferences are explicitly enforced: `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`, `sandbox: true`
- external navigation is blocked (`will-navigate` origin guard + deny-by-default `setWindowOpenHandler`)
- embedded webviews are blocked via `will-attach-webview`
- IPC surface stays allowlisted-only through preload (`desktop:*` channel set; no generic passthrough bridge)
- desktop security checklist is documented in `desktop/DESKTOP_SECURITY.md` and linked from desktop README
- packaging metadata/icon alignment is centralized in `desktop/electron-builder.yml` (`appId`, `productName`, `buildVersion`, `publisherName`, tray/installer icon path parity)
- status: dedicated desktop regression suites are in place and currently green (`planner-desktop-wheel`, `theme-sync`, `settings-integrations`)
- residual risk: device-specific wheel drivers can emit atypical delta streams; keep optional raw-wheel diagnostics for field triage

## 10. Testing and Quality Gates

### 10.1 Scripts

From `package.json`:

- `typecheck`
- `lint`
- `format`
- `format:check`
- `test` (Vitest)
- `test:e2e` (Playwright)
- `test:e2e:cloud` (Playwright dedicated cloud harness)
- `desktop:dev` (Vite + Electron)
- `desktop:build` (desktop packaged dir)
- `desktop:dist` (Windows NSIS installer)

### 10.2 CI

`.github/workflows/ci.yml` runs:

- install
- playwright browser install
- typecheck
- lint
- format check
- unit tests
- build
- performance budget check (`npm run perf:check`)
- E2E tests

### 10.3 Test coverage targets implemented

Unit tests:

- `src/app/services/scheduling.test.ts`
- `src/app/services/shovePlanning.test.ts`
- `src/app/services/syncMerge.test.ts`
- `src/app/services/taskTimer.test.ts`
- `src/app/services/executionTicker.test.ts`
- `src/app/services/operationalTelemetry.test.ts`
- `tests/server/email.test.ts`
- `tests/server/env-validation.test.ts`
- `tests/server/security-headers.test.ts`
- `tests/server/sse-stream-auth.test.ts`

E2E tests (`tests/e2e/planner.spec.ts`):

- create task from dialog
- drag task across day/time
- resize duration
- shove with Shift
- shove via hover dwell
- unschedule to inbox
- team filter (unassigned)
- auto-place from planning panel
- undo/redo shortcuts

Compact E2E tests (`tests/e2e/planner-compact.spec.ts`):

- compact route loads with expected day/task rendering
- compact cards are visual-only and contain no inline action buttons
- clicking compact task opens full app dialog via deep-link
- "Open Full" control exits compact mode
- compact style assertion verifies token-aligned compact spacing/typography marker classes

Desktop/runtime E2E tests:

- `tests/e2e/planner-desktop-wheel.spec.ts` validates planner geometry (`.board-scroll scrollHeight > clientHeight`) plus native day-grid vertical wheel behavior, `Shift+wheel` header horizontal behavior, and non-Shift header wheel fallback to vertical board movement
- `tests/e2e/theme-sync.spec.ts` validates theme synchronization across active windows without refresh and asserts compact root surface resolves from `--board-bg` token
- `tests/e2e/settings-integrations.spec.ts` validates integration/settings input interaction and desktop-safe focus behavior
- `tests/e2e/planner-layout-regression.spec.ts` validates overlap + scroll + resize layout bounds (task cards do not intersect header/footer forbidden regions and stay inside day-column bounds)
- `tests/e2e/route-error-boundary.spec.ts` simulates lazy chunk fetch failure and asserts branded recovery UI (retry/reload/home + diagnostics) instead of React Router default crash page

Advanced deterministic interaction E2E (`tests/e2e/planner-dnd.spec.ts`):

- drag task across day/time using deterministic drop hooks
- resize task duration via deterministic resize hooks
- shove-on-drop behavior through deterministic hook path

Current E2E status (as of 2026-02-21):

- passing: all core planner and advanced deterministic interaction suites
- passing: dedicated two-client cloud sync suite (`npm run test:e2e:cloud`)
- passing: desktop/runtime parity suites (`planner-desktop-wheel`, `theme-sync`, `settings-integrations`, `planner-layout-regression`)

### 10.4 Cloud sync sanity checklist

Manual runbook used before release/merge:

1. Sign in with the same account and workspace on two clients.
2. Confirm `Auto sync: on` in both clients.
3. Create task on client A -> appears on client B within 5 seconds.
4. Update task time on client A -> updated time range appears on client B within 5 seconds.
5. Delete task on client A -> removal appears on client B within 5 seconds.
6. Refresh both clients -> no state reversion.

Deterministic automation:

- `tests/e2e/planner-cloud-sync.spec.ts` validates create/update/delete propagation across two browser clients.
- `npm run test:e2e:cloud` runs dedicated cloud harness (`playwright.cloud.config.ts`) with isolated e2e database.

## 11. Capability Matrix vs Roadmap

### P0 Ship-quality

1. Quality gates scripts: **Complete**
2. Scheduling unit tests: **Complete**
3. Core E2E interactions: **Complete**
   - stable suite (`planner.spec.ts`) + advanced deterministic suite (`planner-dnd.spec.ts`) are green
4. Orphaned modules cleanup/mount: **Complete** (legacy orphan files removed)
5. Toast theme mismatch: **Complete** (`sonner` tied to app theme attribute, no `next-themes` dependency)
6. Format baseline hardening: **Complete** (`.prettierignore` expanded for generated outputs and `npm run format` baseline established; `format:check` clean)
7. Route-level recovery boundaries: **Complete** (root + child `errorElement` plus recovery UI and E2E coverage)
8. Production JWT secret guardrail: **Complete** (env validation module and startup refusal test in production mode)

### P1 Workflow loop

6. Inbox -> Plan -> Done flow: **Complete**
7. Undo/redo scheduling actions: **Complete**
8. Import/export + backup schema versioning: **Complete** (JSON)
9. Notification delivery (browser): **Complete** (permission + scheduling window)

### P2 Business layer

10. Backend MVP auth/org/tasks/subtasks/assignees + local import migration: **Complete**
    10a. Auth lifecycle baseline (refresh rotation, verification, reset, rate limiting, TOTP MFA): **Complete baseline**
    10b. RBAC baseline (`owner/admin/member/viewer`) with server enforcement: **Complete baseline**
11. Collaboration transport: **Complete baseline (SSE-first + reconnect polling fallback + enforced presence locks)**

- SSE push events (`task.changed`, `tasks.synced`, `member.changed`)
- presence events (`presence.changed`) + lock claim/release endpoints
- server-enforced lock gate on task/day writes with owner/admin takeover support
- lock/ownership cues in scheduler UI for same task/day edits + takeover actions
- fallback polling retained for resilience
- conflict-safe sync path with optimistic concurrency
- strict conflict resolution flow (keep mine / keep theirs / merge selected) with audit events

12. Outlook add-in: **Partial scaffold**

- add-in scaffold and backend endpoint exist
- Microsoft SSO exchange + MSAL popup fallback + password fallback are implemented
- planner supports external Outlook/email drag capture into inbox/day grid
- tenant rollout guidance, least-privilege scope notes, and host smoke-test matrix are now documented in `outlook-addin/README.md`
- full enterprise deployment automation/polish is still pending

13. Observability + performance baseline: **Partial baseline**

- request tracing baseline (`X-Request-Id` + structured server logs)
- basic metrics endpoint (`/metrics/basic`)
- SLO metrics endpoint (`/metrics/slo`), telemetry ingest (`/api/ops/events`), and retained alerting endpoint (`/api/ops/alerts`)
- local-first operational telemetry capture for sync/conflict/SSE/outlook import/drag-resize samples
- CI performance budget check (`npm run perf:check`)

## 12. Known Gaps and Risks (Current)

1. Full execution consensus is still version-based at task write time; event-sourcing or dedicated execution channel is not implemented yet.
2. Enterprise identity hardening (tenant rollout policy, conditional access guidance, account recovery codes) is still missing.
3. Real provider wiring is implemented, but production deliverability setup (SPF/DKIM/DMARC, bounce handling, template localization) is still pending.
4. SSE auth is hardened with one-time stream tokens, but websocket transport and richer presence semantics (typing/edit intents per field) are not implemented.
5. Outlook scaffold now supports Microsoft SSO exchange + MSAL popup fallback + credential fallback, but enterprise packaging/deployment automation is still pending.
6. Bundle splitting baseline is in place; additional chunking and virtualization are still recommended for very large task sets.
7. `npm audit` still reports moderate dev-toolchain advisories (no high/critical after current overrides); full elimination likely requires coordinated major-version upgrades.
8. External email drag payload formats vary by Outlook host/browser; subject parsing is heuristic and may need additional host-specific normalization.
9. Desktop scroll behavior is now hardened and covered by regression tests, but some hardware/driver stacks may still emit unusual wheel delta signatures in Electron; add opt-in raw-wheel telemetry logging for field diagnostics before broad desktop rollout.
10. Desktop local static-asset loading can still fail on stale chunk references (`Failed to fetch dynamically imported module`) after interrupted rebuild/restart cycles; harden startup/asset invalidation handling in dev shell and packaged updater flow.
11. Existing sessions running pre-fix state can still show stale conflict retry behavior until session refresh/restart; verify with clean desktop `npm run desktop:dev` runtime.
12. Conflict lock now blocks all major mutation surfaces, but multi-conflict batch resolution UX is still limited (single-task resolver flow).
13. SFX path is now resilient (`no-store` warmup + fallback tone), but host-specific autoplay/capture policies can still mute playback unless user interaction unlock occurs.
14. Desktop vertical scroll ownership is now geometry-bound and covered by regression tests, but hardware/driver wheel delta outliers may still require optional telemetry for field diagnostics.
15. Dev-only console noise remains present during troubleshooting (`React DevTools` suggestion and Electron insecure CSP warning in dev mode); low severity but can obscure real error signals.

## 13. Suggested Next Engineering Step

Highest leverage next step:

- verify fixes in the exact affected desktop runtime path (`npm run desktop:dev`) with live scroll + conflict scenarios and capture any machine-specific deviations.
- monitor `conflict_entered`/`conflict_resolved` durations and consider a batch resolver flow for high-conflict workspaces.
- keep server/client conflict telemetry focused on conflict-entry/resolution timing so unresolved tasks are visible without noisy retry loops.
- continue enterprise hardening (auth rollout policy + observability/perf budgets + websocket option if bidirectional transport becomes required).

## 14. GPT Audit Prompt (Copy/Paste)

```text
Use AppAuditStructure.md as source of truth.
Return:
1) top missing capabilities by Product, UX, Reliability, Security, Performance,
2) top 10 risks with severity and mitigation,
3) phased implementation plan (P0/P1/P2) with acceptance criteria,
4) recommended test expansion (unit/integration/e2e) mapped to concrete files.

Assume Taskable currently has:
- local-first planner UX with drag/resize/stack/shove,
- daily planning loop with inbox/auto-place/review,
- adaptive execution lifecycle (start/pause/done/reopen + overrun prompts),
- undo/redo,
- JSON import/export backup,
- browser notifications with configurable lead/follow-up windows,
- cloud backend with auth/org scoping, refresh-token sessions, email verification/reset flows, TOTP MFA, RBAC, optimistic versioned sync, SSE realtime updates, and task/day presence locks,
- operational telemetry + SLO endpoint baseline,
- Outlook add-in metadata-to-inbox capture with Office SSO, MSAL popup fallback, and password fallback.

Prioritize these active live blockers first:
- repeated `PUT ... 409 (Conflict)` loops on identical task IDs in app runtime with user-visible snap-back after move attempts,
- desktop app vertical scroll still failing on affected machine despite code/test parity claims,
- `Assets/switch-sound.mp3` cache-operation fetch failures in app runtime.
```

## 15. Code Health Cleanup (2026-02-20)

### 15.1 Dead-weight removal pass

A dependency-graph sweep removed unreferenced UI/components to reduce maintenance and bundle surface area.

Removed legacy planner components:

- `src/app/components/AppThemeSwitch.tsx`
- `src/app/components/PlannerDataControls.tsx`
- `src/app/components/TeamMembersEditor.tsx`
- `src/app/components/WorkdaySettings.tsx`

Removed unreferenced UI primitives:

- `src/app/components/ui/accordion.tsx`
- `src/app/components/ui/aspect-ratio.tsx`
- `src/app/components/ui/breadcrumb.tsx`
- `src/app/components/ui/card.tsx`
- `src/app/components/ui/carousel.tsx`
- `src/app/components/ui/chart.tsx`
- `src/app/components/ui/checkbox.tsx`
- `src/app/components/ui/collapsible.tsx`
- `src/app/components/ui/command.tsx`
- `src/app/components/ui/context-menu.tsx`
- `src/app/components/ui/drawer.tsx`
- `src/app/components/ui/form.tsx`
- `src/app/components/ui/hover-card.tsx`
- `src/app/components/ui/input-otp.tsx`
- `src/app/components/ui/menubar.tsx`
- `src/app/components/ui/navigation-menu.tsx`
- `src/app/components/ui/pagination.tsx`
- `src/app/components/ui/progress.tsx`
- `src/app/components/ui/radio-group.tsx`
- `src/app/components/ui/resizable.tsx`
- `src/app/components/ui/scroll-area.tsx`
- `src/app/components/ui/sidebar.tsx`
- `src/app/components/ui/slider.tsx`
- `src/app/components/ui/table.tsx`
- `src/app/components/ui/tabs.tsx`
- `src/app/components/ui/toggle-group.tsx`
- `src/app/components/ui/separator.tsx`
- `src/app/components/ui/sheet.tsx`
- `src/app/components/ui/skeleton.tsx`
- `src/app/components/ui/toggle.tsx`
- `src/app/components/ui/tooltip.tsx`
- `src/app/components/ui/use-mobile.ts`

### 15.2 Verification after cleanup

Executed and passing:

- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run test:e2e`

### 15.3 UI fixes included in this pass

- compact task cards simplified to visual-only title/time (no inline start/pause/done controls)
- theme option text contrast hardened in settings (active/inactive label + description colors now explicit per theme tokens)

## 16. P0 Hardening Update (2026-02-21)

### 16.1 What changed

- `P0-1` format gate cleanup shipped:
  - `.prettierignore` now excludes generated/release artifacts (`release`, desktop packaging outputs, `server/.tmp`)
  - baseline formatting run completed (`npm run format`), and `npm run format:check` now passes
- `P0-2` route-level error boundaries shipped:
  - new branded recovery UI in `src/app/components/RouteErrorBoundary.tsx`
  - root and child route `errorElement` wiring in `src/app/routes.ts`
  - recovery actions: retry, reload, go home, diagnostics with request-id display when available
- `P0-3` production env validation shipped:
  - new `server/src/env.js` validates runtime env and enforces strong production `JWT_SECRET`
  - insecure static JWT fallback removed from `server/src/auth.js`
  - server startup now refuses production boot for missing/weak JWT secret

### 16.2 New or updated tests

- `tests/e2e/route-error-boundary.spec.ts`
  - aborts a lazy route chunk request and verifies branded recovery surface renders
- `tests/server/env-validation.test.ts`
  - starts server with `NODE_ENV=production` and missing `JWT_SECRET`; asserts startup refusal

### 16.3 Gate results after P0

- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `npm run format:check`: PASS
- `npm run test`: PASS
- `npm run test:e2e`: PASS
- `npm run test:e2e:cloud`: PASS
- `npm run build`: PASS
- `npm run perf:check`: PASS

### 16.4 Remaining findings after P0 (historical snapshot prior to P1)

- Security hardening still pending for explicit CSP/API security headers (P1).
- Electron security posture can be tightened further (`sandbox` compatibility review, explicit desktop security checklist).
- Sync conflict UX under high write velocity still needs additional operator/user guardrails.
- Dependency advisory debt remains (`npm audit` moderate issue path).

## 17. P1 Hardening Update (2026-02-21)

### 17.1 What changed

- Server security middleware now includes Helmet CSP + hardening headers in production:
  - `default-src 'self'`
  - `script-src 'self'` (dev-only `unsafe-eval` allowance outside production)
  - `style-src 'self' 'unsafe-inline'`
  - `img-src 'self' data:`
  - `connect-src` scoped to `self` + configured origins (+ ws/wss variants)
  - explicit `Permissions-Policy` and `Referrer-Policy`
- CORS origin checks now use env-driven allow-list (`CORS_ALLOWED_ORIGINS`) with loopback-only relaxed handling in non-production.
- Electron hardening enforcement shipped in `desktop/main.cjs`:
  - `contextIsolation: true`
  - `nodeIntegration: false`
  - `webSecurity: true`
  - `sandbox: true`
  - external navigation blocked (`will-navigate` guard)
  - deny-by-default `setWindowOpenHandler`
  - `will-attach-webview` blocked
- Desktop security checklist added: `desktop/DESKTOP_SECURITY.md` and linked in `desktop/README.md`.
- Conflict UX operator hardening expanded:
  - conflict lock enforcement added across end-prompt mutation actions in `NotificationSettingsContext`
  - persistent planner conflict banner + single resolve action added (`ConflictResolutionBanner`)
  - conflict lifecycle telemetry includes `conflict_entered` and `conflict_resolved` with duration.
- Desktop packaging metadata polish in `desktop/electron-builder.yml`:
  - consistent `appId`, `productName`, `buildVersion`, `publisherName`
  - tray/installer icon path alignment.
- Compact token alignment pass (no behavior change):
  - compact day-label typography/spacing classes aligned with board token scale markers
  - compact style marker attributes/classes added for deterministic assertion.

### 17.2 New or updated tests

- `tests/server/security-headers.test.ts`
  - validates CSP/security headers and CORS allow-list behavior in production mode
- `tests/e2e/planner-compact.spec.ts`
  - added deterministic style assertion for compact token spacing/typography marker classes.

### 17.3 Gate results after P1

- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `npm run format:check`: PASS
- `npm run test`: PASS
- `npm run test:e2e`: PASS
- `npm run test:e2e:cloud`: PASS
- `npm run build`: PASS
- `npm run perf:check`: PASS

### 17.4 Remaining findings after P1

- CSP/security headers are now enforced, but policy refinement for stricter `style-src` (hash/nonce strategy) is still open.
- Desktop security defaults are enforced, but code signing/update-channel hardening remains pending for production distribution.
- Conflict resolution UX still relies on one-task-at-a-time handling under high-conflict bursts.
- Dependency advisory debt remains (`npm audit` moderate issue path).
