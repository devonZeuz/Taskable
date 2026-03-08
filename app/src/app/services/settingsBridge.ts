export type SettingsSectionKey =
  | 'profile'
  | 'general'
  | 'notifications'
  | 'integrations'
  | 'data-backup'
  | 'team-permissions'
  | 'security'
  | 'about';

export const OPEN_SETTINGS_EVENT = 'taskable:open-settings';
export const CLOSE_SETTINGS_EVENT = 'taskable:close-settings';
export const PENDING_CONFLICT_TASK_ID_STORAGE_KEY = 'taskable:pending-conflict-task-id';

export interface OpenSettingsEventDetail {
  section?: SettingsSectionKey;
  conflictTaskId?: string;
}

export function requestOpenSettings(detail: OpenSettingsEventDetail) {
  if (typeof window === 'undefined') return;
  const normalizedTaskId = detail.conflictTaskId?.trim();
  if (normalizedTaskId) {
    try {
      window.localStorage.setItem(PENDING_CONFLICT_TASK_ID_STORAGE_KEY, normalizedTaskId);
    } catch {
      // Ignore storage failures.
    }
  }
  window.dispatchEvent(new CustomEvent<OpenSettingsEventDetail>(OPEN_SETTINGS_EVENT, { detail }));
}

export function requestCloseSettings() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CLOSE_SETTINGS_EVENT));
}

export function requestOpenConflictResolver(taskId: string) {
  requestOpenSettings({
    section: 'integrations',
    conflictTaskId: taskId,
  });
}

export function getPendingConflictTaskId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(PENDING_CONFLICT_TASK_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearPendingConflictTaskId() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PENDING_CONFLICT_TASK_ID_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}
