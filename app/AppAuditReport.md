# AppAuditReport (P1 Hardening Sprint)

Last updated: 2026-02-21
Target: V1 release readiness (web + desktop shell)
Scope: P1 hardening only, preserving planner behavior and scroll ownership

## Executive status

P1 hardening sprint is complete and all required gates are green.

## P1 changes implemented

### 1. Server security headers + CSP + CORS tightening

- Added Helmet middleware in `server/src/index.js`.
- Added production CSP suitable for SPA/API usage:
  - `default-src 'self'`
  - `script-src 'self'` (dev-only eval allowance outside production)
  - `style-src 'self' 'unsafe-inline'`
  - `img-src 'self' data:`
  - `connect-src` scoped to `self` + configured allowed origins (plus ws/wss variants)
- Added explicit:
  - `Permissions-Policy`
  - `Referrer-Policy`
- Tightened CORS to env-driven allow-list via `CORS_ALLOWED_ORIGINS` (loopback-only relaxation in non-production).
- Updated server docs in `server/README.md`.

### 2. Electron security enforcement + checklist

- Enforced BrowserWindow security defaults in `desktop/main.cjs`:
  - `contextIsolation: true`
  - `nodeIntegration: false`
  - `webSecurity: true`
  - `sandbox: true`
- Blocked external navigation:
  - `will-navigate` origin guard
  - `setWindowOpenHandler` deny-by-default
  - `will-attach-webview` blocked
- IPC remains allowlist-only through preload bridge.
- Added `desktop/DESKTOP_SECURITY.md` and linked it from `desktop/README.md`.

### 3. Conflict UX operator-proofing

- Expanded conflict lock coverage to remaining mutation surfaces in `src/app/context/NotificationSettingsContext.tsx` (end-prompt actions now hard-stop and route to resolver).
- Added persistent planner conflict banner with single resolver action:
  - `src/app/components/ConflictResolutionBanner.tsx`
  - integrated into `PersonalView` and `TeamView`.
- Conflict telemetry (`conflict_entered`, `conflict_resolved` with duration/strategy metadata) remains active in `CloudSyncContext`.

### 4. Desktop packaging metadata/icon polish

- Updated `desktop/electron-builder.yml` for consistent packaging metadata:
  - `appId`
  - `productName`
  - `buildVersion`
  - `publisherName`
  - icon paths aligned for tray/installer artifacts.

### 5. Compact token alignment (no behavior changes)

- Updated `src/app/components/CompactView.tsx` to align compact spacing/typography marker classes with board token scale.
- Kept compact behavior unchanged (2-day desktop compact behavior and routing unchanged).

## New/updated tests

1. `tests/server/security-headers.test.ts`
   - validates production security headers/CSP and CORS allow-list behavior.
2. `tests/e2e/planner-compact.spec.ts`
   - adds deterministic compact style assertion for token spacing/typography marker classes.

## Required gate results

1. `npm run typecheck`: PASS
2. `npm run lint`: PASS
3. `npm run format:check`: PASS
4. `npm run test`: PASS (13 files, 44 tests)
5. `npm run test:e2e`: PASS (27 tests)
6. `npm run test:e2e:cloud`: PASS (3 tests)
7. `npm run build`: PASS
8. `npm run perf:check`: PASS

## Remaining findings after P1

1. CSP is now enforced, but future tightening of inline styles (hash/nonce strategy) remains open.
2. Desktop security defaults are enforced, but production distribution hardening (code signing/update trust chain) is still pending.
3. Conflict resolution is still single-task focused under heavy conflict bursts (batch conflict UX remains open).
4. Dependency advisory debt remains (`npm audit` moderate issue path).

## Onboarding/Auth Gating Update (Beta onboarding fix)

### What changed

1. Added onboarding/auth route surface:
   - `/welcome` (default landing)
   - `/login`
   - `/signup`
   - `/verify`
   - `/forgot`
   - `/reset`
2. Added app entry gating:
   - `/` now routes through auth-aware entry logic.
   - If mode is unset: redirect to `/welcome`.
   - If mode is `local`: redirect to `/planner`.
   - If mode is `cloud` with token: redirect to `/planner`.
3. Added planner route split:
   - planner surfaces now mount from `/planner`, `/team`, `/compact`.
   - `Root` keeps planner-only provider stack + auth gate.
4. Added mode persistence:
   - onboarding choice stored in `taskable:mode` (`local` | `cloud`).
   - cloud session keys remain in `taskable:cloud-*`.
5. Disabled automatic demo seeding:
   - fresh storage starts with empty planner state.
   - dev-only explicit `Load demo data` action added in planner shell.
6. Cloud/local runtime behavior hardened:
   - local mode performs no cloud sync network polling.
   - cloud mode requires auth token before planner access.
   - authenticated cloud planner runs API reachability guard; hard failures render branded error UI.

### New/updated tests

1. Added `tests/e2e/onboarding-auth.spec.ts`:
   - fresh `/` -> `/welcome`
   - continue local -> `/planner` with empty state
   - signup route reachable from welcome
   - cloud API failure in planner -> branded error UI
2. Updated e2e bootstrap/routing in:
   - `tests/e2e/planner.spec.ts`
   - `tests/e2e/planner-dnd.spec.ts`
   - `tests/e2e/planner-compact.spec.ts`
   - `tests/e2e/planner-desktop-wheel.spec.ts`
   - `tests/e2e/planner-layout-regression.spec.ts`
   - `tests/e2e/route-error-boundary.spec.ts`
   - `tests/e2e/settings-integrations.spec.ts`
   - `tests/e2e/theme-sync.spec.ts`
   - `tests/e2e/planner-cloud-sync.spec.ts`
   - plus new helper `tests/e2e/storageBootstrap.ts`.

### Gate results after onboarding/auth update

1. `npm run typecheck`: PASS
2. `npm run lint`: PASS
3. `npm run format:check`: PASS
4. `npm run test`: PASS
5. `npm run test:e2e`: PASS
6. `npm run test:e2e:cloud`: PASS
7. `npm run build`: PASS
8. `npm run perf:check`: PASS
