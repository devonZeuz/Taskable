import { Task } from '../context/TaskContext';

export interface WorkdayHours {
  startHour: number;
  endHour: number;
}

export const DEFAULT_WORK_START_HOUR = 8;
export const DEFAULT_WORK_END_HOUR = 18;
export const DEFAULT_WORKDAY: WorkdayHours = {
  startHour: DEFAULT_WORK_START_HOUR,
  endHour: DEFAULT_WORK_END_HOUR,
};

export function getWorkdayMinutes(workday: WorkdayHours = DEFAULT_WORKDAY): number {
  return Math.max(0, (workday.endHour - workday.startHour) * 60);
}

export interface ScheduleInterval {
  startMinutes: number;
  endMinutes: number;
}

export interface SlotSuggestion {
  startTime: string;
  endTime: string;
}

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(minutes: number): string {
  const safeMinutes = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export function getWorkdayHours(workday: WorkdayHours = DEFAULT_WORKDAY): string[] {
  return getWorkdayTimeSlots(60, workday);
}

export function getWorkdayTimeSlots(
  slotMinutes: number,
  workday: WorkdayHours = DEFAULT_WORKDAY
): string[] {
  const slots: string[] = [];
  const startMinutes = workday.startHour * 60;
  const endMinutes = workday.endHour * 60;

  for (let minutes = startMinutes; minutes < endMinutes; minutes += slotMinutes) {
    slots.push(minutesToTime(minutes));
  }

  return slots;
}

export function getDayKey(date: Date): string {
  return date.toLocaleDateString('en-CA');
}

export function getDayKeyFromDateTime(startDateTime?: string): string {
  if (!startDateTime) return '';
  return getDayKey(new Date(startDateTime));
}

export function getDateFromDayKey(dayKey: string): Date {
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function combineDayAndTime(dayKey: string, time: string): Date {
  const date = getDateFromDayKey(dayKey);
  const [hours, minutes] = time.split(':').map(Number);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

export function getTaskInterval(task: {
  startDateTime?: string;
  durationMinutes: number;
}): ScheduleInterval {
  if (!task.startDateTime) {
    return { startMinutes: 0, endMinutes: task.durationMinutes };
  }
  const date = new Date(task.startDateTime);
  const startMinutes = date.getHours() * 60 + date.getMinutes();
  return { startMinutes, endMinutes: startMinutes + task.durationMinutes };
}

export function getDayIntervals(
  tasks: Task[],
  dayKey: string,
  excludeTaskId?: string
): ScheduleInterval[] {
  return tasks
    .filter(
      (task) =>
        task.startDateTime &&
        getDayKeyFromDateTime(task.startDateTime) === dayKey &&
        task.id !== excludeTaskId
    )
    .map((task) => getTaskInterval(task))
    .sort((a, b) => a.startMinutes - b.startMinutes);
}

export function mergeIntervals(intervals: ScheduleInterval[]): ScheduleInterval[] {
  if (intervals.length === 0) return [];

  const sorted = [...intervals].sort((a, b) => a.startMinutes - b.startMinutes);
  const merged: ScheduleInterval[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    if (current.startMinutes <= last.endMinutes) {
      last.endMinutes = Math.max(last.endMinutes, current.endMinutes);
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

export function hasConflict(
  tasks: Task[],
  dayKey: string,
  startTime: string,
  durationMinutes: number,
  excludeTaskId?: string,
  workday: WorkdayHours = DEFAULT_WORKDAY
): boolean {
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = startMinutes + durationMinutes;

  if (durationMinutes <= 0) return true;
  if (startMinutes < workday.startHour * 60 || endMinutes > workday.endHour * 60) {
    return true;
  }

  const dayIntervals = getDayIntervals(tasks, dayKey, excludeTaskId);
  return dayIntervals.some(
    (interval) => startMinutes < interval.endMinutes && endMinutes > interval.startMinutes
  );
}

export function getRemainingCapacityMinutes(
  tasks: Task[],
  dayKey: string,
  excludeTaskId?: string,
  workday: WorkdayHours = DEFAULT_WORKDAY
): number {
  const intervals = mergeIntervals(getDayIntervals(tasks, dayKey, excludeTaskId));
  const workStart = workday.startHour * 60;
  const workEnd = workday.endHour * 60;

  const occupiedMinutes = intervals.reduce((total, interval) => {
    const start = Math.max(interval.startMinutes, workStart);
    const end = Math.min(interval.endMinutes, workEnd);
    if (end <= start) return total;
    return total + (end - start);
  }, 0);

  return Math.max(0, getWorkdayMinutes(workday) - occupiedMinutes);
}

export function findNextAvailableSlot(
  tasks: Task[],
  dayKey: string,
  durationMinutes: number,
  excludeTaskId?: string,
  workday: WorkdayHours = DEFAULT_WORKDAY
): SlotSuggestion | null {
  if (durationMinutes <= 0 || durationMinutes > getWorkdayMinutes(workday)) {
    return null;
  }

  const workStart = workday.startHour * 60;
  const workEnd = workday.endHour * 60;
  const intervals = mergeIntervals(getDayIntervals(tasks, dayKey, excludeTaskId));

  let cursor = workStart;

  for (const interval of intervals) {
    const intervalStart = Math.max(interval.startMinutes, workStart);
    const intervalEnd = Math.min(interval.endMinutes, workEnd);

    if (intervalStart - cursor >= durationMinutes) {
      return {
        startTime: minutesToTime(cursor),
        endTime: minutesToTime(cursor + durationMinutes),
      };
    }

    cursor = Math.max(cursor, intervalEnd);
  }

  if (workEnd - cursor >= durationMinutes) {
    return {
      startTime: minutesToTime(cursor),
      endTime: minutesToTime(cursor + durationMinutes),
    };
  }

  return null;
}

export function findNextAvailableSlotAfter(
  tasks: Task[],
  dayKey: string,
  durationMinutes: number,
  startMinutes: number,
  excludeTaskId?: string,
  workday: WorkdayHours = DEFAULT_WORKDAY
): SlotSuggestion | null {
  if (durationMinutes <= 0 || durationMinutes > getWorkdayMinutes(workday)) {
    return null;
  }

  const workStart = workday.startHour * 60;
  const workEnd = workday.endHour * 60;
  let cursor = Math.max(startMinutes, workStart);

  if (cursor + durationMinutes > workEnd) {
    return null;
  }

  const intervals = mergeIntervals(getDayIntervals(tasks, dayKey, excludeTaskId));

  for (const interval of intervals) {
    const intervalStart = Math.max(interval.startMinutes, workStart);
    const intervalEnd = Math.min(interval.endMinutes, workEnd);

    if (intervalEnd <= cursor) {
      continue;
    }

    if (intervalStart - cursor >= durationMinutes) {
      return {
        startTime: minutesToTime(cursor),
        endTime: minutesToTime(cursor + durationMinutes),
      };
    }

    cursor = Math.max(cursor, intervalEnd);

    if (cursor + durationMinutes > workEnd) {
      return null;
    }
  }

  if (workEnd - cursor >= durationMinutes) {
    return {
      startTime: minutesToTime(cursor),
      endTime: minutesToTime(cursor + durationMinutes),
    };
  }

  return null;
}
