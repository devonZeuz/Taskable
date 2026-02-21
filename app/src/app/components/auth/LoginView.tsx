import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { CloudRequestError, CLOUD_SYNC_ENABLED } from '../../services/cloudApi';
import {
  getAuthErrorMessage,
  isCloudUnreachableError,
  loginWithPassword,
  parseMfaChallenge,
} from '../../services/authClient';
import { useOnboarding } from '../../context/OnboardingContext';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import AuthScaffold from './AuthScaffold';

export default function LoginView() {
  const location = useLocation();
  const navigate = useNavigate();
  const { setMode, setCloudSession, isCloudAuthenticated } = useOnboarding();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaTicket, setMfaTicket] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const returnTo = useMemo(() => {
    const state = location.state as { from?: string } | null;
    return state?.from && state.from.startsWith('/') ? state.from : '/planner';
  }, [location.state]);

  useEffect(() => {
    setMode('cloud');
  }, [setMode]);

  if (isCloudAuthenticated) {
    return <Navigate to={returnTo} replace />;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    try {
      const session = await loginWithPassword({
        email: email.trim(),
        password,
        ...(mfaTicket ? { mfaTicket, mfaCode: mfaCode.trim() } : {}),
      });
      setCloudSession({
        token: session.token,
        refreshToken: session.refreshToken,
        orgId: session.defaultOrgId,
      });
      navigate(returnTo, { replace: true });
    } catch (error) {
      const challenge = parseMfaChallenge(error);
      if (challenge) {
        setMfaTicket(challenge.ticket);
        setMessage('Authenticator code required. Enter the 6-digit code and submit again.');
      } else if (isCloudUnreachableError(error)) {
        setMessage('Cloud API is unreachable. Check server status and VITE_API_URL.');
      } else {
        const detail = getAuthErrorMessage(error, 'Login failed.');
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
          onClick={() => {
            navigate('/welcome', { replace: true });
          }}
          className="ui-hud-btn h-10 w-full rounded-xl"
        >
          Back to welcome
        </Button>
      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold
      title="Sign in to Taskable Cloud"
      description="Use your cloud account to sync tasks and team workspace data."
      footer={
        <p>
          Need an account?{' '}
          <Link to="/signup" className="underline">
            Create one here
          </Link>
          .
        </p>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit} data-testid="auth-login-form">
        <div className="space-y-2">
          <Label htmlFor="login-email">Email</Label>
          <Input
            id="login-email"
            type="email"
            value={email}
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="login-password">Password</Label>
          <Input
            id="login-password"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>

        {mfaTicket ? (
          <div className="space-y-2">
            <Label htmlFor="login-mfa">Authenticator code</Label>
            <Input
              id="login-mfa"
              inputMode="numeric"
              pattern="[0-9]*"
              value={mfaCode}
              onChange={(event) => setMfaCode(event.target.value)}
              required
            />
          </div>
        ) : null}

        {message ? <p className="text-sm text-red-300">{message}</p> : null}

        <Button
          type="submit"
          disabled={submitting}
          className="ui-hud-btn-accent h-11 w-full rounded-xl"
        >
          {submitting ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>

      <div className="flex items-center justify-between text-sm text-[color:var(--hud-muted)]">
        <Link to="/forgot" className="underline">
          Forgot password?
        </Link>
        <Link to="/welcome" className="underline">
          Back
        </Link>
      </div>
    </AuthScaffold>
  );
}
