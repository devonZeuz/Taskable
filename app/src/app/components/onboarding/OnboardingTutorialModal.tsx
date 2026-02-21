import { useEffect, useMemo, useState, type ComponentType, type SVGProps } from 'react';
import { CalendarClock, CheckSquare, Clock3, LayoutGrid, Target, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';

type TutorialMode = 'local' | 'cloud';

interface TutorialSlide {
  id: string;
  title: string;
  description: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
}

interface OnboardingTutorialModalProps {
  open: boolean;
  mode: TutorialMode;
  onSkip: () => void;
  onFinish: () => void;
}

const BASE_SLIDES: TutorialSlide[] = [
  {
    id: 'capture',
    title: 'Capture quickly',
    description: 'Add tasks fast with Add Task, then move them into schedule blocks when ready.',
    icon: CheckSquare,
  },
  {
    id: 'plan',
    title: 'Plan by dragging',
    description:
      'Drag tasks between days and times. Resize task blocks to keep your day realistic.',
    icon: CalendarClock,
  },
  {
    id: 'execute',
    title: 'Run your day',
    description:
      'Start, pause, and complete planned work directly from task cards while the board stays live.',
    icon: Clock3,
  },
  {
    id: 'focus',
    title: 'Stay focused',
    description: 'Use Personal and Team views to filter attention without losing schedule context.',
    icon: Target,
  },
  {
    id: 'compact',
    title: 'Use compact mode',
    description:
      'Switch to compact mode for a cleaner always-visible planner glance, then jump back to full view.',
    icon: LayoutGrid,
  },
];

const CLOUD_SLIDE: TutorialSlide = {
  id: 'cloud',
  title: 'Cloud sync basics',
  description:
    'Cloud mode keeps changes synced across devices and surfaces conflicts when two edits collide.',
  icon: Users,
};

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
  const currentSlide = slides[currentIndex];
  const isLast = currentIndex >= slides.length - 1;

  useEffect(() => {
    if (!open) return;
    setCurrentIndex(0);
  }, [open, mode]);

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
        className="max-w-xl rounded-2xl border-[color:var(--hud-border)] bg-[var(--hud-surface)] p-6 text-[color:var(--hud-text)]"
      >
        <DialogHeader className="space-y-3 text-left">
          <div className="flex items-center gap-3">
            {currentSlide.icon ? (
              <span className="inline-flex size-10 items-center justify-center rounded-xl border border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)]">
                <currentSlide.icon className="size-5" />
              </span>
            ) : null}
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--hud-muted)]">
                Quick Tutorial
              </p>
              <DialogTitle className="text-2xl font-semibold tracking-[-0.02em]">
                {currentSlide.title}
              </DialogTitle>
            </div>
          </div>
          <DialogDescription className="text-sm leading-relaxed text-[color:var(--hud-muted)]">
            {currentSlide.description}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 flex items-center justify-center gap-2" data-testid="onboarding-dots">
          {slides.map((slide, index) => (
            <button
              key={slide.id}
              type="button"
              aria-label={`Go to step ${index + 1}`}
              data-testid={`onboarding-dot-${index}`}
              onClick={() => setCurrentIndex(index)}
              className={`h-2.5 rounded-full transition-all ${
                index === currentIndex
                  ? 'w-7 bg-[var(--hud-text)]'
                  : 'w-2.5 bg-[color:var(--hud-border)] hover:bg-[color:var(--hud-muted)]'
              }`}
            />
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={onSkip}
            data-testid="onboarding-tutorial-skip"
            className="ui-hud-btn h-9 rounded-xl px-4"
          >
            Skip
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={handleBack}
              disabled={currentIndex === 0}
              data-testid="onboarding-tutorial-back"
              className="ui-hud-btn h-9 rounded-xl px-4"
            >
              Back
            </Button>
            <Button
              type="button"
              onClick={handleNext}
              data-testid={isLast ? 'onboarding-tutorial-finish' : 'onboarding-tutorial-next'}
              className="ui-hud-btn-accent h-9 rounded-xl px-4"
            >
              {isLast ? 'Finish' : 'Next'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
