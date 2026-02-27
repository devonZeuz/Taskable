import { useState } from 'react';
import { toast } from 'sonner';
import { useNotificationSettings } from '../../../context/NotificationSettingsContext';
import type { NotificationLeadMinutes } from '../../../context/UserPreferencesContext';
import { Button } from '../../ui/button';
import { Switch } from '../../ui/switch';

const LEAD_OPTIONS: NotificationLeadMinutes[] = [15, 10, 5, 30];
const FOLLOW_UP_OPTIONS: NotificationLeadMinutes[] = [5, 10, 15, 30];

export default function NotificationSettings() {
  const {
    enabled,
    permission,
    incomingLeadTimes,
    endPromptEnabled,
    followUpOverrunIntervals,
    setEnabled,
    setIncomingLeadTimes,
    setEndPromptEnabled,
    setFollowUpOverrunIntervals,
    requestPermission,
  } = useNotificationSettings();
  const [requesting, setRequesting] = useState(false);

  const handleToggle = async (nextEnabled: boolean) => {
    if (!nextEnabled) {
      setEnabled(false);
      return;
    }

    if (permission === 'granted') {
      setEnabled(true);
      return;
    }

    setRequesting(true);
    try {
      const result = await requestPermission();
      if (result === 'granted') {
        setEnabled(true);
        toast.success('Notifications enabled.');
      } else {
        setEnabled(false);
        toast.error('Notification permission was denied.');
      }
    } finally {
      setRequesting(false);
    }
  };

  const toggleLeadTime = (minutes: NotificationLeadMinutes) => {
    const hasValue = incomingLeadTimes.includes(minutes);
    const next = hasValue
      ? incomingLeadTimes.filter((value) => value !== minutes)
      : [...incomingLeadTimes, minutes];

    if (next.length === 0) {
      toast.error('Select at least one incoming reminder time.');
      return;
    }

    setIncomingLeadTimes(next as NotificationLeadMinutes[]);
  };

  const toggleFollowUpInterval = (minutes: NotificationLeadMinutes) => {
    const hasValue = followUpOverrunIntervals.includes(minutes);
    const next = hasValue
      ? followUpOverrunIntervals.filter((value) => value !== minutes)
      : [...followUpOverrunIntervals, minutes];

    if (next.length === 0) {
      toast.error('Select at least one overrun follow-up interval.');
      return;
    }

    setFollowUpOverrunIntervals(next as NotificationLeadMinutes[]);
  };

  return (
    <div className="space-y-5">
      <section className="ui-hud-section ui-v1-radius-md p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
          Browser Alerts
        </p>
        <div className="ui-hud-row mt-3 flex items-center justify-between ui-v1-radius-sm px-3 py-2.5">
          <div>
            <p className="text-sm font-semibold text-[color:var(--hud-text)]">Enable reminders</p>
            <p className="text-[11px] text-[color:var(--hud-muted)]">
              Permission status:{' '}
              <span className="font-semibold text-[color:var(--hud-text)]">{permission}</span>
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={handleToggle} disabled={requesting} />
        </div>

        <div className="mt-4 space-y-2">
          <div>
            <p className="text-sm font-semibold text-[color:var(--hud-text)]">
              Incoming lead times
            </p>
            <p className="text-[11px] text-[color:var(--hud-muted)]">
              Choose when Tareva reminds you before a task starts.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {LEAD_OPTIONS.map((minutes) => {
                const active = incomingLeadTimes.includes(minutes);
                return (
                  <button
                    key={minutes}
                    type="button"
                    className={`h-8 ui-v1-radius-sm border px-3 text-[11px] font-semibold ${
                      active
                        ? 'ui-hud-btn-soft'
                        : 'ui-hud-btn bg-[var(--hud-surface-strong)] opacity-85'
                    }`}
                    onClick={() => toggleLeadTime(minutes)}
                  >
                    {minutes} min
                  </button>
                );
              })}
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-9 w-full sm:w-auto"
            onClick={async () => {
              setRequesting(true);
              try {
                const result = await requestPermission();
                toast.message(`Permission: ${result}`);
              } finally {
                setRequesting(false);
              }
            }}
            disabled={requesting}
          >
            Request Permission
          </Button>
        </div>
      </section>

      <section className="ui-hud-section ui-v1-radius-md p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
          Execution Prompts
        </p>
        <div className="ui-hud-row mt-3 flex items-center justify-between ui-v1-radius-sm px-3 py-2.5">
          <div>
            <p className="text-sm font-semibold text-[color:var(--hud-text)]">End-of-task prompt</p>
            <p className="text-[11px] text-[color:var(--hud-muted)]">
              Ask to Done / Extend / Keep running when planned time ends.
            </p>
          </div>
          <Switch checked={endPromptEnabled} onCheckedChange={setEndPromptEnabled} />
        </div>

        <div className="mt-4 space-y-1.5">
          <p className="text-sm font-semibold text-[color:var(--hud-text)]">Overrun follow-up</p>
          <p className="text-[11px] text-[color:var(--hud-muted)]">
            Send gentle reminders while a running task is late.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {FOLLOW_UP_OPTIONS.map((minutes) => {
              const active = followUpOverrunIntervals.includes(minutes);
              return (
                <button
                  key={minutes}
                  type="button"
                  className={`h-8 ui-v1-radius-sm border px-3 text-[11px] font-semibold ${
                    active
                      ? 'ui-hud-btn-soft'
                      : 'ui-hud-btn bg-[var(--hud-surface-strong)] opacity-85'
                  }`}
                  onClick={() => toggleFollowUpInterval(minutes)}
                >
                  {minutes} min
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="ui-hud-section ui-v1-radius-md p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
          Reminder Types
        </p>
        <ul className="mt-3 space-y-2 text-sm text-[color:var(--hud-text)]">
          <li>Starting soon reminders (active)</li>
          <li>Task end prompts with extension actions (active)</li>
          <li>Running-late follow-up reminders (active)</li>
        </ul>
      </section>
    </div>
  );
}
