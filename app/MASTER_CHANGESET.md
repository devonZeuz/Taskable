# MASTER_CHANGESET

## 2026-02-27

- Created canonical app atlas:
  - `docs/TAREVA_APP_ATLAS.md`
- Atlas now serves as the single source of truth for:
  - route map
  - architecture/module ownership
  - feature flags and rollback levers
  - storage keys and telemetry events
  - backend endpoints and launch readiness checklist
- Updated cross-references:
  - `AppAuditStructure.md` now points to Atlas as canonical index
  - `AppAuditReport.md` now points to Atlas as canonical index

## 2026-02-27
- [QW-9] Add gitleaks to CI: Added a secret-scanning step to the quality workflow before build/test gates.

## 2026-02-27
- [T-02] Verify env tracking safety: Confirmed `.env` and `.env.e2e-cloud` are not git-tracked and documented env hygiene expectations.

## 2026-02-27
- [QW-3] Remove admin runtime overrides: Locked `resolveAdminDashboardFlag()` to env-only evaluation and removed query/localStorage override behavior.

## 2026-02-27
- [QW-4] Protect metrics endpoints: Added `requireMetricsToken` middleware for `/metrics/basic` and `/metrics/slo` with `METRICS_ACCESS_TOKEN` env contract.

## 2026-02-27
- [T-04] Complete admin flag hardening: Kept admin flag env-only and added startup cleanup to remove legacy `taskable:admin-dashboard-v1` localStorage state.

## 2026-02-27
- [QW-6] Require task version field: Made `Task.version` required and updated task creation/migration/test paths to provide numeric versions.

## 2026-02-27
- [T-09] Enforce version semantics in sync: Added runtime version guards in cloud sync and standardized `version: 0` for new local task creation paths.

## 2026-02-27
- [QW-5] Add emergency task list cap: Applied `LIMIT 2000` to `GET /api/orgs/:orgId/tasks` as a temporary safety cap before pagination.

## 2026-02-27
- [T-06] Add task list pagination contract: Implemented `limit/since` query support with incremental sync metadata and wired CloudSync pulls to use `since` after initial snapshots.

## 2026-02-27
- [T-03] Add production SQLite persistence guard: Backend now exits if `TASKABLE_DB_PATH` is unset in production, and `.env.example` documents persistent-disk usage.
