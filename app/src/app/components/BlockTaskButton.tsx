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

  const handleCreateBlock = () => {
    const now = new Date();
    const todayKey = getDayKey(now);
    const durationMinutes = Math.max(slotMinutes, Math.round(60 / slotMinutes) * slotMinutes);
    const startMinute = workday.startHour * 60;
    const endMinute = workday.endHour * 60;
    const maxStartMinute = Math.max(startMinute, endMinute - durationMinutes);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const clampedCurrent = Math.max(startMinute, Math.min(maxStartMinute, currentMinutes));
    const snappedStartMinute =
      startMinute + Math.floor((clampedCurrent - startMinute) / slotMinutes) * slotMinutes;

    const todaySlot = findNextAvailableSlotAfter(
      scheduleScopeTasks,
      todayKey,
      durationMinutes,
      snappedStartMinute,
      undefined,
      workday
    );
    const fallbackSlot =
      todaySlot ??
      findNextAvailableSlot(scheduleScopeTasks, todayKey, durationMinutes, undefined, workday);

    if (!fallbackSlot) {
      toast.error('No room left in the current workday for a block.');
      return;
    }

    const assignedToValue =
      defaultAssignee === 'unassigned' || defaultAssignee === 'all' ? undefined : defaultAssignee;

    addTask({
      title: 'BLOCK',
      description: '',
      startDateTime: combineDayAndTime(todayKey, fallbackSlot.startTime).toISOString(),
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

    toast.success(`Block placed at ${fallbackSlot.startTime}.`);
  };

  return (
    <Button
      type="button"
      data-testid="add-block-trigger"
      onClick={handleCreateBlock}
      variant="ghost"
      className="planner-control h-9 gap-2 ui-v1-radius-sm border border-[color:var(--hud-border)] bg-black/85 px-3 text-white hover:bg-black"
    >
      <StopCircle className="size-4" />
      Block
    </Button>
  );
}
