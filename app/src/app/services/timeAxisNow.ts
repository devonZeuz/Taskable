import { minutesToTime, type WorkdayHours } from './scheduling';

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
  timelineStartMinutes,
  timelineDurationMinutes,
}: {
  nowMinutes: number;
  workday: WorkdayHours;
  hourWidth: number;
  hourGap: number;
  timelineStartMinutes?: number;
  timelineDurationMinutes?: number;
}): number {
  const fallbackStartMinutes = workday.startHour * 60;
  const fallbackDurationMinutes = Math.max(0, (workday.endHour - workday.startHour) * 60);
  const axisStartMinutes = timelineStartMinutes ?? fallbackStartMinutes;
  const axisDurationMinutes = Math.max(1, timelineDurationMinutes ?? fallbackDurationMinutes);
  const hourSpanCount = Math.max(1, Math.ceil(axisDurationMinutes / 60));
  const clampedOffsetMinutes = clamp(nowMinutes - axisStartMinutes, 0, axisDurationMinutes);
  const completedHours = Math.min(
    Math.floor(clampedOffsetMinutes / 60),
    Math.max(0, hourSpanCount - 1)
  );
  const offsetRatio = clampedOffsetMinutes / 60;
  return offsetRatio * hourWidth + completedHours * hourGap;
}

export function getTimelineTimeSlots({
  slotMinutes,
  workday,
  nowMinutes,
}: {
  slotMinutes: number;
  workday: WorkdayHours;
  nowMinutes: number;
}): string[] {
  const normalizedSlotMinutes = Math.max(5, slotMinutes);
  void workday;
  void nowMinutes;
  const axisStartMinutes = 0;
  const axisEndMinutes = 24 * 60;

  const slots: string[] = [];
  for (let minutes = axisStartMinutes; minutes < axisEndMinutes; minutes += normalizedSlotMinutes) {
    slots.push(minutesToTime(minutes));
  }
  return slots;
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
