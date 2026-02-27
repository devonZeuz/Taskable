import { roundDurationToGrid } from './taskTimer';

type TaskType = 'quick' | 'large' | 'block';

interface CompletionSample {
  key: string;
  title: string;
  type: TaskType;
  plannedMinutes: number;
  actualMinutes: number;
  startHour?: number;
  completedAt: string;
}

interface TelemetryPayload {
  schemaVersion: number;
  completionSamples: CompletionSample[];
  rescheduleCounts: Record<string, number>;
}

interface SuggestionResult {
  suggestedDurationMinutes: number | null;
  correctedDurationMinutes: number | null;
  correctionFactor: number | null;
  correctionTrend: 'overrun' | 'underrun' | 'balanced' | 'unknown';
  correctionSampleCount: number;
  durationSampleCount: number;
  suggestedWindow: { start: string; end: string } | null;
  windowSampleCount: number;
}

const STORAGE_KEY = 'taskable:task-telemetry';
const SCHEMA_VERSION = 1;
const MAX_SAMPLES = 400;

function defaultTelemetry(): TelemetryPayload {
  return {
    schemaVersion: SCHEMA_VERSION,
    completionSamples: [],
    rescheduleCounts: {},
  };
}

function normalizeKey(title: string, type: TaskType) {
  const normalizedTitle = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${type}:${normalizedTitle}`;
}

function loadTelemetry(): TelemetryPayload {
  if (typeof window === 'undefined') return defaultTelemetry();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultTelemetry();
    const parsed = JSON.parse(raw) as Partial<TelemetryPayload>;
    const completionSamples = Array.isArray(parsed.completionSamples)
      ? parsed.completionSamples.filter((entry): entry is CompletionSample => {
          return (
            typeof entry?.key === 'string' &&
            typeof entry?.title === 'string' &&
            (entry?.type === 'quick' || entry?.type === 'large' || entry?.type === 'block') &&
            typeof entry?.plannedMinutes === 'number' &&
            typeof entry?.actualMinutes === 'number' &&
            typeof entry?.completedAt === 'string'
          );
        })
      : [];
    return {
      schemaVersion: SCHEMA_VERSION,
      completionSamples,
      rescheduleCounts:
        parsed.rescheduleCounts && typeof parsed.rescheduleCounts === 'object'
          ? Object.fromEntries(
              Object.entries(parsed.rescheduleCounts).filter((entry) =>
                Number.isFinite(Number(entry[1]))
              )
            )
          : {},
    };
  } catch {
    return defaultTelemetry();
  }
}

function saveTelemetry(payload: TelemetryPayload) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

function toHourBucket(startDateTime?: string): number | undefined {
  if (!startDateTime) return undefined;
  const parsed = Date.parse(startDateTime);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).getHours();
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function formatWindowStart(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`;
}

function formatWindowEnd(hour: number) {
  return `${String((hour + 2) % 24).padStart(2, '0')}:00`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function recordTaskCompletionSample(input: {
  title: string;
  type: TaskType;
  plannedMinutes: number;
  actualMinutes: number;
  startDateTime?: string;
  completedAt: string;
}) {
  const key = normalizeKey(input.title, input.type);
  const payload = loadTelemetry();
  const nextSamples = [
    ...payload.completionSamples,
    {
      key,
      title: input.title,
      type: input.type,
      plannedMinutes: Math.max(1, input.plannedMinutes),
      actualMinutes: Math.max(0, input.actualMinutes),
      startHour: toHourBucket(input.startDateTime),
      completedAt: input.completedAt,
    },
  ];

  const trimmedSamples =
    nextSamples.length > MAX_SAMPLES
      ? nextSamples.slice(nextSamples.length - MAX_SAMPLES)
      : nextSamples;

  saveTelemetry({
    ...payload,
    completionSamples: trimmedSamples,
  });
}

export function recordTaskReschedule(input: { title: string; type: TaskType }) {
  const key = normalizeKey(input.title, input.type);
  const payload = loadTelemetry();
  const current = Number(payload.rescheduleCounts[key] ?? 0);
  saveTelemetry({
    ...payload,
    rescheduleCounts: {
      ...payload.rescheduleCounts,
      [key]: current + 1,
    },
  });
}

export function getTaskSuggestions(input: {
  title: string;
  type: TaskType;
  slotMinutes: number;
  currentDurationMinutes?: number;
}): SuggestionResult {
  const key = normalizeKey(input.title, input.type);
  const payload = loadTelemetry();
  const exactSamples = payload.completionSamples.filter((sample) => sample.key === key);
  const fallbackSamples =
    exactSamples.length > 0
      ? exactSamples
      : payload.completionSamples.filter((sample) => sample.type === input.type).slice(-30);

  const durationValues = fallbackSamples
    .map((sample) => sample.actualMinutes)
    .filter((value) => Number.isFinite(value) && value > 0);
  const durationMedian = median(durationValues);
  const sampleRatios = fallbackSamples
    .map((sample) => {
      if (!Number.isFinite(sample.plannedMinutes) || sample.plannedMinutes <= 0) return null;
      if (!Number.isFinite(sample.actualMinutes) || sample.actualMinutes <= 0) return null;
      return sample.actualMinutes / sample.plannedMinutes;
    })
    .filter((ratio): ratio is number => ratio !== null);
  const ratioMedian = median(sampleRatios);
  const correctionFactor = ratioMedian === null ? null : clamp(ratioMedian, 0.55, 2.2);
  const correctedDurationMinutes =
    correctionFactor !== null &&
    Number.isFinite(input.currentDurationMinutes) &&
    (input.currentDurationMinutes ?? 0) > 0
      ? roundDurationToGrid(
          Math.max(input.slotMinutes, (input.currentDurationMinutes ?? 0) * correctionFactor),
          input.slotMinutes
        )
      : null;
  const suggestedFromHistory =
    durationMedian === null
      ? null
      : roundDurationToGrid(Math.max(input.slotMinutes, durationMedian), input.slotMinutes);
  const suggestedDurationMinutes = correctedDurationMinutes ?? suggestedFromHistory;
  const correctionTrend =
    correctionFactor === null
      ? 'unknown'
      : correctionFactor > 1.1
        ? 'overrun'
        : correctionFactor < 0.9
          ? 'underrun'
          : 'balanced';

  const byHour = new Map<number, number>();
  fallbackSamples.forEach((sample) => {
    if (typeof sample.startHour !== 'number') return;
    byHour.set(sample.startHour, (byHour.get(sample.startHour) ?? 0) + 1);
  });

  let topHour: number | null = null;
  let topCount = 0;
  byHour.forEach((count, hour) => {
    if (count > topCount) {
      topHour = hour;
      topCount = count;
    }
  });

  return {
    suggestedDurationMinutes,
    correctedDurationMinutes,
    correctionFactor,
    correctionTrend,
    correctionSampleCount: sampleRatios.length,
    durationSampleCount: durationValues.length,
    suggestedWindow:
      topHour === null
        ? null
        : {
            start: formatWindowStart(topHour),
            end: formatWindowEnd(topHour),
          },
    windowSampleCount: topCount,
  };
}
