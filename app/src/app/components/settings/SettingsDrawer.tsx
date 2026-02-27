import { useEffect, useMemo, useState } from 'react';
import { Settings } from 'lucide-react';
import { useCloudSync } from '../../context/CloudSyncContext';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import SettingsNav, { type SettingsSection, type SettingsSectionKey } from './SettingsNav';
import AboutSettings from './sections/AboutSettings';
import DataBackupSettings from './sections/DataBackupSettings';
import GeneralSettings from './sections/GeneralSettings';
import IntegrationSettings from './sections/IntegrationSettings';
import NotificationSettings from './sections/NotificationSettings';
import ProfileSettings from './sections/ProfileSettings';
import SecuritySettings from './sections/SecuritySettings';
import TeamPermissionsSettings from './sections/TeamPermissionsSettings';
import { OPEN_SETTINGS_EVENT, type OpenSettingsEventDetail } from '../../services/settingsBridge';

const SETTINGS_DRAWER_OPEN_STORAGE_KEY = 'taskable:settings-drawer-open';
const SETTINGS_ACTIVE_SECTION_STORAGE_KEY = 'taskable:settings-active-section';

const SETTINGS_SECTIONS: SettingsSection[] = [
  { key: 'profile', label: 'Profile', description: 'Identity and account defaults' },
  { key: 'general', label: 'General', description: 'Planner behavior and workday' },
  {
    key: 'notifications',
    label: 'Notifications',
    description: 'Reminder permissions and lead time',
  },
  { key: 'integrations', label: 'Integrations', description: 'Cloud sync and external services' },
  { key: 'data-backup', label: 'Data & Backup', description: 'Export, restore, and migration' },
  {
    key: 'team-permissions',
    label: 'Team & Permissions',
    description: 'Members, roles, and workspace controls',
  },
  { key: 'security', label: 'Security', description: 'Verification, MFA, and sessions' },
  { key: 'about', label: 'About', description: 'Version and diagnostics' },
];

function loadStoredOpenState() {
  try {
    return localStorage.getItem(SETTINGS_DRAWER_OPEN_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function loadStoredSection(): SettingsSectionKey {
  try {
    const stored = localStorage.getItem(SETTINGS_ACTIVE_SECTION_STORAGE_KEY);
    if (
      stored === 'profile' ||
      stored === 'general' ||
      stored === 'notifications' ||
      stored === 'integrations' ||
      stored === 'data-backup' ||
      stored === 'team-permissions' ||
      stored === 'security' ||
      stored === 'about'
    ) {
      return stored;
    }
  } catch {
    // ignore
  }
  return 'profile';
}

export default function SettingsDrawer() {
  return <SettingsDrawerInner />;
}

export function SettingsDrawerInner({
  triggerClassName,
  compact = false,
  triggerTestId,
}: {
  triggerClassName?: string;
  compact?: boolean;
  triggerTestId?: string;
}) {
  const { user } = useCloudSync();
  const [open, setOpen] = useState(loadStoredOpenState);
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>(loadStoredSection);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_DRAWER_OPEN_STORAGE_KEY, String(open));
    } catch {
      // ignore persistence errors
    }
  }, [open]);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_ACTIVE_SECTION_STORAGE_KEY, activeSection);
    } catch {
      // ignore persistence errors
    }
  }, [activeSection]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleOpenSettings = (event: Event) => {
      const nextEvent = event as CustomEvent<OpenSettingsEventDetail>;
      const requestedSection = nextEvent.detail?.section;
      if (requestedSection) {
        setActiveSection(requestedSection);
      }
      setOpen(true);
    };

    window.addEventListener(OPEN_SETTINGS_EVENT, handleOpenSettings);
    return () => {
      window.removeEventListener(OPEN_SETTINGS_EVENT, handleOpenSettings);
    };
  }, []);

  const activeSectionMeta = useMemo(
    () =>
      SETTINGS_SECTIONS.find((section) => section.key === activeSection) ?? SETTINGS_SECTIONS[0],
    [activeSection]
  );

  const initials = (user?.name?.trim().charAt(0) || 'P').toUpperCase();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          data-testid={triggerTestId}
          variant="ghost"
          className={`planner-control h-9 gap-2 ui-v1-radius-sm border border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-3 text-[color:var(--hud-text)] hover:bg-[var(--hud-surface-soft)] hover:text-[color:var(--hud-text)] ${
            triggerClassName ?? ''
          }`}
        >
          <Avatar className="size-6 border border-[color:var(--hud-border)]">
            <AvatarFallback className="bg-[var(--hud-accent-soft)] text-[10px] font-semibold text-[var(--hud-accent-soft-text)]">
              {initials}
            </AvatarFallback>
          </Avatar>
          {!compact && <span className="text-[12px] font-semibold">Settings</span>}
          <Settings className="size-4 text-[color:var(--hud-muted)]" />
        </Button>
      </DialogTrigger>

      <DialogContent
        className="h-[min(90vh,860px)] w-[min(1180px,96vw)] max-w-none gap-0 overflow-hidden border-[color:var(--hud-border)] bg-[var(--hud-surface)] text-[color:var(--hud-text)] ui-v1-elevation-3 backdrop-blur-xl sm:max-w-none"
        style={{ padding: 0 }}
      >
        <div className="flex h-full min-h-0 flex-col">
          <DialogHeader className="border-b border-[color:var(--hud-border)] px-4 py-3 sm:px-5">
            <DialogTitle className="text-left text-[16px] font-bold text-[color:var(--hud-text)]">
              Settings
            </DialogTitle>
            <DialogDescription className="sr-only">
              Manage profile, planner preferences, notifications, integrations, backup, permissions,
              security, and app diagnostics.
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1">
            <aside className="hidden w-[300px] shrink-0 border-r border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] lg:block">
              <SettingsNav
                sections={SETTINGS_SECTIONS}
                activeSection={activeSection}
                onSelect={setActiveSection}
              />
            </aside>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="border-b border-[color:var(--hud-border)] px-4 py-3 sm:px-5 lg:hidden">
                <Select
                  value={activeSection}
                  onValueChange={(value) => setActiveSection(value as SettingsSectionKey)}
                >
                  <SelectTrigger className="h-9 border-[color:var(--hud-border)] bg-[var(--hud-surface-strong)] text-[color:var(--hud-text)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SETTINGS_SECTIONS.map((section) => (
                      <SelectItem key={section.key} value={section.key}>
                        {section.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="border-b border-[color:var(--hud-border)] px-4 py-3 sm:px-5">
                <p className="text-[15px] font-bold text-[color:var(--hud-text)]">
                  {activeSectionMeta.label}
                </p>
                <p className="text-xs text-[color:var(--hud-muted)]">
                  {activeSectionMeta.description}
                </p>
              </div>

              <div className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-5 sm:py-5">
                {activeSection === 'profile' && <ProfileSettings />}
                {activeSection === 'general' && <GeneralSettings />}
                {activeSection === 'notifications' && <NotificationSettings />}
                {activeSection === 'integrations' && <IntegrationSettings />}
                {activeSection === 'data-backup' && <DataBackupSettings />}
                {activeSection === 'team-permissions' && <TeamPermissionsSettings />}
                {activeSection === 'security' && <SecuritySettings />}
                {activeSection === 'about' && <AboutSettings />}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
