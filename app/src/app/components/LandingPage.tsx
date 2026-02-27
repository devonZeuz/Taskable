import { ArrowRight, Cloud, ShieldCheck, Sparkles, Target, TrendingUp } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { UISurface } from '../../ui-system';
import { useOnboarding } from '../context/OnboardingContext';
import { Button } from './ui/button';

function getTodayLabel() {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
}

export default function LandingPage() {
  const navigate = useNavigate();
  const { setMode, isCloudAuthenticated } = useOnboarding();
  const todayLabel = useMemo(() => getTodayLabel(), []);

  const startLocally = () => {
    setMode('local');
    navigate('/planner');
  };

  const useCloudWorkspace = () => {
    setMode('cloud');
    navigate(isCloudAuthenticated ? '/planner' : '/welcome');
  };

  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-[var(--board-bg)] text-[var(--board-text)]">
      <div className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col px-4 py-6 md:px-6 md:py-8">
        <header className="mb-8 flex items-center justify-between">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--hud-muted)]">
            Tareva
          </p>
          <p className="text-[12px] font-medium text-[var(--hud-muted)]">{todayLabel}</p>
        </header>

        <main className="flex flex-1 flex-col gap-5">
          <UISurface
            level="2"
            className="ui-v1-radius-xl border border-[color:var(--hud-border)] p-5 md:p-8"
            data-testid="landing-page"
          >
            <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
              <div className="space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--hud-muted)]">
                  Calm planning system
                </p>
                <h1 className="max-w-[780px] text-[clamp(34px,6vw,72px)] font-semibold leading-[0.9] tracking-[-0.04em]">
                  Plan less.
                  <br />
                  Execute better.
                </h1>
                <p className="max-w-[620px] text-sm leading-relaxed text-[var(--hud-muted)] md:text-base">
                  Tareva is a calm planning system for operators. Build a daily plan, run it with
                  live execution signals, and improve with drift-aware feedback.
                </p>
              </div>

              <div className="space-y-3">
                <Button
                  type="button"
                  onClick={startLocally}
                  data-testid="landing-start-local"
                  className="h-11 w-full justify-between ui-v1-radius-md border border-[color:var(--hud-border)] bg-[var(--hud-accent-bg)] px-4 text-[var(--hud-accent-text)] hover:brightness-95"
                >
                  Start locally
                  <ArrowRight className="size-4" />
                </Button>
                <Button
                  type="button"
                  onClick={useCloudWorkspace}
                  data-testid="landing-use-cloud"
                  className="h-11 w-full justify-between ui-v1-radius-md border border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-4 text-[var(--hud-text)] hover:bg-[var(--hud-surface-soft)]"
                >
                  Use cloud workspace
                  <Cloud className="size-4" />
                </Button>
                <p className="text-xs text-[var(--hud-muted)]">
                  Cloud mode adds account sync and team coordination. Local mode keeps data on this
                  device.
                </p>
              </div>
            </div>
          </UISurface>

          <section className="grid gap-4 md:grid-cols-3">
            <UISurface level="1" className="ui-v1-radius-lg p-4">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--hud-text)]">
                <Target className="size-4 text-[var(--hud-muted)]" />
                Plan
              </div>
              <p className="mt-2 text-sm text-[var(--hud-muted)]">
                Convert intent into a realistic day with inbox capture, clear slots, and workload
                visibility.
              </p>
            </UISurface>
            <UISurface level="1" className="ui-v1-radius-lg p-4">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--hud-text)]">
                <Sparkles className="size-4 text-[var(--hud-muted)]" />
                Execute
              </div>
              <p className="mt-2 text-sm text-[var(--hud-muted)]">
                Use run-state controls, now-line cues, and conflict-safe sync to stay in flow
                without losing control.
              </p>
            </UISurface>
            <UISurface level="1" className="ui-v1-radius-lg p-4">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--hud-text)]">
                <TrendingUp className="size-4 text-[var(--hud-muted)]" />
                Improve
              </div>
              <p className="mt-2 text-sm text-[var(--hud-muted)]">
                Track drift, adaptive duration corrections, and overload signals to improve weekly
                execution reliability.
              </p>
            </UISurface>
          </section>

          <UISurface level="1" className="ui-v1-radius-lg p-4 md:p-5">
            <div className="flex flex-wrap items-center gap-2 text-[12px] font-semibold text-[var(--hud-text)]">
              <ShieldCheck className="size-4 text-[var(--hud-muted)]" />
              Reliability proof
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="ui-v1-radius-sm border border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] px-3 py-2">
                <p className="text-xs font-semibold text-[var(--hud-text)]">
                  Local-first by default
                </p>
                <p className="mt-1 text-xs text-[var(--hud-muted)]">
                  Tasks stay available offline and can run fully local without cloud endpoints.
                </p>
              </div>
              <div className="ui-v1-radius-sm border border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] px-3 py-2">
                <p className="text-xs font-semibold text-[var(--hud-text)]">Conflict-safe cloud</p>
                <p className="mt-1 text-xs text-[var(--hud-muted)]">
                  Versioned task writes, lock-aware editing, and explicit conflict resolution keep
                  team edits safe.
                </p>
              </div>
              <div className="ui-v1-radius-sm border border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] px-3 py-2">
                <p className="text-xs font-semibold text-[var(--hud-text)]">Audit-gated shipping</p>
                <p className="mt-1 text-xs text-[var(--hud-muted)]">
                  Type, lint, unit, and E2E suites are required before release and tracked in audit
                  reports.
                </p>
              </div>
            </div>
          </UISurface>
        </main>
      </div>
    </div>
  );
}
