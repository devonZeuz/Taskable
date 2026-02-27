import { useMemo } from 'react';
import { Gauge } from 'lucide-react';
import { useWorkday } from '../context/WorkdayContext';
import type { Task } from '../context/TaskContext';
import { getDayKey, getDayKeyFromDateTime, getWorkdayMinutes } from '../services/scheduling';

interface CapacityBarProps {
  tasks: Task[];
}

function formatMinutes(minutes: number): string {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}

export default function CapacityBar({ tasks }: CapacityBarProps) {
  const { workday } = useWorkday();
  const todayKey = getDayKey(new Date());

  const plannedMinutes = useMemo(
    () =>
      tasks.reduce((total, task) => {
        if (!task.startDateTime || task.status === 'inbox') return total;
        if (task.completed) return total;
        if (getDayKeyFromDateTime(task.startDateTime) !== todayKey) return total;
        return total + Math.max(0, task.durationMinutes);
      }, 0),
    [tasks, todayKey]
  );

  const capacityMinutes = useMemo(() => getWorkdayMinutes(workday), [workday]);
  const usageRatio = capacityMinutes > 0 ? plannedMinutes / capacityMinutes : 0;
  const usagePercent = Math.max(0, Math.min(100, usageRatio * 100));
  const overloaded = plannedMinutes > capacityMinutes;

  return (
    <section
      data-testid="capacity-bar-panel"
      className="ui-hud-panel ui-v1-radius-lg border border-[color:var(--hud-border)] p-3"
    >
      <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--hud-text)]">
        <Gauge className="size-4 text-[var(--hud-muted)]" />
        Capacity
      </div>
      <p className="mt-1 text-xs text-[var(--hud-muted)]">
        Planned {formatMinutes(plannedMinutes)} of {formatMinutes(capacityMinutes)}
      </p>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full border border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)]"
        data-testid="capacity-bar-track"
      >
        <div
          className="h-full rounded-full bg-[var(--hud-accent-bg)] transition-[width] duration-200"
          data-testid="capacity-bar-fill"
          style={{ width: `${usagePercent}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-[var(--hud-muted)]">
        {overloaded
          ? `Overloaded by ${formatMinutes(plannedMinutes - capacityMinutes)}`
          : `${Math.round(usagePercent)}% planned`}
      </p>
    </section>
  );
}
