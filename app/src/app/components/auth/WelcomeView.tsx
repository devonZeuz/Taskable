import { useEffect, useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useOnboarding } from '../../context/OnboardingContext';
import {
  readLocalWorkdaySetupCompleted,
  writeLocalWorkdaySetupPending,
} from '../../services/authStorage';
import { recordProductEvent } from '../../services/productAnalytics';
import { Button } from '../ui/button';

const PREVIEW_HOURS = [
  '08:00',
  '09:00',
  '10:00',
  '11:00',
  '12:00',
  '13:00',
  '14:00',
  '15:00',
] as const;

const PREVIEW_DAY_COLUMN_WIDTH_PX = 168;
const PREVIEW_ROW_HEIGHT_PX = 136;
const PREVIEW_CARD_HEIGHT_PX = 112;
const PREVIEW_CARD_TOP_BASE_PX = 8;
const PREVIEW_STAGGER_OFFSET_PX = 14;

type PreviewCard = {
  id: string;
  title: string;
  time: string;
  rowIndex: number;
  startHour: number;
  left: string;
  width: string;
  tone: 'running' | 'upcoming' | 'done' | 'idle';
  checklist?: string[];
};

const PREVIEW_CARDS: PreviewCard[] = [
  {
    id: 'morning-routine',
    title: 'Morning Routine',
    time: '08:00-09:00',
    rowIndex: 0,
    startHour: 8,
    left: '1.2%',
    width: '11.4%',
    tone: 'done',
  },
  {
    id: 'email-catch-up',
    title: 'Email Catch-up',
    time: '08:00-09:00',
    rowIndex: 1,
    startHour: 8,
    left: '1.2%',
    width: '11.4%',
    tone: 'upcoming',
  },
  {
    id: 'personal-errands',
    title: 'Personal Errands',
    time: '08:00-09:00',
    rowIndex: 2,
    startHour: 8,
    left: '1.2%',
    width: '11.4%',
    tone: 'done',
  },
  {
    id: 'weekly-priorities',
    title: 'Weekly Priorities',
    time: '09:00-11:00',
    rowIndex: 0,
    startHour: 9,
    left: '13.9%',
    width: '23.6%',
    tone: 'running',
    checklist: ['Inbox cleanup', 'Plan top 3 tasks', 'Share update'],
  },
  {
    id: 'workout-break',
    title: 'Workout Break',
    time: '11:00-12:00',
    rowIndex: 0,
    startHour: 11,
    left: '38.3%',
    width: '11.7%',
    tone: 'upcoming',
  },
  {
    id: 'team-planning-session',
    title: 'Team Planning Session',
    time: '09:00-11:30',
    rowIndex: 1,
    startHour: 9,
    left: '13.9%',
    width: '31.7%',
    tone: 'idle',
  },
];

const VALUE_PILLARS = [
  {
    title: 'Capture first',
    description:
      'Drop work into Inbox before you decide exactly when it belongs.',
  },
  {
    title: 'Plan against reality',
    description:
      'See capacity, place tasks on a timeline, and build a day that can actually hold.',
  },
  {
    title: 'Execute visibly',
    description:
      'Start, pause, extend, and complete work so the plan stays aligned with reality.',
  },
] as const;

const TRUST_LINKS = [
  {
    to: '/demo',
    title: 'See how it works',
    description: 'Watch the workflow in under two minutes.',
    testId: 'welcome-demo-link',
  },
  {
    to: '/security',
    title: 'Privacy and security',
    description: 'Understand local mode, cloud sync, and how your data is handled.',
    testId: 'welcome-security-link',
  },
  {
    to: '/support',
    title: 'Get help',
    description: 'Contact support or report an issue.',
    testId: 'welcome-support-link',
  },
] as const;

type CardTone = {
  background: string;
  border: string;
  text: string;
  mutedText: string;
  chipBackground: string;
  chipText: string;
  accent: string;
};

function getPreviewCardTop(card: PreviewCard): number {
  const hourBandIndex = Math.max(0, Math.floor(card.startHour - 8));
  const staggerOffset = hourBandIndex % 2 === 1 ? PREVIEW_STAGGER_OFFSET_PX : 0;
  return card.rowIndex * PREVIEW_ROW_HEIGHT_PX + PREVIEW_CARD_TOP_BASE_PX + staggerOffset;
}

function getPreviewCardTone(tone: PreviewCard['tone']): CardTone {
  if (tone === 'running') {
    return {
      background: 'color-mix(in srgb, var(--hud-surface-strong) 78%, rgba(255,255,255,0.12))',
      border: 'color-mix(in srgb, var(--hud-outline) 86%, var(--hud-border))',
      text: 'var(--hud-text)',
      mutedText: 'var(--hud-muted)',
      chipBackground: 'color-mix(in srgb, var(--hud-surface-soft) 92%, transparent)',
      chipText: 'var(--hud-text)',
      accent: 'var(--hud-accent-bg)',
    };
  }

  if (tone === 'done') {
    return {
      background: 'color-mix(in srgb, var(--hud-surface-soft) 72%, transparent)',
      border: 'color-mix(in srgb, var(--hud-border) 84%, transparent)',
      text: 'color-mix(in srgb, var(--hud-text) 82%, transparent)',
      mutedText: 'color-mix(in srgb, var(--hud-muted) 86%, transparent)',
      chipBackground: 'color-mix(in srgb, var(--hud-surface-soft) 78%, transparent)',
      chipText: 'color-mix(in srgb, var(--hud-muted) 88%, transparent)',
      accent: 'color-mix(in srgb, var(--hud-muted) 75%, transparent)',
    };
  }

  if (tone === 'idle') {
    return {
      background: 'color-mix(in srgb, var(--hud-surface) 76%, transparent)',
      border: 'color-mix(in srgb, var(--hud-border) 92%, transparent)',
      text: 'var(--hud-text)',
      mutedText: 'var(--hud-muted)',
      chipBackground: 'color-mix(in srgb, var(--hud-surface-soft) 92%, transparent)',
      chipText: 'var(--hud-text)',
      accent: 'var(--hud-accent-soft)',
    };
  }

  return {
    background: 'color-mix(in srgb, var(--board-surface) 84%, transparent)',
    border: 'color-mix(in srgb, var(--hud-border) 92%, transparent)',
    text: 'var(--hud-text)',
    mutedText: 'var(--hud-muted)',
    chipBackground: 'color-mix(in srgb, var(--hud-surface-soft) 90%, transparent)',
    chipText: 'var(--hud-text)',
    accent: 'color-mix(in srgb, var(--hud-accent-bg) 72%, transparent)',
  };
}

function PreviewTaskCard({ card }: { card: PreviewCard }) {
  const tone = getPreviewCardTone(card.tone);
  return (
    <div
      className="absolute overflow-hidden rounded-[12px] border p-3"
      style={{
        left: card.left,
        top: `${getPreviewCardTop(card)}px`,
        width: card.width,
        height: `${PREVIEW_CARD_HEIGHT_PX}px`,
        backgroundColor: tone.background,
        borderColor: tone.border,
        color: tone.text,
      }}
    >
      <span
        className="pointer-events-none absolute inset-y-[6px] left-[6px] w-[4px] rounded-full"
        style={{ backgroundColor: tone.accent }}
      />
      <div className="pr-2">
        <div className="max-h-[42px] overflow-hidden break-words pr-1 text-[16px] font-semibold leading-[1.12] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
          {card.title}
        </div>
        {card.checklist ? (
          <div className="mt-2 max-h-[38px] space-y-1 overflow-hidden text-[12px] font-semibold leading-tight">
            {card.checklist.map((item, index) => (
              <div key={item} className={index === 0 ? 'line-through opacity-70' : ''}>
                - {item}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2">
        <div
          className="min-w-0 truncate text-[11px] font-semibold"
          style={{ color: tone.mutedText }}
        >
          {card.time}
        </div>
        <div
          className="shrink-0 rounded-[9px] px-3 py-1 text-[12px] font-semibold"
          style={{
            backgroundColor: tone.chipBackground,
            color: tone.chipText,
          }}
        >
          Start
        </div>
      </div>
    </div>
  );
}

export default function WelcomeView() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setMode, isCloudAuthenticated } = useOnboarding();

  const returnTo = useMemo(() => {
    const state = location.state as { from?: string } | null;
    return state?.from && state.from.startsWith('/') ? state.from : '/planner';
  }, [location.state]);

  const topbarDate = useMemo(
    () =>
      new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }).format(new Date()),
    []
  );

  useEffect(() => {
    recordProductEvent({
      eventType: 'landing_viewed',
      metadata: { path: '/welcome' },
    });
  }, []);

  const continueLocally = () => {
    recordProductEvent({
      eventType: 'landing_continue_local_clicked',
      mode: 'local',
      metadata: { from: '/welcome' },
    });
    if (!readLocalWorkdaySetupCompleted()) {
      writeLocalWorkdaySetupPending(true);
    }
    setMode('local');
    navigate(returnTo, { replace: true });
  };

  const openLogin = () => {
    recordProductEvent({
      eventType: 'landing_sign_in_clicked',
      mode: 'cloud',
      metadata: { from: '/welcome' },
    });
    setMode('cloud');
    navigate('/login', { state: { from: returnTo } });
  };

  const openSignup = () => {
    recordProductEvent({
      eventType: 'landing_sign_up_clicked',
      mode: 'cloud',
      metadata: { from: '/welcome' },
    });
    setMode('cloud');
    navigate('/signup', { state: { from: returnTo } });
  };

  return (
    <div
      data-testid="welcome-screen"
      className="relative flex min-h-[100dvh] flex-col overflow-x-hidden bg-[var(--board-bg)] text-[var(--board-text)]"
    >
      <style>{`
        @keyframes welcome-execute-sheen {
          0% { background-position: 200% 50%; }
          100% { background-position: -40% 50%; }
        }
      `}</style>
      <div className="pointer-events-none fixed bottom-[-0.12em] left-1/2 z-0 -translate-x-1/2 select-none whitespace-nowrap text-[clamp(180px,22vw,340px)] font-extrabold leading-none tracking-[-0.06em] text-white/[0.028]">
        Tareva
      </div>
      <div
        aria-hidden
        className="pointer-events-none fixed left-1/2 top-[30%] z-0 h-[500px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background:
            'radial-gradient(ellipse, color-mix(in srgb, var(--hud-accent-bg) 12%, transparent) 0%, transparent 65%)',
        }}
      />

      <header className="relative z-10 flex items-center justify-between gap-4 px-6 py-[22px] md:px-9">
        <span className="rounded-full px-3 py-1.5 text-[11.5px] font-semibold uppercase tracking-[0.16em] text-[var(--hud-muted)]">
          Tareva
        </span>
        <nav className="hidden items-center gap-1 rounded-full border border-[color:var(--hud-border)] bg-[color:color-mix(in_srgb,var(--hud-surface)_88%,transparent)] p-1 md:flex">
          <Link
            to="/demo"
            className="rounded-full px-3 py-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--hud-muted)] transition hover:bg-[var(--hud-surface-soft)] hover:text-[var(--hud-text)]"
          >
            Demo
          </Link>
          <Link
            to="/security"
            className="rounded-full px-3 py-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--hud-muted)] transition hover:bg-[var(--hud-surface-soft)] hover:text-[var(--hud-text)]"
          >
            Security
          </Link>
          <Link
            to="/support"
            className="rounded-full px-3 py-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--hud-muted)] transition hover:bg-[var(--hud-surface-soft)] hover:text-[var(--hud-text)]"
          >
            Support
          </Link>
        </nav>
        <span className="hidden text-xs text-[var(--hud-muted)] md:block">{topbarDate}</span>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-[1440px] flex-1 flex-col items-center gap-8 px-6 pb-10 pt-4">
        <section className="max-w-[860px] text-center">
          <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--hud-muted)]">
            Timeline-based planner
          </p>
          <h1 className="mt-4 text-center text-[clamp(48px,6.2vw,82px)] font-bold leading-[0.94] tracking-[-0.05em]">
            Turn incoming work
            <br />
            into a{' '}
            <span
              className="bg-[linear-gradient(110deg,var(--hud-accent-soft)_20%,white_46%,var(--hud-accent-soft)_72%)] bg-[length:220%_100%] bg-clip-text text-transparent [animation:welcome-execute-sheen_4.6s_ease-in-out_infinite]"
              style={{ WebkitBackgroundClip: 'text' }}
            >
              realistic day plan.
            </span>
          </h1>

          <p className="mx-auto mt-4 max-w-[620px] text-center text-[16px] leading-relaxed text-[var(--hud-muted)]">
            Tareva helps you capture tasks, place them on a real timeline, and manage them as the
            day changes. It is built for people whose work does not stay neat for long.
          </p>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--hud-muted)]">
            <span className="rounded-full border border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-3 py-1">
              Try on this device
            </span>
            <span className="rounded-full border border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-3 py-1">
              Cloud sync optional
            </span>
            <span className="rounded-full border border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-3 py-1">
              Built for changing days
            </span>
          </div>
        </section>

        <div className="relative flex flex-wrap items-start justify-center gap-3">
          <button
            type="button"
            data-testid="welcome-continue-local"
            onClick={continueLocally}
            className="h-[52px] whitespace-nowrap rounded-[16px] border border-[color:var(--hud-border)] bg-[var(--hud-accent-bg)] px-6 text-[14px] font-bold text-[var(--hud-accent-text)] shadow-[0_8px_22px_rgba(0,0,0,0.22)] transition duration-200 hover:border-[color:var(--hud-accent-soft)] hover:brightness-110 hover:shadow-[0_12px_26px_color-mix(in_srgb,var(--hud-accent-bg)_35%,transparent)]"
          >
            Start locally
          </button>
          <button
            type="button"
            data-testid="welcome-sign-in"
            onClick={openLogin}
            className="h-[52px] whitespace-nowrap rounded-[16px] border border-white/15 bg-white/10 px-6 text-[14px] font-semibold text-[var(--hud-text)] transition duration-200 hover:border-[color:var(--hud-accent-soft)] hover:bg-[color:color-mix(in_srgb,var(--hud-accent-bg)_20%,transparent)] hover:text-[var(--hud-accent-text)]"
          >
            Sign in
          </button>
          <button
            type="button"
            data-testid="welcome-sign-up"
            onClick={openSignup}
            className="h-[52px] whitespace-nowrap rounded-[16px] border border-white/10 bg-white/5 px-6 text-[14px] font-medium text-[var(--hud-muted)] transition duration-200 hover:border-[color:var(--hud-accent-soft)] hover:bg-[color:color-mix(in_srgb,var(--hud-accent-soft)_18%,transparent)] hover:text-[var(--hud-text)]"
          >
            Create account
          </button>
          <Button
            asChild
            type="button"
            variant="ghost"
            className="h-[52px] rounded-[16px] border border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-6 text-[14px] font-semibold text-[var(--hud-text)] hover:bg-[var(--hud-surface-soft)]"
          >
            <Link to="/demo" data-testid="welcome-tour-link">
              Watch demo
            </Link>
          </Button>
        </div>

        <p className="text-center text-[14px] text-[var(--hud-muted)]">
          Try Tareva on this device first. Add cloud sync later if you need shared access.
        </p>

        <section
          data-testid="welcome-planner-preview"
          className="w-full max-w-[1280px] overflow-hidden rounded-[18px] border border-[color:var(--board-line)] bg-[var(--board-surface)] shadow-[0_-1px_0_rgba(255,255,255,0.06),0_24px_60px_rgba(0,0,0,0.5)]"
        >
          <div
            className="grid border-b border-[color:var(--board-line)] bg-[color:color-mix(in_srgb,var(--board-surface)_78%,transparent)]"
            style={{ gridTemplateColumns: `${PREVIEW_DAY_COLUMN_WIDTH_PX}px 1fr` }}
          >
            <div className="border-r border-[color:var(--board-line)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--hud-muted)]" />
            <div className="grid grid-cols-8">
              {PREVIEW_HOURS.map((hour) => (
                <div
                  key={hour}
                  className="border-r border-[color:var(--board-line)] px-2 py-1.5 text-[10px] font-semibold text-[var(--hud-muted)] last:border-r-0"
                >
                  {hour}
                </div>
              ))}
            </div>
          </div>

          <div
            className="grid"
            style={{ gridTemplateColumns: `${PREVIEW_DAY_COLUMN_WIDTH_PX}px 1fr` }}
          >
            <div className="border-r border-[color:var(--board-line)] bg-[color:color-mix(in_srgb,var(--board-surface)_54%,transparent)]">
              <div
                className="border-b border-[color:var(--board-line)] px-3 py-4"
                style={{ height: `${PREVIEW_ROW_HEIGHT_PX}px` }}
              >
                <div className="text-[38px] font-bold leading-none tracking-[-0.04em] text-[var(--board-text)]">
                  Today
                </div>
                <div className="mt-1 text-[12px] font-semibold uppercase tracking-[0.05em] text-[var(--hud-muted)]">
                  FEB 25
                </div>
              </div>
              <div
                className="border-b border-[color:var(--board-line)] px-3 py-4"
                style={{ height: `${PREVIEW_ROW_HEIGHT_PX}px` }}
              >
                <div className="text-[38px] font-bold leading-none tracking-[-0.04em] text-[var(--board-text)]">
                  Tomorrow
                </div>
                <div className="mt-1 text-[12px] font-semibold uppercase tracking-[0.05em] text-[var(--hud-muted)]">
                  FEB 26
                </div>
              </div>
              <div className="px-3 py-4" style={{ height: `${PREVIEW_ROW_HEIGHT_PX}px` }}>
                <div className="text-[38px] font-bold leading-none tracking-[-0.04em] text-[var(--board-text)]">
                  Friday
                </div>
                <div className="mt-1 text-[12px] font-semibold uppercase tracking-[0.05em] text-[var(--hud-muted)]">
                  FEB 27
                </div>
              </div>
            </div>

            <div
              className="relative"
              style={{
                height: `${PREVIEW_ROW_HEIGHT_PX * 3}px`,
                backgroundImage:
                  'repeating-linear-gradient(90deg,transparent 0,transparent calc(12.5% - 1px),rgba(255,255,255,0.12) calc(12.5% - 1px),rgba(255,255,255,0.12) 12.5%),linear-gradient(to bottom,transparent 0,transparent calc(33.33% - 1px),rgba(255,255,255,0.14) calc(33.33% - 1px),rgba(255,255,255,0.14) calc(33.33%),transparent calc(33.33%),transparent calc(66.66% - 1px),rgba(255,255,255,0.14) calc(66.66% - 1px),rgba(255,255,255,0.14) calc(66.66%),transparent calc(66.66%))',
              }}
            >
              <div className="absolute right-4 top-2 flex items-center gap-3">
                <span className="rounded-full border border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-2 py-0.5 text-[10px] font-semibold text-[var(--hud-text)]">
                  Now
                </span>
                <span className="text-[11px] font-semibold text-[var(--hud-muted)]">16:00</span>
              </div>

              <div className="absolute right-[2px] top-[80px] h-[125px] w-[4px] rounded-full bg-white/24" />
              <div className="absolute right-[2px] top-[208px] h-[120px] w-[4px] rounded-full bg-white/12" />

              {PREVIEW_CARDS.map((card) => (
                <PreviewTaskCard key={card.id} card={card} />
              ))}
            </div>
          </div>
        </section>

        <section className="grid w-full max-w-[1280px] gap-4 lg:grid-cols-3">
          {VALUE_PILLARS.map((pillar) => (
            <article
              key={pillar.title}
              className="rounded-[22px] border border-[color:var(--hud-border)] bg-[color:color-mix(in_srgb,var(--hud-surface)_86%,transparent)] p-5"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--hud-muted)]">
                Core workflow
              </p>
              <h2 className="mt-2 text-[24px] font-semibold tracking-[-0.03em] text-[var(--hud-text)]">
                {pillar.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--hud-muted)]">
                {pillar.description}
              </p>
            </article>
          ))}
        </section>

        <section className="grid w-full max-w-[1280px] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
          <article className="rounded-[24px] border border-[color:var(--hud-border)] bg-[color:color-mix(in_srgb,var(--hud-surface-strong)_86%,transparent)] p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--hud-muted)]">
              More than a scheduling app
            </p>
            <h2 className="mt-2 text-[28px] font-semibold tracking-[-0.03em] text-[var(--hud-text)]">
              Most scheduling tools help you place work on a calendar.
            </h2>
            <p className="mt-3 max-w-[720px] text-sm leading-relaxed text-[var(--hud-muted)]">
              Tareva helps you capture work, schedule it realistically, and adjust it while the day
              is actually happening. It is designed to help you run the day, not just place items on
              a timeline.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <div className="rounded-[18px] border border-[color:var(--hud-border)] bg-[var(--hud-surface)] p-4">
                <p className="text-sm font-semibold text-[var(--hud-text)]">
                  Scheduling apps focus on where work should go.
                </p>
              </div>
              <div className="rounded-[18px] border border-[color:var(--hud-border)] bg-[var(--hud-surface)] p-4">
                <p className="text-sm font-semibold text-[var(--hud-text)]">
                  Tareva also shows what is running now, what slipped, and what needs to move next.
                </p>
              </div>
              <div className="rounded-[18px] border border-[color:var(--hud-border)] bg-[var(--hud-surface)] p-4">
                <p className="text-sm font-semibold text-[var(--hud-text)]">
                  It is built for execution, not just calendar placement.
                </p>
              </div>
            </div>
          </article>

          <div className="space-y-4">
            {TRUST_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                data-testid={link.testId}
                className="block rounded-[22px] border border-[color:var(--hud-border)] bg-[var(--hud-surface)] p-5 transition hover:border-[color:var(--hud-accent-soft)] hover:bg-[var(--hud-surface-soft)]"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--hud-muted)]">
                  Product surface
                </p>
                <p className="mt-2 text-[19px] font-semibold tracking-[-0.02em] text-[var(--hud-text)]">
                  {link.title}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-[var(--hud-muted)]">
                  {link.description}
                </p>
              </Link>
            ))}
          </div>
        </section>

        {isCloudAuthenticated ? (
          <Button
            type="button"
            onClick={() => navigate('/planner', { replace: true })}
            className="mt-5 h-10 rounded-xl border border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-4 text-[var(--hud-text)] hover:bg-[var(--hud-surface-soft)]"
          >
            Continue to planner
            <ArrowRight className="size-4" />
          </Button>
        ) : null}
      </main>

      <footer className="relative z-10 border-t border-[color:var(--hud-border)] px-6 py-4 md:px-9">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-2 text-[12px] text-[var(--hud-muted)] md:flex-row md:items-center md:justify-between">
          <p>Schedule work, run the day, and adjust when reality changes.</p>
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/demo" className="transition hover:text-[var(--hud-text)]">
              Demo
            </Link>
            <Link to="/security" className="transition hover:text-[var(--hud-text)]">
              Security
            </Link>
            <Link to="/support" className="transition hover:text-[var(--hud-text)]">
              Support
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
