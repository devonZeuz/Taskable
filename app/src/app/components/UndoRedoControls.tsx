import { RotateCcw, RotateCw } from 'lucide-react';
import { useTasks } from '../context/TaskContext';
import { Button } from './ui/button';

export default function UndoRedoControls() {
  const { undo, redo, canUndo, canRedo } = useTasks();

  return (
    <div className="planner-control flex h-9 items-center gap-1 ui-v1-radius-sm border border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={!canUndo}
        onClick={undo}
        className="planner-control h-7 gap-1 ui-v1-radius-sm px-2 text-[11px] text-[color:var(--hud-text)] opacity-80 hover:bg-[var(--hud-surface-soft)] hover:opacity-100 disabled:opacity-40"
      >
        <RotateCcw className="size-3.5" />
        Undo
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={!canRedo}
        onClick={redo}
        className="planner-control h-7 gap-1 ui-v1-radius-sm px-2 text-[11px] text-[color:var(--hud-text)] opacity-80 hover:bg-[var(--hud-surface-soft)] hover:opacity-100 disabled:opacity-40"
      >
        <RotateCw className="size-3.5" />
        Redo
      </Button>
    </div>
  );
}
