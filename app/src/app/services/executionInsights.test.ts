import { describe, expect, it } from 'vitest';
import type { Task } from '../context/TaskContext';
import { buildWeeklyExecutionInsights } from './executionInsights';

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    durationMinutes: overrides.durationMinutes ?? 60,
    completed: overrides.completed ?? false,
    color: overrides.color ?? '#111111',
    subtasks: overrides.subtasks ?? [],
    type: overrides.type ?? 'quick',
    status: overrides.status ?? 'scheduled',
    version: overrides.version ?? 1,
    ...overrides,
  };
}

describe('buildWeeklyExecutionInsights', () => {
  const referenceNow = Date.parse('2026-02-24T14:00:00.000Z');

  it('returns null score when there are no scheduled tasks in window', () => {
    const insights = buildWeeklyExecutionInsights([], referenceNow, 10);

    expect(insights.scheduledCount).toBe(0);
    expect(insights.completedCount).toBe(0);
    expect(insights.reliabilityScore).toBeNull();
    expect(insights.averageDriftMinutes).toBeNull();
  });

  it('computes reliability and drift metrics for completed tasks', () => {
    const tasks: Task[] = [
      makeTask('a', {
        startDateTime: '2026-02-22T09:00:00.000Z',
        completed: true,
        executionStatus: 'completed',
        durationMinutes: 60,
        actualMinutes: 70,
      }),
      makeTask('b', {
        startDateTime: '2026-02-23T14:00:00.000Z',
        completed: true,
        executionStatus: 'completed',
        durationMinutes: 45,
        actualMinutes: 40,
      }),
      makeTask('c', {
        startDateTime: '2026-02-24T16:00:00.000Z',
        completed: false,
        executionStatus: 'paused',
        durationMinutes: 30,
        actualMinutes: 10,
      }),
      makeTask('outside', {
        startDateTime: '2026-01-01T10:00:00.000Z',
        completed: true,
        executionStatus: 'completed',
        durationMinutes: 30,
        actualMinutes: 30,
      }),
    ];

    const insights = buildWeeklyExecutionInsights(tasks, referenceNow, 10);

    expect(insights.scheduledCount).toBe(3);
    expect(insights.completedCount).toBe(2);
    expect(insights.completionRate).toBeCloseTo(0.667, 3);
    expect(insights.reliabilityScore).not.toBeNull();
    expect(insights.averageDriftMinutes).toBe(2.5);
    expect(insights.overrunCount).toBe(0);
    expect(insights.underrunCount).toBe(0);
    expect(insights.onTrackCount).toBe(2);
  });

  it('reports top positive drift window when overruns cluster', () => {
    const tasks: Task[] = [
      makeTask('a', {
        startDateTime: '2026-02-21T16:00:00.000Z',
        completed: true,
        executionStatus: 'completed',
        durationMinutes: 30,
        actualMinutes: 50,
      }),
      makeTask('b', {
        startDateTime: '2026-02-22T16:30:00.000Z',
        completed: true,
        executionStatus: 'completed',
        durationMinutes: 45,
        actualMinutes: 70,
      }),
      makeTask('c', {
        startDateTime: '2026-02-22T09:30:00.000Z',
        completed: true,
        executionStatus: 'completed',
        durationMinutes: 60,
        actualMinutes: 45,
      }),
    ];

    const insights = buildWeeklyExecutionInsights(tasks, referenceNow, 10);

    expect(insights.overrunCount).toBe(2);
    expect(insights.underrunCount).toBe(1);
    expect(insights.topDriftWindow).not.toBeNull();
    expect(insights.topDriftWindow?.label).toContain('Late day');
    expect(insights.topDriftWindow?.averageDriftMinutes).toBeGreaterThan(20);
  });
});
