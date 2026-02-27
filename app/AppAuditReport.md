# AppAuditReport

Last updated: February 25, 2026

## Canonical Index

- Primary app-wide audit and architecture index now lives at:
  - `docs/TAREVA_APP_ATLAS.md`
- This report is retained as a historical change report for the density/welcome pass.
- If content here conflicts with Atlas, follow Atlas.

## Density + Welcome Pass

### Scope completed

- Replaced unsafe global scale path with UI density presets.
- Added compact/comfortable density preference and persistence.
- Updated planner surfaces to consume density through tokens/wrapper classes.
- Redesigned `/welcome` to match current calm premium style with a full planner snapshot preview.
- Removed “Execution Planner” language from landing/welcome.
- Applied welcome polish pass:
  - fixed preview card clipping/geometry
  - anchored `Start` chips within cards
  - added bounded title/content/footer card layout to prevent text overlap
  - randomized preview task colors using theme swatches with contrast-safe text/chip rendering
  - added CTA accent-hover feedback
  - added sheen effect on `Execute`
  - enlarged local-mode helper text
  - reduced overall welcome visual density via layout sizing (no zoom/transform)

### Key implementation changes

- `src/ui-system/styles/tokens.css`
  - introduced scaling variables:
    - `--ui-font-scale`
    - `--ui-space-scale`
    - `--ui-control-scale`
  - tokenized spacing/font sizes now derive from scale variables.
- `src/styles/theme.css`
  - removed `--ui-scale` and `.app-scale` zoom CSS.
  - added shell density contracts on `[data-testid="app-shell"][data-density=...]`.
  - added compact planner overrides for top rail, day labels/rows, sidebar sizing, and task card density classes.
- `src/app/context/UserPreferencesContext.tsx`
  - `uiDensity` preference integrated with scoped local/cloud persistence and storage sync.
- `src/app/components/settings/sections/GeneralSettings.tsx`
  - new segmented control for `UI density` (`Comfortable` / `Compact`).
- `src/app/components/PersonalView.tsx`, `src/app/components/TeamView.tsx`
  - added planner density class hooks and sidebar collapse attributes for density overrides.
- `src/app/components/TaskCard.tsx`
  - compact density now reduces card padding and dynamic text sizing.
- `src/app/components/PlannerTopRail.tsx`
  - added density control classes for compact-size controls.
- `src/app/components/auth/WelcomeView.tsx`
  - rebuilt welcome surface with calm hero + planner snapshot and friendly placeholder tasks.
- `src/app/components/LandingPage.tsx`
  - replaced legacy “Execution Planner” eyebrow copy.

### Tests added/updated

- Added `tests/e2e/ui-density-compact.spec.ts`
- Added `tests/e2e/welcome.spec.ts`
- Updated `tests/e2e/planner-hud-viewport.spec.ts`
- Updated `tests/e2e/landing.spec.ts`
- Updated `tests/e2e/storageBootstrap.ts` helper for density seeding
- Verified local empty-launch behavior:
  - `tests/e2e/onboarding-auth.spec.ts` (`continue locally enters planner with empty state`)

### Behavioral risk review

- Planner scheduling logic: unchanged.
- Drag/drop coordinate math: unchanged.
- Scroll ownership: unchanged (`.board-scroll` remains vertical owner).
- Wheel interception policy: unchanged.
- Main risk area: compact density CSS overrides; mitigated with viewport/no-overflow and row-height regression tests.

### Gate status

- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `npm run format:check`: PASS
- `npm run test`: PASS
- `npm run test:e2e`: PASS (59 passed, 1 skipped)

## QW-9 pass
- Completed: 2026-02-27
- Gate: npm run typecheck: PASS
- Gate: npm run lint: PASS
- Gate: npm run test: PASS
- Gate: npm run test:e2e: PENDING (phase-end gate)

## T-02 pass
- Completed: 2026-02-27
- Gate: npm run typecheck: PASS
- Gate: npm run lint: PASS
- Gate: npm run test: PASS
- Gate: npm run test:e2e: PENDING (phase-end gate)

## QW-3 pass
- Completed: 2026-02-27
- Gate: npm run typecheck: PASS
- Gate: npm run lint: PASS
- Gate: npm run test: PASS
- Gate: npm run test:e2e: PENDING (phase-end gate)

## QW-4 pass
- Completed: 2026-02-27
- Gate: npm run typecheck: PASS
- Gate: npm run lint: PASS
- Gate: npm run test: PASS
- Gate: npm run test:e2e: PENDING (phase-end gate)

## T-04 pass
- Completed: 2026-02-27
- Gate: npm run typecheck: PASS
- Gate: npm run lint: PASS
- Gate: npm run test: PASS
- Gate: npm run test:e2e: PENDING (phase-end gate)

## Phase 1 final gate
- Completed: 2026-02-27
- Gate: npm run test:e2e: PASS (60 passed, 1 skipped)

## QW-6 pass
- Completed: 2026-02-27
- Gate: npm run typecheck: PASS
- Gate: npm run lint: PASS
- Gate: npm run test: PASS
- Gate: npm run test:e2e: PENDING (phase-end gate)

## T-09 pass
- Completed: 2026-02-27
- Gate: npm run typecheck: PASS
- Gate: npm run lint: PASS
- Gate: npm run test: PASS
- Gate: npm run test:e2e: PENDING (phase-end gate)

## QW-5 pass
- Completed: 2026-02-27
- Gate: npm run typecheck: PASS
- Gate: npm run lint: PASS
- Gate: npm run test: PASS
- Gate: npm run test:e2e: PENDING (phase-end gate)

## T-06 pass
- Completed: 2026-02-27
- Gate: npm run typecheck: PASS
- Gate: npm run lint: PASS
- Gate: npm run test: PASS
- Gate: npm run test:e2e: PENDING (phase-end gate)

## T-03 pass
- Completed: 2026-02-27
- Gate: npm run typecheck: PASS
- Gate: npm run lint: PASS
- Gate: npm run test: PASS
- Gate: npm run test:e2e: PENDING (phase-end gate)
