import { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  CalendarCheck2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Switch } from './ui/switch';
import { toast } from 'sonner';
import { useTasks, type Task } from '../context/TaskContext';
import { useWorkday } from '../context/WorkdayContext';
import { useNotificationSettings } from '../context/NotificationSettingsContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import { useCloudSync } from '../context/CloudSyncContext';
import { resolveLayoutV1Flag } from '../flags';
import {
  combineDayAndTime,
  findNextAvailableSlot,
  findNextAvailableSlotAfter,
  getDayKey,
  getDayKeyFromDateTime,
  getWorkdayMinutes,
  minutesToTime,
  timeToMinutes,
} from '../services/scheduling';
import { applyAdaptiveExtendPlan, buildAdaptiveExtendPlan } from '../services/adaptiveScheduling';
import { buildWeeklyExecutionForecast } from '../services/executionForecast';
import { buildWeeklyExecutionInsights } from '../services/executionInsights';
import {
  calculateElapsedMinutes,
  getOverrunMinutes,
  roundDurationToGrid,
} from '../services/taskTimer';

interface DailyPlanningPanelProps {
  tasks: Task[];
  scheduleTasks?: Task[];
}

const PANEL_COLLAPSED_STORAGE_KEY = 'taskable:daily-planning-collapsed';

export default function DailyPlanningPanel({ tasks, scheduleTasks }: DailyPlanningPanelProps) {
  const { moveTask, completeTask, setTaskFocus, startTask, pauseTask, updateTask } = useTasks();
  const { workday } = useWorkday();
  const { enabled, permission, incomingLeadTimes, setEnabled, requestPermission } =
    useNotificationSettings();
  const {
    preferences: { slotMinutes, autoShoveOnExtend, executionModeEnabled },
  } = useUserPreferences();
  const { canWriteTasks, activeOrgRole, isTaskConflictLocked, openConflictResolver } =
    useCloudSync();
  const layoutV1Enabled = resolveLayoutV1Flag();
  const [showReview, setShowReview] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (!layoutV1Enabled) return false;
    try {
      const storedValue = localStorage.getItem(PANEL_COLLAPSED_STORAGE_KEY);
      if (storedValue === null) return true;
      return storedValue === 'true';
    } catch {
      return true;
    }
  });
  const [nowTimestamp, setNowTimestamp] = useState(() => Date.now());

  const scheduleScopeTasks = scheduleTasks ?? tasks;
  const now = new Date(nowTimestamp);
  const todayKey = getDayKey(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const tomorrowKey = getDayKey(tomorrow);
  const workStartMinutes = workday.startHour * 60;
  const roleLabel = activeOrgRole ?? 'viewer';
  const ensureCloudWritePermission = () => {
    if (canWriteTasks) return true;
    toast.error(`Role "${roleLabel}" is read-only in this workspace.`);
    return false;
  };
  const ensureTaskConflictUnlocked = (task: Task, actionLabel: string) => {
    if (!isTaskConflictLocked(task.id)) return true;
    toast.error(`Task has a sync conflict. Resolve it before ${actionLabel}.`);
    openConflictResolver(task.id);
    return false;
  };

  useEffect(() => {
    const interval = window.setInterval(() => setNowTimestamp(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const todayTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.startDateTime &&
          task.status !== 'inbox' &&
          getDayKeyFromDateTime(task.startDateTime) === todayKey
      ),
    [tasks, todayKey]
  );

  const todayTasksByTime = useMemo(
    () =>
      [...todayTasks].sort((a, b) => {
        const aValue = a.startDateTime
          ? new Date(a.startDateTime).getTime()
          : Number.MAX_SAFE_INTEGER;
        const bValue = b.startDateTime
          ? new Date(b.startDateTime).getTime()
          : Number.MAX_SAFE_INTEGER;
        if (aValue === bValue) return a.title.localeCompare(b.title);
        return aValue - bValue;
      }),
    [todayTasks]
  );

  const focusTasks = useMemo(
    () => todayTasksByTime.filter((task) => task.focus && !task.completed),
    [todayTasksByTime]
  );

  const todayFocusDisplayTasks = useMemo(
    () => (focusTasks.length > 0 ? focusTasks : todayTasksByTime),
    [focusTasks, todayTasksByTime]
  );

  const maxLeadMinutes = useMemo(
    () => (incomingLeadTimes.length > 0 ? Math.max(...incomingLeadTimes) : 0),
    [incomingLeadTimes]
  );

  const startingSoonTasks = useMemo(
    () =>
      tasks
        .filter((task) => {
          if (task.type === 'block') return false;
          if (!task.startDateTime || task.status === 'inbox' || task.completed) return false;
          if (task.executionStatus === 'running') return false;
          const startMs = new Date(task.startDateTime).getTime();
          return startMs >= nowTimestamp && startMs <= nowTimestamp + maxLeadMinutes * 60 * 1000;
        })
        .sort((a, b) =>
          a.startDateTime && b.startDateTime ? a.startDateTime.localeCompare(b.startDateTime) : 0
        ),
    [maxLeadMinutes, nowTimestamp, tasks]
  );

  const runningTasks = useMemo(
    () =>
      tasks
        .filter(
          (task) =>
            task.type !== 'block' && task.executionStatus === 'running' && task.status !== 'inbox'
        )
        .sort((a, b) =>
          a.startDateTime && b.startDateTime ? a.startDateTime.localeCompare(b.startDateTime) : 0
        ),
    [tasks]
  );

  const runningLateTasks = useMemo(
    () =>
      runningTasks.filter((task) => {
        const overrun = getOverrunMinutes(task, nowTimestamp);
        return overrun > 0;
      }),
    [nowTimestamp, runningTasks]
  );

  const runningNowTasks = useMemo(
    () => runningTasks.filter((task) => !runningLateTasks.some((entry) => entry.id === task.id)),
    [runningLateTasks, runningTasks]
  );

  const missedTasks = useMemo(
    () =>
      tasks.filter((task) => {
        if (task.type === 'block') return false;
        if (!task.startDateTime || task.status === 'inbox' || task.completed) return false;
        if (task.executionStatus === 'running') return false;
        return new Date(task.startDateTime).getTime() < nowTimestamp;
      }),
    [tasks, nowTimestamp]
  );

  const reviewSummary = useMemo(() => {
    const completed = todayTasks.filter((task) => task.completed).length;
    const remaining = todayTasks.filter((task) => !task.completed).length;
    const overdueCount = missedTasks.length;
    return { completed, remaining, overdueCount, total: todayTasks.length };
  }, [missedTasks.length, todayTasks]);
  const plannedTodayMinutes = useMemo(
    () =>
      todayTasks.reduce((total, task) => {
        if (task.completed || task.type === 'block') return total;
        return total + Math.max(0, task.durationMinutes);
      }, 0),
    [todayTasks]
  );
  const workdayCapacityMinutes = useMemo(() => getWorkdayMinutes(workday), [workday]);
  const scheduledTodayMinutes = useMemo(
    () =>
      todayTasks.reduce((total, task) => {
        if (task.type === 'block') return total;
        return total + Math.max(0, task.durationMinutes);
      }, 0),
    [todayTasks]
  );
  const completionRatio =
    reviewSummary.total > 0 ? reviewSummary.completed / reviewSummary.total : 0;
  const capacityPlannedRatio =
    workdayCapacityMinutes > 0 ? Math.min(1.5, scheduledTodayMinutes / workdayCapacityMinutes) : 0;
  const capacityPlannedPercent = Math.round(capacityPlannedRatio * 100);
  const overloadMinutes = Math.max(0, plannedTodayMinutes - workdayCapacityMinutes);
  const weeklyExecutionInsights = useMemo(
    () => buildWeeklyExecutionInsights(tasks, nowTimestamp, slotMinutes),
    [nowTimestamp, slotMinutes, tasks]
  );
  const weeklyExecutionForecast = useMemo(
    () => buildWeeklyExecutionForecast(tasks, workday, nowTimestamp),
    [nowTimestamp, tasks, workday]
  );
  const overloadMovePlan = useMemo(() => {
    if (overloadMinutes <= 0) return [];
    const candidates = [...todayTasksByTime]
      .filter((task) => !task.completed && task.type !== 'block' && task.startDateTime)
      .sort((a, b) =>
        a.startDateTime && b.startDateTime ? b.startDateTime.localeCompare(a.startDateTime) : 0
      );
    const selected: Task[] = [];
    let covered = 0;
    candidates.forEach((task) => {
      if (covered >= overloadMinutes) return;
      selected.push(task);
      covered += task.durationMinutes;
    });
    return selected;
  }, [overloadMinutes, todayTasksByTime]);

  useEffect(() => {
    if (!layoutV1Enabled) return;
    try {
      localStorage.setItem(PANEL_COLLAPSED_STORAGE_KEY, String(isCollapsed));
    } catch {
      // ignore storage errors
    }
  }, [isCollapsed, layoutV1Enabled]);

  const autoScheduleTask = (task: Task) => {
    if (!ensureCloudWritePermission()) return;
    if (!ensureTaskConflictUnlocked(task, 'rescheduling')) return;
    if (task.durationMinutes > getWorkdayMinutes(workday)) {
      toast.error('Task duration exceeds current workday length.');
      return;
    }

    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const todaySlot = findNextAvailableSlotAfter(
      scheduleScopeTasks,
      todayKey,
      task.durationMinutes,
      Math.max(nowMinutes, workStartMinutes),
      task.id,
      workday
    );

    const resolvedSlot =
      todaySlot ??
      findNextAvailableSlot(
        scheduleScopeTasks,
        tomorrowKey,
        task.durationMinutes,
        task.id,
        workday
      );

    const targetDay = todaySlot ? todayKey : tomorrowKey;

    if (!resolvedSlot) {
      toast.error('No available slot found in current workday window.');
      return;
    }

    moveTask(task.id, combineDayAndTime(targetDay, resolvedSlot.startTime).toISOString());
    toast.success(`Scheduled at ${resolvedSlot.startTime} on ${todaySlot ? 'today' : 'tomorrow'}.`);
  };

  const carryToTomorrow = (task: Task) => {
    if (!ensureCloudWritePermission()) return;
    if (!ensureTaskConflictUnlocked(task, 'moving')) return;
    if (!task.startDateTime) return;
    const start = new Date(task.startDateTime);
    const startTime = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
    const startMinutes = timeToMinutes(startTime);
    const endMinutes = startMinutes + task.durationMinutes;

    if (startMinutes >= workday.startHour * 60 && endMinutes <= workday.endHour * 60) {
      moveTask(task.id, combineDayAndTime(tomorrowKey, startTime).toISOString());
      toast.success('Moved to tomorrow.');
      return;
    }

    const slot = findNextAvailableSlot(
      scheduleScopeTasks,
      tomorrowKey,
      task.durationMinutes,
      task.id,
      workday
    );
    if (!slot) {
      toast.error('No slot available tomorrow.');
      return;
    }

    moveTask(task.id, combineDayAndTime(tomorrowKey, slot.startTime).toISOString());
    toast.success('Moved to next available slot tomorrow.');
  };

  const rescheduleNext = (task: Task) => {
    if (!ensureCloudWritePermission()) return;
    if (!ensureTaskConflictUnlocked(task, 'rescheduling')) return;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const todaySlot = findNextAvailableSlotAfter(
      scheduleScopeTasks,
      todayKey,
      task.durationMinutes,
      Math.max(nowMinutes, workStartMinutes),
      task.id,
      workday
    );

    if (todaySlot) {
      moveTask(task.id, combineDayAndTime(todayKey, todaySlot.startTime).toISOString());
      toast.success(`Moved to ${todaySlot.startTime} today.`);
      return;
    }

    const tomorrowSlot = findNextAvailableSlot(
      scheduleScopeTasks,
      tomorrowKey,
      task.durationMinutes,
      task.id,
      workday
    );

    if (!tomorrowSlot) {
      toast.error('No next slot available in current workday horizon.');
      return;
    }

    moveTask(task.id, combineDayAndTime(tomorrowKey, tomorrowSlot.startTime).toISOString());
    toast.success(`Moved to ${tomorrowSlot.startTime} tomorrow.`);
  };

  const runCarryOver = () => {
    if (!ensureCloudWritePermission()) return;
    const openToday = todayTasks
      .filter((task) => !task.completed)
      .sort((a, b) =>
        a.startDateTime && b.startDateTime ? a.startDateTime.localeCompare(b.startDateTime) : 0
      );

    if (openToday.length === 0) {
      toast.success('No open tasks to carry over.');
      return;
    }

    const scheduleShadow: Task[] = scheduleScopeTasks.map((task) => ({
      ...task,
      subtasks: task.subtasks.map((subtask) => ({ ...subtask })),
    }));

    let cursor = workday.startHour * 60;
    let movedCount = 0;

    openToday.forEach((task) => {
      if (isTaskConflictLocked(task.id)) return;
      const slot =
        findNextAvailableSlotAfter(
          scheduleShadow,
          tomorrowKey,
          task.durationMinutes,
          cursor,
          task.id,
          workday
        ) ??
        findNextAvailableSlot(scheduleShadow, tomorrowKey, task.durationMinutes, task.id, workday);

      if (!slot) return;

      const startDateTime = combineDayAndTime(tomorrowKey, slot.startTime).toISOString();
      moveTask(task.id, startDateTime);

      const shadowTask = scheduleShadow.find((entry) => entry.id === task.id);
      if (shadowTask) {
        shadowTask.startDateTime = startDateTime;
        shadowTask.status = 'scheduled';
      }

      cursor = timeToMinutes(slot.endTime);
      movedCount += 1;
    });

    if (movedCount === 0) {
      toast.error('Unable to carry over tasks. No available slots tomorrow.');
      return;
    }

    toast.success(`Carried over ${movedCount} task${movedCount === 1 ? '' : 's'} to tomorrow.`);
  };

  const applyOverloadSuggestion = () => {
    if (!ensureCloudWritePermission()) return;
    if (overloadMovePlan.length === 0) {
      toast.message('No overload adjustments needed.');
      return;
    }

    const scheduleShadow: Task[] = scheduleScopeTasks.map((task) => ({
      ...task,
      subtasks: task.subtasks.map((subtask) => ({ ...subtask })),
    }));

    let movedCount = 0;
    let cursor = workday.startHour * 60;
    const orderedPlan = [...overloadMovePlan].sort((a, b) =>
      a.startDateTime && b.startDateTime ? a.startDateTime.localeCompare(b.startDateTime) : 0
    );

    orderedPlan.forEach((task) => {
      if (isTaskConflictLocked(task.id)) return;
      const slot =
        findNextAvailableSlotAfter(
          scheduleShadow,
          tomorrowKey,
          task.durationMinutes,
          cursor,
          task.id,
          workday
        ) ??
        findNextAvailableSlot(scheduleShadow, tomorrowKey, task.durationMinutes, task.id, workday);
      if (!slot) return;

      const startDateTime = combineDayAndTime(tomorrowKey, slot.startTime).toISOString();
      moveTask(task.id, startDateTime);
      const shadowTask = scheduleShadow.find((entry) => entry.id === task.id);
      if (shadowTask) {
        shadowTask.startDateTime = startDateTime;
        shadowTask.status = 'scheduled';
      }
      cursor = timeToMinutes(slot.endTime);
      movedCount += 1;
    });

    if (movedCount === 0) {
      toast.error('Could not move suggested tasks to tomorrow.');
      return;
    }

    toast.success(`Moved ${movedCount} task${movedCount === 1 ? '' : 's'} to tomorrow.`);
  };

  const handleNotificationsToggle = async (nextEnabled: boolean) => {
    if (!nextEnabled) {
      setEnabled(false);
      return;
    }

    if (permission === 'granted') {
      setEnabled(true);
      return;
    }

    const result = await requestPermission();
    if (result === 'granted') {
      setEnabled(true);
      toast.success('Browser notifications enabled.');
      return;
    }

    setEnabled(false);
    toast.error('Notification permission is required to enable reminders.');
  };

  const handleStart = (task: Task) => {
    if (!ensureCloudWritePermission()) return;
    if (!ensureTaskConflictUnlocked(task, 'starting')) return;
    if (!task.startDateTime || task.status === 'inbox') {
      autoScheduleTask(task);
      return;
    }
    startTask(task.id);
    toast.success('Task started.');
  };

  const handleMarkDone = (task: Task) => {
    if (!ensureCloudWritePermission()) return;
    if (!ensureTaskConflictUnlocked(task, 'marking done')) return;
    completeTask(task.id);
  };

  const handlePause = (task: Task) => {
    if (!ensureCloudWritePermission()) return;
    if (!ensureTaskConflictUnlocked(task, 'pausing')) return;
    pauseTask(task.id);
    toast.message('Task paused.');
  };

  const handlePinToggle = (task: Task) => {
    if (!ensureCloudWritePermission()) return;
    if (!ensureTaskConflictUnlocked(task, 'pinning')) return;
    setTaskFocus(task.id, !task.focus);
  };

  const handleExtendToNow = (task: Task) => {
    if (!ensureCloudWritePermission()) return;
    if (!ensureTaskConflictUnlocked(task, 'extending')) return;
    const plan = buildAdaptiveExtendPlan(
      scheduleScopeTasks,
      task,
      nowTimestamp,
      slotMinutes,
      workday
    );
    const result = applyAdaptiveExtendPlan({
      plan,
      taskId: task.id,
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

    if (result.outcome === 'outside_workday') {
      toast.error('Cannot extend beyond current workday.');
      return;
    }

    if (result.outcome === 'conflict') {
      toast.custom(
        (toastId) => (
          <div className="ui-hud-shell w-[360px] ui-v1-radius-sm p-3">
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
                  updateTask(task.id, {
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
          id: `daily-extend-conflict:${task.id}:${plan.nextDurationMinutes}`,
          duration: 12_000,
        }
      );
      return;
    }

    if (result.outcome === 'no_change') {
      toast.message('Task schedule already covers current time.');
      return;
    }

    toast.error('Unable to extend this task right now.');
  };

  const handleRescheduleRemaining = (task: Task) => {
    if (!ensureCloudWritePermission()) return;
    if (!ensureTaskConflictUnlocked(task, 'rescheduling remaining work')) return;
    if (!task.startDateTime || task.status === 'inbox') {
      toast.error('Schedule this task before rescheduling remaining work.');
      return;
    }

    const elapsedMinutes = calculateElapsedMinutes(task, nowTimestamp);
    const remainingRaw = Math.max(slotMinutes, task.durationMinutes - elapsedMinutes);
    const remainingMinutes = roundDurationToGrid(remainingRaw, slotMinutes);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const todaySlot = findNextAvailableSlotAfter(
      scheduleScopeTasks,
      todayKey,
      remainingMinutes,
      nowMinutes,
      task.id,
      workday
    );

    const fallbackSlot = todaySlot
      ? null
      : findNextAvailableSlot(scheduleScopeTasks, tomorrowKey, remainingMinutes, task.id, workday);
    const targetDay = todaySlot ? todayKey : tomorrowKey;
    const targetSlot = todaySlot ?? fallbackSlot;

    if (!targetSlot) {
      toast.error('No room available for remaining work.');
      return;
    }

    moveTask(task.id, combineDayAndTime(targetDay, targetSlot.startTime).toISOString());
    updateTask(task.id, {
      durationMinutes: remainingMinutes,
      executionStatus: 'paused',
      lastEndPromptAt: undefined,
      lastPromptAt: undefined,
    });
    toast.success('Moved remaining work to the next available slot.');
  };

  return (
    <div className="mb-3 shrink-0 px-3 md:mb-4 md:px-5">
      <div
        data-testid="daily-planning-panel"
        className="ui-hud-panel ui-v1-radius-md p-3 backdrop-blur-sm md:p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-[color:var(--hud-text)] md:text-lg">
              Daily Planning
            </h3>
            <p className="mt-0.5 text-[12px] font-semibold text-[color:var(--hud-text)] md:text-[13px]">
              Today - {reviewSummary.completed} of {reviewSummary.total} done ·{' '}
              {capacityPlannedPercent}% capacity planned
            </p>
          </div>
          <div className="flex items-center gap-2">
            {(!isCollapsed || !layoutV1Enabled) && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="daily-review-toggle"
                onClick={() => setShowReview((prev) => !prev)}
                className="h-8 ui-v1-radius-sm border-[color:var(--hud-border)] bg-[var(--hud-surface-strong)] text-[color:var(--hud-text)] hover:brightness-105"
              >
                <CalendarCheck2 className="mr-1.5 size-4" />
                End-of-day Review
              </Button>
            )}
            {layoutV1Enabled && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                data-testid="daily-planning-collapse-toggle"
                onClick={() => {
                  setIsCollapsed((prev) => !prev);
                  if (!isCollapsed) {
                    setShowReview(false);
                  }
                }}
                className="h-8 ui-v1-radius-sm border border-[color:var(--hud-border)] px-2.5 text-[11px] text-[color:var(--hud-text)] opacity-85 hover:bg-[var(--hud-surface-soft)] hover:opacity-100"
              >
                {isCollapsed ? (
                  <>
                    <ChevronDown className="mr-1 size-4" />
                    Expand
                  </>
                ) : (
                  <>
                    <ChevronUp className="mr-1 size-4" />
                    Collapse
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
        <div className="mt-2 h-[4px] w-full overflow-hidden rounded-full bg-[color:var(--hud-border)]/65">
          <div
            className="h-full rounded-full transition-[width] duration-300 ease-out"
            style={{
              width:
                reviewSummary.total === 0
                  ? '0%'
                  : `${Math.max(8, Math.round(completionRatio * 100))}%`,
              background: 'var(--hud-accent-bg)',
            }}
          />
        </div>

        {layoutV1Enabled && isCollapsed && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 ui-v1-radius-sm border border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] px-3 py-2">
            <div className="text-xs text-[color:var(--hud-muted)]">
              <p>
                Planned {formatMinutes(plannedTodayMinutes)} / Capacity{' '}
                {formatMinutes(workdayCapacityMinutes)}
              </p>
              <p>
                Tasks today: {todayTasks.length} ({reviewSummary.remaining} open)
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="daily-planning-open-panel"
              onClick={() => setIsCollapsed(false)}
              className="h-7 ui-v1-radius-sm border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-2.5 text-[11px] text-[color:var(--hud-text)]"
            >
              Open planning panel
            </Button>
          </div>
        )}

        {(!layoutV1Enabled || !isCollapsed) && (
          <div className="mt-3 space-y-3">
            {overloadMinutes > 0 && (
              <div
                data-testid="daily-smart-overload-banner"
                className="ui-hud-row flex flex-wrap items-center justify-between gap-2 ui-v1-radius-sm border border-[color:var(--hud-border)] px-3 py-2"
              >
                <div>
                  <p className="text-xs font-semibold text-[color:var(--hud-text)]">
                    Smart load alert for today
                  </p>
                  <p className="text-[11px] text-[color:var(--hud-muted)]">
                    Planned {formatMinutes(plannedTodayMinutes)} vs capacity{' '}
                    {formatMinutes(workdayCapacityMinutes)}. Move {overloadMovePlan.length} task
                    {overloadMovePlan.length === 1 ? '' : 's'} to rebalance.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  data-testid="daily-smart-overload-move"
                  onClick={applyOverloadSuggestion}
                  disabled={!canWriteTasks}
                  className="ui-hud-btn-accent h-7 ui-v1-radius-sm px-2.5 text-[11px]"
                >
                  Move {overloadMovePlan.length} to tomorrow
                </Button>
              </div>
            )}
            {weeklyExecutionForecast.weeklyOverloadMinutes > 0 && (
              <div
                data-testid="daily-smart-weekly-overload"
                className="ui-hud-row flex flex-wrap items-center justify-between gap-2 ui-v1-radius-sm border border-[color:var(--hud-border)] px-3 py-2"
              >
                <div>
                  <p className="text-xs font-semibold text-[color:var(--hud-text)]">
                    Weekly load projection
                  </p>
                  <p className="text-[11px] text-[color:var(--hud-muted)]">
                    Forecast overload: +
                    {formatMinutes(weeklyExecutionForecast.weeklyOverloadMinutes)} across{' '}
                    {weeklyExecutionForecast.overloadedDays} day
                    {weeklyExecutionForecast.overloadedDays === 1 ? '' : 's'}.
                    {weeklyExecutionForecast.peakOverloadDay
                      ? ` Peak ${formatDayKeyLabel(
                          weeklyExecutionForecast.peakOverloadDay.dayKey
                        )}: +${formatMinutes(weeklyExecutionForecast.peakOverloadDay.overloadMinutes)}.`
                      : ''}
                  </p>
                </div>
              </div>
            )}
            <div className="grid gap-3 lg:grid-cols-2">
              <section className="ui-hud-section ui-v1-radius-sm p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.07em] text-[color:var(--hud-muted)]">
                    <Sparkles className="size-3.5" />
                    Today Focus
                  </div>
                  <Badge className="ui-hud-chip rounded-full px-2 text-[10px]">
                    {focusTasks.length}
                  </Badge>
                </div>
                <div className="space-y-2">
                  {todayFocusDisplayTasks.slice(0, 5).map((task) => (
                    <div
                      key={task.id}
                      className="ui-hud-row flex items-center justify-between gap-2 ui-v1-radius-sm px-2 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[color:var(--hud-text)]">
                          {task.title}
                        </p>
                        <p className="text-[11px] text-[color:var(--hud-muted)]">
                          {task.startDateTime
                            ? new Date(task.startDateTime).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false,
                              })
                            : 'Unscheduled'}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => handlePinToggle(task)}
                        disabled={!canWriteTasks}
                        className={`h-7 ui-v1-radius-sm px-2 text-[11px] ${
                          task.focus ? 'ui-hud-btn-soft' : 'ui-hud-btn opacity-85'
                        }`}
                      >
                        {task.focus ? 'Pinned' : 'Pin'}
                      </Button>
                    </div>
                  ))}
                  {todayFocusDisplayTasks.length === 0 && (
                    <p className="text-xs text-[color:var(--hud-muted)]">
                      No tasks scheduled for today.
                    </p>
                  )}
                </div>
              </section>

              <section className="ui-hud-section ui-v1-radius-sm p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.07em] text-[color:var(--hud-muted)]">
                    <TriangleAlert className="size-3.5" />
                    Execution + Alerts
                  </div>
                  <Badge className="ui-hud-chip rounded-full px-2 text-[10px]">
                    {startingSoonTasks.length +
                      runningNowTasks.length +
                      runningLateTasks.length +
                      missedTasks.length}
                  </Badge>
                </div>

                <div className="ui-hud-row mb-2 ui-v1-radius-sm px-2 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--hud-text)]">
                      <Bell className="size-3.5" />
                      Notifications
                    </div>
                    <Switch checked={enabled} onCheckedChange={handleNotificationsToggle} />
                  </div>
                  <p className="mt-1 text-[10px] text-[color:var(--hud-muted)]">
                    Permission: {permission === 'unsupported' ? 'unsupported' : permission}
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
                    Starting soon
                  </p>
                  {startingSoonTasks.slice(0, 3).map((task) => (
                    <div key={task.id} className="ui-hud-row ui-v1-radius-sm p-2">
                      <p className="truncate text-sm font-semibold text-[color:var(--hud-text)]">
                        {task.title}
                      </p>
                      <p className="text-[11px] text-[color:var(--hud-muted)]">
                        {task.startDateTime ? formatTaskTime(task.startDateTime) : 'Unscheduled'}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleStart(task)}
                          disabled={!canWriteTasks}
                          className="ui-hud-btn-accent h-7 ui-v1-radius-sm px-2.5 text-[11px]"
                        >
                          Start
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => rescheduleNext(task)}
                          disabled={!canWriteTasks}
                          className="ui-hud-btn h-7 ui-v1-radius-sm px-2.5 text-[11px] opacity-85"
                        >
                          Next Slot
                        </Button>
                      </div>
                    </div>
                  ))}
                  {startingSoonTasks.length === 0 && (
                    <p className="text-xs text-[color:var(--hud-muted)]">
                      No tasks in the current lead window.
                    </p>
                  )}
                </div>

                <div className="mt-3 space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
                    Running now
                  </p>
                  {runningNowTasks.slice(0, 3).map((task) => (
                    <div key={task.id} className="ui-hud-row ui-v1-radius-sm p-2">
                      <p className="truncate text-sm font-semibold text-[color:var(--hud-text)]">
                        {task.title}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => handlePause(task)}
                          disabled={!canWriteTasks}
                          className="ui-hud-btn h-7 ui-v1-radius-sm px-2.5 text-[11px] opacity-85"
                        >
                          Pause
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => handleExtendToNow(task)}
                          disabled={!canWriteTasks}
                          className="ui-hud-btn h-7 ui-v1-radius-sm px-2.5 text-[11px] opacity-85"
                        >
                          Extend
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => rescheduleNext(task)}
                          disabled={!canWriteTasks}
                          className="ui-hud-btn h-7 ui-v1-radius-sm px-2.5 text-[11px] opacity-85"
                        >
                          Next Slot
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleMarkDone(task)}
                          disabled={!canWriteTasks}
                          className="ui-hud-btn-soft h-7 ui-v1-radius-sm px-2.5 text-[11px]"
                        >
                          Mark Done
                        </Button>
                      </div>
                    </div>
                  ))}
                  {runningNowTasks.length === 0 && (
                    <p className="text-xs text-[color:var(--hud-muted)]">
                      No active tasks within planned windows.
                    </p>
                  )}
                </div>

                <div className="mt-3 space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
                    Running late
                  </p>
                  {runningLateTasks.slice(0, 3).map((task) => {
                    const overrun = getOverrunMinutes(task, nowTimestamp);
                    return (
                      <div key={task.id} className="ui-hud-row ui-v1-radius-sm p-2">
                        <p className="truncate text-sm font-semibold text-[color:var(--hud-text)]">
                          {task.title}
                        </p>
                        <p className="text-[11px] font-semibold text-[color:var(--hud-danger-text)]">
                          Running late by {Math.max(1, Math.floor(overrun))}m
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => handlePause(task)}
                            disabled={!canWriteTasks}
                            className="ui-hud-btn h-7 ui-v1-radius-sm px-2.5 text-[11px] opacity-85"
                          >
                            Pause
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => handleExtendToNow(task)}
                            disabled={!canWriteTasks}
                            className="ui-hud-btn h-7 ui-v1-radius-sm px-2.5 text-[11px] opacity-85"
                          >
                            Extend to now
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRescheduleRemaining(task)}
                            disabled={!canWriteTasks}
                            className="ui-hud-btn h-7 ui-v1-radius-sm px-2.5 text-[11px] opacity-85"
                          >
                            Reschedule remaining
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleMarkDone(task)}
                            disabled={!canWriteTasks}
                            className="ui-hud-btn-soft h-7 ui-v1-radius-sm px-2.5 text-[11px]"
                          >
                            Mark Done
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  {runningLateTasks.length === 0 && (
                    <p className="text-xs text-[color:var(--hud-muted)]">
                      No running tasks are late.
                    </p>
                  )}
                </div>

                <div className="mt-3 space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
                    Missed
                  </p>
                  {missedTasks.slice(0, 3).map((task) => (
                    <div key={task.id} className="ui-hud-row ui-v1-radius-sm p-2">
                      <p className="truncate text-sm font-semibold text-[color:var(--hud-text)]">
                        {task.title}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleStart(task)}
                          disabled={!canWriteTasks}
                          className="ui-hud-btn-accent h-7 ui-v1-radius-sm px-2.5 text-[11px]"
                        >
                          Start
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => carryToTomorrow(task)}
                          disabled={!canWriteTasks}
                          className="ui-hud-btn h-7 ui-v1-radius-sm px-2.5 text-[11px] opacity-85"
                        >
                          Carry Tomorrow
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => rescheduleNext(task)}
                          disabled={!canWriteTasks}
                          className="ui-hud-btn h-7 ui-v1-radius-sm px-2.5 text-[11px] opacity-85"
                        >
                          Next Slot
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleMarkDone(task)}
                          disabled={!canWriteTasks}
                          className="ui-hud-btn-soft h-7 ui-v1-radius-sm px-2.5 text-[11px]"
                        >
                          Mark Done
                        </Button>
                      </div>
                    </div>
                  ))}
                  {missedTasks.length === 0 && (
                    <p className="text-xs text-[color:var(--hud-muted)]">
                      No overdue tasks right now.
                    </p>
                  )}
                </div>
              </section>
            </div>
          </div>
        )}

        {!isCollapsed && showReview && (
          <div className="ui-hud-section mt-3 ui-v1-radius-sm p-3">
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-[color:var(--hud-text)]">
              <span className="inline-flex items-center gap-1">
                <Clock3 className="size-3.5" />
                Today: {reviewSummary.total}
              </span>
              <Badge className="ui-status-success rounded-full px-2 text-[10px]">
                Done {reviewSummary.completed}
              </Badge>
              <Badge className="ui-status-warning rounded-full px-2 text-[10px]">
                Open {reviewSummary.remaining}
              </Badge>
              <Badge className="ui-status-danger rounded-full px-2 text-[10px]">
                Overdue {reviewSummary.overdueCount}
              </Badge>
              <Badge className="ui-status-info rounded-full px-2 text-[10px]">
                Tomorrow starts {minutesToTime(workStartMinutes)}
              </Badge>
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <div
                data-testid="daily-execution-reliability"
                className="ui-hud-row ui-v1-radius-sm px-3 py-2"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
                  Execution reliability (7d)
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge
                    className={`rounded-full px-2 text-[10px] ${
                      weeklyExecutionInsights.reliabilityScore === null
                        ? 'ui-status-info'
                        : weeklyExecutionInsights.reliabilityScore >= 75
                          ? 'ui-status-success'
                          : weeklyExecutionInsights.reliabilityScore >= 50
                            ? 'ui-status-warning'
                            : 'ui-status-danger'
                    }`}
                  >
                    {weeklyExecutionInsights.reliabilityScore === null
                      ? 'n/a'
                      : `${weeklyExecutionInsights.reliabilityScore}%`}
                  </Badge>
                  <p className="text-[11px] text-[color:var(--hud-muted)]">
                    Completed {weeklyExecutionInsights.completedCount}/
                    {weeklyExecutionInsights.scheduledCount} scheduled tasks
                  </p>
                </div>
                <p className="mt-1 text-[11px] text-[color:var(--hud-muted)]">
                  On-track {weeklyExecutionInsights.onTrackCount} | Overrun{' '}
                  {weeklyExecutionInsights.overrunCount} | Underrun{' '}
                  {weeklyExecutionInsights.underrunCount}
                </p>
              </div>
              <div
                data-testid="daily-drift-analytics"
                className="ui-hud-row ui-v1-radius-sm px-3 py-2"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
                  Drift analytics
                </p>
                {!executionModeEnabled ? (
                  <p className="mt-1 text-[11px] text-[color:var(--hud-muted)]">
                    Enable Execution mode in settings to track runtime drift trends.
                  </p>
                ) : (
                  <>
                    <p className="mt-1 text-[12px] font-semibold text-[color:var(--hud-text)]">
                      Avg drift: {formatSignedMinutes(weeklyExecutionInsights.averageDriftMinutes)}
                    </p>
                    <p className="mt-1 text-[11px] text-[color:var(--hud-muted)]">
                      {weeklyExecutionInsights.topDriftWindow
                        ? `Peak overrun window: ${weeklyExecutionInsights.topDriftWindow.label} (${formatSignedMinutes(
                            weeklyExecutionInsights.topDriftWindow.averageDriftMinutes
                          )})`
                        : 'No positive drift window detected in the current 7-day range.'}
                    </p>
                    <p
                      data-testid="daily-overrun-heatmap"
                      className="mt-1 text-[11px] text-[color:var(--hud-muted)]"
                    >
                      {weeklyExecutionForecast.overrunHeatmap.length > 0
                        ? `Overrun heatmap: ${weeklyExecutionForecast.overrunHeatmap[0].label} (${weeklyExecutionForecast.overrunHeatmap[0].overrunCount} overruns, avg +${Math.max(
                            1,
                            Math.round(
                              weeklyExecutionForecast.overrunHeatmap[0].averageOverrunMinutes
                            )
                          )}m)`
                        : 'Overrun heatmap needs more completed tasks to calibrate.'}
                    </p>
                  </>
                )}
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                size="sm"
                data-testid="daily-review-carryover"
                onClick={runCarryOver}
                disabled={!canWriteTasks}
                className="ui-hud-btn-accent h-8 ui-v1-radius-sm px-3 text-[11px]"
              >
                Carry Open Tasks to Tomorrow
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShowReview(false)}
                className="ui-hud-btn h-8 ui-v1-radius-sm px-3 text-[11px] opacity-85"
              >
                Close Review
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatTaskTime(startDateTime: string): string {
  const date = new Date(startDateTime);
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatMinutes(totalMinutes: number): string {
  const normalized = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function formatSignedMinutes(totalMinutes: number | null): string {
  if (totalMinutes === null || !Number.isFinite(totalMinutes)) return 'n/a';
  const rounded = Math.round(totalMinutes);
  if (rounded === 0) return '0m';
  const sign = rounded > 0 ? '+' : '-';
  return `${sign}${Math.abs(rounded)}m`;
}

function formatDayKeyLabel(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dayKey;
  return date.toLocaleDateString([], { weekday: 'short' });
}
