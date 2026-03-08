import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { getAuthErrorMessage, verifyEmailToken } from '../../services/authClient';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import AuthScaffold from './AuthScaffold';

export default function VerifyView() {
  const [searchParams] = useSearchParams();
  const [token, setToken] = useState(() => searchParams.get('token') ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    try {
      await verifyEmailToken(token.trim());
      setSuccess(true);
      setMessage('Email verified. You can now sign in.');
    } catch (error) {
      setSuccess(false);
      setMessage(getAuthErrorMessage(error, 'Verification failed.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthScaffold
      title="Verify your email"
      description="Paste the verification code from your email to activate your cloud account."
      heroLead="Trust layer for"
      heroTitle="Tareva"
      heroSubtitle="Verification protects workspace access and keeps recovery paths secure."
    >
      <form className="space-y-4" onSubmit={handleSubmit} data-testid="auth-verify-form">
        <div className="space-y-2">
          <Label htmlFor="verify-token">Verification code</Label>
          <Input
            id="verify-token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
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
          {submitting ? 'Verifying...' : 'Verify email'}
        </Button>
      </form>

      <div className="flex items-center justify-between text-sm text-[color:var(--hud-muted)]">
        <Link to="/login" className="underline">
          Go to sign in
        </Link>
        <Link to="/welcome" className="underline">
          Back
        </Link>
      </div>
    </AuthScaffold>
  );
}
