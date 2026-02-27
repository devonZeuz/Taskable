import { FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { getAuthErrorMessage, requestPasswordReset } from '../../services/authClient';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import AuthScaffold from './AuthScaffold';

export default function ForgotPasswordView() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    try {
      await requestPasswordReset(email.trim());
      setSuccess(true);
      setMessage('If this email exists, a reset token was sent.');
    } catch (error) {
      setSuccess(false);
      setMessage(getAuthErrorMessage(error, 'Unable to request reset token.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthScaffold
      title="Reset your password"
      description="Request a reset token. Then use the reset page to set a new password."
      heroLead="Recovery for"
      heroTitle="Tareva"
      heroSubtitle="Use the reset flow to recover access without losing planner data or workspace history."
    >
      <form className="space-y-4" onSubmit={handleSubmit} data-testid="auth-forgot-form">
        <div className="space-y-2">
          <Label htmlFor="forgot-email">Email</Label>
          <Input
            id="forgot-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
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
          {submitting ? 'Requesting...' : 'Request reset token'}
        </Button>
      </form>

      <div className="flex items-center justify-between text-sm text-[color:var(--hud-muted)]">
        <Link to="/reset" className="underline">
          I already have a reset token
        </Link>
        <Link to="/login" className="underline">
          Back to sign in
        </Link>
      </div>
    </AuthScaffold>
  );
}
