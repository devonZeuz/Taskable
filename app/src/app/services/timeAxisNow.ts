import type { WorkdayHours } from './scheduling';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getMinutesSinceMidnightInTimeZone(date: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
    return clamp(hour * 60 + minute, 0, 24 * 60 - 1);
  } catch {
    return date.getHours() * 60 + date.getMinutes();
  }
}

export function getNowAxisOffsetPx({
  nowMinutes,
  workday,
  hourWidth,
  hourGap,
}: {
  nowMinutes: number;
  workday: WorkdayHours;
  hourWidth: number;
  hourGap: number;
}): number {
  const workStartMinutes = workday.startHour * 60;
  const workdayMinutes = Math.max(0, (workday.endHour - workday.startHour) * 60);
  const hourSpanCount = Math.max(1, Math.ceil(workdayMinutes / 60));
  const clampedOffsetMinutes = clamp(nowMinutes - workStartMinutes, 0, workdayMinutes);
  const completedHours = Math.min(
    Math.floor(clampedOffsetMinutes / 60),
    Math.max(0, hourSpanCount - 1)
  );
  const offsetRatio = clampedOffsetMinutes / 60;
  return offsetRatio * hourWidth + completedHours * hourGap;
}

export function centerScrollLeft({
  container,
  targetX,
  behavior,
}: {
  container: HTMLElement;
  targetX: number;
  behavior: ScrollBehavior;
}): number {
  const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
  const targetLeft = clamp(targetX - container.clientWidth / 2, 0, maxLeft);
  if (behavior === 'auto') {
    container.scrollLeft = targetLeft;
  } else {
    container.scrollTo({ left: targetLeft, behavior });
  }
  return targetLeft;
}
