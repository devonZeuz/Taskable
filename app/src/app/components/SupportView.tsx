import { useMemo, useState, useEffect } from 'react';
import { LifeBuoy, Mail, ShieldCheck } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { toast } from 'sonner';
import MarketingShell from './MarketingShell';
import { Button } from './ui/button';
import { recordProductEvent } from '../services/productAnalytics';

function buildSupportPacket(pathname: string) {
  return {
    appVersion: import.meta.env.VITE_APP_VERSION ?? 'dev',
    route: pathname,
    timezone:
      typeof Intl !== 'undefined'
        ? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
        : 'UTC',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    generatedAt: new Date().toISOString(),
  };
}

export default function SupportView() {
  const location = useLocation();
  const supportEmail = import.meta.env.VITE_SUPPORT_EMAIL?.trim();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    recordProductEvent({
      eventType: 'support_viewed',
      metadata: { path: '/support', supportEmailConfigured: Boolean(supportEmail) },
    });
  }, [supportEmail]);

  const supportPacket = useMemo(() => buildSupportPacket(location.pathname), [location.pathname]);
  const mailToHref = useMemo(() => {
    if (!supportEmail) return null;

    const body = [
      'Hi,',
      '',
      'I need help with Tareva.',
      '',
      'Issue summary:',
      '-',
      '',
      'Support packet:',
      JSON.stringify(supportPacket, null, 2),
    ].join('\n');

    return `mailto:${supportEmail}?subject=${encodeURIComponent(
      'Tareva support request'
    )}&body=${encodeURIComponent(body)}`;
  }, [supportEmail, supportPacket]);

  const copySupportPacket = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(supportPacket, null, 2));
      setCopied(true);
      toast.success('Support packet copied to clipboard.');
    } catch {
      toast.error('Unable to copy support packet.');
    }
  };

  return (
    <MarketingShell dataTestId="support-page">
      <section className="mx-auto mt-12 w-full max-w-[1180px] lg:mt-16">
        <div className="max-w-[760px]">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--hud-muted)]">
            Support
          </p>
          <h1 className="mt-3 text-[clamp(42px,5.6vw,68px)] font-bold leading-[0.95] tracking-[-0.05em]">
            A support surface that feels like a product, not an afterthought.
          </h1>
          <p className="mt-4 text-[16px] leading-relaxed text-[var(--hud-muted)]">
            Keep support simple at the start: one clear contact channel, one copyable support packet,
            and a short self-serve path to security and product-tour pages.
          </p>
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,360px)]">
          <section className="rounded-[28px] border border-[color:var(--hud-border)] bg-[color:color-mix(in_srgb,var(--hud-surface)_88%,transparent)] p-6">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--hud-text)]">
              <LifeBuoy className="size-4" />
              Support workflow
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <article className="rounded-[20px] border border-[color:var(--hud-border)] bg-[var(--hud-surface)] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--hud-muted)]">
                  Step 1
                </p>
                <p className="mt-2 text-sm font-semibold text-[var(--hud-text)]">Describe the issue</p>
                <p className="mt-1 text-[13px] leading-relaxed text-[var(--hud-muted)]">
                  Capture what happened, what you expected, and whether it blocks work.
                </p>
              </article>
              <article className="rounded-[20px] border border-[color:var(--hud-border)] bg-[var(--hud-surface)] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--hud-muted)]">
                  Step 2
                </p>
                <p className="mt-2 text-sm font-semibold text-[var(--hud-text)]">Copy the packet</p>
                <p className="mt-1 text-[13px] leading-relaxed text-[var(--hud-muted)]">
                  Share app version, route, timezone, and browser details without manual back-and-forth.
                </p>
              </article>
              <article className="rounded-[20px] border border-[color:var(--hud-border)] bg-[var(--hud-surface)] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--hud-muted)]">
                  Step 3
                </p>
                <p className="mt-2 text-sm font-semibold text-[var(--hud-text)]">Use one contact path</p>
                <p className="mt-1 text-[13px] leading-relaxed text-[var(--hud-muted)]">
                  Start with one email channel before investing in ticketing or chat widgets.
                </p>
              </article>
            </div>

            <div className="mt-6 rounded-[22px] border border-[color:var(--hud-border)] bg-[var(--hud-surface)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--hud-muted)]">
                Support packet preview
              </p>
              <pre className="mt-3 max-h-[240px] overflow-auto rounded-[18px] border border-[color:var(--hud-border)] bg-[color:color-mix(in_srgb,var(--hud-surface-soft)_92%,transparent)] p-3 text-[11px] text-[var(--hud-muted)]">
                {JSON.stringify(supportPacket, null, 2)}
              </pre>
            </div>
          </section>

          <aside className="space-y-4">
            <section className="rounded-[26px] border border-[color:var(--hud-border)] bg-[color:color-mix(in_srgb,var(--hud-surface-strong)_88%,transparent)] p-6">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--hud-text)]">
                <Mail className="size-4" />
                Contact channel
              </div>
              <p className="mt-3 text-sm leading-relaxed text-[var(--hud-muted)]">
                Keep support simple at launch: one direct contact path and one copyable support packet.
              </p>
              {mailToHref ? (
                <Button
                  asChild
                  type="button"
                  className="mt-4 h-10 w-full rounded-full border border-[color:var(--hud-border)] bg-[var(--hud-accent-bg)] text-[var(--hud-accent-text)] hover:brightness-110"
                >
                  <a href={mailToHref}>Email support</a>
                </Button>
              ) : (
                <div className="mt-4 rounded-[18px] border border-[color:var(--hud-border)] bg-[var(--hud-surface)] p-3 text-[13px] text-[var(--hud-muted)]">
                  No support email configured yet.
                </div>
              )}
              <Button
                type="button"
                variant="ghost"
                onClick={() => void copySupportPacket()}
                className="mt-3 h-10 w-full rounded-full border border-[color:var(--hud-border)] bg-[var(--hud-surface)] text-[var(--hud-text)] hover:bg-[var(--hud-surface-soft)]"
              >
                {copied ? 'Copied support packet' : 'Copy support packet'}
              </Button>
            </section>

            <section className="rounded-[26px] border border-[color:var(--hud-border)] bg-[var(--hud-surface)] p-6">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--hud-text)]">
                <ShieldCheck className="size-4" />
                Self-serve
              </div>
              <div className="mt-4 space-y-3">
                <Button
                  asChild
                  type="button"
                  variant="ghost"
                  className="h-10 w-full rounded-full border border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] text-[var(--hud-text)] hover:bg-[var(--hud-surface-strong)]"
                >
                  <Link to="/security">Read security summary</Link>
                </Button>
                <Button
                  asChild
                  type="button"
                  variant="ghost"
                  className="h-10 w-full rounded-full border border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] text-[var(--hud-text)] hover:bg-[var(--hud-surface-strong)]"
                >
                  <Link to="/demo">Open product tour</Link>
                </Button>
              </div>
            </section>
          </aside>
        </div>
      </section>
    </MarketingShell>
  );
}
