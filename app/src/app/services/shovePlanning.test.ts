import { describe, expect, it } from 'vitest';
import type { Task } from '../context/TaskContext';
import { buildForwardShovePlan, countOverlapsAtTarget, snapUpToSlot } from './shovePlanning';

const DAY = '2026-02-18';

function makeTask(id: string, startDateTime: string, durationMinutes: number): Task {
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
  };
}

describe('shove planning', () => {
  it('counts overlaps while excluding inbox and the dragged task', () => {
    const tasks: Task[] = [
      makeTask('a', '2026-02-18T09:00:00', 60),
      makeTask('b', '2026-02-18T09:30:00', 30),
      { ...makeTask('c', '2026-02-18T09:30:00', 30), status: 'inbox' },
    ];

    const overlaps = countOverlapsAtTarget(tasks, DAY, 9 * 60, 60, 'a');
    expect(overlaps).toBe(1);
  });

  it('builds a forward shove chain and snaps to slot boundaries', () => {
    const tasks: Task[] = [
      makeTask('a', '2026-02-18T09:00:00', 60),
      makeTask('b', '2026-02-18T10:00:00', 60),
      makeTask('c', '2026-02-18T12:00:00', 60),
    ];

    const plan = buildForwardShovePlan(
      tasks,
      DAY,
      9 * 60 + 30,
      60,
      'dragging',
      { startHour: 8, endHour: 16 },
      15
    );

    expect(plan).not.toBeNull();
    expect(plan).toHaveLength(3);
    expect(plan?.[0].task.id).toBe('a');
    expect(plan?.[0].toStartMinutes).toBe(10 * 60 + 30);
    expect(plan?.[1].task.id).toBe('b');
    expect(plan?.[1].toStartMinutes).toBe(11 * 60 + 30);
    expect(plan?.[2].task.id).toBe('c');
    expect(plan?.[2].toStartMinutes).toBe(12 * 60 + 30);
  });

  it('returns null when shove would exceed workday end', () => {
    const tasks: Task[] = [makeTask('a', '2026-02-18T15:00:00', 60)];

    const plan = buildForwardShovePlan(
      tasks,
      DAY,
      15 * 60,
      60,
      'dragging',
      { startHour: 8, endHour: 16 },
      15
    );

    expect(plan).toBeNull();
  });

  it('snaps up to the next slot', () => {
    const snapped = snapUpToSlot(10 * 60 + 7, 15, 8 * 60);
    expect(snapped).toBe(10 * 60 + 15);
  });
});
