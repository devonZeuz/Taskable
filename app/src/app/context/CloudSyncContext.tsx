import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTasks, type Task } from './TaskContext';
import {
  cloudRequest,
  CLOUD_API_BASE_URL,
  CLOUD_SYNC_ENABLED,
  CloudRequestError,
  getCloudSseUrl,
  type CloudOrg,
  type CloudUser,
} from '../services/cloudApi';
import type { TeamMember } from '../data/teamMembers';
import {
  autoMergeTask,
  areTasksEquivalentForSync,
  getChangedFields,
  type SyncField,
} from '../services/syncMerge';
import { recordOperationalEvent } from '../services/operationalTelemetry';
import { requestOpenConflictResolver } from '../services/settingsBridge';
import {
  CLOUD_AUTO_SYNC_STORAGE_KEY as AUTO_SYNC_STORAGE_KEY,
  CLOUD_ORG_STORAGE_KEY as ORG_STORAGE_KEY,
  CLOUD_REFRESH_TOKEN_STORAGE_KEY as REFRESH_TOKEN_STORAGE_KEY,
  CLOUD_TOKEN_STORAGE_KEY as TOKEN_STORAGE_KEY,
  notifyAuthStorageUpdated,
  type PlannerMode,
} from '../services/authStorage';

type RealtimeState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
type SyncTransport = 'disconnected' | 'polling' | 'sse';
type CloudOrgRole = 'owner' | 'admin' | 'member' | 'viewer';
export type PresenceScope = 'task' | 'day';
export type ConflictFieldChoice = 'mine' | 'theirs';
const CLOUD_SYNC_TEST_HOOKS_ENABLED =
  import.meta.env.MODE === 'e2e-cloud' || import.meta.env.VITE_E2E_CLOUD_HOOKS === 'true';

declare global {
  interface Window {
    __taskableCloudSyncTest?: {
      pullTasks: () => Promise<void>;
      pushTasks: () => Promise<void>;
      refreshSession: () => Promise<void>;
      getState: () => {
        activeOrgId: string | null;
        autoSync: boolean;
        error: string | null;
        realtimeState: RealtimeState;
        syncTransport: SyncTransport;
        tokenAvailable: boolean;
      };
    };
  }
}

export interface PresenceLock {
  scope: PresenceScope;
  targetId: string;
  userId: string;
  userName: string;
  sessionId: string;
  expiresAt: number;
  updatedAt: number;
}

export interface SyncConflict {
  taskId: string;
  title: string;
  localTask: Task;
  baseTask?: Task;
  serverTask: Task;
  conflictingFields: Array<SyncField | 'delete' | 'manual'>;
  createdAt: number;
}

export interface CloudSyncIssue {
  operation: string;
  message: string;
  status: number | null;
  code: string | null;
  requestId: string | null;
  occurredAt: number;
}

interface CloudLoginOptions {
  mfaTicket?: string;
  mfaCode?: string;
}

interface MfaEnrollmentSetup {
  enabled: boolean;
  pending: boolean;
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

interface ClaimPresenceLockOptions {
  forceTakeover?: boolean;
}

interface CloudSyncContextType {
  enabled: boolean;
  token: string | null;
  user: CloudUser | null;
  orgs: CloudOrg[];
  members: TeamMember[];
  activeOrgId: string | null;
  activeOrgRole: CloudOrgRole | null;
  syncing: boolean;
  autoSync: boolean;
  error: string | null;
  lastSyncIssue: CloudSyncIssue | null;
  realtimeState: RealtimeState;
  syncTransport: SyncTransport;
  canWriteTasks: boolean;
  canDeleteTasks: boolean;
  isTaskConflictLocked: (taskId: string) => boolean;
  openConflictResolver: (taskId: string) => void;
  conflicts: SyncConflict[];
  presenceLocks: PresenceLock[];
  setAutoSync: (enabled: boolean) => void;
  setActiveOrgId: (orgId: string) => void;
  clearSyncIssue: () => void;
  login: (email: string, password: string, options?: CloudLoginOptions) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshSession: () => Promise<void>;
  resendVerification: (email?: string) => Promise<void>;
  verifyEmailToken: (token: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  resetPassword: (token: string, newPassword: string) => Promise<void>;
  startMfaEnrollment: () => Promise<MfaEnrollmentSetup>;
  confirmMfaEnrollment: (code: string) => Promise<void>;
  disableMfa: (code: string) => Promise<void>;
  refreshMembers: () => Promise<void>;
  addMemberByEmail: (email: string) => Promise<void>;
  updateMemberRole: (
    memberId: string,
    role: 'owner' | 'admin' | 'member' | 'viewer'
  ) => Promise<void>;
  removeMember: (memberId: string) => Promise<void>;
  resolveConflictKeepMine: (taskId: string) => Promise<void>;
  resolveConflictKeepTheirs: (taskId: string) => Promise<void>;
  resolveConflictMerge: (
    taskId: string,
    fieldChoices: Partial<Record<string, ConflictFieldChoice>>
  ) => Promise<void>;
  dismissConflict: (taskId: string) => void;
  refreshPresence: () => Promise<void>;
  claimPresenceLock: (
    scope: PresenceScope,
    targetId: string,
    options?: ClaimPresenceLockOptions
  ) => Promise<
    | { ok: true; lock: PresenceLock; takenOver?: boolean }
    | { ok: false; conflict?: PresenceLock; takeoverAllowed?: boolean }
  >;
  releasePresenceLock: (scope: PresenceScope, targetId: string) => Promise<void>;
  releaseAllPresenceLocks: () => Promise<void>;
  ackTaskEndPrompt: (
    taskId: string,
    scheduledEndAt: string,
    ifVersion?: number
  ) => Promise<{ accepted: boolean; task?: Task }>;
  pullTasks: () => Promise<void>;
  pushTasks: () => Promise<void>;
}

const CLOUD_POLL_INTERVAL_MS = 2500;
const CLOUD_CONNECTED_HEARTBEAT_POLL_MS = 3000;
const PRESENCE_HEARTBEAT_TTL_MS = 16000;

function buildSessionId() {
  return `session_${Math.random().toString(36).slice(2, 10)}`;
}

function toPresenceKey(scope: PresenceScope, targetId: string) {
  return `${scope}:${targetId}`;
}

const CloudSyncContext = createContext<CloudSyncContextType | undefined>(undefined);

function loadStoredToken() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function loadStoredRefreshToken() {
  try {
    return localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function loadStoredOrgId() {
  try {
    return localStorage.getItem(ORG_STORAGE_KEY);
  } catch {
    return null;
  }
}

function loadStoredAutoSync() {
  try {
    const stored = localStorage.getItem(AUTO_SYNC_STORAGE_KEY);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

function cloneTask(task: Task): Task {
  return {
    ...task,
    subtasks: task.subtasks.map((subtask) => ({ ...subtask })),
  };
}

function cloneTasks(tasks: Task[]): Task[] {
  return tasks.map(cloneTask);
}

function normalizeOrgRole(role: string | null | undefined): CloudOrgRole | null {
  if (role === 'owner' || role === 'admin' || role === 'member' || role === 'viewer') {
    return role;
  }
  return null;
}

function computeTaskHash(tasks: Task[]) {
  return JSON.stringify(
    tasks.map((task) => ({
      ...task,
      subtasks: task.subtasks.map((subtask) => ({ ...subtask })),
    }))
  );
}

function upsertTaskById(tasks: Task[], task: Task): Task[] {
  const existingIndex = tasks.findIndex((entry) => entry.id === task.id);
  if (existingIndex === -1) {
    return [...tasks, cloneTask(task)];
  }
  const next = cloneTasks(tasks);
  next[existingIndex] = cloneTask(task);
  return next;
}

function executionFingerprint(task: Task) {
  return JSON.stringify({
    completed: Boolean(task.completed),
    executionStatus: task.executionStatus ?? null,
    actualMinutes: Math.round(Number(task.actualMinutes ?? 0) * 1000) / 1000,
    lastStartAt: task.lastStartAt ?? null,
    completedAt: task.completedAt ?? null,
    lastEndPromptAt: task.lastEndPromptAt ?? task.lastPromptAt ?? null,
  });
}

function hasExecutionStateDelta(baseTasks: Task[], localTasks: Task[]) {
  const baseById = new Map(baseTasks.map((task) => [task.id, task]));
  return localTasks.some((task) => {
    const base = baseById.get(task.id);
    if (!base) return false;
    return executionFingerprint(base) !== executionFingerprint(task);
  });
}

function hasSyncableTaskDelta(baseTasks: Task[], localTasks: Task[], conflictTaskIds: Set<string>) {
  const baseById = new Map(baseTasks.map((task) => [task.id, task]));
  const localById = new Map(localTasks.map((task) => [task.id, task]));

  for (const localTask of localTasks) {
    if (conflictTaskIds.has(localTask.id)) continue;
    const baseTask = baseById.get(localTask.id);
    if (!baseTask) return true;
    if (!areTasksEquivalentForSync(localTask, baseTask)) return true;
  }

  for (const baseTask of baseTasks) {
    if (conflictTaskIds.has(baseTask.id)) continue;
    if (!localById.has(baseTask.id)) return true;
  }

  return false;
}

function getTaskStatus(task: Task): 'scheduled' | 'inbox' {
  return task.status ?? (task.startDateTime ? 'scheduled' : 'inbox');
}

function toTaskPayload(task: Task) {
  return {
    id: task.id,
    title: task.title,
    description: task.description ?? '',
    startDateTime: task.startDateTime,
    durationMinutes: task.durationMinutes,
    timeZone: task.timeZone,
    completed: task.completed,
    color: task.color,
    subtasks: task.subtasks.map((subtask) => ({
      id: subtask.id,
      title: subtask.title,
      completed: subtask.completed,
    })),
    type: task.type,
    assignedTo: task.assignedTo,
    status: getTaskStatus(task),
    focus: Boolean(task.focus),
    executionStatus: task.executionStatus,
    actualMinutes: task.actualMinutes,
    lastStartAt: task.lastStartAt,
    completedAt: task.completedAt,
    lastEndPromptAt: task.lastEndPromptAt ?? task.lastPromptAt,
    lastPromptAt: task.lastEndPromptAt ?? task.lastPromptAt,
  };
}

function conflictFromError(error: unknown): { serverTask: Task; code?: string } | null {
  if (!(error instanceof CloudRequestError) || error.status !== 409) return null;
  if (!error.payload || typeof error.payload !== 'object') return null;

  const payload = error.payload as { serverTask?: Task; code?: string };
  if (!payload.serverTask) return null;
  return { serverTask: payload.serverTask, code: payload.code };
}

function presenceConflictFromError(
  error: unknown
): { conflict?: PresenceLock; locks?: PresenceLock[]; takeoverAllowed?: boolean } | null {
  if (!(error instanceof CloudRequestError) || (error.status !== 409 && error.status !== 423)) {
    return null;
  }
  if (!error.payload || typeof error.payload !== 'object') return null;

  const payload = error.payload as {
    lock?: PresenceLock;
    locks?: PresenceLock[];
    takeoverAllowed?: boolean;
  };
  return {
    conflict: payload.lock,
    locks: Array.isArray(payload.locks) ? payload.locks : undefined,
    takeoverAllowed: Boolean(payload.takeoverAllowed),
  };
}

function upsertConflict(conflicts: SyncConflict[], nextConflict: SyncConflict): SyncConflict[] {
  const withoutExisting = conflicts.filter((conflict) => conflict.taskId !== nextConflict.taskId);
  return [...withoutExisting, nextConflict];
}

function cloneFieldValue<T>(value: T): T {
  if (value === undefined || value === null) return value;
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function extractCloudErrorCode(error: unknown): string | null {
  if (!(error instanceof CloudRequestError)) return null;
  if (!error.payload || typeof error.payload !== 'object') return null;
  const payload = error.payload as { code?: string };
  return typeof payload.code === 'string' && payload.code.length > 0 ? payload.code : null;
}

function toCloudSyncIssue(
  operation: string,
  error: unknown,
  fallbackMessage: string
): CloudSyncIssue {
  const status = error instanceof CloudRequestError ? error.status : null;
  const requestId = error instanceof CloudRequestError ? error.requestId : null;
  const message = error instanceof Error ? error.message : fallbackMessage;
  return {
    operation,
    message,
    status,
    code: extractCloudErrorCode(error),
    requestId,
    occurredAt: Date.now(),
  };
}

export function CloudSyncProvider({
  children,
  mode,
}: {
  children: React.ReactNode;
  mode: PlannerMode;
}) {
  const { tasks, replaceTasks } = useTasks();
  const [token, setToken] = useState<string | null>(() => loadStoredToken());
  const [refreshToken, setRefreshToken] = useState<string | null>(() => loadStoredRefreshToken());
  const [user, setUser] = useState<CloudUser | null>(null);
  const [orgs, setOrgs] = useState<CloudOrg[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(() => loadStoredOrgId());
  const [syncing, setSyncing] = useState(false);
  const [autoSync, setAutoSyncState] = useState<boolean>(() => loadStoredAutoSync());
  const [error, setError] = useState<string | null>(null);
  const [lastSyncIssue, setLastSyncIssue] = useState<CloudSyncIssue | null>(null);
  const [realtimeState, setRealtimeState] = useState<RealtimeState>('disconnected');
  const [pollingActive, setPollingActive] = useState(false);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [presenceLocks, setPresenceLocks] = useState<PresenceLock[]>([]);
  const conflictEnteredAtRef = useRef<Map<string, number>>(new Map());
  const skipNextPushRef = useRef(false);
  const lastSyncedHashRef = useRef<string | null>(null);
  const pushTimerRef = useRef<number | null>(null);
  const pendingPushRef = useRef(false);
  const pushQueuedRef = useRef(false);
  const pollingRef = useRef<number | null>(null);
  const tasksRef = useRef<Task[]>(tasks);
  const replaceTasksRef = useRef(replaceTasks);
  const serverTasksRef = useRef<Task[]>([]);
  const hasPulledOrgRef = useRef<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const realtimePullTimerRef = useRef<number | null>(null);
  const sseReconnectTimerRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string>(buildSessionId());
  const claimedPresenceKeysRef = useRef<Set<string>>(new Set());
  const tokenRef = useRef<string | null>(token);
  const refreshTokenRef = useRef<string | null>(refreshToken);

  const cloudModeEnabled = CLOUD_SYNC_ENABLED && mode === 'cloud';
  const enabled = cloudModeEnabled && Boolean(token);
  const hasUnsyncedLocalChanges = useCallback(() => {
    if (lastSyncedHashRef.current === null) return false;
    return computeTaskHash(tasksRef.current) !== lastSyncedHashRef.current;
  }, []);
  const clearSyncIssue = useCallback(() => {
    setError(null);
    setLastSyncIssue(null);
  }, []);
  const setSyncIssue = useCallback((operation: string, err: unknown, fallbackMessage: string) => {
    const issue = toCloudSyncIssue(operation, err, fallbackMessage);
    setError(issue.message);
    setLastSyncIssue(issue);
    recordOperationalEvent({
      eventType: 'sync.fail',
      status: issue.status ?? undefined,
      code: issue.code,
      metadata: {
        operation,
      },
    });
    return issue;
  }, []);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    replaceTasksRef.current = replaceTasks;
  }, [replaceTasks]);

  const performTokenRefresh = useCallback(async () => {
    if (!cloudModeEnabled) return null;
    const currentRefresh = refreshTokenRef.current;
    if (!currentRefresh) return null;

    try {
      const payload = await cloudRequest<{
        token?: string;
        accessToken?: string;
        refreshToken?: string;
        user?: CloudUser;
      }>('/api/auth/refresh', {
        method: 'POST',
        body: { refreshToken: currentRefresh },
      });
      const nextAccessToken = payload.accessToken ?? payload.token ?? null;
      if (!nextAccessToken) return null;
      setToken(nextAccessToken);
      if (payload.refreshToken) {
        setRefreshToken(payload.refreshToken);
      }
      if (payload.user) {
        setUser(payload.user);
      }
      return nextAccessToken;
    } catch {
      setToken(null);
      setRefreshToken(null);
      setUser(null);
      setOrgs([]);
      setMembers([]);
      setActiveOrgIdState(null);
      setPresenceLocks([]);
      hasPulledOrgRef.current = null;
      serverTasksRef.current = [];
      claimedPresenceKeysRef.current.clear();
      return null;
    }
  }, [cloudModeEnabled]);

  const requestWithToken = useCallback(
    async <T,>(
      path: string,
      options: {
        method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
        body?: unknown;
        headers?: Record<string, string>;
      } = {}
    ) => {
      const activeToken = tokenRef.current;
      if (!activeToken) {
        throw new Error('Cloud token is missing.');
      }

      const method = options.method ?? 'GET';
      const requestHeaders: Record<string, string> = {
        ...(options.headers ?? {}),
      };
      if (method !== 'GET' && !requestHeaders['X-Taskable-Session-Id']) {
        requestHeaders['X-Taskable-Session-Id'] = sessionIdRef.current;
      }

      try {
        return await cloudRequest<T>(path, {
          ...options,
          method,
          headers: requestHeaders,
          token: activeToken,
        });
      } catch (error) {
        if (!(error instanceof CloudRequestError) || error.status !== 401) {
          throw error;
        }

        const refreshedToken = await performTokenRefresh();
        if (!refreshedToken) {
          throw error;
        }

        return cloudRequest<T>(path, {
          ...options,
          method,
          headers: requestHeaders,
          token: refreshedToken,
        });
      }
    },
    [performTokenRefresh]
  );

  const logOperationalEvent = useCallback(
    async (
      eventType: string,
      payload: {
        durationMs?: number;
        value?: number;
        status?: number;
        code?: string | null;
        metadata?: Record<string, string | number | boolean | null>;
      } = {}
    ) => {
      recordOperationalEvent({
        eventType,
        durationMs: payload.durationMs,
        value: payload.value,
        status: payload.status,
        code: payload.code ?? undefined,
        metadata: payload.metadata,
      });

      if (!enabled || !activeOrgId || !tokenRef.current) return;
      try {
        await requestWithToken('/api/ops/events', {
          method: 'POST',
          body: {
            orgId: activeOrgId,
            eventType,
            durationMs: payload.durationMs,
            value: payload.value,
            status: payload.status,
            code: payload.code,
            metadata: payload.metadata,
          },
        });
      } catch {
        // telemetry shipping is best-effort
      }
    },
    [activeOrgId, enabled, requestWithToken]
  );

  const recordConflictResolved = useCallback(
    (conflict: SyncConflict, strategy: 'keep_mine' | 'keep_theirs' | 'merge') => {
      const startedAt =
        conflictEnteredAtRef.current.get(conflict.taskId) ?? conflict.createdAt ?? Date.now();
      const durationMs = Math.max(0, Date.now() - startedAt);
      conflictEnteredAtRef.current.delete(conflict.taskId);
      void logOperationalEvent('conflict_resolved', {
        durationMs,
        metadata: {
          taskId: conflict.taskId,
          strategy,
          fieldCount: conflict.conflictingFields.length,
        },
      });
    },
    [logOperationalEvent]
  );

  useEffect(() => {
    tokenRef.current = token;
    try {
      if (token) {
        localStorage.setItem(TOKEN_STORAGE_KEY, token);
      } else {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    } catch {
      // ignore storage errors
    }
    notifyAuthStorageUpdated();
  }, [token]);

  useEffect(() => {
    refreshTokenRef.current = refreshToken;
    try {
      if (refreshToken) {
        localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, refreshToken);
      } else {
        localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
      }
    } catch {
      // ignore storage errors
    }
    notifyAuthStorageUpdated();
  }, [refreshToken]);

  useEffect(() => {
    const activeTaskIds = new Set<string>();
    conflicts.forEach((conflict) => {
      activeTaskIds.add(conflict.taskId);
      if (conflictEnteredAtRef.current.has(conflict.taskId)) return;
      const startedAt = conflict.createdAt || Date.now();
      conflictEnteredAtRef.current.set(conflict.taskId, startedAt);
      void logOperationalEvent('conflict_entered', {
        metadata: {
          taskId: conflict.taskId,
          fieldCount: conflict.conflictingFields.length,
        },
      });
    });

    Array.from(conflictEnteredAtRef.current.keys()).forEach((taskId) => {
      if (activeTaskIds.has(taskId)) return;
      conflictEnteredAtRef.current.delete(taskId);
    });
  }, [conflicts, logOperationalEvent]);

  useEffect(() => {
    try {
      if (activeOrgId) {
        localStorage.setItem(ORG_STORAGE_KEY, activeOrgId);
      } else {
        localStorage.removeItem(ORG_STORAGE_KEY);
      }
    } catch {
      // ignore storage errors
    }
    notifyAuthStorageUpdated();
  }, [activeOrgId]);

  useEffect(() => {
    try {
      localStorage.setItem(AUTO_SYNC_STORAGE_KEY, String(autoSync));
    } catch {
      // ignore storage errors
    }
  }, [autoSync]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea !== localStorage) return;
      if (!event.key) return;

      if (event.key === TOKEN_STORAGE_KEY) {
        const nextToken = event.newValue;
        setToken((previous) => (previous === nextToken ? previous : nextToken));
        if (!nextToken) {
          setUser(null);
          setOrgs([]);
          setMembers([]);
          setActiveOrgIdState(null);
          setPresenceLocks([]);
          setConflicts([]);
          hasPulledOrgRef.current = null;
          serverTasksRef.current = [];
          claimedPresenceKeysRef.current.clear();
        }
        return;
      }

      if (event.key === REFRESH_TOKEN_STORAGE_KEY) {
        const nextRefresh = event.newValue;
        setRefreshToken((previous) => (previous === nextRefresh ? previous : nextRefresh));
        return;
      }

      if (event.key === ORG_STORAGE_KEY) {
        const nextOrgId = event.newValue;
        setActiveOrgIdState((previous) => (previous === nextOrgId ? previous : nextOrgId));
        return;
      }

      if (event.key === AUTO_SYNC_STORAGE_KEY) {
        const nextAutoSync = event.newValue === null ? true : event.newValue === 'true';
        setAutoSyncState((previous) => (previous === nextAutoSync ? previous : nextAutoSync));
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const refreshSession = useCallback(async () => {
    if (!cloudModeEnabled) return;
    if (!tokenRef.current) {
      const refreshed = await performTokenRefresh();
      if (!refreshed) return;
    }

    setSyncing(true);
    clearSyncIssue();

    try {
      const mePayload = await requestWithToken<{ user: CloudUser; orgs: CloudOrg[] }>('/api/me');
      setUser(mePayload.user);
      setOrgs(mePayload.orgs);

      const selectedOrg =
        mePayload.orgs.find((org) => org.id === activeOrgId)?.id ?? mePayload.orgs[0]?.id ?? null;
      setActiveOrgIdState(selectedOrg);
    } catch (err) {
      setSyncIssue('session.refresh', err, 'Cloud session refresh failed.');
      setToken(null);
      setRefreshToken(null);
      setUser(null);
      setOrgs([]);
      setMembers([]);
      setPresenceLocks([]);
      setActiveOrgIdState(null);
      hasPulledOrgRef.current = null;
      serverTasksRef.current = [];
      claimedPresenceKeysRef.current.clear();
    } finally {
      setSyncing(false);
    }
  }, [
    cloudModeEnabled,
    requestWithToken,
    activeOrgId,
    performTokenRefresh,
    clearSyncIssue,
    setSyncIssue,
  ]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (!enabled || !token) return;
    void refreshSession();
  }, [enabled, token, refreshSession]);

  const login = useCallback(
    async (email: string, password: string, options?: CloudLoginOptions) => {
      if (!cloudModeEnabled) return;
      setSyncing(true);
      clearSyncIssue();
      try {
        const payload = await cloudRequest<{
          token?: string;
          accessToken?: string;
          refreshToken?: string;
          user: CloudUser;
        }>('/api/auth/login', {
          method: 'POST',
          body: {
            email,
            password,
            ...(options?.mfaTicket ? { mfaTicket: options.mfaTicket } : {}),
            ...(options?.mfaCode ? { mfaCode: options.mfaCode } : {}),
          },
        });
        const nextToken = payload.accessToken ?? payload.token ?? null;
        if (!nextToken) {
          throw new Error('Cloud login response did not include an access token.');
        }
        setToken(nextToken);
        setRefreshToken(payload.refreshToken ?? null);
        setUser(payload.user);
      } catch (err) {
        setSyncIssue('auth.login', err, 'Login failed.');
        throw err;
      } finally {
        setSyncing(false);
      }
    },
    [cloudModeEnabled, clearSyncIssue, setSyncIssue]
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      if (!cloudModeEnabled) return;
      setSyncing(true);
      clearSyncIssue();
      try {
        const payload = await cloudRequest<{
          token?: string;
          accessToken?: string;
          refreshToken?: string;
          user: CloudUser;
          defaultOrgId?: string;
        }>('/api/auth/register', {
          method: 'POST',
          body: { name, email, password },
        });
        const nextToken = payload.accessToken ?? payload.token ?? null;
        if (!nextToken) {
          throw new Error('Cloud register response did not include an access token.');
        }
        setToken(nextToken);
        setRefreshToken(payload.refreshToken ?? null);
        setUser(payload.user);
        if (payload.defaultOrgId) {
          setActiveOrgIdState(payload.defaultOrgId);
        }
      } catch (err) {
        setSyncIssue('auth.register', err, 'Registration failed.');
        throw err;
      } finally {
        setSyncing(false);
      }
    },
    [cloudModeEnabled, clearSyncIssue, setSyncIssue]
  );

  const logout = useCallback(() => {
    const currentRefresh = refreshTokenRef.current;
    if (currentRefresh) {
      void cloudRequest('/api/auth/logout', {
        method: 'POST',
        body: { refreshToken: currentRefresh },
      }).catch(() => undefined);
    }

    if (enabled && tokenRef.current && activeOrgId && claimedPresenceKeysRef.current.size > 0) {
      void cloudRequest<{ released: boolean; locks: PresenceLock[] }>(
        `/api/orgs/${activeOrgId}/presence/release-all`,
        {
          method: 'POST',
          token: tokenRef.current,
          body: {
            sessionId: sessionIdRef.current,
          },
        }
      ).catch(() => undefined);
    }
    setToken(null);
    setRefreshToken(null);
    setUser(null);
    setOrgs([]);
    setMembers([]);
    setPresenceLocks([]);
    setActiveOrgIdState(null);
    clearSyncIssue();
    setConflicts([]);
    setRealtimeState('disconnected');
    hasPulledOrgRef.current = null;
    serverTasksRef.current = [];
    lastSyncedHashRef.current = null;
    claimedPresenceKeysRef.current.clear();
  }, [enabled, activeOrgId, clearSyncIssue]);

  const resendVerification = useCallback(
    async (email?: string) => {
      if (!cloudModeEnabled) return;
      const targetEmail = email ?? user?.email;
      if (!targetEmail) {
        throw new Error('Email is required.');
      }
      await cloudRequest('/api/auth/resend-verification', {
        method: 'POST',
        body: { email: targetEmail },
      });
    },
    [cloudModeEnabled, user?.email]
  );

  const verifyEmailToken = useCallback(
    async (verificationToken: string) => {
      if (!cloudModeEnabled) return;
      await cloudRequest('/api/auth/verify-email', {
        method: 'POST',
        body: { token: verificationToken },
      });
      await refreshSession();
    },
    [cloudModeEnabled, refreshSession]
  );

  const requestPasswordReset = useCallback(
    async (email: string) => {
      if (!cloudModeEnabled) return;
      await cloudRequest('/api/auth/request-password-reset', {
        method: 'POST',
        body: { email },
      });
    },
    [cloudModeEnabled]
  );

  const resetPassword = useCallback(
    async (resetToken: string, newPassword: string) => {
      if (!cloudModeEnabled) return;
      await cloudRequest('/api/auth/reset-password', {
        method: 'POST',
        body: { token: resetToken, password: newPassword },
      });
      logout();
    },
    [cloudModeEnabled, logout]
  );

  const startMfaEnrollment = useCallback(async () => {
    if (!enabled || !tokenRef.current) {
      throw new Error('You must be signed in to configure MFA.');
    }
    setSyncing(true);
    clearSyncIssue();
    try {
      const payload = await requestWithToken<{ mfa: MfaEnrollmentSetup }>(
        '/api/auth/mfa/enroll/start',
        {
          method: 'POST',
        }
      );
      return payload.mfa;
    } catch (err) {
      setSyncIssue('auth.mfa.start', err, 'Failed to start MFA enrollment.');
      throw err;
    } finally {
      setSyncing(false);
    }
  }, [enabled, requestWithToken, clearSyncIssue, setSyncIssue]);

  const confirmMfaEnrollment = useCallback(
    async (code: string) => {
      if (!enabled || !tokenRef.current) {
        throw new Error('You must be signed in to configure MFA.');
      }
      setSyncing(true);
      clearSyncIssue();
      try {
        const payload = await requestWithToken<{ user?: CloudUser }>(
          '/api/auth/mfa/enroll/confirm',
          {
            method: 'POST',
            body: { code },
          }
        );
        if (payload.user) {
          setUser(payload.user);
        } else {
          await refreshSession();
        }
      } catch (err) {
        setSyncIssue('auth.mfa.confirm', err, 'Failed to confirm MFA enrollment.');
        throw err;
      } finally {
        setSyncing(false);
      }
    },
    [enabled, refreshSession, requestWithToken, clearSyncIssue, setSyncIssue]
  );

  const disableMfa = useCallback(
    async (code: string) => {
      if (!enabled || !tokenRef.current) {
        throw new Error('You must be signed in to configure MFA.');
      }
      setSyncing(true);
      clearSyncIssue();
      try {
        const payload = await requestWithToken<{ user?: CloudUser }>('/api/auth/mfa/disable', {
          method: 'POST',
          body: { code },
        });
        if (payload.user) {
          setUser(payload.user);
        } else {
          await refreshSession();
        }
      } catch (err) {
        setSyncIssue('auth.mfa.disable', err, 'Failed to disable MFA.');
        throw err;
      } finally {
        setSyncing(false);
      }
    },
    [enabled, refreshSession, requestWithToken, clearSyncIssue, setSyncIssue]
  );

  const refreshMembers = useCallback(async () => {
    if (!enabled || !tokenRef.current || !activeOrgId) return;
    try {
      const payload = await requestWithToken<{
        members: Array<{ id: string; name: string; email?: string; role?: string }>;
      }>(`/api/orgs/${activeOrgId}/members`);
      setMembers(
        payload.members.map((member) => ({
          id: member.id,
          name: member.name,
          email: member.email,
          role: member.role,
        }))
      );
    } catch (err) {
      setSyncIssue('members.refresh', err, 'Failed to refresh members.');
      throw err;
    }
  }, [enabled, activeOrgId, requestWithToken, setSyncIssue]);

  const addMemberByEmail = useCallback(
    async (email: string) => {
      if (!enabled || !tokenRef.current || !activeOrgId) return;
      await requestWithToken(`/api/orgs/${activeOrgId}/members`, {
        method: 'POST',
        body: { email },
      });
      await refreshMembers();
    },
    [enabled, activeOrgId, requestWithToken, refreshMembers]
  );

  const updateMemberRole = useCallback(
    async (memberId: string, role: 'owner' | 'admin' | 'member' | 'viewer') => {
      if (!enabled || !tokenRef.current || !activeOrgId) return;
      await requestWithToken(`/api/orgs/${activeOrgId}/members/${memberId}`, {
        method: 'PATCH',
        body: { role },
      });
      await refreshMembers();
    },
    [enabled, activeOrgId, requestWithToken, refreshMembers]
  );

  const removeMember = useCallback(
    async (memberId: string) => {
      if (!enabled || !tokenRef.current || !activeOrgId) return;
      await requestWithToken(`/api/orgs/${activeOrgId}/members/${memberId}`, {
        method: 'DELETE',
      });
      await refreshMembers();
    },
    [enabled, activeOrgId, requestWithToken, refreshMembers]
  );

  const refreshPresence = useCallback(async () => {
    if (!enabled || !tokenRef.current || !activeOrgId) return;
    try {
      const payload = await requestWithToken<{ locks: PresenceLock[] }>(
        `/api/orgs/${activeOrgId}/presence`
      );
      setPresenceLocks(Array.isArray(payload.locks) ? payload.locks : []);
    } catch (err) {
      setSyncIssue('presence.refresh', err, 'Failed to refresh presence.');
      throw err;
    }
  }, [enabled, activeOrgId, requestWithToken, setSyncIssue]);

  const claimPresenceLock = useCallback(
    async (scope: PresenceScope, targetId: string, options: ClaimPresenceLockOptions = {}) => {
      if (!enabled || !tokenRef.current || !activeOrgId || !targetId) {
        return { ok: false as const };
      }

      try {
        const payload = await requestWithToken<{
          lock: PresenceLock;
          locks: PresenceLock[];
          takenOver?: boolean;
        }>(`/api/orgs/${activeOrgId}/presence/claim`, {
          method: 'POST',
          body: {
            scope,
            targetId,
            sessionId: sessionIdRef.current,
            ttlMs: PRESENCE_HEARTBEAT_TTL_MS,
            forceTakeover: Boolean(options.forceTakeover),
          },
        });
        setPresenceLocks(Array.isArray(payload.locks) ? payload.locks : []);
        claimedPresenceKeysRef.current.add(toPresenceKey(scope, targetId));
        return { ok: true as const, lock: payload.lock, takenOver: Boolean(payload.takenOver) };
      } catch (error) {
        const conflictPayload = presenceConflictFromError(error);
        if (conflictPayload) {
          if (Array.isArray(conflictPayload.locks)) {
            setPresenceLocks(conflictPayload.locks);
          }
          return {
            ok: false as const,
            conflict: conflictPayload.conflict,
            takeoverAllowed: conflictPayload.takeoverAllowed,
          };
        }

        const message = error instanceof Error ? error.message : 'Failed to claim edit lock.';
        setSyncIssue('presence.claim', error, message);
        return { ok: false as const };
      }
    },
    [enabled, activeOrgId, requestWithToken, setSyncIssue]
  );

  const releasePresenceLock = useCallback(
    async (scope: PresenceScope, targetId: string) => {
      if (!enabled || !tokenRef.current || !activeOrgId || !targetId) return;

      try {
        const payload = await requestWithToken<{ released: boolean; locks: PresenceLock[] }>(
          `/api/orgs/${activeOrgId}/presence/release`,
          {
            method: 'POST',
            body: {
              scope,
              targetId,
              sessionId: sessionIdRef.current,
            },
          }
        );
        setPresenceLocks(Array.isArray(payload.locks) ? payload.locks : []);
      } catch {
        // best-effort release
      } finally {
        claimedPresenceKeysRef.current.delete(toPresenceKey(scope, targetId));
      }
    },
    [enabled, activeOrgId, requestWithToken]
  );

  const releaseAllPresenceLocks = useCallback(async () => {
    if (!enabled || !tokenRef.current || !activeOrgId) return;
    if (claimedPresenceKeysRef.current.size === 0) return;

    try {
      const payload = await requestWithToken<{ released: boolean; locks: PresenceLock[] }>(
        `/api/orgs/${activeOrgId}/presence/release-all`,
        {
          method: 'POST',
          body: {
            sessionId: sessionIdRef.current,
          },
        }
      );
      setPresenceLocks(Array.isArray(payload.locks) ? payload.locks : []);
    } catch {
      // best-effort release
    } finally {
      claimedPresenceKeysRef.current.clear();
    }
  }, [enabled, activeOrgId, requestWithToken]);

  const ackTaskEndPrompt = useCallback(
    async (taskId: string, scheduledEndAt: string, ifVersion?: number) => {
      if (!enabled || !tokenRef.current || !activeOrgId || !taskId) {
        return { accepted: false as const };
      }

      try {
        const payload = await requestWithToken<{ accepted: boolean; task?: Task }>(
          `/api/orgs/${activeOrgId}/tasks/${taskId}/end-prompt`,
          {
            method: 'POST',
            body: {
              scheduledEndAt,
              ifVersion,
            },
          }
        );

        if (payload.task) {
          const currentTasks = cloneTasks(tasksRef.current);
          const nextTasks = upsertTaskById(currentTasks, payload.task);
          const nextHash = computeTaskHash(nextTasks);
          const currentHash = computeTaskHash(tasksRef.current);
          skipNextPushRef.current = currentHash !== nextHash;
          replaceTasksRef.current(nextTasks, { clearHistory: false });
          serverTasksRef.current = nextTasks;
          hasPulledOrgRef.current = activeOrgId;
          lastSyncedHashRef.current = nextHash;
        }

        return { accepted: Boolean(payload.accepted), task: payload.task };
      } catch (error) {
        if (error instanceof CloudRequestError && error.status === 409) {
          const conflict = conflictFromError(error);
          if (conflict?.serverTask) {
            const currentTasks = cloneTasks(tasksRef.current);
            const nextTasks = upsertTaskById(currentTasks, conflict.serverTask);
            const nextHash = computeTaskHash(nextTasks);
            const currentHash = computeTaskHash(tasksRef.current);
            skipNextPushRef.current = currentHash !== nextHash;
            replaceTasksRef.current(nextTasks, { clearHistory: false });
            serverTasksRef.current = nextTasks;
            hasPulledOrgRef.current = activeOrgId;
            lastSyncedHashRef.current = nextHash;
          }
        }
        const issue = setSyncIssue(
          'tasks.end-prompt-ack',
          error,
          'Failed to coordinate end-of-task prompt state.'
        );
        void logOperationalEvent('sync.fail', {
          status: issue.status ?? undefined,
          code: issue.code,
          metadata: {
            operation: 'end_prompt_ack',
          },
        });
        return { accepted: false as const };
      }
    },
    [enabled, activeOrgId, requestWithToken, setSyncIssue, logOperationalEvent]
  );

  const pullTasksInternal = useCallback(
    async (silent: boolean, options?: { force?: boolean }) => {
      if (!enabled || !tokenRef.current || !activeOrgId) return;
      const startedAt =
        typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
      const forcePull = Boolean(options?.force);
      if (!forcePull && pendingPushRef.current) return;
      if (silent && !forcePull && hasUnsyncedLocalChanges()) return;

      if (!silent) {
        setSyncing(true);
      }
      if (!silent) {
        clearSyncIssue();
      }

      try {
        const payload = await requestWithToken<{ tasks: Task[] }>(`/api/orgs/${activeOrgId}/tasks`);
        const nextTasks = cloneTasks(payload.tasks);
        const nextHash = computeTaskHash(nextTasks);
        const currentHash = computeTaskHash(tasksRef.current);
        serverTasksRef.current = nextTasks;
        hasPulledOrgRef.current = activeOrgId;
        skipNextPushRef.current = currentHash !== nextHash;
        replaceTasksRef.current(nextTasks, { clearHistory: true });
        lastSyncedHashRef.current = nextHash;
        const endedAt =
          typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
        void logOperationalEvent('sync.success', {
          durationMs: Math.max(0, endedAt - startedAt),
          metadata: {
            operation: 'pull',
          },
        });
      } catch (err) {
        const issue = setSyncIssue('tasks.pull', err, 'Failed to pull tasks from cloud.');
        void logOperationalEvent('sync.fail', {
          status: issue.status ?? undefined,
          code: issue.code,
          metadata: {
            operation: 'pull',
          },
        });
        throw err;
      } finally {
        if (!silent) {
          setSyncing(false);
        }
      }
    },
    [
      enabled,
      activeOrgId,
      hasUnsyncedLocalChanges,
      requestWithToken,
      clearSyncIssue,
      setSyncIssue,
      logOperationalEvent,
    ]
  );

  const pullTasks = useCallback(async () => {
    await pullTasksInternal(false, { force: true });
  }, [pullTasksInternal]);

  const pushTasks = useCallback(async () => {
    if (!enabled || !tokenRef.current || !activeOrgId) return;
    const startedAt =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    if (pendingPushRef.current) {
      pushQueuedRef.current = true;
      return;
    }

    pendingPushRef.current = true;
    setSyncing(true);
    clearSyncIssue();

    try {
      if (hasPulledOrgRef.current !== activeOrgId) {
        await pullTasksInternal(true, { force: true });
      }

      const baseTasks = cloneTasks(serverTasksRef.current);
      const localTasks = cloneTasks(tasksRef.current);
      const baseById = new Map(baseTasks.map((task) => [task.id, task]));
      const localById = new Map(localTasks.map((task) => [task.id, task]));
      const nextServerById = new Map(baseTasks.map((task) => [task.id, task]));
      const unresolved: SyncConflict[] = [];
      const conflictTaskIds = new Set(conflicts.map((conflict) => conflict.taskId));

      if (
        conflictTaskIds.size > 0 &&
        !hasSyncableTaskDelta(baseTasks, localTasks, conflictTaskIds)
      ) {
        // Avoid retry storms: unresolved conflict tasks are handled via explicit resolution actions.
        // Keep the current local hash so autosync does not requeue identical conflict-only pushes.
        lastSyncedHashRef.current = computeTaskHash(localTasks);
        return;
      }

      for (const localTask of localTasks) {
        if (conflictTaskIds.has(localTask.id)) {
          const knownServer = baseById.get(localTask.id);
          if (knownServer) {
            nextServerById.set(localTask.id, cloneTask(knownServer));
          }
          continue;
        }

        const baseTask = baseById.get(localTask.id);
        if (!baseTask) {
          try {
            const createdPayload = await requestWithToken<{ task: Task }>(
              `/api/orgs/${activeOrgId}/tasks`,
              {
                method: 'POST',
                body: toTaskPayload(localTask),
              }
            );
            nextServerById.set(createdPayload.task.id, cloneTask(createdPayload.task));
          } catch (error) {
            const conflict = conflictFromError(error);
            if (!conflict?.serverTask || conflict.code !== 'TASK_ALREADY_EXISTS') {
              throw error;
            }
            nextServerById.set(localTask.id, cloneTask(conflict.serverTask));
          }
          continue;
        }

        if (areTasksEquivalentForSync(localTask, baseTask)) {
          continue;
        }

        const ifVersion = baseTask.version ?? 1;
        try {
          const updatedPayload = await requestWithToken<{ task: Task }>(
            `/api/orgs/${activeOrgId}/tasks/${localTask.id}`,
            {
              method: 'PUT',
              body: {
                ...toTaskPayload(localTask),
                ifVersion,
              },
            }
          );
          nextServerById.set(localTask.id, cloneTask(updatedPayload.task));
        } catch (error) {
          if (error instanceof CloudRequestError && error.status === 404) {
            nextServerById.delete(baseTask.id);
            continue;
          }
          const conflict = conflictFromError(error);
          if (!conflict?.serverTask) {
            throw error;
          }

          const mergeResult = autoMergeTask(baseTask, localTask, conflict.serverTask);
          if (mergeResult.conflicts.length === 0) {
            const mergedPayload = await requestWithToken<{ task: Task }>(
              `/api/orgs/${activeOrgId}/tasks/${localTask.id}`,
              {
                method: 'PUT',
                body: {
                  ...toTaskPayload(mergeResult.mergedTask),
                  ifVersion: conflict.serverTask.version ?? 1,
                },
              }
            );
            nextServerById.set(localTask.id, cloneTask(mergedPayload.task));
            continue;
          }

          unresolved.push({
            taskId: localTask.id,
            title: localTask.title,
            localTask: cloneTask(localTask),
            baseTask: cloneTask(baseTask),
            serverTask: cloneTask(conflict.serverTask),
            conflictingFields: mergeResult.conflicts,
            createdAt: Date.now(),
          });
          nextServerById.set(localTask.id, cloneTask(conflict.serverTask));
        }
      }

      for (const baseTask of baseTasks) {
        if (conflictTaskIds.has(baseTask.id)) continue;
        if (localById.has(baseTask.id)) continue;
        try {
          await requestWithToken(
            `/api/orgs/${activeOrgId}/tasks/${baseTask.id}?ifVersion=${baseTask.version ?? 1}`,
            {
              method: 'DELETE',
            }
          );
          nextServerById.delete(baseTask.id);
        } catch (error) {
          const conflict = conflictFromError(error);
          if (!conflict?.serverTask) {
            throw error;
          }

          unresolved.push({
            taskId: baseTask.id,
            title: baseTask.title,
            localTask: cloneTask(baseTask),
            baseTask: cloneTask(baseTask),
            serverTask: cloneTask(conflict.serverTask),
            conflictingFields: ['delete'],
            createdAt: Date.now(),
          });
          nextServerById.set(baseTask.id, cloneTask(conflict.serverTask));
        }
      }

      serverTasksRef.current = Array.from(nextServerById.values());
      hasPulledOrgRef.current = activeOrgId;
      lastSyncedHashRef.current = computeTaskHash(serverTasksRef.current);

      if (unresolved.length > 0) {
        setConflicts((previous) =>
          unresolved.reduce((acc, conflict) => upsertConflict(acc, conflict), previous)
        );
        void logOperationalEvent('sync.conflict', {
          value: unresolved.length,
          metadata: {
            operation: 'push',
          },
        });
        const issue: CloudSyncIssue = {
          operation: 'tasks.push',
          message:
            'Cloud sync conflict detected. Open Settings > Integrations > Cloud Workspace to resolve.',
          status: 409,
          code: 'VERSION_CONFLICT',
          requestId: null,
          occurredAt: Date.now(),
        };
        setError(issue.message);
        setLastSyncIssue(issue);
      }

      await pullTasksInternal(true, { force: true });
      const endedAt =
        typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
      void logOperationalEvent('sync.success', {
        durationMs: Math.max(0, endedAt - startedAt),
        metadata: {
          operation: 'push',
        },
      });
    } catch (err) {
      const issue = setSyncIssue('tasks.push', err, 'Failed to push tasks to cloud.');
      void logOperationalEvent('sync.fail', {
        status: issue.status ?? undefined,
        code: issue.code,
        metadata: {
          operation: 'push',
        },
      });
      throw err;
    } finally {
      pendingPushRef.current = false;
      setSyncing(false);
      if (pushQueuedRef.current) {
        pushQueuedRef.current = false;
        void pushTasks().catch(() => undefined);
      }
    }
  }, [
    enabled,
    activeOrgId,
    conflicts,
    pullTasksInternal,
    requestWithToken,
    clearSyncIssue,
    setSyncIssue,
    logOperationalEvent,
  ]);

  const logConflictResolution = useCallback(
    async (
      conflict: SyncConflict,
      strategy: 'keep_mine' | 'keep_theirs' | 'merge',
      fields?: Array<SyncField | 'delete' | 'manual'>
    ) => {
      if (!enabled || !activeOrgId || !tokenRef.current) return;
      try {
        await requestWithToken(
          `/api/orgs/${activeOrgId}/tasks/${conflict.taskId}/conflict-resolution`,
          {
            method: 'POST',
            body: {
              strategy,
              clientVersion: conflict.baseTask?.version ?? conflict.localTask.version ?? null,
              serverVersion: conflict.serverTask.version ?? null,
              fields: fields?.filter(Boolean),
            },
          }
        );
      } catch {
        // best-effort audit event logging
      }
    },
    [enabled, activeOrgId, requestWithToken]
  );

  const resolveConflictKeepMine = useCallback(
    async (taskId: string) => {
      if (!enabled || !tokenRef.current || !activeOrgId) return;
      const conflict = conflicts.find((entry) => entry.taskId === taskId);
      if (!conflict) return;

      setSyncing(true);
      clearSyncIssue();
      try {
        if (conflict.conflictingFields.includes('delete')) {
          await requestWithToken(
            `/api/orgs/${activeOrgId}/tasks/${taskId}?ifVersion=${conflict.serverTask.version ?? 1}`,
            {
              method: 'DELETE',
            }
          );
        } else {
          await requestWithToken<{ task: Task }>(`/api/orgs/${activeOrgId}/tasks/${taskId}`, {
            method: 'PUT',
            body: {
              ...toTaskPayload(conflict.localTask),
              ifVersion: conflict.serverTask.version ?? 1,
              conflictResolution: {
                strategy: 'keep_mine',
                fields: conflict.conflictingFields,
              },
            },
          });
        }

        setConflicts((previous) => previous.filter((entry) => entry.taskId !== taskId));
        recordConflictResolved(conflict, 'keep_mine');
        await logConflictResolution(conflict, 'keep_mine', conflict.conflictingFields);
        await pullTasksInternal(true, { force: true });
      } catch (error) {
        const conflictPayload = conflictFromError(error);
        if (!conflictPayload) {
          setSyncIssue('conflict.keep-mine', error, 'Failed to resolve conflict.');
          throw error;
        }

        const nextConflictingFields = getChangedFields(
          conflictPayload.serverTask,
          conflict.localTask
        );
        setConflicts((previous) =>
          upsertConflict(previous, {
            ...conflict,
            serverTask: cloneTask(conflictPayload.serverTask),
            conflictingFields:
              nextConflictingFields.length > 0 ? nextConflictingFields : ['manual'],
            createdAt: Date.now(),
          })
        );
      } finally {
        setSyncing(false);
      }
    },
    [
      enabled,
      activeOrgId,
      conflicts,
      logConflictResolution,
      recordConflictResolved,
      pullTasksInternal,
      requestWithToken,
      clearSyncIssue,
      setSyncIssue,
    ]
  );

  const resolveConflictKeepTheirs = useCallback(
    async (taskId: string) => {
      const conflict = conflicts.find((entry) => entry.taskId === taskId);
      if (!conflict) return;

      const existingTaskIndex = tasks.findIndex((task) => task.id === taskId);
      const nextTasks = cloneTasks(tasks);
      if (existingTaskIndex === -1) {
        nextTasks.push(cloneTask(conflict.serverTask));
      } else {
        nextTasks[existingTaskIndex] = cloneTask(conflict.serverTask);
      }

      const nextHash = computeTaskHash(nextTasks);
      const currentHash = computeTaskHash(tasksRef.current);
      skipNextPushRef.current = currentHash !== nextHash;
      replaceTasksRef.current(nextTasks, { clearHistory: false });
      serverTasksRef.current = nextTasks;
      hasPulledOrgRef.current = activeOrgId;
      lastSyncedHashRef.current = nextHash;
      setConflicts((previous) => previous.filter((entry) => entry.taskId !== taskId));
      recordConflictResolved(conflict, 'keep_theirs');
      await logConflictResolution(conflict, 'keep_theirs', conflict.conflictingFields);
      void pullTasksInternal(true, { force: true });
    },
    [
      activeOrgId,
      conflicts,
      logConflictResolution,
      pullTasksInternal,
      recordConflictResolved,
      tasks,
    ]
  );

  const resolveConflictMerge = useCallback(
    async (taskId: string, fieldChoices: Partial<Record<string, ConflictFieldChoice>> = {}) => {
      if (!enabled || !tokenRef.current || !activeOrgId) return;
      const conflict = conflicts.find((entry) => entry.taskId === taskId);
      if (!conflict) return;
      if (conflict.conflictingFields.includes('delete')) {
        throw new Error('Delete conflicts cannot be merged. Choose keep mine or keep theirs.');
      }

      setSyncing(true);
      clearSyncIssue();

      try {
        const mergeResult = autoMergeTask(
          conflict.baseTask,
          conflict.localTask,
          conflict.serverTask
        );
        const mergedTask = cloneTask(mergeResult.mergedTask);
        const mergedRecord = mergedTask as unknown as Record<string, unknown>;
        const localRecord = conflict.localTask as unknown as Record<string, unknown>;
        const serverRecord = conflict.serverTask as unknown as Record<string, unknown>;

        conflict.conflictingFields.forEach((field) => {
          if (field === 'delete') return;
          const choice = fieldChoices[field] ?? 'mine';
          mergedRecord[field] =
            choice === 'theirs'
              ? cloneFieldValue(serverRecord[field])
              : cloneFieldValue(localRecord[field]);
        });

        await requestWithToken<{ task: Task }>(`/api/orgs/${activeOrgId}/tasks/${taskId}`, {
          method: 'PUT',
          body: {
            ...toTaskPayload(mergedTask),
            ifVersion: conflict.serverTask.version ?? 1,
            conflictResolution: {
              strategy: 'merge',
              fields: conflict.conflictingFields,
            },
          },
        });

        setConflicts((previous) => previous.filter((entry) => entry.taskId !== taskId));
        recordConflictResolved(conflict, 'merge');
        await logConflictResolution(conflict, 'merge', conflict.conflictingFields);
        await pullTasksInternal(true, { force: true });
      } catch (error) {
        const conflictPayload = conflictFromError(error);
        if (!conflictPayload) {
          setSyncIssue('conflict.merge', error, 'Failed to merge conflict.');
          throw error;
        }

        const nextConflictingFields = getChangedFields(
          conflictPayload.serverTask,
          conflict.localTask
        );
        setConflicts((previous) =>
          upsertConflict(previous, {
            ...conflict,
            serverTask: cloneTask(conflictPayload.serverTask),
            conflictingFields:
              nextConflictingFields.length > 0 ? nextConflictingFields : ['manual'],
            createdAt: Date.now(),
          })
        );
      } finally {
        setSyncing(false);
      }
    },
    [
      enabled,
      activeOrgId,
      conflicts,
      logConflictResolution,
      recordConflictResolved,
      pullTasksInternal,
      requestWithToken,
      clearSyncIssue,
      setSyncIssue,
    ]
  );

  const dismissConflict = useCallback((taskId: string) => {
    setConflicts((previous) => previous.filter((entry) => entry.taskId !== taskId));
  }, []);

  useEffect(() => {
    if (!enabled || !tokenRef.current || !activeOrgId || !autoSync) return;

    if (skipNextPushRef.current) {
      skipNextPushRef.current = false;
      return;
    }

    const nextHash = computeTaskHash(tasks);
    if (nextHash === lastSyncedHashRef.current) return;
    const executionDelta = hasExecutionStateDelta(serverTasksRef.current, tasks);
    const debounceMs = executionDelta ? 140 : 900;

    if (pushTimerRef.current !== null) {
      window.clearTimeout(pushTimerRef.current);
    }

    pushTimerRef.current = window.setTimeout(() => {
      void pushTasks().catch(() => undefined);
      pushTimerRef.current = null;
    }, debounceMs);

    return () => {
      if (pushTimerRef.current !== null) {
        window.clearTimeout(pushTimerRef.current);
        pushTimerRef.current = null;
      }
    };
  }, [tasks, enabled, activeOrgId, autoSync, pushTasks]);

  useEffect(() => {
    if (!enabled || !tokenRef.current || !activeOrgId) return;
    void pullTasksInternal(true, { force: true });
  }, [enabled, activeOrgId, pullTasksInternal]);

  useEffect(() => {
    if (!enabled || !tokenRef.current || !activeOrgId) return;
    void refreshMembers();
  }, [enabled, activeOrgId, refreshMembers]);

  useEffect(() => {
    if (!enabled || !tokenRef.current || !activeOrgId) {
      setPresenceLocks([]);
      claimedPresenceKeysRef.current.clear();
      return;
    }
    void refreshPresence();
  }, [enabled, activeOrgId, refreshPresence]);

  useEffect(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    if (realtimePullTimerRef.current !== null) {
      window.clearTimeout(realtimePullTimerRef.current);
      realtimePullTimerRef.current = null;
    }

    if (sseReconnectTimerRef.current !== null) {
      window.clearTimeout(sseReconnectTimerRef.current);
      sseReconnectTimerRef.current = null;
    }

    const activeToken = tokenRef.current;
    if (
      !enabled ||
      !activeToken ||
      !activeOrgId ||
      !autoSync ||
      typeof EventSource === 'undefined'
    ) {
      setRealtimeState('disconnected');
      return;
    }

    let disposed = false;
    let reconnectAttempts = 0;

    const scheduleRealtimePull = () => {
      if (realtimePullTimerRef.current !== null) return;
      realtimePullTimerRef.current = window.setTimeout(() => {
        realtimePullTimerRef.current = null;
        if (pendingPushRef.current) return;
        void pullTasksInternal(true);
      }, 120);
    };

    const handleTaskChanged = () => {
      scheduleRealtimePull();
    };

    const handleMemberChanged = () => {
      void refreshMembers();
    };

    const handlePresenceChanged = (event: Event) => {
      const nextEvent = event as MessageEvent<string>;
      if (!nextEvent.data) {
        void refreshPresence();
        return;
      }

      try {
        const payload = JSON.parse(nextEvent.data) as { locks?: PresenceLock[] };
        if (Array.isArray(payload.locks)) {
          setPresenceLocks(payload.locks);
          return;
        }
      } catch {
        // ignore malformed payloads
      }
      void refreshPresence();
    };

    const handleConnected = (event: Event) => {
      const nextEvent = event as MessageEvent<string>;
      if (!nextEvent.data) return;
      try {
        const payload = JSON.parse(nextEvent.data) as { locks?: PresenceLock[] };
        if (Array.isArray(payload.locks)) {
          setPresenceLocks(payload.locks);
        }
      } catch {
        // ignore malformed payloads
      }
    };

    const teardownSource = () => {
      const source = eventSourceRef.current;
      if (!source) return;
      source.removeEventListener('task.changed', handleTaskChanged);
      source.removeEventListener('tasks.synced', handleTaskChanged);
      source.removeEventListener('member.changed', handleMemberChanged);
      source.removeEventListener('presence.changed', handlePresenceChanged);
      source.removeEventListener('connected', handleConnected);
      source.close();
      eventSourceRef.current = null;
    };

    const scheduleReconnect = () => {
      if (disposed || sseReconnectTimerRef.current !== null) return;
      reconnectAttempts += 1;
      const delayMs = Math.min(12000, 450 * 2 ** Math.min(6, reconnectAttempts));
      sseReconnectTimerRef.current = window.setTimeout(() => {
        sseReconnectTimerRef.current = null;
        void connectToStream();
      }, delayMs);
    };

    const connectToStream = async () => {
      if (disposed) return;
      setRealtimeState((previous) =>
        previous === 'connected' || previous === 'reconnecting' ? 'reconnecting' : 'connecting'
      );

      let streamTokenPayload: { streamToken: string } | null = null;
      try {
        streamTokenPayload = await requestWithToken<{ streamToken: string }>(
          `/api/orgs/${activeOrgId}/stream-token`,
          {
            method: 'POST',
            body: {
              sessionId: sessionIdRef.current,
            },
          }
        );
      } catch (error) {
        if (!disposed) {
          void logOperationalEvent('sse.reconnect', {
            code: error instanceof Error ? error.name : 'STREAM_TOKEN_REQUEST_FAILED',
            metadata: {
              transport: 'sse',
              stage: 'stream-token',
            },
          });
          scheduleReconnect();
        }
        return;
      }

      if (disposed || !streamTokenPayload?.streamToken) return;
      teardownSource();

      const streamUrl = getCloudSseUrl(`/api/orgs/${activeOrgId}/stream`, {
        sessionId: sessionIdRef.current,
        streamToken: streamTokenPayload.streamToken,
      });
      const source = new EventSource(streamUrl, { withCredentials: true });
      eventSourceRef.current = source;

      source.onopen = () => {
        reconnectAttempts = 0;
        setRealtimeState('connected');
        void logOperationalEvent('sse.connected', {
          metadata: {
            transport: 'sse',
          },
        });
        void refreshPresence();
      };

      source.onerror = () => {
        if (disposed) return;
        void logOperationalEvent('sse.reconnect', {
          metadata: {
            transport: 'sse',
            stage: 'stream',
          },
        });
        setRealtimeState((previous) => (previous === 'connected' ? 'reconnecting' : previous));
        teardownSource();
        scheduleReconnect();
      };

      source.addEventListener('task.changed', handleTaskChanged);
      source.addEventListener('tasks.synced', handleTaskChanged);
      source.addEventListener('member.changed', handleMemberChanged);
      source.addEventListener('presence.changed', handlePresenceChanged);
      source.addEventListener('connected', handleConnected);
    };

    void connectToStream();

    return () => {
      disposed = true;
      teardownSource();
      if (realtimePullTimerRef.current !== null) {
        window.clearTimeout(realtimePullTimerRef.current);
        realtimePullTimerRef.current = null;
      }
      if (sseReconnectTimerRef.current !== null) {
        window.clearTimeout(sseReconnectTimerRef.current);
        sseReconnectTimerRef.current = null;
      }
      setRealtimeState('disconnected');
    };
  }, [
    enabled,
    activeOrgId,
    autoSync,
    pullTasksInternal,
    refreshMembers,
    refreshPresence,
    token,
    requestWithToken,
    logOperationalEvent,
  ]);

  useEffect(() => {
    if (!enabled || !token || !activeOrgId || !autoSync) return;
    const intervalMs =
      realtimeState === 'connected' ? CLOUD_CONNECTED_HEARTBEAT_POLL_MS : CLOUD_POLL_INTERVAL_MS;
    setPollingActive(true);
    pollingRef.current = window.setInterval(() => {
      if (pendingPushRef.current) return;
      void pullTasksInternal(true);
      void refreshMembers();
      void refreshPresence();
    }, intervalMs);

    return () => {
      if (pollingRef.current !== null) {
        window.clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      setPollingActive(false);
    };
  }, [
    enabled,
    token,
    activeOrgId,
    autoSync,
    realtimeState,
    pullTasksInternal,
    refreshMembers,
    refreshPresence,
  ]);

  useEffect(() => {
    if (!enabled || !token || !activeOrgId || !autoSync) return;

    const syncNow = () => {
      if (pendingPushRef.current) return;
      void pullTasksInternal(true, { force: true });
      void refreshMembers();
      void refreshPresence();
    };

    const handleFocus = () => {
      syncNow();
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncNow();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled, token, activeOrgId, autoSync, pullTasksInternal, refreshMembers, refreshPresence]);

  useEffect(() => {
    if (!enabled || !token || !activeOrgId) return;

    return () => {
      void releaseAllPresenceLocks();
    };
  }, [enabled, token, activeOrgId, releaseAllPresenceLocks]);

  useEffect(() => {
    if (!enabled || !token || !activeOrgId) return;

    const handleBeforeUnload = () => {
      if (claimedPresenceKeysRef.current.size === 0) return;
      if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return;

      const url = `${CLOUD_API_BASE_URL}/api/orgs/${activeOrgId}/presence/release-all`;
      const payload = JSON.stringify({ sessionId: sessionIdRef.current });
      const body = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(url, body);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [enabled, token, activeOrgId]);

  const setActiveOrgId = useCallback(
    (orgId: string) => {
      if (orgId !== activeOrgId) {
        void releaseAllPresenceLocks();
      }
      setActiveOrgIdState(orgId);
      hasPulledOrgRef.current = null;
      serverTasksRef.current = [];
      lastSyncedHashRef.current = null;
      skipNextPushRef.current = false;
      setConflicts([]);
      setPresenceLocks([]);
    },
    [activeOrgId, releaseAllPresenceLocks]
  );

  const setAutoSync = useCallback((next: boolean) => {
    setAutoSyncState(next);
  }, []);

  const syncTransport: SyncTransport =
    realtimeState === 'connected' ? 'sse' : pollingActive ? 'polling' : 'disconnected';
  const activeOrgRole = normalizeOrgRole(orgs.find((org) => org.id === activeOrgId)?.role ?? null);
  const isCloudOrgMode = enabled && Boolean(token && activeOrgId);
  const canWriteTasks =
    !isCloudOrgMode ||
    activeOrgRole === 'owner' ||
    activeOrgRole === 'admin' ||
    activeOrgRole === 'member';
  const canDeleteTasks = !isCloudOrgMode || activeOrgRole === 'owner' || activeOrgRole === 'admin';
  const isTaskConflictLocked = useCallback(
    (taskId: string) => conflicts.some((conflict) => conflict.taskId === taskId),
    [conflicts]
  );
  const openConflictResolver = useCallback((taskId: string) => {
    requestOpenConflictResolver(taskId);
  }, []);

  const value = useMemo(
    () => ({
      enabled,
      token,
      user,
      orgs,
      members,
      activeOrgId,
      activeOrgRole,
      syncing,
      autoSync,
      error,
      lastSyncIssue,
      realtimeState,
      syncTransport,
      canWriteTasks,
      canDeleteTasks,
      isTaskConflictLocked,
      openConflictResolver,
      conflicts,
      presenceLocks,
      setAutoSync,
      setActiveOrgId,
      clearSyncIssue,
      login,
      register,
      logout,
      refreshSession,
      resendVerification,
      verifyEmailToken,
      requestPasswordReset,
      resetPassword,
      startMfaEnrollment,
      confirmMfaEnrollment,
      disableMfa,
      refreshMembers,
      addMemberByEmail,
      updateMemberRole,
      removeMember,
      resolveConflictKeepMine,
      resolveConflictKeepTheirs,
      resolveConflictMerge,
      dismissConflict,
      refreshPresence,
      claimPresenceLock,
      releasePresenceLock,
      releaseAllPresenceLocks,
      ackTaskEndPrompt,
      pullTasks,
      pushTasks,
    }),
    [
      enabled,
      token,
      user,
      orgs,
      members,
      activeOrgId,
      activeOrgRole,
      syncing,
      autoSync,
      error,
      lastSyncIssue,
      realtimeState,
      syncTransport,
      canWriteTasks,
      canDeleteTasks,
      isTaskConflictLocked,
      openConflictResolver,
      conflicts,
      presenceLocks,
      setAutoSync,
      setActiveOrgId,
      clearSyncIssue,
      login,
      register,
      logout,
      refreshSession,
      resendVerification,
      verifyEmailToken,
      requestPasswordReset,
      resetPassword,
      startMfaEnrollment,
      confirmMfaEnrollment,
      disableMfa,
      refreshMembers,
      addMemberByEmail,
      updateMemberRole,
      removeMember,
      resolveConflictKeepMine,
      resolveConflictKeepTheirs,
      resolveConflictMerge,
      dismissConflict,
      refreshPresence,
      claimPresenceLock,
      releasePresenceLock,
      releaseAllPresenceLocks,
      ackTaskEndPrompt,
      pullTasks,
      pushTasks,
    ]
  );

  useEffect(() => {
    if (!CLOUD_SYNC_TEST_HOOKS_ENABLED || typeof window === 'undefined') return;

    window.__taskableCloudSyncTest = {
      pullTasks: () => pullTasks(),
      pushTasks: () => pushTasks(),
      refreshSession: () => refreshSession(),
      getState: () => ({
        activeOrgId,
        autoSync,
        error,
        realtimeState,
        syncTransport,
        tokenAvailable: Boolean(tokenRef.current),
      }),
    };

    return () => {
      delete window.__taskableCloudSyncTest;
    };
  }, [
    activeOrgId,
    autoSync,
    error,
    pullTasks,
    pushTasks,
    realtimeState,
    refreshSession,
    syncTransport,
  ]);

  return <CloudSyncContext.Provider value={value}>{children}</CloudSyncContext.Provider>;
}

export function useCloudSync() {
  const context = useContext(CloudSyncContext);
  if (!context) {
    throw new Error('useCloudSync must be used within CloudSyncProvider');
  }
  return context;
}
