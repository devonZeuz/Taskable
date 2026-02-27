import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Input } from '../ui/input';
import { UIActionButton, UICluster, UISurface, UIStack } from '../../../ui-system';
import {
  getAdminUsers,
  resendVerification,
  type AdminUserRecord,
  type AdminUsersResponse,
} from '../../services/adminApi';
import type { AdminPanelBaseProps } from './types';

const PAGE_SIZE = 20;

function formatDateTime(value: string | null): string {
  if (!value) return 'n/a';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

export default function AdminUsersPanel({ token, orgId, onError }: AdminPanelBaseProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AdminUsersResponse | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const canPageForward = useMemo(() => {
    if (!data) return false;
    return data.offset + data.users.length < data.total;
  }, [data]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await getAdminUsers(token, {
        orgId,
        query: searchQuery,
        limit: PAGE_SIZE,
        offset,
      });
      setData(payload);
    } catch (error) {
      onError(error, 'Failed to load admin users.');
    } finally {
      setLoading(false);
    }
  }, [offset, onError, orgId, searchQuery, token]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchUsers();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [fetchUsers]);

  const handleResendVerification = useCallback(
    async (user: AdminUserRecord) => {
      setBusyUserId(user.id);
      try {
        const result = await resendVerification(token, user.id);
        if (result.alreadyVerified) {
          toast.message('User is already verified.');
        } else {
          toast.success(`Verification email resent to ${user.email}.`);
        }
        await fetchUsers();
      } catch (error) {
        onError(error, `Failed to resend verification for ${user.email}.`);
      } finally {
        setBusyUserId(null);
      }
    },
    [fetchUsers, onError, token]
  );

  return (
    <UIStack gap="4" data-testid="admin-users-panel">
      <UISurface level="2" className="rounded-xl border border-[color:var(--hud-border)] p-4">
        <UICluster className="items-center justify-between gap-3">
          <p className="text-sm text-[color:var(--hud-muted)]">
            Search by email, review account verification status, and resend verification links.
          </p>
          <Input
            data-testid="admin-users-search"
            className="h-9 w-full max-w-[280px]"
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setOffset(0);
            }}
            placeholder="Search email..."
          />
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
                <th className="px-3 py-2 text-left font-semibold">Email</th>
                <th className="px-3 py-2 text-left font-semibold">Created</th>
                <th className="px-3 py-2 text-left font-semibold">Verified</th>
                <th className="px-3 py-2 text-left font-semibold">MFA</th>
                <th className="px-3 py-2 text-left font-semibold">Last Login</th>
                <th className="px-3 py-2 text-left font-semibold">Orgs</th>
                <th className="px-3 py-2 text-left font-semibold">Resends (24h)</th>
                <th className="px-3 py-2 text-left font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-3 py-4 text-[color:var(--hud-muted)]" colSpan={8}>
                    Loading users…
                  </td>
                </tr>
              ) : data && data.users.length > 0 ? (
                data.users.map((user) => (
                  <tr
                    key={user.id}
                    className="border-t border-[color:var(--hud-border)] text-[color:var(--hud-text)]"
                  >
                    <td className="px-3 py-2">{user.email}</td>
                    <td className="px-3 py-2">{formatDateTime(user.createdAt)}</td>
                    <td className="px-3 py-2">{user.emailVerified ? 'Yes' : 'No'}</td>
                    <td className="px-3 py-2">{user.mfaEnabled ? 'Enabled' : 'Off'}</td>
                    <td className="px-3 py-2">{formatDateTime(user.lastLoginAt)}</td>
                    <td className="px-3 py-2">{user.orgCount}</td>
                    <td className="px-3 py-2">{user.resendVerificationCountLast24h}</td>
                    <td className="px-3 py-2">
                      <UIActionButton
                        data-testid="admin-resend-verification"
                        type="button"
                        disabled={Boolean(user.emailVerified) || busyUserId === user.id}
                        onClick={() => void handleResendVerification(user)}
                      >
                        Resend verification
                      </UIActionButton>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-3 py-4 text-[color:var(--hud-muted)]" colSpan={8}>
                    No users match the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </UISurface>

      <UICluster className="items-center justify-between">
        <p className="text-xs text-[color:var(--hud-muted)]">
          {data ? `${data.total} user${data.total === 1 ? '' : 's'} in scope` : '—'}
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
