export const adminDashboardV1 = false;
export const layoutV1 = true;
export const executionModeV1 = false;

export const ADMIN_DASHBOARD_FLAG_STORAGE_KEY = 'taskable:admin-dashboard-v1';
export const ADMIN_DASHBOARD_QUERY_PARAM = 'adminV1';
export const LAYOUT_V1_FLAG_STORAGE_KEY = 'taskable:layout-v1';
export const LAYOUT_V1_QUERY_PARAM = 'layoutV1';
export const EXECUTION_MODE_V1_FLAG_STORAGE_KEY = 'taskable:execution-mode-v1';
export const EXECUTION_MODE_V1_QUERY_PARAM = 'executionModeV1';

const TRUE_VALUES = new Set(['1', 'true', 'on', 'enabled']);
const FALSE_VALUES = new Set(['0', 'false', 'off', 'disabled']);

function parseBooleanFlag(value: string | null | undefined): boolean | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return null;
}

function getEnvOverride(envKey: string): boolean | null {
  if (typeof import.meta === 'undefined') return null;
  const rawValue = (import.meta.env?.[envKey] as string | undefined) ?? null;
  return parseBooleanFlag(rawValue);
}

function getRuntimeOverride(queryParam: string, storageKey: string): boolean | null {
  if (typeof window === 'undefined') return null;

  const queryValue = new URLSearchParams(window.location.search).get(queryParam);
  const queryOverride = parseBooleanFlag(queryValue);
  if (queryOverride !== null) {
    try {
      window.localStorage.setItem(storageKey, queryOverride ? '1' : '0');
    } catch {
      // Ignore storage failures.
    }
    return queryOverride;
  }

  try {
    const persistedValue = window.localStorage.getItem(storageKey);
    return parseBooleanFlag(persistedValue);
  } catch {
    return null;
  }
}

function resolveFeatureFlag(
  envKey: string,
  queryParam: string,
  storageKey: string,
  defaultValue: boolean
): boolean {
  const envOverride = getEnvOverride(envKey);
  if (envOverride !== null) return envOverride;

  const runtimeOverride = getRuntimeOverride(queryParam, storageKey);
  if (runtimeOverride !== null) return runtimeOverride;

  return defaultValue;
}

export function resolveAdminDashboardFlag(defaultValue = adminDashboardV1): boolean {
  const envOverride = getEnvOverride('VITE_ENABLE_ADMIN');
  if (envOverride !== null) return envOverride;
  return defaultValue;
}

export function resolveLayoutV1Flag(defaultValue = layoutV1): boolean {
  return resolveFeatureFlag(
    'VITE_LAYOUT_V1',
    LAYOUT_V1_QUERY_PARAM,
    LAYOUT_V1_FLAG_STORAGE_KEY,
    defaultValue
  );
}

export function resolveExecutionModeV1Flag(defaultValue = executionModeV1): boolean {
  return resolveFeatureFlag(
    'VITE_ENABLE_EXECUTION_MODE_V1',
    EXECUTION_MODE_V1_QUERY_PARAM,
    EXECUTION_MODE_V1_FLAG_STORAGE_KEY,
    defaultValue
  );
}
