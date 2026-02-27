import { Outlet, Link, Navigate, useLocation, useNavigate } from 'react-router';
import { TaskProvider, useTasks } from '../context/TaskContext';
import { TeamMembersProvider } from '../context/TeamMembersContext';
import { WorkdayProvider } from '../context/WorkdayContext';
import { NotificationSettingsProvider } from '../context/NotificationSettingsContext';
import { CloudSyncProvider, useCloudSync } from '../context/CloudSyncContext';
import { UserPreferencesProvider, useUserPreferences } from '../context/UserPreferencesContext';
import { useOnboarding } from '../context/OnboardingContext';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { Minimize2, Users, User } from 'lucide-react';
import { Button } from './ui/button';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  desktopCloseCompact,
  desktopFocusMain,
  desktopToggleCompact,
  isDesktopShell,
} from '../services/desktopShell';
import { CLOUD_API_BASE_URL, CLOUD_SYNC_ENABLED } from '../services/cloudApi';
import { getDayKey, getDayKeyFromDateTime } from '../services/scheduling';
import { normalizeExecutionStatus } from '../services/taskTimer';
import type { PlannerMode } from '../services/authStorage';
import { readCloudTutorialCompleted } from '../services/authStorage';
import OnboardingTutorialModal from './onboarding/OnboardingTutorialModal';
import { resolveExecutionModeV1Flag, resolveLayoutV1Flag } from '../flags';
import { flushExecutionTelemetry } from '../services/executionTelemetry';

const AUTO_START_SESSION_STORAGE_KEY = 'taskable:auto-start-fired';

export default function Root() {
  const location = useLocation();
  const { mode, isCloudAuthenticated } = useOnboarding();
  const layoutV1Enabled = resolveLayoutV1Flag();
  const isTeamView = location.pathname === '/team';
  const isCompactRoute = location.pathname === '/compact';
  const returnTo = `${location.pathname}${location.search}`;

  if (mode !== 'local' && mode !== 'cloud') {
    return <Navigate to="/welcome" replace state={{ from: returnTo }} />;
  }

  if (mode === 'cloud' && !isCloudAuthenticated) {
    return <Navigate to="/login" replace state={{ from: returnTo }} />;
  }

  const plannerMode = mode;

  return (
    <UserPreferencesProvider>
      <DndProvider backend={HTML5Backend}>
        <WorkdayProvider>
          <TeamMembersProvider>
            <TaskProvider>
              <CloudSyncProvider mode={plannerMode}>
                <NotificationSettingsProvider>
                  <TaskHotkeys />
                  <CompactModeHotkeys />
                  <PlannerAutoStartEngine />
                  <ExecutionTelemetryBridge plannerMode={plannerMode} />
                  <CloudSessionRuntimeGuard plannerMode={plannerMode} />
                  <CloudSyncErrorToasts />
                  <DevDemoDataButton plannerMode={plannerMode} isCompactRoute={isCompactRoute} />
                  <PlannerOnboardingTutorial
                    plannerMode={plannerMode}
                    isCompactRoute={isCompactRoute}
                  />
                  <AppShellContainer
                    isCompactRoute={isCompactRoute}
                    isTeamView={isTeamView}
                    layoutV1Enabled={layoutV1Enabled}
                  >
                    <Outlet />
                  </AppShellContainer>
                </NotificationSettingsProvider>
              </CloudSyncProvider>
            </TaskProvider>
          </TeamMembersProvider>
        </WorkdayProvider>
      </DndProvider>
    </UserPreferencesProvider>
  );
}

function AppShellContainer({
  children,
  isCompactRoute,
  isTeamView,
  layoutV1Enabled,
}: {
  children: React.ReactNode;
  isCompactRoute: boolean;
  isTeamView: boolean;
  layoutV1Enabled: boolean;
}) {
  const {
    preferences: { uiDensity },
  } = useUserPreferences();

  return (
    <div
      data-testid="app-shell"
      data-density={uiDensity}
      className="relative flex h-screen h-[100dvh] min-h-0 flex-col overflow-hidden bg-background"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--board-bg)] text-[var(--board-text)]">
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</main>

          {!isCompactRoute && !layoutV1Enabled && (
            <>
              <div className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2 md:top-5">
                <CompactLauncher />
              </div>

              <div className="pointer-events-none absolute bottom-5 left-1/2 z-30 -translate-x-1/2">
                <div className="ui-hud-shell pointer-events-auto flex items-center gap-2 ui-v1-radius-md p-2">
                  <Link to="/planner">
                    <Button
                      data-testid="nav-personal"
                      variant="ghost"
                      size="sm"
                      className={`h-10 gap-2 ui-v1-radius-sm border px-4 ${
                        !isTeamView
                          ? 'ui-hud-btn-soft'
                          : 'border-[color:var(--hud-border)] bg-transparent text-[color:var(--hud-text)] opacity-80 hover:bg-[var(--hud-surface-soft)] hover:opacity-100'
                      }`}
                    >
                      <User className="size-4" />
                      Personal
                    </Button>
                  </Link>
                  <Link to="/team">
                    <Button
                      data-testid="nav-team"
                      variant="ghost"
                      size="sm"
                      className={`h-10 gap-2 ui-v1-radius-sm border px-4 ${
                        isTeamView
                          ? 'ui-hud-btn-soft'
                          : 'border-[color:var(--hud-border)] bg-transparent text-[color:var(--hud-text)] opacity-80 hover:bg-[var(--hud-surface-soft)] hover:opacity-100'
                      }`}
                    >
                      <Users className="size-4" />
                      Team
                    </Button>
                  </Link>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TaskHotkeys() {
  const {
    tasks,
    selectedTaskId,
    setSelectedTaskId,
    clearSelectedTask,
    deleteTask,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useTasks();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    user,
    canDeleteTasks,
    presenceLocks,
    isTaskConflictLocked,
    openConflictResolver,
    activeOrgRole,
  } = useCloudSync();

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      const clickedTask = event.target.closest<HTMLElement>('[data-task-id]');
      if (clickedTask) {
        const taskId = clickedTask.dataset.taskId?.trim();
        if (taskId) {
          setSelectedTaskId(taskId);
        }
        return;
      }

      const clickedPlannerSurface = Boolean(
        event.target.closest(
          '.board-scroll,[data-testid="inbox-panel"],[data-testid="daily-planning-panel"],[data-testid="compact-view"],[data-testid^="day-column-"],[data-day-row]'
        )
      );
      if (!clickedPlannerSurface) return;

      const clickedInteractive = Boolean(
        event.target.closest(
          'button,a,input,textarea,select,[role="button"],[contenteditable="true"],[contenteditable=""],[data-no-selection-clear="true"]'
        )
      );
      if (clickedInteractive) return;

      clearSelectedTask();
    };

    window.addEventListener('click', handleClick, true);
    return () => window.removeEventListener('click', handleClick, true);
  }, [clearSelectedTask, setSelectedTaskId]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
    };

    const isDialogOpen = () =>
      Boolean(document.querySelector('[role="dialog"][data-state="open"], [role="dialog"]'));

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const normalizedKey = event.key.toLowerCase();
      const isCompactRoute = location.pathname === '/compact';

      if (normalizedKey === 'escape') {
        if (selectedTaskId) {
          clearSelectedTask();
        }
        return;
      }

      const selectedTask = selectedTaskId
        ? (tasks.find((task) => task.id === selectedTaskId) ?? null)
        : null;

      if (
        !isCompactRoute &&
        (normalizedKey === 'delete' || normalizedKey === 'backspace') &&
        selectedTask
      ) {
        if (isDialogOpen()) return;
        event.preventDefault();
        if (!canDeleteTasks) {
          toast.error(`Role "${activeOrgRole ?? 'viewer'}" cannot delete tasks in this workspace.`);
          return;
        }
        if (isTaskConflictLocked(selectedTask.id)) {
          toast.error('Task has a sync conflict. Resolve it before deleting.');
          openConflictResolver(selectedTask.id);
          return;
        }
        const taskLock = presenceLocks.find(
          (lock) => lock.scope === 'task' && lock.targetId === selectedTask.id
        );
        if (taskLock && taskLock.userId !== user?.id) {
          toast.error(`${taskLock.userName} is editing this task.`);
          return;
        }
        deleteTask(selectedTask.id);
        clearSelectedTask();
        toast.success('Task deleted.');
        return;
      }

      if (!isCompactRoute && normalizedKey === 'enter' && selectedTask) {
        if (isDialogOpen()) return;
        event.preventDefault();
        const params = new URLSearchParams(location.search);
        params.set('taskId', selectedTask.id);
        const nextSearch = params.toString();
        navigate(
          {
            pathname: location.pathname,
            search: nextSearch ? `?${nextSearch}` : '',
          },
          { replace: false }
        );
        return;
      }

      const withMeta = event.metaKey || event.ctrlKey;
      if (!withMeta) return;

      if (normalizedKey === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          if (canRedo) redo();
        } else if (canUndo) {
          undo();
        }
        return;
      }

      if (normalizedKey === 'y' && canRedo) {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeOrgRole,
    canDeleteTasks,
    canRedo,
    canUndo,
    clearSelectedTask,
    deleteTask,
    isTaskConflictLocked,
    location.pathname,
    location.search,
    navigate,
    openConflictResolver,
    presenceLocks,
    redo,
    selectedTaskId,
    tasks,
    undo,
    user?.id,
  ]);

  return null;
}

function CompactModeHotkeys() {
  const location = useLocation();
  const navigate = useNavigate();
  const { setPreference } = useUserPreferences();

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const isCompactRoute = location.pathname === '/compact';
      const desktopMode = isDesktopShell();
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'c') {
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
        if (desktopMode) {
          void desktopToggleCompact();
          return;
        }
        const nextPath = isCompactRoute ? '/' : '/compact';
        setPreference('compactEnabled', !isCompactRoute);
        navigate(nextPath);
        return;
      }

      if (event.key !== 'Escape' || !isCompactRoute) return;
      if (isEditableTarget(event.target)) return;

      event.preventDefault();
      setPreference('compactEnabled', false);

      if (desktopMode) {
        void desktopCloseCompact();
        void desktopFocusMain();
        return;
      }

      const params = new URLSearchParams(location.search);
      const isPopout = params.get('popout') === '1';
      if (isPopout && typeof window !== 'undefined' && window.opener && !window.opener.closed) {
        window.opener.focus();
        window.close();
        return;
      }

      navigate('/planner');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [location.pathname, location.search, navigate, setPreference]);

  return null;
}

function CompactLauncher() {
  const navigate = useNavigate();
  const { setPreference } = useUserPreferences();
  const desktopMode = isDesktopShell();

  const openCompactRoute = () => {
    if (desktopMode) {
      void desktopToggleCompact();
      return;
    }
    setPreference('compactEnabled', true);
    navigate('/compact');
  };

  return (
    <div className="pointer-events-auto ui-v1-radius-md border border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-2 py-1.5 backdrop-blur-sm">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-testid="compact-launcher"
        onClick={openCompactRoute}
        className="h-9 gap-2 ui-v1-radius-sm border border-[color:var(--hud-border)] bg-[var(--hud-surface-strong)] px-3 text-[12px] font-semibold text-[color:var(--hud-text)] hover:brightness-105"
      >
        <Minimize2 className="size-4" />
        Compact
      </Button>
    </div>
  );
}

function CloudSyncErrorToasts() {
  const { error } = useCloudSync();

  useEffect(() => {
    if (!error) return;
    toast.error(error);
  }, [error]);

  return null;
}

function loadAutoStartSessionKeys(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.sessionStorage.getItem(AUTO_START_SESSION_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((entry): entry is string => typeof entry === 'string'));
  } catch {
    return new Set();
  }
}

function persistAutoStartSessionKeys(keys: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(AUTO_START_SESSION_STORAGE_KEY, JSON.stringify(Array.from(keys)));
  } catch {
    // Ignore sessionStorage failures.
  }
}

function PlannerAutoStartEngine() {
  const executionModeV1Enabled = resolveExecutionModeV1Flag();
  const { tasks, startTask, pauseTask } = useTasks();
  const {
    preferences: { executionModeEnabled, autoStartTasksAtStartTime, autoSwitchActiveTask },
  } = useUserPreferences();
  const { canWriteTasks, isTaskConflictLocked, presenceLocks, user } = useCloudSync();
  const startedKeysRef = useRef<Set<string>>(new Set());
  const executionModeGateOpen = executionModeV1Enabled ? executionModeEnabled : true;

  useEffect(() => {
    startedKeysRef.current = loadAutoStartSessionKeys();
  }, []);

  useEffect(() => {
    if (!executionModeGateOpen || !autoStartTasksAtStartTime || !canWriteTasks) {
      return undefined;
    }

    const tick = () => {
      const nowMs = Date.now();
      const todayKey = getDayKey(new Date(nowMs));
      const runningTasks = tasks.filter(
        (task) =>
          task.type !== 'block' &&
          normalizeExecutionStatus(task) === 'running' &&
          task.status !== 'inbox'
      );

      if (runningTasks.length > 0 && !autoSwitchActiveTask) {
        return;
      }

      const eligibleTask = tasks
        .filter((task) => {
          if (task.type === 'block') return false;
          if (!task.startDateTime || task.status === 'inbox') return false;
          if (task.completed) return false;
          if (normalizeExecutionStatus(task) === 'running') return false;
          if (normalizeExecutionStatus(task) === 'completed') return false;
          if (getDayKeyFromDateTime(task.startDateTime) !== todayKey) return false;
          if (isTaskConflictLocked(task.id)) return false;

          const lock = presenceLocks.find(
            (presenceLock) => presenceLock.scope === 'task' && presenceLock.targetId === task.id
          );
          if (lock && lock.userId !== user?.id) return false;

          const startMs = Date.parse(task.startDateTime);
          if (!Number.isFinite(startMs)) return false;
          const deltaMs = nowMs - startMs;
          if (deltaMs < 0 || deltaMs > 60_000) return false;

          if (task.lastStartAt) {
            const lastStartMs = Date.parse(task.lastStartAt);
            if (Number.isFinite(lastStartMs) && nowMs - lastStartMs < 5 * 60_000) {
              return false;
            }
          }

          const dedupeKey = `${task.id}:${task.startDateTime}`;
          return !startedKeysRef.current.has(dedupeKey);
        })
        .sort((a, b) => {
          const aStart = a.startDateTime ? Date.parse(a.startDateTime) : Number.MAX_SAFE_INTEGER;
          const bStart = b.startDateTime ? Date.parse(b.startDateTime) : Number.MAX_SAFE_INTEGER;
          return aStart - bStart;
        })[0];

      if (!eligibleTask) return;

      if (autoSwitchActiveTask) {
        runningTasks.forEach((task) => {
          pauseTask(task.id);
        });
      }

      startTask(eligibleTask.id);
      const dedupeKey = `${eligibleTask.id}:${eligibleTask.startDateTime}`;
      startedKeysRef.current.add(dedupeKey);
      persistAutoStartSessionKeys(startedKeysRef.current);
      toast.message(`Started: ${eligibleTask.title}`, {
        action: {
          label: 'Stop',
          onClick: () => pauseTask(eligibleTask.id),
        },
      });
    };

    tick();
    const timer = window.setInterval(tick, 15_000);
    return () => window.clearInterval(timer);
  }, [
    autoStartTasksAtStartTime,
    autoSwitchActiveTask,
    canWriteTasks,
    executionModeGateOpen,
    isTaskConflictLocked,
    pauseTask,
    presenceLocks,
    startTask,
    tasks,
    user?.id,
  ]);

  return null;
}

function ExecutionTelemetryBridge({ plannerMode }: { plannerMode: PlannerMode }) {
  const executionModeV1Enabled = resolveExecutionModeV1Flag();
  const { token, activeOrgId } = useCloudSync();
  const {
    preferences: { executionModeEnabled, telemetryShareEnabled },
  } = useUserPreferences();
  const shouldFlushTelemetry = executionModeV1Enabled ? executionModeEnabled : false;

  useEffect(() => {
    if (!shouldFlushTelemetry) return undefined;

    const flushNow = () => {
      void flushExecutionTelemetry({
        mode: plannerMode,
        token,
        orgId: activeOrgId,
        telemetryShareEnabled,
      });
    };

    flushNow();
    const timer = window.setInterval(flushNow, 15_000);
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flushNow();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
      flushNow();
    };
  }, [activeOrgId, plannerMode, shouldFlushTelemetry, telemetryShareEnabled, token]);

  return null;
}

function CloudSessionRuntimeGuard({ plannerMode }: { plannerMode: PlannerMode }) {
  const [runtimeError, setRuntimeError] = useState<Error | null>(null);
  const lastCheckKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (plannerMode !== 'cloud' || !CLOUD_SYNC_ENABLED) {
      setRuntimeError(null);
      lastCheckKeyRef.current = null;
      return;
    }
    const endpoint = CLOUD_API_BASE_URL ? `${CLOUD_API_BASE_URL}/api/me` : '/api/me';
    const checkKey = `${plannerMode}:${endpoint}`;
    if (lastCheckKeyRef.current === checkKey) return;

    let cancelled = false;
    lastCheckKeyRef.current = checkKey;

    const verifyCloudRuntime = async () => {
      try {
        const response = await fetch(endpoint, {
          credentials: 'include',
          cache: 'no-store',
        });
        if (response.status >= 500) {
          const devHint = import.meta.env.DEV
            ? ' (Local dev hint: start backend with `npm run server:dev`.)'
            : '';
          throw new Error(`Cloud API responded with ${response.status}.${devHint}`);
        }
        if (!cancelled) {
          setRuntimeError(null);
        }
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to reach cloud API from planner runtime.';
        setRuntimeError(new Error(`Cloud runtime check failed: ${message}`));
      }
    };

    void verifyCloudRuntime();

    return () => {
      cancelled = true;
    };
  }, [plannerMode]);

  if (runtimeError) {
    throw runtimeError;
  }

  return null;
}

function PlannerOnboardingTutorial({
  plannerMode,
  isCompactRoute,
}: {
  plannerMode: PlannerMode;
  isCompactRoute: boolean;
}) {
  const { cloudUserId, hasCompletedTutorial, markTutorialCompleted } = useOnboarding();
  const { user } = useCloudSync();
  const [isOpen, setIsOpen] = useState(false);
  const resolvedCloudUserId = user?.id ?? cloudUserId ?? null;
  const cloudTutorialCompleted = resolvedCloudUserId
    ? readCloudTutorialCompleted(resolvedCloudUserId)
    : false;
  const tutorialCompleted =
    plannerMode === 'cloud'
      ? hasCompletedTutorial || cloudTutorialCompleted
      : hasCompletedTutorial;

  const shouldShowTutorial =
    plannerMode === 'local'
      ? !tutorialCompleted
      : Boolean(resolvedCloudUserId) && !tutorialCompleted;

  useEffect(() => {
    if (isCompactRoute) {
      setIsOpen(false);
      return;
    }
    setIsOpen(shouldShowTutorial);
  }, [isCompactRoute, shouldShowTutorial]);

  if (plannerMode === 'cloud' && !resolvedCloudUserId) {
    return null;
  }

  const handleDone = () => {
    markTutorialCompleted(resolvedCloudUserId);
    setIsOpen(false);
  };

  return (
    <OnboardingTutorialModal
      open={isOpen}
      mode={plannerMode}
      onSkip={handleDone}
      onFinish={handleDone}
    />
  );
}

function DevDemoDataButton({
  plannerMode,
  isCompactRoute,
}: {
  plannerMode: PlannerMode;
  isCompactRoute: boolean;
}) {
  const { tasks, loadDemoData } = useTasks();

  if (!import.meta.env.DEV || plannerMode !== 'local' || isCompactRoute) {
    return null;
  }

  const onLoadDemoData = () => {
    if (tasks.length > 0) {
      const shouldReplace = window.confirm(
        'Load demo data? This replaces the current local task list in this window.'
      );
      if (!shouldReplace) return;
    }
    loadDemoData();
    toast.success('Demo data loaded.');
  };

  return (
    <div className="pointer-events-none absolute bottom-4 left-3 z-20 md:left-5">
      <Button
        type="button"
        data-testid="load-demo-data"
        onClick={onLoadDemoData}
        className="pointer-events-auto ui-hud-btn h-8 ui-v1-radius-sm px-3 text-[11px]"
      >
        Load demo data
      </Button>
    </div>
  );
}
