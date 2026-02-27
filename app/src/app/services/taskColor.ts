import { APP_THEME_TASK_SWATCHES, type AppTheme } from '../context/AppThemeContext';

const APP_THEME_STORAGE_KEY = 'taskable:app-theme';

function isAppTheme(value: string | null): value is AppTheme {
  return value === 'default' || value === 'white' || value === 'mono' || value === 'sugar-plum';
}

function getRandomIndex(length: number): number {
  if (length <= 1) return 0;
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return buffer[0] % length;
  }
  return Math.floor(Math.random() * length);
}

export function getCurrentThemeForTaskColors(explicitTheme?: AppTheme): AppTheme {
  if (explicitTheme) return explicitTheme;

  if (typeof document !== 'undefined') {
    const fromAttr = document.documentElement.getAttribute('data-app-theme');
    if (isAppTheme(fromAttr)) return fromAttr;
  }

  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem(APP_THEME_STORAGE_KEY);
      if (isAppTheme(stored)) return stored;
    } catch {
      // Ignore localStorage failures.
    }
  }

  return 'default';
}

export function getRandomThemeColor(theme?: AppTheme): string {
  const resolvedTheme = getCurrentThemeForTaskColors(theme);
  const swatches = APP_THEME_TASK_SWATCHES[resolvedTheme];
  if (!Array.isArray(swatches) || swatches.length === 0) {
    return '#8d929c';
  }
  return swatches[getRandomIndex(swatches.length)]?.value ?? swatches[0].value;
}
