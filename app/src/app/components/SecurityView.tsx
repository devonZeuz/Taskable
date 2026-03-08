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
            Security and privacy, explained in product terms.
          </h1>
          <p className="mt-4 text-[16px] leading-relaxed text-[var(--hud-muted)]">
            Tareva already has more engineering discipline than most early-stage productivity tools.
            This page turns that into a public-facing summary users and internal stakeholders can read quickly.
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
              Current product note
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[var(--hud-muted)]">
              This summary is a plain-language overview of implemented protections and controls in the current product.
              It is not a legal policy or a substitute for formal vendor review. As the product matures, this should expand
              into full privacy, terms, and security documentation.
            </p>
          </section>

          <aside className="rounded-[26px] border border-[color:var(--hud-border)] bg-[color:color-mix(in_srgb,var(--hud-surface-strong)_88%,transparent)] p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--hud-muted)]">
              Next surfaces
            </p>
            <div className="mt-4 space-y-3 text-sm text-[var(--hud-muted)]">
              <p>Publish a formal privacy policy.</p>
              <p>Publish terms of use.</p>
              <p>Add a security review changelog for releases.</p>
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
