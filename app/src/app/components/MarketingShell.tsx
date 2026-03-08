import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { Button } from './ui/button';

const NAV_ITEMS = [
  { to: '/welcome', label: 'Product' },
  { to: '/demo', label: 'Demo' },
  { to: '/security', label: 'Security' },
  { to: '/support', label: 'Support' },
] as const;

function NavLink({
  to,
  label,
  active,
}: {
  to: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      className={`rounded-full px-3 py-1.5 text-[12px] font-semibold tracking-[0.08em] uppercase transition ${
        active
          ? 'bg-[var(--hud-surface-strong)] text-[var(--hud-text)]'
          : 'text-[var(--hud-muted)] hover:bg-[var(--hud-surface-soft)] hover:text-[var(--hud-text)]'
      }`}
    >
      {label}
    </Link>
  );
}

export default function MarketingShell({
  children,
  dataTestId,
}: {
  children: ReactNode;
  dataTestId?: string;
}) {
  const location = useLocation();
  const supportEmail = import.meta.env.VITE_SUPPORT_EMAIL?.trim();
  const primaryAction =
    location.pathname === '/welcome'
      ? { to: '/signup', label: 'Create account' }
      : { to: '/welcome', label: 'See product' };

  return (
    <div
      data-testid={dataTestId}
      className="relative min-h-[100dvh] overflow-x-hidden bg-[var(--board-bg)] text-[var(--board-text)]"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -left-28 top-[-120px] size-[420px] rounded-full bg-white/6 blur-[80px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-28 right-[-120px] size-[500px] rounded-full bg-white/5 blur-[100px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(255,255,255,0.08),transparent_36%),radial-gradient(circle_at_82%_80%,rgba(255,255,255,0.06),transparent_44%)]"
      />
      <div className="pointer-events-none absolute bottom-[-0.12em] left-1/2 z-0 -translate-x-1/2 select-none whitespace-nowrap text-[clamp(160px,20vw,320px)] font-extrabold leading-none tracking-[-0.06em] text-white/[0.024]">
        Tareva
      </div>

      <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-[1440px] flex-col px-5 pb-8 pt-5 md:px-8 md:pb-10">
        <header className="flex items-center justify-between gap-4">
          <Link
            to="/welcome"
            className="rounded-full px-3 py-1.5 text-[11.5px] font-semibold uppercase tracking-[0.16em] text-[var(--hud-muted)] transition hover:bg-[var(--hud-surface-soft)] hover:text-[var(--hud-text)]"
          >
            Tareva
          </Link>

          <nav className="hidden items-center gap-1 rounded-full border border-[color:var(--hud-border)] bg-[color:color-mix(in_srgb,var(--hud-surface)_88%,transparent)] p-1 md:flex">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                label={item.label}
                active={location.pathname === item.to}
              />
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Button
              asChild
              type="button"
              variant="ghost"
              className="h-9 rounded-full border border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-4 text-[12px] font-semibold text-[var(--hud-text)] hover:bg-[var(--hud-surface-soft)]"
            >
              <Link to="/login">Sign in</Link>
            </Button>
            <Button
              asChild
              type="button"
              className="h-9 rounded-full border border-[color:var(--hud-border)] bg-[var(--hud-accent-bg)] px-4 text-[12px] font-semibold text-[var(--hud-accent-text)] hover:brightness-110"
            >
              <Link to={primaryAction.to}>
                {primaryAction.label}
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="mt-10 border-t border-[color:var(--hud-border)] pt-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[var(--hud-muted)]">
                Execution-first planning
              </p>
              <p className="mt-1 text-sm text-[var(--hud-muted)]">
                Capture work, place it on a real day, and run it with live execution states.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-[12px] text-[var(--hud-muted)]">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="transition hover:text-[var(--hud-text)]"
                >
                  {item.label}
                </Link>
              ))}
              {supportEmail ? (
                <a
                  href={`mailto:${supportEmail}`}
                  className="transition hover:text-[var(--hud-text)]"
                >
                  {supportEmail}
                </a>
              ) : (
                <span>Support email available at launch</span>
              )}
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
