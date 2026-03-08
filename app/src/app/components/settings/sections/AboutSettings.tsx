import { useMemo } from 'react';
import { useLocation } from 'react-router';
import { toast } from 'sonner';
import { useCloudSync } from '../../../context/CloudSyncContext';
import { useUserPreferences } from '../../../context/UserPreferencesContext';
import { getProductAnalyticsSummary } from '../../../services/productAnalytics';
import { Button } from '../../ui/button';

function formatPercent(value: number | null): string {
  if (value === null) return 'n/a';
  return `${value}%`;
}

export default function AboutSettings() {
  const location = useLocation();
  const { token, activeOrgId, realtimeState } = useCloudSync();
  const {
    preferences: { timezone, slotMinutes, recallDays },
  } = useUserPreferences();

  const diagnostics = useMemo(
    () => ({
      appVersion: import.meta.env.VITE_APP_VERSION ?? 'dev',
      route: location.pathname,
      timezone,
      slotMinutes,
      recallDays,
      cloudConnected: Boolean(token),
      activeOrgId: activeOrgId ?? null,
      realtimeState,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      timestamp: new Date().toISOString(),
    }),
    [activeOrgId, location.pathname, recallDays, realtimeState, slotMinutes, timezone, token]
  );
  const productAnalytics = getProductAnalyticsSummary();
  const buildLabel = diagnostics.appVersion === 'dev' ? 'Development build' : diagnostics.appVersion;

  const copyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      toast.success('Diagnostics copied to clipboard.');
    } catch {
      toast.error('Unable to copy diagnostics.');
    }
  };

  return (
    <div className="space-y-4">
      <section className="ui-hud-section ui-v1-radius-md p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
          Build
        </p>
        <p className="mt-2 text-sm text-[color:var(--hud-text)]">
          Version:{' '}
          <span className="font-semibold text-[color:var(--hud-text)]">
            {buildLabel}
          </span>
        </p>
        <p className="mt-1 text-xs text-[color:var(--hud-muted)]">
          Build and environment details are available here for support and troubleshooting.
        </p>
      </section>

      <section className="ui-hud-section ui-v1-radius-md p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
          Product Analytics
        </p>
        <p className="mt-2 text-xs leading-relaxed text-[color:var(--hud-muted)]">
          Lightweight local funnel metrics for launch validation. These numbers are intended to
          answer whether users reach activation, not to replace a full analytics pipeline.
        </p>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="ui-hud-row ui-v1-radius-sm p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
              Activation
            </p>
            <div className="mt-2 space-y-1 text-[12px] text-[color:var(--hud-muted)]">
              <p>Landing views: {productAnalytics.counts.landingViews}</p>
              <p>Local starts: {productAnalytics.counts.localStarts}</p>
              <p>Sign up clicks: {productAnalytics.counts.signUpClicks}</p>
              <p>Tutorial completions: {productAnalytics.counts.tutorialCompletions}</p>
              <p>First task activations: {productAnalytics.counts.firstTaskActivations}</p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-[color:var(--hud-muted)]">
              <div className="rounded border border-[color:var(--hud-border)] px-2 py-2">
                Local start rate
                <div className="mt-1 text-[14px] font-semibold text-[color:var(--hud-text)]">
                  {formatPercent(productAnalytics.activation.localStartRatePercent)}
                </div>
              </div>
              <div className="rounded border border-[color:var(--hud-border)] px-2 py-2">
                First task rate
                <div className="mt-1 text-[14px] font-semibold text-[color:var(--hud-text)]">
                  {formatPercent(productAnalytics.activation.firstTaskActivationRatePercent)}
                </div>
              </div>
            </div>
          </div>

          <div className="ui-hud-row ui-v1-radius-sm p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
              Retention
            </p>
            <div className="mt-2 space-y-1 text-[12px] text-[color:var(--hud-muted)]">
              <p>Planner days last 7: {productAnalytics.retention.plannerDaysLast7}</p>
              <p>Planner days last 30: {productAnalytics.retention.plannerDaysLast30}</p>
              <p>Active days last 7: {productAnalytics.retention.activeDaysLast7}</p>
              <p>Active days last 30: {productAnalytics.retention.activeDaysLast30}</p>
              <p>Last active: {productAnalytics.retention.lastActiveAt ?? 'n/a'}</p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[color:var(--hud-muted)]">
              <span className="rounded-full border border-[color:var(--hud-border)] px-2 py-1">
                Demo views: {productAnalytics.counts.demoViews}
              </span>
              <span className="rounded-full border border-[color:var(--hud-border)] px-2 py-1">
                Security views: {productAnalytics.counts.securityViews}
              </span>
              <span className="rounded-full border border-[color:var(--hud-border)] px-2 py-1">
                Support views: {productAnalytics.counts.supportViews}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="ui-hud-section ui-v1-radius-md p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
            Support Details
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => void copyDiagnostics()}>
            Copy support details
          </Button>
        </div>
        <pre className="mt-3 max-h-[300px] overflow-auto ui-hud-row ui-v1-radius-sm p-3 text-[11px] text-[color:var(--hud-muted)]">
          {JSON.stringify(diagnostics, null, 2)}
        </pre>
      </section>
    </div>
  );
}
