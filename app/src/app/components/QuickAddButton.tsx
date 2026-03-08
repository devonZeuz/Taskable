import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from './ui/button';
import AddTaskDialog from './AddTaskDialog';
import { Task, useTasks } from '../context/TaskContext';

interface QuickAddButtonProps {
  day: string;
  time: string;
  defaultAssignee?: string;
  scheduleTasks?: Task[];
}

export default function QuickAddButton({
  day,
  time,
  defaultAssignee,
  scheduleTasks,
}: QuickAddButtonProps) {
  const { tasks } = useTasks();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const effectiveScheduleTasks = scheduleTasks ?? tasks;

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
          onClick={() => setIsDialogOpen(true)}
          aria-label="Create task here"
          className="mx-auto h-9 min-w-9 ui-v1-radius-sm border border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-2 text-[12px] font-semibold text-[color:var(--hud-accent-soft)] opacity-0 transition-all duration-150 group-hover:opacity-60 hover:opacity-100 hover:brightness-110"
        >
          <Plus className="size-4" />
        </Button>
      </div>

      {isDialogOpen && (
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
