import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { ExternalLink } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { Button } from './ui/button';
import { Task, useTasks } from '../context/TaskContext';
import { useWorkday } from '../context/WorkdayContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import {
  getDayKey,
  getDayKeyFromDateTime,
  getTaskInterval,
  getWorkdayMinutes,
  minutesToTime,
} from '../services/scheduling';
import {
  desktopCloseCompact,
  desktopFocusMain,
  desktopOpenTask,
  isDesktopShell,
} from '../services/desktopShell';
import { buildTaskSearch } from '../services/taskDeepLink';

const DAY_LABEL_FORMATTER = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'short',
  day: 'numeric',
});

const NARROW_BREAKPOINT = 600;
const DAY_LABEL_WIDTH = 108;
const DEFAULT_PX_PER_MINUTE = 1.65;
const LANE_HEIGHT = 72;
const LANE_GAP = 8;

interface CompactDay {
  key: string;
  date: Date;
  isToday: boolean;
}

interface PositionedTask {
  task: Task;
  laneIndex: number;
}

export default function CompactView() {
  const location = useLocation();
  const navigate = useNavigate();
  const { workday } = useWorkday();
  const { preferences, setPreference } = useUserPreferences();
  const { tasks, nowTimestamp } = useTasks();

  const [viewportWidth, setViewportWidth] = useState(() => {
    if (typeof window === 'undefined') return 0;
    return window.innerWidth;
  });
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const centeredOnNowRef = useRef(false);
  const isDesktopCompact =
    isDesktopShell() && new URLSearchParams(location.search).get('desktopCompact') === '1';
  const laneHeight = LANE_HEIGHT;
  const laneGap = LANE_GAP;

  const isNarrow = viewportWidth > 0 && viewportWidth < NARROW_BREAKPOINT;
  const workdayMinutes = getWorkdayMinutes(workday);
  const workStartMinutes = workday.startHour * 60;
  const workEndMinutes = workStartMinutes + workdayMinutes;
  const pxPerMinute = DEFAULT_PX_PER_MINUTE;
  const timelineWidth = Math.max(420, Math.round(workdayMinutes * pxPerMinute));
  const hourMarkers = useMemo(() => {
    const markerCount = Math.floor(workdayMinutes / 60) + 1;
    return Array.from({ length: markerCount }, (_, index) => workStartMinutes + index * 60);
  }, [workStartMinutes, workdayMinutes]);

  const compactDaysShown = isDesktopCompact ? 2 : preferences.compactDaysShown;

  const days = useMemo<CompactDay[]>(() => {
    return Array.from({ length: compactDaysShown }, (_, index) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() + index);
      return {
        key: getDayKey(date),
        date,
        isToday: index === 0,
      };
    });
  }, [compactDaysShown]);

  const scheduledTasks = useMemo(
    () => tasks.filter((task) => task.startDateTime && task.status !== 'inbox'),
    [tasks]
  );

  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    scheduledTasks.forEach((task) => {
      if (!task.startDateTime) return;
      const dayKey = getDayKeyFromDateTime(task.startDateTime);
      if (!map.has(dayKey)) {
        map.set(dayKey, []);
      }
      map.get(dayKey)?.push(task);
    });
    return map;
  }, [scheduledTasks]);

  const dayLayouts = useMemo(() => {
    const map = new Map<string, { positioned: PositionedTask[]; laneCount: number }>();

    days.forEach((day) => {
      const dayTasks = tasksByDay.get(day.key) ?? [];
      const sorted = [...dayTasks].sort(
        (a, b) => getTaskInterval(a).startMinutes - getTaskInterval(b).startMinutes
      );
      const laneEnds: number[] = [];
      const positioned: PositionedTask[] = [];

      sorted.forEach((task) => {
        const interval = getTaskInterval(task);
        let laneIndex = laneEnds.findIndex((endMinutes) => interval.startMinutes >= endMinutes);
        if (laneIndex === -1) {
          laneIndex = laneEnds.length;
          laneEnds.push(interval.endMinutes);
        } else {
          laneEnds[laneIndex] = interval.endMinutes;
        }
        positioned.push({ task, laneIndex });
      });

      map.set(day.key, {
        positioned,
        laneCount: Math.max(1, laneEnds.length),
      });
    });

    return map;
  }, [days, tasksByDay]);

  const toPixelX = useCallback(
    (minutes: number) => Math.max(0, (minutes - workStartMinutes) * pxPerMinute),
    [pxPerMinute, workStartMinutes]
  );

  const handleTimeAxisWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.shiftKey || event.ctrlKey) return;

    const container = scrollRef.current;
    if (!container) return;

    const delta = Math.abs(event.deltaY) >= 0.1 ? event.deltaY : event.deltaX;
    if (Math.abs(delta) < 0.1) return;

    const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    if (maxLeft <= 0) return;

    const nextLeft = Math.min(maxLeft, Math.max(0, container.scrollLeft + delta));
    if (Math.abs(nextLeft - container.scrollLeft) < 0.5) return;

    container.scrollLeft = nextLeft;
    event.preventDefault();
  }, []);

  const openFullView = useCallback(
    (taskId?: string) => {
      if (isDesktopShell()) {
        void desktopCloseCompact();
        if (taskId) {
          void desktopOpenTask(taskId);
        } else {
          void desktopFocusMain();
        }
        return;
      }

      const search = buildTaskSearch(taskId);
      setPreference('compactEnabled', false);

      if (typeof window !== 'undefined' && window.opener && !window.opener.closed) {
        try {
          window.opener.location.assign(`${window.location.origin}/${search}`);
          window.opener.focus();
          window.close();
          return;
        } catch {
          // Fall back to in-window navigation.
        }
      }

      if (typeof window !== 'undefined') {
        window.location.assign(`${window.location.origin}/${search}`);
        return;
      }

      navigate({ pathname: '/', search });
    },
    [navigate, setPreference]
  );

  useEffect(() => {
    centeredOnNowRef.current = false;
    setPreference('compactEnabled', true);
  }, [setPreference]);

  useEffect(() => {
    const currentScroll = scrollRef.current;
    if (!currentScroll) return;
    currentScroll.scrollTop = 0;
    if (!isNarrow) {
      currentScroll.scrollLeft = 0;
    }
  }, [isNarrow]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const currentScroll = scrollRef.current;
    if (!currentScroll || !isNarrow || centeredOnNowRef.current) return;

    const now = new Date(nowTimestamp);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const nowX = toPixelX(Math.min(workEndMinutes, Math.max(workStartMinutes, nowMinutes)));
    currentScroll.scrollLeft = Math.max(
      0,
      nowX - currentScroll.clientWidth * 0.42 + DAY_LABEL_WIDTH
    );
    centeredOnNowRef.current = true;
  }, [isNarrow, nowTimestamp, toPixelX, workEndMinutes, workStartMinutes]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();

      const popoutMode = new URLSearchParams(location.search).get('popout') === '1';
      if (popoutMode && typeof window !== 'undefined' && window.opener && !window.opener.closed) {
        window.opener.focus();
        window.close();
        return;
      }

      openFullView();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [location.search, openFullView]);

  return (
    <div
      data-testid="compact-view"
      data-compact-spacing="token-v1"
      className="compact-token-layout relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--board-bg)]"
    >
      {isDesktopCompact && (
        <div className="desktop-drag-region absolute inset-x-0 top-0 z-30 h-6" />
      )}

      <div className="pointer-events-none absolute right-3 top-3 z-20">
        <div className="desktop-no-drag pointer-events-auto flex items-center gap-2 rounded-[12px] border border-[color:var(--hud-border)] bg-[var(--hud-surface)]/95 px-2 py-1.5 shadow-[0_12px_26px_rgba(0,0,0,0.35)] backdrop-blur-sm">
          <Button
            type="button"
            size="sm"
            className="desktop-no-drag h-8 rounded-[9px] border border-[color:var(--hud-border)] bg-[var(--hud-surface-strong)] px-3 text-[11px] font-semibold text-[color:var(--hud-text)] hover:brightness-105"
            onClick={() => openFullView()}
          >
            <ExternalLink className="mr-1.5 size-3.5" />
            Open Full
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="board-scroll min-h-0 flex-1 overflow-x-auto overflow-y-auto pt-11"
      >
        <div className="min-w-max pb-4">
          <div className="sticky top-0 z-10 flex h-[46px] border-b border-[color:var(--board-line)] bg-[var(--board-surface)]/92 backdrop-blur-sm">
            <div className="w-[108px] border-r border-[color:var(--board-line)]" />
            <div
              className="relative"
              style={{ width: `${timelineWidth}px` }}
              data-time-axis="1"
              onWheel={handleTimeAxisWheel}
            >
              {hourMarkers.map((markerMinutes, index) => {
                const left = toPixelX(markerMinutes);
                const showLabel = !isNarrow || index % 2 === 0 || index === hourMarkers.length - 1;
                return (
                  <div
                    key={`compact-hour-${markerMinutes}`}
                    className="absolute inset-y-0"
                    style={{ left }}
                  >
                    <div className="h-full w-px bg-[color:var(--board-line)]" />
                    {showLabel && (
                      <span className="absolute left-1 top-2 text-[11px] font-semibold text-[var(--board-muted)]">
                        {minutesToTime(markerMinutes)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {days.map((day) => {
            const layout = dayLayouts.get(day.key) ?? { positioned: [], laneCount: 1 };
            const rowHeight = Math.max(88, 14 + layout.laneCount * (laneHeight + laneGap));
            const isTodayVisible = day.isToday;
            const now = new Date(nowTimestamp);
            const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
            const showNowLine =
              isTodayVisible && nowMinutes >= workStartMinutes && nowMinutes <= workEndMinutes;
            const nowX = showNowLine ? toPixelX(nowMinutes) : null;

            return (
              <div
                key={day.key}
                data-testid={`compact-day-${day.key}`}
                className="relative flex border-b border-[color:var(--board-line)]"
                style={{ minHeight: `${rowHeight}px` }}
              >
                <div
                  className={`compact-token-day-label w-[108px] shrink-0 border-r border-[color:var(--board-line)] px-3 py-3 ${
                    day.isToday ? 'bg-[var(--hud-surface-soft)]' : ''
                  }`}
                >
                  <p className="compact-token-day-title text-[21px] leading-[1.02] font-bold tracking-[-0.03em] text-[var(--board-text)]">
                    {getDayTitle(day.date)}
                  </p>
                  <p className="compact-token-day-subtitle mt-2 text-[11px] leading-none font-semibold uppercase tracking-[0.06em] text-[var(--board-muted)]">
                    {DAY_LABEL_FORMATTER.format(day.date)}
                  </p>
                </div>

                <div
                  className="relative"
                  style={{ width: `${timelineWidth}px`, minHeight: `${rowHeight}px` }}
                >
                  {hourMarkers.map((markerMinutes) => (
                    <div
                      key={`compact-grid-${day.key}-${markerMinutes}`}
                      className="absolute inset-y-0 w-px bg-[color:var(--board-line)]"
                      style={{ left: `${toPixelX(markerMinutes)}px` }}
                    />
                  ))}

                  {showNowLine && nowX !== null && (
                    <div
                      className="pointer-events-none absolute inset-y-0 z-[5]"
                      style={{ left: `${nowX}px` }}
                    >
                      <div
                        className="absolute inset-y-0 w-[2px] -translate-x-1/2"
                        style={{ background: 'var(--timeline-now)' }}
                      />
                    </div>
                  )}

                  {layout.positioned.map(({ task, laneIndex }) => {
                    const interval = getTaskInterval(task);
                    const left = toPixelX(interval.startMinutes);
                    const width = Math.max(
                      84,
                      (interval.endMinutes - interval.startMinutes) * pxPerMinute - 8
                    );
                    const top = 8 + laneIndex * (laneHeight + laneGap);
                    return (
                      <CompactTaskBlock
                        key={task.id}
                        task={task}
                        top={top}
                        left={left}
                        width={width}
                        laneHeight={laneHeight}
                        onOpenFull={openFullView}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CompactTaskBlock({
  task,
  top,
  left,
  width,
  laneHeight = LANE_HEIGHT,
  onOpenFull,
}: {
  task: Task;
  top: number;
  left: number;
  width: number;
  laneHeight?: number;
  onOpenFull: (taskId: string) => void;
}) {
  const { surface, title, body } = getCompactTone(task.color, task.id);
  const timeLabel = task.startDateTime
    ? `${formatTime(new Date(task.startDateTime))}-${formatTime(
        new Date(new Date(task.startDateTime).getTime() + task.durationMinutes * 60_000)
      )}`
    : 'Unscheduled';

  return (
    <div
      data-testid={`compact-task-card-${task.id}`}
      data-task-id={task.id}
      data-task-title={task.title}
      className="compact-token-task-card group absolute rounded-[11px] border border-[color:var(--board-line)] px-2.5 py-2 shadow-[0_10px_22px_rgba(0,0,0,0.3)]"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        minHeight: `${laneHeight}px`,
        backgroundColor: surface,
        textRendering: 'geometricPrecision',
      }}
      onClick={() => onOpenFull(task.id)}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className="line-clamp-2 text-[13px] font-bold leading-[1.08] tracking-[-0.02em]"
          style={{ color: title }}
        >
          {task.title}
        </p>
      </div>

      <p className="mt-1 truncate text-[11px] font-semibold" style={{ color: body }}>
        {timeLabel}
      </p>
    </div>
  );
}

function getDayTitle(date: Date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const compare = new Date(date);
  compare.setHours(0, 0, 0, 0);

  if (compare.getTime() === today.getTime()) return 'Today';
  if (compare.getTime() === tomorrow.getTime()) return 'Tomorrow';
  return compare.toLocaleDateString('en-US', { weekday: 'long' });
}

function formatTime(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function getCompactTone(color: string, taskId: string) {
  const fallback = hashString(taskId) % 2 === 0 ? '#6f7583' : '#c2c8d4';
  const normalized = normalizeHex(color) ?? fallback;
  const luminance = getLuminance(normalized);
  const isLight = luminance >= 0.56;

  return {
    surface: normalized,
    title: isLight ? '#1f2024' : '#f7f8fa',
    body: isLight ? 'rgba(31,32,36,0.84)' : 'rgba(247,248,250,0.88)',
  };
}

function normalizeHex(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  return null;
}

function getLuminance(hex: string): number {
  const rgb = toRgb(hex);
  if (!rgb) return 0.5;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function toRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}
