import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { useOnboarding } from '../../context/OnboardingContext';
import { writeLocalTutorialCompleted } from '../../services/authStorage';
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

type CardTone = {
  background: string;
  border: string;
  text: string;
  mutedText: string;
  chipBackground: string;
  chipText: string;
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
    };
  }

  return {
    background: 'color-mix(in srgb, var(--board-surface) 84%, transparent)',
    border: 'color-mix(in srgb, var(--hud-border) 92%, transparent)',
    text: 'var(--hud-text)',
    mutedText: 'var(--hud-muted)',
    chipBackground: 'color-mix(in srgb, var(--hud-surface-soft) 90%, transparent)',
    chipText: 'var(--hud-text)',
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
      <div className="pr-2">
        <div className="max-h-[42px] overflow-hidden break-words text-[17px] font-semibold leading-[1.12]">
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
          className="min-w-0 truncate text-[12px] font-semibold"
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

  const continueLocally = () => {
    writeLocalTutorialCompleted(false);
    setMode('local');
    navigate(returnTo, { replace: true });
  };

  const openLogin = () => {
    setMode('cloud');
    navigate('/login', { state: { from: returnTo } });
  };

  const openSignup = () => {
    setMode('cloud');
    navigate('/signup', { state: { from: returnTo } });
  };

  return (
    <div
      data-testid="welcome-screen"
      className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-[var(--board-bg)] text-[var(--board-text)]"
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

      <header className="relative z-10 flex items-center justify-between px-6 py-[22px] md:px-9">
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.16em] text-[var(--hud-muted)]">
          Tareva
        </span>
        <span className="text-xs text-[var(--hud-muted)]">{topbarDate}</span>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-[1440px] flex-1 flex-col items-center justify-center px-6 pb-10">
        <h1 className="text-center text-[clamp(48px,6.2vw,80px)] font-bold leading-[0.96] tracking-[-0.045em]">
          Plan less.
          <br />
          <span
            className="bg-[linear-gradient(110deg,var(--hud-accent-soft)_20%,white_46%,var(--hud-accent-soft)_72%)] bg-[length:220%_100%] bg-clip-text text-transparent [animation:welcome-execute-sheen_4.6s_ease-in-out_infinite]"
            style={{ WebkitBackgroundClip: 'text' }}
          >
            Execute
          </span>{' '}
          better.
        </h1>

        <p className="mt-3 max-w-[460px] text-center text-[15px] leading-relaxed text-[var(--hud-muted)]">
          A calm daily planner with live execution tracking, smart scheduling, and drift-aware
          feedback.
        </p>

        <div className="mb-10 mt-8 flex flex-wrap items-center justify-center gap-2.5 md:flex-nowrap">
          <button
            type="button"
            data-testid="welcome-continue-local"
            onClick={continueLocally}
            className="h-12 whitespace-nowrap rounded-[16px] border border-[color:var(--hud-border)] bg-[var(--hud-accent-bg)] px-5 text-[13.5px] font-semibold text-[var(--hud-accent-text)] shadow-[0_8px_22px_rgba(0,0,0,0.22)] transition duration-200 hover:border-[color:var(--hud-accent-soft)] hover:brightness-110 hover:shadow-[0_12px_26px_color-mix(in_srgb,var(--hud-accent-bg)_35%,transparent)]"
          >
            Start locally
          </button>
          <button
            type="button"
            data-testid="welcome-sign-in"
            onClick={openLogin}
            className="h-12 whitespace-nowrap rounded-[16px] border border-white/15 bg-white/10 px-5 text-[13.5px] font-semibold text-[var(--hud-text)] transition duration-200 hover:border-[color:var(--hud-accent-soft)] hover:bg-[color:color-mix(in_srgb,var(--hud-accent-bg)_20%,transparent)] hover:text-[var(--hud-accent-text)]"
          >
            Sign in
          </button>
          <button
            type="button"
            data-testid="welcome-sign-up"
            onClick={openSignup}
            className="h-12 whitespace-nowrap rounded-[16px] border border-white/10 bg-white/5 px-5 text-[13.5px] font-medium text-[var(--hud-muted)] transition duration-200 hover:border-[color:var(--hud-accent-soft)] hover:bg-[color:color-mix(in_srgb,var(--hud-accent-soft)_18%,transparent)] hover:text-[var(--hud-text)]"
          >
            Create account
          </button>
        </div>

        <p className="mb-8 text-center text-[14px] text-[var(--hud-muted)]">
          Local mode keeps data on this device · Switch modes anytime in Settings
        </p>

        <section
          data-testid="welcome-planner-preview"
          className="w-[min(1280px,82vw)] overflow-hidden rounded-[18px] border border-[color:var(--board-line)] bg-[var(--board-surface)] shadow-[0_-1px_0_rgba(255,255,255,0.06),0_24px_60px_rgba(0,0,0,0.5)]"
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
    </div>
  );
}
