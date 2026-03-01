import { useDrag } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { Task, useTasks } from '../context/TaskContext';
import { Check, Clock, Lock, Pause, Play, Trash2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { useTeamMembers } from '../context/TeamMembersContext';
import { useCloudSync } from '../context/CloudSyncContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import { type AppTheme, useAppTheme } from '../context/AppThemeContext';
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
  const {
    preferences: { uiDensity },
  } = useUserPreferences();
  const { theme } = useAppTheme();
  const useCloudMembers = cloudEnabled && Boolean(cloudToken && activeOrgId);
  const members = useMemo(
    () => buildEffectiveMembers(localMembers, cloudMembers, useCloudMembers),
    [cloudMembers, localMembers, useCloudMembers]
  );
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [resizing, setResizing] = useState<ResizeState | null>(null);
  const [resizeStartedAt, setResizeStartedAt] = useState<number | null>(null);
  const [completionPopScale, setCompletionPopScale] = useState(1);
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
  const taskBaseColor = useMemo(() => normalizeHexColor(task.color) ?? '#8d929c', [task.color]);
  const executionStatus = normalizeExecutionStatus(task);
  const isRunning = executionStatus === 'running';
  const isCompletedExecution = executionStatus === 'completed' || task.completed;
  const previousCompletedRef = useRef(isCompletedExecution);
  const tone = useMemo(
    () => resolveTaskCardTone(taskBaseColor, task.id, isBlockTask, theme),
    [isBlockTask, task.id, taskBaseColor, theme]
  );
  const accentStripColor = useMemo(() => {
    if (isRunning) return tone.buttonText;
    if (isCompletedExecution) return withAlpha(tone.buttonText, 0.42);
    return withAlpha(tone.buttonText, 0.6);
  }, [isCompletedExecution, isRunning, tone.buttonText]);
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
  const primaryActionLabel = isCompletedExecution ? 'Done · Reopen' : isRunning ? 'Pause' : 'Start';
  const primaryActionIcon = isCompletedExecution ? Check : isRunning ? Pause : Play;
  const PrimaryActionIcon = primaryActionIcon;
  const actionStripState: 'idle' | 'running' | 'completed' = isCompletedExecution
    ? 'completed'
    : isRunning
      ? 'running'
      : 'idle';
  const actionStripStyle = useMemo(() => {
    if (actionStripState === 'running') {
      return {
        backgroundColor: tone.buttonBg,
        color: tone.buttonText,
      };
    }
    if (actionStripState === 'completed') {
      return {
        backgroundColor: 'rgba(255,255,255,0.16)',
        border: '1px solid rgba(255,255,255,0.24)',
        color: 'rgba(255,255,255,0.76)',
      };
    }
    return {
      backgroundColor: tone.buttonBg,
      color: tone.buttonText,
    };
  }, [actionStripState, tone.buttonBg, tone.buttonText]);
  const taskTypeLabel = task.type === 'large' ? 'Large' : task.type === 'block' ? 'Block' : 'Quick';
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
  const complexGrooveHeight = showComplexCardLayout
    ? clamp(Math.round(heightBasis * 0.22), 28, 52)
    : 0;
  const complexClipPath = useMemo(
    () =>
      showComplexCardLayout
        ? buildComplexCardClipPath({
            width: widthBasis,
            height: heightBasis,
            grooveHeight: complexGrooveHeight,
          })
        : undefined,
    [complexGrooveHeight, heightBasis, showComplexCardLayout, widthBasis]
  );
  const showComplexSubtaskSummary = showComplexCardLayout && task.subtasks.length > 0;
  const showComplexSubtaskList = showComplexCardLayout && visibleSubtasks.length > 0;
  const showStandardSubtaskList =
    !showComplexCardLayout && visibleSubtasks.length > 0 && heightBasis >= 168;
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
  const statusBadgeColor = isCompletedExecution
    ? 'var(--hud-success-text)'
    : isRunning
      ? 'var(--hud-info-text)'
      : isPaused
        ? 'var(--hud-warning-text)'
        : 'var(--hud-text)';
  const timestampColor = isCompletedExecution
    ? withAlpha(tone.title, 0.64)
    : withAlpha(tone.title, 0.82);
  const isComplexCompact = showComplexCardLayout && heightBasis < 214;
  const complexTitleSize = isComplexCompact
    ? clamp(Math.round(20 * sizeRatio), 16, 24)
    : clamp(Math.round(30 * sizeRatio), 20, 36);
  const complexSubtaskFontSize = isComplexCompact
    ? clamp(Math.round(15 * sizeRatio), 13, 16)
    : clamp(Math.round(15 * sizeRatio), 14, 18);
  const complexSubtaskMarkerSize = isComplexCompact
    ? clamp(Math.round(18 * sizeRatio), 15, 19)
    : clamp(Math.round(19 * sizeRatio), 16, 21);
  const complexChecklistTopInset = showComplexCardLayout
    ? clamp(Math.round(complexGrooveHeight * 0.9), 12, 36)
    : 0;
  const blockTitleLabel = (task.title || 'BLOCK').toUpperCase();
  const subtaskTextLineClamp = widthBasis < 190 || heightBasis < 150 ? 1 : 2;
  const paddingClass = showComplexCardLayout
    ? isComplexCompact
      ? 'p-3'
      : 'p-4'
    : uiDensity === 'compact'
      ? isMicro
        ? 'p-1.5'
        : isUltraTiny
          ? 'p-2'
          : isTiny
            ? 'p-3'
            : 'p-3.5'
      : isMicro
        ? 'p-2'
        : isUltraTiny
          ? 'p-2.5'
          : isTiny
            ? 'p-3.5'
            : 'p-[18px]';
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
    if (isPreview) return;
    if (!previousCompletedRef.current && isCompletedExecution) {
      setCompletionPopScale(1.03);
      const timer = window.setTimeout(() => setCompletionPopScale(1), 200);
      previousCompletedRef.current = isCompletedExecution;
      return () => window.clearTimeout(timer);
    }
    previousCompletedRef.current = isCompletedExecution;
    setCompletionPopScale(1);
    return undefined;
  }, [isCompletedExecution, isPreview]);

  useEffect(() => {
    if (!resizing || !canResize || slotMinutes === undefined || !getMinutesFromClientX) {
      return undefined;
    }

    const handleMove = (event: MouseEvent) => {
      if (writeBlocked) return;
      const cursorMinutesRaw = getMinutesFromClientX(event.clientX, 'raw');
      if (cursorMinutesRaw === null) return;

      const dayStart = 0;
      const dayEnd = 24 * 60;
      const originalStart = resizing.startMinutes;
      const originalEnd = resizing.startMinutes + resizing.durationMinutes;
      const snapMode = resizing.direction === 'end' ? 'ceil' : 'floor';
      const adjustedMinutes = cursorMinutesRaw + resizing.dragOffsetMinutes;
      const snappedMinutes = snapMinutes(adjustedMinutes, snapMode, slotMinutes, dayStart);
      let nextStart = originalStart;
      let nextDuration = resizing.durationMinutes;

      if (resizing.direction === 'start') {
        nextStart = Math.min(Math.max(snappedMinutes, dayStart), originalEnd - slotMinutes);
        nextDuration = originalEnd - nextStart;
      } else {
        const nextEnd = Math.min(Math.max(snappedMinutes, originalStart + slotMinutes), dayEnd);
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
      data-status={executionStatus}
      initial={isPreview ? false : { scale: 0.95, opacity: 0 }}
      animate={{
        scale: completionPopScale,
        opacity: isPreview ? 0.55 : isDragging ? 0.45 : isCompletedExecution ? 0.82 : 1,
      }}
      exit={{ scale: 0.95, opacity: 0 }}
      whileHover={
        isPreview
          ? undefined
          : {
              y: -1,
              boxShadow: '0 4px 16px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.25)',
            }
      }
      transition={{ duration: 0.2, ease: 'easeOut' }}
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
      className={`planner-task-card group relative flex select-none flex-col overflow-hidden ${
        showComplexCardLayout ? 'rounded-[20px]' : 'rounded-[16px]'
      } ${
        isPreview ? 'cursor-default pointer-events-none' : 'cursor-move pointer-events-auto'
      } ${paddingClass} ${isSelectedTask ? 'ring-2 ring-[color:var(--hud-outline)]' : ''}`}
      style={{
        backgroundColor: tone.background,
        border: `1.5px solid ${tone.borderColor}`,
        borderRadius: showComplexCardLayout ? '20px' : '16px',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        boxShadow: '0 2px 8px rgba(0,0,0,0.35), 0 1px 2px rgba(0,0,0,0.2)',
        clipPath: complexClipPath,
        fontFamily: '"SF Pro Display",-apple-system,BlinkMacSystemFont,system-ui,sans-serif',
        filter: isCompletedExecution ? 'grayscale(0.24) brightness(0.9) saturate(0.88)' : undefined,
        ...blockStyle,
      }}
    >
      {!isBlockTask && (
        <div
          data-testid={`task-accent-strip-${task.id}`}
          className={`planner-task-accent-strip pointer-events-none absolute inset-y-0 left-0 z-[5] w-1 ${
            isRunning ? 'planner-task-accent-strip-running' : ''
          }`}
          style={{ backgroundColor: accentStripColor }}
        />
      )}
      {isBlockTask && (
        <div
          className="pointer-events-none absolute inset-0 z-0 opacity-40"
          style={{
            backgroundImage:
              'repeating-linear-gradient(-48deg, rgba(183,247,0,0.08) 0, rgba(183,247,0,0.08) 1px, transparent 1px, transparent 14px)',
          }}
        />
      )}

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
        <div
          className={`pointer-events-none absolute right-3 z-10 flex items-center gap-2 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 ${
            showComplexCardLayout ? 'top-11' : 'top-3'
          }`}
        >
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
              if (blockDeleteInCloud()) return;
              setDeleteConfirmOpen(true);
            }}
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      )}

      {showComplexCardLayout ? (
        <div className="mb-2 mt-1 min-h-0 flex-1">
          <div className="relative h-full min-h-0 overflow-hidden">
            <div
              className="pointer-events-none absolute bottom-0 left-[58%] z-[2] w-px"
              style={{
                top: `${complexGrooveHeight + 2}px`,
                backgroundColor: withAlpha(tone.body, 0.28),
              }}
            />
            <div className="grid h-full min-h-0 grid-cols-[minmax(0,1.06fr)_minmax(0,0.94fr)] gap-3">
              <div className="min-h-0 min-w-0 pr-2">
                {showStatusBadge && (
                  <div className="h-[14px]">
                    <span
                      className="pointer-events-none inline-flex items-center gap-1.5 rounded-full border border-current bg-transparent px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.08em] opacity-0 transition-opacity group-hover:opacity-100"
                      style={{ color: statusBadgeColor }}
                    >
                      <span
                        className={`size-1.5 rounded-full ${isRunning ? 'animate-pulse' : ''}`}
                        style={{ backgroundColor: 'currentColor' }}
                      />
                      {statusBadgeLabel}
                    </span>
                  </div>
                )}
                <h3
                  data-no-smart-actions={isBlockTask ? 'true' : undefined}
                  className={`min-w-0 font-bold leading-[0.98] tracking-[-0.03em] ${
                    isPreview ? '' : 'cursor-pointer'
                  }`}
                  style={{
                    color: tone.title,
                    textDecoration: isCompletedExecution ? 'line-through' : 'none',
                    fontSize: `${isBlockTask ? Math.max(12, titleSize - 2) : complexTitleSize}px`,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    wordBreak: 'break-word',
                    maxWidth: '100%',
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
                {!isPreview && !isMicro && (
                  <p
                    className="mt-1 truncate text-[10px] font-semibold uppercase tracking-[0.08em]"
                    style={{ color: withAlpha(tone.title, 0.74) }}
                  >
                    {taskTypeLabel}
                  </p>
                )}
                <p
                  className="mt-1 truncate font-semibold tracking-[-0.01em]"
                  style={{
                    color: timestampColor,
                    fontSize: `${Math.max(10, footerSize - 1)}px`,
                  }}
                >
                  {timeLabel}
                </p>
                {!showComplexSubtaskList && showComplexSubtaskSummary && (
                  <p
                    className="mt-1 truncate text-[11px] font-semibold tracking-[0.06em] uppercase"
                    style={{ color: tone.body }}
                  >
                    Subtasks
                  </p>
                )}
              </div>

              <div
                className="min-h-0 min-w-0"
                style={{ marginTop: `${complexChecklistTopInset}px` }}
              >
                {showComplexSubtaskList && (
                  <div className="flex min-h-0 h-full w-full flex-col gap-1.5 pr-1">
                    <span
                      className="text-[10px] font-semibold uppercase tracking-[0.08em]"
                      style={{ color: withAlpha(tone.body, 0.76) }}
                    >
                      Subtasks
                    </span>
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
                          className="relative mt-[2px] flex shrink-0 items-center justify-center rounded-full border"
                          style={{
                            borderColor: subtask.completed
                              ? withAlpha(tone.body, 0.85)
                              : withAlpha(tone.body, 0.5),
                            width: `${Math.max(8, complexSubtaskMarkerSize - 3)}px`,
                            height: `${Math.max(8, complexSubtaskMarkerSize - 3)}px`,
                            backgroundColor: subtask.completed
                              ? withAlpha(tone.body, 0.8)
                              : 'transparent',
                          }}
                        >
                          {subtask.completed && (
                            <Check
                              className="shrink-0"
                              style={{
                                color: tone.background,
                                width: `${Math.max(8, Math.round(complexSubtaskMarkerSize * 0.45))}px`,
                                height: `${Math.max(8, Math.round(complexSubtaskMarkerSize * 0.45))}px`,
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
                            WebkitLineClamp: isComplexCompact ? 1 : 2,
                            WebkitBoxOrient: 'vertical',
                          }}
                        >
                          {subtask.title}
                        </span>
                      </button>
                    ))}

                    {hiddenSubtasksCount > 0 && (
                      <span
                        className="pl-0.5 font-semibold"
                        style={{
                          color: tone.body,
                          fontSize: `${Math.max(11, complexSubtaskFontSize - 1)}px`,
                        }}
                      >
                        +{hiddenSubtasksCount} more
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className={`${isUltraTiny ? 'mb-2' : 'mb-3'} flex min-h-0 flex-col gap-2`}>
          {showStatusBadge && (
            <div className="h-[18px]">
              <span
                className="pointer-events-none inline-flex items-center gap-1.5 rounded-full border border-current bg-transparent px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] opacity-0 transition-opacity group-hover:opacity-100"
                style={{ color: statusBadgeColor }}
              >
                <span
                  className={`size-1.5 rounded-full ${isRunning ? 'animate-pulse' : ''}`}
                  style={{ backgroundColor: 'currentColor' }}
                />
                {statusBadgeLabel}
              </span>
            </div>
          )}

          <div className="min-h-0 min-w-0">
            <h3
              data-no-smart-actions={isBlockTask ? 'true' : undefined}
              className={`min-w-0 font-bold leading-[0.98] tracking-[-0.03em] ${
                isPreview ? '' : 'cursor-pointer'
              }`}
              style={{
                color: tone.title,
                textDecoration: isCompletedExecution ? 'line-through' : 'none',
                fontSize: `${isBlockTask ? Math.max(12, titleSize - 2) : titleSize}px`,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                wordBreak: 'break-word',
                maxWidth: '100%',
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
            {!isPreview && !isMicro && (
              <p
                className="mt-1 truncate text-[10px] font-semibold uppercase tracking-[0.08em]"
                style={{ color: withAlpha(tone.title, 0.74) }}
              >
                {taskTypeLabel}
              </p>
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
      )}

      {isBlockTask && (
        <div className="mt-auto flex w-full flex-col gap-2">
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
          <span
            className="inline-flex w-full items-center justify-center gap-1 rounded-[12px] border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em]"
            style={{
              color: tone.buttonText,
              borderColor: withAlpha(tone.buttonText, 0.26),
              backgroundColor: 'transparent',
            }}
          >
            Reserved
          </span>
        </div>
      )}

      {!isBlockTask && (
        <div className="mt-auto flex w-full flex-col gap-1.5">
          {!showComplexCardLayout && (
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
                    color: timestampColor,
                    fontSize: `${isMicro ? 8 : isUltraTiny ? 9 : Math.max(11, footerSize)}px`,
                  }}
                  title={`${startTime} - ${endTime}`}
                >
                  <span className="truncate font-bold tracking-[-0.02em]">{startTime}</span>
                  <span
                    className="truncate font-bold leading-none tracking-[-0.02em]"
                    aria-hidden="true"
                  >
                    -
                  </span>
                  <span className="truncate font-bold tracking-[-0.02em]">{endTime}</span>
                </div>
              ) : (
                <span
                  className="planner-task-meta truncate font-bold leading-none tracking-[-0.02em]"
                  style={{
                    color: timestampColor,
                    fontSize: `${Math.max(9, footerSize - 2)}px`,
                  }}
                  title={timeLabel}
                >
                  {timeLabel}
                </span>
              )}
            </div>
          )}

          <button
            type="button"
            data-no-smart-actions="true"
            data-testid={`task-action-strip-${task.id}`}
            data-execution-state={actionStripState}
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
            className={`w-full rounded-[12px] border border-transparent transition-colors hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 ${
              isMicro ? 'h-8 px-2' : isUltraTiny ? 'h-8 px-2.5' : isTiny ? 'h-9 px-3' : 'h-10 px-4'
            }`}
            style={actionStripStyle}
          >
            <span className="inline-flex items-center justify-center gap-1.5">
              {actionStripState === 'running' && (
                <span className="size-1.5 rounded-full bg-current opacity-85" />
              )}
              <PrimaryActionIcon className="size-3.5 shrink-0" />
              <span
                className="font-bold leading-none tracking-[-0.02em]"
                style={{ fontSize: `${isUltraTiny ? 10 : doneSize}px` }}
              >
                {actionStripState === 'running' ? 'Running · Pause' : primaryActionLabel}
              </span>
            </span>
          </button>
        </div>
      )}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete task?</AlertDialogTitle>
            <AlertDialogDescription>
              "{task.title}" will be permanently removed from the board.
              {isConflictLocked
                ? ' This task currently has a sync conflict.'
                : isLockedByOther
                  ? ` ${taskPresenceLock?.userName ?? 'Another user'} is currently editing this task.`
                  : ''}{' '}
              Delete anyway?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (blockDeleteInCloud()) return;
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

function resolveTaskCardTone(
  taskBaseColor: string,
  _taskId: string,
  isBlockTask: boolean,
  theme: AppTheme
): {
  background: string;
  title: string;
  body: string;
  buttonBg: string;
  buttonText: string;
  utilityBg: string;
  utilityText: string;
  borderColor: string;
} {
  if (isBlockTask) {
    return {
      background: '#111111',
      title: 'rgba(183,247,0,0.58)',
      body: 'rgba(183,247,0,0.66)',
      buttonBg: 'transparent',
      buttonText: 'rgba(183,247,0,0.52)',
      utilityBg: 'rgba(183,247,0,0.18)',
      utilityText: 'rgba(183,247,0,0.8)',
      borderColor: '#252525',
    };
  }

  const normalized = normalizeHexColor(taskBaseColor) ?? '#8d929c';
  if (theme === 'vibrant-pop') {
    const family = resolveVibrantFamily(normalized);
    if (family === 'electric') {
      const text = '#b7f700';
      return {
        background: normalized,
        title: text,
        body: withAlpha(text, 0.74),
        buttonBg: text,
        buttonText: '#0136fe',
        utilityBg: withAlpha(text, 0.18),
        utilityText: text,
        borderColor: withAlpha(text, 0.26),
      };
    }
    if (family === 'lime') {
      const text = '#0136fe';
      return {
        background: normalized,
        title: text,
        body: withAlpha(text, 0.72),
        buttonBg: text,
        buttonText: '#b7f700',
        utilityBg: withAlpha(text, 0.16),
        utilityText: text,
        borderColor: withAlpha(text, 0.24),
      };
    }
    const text = '#0f1a36';
    return {
      background: normalized,
      title: text,
      body: withAlpha(text, 0.7),
      buttonBg: '#0136fe',
      buttonText: normalized,
      utilityBg: withAlpha(text, 0.14),
      utilityText: text,
      borderColor: withAlpha(text, 0.24),
    };
  }

  const contrastText = pickReadableTextColor(normalized);

  return {
    background: normalized,
    title: contrastText,
    body: withAlpha(contrastText, 0.64),
    buttonBg: contrastText,
    buttonText: normalized,
    utilityBg: withAlpha(contrastText, 0.2),
    utilityText: contrastText,
    borderColor: withAlpha(contrastText, 0.24),
  };
}

function buildComplexCardClipPath(input: {
  width: number;
  height: number;
  grooveHeight: number;
}): string {
  const width = Math.max(180, Math.round(input.width));
  const height = Math.max(140, Math.round(input.height));
  const outerRadius = clamp(Math.round(Math.min(width, height) * 0.11), 14, 24);
  const grooveHeight = clamp(Math.round(input.grooveHeight), 26, 56);
  const grooveWidth = clamp(Math.round(width * 0.44), 92, Math.max(120, width - 44));
  const grooveLeft = Math.max(outerRadius + 20, width - grooveWidth);
  const grooveRadius = clamp(Math.round(grooveHeight * 0.48), 12, 20);
  const notchTopCurveX = grooveLeft + grooveRadius;
  const notchBottomCurveX = Math.min(width - outerRadius - 2, grooveLeft + grooveRadius * 2 + 4);
  const rightUpperJoinY = grooveHeight + grooveRadius;

  return `path('M ${outerRadius} 0 H ${grooveLeft} Q ${notchTopCurveX} 0 ${notchTopCurveX} ${grooveRadius} V ${Math.max(
    grooveRadius + 2,
    grooveHeight - grooveRadius
  )} Q ${notchTopCurveX} ${grooveHeight} ${notchBottomCurveX} ${grooveHeight} H ${
    width - outerRadius
  } Q ${width} ${grooveHeight} ${width} ${rightUpperJoinY} V ${height - outerRadius} Q ${width} ${height} ${
    width - outerRadius
  } ${height} H ${outerRadius} Q 0 ${height} 0 ${height - outerRadius} V ${outerRadius} Q 0 0 ${outerRadius} 0 Z')`;
}

function resolveVibrantFamily(color: string): 'electric' | 'lime' | 'bloom' {
  const electric = ['#0136fe', '#2c6dff', '#5d41ff'];
  const lime = ['#b7f700'];
  const bloom = ['#f14292', '#e63f97', '#ff4d8f', '#b93d7d'];
  const all = [
    ...electric.map((hex) => ({ hex, family: 'electric' as const })),
    ...lime.map((hex) => ({ hex, family: 'lime' as const })),
    ...bloom.map((hex) => ({ hex, family: 'bloom' as const })),
  ];
  let best: (typeof all)[number] = all[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  const baseRgb = hexToRgb(color);
  if (!baseRgb) return 'bloom';
  all.forEach((entry) => {
    const candidateRgb = hexToRgb(entry.hex);
    if (!candidateRgb) return;
    const distance = Math.sqrt(
      Math.pow(baseRgb.r - candidateRgb.r, 2) +
        Math.pow(baseRgb.g - candidateRgb.g, 2) +
        Math.pow(baseRgb.b - candidateRgb.b, 2)
    );
    if (distance < bestDistance) {
      best = entry;
      bestDistance = distance;
    }
  });
  return best.family;
}

function pickReadableTextColor(backgroundHex: string): '#0f1a36' | '#f3f3f8' {
  const light = '#f3f3f8';
  const dark = '#0f1a36';
  const bgLuminance = getLuminance(backgroundHex);
  const lightContrast = getContrastRatio(bgLuminance, getLuminance(light));
  const darkContrast = getContrastRatio(bgLuminance, getLuminance(dark));
  return lightContrast >= darkContrast ? light : dark;
}

function getContrastRatio(luminanceA: number, luminanceB: number): number {
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
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

function withAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(111, 117, 132, ${alpha})`;
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clampedAlpha})`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
