import { useEffect } from 'react';
import { ArrowRight, CirclePlay, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import MarketingShell from './MarketingShell';
import { Button } from './ui/button';
import { recordProductEvent } from '../services/productAnalytics';

const DEMO_CHAPTERS = [
  {
    time: '0:00-0:20',
    title: 'Capture incoming work',
    description:
      'Start in Inbox or import from Outlook so the day begins with real inputs, not a blank plan.',
  },
  {
    time: '0:20-0:50',
    title: 'Place work on a real timeline',
    description:
      'Drag work into the planner, spot overload early, and reschedule directly when priorities shift.',
  },
  {
    time: '0:50-1:20',
    title: 'Run the day in execution mode',
    description:
      'Start, pause, extend, and complete tasks while keeping drift visible instead of hidden.',
  },
  {
    time: '1:20-1:30',
    title: 'Close with the team view',
    description:
      'Show how collaboration, sync, and presence turn a personal planner into a team coordination layer.',
  },
] as const;

export default function DemoView() {
  const hostedDemoUrl = import.meta.env.VITE_DEMO_VIDEO_URL?.trim();

  useEffect(() => {
    recordProductEvent({
      eventType: 'demo_viewed',
      metadata: { path: '/demo', hostedDemoConfigured: Boolean(hostedDemoUrl) },
    });
  }, [hostedDemoUrl]);

  return (
    <MarketingShell dataTestId="demo-page">
      <section className="mx-auto mt-12 flex w-full max-w-[1180px] flex-col gap-10 lg:mt-16 lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,460px)]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--hud-muted)]">
            Product Tour
          </p>
          <h1 className="mt-3 max-w-[780px] text-[clamp(42px,6vw,72px)] font-bold leading-[0.94] tracking-[-0.05em]">
            See how Tareva turns a messy day into a workable plan.
          </h1>
          <p className="mt-4 max-w-[640px] text-[16px] leading-relaxed text-[var(--hud-muted)]">
            This tour shows the core workflow quickly: capture work, place it on a real timeline,
            and adjust as the day changes.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              asChild
              type="button"
              className="h-11 rounded-full border border-[color:var(--hud-border)] bg-[var(--hud-accent-bg)] px-5 text-[13px] font-semibold text-[var(--hud-accent-text)] hover:brightness-110"
            >
              <Link to="/welcome">
                See the landing page
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            {hostedDemoUrl ? (
              <Button
                asChild
                type="button"
                variant="ghost"
                className="h-11 rounded-full border border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-5 text-[13px] font-semibold text-[var(--hud-text)] hover:bg-[var(--hud-surface-soft)]"
              >
                <a href={hostedDemoUrl} target="_blank" rel="noreferrer">
                  Watch hosted demo
                  <CirclePlay className="size-4" />
                </a>
              </Button>
            ) : (
              <div className="inline-flex min-h-11 items-center rounded-full border border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-5 text-[13px] text-[var(--hud-muted)]">
                Hosted video will appear here when the walkthrough is published.
              </div>
            )}
          </div>

          <div className="mt-8 grid gap-3 md:grid-cols-2">
            {DEMO_CHAPTERS.map((chapter) => (
              <article
                key={chapter.time}
                className="rounded-[22px] border border-[color:var(--hud-border)] bg-[color:color-mix(in_srgb,var(--hud-surface)_86%,transparent)] p-5"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--hud-muted)]">
                  {chapter.time}
                </p>
                <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-[var(--hud-text)]">
                  {chapter.title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-[var(--hud-muted)]">
                  {chapter.description}
                </p>
              </article>
            ))}
          </div>
        </div>

        <aside className="rounded-[28px] border border-[color:var(--hud-border)] bg-[color:color-mix(in_srgb,var(--hud-surface-strong)_88%,transparent)] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
          <div className="inline-flex rounded-full border border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--hud-muted)]">
            Recording order
          </div>
          <div className="mt-4 space-y-4">
            <div className="rounded-[20px] border border-[color:var(--hud-border)] bg-[var(--hud-surface)] p-4">
              <p className="text-sm font-semibold text-[var(--hud-text)]">1. Open on the landing page</p>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--hud-muted)]">
                Open with the problem: work keeps changing, and the day rarely stays neat.
              </p>
            </div>
            <div className="rounded-[20px] border border-[color:var(--hud-border)] bg-[var(--hud-surface)] p-4">
              <p className="text-sm font-semibold text-[var(--hud-text)]">2. Enter planner with sample data</p>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--hud-muted)]">
                Show one overloaded day, one reschedule, and one task moving into running state.
              </p>
            </div>
            <div className="rounded-[20px] border border-[color:var(--hud-border)] bg-[var(--hud-surface)] p-4">
              <p className="text-sm font-semibold text-[var(--hud-text)]">3. End on trust and support</p>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--hud-muted)]">
                Close with privacy, support, and the choice between local use and cloud sync.
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-[22px] border border-[color:var(--hud-border)] bg-[color:color-mix(in_srgb,var(--hud-accent-soft)_24%,transparent)] p-4">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--hud-text)]">
              <Sparkles className="size-4" />
              Demo goal
            </div>
            <p className="mt-2 text-sm leading-relaxed text-[var(--hud-muted)]">
              By the end, the viewer should understand what Tareva is, who it is for, and why it is
              different from a basic scheduler or task list.
            </p>
          </div>
        </aside>
      </section>
    </MarketingShell>
  );
}
