import { StopCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Task, useTasks } from '../context/TaskContext';
import { type AppTheme, useAppTheme } from '../context/AppThemeContext';
import { useWorkday } from '../context/WorkdayContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import {
  combineDayAndTime,
  findNextAvailableSlot,
  findNextAvailableSlotAfter,
  getDayKey,
} from '../services/scheduling';
import { playCalendarSnapSound } from '../services/uiSounds';

interface BlockTaskButtonProps {
  defaultAssignee?: string;
  scheduleTasks?: Task[];
}

const BLOCK_COLOR_BY_THEME: Record<AppTheme, string> = {
  default: '#121216',
  mono: '#050506',
  white: '#111216',
  'sugar-plum': '#0f0f13',
  'vibrant-pop': '#0d1020',
};

const BLOCK_BUTTON_ACCENT_BY_THEME: Record<AppTheme, string> = {
  default: '#b7f700',
  mono: '#f3f3f5',
  white: '#1c1b1f',
  'sugar-plum': '#f0c7dd',
  'vibrant-pop': '#b7f700',
};

export default function BlockTaskButton({ defaultAssignee, scheduleTasks }: BlockTaskButtonProps) {
  const { addTask, tasks } = useTasks();
  const { workday } = useWorkday();
  const { theme } = useAppTheme();
  const {
    preferences: { slotMinutes, soundEffectsEnabled },
  } = useUserPreferences();

  const scheduleScopeTasks = scheduleTasks ?? tasks;
  const blockColor = BLOCK_COLOR_BY_THEME[theme];
  const blockButtonAccent = BLOCK_BUTTON_ACCENT_BY_THEME[theme];

  const handleCreateBlock = () => {
    const now = new Date();
    const todayKey = getDayKey(now);
    const durationMinutes = Math.max(slotMinutes, Math.round(60 / slotMinutes) * slotMinutes);
    const startMinute = workday.startHour * 60;
    const endMinute = workday.endHour * 60;
    const latestStartMinute = Math.max(startMinute, endMinute - durationMinutes);
    const roundedNowMinutes =
      Math.round((now.getHours() * 60 + now.getMinutes()) / slotMinutes) * slotMinutes;
    const nowFitsWorkday =
      roundedNowMinutes >= startMinute && roundedNowMinutes + durationMinutes <= endMinute;
    const startSearchMinute = nowFitsWorkday ? roundedNowMinutes : startMinute;
    const fallbackSlot = findNextAvailableSlotAfter(
      scheduleScopeTasks,
      todayKey,
      durationMinutes,
      Math.min(latestStartMinute, startSearchMinute),
      undefined,
      workday
    );

    const beforeWorkday =
      roundedNowMinutes < startMinute || roundedNowMinutes + durationMinutes > endMinute;
    const nextWorkdaySlot =
      beforeWorkday && !fallbackSlot
        ? findNextAvailableSlot(scheduleScopeTasks, todayKey, durationMinutes, undefined, workday)
        : null;
    const selectedSlot = fallbackSlot ?? nextWorkdaySlot;

    if (!selectedSlot) {
      toast.error('No room left in the current workday for a block.');
      return;
    }

    const assignedToValue =
      defaultAssignee === 'unassigned' || defaultAssignee === 'all' ? undefined : defaultAssignee;

    addTask({
      title: 'Block',
      description: '',
      startDateTime: combineDayAndTime(todayKey, selectedSlot.startTime).toISOString(),
      durationMinutes,
      color: blockColor,
      subtasks: [],
      type: 'block',
      assignedTo: assignedToValue,
      completed: false,
      status: 'scheduled',
      executionStatus: 'idle',
      actualMinutes: 0,
      version: 0,
    });

    if (soundEffectsEnabled) {
      playCalendarSnapSound();
    }

    toast.success(`Block placed at ${selectedSlot.startTime}.`);
  };

  return (
    <Button
      type="button"
      data-testid="add-block-trigger"
      onClick={handleCreateBlock}
      variant="ghost"
      className="planner-control h-9 gap-2 rounded-[11px] border px-3.5 text-[12px] font-semibold tracking-[-0.01em] shadow-[0_8px_18px_rgba(0,0,0,0.34)] transition-all hover:brightness-110"
      style={{
        backgroundColor: '#0f1013',
        borderColor: `color-mix(in srgb, ${blockButtonAccent} 24%, rgba(255,255,255,0.2))`,
        color: blockButtonAccent,
      }}
    >
      <span
        className="inline-flex size-4 items-center justify-center rounded-full border"
        style={{
          borderColor: `color-mix(in srgb, ${blockButtonAccent} 40%, transparent)`,
          backgroundColor: `color-mix(in srgb, ${blockButtonAccent} 16%, transparent)`,
        }}
      >
        <StopCircle className="size-3" />
      </span>
      Block
    </Button>
  );
}
