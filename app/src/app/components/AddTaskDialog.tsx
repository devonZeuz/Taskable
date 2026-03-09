import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Switch } from './ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar as DayPickerCalendar } from './ui/calendar';
import {
  Calendar as CalendarIcon,
  Plus,
  X,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Search,
  UserRound,
  Check,
} from 'lucide-react';
import { useTasks, Task, SubTask } from '../context/TaskContext';
import { useTeamMembers } from '../context/TeamMembersContext';
import { useWorkday } from '../context/WorkdayContext';
import { APP_THEME_TASK_SWATCHES, useAppTheme } from '../context/AppThemeContext';
import { useCloudSync } from '../context/CloudSyncContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import { Alert, AlertDescription } from './ui/alert';
import { toast } from 'sonner';
import { buildEffectiveMembers } from '../services/memberDirectory';
import { getTaskSuggestions } from '../services/taskTelemetry';
import { suggestDuration } from '../services/durationProfile';
import { playCalendarSnapSound } from '../services/uiSounds';
import { getRandomThemeColor } from '../services/taskColor';
import { resolveLayoutV1Flag } from '../flags';
import {
  combineDayAndTime,
  findNextAvailableSlot,
  getDayKey,
  getDayKeyFromDateTime,
  getDateFromDayKey,
  getRemainingCapacityMinutes,
  minutesToTime,
  timeToMinutes,
} from '../services/scheduling';
import { buildBlockShiftPlan } from '../services/blockScheduling';

interface AddTaskDialogProps {
  defaultDay?: string;
  defaultTime?: string;
  defaultAssignee?: string;
  scheduleTasks?: Task[];
  editTask?: Task;
  hideTrigger?: boolean;
  playSnapOnSubmit?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
}

const DURATION_PRESET_MINUTES = [15, 30, 45, 60, 90, 120];
const DEFAULT_OPEN_DISMISS_GUARD_MS = 320;
const RUNNING_TASK_OPEN_DISMISS_GUARD_MS = 2500;
const TASK_TYPE_HELP: Record<'quick' | 'large' | 'block', string> = {
  quick: 'Quick: short focused task that fits in a standard slot.',
  large: 'Complex: multi-step work with subtasks and deeper tracking.',
  block: "Block: reserved time window where tasks can't be scheduled.",
};

export default function AddTaskDialog({
  defaultDay,
  defaultTime,
  defaultAssignee,
  scheduleTasks,
  editTask,
  hideTrigger = false,
  playSnapOnSubmit,
  open: controlledOpen,
  onOpenChange,
  onClose,
}: AddTaskDialogProps) {
  const { addTask, moveTasksAtomic, updateTask, tasks } = useTasks();
  const { members: localMembers } = useTeamMembers();
  const {
    enabled: cloudEnabled,
    token: cloudToken,
    activeOrgId,
    members: cloudMembers,
    user,
    presenceLocks,
    canWriteTasks,
    activeOrgRole,
    claimPresenceLock,
    releasePresenceLock,
    isTaskConflictLocked,
    openConflictResolver,
  } = useCloudSync();
  const { workday } = useWorkday();
  const {
    preferences: { defaultTaskDurationMinutes, slotMinutes, soundEffectsEnabled },
  } = useUserPreferences();
  const layoutV1Enabled = resolveLayoutV1Flag();
  const { theme } = useAppTheme();
  const activeSwatches = APP_THEME_TASK_SWATCHES[theme];
  const useCloudMembers = cloudEnabled && Boolean(cloudToken && activeOrgId);
  const openedAtRef = useRef<number>(0);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const members = useMemo(
    () => buildEffectiveMembers(localMembers, cloudMembers, useCloudMembers),
    [cloudMembers, localMembers, useCloudMembers]
  );
  const scheduleScopeTasks = scheduleTasks ?? tasks;
  const shouldPlaySnapOnSubmit = playSnapOnSubmit ?? !editTask;
  const isOpenControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(Boolean(editTask) || hideTrigger);
  const open = isOpenControlled ? Boolean(controlledOpen) : internalOpen;
  const openDismissGuardMs = tasks.some((task) => task.executionStatus === 'running')
    ? RUNNING_TASK_OPEN_DISMISS_GUARD_MS
    : DEFAULT_OPEN_DISMISS_GUARD_MS;

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const initialDayKey = editTask?.startDateTime
    ? getDayKeyFromDateTime(editTask.startDateTime)
    : defaultDay || getDayKey(todayStart);
  const roundedNowMinutes = Math.max(
    0,
    Math.min(
      24 * 60 - slotMinutes,
      Math.round((now.getHours() * 60 + now.getMinutes()) / slotMinutes) * slotMinutes
    )
  );
  const roundedNowTime = minutesToTime(roundedNowMinutes);
  const initialDurationMinutes = editTask?.durationMinutes || defaultTaskDurationMinutes;
  const todayDayKey = getDayKey(todayStart);
  const initialStartTime = editTask?.startDateTime
    ? formatTime(new Date(editTask.startDateTime))
    : defaultTime ||
      (initialDayKey === todayDayKey
        ? roundedNowTime
        : findNextAvailableSlot(
            scheduleScopeTasks,
            initialDayKey,
            initialDurationMinutes,
            undefined,
            workday
          )?.startTime || roundedNowTime);
  const initialScheduleLater = editTask
    ? editTask.status === 'inbox' || !editTask.startDateTime
    : false;

  const [formData, setFormData] = useState({
    title: editTask?.title || 'New Task',
    description: editTask?.description || '',
    day: initialDayKey,
    startTime: initialStartTime,
    durationMinutes: initialDurationMinutes,
    color: editTask?.color || getRandomThemeColor(theme),
    type: editTask?.type || ('quick' as 'quick' | 'large' | 'block'),
    subtasks: editTask?.subtasks || ([] as SubTask[]),
    assignedTo: editTask?.assignedTo || defaultAssignee || 'unassigned',
    scheduleLater: initialScheduleLater,
  });

  const [subtaskInput, setSubtaskInput] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(() => !layoutV1Enabled);
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false);
  const [assigneeQuery, setAssigneeQuery] = useState('');
  const [taskTakeoverPending, setTaskTakeoverPending] = useState(false);
  const [dayTakeoverPending, setDayTakeoverPending] = useState(false);
  const taskLockHeartbeatRef = useRef<number | null>(null);
  const dayLockHeartbeatRef = useRef<number | null>(null);
  const claimedTaskIdRef = useRef<string | null>(null);
  const claimedDayKeyRef = useRef<string | null>(null);
  const timeOptions = useMemo(() => {
    const slots: string[] = [];
    for (let minutes = 0; minutes < 24 * 60; minutes += slotMinutes) {
      slots.push(minutesToTime(minutes));
    }
    return slots;
  }, [slotMinutes]);
  const selectedStartMinutes = timeToMinutes(formData.startTime);
  const isCrossDay =
    !formData.scheduleLater && selectedStartMinutes + formData.durationMinutes > 24 * 60;
  const shouldCheckSchedule = !formData.scheduleLater && !isCrossDay;
  const scheduleSummary = useMemo(() => {
    if (!shouldCheckSchedule) {
      return { remainingMinutes: 0, suggestion: null, outsideWorkday: false, invalidRange: false };
    }
    const remainingMinutes = getRemainingCapacityMinutes(
      scheduleScopeTasks,
      formData.day,
      editTask?.id,
      workday
    );
    const suggestion = findNextAvailableSlot(
      scheduleScopeTasks,
      formData.day,
      formData.durationMinutes,
      editTask?.id,
      workday
    );
    const startMinutes = timeToMinutes(formData.startTime);
    const endMinutes = startMinutes + formData.durationMinutes;
    const outsideWorkday = startMinutes < workday.startHour * 60 || endMinutes > workday.endHour * 60;
    const invalidRange = formData.durationMinutes <= 0 || endMinutes > 24 * 60;
    return { remainingMinutes, suggestion, outsideWorkday, invalidRange };
  }, [
    scheduleScopeTasks,
    formData.day,
    formData.startTime,
    formData.durationMinutes,
    editTask?.id,
    shouldCheckSchedule,
    workday,
  ]);

  const todayKey = todayDayKey;
  const isSelectedToday = formData.day === todayKey;

  const cannotFit = false;
  const assignableMembers = members.filter(
    (member) => member.id !== 'all' && member.id !== 'unassigned'
  );
  const meMemberId = useMemo(() => {
    const explicitUserId = user?.id;
    if (explicitUserId && explicitUserId !== 'all' && explicitUserId !== 'unassigned') {
      return explicitUserId;
    }
    if (defaultAssignee && defaultAssignee !== 'all' && defaultAssignee !== 'unassigned') {
      return defaultAssignee;
    }
    return null;
  }, [defaultAssignee, user?.id]);
  const assigneeOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; isMe: boolean }>();
    assignableMembers.forEach((member) => {
      map.set(member.id, {
        id: member.id,
        name: member.name,
        isMe: Boolean(meMemberId && member.id === meMemberId),
      });
    });
    if (meMemberId && !map.has(meMemberId)) {
      map.set(meMemberId, {
        id: meMemberId,
        name: 'Me',
        isMe: true,
      });
    }
    return Array.from(map.values());
  }, [assignableMembers, meMemberId]);
  const filteredAssigneeOptions = useMemo(() => {
    const query = assigneeQuery.trim().toLowerCase();
    if (!query) return assigneeOptions;
    return assigneeOptions.filter((option) => option.name.toLowerCase().includes(query));
  }, [assigneeOptions, assigneeQuery]);
  const selectedAssigneeOption = useMemo(
    () => assigneeOptions.find((option) => option.id === formData.assignedTo) ?? null,
    [assigneeOptions, formData.assignedTo]
  );
  const selectedAssigneeLabel =
    formData.assignedTo === 'unassigned'
      ? 'Unassigned'
      : (selectedAssigneeOption?.name ?? 'Assignee');
  const selectedAssigneeInitials =
    formData.assignedTo === 'unassigned' ? '—' : getInitials(selectedAssigneeLabel);
  const taskLockByOther = useMemo(() => {
    if (!editTask) return null;
    const lock = presenceLocks.find(
      (entry) => entry.scope === 'task' && entry.targetId === editTask.id
    );
    if (!lock || lock.userId === user?.id) return null;
    return lock;
  }, [editTask, presenceLocks, user?.id]);
  const dayLockByOther = useMemo(() => {
    if (formData.scheduleLater) return null;
    const lock = presenceLocks.find(
      (entry) => entry.scope === 'day' && entry.targetId === formData.day
    );
    if (!lock || lock.userId === user?.id) return null;
    return lock;
  }, [formData.day, formData.scheduleLater, presenceLocks, user?.id]);
  const editTaskId = editTask?.id;
  const blockedByTaskLock = Boolean(editTask && taskLockByOther);
  const blockedByConflictLock = Boolean(editTask && isTaskConflictLocked(editTask.id));
  const roleLabel = activeOrgRole ?? 'viewer';
  const canForceTakeover = activeOrgRole === 'owner' || activeOrgRole === 'admin';
  const taskSuggestions = useMemo(
    () =>
      getTaskSuggestions({
        title: formData.title,
        type: formData.type,
        slotMinutes,
        currentDurationMinutes: formData.durationMinutes,
      }),
    [formData.durationMinutes, formData.title, formData.type, slotMinutes]
  );
  const durationProfileSuggestion = useMemo(
    () =>
      suggestDuration({
        title: formData.title,
        type: formData.type,
        plannedMinutes: formData.durationMinutes,
        slotMinutes,
      }),
    [formData.durationMinutes, formData.title, formData.type, slotMinutes]
  );

  const setDialogOpen = (nextOpen: boolean) => {
    if (!isOpenControlled) {
      setInternalOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setAssigneePickerOpen(false);
    setAssigneeQuery('');
    onClose?.();
  };

  const shouldIgnoreImmediateDismiss = () =>
    open && Date.now() - openedAtRef.current < openDismissGuardMs;

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setShowAdvanced(!layoutV1Enabled);
      if (!editTask) {
        const randomThemeColor = getRandomThemeColor(theme);
        setFormData({
          title: 'New Task',
          description: '',
          day: initialDayKey,
          startTime: initialStartTime,
          durationMinutes: initialDurationMinutes,
          color: activeSwatches.some(
            (swatch) => swatch.value.toLowerCase() === randomThemeColor.toLowerCase()
          )
            ? randomThemeColor
            : getRandomThemeColor(theme),
          type: 'quick',
          subtasks: [],
          assignedTo: defaultAssignee || 'unassigned',
          scheduleLater: false,
        });
      }
      setDialogOpen(true);
      return;
    }
    if (shouldIgnoreImmediateDismiss()) {
      return;
    }
    closeDialog();
  };

  useEffect(() => {
    if (open) {
      openedAtRef.current = Date.now();
    }
  }, [open]);

  useEffect(() => {
    if (!open || !editTaskId || !cloudEnabled || !cloudToken || !activeOrgId) {
      return undefined;
    }

    const taskId = editTaskId;
    const claimTaskLock = async () => {
      const result = await claimPresenceLock('task', taskId);
      if (result.ok) {
        claimedTaskIdRef.current = taskId;
      }
    };

    void claimTaskLock();
    taskLockHeartbeatRef.current = window.setInterval(() => {
      void claimTaskLock();
    }, 7000);

    return () => {
      if (taskLockHeartbeatRef.current !== null) {
        window.clearInterval(taskLockHeartbeatRef.current);
        taskLockHeartbeatRef.current = null;
      }

      const claimedTaskId = claimedTaskIdRef.current;
      claimedTaskIdRef.current = null;
      if (claimedTaskId) {
        void releasePresenceLock('task', claimedTaskId);
      }
    };
  }, [
    open,
    editTaskId,
    cloudEnabled,
    cloudToken,
    activeOrgId,
    claimPresenceLock,
    releasePresenceLock,
  ]);

  useEffect(() => {
    const dayKey = formData.scheduleLater ? null : formData.day;
    if (!open || !dayKey || !cloudEnabled || !cloudToken || !activeOrgId) {
      return undefined;
    }

    const claimDayLock = async () => {
      const result = await claimPresenceLock('day', dayKey);
      if (result.ok) {
        claimedDayKeyRef.current = dayKey;
      }
    };

    void claimDayLock();
    dayLockHeartbeatRef.current = window.setInterval(() => {
      void claimDayLock();
    }, 7000);

    return () => {
      if (dayLockHeartbeatRef.current !== null) {
        window.clearInterval(dayLockHeartbeatRef.current);
        dayLockHeartbeatRef.current = null;
      }

      const claimedDay = claimedDayKeyRef.current;
      claimedDayKeyRef.current = null;
      if (claimedDay) {
        void releasePresenceLock('day', claimedDay);
      }
    };
  }, [
    open,
    formData.day,
    formData.scheduleLater,
    cloudEnabled,
    cloudToken,
    activeOrgId,
    claimPresenceLock,
    releasePresenceLock,
  ]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!canWriteTasks) {
      toast.error(`Role "${roleLabel}" is read-only in this workspace.`);
      return;
    }

    if (blockedByTaskLock && taskLockByOther) {
      toast.error(`${taskLockByOther.userName} is currently editing this task.`);
      return;
    }

    if (blockedByConflictLock && editTask) {
      toast.error('This task has a sync conflict. Resolve it before saving changes.');
      openConflictResolver(editTask.id);
      return;
    }

    if (isCrossDay || scheduleSummary.invalidRange || cannotFit) {
      return;
    }

    const blockShiftPlan =
      formData.type === 'block' && !formData.scheduleLater
        ? buildBlockShiftPlan(
            scheduleScopeTasks,
            formData.day,
            timeToMinutes(formData.startTime),
            formData.durationMinutes,
            editTask?.id,
            workday
          )
        : null;

    if (formData.type === 'block' && !formData.scheduleLater && blockShiftPlan === null) {
      toast.error('This block collides with reserved time or leaves no later slot for the work it covers.');
      return;
    }

    const normalizedSubtasks = formData.type === 'large' ? formData.subtasks : [];
    const assignedToValue = formData.assignedTo === 'unassigned' ? undefined : formData.assignedTo;
    const startDateTime = formData.scheduleLater
      ? undefined
      : combineDayAndTime(formData.day, formData.startTime).toISOString();
    const timeZone = startDateTime
      ? (editTask?.timeZone ?? getLocalTimeZone())
      : editTask?.timeZone;

    const normalizedTitle =
      formData.title.trim() || (formData.type === 'block' ? 'Block' : 'New Task');

    if (editTask) {
      updateTask(editTask.id, {
        title: normalizedTitle,
        description: formData.description,
        startDateTime,
        durationMinutes: formData.durationMinutes,
        timeZone,
        color: formData.color,
        type: formData.type,
        subtasks: normalizedSubtasks,
        assignedTo: assignedToValue,
        completed: editTask.completed,
        status: formData.scheduleLater ? 'inbox' : 'scheduled',
        executionStatus: editTask.executionStatus,
        actualMinutes: editTask.actualMinutes,
      });
    } else {
      addTask({
        title: normalizedTitle,
        description: formData.description,
        startDateTime,
        durationMinutes: formData.durationMinutes,
        timeZone,
        color: formData.color,
        type: formData.type,
        subtasks: normalizedSubtasks,
        assignedTo: assignedToValue,
        completed: false,
        status: formData.scheduleLater ? 'inbox' : 'scheduled',
        executionStatus: 'idle',
        actualMinutes: 0,
        version: 0,
      });
    }

    if (blockShiftPlan && blockShiftPlan.moves.length > 0) {
      moveTasksAtomic(
        blockShiftPlan.moves.map((move) => ({
          id: move.task.id,
          startDateTime: move.startDateTime,
        }))
      );
    }

    closeDialog();
    if (shouldPlaySnapOnSubmit && soundEffectsEnabled) {
      window.setTimeout(() => {
        playCalendarSnapSound();
      }, 140);
    }
    if (blockShiftPlan && blockShiftPlan.moves.length > 0) {
      toast.success(
        `${editTask ? 'Block updated' : 'Block created'}. Shifted ${
          blockShiftPlan.moves.length
        } task${blockShiftPlan.moves.length === 1 ? '' : 's'} out of the reserved time.`
      );
      return;
    }

    toast.success(editTask ? 'Task updated successfully!' : 'Task created successfully!');
  };

  const handleTaskTakeover = async () => {
    if (!editTaskId || !canForceTakeover || taskTakeoverPending) return;
    setTaskTakeoverPending(true);
    try {
      const result = await claimPresenceLock('task', editTaskId, { forceTakeover: true });
      if (result.ok) {
        claimedTaskIdRef.current = editTaskId;
        toast.success(
          result.takenOver ? 'Task lock taken over. You can update now.' : 'Task lock claimed.'
        );
        return;
      }
      if (result.conflict) {
        toast.error(`${result.conflict.userName} still holds the task lock.`);
      } else {
        toast.error('Unable to take over task lock right now.');
      }
    } finally {
      setTaskTakeoverPending(false);
    }
  };

  const handleDayTakeover = async () => {
    if (formData.scheduleLater || !canForceTakeover || dayTakeoverPending) return;
    setDayTakeoverPending(true);
    try {
      const result = await claimPresenceLock('day', formData.day, { forceTakeover: true });
      if (result.ok) {
        claimedDayKeyRef.current = formData.day;
        toast.success(
          result.takenOver ? 'Day lock taken over. Planning unlocked.' : 'Day lock claimed.'
        );
        return;
      }
      if (result.conflict) {
        toast.error(`${result.conflict.userName} still holds this day lock.`);
      } else {
        toast.error('Unable to take over day lock right now.');
      }
    } finally {
      setDayTakeoverPending(false);
    }
  };

  const setTaskType = (type: 'quick' | 'large' | 'block') => {
    setFormData((prev) => {
      let seededValues: Partial<typeof prev> = {};
      if (type === 'block' && !editTask && !prev.scheduleLater) {
        const now = new Date();
        const todayKey = getDayKey(now);
        const roundedNowMinutes =
          Math.round((now.getHours() * 60 + now.getMinutes()) / slotMinutes) * slotMinutes;
        const seededStartMinutes = Math.max(0, Math.min(24 * 60 - slotMinutes, roundedNowMinutes));
        seededValues = {
          day: todayKey,
          startTime: minutesToTime(seededStartMinutes),
          scheduleLater: false,
        };
      }

      const normalizedCurrentTitle = prev.title.trim().toLowerCase();
      const shouldReplaceDefaultTitle =
        !editTask &&
        (normalizedCurrentTitle === '' ||
          normalizedCurrentTitle === 'new task' ||
          normalizedCurrentTitle === 'block');

      return {
        ...prev,
        ...seededValues,
        title: shouldReplaceDefaultTitle ? (type === 'block' ? 'Block' : 'New Task') : prev.title,
        type,
        subtasks: type === 'large' ? prev.subtasks : [],
      };
    });
    if (type === 'large' && layoutV1Enabled) {
      setShowAdvanced(true);
    }
    if (type !== 'large') {
      setSubtaskInput('');
    }
  };

  const applyDurationMinutes = (minutes: number) => {
    const normalized = Number.isFinite(minutes)
      ? Math.min(600, Math.max(slotMinutes, Math.round(minutes)))
      : slotMinutes;
    setFormData((prev) => ({
      ...prev,
      durationMinutes: normalized,
    }));
  };

  const stepDurationMinutes = (delta: number) => {
    applyDurationMinutes(formData.durationMinutes + delta);
  };

  const addSubtask = () => {
    if (subtaskInput.trim()) {
      setFormData({
        ...formData,
        subtasks: [
          ...formData.subtasks,
          {
            id: Math.random().toString(36).substring(2, 11),
            title: subtaskInput,
            completed: false,
          },
        ],
      });
      setSubtaskInput('');
    }
  };

  const removeSubtask = (id: string) => {
    setFormData({
      ...formData,
      subtasks: formData.subtasks.filter((st) => st.id !== id),
    });
  };

  const getDateLabel = (dayKey: string) => {
    const date = getDateFromDayKey(dayKey);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.getTime() === today.getTime()) return 'Today';
    if (date.getTime() === tomorrow.getTime()) return 'Tomorrow';

    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  };

  const formatMinutes = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h`;
    return `${mins}m`;
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!editTask && !hideTrigger ? (
        <DialogTrigger asChild>
          <Button
            data-testid="add-task-trigger"
            className="planner-control h-9 gap-2 ui-v1-radius-sm border border-[color:var(--hud-border)] bg-[var(--hud-accent-bg)] px-4 text-[var(--hud-accent-text)] hover:brightness-95"
          >
            <Plus className="size-4" />
            Add Task
          </Button>
        </DialogTrigger>
      ) : null}
      <DialogContent
        data-testid="task-dialog-content"
        className="max-h-[90vh] max-w-[calc(100vw-1.5rem)] overflow-hidden ui-v1-radius-lg border-[color:var(--hud-border)] bg-[color:color-mix(in_srgb,var(--hud-surface)_96%,transparent)] ui-v1-elevation-3 backdrop-blur-md sm:max-w-[820px]"
        style={{ padding: 0 }}
        onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          window.requestAnimationFrame(() => {
            titleInputRef.current?.focus();
            titleInputRef.current?.select();
          });
        }}
      >
        <DialogHeader className="gap-1.5 border-b border-[color:color-mix(in_srgb,var(--hud-border)_62%,transparent)] px-5 py-4 pr-12">
          <DialogTitle className="text-[19px] tracking-[-0.025em] text-[color:var(--hud-text)]">
            {editTask ? 'Update Task' : 'Create Task'}
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed text-[color:var(--hud-muted)]">
            Plan the task, then place it with intention.
          </DialogDescription>
        </DialogHeader>

        <form
          data-testid="task-dialog-form"
          onSubmit={handleSubmit}
          className="max-h-[calc(90vh-92px)] space-y-3.5 overflow-y-auto px-5 py-4"
        >
          {!canWriteTasks && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>
                Role "{roleLabel}" is read-only in this workspace. Editing is disabled.
              </AlertDescription>
            </Alert>
          )}

          {taskLockByOther && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>
                {taskLockByOther.userName} is editing this task right now. Updates are disabled
                until the lock clears.
              </AlertDescription>
              {canForceTakeover && (
                <div className="mt-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 ui-v1-radius-sm border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] text-[11px]"
                    disabled={taskTakeoverPending}
                    onClick={() => {
                      void handleTaskTakeover();
                    }}
                  >
                    {taskTakeoverPending ? 'Taking over...' : 'Take over task lock'}
                  </Button>
                </div>
              )}
            </Alert>
          )}

          {blockedByConflictLock && editTask && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>
                This task is locked by a version conflict. Resolve it before editing.
              </AlertDescription>
              <div className="mt-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 ui-v1-radius-sm border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] text-[11px]"
                  onClick={() => openConflictResolver(editTask.id)}
                >
                  Resolve conflict
                </Button>
              </div>
            </Alert>
          )}

          {dayLockByOther && !formData.scheduleLater && (
            <Alert>
              <AlertCircle className="size-4" />
              <AlertDescription>
                {dayLockByOther.userName} is actively planning this day.
              </AlertDescription>
              {canForceTakeover && (
                <div className="mt-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 ui-v1-radius-sm border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] text-[11px]"
                    disabled={dayTakeoverPending}
                    onClick={() => {
                      void handleDayTakeover();
                    }}
                  >
                    {dayTakeoverPending ? 'Taking over...' : 'Take over day lock'}
                  </Button>
                </div>
              )}
            </Alert>
          )}

          {isCrossDay && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>
                Tasks cannot span multiple days. Reduce duration or choose an earlier start time.
              </AlertDescription>
            </Alert>
          )}

          {shouldCheckSchedule && scheduleSummary.outsideWorkday && (
            <Alert className="border-[color:var(--hud-warning-text)]/40 text-[color:var(--hud-warning-text)] [&>svg]:text-[color:var(--hud-warning-text)]">
              <AlertCircle className="size-4" />
              <AlertDescription className="text-[color:var(--hud-warning-text)]">
                Outside your workday ({minutesToTime(workday.startHour * 60)} -{' '}
                {minutesToTime(workday.endHour * 60)}).
              </AlertDescription>
            </Alert>
          )}

          {shouldCheckSchedule && scheduleSummary.invalidRange && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>
                Invalid time range. Choose a start time and duration that end before midnight.
              </AlertDescription>
            </Alert>
          )}

          {cannotFit && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>
                {isSelectedToday
                  ? 'This task cannot fit today.'
                  : 'This task cannot fit on the selected day.'}
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="title">Task Title</Label>
            <Input
              id="title"
              ref={titleInputRef}
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="e.g., Germany Invoices"
            />
          </div>

          <div
            data-testid="task-scheduling-section"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <div className="space-y-1.5">
              <Label htmlFor="day">Day</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-between font-normal"
                    disabled={formData.scheduleLater}
                  >
                    <span>{getDateLabel(formData.day)}</span>
                    <CalendarIcon className="size-4 text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <DayPickerCalendar
                    mode="single"
                    selected={getDateFromDayKey(formData.day)}
                    onSelect={(date) => {
                      if (!date) return;
                      setFormData({ ...formData, day: getDayKey(date) });
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="startTime">Start Time</Label>
              <Select
                value={formData.startTime}
                onValueChange={(value) => setFormData({ ...formData, startTime: value })}
              >
                <SelectTrigger disabled={formData.scheduleLater}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {timeOptions.map((time) => (
                    <SelectItem key={time} value={time}>
                      {time}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="duration">Duration (minutes)</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] sm:items-stretch">
                <div className="w-full ui-v1-radius-md border border-[color:color-mix(in_srgb,var(--hud-border)_58%,transparent)] bg-[color:color-mix(in_srgb,var(--hud-surface-soft)_74%,transparent)] p-3.5 sm:flex sm:w-full sm:flex-col">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="ui-hud-btn h-9 w-9 ui-v1-radius-sm p-0 text-base leading-none"
                      onClick={() => stepDurationMinutes(-slotMinutes)}
                      aria-label="Decrease duration"
                    >
                      -
                    </Button>
                    <div className="relative min-w-0 flex-1">
                      <Input
                        id="duration"
                        type="number"
                        min={slotMinutes}
                        max="600"
                        step={slotMinutes}
                        value={formData.durationMinutes}
                        onChange={(e) => {
                          const value = Number(e.target.value);
                          applyDurationMinutes(Number.isNaN(value) ? slotMinutes : value);
                        }}
                        required
                        className="h-10 border-[color:var(--hud-border)] bg-[var(--hud-surface)] pr-11 text-[14px] font-semibold"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold tracking-[0.08em] text-[color:var(--hud-muted)]">
                        MIN
                      </span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="ui-hud-btn h-9 w-9 ui-v1-radius-sm p-0 text-base leading-none"
                      onClick={() => stepDurationMinutes(slotMinutes)}
                      aria-label="Increase duration"
                    >
                      +
                    </Button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {DURATION_PRESET_MINUTES.map((minutes) => (
                      <Button
                        key={minutes}
                        type="button"
                        size="sm"
                        variant="ghost"
                        className={`h-8 ui-v1-radius-sm px-3 text-[12px] ${
                          formData.durationMinutes === minutes
                            ? 'border border-[color:var(--hud-border)] bg-[color:var(--hud-accent-soft)] text-[color:var(--hud-accent-soft-text)]'
                            : 'ui-hud-btn'
                        }`}
                        onClick={() => applyDurationMinutes(minutes)}
                      >
                        {minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}
                      </Button>
                    ))}
                  </div>
                </div>

                <div
                  data-testid="task-type-section"
                  className="ui-v1-radius-md border border-[color:color-mix(in_srgb,var(--hud-border)_58%,transparent)] bg-[color:color-mix(in_srgb,var(--hud-surface-soft)_74%,transparent)] p-3.5"
                >
                  <Label className="text-[12px] font-semibold text-[color:var(--hud-muted)]">
                    Task Type
                  </Label>
                  <div className="mt-2 inline-flex w-full rounded-md border border-[color:var(--hud-border)] bg-[var(--hud-surface)] p-1">
                    <Button
                      type="button"
                      size="sm"
                      className={`h-9 flex-1 text-[12px] ${
                        formData.type === 'quick'
                          ? 'border border-[color:var(--hud-border)] bg-[color:var(--hud-accent-soft)] text-[color:var(--hud-accent-soft-text)]'
                          : 'bg-transparent text-[color:var(--hud-muted)] hover:bg-transparent hover:text-[color:var(--hud-text)]'
                      }`}
                      variant="ghost"
                      onClick={() => setTaskType('quick')}
                    >
                      Quick
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className={`h-9 flex-1 text-[12px] ${
                        formData.type === 'large'
                          ? 'border border-[color:var(--hud-border)] bg-[color:var(--hud-accent-soft)] text-[color:var(--hud-accent-soft-text)]'
                          : 'bg-transparent text-[color:var(--hud-muted)] hover:bg-transparent hover:text-[color:var(--hud-text)]'
                      }`}
                      variant="ghost"
                      onClick={() => setTaskType('large')}
                    >
                      Complex
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className={`h-9 flex-1 text-[12px] ${
                        formData.type === 'block'
                          ? 'border border-[color:var(--hud-border)] bg-[color:var(--hud-accent-soft)] text-[color:var(--hud-accent-soft-text)]'
                          : 'bg-transparent text-[color:var(--hud-muted)] hover:bg-transparent hover:text-[color:var(--hud-text)]'
                      }`}
                      variant="ghost"
                      onClick={() => setTaskType('block')}
                    >
                      Block
                    </Button>
                  </div>
                  <p
                    data-testid="task-type-helper"
                    className="mt-2 text-[11px] leading-snug text-[color:var(--hud-muted)]"
                  >
                    {TASK_TYPE_HELP[formData.type]}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
            <div className="space-y-1.5" data-testid="task-color-section-primary">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {activeSwatches.map((swatch) => (
                  <button
                    key={swatch.value}
                    type="button"
                    data-testid="task-color-swatch"
                    onClick={() => setFormData({ ...formData, color: swatch.value })}
                    className={`size-7 rounded-full border-2 ui-v1-hover-grow ${
                      formData.color === swatch.value
                        ? 'ring-2 ring-[color:var(--hud-outline)] ring-offset-2 ring-offset-[color:var(--hud-surface-soft)]'
                        : ''
                    }`}
                    style={{
                      backgroundColor: swatch.value,
                      borderColor:
                        formData.color === swatch.value
                          ? 'var(--hud-text)'
                          : 'color-mix(in srgb, var(--hud-border) 85%, transparent)',
                    }}
                    title={swatch.name}
                  >
                    <span className="sr-only">{swatch.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Assignee</Label>
              <Popover
                open={assigneePickerOpen}
                onOpenChange={(nextOpen) => {
                  setAssigneePickerOpen(nextOpen);
                  if (!nextOpen) setAssigneeQuery('');
                }}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex h-10 w-full items-center justify-between ui-v1-radius-sm border border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-2.5"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] text-[11px] font-semibold text-[color:var(--hud-text)]">
                        {selectedAssigneeInitials}
                      </span>
                      <span className="truncate text-[12px] font-semibold text-[color:var(--hud-text)]">
                        {selectedAssigneeLabel}
                      </span>
                    </span>
                    <ChevronsUpDown className="size-4 text-[color:var(--hud-muted)]" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[280px] p-2" align="start">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[color:var(--hud-muted)]" />
                    <Input
                      value={assigneeQuery}
                      onChange={(event) => setAssigneeQuery(event.target.value)}
                      placeholder="Search assignee..."
                      className="h-8 border-[color:var(--hud-border)] bg-[var(--hud-surface)] pl-8 text-[12px]"
                    />
                  </div>
                  <div className="mt-2 max-h-52 space-y-1 overflow-y-auto">
                    <button
                      type="button"
                      className="flex h-8 w-full items-center justify-between rounded-md px-2 text-[12px] font-medium text-[color:var(--hud-text)] hover:bg-[var(--hud-surface-soft)]"
                      onClick={() => {
                        setFormData((prev) => ({ ...prev, assignedTo: 'unassigned' }));
                        setAssigneePickerOpen(false);
                        setAssigneeQuery('');
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <span className="flex size-6 items-center justify-center rounded-full border border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] text-[10px] font-semibold">
                          —
                        </span>
                        Unassigned
                      </span>
                      {formData.assignedTo === 'unassigned' && (
                        <Check className="size-3.5 text-[color:var(--hud-accent-bg)]" />
                      )}
                    </button>

                    {filteredAssigneeOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className="flex h-8 w-full items-center justify-between rounded-md px-2 text-[12px] font-medium text-[color:var(--hud-text)] hover:bg-[var(--hud-surface-soft)]"
                        onClick={() => {
                          setFormData((prev) => ({ ...prev, assignedTo: option.id }));
                          setAssigneePickerOpen(false);
                          setAssigneeQuery('');
                        }}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] text-[10px] font-semibold">
                            {option.isMe ? (
                              <UserRound className="size-3.5" />
                            ) : (
                              getInitials(option.name)
                            )}
                          </span>
                          <span className="truncate">
                            {option.name}
                            {option.isMe ? ' (Me)' : ''}
                          </span>
                        </span>
                        {formData.assignedTo === option.id && (
                          <Check className="size-3.5 text-[color:var(--hud-accent-bg)]" />
                        )}
                      </button>
                    ))}

                    {filteredAssigneeOptions.length === 0 && (
                      <p className="px-2 py-1 text-[11px] text-[color:var(--hud-muted)]">
                        No assignee matches.
                      </p>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {shouldCheckSchedule && (
            <div className="ui-hud-row ui-v1-radius-md px-3.5 py-3 text-[11px] text-[color:var(--hud-muted)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-[color:var(--hud-text)]">
                    Capacity left
                  </p>
                  {scheduleSummary.suggestion ? (
                    <p className="mt-0.5">
                      Next slot: {scheduleSummary.suggestion.startTime} -{' '}
                      {scheduleSummary.suggestion.endTime}
                    </p>
                  ) : (
                    <p className="mt-0.5">
                      No open slot found. You can still stack tasks at your chosen time.
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span
                    className={`text-[18px] font-bold leading-none tracking-[-0.02em] ${
                      scheduleSummary.remainingMinutes > 0
                        ? 'text-[color:var(--hud-success-text)]'
                        : 'text-[color:var(--hud-warning-text)]'
                    }`}
                  >
                    {formatMinutes(scheduleSummary.remainingMinutes)}
                  </span>
                  {scheduleSummary.suggestion && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="ui-hud-btn h-7 ui-v1-radius-sm px-2.5 text-[11px]"
                      onClick={() =>
                        setFormData((prev) => ({
                          ...prev,
                          day: formData.day,
                          startTime: scheduleSummary.suggestion?.startTime ?? prev.startTime,
                          scheduleLater: false,
                        }))
                      }
                    >
                      Use next slot
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {layoutV1Enabled && (
            <button
              type="button"
              onClick={() => setShowAdvanced((prev) => !prev)}
              className="ui-hud-row flex h-10 w-full items-center justify-between ui-v1-radius-md border-dashed px-3.5 py-2 text-sm font-medium text-[color:var(--hud-muted)] transition-colors hover:text-[color:var(--hud-text)]"
            >
              <span>Advanced options</span>
              {showAdvanced ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </button>
          )}

          {(showAdvanced || !layoutV1Enabled) && (
            <div className="space-y-3.5 ui-v1-radius-md border border-[color:color-mix(in_srgb,var(--hud-border)_54%,transparent)] bg-[color:color-mix(in_srgb,var(--hud-surface-soft)_68%,transparent)] p-4">
              {formData.type === 'large' && (
                <div className="space-y-2.5 ui-v1-radius-md border border-[color:color-mix(in_srgb,var(--hud-border)_54%,transparent)] bg-[color:color-mix(in_srgb,var(--hud-surface)_84%,transparent)] px-3.5 py-3">
                  <Label>Subtasks</Label>
                  <div className="flex gap-2">
                    <Input
                      value={subtaskInput}
                      onChange={(e) => setSubtaskInput(e.target.value)}
                      placeholder="Add a subtask..."
                      className="h-9 border-[color:var(--hud-border)] bg-[var(--hud-surface)] text-[13px]"
                      onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addSubtask())}
                    />
                    <Button
                      type="button"
                      onClick={addSubtask}
                      variant="outline"
                      className="ui-hud-btn h-9 ui-v1-radius-sm border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-3"
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>

                  {formData.subtasks.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {formData.subtasks.map((subtask) => (
                        <div
                          key={subtask.id}
                          className="flex items-center justify-start gap-2 ui-v1-radius-sm border border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-2.5 py-2"
                        >
                          <span className="size-3.5 rounded-full border border-[color:var(--hud-muted)]" />
                          <span className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold text-[color:var(--hud-text)]">
                            {subtask.title}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="ui-hud-btn h-7 w-7 shrink-0 ui-v1-radius-sm p-0"
                            onClick={() => removeSubtask(subtask.id)}
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between ui-v1-radius-md border border-[color:color-mix(in_srgb,var(--hud-border)_54%,transparent)] bg-[color:color-mix(in_srgb,var(--hud-surface)_84%,transparent)] px-3.5 py-2.5">
                <div>
                  <p className="text-sm font-semibold">Schedule later</p>
                  <p className="text-xs text-muted-foreground">Keep in inbox/backlog.</p>
                </div>
                <Switch
                  data-testid="schedule-later-toggle"
                  checked={formData.scheduleLater}
                  onCheckedChange={(value) => setFormData({ ...formData, scheduleLater: value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="description">Notes</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Add details..."
                  rows={2}
                  className="min-h-[72px]"
                />
              </div>

              {formData.type !== 'block' &&
                (taskSuggestions.suggestedWindow ||
                  taskSuggestions.suggestedDurationMinutes !== null ||
                  durationProfileSuggestion.suggestedDurationMinutes !== null) && (
                  <div className="ui-v1-radius-md border border-[color:color-mix(in_srgb,var(--hud-border)_54%,transparent)] bg-[color:color-mix(in_srgb,var(--hud-surface)_84%,transparent)] px-3.5 py-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-semibold text-[color:var(--hud-text)]">
                        Smart helpers
                      </p>
                      <span className="ui-v1-radius-xs border border-[color:var(--hud-border)] bg-[color:var(--hud-accent-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-[color:var(--hud-accent-soft-text)]">
                        Smart
                      </span>
                    </div>

                    <div className="mt-2 space-y-2 text-[12px] text-[color:var(--hud-muted)]">
                      {taskSuggestions.suggestedWindow ? (
                        <div className="flex items-center justify-between gap-2">
                          <span>Suggested window</span>
                          <span className="ui-v1-radius-xs ui-status-info px-2 py-0.5 text-[11px] font-semibold">
                            {taskSuggestions.suggestedWindow.start} -{' '}
                            {taskSuggestions.suggestedWindow.end}
                          </span>
                        </div>
                      ) : null}

                      {(taskSuggestions.suggestedDurationMinutes !== null ||
                        durationProfileSuggestion.suggestedDurationMinutes !== null) && (
                        <div className="flex items-center justify-between gap-2">
                          <span>Suggested duration</span>
                          <span className="ui-v1-radius-xs ui-status-success px-2 py-0.5 text-[11px] font-semibold">
                            {durationProfileSuggestion.suggestedDurationMinutes ??
                              taskSuggestions.suggestedDurationMinutes}{' '}
                            min
                          </span>
                        </div>
                      )}

                      {taskSuggestions.correctionFactor !== null ? (
                        <div className="flex items-center justify-between gap-2">
                          <span>Execution trend</span>
                          <span
                            className={`ui-v1-radius-xs px-2 py-0.5 text-[11px] font-semibold ${
                              taskSuggestions.correctionTrend === 'overrun'
                                ? 'ui-status-warning'
                                : taskSuggestions.correctionTrend === 'underrun'
                                  ? 'ui-status-info'
                                  : 'ui-status-success'
                            }`}
                          >
                            {taskSuggestions.correctionTrend === 'overrun'
                              ? `Usually +${Math.round((taskSuggestions.correctionFactor - 1) * 100)}%`
                              : taskSuggestions.correctionTrend === 'underrun'
                                ? `Usually ${Math.round((taskSuggestions.correctionFactor - 1) * 100)}%`
                                : 'Balanced'}
                          </span>
                        </div>
                      ) : null}
                    </div>

                    {(taskSuggestions.suggestedDurationMinutes !== null ||
                      durationProfileSuggestion.suggestedDurationMinutes !== null) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="ui-hud-btn-soft mt-2 h-8 w-full ui-v1-radius-sm px-3 text-[12px]"
                        onClick={() =>
                          setFormData((prev) => ({
                            ...prev,
                            durationMinutes:
                              durationProfileSuggestion.suggestedDurationMinutes ??
                              taskSuggestions.suggestedDurationMinutes ??
                              prev.durationMinutes,
                          }))
                        }
                      >
                        Use suggested duration
                      </Button>
                    )}
                  </div>
                )}
            </div>
          )}

          <div className="flex justify-end gap-2.5 pt-2">
            <Button
              type="button"
              data-testid="task-dialog-cancel"
              variant="outline"
              className="h-9 ui-v1-radius-sm border-[color:var(--hud-border)]"
              onClick={() => {
                if (shouldIgnoreImmediateDismiss()) {
                  return;
                }
                closeDialog();
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              data-testid={editTask ? 'update-task-submit' : 'create-task-submit'}
              disabled={blockedByTaskLock || blockedByConflictLock || !canWriteTasks}
              className="h-9 ui-v1-radius-sm border border-[color:var(--hud-border)] bg-[var(--hud-accent-bg)] text-[var(--hud-accent-text)] hover:brightness-95"
            >
              {editTask ? 'Update Task' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
}

function getLocalTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  } catch {
    return 'UTC';
  }
}
