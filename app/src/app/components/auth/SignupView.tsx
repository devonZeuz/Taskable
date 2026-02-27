import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { CloudRequestError, CLOUD_SYNC_ENABLED } from '../../services/cloudApi';
import {
  getAuthErrorMessage,
  isCloudUnreachableError,
  registerWithPassword,
} from '../../services/authClient';
import { writeCloudTutorialCompleted } from '../../services/authStorage';
import { useOnboarding } from '../../context/OnboardingContext';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import AuthScaffold from './AuthScaffold';

export default function SignupView() {
  const location = useLocation();
  const navigate = useNavigate();
  const { setMode, setCloudSession } = useOnboarding();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const returnTo = useMemo(() => {
    const state = location.state as { from?: string } | null;
    return state?.from && state.from.startsWith('/') ? state.from : '/planner';
  }, [location.state]);

  useEffect(() => {
    setMode('cloud');
  }, [setMode]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setMessage(null);

    try {
      const session = await registerWithPassword({
        name: name.trim(),
        email: email.trim(),
        password,
      });
      const nextUserId = session.user?.id ?? null;
      if (nextUserId) {
        writeCloudTutorialCompleted(nextUserId, false);
      }
      setCloudSession({
        token: session.token,
        refreshToken: session.refreshToken,
        orgId: session.defaultOrgId,
        userId: nextUserId,
      });
      if (session.verificationRequired) {
        setMessage(
          'Account created. Verify your email from your inbox to unlock all cloud actions.'
        );
      }
      navigate(returnTo, { replace: true });
    } catch (error) {
      if (isCloudUnreachableError(error)) {
        setMessage('Cloud API is unreachable. Check server status and VITE_API_URL.');
      } else if (
        error instanceof CloudRequestError &&
        error.status === 409 &&
        error.payload &&
        typeof error.payload === 'object' &&
        'code' in error.payload &&
        (error.payload as { code?: string }).code === 'EMAIL_EXISTS'
      ) {
        setMessage('An account already exists for this email. Use Sign in instead.');
      } else {
        const detail = getAuthErrorMessage(error, 'Signup failed.');
        const requestId = error instanceof CloudRequestError ? error.requestId : null;
        setMessage(requestId ? `${detail} (request ${requestId})` : detail);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!CLOUD_SYNC_ENABLED) {
    return (
      <AuthScaffold
        title="Cloud mode unavailable"
        description="Cloud sync is disabled for this build."
      >
        <Button
          type="button"
          onClick={() => navigate('/welcome', { replace: true })}
          className="ui-hud-btn h-10 w-full rounded-xl"
        >
          Back to welcome
        </Button>
      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold
      title="Create account"
      description="Create a cloud workspace to sync tasks across web and desktop."
      footer={
        <p>
          Already have an account?{' '}
          <Link to="/login" className="underline">
            Sign in
          </Link>
          .
        </p>
      }
      heroLead="Build with"
      heroTitle="Tareva"
      heroSubtitle="Create your account once, then use the same planner and sync layer across every surface."
    >
      <form className="space-y-4" onSubmit={handleSubmit} data-testid="auth-signup-form">
        <div className="space-y-2">
          <Label htmlFor="signup-name">Name</Label>
          <Input
            id="signup-name"
            value={name}
            autoComplete="name"
            onChange={(event) => setName(event.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="signup-email">Email</Label>
          <Input
            id="signup-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="signup-password">Password</Label>
          <Input
            id="signup-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>

        {message ? <p className="text-sm text-red-300">{message}</p> : null}

        <Button
          type="submit"
          disabled={submitting}
          className="ui-hud-btn-accent h-11 w-full rounded-xl"
        >
          {submitting ? 'Creating account...' : 'Create account'}
        </Button>
      </form>

      <div className="text-sm text-[color:var(--hud-muted)]">
        <Link to="/welcome" className="underline">
          Back
        </Link>
      </div>
    </AuthScaffold>
  );
}
