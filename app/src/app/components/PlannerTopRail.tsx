import { Minimize2, Minus, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from './ui/button';

interface PlannerTopRailProps {
  view: 'personal' | 'team';
  showTeamsNav?: boolean;
  dateLabel: string;
  timelineZoom: number;
  executionModeActive?: boolean;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onJumpToNow: () => void;
  showJumpToNowButton?: boolean;
  onOpenCompact: () => void;
  leftControls: ReactNode;
  rightControls?: ReactNode;
  zoomOutTestId?: string;
  zoomInTestId?: string;
  zoomValueTestId?: string;
  jumpToNowTestId?: string;
  canZoomOut?: boolean;
  canZoomIn?: boolean;
}

export default function PlannerTopRail({
  view,
  showTeamsNav = true,
  dateLabel,
  timelineZoom,
  executionModeActive = false,
  onZoomOut,
  onZoomIn,
  onJumpToNow,
  showJumpToNowButton = true,
  onOpenCompact,
  leftControls,
  rightControls,
  zoomOutTestId,
  zoomInTestId,
  zoomValueTestId,
  jumpToNowTestId,
  canZoomOut = true,
  canZoomIn = true,
}: PlannerTopRailProps) {
  return (
    <div className="mt-3 px-3 md:mt-5 md:px-5">
      <div className="planner-top-rail ui-hud-shell flex w-full max-w-[100vw] min-w-0 flex-nowrap items-center gap-2 overflow-x-clip ui-v1-radius-md p-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <Link
            to="/"
            className="planner-control inline-flex h-9 items-center rounded-md border border-[color:var(--hud-border)] bg-[var(--hud-surface-strong)] px-3 text-[12px] font-semibold tracking-[0.08em] uppercase text-[color:var(--hud-text)]"
          >
            Tareva
          </Link>
          <div className="flex min-w-0 items-center gap-2 overflow-hidden">{leftControls}</div>
        </div>

        <div className="flex flex-none shrink-0 items-center justify-center gap-2 px-1">
          <p className="hidden max-w-[220px] truncate text-[12px] font-semibold text-[color:var(--hud-muted)] lg:block">
            {dateLabel}
          </p>
          <div className="flex items-center gap-1 rounded-md border border-[color:var(--hud-border)] bg-[var(--hud-surface-strong)] px-1 py-1">
            <button
              type="button"
              aria-label="Zoom out timeline"
              data-testid={zoomOutTestId}
              onClick={onZoomOut}
              className="planner-control planner-control-icon ui-hud-btn h-7 w-7 ui-v1-radius-xs p-0"
              disabled={!canZoomOut}
            >
              <Minus className="mx-auto size-3.5" />
            </button>
            <span
              data-testid={zoomValueTestId}
              className="min-w-[44px] text-center text-[11px] font-semibold text-[color:var(--hud-text)]"
            >
              {timelineZoom}%
            </span>
            <button
              type="button"
              aria-label="Zoom in timeline"
              data-testid={zoomInTestId}
              onClick={onZoomIn}
              className="planner-control planner-control-icon ui-hud-btn h-7 w-7 ui-v1-radius-xs p-0"
              disabled={!canZoomIn}
            >
              <Plus className="mx-auto size-3.5" />
            </button>
          </div>
          {showJumpToNowButton && (
            <button
              type="button"
              data-testid={jumpToNowTestId}
              onClick={onJumpToNow}
              className="planner-control ui-hud-btn h-8 ui-v1-radius-sm px-2 text-[11px] font-semibold text-[color:var(--hud-muted)] lg:px-3"
            >
              <span className="hidden xl:inline">Jump to now</span>
              <span className="xl:hidden">Now</span>
            </button>
          )}
          {executionModeActive && (
            <span
              data-testid="execution-mode-indicator"
              className="hidden h-8 items-center rounded-full border border-[color:var(--hud-border)] bg-[var(--hud-surface-soft)] px-3 text-[10px] font-semibold tracking-[0.06em] uppercase text-[color:var(--hud-muted)] xl:inline-flex"
            >
              Execution Mode On
            </span>
          )}
        </div>

        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 overflow-hidden">
          <div
            data-testid="toprail-nav-personal"
            className="flex items-center rounded-md border border-[color:var(--hud-border)] bg-[var(--hud-surface-strong)] p-1"
          >
            <Link to="/planner">
              <Button
                data-testid="nav-personal"
                type="button"
                variant="ghost"
                className={`planner-control h-8 ui-v1-radius-xs px-2 text-[11px] md:px-3 ${
                  view === 'personal' ? 'ui-hud-btn-soft' : 'ui-hud-btn'
                }`}
              >
                <span className="hidden sm:inline">Personal</span>
                <span className="sm:hidden">P</span>
              </Button>
            </Link>
          </div>
          {showTeamsNav && (
            <div
              data-testid="toprail-nav-team"
              className="flex items-center rounded-md border border-[color:var(--hud-border)] bg-[var(--hud-surface-strong)] p-1"
            >
              <Link to="/team">
                <Button
                  data-testid="nav-team"
                  type="button"
                  variant="ghost"
                  className={`planner-control h-8 ui-v1-radius-xs px-2 text-[11px] md:px-3 ${
                    view === 'team' ? 'ui-hud-btn-soft' : 'ui-hud-btn'
                  }`}
                >
                  <span className="hidden sm:inline">Team</span>
                  <span className="sm:hidden">T</span>
                </Button>
              </Link>
            </div>
          )}
          <Button
            type="button"
            variant="ghost"
            data-testid="toprail-compact"
            onClick={onOpenCompact}
            className="planner-control h-8 gap-2 ui-v1-radius-sm border border-[color:var(--hud-border)] bg-[var(--hud-surface-strong)] px-2 text-[11px] font-semibold text-[color:var(--hud-text)] hover:brightness-105 md:px-3"
          >
            <Minimize2 className="size-3.5" />
            <span className="hidden 2xl:inline">Compact</span>
            <span className="2xl:hidden">C</span>
          </Button>
          <div className="flex min-w-0 items-center gap-2 overflow-hidden">{rightControls}</div>
        </div>
      </div>
    </div>
  );
}
