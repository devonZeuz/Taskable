import { describe, expect, it } from 'vitest';
import type { Task } from '../context/TaskContext';
import { areTasksEquivalentForSync, autoMergeTask, getChangedFields } from './syncMerge';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? 'task-1',
    title: overrides.title ?? 'Base Task',
    description: overrides.description ?? '',
    startDateTime: overrides.startDateTime ?? '2026-02-18T09:00:00.000Z',
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
  };
}

describe('syncMerge', () => {
  it('auto-merges non-overlapping local and server changes', () => {
    const base = makeTask({
      title: 'Task',
      description: 'Old description',
      startDateTime: '2026-02-18T09:00:00.000Z',
      version: 1,
    });
    const local = makeTask({
      title: 'Task (edited locally)',
      description: 'Old description',
      startDateTime: '2026-02-18T09:00:00.000Z',
      version: 1,
    });
    const server = makeTask({
      title: 'Task',
      description: 'Edited on server',
      startDateTime: '2026-02-18T10:00:00.000Z',
      version: 2,
    });

    const result = autoMergeTask(base, local, server);
    expect(result.conflicts).toEqual([]);
    expect(result.mergedTask.title).toBe('Task (edited locally)');
    expect(result.mergedTask.description).toBe('Edited on server');
    expect(result.mergedTask.startDateTime).toBe('2026-02-18T10:00:00.000Z');
    expect(result.mergedTask.version).toBe(2);
  });

  it('reports conflicts when the same field changed differently', () => {
    const base = makeTask({ title: 'Task', version: 1 });
    const local = makeTask({ title: 'Local title', version: 1 });
    const server = makeTask({ title: 'Server title', version: 2 });

    const result = autoMergeTask(base, local, server);
    expect(result.conflicts).toEqual(['title']);
    expect(result.mergedTask.title).toBe('Local title');
  });

  it('treats tasks with same sync fields as equivalent regardless of version', () => {
    const a = makeTask({ version: 1 });
    const b = makeTask({ version: 5 });

    expect(areTasksEquivalentForSync(a, b)).toBe(true);
  });

  it('treats nullish and normalized sync values as equivalent', () => {
    const a = {
      ...makeTask(),
      description: undefined,
      startDateTime: undefined,
      status: 'inbox' as const,
      assignedTo: undefined,
    };
    const b = {
      ...makeTask(),
      description: '',
      startDateTime: undefined,
      status: undefined,
      assignedTo: undefined,
    };

    expect(areTasksEquivalentForSync(a, b)).toBe(true);
  });

  it('returns changed field list against a base task', () => {
    const base = makeTask({ title: 'Task', completed: false });
    const next = makeTask({ title: 'Task updated', completed: true });

    expect(getChangedFields(base, next)).toEqual(['title', 'completed']);
  });
});
