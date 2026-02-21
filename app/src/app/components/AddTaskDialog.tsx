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
import { playCalendarSnapSound } from '../services/uiSounds';
import {
  combineDayAndTime,
  findNextAvailableSlot,
  getDayKey,
  getDayKeyFromDateTime,
  getDateFromDayKey,
  getWorkdayMinutes,
  getRemainingCapacityMinutes,
  getWorkdayTimeSlots,
  minutesToTime,
  timeToMinutes,
} from '../services/scheduling';

interface AddTaskDialogProps {
  defaultDay?: string;
  defaultTime?: string;
  defaultAssignee?: string;
  scheduleTasks?: Task[];
  editTask?: Task;
  hideTrigger?: boolean;
  playSnapOnSubmit?: boolean;
  onClose?: () => void;
}

export default function AddTaskDialog({
  defaultDay,
  defaultTime,
  defaultAssignee,
  scheduleTasks,
  editTask,
  hideTrigger = false,
  playSnapOnSubmit,
  onClose,
}: AddTaskDialogProps) {
  const { addTask, updateTask, tasks } = useTasks();
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
  const { theme } = useAppTheme();
  const activeSwatches = APP_THEME_TASK_SWATCHES[theme];
  const useCloudMembers = cloudEnabled && Boolean(cloudToken && activeOrgId);
  const members = useMemo(
    () => buildEffectiveMembers(localMembers, cloudMembers, useCloudMembers),
    [cloudMembers, localMembers, useCloudMembers]
  );
  const scheduleScopeTasks = scheduleTasks ?? tasks;
  const shouldPlaySnapOnSubmit = playSnapOnSubmit ?? !editTask;
  const [open, setOpen] = useState(Boolean(editTask) || hideTrigger);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const initialDayKey = editTask?.startDateTime
    ? getDayKeyFromDateTime(editTask.startDateTime)
    : defaultDay || getDayKey(today);
  const initialDurationMinutes = editTask?.durationMinutes || defaultTaskDurationMinutes;
  const initialStartTime = editTask?.startDateTime
    ? formatTime(new Date(editTask.startDateTime))
    : defaultTime ||
      findNextAvailableSlot(
        scheduleScopeTasks,
        initialDayKey,
        initialDurationMinutes,
        undefined,
        workday
      )?.startTime ||
      minutesToTime(workday.startHour * 60);
  const initialScheduleLater = editTask
    ? editTask.status === 'inbox' || !editTask.startDateTime
    : false;

  const [formData, setFormData] = useState({
    title: editTask?.title || '',
    description: editTask?.description || '',
    day: initialDayKey,
    startTime: initialStartTime,
    durationMinutes: initialDurationMinutes,
    color: editTask?.color || activeSwatches[0].value,
    type: editTask?.type || ('quick' as 'quick' | 'large' | 'block'),
    subtasks: editTask?.subtasks || ([] as SubTask[]),
    assignedTo: editTask?.assignedTo || defaultAssignee || 'unassigned',
    scheduleLater: initialScheduleLater,
  });

  const [subtaskInput, setSubtaskInput] = useState('');
  const [showColorPalette, setShowColorPalette] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [taskTakeoverPending, setTaskTakeoverPending] = useState(false);
  const [dayTakeoverPending, setDayTakeoverPending] = useState(false);
  const taskLockHeartbeatRef = useRef<number | null>(null);
  const dayLockHeartbeatRef = useRef<number | null>(null);
  const claimedTaskIdRef = useRef<string | null>(null);
  const claimedDayKeyRef = useRef<string | null>(null);
  const timeOptions = useMemo(
    () => getWorkdayTimeSlots(slotMinutes, workday),
    [slotMinutes, workday]
  );
  const isCrossDay = formData.durationMinutes > getWorkdayMinutes(workday);
  const shouldCheckSchedule = !formData.scheduleLater && !isCrossDay;
  const scheduleSummary = useMemo(() => {
    if (!shouldCheckSchedule) {
      return { remainingMinutes: 0, suggestion: null, outOfBounds: false };
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
    const outOfBounds =
      formData.durationMinutes <= 0 ||
      startMinutes < workday.startHour * 60 ||
      endMinutes > workday.endHour * 60;
    return { remainingMinutes, suggestion, outOfBounds };
  }, [
    scheduleScopeTasks,
    formData.day,
    formData.startTime,
    formData.durationMinutes,
    editTask?.id,
    shouldCheckSchedule,
    workday,
  ]);

  const todayKey = getDayKey(today);
  const isSelectedToday = formData.day === todayKey;

  const cannotFit = false;
  const assignableMembers = members.filter(
    (member) => member.id !== 'all' && member.id !== 'unassigned'
  );
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
      }),
    [formData.title, formData.type, slotMinutes]
  );

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setShowAdvanced(false);
      setShowColorPalette(false);
      if (!editTask) {
        const hasThemeColor = activeSwatches.some(
          (swatch) => swatch.value.toLowerCase() === formData.color.toLowerCase()
        );
        if (!hasThemeColor) {
          setFormData((prev) => ({ ...prev, color: activeSwatches[0].value }));
        }
      }
    }
    setOpen(nextOpen);
    if (!nextOpen) {
      onClose?.();
    }
  };

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

    if (isCrossDay || scheduleSummary.outOfBounds || cannotFit) {
      return;
    }

    const assignedToValue = formData.assignedTo === 'unassigned' ? undefined : formData.assignedTo;
    const startDateTime = formData.scheduleLater
      ? undefined
      : combineDayAndTime(formData.day, formData.startTime).toISOString();
    const timeZone = startDateTime
      ? (editTask?.timeZone ?? getLocalTimeZone())
      : editTask?.timeZone;

    if (editTask) {
      updateTask(editTask.id, {
        title: formData.title,
        description: formData.description,
        startDateTime,
        durationMinutes: formData.durationMinutes,
        timeZone,
        color: formData.color,
        type: formData.type,
        subtasks: formData.subtasks,
        assignedTo: assignedToValue,
        completed: editTask.completed,
        status: formData.scheduleLater ? 'inbox' : 'scheduled',
        executionStatus: editTask.executionStatus,
        actualMinutes: editTask.actualMinutes,
      });
    } else {
      addTask({
        title: formData.title,
        description: formData.description,
        startDateTime,
        durationMinutes: formData.durationMinutes,
        timeZone,
        color: formData.color,
        type: formData.type,
        subtasks: formData.subtasks,
        assignedTo: assignedToValue,
        completed: false,
        status: formData.scheduleLater ? 'inbox' : 'scheduled',
        executionStatus: 'idle',
        actualMinutes: 0,
      });
    }

    setOpen(false);
    onClose?.();
    if (shouldPlaySnapOnSubmit && soundEffectsEnabled) {
      window.setTimeout(() => {
        playCalendarSnapSound();
      }, 140);
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
      <DialogTrigger asChild>
        {!editTask && !hideTrigger && (
          <Button
            data-testid="add-task-trigger"
            className="h-9 gap-2 rounded-[11px] border border-[color:var(--hud-border)] bg-[var(--hud-accent-bg)] px-4 text-[var(--hud-accent-text)] hover:brightness-95"
          >
            <Plus className="size-4" />
            Add Task
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-[16px] border-[color:var(--hud-border)] bg-[var(--hud-surface)] p-0 shadow-[0_24px_52px_rgba(0,0,0,0.45)] backdrop-blur-md sm:max-w-[760px]">
        <DialogHeader className="gap-1 border-b border-[color:var(--hud-border)] px-4 py-3 pr-12">
          <DialogTitle className="text-[17px] tracking-[-0.02em] text-[color:var(--hud-text)]">
            {editTask ? 'Update Task' : 'Create Task'}
          </DialogTitle>
          <DialogDescription className="text-[12px] text-[color:var(--hud-muted)]">
            Compact planner editor.
          </DialogDescription>
        </DialogHeader>

        <form
          data-testid="task-dialog-form"
          onSubmit={handleSubmit}
          className="max-h-[calc(88vh-82px)] space-y-2.5 overflow-y-auto px-4 py-3"
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
                    className="h-7 rounded-[9px] border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] text-[11px]"
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
                  className="h-7 rounded-[9px] border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] text-[11px]"
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
                    className="h-7 rounded-[9px] border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] text-[11px]"
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
                Tasks cannot span multiple days. Reduce the duration to fit within working hours.
              </AlertDescription>
            </Alert>
          )}

          {shouldCheckSchedule && scheduleSummary.outOfBounds && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>
                This task extends beyond work hours ({minutesToTime(workday.endHour * 60)}).
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

          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="title">Task Title</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                required
                placeholder="e.g., Germany Invoices"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Color</Label>
              <div className="flex items-center gap-2">
                <Popover open={showColorPalette} onOpenChange={setShowColorPalette}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="size-8 rounded-full border-2 transition-transform hover:scale-105"
                      style={{
                        backgroundColor: formData.color,
                        borderColor: 'var(--hud-outline)',
                      }}
                      title="Selected color"
                    />
                  </PopoverTrigger>
                  <PopoverContent
                    side="bottom"
                    align="end"
                    sideOffset={8}
                    className="w-auto rounded-md p-2"
                  >
                    <div className="flex max-w-[180px] flex-wrap gap-1.5">
                      {activeSwatches.map((swatch) => (
                        <button
                          key={swatch.value}
                          type="button"
                          onClick={() => {
                            setFormData({ ...formData, color: swatch.value });
                            setShowColorPalette(false);
                          }}
                          className="size-6 rounded-full border-2 transition-transform hover:scale-105"
                          style={{
                            backgroundColor: swatch.value,
                            borderColor:
                              formData.color === swatch.value ? 'var(--hud-text)' : 'transparent',
                          }}
                          title={swatch.name}
                        />
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description (Optional)</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Add details..."
              rows={1}
              className="min-h-[54px]"
            />
          </div>

          <div className="flex items-center justify-between rounded-[12px] border border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] px-3 py-2">
            <div>
              <p className="text-sm font-semibold">Schedule later (WIP)</p>
              <p className="text-xs text-muted-foreground">Keep in inbox/backlog.</p>
            </div>
            <Switch
              data-testid="schedule-later-toggle"
              checked={formData.scheduleLater}
              onCheckedChange={(value) => setFormData({ ...formData, scheduleLater: value })}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              {taskSuggestions.suggestedWindow && (
                <p className="text-[11px] text-muted-foreground">
                  Suggested window: {taskSuggestions.suggestedWindow.start} -{' '}
                  {taskSuggestions.suggestedWindow.end}
                  {taskSuggestions.windowSampleCount > 0
                    ? ` (${taskSuggestions.windowSampleCount} similar completions)`
                    : ''}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="duration">Duration (minutes)</Label>
              <Input
                id="duration"
                type="number"
                min={slotMinutes}
                max="600"
                step={slotMinutes}
                value={formData.durationMinutes}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  setFormData({
                    ...formData,
                    durationMinutes: Number.isNaN(value) ? 0 : value,
                  });
                }}
                required
              />
              {taskSuggestions.suggestedDurationMinutes !== null && (
                <p className="text-[11px] text-muted-foreground">
                  Suggested duration: {taskSuggestions.suggestedDurationMinutes} min
                  {taskSuggestions.durationSampleCount > 0
                    ? ` (based on ${taskSuggestions.durationSampleCount} similar tasks)`
                    : ''}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Task Type</Label>
              <div className="inline-flex w-full rounded-md border bg-muted/30 p-1">
                <Button
                  type="button"
                  size="sm"
                  className={`h-8 flex-1 ${
                    formData.type === 'quick'
                      ? ''
                      : 'bg-transparent text-muted-foreground hover:bg-transparent'
                  }`}
                  variant={formData.type === 'quick' ? 'default' : 'ghost'}
                  onClick={() => setFormData({ ...formData, type: 'quick' })}
                >
                  Quick
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className={`h-8 flex-1 ${
                    formData.type === 'large'
                      ? ''
                      : 'bg-transparent text-muted-foreground hover:bg-transparent'
                  }`}
                  variant={formData.type === 'large' ? 'default' : 'ghost'}
                  onClick={() => setFormData({ ...formData, type: 'large' })}
                >
                  Complex
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className={`h-8 flex-1 ${
                    formData.type === 'block'
                      ? ''
                      : 'bg-transparent text-muted-foreground hover:bg-transparent'
                  }`}
                  variant={formData.type === 'block' ? 'default' : 'ghost'}
                  onClick={() => setFormData({ ...formData, type: 'block' })}
                >
                  Block
                </Button>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced((prev) => !prev)}
            className="flex h-9 w-full items-center justify-between rounded-[11px] border border-dashed border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] px-3 py-2 text-sm font-medium text-[color:var(--hud-muted)] transition-colors hover:text-[color:var(--hud-text)]"
          >
            <span>Advanced options</span>
            {showAdvanced ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>

          {showAdvanced && (
            <div className="space-y-3 rounded-[12px] border border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] p-3">
              <div className="space-y-1.5">
                <Label htmlFor="assignee">Assignee</Label>
                <Select
                  value={formData.assignedTo}
                  onValueChange={(value) => setFormData({ ...formData, assignedTo: value })}
                >
                  <SelectTrigger id="assignee" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {assignableMembers.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {shouldCheckSchedule && (
                <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between gap-2">
                    <span>Capacity left</span>
                    <span className="font-semibold text-foreground">
                      {formatMinutes(scheduleSummary.remainingMinutes)}
                    </span>
                  </div>
                  {scheduleSummary.suggestion ? (
                    <div className="mt-1">
                      Next slot: {scheduleSummary.suggestion.startTime} -{' '}
                      {scheduleSummary.suggestion.endTime}
                    </div>
                  ) : (
                    <div className="mt-1 text-muted-foreground">
                      No open slot found. You can still stack tasks at your chosen time.
                    </div>
                  )}
                </div>
              )}

              {formData.type === 'large' && (
                <div className="space-y-2">
                  <Label>Subtasks (Optional)</Label>
                  <div className="flex gap-2">
                    <Input
                      value={subtaskInput}
                      onChange={(e) => setSubtaskInput(e.target.value)}
                      placeholder="Add a subtask..."
                      onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addSubtask())}
                    />
                    <Button type="button" onClick={addSubtask} variant="outline">
                      <Plus className="size-4" />
                    </Button>
                  </div>

                  {formData.subtasks.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {formData.subtasks.map((subtask) => (
                        <div
                          key={subtask.id}
                          className="flex items-center justify-start gap-2 rounded bg-muted p-2"
                        >
                          <span className="text-left">{subtask.title}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 shrink-0 p-0"
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
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-[10px] border-[color:var(--hud-border)]"
              onClick={() => {
                setOpen(false);
                onClose?.();
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              data-testid={editTask ? 'update-task-submit' : 'create-task-submit'}
              disabled={blockedByTaskLock || blockedByConflictLock || !canWriteTasks}
              className="h-9 rounded-[10px] border border-[color:var(--hud-border)] bg-[var(--hud-accent-bg)] text-[var(--hud-accent-text)] hover:brightness-95"
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

function getLocalTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  } catch {
    return 'UTC';
  }
}
