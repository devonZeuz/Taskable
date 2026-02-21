# Taskable Audit Log

## 2026-02-20 Desktop UX Defects

### Reported by user

- Desktop full view vertical scroll still blocked.
- Cloud login/integration changes require refresh to appear.
- Snap/haptic sound works on web but not desktop.

### Findings

- Timeline header wheel remap could still capture mixed desktop wheel gestures.
- Cloud/session state relied on initial localStorage load and did not subscribe to cross-window `storage` updates.
- Snap sound had no fallback when Chromium rejects `HTMLAudioElement.play()` in desktop runtime.

### Fixes applied

- Added desktop capture-phase wheel handler for full views (Personal + Team) to force vertical board ownership from `deltaY` or axis-flipped `deltaX`.
- Relaxed desktop header wheel remap guard so any non-trivial vertical delta remains native to board scroll.
- Added `storage` listeners in cloud context to sync token/refresh token/org/auto-sync changes without manual refresh.
- Added audio fallback tone in `uiSounds` when `audio.play()` fails and installed one-time interaction unlock listeners for desktop autoplay policy behavior.

### Files touched

- `src/app/components/PersonalView.tsx`
- `src/app/components/TeamView.tsx`
- `src/app/context/CloudSyncContext.tsx`
- `src/app/services/uiSounds.ts`

### Validation executed

- Typecheck: `npm run typecheck`
- E2E: `tests/e2e/planner-desktop-wheel.spec.ts`
- E2E: `tests/e2e/theme-sync.spec.ts`
- E2E: `tests/e2e/settings-integrations.spec.ts`
- Regression E2E: `tests/e2e/planner-compact.spec.ts`
- Regression E2E: `tests/e2e/planner.spec.ts`

### Notes

- If desktop still fails on a specific device driver, next diagnostic step is to log raw wheel deltas from the Electron renderer to isolate vendor-specific axis behavior.
