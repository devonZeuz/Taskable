import { useCallback, useEffect, useState } from 'react';
import { UICluster, UISurface, UIStack } from '../../../ui-system';
import { getAdminEmailHealth, type AdminEmailHealthResponse } from '../../services/adminApi';
import type { AdminPanelBaseProps } from './types';

interface EmailMetricRowProps {
  label: string;
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
}

function EmailMetricRow({ label, attempted, sent, failed, skipped }: EmailMetricRowProps) {
  return (
    <div className="rounded-lg border border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] p-3">
      <p className="text-sm font-semibold text-[color:var(--hud-text)]">{label}</p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-[color:var(--hud-muted)] md:grid-cols-4">
        <span>Attempted: {attempted}</span>
        <span>Sent: {sent}</span>
        <span>Failed: {failed}</span>
        <span>Skipped: {skipped}</span>
      </div>
    </div>
  );
}

export default function AdminEmailHealthPanel({ token, orgId, onError }: AdminPanelBaseProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AdminEmailHealthResponse | null>(null);

  const fetchEmailHealth = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await getAdminEmailHealth(token, { orgId });
      setData(payload);
    } catch (error) {
      onError(error, 'Failed to load email health.');
    } finally {
      setLoading(false);
    }
  }, [onError, orgId, token]);

  useEffect(() => {
    void fetchEmailHealth();
  }, [fetchEmailHealth]);

  if (loading) {
    return (
      <UISurface level="2" className="rounded-xl border border-[color:var(--hud-border)] p-4">
        <p className="text-sm text-[color:var(--hud-muted)]">Loading email health…</p>
      </UISurface>
    );
  }

  if (!data) {
    return (
      <UISurface level="2" className="rounded-xl border border-[color:var(--hud-border)] p-4">
        <p className="text-sm text-[color:var(--hud-muted)]">Email health data unavailable.</p>
      </UISurface>
    );
  }

  return (
    <UIStack gap="4" data-testid="admin-email-health-panel">
      <UISurface level="2" className="rounded-xl border border-[color:var(--hud-border)] p-4">
        <UICluster className="items-center justify-between">
          <p className="text-sm font-semibold text-[color:var(--hud-text)]">
            Provider: {data.providerMode}
          </p>
          <span className="rounded-full border border-[color:var(--hud-border)] px-2 py-0.5 text-xs text-[color:var(--hud-muted)]">
            {data.availability}
          </span>
        </UICluster>
        {data.explanation ? (
          <p className="mt-2 text-sm text-[color:var(--hud-muted)]">{data.explanation}</p>
        ) : null}
      </UISurface>

      <EmailMetricRow label="Verification emails" {...data.verification} />
      <EmailMetricRow label="Password reset emails" {...data.reset} />
    </UIStack>
  );
}
