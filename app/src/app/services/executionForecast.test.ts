import { describe, expect, it } from 'vitest';
import type { Task } from '../context/TaskContext';
import { buildWeeklyExecutionForecast } from './executionForecast';

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

describe('buildWeeklyExecutionForecast', () => {
  const referenceNow = Date.parse('2026-02-24T14:00:00.000Z');
  const workday = { startHour: 8, endHour: 18 };

  it('computes weekly overload across next 7 days', () => {
    const tasks: Task[] = [
      makeTask('today-1', {
        startDateTime: '2026-02-24T08:00:00.000Z',
        durationMinutes: 500,
      }),
      makeTask('today-2', {
        startDateTime: '2026-02-24T12:00:00.000Z',
        durationMinutes: 300,
      }),
      makeTask('tomorrow', {
        startDateTime: '2026-02-25T09:00:00.000Z',
        durationMinutes: 700,
      }),
      makeTask('done-ignore', {
        startDateTime: '2026-02-24T15:00:00.000Z',
        completed: true,
        executionStatus: 'completed',
        durationMinutes: 200,
      }),
    ];

    const forecast = buildWeeklyExecutionForecast(tasks, workday, referenceNow);

    expect(forecast.overloadedDays).toBe(2);
    expect(forecast.weeklyOverloadMinutes).toBeGreaterThan(0);
    expect(forecast.peakOverloadDay).not.toBeNull();
    expect(forecast.peakOverloadDay?.dayKey).toBe('2026-02-24');
  });

  it('builds overrun heatmap from completed task drift', () => {
    const tasks: Task[] = [
      makeTask('late-1', {
        startDateTime: '2026-02-21T16:15:00.000Z',
        completed: true,
        executionStatus: 'completed',
        durationMinutes: 45,
        actualMinutes: 70,
      }),
      makeTask('late-2', {
        startDateTime: '2026-02-20T16:45:00.000Z',
        completed: true,
        executionStatus: 'completed',
        durationMinutes: 30,
        actualMinutes: 55,
      }),
      makeTask('morning-balanced', {
        startDateTime: '2026-02-22T09:15:00.000Z',
        completed: true,
        executionStatus: 'completed',
        durationMinutes: 60,
        actualMinutes: 62,
      }),
    ];

    const forecast = buildWeeklyExecutionForecast(tasks, workday, referenceNow);

    expect(forecast.overrunHeatmap.length).toBeGreaterThan(0);
    expect(forecast.overrunHeatmap[0].label).toContain('Late day');
    expect(forecast.overrunHeatmap[0].overrunCount).toBe(2);
  });
});
