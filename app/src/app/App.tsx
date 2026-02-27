import { useEffect } from 'react';
import { RouterProvider } from 'react-router';
import { router } from './routes';
import { Toaster } from './components/ui/sonner';
import { OnboardingProvider } from './context/OnboardingContext';
import { AppThemeProvider } from './context/AppThemeContext';
import { UISystemProvider } from '../ui-system';
import { ADMIN_DASHBOARD_FLAG_STORAGE_KEY } from './flags';

const TODAY_NOTE_STORAGE_PREFIX = 'taskable:today-note:';
const TODAY_NOTE_RETENTION_DAYS = 90;

export default function App() {
  useEffect(() => {
    try {
      window.localStorage.removeItem(ADMIN_DASHBOARD_FLAG_STORAGE_KEY);
    } catch {
      // Ignore storage cleanup errors.
    }
  }, []);

  useEffect(() => {
    try {
      const cutoffMs = Date.now() - TODAY_NOTE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const storageKey = window.localStorage.key(index);
        if (!storageKey || !storageKey.startsWith(TODAY_NOTE_STORAGE_PREFIX)) continue;
        const dayValue = storageKey.slice(TODAY_NOTE_STORAGE_PREFIX.length);
        const parsedMs = Date.parse(dayValue);
        if (!Number.isNaN(parsedMs) && parsedMs < cutoffMs) {
          window.localStorage.removeItem(storageKey);
        }
      }
    } catch {
      // Ignore storage cleanup errors.
    }
  }, []);

  return (
    <AppThemeProvider>
      <UISystemProvider>
        <OnboardingProvider>
          <RouterProvider router={router} />
          <Toaster />
        </OnboardingProvider>
      </UISystemProvider>
    </AppThemeProvider>
  );
}
