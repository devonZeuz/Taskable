import type { Task } from '../context/TaskContext';
import {
  combineDayAndTime,
  findNextAvailableSlot,
  findNextAvailableSlotAfter,
  getDateFromDayKey,
  getDayKey,
  getDayKeyFromDateTime,
  getTaskInterval,
  minutesToTime,
  type WorkdayHours,
} from './scheduling';

const BLOCK_SHIFT_SEARCH_DAYS = 14;

export interface BlockShiftMove {
  task: Task;
  fromDayKey: string;
  fromStartMinutes: number;
  toDayKey: string;
  toStartMinutes: number;
  startDateTime: string;
}

export interface BlockShiftPlan {
  moves: BlockShiftMove[];
  overlappingTasks: Task[];
}

function cloneSchedule(tasks: Task[]): Task[] {
  return tasks.map((task) => ({
    ...task,
    subtasks: task.subtasks.map((subtask) => ({ ...subtask })),
  }));
}

function getNextDayKey(dayKey: string): string {
  const next = getDateFromDayKey(dayKey);
  next.setDate(next.getDate() + 1);
  return getDayKey(next);
}

export function buildBlockShiftPlan(
  tasks: Task[],
  dayKey: string,
  blockStartMinutes: number,
  blockDurationMinutes: number,
  excludeBlockTaskId: string | undefined,
  workday: WorkdayHours
): BlockShiftPlan | null {
  const blockEndMinutes = blockStartMinutes + blockDurationMinutes;
  const scheduleShadow = cloneSchedule(tasks).filter((task) => task.id !== excludeBlockTaskId);

  const overlappingBlock = scheduleShadow.some((task) => {
    if (!task.startDateTime || task.status === 'inbox' || task.type !== 'block') return false;
    if (getDayKeyFromDateTime(task.startDateTime) !== dayKey) return false;
    const interval = getTaskInterval(task);
    return blockStartMinutes < interval.endMinutes && blockEndMinutes > interval.startMinutes;
  });

  if (overlappingBlock) {
    return null;
  }

  scheduleShadow.push({
    id: excludeBlockTaskId ?? '__block-shift-shadow__',
    title: 'Block',
    description: '',
    startDateTime: combineDayAndTime(dayKey, minutesToTime(blockStartMinutes)).toISOString(),
    durationMinutes: blockDurationMinutes,
    color: '#111111',
    subtasks: [],
    type: 'block',
    completed: false,
    status: 'scheduled',
    executionStatus: 'idle',
    actualMinutes: 0,
    version: 0,
  });

  const overlappingTasks = scheduleShadow
    .filter((task) => {
      if (!task.startDateTime || task.status === 'inbox' || task.type === 'block') return false;
      if (getDayKeyFromDateTime(task.startDateTime) !== dayKey) return false;
      const interval = getTaskInterval(task);
      return blockStartMinutes < interval.endMinutes && blockEndMinutes > interval.startMinutes;
    })
    .sort((left, right) => {
      if (!left.startDateTime || !right.startDateTime) return 0;
      return left.startDateTime.localeCompare(right.startDateTime);
    });

  const moves: BlockShiftMove[] = [];

  for (const task of overlappingTasks) {
    const shadowTask = scheduleShadow.find((entry) => entry.id === task.id);
    if (!shadowTask || !task.startDateTime) {
      continue;
    }

    const originalInterval = getTaskInterval(task);
    shadowTask.startDateTime = undefined;
    shadowTask.status = 'inbox';

    let searchDayKey = dayKey;
    let slot =
      findNextAvailableSlotAfter(
        scheduleShadow,
        searchDayKey,
        task.durationMinutes,
        blockEndMinutes,
        task.id,
        workday
      ) ?? null;

    let dayOffset = 0;
    while (!slot && dayOffset < BLOCK_SHIFT_SEARCH_DAYS) {
      searchDayKey = getNextDayKey(searchDayKey);
      dayOffset += 1;
      slot = findNextAvailableSlot(
        scheduleShadow,
        searchDayKey,
        task.durationMinutes,
        task.id,
        workday
      );
    }

    if (!slot) {
      return null;
    }

    const startDateTime = combineDayAndTime(searchDayKey, slot.startTime).toISOString();
    shadowTask.startDateTime = startDateTime;
    shadowTask.status = 'scheduled';

    moves.push({
      task,
      fromDayKey: dayKey,
      fromStartMinutes: originalInterval.startMinutes,
      toDayKey: searchDayKey,
      toStartMinutes: getTaskInterval({ startDateTime, durationMinutes: task.durationMinutes })
        .startMinutes,
      startDateTime,
    });
  }

  return {
    moves,
    overlappingTasks,
  };
}
