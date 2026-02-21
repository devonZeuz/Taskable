import { useMemo } from 'react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { useCloudSync } from '../../../context/CloudSyncContext';
import { useUserPreferences } from '../../../context/UserPreferencesContext';

export default function ProfileSettings() {
  const { token, user, orgs, activeOrgId } = useCloudSync();
  const {
    preferences: { timezone, language },
    setPreference,
  } = useUserPreferences();

  const activeOrg = useMemo(
    () => orgs.find((org) => org.id === activeOrgId) ?? null,
    [activeOrgId, orgs]
  );

  const accountName = user?.name ?? 'Local Planner';
  const accountEmail = user?.email ?? 'Local-only workspace';
  const accountMode = token ? 'Cloud account' : 'Local mode';

  const timeZoneList = useMemo(() => {
    const intlWithTimeZones = Intl as typeof Intl & {
      supportedValuesOf?: (input: string) => string[];
    };
    if (typeof intlWithTimeZones.supportedValuesOf !== 'function') {
      return [timezone];
    }
    try {
      return intlWithTimeZones.supportedValuesOf('timeZone');
    } catch {
      return [timezone];
    }
  }, [timezone]);

  const setSystemTimeZone = () => {
    try {
      const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (localTimeZone) {
        setPreference('timezone', localTimeZone);
      }
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-4">
      <section className="ui-hud-section rounded-[14px] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
          Account
        </p>
        <div className="mt-2 space-y-1">
          <p className="text-xl font-bold text-[color:var(--hud-text)]">{accountName}</p>
          <p className="text-sm text-[color:var(--hud-muted)]">{accountEmail}</p>
          <p className="text-xs text-[color:var(--hud-muted)]">
            {accountMode}
            {activeOrg ? ` | ${activeOrg.name} (${activeOrg.role})` : ''}
          </p>
        </div>
      </section>

      <section className="ui-hud-section rounded-[14px] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
          Profile Defaults
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="profile-timezone">Timezone</Label>
            <Input
              id="profile-timezone"
              list="timezone-options"
              value={timezone}
              onChange={(event) => setPreference('timezone', event.target.value)}
            />
            <datalist id="timezone-options">
              {timeZoneList.map((entry) => (
                <option key={entry} value={entry} />
              ))}
            </datalist>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-[color:var(--hud-muted)] hover:text-[color:var(--hud-text)]"
              onClick={setSystemTimeZone}
            >
              Use system timezone
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="profile-language">Language</Label>
            <Input
              id="profile-language"
              value={language}
              onChange={(event) => setPreference('language', event.target.value)}
              placeholder="en"
            />
            <p className="text-[11px] text-[color:var(--hud-muted)]">Language packs are WIP.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
