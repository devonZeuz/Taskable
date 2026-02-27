import { AlertTriangle } from 'lucide-react';
import { useCloudSync } from '../context/CloudSyncContext';
import { Button } from './ui/button';

export default function ConflictResolutionBanner() {
  const { conflicts, openConflictResolver } = useCloudSync();
  const primaryConflict = conflicts[0] ?? null;

  if (!primaryConflict) return null;

  const additionalConflicts = Math.max(0, conflicts.length - 1);

  return (
    <div className="px-3 pb-2 md:px-5" data-testid="conflict-lock-banner">
      <div className="ui-alert-block flex items-center justify-between gap-3 ui-v1-radius-sm px-3 py-2.5">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[12px] font-semibold">
            <AlertTriangle className="size-4 shrink-0" />
            Task edits are locked until conflict resolution
          </p>
          <p className="mt-0.5 truncate text-[11px] opacity-90">
            {primaryConflict.title}
            {additionalConflicts > 0
              ? ` (+${additionalConflicts} more conflict${additionalConflicts === 1 ? '' : 's'})`
              : ''}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          className="h-8 shrink-0 ui-v1-radius-sm px-3 text-[11px] font-semibold"
          onClick={() => openConflictResolver(primaryConflict.taskId)}
        >
          Resolve
        </Button>
      </div>
    </div>
  );
}
