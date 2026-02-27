import { useEffect } from 'react';
import { RouterProvider } from 'react-router';
import { router } from './routes';
import { Toaster } from './components/ui/sonner';
import { OnboardingProvider } from './context/OnboardingContext';
import { AppThemeProvider } from './context/AppThemeContext';
import { UISystemProvider } from '../ui-system';
import { ADMIN_DASHBOARD_FLAG_STORAGE_KEY } from './flags';

export default function App() {
  useEffect(() => {
    try {
      window.localStorage.removeItem(ADMIN_DASHBOARD_FLAG_STORAGE_KEY);
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
