export const uiSystemV1 = true;

export const UI_SYSTEM_FLAG_STORAGE_KEY = 'taskable:ui-system-v1';
export const UI_SYSTEM_QUERY_PARAM = 'uiSystemV1';
export const UI_SYSTEM_ROOT_CLASS = 'ui-system-v1';

const TRUE_VALUES = new Set(['1', 'true', 'on', 'enabled']);
const FALSE_VALUES = new Set(['0', 'false', 'off', 'disabled']);

function parseBooleanFlag(value: string | null | undefined): boolean | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return null;
}

function getEnvOverride(): boolean | null {
  if (typeof import.meta === 'undefined') return null;
  const rawValue = (import.meta.env?.VITE_UI_SYSTEM_V1 as string | undefined) ?? null;
  return parseBooleanFlag(rawValue);
}

function getRuntimeOverride(): boolean | null {
  if (typeof window === 'undefined') return null;

  const queryValue = new URLSearchParams(window.location.search).get(UI_SYSTEM_QUERY_PARAM);
  const queryOverride = parseBooleanFlag(queryValue);
  if (queryOverride !== null) {
    try {
      window.localStorage.setItem(UI_SYSTEM_FLAG_STORAGE_KEY, queryOverride ? '1' : '0');
    } catch {
      // Ignore storage failures (private mode, quotas, etc.).
    }
    return queryOverride;
  }

  try {
    const persistedValue = window.localStorage.getItem(UI_SYSTEM_FLAG_STORAGE_KEY);
    return parseBooleanFlag(persistedValue);
  } catch {
    return null;
  }
}

export function resolveUiSystemFlag(defaultValue = uiSystemV1): boolean {
  const envOverride = getEnvOverride();
  if (envOverride !== null) return envOverride;

  const runtimeOverride = getRuntimeOverride();
  if (runtimeOverride !== null) return runtimeOverride;

  return defaultValue;
}
