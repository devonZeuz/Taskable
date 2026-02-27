import { useMemo, useState } from 'react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { useCloudSync } from '../../../context/CloudSyncContext';
import { useUserPreferences } from '../../../context/UserPreferencesContext';
import { CloudRequestError } from '../../../services/cloudApi';

export default function ProfileSettings() {
  const { token, user, orgs, activeOrgId, deleteAccount } = useCloudSync();
  const {
    preferences: { timezone, language },
    setPreference,
  } = useUserPreferences();
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  const canDeleteAccount = deleteConfirmation.trim().toLowerCase() === 'delete account';

  const handleDeleteAccount = async () => {
    if (!canDeleteAccount || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteAccount();
    } catch (error) {
      if (error instanceof CloudRequestError) {
        setDeleteError(error.message);
      } else if (error instanceof Error) {
        setDeleteError(error.message);
      } else {
        setDeleteError('Unable to delete account right now.');
      }
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="ui-hud-section ui-v1-radius-md p-4">
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

      <section className="ui-hud-section ui-v1-radius-md p-4">
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

      {token ? (
        <section className="ui-hud-section ui-v1-radius-md border border-[color:var(--hud-danger-border)] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-danger-text)]">
            Danger Zone
          </p>
          <p className="mt-2 text-sm text-[color:var(--hud-muted)]">
            Delete your cloud account and personal profile data. This action cannot be undone.
          </p>
          <div className="mt-3 space-y-2">
            <Label htmlFor="delete-account-confirmation">
              Type <span className="font-semibold">delete account</span> to confirm
            </Label>
            <Input
              id="delete-account-confirmation"
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              placeholder="delete account"
              autoComplete="off"
            />
            {deleteError ? (
              <p className="text-xs font-medium text-[color:var(--hud-danger-text)]">{deleteError}</p>
            ) : null}
            <div className="flex justify-end">
              <Button
                type="button"
                variant="destructive"
                onClick={handleDeleteAccount}
                disabled={!canDeleteAccount || deleteBusy}
              >
                {deleteBusy ? 'Deleting account...' : 'Delete account'}
              </Button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
