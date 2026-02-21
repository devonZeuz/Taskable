import type { Task } from '../context/TaskContext';

export type TaskExecutionStatus = 'idle' | 'running' | 'paused' | 'completed' | 'scheduled';

const MINUTE_MS = 60_000;

function isValidIso(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function toSafeMinutes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

function roundToHundredths(value: number): number {
  return Math.round(value * 100) / 100;
}

function fallbackExecutionStatus(task: Pick<Task, 'completed'>): TaskExecutionStatus {
  return task.completed ? 'completed' : 'idle';
}

export function normalizeExecutionStatus(task: Pick<Task, 'completed' | 'executionStatus'>) {
  const rawStatus = task.executionStatus;
  if (rawStatus === 'scheduled' || rawStatus === 'idle') {
    return task.completed ? 'completed' : 'idle';
  }
  if (rawStatus === 'running' || rawStatus === 'paused') {
    return task.completed ? 'completed' : rawStatus;
  }
  if (rawStatus === 'completed') {
    return 'completed';
  }
  return fallbackExecutionStatus(task);
}

export function normalizeTaskExecutionFields(task: Task): Task {
  const executionStatus = normalizeExecutionStatus(task);
  const completed = executionStatus === 'completed' || Boolean(task.completed);
  const normalizedStatus: TaskExecutionStatus = completed ? 'completed' : executionStatus;
  const normalizedActualMinutes = toSafeMinutes(task.actualMinutes);
  const normalizedLastStartAt =
    normalizedStatus === 'running' && isValidIso(task.lastStartAt) ? task.lastStartAt : undefined;
  const normalizedCompletedAt =
    normalizedStatus === 'completed' && isValidIso(task.completedAt) ? task.completedAt : undefined;
  const normalizedLastEndPromptAt = isValidIso(task.lastEndPromptAt)
    ? task.lastEndPromptAt
    : isValidIso(task.lastPromptAt)
      ? task.lastPromptAt
      : undefined;

  return {
    ...task,
    completed,
    executionStatus: normalizedStatus,
    actualMinutes: normalizedActualMinutes,
    lastStartAt: normalizedLastStartAt,
    completedAt: normalizedCompletedAt,
    lastEndPromptAt: normalizedLastEndPromptAt,
    lastPromptAt: normalizedLastEndPromptAt,
  };
}

export function calculateElapsedMinutes(
  task: Pick<Task, 'actualMinutes' | 'lastStartAt'>,
  nowMs: number
) {
  const baseMinutes = toSafeMinutes(task.actualMinutes);
  if (!isValidIso(task.lastStartAt)) {
    return roundToHundredths(baseMinutes);
  }
  const runningMs = Math.max(0, nowMs - Date.parse(task.lastStartAt));
  return roundToHundredths(baseMinutes + runningMs / MINUTE_MS);
}

export function accumulateIfRunning(
  task: Pick<Task, 'actualMinutes' | 'lastStartAt' | 'executionStatus'>,
  nowMs: number
) {
  if (task.executionStatus !== 'running') {
    return roundToHundredths(toSafeMinutes(task.actualMinutes));
  }
  return calculateElapsedMinutes(task, nowMs);
}

export function getScheduledEndTimestamp(
  task: Pick<Task, 'startDateTime' | 'durationMinutes'>
): number | null {
  if (!task.startDateTime || !isValidIso(task.startDateTime)) return null;
  const startMs = Date.parse(task.startDateTime);
  return startMs + Math.max(0, task.durationMinutes) * MINUTE_MS;
}

export function getOverrunMinutes(
  task: Pick<Task, 'executionStatus' | 'startDateTime' | 'durationMinutes'>,
  nowMs: number
) {
  if (task.executionStatus !== 'running') return 0;
  const scheduledEnd = getScheduledEndTimestamp(task);
  if (scheduledEnd === null) return 0;
  if (nowMs <= scheduledEnd) return 0;
  return roundToHundredths((nowMs - scheduledEnd) / MINUTE_MS);
}

export function isRunningLate(
  task: Pick<Task, 'executionStatus' | 'startDateTime' | 'durationMinutes'>,
  nowMs: number
) {
  return getOverrunMinutes(task, nowMs) > 0;
}

export function roundDurationToGrid(durationMinutes: number, slotMinutes: number): number {
  const safeSlot = Math.max(1, slotMinutes);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return safeSlot;
  return Math.ceil(durationMinutes / safeSlot) * safeSlot;
}

export function getDurationToNow(
  task: Pick<Task, 'startDateTime' | 'durationMinutes'>,
  nowMs: number,
  slotMinutes: number
) {
  if (!task.startDateTime || !isValidIso(task.startDateTime)) {
    return Math.max(slotMinutes, task.durationMinutes);
  }
  const startMs = Date.parse(task.startDateTime);
  const elapsedMinutes = Math.max(0, (nowMs - startMs) / MINUTE_MS);
  const roundedElapsed = roundDurationToGrid(elapsedMinutes, slotMinutes);
  return Math.max(task.durationMinutes, roundedElapsed);
}

export function formatElapsedClock(elapsedMinutes: number): string {
  const safeSeconds = Math.max(0, Math.floor(elapsedMinutes * 60));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
