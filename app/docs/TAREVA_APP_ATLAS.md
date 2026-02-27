# TAREVA_APP_ATLAS

Generated: 2026-02-27  
Repo: `Taskable` (product name in UI: `Tareva`)  
Commit: `2df849e`  
Primary code roots: `src/`, `server/`, `desktop/`

## 0) Snapshot header

### Environments

- Web frontend (Vite + React): `app/src/app/*`, `app/src/ui-system/*`
- Desktop shell (Electron): `app/desktop/main.cjs`, `app/desktop/preload.cjs`
- Backend API (Express + SQLite): `app/server/src/index.js`, `app/server/src/db.js`

### Launch posture (current)

- Green:
  - Route guard model is coherent and centralized in `src/app/components/Root.tsx` and `src/app/components/auth/AppEntryRoute.tsx`.
  - Task execution lifecycle and drift logic are implemented end-to-end (`TaskContext`, `taskTimer`, `durationProfile`, `executionTelemetry`).
  - Cloud sync has conflict detection/resolution + presence locking + SSE fallback paths (`CloudSyncContext.tsx`, backend `/stream` + presence endpoints).
  - Desktop security defaults are hardened (`contextIsolation`, `sandbox`, nav blocking).
- Risks:
  - Onboarding visuals are static, custom scene markup/CSS and can drift from live planner behavior (`src/app/components/onboarding/OnboardingTutorialModal.tsx`, `.css`).
  - Admin and execution-mode controls are flag-gated and can disappear with env/runtime mismatch (`src/app/flags.ts`).
  - Code-signing is documented but not automated (`desktop/CODE_SIGNING.md`).

### Discrepancies (docs reconciliation)

| Topic | Prior docs | Current code truth | Resolution in Atlas |
| --- | --- | --- | --- |
| Canonical index file | `AppAuditStructure.md`, `AppAuditReport.md` were acting as top-level indexes | No single canonical atlas file existed | This file is now the primary index. |
| MASTER_CHANGESET reference | Requested as an input source | `app/MASTER_CHANGESET.md` did not exist | Created and linked as a changelog ledger. |
| `/landing` surface | `LandingPage.tsx` exists | Router does not register `/landing` (`src/app/routes.ts`) | Documented as non-routed legacy surface. |
| Naming | Docs mix `Taskable` and `Tareva` | UI strings and desktop metadata use `Tareva`; package/repo use `Taskable` | Both names documented with file anchors. |

## 1) Product definition

Tareva is a local-first daily planning and execution app with optional cloud sync for multi-device/team workflows. It combines timeline scheduling, execution-state controls, and drift-aware runtime feedback.

### Differentiators implemented

- Drift prevention and recovery:
  - Overrun detection + extension flows: `src/app/services/taskTimer.ts`, `src/app/context/NotificationSettingsContext.tsx`
  - Adaptive duration suggestions: `src/app/services/durationProfile.ts`, consumed by `src/app/components/AddTaskDialog.tsx`
- Execution mode (flag-gated):
  - Preference and behavior gate: `src/app/flags.ts`, `src/app/context/UserPreferencesContext.tsx`, `src/app/components/Root.tsx`
- Real-time collaboration (when cloud enabled):
  - Presence locks + SSE stream + conflict resolver: `src/app/context/CloudSyncContext.tsx`, `server/src/index.js`
- Compact desktop operation:
  - Dedicated compact route and Electron compact window: `src/app/components/CompactView.tsx`, `desktop/main.cjs`

### Explicitly out of scope for launch

- `/landing` as a production route (component exists but is not routed): `src/app/components/LandingPage.tsx`, `src/app/routes.ts`
- Automated desktop code-signing pipeline in CI (runbook only): `desktop/CODE_SIGNING.md`
- Separate weekly-review page route (review currently appears in onboarding scene, not as a routed page): `src/app/components/onboarding/OnboardingTutorialModal.tsx`

## 2) App map (routes and pages)

Source of truth: `src/app/routes.ts`

| Route | Page component file | Guards / gates | Primary purpose | Key child components |
| --- | --- | --- | --- | --- |
| `/` | Redirect via `RootWelcomeRedirect` in `src/app/routes.ts` | Always redirects to `/welcome` | Canonical entry redirect | `Navigate` |
| `/app` | `src/app/components/auth/AppEntryRoute.tsx` | Uses onboarding mode + cloud auth state; localhost dev override with `?persistMode=1` | Legacy deep entry to planner/welcome | `Navigate` |
| `/welcome` | `src/app/components/auth/WelcomeView.tsx` | Public | Unified onboarding/welcome surface | Hero CTA row + planner snapshot preview |
| `/login` | `src/app/components/auth/LoginView.tsx` | Public route; UI hard-blocked when `CLOUD_SYNC_ENABLED=false` | Cloud sign-in | `AuthScaffold` |
| `/signup` | `src/app/components/auth/SignupView.tsx` | Public route; UI hard-blocked when `CLOUD_SYNC_ENABLED=false` | Cloud registration | `AuthScaffold` |
| `/verify` | `src/app/components/auth/VerifyView.tsx` | Public | Email verification completion | Auth scaffold sections |
| `/forgot` | `src/app/components/auth/ForgotPasswordView.tsx` | Public | Request reset email | Auth scaffold sections |
| `/reset` | `src/app/components/auth/ResetPasswordView.tsx` | Public | Reset password with token | Auth scaffold sections |
| `/planner` | Lazy `src/app/components/PersonalView.tsx` under `Root` | `Root` requires mode (`local`/`cloud`) and cloud auth if cloud mode | Personal planner board | `PlannerTopRail`, `DailyPlanningPanel`, `InboxPanel`, `DayColumn`, `TaskCard`, settings drawer |
| `/team` | Lazy `src/app/components/TeamView.tsx` under `Root` | Same `Root` gating as `/planner` | Team planner board | Team-aware variants + same planning primitives |
| `/compact` | Lazy `src/app/components/CompactView.tsx` under `Root` | Same `Root` gating as `/planner` | Dense compact planner surface | Compact timeline + compact task cards |
| `/admin` | Lazy `src/app/components/admin/AdminDashboard.tsx` under `Root` | Requires cloud mode/auth + owner role + `resolveAdminDashboardFlag()` true | Owner-only admin and ops panels | `AdminOverviewPanel`, `AdminUsersPanel`, `AdminOrgsPanel`, `AdminConflictsPanel`, `AdminSyncHealthPanel`, `AdminEmailHealthPanel` |
| `/landing` | `src/app/components/LandingPage.tsx` (not routed) | Not reachable by router | Legacy/non-active landing implementation | N/A |

### Route error boundary

All routes are wrapped with `RouteErrorBoundary` (`src/app/components/RouteErrorBoundary.tsx`) through `errorElement` in `src/app/routes.ts`.

## 3) UI/UX contract

### Token system and style primitives (enforced in code)

- Theme + semantic tokens: `src/styles/theme.css`
  - `--hud-*`, `--board-*`, `--timeline-*`, planner sizing tokens
- UI system tokens/layout/components:
  - `src/ui-system/styles/tokens.css`
  - `src/ui-system/styles/components.css`
  - `src/ui-system/styles/layout.css`
- App shell density contract:
  - `data-testid="app-shell"` + `data-density` in `src/app/components/Root.tsx`
  - density vars in `src/styles/theme.css`

### Premium-feel rules currently encoded

- HUD surfaces use thin borders + dark layered surfaces + blur shell (`.ui-hud-shell`, `.ui-hud-panel` in `src/styles/theme.css`).
- Semantic token usage over ad-hoc per-component hex colors is mandated in style guide (`docs/master-style.md`).
- Welcome/onboarding/planner visual language is expected to stay unified (`docs/master-style.md`, source files listed there).

### Scroll ownership contract

- Planner board scroll owner is `.board-scroll` (x/y overflow), with custom scrollbar styling: `src/styles/theme.css`
- Personal/Team views attach scroll/wheel listeners to board container and avoid global page scrolling: `src/app/components/PersonalView.tsx`, `src/app/components/TeamView.tsx`

### Overlap policy (current behavior)

- Default action on drop over occupied slot: stack in lane.
- Shove behavior requires hold or Shift key:
  - hover dwell threshold `SHOVE_HOVER_MS = 550` in `src/app/components/DayColumn.tsx`
  - math functions: `buildForwardShovePlan`, `countOverlapsAtTarget` in `src/app/services/shovePlanning.ts`
- User-facing hint text: `Drop to stack, hold to shove` in `DayColumn.tsx`.

### Stagger policy (current behavior)

- Planner: card top offset by hour-band/lane parity (`staggerOffsetPx`) in `src/app/components/DayColumn.tsx`.
- Compact: stagger offset in `getTaskTop()` using `LANE_STAGGER_OFFSET` in `src/app/components/CompactView.tsx`.
- Welcome preview has custom stagger constants in `src/app/components/auth/WelcomeView.tsx`.
- Onboarding scenes are custom markup/CSS and maintain separate stagger logic (`OnboardingTutorialModal.tsx`, `.css`).

### Compact mode constraints

- Compact layout constants and lane geometry:
  - `LANE_HEIGHT`, `LANE_GAP`, `LANE_STAGGER_OFFSET` in `src/app/components/CompactView.tsx`
- Compact route is a first-class page (`/compact`) and desktop window target (`desktop/main.cjs`).

### Accessibility commitments implemented

- Reduced motion global switch via `data-reduce-motion=true`: `src/app/context/UserPreferencesContext.tsx`, `src/styles/theme.css`
- Keyboard controls and escape/delete/undo/redo handlers: `src/app/components/Root.tsx` (`TaskHotkeys`, `CompactModeHotkeys`)
- Focus/ring tokenized states from base theme tokens: `src/styles/theme.css`

## 4) Feature flags

### Flag registry

| Flag | Defining file | Default | Query override | Env override | Gates | Rollback instruction |
| --- | --- | --- | --- | --- | --- | --- |
| `adminDashboardV1` | `src/app/flags.ts` | `false` | None | `VITE_ENABLE_ADMIN` | `/admin` feature availability | Set `VITE_ENABLE_ADMIN=false` and restart deployment; query/localStorage override is intentionally disabled. |
| `layoutV1` | `src/app/flags.ts` | `true` | `?layoutV1=1|0` | `VITE_LAYOUT_V1` | LayoutV1 shell/sidebar behavior | Set env/query to `false`, or clear `taskable:layout-v1`. |
| `executionModeV1` | `src/app/flags.ts` | `false` | `?executionModeV1=1|0` | `VITE_ENABLE_EXECUTION_MODE_V1` | Execution mode toggle/UI availability | Set env/query to `false`, or clear `taskable:execution-mode-v1`. |
| `uiSystemV1` | `src/ui-system/flags.ts` | `true` | `?uiSystemV1=1|0` | `VITE_UI_SYSTEM_V1` | UI-system shell classes/primitives | Set env/query to `false`, or clear `taskable:ui-system-v1`. |
| Cloud sync build gate | `src/app/services/cloudApi.ts` | Off unless env true | None | `VITE_ENABLE_CLOUD_SYNC` | Auth screens, cloud sync runtime, cloud-only flows | Set `VITE_ENABLE_CLOUD_SYNC=false` to force local-only behavior. |

### Override precedence

- `adminDashboardV1`: env override -> default (`src/app/flags.ts`)
- Other app flags (`layoutV1`, `executionModeV1`): env override -> query param -> persisted localStorage override -> default (`src/app/flags.ts`)
- UI-system flag: env override -> query param -> persisted localStorage override -> default (`src/ui-system/flags.ts`)

Legacy cleanup:
- App startup removes stale admin override key `taskable:admin-dashboard-v1` to prevent previous local flags from affecting UI state (`src/app/App.tsx`).

## 5) Frontend architecture (modules and ownership)

### Providers / contexts

| Module | File | Responsibility |
| --- | --- | --- |
| Onboarding state | `src/app/context/OnboardingContext.tsx` | Planner mode (`local|cloud`), cloud session links, tutorial completion state |
| Preferences | `src/app/context/UserPreferencesContext.tsx` | Planner behavior prefs (density, execution settings, telemetry share, compact mode, reduced motion, etc.) |
| Tasks canonical state | `src/app/context/TaskContext.tsx` | Task CRUD, execution state transitions, undo/redo, local persistence, broadcast sync |
| Cloud sync | `src/app/context/CloudSyncContext.tsx` | Tokened API calls, pull/push, conflict lifecycle, presence locking, SSE/polling transport |
| Workday model | `src/app/context/WorkdayContext.tsx` | Workday hours + persistence |
| Team members | `src/app/context/TeamMembersContext.tsx` | Team member local data + default removals |
| Notifications / end-prompt | `src/app/context/NotificationSettingsContext.tsx` | Notification permissions, lead times, overrun prompt workflow |
| Theme | `src/app/context/AppThemeContext.tsx` | Theme mode and theme persistence |

Provider assembly points:
- `src/app/App.tsx`
- `src/app/components/Root.tsx`

### Services map

| Service area | Key files | Responsibility |
| --- | --- | --- |
| Scheduling engine | `src/app/services/scheduling.ts`, `src/app/services/shovePlanning.ts` | Time math, conflict checks, shove plan generation |
| Execution timing | `src/app/services/taskTimer.ts`, `executionTicker.ts` | Running-state normalization, elapsed/overrun calculations, ticker updates |
| Duration learning | `src/app/services/durationProfile.ts` | Completion sample ingestion and duration suggestion |
| Telemetry | `src/app/services/operationalTelemetry.ts`, `executionTelemetry.ts`, `taskTelemetry.ts` | Operational + execution event capture and flushing |
| Cloud transport | `src/app/services/cloudApi.ts`, `authClient.ts` | Cloud request wrapper, SSE URL build, auth client APIs |
| Sound/feedback | `src/app/services/uiSounds.ts` | UI sound gating and playback |
| Desktop bridge | `src/app/services/desktopShell.ts` | Desktop shell integration and compact window controls |
| Time-axis helpers | `src/app/services/dayTimeline.ts`, `taskLayout.ts` | Day/hour slot layout helpers for planner rendering |

### DnD subsystem and drop math

- React DnD backend initialized in `Root.tsx` (`DndProvider` + `HTML5Backend`).
- Planner drop coordinate mapping:
  - `getMinutesFromClientX()` in `src/app/components/DayColumn.tsx`
- Placement/preview math:
  - `getPlacement()`, `getPreviewLaneIndex()` in `DayColumn.tsx`
- Overlap/shove logic:
  - `countOverlapsAtTarget()`, `buildForwardShovePlan()` in `src/app/services/shovePlanning.ts`
  - applied in drop handlers in `DayColumn.tsx`

### Error boundaries and guard rails

- Route-level boundary: `src/app/components/RouteErrorBoundary.tsx`
- Access/mode guard:
  - app shell guard in `src/app/components/Root.tsx`
  - legacy entry redirect guard in `src/app/components/auth/AppEntryRoute.tsx`
  - admin role + flag gates in `src/app/components/admin/AdminDashboard.tsx`

### Storage / persistence boundaries

- Local-first task persistence: `TaskContext` -> `localStorage` key `taskable-tasks`
- Cross-tab task sync: `BroadcastChannel('taskable:tasks-sync')`
- Preferences persistence and per-mode/per-user scoping: `UserPreferencesContext`
- Cloud persistence boundary: backend `/api/orgs/:orgId/tasks*` endpoints (through `CloudSyncContext`)

## 6) Data model (canonical)

### Canonical Task model in frontend

Source: `src/app/context/TaskContext.tsx` (`export interface Task`)

Required fields used by runtime:
- `id: string`
- `title: string`
- `durationMinutes: number`
- `completed: boolean`
- `color: string`
- `subtasks: SubTask[]`
- `type: 'quick' | 'large' | 'block'`
- `version: number` (required; new local tasks initialize with `0` before first cloud write)

Optional scheduling/collaboration fields:
- `description?: string`
- `startDateTime?: string`
- `timeZone?: string`
- `assignedTo?: string`
- `status?: 'scheduled' | 'inbox'`
- `focus?: boolean`

Execution/drift fields:
- `executionVersion?: number`
- `executionUpdatedAt?: string`
- `executionStatus?: TaskExecutionStatus`
- `actualMinutes?: number`
- `lastStartAt?: string`
- `completedAt?: string`
- `lastEndPromptAt?: string`
- `lastPromptAt?: string` (legacy compatibility)

Subtask model:
- `SubTask = { id: string; title: string; completed: boolean }`

### Local storage keys for tasks/state

- Task payload key: `taskable-tasks` (`schemaVersion=4`) in `TaskContext.tsx`
- Task sync broadcast channel: `taskable:tasks-sync`

### Cloud mapping + versioning rules

- Backend DB task row mapper: `server/src/index.js` `mapTaskRow()`
- Write schemas:
  - `taskCreateSchema`
  - `taskUpdateSchema`
  - `taskEndPromptAckSchema`
  - `conflictResolutionLogSchema`
- Version conflict contract:
  - request carries `ifVersion`
  - backend compares with stored `tasks.version`
  - mismatch returns `409` via `sendVersionConflict(...)`
- Execution versioning:
  - backend stores and returns `execution_version`
  - frontend tracks `executionVersion`/`executionUpdatedAt`

## 7) Execution system (drift)

### Lifecycle (as implemented)

Source: `src/app/context/TaskContext.tsx`

- Start: `startTask(id)` -> sets running status + timestamps, emits telemetry event `task_started`
- Pause: `pauseTask(id)` -> transitions running->paused, emits `task_paused`
- Done: `completeTask(id)` -> marks completed, captures completion sample, emits `task_completed`
- Reopen: `reopenTask(id)` -> returns completed task to active state
- Extend:
  - `extendTaskDuration(id, additionalMinutes)`
  - `extendTaskToNow(id, slotMinutes)`
- End-prompt ack marker: `markTaskPrompted(id, promptedAt?)`

### Overrun stripe + extend behavior

- Overrun math in `src/app/services/taskTimer.ts` (`getOverrunMinutes`, elapsed helpers)
- End-prompt and adaptive extend/replan flows in `src/app/context/NotificationSettingsContext.tsx`
- Task card visual overrun indicators in `src/app/components/TaskCard.tsx`

### Auto-start engine behavior and gating

Source: `src/app/components/Root.tsx` (`PlannerAutoStartEngine`)

- Session dedupe key: `taskable:auto-start-fired` (session storage)
- Starts eligible scheduled tasks at their start time when gate is open
- Gate conditions:
  - execution-mode gate open (`resolveExecutionModeV1Flag` + preference)
  - `autoStartTasksAtStartTime` enabled
  - write permission available (cloud role/lock checks)

### Execution Mode toggle + persistence

- Flag gate: `resolveExecutionModeV1Flag()` in `src/app/flags.ts`
- Preference: `executionModeEnabled` in `UserPreferencesContext.tsx`
- Scoped persistence keys:
  - local: `taskable:execution-mode:local`
  - cloud: `taskable:execution-mode:cloud:<userId>`

### Telemetry capture and retention

- Execution telemetry store:
  - key `taskable:telemetry:v1`
  - schema version and retention max (`MAX_EVENTS=5000`, `MAX_RETENTION_MS=90 days`)
  - file: `src/app/services/executionTelemetry.ts`
- Event types:
  - `task_started`, `task_paused`, `task_completed`, `task_postponed`
- Flush bridge in shell: `ExecutionTelemetryBridge` in `Root.tsx`

### Duration profile learning

- Updated on completion: `updateDurationProfileOnCompletion(...)` in `src/app/services/durationProfile.ts`
- Suggestions consumed during task creation/edit (`AddTaskDialog.tsx`)

## 8) Collaboration & cloud sync

### Auth token usage

- Tokens persisted client-side in auth storage keys:
  - `taskable:cloud-token`, `taskable:cloud-refresh-token`, `taskable:cloud-org-id`, `taskable:cloud-user-id`
- Request wrapper with auto refresh path in `CloudSyncContext.tsx` (`requestWithToken`) and `cloudApi.ts`.

### Push / pull flow

- Pull:
  - `pullTasksInternal()` in `CloudSyncContext.tsx`
  - endpoint `GET /api/orgs/:orgId/tasks`
- Push:
  - `pushTasks()` in `CloudSyncContext.tsx`
  - endpoint `PUT /api/orgs/:orgId/tasks/:taskId` + `ifVersion`

### Conflict detection and lock behavior

- Conflict detect on HTTP `409` (`VERSION_CONFLICT`) -> `conflicts` state
- Conflict lock surfaces:
  - `isTaskConflictLocked(taskId)`
  - `openConflictResolver(taskId)`
- Resolution methods:
  - `resolveConflictKeepMine(taskId)`
  - `resolveConflictKeepTheirs(taskId)`
  - `resolveConflictMerge(taskId, mergedTask)`

### Presence locking (SSE + REST)

- Presence REST endpoints:
  - `GET /api/orgs/:orgId/presence`
  - `POST /api/orgs/:orgId/presence/claim`
  - `POST /api/orgs/:orgId/presence/release`
  - `POST /api/orgs/:orgId/presence/release-all`
- Client functions:
  - `claimPresenceLock`, `releasePresenceLock`, `releaseAllPresenceLocks` in `CloudSyncContext.tsx`
- SSE setup:
  - stream token: `POST /api/orgs/:orgId/stream-token`
  - stream channel: `GET /api/orgs/:orgId/stream`

### SSE channel structure (implemented events)

Client listeners in `CloudSyncContext.tsx`:
- `connected`
- `task.changed`
- `tasks.synced`
- `member.changed`
- `presence.changed`

Server emits from `server/src/index.js` via `publishOrgEvent(...)`.

### Retry suppression / failure behavior

- Dev fallback fetch targets in `cloudApi.ts` (`localhost` + loopback fallbacks)
- Sync issue state and toasts in `CloudSyncContext.tsx` (`setSyncIssue`, `CloudSyncErrorToasts`)
- Cloud disabled build path: auth routes render explicit disabled message (`LoginView.tsx`, `SignupView.tsx`)
- Cloud unreachable path: auth views show actionable API unreachable message

## 9) Backend architecture

### Server entry and middleware stack

Primary entry: `server/src/index.js`

Key middleware/security layers:
- Helmet + CSP + security headers
- CORS allowlist validation from env (`server/src/env.js`)
- JSON parsing limits (`express.json`)
- Request ID + request metrics collection
- `requireMetricsToken` middleware on `/metrics/basic` and `/metrics/slo` (`METRICS_ACCESS_TOKEN` env, loopback-only fallback when unset)
- Auth middleware (`requireAuth`, org access, owner checks)

Database layer:
- SQLite schema and migrations: `server/src/db.js`

Auth helpers:
- Token/session/hash utilities: `server/src/auth.js`

### Auth subsystem

Implemented in `server/src/index.js` with zod validation and rate limiting on auth-sensitive routes:
- Register/login/refresh/logout
- Email verification + resend
- Password reset request + reset
- MFA enroll start/confirm/disable
- Session listing and `/api/me`

### Org/roles model

- Orgs and memberships resolved from DB joins in `server/src/index.js`
- Roles include owner/admin/member/viewer patterns (enforced in org access helpers and admin owner gate)
- Admin API requires:
  - `ENABLE_ADMIN_API` gate
  - authenticated user
  - owner role (`requireOwner`)

### Endpoint inventory (all)

Handler file for all rows: `server/src/index.js`

| Method | Path | Handler file | High-level schema / validation |
| --- | --- | --- | --- |
| GET | `/health` | `server/src/index.js` | none (inline health JSON) |
| GET | `/metrics/basic` | `server/src/index.js` | `requireMetricsToken` + inline metrics payload |
| GET | `/metrics/slo` | `server/src/index.js` | `requireMetricsToken` + inline SLO aggregation |
| POST | `/api/auth/register` | `server/src/index.js` | `registerSchema` + auth rate limit |
| POST | `/api/auth/login` | `server/src/index.js` | `loginSchema` + auth rate limit |
| POST | `/api/auth/microsoft/exchange` | `server/src/index.js` | `microsoftExchangeSchema` + auth rate limit |
| POST | `/api/auth/refresh` | `server/src/index.js` | `refreshSchema` + auth rate limit |
| POST | `/api/auth/logout` | `server/src/index.js` | inline refresh token extraction |
| POST | `/api/auth/resend-verification` | `server/src/index.js` | `emailOnlySchema` + auth rate limit |
| POST | `/api/auth/verify-email` | `server/src/index.js` | `verifyEmailSchema` + auth rate limit |
| POST | `/api/auth/request-password-reset` | `server/src/index.js` | `emailOnlySchema` + auth rate limit |
| POST | `/api/auth/reset-password` | `server/src/index.js` | `resetPasswordSchema` + auth rate limit |
| GET | `/api/auth/sessions` | `server/src/index.js` | auth required |
| POST | `/api/auth/mfa/enroll/start` | `server/src/index.js` | auth required (inline checks) |
| POST | `/api/auth/mfa/enroll/confirm` | `server/src/index.js` | `mfaConfirmSchema` + auth required |
| POST | `/api/auth/mfa/disable` | `server/src/index.js` | `mfaDisableSchema` + auth required |
| GET | `/api/me` | `server/src/index.js` | auth required |
| GET | `/api/admin/overview` | `server/src/index.js` | `adminScopeQuerySchema` + admin gate + owner |
| GET | `/api/admin/users` | `server/src/index.js` | `adminUsersQuerySchema` + admin gate + owner |
| POST | `/api/admin/users/:userId/resend-verification` | `server/src/index.js` | admin gate + owner |
| GET | `/api/admin/orgs` | `server/src/index.js` | `adminOrgsQuerySchema` + admin gate + owner |
| GET | `/api/admin/conflicts` | `server/src/index.js` | `adminConflictsQuerySchema` + admin gate + owner |
| GET | `/api/admin/sync-health` | `server/src/index.js` | `adminScopeQuerySchema` + admin gate + owner |
| GET | `/api/admin/email-health` | `server/src/index.js` | `adminScopeQuerySchema` + admin gate + owner |
| POST | `/api/ops/events` | `server/src/index.js` | `operationalEventSchema` + auth required |
| GET | `/api/ops/alerts` | `server/src/index.js` | inline `querySchema` + auth required |
| GET | `/api/orgs` | `server/src/index.js` | auth required |
| POST | `/api/orgs` | `server/src/index.js` | inline `z.object({name})` + auth required |
| POST | `/api/orgs/:orgId/stream-token` | `server/src/index.js` | `streamTokenRequestSchema` + auth/org access |
| GET | `/api/orgs/:orgId/stream` | `server/src/index.js` | SSE stream token auth + org access |
| GET | `/api/orgs/:orgId/presence` | `server/src/index.js` | auth + org access |
| POST | `/api/orgs/:orgId/presence/claim` | `server/src/index.js` | `presenceClaimSchema` + auth/org access |
| POST | `/api/orgs/:orgId/presence/release` | `server/src/index.js` | `presenceReleaseSchema` + auth/org access |
| POST | `/api/orgs/:orgId/presence/release-all` | `server/src/index.js` | `presenceReleaseAllSchema` + auth/org access |
| GET | `/api/orgs/:orgId/members` | `server/src/index.js` | auth + org access |
| POST | `/api/orgs/:orgId/members` | `server/src/index.js` | inline member create `schema` + auth/org access |
| PATCH | `/api/orgs/:orgId/members/:userId` | `server/src/index.js` | inline member update `schema` + auth/org access |
| DELETE | `/api/orgs/:orgId/members/:userId` | `server/src/index.js` | auth/org access + role checks |
| GET | `/api/orgs/:orgId/tasks` | `server/src/index.js` | `taskListQuerySchema` (`limit<=2000`, optional ISO `since`), auth/org access; returns `tasks`, `hasMore`, `nextSince`, `deletedTaskIds` |
| POST | `/api/orgs/:orgId/tasks` | `server/src/index.js` | `taskCreateSchema` + auth/org access |
| PUT | `/api/orgs/:orgId/tasks/:taskId` | `server/src/index.js` | `taskUpdateSchema` + `ifVersion` conflict handling |
| POST | `/api/orgs/:orgId/tasks/:taskId/end-prompt` | `server/src/index.js` | `taskEndPromptAckSchema` + `ifVersion` |
| DELETE | `/api/orgs/:orgId/tasks/:taskId` | `server/src/index.js` | auth/org access + optional `ifVersion` |
| POST | `/api/orgs/:orgId/tasks/:taskId/conflict-resolution` | `server/src/index.js` | `conflictResolutionLogSchema` + auth/org access |
| GET | `/api/orgs/:orgId/activity` | `server/src/index.js` | `activityQuerySchema` + auth/org access |
| POST | `/api/orgs/:orgId/import-local` | `server/src/index.js` | inline import `schema` + auth/org access |
| POST | `/api/orgs/:orgId/inbox-from-email` | `server/src/index.js` | inline inbox-email `schema` + auth/org access |

## 10) Desktop (Electron)

### Main process files

- Main entry: `desktop/main.cjs`
- Preload bridge: `desktop/preload.cjs`
- Local static server helper: `desktop/localServer.cjs`
- Desktop state persistence: `desktop/store.cjs`

### Security defaults

In `desktop/main.cjs` `BrowserWindow` options:
- `contextIsolation: true`
- `nodeIntegration: false`
- `webSecurity: true`
- `sandbox: true`

Navigation hardening:
- denies `window.open`
- blocks navigation outside renderer origin (`will-navigate`)
- blocks `webview` attachment (`will-attach-webview`)

### Compact window behavior

- Compact route target: `/compact?desktopCompact=1`
- Separate frameless always-on-top capable window with tray toggles
- Main/compact window state persisted through desktop store

### Packaging config and current limitations

- Build config: `desktop/electron-builder.yml`
- Windows target: NSIS installer
- Current limitation: code signing documented, not automated (`desktop/CODE_SIGNING.md`)

## 11) Deployment & environments

### Frontend (Vercel)

- SPA fallback config: `vercel.json` routes all to `/index.html`
- Frontend env contract: `.env.example`
  - `VITE_API_URL`
  - `VITE_ENABLE_CLOUD_SYNC`
  - `VITE_UI_SYSTEM_V1`
  - `VITE_LAYOUT_V1`
  - `VITE_ENABLE_ADMIN`

### Backend (Render)

- Root/service path documented: `README.md` (`app/server`)
- Health endpoint for uptime: `GET /health`
- Server env contract: `server/.env.example`
  - auth secrets, token TTLs, CORS/client origins
  - email provider keys
  - admin/sse toggles
  - persistent DB path (`TASKABLE_DB_PATH`)

Production persistence guard:
- `server/src/db.js` exits at startup when `NODE_ENV=production` and `TASKABLE_DB_PATH` is unset.
- Render deployments must mount a persistent disk and set `TASKABLE_DB_PATH` to that mount (example: `/data/tareva.db`).

Environment hygiene requirement:
- `.env` and `.env.e2e-cloud` must remain untracked in git; verify with:
  - `git ls-files .env`
  - `git ls-files .env.e2e-cloud`

### CORS and API base behavior

- Vite dev proxy routes `/api` to `VITE_SERVER_URL` or `http://localhost:4000`: `vite.config.ts`
- Cloud API base + dev failover logic: `src/app/services/cloudApi.ts`

### Render suspended / unreachable behavior

User-visible fallback when API unreachable:
- Login/Signup show `Cloud API is unreachable. Check server status and VITE_API_URL.`
  - `src/app/components/auth/LoginView.tsx`
  - `src/app/components/auth/SignupView.tsx`

### Email provider mode and deliverability readiness

Source: `docs/EmailDeliverabilityRunbook.md`

Required for production readiness:
- configured provider (`sendgrid` or `postmark`)
- verified sender domain (`EMAIL_FROM`)
- DNS alignment (SPF, DKIM, DMARC)
- `EMAIL_REQUIRE_DELIVERY=true`
- admin email health checks on `/admin` panel

## 12) Test map & gates

### Gate commands

From `package.json`:
- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- `npm run test`
- `npm run test:e2e`
- `npm run test:e2e:cloud`

CI security gate:
- `.github/workflows/ci.yml` runs `gitleaks/gitleaks-action@v2` in the `quality` job before install/build/test steps.

Green means:
- all commands exit code `0`
- no failed unit/server/e2e specs

### Unit/service tests (Vitest)

Files under `src/app/services/*.test.ts` include:
- scheduling and shove math: `scheduling.test.ts`, `shovePlanning.test.ts`
- execution timers/telemetry: `taskTimer.test.ts`, `executionTelemetry.test.ts`, `executionTicker.test.ts`
- duration/adaptive logic: `durationProfile.test.ts`, `adaptiveScheduling.test.ts`
- merge/conflict helpers: `syncMerge.test.ts`
- insight/forecast helpers: `executionInsights.test.ts`, `executionForecast.test.ts`
- task telemetry/deep-link: `taskTelemetry.test.ts`, `taskDeepLink.test.ts`
- operational telemetry: `operationalTelemetry.test.ts`

### Server/API tests

Files under `tests/server/*` include:
- auth/admin gates: `admin-auth.test.ts`, `admin-env-gate.test.ts`, `admin-scope.test.ts`
- security/env: `security-headers.test.ts`, `env-validation.test.ts`
- email flows/rate limits: `email.test.ts`, `email-rate-limit.test.ts`
- ops telemetry: `opsTelemetry.test.ts`
- SSE stream auth: `sse-stream-auth.test.ts`

### E2E (Playwright)

Core planner and UX regressions under `tests/e2e/*`:
- drag/drop + overlap/stack: `planner-dnd.spec.ts`, `planner-real-drag.spec.ts`, `planner-overlap-stack.spec.ts`, `planner-inbox-drag.spec.ts`
- scroll/hud/layout: `planner-scroll-ownership-web.spec.ts`, `planner-hud-viewport.spec.ts`, `planner-layout-regression.spec.ts`, `planner-compact.spec.ts`
- onboarding/auth/welcome/landing: `onboarding-auth.spec.ts`, `welcome.spec.ts`, `landing.spec.ts`
- feature flags and mode toggles: `ui-system-toggle.spec.ts`, `execution-mode-toggle.spec.ts`, `layoutV1-sidebar-collapse.spec.ts`
- cloud sync suite: `planner-cloud-sync.spec.ts` (via `playwright.cloud.config.ts`)
- admin access: `admin-dashboard.spec.ts`, `admin-dashboard-access.spec.ts`

## 13) Known risks / launch blockers

### P0 (must fix before launch)

| Risk | Reproduction steps | Impacted surfaces | Proposed mitigation | Owner module |
| --- | --- | --- | --- | --- |
| Cloud mode disabled by env mismatch | Build frontend with `VITE_ENABLE_CLOUD_SYNC=false`, open `/login` or `/signup` | Cloud onboarding and sync unavailable | Enforce env validation in release checklist; block release when cloud SKU expected but flag false | `src/app/services/cloudApi.ts`, deployment config |
| Missing/incorrect auth secret/env in backend | Start server without valid `JWT_SECRET` or origins, run auth flows | Login/signup/session flows fail or insecure setup | Mandatory env verification before deploy; use `server/.env.example` contract and health+smoke tests | `server/src/env.js`, ops checklist |

### P1 (can launch with)

| Risk | Reproduction steps | Impacted surfaces | Proposed mitigation | Owner module |
| --- | --- | --- | --- | --- |
| Onboarding preview can drift from planner reality | Compare onboarding drag/run scenes against live `DayColumn` behavior after UI changes | Tutorial accuracy and trust | Move scenes to shared task-card/timeline primitives or add visual regression tests for onboarding scenes | `src/app/components/onboarding/*` |
| `/landing` component is not routed | Search router for `/landing`; route not present | Potential contributor confusion | Keep documented as inactive or explicitly add/remove route in planned cleanup | `src/app/routes.ts`, `LandingPage.tsx` |
| Desktop signing pipeline is manual | Follow release build docs; no CI signing job | Desktop distribution trust/SmartScreen | Implement CI signing using documented env vars and verify signatures pre-release | `desktop/CODE_SIGNING.md`, CI config |

### P2 (backlog)

| Risk | Reproduction steps | Impacted surfaces | Proposed mitigation | Owner module |
| --- | --- | --- | --- | --- |
| Audit docs drift over time | Update features without updating docs | New contributor onboarding and release confidence | Require Atlas update in PR checklist | `docs/TAREVA_APP_ATLAS.md`, `AppAudit*` |
| Theme naming inconsistency (`Taskable` vs `Tareva`) | Review package metadata vs UI labels | Branding consistency | Decide canonical product naming policy and codify in docs | repo root + UI copy |

## 14) Launch checklist (copy/paste ready)

- [ ] Set and verify all required env variables.
- [ ] Backend env sanity: `JWT_SECRET`, origins (`CLIENT_ORIGIN`/`APP_BASE_URL`), auth TTL values.
- [ ] Frontend env sanity: `VITE_API_URL`, `VITE_ENABLE_CLOUD_SYNC`, feature flags for intended SKU.
- [ ] DNS/email deliverability checks completed (SPF, DKIM, DMARC, sender verification).
- [ ] Admin access check:
  - [ ] Owner account can open `/admin`.
  - [ ] Non-owner account is blocked.
- [ ] Onboarding happy path:
  - [ ] `/welcome` -> start local -> planner.
  - [ ] `/signup` cloud account -> planner -> tutorial completion storage updated.
- [ ] Local-first happy path:
  - [ ] New local user starts with empty task state.
  - [ ] Task CRUD persists via `taskable-tasks`.
- [ ] Cloud sync happy path:
  - [ ] task create/update/delete round-trip succeeds across two clients.
  - [ ] presence locks display and release correctly.
- [ ] Conflict scenario test:
  - [ ] concurrent edit triggers 409 conflict.
  - [ ] keep-mine / keep-theirs / merge paths complete.
- [ ] Desktop packaging smoke test:
  - [ ] main + compact windows open correctly.
  - [ ] deep-link and tray controls work.
  - [ ] installer metadata/version correct.
- [ ] Rollback levers verified:
  - [ ] `adminV1`, `layoutV1`, `executionModeV1`, `uiSystemV1` overrides.
  - [ ] `VITE_ENABLE_CLOUD_SYNC` emergency local-only fallback behavior confirmed.

## 15) Appendices

### A) Storage keys inventory

Source: `src/app/**` local/session storage usage.

#### LocalStorage keys

- `taskable:mode`
- `taskable:cloud-token`
- `taskable:cloud-refresh-token`
- `taskable:cloud-org-id`
- `taskable:cloud-user-id`
- `taskable:cloud-auto-sync`
- `taskable:tutorial:local-completed`
- `taskable:tutorial:cloud-completed:<userId>`
- `taskable-tasks`
- `taskable:app-theme`
- `taskable:notifications-enabled`
- `Tareva:notifications-enabled` (legacy read/remove)
- `taskable-custom-team-members`
- `taskable-removed-default-team-members`
- `taskable-workday`
- `taskable:user-preferences`
- `taskable:execution-mode:local`
- `taskable:execution-mode:cloud:<userId>`
- `taskable:telemetry-share:local`
- `taskable:telemetry-share:cloud:<userId>`
- `taskable:layoutV1:sidebarCollapsed`
- `taskable:layoutV1:sidebarCollapsed:cloud:<userId>`
- `taskable:ui-density:local`
- `taskable:ui-density:cloud:<userId>`
- `taskable:integration-prefs`
- `taskable:settings-drawer-open`
- `taskable:settings-active-section`
- `taskable:daily-planning-collapsed`
- `taskable:today-note:<day>`
- `taskable:duration-profile:v1:local`
- `taskable:duration-profile:v1:cloud:<userId>`
- `taskable:e2e-dnd`
- `taskable:telemetry:v1`
- `taskable:operational-telemetry`
- `taskable:task-telemetry`
- `taskable:pending-conflict-task-id`
- `taskable:admin-dashboard-v1`
- `taskable:layout-v1`
- `taskable:execution-mode-v1`
- `taskable:ui-system-v1`

#### SessionStorage keys

- `taskable:auto-start-fired`
- `taskable:now-snap:personal`
- `taskable:now-snap:team`

#### Browser event channels (non-storage but state-linked)

- `taskable:tasks-sync` (`BroadcastChannel`)
- `taskable:auth-storage-updated` (`window` event)
- `taskable:open-settings` (`window` event)

### B) Events inventory (telemetry / ops / SSE)

#### Client operational telemetry (`operationalTelemetry.ts`)

Common emitted events found in code:
- `sync.success`
- `sync.fail`
- `sync.conflict`
- `conflict_entered`
- `conflict_resolved`
- `sse.connected`
- `sse.reconnect`
- `outlook.import.success`
- `outlook.import.fail`
- `dnd.drop.performance`
- `dnd.resize.performance`

#### Client execution telemetry (`executionTelemetry.ts`)

- `task_started`
- `task_paused`
- `task_completed`
- `task_postponed`

#### Server operational/audit events (`server/src/index.js`)

- `email.verification.send`
- `email.verification.resend`
- `email.reset.send`
- `presence.lock_taken_over`
- `org.member_added`
- `org.member_role_updated`
- `org.member_removed`
- `task.created`
- `task.updated`
- `task.deleted`
- `task.conflict_detected`
- `task.conflict_resolved`
- `task.end_prompt_acknowledged`
- `task.imported`
- `task.created_from_email`
- plus custom ops events posted through `/api/ops/events`

#### SSE event names (`/api/orgs/:orgId/stream`)

- `connected`
- `task.changed`
- `tasks.synced`
- `member.changed`
- `presence.changed`
- `task.conflict.resolved`

### C) How to add a new feature safely

1. Add a feature flag first (env + query + persisted override if runtime rollout needed).
2. Implement behind the gate with default-off unless explicitly safe.
3. Add/adjust unit tests and at least one E2E regression touching the changed surface.
4. Validate planner invariants when relevant:
   - scroll ownership
   - drag/drop coordinate mapping
   - overlap/stack behavior
   - compact view clipping
5. Run gate commands (`typecheck`, `lint`, `format:check`, `test`, `test:e2e`).
6. Update this Atlas in the same change.

---

Generated from code and docs in:
- `app/src/app/*`
- `app/src/ui-system/*`
- `app/server/src/*`
- `app/desktop/*`
- `app/docs/*`
- `app/AppAuditStructure.md`
- `app/AppAuditReport.md`
