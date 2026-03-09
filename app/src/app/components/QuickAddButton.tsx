import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from './ui/button';
import AddTaskDialog from './AddTaskDialog';
import { Task, useTasks } from '../context/TaskContext';

interface QuickAddButtonProps {
  day: string;
  time: string;
  defaultAssignee?: string;
  scheduleTasks?: Task[];
  onRequestCreate?: (defaults: {
    day: string;
    time: string;
    assignee?: string;
  }) => void;
}

export default function QuickAddButton({
  day,
  time,
  defaultAssignee,
  scheduleTasks,
  onRequestCreate,
}: QuickAddButtonProps) {
  const { tasks } = useTasks();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const openTimerRef = useRef<number | null>(null);
  const effectiveScheduleTasks = scheduleTasks ?? tasks;
  const handleClick = () => {
    if (onRequestCreate) {
      onRequestCreate({
        day,
        time,
        assignee: defaultAssignee,
      });
      return;
    }
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
    }
    openTimerRef.current = window.setTimeout(() => {
      setIsDialogOpen(true);
      openTimerRef.current = null;
    }, 0);
  };

  useEffect(
    () => () => {
      if (openTimerRef.current !== null) {
        window.clearTimeout(openTimerRef.current);
      }
    },
    []
  );

  return (
    <>
      <div
        data-testid={`quick-add-cell-${day}-${time}`}
        className="group relative flex h-full w-full items-center justify-center"
      >
        <div className="pointer-events-none absolute inset-1 rounded-[12px] bg-white/[0.02] opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-hover:bg-white/[0.08]" />
        <Button
          variant="ghost"
          size="sm"
          data-testid={`quick-add-${day}-${time}`}
          onClick={handleClick}
          aria-label="Create task here"
          className="relative mx-auto h-9 min-w-9 ui-v1-radius-sm border border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-2 text-[12px] font-semibold text-[color:var(--hud-accent-soft)] opacity-0 transition-all duration-150 group-hover:opacity-60 hover:opacity-100 hover:brightness-110"
        >
          <span
            aria-hidden="true"
            data-onboarding-quick-add-glyph="true"
            className="pointer-events-none absolute inset-0 hidden items-center justify-center text-[22px] font-bold leading-none"
          >
            +
          </span>
          <Plus className="size-4" />
        </Button>
      </div>

      {!onRequestCreate && isDialogOpen && (
        <AddTaskDialog
          hideTrigger
          defaultDay={day}
          defaultTime={time}
          defaultAssignee={defaultAssignee}
          scheduleTasks={effectiveScheduleTasks}
          playSnapOnSubmit
          onClose={() => setIsDialogOpen(false)}
        />
      )}
    </>
  );
}
