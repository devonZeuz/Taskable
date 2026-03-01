import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cloudRequest } from '../services/cloudApi';
import {
  AUTH_STORAGE_EVENT,
  CLOUD_USER_ID_STORAGE_KEY,
  PLANNER_MODE_STORAGE_KEY,
  readCloudUserId,
  readPlannerMode,
} from '../services/authStorage';

export type AppTheme = 'default' | 'sugar-plum' | 'vibrant-pop' | 'mono' | 'white';

interface AppThemeContextType {
  theme: AppTheme;
  setTheme: (next: AppTheme) => void;
}

export const APP_THEMES: Array<{ value: AppTheme; label: string }> = [
  { value: 'default', label: 'Default Dark' },
  { value: 'white', label: 'Paper White' },
  { value: 'mono', label: 'True B/W' },
  { value: 'sugar-plum', label: 'Sugar Plum' },
  { value: 'vibrant-pop', label: 'Vibrant Pop' },
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
    { name: 'Hot Sugar', value: '#ee3f9b' },
    { name: 'Soft Plum', value: '#dcb3ca' },
    { name: 'Rose Punch', value: '#df2f8f' },
    { name: 'Petal Milk', value: '#e7bfd4' },
    { name: 'Berry Jam', value: '#c22f80' },
    { name: 'Blush Velvet', value: '#ce9fbe' },
    { name: 'Candy Heart', value: '#f05eab' },
    { name: 'Cloud Rose', value: '#edd1de' },
  ],
  'vibrant-pop': [
    { name: 'Electric Blue', value: '#0136fe' },
    { name: 'Acid Lime', value: '#b7f700' },
    { name: 'Bloom Pink', value: '#f14292' },
    { name: 'Hot Magenta', value: '#e63f97' },
    { name: 'Plum Pulse', value: '#b93d7d' },
    { name: 'Vivid Indigo', value: '#5d41ff' },
    { name: 'Cobalt', value: '#2c6dff' },
    { name: 'Neon Coral', value: '#ff4d8f' },
  ],
};

const STORAGE_KEY = 'taskable:app-theme';
const DEFAULT_THEME: AppTheme = 'default';
const CLOUD_THEME_SYNC_DEBOUNCE_MS = 140;

const AppThemeContext = createContext<AppThemeContextType | undefined>(undefined);

interface ThemeAuthSnapshot {
  mode: 'local' | 'cloud' | null;
  userId: string | null;
}

function isAppTheme(value: string | null): value is AppTheme {
  return (
    value === 'default' ||
    value === 'sugar-plum' ||
    value === 'vibrant-pop' ||
    value === 'mono' ||
    value === 'white'
  );
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

function readThemeAuthSnapshot(): ThemeAuthSnapshot {
  return {
    mode: readPlannerMode(),
    userId: readCloudUserId(),
  };
}

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(() => loadTheme());
  const [authSnapshot, setAuthSnapshot] = useState<ThemeAuthSnapshot>(() =>
    readThemeAuthSnapshot()
  );
  const [cloudThemeHydrated, setCloudThemeHydrated] = useState(false);
  const lastCloudSyncedThemeRef = useRef<AppTheme | null>(null);
  const currentThemeRef = useRef(theme);

  useEffect(() => {
    currentThemeRef.current = theme;
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Ignore localStorage failures.
    }
    document.documentElement.setAttribute('data-app-theme', theme);
  }, [theme]);

  useEffect(() => {
    const refreshAuthSnapshot = () => {
      setAuthSnapshot((previous) => {
        const next = readThemeAuthSnapshot();
        if (previous.mode === next.mode && previous.userId === next.userId) {
          return previous;
        }
        return next;
      });
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        const nextTheme = event.newValue;
        if (!isAppTheme(nextTheme)) return;
        setThemeState((previous) => (previous === nextTheme ? previous : nextTheme));
        return;
      }

      if (event.key === PLANNER_MODE_STORAGE_KEY || event.key === CLOUD_USER_ID_STORAGE_KEY) {
        refreshAuthSnapshot();
      }
    };

    window.addEventListener(AUTH_STORAGE_EVENT, refreshAuthSnapshot);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(AUTH_STORAGE_EVENT, refreshAuthSnapshot);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    if (authSnapshot.mode !== 'cloud' || !authSnapshot.userId) {
      setCloudThemeHydrated(false);
      lastCloudSyncedThemeRef.current = null;
      return;
    }

    let cancelled = false;
    setCloudThemeHydrated(false);
    void (async () => {
      try {
        const mePayload = await cloudRequest<{ user?: { appTheme?: string | null } }>(
          '/api/v1/me',
          {
            timeoutMs: 8_000,
          }
        );
        if (cancelled) return;

        const serverTheme = isAppTheme(mePayload.user?.appTheme ?? null)
          ? (mePayload.user?.appTheme as AppTheme)
          : null;
        if (serverTheme) {
          lastCloudSyncedThemeRef.current = serverTheme;
          setThemeState((previous) => (previous === serverTheme ? previous : serverTheme));
        } else {
          const fallbackTheme = currentThemeRef.current;
          await cloudRequest('/api/v1/me/theme', {
            method: 'PATCH',
            body: { theme: fallbackTheme },
            timeoutMs: 8_000,
          });
          if (cancelled) return;
          lastCloudSyncedThemeRef.current = fallbackTheme;
        }
      } catch {
        // Ignore cloud theme hydration failures and keep local theme.
      } finally {
        if (!cancelled) {
          setCloudThemeHydrated(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authSnapshot.mode, authSnapshot.userId]);

  useEffect(() => {
    if (authSnapshot.mode !== 'cloud' || !authSnapshot.userId || !cloudThemeHydrated) {
      return;
    }
    if (lastCloudSyncedThemeRef.current === theme) {
      return;
    }

    let cancelled = false;
    const syncTimer = window.setTimeout(() => {
      void (async () => {
        try {
          await cloudRequest('/api/v1/me/theme', {
            method: 'PATCH',
            body: { theme },
            timeoutMs: 8_000,
          });
          if (cancelled) return;
          lastCloudSyncedThemeRef.current = theme;
        } catch {
          // Ignore theme sync write failures and retry on next change.
        }
      })();
    }, CLOUD_THEME_SYNC_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(syncTimer);
    };
  }, [authSnapshot.mode, authSnapshot.userId, cloudThemeHydrated, theme]);

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
