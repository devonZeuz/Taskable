import { NotebookText } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getDayKey } from '../services/scheduling';
import { Textarea } from './ui/textarea';

const STORAGE_PREFIX = 'taskable:today-note:';

export default function TodayNotePanel() {
  const todayKey = useMemo(() => getDayKey(new Date()), []);
  const storageKey = `${STORAGE_PREFIX}${todayKey}`;
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(storageKey) ?? '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, value);
    } catch {
      // Ignore storage persistence failures.
    }
  }, [storageKey, value]);

  return (
    <section
      data-testid="today-note-panel"
      className="ui-hud-panel ui-v1-radius-lg border border-[color:var(--hud-border)] p-3"
    >
      <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--hud-text)]">
        <NotebookText className="size-4 text-[var(--hud-muted)]" />
        Today note
      </div>
      <p className="mt-1 text-xs text-[var(--hud-muted)]">Keep one short intent for the day.</p>
      <Textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="What must be true by end of day?"
        className="mt-2 min-h-[92px] resize-none border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] text-[13px] text-[var(--hud-text)] placeholder:text-[var(--hud-muted)]"
      />
    </section>
  );
}
