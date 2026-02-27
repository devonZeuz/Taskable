import { useMemo, useState } from 'react';
import { Check, Pause, Play, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import { Task, useTasks } from '../context/TaskContext';
import { useCloudSync } from '../context/CloudSyncContext';
import { useNotificationSettings } from '../context/NotificationSettingsContext';
import { useWorkday } from '../context/WorkdayContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import {
  combineDayAndTime,
  findNextAvailableSlot,
  findNextAvailableSlotAfter,
  getDayKey,
} from '../services/scheduling';
import {
  calculateElapsedMinutes,
  normalizeExecutionStatus,
  roundDurationToGrid,
} from '../services/taskTimer';
import { applyAdaptiveExtendPlan, buildAdaptiveExtendPlan } from '../services/adaptiveScheduling';

interface TaskQuickActionsHubProps {
  task: Task | null;
  onClose: () => void;
}

export default function TaskQuickActionsHub({ task, onClose }: TaskQuickActionsHubProps) {
  const {
    tasks,
    nowTimestamp,
    startTask,
    pauseTask,
    completeTask,
    reopenTask,
    updateTask,
    moveTask,
  } = useTasks();
  const {
    user,
    presenceLocks,
    activeOrgRole,
    canWriteTasks,
    claimPresenceLock,
    isTaskConflictLocked,
    openConflictResolver,
  } = useCloudSync();
  const { hasActiveEndPrompt } = useNotificationSettings();
  const { workday } = useWorkday();
  const {
    preferences: { slotMinutes, autoShoveOnExtend },
  } = useUserPreferences();

  const currentTask = useMemo(
    () => (task ? (tasks.find((entry) => entry.id === task.id) ?? task) : null),
    [task, tasks]
  );

  const lock = useMemo(
    () =>
      currentTask
        ? presenceLocks.find((entry) => entry.scope === 'task' && entry.targetId === currentTask.id)
        : null,
    [currentTask, presenceLocks]
  );
  const isLockedByOther = Boolean(lock && lock.userId !== user?.id);
  const isConflictLocked = currentTask ? isTaskConflictLocked(currentTask.id) : false;
  const roleLabel = activeOrgRole ?? 'viewer';
  const actionsDisabled = isLockedByOther || isConflictLocked || !canWriteTasks;
  const canForceTakeover = activeOrgRole === 'owner' || activeOrgRole === 'admin';
  const [takeoverPending, setTakeoverPending] = useState(false);

  if (!currentTask || hasActiveEndPrompt || currentTask.type === 'block') return null;

  const status = normalizeExecutionStatus(currentTask);
  const isRunning = status === 'running';
  const isCompleted = status === 'completed' || currentTask.completed;
  const hasStartTime = Boolean(currentTask.startDateTime);

  const runGuarded = (action: () => void) => {
    if (!canWriteTasks) {
      toast.error(`Role "${roleLabel}" is read-only in this workspace.`);
      return;
    }
    if (isConflictLocked) {
      toast.error('Task has a sync conflict. Resolve it before applying actions.');
      openConflictResolver(currentTask.id);
      return;
    }
    if (isLockedByOther) {
      toast.error(`${lock?.userName ?? 'Someone'} is editing this task.`);
      return;
    }
    action();
    onClose();
  };

  const handleTakeover = async () => {
    if (!currentTask || !canForceTakeover || takeoverPending) return;
    setTakeoverPending(true);
    try {
      const result = await claimPresenceLock('task', currentTask.id, {
        forceTakeover: true,
      });
      if (result.ok) {
        toast.success(
          result.takenOver ? 'Editing lock taken over. You can continue.' : 'Editing lock claimed.'
        );
        return;
      }
      if (result.conflict) {
        toast.error(`${result.conflict.userName} still holds this lock.`);
      } else {
        toast.error('Could not take over this lock.');
      }
    } finally {
      setTakeoverPending(false);
    }
  };

  const primaryLabel = isCompleted ? 'Reopen' : isRunning ? 'Pause' : 'Start';
  const PrimaryIcon = isCompleted ? RotateCcw : isRunning ? Pause : Play;

  const runRescheduleRemaining = () => {
    if (!currentTask.startDateTime || currentTask.status === 'inbox') {
      toast.error('Schedule this task before rescheduling remaining work.');
      return;
    }

    const elapsedMinutes = calculateElapsedMinutes(currentTask, nowTimestamp);
    const remainingRaw = Math.max(slotMinutes, currentTask.durationMinutes - elapsedMinutes);
    const remainingMinutes = roundDurationToGrid(remainingRaw, slotMinutes);
    const now = new Date(nowTimestamp);
    const todayKey = getDayKey(now);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const todaySlot = findNextAvailableSlotAfter(
      tasks,
      todayKey,
      remainingMinutes,
      nowMinutes,
      currentTask.id,
      workday
    );

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const tomorrowKey = getDayKey(tomorrow);
    const fallbackSlot = todaySlot
      ? null
      : findNextAvailableSlot(tasks, tomorrowKey, remainingMinutes, currentTask.id, workday);
    const targetDayKey = todaySlot ? todayKey : tomorrowKey;
    const targetSlot = todaySlot ?? fallbackSlot;

    if (!targetSlot) {
      toast.error('No room available for remaining work.');
      return;
    }

    moveTask(currentTask.id, combineDayAndTime(targetDayKey, targetSlot.startTime).toISOString());
    updateTask(currentTask.id, {
      durationMinutes: remainingMinutes,
      executionStatus: 'paused',
      lastEndPromptAt: undefined,
      lastPromptAt: undefined,
    });
    toast.success('Moved remaining work to the next available slot.');
  };

  const runExtendToNow = () => {
    if (!currentTask.startDateTime || currentTask.status === 'inbox') {
      toast.error('Schedule this task before extending.');
      return;
    }

    const plan = buildAdaptiveExtendPlan(tasks, currentTask, nowTimestamp, slotMinutes, workday);
    const result = applyAdaptiveExtendPlan({
      plan,
      taskId: currentTask.id,
      autoShoveOnExtend,
      setDuration: (taskId, durationMinutes) =>
        updateTask(taskId, {
          durationMinutes,
          lastEndPromptAt: undefined,
          lastPromptAt: undefined,
        }),
      moveTask,
    });

    if (result.outcome === 'extended_with_shove') {
      toast.success(
        `Extended and shifted ${result.shovedCount} task${result.shovedCount === 1 ? '' : 's'}.`
      );
      return;
    }
    if (result.outcome === 'extended') {
      toast.success('Task schedule extended.');
      return;
    }
    if (result.outcome === 'no_change') {
      toast.message('Task schedule already covers current time.');
      return;
    }
    if (result.outcome === 'outside_workday') {
      toast.error('Cannot extend beyond current workday.');
      return;
    }
    if (result.outcome === 'conflict') {
      toast.custom(
        (toastId) => (
          <div className="ui-hud-shell w-[340px] ui-v1-radius-sm p-3">
            <p className="text-sm font-semibold text-[color:var(--hud-text)]">Extension conflict</p>
            <p className="mt-1 text-xs text-[color:var(--hud-muted)]">
              Extending now overlaps {Math.max(1, plan.overlapCount)} task
              {plan.overlapCount === 1 ? '' : 's'}.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="ui-hud-btn-soft h-8 ui-v1-radius-sm px-3 text-[11px] font-semibold"
                onClick={() => {
                  updateTask(currentTask.id, {
                    durationMinutes: plan.nextDurationMinutes,
                    lastEndPromptAt: undefined,
                    lastPromptAt: undefined,
                  });
                  toast.dismiss(toastId);
                  toast.success('Extended with overlap. Review displaced tasks.');
                }}
              >
                Extend anyway
              </button>
              <button
                type="button"
                className="ui-hud-btn h-8 ui-v1-radius-sm px-3 text-[11px] font-semibold opacity-85"
                onClick={() => {
                  toast.dismiss(toastId);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ),
        {
          id: `task-hub-extend-conflict:${currentTask.id}:${plan.nextDurationMinutes}`,
          duration: 12_000,
        }
      );
      return;
    }

    toast.error('Unable to extend this task right now.');
  };

  return (
    <div className="pointer-events-none absolute bottom-24 left-1/2 z-40 w-full max-w-[440px] -translate-x-1/2 px-3">
      <div
        data-testid="task-quick-actions-hub"
        className="pointer-events-auto ui-v1-radius-md border border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-2.5 py-2 ui-v1-elevation-2 backdrop-blur-md"
      >
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[12px] font-bold tracking-[-0.02em] text-[color:var(--hud-text)]">
              {currentTask.title}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6.5 w-6.5 items-center justify-center ui-v1-radius-sm border border-[color:var(--hud-border)] bg-[var(--hud-surface-strong)] text-[color:var(--hud-text)] opacity-85 transition-colors hover:brightness-105 hover:opacity-100"
            title="Close actions"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid w-full grid-flow-col auto-cols-fr items-center gap-1.5 ui-v1-radius-sm border border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] p-1.5">
          <button
            type="button"
            disabled={actionsDisabled}
            onClick={() =>
              runGuarded(() => {
                if (isCompleted) {
                  reopenTask(currentTask.id);
                  return;
                }
                if (isRunning) {
                  pauseTask(currentTask.id);
                  return;
                }
                if (!currentTask.startDateTime || currentTask.status === 'inbox') {
                  toast.message('Schedule this task before starting.');
                  return;
                }
                startTask(currentTask.id);
              })
            }
            className="inline-flex h-8 w-full min-w-0 items-center justify-center gap-1.5 whitespace-nowrap ui-v1-radius-sm border border-[color:var(--hud-border)] bg-[var(--hud-surface-strong)] px-2 text-[11px] font-semibold text-[color:var(--hud-text)] disabled:cursor-not-allowed disabled:opacity-55"
          >
            <PrimaryIcon className="size-3.5" />
            {primaryLabel}
          </button>

          {!isCompleted && (
            <button
              type="button"
              disabled={actionsDisabled}
              onClick={() => runGuarded(() => completeTask(currentTask.id))}
              className="inline-flex h-8 w-full min-w-0 items-center justify-center gap-1.5 whitespace-nowrap ui-v1-radius-sm border border-[color:var(--hud-border)] bg-[var(--hud-accent-soft)] px-2 text-[11px] font-semibold text-[var(--hud-accent-soft-text)] disabled:cursor-not-allowed disabled:opacity-55"
            >
              <Check className="size-3.5" />
              Done
            </button>
          )}

          {hasStartTime && !isCompleted && (
            <button
              type="button"
              disabled={actionsDisabled}
              onClick={() =>
                runGuarded(() => {
                  runExtendToNow();
                })
              }
              className="inline-flex h-8 w-full min-w-0 items-center justify-center whitespace-nowrap ui-v1-radius-sm border border-[color:var(--hud-border)] bg-transparent px-2 text-[11px] font-semibold text-[color:var(--hud-text)] opacity-85 disabled:cursor-not-allowed disabled:opacity-55"
            >
              Extend
            </button>
          )}

          {hasStartTime && !isCompleted && (
            <button
              type="button"
              disabled={actionsDisabled}
              onClick={() => runGuarded(runRescheduleRemaining)}
              className="inline-flex h-8 w-full min-w-0 items-center justify-center whitespace-nowrap ui-v1-radius-sm border border-[color:var(--hud-border)] bg-transparent px-2 text-[11px] font-semibold text-[color:var(--hud-text)] opacity-85 disabled:cursor-not-allowed disabled:opacity-55"
            >
              Next
            </button>
          )}
        </div>

        {(isLockedByOther || isConflictLocked || !canWriteTasks) && (
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold text-[var(--hud-accent-soft)]">
              {isConflictLocked
                ? 'Task is blocked by a sync conflict.'
                : isLockedByOther
                  ? `${lock?.userName} is editing.`
                  : `Role "${roleLabel}" is read-only.`}
            </p>
            {isConflictLocked && (
              <button
                type="button"
                onClick={() => openConflictResolver(currentTask.id)}
                className="inline-flex h-6 items-center justify-center ui-v1-radius-xs border border-[color:var(--hud-border)] bg-[var(--hud-surface-strong)] px-2 text-[10px] font-semibold text-[color:var(--hud-text)]"
              >
                Resolve
              </button>
            )}
            {isLockedByOther && canForceTakeover && (
              <button
                type="button"
                onClick={() => {
                  void handleTakeover();
                }}
                disabled={takeoverPending}
                className="inline-flex h-6 items-center justify-center ui-v1-radius-xs border border-[color:var(--hud-border)] bg-[var(--hud-surface-strong)] px-2 text-[10px] font-semibold text-[color:var(--hud-text)] disabled:opacity-55"
              >
                {takeoverPending ? 'Taking over...' : 'Take over'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
