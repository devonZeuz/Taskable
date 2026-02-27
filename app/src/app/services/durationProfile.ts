import { readCloudUserId, readPlannerMode } from './authStorage';
import { roundDurationToGrid } from './taskTimer';

type TaskType = 'quick' | 'large' | 'block';

export interface DurationProfileBucket {
  key: string;
  type: TaskType;
  titleBucket: string;
  count: number;
  avgPlanned: number;
  avgActual: number;
  correctionFactor: number;
  lastUpdatedAt: string;
}

interface DurationProfilePayload {
  schemaVersion: number;
  buckets: Record<string, DurationProfileBucket>;
}

export interface DurationProfileSuggestion {
  suggestedDurationMinutes: number | null;
  sampleCount: number;
  correctionFactor: number | null;
  bucketKey: string | null;
}

interface DurationProfileInput {
  title: string;
  type: TaskType;
  plannedMinutes: number;
  actualMinutes: number;
  completedAt?: string;
}

interface DurationSuggestionInput {
  title: string;
  type: TaskType;
  plannedMinutes: number;
  slotMinutes: number;
}

const SCHEMA_VERSION = 1;
const LOCAL_STORAGE_KEY = 'taskable:duration-profile:v1:local';
const CLOUD_STORAGE_PREFIX = 'taskable:duration-profile:v1:cloud:';
const MAX_BUCKETS = 400;
const MIN_SAMPLES_FOR_SUGGESTION = 3;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function resolveStorageKey(): string {
  const mode = readPlannerMode();
  if (mode === 'cloud') {
    const cloudUserId = readCloudUserId();
    if (cloudUserId) {
      return `${CLOUD_STORAGE_PREFIX}${cloudUserId}`;
    }
  }
  return LOCAL_STORAGE_KEY;
}

function buildDefaultPayload(): DurationProfilePayload {
  return {
    schemaVersion: SCHEMA_VERSION,
    buckets: {},
  };
}

function loadPayload(): DurationProfilePayload {
  if (typeof window === 'undefined') return buildDefaultPayload();

  try {
    const raw = window.localStorage.getItem(resolveStorageKey());
    if (!raw) return buildDefaultPayload();
    const parsed = JSON.parse(raw) as Partial<DurationProfilePayload>;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !parsed.buckets ||
      typeof parsed.buckets !== 'object'
    ) {
      return buildDefaultPayload();
    }

    const buckets = Object.fromEntries(
      Object.entries(parsed.buckets).filter(([key, bucket]) => {
        if (!bucket || typeof bucket !== 'object') return false;
        const candidate = bucket as Partial<DurationProfileBucket>;
        if (typeof key !== 'string' || key.length === 0) return false;
        if (
          candidate.type !== 'quick' &&
          candidate.type !== 'large' &&
          candidate.type !== 'block'
        ) {
          return false;
        }
        if (typeof candidate.titleBucket !== 'string' || candidate.titleBucket.length === 0) {
          return false;
        }
        if (!Number.isFinite(candidate.count) || (candidate.count ?? 0) <= 0) return false;
        if (!Number.isFinite(candidate.avgPlanned) || (candidate.avgPlanned ?? 0) <= 0)
          return false;
        if (!Number.isFinite(candidate.avgActual) || (candidate.avgActual ?? 0) <= 0) return false;
        if (!Number.isFinite(candidate.correctionFactor)) return false;
        if (typeof candidate.lastUpdatedAt !== 'string' || candidate.lastUpdatedAt.length === 0) {
          return false;
        }
        return true;
      })
    ) as Record<string, DurationProfileBucket>;

    return {
      schemaVersion: SCHEMA_VERSION,
      buckets,
    };
  } catch {
    return buildDefaultPayload();
  }
}

function savePayload(payload: DurationProfilePayload) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(resolveStorageKey(), JSON.stringify(payload));
  } catch {
    // Ignore storage write errors.
  }
}

function trimBuckets(buckets: Record<string, DurationProfileBucket>) {
  const entries = Object.entries(buckets);
  if (entries.length <= MAX_BUCKETS) return buckets;

  const sorted = entries.sort((a, b) => {
    const aTime = Date.parse(a[1].lastUpdatedAt);
    const bTime = Date.parse(b[1].lastUpdatedAt);
    if (Number.isFinite(aTime) && Number.isFinite(bTime)) {
      return bTime - aTime;
    }
    return b[1].count - a[1].count;
  });

  return Object.fromEntries(sorted.slice(0, MAX_BUCKETS));
}

export function normalizeTitle(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return 'general';

  const tokens = normalized
    .split(' ')
    .filter((token) => token.length > 2 && !/^\d+$/.test(token))
    .slice(0, 2);
  if (tokens.length === 0) {
    return normalized.split(' ').slice(0, 1).join(' ') || 'general';
  }
  return tokens.join(' ');
}

function toBucketKey(title: string, type: TaskType): string {
  return `${type}:${normalizeTitle(title)}`;
}

export function updateDurationProfileOnCompletion(input: DurationProfileInput) {
  const plannedMinutes = Math.max(1, Math.round(input.plannedMinutes));
  const actualMinutes = Math.max(1, Math.round(input.actualMinutes));
  if (!Number.isFinite(plannedMinutes) || !Number.isFinite(actualMinutes)) return null;

  const payload = loadPayload();
  const key = toBucketKey(input.title, input.type);
  const existing = payload.buckets[key];
  const timestamp = input.completedAt ?? new Date().toISOString();

  const count = (existing?.count ?? 0) + 1;
  const avgPlanned =
    existing && existing.count > 0
      ? (existing.avgPlanned * existing.count + plannedMinutes) / count
      : plannedMinutes;
  const avgActual =
    existing && existing.count > 0
      ? (existing.avgActual * existing.count + actualMinutes) / count
      : actualMinutes;
  const correctionFactor = clamp(avgActual / Math.max(1, avgPlanned), 0.5, 2.5);

  const nextBucket: DurationProfileBucket = {
    key,
    type: input.type,
    titleBucket: normalizeTitle(input.title),
    count,
    avgPlanned,
    avgActual,
    correctionFactor,
    lastUpdatedAt: timestamp,
  };

  const nextBuckets = trimBuckets({
    ...payload.buckets,
    [key]: nextBucket,
  });

  savePayload({
    schemaVersion: SCHEMA_VERSION,
    buckets: nextBuckets,
  });

  return nextBucket;
}

export function suggestDuration(input: DurationSuggestionInput): DurationProfileSuggestion {
  const payload = loadPayload();
  const key = toBucketKey(input.title, input.type);
  const bucket = payload.buckets[key];
  if (!bucket || bucket.count < MIN_SAMPLES_FOR_SUGGESTION) {
    return {
      suggestedDurationMinutes: null,
      sampleCount: bucket?.count ?? 0,
      correctionFactor: bucket?.correctionFactor ?? null,
      bucketKey: bucket?.key ?? null,
    };
  }

  const slotMinutes = Math.max(5, Math.round(input.slotMinutes));
  const plannedMinutes = Math.max(slotMinutes, Math.round(input.plannedMinutes));
  const corrected = roundDurationToGrid(plannedMinutes * bucket.correctionFactor, slotMinutes);

  return {
    suggestedDurationMinutes: Math.max(slotMinutes, corrected),
    sampleCount: bucket.count,
    correctionFactor: bucket.correctionFactor,
    bucketKey: bucket.key,
  };
}

export function getDurationProfileBuckets(): DurationProfileBucket[] {
  const payload = loadPayload();
  return Object.values(payload.buckets).sort((a, b) => b.count - a.count);
}
