import { useCallback, useEffect, useState } from 'react';
import { UICluster, UISurface, UIStack } from '../../../ui-system';
import { getAdminSyncHealth, type AdminSyncHealthResponse } from '../../services/adminApi';
import type { AdminPanelBaseProps } from './types';

function toPercent(value: number): string {
  return `${Math.round((Number.isFinite(value) ? value : 0) * 100)}%`;
}

export default function AdminSyncHealthPanel({ token, orgId, onError }: AdminPanelBaseProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AdminSyncHealthResponse | null>(null);

  const fetchSyncHealth = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await getAdminSyncHealth(token, { orgId });
      setData(payload);
    } catch (error) {
      onError(error, 'Failed to load sync health.');
    } finally {
      setLoading(false);
    }
  }, [onError, orgId, token]);

  useEffect(() => {
    void fetchSyncHealth();
  }, [fetchSyncHealth]);

  if (loading) {
    return (
      <UISurface level="2" className="rounded-xl border border-[color:var(--hud-border)] p-4">
        <p className="text-sm text-[color:var(--hud-muted)]">Loading sync health…</p>
      </UISurface>
    );
  }

  if (!data) {
    return (
      <UISurface level="2" className="rounded-xl border border-[color:var(--hud-border)] p-4">
        <p className="text-sm text-[color:var(--hud-muted)]">Sync health data unavailable.</p>
      </UISurface>
    );
  }

  return (
    <UIStack gap="4" data-testid="admin-sync-health-panel">
      <div className="grid gap-3 md:grid-cols-3">
        <UISurface level="2" className="rounded-xl border border-[color:var(--hud-border)] p-4">
          <p className="text-xs uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
            Sync errors (24h)
          </p>
          <p className="mt-2 text-2xl font-semibold">{data.syncErrors.last24h}</p>
        </UISurface>
        <UISurface level="2" className="rounded-xl border border-[color:var(--hud-border)] p-4">
          <p className="text-xs uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
            Sync errors (7d)
          </p>
          <p className="mt-2 text-2xl font-semibold">{data.syncErrors.last7d}</p>
        </UISurface>
        <UISurface level="2" className="rounded-xl border border-[color:var(--hud-border)] p-4">
          <p className="text-xs uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
            SSE connected ratio
          </p>
          <p className="mt-2 text-2xl font-semibold">{toPercent(data.sseConnectedRatio)}</p>
        </UISurface>
      </div>

      <UISurface level="2" className="rounded-xl border border-[color:var(--hud-border)] p-4">
        <UICluster className="items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
            Alerts ({data.windowMinutes}m window)
          </p>
          <p className="text-xs text-[color:var(--hud-muted)]">{data.generatedAt}</p>
        </UICluster>
        {data.alerts.length === 0 ? (
          <p className="mt-3 text-sm text-[color:var(--hud-muted)]">No active alerts.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {data.alerts.map((alert) => (
              <div
                key={`${alert.code}-${alert.windowMinutes ?? ''}`}
                className="rounded-lg border border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] px-3 py-2 text-sm"
              >
                <p className="font-semibold text-[color:var(--hud-text)]">{alert.code}</p>
                <p className="text-[color:var(--hud-muted)]">{alert.message}</p>
              </div>
            ))}
          </div>
        )}
      </UISurface>
    </UIStack>
  );
}
