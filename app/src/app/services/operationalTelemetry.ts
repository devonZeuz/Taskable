interface PrimitiveMetaValue {
  [key: string]: string | number | boolean | null;
}

export interface OperationalEventInput {
  eventType: string;
  durationMs?: number;
  value?: number;
  status?: number;
  code?: string | null;
  transport?: string;
  source?: string;
  metadata?: PrimitiveMetaValue;
}

export interface OperationalEvent extends OperationalEventInput {
  id: string;
  recordedAt: string;
}

interface OperationalTelemetryPayload {
  schemaVersion: number;
  events: OperationalEvent[];
}

const STORAGE_KEY = 'taskable:operational-telemetry';
const SCHEMA_VERSION = 1;
const MAX_EVENTS = 600;
const REDACTED_KEYS = new Set([
  'title',
  'tasktitle',
  'subject',
  'description',
  'body',
  'content',
  'note',
  'text',
]);

function buildDefaultPayload(): OperationalTelemetryPayload {
  return {
    schemaVersion: SCHEMA_VERSION,
    events: [],
  };
}

function sanitizeMetadata(metadata?: PrimitiveMetaValue): PrimitiveMetaValue | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;

  const sanitizedEntries = Object.entries(metadata)
    .filter(([rawKey, value]) => {
      const key = rawKey.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (REDACTED_KEYS.has(key)) return false;
      const valueType = typeof value;
      return (
        value === null ||
        valueType === 'string' ||
        valueType === 'number' ||
        valueType === 'boolean'
      );
    })
    .map(([key, value]) => {
      if (typeof value === 'string') {
        return [key, value.slice(0, 120)];
      }
      if (typeof value === 'number') {
        return [key, Number.isFinite(value) ? value : 0];
      }
      return [key, value];
    });

  if (sanitizedEntries.length === 0) return undefined;
  return Object.fromEntries(sanitizedEntries);
}

function loadPayload(): OperationalTelemetryPayload {
  if (typeof window === 'undefined') return buildDefaultPayload();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return buildDefaultPayload();
    const parsed = JSON.parse(raw) as Partial<OperationalTelemetryPayload>;

    if (!Array.isArray(parsed.events)) return buildDefaultPayload();

    const events = parsed.events.filter((entry): entry is OperationalEvent => {
      return (
        typeof entry?.id === 'string' &&
        typeof entry?.eventType === 'string' &&
        typeof entry?.recordedAt === 'string'
      );
    });

    return {
      schemaVersion: SCHEMA_VERSION,
      events: events.slice(-MAX_EVENTS),
    };
  } catch {
    return buildDefaultPayload();
  }
}

function savePayload(payload: OperationalTelemetryPayload) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage write issues
  }
}

function toSafePositiveNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, value);
}

export function recordOperationalEvent(input: OperationalEventInput) {
  if (!input.eventType || typeof input.eventType !== 'string') return;

  const payload = loadPayload();
  const next: OperationalEvent = {
    id: `ops_${Math.random().toString(36).slice(2, 11)}`,
    eventType: input.eventType.slice(0, 80),
    recordedAt: new Date().toISOString(),
    durationMs: toSafePositiveNumber(input.durationMs),
    value: toSafePositiveNumber(input.value),
    status: toSafePositiveNumber(input.status),
    code: typeof input.code === 'string' ? input.code.slice(0, 64) : (input.code ?? undefined),
    transport: typeof input.transport === 'string' ? input.transport.slice(0, 24) : undefined,
    source: typeof input.source === 'string' ? input.source.slice(0, 32) : undefined,
    metadata: sanitizeMetadata(input.metadata),
  };

  const events = [...payload.events, next];
  savePayload({
    schemaVersion: SCHEMA_VERSION,
    events: events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events,
  });
}

export function getOperationalTelemetryEvents(): OperationalEvent[] {
  return loadPayload().events;
}
