import { Outlet, Link, useLocation, useNavigate } from 'react-router';
import { TaskProvider, useTasks } from '../context/TaskContext';
import { TeamMembersProvider } from '../context/TeamMembersContext';
import { WorkdayProvider } from '../context/WorkdayContext';
import { AppThemeProvider } from '../context/AppThemeContext';
import { NotificationSettingsProvider } from '../context/NotificationSettingsContext';
import { CloudSyncProvider, useCloudSync } from '../context/CloudSyncContext';
import { UserPreferencesProvider, useUserPreferences } from '../context/UserPreferencesContext';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { Minimize2, Users, User } from 'lucide-react';
import { Button } from './ui/button';
import { useEffect } from 'react';
import { toast } from 'sonner';
import {
  desktopCloseCompact,
  desktopFocusMain,
  desktopToggleCompact,
  isDesktopShell,
} from '../services/desktopShell';

export default function Root() {
  const location = useLocation();
  const isTeamView = location.pathname === '/team';
  const isCompactRoute = location.pathname === '/compact';
  const isDesktopMode = isDesktopShell();
  const isElectronRuntime =
    typeof navigator !== 'undefined' &&
    typeof navigator.userAgent === 'string' &&
    navigator.userAgent.includes('Electron');
  const shouldScaleUi = !isCompactRoute && !isDesktopMode && !isElectronRuntime;

  return (
    <AppThemeProvider>
      <UserPreferencesProvider>
        <DndProvider backend={HTML5Backend}>
          <WorkdayProvider>
            <TeamMembersProvider>
              <TaskProvider>
                <CloudSyncProvider>
                  <NotificationSettingsProvider>
                    <TaskHotkeys />
                    <CompactModeHotkeys />
                    <CloudSyncErrorToasts />
                    <div
                      data-testid="app-shell"
                      className="relative flex h-full min-h-screen min-h-[100dvh] flex-col bg-background"
                    >
                      <div className="flex min-h-0 flex-1 flex-col">
                        <div className={shouldScaleUi ? 'app-scale' : 'h-full'}>
                          <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--board-bg)] text-[var(--board-text)]">
                            <main className="flex-1 min-h-0 overflow-hidden">
                              <Outlet />
                            </main>

                            {!isCompactRoute && (
                              <>
                                <div className="pointer-events-none absolute top-3 left-1/2 z-30 -translate-x-1/2 md:top-5">
                                  <CompactLauncher />
                                </div>

                                <div className="pointer-events-none absolute bottom-5 left-1/2 z-30 -translate-x-1/2">
                                  <div className="ui-hud-shell pointer-events-auto flex items-center gap-2 rounded-[16px] p-2">
                                    <Link to="/">
                                      <Button
                                        data-testid="nav-personal"
                                        variant="ghost"
                                        size="sm"
                                        className={`h-10 gap-2 rounded-[11px] border px-4 ${
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
                                        className={`h-10 gap-2 rounded-[11px] border px-4 ${
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
                    </div>
                  </NotificationSettingsProvider>
                </CloudSyncProvider>
              </TaskProvider>
            </TeamMembersProvider>
          </WorkdayProvider>
        </DndProvider>
      </UserPreferencesProvider>
    </AppThemeProvider>
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
    const handlePointerDown = (event: PointerEvent) => {
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

    window.addEventListener('pointerdown', handlePointerDown, true);
    return () => window.removeEventListener('pointerdown', handlePointerDown, true);
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

      navigate('/');
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
    <div className="pointer-events-auto rounded-[14px] border border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-2 py-1.5 backdrop-blur-sm">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-testid="compact-launcher"
        onClick={openCompactRoute}
        className="h-9 gap-2 rounded-[10px] border border-[color:var(--hud-border)] bg-[var(--hud-surface-strong)] px-3 text-[12px] font-semibold text-[color:var(--hud-text)] hover:brightness-105"
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
