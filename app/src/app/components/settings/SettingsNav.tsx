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
    <nav className="flex flex-col gap-2 p-4" aria-label="Settings sections">
      {sections.map((section) => {
        const isActive = section.key === activeSection;
        return (
          <Button
            key={section.key}
            type="button"
            variant="ghost"
            onClick={() => onSelect(section.key)}
            className={`h-auto w-full flex-col items-start justify-start gap-2 ui-v1-radius-md px-4 py-4 text-left whitespace-normal transition-all ${
              isActive
                ? 'border border-[color:color-mix(in_srgb,var(--hud-accent-soft)_72%,var(--hud-border))] bg-[color:color-mix(in_srgb,var(--hud-surface)_92%,transparent)] text-[color:var(--hud-text)] shadow-[0_12px_28px_rgba(0,0,0,0.14)]'
                : 'border border-transparent bg-transparent text-[color:var(--hud-text)] opacity-84 hover:bg-[color:color-mix(in_srgb,var(--hud-surface)_72%,transparent)] hover:opacity-100'
            }`}
          >
            <span className="block w-full text-[14px] font-semibold tracking-[-0.01em]">
              {section.label}
            </span>
            <span className="block w-full text-[11px] font-normal leading-[1.45] text-[color:var(--hud-muted)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3]">
              {section.description}
            </span>
          </Button>
        );
      })}
    </nav>
  );
}
