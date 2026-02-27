import { useCallback, useEffect, useMemo, useState } from 'react';
import { UIActionButton, UICluster, UISurface, UIStack } from '../../../ui-system';
import { getAdminConflicts, type AdminConflictsResponse } from '../../services/adminApi';
import type { AdminPanelBaseProps } from './types';

const PAGE_SIZE = 25;

function formatDate(value: string | null): string {
  if (!value) return 'n/a';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '0m';
  const totalMinutes = Math.floor(durationMs / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

export default function AdminConflictsPanel({ token, orgId, onError }: AdminPanelBaseProps) {
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'unresolved' | 'all'>('unresolved');
  const [data, setData] = useState<AdminConflictsResponse | null>(null);

  const canPageForward = useMemo(() => {
    if (!data) return false;
    return data.offset + data.conflicts.length < data.total;
  }, [data]);

  const fetchConflicts = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await getAdminConflicts(token, {
        orgId,
        status: statusFilter,
        limit: PAGE_SIZE,
        offset,
      });
      setData(payload);
    } catch (error) {
      onError(error, 'Failed to load admin conflicts.');
    } finally {
      setLoading(false);
    }
  }, [offset, onError, orgId, statusFilter, token]);

  useEffect(() => {
    void fetchConflicts();
  }, [fetchConflicts]);

  return (
    <UIStack gap="4" data-testid="admin-conflicts-panel">
      <UISurface level="2" className="rounded-xl border border-[color:var(--hud-border)] p-4">
        <UICluster className="items-center justify-between">
          <p className="text-sm text-[color:var(--hud-muted)]">
            Review unresolved conflicts and verify resolution strategy quality.
          </p>
          <label className="flex items-center gap-2 text-xs text-[color:var(--hud-muted)]">
            Status
            <select
              data-testid="admin-conflicts-status"
              className="h-8 ui-v1-radius-sm border border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] px-2 text-[color:var(--hud-text)]"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value === 'all' ? 'all' : 'unresolved');
                setOffset(0);
              }}
            >
              <option value="unresolved">Unresolved</option>
              <option value="all">All</option>
            </select>
          </label>
        </UICluster>
      </UISurface>

      <UISurface
        level="2"
        className="overflow-hidden rounded-xl border border-[color:var(--hud-border)]"
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--hud-surface-soft)] text-[color:var(--hud-muted)]">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Task</th>
                <th className="px-3 py-2 text-left font-semibold">Workspace</th>
                <th className="px-3 py-2 text-left font-semibold">Entered</th>
                <th className="px-3 py-2 text-left font-semibold">Resolved</th>
                <th className="px-3 py-2 text-left font-semibold">Duration</th>
                <th className="px-3 py-2 text-left font-semibold">Strategy</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-3 py-4 text-[color:var(--hud-muted)]" colSpan={6}>
                    Loading conflicts…
                  </td>
                </tr>
              ) : data && data.conflicts.length > 0 ? (
                data.conflicts.map((conflict) => (
                  <tr
                    key={`${conflict.orgId}-${conflict.taskId}-${conflict.enteredAt}`}
                    className="border-t border-[color:var(--hud-border)] text-[color:var(--hud-text)]"
                  >
                    <td className="px-3 py-2">
                      <div className="min-w-[180px]">
                        <p className="font-semibold">{conflict.title ?? conflict.taskId}</p>
                        <p className="text-xs text-[color:var(--hud-muted)]">{conflict.taskId}</p>
                      </div>
                    </td>
                    <td className="px-3 py-2">{conflict.orgId}</td>
                    <td className="px-3 py-2">{formatDate(conflict.enteredAt)}</td>
                    <td className="px-3 py-2">{formatDate(conflict.resolvedAt)}</td>
                    <td className="px-3 py-2">{formatDuration(conflict.durationMs)}</td>
                    <td className="px-3 py-2">
                      {conflict.strategy ?? (conflict.resolvedAt ? 'manual' : 'open')}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-3 py-4 text-[color:var(--hud-muted)]" colSpan={6}>
                    No conflicts for this scope and filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </UISurface>

      <UICluster className="items-center justify-between">
        <p className="text-xs text-[color:var(--hud-muted)]">
          {data ? `${data.total} conflict record${data.total === 1 ? '' : 's'}` : '—'}
        </p>
        <UICluster className="items-center gap-2">
          <UIActionButton
            type="button"
            disabled={loading || offset === 0}
            onClick={() => setOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
          >
            Previous
          </UIActionButton>
          <UIActionButton
            type="button"
            disabled={loading || !canPageForward}
            onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
          >
            Next
          </UIActionButton>
        </UICluster>
      </UICluster>
    </UIStack>
  );
}
