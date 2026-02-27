import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  ChartColumnIncreasing,
  Inbox,
  Minus,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { useTasks, Task } from '../context/TaskContext';
import AddTaskDialog from './AddTaskDialog';
import InboxPanel from './InboxPanel';
import CapacityBar from './CapacityBar';
import TodayNotePanel from './TodayNotePanel';
import DayColumn from './DayColumn';
import UndoRedoControls from './UndoRedoControls';
import DailyPlanningPanel from './DailyPlanningPanel';
import TaskQuickActionsHub from './TaskQuickActionsHub';
import BlockTaskButton from './BlockTaskButton';
import ConflictResolutionBanner from './ConflictResolutionBanner';
import { SettingsDrawerInner } from './settings/SettingsDrawer';
import RealtimePresenceBadge from './RealtimePresenceBadge';
import { useCloudSync } from '../context/CloudSyncContext';
import { useWorkday } from '../context/WorkdayContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import {
  getDayKey,
  getDayKeyFromDateTime,
  getWorkdayTimeSlots,
  minutesToTime,
} from '../services/scheduling';
import { parseTaskIdFromSearch, removeTaskIdFromSearch } from '../services/taskDeepLink';
import {
  centerScrollLeft,
  getMinutesSinceMidnightInTimeZone,
  getNowAxisOffsetPx,
} from '../services/timeAxisNow';
import { getNextTimelineZoom } from '../services/timelineZoom';
import PlannerTopRail from './PlannerTopRail';
import { resolveExecutionModeV1Flag, resolveLayoutV1Flag } from '../flags';
import { desktopToggleCompact, isDesktopShell } from '../services/desktopShell';

const PERSONAL_NOW_SNAP_SESSION_KEY = 'taskable:now-snap:personal';

export default function PersonalView() {
  const location = useLocation();
  const navigate = useNavigate();
  const { tasks } = useTasks();
  const { enabled: cloudEnabled, token: cloudToken, activeOrgId, user: cloudUser } = useCloudSync();
  const { workday } = useWorkday();
  const { preferences, setPreference } = useUserPreferences();
  const {
    slotMinutes,
    recallDays,
    hideUnassignedInPersonal,
    timelineZoom,
    sidebarCollapsed,
    sidebarCollapsePreferenceSet,
    executionModeEnabled,
  } = preferences;
  const layoutV1Enabled = resolveLayoutV1Flag();
  const executionModeV1Enabled = resolveExecutionModeV1Flag();
  const executionModeActive = executionModeV1Enabled && executionModeEnabled;
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [activeHubTaskId, setActiveHubTaskId] = useState<string | null>(null);
  const [sidebarPanel, setSidebarPanel] = useState<'inbox' | 'capacity' | 'notes' | null>(null);
  const [showBackToToday, setShowBackToToday] = useState(false);
  const [showJumpToNow, setShowJumpToNow] = useState(false);
  const boardScrollRef = useRef<HTMLDivElement | null>(null);
  const stickyHeaderRef = useRef<HTMLDivElement | null>(null);
  const todayRowRef = useRef<HTMLDivElement | null>(null);
  const hasInitialScrollRef = useRef(false);
  const hasUserScrolledRef = useRef(false);
  const hasAutoNowSnapRef = useRef(false);
  const currentUserId =
    cloudEnabled && cloudToken && activeOrgId && cloudUser ? cloudUser.id : 'user1';
  const zoomFactor = timelineZoom / 100;
  const hourWidth = Math.round(216 * zoomFactor);
  const hourGap = Math.max(12, Math.round(18 * zoomFactor));
  const slotWidth = (hourWidth * slotMinutes) / 60;
  const slotsPerHour = 60 / slotMinutes;
  const futureDays = 14;
  const dateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      }).format(new Date()),
    []
  );

  const days = useMemo(() => {
    const result = [];
    const endOffset = futureDays - 1;
    for (let offset = -recallDays; offset <= endOffset; offset += 1) {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      date.setHours(0, 0, 0, 0);
      const dayKey = getDayKey(date);
      result.push({
        date: dayKey,
        label: getDayLabel(date),
        isToday: offset === 0,
      });
    }
    return result;
  }, [futureDays, recallDays]);
  const hasTodayInRange = useMemo(() => days.some((day) => day.isToday), [days]);
  const activeTimeZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
    } catch {
      return 'UTC';
    }
  }, []);

  const getTodayTargetTop = useCallback(() => {
    const container = boardScrollRef.current;
    const stickyHeight = stickyHeaderRef.current?.offsetHeight ?? 46;
    if (!container) return null;
    const target =
      todayRowRef.current ?? container.querySelector<HTMLElement>('[data-day-kind="today"]');
    if (!target) return null;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const nextTop = container.scrollTop + (targetRect.top - containerRect.top) - stickyHeight;
    return Math.min(maxTop, Math.max(0, nextTop));
  }, []);

  const getNowTargetLeft = useCallback(() => {
    const container = boardScrollRef.current;
    if (!container || !hasTodayInRange) return null;

    const nowMinutes = getMinutesSinceMidnightInTimeZone(new Date(), activeTimeZone);
    const nowX = getNowAxisOffsetPx({
      nowMinutes,
      workday,
      hourWidth,
      hourGap,
    });
    const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    return Math.min(maxLeft, Math.max(0, nowX - container.clientWidth / 2));
  }, [activeTimeZone, hasTodayInRange, hourGap, hourWidth, workday]);

  const scrollToToday = useCallback(
    (behavior: ScrollBehavior): boolean => {
      const container = boardScrollRef.current;
      const targetTop = getTodayTargetTop();
      if (!container || targetTop === null) return false;
      if (behavior === 'auto') {
        container.scrollTop = targetTop;
      } else {
        container.scrollTo({ top: targetTop, behavior: 'smooth' });
      }
      if (behavior === 'smooth') {
        window.setTimeout(() => {
          const finalTop = getTodayTargetTop();
          if (finalTop === null || !boardScrollRef.current) return;
          boardScrollRef.current.scrollTop = finalTop;
        }, 430);
      }
      return true;
    },
    [getTodayTargetTop]
  );

  useEffect(() => {
    if (hasInitialScrollRef.current) return;
    if (!boardScrollRef.current) return;

    let attempts = 0;
    let retryTimer: number | null = null;
    const tryAlign = () => {
      attempts += 1;
      const aligned = scrollToToday('auto');
      if (aligned || attempts >= 24) {
        hasInitialScrollRef.current = true;
        if (retryTimer !== null) {
          window.clearInterval(retryTimer);
        }
      }
    };

    tryAlign();
    retryTimer = window.setInterval(tryAlign, 80);
    return () => {
      if (retryTimer !== null) {
        window.clearInterval(retryTimer);
      }
    };
  }, [days, scrollToToday]);

  useEffect(() => {
    const container = boardScrollRef.current;
    if (!container) return;

    const evaluate = () => {
      const targetTop = getTodayTargetTop();
      if (targetTop === null) {
        setShowBackToToday(false);
      } else {
        setShowBackToToday(Math.abs(container.scrollTop - targetTop) > 90);
      }

      const nowTargetLeft = getNowTargetLeft();
      if (nowTargetLeft === null) {
        setShowJumpToNow(false);
      } else {
        setShowJumpToNow(Math.abs(container.scrollLeft - nowTargetLeft) > 64);
      }
    };

    evaluate();
    container.addEventListener('scroll', evaluate, { passive: true });
    window.addEventListener('resize', evaluate);
    const nowDriftTimer = window.setInterval(evaluate, 30_000);
    return () => {
      container.removeEventListener('scroll', evaluate);
      window.removeEventListener('resize', evaluate);
      window.clearInterval(nowDriftTimer);
    };
  }, [days, getNowTargetLeft, getTodayTargetTop]);

  useEffect(() => {
    const container = boardScrollRef.current;
    if (!container) return;

    const markUserScrolled = () => {
      hasUserScrolledRef.current = true;
    };

    container.addEventListener('wheel', markUserScrolled, { passive: true });
    container.addEventListener('pointerdown', markUserScrolled);
    container.addEventListener('touchstart', markUserScrolled, { passive: true });

    return () => {
      container.removeEventListener('wheel', markUserScrolled);
      container.removeEventListener('pointerdown', markUserScrolled);
      container.removeEventListener('touchstart', markUserScrolled);
    };
  }, []);

  const adjustTimelineZoom = useCallback(
    (direction: 'in' | 'out') => {
      setPreference('timelineZoom', getNextTimelineZoom(timelineZoom, direction));
    },
    [setPreference, timelineZoom]
  );

  const openCompact = useCallback(() => {
    if (isDesktopShell()) {
      void desktopToggleCompact();
      return;
    }
    setPreference('compactEnabled', true);
    navigate('/compact');
  }, [navigate, setPreference]);

  useEffect(() => {
    if (!layoutV1Enabled || sidebarCollapsePreferenceSet) return;
    if (typeof window === 'undefined') return;

    const shouldCollapse = window.innerWidth < 1100;
    setPreference('sidebarCollapsed', shouldCollapse);
    setPreference('sidebarCollapsePreferenceSet', true);
  }, [layoutV1Enabled, setPreference, sidebarCollapsePreferenceSet]);

  const toggleSidebarCollapse = useCallback(() => {
    const nextValue = !sidebarCollapsed;
    setPreference('sidebarCollapsed', nextValue);
    setPreference('sidebarCollapsePreferenceSet', true);
    if (nextValue) {
      setSidebarPanel(null);
    }
  }, [setPreference, sidebarCollapsed]);

  useEffect(() => {
    if (!sidebarCollapsed && sidebarPanel) {
      setSidebarPanel(null);
    }
  }, [sidebarCollapsed, sidebarPanel]);

  const handleTimeAxisWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (event.ctrlKey || event.metaKey) {
        const direction = event.deltaY < 0 ? 'in' : 'out';
        adjustTimelineZoom(direction);
        event.preventDefault();
        return;
      }
      if (!event.shiftKey) return;
      const container = boardScrollRef.current;
      if (!container) return;

      const delta = Math.abs(event.deltaY) >= 0.1 ? event.deltaY : event.deltaX;
      if (Math.abs(delta) < 0.1) return;

      const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
      if (maxLeft <= 0) return;

      const nextLeft = Math.min(maxLeft, Math.max(0, container.scrollLeft + delta));
      if (Math.abs(nextLeft - container.scrollLeft) < 0.5) return;

      container.scrollLeft = nextLeft;
      event.preventDefault();
    },
    [adjustTimelineZoom]
  );

  const timeSlots = useMemo(
    () => getWorkdayTimeSlots(slotMinutes, workday),
    [slotMinutes, workday]
  );
  const timeColumns = useMemo(() => {
    const columns: Array<{ key: string; time?: string; isHourStart?: boolean; isGap?: boolean }> =
      [];
    timeSlots.forEach((time, index) => {
      const isHourStart = index % slotsPerHour === 0;
      const isHourEnd = (index + 1) % slotsPerHour === 0;
      const isLastSlot = index === timeSlots.length - 1;
      columns.push({ key: `slot-${time}`, time, isHourStart });
      if (isHourEnd && !isLastSlot) {
        columns.push({ key: `gap-${time}`, isGap: true });
      }
    });
    return columns;
  }, [timeSlots, slotsPerHour]);
  const hourCount = Math.ceil(timeSlots.length / slotsPerHour);
  const gridWidth = timeSlots.length * slotWidth + Math.max(0, hourCount - 1) * hourGap;
  const gridTemplateColumns = useMemo(
    () => timeColumns.map((col) => (col.isGap ? `${hourGap}px` : `${slotWidth}px`)).join(' '),
    [timeColumns, hourGap, slotWidth]
  );
  const endLabel = minutesToTime(workday.endHour * 60);
  const startLabel = minutesToTime(workday.startHour * 60);
  const scrollToNow = useCallback(
    (behavior: ScrollBehavior = 'smooth'): boolean => {
      const container = boardScrollRef.current;
      if (!container) return false;

      const nowMinutes = getMinutesSinceMidnightInTimeZone(new Date(), activeTimeZone);
      const nowX = getNowAxisOffsetPx({
        nowMinutes,
        workday,
        hourWidth,
        hourGap,
      });
      centerScrollLeft({
        container,
        targetX: nowX,
        behavior,
      });
      return true;
    },
    [activeTimeZone, hourGap, hourWidth, workday]
  );

  useEffect(() => {
    if (!hasTodayInRange) return;
    if (hasAutoNowSnapRef.current) return;
    if (hasUserScrolledRef.current) return;

    try {
      if (window.sessionStorage.getItem(PERSONAL_NOW_SNAP_SESSION_KEY) === '1') {
        hasAutoNowSnapRef.current = true;
        return;
      }
    } catch {
      // ignore session storage errors
    }

    let attempts = 0;
    let retryTimer: number | null = null;
    const trySnap = () => {
      if (hasUserScrolledRef.current) {
        if (retryTimer !== null) {
          window.clearInterval(retryTimer);
        }
        return;
      }

      attempts += 1;
      const snapped = scrollToNow('auto');
      if (snapped || attempts >= 20) {
        hasAutoNowSnapRef.current = true;
        try {
          window.sessionStorage.setItem(PERSONAL_NOW_SNAP_SESSION_KEY, '1');
        } catch {
          // ignore session storage errors
        }
        if (retryTimer !== null) {
          window.clearInterval(retryTimer);
        }
      }
    };

    trySnap();
    retryTimer = window.setInterval(trySnap, 90);
    return () => {
      if (retryTimer !== null) {
        window.clearInterval(retryTimer);
      }
    };
  }, [hasTodayInRange, scrollToNow]);

  const visibleTasks = useMemo(
    () =>
      tasks.filter((task) => {
        if (!task.assignedTo) return !hideUnassignedInPersonal;
        return task.assignedTo === currentUserId;
      }),
    [tasks, currentUserId, hideUnassignedInPersonal]
  );
  const scheduleScopeTasks = visibleTasks;
  const activeHubTask = useMemo(
    () => (activeHubTaskId ? (tasks.find((task) => task.id === activeHubTaskId) ?? null) : null),
    [activeHubTaskId, tasks]
  );
  const deepLinkTaskId = useMemo(() => parseTaskIdFromSearch(location.search), [location.search]);

  useEffect(() => {
    if (activeHubTaskId && !activeHubTask) {
      setActiveHubTaskId(null);
    }
  }, [activeHubTask, activeHubTaskId]);

  useEffect(() => {
    if (!deepLinkTaskId) return;
    const targetTask = tasks.find((task) => task.id === deepLinkTaskId);
    if (!targetTask) return;

    setEditingTask(targetTask);
    setActiveHubTaskId(null);

    const nextSearch = removeTaskIdFromSearch(location.search);
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch,
      },
      { replace: true }
    );
  }, [deepLinkTaskId, location.pathname, location.search, navigate, tasks]);

  const inboxTasks = useMemo(
    () => visibleTasks.filter((task) => !task.startDateTime || task.status === 'inbox'),
    [visibleTasks]
  );

  const scheduledTasks = useMemo(
    () => visibleTasks.filter((task) => task.startDateTime && task.status !== 'inbox'),
    [visibleTasks]
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

  return (
    <div
      className={`planner-density-scope relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[var(--board-bg)] ${
        layoutV1Enabled ? '' : 'ui-v1-pt-header-offset md:pt-[98px]'
      }`}
    >
      {layoutV1Enabled ? (
        <PlannerTopRail
          view="personal"
          dateLabel={dateLabel}
          timelineZoom={timelineZoom}
          executionModeActive={executionModeActive}
          onZoomOut={() => adjustTimelineZoom('out')}
          onZoomIn={() => adjustTimelineZoom('in')}
          onJumpToNow={() => scrollToNow('smooth')}
          showJumpToNowButton={false}
          onOpenCompact={openCompact}
          leftControls={
            <>
              <UndoRedoControls />
              <AddTaskDialog defaultAssignee={currentUserId} scheduleTasks={scheduleScopeTasks} />
              <BlockTaskButton defaultAssignee={currentUserId} scheduleTasks={scheduleScopeTasks} />
            </>
          }
          rightControls={
            <>
              <RealtimePresenceBadge compact />
              <SettingsDrawerInner compact triggerTestId="toprail-settings" />
            </>
          }
          zoomOutTestId="timeline-zoom-out-personal"
          zoomInTestId="timeline-zoom-in-personal"
          zoomValueTestId="timeline-zoom-value-personal"
          jumpToNowTestId="jump-to-now-personal"
          canZoomOut={timelineZoom > 50}
          canZoomIn={timelineZoom < 150}
        />
      ) : (
        <div className="pointer-events-none absolute left-3 top-3 z-20 md:left-5 md:top-5">
          <div className="pointer-events-auto flex items-center gap-2 ui-v1-radius-md border border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-2 py-1.5 backdrop-blur-sm">
            <UndoRedoControls />
            <AddTaskDialog defaultAssignee={currentUserId} scheduleTasks={scheduleScopeTasks} />
            <BlockTaskButton defaultAssignee={currentUserId} scheduleTasks={scheduleScopeTasks} />
            <div className="flex items-center gap-1 ui-v1-radius-sm border border-[color:var(--hud-border)] bg-[var(--hud-surface-strong)] px-1 py-1">
              <button
                type="button"
                aria-label="Zoom out timeline"
                data-testid="timeline-zoom-out-personal"
                onClick={() => adjustTimelineZoom('out')}
                className="ui-hud-btn h-7 w-7 ui-v1-radius-xs p-0"
                disabled={timelineZoom <= 50}
              >
                <Minus className="mx-auto size-3.5" />
              </button>
              <span
                data-testid="timeline-zoom-value-personal"
                className="min-w-[44px] text-center text-[11px] font-semibold text-[color:var(--hud-text)]"
              >
                {timelineZoom}%
              </span>
              <button
                type="button"
                aria-label="Zoom in timeline"
                data-testid="timeline-zoom-in-personal"
                onClick={() => adjustTimelineZoom('in')}
                className="ui-hud-btn h-7 w-7 ui-v1-radius-xs p-0"
                disabled={timelineZoom >= 150}
              >
                <Plus className="mx-auto size-3.5" />
              </button>
            </div>
            <RealtimePresenceBadge compact />
            <SettingsDrawerInner />
          </div>
        </div>
      )}

      <DailyPlanningPanel
        tasks={visibleTasks}
        scheduleTasks={scheduleScopeTasks}
      />
      <ConflictResolutionBanner />

      <div className="flex min-h-0 flex-1 flex-col">
        <div
          className={`min-h-0 min-w-0 flex-1 ${
            layoutV1Enabled ? 'flex gap-3 px-3 pb-3 md:gap-4 md:px-5 md:pb-5' : 'flex flex-col'
          }`}
        >
          {layoutV1Enabled ? (
            <aside
              data-collapsed={sidebarCollapsed ? 'true' : 'false'}
              className={`relative flex min-h-0 shrink-0 flex-col gap-3 transition-[width] duration-200 ${
                sidebarCollapsed ? 'planner-sidebar w-[72px]' : 'planner-sidebar w-[300px]'
              }`}
            >
              <div className="ui-hud-panel flex items-center justify-between ui-v1-radius-md px-2 py-2">
                {!sidebarCollapsed ? (
                  <p className="pl-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
                    Sidebar
                  </p>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  data-testid="sidebar-collapse-toggle-personal"
                  onClick={toggleSidebarCollapse}
                  className="ui-hud-btn h-8 w-8 ui-v1-radius-sm p-0"
                  title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                >
                  {sidebarCollapsed ? (
                    <PanelLeftOpen className="mx-auto size-4" />
                  ) : (
                    <PanelLeftClose className="mx-auto size-4" />
                  )}
                </button>
              </div>

              {sidebarCollapsed ? (
                <div className="ui-hud-panel flex items-center justify-center ui-v1-radius-md px-1 py-2">
                  <div className="flex flex-col items-center gap-2">
                    <button
                      type="button"
                      data-testid="sidebar-icon-inbox-personal"
                      onClick={() => setSidebarPanel('inbox')}
                      className={`ui-hud-btn h-9 w-9 ui-v1-radius-sm p-0 ${
                        sidebarPanel === 'inbox' ? 'ui-hud-btn-soft' : ''
                      }`}
                      title="Inbox"
                      aria-label="Inbox"
                    >
                      <Inbox className="mx-auto size-4" />
                    </button>
                    <button
                      type="button"
                      data-testid="sidebar-icon-capacity-personal"
                      onClick={() => setSidebarPanel('capacity')}
                      className={`ui-hud-btn h-9 w-9 ui-v1-radius-sm p-0 ${
                        sidebarPanel === 'capacity' ? 'ui-hud-btn-soft' : ''
                      }`}
                      title="Capacity"
                      aria-label="Capacity"
                    >
                      <ChartColumnIncreasing className="mx-auto size-4" />
                    </button>
                    <button
                      type="button"
                      data-testid="sidebar-icon-notes-personal"
                      onClick={() => setSidebarPanel('notes')}
                      className={`ui-hud-btn h-9 w-9 ui-v1-radius-sm p-0 ${
                        sidebarPanel === 'notes' ? 'ui-hud-btn-soft' : ''
                      }`}
                      title="Today's notes"
                      aria-label="Today's notes"
                    >
                      <NotebookPen className="mx-auto size-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <InboxPanel
                    title="Inbox"
                    tasks={inboxTasks}
                    onEdit={setEditingTask}
                    variant="sidebar"
                  />
                  <CapacityBar tasks={visibleTasks} />
                  <TodayNotePanel />
                </>
              )}

              {sidebarCollapsed && sidebarPanel && (
                <div
                  data-testid="layoutv1-sidebar-panel"
                  className="planner-sidebar-panel absolute left-full top-0 z-20 ml-2 flex h-full w-[300px] min-h-0 flex-col gap-3"
                >
                  <div className="ui-hud-panel flex items-center justify-between ui-v1-radius-md px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--hud-muted)]">
                      {sidebarPanel === 'inbox'
                        ? 'Inbox'
                        : sidebarPanel === 'capacity'
                          ? 'Capacity'
                          : "Today's notes"}
                    </p>
                    <button
                      type="button"
                      onClick={() => setSidebarPanel(null)}
                      className="ui-hud-btn h-8 w-8 ui-v1-radius-sm p-0"
                      aria-label="Close sidebar panel"
                    >
                      <PanelLeftClose className="mx-auto size-4" />
                    </button>
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col gap-3">
                    {sidebarPanel === 'inbox' && (
                      <InboxPanel
                        title="Inbox"
                        tasks={inboxTasks}
                        onEdit={setEditingTask}
                        variant="sidebar"
                      />
                    )}
                    {sidebarPanel === 'capacity' && <CapacityBar tasks={visibleTasks} />}
                    {sidebarPanel === 'notes' && <TodayNotePanel />}
                  </div>
                </div>
              )}
            </aside>
          ) : inboxTasks.length > 0 ? (
            <div className="px-3 md:px-5">
              <InboxPanel title="Inbox" tasks={inboxTasks} onEdit={setEditingTask} />
            </div>
          ) : null}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              ref={boardScrollRef}
              className="board-scroll h-0 min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto"
            >
              <div className="min-w-max pb-24">
                <div
                  ref={stickyHeaderRef}
                  className="sticky top-0 z-10 flex border-b border-[color:var(--board-line)] bg-[var(--board-surface)]/92 backdrop-blur-sm"
                >
                  <div className="sticky left-0 z-[20] w-[140px] flex-shrink-0 border-r border-[color:var(--board-line)] bg-[var(--board-surface)] md:w-[196px]" />
                  <div
                    className="relative"
                    style={{ width: `${gridWidth}px` }}
                    data-time-axis="1"
                    onWheel={handleTimeAxisWheel}
                  >
                    <div className="grid h-[46px] items-center" style={{ gridTemplateColumns }}>
                      {timeColumns.map((col) => {
                        if (col.isGap) {
                          return <div key={col.key} className="h-full bg-transparent" />;
                        }

                        return (
                          <div key={col.key} className="flex h-full items-center">
                            {col.isHourStart && (
                              <span
                                className="planner-hour-label pl-2 text-[11px] font-semibold md:text-xs"
                                style={{
                                  color:
                                    col.time === startLabel
                                      ? 'var(--hour-start-highlight)'
                                      : 'var(--board-muted)',
                                }}
                              >
                                {col.time}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="pointer-events-none absolute right-2 top-0 flex h-[46px] items-center">
                      <span
                        className="planner-hour-end-label text-[10px] font-semibold md:text-[11px]"
                        style={{ color: 'var(--hour-end-highlight)' }}
                      >
                        {endLabel}
                      </span>
                    </div>
                    <div className="pointer-events-none absolute right-14 top-0 flex h-[46px] items-center">
                      <button
                        type="button"
                        data-testid="time-axis-now-pill-personal"
                        onClick={() => scrollToNow('smooth')}
                        className="planner-now-pill pointer-events-auto rounded-full border border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-2.5 py-1 text-[10px] font-semibold text-[color:var(--hud-text)] md:text-[11px]"
                      >
                        Now
                      </button>
                    </div>
                  </div>
                </div>

                {days.map((day) => (
                  <div
                    key={day.date}
                    ref={day.isToday ? todayRowRef : undefined}
                    data-day-row={day.date}
                    data-day-kind={day.isToday ? 'today' : 'other'}
                    className="planner-day-row flex min-h-[134px] border-b border-[color:var(--board-line)] md:min-h-[174px]"
                  >
                    <div
                      data-testid="day-label-cell"
                      className="planner-day-label-cell sticky left-0 z-[8] w-[140px] flex-shrink-0 border-r border-[color:var(--board-line)] bg-[var(--board-bg)] py-5 pl-3 pr-2 text-left md:w-[196px] md:py-6 md:pl-4 md:pr-3"
                    >
                      <p
                        className="planner-day-title text-[21px] leading-[1.02] font-bold tracking-[-0.03em] md:text-[34px]"
                        style={{ color: 'var(--board-text)' }}
                      >
                        {day.label.title}
                      </p>
                      <p
                        className="planner-day-subtitle mt-2 text-[11px] leading-none font-semibold uppercase tracking-[0.06em] md:text-[13px]"
                        style={{ color: 'var(--board-muted)' }}
                      >
                        {day.label.subtitle}
                      </p>
                    </div>
                    <DayColumn
                      day={day.date}
                      tasks={tasksByDay.get(day.date) ?? []}
                      timeSlots={timeSlots}
                      slotMinutes={slotMinutes}
                      hourWidth={hourWidth}
                      hourGap={hourGap}
                      onEdit={setEditingTask}
                      onOpenQuickActions={(task) => setActiveHubTaskId(task.id)}
                      defaultAssignee={currentUserId}
                      scheduleTasks={scheduleScopeTasks}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {(showBackToToday || showJumpToNow) && (
        <div className="pointer-events-none absolute bottom-24 right-3 z-20 md:right-5">
          <div className="flex flex-col items-end gap-2">
            {showJumpToNow && (
              <button
                type="button"
                data-testid="jump-to-now-personal"
                onClick={() => scrollToNow('smooth')}
                className="ui-back-to-today pointer-events-auto h-9 ui-v1-radius-sm px-3 text-[12px] font-semibold hover:brightness-105"
              >
                Jump to now
              </button>
            )}
            {showBackToToday && (
              <button
                type="button"
                onClick={() => scrollToToday('smooth')}
                className="ui-back-to-today pointer-events-auto h-9 ui-v1-radius-sm px-3 text-[12px] font-semibold hover:brightness-105"
              >
                Back to Today
              </button>
            )}
          </div>
        </div>
      )}

      <TaskQuickActionsHub task={activeHubTask} onClose={() => setActiveHubTaskId(null)} />

      {editingTask && (
        <AddTaskDialog
          editTask={editingTask}
          defaultAssignee={currentUserId}
          scheduleTasks={scheduleScopeTasks}
          onClose={() => {
            setEditingTask(null);
            setActiveHubTaskId(null);
          }}
        />
      )}
    </div>
  );
}

function getDayLabel(date: Date): { title: string; subtitle: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const compareDate = new Date(date);
  compareDate.setHours(0, 0, 0, 0);

  const subtitle = compareDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  if (compareDate.getTime() === yesterday.getTime()) {
    return { title: 'Yesterday', subtitle };
  }
  if (compareDate.getTime() === today.getTime()) {
    return { title: 'Today', subtitle };
  }
  if (compareDate.getTime() === tomorrow.getTime()) {
    return { title: 'Tomorrow', subtitle };
  }

  return {
    title: compareDate.toLocaleDateString('en-US', { weekday: 'long' }),
    subtitle,
  };
}
