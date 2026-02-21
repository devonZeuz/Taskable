import { useMemo, useState, type DragEvent } from 'react';
import { useDrop } from 'react-dnd';
import { toast } from 'sonner';
import { Task, useTasks } from '../context/TaskContext';
import { APP_THEME_TASK_SWATCHES, useAppTheme } from '../context/AppThemeContext';
import TaskCard from './TaskCard';
import { hasExternalPayload, parseExternalDrop } from '../services/externalDrop';
import { recordOperationalEvent } from '../services/operationalTelemetry';

interface InboxPanelProps {
  title?: string;
  tasks: Task[];
  onEdit: (task: Task) => void;
}

export default function InboxPanel({ title = 'Inbox', tasks, onEdit }: InboxPanelProps) {
  const { tasks: allTasks, unscheduleTask, addTask } = useTasks();
  const { theme } = useAppTheme();
  const [externalDragOver, setExternalDragOver] = useState(false);
  const defaultInboxColor = APP_THEME_TASK_SWATCHES[theme][0]?.value ?? '#8d929c';
  const [{ isOver }, drop] = useDrop(
    () => ({
      accept: 'TASK',
      drop: (item: { id: string }) => {
        const task = allTasks.find((entry) => entry.id === item.id);
        if (!task) return;
        if (!task.startDateTime) return;
        unscheduleTask(task.id);
        toast.success('Moved to inbox.');
      },
      collect: (monitor) => ({
        isOver: monitor.isOver(),
      }),
    }),
    [allTasks, unscheduleTask]
  );

  const visibleTasks = useMemo(() => tasks.filter((task) => !task.startDateTime), [tasks]);
  const highlighted = isOver || externalDragOver;

  const handleNativeDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasExternalPayload(event.dataTransfer)) return;
    event.preventDefault();
    setExternalDragOver(true);
  };

  const handleNativeDragLeave = (event: DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setExternalDragOver(false);
  };

  const handleNativeDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasExternalPayload(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    setExternalDragOver(false);

    const capture = parseExternalDrop(event.dataTransfer);
    if (!capture) {
      toast.error('Could not capture a title from that drop.');
      recordOperationalEvent({
        eventType: 'outlook.import.fail',
        source: 'external-drop',
        metadata: { surface: 'inbox' },
      });
      return;
    }

    const created = addTask({
      title: capture.title,
      description: capture.description ?? '',
      startDateTime: undefined,
      durationMinutes: 60,
      color: defaultInboxColor,
      subtasks: [],
      type: 'quick',
      assignedTo: undefined,
      completed: false,
      status: 'inbox',
      executionStatus: 'idle',
      actualMinutes: 0,
    });

    toast.success('Captured into inbox.');
    recordOperationalEvent({
      eventType: 'outlook.import.success',
      source: 'external-drop',
      metadata: { surface: 'inbox' },
    });
    onEdit(created);
  };

  return (
    <div
      ref={drop}
      data-testid="inbox-panel"
      onDragOver={handleNativeDragOver}
      onDragLeave={handleNativeDragLeave}
      onDrop={handleNativeDrop}
      className={`ui-hud-panel rounded-[18px] px-5 py-4 ${
        highlighted ? 'ring-2 ring-[color:var(--hud-outline)]' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-[color:var(--hud-text)]">{title}</h3>
          <p className="text-xs font-medium text-[color:var(--hud-muted)]">To schedule</p>
        </div>
        <div className="ui-hud-chip rounded-full px-3 py-1 text-xs font-semibold">
          {visibleTasks.length} tasks
        </div>
      </div>

      {visibleTasks.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-[color:var(--hud-border)] px-4 py-6 text-sm text-[color:var(--hud-muted)]">
          Drop tasks here to move them into the inbox. You can also drop email text/subject to
          create a new inbox task.
        </div>
      ) : (
        <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
          {visibleTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onEdit={onEdit}
              blockHeight={148}
              blockWidth={250}
              blockStyle={{
                minWidth: '250px',
                maxWidth: '250px',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
