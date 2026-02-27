import { useDrag } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { Task, useTasks } from '../context/TaskContext';
import { Check, Clock, Lock, Pause, Play, RotateCcw, Trash2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { useTeamMembers } from '../context/TeamMembersContext';
import { useWorkday } from '../context/WorkdayContext';
import { useCloudSync } from '../context/CloudSyncContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import { buildEffectiveMembers } from '../services/memberDirectory';
import { combineDayAndTime, getDayKeyFromDateTime, minutesToTime } from '../services/scheduling';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { getOverrunMinutes, normalizeExecutionStatus } from '../services/taskTimer';
import { recordOperationalEvent } from '../services/operationalTelemetry';

interface TaskCardProps {
  task: Task;
  onEdit: (task: Task) => void;
  onOpenQuickActions?: (task: Task) => void;
  blockStyle?: CSSProperties;
  blockHeight?: number;
  blockWidth?: number;
  slotMinutes?: number;
  getMinutesFromClientX?: (
    clientX: number,
    snap?: 'round' | 'floor' | 'ceil' | 'raw'
  ) => number | null;
  isPreview?: boolean;
}

type ResizeDirection = 'start' | 'end';

interface ResizeState {
  direction: ResizeDirection;
  startMinutes: number;
  durationMinutes: number;
  dayKey: string;
  dragOffsetMinutes: number;
}

interface CardTone {
  background: string;
  title: string;
  body: string;
  buttonBg: string;
  buttonText: string;
  utilityBg: string;
  utilityText: string;
}

export default function TaskCard({
  task,
  onEdit,
  onOpenQuickActions,
  blockStyle,
  blockHeight,
  blockWidth,
  slotMinutes,
  getMinutesFromClientX,
  isPreview = false,
}: TaskCardProps) {
  const {
    updateTask,
    toggleSubtaskComplete,
    deleteTask,
    nowTimestamp,
    selectedTaskId,
    startTask,
    pauseTask,
    completeTask,
    reopenTask,
  } = useTasks();
  const { members: localMembers } = useTeamMembers();
  const {
    enabled: cloudEnabled,
    token: cloudToken,
    activeOrgId,
    activeOrgRole,
    canWriteTasks,
    canDeleteTasks,
    members: cloudMembers,
    user,
    presenceLocks,
    isTaskConflictLocked,
    openConflictResolver,
    claimPresenceLock,
  } = useCloudSync();
  const { workday } = useWorkday();
  const {
    preferences: { uiDensity },
  } = useUserPreferences();
  const useCloudMembers = cloudEnabled && Boolean(cloudToken && activeOrgId);
  const members = useMemo(
    () => buildEffectiveMembers(localMembers, cloudMembers, useCloudMembers),
    [cloudMembers, localMembers, useCloudMembers]
  );
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [resizing, setResizing] = useState<ResizeState | null>(null);
  const [resizeStartedAt, setResizeStartedAt] = useState<number | null>(null);
  const [{ isDragging }, drag, preview] = useDrag(() => ({
    type: 'TASK',
    item: { id: task.id },
    canDrag: () => !resizing && !isPreview && canWriteTasks && !isConflictLocked,
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }));

  useEffect(() => {
    if (isPreview) return;
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview, isPreview]);

  const isBlockTask = task.type === 'block';
  const tone = useMemo(
    () =>
      isBlockTask
        ? {
            background: '#1b1c21',
            title: '#f7f8fa',
            body: 'rgba(247,248,250,0.86)',
            buttonBg: 'rgba(247,248,250,0.14)',
            buttonText: '#f7f8fa',
            utilityBg: 'rgba(255,255,255,0.18)',
            utilityText: '#f7f8fa',
          }
        : getCardTone(task.color, task.id),
    [isBlockTask, task.color, task.id]
  );
  const executionStatus = normalizeExecutionStatus(task);
  const isRunning = executionStatus === 'running';
  const isCompletedExecution = executionStatus === 'completed' || task.completed;
  const hasStartTime = Boolean(task.startDateTime);
  const startTime = hasStartTime ? formatTime(new Date(task.startDateTime as string)) : '';
  const endTime = hasStartTime
    ? getEndTime(task.startDateTime as string, task.durationMinutes)
    : '';
  const overrunMinutes = getOverrunMinutes(
    {
      executionStatus,
      startDateTime: task.startDateTime,
      durationMinutes: task.durationMinutes,
    },
    nowTimestamp
  );
  const overrunLabel = `+${Math.max(1, Math.floor(overrunMinutes))}m`;
  const widthBasis = typeof blockWidth === 'number' ? blockWidth : 260;
  const heightBasis = typeof blockHeight === 'number' ? blockHeight : 164;
  const isMicro = widthBasis < 78 || heightBasis < 98;
  const isUltraTiny = widthBasis < 120 || heightBasis < 118;
  const isTiny = !isUltraTiny && (widthBasis < 210 || heightBasis < 148);
  const isCompact = !isUltraTiny && (widthBasis < 280 || heightBasis < 172);
  const sizeRatio = Math.min(widthBasis / 230, heightBasis / 168);
  const densityScale = uiDensity === 'compact' ? 0.9 : 1;
  const baseTitleSize = isMicro
    ? 10
    : isUltraTiny
      ? clamp(Math.round(13 * Math.max(widthBasis / 130, heightBasis / 120)), 11, 14)
      : isTiny
        ? clamp(Math.round(16 * sizeRatio + 7), 14, 20)
        : clamp(Math.round(28 * sizeRatio), 18, 34);
  const titleSize = clamp(Math.round(baseTitleSize * densityScale), 10, 34);
  const baseFooterSize = isUltraTiny ? 10 : clamp(Math.round(14 * sizeRatio), 11, 15);
  const footerSize = clamp(Math.round(baseFooterSize * densityScale), 10, 15);
  const baseDoneSize = isUltraTiny ? 10 : clamp(Math.round(15 * sizeRatio), 12, 17);
  const doneSize = clamp(Math.round(baseDoneSize * densityScale), 10, 17);
  const subtaskScale = Math.min(widthBasis / 220, heightBasis / 160);
  const baseSubtaskFontSize = isUltraTiny ? 11 : clamp(Math.round(15 * subtaskScale), 12, 18);
  const subtaskFontSize = clamp(Math.round(baseSubtaskFontSize * densityScale), 11, 18);
  const baseSubtaskMarkerSize = isUltraTiny ? 12 : clamp(Math.round(17 * subtaskScale), 14, 20);
  const subtaskMarkerSize = clamp(Math.round(baseSubtaskMarkerSize * densityScale), 12, 20);
  const useColumnFooter = widthBasis < 150 || isMicro;
  const showVerticalTime =
    hasStartTime && !isBlockTask && (task.durationMinutes < 60 || isTiny || isUltraTiny);
  const timeLabel = hasStartTime
    ? isCompact
      ? `${startTime}-${endTime}`
      : `${startTime} - ${endTime}`
    : 'Unscheduled';
  const blockTimeLabel = hasStartTime ? `${startTime}-${endTime}` : 'UNSCHEDULED';
  const canResize =
    !isPreview && typeof slotMinutes === 'number' && typeof getMinutesFromClientX === 'function';
  const isInteractive = !isPreview;
  const isSelectedTask = !isPreview && selectedTaskId === task.id;
  const assignee = members.find((member) => member.id === task.assignedTo);
  const assigneeInitials = assignee ? getInitials(assignee.name) : '';
  const taskPresenceLock = useMemo(
    () => presenceLocks.find((lock) => lock.scope === 'task' && lock.targetId === task.id),
    [presenceLocks, task.id]
  );
  const isConflictLocked = isTaskConflictLocked(task.id);
  const isLockedByOther = Boolean(taskPresenceLock && taskPresenceLock.userId !== user?.id);
  const roleLabel = activeOrgRole ?? 'viewer';
  const lockLabel = taskPresenceLock
    ? isLockedByOther
      ? `${taskPresenceLock.userName} editing`
      : 'You are editing'
    : null;
  const interactionLockLabel = lockLabel ?? (isConflictLocked ? 'Sync conflict' : null);
  const writeBlocked = !canWriteTasks;
  const deleteBlocked = !canDeleteTasks;
  const canForceTakeover = activeOrgRole === 'owner' || activeOrgRole === 'admin';
  const blockConflictMutation = () => {
    if (!isConflictLocked) return false;
    toast.error('Task has a sync conflict. Resolve it before editing.');
    openConflictResolver(task.id);
    return true;
  };
  const blockWriteInCloud = () => {
    if (!writeBlocked) return false;
    toast.error(`Role "${roleLabel}" is read-only in this workspace.`);
    return true;
  };
  const blockDeleteInCloud = () => {
    if (!deleteBlocked) return false;
    toast.error('Only owner/admin can delete tasks in cloud workspaces.');
    return true;
  };
  const subtaskSlots = isUltraTiny
    ? 0
    : heightBasis < 188 || widthBasis < 228
      ? 1
      : heightBasis < 242 || widthBasis < 294
        ? 2
        : 3;
  const isComplexTask = task.type === 'large';
  const forceComplexChecklistLayout =
    isComplexTask &&
    !isBlockTask &&
    !isMicro &&
    !isUltraTiny &&
    widthBasis >= 250 &&
    heightBasis >= 164;
  const isPaused = executionStatus === 'paused';
  const primaryActionLabel = isCompletedExecution ? 'Reopen' : isRunning ? 'Pause' : 'Start';
  const primaryActionIcon = isCompletedExecution ? RotateCcw : isRunning ? Pause : Play;
  const PrimaryActionIcon = primaryActionIcon;
  const visibleSubtasks =
    !isBlockTask && isComplexTask && task.subtasks.length > 0
      ? task.subtasks.slice(0, forceComplexChecklistLayout ? 3 : subtaskSlots)
      : [];
  const hiddenSubtasksCount = Math.max(0, task.subtasks.length - visibleSubtasks.length);
  const completedSubtasksCount = isComplexTask
    ? task.subtasks.filter((subtask) => subtask.completed).length
    : 0;
  const complexProgressRatio =
    isComplexTask && task.subtasks.length > 0
      ? completedSubtasksCount / task.subtasks.length
      : isCompletedExecution
        ? 1
        : isRunning
          ? 0.3
          : 0;
  const showComplexCardLayout = forceComplexChecklistLayout;
  const showComplexSubtaskSummary = showComplexCardLayout && task.subtasks.length > 0;
  const showComplexSubtaskList = showComplexCardLayout && visibleSubtasks.length > 0;
  const showStandardSubtaskList = !showComplexCardLayout && visibleSubtasks.length > 0 && heightBasis >= 168;
  const showStatusBadge =
    !isPreview &&
    !isMicro &&
    ((isBlockTask && widthBasis >= 110 && heightBasis >= 150) ||
      (!isBlockTask && widthBasis >= 176 && heightBasis >= 168));
  const statusBadgeLabel = isCompletedExecution
    ? 'Done'
    : isRunning
      ? 'Running'
      : isPaused
        ? 'Paused'
        : task.status === 'inbox' || !task.startDateTime
          ? 'Inbox'
          : 'Scheduled';
  const statusBadgeClassName = isCompletedExecution
    ? 'ui-status-success'
    : isRunning
      ? 'ui-status-info'
      : isPaused
        ? 'ui-status-warning'
        : 'ui-hud-btn';
  const isComplexCompact = showComplexCardLayout && heightBasis < 214;
  const complexTitleSize = isComplexCompact
    ? clamp(Math.round(20 * sizeRatio), 16, 24)
    : clamp(Math.round(30 * sizeRatio), 20, 36);
  const complexSubtaskFontSize = isComplexCompact
    ? clamp(Math.round(14 * sizeRatio), 12, 15)
    : clamp(Math.round(14 * sizeRatio), 13, 16);
  const complexSubtaskMarkerSize = isComplexCompact
    ? clamp(Math.round(17 * sizeRatio), 14, 18)
    : clamp(Math.round(18 * sizeRatio), 15, 20);
  const blockTitleLabel = (task.title || 'BLOCK').toUpperCase();
  const subtaskTextLineClamp = widthBasis < 190 || heightBasis < 150 ? 1 : 2;
  const paddingClass = showComplexCardLayout
    ? isComplexCompact
      ? 'p-2.5'
      : 'p-3'
    : uiDensity === 'compact'
      ? isMicro
        ? 'p-1'
        : isUltraTiny
          ? 'p-1.5'
          : isTiny
            ? 'p-2.5'
            : 'p-3'
      : isMicro
        ? 'p-1.5'
        : isUltraTiny
          ? 'p-2'
          : isTiny
            ? 'p-3'
            : 'p-4';
  const showTopMeta = widthBasis >= 232 && heightBasis >= 152 && !isPreview;
  const requestTakeover = useCallback(() => {
    if (!isLockedByOther || !taskPresenceLock) return;
    if (!canForceTakeover) {
      toast.error(`${taskPresenceLock.userName} is editing this task.`);
      return;
    }
    void (async () => {
      const result = await claimPresenceLock('task', task.id, { forceTakeover: true });
      if (result.ok) {
        toast.success(
          result.takenOver
            ? 'Editing lock taken over. Try action again.'
            : 'Editing lock claimed. Try action again.'
        );
        return;
      }
      if (result.conflict) {
        toast.error(`${result.conflict.userName} still holds this lock.`);
      } else {
        toast.error('Unable to take over this task lock right now.');
      }
    })();
  }, [canForceTakeover, claimPresenceLock, isLockedByOther, task.id, taskPresenceLock]);

  useEffect(() => {
    if (!resizing || !canResize || slotMinutes === undefined || !getMinutesFromClientX) {
      return undefined;
    }

    const handleMove = (event: MouseEvent) => {
      if (writeBlocked) return;
      const cursorMinutesRaw = getMinutesFromClientX(event.clientX, 'raw');
      if (cursorMinutesRaw === null) return;

      const workStart = workday.startHour * 60;
      const workEnd = workday.endHour * 60;
      const originalStart = resizing.startMinutes;
      const originalEnd = resizing.startMinutes + resizing.durationMinutes;
      const snapMode = resizing.direction === 'end' ? 'ceil' : 'floor';
      const adjustedMinutes = cursorMinutesRaw + resizing.dragOffsetMinutes;
      const snappedMinutes = snapMinutes(adjustedMinutes, snapMode, slotMinutes, workStart);
      let nextStart = originalStart;
      let nextDuration = resizing.durationMinutes;

      if (resizing.direction === 'start') {
        nextStart = Math.min(Math.max(snappedMinutes, workStart), originalEnd - slotMinutes);
        nextDuration = originalEnd - nextStart;
      } else {
        const nextEnd = Math.min(Math.max(snappedMinutes, originalStart + slotMinutes), workEnd);
        nextDuration = nextEnd - originalStart;
      }

      const startTime = minutesToTime(nextStart);
      const nextStartDateTime = combineDayAndTime(resizing.dayKey, startTime).toISOString();

      if (nextStartDateTime === task.startDateTime && nextDuration === task.durationMinutes) {
        return;
      }

      updateTask(task.id, {
        startDateTime: nextStartDateTime,
        durationMinutes: nextDuration,
      });
    };

    const handleUp = () => {
      if (resizeStartedAt !== null) {
        const endedAt =
          typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
        recordOperationalEvent({
          eventType: 'dnd.resize.performance',
          durationMs: Math.max(0, endedAt - resizeStartedAt),
          metadata: {
            direction: resizing.direction,
            durationMinutes: task.durationMinutes,
          },
        });
      }
      setResizeStartedAt(null);
      setResizing(null);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [
    resizeStartedAt,
    resizing,
    canResize,
    writeBlocked,
    slotMinutes,
    getMinutesFromClientX,
    task.id,
    task.startDateTime,
    task.durationMinutes,
    updateTask,
    workday.startHour,
    workday.endHour,
  ]);

  const handleResizeStart =
    (direction: ResizeDirection) => (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!canResize) return;
      if (blockWriteInCloud()) return;
      if (blockConflictMutation()) return;
      if (!task.startDateTime) return;
      if (isLockedByOther) {
        requestTakeover();
        return;
      }
      event.preventDefault();
      event.stopPropagation();

      const startDate = new Date(task.startDateTime);
      const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
      const endMinutes = startMinutes + task.durationMinutes;
      const cursorMinutesRaw = getMinutesFromClientX?.(event.clientX, 'raw');
      const dragOffsetMinutes =
        typeof cursorMinutesRaw === 'number'
          ? (direction === 'start' ? startMinutes : endMinutes) - cursorMinutesRaw
          : 0;

      setResizing({
        direction,
        startMinutes,
        durationMinutes: task.durationMinutes,
        dayKey: getDayKeyFromDateTime(task.startDateTime),
        dragOffsetMinutes,
      });
      setResizeStartedAt(
        typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now()
      );
    };

  return (
    <motion.div
      ref={(node) => {
        if (!isPreview) {
          drag(node);
        }
      }}
      data-testid={`task-card-${task.id}`}
      data-task-id={task.id}
      data-selected={isSelectedTask ? 'true' : 'false'}
      data-task-type={task.type}
      data-task-title={task.title}
      initial={isPreview ? false : { scale: 0.95, opacity: 0 }}
      animate={{
        scale: 1,
        opacity: isPreview ? 0.55 : isDragging ? 0.45 : isCompletedExecution ? 0.74 : 1,
      }}
      exit={{ scale: 0.95, opacity: 0 }}
      whileHover={isPreview ? undefined : { scale: 1.012 }}
      onMouseDown={(event) => {
        if (!isInteractive) return;
        if (!shouldOpenQuickActions(event.target)) return;
        if (isConflictLocked) {
          toast.error('Task has a sync conflict. Resolve it before moving.');
          openConflictResolver(task.id);
          return;
        }
        if (isLockedByOther) {
          requestTakeover();
          return;
        }
        if (writeBlocked) {
          toast.error(`Role "${roleLabel}" is read-only in this workspace.`);
        }
      }}
      onClick={(event) => {
        if (!isInteractive || isDragging) return;
        if (isBlockTask) {
          if (shouldOpenQuickActions(event.target)) {
            onEdit(task);
          }
          return;
        }
        if (!shouldOpenQuickActions(event.target)) return;
        onOpenQuickActions?.(task);
      }}
      className={`planner-task-card group relative flex select-none flex-col overflow-hidden ui-v1-radius-md ${
        isPreview ? 'cursor-default pointer-events-none' : 'cursor-move pointer-events-auto'
      } ${paddingClass} ${isSelectedTask ? 'ring-2 ring-[color:var(--hud-outline)]' : ''}`}
      style={{
        backgroundColor: tone.background,
        userSelect: 'none',
        WebkitUserSelect: 'none',
        boxShadow: '0 14px 30px rgba(0, 0, 0, 0.2)',
        ...blockStyle,
      }}
    >
      {canResize && (
        <>
          <div
            className={`absolute left-0 top-0 bottom-0 ${isUltraTiny ? 'w-2' : 'w-4'} cursor-ew-resize bg-transparent`}
            data-testid={`resize-start-${task.id}`}
            data-no-smart-actions="true"
            onMouseDown={handleResizeStart('start')}
          >
            <div className="absolute left-1/2 top-1/2 h-10 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/35 opacity-0 transition-opacity group-hover:opacity-70" />
          </div>
          <div
            className={`absolute right-0 top-0 bottom-0 ${isUltraTiny ? 'w-2' : 'w-4'} cursor-ew-resize bg-transparent`}
            data-testid={`resize-end-${task.id}`}
            data-no-smart-actions="true"
            onMouseDown={handleResizeStart('end')}
          >
            <div className="absolute left-1/2 top-1/2 h-10 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/35 opacity-0 transition-opacity group-hover:opacity-70" />
          </div>
        </>
      )}

      {showComplexCardLayout && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[7] h-[3px] overflow-hidden bg-black/25">
          <span
            className="block h-full rounded-r-sm transition-[width] duration-500 ease-out"
            style={{
              width: `${Math.max(0, Math.min(100, Math.round(complexProgressRatio * 100)))}%`,
              backgroundColor: withAlpha(tone.buttonText, 0.86),
            }}
          />
        </div>
      )}

      {showTopMeta && interactionLockLabel && (
        <div className="pointer-events-none absolute left-3 top-3 z-[11]">
          <div
            className="inline-flex max-w-[168px] items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold"
            style={{
              backgroundColor: isConflictLocked
                ? 'var(--hud-warning-bg)'
                : isLockedByOther
                  ? 'var(--hud-accent-soft)'
                  : 'var(--hud-surface-strong)',
              color: isConflictLocked
                ? 'var(--hud-warning-text)'
                : isLockedByOther
                  ? 'var(--hud-accent-soft-text)'
                  : 'var(--hud-text)',
            }}
          >
            <Lock className="size-3 shrink-0" />
            <span className="truncate">{interactionLockLabel}</span>
          </div>
        </div>
      )}

      {!isPreview && !isBlockTask && overrunMinutes > 0 && (
        <>
          <div
            className="pointer-events-none absolute bottom-0 right-0 top-0 z-[9] w-[4px]"
            style={{ background: 'var(--hud-danger-text)' }}
          />
          {showTopMeta && (
            <div
              className="pointer-events-none absolute right-2 top-2 z-[12] rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{
                background: 'var(--hud-danger-text)',
                color: 'var(--hud-surface-strong)',
              }}
            >
              {overrunLabel}
            </div>
          )}
        </>
      )}

      {showTopMeta && (
        <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-2 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
          {!isBlockTask && assigneeInitials && (
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold"
              style={{ backgroundColor: tone.utilityBg, color: tone.utilityText }}
              title={assignee?.name}
            >
              {assigneeInitials}
            </div>
          )}
          {!isBlockTask && (
            <button
              type="button"
              data-no-smart-actions="true"
              aria-label={isCompletedExecution ? 'Reopen task' : 'Mark task done'}
              disabled={writeBlocked}
              className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: tone.utilityBg, color: tone.utilityText }}
              onClick={() => {
                if (blockConflictMutation()) return;
                if (isLockedByOther) {
                  requestTakeover();
                  return;
                }
                if (blockWriteInCloud()) return;
                if (isCompletedExecution) {
                  reopenTask(task.id);
                  return;
                }
                completeTask(task.id);
              }}
              title={isCompletedExecution ? 'Reopen task' : 'Mark done'}
            >
              <Check className="size-4" />
            </button>
          )}
          <button
            type="button"
            data-no-smart-actions="true"
            aria-label="Delete task"
            disabled={deleteBlocked}
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: tone.utilityBg, color: tone.utilityText }}
            onClick={() => {
              if (blockConflictMutation()) return;
              if (isLockedByOther) {
                requestTakeover();
                return;
              }
              if (blockDeleteInCloud()) return;
              setDeleteConfirmOpen(true);
            }}
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      )}

      <div
        className={`${isUltraTiny ? 'mb-2' : showComplexCardLayout ? 'mb-1.5' : 'mb-3'} flex min-h-0 flex-col ${
          showComplexCardLayout ? 'gap-1' : 'gap-2'
        } ${showComplexCardLayout ? 'flex-1' : ''}`}
      >
        {showStatusBadge && (
          <div className={showComplexCardLayout ? 'h-[10px]' : 'h-[18px]'}>
            <span
              className={`pointer-events-none inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 ${
                showComplexCardLayout ? 'text-[7px] leading-none' : 'text-[9px]'
              } font-semibold uppercase tracking-[0.08em] opacity-0 transition-opacity group-hover:opacity-100 ${statusBadgeClassName}`}
            >
              <span
                className={`size-1.5 rounded-full ${isRunning ? 'animate-pulse' : ''}`}
                style={{ backgroundColor: 'currentColor' }}
              />
              {statusBadgeLabel}
            </span>
          </div>
        )}

        <div className={showComplexCardLayout ? 'min-h-0 min-w-0 flex h-full flex-col' : 'min-h-0 min-w-0'}>
          <h3
            data-no-smart-actions={isBlockTask ? 'true' : undefined}
            className={`min-w-0 font-bold leading-[0.98] tracking-[-0.03em] ${
              isPreview ? '' : 'cursor-pointer'
            }`}
            style={{
              color: tone.title,
              textDecoration: isCompletedExecution ? 'line-through' : 'none',
              fontSize: `${isBlockTask ? Math.max(12, titleSize - 2) : showComplexCardLayout ? complexTitleSize : titleSize}px`,
              display: isBlockTask ? 'block' : '-webkit-box',
              WebkitLineClamp: isBlockTask
                ? undefined
                : showComplexCardLayout
                  ? 1
                  : isMicro
                    ? 2
                    : isUltraTiny
                      ? 2
                      : isTiny
                        ? 2
                        : 3,
              WebkitBoxOrient: isBlockTask ? undefined : 'vertical',
              overflow: 'hidden',
              wordBreak: isBlockTask ? 'keep-all' : 'break-word',
              whiteSpace: isBlockTask ? 'normal' : undefined,
              textTransform: isBlockTask ? 'uppercase' : undefined,
              writingMode: isBlockTask ? 'vertical-rl' : undefined,
              textOrientation: isBlockTask ? 'upright' : undefined,
              lineHeight: isBlockTask ? 1.05 : undefined,
              letterSpacing: isBlockTask ? '0.1em' : undefined,
              position: isBlockTask ? 'absolute' : undefined,
              left: isBlockTask ? `${isUltraTiny ? 8 : 12}px` : undefined,
              top: isBlockTask ? `${isUltraTiny ? 10 : 14}px` : undefined,
              bottom: isBlockTask ? `${isUltraTiny ? 30 : 38}px` : undefined,
              maxHeight: isBlockTask ? 'calc(100% - 48px)' : undefined,
            }}
            onClick={(event) => {
              if (!isInteractive) return;
              event.stopPropagation();
              if (isBlockTask) {
                onEdit(task);
                return;
              }
              onEdit(task);
            }}
            title={task.title}
          >
            {isBlockTask ? blockTitleLabel : task.title}
          </h3>

          {showComplexSubtaskSummary && (
            <div
              className={`mt-0.5 flex min-h-0 w-full flex-col ${
                isComplexCompact ? 'gap-0.5' : 'gap-1'
              } pr-1 ${showComplexCardLayout ? 'flex-1 justify-center' : ''}`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <p
                  className={`truncate font-semibold tracking-[-0.01em] ${
                    isComplexCompact ? 'text-[11px] leading-tight' : 'text-[12px]'
                  }`}
                  style={{ color: tone.body }}
                >
                  {task.subtasks.length} subtasks · {completedSubtasksCount}/{task.subtasks.length} done
                </p>
              </div>

              {showComplexSubtaskList &&
                visibleSubtasks.map((subtask) => (
                  <button
                    key={subtask.id}
                    type="button"
                    data-no-smart-actions="true"
                    disabled={writeBlocked}
                    onClick={() => {
                      if (!isInteractive) return;
                      if (blockWriteInCloud()) return;
                      toggleSubtaskComplete(task.id, subtask.id);
                    }}
                    className={`flex w-full items-center justify-start ${
                      isComplexCompact ? 'gap-1' : 'gap-1.5'
                    } text-left disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    <span
                      className="relative flex shrink-0 items-center justify-center rounded-full border-2"
                      style={{
                        borderColor: tone.body,
                        width: `${complexSubtaskMarkerSize}px`,
                        height: `${complexSubtaskMarkerSize}px`,
                        backgroundColor: subtask.completed ? withAlpha(tone.body, 0.22) : 'transparent',
                      }}
                    >
                      {subtask.completed && (
                        <Check
                          className="shrink-0"
                          style={{
                            color: tone.body,
                            width: `${Math.max(10, Math.round(complexSubtaskMarkerSize * 0.62))}px`,
                            height: `${Math.max(10, Math.round(complexSubtaskMarkerSize * 0.62))}px`,
                          }}
                        />
                      )}
                    </span>
                    <span
                      className="min-w-0 flex-1 overflow-hidden font-semibold leading-tight text-left"
                      style={{
                        color: tone.body,
                        textDecoration: subtask.completed ? 'line-through' : 'none',
                        fontSize: `${complexSubtaskFontSize}px`,
                        lineHeight: isComplexCompact ? 1.12 : 1.15,
                        display: '-webkit-box',
                        WebkitLineClamp: 1,
                        WebkitBoxOrient: 'vertical',
                      }}
                    >
                      {subtask.title}
                    </span>
                  </button>
                ))}

              {showComplexSubtaskList && hiddenSubtasksCount > 0 && (
                <span
                  className="pl-0.5 font-semibold"
                  style={{ color: tone.body, fontSize: `${Math.max(10, complexSubtaskFontSize)}px` }}
                >
                  +{hiddenSubtasksCount} more
                </span>
              )}
            </div>
          )}
        </div>

        {showStandardSubtaskList && (
          <div className="mt-1.5 flex w-full min-h-0 flex-col gap-1.5 pr-1">
            {visibleSubtasks.map((subtask) => (
              <button
                key={subtask.id}
                type="button"
                data-no-smart-actions="true"
                disabled={writeBlocked}
                onClick={() => {
                  if (!isInteractive) return;
                  if (blockWriteInCloud()) return;
                  toggleSubtaskComplete(task.id, subtask.id);
                }}
                className="flex w-full items-start justify-start gap-1.5 text-left disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span
                  className="shrink-0 rounded-full border-2"
                  style={{
                    borderColor: tone.body,
                    backgroundColor: subtask.completed ? tone.body : 'transparent',
                    width: `${subtaskMarkerSize}px`,
                    height: `${subtaskMarkerSize}px`,
                  }}
                />
                <span
                  className="min-w-0 flex-1 overflow-hidden font-semibold leading-tight text-left"
                  style={{
                    color: tone.body,
                    textDecoration: subtask.completed ? 'line-through' : 'none',
                    fontSize: `${subtaskFontSize}px`,
                    display: '-webkit-box',
                    WebkitLineClamp: subtaskTextLineClamp,
                    WebkitBoxOrient: 'vertical',
                    wordBreak: 'break-word',
                  }}
                >
                  {subtask.title}
                </span>
              </button>
            ))}

            {hiddenSubtasksCount > 0 && (
              <span
                className="pl-0.5 font-semibold"
                style={{ color: tone.body, fontSize: `${Math.max(9, subtaskFontSize - 1)}px` }}
              >
                +{hiddenSubtasksCount} more
              </span>
            )}
          </div>
        )}
      </div>

      {isBlockTask && (
        <div className="mt-auto flex items-end justify-end pr-1">
          <span
            className="truncate font-semibold leading-none tracking-[-0.015em]"
            style={{
              color: tone.body,
              fontSize: `${Math.max(10, footerSize)}px`,
            }}
            title={blockTimeLabel}
          >
            {blockTimeLabel}
          </span>
        </div>
      )}

      {!isBlockTask && (
        <div
          className={`mt-auto ${
            useColumnFooter
              ? 'flex w-full flex-col items-center gap-1'
              : showComplexCardLayout
                ? 'flex items-end justify-between gap-2'
              : 'flex items-end justify-between gap-3'
          }`}
        >
          <div
            className={`flex min-w-0 ${showVerticalTime ? (useColumnFooter ? 'flex-col items-center' : 'items-start gap-1') : 'items-center gap-2'}`}
          >
            {!isCompact && !showVerticalTime && !showComplexCardLayout && (
              <Clock className="size-4 shrink-0" style={{ color: tone.body }} />
            )}
            {showVerticalTime ? (
              <div
                className={`flex min-w-0 flex-col leading-tight ${useColumnFooter ? 'items-center text-center' : ''}`}
                style={{
                  color: tone.body,
                  fontSize: `${isMicro ? 8 : isUltraTiny ? 9 : Math.max(11, footerSize)}px`,
                }}
                title={`${startTime} - ${endTime}`}
              >
                <span className="truncate font-bold tracking-[-0.02em]">{startTime}</span>
                <span className="truncate font-bold tracking-[-0.02em]">{endTime}</span>
              </div>
            ) : (
              <span
                className="planner-task-meta truncate font-bold leading-none tracking-[-0.02em]"
                style={{
                  color: tone.body,
                  fontSize: `${showComplexCardLayout ? Math.max(9, footerSize - 2) : footerSize}px`,
                }}
                title={timeLabel}
              >
                {timeLabel}
              </span>
            )}
          </div>

          <button
            type="button"
            data-no-smart-actions="true"
            disabled={writeBlocked}
            onClick={() => {
              if (blockConflictMutation()) return;
              if (!isInteractive) return;
              if (isLockedByOther) {
                requestTakeover();
                return;
              }
              if (blockWriteInCloud()) return;
              if (isCompletedExecution) {
                reopenTask(task.id);
                return;
              }
              if (isRunning) {
                pauseTask(task.id);
                return;
              }
              if (!task.startDateTime || task.status === 'inbox') {
                toast.message('Schedule this task before starting.');
                onEdit(task);
                return;
              }
              startTask(task.id);
            }}
            className={`ui-v1-radius-sm ${
              isMicro
                ? 'h-7 w-7 p-0'
                : showComplexCardLayout
                  ? isComplexCompact
                    ? 'h-7 min-w-[72px] px-2.5'
                    : 'h-9 min-w-[92px] px-4'
                : useColumnFooter
                  ? isUltraTiny
                    ? 'h-7 w-full px-1.5 text-center'
                    : 'h-7 w-full px-2 text-center'
                  : isTiny
                    ? 'h-8 min-w-[74px] px-3.5'
                    : isCompact
                      ? 'h-9 min-w-[84px] px-4'
                      : 'h-10 min-w-[98px] px-5'
            } transition-colors hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60`}
            style={{
              backgroundColor: showComplexCardLayout ? withAlpha(tone.buttonText, 0.22) : tone.buttonBg,
              color: showComplexCardLayout ? tone.title : tone.buttonText,
            }}
          >
            {isMicro ? (
              <span className="inline-flex items-center justify-center">
                <PrimaryActionIcon className="size-3.5 shrink-0" />
              </span>
            ) : showComplexCardLayout ? (
              <span className="font-bold leading-none tracking-[-0.02em]" style={{ fontSize: `${doneSize}px` }}>
                {primaryActionLabel}
              </span>
            ) : useColumnFooter && isUltraTiny ? (
              <span
                className="font-bold leading-none tracking-[-0.02em]"
                style={{ fontSize: `${doneSize}px` }}
              >
                {primaryActionLabel}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <PrimaryActionIcon className="size-3.5 shrink-0" />
                <span
                  className="font-bold leading-none tracking-[-0.02em]"
                  style={{ fontSize: `${isUltraTiny ? 10 : doneSize}px` }}
                >
                  {primaryActionLabel}
                </span>
              </span>
            )}
          </button>
        </div>
      )}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete task?</AlertDialogTitle>
            <AlertDialogDescription>
              "{task.title}" will be permanently removed from the board.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (blockConflictMutation()) return;
                deleteTask(task.id);
                toast.success('Task deleted.');
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}

function shouldOpenQuickActions(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return true;
  if (target.closest('[data-no-smart-actions="true"]')) return false;
  if (target.closest('button,a,input,select,textarea,[role="button"]')) return false;
  return true;
}

function getEndTime(startDateTime: string, durationMinutes: number): string {
  const endDate = new Date(startDateTime);
  endDate.setMinutes(endDate.getMinutes() + durationMinutes);
  return formatTime(endDate);
}

function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function snapMinutes(
  minutes: number,
  mode: 'floor' | 'ceil',
  slotMinutes: number,
  baseMinutes: number
): number {
  const offset = minutes - baseMinutes;
  const snappedOffset =
    mode === 'ceil'
      ? Math.ceil(offset / slotMinutes) * slotMinutes
      : Math.floor(offset / slotMinutes) * slotMinutes;
  return baseMinutes + snappedOffset;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
}

function getCardTone(color: string, taskId: string): CardTone {
  const fallback = hashString(taskId) % 2 === 0 ? '#6f7584' : '#c5cbd7';
  const normalized = normalizeHexColor(color) ?? fallback;
  const luminance = getLuminance(normalized);
  const isLight = luminance >= 0.58;

  const title = isLight ? mixHex(normalized, '#111111', 0.74) : mixHex(normalized, '#ffffff', 0.82);
  const bodyBase = isLight
    ? mixHex(normalized, '#111111', 0.66)
    : mixHex(normalized, '#ffffff', 0.7);
  const utilityBase = isLight
    ? mixHex(normalized, '#111111', 0.2)
    : mixHex(normalized, '#ffffff', 0.42);
  const buttonBase = isLight
    ? mixHex(normalized, '#111111', 0.24)
    : mixHex(normalized, '#ffffff', 0.64);

  return {
    background: normalized,
    title,
    body: withAlpha(bodyBase, 0.94),
    buttonBg: withAlpha(buttonBase, isLight ? 0.9 : 0.92),
    buttonText: isLight ? '#f5f5f5' : mixHex(normalized, '#111111', 0.34),
    utilityBg: withAlpha(utilityBase, isLight ? 0.78 : 0.86),
    utilityText: isLight ? '#f5f5f5' : mixHex(normalized, '#111111', 0.32),
  };
}

function getLuminance(hexColor: string): number {
  const normalized = normalizeHexColor(hexColor);
  if (!normalized) return 0.5;
  const rgb = hexToRgb(normalized);
  if (!rgb) return 0.5;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function normalizeHexColor(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(normalized)) return normalized;
  if (!/^#[0-9a-f]{3}$/i.test(normalized)) return null;
  return `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`;
}

function hexToRgb(value: string): { r: number; g: number; b: number } | null {
  const normalized = normalizeHexColor(value);
  if (!normalized) return null;
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (channel: number) =>
    Math.max(0, Math.min(255, Math.round(channel)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function mixHex(baseHex: string, targetHex: string, amount: number): string {
  const from = hexToRgb(baseHex);
  const to = hexToRgb(targetHex);
  if (!from || !to) return normalizeHexColor(baseHex) ?? '#6f7584';
  const ratio = Math.max(0, Math.min(1, amount));
  return rgbToHex(
    from.r + (to.r - from.r) * ratio,
    from.g + (to.g - from.g) * ratio,
    from.b + (to.b - from.b) * ratio
  );
}

function withAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(111, 117, 132, ${alpha})`;
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clampedAlpha})`;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
