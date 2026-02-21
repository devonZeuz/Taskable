import { describe, expect, it, vi } from 'vitest';
import type { Task } from '../context/TaskContext';
import { applyAdaptiveExtendPlan, buildAdaptiveExtendPlan } from './adaptiveScheduling';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? 'task-1',
    title: overrides.title ?? 'Task',
    description: overrides.description ?? '',
    startDateTime: overrides.startDateTime,
    durationMinutes: overrides.durationMinutes ?? 60,
    timeZone: overrides.timeZone ?? 'UTC',
    completed: overrides.completed ?? false,
    color: overrides.color ?? '#e63f97',
    subtasks: overrides.subtasks ?? [],
    type: overrides.type ?? 'quick',
    assignedTo: overrides.assignedTo,
    status: overrides.status ?? (overrides.startDateTime ? 'scheduled' : 'inbox'),
    focus: overrides.focus ?? false,
    executionStatus: overrides.executionStatus ?? 'idle',
    actualMinutes: overrides.actualMinutes ?? 0,
    version: overrides.version ?? 1,
  };
}

const WORKDAY = { startHour: 8, endHour: 16 };

describe('adaptiveScheduling', () => {
  it('returns unscheduled when task has no planned start', () => {
    const task = makeTask({ id: 't1', startDateTime: undefined, status: 'inbox' });
    const plan = buildAdaptiveExtendPlan(
      [],
      task,
      Date.parse('2026-02-19T10:00:00.000Z'),
      15,
      WORKDAY
    );

    expect(plan.reason).toBe('unscheduled');
    expect(plan.nextDurationMinutes).toBe(task.durationMinutes);
  });

  it('detects conflict and applies shove when enabled', () => {
    const task = makeTask({
      id: 't1',
      startDateTime: '2026-02-19T09:00:00.000Z',
      durationMinutes: 60,
    });
    const overlap = makeTask({
      id: 't2',
      startDateTime: '2026-02-19T10:00:00.000Z',
      durationMinutes: 60,
    });

    const plan = buildAdaptiveExtendPlan(
      [task, overlap],
      task,
      Date.parse('2026-02-19T10:20:00.000Z'),
      15,
      WORKDAY
    );

    expect(plan.reason).toBe('conflict');
    expect(plan.overlapCount).toBeGreaterThan(0);

    const setDuration = vi.fn();
    const moveTask = vi.fn();

    const withoutShove = applyAdaptiveExtendPlan({
      plan,
      taskId: task.id,
      autoShoveOnExtend: false,
      setDuration,
      moveTask,
    });
    expect(withoutShove.outcome).toBe('conflict');
    expect(setDuration).not.toHaveBeenCalled();
    expect(moveTask).not.toHaveBeenCalled();

    const withShove = applyAdaptiveExtendPlan({
      plan,
      taskId: task.id,
      autoShoveOnExtend: true,
      setDuration,
      moveTask,
    });
    expect(withShove.outcome).toBe('extended_with_shove');
    expect(withShove.shovedCount).toBeGreaterThan(0);
    expect(setDuration).toHaveBeenCalledWith(task.id, plan.nextDurationMinutes);
    expect(moveTask).toHaveBeenCalled();
  });

  it('returns blocked when shove cannot resolve conflict within workday', () => {
    const task = makeTask({
      id: 't1',
      startDateTime: '2026-02-19T13:00:00.000Z',
      durationMinutes: 60,
    });
    const blocking = makeTask({
      id: 't2',
      startDateTime: '2026-02-19T14:30:00.000Z',
      durationMinutes: 60,
    });
    const downstream = makeTask({
      id: 't3',
      startDateTime: '2026-02-19T15:30:00.000Z',
      durationMinutes: 30,
    });

    const plan = buildAdaptiveExtendPlan(
      [task, blocking, downstream],
      task,
      Date.parse('2026-02-19T14:40:00.000Z'),
      15,
      WORKDAY
    );

    expect(plan.reason).toBe('conflict');
    expect(plan.shoveMoves).toBeNull();

    const result = applyAdaptiveExtendPlan({
      plan,
      taskId: task.id,
      autoShoveOnExtend: true,
      setDuration: vi.fn(),
      moveTask: vi.fn(),
    });

    expect(result.outcome).toBe('blocked');
  });

  it('returns outside_workday when extension would pass workday end', () => {
    const task = makeTask({
      id: 't1',
      startDateTime: '2026-02-19T15:30:00.000Z',
      durationMinutes: 30,
    });

    const plan = buildAdaptiveExtendPlan(
      [task],
      task,
      Date.parse('2026-02-19T16:40:00.000Z'),
      15,
      WORKDAY
    );

    expect(plan.reason).toBe('outside_workday');
  });
});
