import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useOnboarding } from './OnboardingContext';

export type WeekStartDay = 'sunday' | 'monday';
export type TimeFormat = '24h' | '12h';
export type SlotSizeMinutes = 15 | 30 | 60;
export type NotificationLeadMinutes = 5 | 10 | 15 | 30;
export type CompactDaysShown = 3 | 5 | 7;
export type TimelineZoomLevel = 50 | 75 | 100 | 125 | 150;
export type UiDensity = 'comfortable' | 'compact';

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
  executionModeEnabled: boolean;
  telemetryShareEnabled: boolean;
  autoStartTasksAtStartTime: boolean;
  autoSwitchActiveTask: boolean;
  hideUnassignedInPersonal: boolean;
  recallDays: number;
  timelineZoom: TimelineZoomLevel;
  uiDensity: UiDensity;
  sidebarCollapsed: boolean;
  sidebarCollapsePreferenceSet: boolean;
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
const STORAGE_SCHEMA_VERSION = 9;
const EXECUTION_MODE_LOCAL_STORAGE_KEY = 'taskable:execution-mode:local';
const EXECUTION_MODE_CLOUD_STORAGE_PREFIX = 'taskable:execution-mode:cloud:';
const TELEMETRY_SHARE_LOCAL_STORAGE_KEY = 'taskable:telemetry-share:local';
const TELEMETRY_SHARE_CLOUD_STORAGE_PREFIX = 'taskable:telemetry-share:cloud:';
const SIDEBAR_COLLAPSED_LOCAL_STORAGE_KEY = 'taskable:layoutV1:sidebarCollapsed';
const SIDEBAR_COLLAPSED_CLOUD_STORAGE_PREFIX = 'taskable:layoutV1:sidebarCollapsed:cloud:';
const UI_DENSITY_LOCAL_STORAGE_KEY = 'taskable:ui-density:local';
const UI_DENSITY_CLOUD_STORAGE_PREFIX = 'taskable:ui-density:cloud:';

function getLocalTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  } catch {
    return 'UTC';
  }
}

function getScopedStorageKey(
  mode: 'local' | 'cloud' | null,
  cloudUserId: string | null,
  localKey: string,
  cloudPrefix: string
): string | null {
  if (mode === 'local') return localKey;
  if (mode === 'cloud' && typeof cloudUserId === 'string' && cloudUserId.length > 0) {
    return `${cloudPrefix}${cloudUserId}`;
  }
  return null;
}

function readScopedBoolean(
  mode: 'local' | 'cloud' | null,
  cloudUserId: string | null,
  localKey: string,
  cloudPrefix: string
): boolean | null {
  if (typeof window === 'undefined') return null;
  const storageKey = getScopedStorageKey(mode, cloudUserId, localKey, cloudPrefix);
  if (!storageKey) return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return null;
  } catch {
    return null;
  }
}

function writeScopedBoolean(
  mode: 'local' | 'cloud' | null,
  cloudUserId: string | null,
  localKey: string,
  cloudPrefix: string,
  value: boolean
) {
  if (typeof window === 'undefined') return;
  const storageKey = getScopedStorageKey(mode, cloudUserId, localKey, cloudPrefix);
  if (!storageKey) return;
  try {
    window.localStorage.setItem(storageKey, value ? 'true' : 'false');
  } catch {
    // Ignore storage write errors.
  }
}

function readScopedUiDensity(
  mode: 'local' | 'cloud' | null,
  cloudUserId: string | null,
  localKey: string,
  cloudPrefix: string
): UiDensity | null {
  if (typeof window === 'undefined') return null;
  const storageKey = getScopedStorageKey(mode, cloudUserId, localKey, cloudPrefix);
  if (!storageKey) return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === 'comfortable' || raw === 'compact') {
      return raw;
    }
    return null;
  } catch {
    return null;
  }
}

function writeScopedUiDensity(
  mode: 'local' | 'cloud' | null,
  cloudUserId: string | null,
  localKey: string,
  cloudPrefix: string,
  value: UiDensity
) {
  if (typeof window === 'undefined') return;
  const storageKey = getScopedStorageKey(mode, cloudUserId, localKey, cloudPrefix);
  if (!storageKey) return;
  try {
    window.localStorage.setItem(storageKey, value);
  } catch {
    // Ignore storage write errors.
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
  executionModeEnabled: false,
  telemetryShareEnabled: true,
  autoStartTasksAtStartTime: false,
  autoSwitchActiveTask: false,
  hideUnassignedInPersonal: false,
  recallDays: 3,
  timelineZoom: 100,
  uiDensity: 'comfortable',
  sidebarCollapsed: false,
  sidebarCollapsePreferenceSet: false,
  notificationLeadTimes: [15],
  endPromptEnabled: true,
  followUpOverrunIntervals: [15],
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
    executionModeEnabled:
      typeof input.executionModeEnabled === 'boolean'
        ? input.executionModeEnabled
        : DEFAULT_PREFERENCES.executionModeEnabled,
    telemetryShareEnabled:
      typeof input.telemetryShareEnabled === 'boolean'
        ? input.telemetryShareEnabled
        : DEFAULT_PREFERENCES.telemetryShareEnabled,
    autoStartTasksAtStartTime:
      typeof input.autoStartTasksAtStartTime === 'boolean'
        ? input.autoStartTasksAtStartTime
        : DEFAULT_PREFERENCES.autoStartTasksAtStartTime,
    autoSwitchActiveTask:
      typeof input.autoSwitchActiveTask === 'boolean'
        ? input.autoSwitchActiveTask
        : DEFAULT_PREFERENCES.autoSwitchActiveTask,
    hideUnassignedInPersonal:
      typeof input.hideUnassignedInPersonal === 'boolean'
        ? input.hideUnassignedInPersonal
        : DEFAULT_PREFERENCES.hideUnassignedInPersonal,
    recallDays:
      typeof input.recallDays === 'number'
        ? Math.max(0, Math.min(3, Math.floor(input.recallDays)))
        : DEFAULT_PREFERENCES.recallDays,
    timelineZoom:
      input.timelineZoom === 50 ||
      input.timelineZoom === 75 ||
      input.timelineZoom === 100 ||
      input.timelineZoom === 125 ||
      input.timelineZoom === 150
        ? input.timelineZoom
        : DEFAULT_PREFERENCES.timelineZoom,
    uiDensity: input.uiDensity === 'compact' ? 'compact' : DEFAULT_PREFERENCES.uiDensity,
    sidebarCollapsed:
      typeof input.sidebarCollapsed === 'boolean'
        ? input.sidebarCollapsed
        : DEFAULT_PREFERENCES.sidebarCollapsed,
    sidebarCollapsePreferenceSet:
      typeof input.sidebarCollapsePreferenceSet === 'boolean'
        ? input.sidebarCollapsePreferenceSet
        : DEFAULT_PREFERENCES.sidebarCollapsePreferenceSet,
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
          executionModeEnabled:
            payload.preferences.executionModeEnabled ?? DEFAULT_PREFERENCES.executionModeEnabled,
          telemetryShareEnabled:
            payload.preferences.telemetryShareEnabled ?? DEFAULT_PREFERENCES.telemetryShareEnabled,
          sidebarCollapsed:
            payload.preferences.sidebarCollapsed ?? DEFAULT_PREFERENCES.sidebarCollapsed,
          sidebarCollapsePreferenceSet:
            payload.preferences.sidebarCollapsePreferenceSet ??
            DEFAULT_PREFERENCES.sidebarCollapsePreferenceSet,
          notificationLeadTimes:
            payload.preferences.notificationLeadTimes ?? DEFAULT_PREFERENCES.notificationLeadTimes,
          followUpOverrunIntervals:
            payload.preferences.followUpOverrunIntervals ??
            DEFAULT_PREFERENCES.followUpOverrunIntervals,
          uiDensity: payload.preferences.uiDensity ?? DEFAULT_PREFERENCES.uiDensity,
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
  const { mode, cloudUserId } = useOnboarding();
  const [preferences, setPreferences] = useState<UserPreferences>(() => loadPreferences());

  useEffect(() => {
    const scopedExecutionMode = readScopedBoolean(
      mode,
      cloudUserId,
      EXECUTION_MODE_LOCAL_STORAGE_KEY,
      EXECUTION_MODE_CLOUD_STORAGE_PREFIX
    );
    const scopedTelemetryShare = readScopedBoolean(
      mode,
      cloudUserId,
      TELEMETRY_SHARE_LOCAL_STORAGE_KEY,
      TELEMETRY_SHARE_CLOUD_STORAGE_PREFIX
    );
    const scopedSidebarCollapsed = readScopedBoolean(
      mode,
      cloudUserId,
      SIDEBAR_COLLAPSED_LOCAL_STORAGE_KEY,
      SIDEBAR_COLLAPSED_CLOUD_STORAGE_PREFIX
    );
    const scopedUiDensity = readScopedUiDensity(
      mode,
      cloudUserId,
      UI_DENSITY_LOCAL_STORAGE_KEY,
      UI_DENSITY_CLOUD_STORAGE_PREFIX
    );

    if (
      scopedExecutionMode === null &&
      scopedTelemetryShare === null &&
      scopedSidebarCollapsed === null &&
      scopedUiDensity === null
    ) {
      return;
    }

    setPreferences((prev) => {
      const nextExecutionMode =
        scopedExecutionMode === null ? prev.executionModeEnabled : scopedExecutionMode;
      const nextTelemetryShare =
        scopedTelemetryShare === null ? prev.telemetryShareEnabled : scopedTelemetryShare;
      const nextSidebarCollapsed =
        scopedSidebarCollapsed === null ? prev.sidebarCollapsed : scopedSidebarCollapsed;
      const nextUiDensity = scopedUiDensity === null ? prev.uiDensity : scopedUiDensity;
      if (
        nextExecutionMode === prev.executionModeEnabled &&
        nextTelemetryShare === prev.telemetryShareEnabled &&
        nextSidebarCollapsed === prev.sidebarCollapsed &&
        nextUiDensity === prev.uiDensity
      ) {
        return prev;
      }
      return normalizePreferences({
        ...prev,
        executionModeEnabled: nextExecutionMode,
        telemetryShareEnabled: nextTelemetryShare,
        sidebarCollapsed: nextSidebarCollapsed,
        uiDensity: nextUiDensity,
      });
    });
  }, [mode, cloudUserId]);

  useEffect(() => {
    writeScopedBoolean(
      mode,
      cloudUserId,
      EXECUTION_MODE_LOCAL_STORAGE_KEY,
      EXECUTION_MODE_CLOUD_STORAGE_PREFIX,
      preferences.executionModeEnabled
    );
  }, [mode, cloudUserId, preferences.executionModeEnabled]);

  useEffect(() => {
    writeScopedBoolean(
      mode,
      cloudUserId,
      TELEMETRY_SHARE_LOCAL_STORAGE_KEY,
      TELEMETRY_SHARE_CLOUD_STORAGE_PREFIX,
      preferences.telemetryShareEnabled
    );
  }, [mode, cloudUserId, preferences.telemetryShareEnabled]);

  useEffect(() => {
    writeScopedBoolean(
      mode,
      cloudUserId,
      SIDEBAR_COLLAPSED_LOCAL_STORAGE_KEY,
      SIDEBAR_COLLAPSED_CLOUD_STORAGE_PREFIX,
      preferences.sidebarCollapsed
    );
  }, [mode, cloudUserId, preferences.sidebarCollapsed]);

  useEffect(() => {
    writeScopedUiDensity(
      mode,
      cloudUserId,
      UI_DENSITY_LOCAL_STORAGE_KEY,
      UI_DENSITY_CLOUD_STORAGE_PREFIX,
      preferences.uiDensity
    );
  }, [mode, cloudUserId, preferences.uiDensity]);

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
      if (event.key === STORAGE_KEY) {
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
        return;
      }

      const executionModeScopedKey = getScopedStorageKey(
        mode,
        cloudUserId,
        EXECUTION_MODE_LOCAL_STORAGE_KEY,
        EXECUTION_MODE_CLOUD_STORAGE_PREFIX
      );
      const telemetryShareScopedKey = getScopedStorageKey(
        mode,
        cloudUserId,
        TELEMETRY_SHARE_LOCAL_STORAGE_KEY,
        TELEMETRY_SHARE_CLOUD_STORAGE_PREFIX
      );
      const sidebarCollapsedScopedKey = getScopedStorageKey(
        mode,
        cloudUserId,
        SIDEBAR_COLLAPSED_LOCAL_STORAGE_KEY,
        SIDEBAR_COLLAPSED_CLOUD_STORAGE_PREFIX
      );
      const uiDensityScopedKey = getScopedStorageKey(
        mode,
        cloudUserId,
        UI_DENSITY_LOCAL_STORAGE_KEY,
        UI_DENSITY_CLOUD_STORAGE_PREFIX
      );
      if (
        !event.key ||
        (event.key !== executionModeScopedKey &&
          event.key !== telemetryShareScopedKey &&
          event.key !== sidebarCollapsedScopedKey &&
          event.key !== uiDensityScopedKey)
      ) {
        return;
      }

      const scopedExecutionMode = readScopedBoolean(
        mode,
        cloudUserId,
        EXECUTION_MODE_LOCAL_STORAGE_KEY,
        EXECUTION_MODE_CLOUD_STORAGE_PREFIX
      );
      const scopedTelemetryShare = readScopedBoolean(
        mode,
        cloudUserId,
        TELEMETRY_SHARE_LOCAL_STORAGE_KEY,
        TELEMETRY_SHARE_CLOUD_STORAGE_PREFIX
      );
      const scopedSidebarCollapsed = readScopedBoolean(
        mode,
        cloudUserId,
        SIDEBAR_COLLAPSED_LOCAL_STORAGE_KEY,
        SIDEBAR_COLLAPSED_CLOUD_STORAGE_PREFIX
      );
      const scopedUiDensity = readScopedUiDensity(
        mode,
        cloudUserId,
        UI_DENSITY_LOCAL_STORAGE_KEY,
        UI_DENSITY_CLOUD_STORAGE_PREFIX
      );
      setPreferences((prev) =>
        normalizePreferences({
          ...prev,
          executionModeEnabled:
            scopedExecutionMode === null ? prev.executionModeEnabled : scopedExecutionMode,
          telemetryShareEnabled:
            scopedTelemetryShare === null ? prev.telemetryShareEnabled : scopedTelemetryShare,
          sidebarCollapsed:
            scopedSidebarCollapsed === null ? prev.sidebarCollapsed : scopedSidebarCollapsed,
          uiDensity: scopedUiDensity === null ? prev.uiDensity : scopedUiDensity,
        })
      );
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [cloudUserId, mode]);

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
