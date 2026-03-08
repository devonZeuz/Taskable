import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTasks } from './TaskContext';
import { useCloudSync } from './CloudSyncContext';
import { useUserPreferences, type NotificationLeadMinutes } from './UserPreferencesContext';
import { useWorkday } from './WorkdayContext';
import {
  combineDayAndTime,
  findNextAvailableSlot,
  findNextAvailableSlotAfter,
  getDayKey,
} from '../services/scheduling';
import { applyAdaptiveExtendPlan, buildAdaptiveExtendPlan } from '../services/adaptiveScheduling';
import {
  calculateElapsedMinutes,
  getOverrunMinutes,
  getScheduledEndTimestamp,
  roundDurationToGrid,
} from '../services/taskTimer';
import { playReminderChime } from '../services/uiSounds';

interface NotificationSettingsContextType {
  enabled: boolean;
  permission: NotificationPermission | 'unsupported';
  incomingLeadTimes: NotificationLeadMinutes[];
  endPromptEnabled: boolean;
  followUpOverrunIntervals: NotificationLeadMinutes[];
  hasActiveEndPrompt: boolean;
  setEnabled: (enabled: boolean) => void;
  setIncomingLeadTimes: (times: NotificationLeadMinutes[]) => void;
  setEndPromptEnabled: (enabled: boolean) => void;
  setFollowUpOverrunIntervals: (times: NotificationLeadMinutes[]) => void;
  requestPermission: () => Promise<NotificationPermission | 'unsupported'>;
}

const STORAGE_KEY = 'taskable:notifications-enabled';
const LEGACY_STORAGE_KEY = 'Tareva:notifications-enabled';
const CHECK_INTERVAL_MS = 10_000;
const TASK_ENDING_SOON_LEAD_MINUTES = 5;

const NotificationSettingsContext = createContext<NotificationSettingsContextType | undefined>(
  undefined
);

interface EndPromptItem {
  key: string;
  taskId: string;
  scheduledEndMs: number;
}

interface ReminderNotifyOptions {
  persistent?: boolean;
  playSound?: boolean;
}

function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function loadEnabledState(): boolean {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current !== null) {
      return current === 'true';
    }
    return localStorage.getItem(LEGACY_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function formatClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function normalizeLeadTimes(times: NotificationLeadMinutes[]): NotificationLeadMinutes[] {
  const deduped = Array.from(new Set(times));
  return deduped.sort((a, b) => b - a) as NotificationLeadMinutes[];
}

function normalizeFollowUpIntervals(times: NotificationLeadMinutes[]): NotificationLeadMinutes[] {
  const deduped = Array.from(new Set(times));
  return deduped.sort((a, b) => a - b) as NotificationLeadMinutes[];
}

export function NotificationSettingsProvider({ children }: { children: React.ReactNode }) {
  const { tasks, markTaskPrompted, completeTask, moveTask, updateTask, pauseTask } = useTasks();
  const {
    enabled: cloudEnabled,
    token: cloudToken,
    activeOrgId,
    ackTaskEndPrompt,
    isTaskConflictLocked,
    openConflictResolver,
  } = useCloudSync();
  const { workday } = useWorkday();
  const {
    preferences: {
      notificationLeadTimes,
      endPromptEnabled,
      followUpOverrunIntervals,
      adaptiveMode,
      slotMinutes,
      autoShoveOnExtend,
      soundEffectsEnabled,
    },
    setPreference,
  } = useUserPreferences();
  const [enabled, setEnabled] = useState<boolean>(() => loadEnabledState());
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => {
    if (!isNotificationSupported()) return 'unsupported';
    return Notification.permission;
  });
  const notifiedRef = useRef<Record<string, number>>({});
  const promptedRef = useRef<Record<string, number>>({});
  const fallbackNoticeShownRef = useRef(false);
  const endPromptShownRef = useRef<Record<string, number>>({});
  const endPromptAckPendingRef = useRef<Record<string, boolean>>({});
  const [endPromptQueue, setEndPromptQueue] = useState<EndPromptItem[]>([]);
  const [activeEndPromptIndex, setActiveEndPromptIndex] = useState(0);

  const dismissEndPrompt = useCallback((promptKey: string) => {
    setEndPromptQueue((current) => current.filter((entry) => entry.key !== promptKey));
  }, []);

  useEffect(() => {
    if (!endPromptQueue.length) {
      if (activeEndPromptIndex !== 0) {
        setActiveEndPromptIndex(0);
      }
      return;
    }
    if (activeEndPromptIndex > endPromptQueue.length - 1) {
      setActiveEndPromptIndex(endPromptQueue.length - 1);
    }
  }, [activeEndPromptIndex, endPromptQueue.length]);

  useEffect(() => {
    if (!endPromptQueue.length) return;
    const runningTaskIds = new Set(
      tasks
        .filter((task) => task.type !== 'block' && task.executionStatus === 'running')
        .map((task) => task.id)
    );
    setEndPromptQueue((current) => current.filter((entry) => runningTaskIds.has(entry.taskId)));
  }, [endPromptQueue.length, tasks]);

  const notify = useCallback(
    (title: string, body: string, dedupeKey: string, options: ReminderNotifyOptions = {}) => {
      if (notifiedRef.current[dedupeKey]) return;

      if (enabled && permission === 'granted' && isNotificationSupported()) {
        new Notification(title, {
          body,
          tag: dedupeKey,
          requireInteraction: Boolean(options.persistent),
        });
      } else {
        toast.message(title, {
          description: body,
          duration: options.persistent ? Number.POSITIVE_INFINITY : 5000,
        });
      }

      if (options.playSound && soundEffectsEnabled) {
        playReminderChime();
      }
      notifiedRef.current[dedupeKey] = Date.now();
    },
    [enabled, permission, soundEffectsEnabled]
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // ignore persistence errors
    }
  }, [enabled]);

  useEffect(() => {
    if (!isNotificationSupported()) return;
    setPermission(Notification.permission);
  }, []);

  const ensureConflictUnlocked = useCallback(
    (taskId: string, actionLabel: string) => {
      if (!isTaskConflictLocked(taskId)) return true;
      toast.error(`${actionLabel} is blocked until this conflict is resolved.`);
      openConflictResolver(taskId);
      return false;
    },
    [isTaskConflictLocked, openConflictResolver]
  );

  const handleRescheduleRemaining = useCallback(
    (taskId: string) => {
      const task = tasks.find((entry) => entry.id === taskId);
      if (!task || !task.startDateTime || task.status === 'inbox') {
        toast.error('Schedule this task before rescheduling remaining work.');
        return false;
      }
      if (!ensureConflictUnlocked(task.id, 'Reschedule remaining work')) {
        return false;
      }

      const nowMs = Date.now();
      const elapsedMinutes = calculateElapsedMinutes(task, nowMs);
      const remainingRaw = Math.max(slotMinutes, task.durationMinutes - elapsedMinutes);
      const remainingMinutes = roundDurationToGrid(remainingRaw, slotMinutes);
      const now = new Date(nowMs);
      const todayKey = getDayKey(now);
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const todaySlot = findNextAvailableSlotAfter(
        tasks,
        todayKey,
        remainingMinutes,
        nowMinutes,
        task.id,
        workday
      );

      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const tomorrowKey = getDayKey(tomorrow);
      const fallbackSlot = todaySlot
        ? null
        : findNextAvailableSlot(tasks, tomorrowKey, remainingMinutes, task.id, workday);
      const targetDay = todaySlot ? todayKey : tomorrowKey;
      const targetSlot = todaySlot ?? fallbackSlot;

      if (!targetSlot) {
        toast.error('No room available for remaining work.');
        return false;
      }

      moveTask(task.id, combineDayAndTime(targetDay, targetSlot.startTime).toISOString());
      updateTask(task.id, {
        durationMinutes: remainingMinutes,
        executionStatus: 'paused',
        lastEndPromptAt: undefined,
        lastPromptAt: undefined,
      });
      toast.success('Moved remaining work to the next available slot.');
      return true;
    },
    [ensureConflictUnlocked, moveTask, slotMinutes, tasks, updateTask, workday]
  );

  const handleExtendToNow = useCallback(
    (taskId: string, allowConflictOverride = false) => {
      const task = tasks.find((entry) => entry.id === taskId);
      if (!task) return false;
      if (!ensureConflictUnlocked(task.id, 'Extend to now')) {
        return false;
      }

      const nowMs = Date.now();
      const plan = buildAdaptiveExtendPlan(tasks, task, nowMs, slotMinutes, workday);
      const result = applyAdaptiveExtendPlan({
        plan,
        taskId: task.id,
        autoShoveOnExtend,
        setDuration: (currentTaskId, durationMinutes) =>
          updateTask(currentTaskId, {
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
        return true;
      }
      if (result.outcome === 'extended') {
        toast.success('Task schedule extended.');
        return true;
      }
      if (result.outcome === 'no_change') {
        toast.message('Task schedule already covers current time.');
        return false;
      }
      if (result.outcome === 'outside_workday') {
        toast.error('Cannot extend beyond current workday.');
        return false;
      }
      if (result.outcome === 'conflict') {
        if (allowConflictOverride) {
          if (!ensureConflictUnlocked(task.id, 'Extend to now')) {
            return false;
          }
          updateTask(task.id, {
            durationMinutes: plan.nextDurationMinutes,
            lastEndPromptAt: undefined,
            lastPromptAt: undefined,
          });
          toast.message('Extended with overlap. Review displaced tasks in your timeline.');
          return true;
        }
        const conflictToastId = `extend-conflict:${task.id}:${plan.nextDurationMinutes}`;
        toast.custom(
          (toastId) => (
            <div className="ui-hud-shell w-[360px] ui-v1-radius-sm p-3">
              <p className="text-sm font-semibold text-[color:var(--hud-text)]">
                Extension conflict
              </p>
              <p className="mt-1 text-xs text-[color:var(--hud-muted)]">
                Extending now overlaps {Math.max(1, plan.overlapCount)} task
                {plan.overlapCount === 1 ? '' : 's'}.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="ui-hud-btn-soft h-8 ui-v1-radius-sm px-3 text-[11px] font-semibold"
                  onClick={() => {
                    if (!ensureConflictUnlocked(task.id, 'Extend to now')) {
                      toast.dismiss(toastId);
                      return;
                    }
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
          { id: conflictToastId, duration: 12_000 }
        );
        return false;
      }

      toast.error('Unable to extend this task right now.');
      return false;
    },
    [autoShoveOnExtend, ensureConflictUnlocked, moveTask, slotMinutes, tasks, updateTask, workday]
  );

  const showEndPrompt = useCallback(
    (taskId: string, scheduledEndMs: number) => {
      const task = tasks.find((entry) => entry.id === taskId);
      if (task?.type === 'block') return;
      if (!task || task.executionStatus !== 'running') return;
      const promptKey = `${task.id}:${scheduledEndMs}`;
      if (endPromptShownRef.current[promptKey]) return;
      endPromptShownRef.current[promptKey] = Date.now();
      setEndPromptQueue((current) => {
        if (current.some((entry) => entry.key === promptKey)) {
          return current;
        }
        return [...current, { key: promptKey, taskId: task.id, scheduledEndMs }];
      });
    },
    [tasks]
  );

  useEffect(() => {
    if (!enabled) return;

    if (!isNotificationSupported() || permission !== 'granted') {
      if (!fallbackNoticeShownRef.current) {
        toast.message('Browser notifications are unavailable.', {
          description: 'Tareva will use in-app reminders while this tab is active.',
        });
        fallbackNoticeShownRef.current = true;
      }
    } else {
      fallbackNoticeShownRef.current = false;
    }

    const tick = () => {
      const now = Date.now();

      tasks.forEach((task) => {
        if (task.type === 'block') return;
        if (!task.startDateTime || task.status === 'inbox' || task.completed) return;

        const taskStartMs = Date.parse(task.startDateTime);
        if (!Number.isFinite(taskStartMs)) return;

        const diffMs = taskStartMs - now;

        if (task.executionStatus !== 'running') {
          notificationLeadTimes.forEach((leadMinutes) => {
            const leadMs = leadMinutes * 60 * 1000;
            if (diffMs < 0 || diffMs > leadMs) return;
            const key = `${task.id}:${task.startDateTime}:lead:${leadMinutes}`;
            notify(
              task.title,
              `Starts at ${formatClock(new Date(taskStartMs))}. (${leadMinutes} min)`,
              key,
              {
                persistent: leadMinutes === 15,
                playSound: leadMinutes === 15,
              }
            );
          });
        }

        if (task.executionStatus === 'running') {
          const scheduledEndMs = getScheduledEndTimestamp(task);
          if (scheduledEndMs !== null) {
            const remainingMs = scheduledEndMs - now;
            const endingSoonLeadMs = TASK_ENDING_SOON_LEAD_MINUTES * 60 * 1000;
            if (remainingMs > 0 && remainingMs <= endingSoonLeadMs) {
              const key = `${task.id}:${scheduledEndMs}:ending-soon:${TASK_ENDING_SOON_LEAD_MINUTES}`;
              notify(
                task.title,
                `Ends at ${formatClock(new Date(scheduledEndMs))}. ${TASK_ENDING_SOON_LEAD_MINUTES} min left.`,
                key
              );
            }
          }
        }

        if (!adaptiveMode || !endPromptEnabled || task.executionStatus !== 'running') return;

        const scheduledEndMs = getScheduledEndTimestamp(task);
        if (scheduledEndMs === null || now < scheduledEndMs) return;

        const promptKey = `${task.id}:${scheduledEndMs}`;
        const lastPromptMs = task.lastEndPromptAt ? Date.parse(task.lastEndPromptAt) : Number.NaN;
        const alreadyPromptedInTask =
          Number.isFinite(lastPromptMs) && lastPromptMs >= scheduledEndMs;

        if (!promptedRef.current[promptKey] && !alreadyPromptedInTask) {
          if (cloudEnabled && cloudToken && activeOrgId) {
            if (endPromptAckPendingRef.current[promptKey]) return;
            endPromptAckPendingRef.current[promptKey] = true;
            void ackTaskEndPrompt(task.id, new Date(scheduledEndMs).toISOString(), task.version)
              .then((result) => {
                promptedRef.current[promptKey] = Date.now();
                if (!result.accepted) return;
                showEndPrompt(task.id, scheduledEndMs);
                notify(
                  task.title,
                  'Planned time ended. Use the end prompt to Done, Extend, Keep Running, or Reschedule.',
                  `task-end-prompt:${promptKey}`
                );
              })
              .finally(() => {
                delete endPromptAckPendingRef.current[promptKey];
              });
          } else {
            promptedRef.current[promptKey] = now;
            markTaskPrompted(task.id, new Date(now).toISOString());
            showEndPrompt(task.id, scheduledEndMs);
            notify(
              task.title,
              'Planned time ended. Use the end prompt to Done, Extend, Keep Running, or Reschedule.',
              `task-end-prompt:${promptKey}`
            );
          }
        }

        const overrunMinutes = getOverrunMinutes(task, now);
        if (overrunMinutes <= 0) return;

        followUpOverrunIntervals.forEach((interval) => {
          if (overrunMinutes < interval) return;
          const followUpKey = `${task.id}:${scheduledEndMs}:follow:${interval}`;
          notify(task.title, `Running late by ${Math.floor(overrunMinutes)} minutes.`, followUpKey);
        });
      });

      Object.entries(notifiedRef.current).forEach(([key, timestamp]) => {
        if (now - timestamp > 24 * 60 * 60 * 1000) {
          delete notifiedRef.current[key];
        }
      });
    };

    tick();
    const interval = window.setInterval(tick, CHECK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [
    ackTaskEndPrompt,
    adaptiveMode,
    activeOrgId,
    cloudEnabled,
    cloudToken,
    enabled,
    endPromptEnabled,
    handleExtendToNow,
    handleRescheduleRemaining,
    markTaskPrompted,
    notificationLeadTimes,
    notify,
    followUpOverrunIntervals,
    permission,
    showEndPrompt,
    slotMinutes,
    tasks,
  ]);

  const requestPermission = async (): Promise<NotificationPermission | 'unsupported'> => {
    if (!isNotificationSupported()) {
      return 'unsupported';
    }

    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  };

  const value = useMemo(
    () => ({
      enabled,
      permission,
      incomingLeadTimes: notificationLeadTimes,
      endPromptEnabled,
      followUpOverrunIntervals,
      hasActiveEndPrompt: endPromptQueue.length > 0,
      setEnabled,
      setIncomingLeadTimes: (times: NotificationLeadMinutes[]) => {
        setPreference('notificationLeadTimes', normalizeLeadTimes(times));
      },
      setEndPromptEnabled: (nextEnabled: boolean) => {
        setPreference('endPromptEnabled', nextEnabled);
      },
      setFollowUpOverrunIntervals: (times: NotificationLeadMinutes[]) => {
        setPreference('followUpOverrunIntervals', normalizeFollowUpIntervals(times));
      },
      requestPermission,
    }),
    [
      enabled,
      permission,
      notificationLeadTimes,
      endPromptEnabled,
      followUpOverrunIntervals,
      endPromptQueue.length,
      setPreference,
    ]
  );

  return (
    <NotificationSettingsContext.Provider value={value}>
      {children}
      <EndPromptHud
        activePrompt={endPromptQueue[activeEndPromptIndex] ?? null}
        promptCount={endPromptQueue.length}
        activeIndex={activeEndPromptIndex}
        onPrev={() => {
          setActiveEndPromptIndex((current) =>
            endPromptQueue.length
              ? (current - 1 + endPromptQueue.length) % endPromptQueue.length
              : 0
          );
        }}
        onNext={() => {
          setActiveEndPromptIndex((current) =>
            endPromptQueue.length ? (current + 1) % endPromptQueue.length : 0
          );
        }}
        resolveTask={(taskId) => tasks.find((entry) => entry.id === taskId) ?? null}
        onDismiss={dismissEndPrompt}
        onMarkDone={(prompt) => {
          if (!ensureConflictUnlocked(prompt.taskId, 'Mark done')) return;
          completeTask(prompt.taskId);
          dismissEndPrompt(prompt.key);
        }}
        onKeepRunning={(prompt) => {
          dismissEndPrompt(prompt.key);
        }}
        onExtendToNow={(prompt) => {
          const didExtend = handleExtendToNow(prompt.taskId);
          if (didExtend) {
            dismissEndPrompt(prompt.key);
          }
        }}
        onRescheduleRemaining={(prompt) => {
          const didReschedule = handleRescheduleRemaining(prompt.taskId);
          if (didReschedule) {
            if (!ensureConflictUnlocked(prompt.taskId, 'Pause task')) return;
            pauseTask(prompt.taskId);
            dismissEndPrompt(prompt.key);
          }
        }}
      />
    </NotificationSettingsContext.Provider>
  );
}

export function useNotificationSettings() {
  const context = useContext(NotificationSettingsContext);
  if (!context) {
    throw new Error('useNotificationSettings must be used within NotificationSettingsProvider');
  }
  return context;
}

interface EndPromptHudProps {
  activePrompt: EndPromptItem | null;
  promptCount: number;
  activeIndex: number;
  onPrev: () => void;
  onNext: () => void;
  resolveTask: (taskId: string) => ReturnType<typeof useTasks>['tasks'][number] | null;
  onDismiss: (promptKey: string) => void;
  onMarkDone: (prompt: EndPromptItem) => void;
  onKeepRunning: (prompt: EndPromptItem) => void;
  onExtendToNow: (prompt: EndPromptItem) => void;
  onRescheduleRemaining: (prompt: EndPromptItem) => void;
}

function EndPromptHud({
  activePrompt,
  promptCount,
  activeIndex,
  onPrev,
  onNext,
  resolveTask,
  onDismiss,
  onMarkDone,
  onKeepRunning,
  onExtendToNow,
  onRescheduleRemaining,
}: EndPromptHudProps) {
  const activeTaskId = activePrompt?.taskId ?? null;
  const task = activeTaskId ? resolveTask(activeTaskId) : null;
  const hudWidth = 264;
  const hudHeight = 162;
  const viewportMargin = 12;
  const safeTop = 84;
  const [position, setPosition] = useState(() => ({
    top: safeTop,
    left: Math.max(
      viewportMargin,
      (typeof window !== 'undefined' ? window.innerWidth : 320) - hudWidth - 16
    ),
  }));

  useEffect(() => {
    if (!activeTaskId) return;

    const updatePosition = () => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const fallbackLeft = Math.max(viewportMargin, viewportWidth - hudWidth - 16);
      const fallbackTop = safeTop;
      const card = document.querySelector<HTMLElement>(`[data-testid="task-card-${activeTaskId}"]`);

      if (!card) {
        setPosition({ top: fallbackTop, left: fallbackLeft });
        return;
      }

      const rect = card.getBoundingClientRect();
      const left = clamp(
        rect.right - hudWidth,
        viewportMargin,
        viewportWidth - hudWidth - viewportMargin
      );
      let top = rect.top - hudHeight - 10;
      if (top < safeTop) {
        top = rect.bottom + 10;
      }
      top = clamp(top, safeTop, viewportHeight - hudHeight - viewportMargin);

      setPosition({ top, left });
    };

    let rafId = 0;
    const schedulePositionUpdate = () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(updatePosition);
    };

    schedulePositionUpdate();
    window.addEventListener('resize', schedulePositionUpdate);
    window.addEventListener('scroll', schedulePositionUpdate, true);

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', schedulePositionUpdate);
      window.removeEventListener('scroll', schedulePositionUpdate, true);
    };
  }, [activeTaskId, hudHeight, hudWidth]);

  if (!activePrompt || !task) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[45]">
      <div
        className="pointer-events-auto absolute w-[264px] ui-v1-radius-md border border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-2.5 py-2 ui-v1-elevation-3 backdrop-blur-md"
        style={{ top: `${Math.round(position.top)}px`, left: `${Math.round(position.left)}px` }}
      >
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-[color:var(--hud-text)] opacity-85">
              Task ending now
            </p>
            <p className="truncate text-[12px] font-bold tracking-[-0.02em] text-[color:var(--hud-text)]">
              {task.title}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {promptCount > 1 && (
              <>
                <button
                  type="button"
                  onClick={onPrev}
                  className="flex h-6.5 w-6.5 items-center justify-center ui-v1-radius-xs border border-[color:var(--hud-border)] bg-[var(--hud-surface-strong)] text-[color:var(--hud-text)] opacity-80 transition-colors hover:brightness-105 hover:opacity-100"
                  title="Previous prompt"
                >
                  <ChevronLeft className="size-3.5" />
                </button>
                <span className="text-[10px] font-semibold text-[color:var(--hud-text)] opacity-75">
                  {activeIndex + 1}/{promptCount}
                </span>
                <button
                  type="button"
                  onClick={onNext}
                  className="flex h-6.5 w-6.5 items-center justify-center ui-v1-radius-xs border border-[color:var(--hud-border)] bg-[var(--hud-surface-strong)] text-[color:var(--hud-text)] opacity-80 transition-colors hover:brightness-105 hover:opacity-100"
                  title="Next prompt"
                >
                  <ChevronRight className="size-3.5" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => onDismiss(activePrompt.key)}
              className="flex h-6.5 w-6.5 items-center justify-center ui-v1-radius-xs border border-[color:var(--hud-border)] bg-[var(--hud-surface-strong)] text-[color:var(--hud-text)] opacity-80 transition-colors hover:brightness-105 hover:opacity-100"
              title="Dismiss prompt"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1">
          <button
            type="button"
            onClick={() => onMarkDone(activePrompt)}
            className="inline-flex h-8 min-w-0 items-center justify-center ui-v1-radius-sm border border-[color:var(--hud-border)] bg-[var(--hud-accent-soft)] px-2 text-[10.5px] font-semibold text-[var(--hud-accent-soft-text)]"
          >
            Mark done
          </button>
          <button
            type="button"
            onClick={() => onKeepRunning(activePrompt)}
            className="inline-flex h-8 min-w-0 items-center justify-center ui-v1-radius-sm border border-[color:var(--hud-border)] bg-transparent px-2 text-[10.5px] font-semibold text-[color:var(--hud-text)] opacity-90"
          >
            Keep running
          </button>
          <button
            type="button"
            onClick={() => onExtendToNow(activePrompt)}
            className="inline-flex h-8 min-w-0 items-center justify-center ui-v1-radius-sm border border-[color:var(--hud-border)] bg-transparent px-2 text-[10.5px] font-semibold text-[color:var(--hud-text)] opacity-90"
          >
            Extend to now
          </button>
          <button
            type="button"
            onClick={() => onRescheduleRemaining(activePrompt)}
            className="inline-flex h-8 min-w-0 items-center justify-center ui-v1-radius-sm border border-[color:var(--hud-border)] bg-transparent px-2 text-[10.5px] font-semibold text-[color:var(--hud-text)] opacity-90"
          >
            Reschedule
          </button>
        </div>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
