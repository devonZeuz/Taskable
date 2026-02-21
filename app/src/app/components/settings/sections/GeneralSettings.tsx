import { APP_THEMES, useAppTheme } from '../../../context/AppThemeContext';
import { useUserPreferences } from '../../../context/UserPreferencesContext';
import { useWorkday } from '../../../context/WorkdayContext';
import { desktopSetAlwaysOnTop, isDesktopShell } from '../../../services/desktopShell';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Switch } from '../../ui/switch';

const HOURS = Array.from({ length: 24 }, (_, index) => index);

function formatHour(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`;
}

export default function GeneralSettings() {
  const { theme, setTheme } = useAppTheme();
  const { workday, setWorkday } = useWorkday();
  const { preferences, setPreference } = useUserPreferences();
  const desktopMode = isDesktopShell();

  const handleStartChange = (value: string) => {
    const nextStart = Number(value);
    if (Number.isNaN(nextStart)) return;
    const nextEnd = workday.endHour <= nextStart ? nextStart + 1 : workday.endHour;
    setWorkday({ startHour: nextStart, endHour: Math.min(23, nextEnd) });
  };

  const handleEndChange = (value: string) => {
    const nextEnd = Number(value);
    if (Number.isNaN(nextEnd)) return;
    const nextStart = workday.startHour >= nextEnd ? nextEnd - 1 : workday.startHour;
    setWorkday({ startHour: Math.max(0, nextStart), endHour: nextEnd });
  };

  return (
    <div className="space-y-4">
      <section className="rounded-[14px] border border-[color:var(--hud-border)] bg-[var(--hud-surface)] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
          Theme
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {APP_THEMES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setTheme(option.value)}
              className={`rounded-[10px] border px-3 py-2 text-left text-sm ${
                theme === option.value
                  ? 'ui-hud-btn-soft'
                  : 'ui-hud-btn bg-[var(--hud-surface-strong)] opacity-80 hover:border-[color:var(--hud-outline)] hover:opacity-100'
              }`}
            >
              <span
                className={`font-semibold ${
                  theme === option.value
                    ? 'text-[color:var(--hud-accent-soft-text)]'
                    : 'text-[color:var(--hud-text)]'
                }`}
              >
                {option.label}
              </span>
              <p
                className={`mt-0.5 text-[11px] ${
                  theme === option.value
                    ? 'text-[color:var(--hud-accent-soft-text)] opacity-80'
                    : 'text-[color:var(--hud-muted)]'
                }`}
              >
                {option.value === 'sugar-plum'
                  ? 'Pink-forward visual palette'
                  : option.value === 'white'
                    ? 'Clean bright white interface'
                    : option.value === 'mono'
                      ? 'Pure black and white'
                      : 'Neutral black/white with softer contrast'}
              </p>
            </button>
          ))}
        </div>
      </section>

      <section className="ui-hud-section rounded-[14px] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
          Planner Defaults
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Workday start</Label>
            <Select value={String(workday.startHour)} onValueChange={handleStartChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOURS.slice(0, 23).map((hour) => (
                  <SelectItem key={`general-start-${hour}`} value={String(hour)}>
                    {formatHour(hour)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Workday end</Label>
            <Select value={String(workday.endHour)} onValueChange={handleEndChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOURS.slice(1).map((hour) => (
                  <SelectItem key={`general-end-${hour}`} value={String(hour)}>
                    {formatHour(hour)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Slot size</Label>
            <Select
              value={String(preferences.slotMinutes)}
              onValueChange={(value) => {
                const next = Number(value);
                if (next === 15 || next === 30 || next === 60) {
                  setPreference('slotMinutes', next);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">15 minutes</SelectItem>
                <SelectItem value="30">30 minutes</SelectItem>
                <SelectItem value="60">60 minutes</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="default-duration">Default task duration (minutes)</Label>
            <Input
              id="default-duration"
              type="number"
              min={preferences.slotMinutes}
              max={480}
              step={preferences.slotMinutes}
              value={preferences.defaultTaskDurationMinutes}
              onChange={(event) => {
                const raw = Number(event.target.value);
                if (Number.isNaN(raw)) return;
                const rounded = Math.round(raw / preferences.slotMinutes) * preferences.slotMinutes;
                setPreference(
                  'defaultTaskDurationMinutes',
                  Math.max(preferences.slotMinutes, rounded)
                );
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Week starts on</Label>
            <Select
              value={preferences.weekStartDay}
              onValueChange={(value) =>
                setPreference('weekStartDay', value === 'sunday' ? 'sunday' : 'monday')
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monday">Monday</SelectItem>
                <SelectItem value="sunday">Sunday</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Time format</Label>
            <Select
              value={preferences.timeFormat}
              onValueChange={(value) =>
                setPreference('timeFormat', value === '12h' ? '12h' : '24h')
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">24 hour</SelectItem>
                <SelectItem value="12h">12 hour</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Calendar recall window</Label>
            <Select
              value={String(preferences.recallDays)}
              onValueChange={(value) => {
                const next = Number(value);
                if (!Number.isNaN(next)) {
                  setPreference('recallDays', next);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">No history</SelectItem>
                <SelectItem value="1">1 day back</SelectItem>
                <SelectItem value="2">2 days back</SelectItem>
                <SelectItem value="3">3 days back</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <section className="ui-hud-section rounded-[14px] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
          Compact Mode
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <ToggleRow
            label="Compact mode active"
            description="Remember compact mode as the last used layout."
            checked={preferences.compactEnabled}
            onCheckedChange={(checked) => setPreference('compactEnabled', checked)}
          />

          <ToggleRow
            label="Always on top (desktop)"
            description="Keep compact window pinned above other apps."
            checked={preferences.compactAlwaysOnTop}
            onCheckedChange={(checked) => {
              setPreference('compactAlwaysOnTop', checked);
              if (desktopMode) {
                void desktopSetAlwaysOnTop(checked);
              }
            }}
          />

          <div className="space-y-1.5">
            <Label>Days shown in compact view</Label>
            <Select
              value={String(preferences.compactDaysShown)}
              onValueChange={(value) => {
                const next = Number(value);
                if (next === 3 || next === 5 || next === 7) {
                  setPreference('compactDaysShown', next);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3">3 days</SelectItem>
                <SelectItem value="5">5 days</SelectItem>
                <SelectItem value="7">7 days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Last compact pop-out bounds</Label>
            <div className="ui-hud-row rounded-[10px] px-3 py-2 text-[11px] text-[color:var(--hud-muted)]">
              {preferences.compactWindowBounds ? (
                <>
                  {preferences.compactWindowBounds.width} x {preferences.compactWindowBounds.height}
                  {' at '}({preferences.compactWindowBounds.left},{' '}
                  {preferences.compactWindowBounds.top})
                </>
              ) : (
                'No compact pop-out bounds captured yet.'
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="ui-hud-section rounded-[14px] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
          Behavior
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <ToggleRow
            label="Sound effects"
            description="Play completion and undo tones."
            checked={preferences.soundEffectsEnabled}
            onCheckedChange={(checked) => setPreference('soundEffectsEnabled', checked)}
          />
          <ToggleRow
            label="Reduce motion"
            description="Minimize transition and animation effects."
            checked={preferences.reduceMotion}
            onCheckedChange={(checked) => setPreference('reduceMotion', checked)}
          />
          <ToggleRow
            label="Auto-place on conflict"
            description="Drop to the next free slot when a time conflict is detected."
            checked={preferences.autoPlaceOnConflict}
            onCheckedChange={(checked) => setPreference('autoPlaceOnConflict', checked)}
          />
          <ToggleRow
            label="Adaptive execution mode"
            description="Keep planned times stable while tracking runtime overrun."
            checked={preferences.adaptiveMode}
            onCheckedChange={(checked) => setPreference('adaptiveMode', checked)}
          />
          <ToggleRow
            label="Auto-shove on extend"
            description="When extending to now, shift downstream tasks automatically."
            checked={preferences.autoShoveOnExtend}
            onCheckedChange={(checked) => setPreference('autoShoveOnExtend', checked)}
          />
          <ToggleRow
            label="Hide unassigned in Personal view"
            description="Keep unassigned tasks out of the personal lane."
            checked={preferences.hideUnassignedInPersonal}
            onCheckedChange={(checked) => setPreference('hideUnassignedInPersonal', checked)}
          />
        </div>
      </section>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between ui-hud-row rounded-[10px] px-3 py-2">
      <div className="pr-3">
        <p className="text-sm font-semibold text-[color:var(--hud-text)]">{label}</p>
        <p className="text-[11px] text-[color:var(--hud-muted)]">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
