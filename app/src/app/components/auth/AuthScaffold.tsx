import type { ReactNode } from 'react';
import { Link } from 'react-router';

interface AuthScaffoldProps {
  eyebrow?: string;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}

export default function AuthScaffold({
  eyebrow = 'Taskable',
  title,
  description,
  children,
  footer,
}: AuthScaffoldProps) {
  return (
    <div className="flex min-h-[100dvh] bg-[var(--board-bg)] text-[var(--board-text)]">
      <div className="mx-auto flex w-full max-w-[1320px] flex-1 flex-col gap-8 px-4 py-6 md:flex-row md:items-center md:px-8 md:py-10">
        <section className="ui-hud-shell w-full max-w-[460px] rounded-[28px] p-6 md:p-8">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--hud-muted)]">
              {eyebrow}
            </p>
            <h1 className="text-3xl font-semibold tracking-[-0.02em]">{title}</h1>
            <p className="text-sm text-[color:var(--hud-muted)]">{description}</p>
          </div>
          <div className="mt-6 space-y-4">{children}</div>
          {footer ? (
            <div className="mt-6 text-sm text-[color:var(--hud-muted)]">{footer}</div>
          ) : null}
        </section>

        <section className="relative flex flex-1 flex-col justify-end rounded-[28px] border border-[color:var(--hud-border)] bg-[var(--hud-surface)] p-6 md:min-h-[560px] md:p-10">
          <div className="max-w-[540px]">
            <p className="text-sm font-medium text-[color:var(--hud-muted)]">
              Plan your day with clear priorities. Use local mode for private planning or cloud mode
              for team sync.
            </p>
            <p className="mt-5 text-5xl font-semibold leading-[0.95] tracking-[-0.03em] md:text-8xl">
              Welcome to Taskable
            </p>
          </div>
          <Link
            to="/welcome"
            className="absolute right-5 top-5 rounded-xl border border-[color:var(--hud-border)] bg-[var(--hud-surface-strong)] px-3 py-2 text-xs font-semibold text-[color:var(--hud-text)] hover:brightness-105"
          >
            Welcome
          </Link>
        </section>
      </div>
    </div>
  );
}
