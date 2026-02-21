import { Task } from '../context/TaskContext';
import { getDayKeyFromDateTime, getTaskInterval } from './scheduling';

export interface ShoveMove {
  task: Task;
  fromStartMinutes: number;
  toStartMinutes: number;
}

export function countOverlapsAtTarget(
  tasks: Task[],
  day: string,
  startMinutes: number,
  durationMinutes: number,
  excludeTaskId: string
): number {
  const endMinutes = startMinutes + durationMinutes;
  return tasks.filter((task) => {
    if (task.id === excludeTaskId) return false;
    if (!task.startDateTime || task.status === 'inbox') return false;
    if (getDayKeyFromDateTime(task.startDateTime) !== day) return false;
    const interval = getTaskInterval(task);
    return startMinutes < interval.endMinutes && endMinutes > interval.startMinutes;
  }).length;
}

export function buildForwardShovePlan(
  tasks: Task[],
  day: string,
  startMinutes: number,
  durationMinutes: number,
  excludeTaskId: string,
  workday: { startHour: number; endHour: number },
  slotMinutes: number
): ShoveMove[] | null {
  const workStart = workday.startHour * 60;
  const workEnd = workday.endHour * 60;
  const dropEnd = startMinutes + durationMinutes;
  if (startMinutes < workStart || dropEnd > workEnd) return null;

  const dayTasks = tasks
    .filter((task) => {
      if (task.id === excludeTaskId) return false;
      if (!task.startDateTime || task.status === 'inbox') return false;
      return getDayKeyFromDateTime(task.startDateTime) === day;
    })
    .map((task) => {
      const interval = getTaskInterval(task);
      return { task, interval };
    })
    .sort((a, b) => a.interval.startMinutes - b.interval.startMinutes);

  const moves: ShoveMove[] = [];
  let chainEnd = dropEnd;
  let chainStarted = false;

  for (const entry of dayTasks) {
    const currentStart = entry.interval.startMinutes;
    const currentEnd = entry.interval.endMinutes;
    if (currentEnd <= startMinutes) continue;

    if (currentStart >= chainEnd) {
      if (chainStarted) break;
      continue;
    }

    chainStarted = true;
    const snappedStart = snapUpToSlot(chainEnd, slotMinutes, workStart);
    const snappedEnd = snappedStart + entry.task.durationMinutes;
    if (snappedEnd > workEnd) return null;

    if (snappedStart !== currentStart) {
      moves.push({
        task: entry.task,
        fromStartMinutes: currentStart,
        toStartMinutes: snappedStart,
      });
    }

    chainEnd = snappedEnd;
  }

  return moves;
}

export function snapUpToSlot(minutes: number, slotMinutes: number, baseMinutes: number): number {
  const offset = minutes - baseMinutes;
  const snappedOffset = Math.ceil(offset / slotMinutes) * slotMinutes;
  return baseMinutes + snappedOffset;
}
