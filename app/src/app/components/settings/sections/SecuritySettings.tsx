import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useCloudSync } from '../../../context/CloudSyncContext';
import { cloudRequest } from '../../../services/cloudApi';
import { Button } from '../../ui/button';

interface SessionRow {
  id: string;
  created_at: string;
  last_used_at: string;
  expires_at: string;
  revoked_at?: string | null;
  user_agent?: string | null;
  ip_address?: string | null;
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

  const fetchSessions = useCallback(async () => {
    if (!token) {
      setSessions([]);
      return;
    }
    setLoadingSessions(true);
    try {
      const payload = await cloudRequest<{ sessions: SessionRow[] }>('/api/auth/sessions', {
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

  if (!token || !user) {
    return (
      <section className="ui-hud-section rounded-[14px] p-4">
        <p className="text-sm text-[color:var(--hud-muted)]">
          Connect a cloud account to manage security settings.
        </p>
      </section>
    );
  }

  const runResendVerification = async () => {
    try {
      await resendVerification();
      toast.success('Verification email queued.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to resend verification.';
      toast.error(message);
    }
  };

  const runVerifyWithToken = async () => {
    const tokenInput = window.prompt('Enter verification token:');
    if (!tokenInput) return;
    try {
      await verifyEmailToken(tokenInput);
      toast.success('Email verified.');
      await refreshSession();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Email verification failed.';
      toast.error(message);
    }
  };

  const runPasswordReset = async () => {
    const targetEmail = window.prompt('Password reset email:', user.email);
    if (!targetEmail) return;
    try {
      await requestPasswordReset(targetEmail);
      toast.success('Password reset requested.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Password reset failed.';
      toast.error(message);
    }
  };

  const runResetWithToken = async () => {
    const resetTokenInput = window.prompt('Reset token:');
    if (!resetTokenInput) return;
    const newPassword = window.prompt('New password (min 8 chars):');
    if (!newPassword) return;
    try {
      await resetPassword(resetTokenInput, newPassword);
      toast.success('Password updated. Sign in again.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Password reset failed.';
      toast.error(message);
    }
  };

  const runEnableMfa = async () => {
    try {
      const setup = await startMfaEnrollment();
      const qrWindow = window.open('', '_blank', 'noopener,noreferrer,width=360,height=420');
      if (qrWindow) {
        qrWindow.document.title = 'Taskable MFA Setup';
        qrWindow.document.body.style.margin = '0';
        qrWindow.document.body.style.fontFamily =
          "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        qrWindow.document.body.style.background = '#17181d';
        qrWindow.document.body.style.color = '#f3f4f7';
        qrWindow.document.body.style.display = 'grid';
        qrWindow.document.body.style.placeItems = 'center';
        qrWindow.document.body.innerHTML = `
          <div style="padding:16px;text-align:center;">
            <p style="margin:0 0 10px;font-size:14px;">Scan this QR with your authenticator app</p>
            <img src="${setup.qrDataUrl}" alt="Taskable MFA QR" width="240" height="240" />
          </div>
        `;
      }

      window.prompt('Save this MFA secret before confirming:', setup.secret);
      const verificationCode = window.prompt('Enter the 6-digit authenticator code:');
      if (!verificationCode) return;

      await confirmMfaEnrollment(verificationCode);
      toast.success('MFA enabled.');
      await refreshSession();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to enable MFA.';
      toast.error(message);
    }
  };

  const runDisableMfa = async () => {
    const verificationCode = window.prompt('Enter current 6-digit authenticator code:');
    if (!verificationCode) return;
    try {
      await disableMfa(verificationCode);
      toast.success('MFA disabled.');
      await refreshSession();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to disable MFA.';
      toast.error(message);
    }
  };

  return (
    <div className="space-y-4">
      <section className="ui-hud-section rounded-[14px] p-4">
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
                onClick={() => void runVerifyWithToken()}
              >
                Enter verification token
              </Button>
            </>
          )}
          <Button
            type="button"
            variant={user.mfaEnabled ? 'outline' : 'default'}
            size="sm"
            onClick={() => void (user.mfaEnabled ? runDisableMfa() : runEnableMfa())}
          >
            {user.mfaEnabled ? 'Disable MFA' : 'Enable MFA'}
          </Button>
        </div>
      </section>

      <section className="ui-hud-section rounded-[14px] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
          Password & Recovery
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void runPasswordReset()}>
            Request password reset
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => void runResetWithToken()}>
            Use reset token
          </Button>
        </div>
      </section>

      <section className="ui-hud-section rounded-[14px] p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
            Session Activity
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void fetchSessions()}>
            Refresh
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-[color:var(--hud-muted)]">
          Session rotation is active. Global sign-out endpoint is WIP.
        </p>
        <div className="mt-3 max-h-[240px] space-y-1 overflow-auto ui-hud-row rounded-[10px] p-2">
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
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="ui-hud-row rounded-[10px] px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.07em] text-[color:var(--hud-muted)]">
        {label}
      </p>
      <p className="text-sm font-semibold text-[color:var(--hud-text)]">{value}</p>
    </div>
  );
}
