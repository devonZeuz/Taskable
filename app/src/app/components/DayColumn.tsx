import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useDrop } from 'react-dnd';
import { toast } from 'sonner';
import { Task, useTasks } from '../context/TaskContext';
import TaskCard from './TaskCard';
import QuickAddButton from './QuickAddButton';
import { useWorkday } from '../context/WorkdayContext';
import { useCloudSync } from '../context/CloudSyncContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import {
  combineDayAndTime,
  findNextAvailableSlotAfter,
  getDayKey,
  getDayKeyFromDateTime,
  getTaskInterval,
  getWorkdayMinutes,
  minutesToTime,
  timeToMinutes,
} from '../services/scheduling';
import {
  buildForwardShovePlan,
  countOverlapsAtTarget,
  type ShoveMove,
} from '../services/shovePlanning';
import { isDeterministicDndMode } from '../services/e2eMode';
import { hasExternalPayload, parseExternalDrop } from '../services/externalDrop';
import { recordOperationalEvent } from '../services/operationalTelemetry';
import { playCalendarSnapSound } from '../services/uiSounds';

interface DayColumnProps {
  day: string;
  tasks: Task[];
  timeSlots: string[];
  slotMinutes: number;
  hourWidth: number;
  hourGap: number;
  onEdit: (task: Task) => void;
  onOpenQuickActions?: (task: Task) => void;
  showQuickAdd?: boolean;
  defaultAssignee?: string;
  scheduleTasks?: Task[];
}

interface HoverPreview {
  startMinutes: number;
  durationMinutes: number;
  laneIndex: number;
  canShove: boolean;
  shoveMoves: ShoveMove[];
}

const SHOVE_HOVER_MS = 550;

export default function DayColumn({
  day,
  tasks: dayTasks,
  timeSlots,
  slotMinutes,
  hourWidth,
  hourGap,
  onEdit,
  onOpenQuickActions,
  showQuickAdd = true,
  defaultAssignee,
  scheduleTasks,
}: DayColumnProps) {
  const { tasks, addTask, moveTask, moveTasksAtomic, updateTask } = useTasks();
  const { workday } = useWorkday();
  const {
    preferences: { defaultTaskDurationMinutes, soundEffectsEnabled, uiDensity },
  } = useUserPreferences();
  const { user, presenceLocks, activeOrgRole, claimPresenceLock, conflicts } = useCloudSync();
  const deterministicDndMode = isDeterministicDndMode();
  const scheduleScopeTasks = scheduleTasks ?? tasks;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hoverIntentRef = useRef<{ key: string; since: number }>({ key: '', since: 0 });
  const [hoverPreview, setHoverPreview] = useState<HoverPreview | null>(null);
  const [shoveIntentActive, setShoveIntentActive] = useState(false);
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [externalDragOver, setExternalDragOver] = useState(false);
  const [nowTimestamp, setNowTimestamp] = useState(() => Date.now());
  const slotsPerHour = 60 / slotMinutes;
  const slotWidth = (hourWidth * slotMinutes) / 60;
  const hourCount = Math.ceil(timeSlots.length / slotsPerHour);
  const gapCount = Math.max(0, hourCount - 1);
  const gridWidth = timeSlots.length * slotWidth + gapCount * hourGap;
  const compactDensity = uiDensity === 'compact';
  const laneMinHeight = compactDensity ? 154 : 178;
  const laneStaggerOffset = compactDensity ? 16 : 18;
  const laneGap = compactDensity ? 8 : 10;
  const rowPadding = compactDensity ? 8 : 10;
  const taskSpacing = compactDensity ? 16 : 18;
  const taskInset = taskSpacing / 2;
  const workStartMinutes = workday.startHour * 60;
  const workdayMinutes = getWorkdayMinutes(workday);
  const workEndMinutes = workStartMinutes + workdayMinutes;
  const normalizedDefaultDuration = Math.max(
    slotMinutes,
    Math.round(defaultTaskDurationMinutes / slotMinutes) * slotMinutes
  );
  const hourSpanCount = Math.max(1, Math.ceil(timeSlots.length / slotsPerHour));
  const todayKey = getDayKey(new Date());
  const isTodayColumn = day === todayKey;
  const dayPresenceLock = useMemo(
    () => presenceLocks.find((lock) => lock.scope === 'day' && lock.targetId === day),
    [presenceLocks, day]
  );
  const conflictedTaskIds = useMemo(
    () => new Set(conflicts.map((conflict) => conflict.taskId)),
    [conflicts]
  );
  const dayLockedByOther = Boolean(dayPresenceLock && dayPresenceLock.userId !== user?.id);
  const canForceTakeover = activeOrgRole === 'owner' || activeOrgRole === 'admin';

  const attemptTakeover = useCallback(
    (scope: 'task' | 'day', targetId: string, currentLockUserName?: string) => {
      if (!targetId) return;
      if (!canForceTakeover) {
        toast.error(`${currentLockUserName ?? 'Someone'} is editing this ${scope}.`);
        return;
      }
      void (async () => {
        const result = await claimPresenceLock(scope, targetId, { forceTakeover: true });
        if (result.ok) {
          toast.success(
            result.takenOver
              ? `${scope === 'task' ? 'Task' : 'Day'} lock taken over. Try again.`
              : `${scope === 'task' ? 'Task' : 'Day'} lock claimed.`
          );
          return;
        }
        if (result.conflict) {
          toast.error(`${result.conflict.userName} still holds this lock.`);
        } else {
          toast.error(`Unable to take over ${scope} lock.`);
        }
      })();
    },
    [canForceTakeover, claimPresenceLock]
  );

  useEffect(() => {
    if (!isTodayColumn) return;
    const timer = window.setInterval(() => setNowTimestamp(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [isTodayColumn]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') setIsShiftPressed(true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') setIsShiftPressed(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const getMinutesFromClientX = useCallback(
    (clientX: number, snap: 'round' | 'floor' | 'ceil' | 'raw' = 'round') => {
      if (!containerRef.current) return null;
      const rect = containerRef.current.getBoundingClientRect();
      const scaleX = rect.width > 0 ? rect.width / gridWidth : 1;
      const unscaledX = (clientX - rect.left) / (scaleX || 1);
      const relativeX = Math.min(Math.max(unscaledX, 0), gridWidth);
      const hourBlockWidth = hourWidth + hourGap;
      const maxHourIndex = Math.max(0, hourCount - 1);

      let hourIndex = Math.min(Math.floor(relativeX / hourBlockWidth), maxHourIndex);
      let xInHour = relativeX - hourIndex * hourBlockWidth;

      if (xInHour > hourWidth) {
        hourIndex = Math.min(hourIndex + 1, maxHourIndex);
        xInHour = 0;
      }

      const rawSlotIndex = xInHour / slotWidth;
      let slotIndexInHour =
        snap === 'raw'
          ? rawSlotIndex
          : snap === 'floor'
            ? Math.floor(rawSlotIndex)
            : snap === 'ceil'
              ? Math.ceil(rawSlotIndex)
              : Math.round(rawSlotIndex);
      slotIndexInHour = Math.min(Math.max(slotIndexInHour, 0), slotsPerHour);

      let slotIndex = hourIndex * slotsPerHour + slotIndexInHour;
      const maxSlotIndex = timeSlots.length;
      slotIndex = Math.min(Math.max(slotIndex, 0), maxSlotIndex);

      return workStartMinutes + slotIndex * slotMinutes;
    },
    [
      gridWidth,
      hourWidth,
      hourGap,
      hourCount,
      slotWidth,
      slotsPerHour,
      slotMinutes,
      timeSlots.length,
      workStartMinutes,
    ]
  );

  const getPlacement = useCallback(
    (startMinutes: number, durationMinutes: number) => {
      const maxSlotIndex = timeSlots.length;
      const startSlotIndex = Math.min(
        Math.max(0, Math.round((startMinutes - workStartMinutes) / slotMinutes)),
        Math.max(0, maxSlotIndex - 1)
      );
      const durationSlots = Math.max(1, Math.ceil(durationMinutes / slotMinutes));
      const endSlotIndex = Math.min(startSlotIndex + durationSlots, maxSlotIndex);
      const startGapCount = Math.floor(startSlotIndex / slotsPerHour);
      const endGapCount = Math.floor((endSlotIndex - 1) / slotsPerHour);
      const startCol = startSlotIndex + startGapCount + 1;
      const endCol = endSlotIndex + endGapCount + 1;
      const gapCountWithin = Math.max(0, endGapCount - startGapCount);
      const blockWidth = durationSlots * slotWidth + gapCountWithin * hourGap;
      const hasHourBoundaryLeft = startSlotIndex % slotsPerHour === 0 && startSlotIndex > 0;
      const hasHourBoundaryRight = endSlotIndex % slotsPerHour === 0 && endSlotIndex < maxSlotIndex;
      const leftInset = startSlotIndex === 0 || hasHourBoundaryLeft ? 0 : taskInset;
      const rightInset = endSlotIndex === maxSlotIndex || hasHourBoundaryRight ? 0 : taskInset;
      const visibleWidth = Math.max(slotWidth - 4, blockWidth - leftInset - rightInset);
      return { startCol, endCol, visibleWidth, leftInset, rightInset };
    },
    [hourGap, slotMinutes, slotWidth, slotsPerHour, taskInset, timeSlots.length, workStartMinutes]
  );

  const getPreviewLaneIndex = useCallback(
    (startMinutes: number, durationMinutes: number, excludeTaskId?: string) => {
      const endMinutes = startMinutes + durationMinutes;
      const overlappingIntervals = [...dayTasks]
        .sort((a, b) => getTaskInterval(a).startMinutes - getTaskInterval(b).startMinutes)
        .reduce<Array<{ startMinutes: number; endMinutes: number }>>((accumulator, task) => {
          if (excludeTaskId && task.id === excludeTaskId) return accumulator;
          const interval = getTaskInterval(task);
          const overlaps = startMinutes < interval.endMinutes && endMinutes > interval.startMinutes;
          if (overlaps) {
            accumulator.push(interval);
          }
          return accumulator;
        }, []);

      const laneEnds: number[] = [];
      overlappingIntervals.forEach((interval) => {
        let laneIndex = laneEnds.findIndex((end) => interval.startMinutes >= end);
        if (laneIndex === -1) {
          laneIndex = laneEnds.length;
          laneEnds.push(interval.endMinutes);
        } else {
          laneEnds[laneIndex] = interval.endMinutes;
        }
      });

      const previewLane = laneEnds.findIndex((end) => startMinutes >= end);
      return previewLane === -1 ? laneEnds.length : previewLane;
    },
    [dayTasks]
  );

  const overlapsBlockedWindow = useCallback(
    (startMinutes: number, durationMinutes: number, excludeTaskId?: string) => {
      const endMinutes = startMinutes + durationMinutes;
      return scheduleScopeTasks.some((task) => {
        if (task.id === excludeTaskId) return false;
        if (task.type !== 'block') return false;
        if (!task.startDateTime || task.status === 'inbox') return false;
        if (getDayKeyFromDateTime(task.startDateTime) !== day) return false;
        const interval = getTaskInterval(task);
        return startMinutes < interval.endMinutes && endMinutes > interval.startMinutes;
      });
    },
    [day, scheduleScopeTasks]
  );

  const [{ isOver, canDrop }, drop] = useDrop(
    () => ({
      accept: 'TASK',
      hover: (item: { id: string }, monitor) => {
        if (!monitor.isOver()) return;

        const draggedTask = tasks.find((task) => task.id === item.id);
        if (!draggedTask) return;
        if (conflictedTaskIds.has(draggedTask.id)) {
          setHoverPreview(null);
          setShoveIntentActive(false);
          return;
        }
        const taskPresenceLock = presenceLocks.find(
          (lock) => lock.scope === 'task' && lock.targetId === draggedTask.id
        );
        const taskLockedByOther = Boolean(taskPresenceLock && taskPresenceLock.userId !== user?.id);
        if (taskLockedByOther || dayLockedByOther) {
          setHoverPreview(null);
          setShoveIntentActive(false);
          return;
        }

        const clientOffset = monitor.getClientOffset();
        if (!clientOffset) return;

        const cursorMinutes = getMinutesFromClientX(clientOffset.x);
        if (cursorMinutes === null) return;

        const durationMinutes = draggedTask.durationMinutes;
        if (durationMinutes > workdayMinutes) {
          setHoverPreview(null);
          setShoveIntentActive(false);
          return;
        }

        const durationSlots = Math.ceil(durationMinutes / slotMinutes);
        const maxStartIndex = timeSlots.length - durationSlots;
        if (maxStartIndex < 0) {
          setHoverPreview(null);
          setShoveIntentActive(false);
          return;
        }

        const rawIndex = Math.round((cursorMinutes - workStartMinutes) / slotMinutes);
        const startIndex = Math.min(Math.max(rawIndex, 0), maxStartIndex);
        const startMinutes = workStartMinutes + startIndex * slotMinutes;
        const blockedWindow =
          draggedTask.type !== 'block' &&
          overlapsBlockedWindow(startMinutes, durationMinutes, draggedTask.id);
        if (blockedWindow) {
          setHoverPreview(null);
          setShoveIntentActive(false);
          return;
        }
        const shovePlan = buildForwardShovePlan(
          scheduleScopeTasks,
          day,
          startMinutes,
          durationMinutes,
          draggedTask.id,
          workday,
          slotMinutes
        );
        const overlapCount = countOverlapsAtTarget(
          scheduleScopeTasks,
          day,
          startMinutes,
          durationMinutes,
          draggedTask.id
        );
        const canShove = shovePlan !== null && shovePlan.length > 0;
        const hoverKey = `${draggedTask.id}:${day}:${startMinutes}`;
        const now = Date.now();
        let shoveByHover = false;

        if (hoverIntentRef.current.key !== hoverKey) {
          hoverIntentRef.current = { key: hoverKey, since: now };
        } else if (
          canShove &&
          overlapCount > 0 &&
          now - hoverIntentRef.current.since >= SHOVE_HOVER_MS
        ) {
          shoveByHover = true;
        }

        setShoveIntentActive((prev) => (prev === shoveByHover ? prev : shoveByHover));

        setHoverPreview({
          startMinutes,
          durationMinutes,
          laneIndex: getPreviewLaneIndex(startMinutes, durationMinutes, draggedTask.id),
          canShove,
          shoveMoves: shovePlan ?? [],
        });
      },
      drop: (item: { id: string }, monitor) => {
        const dropStartedAt =
          typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
        const logDropSample = (
          outcome: string,
          extra?: Record<string, string | number | boolean>
        ) => {
          const endedAt =
            typeof performance !== 'undefined' && typeof performance.now === 'function'
              ? performance.now()
              : Date.now();
          recordOperationalEvent({
            eventType: 'dnd.drop.performance',
            durationMs: Math.max(0, endedAt - dropStartedAt),
            metadata: {
              outcome,
              ...(extra ?? {}),
            },
          });
        };
        const draggedTask = tasks.find((task) => task.id === item.id);
        if (!draggedTask) {
          logDropSample('missing_task');
          return;
        }
        if (conflictedTaskIds.has(draggedTask.id)) {
          toast.error('Task has a sync conflict. Resolve it before moving.');
          setHoverPreview(null);
          setShoveIntentActive(false);
          logDropSample('task_conflict_locked');
          return;
        }
        const taskPresenceLock = presenceLocks.find(
          (lock) => lock.scope === 'task' && lock.targetId === draggedTask.id
        );
        const taskLockedByOther = Boolean(taskPresenceLock && taskPresenceLock.userId !== user?.id);
        if (taskLockedByOther) {
          attemptTakeover('task', draggedTask.id, taskPresenceLock?.userName);
          setHoverPreview(null);
          setShoveIntentActive(false);
          logDropSample('task_locked');
          return;
        }
        if (dayLockedByOther) {
          attemptTakeover('day', day, dayPresenceLock?.userName);
          setHoverPreview(null);
          setShoveIntentActive(false);
          logDropSample('day_locked');
          return;
        }

        const clientOffset = monitor.getClientOffset();
        if (!clientOffset) {
          logDropSample('missing_offset');
          return;
        }

        const cursorMinutes = getMinutesFromClientX(clientOffset.x);
        if (cursorMinutes === null) {
          logDropSample('missing_cursor');
          return;
        }

        const durationMinutes = draggedTask.durationMinutes;
        if (durationMinutes > workdayMinutes) {
          toast.error('Tasks cannot span multiple days.');
          setHoverPreview(null);
          logDropSample('duration_exceeds_workday');
          return;
        }

        const durationSlots = Math.ceil(durationMinutes / slotMinutes);
        const maxStartIndex = timeSlots.length - durationSlots;
        if (maxStartIndex < 0) {
          toast.error('Cannot fit today. Duration exceeds available work hours.');
          setHoverPreview(null);
          logDropSample('cannot_fit');
          return;
        }

        const rawIndex = Math.round((cursorMinutes - workStartMinutes) / slotMinutes);
        const startIndex = Math.min(Math.max(rawIndex, 0), maxStartIndex);
        const startMinutes = workStartMinutes + startIndex * slotMinutes;
        const startTime = minutesToTime(startMinutes);
        const startDateTime = combineDayAndTime(day, startTime).toISOString();
        const blockedWindow =
          draggedTask.type !== 'block' &&
          overlapsBlockedWindow(startMinutes, durationMinutes, draggedTask.id);
        if (blockedWindow) {
          const nextSlot = findNextAvailableSlotAfter(
            scheduleScopeTasks,
            day,
            durationMinutes,
            startMinutes + slotMinutes,
            draggedTask.id,
            workday
          );
          if (nextSlot) {
            moveTask(item.id, combineDayAndTime(day, nextSlot.startTime).toISOString());
            toast.success(`That slot is blocked. Auto-placed at ${nextSlot.startTime}.`);
            if (soundEffectsEnabled) {
              playCalendarSnapSound();
            }
          } else {
            toast.error('That time is blocked and no free slot was found.');
          }
          hoverIntentRef.current = { key: '', since: 0 };
          setShoveIntentActive(false);
          setHoverPreview(null);
          logDropSample('blocked_window', { overlapCount: 1 });
          return;
        }
        const shovePlan = buildForwardShovePlan(
          scheduleScopeTasks,
          day,
          startMinutes,
          durationMinutes,
          draggedTask.id,
          workday,
          slotMinutes
        );
        const overlapCount = countOverlapsAtTarget(
          scheduleScopeTasks,
          day,
          startMinutes,
          durationMinutes,
          draggedTask.id
        );
        const canShove = shovePlan !== null && shovePlan.length > 0;
        const hoverKey = `${draggedTask.id}:${day}:${startMinutes}`;
        const hoverDwellShove =
          hoverIntentRef.current.key === hoverKey &&
          Date.now() - hoverIntentRef.current.since >= SHOVE_HOVER_MS &&
          overlapCount > 0 &&
          canShove;
        const shouldShove = canShove && (isShiftPressed || hoverDwellShove);

        if (shouldShove) {
          if (shovePlan === null) {
            toast.error('Cannot shove tasks in this slot within workday hours.');
            setHoverPreview(null);
            logDropSample('shove_blocked');
            return;
          }
          moveTasksAtomic([
            ...shovePlan.map((move) => ({
              id: move.task.id,
              startDateTime: combineDayAndTime(
                day,
                minutesToTime(move.toStartMinutes)
              ).toISOString(),
            })),
            { id: item.id, startDateTime },
          ]);
          if (shovePlan.length > 0) {
            toast.success(`Shifted ${shovePlan.length} task${shovePlan.length === 1 ? '' : 's'}.`);
          }
          toast.success(`Task moved to ${startTime}.`);
          if (soundEffectsEnabled) {
            playCalendarSnapSound();
          }
          hoverIntentRef.current = { key: '', since: 0 };
          setShoveIntentActive(false);
          setHoverPreview(null);
          logDropSample('shove_applied', {
            movedTasks: shovePlan.length + 1,
            overlapCount,
          });
          return;
        }

        moveTask(item.id, startDateTime);
        if (overlapCount > 0) {
          toast.success(`Task stacked at ${startTime}.`);
        } else {
          toast.success(`Task moved to ${startTime}.`);
        }
        if (soundEffectsEnabled) {
          playCalendarSnapSound();
        }
        hoverIntentRef.current = { key: '', since: 0 };
        setShoveIntentActive(false);
        setHoverPreview(null);
        logDropSample(overlapCount > 0 ? 'stacked' : 'moved', {
          overlapCount,
        });
      },
      collect: (monitor) => ({
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop(),
      }),
    }),
    [
      tasks,
      scheduleScopeTasks,
      day,
      slotMinutes,
      timeSlots.length,
      getMinutesFromClientX,
      moveTask,
      moveTasksAtomic,
      workday,
      workStartMinutes,
      workdayMinutes,
      conflictedTaskIds,
      isShiftPressed,
      getPreviewLaneIndex,
      overlapsBlockedWindow,
      day,
      dayLockedByOther,
      dayPresenceLock,
      attemptTakeover,
      presenceLocks,
      user?.id,
    ]
  );

  drop(containerRef);

  const slotMeta = useMemo(
    () =>
      timeSlots.map((time, index) => {
        const slotStart = timeToMinutes(time);
        const slotEnd = slotStart + slotMinutes;
        const isOccupied = dayTasks.some((task) => {
          const interval = getTaskInterval(task);
          return interval.startMinutes < slotEnd && interval.endMinutes > slotStart;
        });
        return {
          index,
          time,
          isOccupied,
          isHourStart: index % slotsPerHour === 0,
          isHourEnd: (index + 1) % slotsPerHour === 0,
          isLastSlot: index === timeSlots.length - 1,
        };
      }),
    [dayTasks, slotMinutes, timeSlots, slotsPerHour]
  );

  const columns = useMemo(() => {
    const result: Array<
      | { type: 'slot'; time: string; isOccupied: boolean; isHourStart: boolean }
      | { type: 'gap'; key: string }
    > = [];

    slotMeta.forEach((slot) => {
      result.push({
        type: 'slot',
        time: slot.time,
        isOccupied: slot.isOccupied,
        isHourStart: slot.isHourStart,
      });

      if (slot.isHourEnd && !slot.isLastSlot) {
        result.push({ type: 'gap', key: `gap-${slot.time}` });
      }
    });

    return result;
  }, [slotMeta]);

  const gridTemplateColumns = useMemo(
    () => columns.map((col) => (col.type === 'gap' ? `${hourGap}px` : `${slotWidth}px`)).join(' '),
    [columns, hourGap, slotWidth]
  );

  useEffect(() => {
    if (!isOver) {
      hoverIntentRef.current = { key: '', since: 0 };
      setShoveIntentActive(false);
      setHoverPreview(null);
    }
  }, [isOver]);

  const showShovePreview = Boolean(hoverPreview && hoverPreview.shoveMoves.length > 0);
  const shovePreviewActive = shoveIntentActive || isShiftPressed;

  const handleExternalDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasExternalPayload(event.dataTransfer)) return;
    event.preventDefault();
    setExternalDragOver(true);
  }, []);

  const handleExternalDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setExternalDragOver(false);
  }, []);

  const handleExternalDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!hasExternalPayload(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      setExternalDragOver(false);

      const capture = parseExternalDrop(event.dataTransfer);
      if (!capture) {
        toast.error('Could not capture an email subject from that drop.');
        recordOperationalEvent({
          eventType: 'outlook.import.fail',
          source: 'external-drop',
          metadata: { surface: 'day-grid' },
        });
        return;
      }

      const cursorMinutes = getMinutesFromClientX(event.clientX, 'round');
      if (cursorMinutes === null) {
        toast.error('Could not determine drop time.');
        recordOperationalEvent({
          eventType: 'outlook.import.fail',
          source: 'external-drop',
          metadata: { surface: 'day-grid', reason: 'missing_time' },
        });
        return;
      }

      const durationMinutes = Math.min(normalizedDefaultDuration, workdayMinutes);
      const durationSlots = Math.ceil(durationMinutes / slotMinutes);
      const maxStartIndex = Math.max(0, timeSlots.length - durationSlots);
      const rawIndex = Math.round((cursorMinutes - workStartMinutes) / slotMinutes);
      const startIndex = Math.min(Math.max(rawIndex, 0), maxStartIndex);
      const startMinutes = workStartMinutes + startIndex * slotMinutes;
      const startDateTime = combineDayAndTime(day, minutesToTime(startMinutes)).toISOString();
      const assignedTo =
        defaultAssignee && defaultAssignee !== 'unassigned' && defaultAssignee !== 'all'
          ? defaultAssignee
          : undefined;

      const created = addTask({
        title: capture.title,
        description: capture.description ?? '',
        startDateTime,
        durationMinutes,
        subtasks: [],
        type: 'quick',
        assignedTo,
        completed: false,
        status: 'scheduled',
        executionStatus: 'idle',
        actualMinutes: 0,
        version: 0,
      });

      toast.success(`Captured email at ${minutesToTime(startMinutes)}.`);
      if (soundEffectsEnabled) {
        playCalendarSnapSound();
      }
      recordOperationalEvent({
        eventType: 'outlook.import.success',
        source: 'external-drop',
        metadata: { surface: 'day-grid' },
      });
      onEdit(created);
    },
    [
      addTask,
      day,
      defaultAssignee,
      getMinutesFromClientX,
      normalizedDefaultDuration,
      onEdit,
      soundEffectsEnabled,
      slotMinutes,
      timeSlots.length,
      workStartMinutes,
      workdayMinutes,
    ]
  );

  const laneLayout = useMemo(() => {
    const sortedTasks = [...dayTasks].sort(
      (a, b) => getTaskInterval(a).startMinutes - getTaskInterval(b).startMinutes
    );
    const layoutById = new Map<string, number>();
    const stackedById = new Map<string, boolean>();
    let laneCount = 1;

    const overlapGroups: Task[][] = [];
    let currentGroup: Task[] = [];
    let currentGroupEnd = Number.NEGATIVE_INFINITY;

    sortedTasks.forEach((task) => {
      const interval = getTaskInterval(task);
      if (currentGroup.length === 0) {
        currentGroup.push(task);
        currentGroupEnd = interval.endMinutes;
        return;
      }

      if (interval.startMinutes < currentGroupEnd) {
        currentGroup.push(task);
        currentGroupEnd = Math.max(currentGroupEnd, interval.endMinutes);
        return;
      }

      overlapGroups.push(currentGroup);
      currentGroup = [task];
      currentGroupEnd = interval.endMinutes;
    });

    if (currentGroup.length > 0) {
      overlapGroups.push(currentGroup);
    }

    overlapGroups.forEach((group) => {
      const laneEnds: number[] = [];
      const isStackedGroup = group.length > 1;

      group.forEach((task) => {
        const interval = getTaskInterval(task);
        let laneIndex = laneEnds.findIndex((end) => interval.startMinutes >= end);

        if (laneIndex === -1) {
          laneIndex = laneEnds.length;
          laneEnds.push(interval.endMinutes);
        } else {
          laneEnds[laneIndex] = interval.endMinutes;
        }

        layoutById.set(task.id, laneIndex);
        stackedById.set(task.id, isStackedGroup);
      });

      laneCount = Math.max(laneCount, laneEnds.length);
    });

    const laneTrackHeight = laneMinHeight + laneStaggerOffset;

    return {
      tasks: sortedTasks,
      layoutById,
      stackedById,
      laneCount: Math.max(1, laneCount),
      laneTrackHeight,
    };
  }, [dayTasks, laneMinHeight, laneStaggerOffset]);

  const nowIndicatorX = useMemo(() => {
    if (!isTodayColumn) return null;

    const now = new Date(nowTimestamp);
    const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    if (nowMinutes < workStartMinutes || nowMinutes > workEndMinutes) return null;

    const offsetMinutes = nowMinutes - workStartMinutes;
    const offsetRatio = offsetMinutes / 60;
    const completedHours = Math.min(Math.floor(offsetMinutes / 60), Math.max(0, hourSpanCount - 1));
    return offsetRatio * hourWidth + completedHours * hourGap;
  }, [
    hourGap,
    hourSpanCount,
    hourWidth,
    isTodayColumn,
    nowTimestamp,
    workEndMinutes,
    workStartMinutes,
  ]);

  useEffect(() => {
    if (!deterministicDndMode || typeof window === 'undefined') {
      return undefined;
    }

    type HookDropArgs = {
      taskId: string;
      day: string;
      startTime: string;
      shove?: boolean;
    };
    type HookResizeArgs = {
      taskId: string;
      day: string;
      startTime?: string;
      durationMinutes: number;
    };
    type HookStore = {
      dropHandlers: Record<string, (args: HookDropArgs) => boolean>;
      resizeHandlers: Record<string, (args: HookResizeArgs) => boolean>;
      dropTask: (args: HookDropArgs) => boolean;
      resizeTask: (args: HookResizeArgs) => boolean;
    };

    const host = window as unknown as {
      __TASKABLE_DND_HOOKS__?: HookStore;
    };
    const hooks = host.__TASKABLE_DND_HOOKS__ ?? {
      dropHandlers: {},
      resizeHandlers: {},
      dropTask: (_args: HookDropArgs) => false,
      resizeTask: (_args: HookResizeArgs) => false,
    };

    hooks.dropTask = (args) => {
      const handler = hooks.dropHandlers[args.day];
      return handler ? handler(args) : false;
    };
    hooks.resizeTask = (args) => {
      const handler = hooks.resizeHandlers[args.day];
      return handler ? handler(args) : false;
    };

    hooks.dropHandlers[day] = (args) => {
      if (args.day !== day) return false;

      const draggedTask = tasks.find((task) => task.id === args.taskId);
      if (!draggedTask) return false;
      if (conflictedTaskIds.has(draggedTask.id)) return false;

      const startMinutes = timeToMinutes(args.startTime);
      const durationMinutes = draggedTask.durationMinutes;
      if (durationMinutes > workdayMinutes) return false;
      const blockedWindow =
        draggedTask.type !== 'block' &&
        overlapsBlockedWindow(startMinutes, durationMinutes, draggedTask.id);
      if (blockedWindow) {
        const nextSlot = findNextAvailableSlotAfter(
          scheduleScopeTasks,
          day,
          durationMinutes,
          startMinutes + slotMinutes,
          draggedTask.id,
          workday
        );
        if (!nextSlot) return false;
        moveTask(args.taskId, combineDayAndTime(day, nextSlot.startTime).toISOString());
        if (soundEffectsEnabled) {
          playCalendarSnapSound();
        }
        return true;
      }

      const shovePlan = buildForwardShovePlan(
        scheduleScopeTasks,
        day,
        startMinutes,
        durationMinutes,
        draggedTask.id,
        workday,
        slotMinutes
      );
      const shouldShove = Boolean(args.shove);

      if (shouldShove) {
        if (shovePlan === null) return false;
        moveTasksAtomic([
          ...shovePlan.map((move) => ({
            id: move.task.id,
            startDateTime: combineDayAndTime(day, minutesToTime(move.toStartMinutes)).toISOString(),
          })),
          { id: args.taskId, startDateTime: combineDayAndTime(day, args.startTime).toISOString() },
        ]);
        if (soundEffectsEnabled) {
          playCalendarSnapSound();
        }
        return true;
      }

      moveTask(args.taskId, combineDayAndTime(day, args.startTime).toISOString());
      if (soundEffectsEnabled) {
        playCalendarSnapSound();
      }
      return true;
    };

    hooks.resizeHandlers[day] = (args) => {
      if (args.day !== day) return false;

      const targetTask = tasks.find((task) => task.id === args.taskId);
      if (!targetTask || !targetTask.startDateTime) return false;
      if (conflictedTaskIds.has(targetTask.id)) return false;

      const interval = getTaskInterval(targetTask);
      const nextStartMinutes = args.startTime
        ? timeToMinutes(args.startTime)
        : interval.startMinutes;
      const maxDuration = workEndMinutes - nextStartMinutes;
      const clampedDuration = Math.max(slotMinutes, Math.min(args.durationMinutes, maxDuration));
      if (clampedDuration <= 0) return false;

      updateTask(args.taskId, {
        startDateTime: combineDayAndTime(day, minutesToTime(nextStartMinutes)).toISOString(),
        durationMinutes: clampedDuration,
      });
      if (soundEffectsEnabled) {
        playCalendarSnapSound();
      }
      return true;
    };

    host.__TASKABLE_DND_HOOKS__ = hooks;

    return () => {
      if (!host.__TASKABLE_DND_HOOKS__) return;
      delete host.__TASKABLE_DND_HOOKS__.dropHandlers[day];
      delete host.__TASKABLE_DND_HOOKS__.resizeHandlers[day];
    };
  }, [
    day,
    deterministicDndMode,
    moveTask,
    moveTasksAtomic,
    overlapsBlockedWindow,
    conflictedTaskIds,
    scheduleScopeTasks,
    slotMinutes,
    tasks,
    updateTask,
    workEndMinutes,
    workday,
    workdayMinutes,
    soundEffectsEnabled,
  ]);

  return (
    <div
      className="relative"
      ref={containerRef}
      data-testid={`day-column-${day}`}
      onDragOver={handleExternalDragOver}
      onDragLeave={handleExternalDragLeave}
      onDrop={handleExternalDrop}
      style={{
        width: `${gridWidth}px`,
        minHeight: `${laneLayout.laneTrackHeight + rowPadding * 2}px`,
      }}
    >
      {dayPresenceLock && (
        <div className="pointer-events-none absolute left-3 top-2 z-[7]">
          <div
            className="rounded-full px-2 py-1 text-[10px] font-semibold"
            style={{
              backgroundColor: dayLockedByOther
                ? 'var(--hud-accent-soft)'
                : 'var(--hud-surface-strong)',
              color: dayLockedByOther ? 'var(--hud-accent-soft-text)' : 'var(--hud-text)',
            }}
          >
            {dayLockedByOther ? `${dayPresenceLock.userName} scheduling` : 'You are scheduling'}
          </div>
        </div>
      )}

      <div className="absolute inset-0 flex pointer-events-none" aria-hidden="true">
        {columns.map((col, index) => {
          if (col.type === 'gap') {
            return (
              <div key={col.key} style={{ width: `${hourGap}px` }} className="bg-transparent" />
            );
          }

          return (
            <div
              key={`${col.time}-${index}`}
              className={`relative h-full ${
                col.isHourStart ? 'border-l border-[color:var(--board-line)]' : ''
              }`}
              style={{ width: `${slotWidth}px` }}
            />
          );
        })}
      </div>

      {deterministicDndMode && (
        <div className="pointer-events-none absolute inset-0 z-[1]" aria-hidden="true">
          {slotMeta.map((slot) => {
            const left = slot.index * slotWidth + Math.floor(slot.index / slotsPerHour) * hourGap;
            const timeKey = slot.time.replace(':', '');
            return (
              <div
                key={`dnd-slot-hook-${slot.time}`}
                data-testid={`dnd-slot-${day}-${timeKey}`}
                data-slot-time={slot.time}
                className="pointer-events-auto absolute bottom-0 top-0"
                style={{ left: `${left}px`, width: `${slotWidth}px` }}
              />
            );
          })}
        </div>
      )}

      <div
        className="relative grid"
        style={{
          gridTemplateColumns,
          gridAutoRows: `minmax(${laneLayout.laneTrackHeight}px, auto)`,
          rowGap: `${laneGap}px`,
          padding: `${rowPadding}px 0`,
        }}
      >
        {showShovePreview &&
          hoverPreview?.shoveMoves.map((move, index) => {
            const { startCol, endCol, visibleWidth, leftInset, rightInset } = getPlacement(
              move.toStartMinutes,
              move.task.durationMinutes
            );
            return (
              <div
                key={`shove-preview-${move.task.id}-${index}`}
                className="pointer-events-none ui-v1-radius-md border-2 border-dashed bg-transparent"
                style={{
                  gridColumn: `${startCol} / ${endCol}`,
                  gridRow: `${(laneLayout.layoutById.get(move.task.id) ?? 0) + 1}`,
                  minHeight: `${laneMinHeight}px`,
                  width: `${visibleWidth}px`,
                  justifySelf: 'start',
                  marginLeft: `${leftInset}px`,
                  marginRight: `${rightInset}px`,
                  zIndex: 3,
                  borderColor: shovePreviewActive ? 'var(--hud-outline)' : 'var(--hud-border)',
                }}
              />
            );
          })}

        {hoverPreview &&
          (() => {
            const { startCol, endCol, visibleWidth, leftInset, rightInset } = getPlacement(
              hoverPreview.startMinutes,
              hoverPreview.durationMinutes
            );

            return (
              <div
                className="pointer-events-none ui-v1-radius-md border-2 border-dashed bg-transparent"
                style={{
                  gridColumn: `${startCol} / ${endCol}`,
                  gridRow: `${hoverPreview.laneIndex + 1}`,
                  minHeight: `${laneMinHeight}px`,
                  width: `${visibleWidth}px`,
                  justifySelf: 'start',
                  marginLeft: `${leftInset}px`,
                  marginRight: `${rightInset}px`,
                  zIndex: 4,
                  borderColor: 'var(--hud-outline)',
                }}
              />
            );
          })()}

        {showQuickAdd &&
          slotMeta
            .filter((slot) => slot.isHourStart)
            .map((slot) => {
              const hourEndSlotIndex = Math.min(slot.index + slotsPerHour, timeSlots.length);
              const startGapCount = Math.floor(slot.index / slotsPerHour);
              const endGapCount = Math.floor((hourEndSlotIndex - 1) / slotsPerHour);
              const startCol = slot.index + startGapCount + 1;
              const endCol = hourEndSlotIndex + endGapCount + 1;
              return (
                <div
                  key={`quick-${slot.time}`}
                  className="flex h-full w-full items-center justify-center"
                  style={{
                    gridColumn: `${startCol} / ${endCol}`,
                    gridRow: '1 / -1',
                    zIndex: 1,
                  }}
                >
                  <QuickAddButton
                    day={day}
                    time={slot.time}
                    defaultAssignee={defaultAssignee}
                    scheduleTasks={scheduleScopeTasks}
                  />
                </div>
              );
            })}

        {laneLayout.tasks.map((task) => {
          const interval = getTaskInterval(task);
          const { startCol, endCol, visibleWidth, leftInset, rightInset } = getPlacement(
            interval.startMinutes,
            task.durationMinutes
          );
          const isBlockTask = task.type === 'block';
          const blockSpanHeight =
            laneLayout.laneCount > 1
              ? laneLayout.laneCount * laneLayout.laneTrackHeight +
                (laneLayout.laneCount - 1) * laneGap
              : laneMinHeight;
          const laneIndex = laneLayout.layoutById.get(task.id) ?? 0;
          const startSlotIndex = Math.max(
            0,
            Math.round((interval.startMinutes - workStartMinutes) / slotMinutes)
          );
          const hourBandIndex = Math.floor(startSlotIndex / slotsPerHour);
          const staggerOffsetPx =
            (hourBandIndex + laneIndex) % 2 === 1 ? laneStaggerOffset : 0;

          return (
            <TaskCard
              key={task.id}
              task={task}
              onEdit={onEdit}
              onOpenQuickActions={onOpenQuickActions}
              blockHeight={laneMinHeight}
              blockWidth={visibleWidth}
              slotMinutes={slotMinutes}
              getMinutesFromClientX={getMinutesFromClientX}
              blockStyle={{
                gridColumn: `${startCol} / ${endCol}`,
                gridRow: isBlockTask
                  ? `1 / ${Math.max(2, laneLayout.laneCount + 1)}`
                  : `${laneIndex + 1}`,
                height: isBlockTask ? `${blockSpanHeight}px` : `${laneMinHeight}px`,
                minHeight: isBlockTask ? `${blockSpanHeight}px` : `${laneMinHeight}px`,
                marginLeft: `${leftInset}px`,
                marginRight: `${rightInset}px`,
                position: 'relative',
                top: `${staggerOffsetPx}px`,
                zIndex: isBlockTask ? 8 : 2,
              }}
            />
          );
        })}
      </div>

      {hoverPreview?.canShove && (
        <div className="ui-hud-shell pointer-events-none absolute right-3 top-3 rounded-md px-2 py-1 text-[11px] font-semibold">
          {shoveIntentActive || isShiftPressed
            ? 'Release to shove'
            : 'Drop to stack, hold to shove'}
        </div>
      )}

      {(isOver && canDrop) || externalDragOver ? (
        <div
          className="pointer-events-none absolute inset-1 ui-v1-radius-xl border-2 border-dashed"
          style={{ borderColor: 'var(--hud-outline)' }}
        />
      ) : null}

      {nowIndicatorX !== null && (
        <div
          data-testid="timeline-now-indicator"
          className="pointer-events-none absolute inset-y-0 z-[6]"
          style={{ left: `${nowIndicatorX}px` }}
          aria-hidden="true"
        >
          <div
            className="absolute inset-y-0 w-[2px] -translate-x-1/2"
            style={{
              background: 'var(--timeline-now)',
              boxShadow: '0 0 0 1px var(--timeline-now-glow)',
            }}
          />
          <div
            className="absolute top-2 size-2.5 -translate-x-1/2 rounded-full"
            style={{
              background: 'var(--timeline-now)',
              boxShadow: '0 0 0 2px var(--timeline-now-glow)',
            }}
          />
        </div>
      )}
    </div>
  );
}
