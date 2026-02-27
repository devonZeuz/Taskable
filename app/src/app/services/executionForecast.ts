import type { Task } from '../context/TaskContext';
import { getDayKey, getDayKeyFromDateTime, getWorkdayMinutes } from './scheduling';
import { normalizeExecutionStatus } from './taskTimer';

const DAY_MS = 24 * 60 * 60 * 1000;
const HEATMAP_LOOKBACK_DAYS = 28;
const OVERRUN_THRESHOLD_MINUTES = 10;

interface WorkdayWindow {
  startHour: number;
  endHour: number;
}

export interface WeeklyOverloadDay {
  dayKey: string;
  plannedMinutes: number;
  capacityMinutes: number;
  overloadMinutes: number;
}

export interface OverrunHeatmapCell {
  label: string;
  overrunCount: number;
  sampleCount: number;
  averageOverrunMinutes: number;
}

export interface WeeklyExecutionForecast {
  weeklyOverloadMinutes: number;
  overloadedDays: number;
  peakOverloadDay: WeeklyOverloadDay | null;
  overloadByDay: WeeklyOverloadDay[];
  overrunHeatmap: OverrunHeatmapCell[];
}

interface HeatmapBucket {
  label: string;
  startHour: number;
  endHour: number;
}

const HEATMAP_BUCKETS: HeatmapBucket[] = [
  { label: 'Morning (06:00-11:59)', startHour: 6, endHour: 12 },
  { label: 'Midday (12:00-15:59)', startHour: 12, endHour: 16 },
  { label: 'Late day (16:00-19:59)', startHour: 16, endHour: 20 },
  { label: 'Evening (20:00-23:59)', startHour: 20, endHour: 24 },
  { label: 'Overnight (00:00-05:59)', startHour: 0, endHour: 6 },
];

function startOfDay(timestampMs: number) {
  const date = new Date(timestampMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function roundToTenth(value: number) {
  return Math.round(value * 10) / 10;
}

function getBucketForHour(hour: number): HeatmapBucket {
  return (
    HEATMAP_BUCKETS.find((bucket) => hour >= bucket.startHour && hour < bucket.endHour) ??
    HEATMAP_BUCKETS[0]
  );
}

export function buildWeeklyExecutionForecast(
  tasks: Task[],
  workday: WorkdayWindow,
  nowMs: number = Date.now()
): WeeklyExecutionForecast {
  const todayStartMs = startOfDay(nowMs);
  const capacityMinutes = getWorkdayMinutes(workday);

  const overloadByDay: WeeklyOverloadDay[] = Array.from({ length: 7 }, (_, offset) => {
    const dayDate = new Date(todayStartMs + offset * DAY_MS);
    const dayKey = getDayKey(dayDate);
    const plannedMinutes = tasks.reduce((total, task) => {
      if (task.type === 'block') return total;
      if (task.completed || normalizeExecutionStatus(task) === 'completed') return total;
      if (!task.startDateTime || task.status === 'inbox') return total;
      if (getDayKeyFromDateTime(task.startDateTime) !== dayKey) return total;
      return total + Math.max(0, task.durationMinutes);
    }, 0);
    const overloadMinutes = Math.max(0, plannedMinutes - capacityMinutes);
    return {
      dayKey,
      plannedMinutes,
      capacityMinutes,
      overloadMinutes,
    };
  });

  const weeklyOverloadMinutes = overloadByDay.reduce(
    (total, day) => total + day.overloadMinutes,
    0
  );
  const overloadedDays = overloadByDay.filter((day) => day.overloadMinutes > 0).length;
  const peakOverloadDay =
    overloadByDay
      .filter((day) => day.overloadMinutes > 0)
      .sort((a, b) => b.overloadMinutes - a.overloadMinutes)[0] ?? null;

  const heatmapStartMs = todayStartMs - (HEATMAP_LOOKBACK_DAYS - 1) * DAY_MS;
  const heatmapBuckets = new Map<
    string,
    { overrunTotal: number; overrunCount: number; sampleCount: number }
  >();

  tasks.forEach((task) => {
    if (task.type === 'block') return;
    if (!task.startDateTime || task.status === 'inbox') return;
    if (!(task.completed || normalizeExecutionStatus(task) === 'completed')) return;

    const startMs = Date.parse(task.startDateTime);
    if (!Number.isFinite(startMs) || startMs < heatmapStartMs || startMs > nowMs) return;

    const actualMinutes = Number(task.actualMinutes ?? 0);
    if (!Number.isFinite(actualMinutes) || actualMinutes < 0) return;
    const plannedMinutes = Math.max(1, Math.round(task.durationMinutes));
    const driftMinutes = actualMinutes - plannedMinutes;
    const bucket = getBucketForHour(new Date(startMs).getHours());
    const current = heatmapBuckets.get(bucket.label) ?? {
      overrunTotal: 0,
      overrunCount: 0,
      sampleCount: 0,
    };

    heatmapBuckets.set(bucket.label, {
      overrunTotal:
        current.overrunTotal + (driftMinutes > OVERRUN_THRESHOLD_MINUTES ? driftMinutes : 0),
      overrunCount: current.overrunCount + (driftMinutes > OVERRUN_THRESHOLD_MINUTES ? 1 : 0),
      sampleCount: current.sampleCount + 1,
    });
  });

  const overrunHeatmap = Array.from(heatmapBuckets.entries())
    .map(([label, bucket]) => ({
      label,
      overrunCount: bucket.overrunCount,
      sampleCount: bucket.sampleCount,
      averageOverrunMinutes:
        bucket.overrunCount > 0 ? roundToTenth(bucket.overrunTotal / bucket.overrunCount) : 0,
    }))
    .filter((bucket) => bucket.sampleCount > 0)
    .sort((a, b) => {
      if (b.overrunCount === a.overrunCount) {
        return b.averageOverrunMinutes - a.averageOverrunMinutes;
      }
      return b.overrunCount - a.overrunCount;
    });

  return {
    weeklyOverloadMinutes,
    overloadedDays,
    peakOverloadDay,
    overloadByDay,
    overrunHeatmap,
  };
}
