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
    <div className="mt-3 px-4 md:mt-5 md:px-6">
      <div className="planner-top-rail ui-hud-shell flex w-full max-w-[100vw] min-w-0 flex-nowrap items-center gap-3 overflow-x-clip ui-v1-radius-lg px-3 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
          <Link
            to="/welcome"
            className="planner-control inline-flex h-10 items-center rounded-xl border border-[color:var(--hud-border)] bg-[color:color-mix(in_srgb,var(--hud-surface-strong)_82%,transparent)] px-4 text-[11px] font-semibold tracking-[0.12em] uppercase text-[color:var(--hud-text)] shadow-none"
          >
            Tareva
          </Link>
          <div className="flex min-w-0 items-center gap-2.5 overflow-hidden">{leftControls}</div>
        </div>

        <div className="flex flex-none shrink-0 items-center justify-center gap-2.5 px-1">
          <p className="hidden max-w-[240px] truncate rounded-full border border-[color:color-mix(in_srgb,var(--hud-border)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--hud-surface-soft)_72%,transparent)] px-3 py-1.5 text-[12px] font-semibold tracking-[-0.01em] text-[color:var(--hud-muted)] lg:block">
            {dateLabel}
          </p>
          <div className="flex items-center gap-1 rounded-xl border border-[color:var(--hud-border)] bg-[color:color-mix(in_srgb,var(--hud-surface-strong)_82%,transparent)] px-1.5 py-1.5 shadow-none">
            <button
              type="button"
              aria-label="Zoom out timeline"
              data-testid={zoomOutTestId}
              onClick={onZoomOut}
              className="planner-control planner-control-icon ui-hud-btn h-8 w-8 ui-v1-radius-sm p-0"
              disabled={!canZoomOut}
            >
              <Minus className="mx-auto size-4" />
            </button>
            <span
              data-testid={zoomValueTestId}
              className="min-w-[48px] text-center text-[11px] font-semibold tracking-[-0.01em] text-[color:var(--hud-text)]"
            >
              {timelineZoom}%
            </span>
            <button
              type="button"
              aria-label="Zoom in timeline"
              data-testid={zoomInTestId}
              onClick={onZoomIn}
              className="planner-control planner-control-icon ui-hud-btn h-8 w-8 ui-v1-radius-sm p-0"
              disabled={!canZoomIn}
            >
              <Plus className="mx-auto size-4" />
            </button>
          </div>
          {showJumpToNowButton && (
            <button
              type="button"
              data-testid={jumpToNowTestId}
              onClick={onJumpToNow}
              className="planner-control ui-hud-btn h-9 ui-v1-radius-md px-3 text-[11px] font-semibold text-[color:var(--hud-muted)]"
            >
              <span className="hidden xl:inline">Jump to now</span>
              <span className="xl:hidden">Now</span>
            </button>
          )}
          {executionModeActive && (
            <span
              data-testid="execution-mode-indicator"
              className="hidden h-9 items-center rounded-full border border-[color:var(--hud-border)] bg-[color:color-mix(in_srgb,var(--hud-surface-soft)_78%,transparent)] px-3.5 text-[10px] font-semibold tracking-[0.06em] uppercase text-[color:var(--hud-muted)] xl:inline-flex"
            >
              Execution Mode On
            </span>
          )}
        </div>

        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2.5 overflow-hidden">
          <div
            data-testid="toprail-nav-personal"
            className="flex items-center rounded-xl border border-[color:var(--hud-border)] bg-[color:color-mix(in_srgb,var(--hud-surface-strong)_82%,transparent)] p-1 shadow-none"
          >
            <Link to="/planner">
              <Button
                data-testid="nav-personal"
                type="button"
                variant="ghost"
                className={`planner-control h-9 ui-v1-radius-sm px-3 text-[11px] ${
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
              className="flex items-center rounded-xl border border-[color:var(--hud-border)] bg-[color:color-mix(in_srgb,var(--hud-surface-strong)_82%,transparent)] p-1 shadow-none"
            >
              <Link to="/team">
                <Button
                  data-testid="nav-team"
                  type="button"
                  variant="ghost"
                  className={`planner-control h-9 ui-v1-radius-sm px-3 text-[11px] ${
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
            className="planner-control h-9 gap-2 ui-v1-radius-md border border-[color:var(--hud-border)] bg-[color:color-mix(in_srgb,var(--hud-surface-strong)_82%,transparent)] px-3 text-[11px] font-semibold text-[color:var(--hud-text)]"
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
