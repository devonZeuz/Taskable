export type PlannerMode = 'local' | 'cloud';

export const AUTH_STORAGE_EVENT = 'taskable:auth-storage-updated';
export const PLANNER_MODE_STORAGE_KEY = 'taskable:mode';
export const CLOUD_TOKEN_STORAGE_KEY = 'taskable:cloud-token';
export const CLOUD_REFRESH_TOKEN_STORAGE_KEY = 'taskable:cloud-refresh-token';
export const CLOUD_ORG_STORAGE_KEY = 'taskable:cloud-org-id';
export const CLOUD_AUTO_SYNC_STORAGE_KEY = 'taskable:cloud-auto-sync';

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function safeGetItem(key: string): string | null {
  if (!canUseStorage()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage write errors (private mode, quota, etc.).
  }
}

function safeRemoveItem(key: string) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage write errors (private mode, quota, etc.).
  }
}

export function notifyAuthStorageUpdated() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(AUTH_STORAGE_EVENT));
}

export function readPlannerMode(): PlannerMode | null {
  const value = safeGetItem(PLANNER_MODE_STORAGE_KEY);
  if (value === 'local' || value === 'cloud') return value;
  return null;
}

export function writePlannerMode(mode: PlannerMode | null) {
  if (mode === null) {
    safeRemoveItem(PLANNER_MODE_STORAGE_KEY);
  } else {
    safeSetItem(PLANNER_MODE_STORAGE_KEY, mode);
  }
  notifyAuthStorageUpdated();
}

export function readCloudToken(): string | null {
  return safeGetItem(CLOUD_TOKEN_STORAGE_KEY);
}

export function hasCloudToken(): boolean {
  return Boolean(readCloudToken());
}

export function saveCloudSession({
  token,
  refreshToken,
  orgId,
}: {
  token: string;
  refreshToken?: string | null;
  orgId?: string | null;
}) {
  safeSetItem(CLOUD_TOKEN_STORAGE_KEY, token);
  if (typeof refreshToken === 'string' && refreshToken.length > 0) {
    safeSetItem(CLOUD_REFRESH_TOKEN_STORAGE_KEY, refreshToken);
  } else if (refreshToken === null) {
    safeRemoveItem(CLOUD_REFRESH_TOKEN_STORAGE_KEY);
  }
  if (typeof orgId === 'string' && orgId.length > 0) {
    safeSetItem(CLOUD_ORG_STORAGE_KEY, orgId);
  }
  notifyAuthStorageUpdated();
}

export function clearCloudSessionStorage() {
  safeRemoveItem(CLOUD_TOKEN_STORAGE_KEY);
  safeRemoveItem(CLOUD_REFRESH_TOKEN_STORAGE_KEY);
  safeRemoveItem(CLOUD_ORG_STORAGE_KEY);
  notifyAuthStorageUpdated();
}
