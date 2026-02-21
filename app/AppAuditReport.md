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
