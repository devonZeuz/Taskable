import { useMemo } from 'react';
import { useLocation } from 'react-router';
import { toast } from 'sonner';
import { useCloudSync } from '../../../context/CloudSyncContext';
import { useUserPreferences } from '../../../context/UserPreferencesContext';
import { Button } from '../../ui/button';

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
      <section className="ui-hud-section rounded-[14px] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
          Build
        </p>
        <p className="mt-2 text-sm text-[color:var(--hud-text)]">
          Version:{' '}
          <span className="font-semibold text-[color:var(--hud-text)]">
            {diagnostics.appVersion}
          </span>
        </p>
        <p className="mt-1 text-xs text-[color:var(--hud-muted)]">
          Changelog and release publishing flow are currently WIP.
        </p>
      </section>

      <section className="ui-hud-section rounded-[14px] p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
            Diagnostics
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => void copyDiagnostics()}>
            Copy debug info
          </Button>
        </div>
        <pre className="mt-3 max-h-[300px] overflow-auto ui-hud-row rounded-[10px] p-3 text-[11px] text-[color:var(--hud-muted)]">
          {JSON.stringify(diagnostics, null, 2)}
        </pre>
      </section>
    </div>
  );
}
