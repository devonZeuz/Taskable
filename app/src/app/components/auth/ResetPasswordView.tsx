import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { getAuthErrorMessage, resetPassword } from '../../services/authClient';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import AuthScaffold from './AuthScaffold';

export default function ResetPasswordView() {
  const [searchParams] = useSearchParams();
  const [token, setToken] = useState(() => searchParams.get('token') ?? '');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    try {
      await resetPassword(token.trim(), password);
      setSuccess(true);
      setPassword('');
      setMessage('Password reset completed. Sign in with your new password.');
    } catch (error) {
      setSuccess(false);
      setMessage(getAuthErrorMessage(error, 'Password reset failed.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthScaffold
      title="Set a new password"
      description="Paste your reset token and choose a strong password."
      heroLead="Secure your"
      heroTitle="Tareva"
      heroSubtitle="Set a new password and continue with the same account and workspace."
    >
      <form className="space-y-4" onSubmit={handleSubmit} data-testid="auth-reset-form">
        <div className="space-y-2">
          <Label htmlFor="reset-token">Reset token</Label>
          <Input
            id="reset-token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="reset-password">New password</Label>
          <Input
            id="reset-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>

        {message ? (
          <p className={`text-sm ${success ? 'text-emerald-300' : 'text-red-300'}`}>{message}</p>
        ) : null}

        <Button
          type="submit"
          disabled={submitting}
          className="ui-hud-btn-accent h-11 w-full rounded-xl"
        >
          {submitting ? 'Resetting...' : 'Reset password'}
        </Button>
      </form>

      <div className="flex items-center justify-between text-sm text-[color:var(--hud-muted)]">
        <Link to="/forgot" className="underline">
          Need another reset token?
        </Link>
        <Link to="/login" className="underline">
          Back to sign in
        </Link>
      </div>
    </AuthScaffold>
  );
}
