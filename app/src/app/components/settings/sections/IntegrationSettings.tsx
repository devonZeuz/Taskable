import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Link } from 'react-router';
import CloudSyncControls from '../../CloudSyncControls';
import { type CloudSyncIssue, useCloudSync } from '../../../context/CloudSyncContext';
import { cloudRequest } from '../../../services/cloudApi';
import { resolveAdminDashboardFlag } from '../../../flags';
import { Switch } from '../../ui/switch';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';

interface IntegrationPrefs {
  outlookEnabled: boolean;
  calendarEnabled: boolean;
}

interface AuditEvent {
  id: string;
  task_id: string | null;
  actor_user_id: string;
  actor_name?: string | null;
  actor_email?: string | null;
  event_type: string;
  payload?: Record<string, unknown>;
  created_at: string;
}

const INTEGRATIONS_STORAGE_KEY = 'taskable:integration-prefs';

function loadIntegrationPrefs(orgId: string | null): IntegrationPrefs {
  if (!orgId) {
    return { outlookEnabled: false, calendarEnabled: false };
  }
  try {
    const raw = localStorage.getItem(INTEGRATIONS_STORAGE_KEY);
    if (!raw) return { outlookEnabled: false, calendarEnabled: false };
    const parsed = JSON.parse(raw) as Record<string, IntegrationPrefs>;
    return parsed[orgId] ?? { outlookEnabled: false, calendarEnabled: false };
  } catch {
    return { outlookEnabled: false, calendarEnabled: false };
  }
}

function persistIntegrationPrefs(orgId: string, prefs: IntegrationPrefs) {
  try {
    const raw = localStorage.getItem(INTEGRATIONS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, IntegrationPrefs>) : {};
    parsed[orgId] = prefs;
    localStorage.setItem(INTEGRATIONS_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore persistence errors
  }
}

function parseAuditTimestamp(value: string): Date | null {
  if (!value) return null;
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  const fallback = new Date(value);
  if (!Number.isNaN(fallback.getTime())) return fallback;
  return null;
}

function formatAuditTimestamp(value: string): string {
  const date = parseAuditTimestamp(value);
  if (!date) return value;
  return date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
}

function toIsoFilter(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function formatActor(event: AuditEvent): string {
  if (event.actor_name && event.actor_email) {
    return `${event.actor_name} (${event.actor_email})`;
  }
  if (event.actor_name) return event.actor_name;
  if (event.actor_email) return event.actor_email;
  return event.actor_user_id || 'unknown';
}

function formatSyncIssue(issue: CloudSyncIssue, orgId: string | null): string {
  const lines = [
    `time=${new Date(issue.occurredAt).toISOString()}`,
    `operation=${issue.operation}`,
    `message=${issue.message}`,
    `status=${issue.status ?? 'n/a'}`,
    `code=${issue.code ?? 'n/a'}`,
    `requestId=${issue.requestId ?? 'n/a'}`,
    `orgId=${orgId ?? 'n/a'}`,
  ];
  return lines.join('\n');
}

export default function IntegrationSettings() {
  const {
    token,
    orgs,
    activeOrgId,
    realtimeState,
    error,
    activeOrgRole,
    canWriteTasks,
    canDeleteTasks,
    conflicts,
    autoSync,
    syncTransport,
    lastSyncIssue,
    clearSyncIssue,
  } = useCloudSync();
  const [prefs, setPrefs] = useState<IntegrationPrefs>(() => loadIntegrationPrefs(activeOrgId));
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [activityAction, setActivityAction] = useState('');
  const [activityUserId, setActivityUserId] = useState('');
  const [activityTaskId, setActivityTaskId] = useState('');
  const [activityFrom, setActivityFrom] = useState('');
  const [activityTo, setActivityTo] = useState('');

  const activeOrg = useMemo(
    () => orgs.find((org) => org.id === activeOrgId) ?? null,
    [activeOrgId, orgs]
  );
  const adminDashboardEnabled = resolveAdminDashboardFlag();
  const canManageIntegrations = activeOrg?.role === 'owner' || activeOrg?.role === 'admin';
  const canOpenAdminDashboard = adminDashboardEnabled && activeOrg?.role === 'owner';

  useEffect(() => {
    setPrefs(loadIntegrationPrefs(activeOrgId));
  }, [activeOrgId]);

  useEffect(() => {
    if (!activeOrgId) return;
    persistIntegrationPrefs(activeOrgId, prefs);
  }, [activeOrgId, prefs]);

  const fetchEvents = useCallback(async () => {
    if (!token || !activeOrgId) {
      setEvents([]);
      return;
    }

    setLoadingEvents(true);
    try {
      const query = new URLSearchParams();
      if (activityAction) {
        query.set('action', activityAction);
      }
      if (activityUserId.trim()) {
        query.set('userId', activityUserId.trim());
      }
      if (activityTaskId.trim()) {
        query.set('taskId', activityTaskId.trim());
      }
      const fromIso = toIsoFilter(activityFrom);
      if (fromIso) {
        query.set('from', fromIso);
      }
      const toIso = toIsoFilter(activityTo);
      if (toIso) {
        query.set('to', toIso);
      }
      query.set('limit', '250');

      const payload = await cloudRequest<{ events: AuditEvent[] }>(
        `/api/orgs/${activeOrgId}/activity?${query.toString()}`,
        {
          token,
        }
      );
      setEvents(payload.events ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load activity feed.';
      toast.error(message);
    } finally {
      setLoadingEvents(false);
    }
  }, [
    activeOrgId,
    token,
    activityAction,
    activityUserId,
    activityTaskId,
    activityFrom,
    activityTo,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchEvents();
    }, 180);
    return () => {
      window.clearTimeout(timer);
    };
  }, [fetchEvents]);

  const handleCopyIssueDetails = useCallback(async () => {
    if (!lastSyncIssue) return;
    const payload = formatSyncIssue(lastSyncIssue, activeOrgId);
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
        toast.success('Sync diagnostics copied.');
        return;
      }
      toast.error('Clipboard API is unavailable in this browser.');
    } catch {
      toast.error('Failed to copy sync diagnostics.');
    }
  }, [activeOrgId, lastSyncIssue]);

  const activityStats = useMemo(() => {
    let conflictCount = 0;
    let takeoverCount = 0;
    let presenceCount = 0;
    events.forEach((event) => {
      if (event.event_type.startsWith('task.conflict_')) {
        conflictCount += 1;
      }
      if (event.event_type.includes('taken_over')) {
        takeoverCount += 1;
      }
      if (event.event_type.startsWith('presence.')) {
        presenceCount += 1;
      }
    });
    return {
      total: events.length,
      conflictCount,
      takeoverCount,
      presenceCount,
    };
  }, [events]);

  return (
    <div className="space-y-4">
      <section className="ui-hud-section ui-v1-radius-md p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
          Sync Status
        </p>
        <div className="mt-2 space-y-1 text-xs text-[color:var(--hud-muted)]">
          <p>
            Active role:{' '}
            <span className="font-semibold text-[color:var(--hud-text)]">
              {activeOrgRole ?? 'none'}
            </span>
          </p>
          <p>
            Task write:{' '}
            <span className="font-semibold text-[color:var(--hud-text)]">
              {canWriteTasks ? 'allowed' : 'blocked'}
            </span>
          </p>
          <p>
            Task delete:{' '}
            <span className="font-semibold text-[color:var(--hud-text)]">
              {canDeleteTasks ? 'allowed' : 'blocked'}
            </span>
          </p>
          <p>
            Auto sync:{' '}
            <span className="font-semibold text-[color:var(--hud-text)]">
              {autoSync ? 'on' : 'off'}
            </span>
          </p>
          <p>
            Transport:{' '}
            <span className="font-semibold text-[color:var(--hud-text)]">{syncTransport}</span>
          </p>
        </div>
        {conflicts.length > 0 && (
          <div className="ui-status-warning mt-3 ui-v1-radius-sm px-3 py-2 text-xs">
            {conflicts.length} sync conflict{conflicts.length === 1 ? '' : 's'} pending. Open Cloud
            control and resolve conflict entries.
          </div>
        )}
        {error && (
          <div className="ui-status-danger mt-3 ui-v1-radius-sm px-3 py-2 text-xs">{error}</div>
        )}
        {lastSyncIssue && (
          <div className="ui-alert-block mt-3 space-y-2 ui-v1-radius-sm px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em]">
              Latest Sync Issue
            </p>
            <div className="space-y-1 text-[11px]">
              <p>
                <span className="opacity-75">When:</span>{' '}
                {new Date(lastSyncIssue.occurredAt).toLocaleString(undefined, {
                  dateStyle: 'short',
                  timeStyle: 'medium',
                })}
              </p>
              <p>
                <span className="opacity-75">Operation:</span> {lastSyncIssue.operation}
              </p>
              <p>
                <span className="opacity-75">HTTP:</span> {lastSyncIssue.status ?? 'n/a'}
                {lastSyncIssue.code ? ` (${lastSyncIssue.code})` : ''}
              </p>
              {lastSyncIssue.requestId && (
                <p>
                  <span className="opacity-75">Request ID:</span> {lastSyncIssue.requestId}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => void handleCopyIssueDetails()}
              >
                Copy diagnostics
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-[11px]"
                onClick={clearSyncIssue}
              >
                Clear
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="ui-hud-section ui-v1-radius-md p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
          Cloud Workspace
        </p>
        <div className="mt-2 space-y-2">
          <p className="text-sm text-[color:var(--hud-text)]">
            Realtime status:{' '}
            <span className="font-semibold text-[color:var(--hud-text)]">{realtimeState}</span>
          </p>
          {activeOrg ? (
            <p className="text-xs text-[color:var(--hud-muted)]">
              Active workspace: {activeOrg.name} ({activeOrg.role})
            </p>
          ) : (
            <p className="text-xs text-[color:var(--hud-muted)]">No workspace selected.</p>
          )}
          <p className="text-[11px] text-[color:var(--hud-muted)]">
            Different login = different workspace data unless that user is invited into the same
            workspace.
          </p>
        </div>
        <div className="mt-3">
          <CloudSyncControls />
        </div>
        {canOpenAdminDashboard && (
          <div className="mt-3 ui-v1-radius-sm border border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] p-3">
            <p className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
              Owner Tools
            </p>
            <p className="mt-1 text-xs text-[color:var(--hud-muted)]">
              Open owner-only operations dashboard for users, conflicts, sync, and email health.
            </p>
            <Link
              to="/admin"
              data-testid="settings-admin-link"
              className="mt-2 inline-flex h-8 items-center ui-v1-radius-sm border border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-3 text-xs font-semibold text-[color:var(--hud-text)] hover:bg-[var(--hud-surface-strong)]"
            >
              Admin (Owner)
            </Link>
          </div>
        )}
      </section>

      <section className="ui-hud-section ui-v1-radius-md p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
          External Integrations
        </p>
        <p className="mt-2 text-xs text-[color:var(--hud-muted)]">
          Metadata-only import is default for Outlook email capture. Owners and admins manage
          integration access.
        </p>
        <div className="mt-3 space-y-2">
          <IntegrationRow
            title="Outlook email -> Inbox task"
            subtitle="Imports sender, subject, timestamp, and deep-link metadata only."
            checked={prefs.outlookEnabled}
            disabled={!canManageIntegrations}
            onCheckedChange={(checked) =>
              setPrefs((prev) => ({ ...prev, outlookEnabled: checked }))
            }
          />
          <IntegrationRow
            title="Calendar sync"
            subtitle="Calendar event overlay and sync controls are WIP."
            checked={prefs.calendarEnabled}
            disabled={!canManageIntegrations}
            onCheckedChange={(checked) =>
              setPrefs((prev) => ({ ...prev, calendarEnabled: checked }))
            }
          />
        </div>
        {!canManageIntegrations && token && (
          <p className="mt-2 text-[11px] text-[color:var(--hud-warning-text)]">
            You can view integration status, but only owners/admins can enable integrations.
          </p>
        )}
      </section>

      <section className="ui-hud-section ui-v1-radius-md p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
            Integration Audit Feed
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void fetchEvents()}
            disabled={loadingEvents || !token || !activeOrgId}
          >
            Refresh
          </Button>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="space-y-1 text-[11px] text-[color:var(--hud-muted)]">
            Action
            <select
              className="h-8 w-full ui-v1-radius-xs border border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] px-2 text-[12px] text-[color:var(--hud-text)]"
              value={activityAction}
              onChange={(event) => setActivityAction(event.target.value)}
            >
              <option value="">All actions</option>
              <option value="task.">Task events</option>
              <option value="task.conflict_">Conflicts</option>
              <option value="presence.">Presence locks</option>
              <option value="presence.lock_taken_over">Takeover only</option>
              <option value="org.member_">Member changes</option>
            </select>
          </label>
          <label className="space-y-1 text-[11px] text-[color:var(--hud-muted)]">
            User ID
            <Input
              value={activityUserId}
              onChange={(event) => setActivityUserId(event.target.value)}
              placeholder="usr_..."
              className="h-8"
            />
          </label>
          <label className="space-y-1 text-[11px] text-[color:var(--hud-muted)]">
            Task ID
            <Input
              value={activityTaskId}
              onChange={(event) => setActivityTaskId(event.target.value)}
              placeholder="tsk_..."
              className="h-8"
            />
          </label>
          <label className="space-y-1 text-[11px] text-[color:var(--hud-muted)]">
            From
            <Input
              type="datetime-local"
              value={activityFrom}
              onChange={(event) => setActivityFrom(event.target.value)}
              className="h-8"
            />
          </label>
          <label className="space-y-1 text-[11px] text-[color:var(--hud-muted)]">
            To
            <Input
              type="datetime-local"
              value={activityTo}
              onChange={(event) => setActivityTo(event.target.value)}
              className="h-8"
            />
          </label>
          <div className="flex items-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-[11px]"
              onClick={() => {
                setActivityAction('');
                setActivityUserId('');
                setActivityTaskId('');
                setActivityFrom('');
                setActivityTo('');
              }}
            >
              Clear filters
            </Button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[color:var(--hud-muted)]">
          <span className="ui-hud-row rounded-full px-2 py-0.5">total: {activityStats.total}</span>
          <span className="ui-hud-row rounded-full px-2 py-0.5">
            conflicts: {activityStats.conflictCount}
          </span>
          <span className="ui-hud-row rounded-full px-2 py-0.5">
            takeovers: {activityStats.takeoverCount}
          </span>
          <span className="ui-hud-row rounded-full px-2 py-0.5">
            presence: {activityStats.presenceCount}
          </span>
        </div>
        {!token || !activeOrgId ? (
          <p className="mt-2 text-xs text-[color:var(--hud-muted)]">
            Connect cloud sync to load workspace activity.
          </p>
        ) : events.length === 0 ? (
          <p className="mt-2 text-xs text-[color:var(--hud-muted)]">No activity yet.</p>
        ) : (
          <div className="mt-3 max-h-[260px] space-y-1 overflow-auto ui-hud-row ui-v1-radius-sm p-2">
            {events.slice(0, 80).map((event) => (
              <div
                key={event.id}
                className="rounded px-2 py-1.5 text-[11px] text-[color:var(--hud-muted)] hover:bg-[var(--hud-surface-soft)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate pr-2 font-semibold text-[color:var(--hud-text)]">
                    {event.event_type}
                  </span>
                  <span className="shrink-0 text-[color:var(--hud-muted)]">
                    {formatAuditTimestamp(event.created_at)}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px]">
                  <span>actor: {formatActor(event)}</span>
                  {event.task_id && <span>task: {event.task_id}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function IntegrationRow({
  title,
  subtitle,
  checked,
  disabled,
  onCheckedChange,
}: {
  title: string;
  subtitle: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between ui-hud-row ui-v1-radius-sm px-3 py-2">
      <div className="pr-3">
        <p className="text-sm font-semibold text-[color:var(--hud-text)]">{title}</p>
        <p className="text-[11px] text-[color:var(--hud-muted)]">{subtitle}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}
