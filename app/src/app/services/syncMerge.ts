import type { Task } from '../context/TaskContext';

const SYNC_FIELDS = [
  'title',
  'description',
  'startDateTime',
  'durationMinutes',
  'timeZone',
  'completed',
  'color',
  'subtasks',
  'type',
  'assignedTo',
  'status',
  'focus',
  'executionStatus',
  'actualMinutes',
  'lastStartAt',
  'completedAt',
  'lastEndPromptAt',
  'lastPromptAt',
] as const;

type SyncField = (typeof SYNC_FIELDS)[number];
export type { SyncField };

export interface TaskMergeResult {
  mergedTask: Task;
  conflicts: SyncField[];
}

function isEqualValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function normalizeFieldValue(task: Task | undefined, field: SyncField): unknown {
  if (!task) return undefined;

  switch (field) {
    case 'title':
      return task.title ?? '';
    case 'description':
      return task.description ?? '';
    case 'startDateTime':
      return task.startDateTime ?? null;
    case 'durationMinutes':
      return Math.max(0, Math.round(Number(task.durationMinutes ?? 0)));
    case 'timeZone':
      return task.timeZone ?? null;
    case 'completed':
      return Boolean(task.completed);
    case 'color':
      return task.color ?? '';
    case 'subtasks':
      return (task.subtasks ?? []).map((subtask) => ({
        id: subtask.id,
        title: subtask.title,
        completed: Boolean(subtask.completed),
      }));
    case 'type':
      return task.type ?? 'quick';
    case 'assignedTo':
      return task.assignedTo ?? null;
    case 'status':
      return task.status ?? (task.startDateTime ? 'scheduled' : 'inbox');
    case 'focus':
      return Boolean(task.focus);
    case 'executionStatus':
      return task.executionStatus ?? null;
    case 'actualMinutes':
      return Math.max(0, Math.round(Number(task.actualMinutes ?? 0)));
    case 'lastStartAt':
      return task.lastStartAt ?? null;
    case 'completedAt':
      return task.completedAt ?? null;
    case 'lastEndPromptAt':
    case 'lastPromptAt':
      return task.lastEndPromptAt ?? task.lastPromptAt ?? null;
    default:
      return task[field];
  }
}

function pickField(task: Task | undefined, field: SyncField) {
  return normalizeFieldValue(task, field);
}

export function areTasksEquivalentForSync(a: Task | undefined, b: Task | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return SYNC_FIELDS.every((field) => isEqualValue(pickField(a, field), pickField(b, field)));
}

export function getChangedFields(base: Task | undefined, next: Task): SyncField[] {
  return SYNC_FIELDS.filter(
    (field) => !isEqualValue(pickField(base, field), pickField(next, field))
  );
}

export function autoMergeTask(base: Task | undefined, local: Task, server: Task): TaskMergeResult {
  const mergedTask: Record<string, unknown> = {
    ...server,
    id: local.id,
    version: server.version,
  };
  const conflicts: SyncField[] = [];

  SYNC_FIELDS.forEach((field) => {
    const baseValue = pickField(base, field);
    const localNormalizedValue = pickField(local, field);
    const serverNormalizedValue = pickField(server, field);
    const localValue = local[field];
    const serverValue = server[field];

    const localChanged = !isEqualValue(localNormalizedValue, baseValue);
    const serverChanged = !isEqualValue(serverNormalizedValue, baseValue);

    if (
      localChanged &&
      serverChanged &&
      !isEqualValue(localNormalizedValue, serverNormalizedValue)
    ) {
      conflicts.push(field);
      mergedTask[field] = localValue;
      return;
    }

    if (localChanged && !serverChanged) {
      mergedTask[field] = localValue;
      return;
    }

    mergedTask[field] = serverValue;
  });

  return { mergedTask: mergedTask as unknown as Task, conflicts };
}
