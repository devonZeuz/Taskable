# AppAuditReport (P1 Hardening Sprint)

Last updated: 2026-02-21 (timeline snap + sticky day-labels + tutorial/auth hardening)
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

## Onboarding UI Polish + Auth Login Reliability Update (2026-02-21)

### What changed

1. Auth pages UI composition was refined:
   - kept only the auth form section inside the boxed HUD shell
   - moved surrounding narrative/branding copy to the page background surface
   - removed extra welcome chip/pill decoration
   - increased hero hierarchy (`Taskable` scales larger than “Welcome to”) and right-aligned hero layout
2. Auth credential reliability was fixed in backend lookup logic:
   - server now performs case-insensitive email matching (`lower(email) = lower(?)`) in register duplicate check, login, Microsoft exchange lookup, resend verification, password reset request, and member invite lookup
   - resolves production symptom where signup succeeded but subsequent login with casing variation returned “invalid credentials”

### New/updated tests

1. `tests/e2e/planner-cloud-sync.spec.ts`
   - added `supports re-login after signup with case-insensitive email lookup`

### Gate status

- The latest full gate run remains green:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run format:check`
  - `npm run test`
  - `npm run test:e2e`
  - `npm run test:e2e:cloud`
  - `npm run build`
  - `npm run perf:check`

## Dev Entry + Package Naming Update (2026-02-21)

### What changed

1. Removed Figma package label from script output:
   - renamed root package from `@figma/my-make-file` to `taskable-app` in `package.json` and `package-lock.json`.
2. Improved local onboarding test loop at root route:
   - in local `DEV` on loopback hosts, `/` now defaults to `/welcome` (faster onboarding/auth QA without clearing storage each run).
   - remembered-mode behavior can still be tested by visiting `/?persistMode=1`.
   - explicit onboarding route forcing remains available with `/?welcome=1`.
3. Updated docs:
   - `README.md` now documents this local dev routing behavior and override.

### Tests

- No new tests were required for this small routing/metadata patch.

## Tutorial Modal + Production Seed Hardening Update (2026-02-21)

### What changed

1. Added first-run onboarding tutorial modal:
   - new `src/app/components/onboarding/OnboardingTutorialModal.tsx` with 5-7 slides, icons, progress dots, and Back/Next/Skip/Finish controls.
   - integrated into planner shell via `Root` so planner still loads first, then tutorial overlays (non-blocking route load).
2. Trigger and persistence behavior:
   - appears after signup and first cloud login when not completed.
   - appears on first local planner entry only.
   - local completion persisted in `taskable:tutorial:local-completed`.
   - cloud completion persisted per account in `taskable:tutorial:cloud-completed:{userId}`.
   - cloud user identity persistence added with `taskable:cloud-user-id`.
3. Production seeding policy hardened:
   - `TaskContext.loadDemoData` now no-ops unless `import.meta.env.DEV` is true.
   - no automatic sample/demo seeding in production startup path.
   - demo tasks remain explicit dev-only action.
4. Invalid credential reliability hardening:
   - server email schemas now normalize with `trim().toLowerCase().email()`.
   - login-adjacent DB lookups now use `lower(trim(email)) = lower(trim(?))` to avoid whitespace/casing mismatch regressions.

### New/updated tests

1. `tests/e2e/onboarding-auth.spec.ts`
   - local mode first entry shows tutorial; Skip suppresses it on reload.
   - signup lands in planner with empty cloud state and tutorial overlay.
   - first cloud login shows tutorial when incomplete.
   - local mode asserts no cloud task pull requests are made.
2. `tests/e2e/planner-cloud-sync.spec.ts`
   - updated re-login regression now validates case-insensitive + whitespace-trimmed email input.

### Validation run

- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `npm run test`: PASS
- `npm run format:check`: PASS
- `npx playwright test tests/e2e/onboarding-auth.spec.ts`: PASS
- `npx playwright test --config=playwright.cloud.config.ts -g "case-insensitive"`: PASS

## Planner Time-Axis Snap + Sticky Day Labels Update (2026-02-21)

### What changed

1. Soft snap to current time (Personal + Team):
   - added route-level `scrollToNow({ behavior: 'auto' | 'smooth' })` centered horizontal alignment.
   - conversion uses active timezone minutes-since-midnight + existing timeline scale.
   - clamped within `scrollLeft` bounds.
2. Auto-run policy:
   - auto snap runs once per route/session using sessionStorage keys (`taskable:now-snap:personal`, `taskable:now-snap:team`).
   - guarded by: today in rendered range, no user scroll intent yet.
3. New controls:
   - `Jump to now` button in planner HUD for both views.
   - small `Now` pill inside time-axis header for both views.
4. Frozen day labels panel:
   - left day-label cells are now sticky (`left: 0`) with elevated z-index and solid board-token background.
   - header left cell also sticky to keep alignment while timeline scrolls horizontally.
5. Reusable helper module:
   - added `src/app/services/timeAxisNow.ts` for timezone conversion, now-X mapping, and centered scroll math.

### New/updated tests

1. Added `tests/e2e/planner-now-snap.spec.ts`:
   - forced-time load asserts initial horizontal now snap (`scrollLeft > 0`) and now-indicator visibility in viewport.
   - horizontal scroll keeps day labels pinned near left edge and verifies deterministic drag still works.
2. Added `data-testid="timeline-now-indicator"` in `DayColumn` for deterministic viewport assertion.

### Validation run

- `npm run format:check`: PASS
- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `npx playwright test tests/e2e/planner-now-snap.spec.ts`: PASS
- `npm run test:e2e`: PARTIAL PASS
  - 33 passed, 1 skipped, 2 existing failures in `tests/e2e/planner-desktop-wheel.spec.ts` (`preventDefault` expectation mismatch), unrelated to this feature patch.
