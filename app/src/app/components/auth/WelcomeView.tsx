import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Cloud, Laptop, LogIn, UserPlus } from 'lucide-react';
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
      title="Choose your workspace mode"
      description="Start in local mode or sign in to cloud mode for sync across devices."
      footer={
        <p>
          You can switch modes anytime from settings. Local mode never calls cloud endpoints until
          you opt in.
        </p>
      }
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

      <div className="ui-hud-section space-y-2 rounded-2xl p-4 text-sm">
        <div className="flex items-center gap-2 text-[color:var(--hud-text)]">
          <Cloud className="size-4" />
          Cloud mode
        </div>
        <p className="text-[color:var(--hud-muted)]">
          Cloud mode syncs tasks and team presence. Local mode keeps everything on this device.
        </p>
      </div>

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
