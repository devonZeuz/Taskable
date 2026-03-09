import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../ui/button';
import { useTasks } from '../../context/TaskContext';
import { recordProductEvent } from '../../services/productAnalytics';
import { requestCloseSettings, requestOpenSettings } from '../../services/settingsBridge';
import './OnboardingSpotlightTour.css';

type TutorialMode = 'local' | 'cloud';
type SpotlightPlacement = 'top' | 'right' | 'bottom' | 'left';

type TargetRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

interface TutorialStep {
  id: string;
  title: string;
  description: string;
  details?: string[];
  placement: SpotlightPlacement;
  targetPadding?: number;
  mergeTargets?: boolean;
  target: () => HTMLElement | null;
  secondaryTargets?: () => HTMLElement[];
  arrowTargets?: () => HTMLElement[];
  prepare?: () => void;
}

interface OnboardingTutorialModalProps {
  open: boolean;
  mode: TutorialMode;
  onSkip: () => void;
  onFinish: () => void;
}

function getVisibleElements(selectors: string[]): HTMLElement[] {
  if (typeof document === 'undefined') return [];
  const results: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  for (const selector of selectors) {
    const matches = Array.from(document.querySelectorAll<HTMLElement>(selector));
    matches.forEach((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      if (seen.has(element)) return;
      seen.add(element);
      results.push(element);
    });
  }
  return results;
}

function getFirstVisibleElement(selectors: string[]): HTMLElement | null {
  return getVisibleElements(selectors)[0] ?? null;
}

function clickFirstVisible(selectors: string[]) {
  const element = getFirstVisibleElement(selectors);
  if (!element) return false;
  element.click();
  return true;
}

function closeTaskDialogIfOpen() {
  clickFirstVisible(['[data-testid="task-dialog-cancel"]']);
}

function closeQuickActionsIfOpen() {
  clickFirstVisible(['[data-testid="task-quick-actions-close"]']);
}

function getElementCenter(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function parseQuickAddMinutes(testId: string): number | null {
  const match = testId.match(/(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

function getLocalDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseQuickAddSlot(testId: string) {
  const match = testId.match(/^quick-add-(\d{4}-\d{2}-\d{2})-(\d{2}:\d{2})$/);
  if (!match) return null;
  return { dayKey: match[1], time: match[2] };
}

function getPreferredQuickAddTargetData(): {
  cell: HTMLElement;
  button: HTMLElement;
  dayKey: string;
  time: string;
} | null {
  const nowIndicator = document.querySelector<HTMLElement>('[data-testid="timeline-now-indicator"]');
  const currentNow = new Date();
  currentNow.setSeconds(0, 0);
  const targetHour = new Date(currentNow);
  targetHour.setMinutes(0, 0, 0);
  const todayKey = getLocalDayKey(targetHour);
  const todayColumn =
    nowIndicator?.closest<HTMLElement>('[data-testid^="day-column-"]') ??
    document.querySelector<HTMLElement>(`[data-testid="day-column-${todayKey}"]`);
  const allButtons = getVisibleElements(['[data-testid^="quick-add-"]']).filter((element) =>
    /^quick-add-\d{4}-\d{2}-\d{2}-\d{2}:\d{2}$/.test(element.getAttribute('data-testid') ?? '')
  );
  if (allButtons.length === 0) return null;

  const usableButtons = todayColumn
    ? allButtons.filter((button) => todayColumn.contains(button))
    : allButtons;
  const candidateButtons = usableButtons.length > 0 ? usableButtons : allButtons;
  const targetMinutes = targetHour.getHours() * 60 + targetHour.getMinutes();

  const exactButton = candidateButtons.find((button) => {
    const slot = parseQuickAddSlot(button.getAttribute('data-testid') ?? '');
    return slot?.dayKey === todayKey && slot.time === `${String(targetHour.getHours()).padStart(2, '0')}:00`;
  });

  const preferredButton =
    exactButton ??
    candidateButtons
      .map((button) => {
        const testId = button.getAttribute('data-testid') ?? '';
        const minutes = parseQuickAddMinutes(testId);
        if (minutes === null) return null;
        return {
          button,
          delta: Math.abs(minutes - targetMinutes),
        };
      })
      .filter((entry): entry is { button: HTMLElement; delta: number } => Boolean(entry))
      .sort((left, right) => left.delta - right.delta)[0]?.button ??
    candidateButtons[0];

  if (!preferredButton) return null;
  const preferredCell =
    preferredButton.closest<HTMLElement>('[data-testid^="quick-add-cell-"]') ?? preferredButton;
  const preferredSlot = parseQuickAddSlot(preferredButton.getAttribute('data-testid') ?? '');
  return {
    cell: preferredCell,
    button: preferredButton,
    dayKey: preferredSlot?.dayKey ?? todayKey,
    time:
      preferredSlot?.time ??
      `${String(targetHour.getHours()).padStart(2, '0')}:00`,
  };
}

function getPreferredQuickAddTargets(): HTMLElement[] {
  const targetData = getPreferredQuickAddTargetData();
  if (!targetData) return [];
  return [targetData.cell, targetData.button];
}

function ensureDailyPlanningExpanded() {
  if (clickFirstVisible(['[data-testid="daily-planning-open-panel"]'])) return;
  const collapseToggle = getFirstVisibleElement(['[data-testid="daily-planning-collapse-toggle"]']);
  if (collapseToggle && /expand/i.test(collapseToggle.textContent ?? '')) {
    collapseToggle.click();
  }
}

function ensureDailyPlanningCollapsed() {
  const collapseToggle = getFirstVisibleElement(['[data-testid="daily-planning-collapse-toggle"]']);
  if (collapseToggle && /collapse/i.test(collapseToggle.textContent ?? '')) {
    collapseToggle.click();
  }
}

export default function OnboardingTutorialModal({
  open,
  mode,
  onSkip,
  onFinish,
}: OnboardingTutorialModalProps) {
  const { tasks, addTask, deleteTask, startTask } = useTasks();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [targetRects, setTargetRects] = useState<TargetRect[]>([]);
  const [arrowRects, setArrowRects] = useState<TargetRect[]>([]);
  const [bubbleSize, setBubbleSize] = useState({ width: 360, height: 228 });
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const onboardingTaskIdRef = useRef<string | null>(null);
  const highlightedElementsRef = useRef<HTMLElement[]>([]);
  const backdropMaskId = useId().replace(/:/g, '-');

  const clearStepHighlights = () => {
    highlightedElementsRef.current.forEach((element) => {
      delete element.dataset.onboardingQuickAdd;
    });
    highlightedElementsRef.current = [];
  };

  const cleanupOnboardingTask = () => {
    const taskId = onboardingTaskIdRef.current;
    if (!taskId) return;
    onboardingTaskIdRef.current = null;
    if (tasks.some((task) => task.id === taskId)) {
      deleteTask(taskId);
    }
  };

  const ensureInboxVisible = () => {
    if (getFirstVisibleElement(['[data-testid="inbox-panel"]'])) return;
    void clickFirstVisible(['[data-testid="sidebar-icon-inbox-personal"]']);
  };

  const ensureCapacityVisible = () => {
    if (getFirstVisibleElement(['[data-testid="capacity-bar-panel"]'])) return;
    void clickFirstVisible(['[data-testid="sidebar-icon-capacity-personal"]']);
  };

  const ensureTourTask = () => {
    const existingTaskId = onboardingTaskIdRef.current;
    if (existingTaskId && tasks.some((task) => task.id === existingTaskId)) {
      return existingTaskId;
    }

    const quickAddTarget = getPreferredQuickAddTargetData();
    const startDate = quickAddTarget
      ? new Date(`${quickAddTarget.dayKey}T${quickAddTarget.time}:00`)
      : new Date();
    if (!quickAddTarget) {
      startDate.setMinutes(Math.ceil(startDate.getMinutes() / 15) * 15, 0, 0);
    }

    const task = addTask(
      {
        title: 'Onboarding walkthrough task',
        description: 'Temporary task used only during the onboarding spotlight tour.',
        startDateTime: startDate.toISOString(),
        durationMinutes: 60,
        subtasks: [
          { id: 'onboard-subtask-1', title: 'Capture the task', completed: true },
          { id: 'onboard-subtask-2', title: 'Place it on the calendar', completed: false },
        ],
        type: 'large',
        completed: false,
        status: 'scheduled',
        executionStatus: 'idle',
        actualMinutes: 0,
        version: 0,
      },
      { skipProductAnalytics: true }
    );

    onboardingTaskIdRef.current = task.id;
    return task.id;
  };

  const steps = useMemo<TutorialStep[]>(
    () => [
      {
        id: 'inbox',
        title: 'Start with Inbox',
        description:
          'Capture loose work here first. Drag emails or text into Inbox, then schedule it once the timing is clear.',
        placement: 'right',
        targetPadding: 14,
        target: () =>
          getFirstVisibleElement([
            '[data-testid="inbox-panel"]',
            '[data-testid="sidebar-icon-inbox-personal"]',
          ]),
        prepare: () => {
          requestCloseSettings();
          closeTaskDialogIfOpen();
          closeQuickActionsIfOpen();
          ensureDailyPlanningCollapsed();
          ensureInboxVisible();
        },
      },
      {
        id: 'create-task-paths',
        title: 'Create tasks in two ways',
        description:
          'Use Add Task when you already know the details. Use the plus button inside the calendar when you want to place work directly on the timeline.',
        placement: 'bottom',
        targetPadding: 12,
        target: () => getFirstVisibleElement(['[data-testid="add-task-trigger"]']),
        secondaryTargets: () => getPreferredQuickAddTargets(),
        prepare: () => {
          requestCloseSettings();
          closeTaskDialogIfOpen();
          closeQuickActionsIfOpen();
          ensureDailyPlanningCollapsed();
        },
      },
      {
        id: 'task-dialog',
        title: 'Choose the task type before you place it',
        description:
          'Pick the task type, then set the scheduling details.',
        details: [
          'Quick: short focused work in a standard slot',
          'Complex: multi-step work that needs structure',
          'Block: reserved time on the calendar',
          'Set day, start time, duration, and scheduling intent here',
        ],
        placement: 'right',
        targetPadding: 14,
        mergeTargets: true,
        target: () => getFirstVisibleElement(['[data-testid="task-scheduling-section"]']),
        secondaryTargets: () => getVisibleElements(['[data-testid="task-type-section"]']),
        prepare: () => {
          requestCloseSettings();
          closeQuickActionsIfOpen();
          ensureDailyPlanningCollapsed();
          if (getFirstVisibleElement(['[data-testid="task-dialog-form"]'])) return;
          const openedFromTopbar = clickFirstVisible(['[data-testid="add-task-trigger"]']);
          if (!openedFromTopbar) {
            void clickFirstVisible(['[data-testid^="quick-add-"]']);
          }
          window.setTimeout(() => {
            if (getFirstVisibleElement(['[data-testid="task-dialog-form"]'])) return;
            clickFirstVisible(['[data-testid="add-task-trigger"]']);
          }, 90);
        },
      },
      {
        id: 'task-hud',
        title: 'Run the task from the live HUD',
        description:
          'Once work starts, open the task card to get the live HUD.',
        details: [
          'Start or Pause: control live execution',
          'Done: mark the work complete',
          'Extend: stretch the task to cover reality',
          'Next: move remaining work forward',
          'Close: dismiss the HUD when you are done',
        ],
        placement: 'left',
        targetPadding: 14,
        target: () =>
          getFirstVisibleElement([
            `[data-testid="task-card-${onboardingTaskIdRef.current ?? 'missing'}"]`,
            '[data-testid="task-quick-actions-hub"]',
          ]),
        secondaryTargets: () =>
          getVisibleElements([
            `[data-testid="task-action-strip-${onboardingTaskIdRef.current ?? 'missing'}"]`,
            '[data-testid="task-quick-actions-hub"]',
          ]),
        arrowTargets: () =>
          getVisibleElements([`[data-testid="task-action-strip-${onboardingTaskIdRef.current ?? 'missing'}"]`]),
        prepare: () => {
          requestCloseSettings();
          closeTaskDialogIfOpen();
          ensureDailyPlanningCollapsed();
          const taskId = ensureTourTask();
          window.requestAnimationFrame(() => {
            if (!tasks.some((task) => task.id === taskId && task.executionStatus === 'running')) {
              startTask(taskId);
            }
            window.requestAnimationFrame(() => {
              const card = document.querySelector<HTMLElement>(`[data-testid="task-card-${taskId}"]`);
              card?.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
              card?.click();
            });
          });
        },
      },
      {
        id: 'capacity',
        title: 'Capacity shows if the day is realistic',
        description:
          'This panel compares planned work against the available workday. Use it to spot overload before the schedule gets away from you.',
        placement: 'right',
        targetPadding: 12,
        target: () =>
          getFirstVisibleElement([
            '[data-testid="capacity-bar-panel"]',
            '[data-testid="sidebar-icon-capacity-personal"]',
          ]),
        prepare: () => {
          requestCloseSettings();
          closeTaskDialogIfOpen();
          closeQuickActionsIfOpen();
          ensureDailyPlanningCollapsed();
          ensureCapacityVisible();
        },
      },
      {
        id: 'daily-planning',
        title: 'Daily Planning is your command surface',
        description:
          'This panel summarizes progress, near-term work, alerts, and end-of-day review. It is the fastest way to steer today without scanning the full timeline.',
        placement: 'bottom',
        targetPadding: 12,
        target: () => getFirstVisibleElement(['[data-testid="daily-planning-panel"]']),
        prepare: () => {
          requestCloseSettings();
          closeTaskDialogIfOpen();
          closeQuickActionsIfOpen();
          ensureDailyPlanningExpanded();
        },
      },
      {
        id: 'settings-general',
        title: 'General settings shape the planner',
        description:
          'General settings control workday hours, slot size, default duration, week start, time format, zoom, density, and other planner defaults.',
        placement: 'left',
        targetPadding: 14,
        target: () => getFirstVisibleElement(['[data-testid="settings-drawer"]']),
        prepare: () => {
          closeTaskDialogIfOpen();
          closeQuickActionsIfOpen();
          ensureDailyPlanningCollapsed();
          requestOpenSettings({ section: 'general' });
        },
      },
    ],
    [addTask, deleteTask, startTask, tasks]
  );

  const currentStep = steps[currentIndex];
  const isLast = currentIndex >= steps.length - 1;
  const stepLabel = `Step ${currentIndex + 1} of ${steps.length}`;

  useEffect(() => {
    if (!open) return;
    setCurrentIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    recordProductEvent({
      eventType: 'tutorial_viewed',
      mode,
      metadata: { stepCount: steps.length, tourStyle: 'spotlight' },
    });
  }, [mode, open, steps.length]);

  useEffect(() => {
    if (!open) {
      requestCloseSettings();
      closeTaskDialogIfOpen();
      closeQuickActionsIfOpen();
      cleanupOnboardingTask();
      clearStepHighlights();
      setArrowRects([]);
      if (typeof document !== 'undefined') {
        delete document.documentElement.dataset.onboardingStep;
      }
      return;
    }

    document.documentElement.dataset.onboardingStep = currentStep.id;
    currentStep.prepare?.();

    return () => {
      clearStepHighlights();
      if (typeof document !== 'undefined') {
        delete document.documentElement.dataset.onboardingStep;
      }
    };
  }, [currentStep, open]);

  useEffect(() => {
    if (!open) return undefined;

    const scrollToTarget = () => {
      const element = currentStep.target();
      if (!element) return false;
      element.scrollIntoView({
        behavior: 'auto',
        block: 'center',
        inline: 'center',
      });
      return true;
    };

    if (!scrollToTarget()) {
      const retryId = window.setTimeout(scrollToTarget, 80);
      return () => window.clearTimeout(retryId);
    }

    return undefined;
  }, [currentStep, open]);

  useEffect(() => {
    if (!open) {
      setTargetRects([]);
      return undefined;
    }

    const updateTargetRects = () => {
      const primaryTarget = currentStep.target();
      const secondaryTargets = currentStep.secondaryTargets?.() ?? [];
      const elements = [primaryTarget, ...secondaryTargets].filter(
        (element): element is HTMLElement => Boolean(element)
      );

      if (elements.length === 0) {
        return;
      }

      clearStepHighlights();
      if (currentStep.id === 'create-task-paths') {
        elements.forEach((element) => {
          const testId = element.getAttribute('data-testid') ?? '';
          if (testId.startsWith('quick-add-cell-')) {
            element.dataset.onboardingQuickAdd = 'cell';
            highlightedElementsRef.current.push(element);
            return;
          }
          if (testId.startsWith('quick-add-')) {
            element.dataset.onboardingQuickAdd = 'button';
            highlightedElementsRef.current.push(element);
          }
        });
      }

      const padding = currentStep.targetPadding ?? 10;
      const toRect = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        return {
          left: Math.max(10, rect.left - padding),
          top: Math.max(10, rect.top - padding),
          width: rect.width + padding * 2,
          height: rect.height + padding * 2,
        };
      };
      const rawRects = elements.map(toRect);
      const nextRects = currentStep.mergeTargets
        ? [mergeTargetRects(rawRects)]
        : rawRects;
      const nextArrowRects = (currentStep.arrowTargets?.() ?? [])
        .filter((element): element is HTMLElement => Boolean(element))
        .map(toRect);

      setTargetRects((previous) => {
        if (
          previous.length === nextRects.length &&
          previous.every(
            (rect, index) =>
              Math.abs(rect.left - nextRects[index].left) < 0.5 &&
              Math.abs(rect.top - nextRects[index].top) < 0.5 &&
              Math.abs(rect.width - nextRects[index].width) < 0.5 &&
              Math.abs(rect.height - nextRects[index].height) < 0.5
          )
        ) {
          return previous;
        }
        return nextRects;
      });
      setArrowRects((previous) => {
        const effectiveArrowRects = nextArrowRects.length > 0 ? nextArrowRects : [nextRects[0]];
        if (
          previous.length === effectiveArrowRects.length &&
          previous.every(
            (rect, index) =>
              Math.abs(rect.left - effectiveArrowRects[index].left) < 0.5 &&
              Math.abs(rect.top - effectiveArrowRects[index].top) < 0.5 &&
              Math.abs(rect.width - effectiveArrowRects[index].width) < 0.5 &&
              Math.abs(rect.height - effectiveArrowRects[index].height) < 0.5
          )
        ) {
          return previous;
        }
        return effectiveArrowRects;
      });
    };

    updateTargetRects();
    const intervalId = window.setInterval(updateTargetRects, 100);
    window.addEventListener('resize', updateTargetRects);
    window.addEventListener('scroll', updateTargetRects, true);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('resize', updateTargetRects);
      window.removeEventListener('scroll', updateTargetRects, true);
    };
  }, [currentStep, open]);

  useLayoutEffect(() => {
    if (!open || !bubbleRef.current) return;
    const nextWidth = bubbleRef.current.offsetWidth || 360;
    const nextHeight = bubbleRef.current.offsetHeight || 228;
    setBubbleSize((previous) =>
      previous.width === nextWidth && previous.height === nextHeight
        ? previous
        : { width: nextWidth, height: nextHeight }
    );
  }, [currentIndex, open, targetRects]);

  const handleSkip = (reason: 'skip' | 'escape') => {
    requestCloseSettings();
    closeTaskDialogIfOpen();
    closeQuickActionsIfOpen();
    cleanupOnboardingTask();
    clearStepHighlights();
    recordProductEvent({
      eventType: 'tutorial_skipped',
      mode,
      metadata: { step: currentIndex + 1, stepId: currentStep.id, reason },
    });
    onSkip();
  };

  const handleNext = () => {
    if (isLast) {
      requestCloseSettings();
      closeTaskDialogIfOpen();
      closeQuickActionsIfOpen();
      cleanupOnboardingTask();
      clearStepHighlights();
      recordProductEvent({
        eventType: 'tutorial_completed',
        mode,
        metadata: { stepCount: steps.length, tourStyle: 'spotlight' },
      });
      onFinish();
      return;
    }
    goToStep(Math.min(steps.length - 1, currentIndex + 1));
  };

  const goToStep = (nextIndex: number) => {
    const resolvedIndex = Math.min(steps.length - 1, Math.max(0, nextIndex));
    if (resolvedIndex === currentIndex) return;

    const nextStep = steps[resolvedIndex];
    if (nextStep.id === 'task-dialog' || nextStep.id === 'task-hud') {
      nextStep.prepare?.();
    }
    setCurrentIndex(resolvedIndex);
  };

  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleSkip('escape');
        return;
      }
      if (event.key === 'ArrowRight') {
        handleNext();
        return;
      }
      if (event.key === 'ArrowLeft') {
        goToStep(Math.max(0, currentIndex - 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, isLast, open]);

  if (!open) return null;

  const primaryRect = targetRects[0] ?? null;
  const bubblePosition = getBubblePosition(primaryRect, bubbleSize, currentStep.placement);
  const arrowPaths = arrowRects
    .map((rect) => getArrowPath(rect, bubblePosition, bubbleSize, bubblePosition.placement))
    .filter(Boolean);
  const viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight;

  return (
    <div
      data-testid="onboarding-tutorial-modal"
      className="onboarding-spotlight-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Tareva onboarding tour"
    >
      <svg className="onboarding-spotlight-backdrop" aria-hidden="true">
        <defs>
          <mask id={backdropMaskId}>
            <rect width="100%" height="100%" fill="white" />
            {targetRects.map((rect, index) => (
              <rect
                key={`spotlight-mask-${index}`}
                x={rect.left}
                y={rect.top}
                width={rect.width}
                height={rect.height}
                rx="20"
                ry="20"
                fill="black"
              />
            ))}
          </mask>
        </defs>
        <rect
          width={viewportWidth}
          height={viewportHeight}
          fill="rgba(3, 5, 10, 0.5)"
          mask={`url(#${backdropMaskId})`}
        />
      </svg>

      {targetRects.length > 0 ? (
        <>
          {targetRects.map((rect, index) => (
            <div
              key={`spotlight-rect-${index}`}
              className="onboarding-spotlight-hole"
              style={{
                left: `${rect.left}px`,
                top: `${rect.top}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`,
              }}
            />
          ))}
          {arrowPaths.length > 0 ? (
            <svg className="onboarding-spotlight-arrow" aria-hidden="true">
              {arrowPaths.map((path, index) => (
                <path key={`spotlight-arrow-${index}`} d={path} />
              ))}
            </svg>
          ) : null}
        </>
      ) : null}

      <div
        ref={bubbleRef}
        className="onboarding-spotlight-card"
        style={{
          left: `${bubblePosition.left}px`,
          top: `${bubblePosition.top}px`,
        }}
      >
        <div className="onboarding-spotlight-head">
          <p className="onboarding-spotlight-step">{stepLabel}</p>
          {!isLast ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleSkip('skip')}
              data-testid="onboarding-tutorial-skip"
              className="onboarding-spotlight-skip"
            >
              Skip
            </Button>
          ) : (
            <div />
          )}
        </div>

        <h2 className="onboarding-spotlight-title">{currentStep.title}</h2>
        <p className="onboarding-spotlight-description">{currentStep.description}</p>
        {currentStep.details?.length ? (
          <ul className="onboarding-spotlight-list">
            {currentStep.details.map((item) => (
              <li key={item} className="onboarding-spotlight-list-item">
                {item}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="onboarding-spotlight-dots" data-testid="onboarding-dots">
          {steps.map((step, index) => (
            <button
              key={step.id}
              type="button"
              aria-label={`Go to step ${index + 1}`}
              data-testid={`onboarding-dot-${index}`}
              onClick={() => goToStep(index)}
              className={`onboarding-spotlight-dot${index === currentIndex ? ' is-active' : ''}`}
            />
          ))}
        </div>

        <div className="onboarding-spotlight-actions">
          <Button
            type="button"
            variant="ghost"
            onClick={() => goToStep(Math.max(0, currentIndex - 1))}
            disabled={currentIndex === 0}
            data-testid="onboarding-tutorial-back"
            className="onboarding-spotlight-btn is-secondary"
          >
            Back
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={handleNext}
            data-testid={isLast ? 'onboarding-tutorial-finish' : 'onboarding-tutorial-next'}
            className="onboarding-spotlight-btn is-primary"
          >
            {isLast ? 'Finish' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function mergeTargetRects(rects: TargetRect[]): TargetRect {
  if (rects.length === 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }

  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.left + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.top + rect.height));

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

function getBubblePosition(
  targetRect: TargetRect | null,
  bubbleSize: { width: number; height: number },
  placement: SpotlightPlacement
) {
  const viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight;
  const gutter = 18;
  const gap = 24;

  if (!targetRect) {
    return {
      left: Math.max(gutter, Math.round((viewportWidth - bubbleSize.width) / 2)),
      top: Math.max(gutter, Math.round((viewportHeight - bubbleSize.height) / 2)),
      placement,
    };
  }

  const candidates = {
    top: {
      left: targetRect.left + targetRect.width / 2 - bubbleSize.width / 2,
      top: targetRect.top - bubbleSize.height - gap,
    },
    right: {
      left: targetRect.left + targetRect.width + gap,
      top: targetRect.top + targetRect.height / 2 - bubbleSize.height / 2,
    },
    bottom: {
      left: targetRect.left + targetRect.width / 2 - bubbleSize.width / 2,
      top: targetRect.top + targetRect.height + gap,
    },
    left: {
      left: targetRect.left - bubbleSize.width - gap,
      top: targetRect.top + targetRect.height / 2 - bubbleSize.height / 2,
    },
  } satisfies Record<SpotlightPlacement, { left: number; top: number }>;

  const orderedPlacements: SpotlightPlacement[] = [
    placement,
    placement === 'left' || placement === 'right' ? 'bottom' : 'right',
    placement === 'top' || placement === 'bottom' ? 'left' : 'top',
    placement === 'top' ? 'bottom' : 'top',
  ];

  const chosen =
    orderedPlacements.find((option) => {
      const next = candidates[option];
      return (
        next.left >= gutter &&
        next.top >= gutter &&
        next.left + bubbleSize.width <= viewportWidth - gutter &&
        next.top + bubbleSize.height <= viewportHeight - gutter
      );
    }) ?? placement;

  return {
    left: clamp(candidates[chosen].left, gutter, viewportWidth - bubbleSize.width - gutter),
    top: clamp(candidates[chosen].top, gutter, viewportHeight - bubbleSize.height - gutter),
    placement: chosen,
  };
}

function getArrowPath(
  targetRect: TargetRect | null,
  bubblePosition: { left: number; top: number },
  bubbleSize: { width: number; height: number },
  placement: SpotlightPlacement
) {
  if (!targetRect) return '';

  const bubbleAnchor = {
    top: {
      x: bubblePosition.left + bubbleSize.width / 2,
      y: bubblePosition.top + bubbleSize.height,
    },
    right: {
      x: bubblePosition.left,
      y: bubblePosition.top + bubbleSize.height / 2,
    },
    bottom: {
      x: bubblePosition.left + bubbleSize.width / 2,
      y: bubblePosition.top,
    },
    left: {
      x: bubblePosition.left + bubbleSize.width,
      y: bubblePosition.top + bubbleSize.height / 2,
    },
  }[placement];

  const targetAnchor = {
    top: {
      x: targetRect.left + targetRect.width / 2,
      y: targetRect.top,
    },
    right: {
      x: targetRect.left + targetRect.width,
      y: targetRect.top + targetRect.height / 2,
    },
    bottom: {
      x: targetRect.left + targetRect.width / 2,
      y: targetRect.top + targetRect.height,
    },
    left: {
      x: targetRect.left,
      y: targetRect.top + targetRect.height / 2,
    },
  }[placement];

  const controlPoint = {
    x:
      (bubbleAnchor.x + targetAnchor.x) / 2 +
      (placement === 'left' ? -42 : placement === 'right' ? 42 : 0),
    y:
      (bubbleAnchor.y + targetAnchor.y) / 2 +
      (placement === 'top' ? -38 : placement === 'bottom' ? 38 : 0),
  };

  return `M ${bubbleAnchor.x} ${bubbleAnchor.y} Q ${controlPoint.x} ${controlPoint.y} ${targetAnchor.x} ${targetAnchor.y}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
