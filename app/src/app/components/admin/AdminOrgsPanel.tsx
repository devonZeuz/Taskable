import { useCallback, useEffect, useMemo, useState } from 'react';
import { UIActionButton, UICluster, UISurface, UIStack } from '../../../ui-system';
import { getAdminOrgs, type AdminOrgsResponse } from '../../services/adminApi';
import type { AdminPanelBaseProps } from './types';

const PAGE_SIZE = 20;

function formatDate(value: string | null): string {
  if (!value) return 'n/a';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

export default function AdminOrgsPanel({ token, orgId, onError }: AdminPanelBaseProps) {
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AdminOrgsResponse | null>(null);

  const canPageForward = useMemo(() => {
    if (!data) return false;
    return data.offset + data.orgs.length < data.total;
  }, [data]);

  const fetchOrgs = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await getAdminOrgs(token, {
        orgId,
        limit: PAGE_SIZE,
        offset,
      });
      setData(payload);
    } catch (error) {
      onError(error, 'Failed to load admin orgs.');
    } finally {
      setLoading(false);
    }
  }, [offset, onError, orgId, token]);

  useEffect(() => {
    void fetchOrgs();
  }, [fetchOrgs]);

  return (
    <UIStack gap="4" data-testid="admin-orgs-panel">
      <UISurface
        level="2"
        className="overflow-hidden rounded-xl border border-[color:var(--hud-border)]"
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--hud-surface-soft)] text-[color:var(--hud-muted)]">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Workspace</th>
                <th className="px-3 py-2 text-left font-semibold">Created</th>
                <th className="px-3 py-2 text-left font-semibold">Members</th>
                <th className="px-3 py-2 text-left font-semibold">Tasks</th>
                <th className="px-3 py-2 text-left font-semibold">Conflicts (7d)</th>
                <th className="px-3 py-2 text-left font-semibold">Last Activity</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-3 py-4 text-[color:var(--hud-muted)]" colSpan={6}>
                    Loading workspaces…
                  </td>
                </tr>
              ) : data && data.orgs.length > 0 ? (
                data.orgs.map((org) => (
                  <tr
                    key={org.orgId}
                    className="border-t border-[color:var(--hud-border)] text-[color:var(--hud-text)]"
                  >
                    <td className="px-3 py-2">{org.name}</td>
                    <td className="px-3 py-2">{formatDate(org.createdAt)}</td>
                    <td className="px-3 py-2">{org.memberCount}</td>
                    <td className="px-3 py-2">{org.taskCount}</td>
                    <td className="px-3 py-2">{org.conflictCountLast7d}</td>
                    <td className="px-3 py-2">{formatDate(org.lastActivityAt)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-3 py-4 text-[color:var(--hud-muted)]" colSpan={6}>
                    No workspaces in owner scope.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </UISurface>

      <UICluster className="items-center justify-between">
        <p className="text-xs text-[color:var(--hud-muted)]">
          {data ? `${data.total} workspace${data.total === 1 ? '' : 's'} in scope` : '—'}
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
