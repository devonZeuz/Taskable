import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { toast } from 'sonner';
import { CloudRequestError } from '../../services/cloudApi';
import { useCloudSync } from '../../context/CloudSyncContext';
import { useOnboarding } from '../../context/OnboardingContext';
import { resolveAdminDashboardFlag } from '../../flags';
import { UIActionButton, UIControlGroup, UISurface, UIStack } from '../../../ui-system';
import AdminOverviewPanel from './AdminOverviewPanel';
import AdminUsersPanel from './AdminUsersPanel';
import AdminOrgsPanel from './AdminOrgsPanel';
import AdminConflictsPanel from './AdminConflictsPanel';
import AdminSyncHealthPanel from './AdminSyncHealthPanel';
import AdminEmailHealthPanel from './AdminEmailHealthPanel';

type AdminTabKey = 'overview' | 'users' | 'orgs' | 'conflicts' | 'sync-health' | 'email-health';

const ADMIN_TABS: Array<{ key: AdminTabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'users', label: 'Users' },
  { key: 'orgs', label: 'Orgs' },
  { key: 'conflicts', label: 'Conflicts' },
  { key: 'sync-health', label: 'Sync Health' },
  { key: 'email-health', label: 'Email Health' },
];

function UnauthorizedPanel() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 items-center justify-center p-4">
      <UISurface
        level="2"
        className="w-full rounded-2xl border border-[color:var(--hud-border)] p-6"
        data-testid="admin-unauthorized"
      >
        <p className="text-xs uppercase tracking-[0.1em] text-[color:var(--hud-muted)]">Tareva</p>
        <h1 className="mt-2 text-2xl font-semibold text-[color:var(--hud-text)]">Not authorized</h1>
        <p className="mt-2 text-sm text-[color:var(--hud-muted)]">
          Admin dashboard access is restricted to workspace owners.
        </p>
        <div className="mt-5">
          <Link to="/planner">
            <UIActionButton type="button">Return to planner</UIActionButton>
          </Link>
        </div>
      </UISurface>
    </div>
  );
}

export default function AdminDashboard() {
  const adminEnabled = resolveAdminDashboardFlag();
  const { mode, isCloudAuthenticated } = useOnboarding();
  const { token, orgs, user } = useCloudSync();
  const [activeTab, setActiveTab] = useState<AdminTabKey>('overview');
  const [selectedOrgId, setSelectedOrgId] = useState<string>('all');
  const [forbidden, setForbidden] = useState(false);
  const [fatalError, setFatalError] = useState<Error | null>(null);

  const ownedOrgs = useMemo(() => orgs.filter((org) => org.role === 'owner'), [orgs]);
  const isOwner = ownedOrgs.length > 0;
  const scopedOrgId = selectedOrgId === 'all' ? undefined : selectedOrgId;

  useEffect(() => {
    if (selectedOrgId === 'all') return;
    if (!ownedOrgs.some((org) => org.id === selectedOrgId)) {
      setSelectedOrgId('all');
    }
  }, [ownedOrgs, selectedOrgId]);

  const handlePanelError = useCallback((error: unknown, context: string) => {
    if (error instanceof CloudRequestError) {
      if (error.status === 403) {
        setForbidden(true);
        return;
      }
      if (error.status >= 500) {
        setFatalError(new Error(`Admin API runtime check failed: ${error.message}`));
        return;
      }
      toast.error(context);
      return;
    }
    const message = error instanceof Error ? error.message : context;
    setFatalError(new Error(`Admin API runtime check failed: ${message}`));
  }, []);

  if (!adminEnabled) {
    return <Navigate to="/planner" replace />;
  }
  if (mode !== 'cloud') {
    return <Navigate to="/welcome" replace />;
  }
  if (!isCloudAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (fatalError) {
    throw fatalError;
  }
  if (token && !user) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <UISurface level="2" className="rounded-xl border border-[color:var(--hud-border)] p-4">
          <p className="text-sm text-[color:var(--hud-muted)]">Loading admin permissions…</p>
        </UISurface>
      </div>
    );
  }
  if (!isOwner || forbidden) {
    return <UnauthorizedPanel />;
  }
  if (!token) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <UISurface level="2" className="rounded-xl border border-[color:var(--hud-border)] p-4">
          <p className="text-sm text-[color:var(--hud-muted)]">Authorizing admin dashboard…</p>
        </UISurface>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-3 sm:p-4 md:p-5">
      <UISurface
        level="1"
        className="flex min-h-0 flex-1 flex-col rounded-2xl border border-[color:var(--hud-border)] p-4 md:p-5"
        data-testid="admin-dashboard"
      >
        <UIStack gap="4" className="min-h-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-[color:var(--hud-muted)]">
                Owner Admin
              </p>
              <h1 className="text-2xl font-semibold text-[color:var(--hud-text)]">
                Admin Dashboard
              </h1>
              <p className="mt-1 text-sm text-[color:var(--hud-muted)]">
                Operational visibility for users, workspace conflicts, sync health, and email
                delivery.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs text-[color:var(--hud-muted)]">
              Org scope
              <select
                data-testid="admin-org-filter"
                value={selectedOrgId}
                onChange={(event) => setSelectedOrgId(event.target.value)}
                className="h-9 ui-v1-radius-sm border border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] px-2 text-[color:var(--hud-text)]"
              >
                <option value="all">All owned orgs</option>
                {ownedOrgs.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <UIControlGroup className="flex flex-wrap gap-2">
            {ADMIN_TABS.map((tab) => {
              const isActive = tab.key === activeTab;
              return (
                <UIActionButton
                  key={tab.key}
                  type="button"
                  data-testid={`admin-tab-${tab.key}`}
                  tone={isActive ? 'primary' : 'default'}
                  className={isActive ? '' : 'opacity-85'}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                </UIActionButton>
              );
            })}
          </UIControlGroup>

          <div className="min-h-0 flex-1 overflow-auto pr-1">
            {activeTab === 'overview' && (
              <AdminOverviewPanel token={token} orgId={scopedOrgId} onError={handlePanelError} />
            )}
            {activeTab === 'users' && (
              <AdminUsersPanel token={token} orgId={scopedOrgId} onError={handlePanelError} />
            )}
            {activeTab === 'orgs' && (
              <AdminOrgsPanel token={token} orgId={scopedOrgId} onError={handlePanelError} />
            )}
            {activeTab === 'conflicts' && (
              <AdminConflictsPanel token={token} orgId={scopedOrgId} onError={handlePanelError} />
            )}
            {activeTab === 'sync-health' && (
              <AdminSyncHealthPanel token={token} orgId={scopedOrgId} onError={handlePanelError} />
            )}
            {activeTab === 'email-health' && (
              <AdminEmailHealthPanel token={token} orgId={scopedOrgId} onError={handlePanelError} />
            )}
          </div>
        </UIStack>
      </UISurface>
    </div>
  );
}
