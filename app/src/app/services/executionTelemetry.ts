import { cloudRequest } from './cloudApi';
import type { PlannerMode } from './authStorage';

type ExecutionTelemetryEventType =
  | 'task_started'
  | 'task_paused'
  | 'task_completed'
  | 'task_postponed';

interface ExecutionTelemetryPayload {
  schemaVersion: number;
  events: ExecutionTelemetryEvent[];
}

interface ExecutionTelemetryMeta {
  [key: string]: string | number | boolean | null | undefined;
}

export interface ExecutionTelemetryEventInput {
  eventType: ExecutionTelemetryEventType;
  taskId: string;
  timestamp?: string;
  plannedStartDateTime?: string;
  plannedDurationMinutes?: number;
  actualMinutes?: number;
  startAt?: string;
  completedAt?: string;
  overrunMinutes?: number;
  fromStartDateTime?: string;
  toStartDateTime?: string;
}

export interface ExecutionTelemetryEvent extends ExecutionTelemetryEventInput {
  id: string;
  timestamp: string;
  cloudSyncedAt?: string;
}

interface FlushExecutionTelemetryOptions {
  mode?: PlannerMode | null;
  token?: string | null;
  orgId?: string | null;
  telemetryShareEnabled?: boolean;
  maxShip?: number;
}

const STORAGE_KEY = 'taskable:telemetry:v1';
const SCHEMA_VERSION = 1;
const MAX_EVENTS = 5_000;
const MAX_RETENTION_DAYS = 90;
const WRITE_DEBOUNCE_MS = 220;
const DEFAULT_SHIP_BATCH_SIZE = 30;

let pendingEvents: ExecutionTelemetryEventInput[] = [];
let writeTimer: number | null = null;

function buildDefaultPayload(): ExecutionTelemetryPayload {
  return {
    schemaVersion: SCHEMA_VERSION,
    events: [],
  };
}

function toSafeTimestamp(value?: string): string {
  if (typeof value !== 'string' || value.length === 0) return new Date().toISOString();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return new Date().toISOString();
  return new Date(parsed).toISOString();
}

function toSafeNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

function normalizeEvent(input: ExecutionTelemetryEventInput): ExecutionTelemetryEvent | null {
  if (
    input.eventType !== 'task_started' &&
    input.eventType !== 'task_paused' &&
    input.eventType !== 'task_completed' &&
    input.eventType !== 'task_postponed'
  ) {
    return null;
  }
  if (typeof input.taskId !== 'string' || input.taskId.trim().length === 0) return null;

  return {
    id: `exec_${Math.random().toString(36).slice(2, 11)}`,
    eventType: input.eventType,
    taskId: input.taskId.trim(),
    timestamp: toSafeTimestamp(input.timestamp),
    plannedStartDateTime:
      typeof input.plannedStartDateTime === 'string' ? input.plannedStartDateTime : undefined,
    plannedDurationMinutes: toSafeNumber(input.plannedDurationMinutes),
    actualMinutes: toSafeNumber(input.actualMinutes),
    startAt: typeof input.startAt === 'string' ? input.startAt : undefined,
    completedAt: typeof input.completedAt === 'string' ? input.completedAt : undefined,
    overrunMinutes: toSafeNumber(input.overrunMinutes),
    fromStartDateTime:
      typeof input.fromStartDateTime === 'string' ? input.fromStartDateTime : undefined,
    toStartDateTime: typeof input.toStartDateTime === 'string' ? input.toStartDateTime : undefined,
  };
}

function pruneEvents(events: ExecutionTelemetryEvent[]): ExecutionTelemetryEvent[] {
  const retentionCutoffMs = Date.now() - MAX_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const retained = events.filter((event) => {
    const eventTime = Date.parse(event.timestamp);
    if (!Number.isFinite(eventTime)) return false;
    return eventTime >= retentionCutoffMs;
  });
  if (retained.length <= MAX_EVENTS) return retained;
  return retained.slice(retained.length - MAX_EVENTS);
}

function loadPayload(): ExecutionTelemetryPayload {
  if (typeof window === 'undefined') return buildDefaultPayload();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return buildDefaultPayload();
    const parsed = JSON.parse(raw) as Partial<ExecutionTelemetryPayload>;
    if (!Array.isArray(parsed.events)) return buildDefaultPayload();
    const events = parsed.events
      .map((event) => normalizeEvent(event))
      .filter((event): event is ExecutionTelemetryEvent => Boolean(event))
      .map((event, index) => ({
        ...event,
        id:
          typeof parsed.events?.[index] === 'object' &&
          parsed.events[index] !== null &&
          typeof (parsed.events[index] as { id?: unknown }).id === 'string'
            ? ((parsed.events[index] as { id: string }).id ?? event.id)
            : event.id,
        cloudSyncedAt:
          typeof parsed.events?.[index] === 'object' &&
          parsed.events[index] !== null &&
          typeof (parsed.events[index] as { cloudSyncedAt?: unknown }).cloudSyncedAt === 'string'
            ? ((parsed.events[index] as { cloudSyncedAt: string }).cloudSyncedAt ?? undefined)
            : undefined,
      }));
    return {
      schemaVersion: SCHEMA_VERSION,
      events: pruneEvents(events),
    };
  } catch {
    return buildDefaultPayload();
  }
}

function savePayload(payload: ExecutionTelemetryPayload) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        events: pruneEvents(payload.events),
      } satisfies ExecutionTelemetryPayload)
    );
  } catch {
    // Ignore storage write errors.
  }
}

function mergePendingIntoStorage() {
  if (pendingEvents.length === 0) return;
  const payload = loadPayload();
  const normalizedPending = pendingEvents
    .map((event) => normalizeEvent(event))
    .filter((event): event is ExecutionTelemetryEvent => Boolean(event));
  pendingEvents = [];
  if (normalizedPending.length === 0) return;

  savePayload({
    schemaVersion: SCHEMA_VERSION,
    events: [...payload.events, ...normalizedPending],
  });
}

function scheduleWrite() {
  if (typeof window === 'undefined') return;
  if (writeTimer !== null) return;
  writeTimer = window.setTimeout(() => {
    writeTimer = null;
    mergePendingIntoStorage();
  }, WRITE_DEBOUNCE_MS);
}

function toOpsMetadata(event: ExecutionTelemetryEvent): ExecutionTelemetryMeta {
  return {
    taskId: event.taskId,
    plannedStartDateTime: event.plannedStartDateTime ?? null,
    plannedDurationMinutes: event.plannedDurationMinutes ?? null,
    actualMinutes: event.actualMinutes ?? null,
    startAt: event.startAt ?? null,
    completedAt: event.completedAt ?? null,
    overrunMinutes: event.overrunMinutes ?? null,
    fromStartDateTime: event.fromStartDateTime ?? null,
    toStartDateTime: event.toStartDateTime ?? null,
  };
}

export function recordExecutionTelemetryEvent(event: ExecutionTelemetryEventInput) {
  pendingEvents.push(event);
  scheduleWrite();
}

export async function flushExecutionTelemetry(
  options: FlushExecutionTelemetryOptions = {}
): Promise<void> {
  if (writeTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(writeTimer);
    writeTimer = null;
  }
  mergePendingIntoStorage();

  const {
    mode = null,
    token = null,
    orgId = null,
    telemetryShareEnabled = false,
    maxShip = DEFAULT_SHIP_BATCH_SIZE,
  } = options;

  if (mode !== 'cloud' || !token || !orgId || !telemetryShareEnabled) {
    return;
  }

  const payload = loadPayload();
  const unsynced = payload.events.filter((event) => !event.cloudSyncedAt).slice(0, maxShip);
  if (unsynced.length === 0) return;

  const syncedIds = new Set<string>();
  for (const event of unsynced) {
    try {
      await cloudRequest('/api/ops/events', {
        method: 'POST',
        token,
        body: {
          orgId,
          eventType: event.eventType,
          metadata: toOpsMetadata(event),
        },
      });
      syncedIds.add(event.id);
    } catch {
      // Best effort shipping; keep unsynced for a later retry.
    }
  }

  if (syncedIds.size === 0) return;
  const syncedAt = new Date().toISOString();
  const nextEvents = payload.events.map((event) =>
    syncedIds.has(event.id) ? { ...event, cloudSyncedAt: syncedAt } : event
  );
  savePayload({
    schemaVersion: SCHEMA_VERSION,
    events: nextEvents,
  });
}

export function getLocalTelemetryWindow(days: number): ExecutionTelemetryEvent[] {
  const safeDays = Math.max(1, Math.floor(days));
  const cutoffMs = Date.now() - safeDays * 24 * 60 * 60 * 1000;
  return loadPayload().events.filter((event) => {
    const eventTime = Date.parse(event.timestamp);
    return Number.isFinite(eventTime) && eventTime >= cutoffMs;
  });
}
