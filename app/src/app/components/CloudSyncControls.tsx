import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, DownloadCloud, LogIn, LogOut, RefreshCw, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import type { Task } from '../context/TaskContext';
import { useCloudSync } from '../context/CloudSyncContext';
import { cloudRequest, CloudRequestError } from '../services/cloudApi';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Switch } from './ui/switch';
import { clearPendingConflictTaskId, getPendingConflictTaskId } from '../services/settingsBridge';

interface ConflictAuditEvent {
  id: string;
  task_id: string | null;
  event_type: string;
  created_at: string;
  payload?: { strategy?: string };
}

function formatConflictTimestamp(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
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

export default function CloudSyncControls() {
  const {
    enabled,
    token,
    user,
    orgs,
    activeOrgId,
    syncing,
    autoSync,
    error,
    realtimeState,
    syncTransport,
    conflicts,
    setAutoSync,
    setActiveOrgId,
    login,
    register,
    logout,
    refreshSession,
    resolveConflictKeepMine,
    resolveConflictKeepTheirs,
    resolveConflictMerge,
    dismissConflict,
    pullTasks,
    pushTasks,
  } = useCloudSync();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaTicket, setMfaTicket] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [activeConflictId, setActiveConflictId] = useState<string | null>(null);
  const [mergeChoicesByTask, setMergeChoicesByTask] = useState<
    Record<string, Partial<Record<string, 'mine' | 'theirs'>>>
  >({});
  const [conflictAuditEvents, setConflictAuditEvents] = useState<ConflictAuditEvent[]>([]);
  const [loadingConflictAudit, setLoadingConflictAudit] = useState(false);
  const [batchResolvingAction, setBatchResolvingAction] = useState<'mine' | 'theirs' | null>(null);

  const parseMfaChallenge = (err: unknown) => {
    if (!(err instanceof CloudRequestError) || err.status !== 401) return null;
    if (!err.payload || typeof err.payload !== 'object') return null;
    const payload = err.payload as {
      code?: string;
      details?: { mfaRequired?: boolean; mfaTicket?: string };
    };
    if (
      payload.code !== 'MFA_REQUIRED' ||
      !payload.details?.mfaRequired ||
      !payload.details.mfaTicket
    ) {
      return null;
    }
    return { ticket: payload.details.mfaTicket };
  };

  const fetchConflictAudit = useCallback(async () => {
    if (!token || !activeOrgId) {
      setConflictAuditEvents([]);
      return;
    }

    setLoadingConflictAudit(true);
    try {
      const payload = await cloudRequest<{ events: ConflictAuditEvent[] }>(
        `/api/v1/orgs/${activeOrgId}/activity`,
        { token }
      );
      setConflictAuditEvents(
        (payload.events ?? []).filter((event) => event.event_type.startsWith('task.conflict_'))
      );
    } catch {
      setConflictAuditEvents([]);
    } finally {
      setLoadingConflictAudit(false);
    }
  }, [activeOrgId, token]);

  useEffect(() => {
    void fetchConflictAudit();
  }, [fetchConflictAudit, conflicts.length]);

  const activeConflict = useMemo(
    () => conflicts.find((conflict) => conflict.taskId === activeConflictId) ?? null,
    [activeConflictId, conflicts]
  );

  useEffect(() => {
    if (!activeConflict) return;
    setMergeChoicesByTask((previous) => {
      if (previous[activeConflict.taskId]) return previous;
      const defaults: Partial<Record<string, 'mine' | 'theirs'>> = {};
      activeConflict.conflictingFields.forEach((field) => {
        if (field !== 'delete' && field !== 'manual') defaults[field] = 'mine';
      });
      return { ...previous, [activeConflict.taskId]: defaults };
    });
  }, [activeConflict]);

  useEffect(() => {
    const pendingConflictTaskId = getPendingConflictTaskId();
    if (!pendingConflictTaskId) return;
    if (!conflicts.some((entry) => entry.taskId === pendingConflictTaskId)) return;
    setActiveConflictId(pendingConflictTaskId);
    clearPendingConflictTaskId();
  }, [conflicts]);

  if (!enabled) return null;

  const handleAuthSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      if (mode === 'login') {
        try {
          await login(email, password, mfaTicket ? { mfaTicket, mfaCode: mfaCode.trim() } : {});
        } catch (error) {
          const challenge = parseMfaChallenge(error);
          if (!challenge) throw error;
          setMfaTicket(challenge.ticket);
          setMfaCode('');
          toast.info('Enter your authenticator code to finish signing in.');
          return;
        }
      } else {
        await register(name, email, password);
      }
      setPassword('');
      setMfaTicket(null);
      setMfaCode('');
      toast.success(mode === 'login' ? 'Connected to cloud.' : 'Cloud workspace created.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed.';
      toast.error(message);
    }
  };

  const runAction = async (
    fn: () => Promise<void>,
    successMessage: string,
    failureMessage: string
  ) => {
    try {
      await fn();
      toast.success(successMessage);
    } catch (err) {
      const message = err instanceof Error ? err.message : failureMessage;
      toast.error(message);
    }
  };

  const realtimeLabel =
    syncTransport === 'sse'
      ? 'Connected (SSE)'
      : syncTransport === 'polling'
        ? 'Fallback polling'
        : realtimeState === 'connecting'
          ? 'Connecting'
          : realtimeState === 'reconnecting'
            ? 'Reconnecting'
            : 'Disconnected';
  const realtimeTone =
    syncTransport === 'sse'
      ? 'text-emerald-400'
      : syncTransport === 'polling'
        ? 'text-amber-300'
        : 'text-[color:var(--hud-muted)]';

  const handleConflictAction = async (taskId: string, action: 'mine' | 'theirs' | 'merge') => {
    try {
      if (action === 'mine') {
        await resolveConflictKeepMine(taskId);
      } else if (action === 'theirs') {
        await resolveConflictKeepTheirs(taskId);
      } else {
        await resolveConflictMerge(taskId, mergeChoicesByTask[taskId] ?? {});
      }
      await fetchConflictAudit();
      setActiveConflictId(null);
      toast.success('Conflict resolved.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to resolve conflict.';
      toast.error(message);
    }
  };

  const handleBatchConflictAction = async (action: 'mine' | 'theirs') => {
    const targetConflictIds = conflicts.map((conflict) => conflict.taskId);
    if (targetConflictIds.length === 0) return;

    setBatchResolvingAction(action);
    let resolvedCount = 0;
    let failedCount = 0;

    for (const taskId of targetConflictIds) {
      try {
        if (action === 'mine') {
          await resolveConflictKeepMine(taskId);
        } else {
          await resolveConflictKeepTheirs(taskId);
        }
        resolvedCount += 1;
      } catch {
        failedCount += 1;
      }
    }

    await fetchConflictAudit();
    setActiveConflictId(null);
    setBatchResolvingAction(null);

    if (failedCount === 0) {
      toast.success(`Resolved ${resolvedCount} conflict${resolvedCount === 1 ? '' : 's'}.`);
      return;
    }

    toast.warning(
      `Resolved ${resolvedCount} conflict${resolvedCount === 1 ? '' : 's'}, ${failedCount} failed.`
    );
  };

  const setAllMergeChoices = (taskId: string, choice: 'mine' | 'theirs') => {
    const conflict = conflicts.find((entry) => entry.taskId === taskId);
    if (!conflict) return;
    setMergeChoicesByTask((previous) => {
      const nextFields: Partial<Record<string, 'mine' | 'theirs'>> = {};
      conflict.conflictingFields.forEach((field) => {
        if (field === 'delete' || field === 'manual') return;
        nextFields[field] = choice;
      });
      return {
        ...previous,
        [taskId]: nextFields,
      };
    });
  };

  const canMerge =
    activeConflict !== null &&
    !activeConflict.conflictingFields.includes('delete') &&
    !activeConflict.conflictingFields.includes('manual');

  return (
    <>
      <div className="desktop-no-drag w-full max-w-[340px] space-y-3 ui-v1-radius-sm border border-[color:var(--hud-border)] bg-[var(--hud-surface-strong)] p-3">
        {!token ? (
          <form className="space-y-3" onSubmit={handleAuthSubmit}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Cloud workspace</p>
              <div className="inline-flex rounded-md border bg-muted/20 p-0.5">
                <Button
                  type="button"
                  size="sm"
                  variant={mode === 'login' ? 'default' : 'ghost'}
                  className="h-7 px-2 text-[11px]"
                  onClick={() => {
                    setMode('login');
                    setMfaTicket(null);
                    setMfaCode('');
                  }}
                >
                  Sign in
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={mode === 'register' ? 'default' : 'ghost'}
                  className="h-7 px-2 text-[11px]"
                  onClick={() => {
                    setMode('register');
                    setMfaTicket(null);
                    setMfaCode('');
                  }}
                >
                  Create
                </Button>
              </div>
            </div>
            {mode === 'register' && (
              <div className="space-y-1.5">
                <Label htmlFor="cloud-name">Name</Label>
                <Input
                  id="cloud-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="cloud-email">Email</Label>
              <Input
                id="cloud-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cloud-password">Password</Label>
              <Input
                id="cloud-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                required
              />
            </div>
            {mfaTicket && mode === 'login' && (
              <div className="space-y-1.5">
                <Label htmlFor="cloud-mfa-code">Authenticator code</Label>
                <Input
                  id="cloud-mfa-code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value)}
                  autoComplete="one-time-code"
                  required
                />
                <p className="text-[11px] text-muted-foreground">
                  Multi-factor authentication is enabled for this account.
                </p>
              </div>
            )}
            {error && <p className="text-xs text-red-400">{error}</p>}
            <Button type="submit" className="h-8 w-full" disabled={syncing}>
              <LogIn className="mr-1 size-4" />
              {syncing ? 'Connecting...' : mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
              <p className="text-[11px] text-muted-foreground">
                Account verification, password recovery, and MFA management live in Settings -
                Security after sign-in.
              </p>
          </form>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/20 p-2">
              <p className="text-[11px] text-muted-foreground">Signed in</p>
              <p className="text-sm font-semibold">{user?.name ?? 'Cloud user'}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
            <div className="rounded-md border bg-muted/20 px-2 py-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">Realtime</span>
                <span className={`text-xs font-semibold ${realtimeTone}`}>{realtimeLabel}</span>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Realtime sync stays connected automatically and falls back safely if the live
                connection drops.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cloud-org">Workspace</Label>
              <Select value={activeOrgId ?? undefined} onValueChange={setActiveOrgId}>
                <SelectTrigger id="cloud-org" className="h-8">
                  <SelectValue placeholder="Select workspace" />
                </SelectTrigger>
                <SelectContent>
                  {orgs.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-md border bg-muted/20 px-2 py-1.5">
              <span className="text-xs font-medium">Auto sync</span>
              <Switch checked={autoSync} onCheckedChange={setAutoSync} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 text-[11px]"
                onClick={() =>
                  void runAction(pullTasks, 'Pulled latest cloud tasks.', 'Pull failed.')
                }
                disabled={syncing || !activeOrgId}
              >
                <DownloadCloud className="mr-1 size-3.5" />
                Pull
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 text-[11px]"
                onClick={() =>
                  void runAction(pushTasks, 'Pushed local tasks to cloud.', 'Push failed.')
                }
                disabled={syncing || !activeOrgId}
              >
                <UploadCloud className="mr-1 size-3.5" />
                Push
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 text-[11px]"
                onClick={() =>
                  void runAction(refreshSession, 'Cloud session refreshed.', 'Refresh failed.')
                }
                disabled={syncing}
              >
                <RefreshCw className="mr-1 size-3.5" />
                Refresh
              </Button>
            </div>
            <div className="rounded-md border bg-muted/20 px-2 py-2">
            <p className="text-[11px] font-semibold text-[color:var(--hud-text)]">
                Account security
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Verification, password recovery, and MFA controls are available in Settings -
                Security.
              </p>
            </div>
            {conflicts.length > 0 && (
              <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2">
                <p className="text-xs font-semibold text-amber-200">
                  Sync conflicts ({conflicts.length})
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-[10px]"
                    onClick={() => void handleBatchConflictAction('mine')}
                    disabled={syncing || batchResolvingAction !== null}
                  >
                    {batchResolvingAction === 'mine' ? 'Resolving…' : 'Keep mine (all)'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-[10px]"
                    onClick={() => void handleBatchConflictAction('theirs')}
                    disabled={syncing || batchResolvingAction !== null}
                  >
                    {batchResolvingAction === 'theirs' ? 'Resolving…' : 'Keep theirs (all)'}
                  </Button>
                </div>
                {conflicts.slice(0, 4).map((conflict) => (
                  <div key={conflict.taskId} className="ui-alert-block rounded p-2">
                    <p className="truncate text-xs font-semibold text-amber-100">
                      {conflict.title}
                    </p>
                    <p className="mt-1 text-[10px] text-amber-200/80">
                      Fields: {conflict.conflictingFields.join(', ')}
                    </p>
                    <p className="mt-1 text-[10px] text-amber-200/70">
                      local v{conflict.localTask.version ?? '?'} / server v
                      {conflict.serverTask.version ?? '?'}
                    </p>
                    <p className="mt-0.5 text-[10px] text-amber-200/65">
                      detected: {formatConflictTimestamp(conflict.createdAt)}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      className="mt-2 h-7 w-full text-[10px]"
                      onClick={() => setActiveConflictId(conflict.taskId)}
                    >
                      <AlertTriangle className="mr-1 size-3.5" />
                      Review conflict
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="mt-1 h-6 w-full border border-amber-400/30 text-[10px] text-amber-200/85 hover:bg-amber-500/15"
                      onClick={() => dismissConflict(conflict.taskId)}
                    >
                      Dismiss for now
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div className="rounded-md border bg-muted/20 px-2 py-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold">Conflict audit</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => void fetchConflictAudit()}
                  disabled={loadingConflictAudit}
                >
                  Refresh
                </Button>
              </div>
              <div className="mt-1 max-h-[110px] space-y-1 overflow-auto">
                {loadingConflictAudit ? (
                  <p className="text-[10px] text-muted-foreground">Loading...</p>
                ) : conflictAuditEvents.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground">No conflict events yet.</p>
                ) : (
                  conflictAuditEvents.slice(0, 6).map((event) => (
                    <div key={event.id} className="ui-hud-row rounded px-2 py-1">
                      <p className="text-[10px] font-semibold text-[color:var(--hud-text)]">
                        {event.event_type}
                      </p>
                      <p className="text-[10px] text-[color:var(--hud-muted)]">
                        {event.task_id ?? 'task?'} | {formatAuditTimestamp(event.created_at)}
                      </p>
                      {event.payload?.strategy && (
                        <p className="text-[10px] text-[color:var(--hud-muted)]">
                          strategy: {event.payload.strategy}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 w-full border border-[color:var(--hud-border)] text-[11px]"
              onClick={logout}
            >
              <LogOut className="mr-1 size-3.5" />
              Disconnect
            </Button>
          </div>
        )}
      </div>

      <Dialog
        open={Boolean(activeConflict)}
        onOpenChange={(open) => !open && setActiveConflictId(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogDescription className="sr-only">
            Review and resolve cloud version conflicts for a task.
          </DialogDescription>
          {activeConflict && (
            <>
              <DialogHeader>
                <DialogTitle>Resolve version conflict</DialogTitle>
                <DialogDescription>
                  Choose keep mine/keep theirs or merge fields for this task.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="rounded-md border bg-muted/30 px-3 py-2">
                  <p className="text-sm font-semibold">{activeConflict.title}</p>
                  <p className="text-xs text-muted-foreground">
                    Fields: {activeConflict.conflictingFields.join(', ')}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Local v{activeConflict.localTask.version ?? '?'} vs server v
                    {activeConflict.serverTask.version ?? '?'} | detected{' '}
                    {formatConflictTimestamp(activeConflict.createdAt)}
                  </p>
                </div>
                {canMerge ? (
                  <div className="max-h-[320px] space-y-2 overflow-auto pr-1">
                    <div className="flex flex-wrap gap-2 rounded-md border bg-muted/30 px-3 py-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px]"
                        onClick={() => setAllMergeChoices(activeConflict.taskId, 'mine')}
                      >
                        Use mine for all
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px]"
                        onClick={() => setAllMergeChoices(activeConflict.taskId, 'theirs')}
                      >
                        Use theirs for all
                      </Button>
                    </div>
                    {activeConflict.conflictingFields.map((field) => {
                      if (field === 'delete' || field === 'manual') return null;
                      return (
                        <div key={field} className="rounded-md border p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <p className="text-xs font-semibold uppercase tracking-wide">{field}</p>
                            <Select
                              value={mergeChoicesByTask[activeConflict.taskId]?.[field] ?? 'mine'}
                              onValueChange={(choice) =>
                                setMergeChoicesByTask((previous) => ({
                                  ...previous,
                                  [activeConflict.taskId]: {
                                    ...(previous[activeConflict.taskId] ?? {}),
                                    [field]: choice as 'mine' | 'theirs',
                                  },
                                }))
                              }
                            >
                              <SelectTrigger className="h-7 w-[130px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="mine">Use mine</SelectItem>
                                <SelectItem value="theirs">Use theirs</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="grid gap-2 md:grid-cols-2">
                            <div className="rounded border bg-muted/20 p-2">
                              <p className="text-[11px] text-muted-foreground">Local</p>
                              <p className="mt-1 text-xs">
                                {renderConflictValue(activeConflict.localTask, field)}
                              </p>
                            </div>
                            <div className="rounded border bg-muted/20 p-2">
                              <p className="text-[11px] text-muted-foreground">Server</p>
                              <p className="mt-1 text-xs">
                                {renderConflictValue(activeConflict.serverTask, field)}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                    Merge is unavailable for delete/manual conflicts. Use keep mine or keep theirs.
                  </div>
                )}
              </div>
              <DialogFooter className="gap-2 sm:justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleConflictAction(activeConflict.taskId, 'theirs')}
                  disabled={syncing}
                >
                  Keep theirs
                </Button>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={() => void handleConflictAction(activeConflict.taskId, 'mine')}
                    disabled={syncing}
                  >
                    Keep mine
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void handleConflictAction(activeConflict.taskId, 'merge')}
                    disabled={!canMerge || syncing}
                  >
                    Merge selected
                  </Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function renderConflictValue(task: Task, field: string): string {
  const value = (task as unknown as Record<string, unknown>)[field];
  if (value === undefined || value === null || value === '') return 'empty';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && field === 'subtasks') {
    return (value as Array<{ title?: string; completed?: boolean }>)
      .map((subtask) => `${subtask.completed ? '[x]' : '[ ]'} ${subtask.title ?? 'subtask'}`)
      .join(', ');
  }
  return JSON.stringify(value);
}
