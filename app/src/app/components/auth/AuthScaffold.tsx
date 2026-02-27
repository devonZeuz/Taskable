import type { ReactNode } from 'react';

interface AuthScaffoldProps {
  eyebrow?: string;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
  heroLead?: string;
  heroTitle?: string;
  heroSubtitle?: string;
}

export default function AuthScaffold({
  eyebrow = 'Tareva',
  title,
  description,
  children,
  footer,
  heroLead = 'Welcome to',
  heroTitle = 'Tareva',
  heroSubtitle = 'Plan your day with clear priorities. Use local mode for private planning or cloud mode for team sync.',
}: AuthScaffoldProps) {
  return (
    <div className="relative flex min-h-[100dvh] overflow-hidden bg-[var(--board-bg)] text-[var(--board-text)]">
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
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_12%,rgba(255,255,255,0.08),transparent_42%),radial-gradient(circle_at_82%_80%,rgba(255,255,255,0.06),transparent_44%)]"
      />

      <div className="relative mx-auto flex w-full max-w-[1440px] flex-1 flex-col px-4 py-6 md:px-8 md:py-10 lg:px-12">
        <section className="grid flex-1 items-center gap-10 lg:grid-cols-[minmax(360px,480px)_1fr]">
          <div className="relative z-20">
            <div className="ui-hud-shell w-full ui-v1-radius-xl p-6 md:p-8">
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--hud-muted)]">
                  {eyebrow}
                </p>
                <h1 className="text-3xl font-semibold tracking-[-0.025em]">{title}</h1>
                <p className="text-sm leading-relaxed text-[color:var(--hud-muted)]">
                  {description}
                </p>
              </div>
              <div className="mt-6 space-y-4">{children}</div>
              {footer ? (
                <div className="mt-6 text-sm leading-relaxed text-[color:var(--hud-muted)]">
                  {footer}
                </div>
              ) : null}
            </div>
          </div>

          <div className="relative flex min-h-[300px] items-end justify-end pb-2 lg:min-h-[620px]">
            <div className="max-w-[760px] text-left lg:text-right">
              <p className="text-xl font-semibold tracking-[-0.02em] text-[color:var(--hud-muted)] md:text-3xl">
                {heroLead}
              </p>
              <p className="mt-1 text-[58px] font-semibold leading-[0.84] tracking-[-0.05em] md:text-[108px] xl:text-[132px]">
                {heroTitle}
              </p>
              <p className="mt-4 max-w-[560px] text-sm font-medium text-[color:var(--hud-muted)] lg:ml-auto lg:text-base">
                {heroSubtitle}
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
