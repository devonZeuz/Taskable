import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import './OnboardingTutorialModal.css';

type TutorialMode = 'local' | 'cloud';
type TutorialScene = 'calendar' | 'inbox' | 'drag' | 'execute' | 'review' | 'cloud';

interface TutorialSlide {
  id: string;
  title: string;
  description: string;
  scene: TutorialScene;
}

interface OnboardingTutorialModalProps {
  open: boolean;
  mode: TutorialMode;
  onSkip: () => void;
  onFinish: () => void;
}

const BASE_SLIDES: TutorialSlide[] = [
  {
    id: 'calendar-overview',
    title: 'Your day at a glance',
    description:
      "See the full planner timeline in one place, including what's done, running, and up next.",
    scene: 'calendar',
  },
  {
    id: 'capture',
    title: 'Capture tasks instantly',
    description: 'Drop tasks into Inbox quickly. Duration suggestions help you schedule faster.',
    scene: 'inbox',
  },
  {
    id: 'drag-plan',
    title: 'Drag tasks into your day',
    description:
      'Reschedule directly on the timeline by dragging a task to a new slot and dropping to update it.',
    scene: 'drag',
  },
  {
    id: 'execute',
    title: 'Run tasks in real time',
    description: 'Start, pause, and complete tasks from cards while execution progress stays visible.',
    scene: 'execute',
  },
  {
    id: 'review',
    title: 'Review and improve',
    description:
      'Use weekly trends to spot what worked and where to improve focus, completion, and timing.',
    scene: 'review',
  },
];

const CLOUD_SLIDE: TutorialSlide = {
  id: 'cloud',
  title: 'Cloud sync basics',
  description:
    'Cloud mode keeps changes synced across devices and surfaces conflicts when two edits collide.',
  scene: 'cloud',
};

function formatElapsed(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safeSeconds / 60);
  const rem = safeSeconds % 60;
  return `${mins}:${String(rem).padStart(2, '0')}`;
}

export default function OnboardingTutorialModal({
  open,
  mode,
  onSkip,
  onFinish,
}: OnboardingTutorialModalProps) {
  const slides = useMemo(() => {
    if (mode === 'cloud') {
      return [...BASE_SLIDES, CLOUD_SLIDE];
    }
    return BASE_SLIDES;
  }, [mode]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [executeElapsedSeconds, setExecuteElapsedSeconds] = useState(0);
  const currentSlide = slides[currentIndex];
  const isLast = currentIndex >= slides.length - 1;
  const stepLabel = `Step ${currentIndex + 1} of ${slides.length}`;

  useEffect(() => {
    if (!open) return;
    setCurrentIndex(0);
  }, [open, mode]);

  useEffect(() => {
    if (!open || currentSlide.scene !== 'execute') {
      setExecuteElapsedSeconds(0);
      return;
    }

    setExecuteElapsedSeconds(0);
    const timerId = window.setInterval(() => {
      setExecuteElapsedSeconds((previous) => (previous >= 179 ? 0 : previous + 1));
    }, 1000);
    return () => {
      window.clearInterval(timerId);
    };
  }, [currentSlide.scene, open]);

  const handleBack = () => {
    setCurrentIndex((previous) => Math.max(0, previous - 1));
  };

  const handleNext = () => {
    if (isLast) {
      onFinish();
      return;
    }
    setCurrentIndex((previous) => Math.min(slides.length - 1, previous + 1));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onSkip();
        }
      }}
    >
      <DialogContent
        data-testid="onboarding-tutorial-modal"
        className="onboarding-tutorial-modal w-[min(560px,calc(100vw-1rem))] max-w-none overflow-hidden rounded-[22px] border-[color:var(--hud-border)] bg-[var(--hud-surface-strong)] p-0 text-[color:var(--hud-text)]"
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{currentSlide.title}</DialogTitle>
          <DialogDescription>{currentSlide.description}</DialogDescription>
        </DialogHeader>

        <div className="onboarding-tutorial-preview" aria-hidden="true">
          <TutorialPreview
            scene={currentSlide.scene}
            mode={mode}
            executeElapsedSeconds={executeElapsedSeconds}
          />
        </div>

        <div className="onboarding-tutorial-body">
          <div className="onboarding-tutorial-head">
            <p className="onboarding-tutorial-step">{stepLabel}</p>
            <Button
              type="button"
              variant="ghost"
              onClick={onSkip}
              data-testid="onboarding-tutorial-skip"
              className="onboarding-tutorial-skip-chip"
            >
              Skip
            </Button>
          </div>
          <h2 className="onboarding-tutorial-title">{currentSlide.title}</h2>
          <p className="onboarding-tutorial-description">{currentSlide.description}</p>

          <div className="onboarding-tutorial-footer">
            <div className="onboarding-tutorial-dots" data-testid="onboarding-dots">
              {slides.map((slide, index) => (
                <button
                  key={slide.id}
                  type="button"
                  aria-label={`Go to step ${index + 1}`}
                  data-testid={`onboarding-dot-${index}`}
                  onClick={() => setCurrentIndex(index)}
                  className={`onboarding-tutorial-dot${index === currentIndex ? ' is-active' : ''}`}
                />
              ))}
            </div>

            <div className="onboarding-tutorial-actions">
              <Button
                type="button"
                variant="ghost"
                onClick={handleBack}
                disabled={currentIndex === 0}
                data-testid="onboarding-tutorial-back"
                className="onboarding-tutorial-btn is-secondary"
              >
                Back
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={handleNext}
                data-testid={isLast ? 'onboarding-tutorial-finish' : 'onboarding-tutorial-next'}
                className="onboarding-tutorial-btn is-primary"
              >
                {isLast ? 'Finish' : 'Next'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TutorialPreview({
  scene,
  mode,
  executeElapsedSeconds,
}: {
  scene: TutorialScene;
  mode: TutorialMode;
  executeElapsedSeconds: number;
}) {
  const sceneClass = (target: TutorialScene) =>
    `onboarding-tutorial-scene${scene === target ? ' is-active' : ''}`;
  const executeProgress = Math.min(0.82, executeElapsedSeconds / 180);

  return (
    <div className="onboarding-tutorial-scenes-shell">
      <section className={sceneClass('calendar')}>
        <div className="onboarding-calendar-shell">
          <div className="onboarding-calendar-rail">
            <span className="onboarding-calendar-chip is-accent">Add Task</span>
            <span className="onboarding-calendar-chip">Undo</span>
            <span className="onboarding-calendar-chip">Redo</span>
            <span className="onboarding-calendar-chip">125%</span>
            <span className="onboarding-calendar-chip ml-auto">Personal</span>
          </div>

          <div className="onboarding-calendar-axis">
            <span>08:00</span>
            <span>09:00</span>
            <span>10:00</span>
            <span>11:00</span>
            <span className="onboarding-calendar-now-pill">Now</span>
          </div>

          <div className="onboarding-calendar-row">
            <div className="onboarding-calendar-day-label">
              <p className="onboarding-calendar-day-title">Today</p>
              <p className="onboarding-calendar-day-subtitle">Feb 26</p>
            </div>

            <div className="onboarding-calendar-grid">
              <article className="onboarding-calendar-task is-done task-a">
                <p className="onboarding-calendar-task-title">Germany invoices</p>
                <p className="onboarding-calendar-task-meta">08:00-09:00</p>
              </article>
              <article className="onboarding-calendar-task is-running task-b">
                <p className="onboarding-calendar-task-title">Monthly reports</p>
                <p className="onboarding-calendar-task-meta">09:00-10:45</p>
                <p className="onboarding-calendar-task-status">Running</p>
              </article>
              <article className="onboarding-calendar-task is-upcoming task-c">
                <p className="onboarding-calendar-task-title">Design review</p>
                <p className="onboarding-calendar-task-meta">11:00-12:00</p>
                <span className="onboarding-calendar-task-start">Start</span>
              </article>
              <article className="onboarding-calendar-task is-done task-d">
                <p className="onboarding-calendar-task-title">Swiss invoices</p>
                <p className="onboarding-calendar-task-meta">08:00-09:00</p>
              </article>
              <article className="onboarding-calendar-task is-idle task-e">
                <p className="onboarding-calendar-task-title">Update dependencies</p>
                <p className="onboarding-calendar-task-meta">09:00-10:15</p>
              </article>
              <article className="onboarding-calendar-task is-upcoming task-f">
                <p className="onboarding-calendar-task-title">Client follow-up</p>
                <p className="onboarding-calendar-task-meta">10:30-11:30</p>
                <span className="onboarding-calendar-task-start is-click-target">Start</span>
              </article>

              <TutorialCursor className="onboarding-calendar-cursor" />
              <span className="onboarding-ripple onboarding-calendar-ripple" />
            </div>
          </div>
        </div>
      </section>

      <section className={sceneClass('inbox')}>
        <div className="onboarding-inbox-shell">
          <div className="onboarding-inbox-header">
            <p className="onboarding-inbox-title">Inbox</p>
            <span className="onboarding-inbox-add">Add task</span>
          </div>
          <ul className="onboarding-inbox-list">
            <li className="onboarding-inbox-item">
              <span>Q3 strategy deck</span>
              <span className="onboarding-inbox-estimate">~2h 15m</span>
            </li>
            <li className="onboarding-inbox-item">
              <span>Performance reviews</span>
              <span className="onboarding-inbox-estimate">~3h</span>
            </li>
            <li className="onboarding-inbox-item">
              <span>Update dependencies</span>
              <span className="onboarding-inbox-estimate">~45m</span>
            </li>
            <li className="onboarding-inbox-item">
              <span>Reply to contractors</span>
              <span className="onboarding-inbox-estimate">~20m</span>
            </li>
          </ul>
          <div className="onboarding-inbox-input">
            <span className="onboarding-inbox-typing">Q3 strategy follow-up</span>
          </div>
          <TutorialCursor className="onboarding-inbox-cursor" />
        </div>
      </section>

      <section className={sceneClass('drag')}>
        <div className="onboarding-drag-shell">
          <div className="onboarding-drag-board is-full">
            <div className="onboarding-drag-axis">
              <span>08:00</span>
              <span>09:00</span>
              <span>10:00</span>
              <span>11:00</span>
            </div>
            <div className="onboarding-drag-grid">
              <div className="onboarding-drag-dropzone" />
              <article className="onboarding-calendar-task is-running drag-task-a">
                <p className="onboarding-calendar-task-title">Monthly reports</p>
                <p className="onboarding-calendar-task-meta">09:00-11:00</p>
              </article>
              <article className="onboarding-calendar-task is-upcoming drag-task-b">
                <p className="onboarding-calendar-task-title">Design review</p>
                <p className="onboarding-calendar-task-meta">11:00-12:00</p>
              </article>

              <article className="onboarding-calendar-task is-idle onboarding-drag-origin-card">
                <p className="onboarding-calendar-task-title">Q3 strategy</p>
                <p className="onboarding-calendar-task-meta">08:00-10:15</p>
                <span className="onboarding-calendar-task-start">Start</span>
              </article>

              <article className="onboarding-calendar-task is-idle onboarding-drag-moving-card">
                <p className="onboarding-calendar-task-title">Q3 strategy</p>
                <p className="onboarding-calendar-task-meta">08:00-10:15</p>
                <span className="onboarding-calendar-task-start">Start</span>
              </article>

              <article className="onboarding-calendar-task is-idle onboarding-drag-updated-card">
                <p className="onboarding-calendar-task-title">Q3 strategy</p>
                <p className="onboarding-calendar-task-meta">09:30-11:45</p>
                <span className="onboarding-calendar-task-start">Start</span>
              </article>

              <TutorialCursor className="onboarding-drag-cursor" />
            </div>
          </div>
        </div>
      </section>

      <section className={sceneClass('execute')}>
        <div className="onboarding-run-shell">
          <article className="onboarding-run-card">
            <div className="onboarding-run-top">
              <div>
                <p className="onboarding-run-title">Monthly reports</p>
                <p className="onboarding-run-meta">09:00-11:00 | 3 subtasks</p>
              </div>
              <span className="onboarding-run-status">
                <span className="onboarding-run-status-dot" />
                Running
              </span>
            </div>

            <ul className="onboarding-run-subtasks">
              <li>
                <span className="onboarding-run-check check-one" />
                Report 1
              </li>
              <li>
                <span className="onboarding-run-check check-two" />
                Report 2
              </li>
              <li>
                <span className="onboarding-run-check check-three" />
                Report 3
              </li>
            </ul>

            <div className="onboarding-run-actions">
              <button type="button" className="onboarding-run-action is-primary is-click-target">
                <span className="onboarding-run-action-label is-start">Start</span>
                <span className="onboarding-run-action-label is-pause">Pause</span>
              </button>
              <button type="button" className="onboarding-run-action">
                Done
              </button>
              <button type="button" className="onboarding-run-action">
                Next
              </button>
            </div>

            <p className="onboarding-run-timer">{formatElapsed(executeElapsedSeconds)} elapsed</p>
            <div className="onboarding-run-progress">
              <span style={{ transform: `scaleX(${executeProgress})` }} />
            </div>
          </article>

          <TutorialCursor className="onboarding-run-cursor" />
          <span className="onboarding-ripple onboarding-run-ripple-start" />
          <span className="onboarding-ripple onboarding-run-ripple-c1" />
          <span className="onboarding-ripple onboarding-run-ripple-c2" />
          <span className="onboarding-ripple onboarding-run-ripple-c3" />
        </div>
      </section>

      <section className={sceneClass('review')}>
        <div className="onboarding-review-shell">
          <div>
            <p className="onboarding-review-title">Weekly review</p>
            <p className="onboarding-review-subtitle">How your week performed</p>
          </div>

          <div className="onboarding-review-stats">
            <article className="onboarding-review-stat">
              <p className="onboarding-review-value">24</p>
              <p className="onboarding-review-label">Tasks done</p>
            </article>
            <article className="onboarding-review-stat">
              <p className="onboarding-review-value">87%</p>
              <p className="onboarding-review-label">On time</p>
            </article>
            <article className="onboarding-review-stat">
              <p className="onboarding-review-value">18.5h</p>
              <p className="onboarding-review-label">Focus time</p>
            </article>
          </div>

          <div className="onboarding-review-bars">
            <div className="onboarding-review-row">
              <span>Completion</span>
              <div className="onboarding-review-track">
                <span className="fill-one" />
              </div>
              <span>87%</span>
            </div>
            <div className="onboarding-review-row">
              <span>Focus</span>
              <div className="onboarding-review-track">
                <span className="fill-two" />
              </div>
              <span>72%</span>
            </div>
            <div className="onboarding-review-row">
              <span>Accuracy</span>
              <div className="onboarding-review-track">
                <span className="fill-three" />
              </div>
              <span>94%</span>
            </div>
          </div>

          <div className="onboarding-review-insight">
            <p>Performance insight</p>
            <span>You focus best Tue 09:00-11:00. Reserve that block for deep work.</span>
          </div>
        </div>
      </section>

      <section className={sceneClass('cloud')}>
        <div className="onboarding-cloud-shell">
          <p className="onboarding-cloud-title">
            {mode === 'cloud' ? 'Workspace sync active' : 'Cloud sync'}
          </p>
          <p className="onboarding-cloud-subtitle">
            Keep planner changes synced across devices with conflict-safe updates.
          </p>
          <div className="onboarding-cloud-flow">
            <div className="onboarding-cloud-node">Desktop</div>
            <div className="onboarding-cloud-link" />
            <div className="onboarding-cloud-node is-primary">Cloud</div>
            <div className="onboarding-cloud-link" />
            <div className="onboarding-cloud-node">Team</div>
          </div>
          <ul className="onboarding-cloud-points">
            <li>Live sync between sessions</li>
            <li>Conflict detection before overwrite</li>
            <li>Workspace-aware roles and visibility</li>
          </ul>
        </div>
      </section>
    </div>
  );
}

function TutorialCursor({ className }: { className: string }) {
  return (
    <span className={`onboarding-cursor ${className}`}>
      <span className="onboarding-cursor-inner">
        <svg viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M3 1.5L14.5 9L9.5 10.5L7.5 15.5L3 1.5Z"
            fill="white"
            stroke="rgba(0,0,0,0.45)"
            strokeWidth="0.8"
          />
        </svg>
      </span>
    </span>
  );
}
