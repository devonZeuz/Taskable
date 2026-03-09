import type { Task } from '../context/TaskContext';
import { buildForwardShovePlan, countOverlapsAtTarget, type ShoveMove } from './shovePlanning';
import { combineDayAndTime, getDayKeyFromDateTime, minutesToTime } from './scheduling';
import { getDurationToNow } from './taskTimer';

interface WorkdayWindow {
  startHour: number;
  endHour: number;
}

type AdaptiveExtendReason =
  | 'unscheduled'
  | 'no_change'
  | 'outside_workday'
  | 'conflict'
  | 'blocked'
  | 'extended'
  | 'extended_with_shove';

export interface AdaptiveExtendPlan {
  reason: AdaptiveExtendReason;
  dayKey: string | null;
  startMinutes: number | null;
  nextDurationMinutes: number;
  overlapCount: number;
  shoveMoves: ShoveMove[] | null;
}

export function buildAdaptiveExtendPlan(
  tasks: Task[],
  task: Task,
  nowMs: number,
  slotMinutes: number,
  workday: WorkdayWindow
): AdaptiveExtendPlan {
  if (!task.startDateTime || task.status === 'inbox') {
    return {
      reason: 'unscheduled',
      dayKey: null,
      startMinutes: null,
      nextDurationMinutes: task.durationMinutes,
      overlapCount: 0,
      shoveMoves: null,
    };
  }

  const nextDurationMinutes = getDurationToNow(task, nowMs, slotMinutes);
  if (nextDurationMinutes <= task.durationMinutes) {
    return {
      reason: 'no_change',
      dayKey: getDayKeyFromDateTime(task.startDateTime),
      startMinutes: toStartMinutes(task.startDateTime),
      nextDurationMinutes: task.durationMinutes,
      overlapCount: 0,
      shoveMoves: null,
    };
  }

  const dayKey = getDayKeyFromDateTime(task.startDateTime);
  const startMinutes = toStartMinutes(task.startDateTime);
  const dayStartMinutes = 0;
  const dayEndMinutes = 24 * 60;

  if (startMinutes < dayStartMinutes || startMinutes + nextDurationMinutes > dayEndMinutes) {
    return {
      reason: 'outside_workday',
      dayKey,
      startMinutes,
      nextDurationMinutes,
      overlapCount: 0,
      shoveMoves: null,
    };
  }

  const overlapCount = countOverlapsAtTarget(
    tasks,
    dayKey,
    startMinutes,
    nextDurationMinutes,
    task.id
  );
  const shoveMoves =
    overlapCount > 0
      ? buildForwardShovePlan(
          tasks,
          dayKey,
          startMinutes,
          nextDurationMinutes,
          task.id,
          workday,
          slotMinutes
        )
      : [];

  return {
    reason: overlapCount > 0 ? 'conflict' : 'extended',
    dayKey,
    startMinutes,
    nextDurationMinutes,
    overlapCount,
    shoveMoves,
  };
}

export interface ApplyAdaptiveExtendInput {
  plan: AdaptiveExtendPlan;
  taskId: string;
  autoShoveOnExtend: boolean;
  setDuration: (taskId: string, durationMinutes: number) => void;
  moveTask: (taskId: string, startDateTime: string) => void;
}

export interface ApplyAdaptiveExtendResult {
  outcome: AdaptiveExtendReason;
  shovedCount: number;
}

export function applyAdaptiveExtendPlan(
  input: ApplyAdaptiveExtendInput
): ApplyAdaptiveExtendResult {
  const { plan, taskId, autoShoveOnExtend, setDuration, moveTask } = input;

  if (
    plan.reason === 'unscheduled' ||
    plan.reason === 'no_change' ||
    plan.reason === 'outside_workday'
  ) {
    return { outcome: plan.reason, shovedCount: 0 };
  }

  if (plan.overlapCount === 0) {
    setDuration(taskId, plan.nextDurationMinutes);
    return { outcome: 'extended', shovedCount: 0 };
  }

  if (!autoShoveOnExtend) {
    return { outcome: 'conflict', shovedCount: 0 };
  }

  if (!plan.dayKey || plan.startMinutes === null || plan.shoveMoves === null) {
    return { outcome: 'blocked', shovedCount: 0 };
  }

  plan.shoveMoves.forEach((move) => {
    moveTask(
      move.task.id,
      combineDayAndTime(plan.dayKey as string, minutesToTime(move.toStartMinutes)).toISOString()
    );
  });
  setDuration(taskId, plan.nextDurationMinutes);
  return { outcome: 'extended_with_shove', shovedCount: plan.shoveMoves.length };
}

function toStartMinutes(startDateTime: string) {
  const startDate = new Date(startDateTime);
  return startDate.getHours() * 60 + startDate.getMinutes();
}
