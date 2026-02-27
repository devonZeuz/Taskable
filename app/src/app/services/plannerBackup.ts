import type { Task } from '../context/TaskContext';
import type { AppTheme } from '../context/AppThemeContext';
import type { TeamMember } from '../data/teamMembers';
import type { WorkdayHours } from './scheduling';
import { getDateFromDayKey } from './scheduling';
import { normalizeTaskExecutionFields } from './taskTimer';

export interface PlannerBackupPayload {
  schemaVersion: number;
  exportedAt: string;
  taskSchemaVersion: number;
  tasks: Task[];
  workday: WorkdayHours;
  customMembers: TeamMember[];
  removedDefaultMemberIds?: string[];
  appTheme: AppTheme;
  notificationsEnabled: boolean;
}

interface LegacyTask {
  id: string;
  title: string;
  description?: string;
  day?: string;
  startTime?: string;
  estimatedHours?: number;
  completed?: boolean;
  color?: string;
  subtasks?: Array<{ id: string; title: string; completed: boolean }>;
  type?: 'quick' | 'large' | 'block';
  assignedTo?: string;
}

export const CURRENT_BACKUP_SCHEMA_VERSION = 4;

export function createPlannerBackupPayload(input: {
  tasks: Task[];
  workday: WorkdayHours;
  customMembers: TeamMember[];
  removedDefaultMemberIds?: string[];
  appTheme: AppTheme;
  notificationsEnabled: boolean;
}): PlannerBackupPayload {
  return {
    schemaVersion: CURRENT_BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    taskSchemaVersion: 4,
    tasks: normalizeTasks(input.tasks),
    workday: normalizeWorkday(input.workday),
    customMembers: sanitizeMembers(input.customMembers),
    removedDefaultMemberIds: sanitizeStringArray(input.removedDefaultMemberIds),
    appTheme: input.appTheme,
    notificationsEnabled: Boolean(input.notificationsEnabled),
  };
}

export function parsePlannerBackup(raw: string): PlannerBackupPayload {
  const parsed = JSON.parse(raw) as unknown;

  if (Array.isArray(parsed)) {
    return {
      schemaVersion: CURRENT_BACKUP_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      taskSchemaVersion: 4,
      tasks: normalizeTasks(migrateLegacyTasks(parsed as LegacyTask[])),
      workday: { startHour: 8, endHour: 18 },
      customMembers: [],
      removedDefaultMemberIds: [],
      appTheme: 'default',
      notificationsEnabled: false,
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid import: expected JSON object or task array.');
  }

  const obj = parsed as Record<string, unknown>;

  if ('tasks' in obj && Array.isArray(obj.tasks)) {
    const tasks = resolveTasks(obj.tasks as unknown[]);
    const workday = normalizeWorkday(obj.workday as WorkdayHours | undefined);
    const customMembers = sanitizeMembers(obj.customMembers as TeamMember[] | undefined);
    const removedDefaultMemberIds = sanitizeStringArray(
      obj.removedDefaultMemberIds as string[] | undefined
    );
    const appTheme = normalizeTheme(obj.appTheme);
    const notificationsEnabled = Boolean(obj.notificationsEnabled);

    return {
      schemaVersion: Number(obj.schemaVersion) || CURRENT_BACKUP_SCHEMA_VERSION,
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
      taskSchemaVersion: Number(obj.taskSchemaVersion) || 4,
      tasks: normalizeTasks(tasks),
      workday,
      customMembers,
      removedDefaultMemberIds,
      appTheme,
      notificationsEnabled,
    };
  }

  if ('schemaVersion' in obj && 'tasks' in obj && obj.tasks && typeof obj.tasks === 'object') {
    const taskWrapper = obj.tasks as Record<string, unknown>;
    const nestedTasks = Array.isArray(taskWrapper.tasks)
      ? (taskWrapper.tasks as unknown[])
      : Array.isArray(obj.tasks)
        ? (obj.tasks as unknown[])
        : [];

    return {
      schemaVersion: CURRENT_BACKUP_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      taskSchemaVersion: 4,
      tasks: normalizeTasks(resolveTasks(nestedTasks)),
      workday: normalizeWorkday(obj.workday as WorkdayHours | undefined),
      customMembers: sanitizeMembers(obj.customMembers as TeamMember[] | undefined),
      removedDefaultMemberIds: sanitizeStringArray(
        obj.removedDefaultMemberIds as string[] | undefined
      ),
      appTheme: normalizeTheme(obj.appTheme),
      notificationsEnabled: Boolean(obj.notificationsEnabled),
    };
  }

  throw new Error('Invalid import: unsupported backup format.');
}

function resolveTasks(tasks: unknown[]): Task[] {
  if (tasks.length === 0) return [];
  const first = tasks[0] as Record<string, unknown>;
  if ('durationMinutes' in first || 'startDateTime' in first) {
    return tasks as Task[];
  }
  return migrateLegacyTasks(tasks as LegacyTask[]);
}

function migrateLegacyTasks(legacyTasks: LegacyTask[]): Task[] {
  const localTimeZone = getLocalTimeZone();
  return legacyTasks.map((task) => {
    const durationMinutes = Math.max(15, Math.round((task.estimatedHours ?? 1) * 60));
    const startDateTime =
      task.day && task.startTime ? buildStartDateTime(task.day, task.startTime) : undefined;

    return {
      id: task.id || randomId('tsk'),
      title: task.title || 'Imported task',
      description: task.description || '',
      startDateTime,
      durationMinutes,
      timeZone: localTimeZone,
      completed: Boolean(task.completed),
      color: task.color || '#8d929c',
      subtasks: Array.isArray(task.subtasks)
        ? task.subtasks.map((subtask) => ({
            id: subtask.id || randomId('sub'),
            title: subtask.title || 'Subtask',
            completed: Boolean(subtask.completed),
          }))
        : [],
      type: task.type === 'large' ? 'large' : task.type === 'block' ? 'block' : 'quick',
      assignedTo: task.assignedTo,
      status: startDateTime ? 'scheduled' : 'inbox',
      focus: false,
      version: 1,
      executionStatus: task.completed ? 'completed' : 'idle',
      actualMinutes: 0,
    };
  });
}

function normalizeTasks(tasks: Task[]): Task[] {
  return tasks.map((task) => {
    const subtasks = Array.isArray(task.subtasks)
      ? task.subtasks.map((subtask) => ({
          id: subtask.id || randomId('sub'),
          title: subtask.title || 'Subtask',
          completed: Boolean(subtask.completed),
        }))
      : [];

    const hasStart = Boolean(task.startDateTime);
    const status = task.status ?? (hasStart ? 'scheduled' : 'inbox');

    return normalizeTaskExecutionFields({
      ...task,
      id: task.id || randomId('tsk'),
      title: task.title || 'Imported task',
      description: task.description || '',
      durationMinutes: Math.max(15, Math.round(task.durationMinutes || 60)),
      timeZone: task.timeZone || getLocalTimeZone(),
      completed: Boolean(task.completed),
      color: task.color || '#8d929c',
      type: task.type === 'large' ? 'large' : task.type === 'block' ? 'block' : 'quick',
      status,
      startDateTime: status === 'scheduled' ? task.startDateTime : undefined,
      subtasks,
      focus: Boolean(task.focus),
      version:
        typeof task.version === 'number' && Number.isFinite(task.version) && task.version > 0
          ? Math.floor(task.version)
          : 1,
      executionVersion:
        typeof task.executionVersion === 'number' && task.executionVersion > 0
          ? Math.floor(task.executionVersion)
          : undefined,
      executionUpdatedAt:
        typeof task.executionUpdatedAt === 'string' ? task.executionUpdatedAt : undefined,
      executionStatus: task.executionStatus,
      actualMinutes: task.actualMinutes,
      lastStartAt: task.lastStartAt,
      completedAt: task.completedAt,
      lastEndPromptAt: task.lastEndPromptAt ?? task.lastPromptAt,
      lastPromptAt: task.lastPromptAt,
    });
  });
}

function normalizeWorkday(workday?: WorkdayHours): WorkdayHours {
  const startHour = Math.max(0, Math.min(23, Math.floor(workday?.startHour ?? 8)));
  let endHour = Math.max(1, Math.min(23, Math.floor(workday?.endHour ?? 18)));
  if (endHour <= startHour) {
    endHour = Math.min(23, startHour + 1);
  }
  return { startHour, endHour };
}

function sanitizeMembers(members?: TeamMember[]): TeamMember[] {
  if (!Array.isArray(members)) return [];
  return members
    .filter((member) => typeof member?.id === 'string' && typeof member?.name === 'string')
    .map((member) => ({ id: member.id, name: member.name }));
}

function sanitizeStringArray(values?: string[]): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter((value) => typeof value === 'string');
}

function normalizeTheme(theme: unknown): AppTheme {
  if (theme === 'default' || theme === 'sugar-plum' || theme === 'mono' || theme === 'white')
    return theme;
  return 'default';
}

function buildStartDateTime(dayValue: string, time: string): string {
  const day = dayValue.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? dayValue;
  const baseDate = getDateFromDayKey(day);
  const [hours, minutes] = time.split(':').map(Number);
  baseDate.setHours(
    Number.isFinite(hours) ? hours : 8,
    Number.isFinite(minutes) ? minutes : 0,
    0,
    0
  );
  return baseDate.toISOString();
}

function getLocalTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  } catch {
    return 'UTC';
  }
}

function randomId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
