import { Button } from '../ui/button';

export type SettingsSectionKey =
  | 'profile'
  | 'general'
  | 'notifications'
  | 'integrations'
  | 'data-backup'
  | 'team-permissions'
  | 'security'
  | 'about';

export interface SettingsSection {
  key: SettingsSectionKey;
  label: string;
  description: string;
}

interface SettingsNavProps {
  sections: SettingsSection[];
  activeSection: SettingsSectionKey;
  onSelect: (section: SettingsSectionKey) => void;
}

export default function SettingsNav({ sections, activeSection, onSelect }: SettingsNavProps) {
  return (
    <nav className="flex flex-col gap-1.5 p-4" aria-label="Settings sections">
      {sections.map((section) => {
        const isActive = section.key === activeSection;
        return (
          <Button
            key={section.key}
            type="button"
            variant="ghost"
            onClick={() => onSelect(section.key)}
            className={`h-auto w-full flex-col items-start justify-start gap-1 rounded-[11px] px-3.5 py-3 text-left whitespace-normal ${
              isActive
                ? 'border border-[color:var(--hud-accent-soft)] bg-[var(--hud-surface-strong)] text-[color:var(--hud-text)]'
                : 'border border-transparent text-[color:var(--hud-text)] opacity-80 hover:border-[color:var(--hud-border)] hover:bg-[var(--hud-surface-strong)] hover:opacity-100'
            }`}
          >
            <span className="block w-full text-[14px] font-semibold leading-none">
              {section.label}
            </span>
            <span className="block w-full truncate text-[11px] font-normal leading-[1.2] text-[color:var(--hud-muted)]">
              {section.description}
            </span>
          </Button>
        );
      })}
    </nav>
  );
}
