import { useMemo, useState, type DragEvent } from 'react';
import { useDrop } from 'react-dnd';
import { toast } from 'sonner';
import { Task, useTasks } from '../context/TaskContext';
import TaskCard from './TaskCard';
import { hasExternalPayload, parseExternalDrop } from '../services/externalDrop';
import { recordOperationalEvent } from '../services/operationalTelemetry';

interface InboxPanelProps {
  title?: string;
  tasks: Task[];
  onEdit: (task: Task) => void;
  variant?: 'default' | 'sidebar';
}

export default function InboxPanel({
  title = 'Inbox',
  tasks,
  onEdit,
  variant = 'default',
}: InboxPanelProps) {
  const { tasks: allTasks, unscheduleTask, addTask } = useTasks();
  const [externalDragOver, setExternalDragOver] = useState(false);
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
  const isSidebar = variant === 'sidebar';

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
      subtasks: [],
      type: 'quick',
      assignedTo: undefined,
      completed: false,
      status: 'inbox',
      executionStatus: 'idle',
      actualMinutes: 0,
      version: 0,
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
      className={`ui-hud-panel ui-v1-radius-lg border border-[color:var(--hud-border)] ${
        isSidebar ? 'flex min-h-0 flex-1 flex-col px-3 py-3' : 'px-5 py-4'
      } ${highlighted ? 'ring-2 ring-[color:var(--hud-outline)]' : ''}`}
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
        <div
          className={
            isSidebar
              ? 'mt-3 min-h-0 space-y-2 overflow-y-auto pr-1'
              : 'mt-3 flex gap-3 overflow-x-auto pb-2'
          }
        >
          {visibleTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onEdit={onEdit}
              blockHeight={isSidebar ? 126 : 148}
              blockWidth={isSidebar ? 228 : 250}
              blockStyle={{
                minWidth: isSidebar ? '100%' : '250px',
                maxWidth: isSidebar ? '100%' : '250px',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
