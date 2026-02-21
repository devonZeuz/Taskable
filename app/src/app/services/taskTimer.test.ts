import { describe, expect, it } from 'vitest';
import type { Task } from '../context/TaskContext';
import {
  accumulateIfRunning,
  calculateElapsedMinutes,
  formatElapsedClock,
  getDurationToNow,
  getOverrunMinutes,
  normalizeTaskExecutionFields,
  roundDurationToGrid,
} from './taskTimer';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? 'task-1',
    title: overrides.title ?? 'Timer Task',
    description: overrides.description ?? '',
    startDateTime: overrides.startDateTime ?? '2026-02-19T09:00:00.000Z',
    durationMinutes: overrides.durationMinutes ?? 60,
    timeZone: overrides.timeZone ?? 'UTC',
    completed: overrides.completed ?? false,
    color: overrides.color ?? '#e63f97',
    subtasks: overrides.subtasks ?? [],
    type: overrides.type ?? 'quick',
    assignedTo: overrides.assignedTo,
    status: overrides.status ?? 'scheduled',
    focus: overrides.focus ?? false,
    version: overrides.version ?? 1,
    executionStatus: overrides.executionStatus ?? 'idle',
    actualMinutes: overrides.actualMinutes ?? 0,
    lastStartAt: overrides.lastStartAt,
    completedAt: overrides.completedAt,
    lastEndPromptAt: overrides.lastEndPromptAt,
    lastPromptAt: overrides.lastPromptAt,
  };
}

describe('taskTimer service', () => {
  it('normalizes execution fields from legacy task shape', () => {
    const normalized = normalizeTaskExecutionFields(
      makeTask({
        completed: true,
        executionStatus: undefined,
        actualMinutes: Number.NaN,
        lastStartAt: 'invalid',
      })
    );

    expect(normalized.executionStatus).toBe('completed');
    expect(normalized.completed).toBe(true);
    expect(normalized.actualMinutes).toBe(0);
    expect(normalized.lastStartAt).toBeUndefined();
  });

  it('maps legacy scheduled status and prompt timestamp to new fields', () => {
    const normalized = normalizeTaskExecutionFields(
      makeTask({
        executionStatus: 'scheduled',
        completed: false,
        lastPromptAt: '2026-02-19T10:00:00.000Z',
      })
    );

    expect(normalized.executionStatus).toBe('idle');
    expect(normalized.lastEndPromptAt).toBe('2026-02-19T10:00:00.000Z');
  });

  it('accumulates elapsed minutes while running', () => {
    const task = makeTask({
      executionStatus: 'running',
      actualMinutes: 10,
      lastStartAt: '2026-02-19T09:00:00.000Z',
    });
    const now = Date.parse('2026-02-19T09:30:00.000Z');

    expect(calculateElapsedMinutes(task, now)).toBe(40);
    expect(accumulateIfRunning(task, now)).toBe(40);
  });

  it('detects overrun minutes only when running past planned end', () => {
    const task = makeTask({
      executionStatus: 'running',
      startDateTime: '2026-02-19T09:00:00.000Z',
      durationMinutes: 60,
    });
    const now = Date.parse('2026-02-19T10:15:00.000Z');

    expect(getOverrunMinutes(task, now)).toBe(15);
    expect(getOverrunMinutes({ ...task, executionStatus: 'paused' }, now)).toBe(0);
  });

  it('rounds duration to slot size and extends to cover now', () => {
    expect(roundDurationToGrid(61, 15)).toBe(75);
    expect(roundDurationToGrid(45, 30)).toBe(60);

    const task = makeTask({
      startDateTime: '2026-02-19T09:00:00.000Z',
      durationMinutes: 60,
    });
    const now = Date.parse('2026-02-19T10:17:00.000Z');
    expect(getDurationToNow(task, now, 15)).toBe(90);
  });

  it('formats elapsed clock for compact rendering', () => {
    expect(formatElapsedClock(5.5)).toBe('05:30');
    expect(formatElapsedClock(65.25)).toBe('01:05:15');
  });
});
