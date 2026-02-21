import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type WeekStartDay = 'sunday' | 'monday';
export type TimeFormat = '24h' | '12h';
export type SlotSizeMinutes = 15 | 30 | 60;
export type NotificationLeadMinutes = 5 | 10 | 15 | 30;
export type CompactDaysShown = 3 | 5 | 7;

export interface CompactWindowBounds {
  width: number;
  height: number;
  left: number;
  top: number;
}

export interface UserPreferences {
  timezone: string;
  weekStartDay: WeekStartDay;
  timeFormat: TimeFormat;
  slotMinutes: SlotSizeMinutes;
  soundEffectsEnabled: boolean;
  reduceMotion: boolean;
  defaultTaskDurationMinutes: number;
  autoPlaceOnConflict: boolean;
  hideUnassignedInPersonal: boolean;
  recallDays: number;
  notificationLeadTimes: NotificationLeadMinutes[];
  endPromptEnabled: boolean;
  followUpOverrunIntervals: NotificationLeadMinutes[];
  adaptiveMode: boolean;
  autoShoveOnExtend: boolean;
  language: string;
  compactEnabled: boolean;
  compactDaysShown: CompactDaysShown;
  compactAlwaysOnTop: boolean;
  compactWindowBounds: CompactWindowBounds | null;
}

interface UserPreferencesContextType {
  preferences: UserPreferences;
  updatePreferences: (updates: Partial<UserPreferences>) => void;
  setPreference: <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => void;
  resetPreferences: () => void;
}

interface StoredPreferencesPayload {
  schemaVersion: number;
  preferences: Partial<UserPreferences>;
}

const STORAGE_KEY = 'taskable:user-preferences';
const STORAGE_SCHEMA_VERSION = 5;

function getLocalTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  } catch {
    return 'UTC';
  }
}

const DEFAULT_PREFERENCES: UserPreferences = {
  timezone: getLocalTimeZone(),
  weekStartDay: 'monday',
  timeFormat: '24h',
  slotMinutes: 15,
  soundEffectsEnabled: true,
  reduceMotion: false,
  defaultTaskDurationMinutes: 60,
  autoPlaceOnConflict: false,
  hideUnassignedInPersonal: false,
  recallDays: 3,
  notificationLeadTimes: [15, 10, 5],
  endPromptEnabled: true,
  followUpOverrunIntervals: [5, 10, 15],
  adaptiveMode: true,
  autoShoveOnExtend: false,
  language: 'en',
  compactEnabled: false,
  compactDaysShown: 5,
  compactAlwaysOnTop: false,
  compactWindowBounds: null,
};

const UserPreferencesContext = createContext<UserPreferencesContextType | undefined>(undefined);

function clampDuration(value: number) {
  return Math.max(15, Math.min(8 * 60, Math.round(value)));
}

function normalizeLeadTimes(value: unknown): NotificationLeadMinutes[] {
  if (!Array.isArray(value)) {
    return DEFAULT_PREFERENCES.notificationLeadTimes;
  }

  const supported = value
    .map((entry) => Number(entry))
    .filter((entry): entry is NotificationLeadMinutes => {
      return entry === 5 || entry === 10 || entry === 15 || entry === 30;
    });

  const deduped = Array.from(new Set(supported));
  if (deduped.length === 0) {
    return DEFAULT_PREFERENCES.notificationLeadTimes;
  }

  return deduped.sort((a, b) => b - a);
}

function normalizeFollowUpIntervals(value: unknown): NotificationLeadMinutes[] {
  if (!Array.isArray(value)) {
    return DEFAULT_PREFERENCES.followUpOverrunIntervals;
  }

  const supported = value
    .map((entry) => Number(entry))
    .filter((entry): entry is NotificationLeadMinutes => {
      return entry === 5 || entry === 10 || entry === 15 || entry === 30;
    });

  const deduped = Array.from(new Set(supported));
  if (deduped.length === 0) {
    return DEFAULT_PREFERENCES.followUpOverrunIntervals;
  }

  return deduped.sort((a, b) => a - b);
}

function normalizeCompactBounds(input: unknown): CompactWindowBounds | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const candidate = input as Partial<CompactWindowBounds>;
  if (
    typeof candidate.width !== 'number' ||
    typeof candidate.height !== 'number' ||
    typeof candidate.left !== 'number' ||
    typeof candidate.top !== 'number' ||
    !Number.isFinite(candidate.width) ||
    !Number.isFinite(candidate.height) ||
    !Number.isFinite(candidate.left) ||
    !Number.isFinite(candidate.top)
  ) {
    return null;
  }

  return {
    width: Math.max(420, Math.min(1600, Math.round(candidate.width))),
    height: Math.max(280, Math.min(1200, Math.round(candidate.height))),
    left: Math.round(candidate.left),
    top: Math.round(candidate.top),
  };
}

function normalizePreferences(input: Partial<UserPreferences> | null | undefined): UserPreferences {
  if (!input) return DEFAULT_PREFERENCES;

  const slotMinutes = input.slotMinutes;
  const legacyNotificationLeadMinutes = (input as { notificationLeadMinutes?: number })
    .notificationLeadMinutes;
  const legacyOverrunFollowUpMinutes = (input as { overrunFollowUpMinutes?: number })
    .overrunFollowUpMinutes;
  const normalizedLeadTimes = Array.isArray(input.notificationLeadTimes)
    ? normalizeLeadTimes(input.notificationLeadTimes)
    : legacyNotificationLeadMinutes === 10 ||
        legacyNotificationLeadMinutes === 15 ||
        legacyNotificationLeadMinutes === 30 ||
        legacyNotificationLeadMinutes === 5
      ? normalizeLeadTimes([legacyNotificationLeadMinutes])
      : DEFAULT_PREFERENCES.notificationLeadTimes;
  const normalizedFollowUps = Array.isArray(input.followUpOverrunIntervals)
    ? normalizeFollowUpIntervals(input.followUpOverrunIntervals)
    : legacyOverrunFollowUpMinutes === 5 ||
        legacyOverrunFollowUpMinutes === 10 ||
        legacyOverrunFollowUpMinutes === 15 ||
        legacyOverrunFollowUpMinutes === 30
      ? normalizeFollowUpIntervals([legacyOverrunFollowUpMinutes])
      : DEFAULT_PREFERENCES.followUpOverrunIntervals;

  return {
    timezone:
      typeof input.timezone === 'string' && input.timezone.trim().length > 0
        ? input.timezone.trim()
        : DEFAULT_PREFERENCES.timezone,
    weekStartDay: input.weekStartDay === 'sunday' ? 'sunday' : DEFAULT_PREFERENCES.weekStartDay,
    timeFormat: input.timeFormat === '12h' ? '12h' : DEFAULT_PREFERENCES.timeFormat,
    slotMinutes:
      slotMinutes === 30 || slotMinutes === 60 ? slotMinutes : DEFAULT_PREFERENCES.slotMinutes,
    soundEffectsEnabled:
      typeof input.soundEffectsEnabled === 'boolean'
        ? input.soundEffectsEnabled
        : DEFAULT_PREFERENCES.soundEffectsEnabled,
    reduceMotion:
      typeof input.reduceMotion === 'boolean'
        ? input.reduceMotion
        : DEFAULT_PREFERENCES.reduceMotion,
    defaultTaskDurationMinutes:
      typeof input.defaultTaskDurationMinutes === 'number'
        ? clampDuration(input.defaultTaskDurationMinutes)
        : DEFAULT_PREFERENCES.defaultTaskDurationMinutes,
    autoPlaceOnConflict:
      typeof input.autoPlaceOnConflict === 'boolean'
        ? input.autoPlaceOnConflict
        : DEFAULT_PREFERENCES.autoPlaceOnConflict,
    hideUnassignedInPersonal:
      typeof input.hideUnassignedInPersonal === 'boolean'
        ? input.hideUnassignedInPersonal
        : DEFAULT_PREFERENCES.hideUnassignedInPersonal,
    recallDays:
      typeof input.recallDays === 'number'
        ? Math.max(0, Math.min(3, Math.floor(input.recallDays)))
        : DEFAULT_PREFERENCES.recallDays,
    notificationLeadTimes: normalizedLeadTimes,
    endPromptEnabled:
      typeof input.endPromptEnabled === 'boolean'
        ? input.endPromptEnabled
        : DEFAULT_PREFERENCES.endPromptEnabled,
    followUpOverrunIntervals: normalizedFollowUps,
    adaptiveMode:
      typeof input.adaptiveMode === 'boolean'
        ? input.adaptiveMode
        : DEFAULT_PREFERENCES.adaptiveMode,
    autoShoveOnExtend:
      typeof input.autoShoveOnExtend === 'boolean'
        ? input.autoShoveOnExtend
        : DEFAULT_PREFERENCES.autoShoveOnExtend,
    language:
      typeof input.language === 'string' && input.language.trim().length > 0
        ? input.language.trim()
        : DEFAULT_PREFERENCES.language,
    compactEnabled:
      typeof input.compactEnabled === 'boolean'
        ? input.compactEnabled
        : DEFAULT_PREFERENCES.compactEnabled,
    compactDaysShown:
      input.compactDaysShown === 3 || input.compactDaysShown === 5 || input.compactDaysShown === 7
        ? input.compactDaysShown
        : DEFAULT_PREFERENCES.compactDaysShown,
    compactAlwaysOnTop:
      typeof input.compactAlwaysOnTop === 'boolean'
        ? input.compactAlwaysOnTop
        : DEFAULT_PREFERENCES.compactAlwaysOnTop,
    compactWindowBounds: normalizeCompactBounds(input.compactWindowBounds),
  };
}

function loadPreferences(): UserPreferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_PREFERENCES;

    const parsed = JSON.parse(stored) as StoredPreferencesPayload | Partial<UserPreferences>;
    if ('schemaVersion' in parsed && 'preferences' in parsed) {
      const payload = parsed as StoredPreferencesPayload;
      if (payload.schemaVersion !== STORAGE_SCHEMA_VERSION) {
        return normalizePreferences({
          ...payload.preferences,
          recallDays: DEFAULT_PREFERENCES.recallDays,
          notificationLeadTimes:
            payload.preferences.notificationLeadTimes ?? DEFAULT_PREFERENCES.notificationLeadTimes,
          followUpOverrunIntervals:
            payload.preferences.followUpOverrunIntervals ??
            DEFAULT_PREFERENCES.followUpOverrunIntervals,
          compactEnabled: payload.preferences.compactEnabled ?? DEFAULT_PREFERENCES.compactEnabled,
          compactDaysShown:
            payload.preferences.compactDaysShown ?? DEFAULT_PREFERENCES.compactDaysShown,
          compactAlwaysOnTop:
            payload.preferences.compactAlwaysOnTop ?? DEFAULT_PREFERENCES.compactAlwaysOnTop,
          compactWindowBounds:
            payload.preferences.compactWindowBounds ?? DEFAULT_PREFERENCES.compactWindowBounds,
        });
      }
      return normalizePreferences(payload.preferences);
    }

    return normalizePreferences(parsed as Partial<UserPreferences>);
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function UserPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState<UserPreferences>(() => loadPreferences());

  useEffect(() => {
    try {
      const payload: StoredPreferencesPayload = {
        schemaVersion: STORAGE_SCHEMA_VERSION,
        preferences,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore persistence errors.
    }
  }, [preferences]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute(
      'data-reduce-motion',
      preferences.reduceMotion ? 'true' : 'false'
    );
  }, [preferences.reduceMotion]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;

      if (!event.newValue) {
        setPreferences(DEFAULT_PREFERENCES);
        return;
      }

      try {
        const parsed = JSON.parse(event.newValue) as
          | StoredPreferencesPayload
          | Partial<UserPreferences>;
        const nextPreferences =
          'schemaVersion' in parsed && 'preferences' in parsed
            ? normalizePreferences((parsed as StoredPreferencesPayload).preferences)
            : normalizePreferences(parsed as Partial<UserPreferences>);
        setPreferences(nextPreferences);
      } catch {
        // Ignore malformed cross-window storage payloads.
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const updatePreferences = (updates: Partial<UserPreferences>) => {
    setPreferences((prev) => normalizePreferences({ ...prev, ...updates }));
  };

  const setPreference: UserPreferencesContextType['setPreference'] = (key, value) => {
    setPreferences((prev) => normalizePreferences({ ...prev, [key]: value }));
  };

  const resetPreferences = () => {
    setPreferences(DEFAULT_PREFERENCES);
  };

  const value = useMemo(
    () => ({ preferences, updatePreferences, setPreference, resetPreferences }),
    [preferences]
  );

  return (
    <UserPreferencesContext.Provider value={value}>{children}</UserPreferencesContext.Provider>
  );
}

export function useUserPreferences() {
  const context = useContext(UserPreferencesContext);
  if (!context) {
    throw new Error('useUserPreferences must be used within UserPreferencesProvider');
  }
  return context;
}
