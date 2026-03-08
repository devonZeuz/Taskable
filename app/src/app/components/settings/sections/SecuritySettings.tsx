import { FormEvent, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useCloudSync } from '../../../context/CloudSyncContext';
import { cloudRequest } from '../../../services/cloudApi';
import { Button } from '../../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';

interface SessionRow {
  id: string;
  created_at: string;
  last_used_at: string;
  expires_at: string;
  revoked_at?: string | null;
  user_agent?: string | null;
  ip_address?: string | null;
}

interface MfaEnrollmentSetup {
  enabled: boolean;
  pending: boolean;
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

export default function SecuritySettings() {
  const {
    token,
    user,
    refreshSession,
    resendVerification,
    verifyEmailToken,
    requestPasswordReset,
    resetPassword,
    startMfaEnrollment,
    confirmMfaEnrollment,
    disableMfa,
  } = useCloudSync();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false);
  const [resetRequestDialogOpen, setResetRequestDialogOpen] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [enableMfaDialogOpen, setEnableMfaDialogOpen] = useState(false);
  const [disableMfaDialogOpen, setDisableMfaDialogOpen] = useState(false);
  const [verifyTokenValue, setVerifyTokenValue] = useState('');
  const [resetRequestEmail, setResetRequestEmail] = useState('');
  const [resetTokenValue, setResetTokenValue] = useState('');
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [mfaSetup, setMfaSetup] = useState<MfaEnrollmentSetup | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [disableMfaCode, setDisableMfaCode] = useState('');
  const [actionBusy, setActionBusy] = useState<
    'verify' | 'request-reset' | 'reset-password' | 'load-mfa' | 'enable-mfa' | 'disable-mfa' | null
  >(null);

  const fetchSessions = useCallback(async () => {
    if (!token) {
      setSessions([]);
      return;
    }
    setLoadingSessions(true);
    try {
      const payload = await cloudRequest<{ sessions: SessionRow[] }>('/api/v1/auth/sessions', {
        token,
      });
      setSessions(payload.sessions ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load sessions.';
      toast.error(message);
    } finally {
      setLoadingSessions(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    setResetRequestEmail(user?.email ?? '');
  }, [user?.email]);

  useEffect(() => {
    if (!enableMfaDialogOpen || mfaSetup || actionBusy === 'load-mfa') return;

    const loadMfaSetup = async () => {
      setActionBusy('load-mfa');
      try {
        const setup = await startMfaEnrollment();
        setMfaSetup(setup);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to prepare MFA setup.';
        toast.error(message);
        setEnableMfaDialogOpen(false);
      } finally {
        setActionBusy(null);
      }
    };

    void loadMfaSetup();
  }, [actionBusy, enableMfaDialogOpen, mfaSetup, startMfaEnrollment]);

  if (!token || !user) {
    return (
      <section className="ui-hud-section ui-v1-radius-md p-4">
        <p className="text-sm text-[color:var(--hud-muted)]">
          Sign in to a cloud account to manage verification, password recovery, and multi-factor
          authentication.
        </p>
      </section>
    );
  }

  const runResendVerification = async () => {
    try {
      await resendVerification();
      toast.success('Verification email sent.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to resend verification.';
      toast.error(message);
    }
  };

  const handleVerifyToken = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!verifyTokenValue.trim() || actionBusy) return;
    setActionBusy('verify');
    try {
      await verifyEmailToken(verifyTokenValue.trim());
      toast.success('Email verified.');
      setVerifyTokenValue('');
      setVerifyDialogOpen(false);
      await refreshSession();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Email verification failed.';
      toast.error(message);
    } finally {
      setActionBusy(null);
    }
  };

  const handlePasswordResetRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resetRequestEmail.trim() || actionBusy) return;
    setActionBusy('request-reset');
    try {
      await requestPasswordReset(resetRequestEmail.trim());
      toast.success('Password reset email sent.');
      setResetRequestDialogOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Password reset failed.';
      toast.error(message);
    } finally {
      setActionBusy(null);
    }
  };

  const handleResetWithToken = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resetTokenValue.trim() || !resetPasswordValue || actionBusy) return;
    setActionBusy('reset-password');
    try {
      await resetPassword(resetTokenValue.trim(), resetPasswordValue);
      toast.success('Password updated. Sign in again.');
      setResetTokenValue('');
      setResetPasswordValue('');
      setResetDialogOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Password reset failed.';
      toast.error(message);
    } finally {
      setActionBusy(null);
    }
  };

  const handleEnableMfa = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mfaCode.trim() || actionBusy || !mfaSetup) return;
    setActionBusy('enable-mfa');
    try {
      await confirmMfaEnrollment(mfaCode.trim());
      toast.success('MFA enabled.');
      setMfaCode('');
      setMfaSetup(null);
      setEnableMfaDialogOpen(false);
      await refreshSession();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to enable MFA.';
      toast.error(message);
    } finally {
      setActionBusy(null);
    }
  };

  const handleDisableMfa = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!disableMfaCode.trim() || actionBusy) return;
    setActionBusy('disable-mfa');
    try {
      await disableMfa(disableMfaCode.trim());
      toast.success('MFA disabled.');
      setDisableMfaCode('');
      setDisableMfaDialogOpen(false);
      await refreshSession();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to disable MFA.';
      toast.error(message);
    } finally {
      setActionBusy(null);
    }
  };

  const copyMfaSecret = async () => {
    if (!mfaSetup?.secret) return;
    try {
      await navigator.clipboard.writeText(mfaSetup.secret);
      toast.success('MFA secret copied.');
    } catch {
      toast.error('Unable to copy MFA secret.');
    }
  };

  return (
    <>
      <div className="space-y-4">
      <section className="ui-hud-section ui-v1-radius-md p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
          Account Status
        </p>
        <div className="mt-3 grid gap-2 text-sm text-[color:var(--hud-text)] md:grid-cols-2">
          <StatusRow
            label="Email verification"
            value={user.emailVerified ? 'Verified' : 'Pending'}
          />
          <StatusRow label="MFA" value={user.mfaEnabled ? 'Enabled' : 'Disabled'} />
          <StatusRow label="Email" value={user.email} />
          <StatusRow label="Name" value={user.name} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {!user.emailVerified && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void runResendVerification()}
              >
                Resend verification
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setVerifyDialogOpen(true)}
              >
                Enter verification code
              </Button>
            </>
          )}
          <Button
            type="button"
            variant={user.mfaEnabled ? 'outline' : 'default'}
            size="sm"
            onClick={() => {
              if (user.mfaEnabled) {
                setDisableMfaDialogOpen(true);
                return;
              }
              setMfaCode('');
              setMfaSetup(null);
              setEnableMfaDialogOpen(true);
            }}
          >
            {user.mfaEnabled ? 'Disable MFA' : 'Enable MFA'}
          </Button>
        </div>
      </section>

      <section className="ui-hud-section ui-v1-radius-md p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
          Password & Recovery
        </p>
        <p className="mt-2 text-sm leading-relaxed text-[color:var(--hud-muted)]">
          Send reset instructions to your account email or complete a token-based reset from inside
          the app.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setResetRequestEmail(user.email);
              setResetRequestDialogOpen(true);
            }}
          >
            Send reset email
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setResetDialogOpen(true)}
          >
            Use reset token
          </Button>
        </div>
      </section>

      <section className="ui-hud-section ui-v1-radius-md p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
            Session Activity
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void fetchSessions()}>
            Refresh
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-[color:var(--hud-muted)]">
          Review active sessions for this account. Session activity is updated automatically as the
          account is used.
        </p>
        <div className="mt-3 max-h-[240px] space-y-1 overflow-auto ui-hud-row ui-v1-radius-sm p-2">
          {loadingSessions && (
            <p className="px-2 py-1 text-xs text-[color:var(--hud-muted)]">Loading sessions...</p>
          )}
          {!loadingSessions && sessions.length === 0 && (
            <p className="px-2 py-1 text-xs text-[color:var(--hud-muted)]">No sessions found.</p>
          )}
          {sessions.map((session) => (
            <div
              key={session.id}
              className="rounded px-2 py-1 text-[11px] text-[color:var(--hud-muted)] hover:bg-[var(--hud-surface-soft)]"
            >
              <p className="truncate font-semibold text-[color:var(--hud-text)]">
                {session.user_agent || 'Unknown client'}
              </p>
              <p className="truncate text-[color:var(--hud-muted)]">
                Last used: {new Date(session.last_used_at).toLocaleString()} | Expires:{' '}
                {new Date(session.expires_at).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      </section>

      </div>

      <Dialog open={verifyDialogOpen} onOpenChange={setVerifyDialogOpen}>
        <DialogContent className="border-[color:var(--hud-border)] bg-[var(--hud-surface)] text-[color:var(--hud-text)]">
          <DialogHeader>
            <DialogTitle>Verify email</DialogTitle>
            <DialogDescription>
              Paste the verification code from your email to confirm this account.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => void handleVerifyToken(event)}>
            <div className="space-y-2">
              <Label htmlFor="security-verify-token">Verification code</Label>
              <Input
                id="security-verify-token"
                value={verifyTokenValue}
                onChange={(event) => setVerifyTokenValue(event.target.value)}
                autoComplete="off"
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={actionBusy === 'verify'}>
                {actionBusy === 'verify' ? 'Verifying...' : 'Verify email'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={resetRequestDialogOpen} onOpenChange={setResetRequestDialogOpen}>
        <DialogContent className="border-[color:var(--hud-border)] bg-[var(--hud-surface)] text-[color:var(--hud-text)]">
          <DialogHeader>
            <DialogTitle>Send password reset email</DialogTitle>
            <DialogDescription>
              Send reset instructions to the address linked to this account.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => void handlePasswordResetRequest(event)}>
            <div className="space-y-2">
              <Label htmlFor="security-reset-email">Email</Label>
              <Input
                id="security-reset-email"
                type="email"
                value={resetRequestEmail}
                onChange={(event) => setResetRequestEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={actionBusy === 'request-reset'}>
                {actionBusy === 'request-reset' ? 'Sending...' : 'Send reset email'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent className="border-[color:var(--hud-border)] bg-[var(--hud-surface)] text-[color:var(--hud-text)]">
          <DialogHeader>
            <DialogTitle>Complete password reset</DialogTitle>
            <DialogDescription>
              Enter the reset token and choose a new password for this account.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => void handleResetWithToken(event)}>
            <div className="space-y-2">
              <Label htmlFor="security-reset-token">Reset token</Label>
              <Input
                id="security-reset-token"
                value={resetTokenValue}
                onChange={(event) => setResetTokenValue(event.target.value)}
                autoComplete="off"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="security-reset-password">New password</Label>
              <Input
                id="security-reset-password"
                type="password"
                minLength={8}
                value={resetPasswordValue}
                onChange={(event) => setResetPasswordValue(event.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={actionBusy === 'reset-password'}>
                {actionBusy === 'reset-password' ? 'Updating...' : 'Update password'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={enableMfaDialogOpen}
        onOpenChange={(open) => {
          setEnableMfaDialogOpen(open);
          if (!open) {
            setMfaSetup(null);
            setMfaCode('');
          }
        }}
      >
        <DialogContent className="border-[color:var(--hud-border)] bg-[var(--hud-surface)] text-[color:var(--hud-text)] sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Enable MFA</DialogTitle>
            <DialogDescription>
              Scan the QR code with your authenticator app, then confirm the current 6-digit code.
            </DialogDescription>
          </DialogHeader>
          {actionBusy === 'load-mfa' || !mfaSetup ? (
            <div className="rounded-[14px] border border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] px-4 py-6 text-sm text-[color:var(--hud-muted)]">
              Preparing MFA setup...
            </div>
          ) : (
            <form className="space-y-4" onSubmit={(event) => void handleEnableMfa(event)}>
              <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
                <div className="rounded-[18px] border border-[color:var(--hud-border)] bg-white p-3">
                  <img src={mfaSetup.qrDataUrl} alt="Tareva MFA QR code" className="w-full" />
                </div>
                <div className="space-y-3">
                  <div className="rounded-[18px] border border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
                      Setup key
                    </p>
                    <p className="mt-2 break-all font-mono text-sm text-[color:var(--hud-text)]">
                      {mfaSetup.secret}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-3 h-8"
                      onClick={() => void copyMfaSecret()}
                    >
                      Copy key
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="security-mfa-code">Authenticator code</Label>
                    <Input
                      id="security-mfa-code"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={mfaCode}
                      onChange={(event) => setMfaCode(event.target.value)}
                      autoComplete="one-time-code"
                      required
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={actionBusy === 'enable-mfa'}>
                  {actionBusy === 'enable-mfa' ? 'Enabling...' : 'Enable MFA'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={disableMfaDialogOpen} onOpenChange={setDisableMfaDialogOpen}>
        <DialogContent className="border-[color:var(--hud-border)] bg-[var(--hud-surface)] text-[color:var(--hud-text)]">
          <DialogHeader>
            <DialogTitle>Disable MFA</DialogTitle>
            <DialogDescription>
              Enter the current authenticator code to confirm this change.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => void handleDisableMfa(event)}>
            <div className="space-y-2">
              <Label htmlFor="security-disable-mfa-code">Authenticator code</Label>
              <Input
                id="security-disable-mfa-code"
                inputMode="numeric"
                pattern="[0-9]*"
                value={disableMfaCode}
                onChange={(event) => setDisableMfaCode(event.target.value)}
                autoComplete="one-time-code"
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="submit"
                variant="outline"
                disabled={actionBusy === 'disable-mfa'}
              >
                {actionBusy === 'disable-mfa' ? 'Disabling...' : 'Disable MFA'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="ui-hud-row ui-v1-radius-sm px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.07em] text-[color:var(--hud-muted)]">
        {label}
      </p>
      <p className="text-sm font-semibold text-[color:var(--hud-text)]">{value}</p>
    </div>
  );
}
