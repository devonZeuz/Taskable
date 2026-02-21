import { Activity, Users } from 'lucide-react';
import { useMemo } from 'react';
import { useCloudSync } from '../context/CloudSyncContext';

export default function RealtimePresenceBadge({ compact = false }: { compact?: boolean }) {
  const { enabled, token, activeOrgId, realtimeState, syncTransport, presenceLocks, user } =
    useCloudSync();

  const otherUsers = useMemo(() => {
    const map = new Map<string, string>();
    presenceLocks.forEach((lock) => {
      if (lock.userId === user?.id) return;
      if (!map.has(lock.userId)) {
        map.set(lock.userId, lock.userName);
      }
    });
    return Array.from(map.values());
  }, [presenceLocks, user?.id]);

  if (!enabled || !token || !activeOrgId) {
    return null;
  }

  const statusLabel =
    syncTransport === 'sse'
      ? 'Live'
      : syncTransport === 'polling'
        ? 'Polling'
        : realtimeState === 'reconnecting'
          ? 'Reconnecting'
          : realtimeState === 'connecting'
            ? 'Connecting'
            : 'Offline';

  const statusTone =
    syncTransport === 'sse'
      ? 'text-emerald-300'
      : syncTransport === 'polling'
        ? 'text-amber-300'
        : 'text-[color:var(--hud-muted)]';

  const collaboratorsLabel =
    otherUsers.length === 0
      ? 'Solo'
      : `${otherUsers.length} active collaborator${otherUsers.length === 1 ? '' : 's'}`;

  return (
    <div
      data-testid="realtime-presence-badge"
      className="ui-hud-shell inline-flex h-9 items-center gap-2 rounded-[11px] px-3 text-[11px] shadow-none"
      title={otherUsers.length > 0 ? `Active: ${otherUsers.join(', ')}` : 'No active collaborators'}
    >
      <span className={`inline-flex items-center gap-1 font-semibold ${statusTone}`}>
        <Activity className="size-3.5" />
        {statusLabel}
      </span>
      {!compact && (
        <span className="inline-flex items-center gap-1 text-[color:var(--hud-muted)]">
          <Users className="size-3.5" />
          {collaboratorsLabel}
        </span>
      )}
    </div>
  );
}
