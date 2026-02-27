import type { Task } from '../context/TaskContext';
import { normalizeExecutionStatus } from './taskTimer';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_ON_TRACK_TOLERANCE_MINUTES = 10;

interface DriftBucket {
  label: string;
  startHour: number;
  endHour: number;
}

interface DriftSample {
  plannedMinutes: number;
  driftMinutes: number;
  startHour: number;
}

export interface ExecutionDriftWindow {
  label: string;
  averageDriftMinutes: number;
  sampleCount: number;
}

export interface WeeklyExecutionInsights {
  windowStartIso: string;
  windowEndIso: string;
  scheduledCount: number;
  completedCount: number;
  completionRate: number;
  reliabilityScore: number | null;
  averageDriftMinutes: number | null;
  overrunCount: number;
  underrunCount: number;
  onTrackCount: number;
  topDriftWindow: ExecutionDriftWindow | null;
}

const DRIFT_BUCKETS: DriftBucket[] = [
  { label: 'Early (00:00-05:59)', startHour: 0, endHour: 6 },
  { label: 'Morning (06:00-11:59)', startHour: 6, endHour: 12 },
  { label: 'Midday (12:00-15:59)', startHour: 12, endHour: 16 },
  { label: 'Late day (16:00-19:59)', startHour: 16, endHour: 20 },
  { label: 'Evening (20:00-23:59)', startHour: 20, endHour: 24 },
];

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function toSafeTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function startOfDay(timestampMs: number): number {
  const date = new Date(timestampMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function endOfDay(timestampMs: number): number {
  const date = new Date(timestampMs);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function getDriftBucket(hour: number): DriftBucket {
  return (
    DRIFT_BUCKETS.find((bucket) => hour >= bucket.startHour && hour < bucket.endHour) ??
    DRIFT_BUCKETS[0]
  );
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

export function buildWeeklyExecutionInsights(
  tasks: Task[],
  nowMs: number = Date.now(),
  onTrackToleranceMinutes = DEFAULT_ON_TRACK_TOLERANCE_MINUTES
): WeeklyExecutionInsights {
  const safeTolerance = Math.max(1, Math.round(onTrackToleranceMinutes));
  const windowEndMs = endOfDay(nowMs);
  const windowStartMs = startOfDay(nowMs) - (DEFAULT_LOOKBACK_DAYS - 1) * DAY_MS;

  const scheduledTasks = tasks.filter((task) => {
    if (task.type === 'block') return false;
    const startMs = toSafeTimestamp(task.startDateTime);
    if (startMs === null) return false;
    return startMs >= windowStartMs && startMs <= windowEndMs;
  });

  const completedTasks = scheduledTasks.filter(
    (task) => task.completed || normalizeExecutionStatus(task) === 'completed'
  );

  const driftSamples: DriftSample[] = completedTasks
    .map((task) => {
      const startMs = toSafeTimestamp(task.startDateTime);
      if (startMs === null) return null;
      const actualMinutes = Number(task.actualMinutes ?? 0);
      if (!Number.isFinite(actualMinutes) || actualMinutes < 0) return null;
      const plannedMinutes = Math.max(1, Math.round(task.durationMinutes));
      return {
        plannedMinutes,
        driftMinutes: actualMinutes - plannedMinutes,
        startHour: new Date(startMs).getHours(),
      };
    })
    .filter((entry): entry is DriftSample => entry !== null);

  const completionRate =
    scheduledTasks.length > 0 ? completedTasks.length / scheduledTasks.length : 0;
  const averageAdherence = average(
    driftSamples.map((sample) => {
      const scale = Math.max(sample.plannedMinutes, safeTolerance);
      return clamp01(1 - Math.abs(sample.driftMinutes) / scale);
    })
  );

  const reliabilityScore =
    scheduledTasks.length === 0
      ? null
      : Math.round((completionRate * 0.65 + (averageAdherence ?? 0) * 0.35) * 100);

  const averageDrift = average(driftSamples.map((sample) => sample.driftMinutes));
  const overrunCount = driftSamples.filter((sample) => sample.driftMinutes > safeTolerance).length;
  const underrunCount = driftSamples.filter(
    (sample) => sample.driftMinutes < -safeTolerance
  ).length;
  const onTrackCount = driftSamples.length - overrunCount - underrunCount;

  const bucketMap = new Map<string, { totalDrift: number; sampleCount: number }>();
  driftSamples.forEach((sample) => {
    const bucket = getDriftBucket(sample.startHour);
    const current = bucketMap.get(bucket.label) ?? { totalDrift: 0, sampleCount: 0 };
    bucketMap.set(bucket.label, {
      totalDrift: current.totalDrift + sample.driftMinutes,
      sampleCount: current.sampleCount + 1,
    });
  });

  const topDriftWindow = Array.from(bucketMap.entries())
    .map(([label, value]) => ({
      label,
      sampleCount: value.sampleCount,
      averageDriftMinutes: value.totalDrift / value.sampleCount,
    }))
    .filter((bucket) => bucket.averageDriftMinutes > 0)
    .sort((a, b) => {
      if (b.averageDriftMinutes === a.averageDriftMinutes) {
        return b.sampleCount - a.sampleCount;
      }
      return b.averageDriftMinutes - a.averageDriftMinutes;
    })[0];

  return {
    windowStartIso: new Date(windowStartMs).toISOString(),
    windowEndIso: new Date(windowEndMs).toISOString(),
    scheduledCount: scheduledTasks.length,
    completedCount: completedTasks.length,
    completionRate: roundToTenth(completionRate * 100) / 100,
    reliabilityScore,
    averageDriftMinutes: averageDrift === null ? null : roundToTenth(averageDrift),
    overrunCount,
    underrunCount,
    onTrackCount,
    topDriftWindow: topDriftWindow
      ? {
          label: topDriftWindow.label,
          averageDriftMinutes: roundToTenth(topDriftWindow.averageDriftMinutes),
          sampleCount: topDriftWindow.sampleCount,
        }
      : null,
  };
}
