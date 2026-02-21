import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Laptop, LogIn, UserPlus } from 'lucide-react';
import { Button } from '../ui/button';
import AuthScaffold from './AuthScaffold';
import { useOnboarding } from '../../context/OnboardingContext';

export default function WelcomeView() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setMode, isCloudAuthenticated } = useOnboarding();

  const returnTo = useMemo(() => {
    const state = location.state as { from?: string } | null;
    return state?.from && state.from.startsWith('/') ? state.from : '/planner';
  }, [location.state]);

  const continueLocally = () => {
    setMode('local');
    navigate(returnTo, { replace: true });
  };

  const openLogin = () => {
    setMode('cloud');
    navigate('/login', { state: { from: returnTo } });
  };

  const openSignup = () => {
    setMode('cloud');
    navigate('/signup', { state: { from: returnTo } });
  };

  return (
    <AuthScaffold
      title="Choose your start mode"
      description="Local mode keeps data on this device. Cloud mode signs you in for cross-device sync."
      footer={
        <p>
          You can switch modes later in settings. Local mode never calls cloud endpoints until you
          opt in.
        </p>
      }
      heroLead="Welcome to"
      heroTitle="Taskable"
    >
      <div className="space-y-3" data-testid="welcome-screen">
        <Button
          type="button"
          onClick={continueLocally}
          data-testid="welcome-continue-local"
          className="ui-hud-btn-accent h-11 w-full justify-start rounded-xl px-4"
        >
          <Laptop className="size-4" />
          Continue locally
        </Button>
        <Button
          type="button"
          onClick={openLogin}
          data-testid="welcome-sign-in"
          className="ui-hud-btn h-11 w-full justify-start rounded-xl px-4"
        >
          <LogIn className="size-4" />
          Sign in
        </Button>
        <Button
          type="button"
          onClick={openSignup}
          data-testid="welcome-sign-up"
          className="ui-hud-btn h-11 w-full justify-start rounded-xl px-4"
        >
          <UserPlus className="size-4" />
          Create account
        </Button>
      </div>

      <p className="text-sm leading-relaxed text-[color:var(--hud-muted)]">
        Cloud mode syncs tasks and team presence. Local mode stays private on this machine.
      </p>

      {isCloudAuthenticated ? (
        <Button
          type="button"
          onClick={() => navigate('/planner', { replace: true })}
          className="ui-hud-btn h-10 w-full rounded-xl"
        >
          Continue to planner
        </Button>
      ) : null}
    </AuthScaffold>
  );
}
