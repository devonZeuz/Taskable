import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from './ui/button';
import AddTaskDialog from './AddTaskDialog';
import { Task, useTasks } from '../context/TaskContext';
import { combineDayAndTime } from '../services/scheduling';

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
  const { addTask } = useTasks();
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const handleQuickCreate = () => {
    const assignedToValue =
      defaultAssignee === 'unassigned' || defaultAssignee === 'all' ? undefined : defaultAssignee;
    const created = addTask({
      title: 'New Task',
      description: '',
      startDateTime: combineDayAndTime(day, time).toISOString(),
      durationMinutes: 60,
      subtasks: [],
      type: 'quick',
      assignedTo: assignedToValue,
      completed: false,
      status: 'scheduled',
      executionStatus: 'idle',
      actualMinutes: 0,
      version: 0,
    });
    setEditingTask(created);
  };

  return (
    <>
      <div className="flex h-full w-full items-center justify-center opacity-0 transition-opacity hover:opacity-100">
        <Button
          variant="ghost"
          size="sm"
          data-testid={`quick-add-${day}-${time}`}
          onClick={handleQuickCreate}
          className="mx-auto h-9 min-w-[108px] ui-v1-radius-sm border border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-3 text-[12px] font-semibold text-[color:var(--hud-accent-soft)] hover:brightness-110"
        >
          <Plus className="size-4" />
          Add Task
        </Button>
      </div>

      {editingTask && (
        <AddTaskDialog
          editTask={editingTask}
          defaultAssignee={defaultAssignee}
          scheduleTasks={scheduleTasks}
          playSnapOnSubmit
          onClose={() => setEditingTask(null)}
        />
      )}
    </>
  );
}
