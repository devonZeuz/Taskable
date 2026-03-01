import { NotebookText } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getDayKey } from '../services/scheduling';
import { Textarea } from './ui/textarea';

const STORAGE_PREFIX = 'taskable:today-note:';

export default function TodayNotePanel() {
  const todayKey = useMemo(() => getDayKey(new Date()), []);
  const storageKey = `${STORAGE_PREFIX}${todayKey}`;
  const initialValue = useMemo(() => {
    try {
      return localStorage.getItem(storageKey) ?? '';
    } catch {
      return '';
    }
  }, [storageKey]);
  const [value, setValue] = useState(initialValue);
  const [isEditing, setIsEditing] = useState(() => initialValue.trim().length === 0);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, value);
    } catch {
      // Ignore storage persistence failures.
    }
  }, [storageKey, value]);

  const trimmedValue = value.trim();

  return (
    <section
      data-testid="today-note-panel"
      className="ui-hud-panel ui-v1-radius-lg flex min-h-[176px] flex-col border border-[color:var(--hud-border)] p-3"
    >
      <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--hud-text)]">
        <NotebookText className="size-4 text-[var(--hud-muted)]" />
        Today note
      </div>
      <p className="mt-1 text-xs text-[var(--hud-muted)]">Keep one short intent for the day.</p>
      {isEditing || trimmedValue.length === 0 ? (
        <Textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => {
            if (value.trim().length > 0) {
              setIsEditing(false);
            }
          }}
          placeholder="What must be true by end of day?"
          className="mt-2 min-h-[92px] resize-none border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] text-[13px] text-[var(--hud-text)] placeholder:text-[var(--hud-muted)]"
        />
      ) : (
        <button
          type="button"
          data-testid="today-note-chip"
          onClick={() => setIsEditing(true)}
          className="mt-auto inline-flex w-full items-center justify-between gap-2 rounded-full border border-[color:var(--hud-border)] bg-[var(--hud-chip-neutral-bg)] px-3 py-2 text-left text-[12px] text-[var(--hud-text)] hover:brightness-105"
          aria-label="Edit today's note"
          title="Edit today's note"
        >
          <span className="truncate">{trimmedValue}</span>
          <span className="shrink-0 text-[11px] font-semibold text-[var(--hud-accent-text)]">
            Edit
          </span>
        </button>
      )}
    </section>
  );
}
