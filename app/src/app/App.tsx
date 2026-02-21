import { RouterProvider } from 'react-router';
import { router } from './routes';
import { Toaster } from './components/ui/sonner';
import { OnboardingProvider } from './context/OnboardingContext';
import { AppThemeProvider } from './context/AppThemeContext';

export default function App() {
  return (
    <AppThemeProvider>
      <OnboardingProvider>
        <RouterProvider router={router} />
        <Toaster />
      </OnboardingProvider>
    </AppThemeProvider>
  );
}
