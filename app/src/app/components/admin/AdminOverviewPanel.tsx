import { useCallback, useEffect, useState } from 'react';
import { UICluster, UISurface, UIStack } from '../../../ui-system';
import { getAdminOverview, type AdminOverviewResponse } from '../../services/adminApi';
import type { AdminPanelBaseProps } from './types';

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '0m';
  const totalMinutes = Math.floor(durationMs / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

interface SummaryCardProps {
  title: string;
  value: string | number;
  hint?: string;
  testId?: string;
}

function SummaryCard({ title, value, hint, testId }: SummaryCardProps) {
  return (
    <UISurface
      level="2"
      className="rounded-xl border border-[color:var(--hud-border)] p-4"
      data-testid={testId}
    >
      <p className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
        {title}
      </p>
      <p className="mt-2 text-xl font-semibold text-[color:var(--hud-text)]">{value}</p>
      {hint ? <p className="mt-1 text-xs text-[color:var(--hud-muted)]">{hint}</p> : null}
    </UISurface>
  );
}

export default function AdminOverviewPanel({ token, orgId, onError }: AdminPanelBaseProps) {
  const [data, setData] = useState<AdminOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await getAdminOverview(token, { orgId });
      setData(payload);
    } catch (error) {
      onError(error, 'Failed to load admin overview.');
    } finally {
      setLoading(false);
    }
  }, [onError, orgId, token]);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  if (loading) {
    return (
      <UISurface level="2" className="rounded-xl border border-[color:var(--hud-border)] p-4">
        <p className="text-sm text-[color:var(--hud-muted)]">Loading overview…</p>
      </UISurface>
    );
  }

  if (!data) {
    return (
      <UISurface level="2" className="rounded-xl border border-[color:var(--hud-border)] p-4">
        <p className="text-sm text-[color:var(--hud-muted)]">Overview data unavailable.</p>
      </UISurface>
    );
  }

  const syncErrorRate = `${Math.round((data.syncSummary.sync.errorRate ?? 0) * 100)}%`;
  const sseRatio = `${Math.round((data.syncSummary.realtime.sseConnectedRatio ?? 0) * 100)}%`;

  return (
    <UIStack gap="4" data-testid="admin-overview-panel">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="Users"
          value={data.usersSummary.totalUsers}
          hint={`${data.usersSummary.verifiedCount} verified`}
          testId="admin-overview-users"
        />
        <SummaryCard
          title="Workspaces"
          value={data.orgsSummary.totalOrgs}
          hint={`${data.orgsSummary.totalMembers} members`}
          testId="admin-overview-orgs"
        />
        <SummaryCard
          title="Unresolved Conflicts (7d)"
          value={data.conflictsSummary.unresolvedCountLast7d}
          hint={`Longest open: ${formatDuration(data.conflictsSummary.longestUnresolvedDurationMs)}`}
          testId="admin-overview-conflicts"
        />
        <SummaryCard
          title="Sync Error Rate"
          value={syncErrorRate}
          hint={`SSE connected ratio: ${sseRatio}`}
          testId="admin-overview-sync"
        />
      </div>

      <UISurface level="2" className="rounded-xl border border-[color:var(--hud-border)] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
          Top Conflict Workspaces
        </p>
        {data.conflictsSummary.topOrgsByConflicts.length === 0 ? (
          <p className="mt-2 text-sm text-[color:var(--hud-muted)]">No conflict events recorded.</p>
        ) : (
          <UICluster className="mt-3 flex-wrap" gap="2">
            {data.conflictsSummary.topOrgsByConflicts.map((item) => (
              <span
                key={`${item.orgId}-${item.count}`}
                className="rounded-full border border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] px-3 py-1 text-xs text-[color:var(--hud-text)]"
              >
                {item.orgName}: {item.count}
              </span>
            ))}
          </UICluster>
        )}
      </UISurface>
    </UIStack>
  );
}
