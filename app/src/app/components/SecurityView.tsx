import { useEffect } from 'react';
import { Link } from 'react-router';
import MarketingShell from './MarketingShell';
import { Button } from './ui/button';
import { recordProductEvent } from '../services/productAnalytics';

const SECURITY_SECTIONS = [
  {
    title: 'Local-first by design',
    body:
      'Local mode keeps planner data on the device. Users can export, restore, or reset local data from in-app settings.',
  },
  {
    title: 'Cloud auth and sessions',
    body:
      'Cloud mode supports email verification, password reset, and MFA. The backend is documented to use httpOnly cookie sessions instead of exposing tokens in localStorage.',
  },
  {
    title: 'Conflict-safe collaboration',
    body:
      'Cloud sync uses versioned writes, presence locks, and conflict handling so two people cannot silently overwrite the same work.',
  },
  {
    title: 'Operational visibility',
    body:
      'Metrics, sync health, email health, and diagnostics surfaces already exist so reliability issues can be inspected instead of guessed at.',
  },
  {
    title: 'Access control',
    body:
      'Workspace roles support owner, admin, member, and viewer access patterns. Admin access is guarded and not exposed as a casual runtime toggle.',
  },
  {
    title: 'Telemetry boundaries',
    body:
      'Operational telemetry is designed to avoid raw task-title payloads by default, and the product exposes telemetry sharing controls in settings.',
  },
] as const;

export default function SecurityView() {
  useEffect(() => {
    recordProductEvent({
      eventType: 'security_viewed',
      metadata: { path: '/security' },
    });
  }, []);

  return (
    <MarketingShell dataTestId="security-page">
      <section className="mx-auto mt-12 w-full max-w-[1180px] lg:mt-16">
        <div className="max-w-[760px]">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--hud-muted)]">
            Security & Privacy
          </p>
          <h1 className="mt-3 text-[clamp(42px,5.6vw,68px)] font-bold leading-[0.95] tracking-[-0.05em]">
            Understand how Tareva handles privacy, sync, and access.
          </h1>
          <p className="mt-4 text-[16px] leading-relaxed text-[var(--hud-muted)]">
            This summary explains what stays on your device, what changes when cloud sync is enabled,
            and which controls exist today for account security and collaboration.
          </p>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {SECURITY_SECTIONS.map((section) => (
            <article
              key={section.title}
              className="rounded-[24px] border border-[color:var(--hud-border)] bg-[color:color-mix(in_srgb,var(--hud-surface)_86%,transparent)] p-5"
            >
              <h2 className="text-[21px] font-semibold tracking-[-0.03em] text-[var(--hud-text)]">
                {section.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--hud-muted)]">{section.body}</p>
            </article>
          ))}
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="rounded-[26px] border border-[color:var(--hud-border)] bg-[var(--hud-surface)] p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--hud-muted)]">
              What this page is
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[var(--hud-muted)]">
              This is a plain-language overview of the current product protections and controls. It
              is meant to help users and pilot teams understand how the product behaves today.
            </p>
          </section>

          <aside className="rounded-[26px] border border-[color:var(--hud-border)] bg-[color:color-mix(in_srgb,var(--hud-surface-strong)_88%,transparent)] p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--hud-muted)]">
              Need more detail?
            </p>
            <div className="mt-4 space-y-3 text-sm text-[var(--hud-muted)]">
              <p>Open the support page to report an issue or ask a question.</p>
              <p>Use local mode if you want to keep planning data on this device.</p>
              <p>Use cloud mode if you need sync, shared access, or team coordination.</p>
            </div>
            <Button
              asChild
              type="button"
              variant="ghost"
              className="mt-5 h-10 w-full rounded-full border border-[color:var(--hud-border)] bg-[var(--hud-surface)] text-[var(--hud-text)] hover:bg-[var(--hud-surface-soft)]"
            >
              <Link to="/support">Open support channel</Link>
            </Button>
          </aside>
        </div>
      </section>
    </MarketingShell>
  );
}
