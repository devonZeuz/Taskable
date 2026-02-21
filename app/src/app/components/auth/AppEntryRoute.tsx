import { Navigate, useLocation } from 'react-router';
import { useOnboarding } from '../../context/OnboardingContext';

export default function AppEntryRoute() {
  const location = useLocation();
  const { mode, isCloudAuthenticated } = useOnboarding();
  const nextSearch = location.search ?? '';
  const plannerPath = `/planner${nextSearch}`;

  if (mode === 'local') {
    return <Navigate to={plannerPath} replace />;
  }

  if (mode === 'cloud' && isCloudAuthenticated) {
    return <Navigate to={plannerPath} replace />;
  }

  return <Navigate to="/welcome" replace state={{ from: plannerPath }} />;
}
