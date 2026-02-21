import { describe, expect, it } from 'vitest';
import type { Task } from '../context/TaskContext';
import {
  DEFAULT_WORKDAY,
  findNextAvailableSlot,
  findNextAvailableSlotAfter,
  getRemainingCapacityMinutes,
  hasConflict,
} from './scheduling';

const DAY = '2026-02-18';

function makeTask(
  id: string,
  startDateTime: string,
  durationMinutes: number,
  overrides: Partial<Task> = {}
): Task {
  return {
    id,
    title: id,
    description: '',
    startDateTime,
    durationMinutes,
    timeZone: 'UTC',
    completed: false,
    color: '#e63f97',
    subtasks: [],
    type: 'quick',
    status: 'scheduled',
    ...overrides,
  };
}

describe('scheduling service', () => {
  it('detects overlap conflicts on the same day', () => {
    const tasks: Task[] = [
      makeTask('t1', '2026-02-18T09:00:00', 60),
      makeTask('t2', '2026-02-18T11:00:00', 30),
    ];

    expect(hasConflict(tasks, DAY, '09:30', 30, undefined, DEFAULT_WORKDAY)).toBe(true);
    expect(hasConflict(tasks, DAY, '10:00', 30, undefined, DEFAULT_WORKDAY)).toBe(false);
  });

  it('rejects tasks that exceed workday boundaries', () => {
    const tasks: Task[] = [];

    expect(hasConflict(tasks, DAY, '07:45', 30, undefined, DEFAULT_WORKDAY)).toBe(true);
    expect(hasConflict(tasks, DAY, '17:30', 60, undefined, DEFAULT_WORKDAY)).toBe(true);
    expect(hasConflict(tasks, DAY, '08:00', 60, undefined, DEFAULT_WORKDAY)).toBe(false);
  });

  it('calculates remaining capacity with merged intervals', () => {
    const tasks: Task[] = [
      makeTask('t1', '2026-02-18T08:00:00', 60),
      makeTask('t2', '2026-02-18T09:00:00', 30),
      makeTask('t3', '2026-02-18T12:00:00', 120),
    ];

    const remaining = getRemainingCapacityMinutes(tasks, DAY, undefined, DEFAULT_WORKDAY);

    // Workday is 10h (08:00-18:00 = 600 minutes), occupied = 60 + 30 + 120 = 210.
    expect(remaining).toBe(390);
  });

  it('finds the first available slot and handles cannot-fit scenarios', () => {
    const tasks: Task[] = [
      makeTask('t1', '2026-02-18T08:00:00', 120),
      makeTask('t2', '2026-02-18T11:00:00', 60),
      makeTask('t3', '2026-02-18T13:00:00', 300),
    ];

    const slot = findNextAvailableSlot(tasks, DAY, 60, undefined, DEFAULT_WORKDAY);
    expect(slot).toEqual({ startTime: '10:00', endTime: '11:00' });

    const cannotFit = findNextAvailableSlot(tasks, DAY, 121, undefined, DEFAULT_WORKDAY);
    expect(cannotFit).toBeNull();
  });

  it('finds the next slot after a specific minute cursor', () => {
    const tasks: Task[] = [
      makeTask('t1', '2026-02-18T09:00:00', 90),
      makeTask('t2', '2026-02-18T12:00:00', 60),
    ];

    const slot = findNextAvailableSlotAfter(tasks, DAY, 60, 10 * 60, undefined, DEFAULT_WORKDAY);
    expect(slot).toEqual({ startTime: '10:30', endTime: '11:30' });

    const endOfDay = findNextAvailableSlotAfter(
      tasks,
      DAY,
      120,
      17 * 60,
      undefined,
      DEFAULT_WORKDAY
    );
    expect(endOfDay).toBeNull();
  });
});
