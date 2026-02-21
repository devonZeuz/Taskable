import { Navigate, useLocation } from 'react-router';
import { useOnboarding } from '../../context/OnboardingContext';

export default function AppEntryRoute() {
  const location = useLocation();
  const { mode, isCloudAuthenticated } = useOnboarding();
  const nextSearch = location.search ?? '';
  const searchParams = new URLSearchParams(nextSearch);
  const forceWelcome = searchParams.get('welcome') === '1';
  const persistMode = searchParams.get('persistMode') === '1';
  const isLocalDevHost =
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    /^(localhost|127\\.0\\.0\\.1|::1|\\[::1\\])$/i.test(window.location.hostname);

  const plannerPath = `/planner${nextSearch}`;

  // In local dev we default "/" to onboarding for faster auth/onboarding test loops.
  if (forceWelcome || (isLocalDevHost && !persistMode)) {
    return <Navigate to="/welcome" replace state={{ from: plannerPath }} />;
  }

  if (mode === 'local') {
    return <Navigate to={plannerPath} replace />;
  }

  if (mode === 'cloud' && isCloudAuthenticated) {
    return <Navigate to={plannerPath} replace />;
  }

  return <Navigate to="/welcome" replace state={{ from: plannerPath }} />;
}
