import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type AppTheme = 'default' | 'sugar-plum' | 'mono' | 'white';

interface AppThemeContextType {
  theme: AppTheme;
  setTheme: (next: AppTheme) => void;
}

export const APP_THEMES: Array<{ value: AppTheme; label: string }> = [
  { value: 'default', label: 'Default Dark' },
  { value: 'white', label: 'Paper White' },
  { value: 'mono', label: 'True B/W' },
  { value: 'sugar-plum', label: 'Sugar Plum' },
];

export const APP_THEME_TASK_SWATCHES: Record<AppTheme, Array<{ name: string; value: string }>> = {
  default: [
    { name: 'Graphite', value: '#1f1f22' },
    { name: 'Slate', value: '#3a3a40' },
    { name: 'Ash', value: '#53535b' },
    { name: 'Steel', value: '#6f6f79' },
    { name: 'Fog', value: '#9a9aa3' },
    { name: 'Cloud', value: '#c8c8ce' },
    { name: 'Mist', value: '#dedee3' },
    { name: 'Paper', value: '#f3f3f5' },
  ],
  mono: [
    { name: 'Pitch', value: '#000000' },
    { name: 'Onyx', value: '#141414' },
    { name: 'Charcoal', value: '#2a2a2a' },
    { name: 'Smoke', value: '#4a4a4a' },
    { name: 'Stone', value: '#6a6a6a' },
    { name: 'Silver', value: '#9a9a9a' },
    { name: 'Pearl', value: '#cdcdcd' },
    { name: 'White', value: '#ffffff' },
  ],
  white: [
    { name: 'Ink', value: '#0f1012' },
    { name: 'Graphite', value: '#2d2f33' },
    { name: 'Slate', value: '#5a5e65' },
    { name: 'Silver', value: '#8d929c' },
    { name: 'Cloud', value: '#c9ced8' },
    { name: 'Paper', value: '#eceff4' },
    { name: 'Snow', value: '#f8f9fb' },
    { name: 'White', value: '#ffffff' },
  ],
  'sugar-plum': [
    { name: 'Hot Pink', value: '#e63f97' },
    { name: 'Blush', value: '#ddb1c8' },
    { name: 'Rose', value: '#d9318a' },
    { name: 'Petal', value: '#e7c0d3' },
    { name: 'Plum', value: '#b93d7d' },
    { name: 'Berry', value: '#922a66' },
    { name: 'Carnation', value: '#f27ab7' },
    { name: 'Lilac Mist', value: '#f1d4e2' },
  ],
};

const STORAGE_KEY = 'taskable:app-theme';
const DEFAULT_THEME: AppTheme = 'default';

const AppThemeContext = createContext<AppThemeContextType | undefined>(undefined);

function isAppTheme(value: string | null): value is AppTheme {
  return value === 'default' || value === 'sugar-plum' || value === 'mono' || value === 'white';
}

function loadTheme(): AppTheme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isAppTheme(stored)) return stored;
  } catch {
    // Ignore localStorage failures.
  }
  return DEFAULT_THEME;
}

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(() => loadTheme());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Ignore localStorage failures.
    }
    document.documentElement.setAttribute('data-app-theme', theme);
  }, [theme]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      const nextTheme = event.newValue;
      if (!isAppTheme(nextTheme)) return;
      setThemeState((previous) => (previous === nextTheme ? previous : nextTheme));
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const setTheme = useCallback((next: AppTheme) => {
    setThemeState(next);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}

export function useAppTheme() {
  const context = useContext(AppThemeContext);
  if (!context) {
    throw new Error('useAppTheme must be used within AppThemeProvider');
  }
  return context;
}
