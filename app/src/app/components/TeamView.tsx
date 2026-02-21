import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTasks, Task } from '../context/TaskContext';
import AddTaskDialog from './AddTaskDialog';
import InboxPanel from './InboxPanel';
import DayColumn from './DayColumn';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import UndoRedoControls from './UndoRedoControls';
import DailyPlanningPanel from './DailyPlanningPanel';
import TaskQuickActionsHub from './TaskQuickActionsHub';
import BlockTaskButton from './BlockTaskButton';
import ConflictResolutionBanner from './ConflictResolutionBanner';
import { SettingsDrawerInner } from './settings/SettingsDrawer';
import RealtimePresenceBadge from './RealtimePresenceBadge';
import { useWorkday } from '../context/WorkdayContext';
import { useCloudSync } from '../context/CloudSyncContext';
import { useUserPreferences } from '../context/UserPreferencesContext';
import {
  getDayKey,
  getDayKeyFromDateTime,
  getWorkdayTimeSlots,
  minutesToTime,
} from '../services/scheduling';
import { useTeamMembers } from '../context/TeamMembersContext';
import { buildEffectiveMembers } from '../services/memberDirectory';
import { parseTaskIdFromSearch, removeTaskIdFromSearch } from '../services/taskDeepLink';

const TODAY_REVEAL_BUFFER_ROWS = 0.9;

export default function TeamView() {
  const location = useLocation();
  const navigate = useNavigate();
  const { tasks } = useTasks();
  const { workday } = useWorkday();
  const {
    preferences: { slotMinutes, recallDays },
  } = useUserPreferences();
  const { members: localMembers } = useTeamMembers();
  const {
    enabled: cloudEnabled,
    token: cloudToken,
    activeOrgId,
    members: cloudMembers,
  } = useCloudSync();
  const useCloudMembers = cloudEnabled && Boolean(cloudToken && activeOrgId);
  const members = useMemo(
    () => buildEffectiveMembers(localMembers, cloudMembers, useCloudMembers),
    [cloudMembers, localMembers, useCloudMembers]
  );
  const [selectedMember, setSelectedMember] = useState('all');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [activeHubTaskId, setActiveHubTaskId] = useState<string | null>(null);
  const [showBackToToday, setShowBackToToday] = useState(false);
  const boardScrollRef = useRef<HTMLDivElement | null>(null);
  const stickyHeaderRef = useRef<HTMLDivElement | null>(null);
  const todayRowRef = useRef<HTMLDivElement | null>(null);
  const initialScrollDoneRef = useRef(false);
  const hourWidth = 216;
  const hourGap = 18;
  const slotWidth = (hourWidth * slotMinutes) / 60;
  const slotsPerHour = 60 / slotMinutes;
  const futureDays = 14;

  const filteredTasks = useMemo(() => {
    if (selectedMember === 'all') return tasks;
    if (selectedMember === 'unassigned') {
      return tasks.filter((task) => !task.assignedTo);
    }
    return tasks.filter((task) => task.assignedTo === selectedMember);
  }, [tasks, selectedMember]);

  useEffect(() => {
    if (!members.some((member) => member.id === selectedMember)) {
      setSelectedMember('all');
    }
  }, [members, selectedMember]);

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

  const getTodayTargetTop = useCallback(() => {
    const container = boardScrollRef.current;
    const stickyHeight = stickyHeaderRef.current?.offsetHeight ?? 46;
    const rowHeight = todayRowRef.current?.offsetHeight ?? 0;
    const revealBuffer = rowHeight * TODAY_REVEAL_BUFFER_ROWS;
    if (!container) return null;
    const target =
      todayRowRef.current ?? container.querySelector<HTMLElement>('[data-day-kind="today"]');
    if (!target) return null;
    return Math.max(0, target.offsetTop - stickyHeight - revealBuffer - 2);
  }, []);

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
    if (initialScrollDoneRef.current) return;
    if (!boardScrollRef.current) return;

    let attempts = 0;
    let retryTimer: number | null = null;
    const tryAlign = () => {
      attempts += 1;
      const aligned = scrollToToday('auto');
      if (aligned || attempts >= 24) {
        initialScrollDoneRef.current = true;
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
        return;
      }
      setShowBackToToday(Math.abs(container.scrollTop - targetTop) > 90);
    };

    evaluate();
    container.addEventListener('scroll', evaluate, { passive: true });
    window.addEventListener('resize', evaluate);
    return () => {
      container.removeEventListener('scroll', evaluate);
      window.removeEventListener('resize', evaluate);
    };
  }, [days, getTodayTargetTop]);

  const handleTimeAxisWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.shiftKey || event.ctrlKey) return;
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
  }, []);

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
  const inboxTasks = filteredTasks.filter((task) => !task.startDateTime || task.status === 'inbox');
  const scheduledTasks = filteredTasks.filter(
    (task) => task.startDateTime && task.status !== 'inbox'
  );
  const scheduleScopeTasks = filteredTasks;
  const defaultAssignee =
    selectedMember !== 'all' && selectedMember !== 'unassigned' ? selectedMember : undefined;

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

  const stats = useMemo(() => {
    const total = filteredTasks.length;
    const completed = filteredTasks.filter((t) => t.completed).length;
    const pending = total - completed;
    return { total, completed, pending };
  }, [filteredTasks]);
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

  return (
    <div className="relative h-full min-h-0 flex flex-col bg-[var(--board-bg)] pt-[86px] md:pt-[98px]">
      <div className="pointer-events-none absolute right-3 top-3 z-20 md:right-5 md:top-5">
        <div className="pointer-events-auto flex items-center gap-2 rounded-[14px] border border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-2 py-1.5 backdrop-blur-sm">
          <Select value={selectedMember} onValueChange={setSelectedMember}>
            <SelectTrigger
              data-testid="team-filter-trigger"
              className="h-9 w-[150px] rounded-[10px] border-[color:var(--hud-border)] bg-[var(--hud-surface-strong)] text-[color:var(--hud-text)] md:w-[190px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {members.map((member) => (
                <SelectItem
                  data-testid={`team-filter-${member.id}`}
                  key={member.id}
                  value={member.id}
                >
                  {member.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge className="hidden rounded-full border border-[color:var(--hud-border)] bg-[var(--hud-accent-soft)] px-3 text-[var(--hud-accent-soft-text)] md:inline-flex">
            All {stats.total}
          </Badge>
          <Badge className="hidden rounded-full border border-[color:var(--hud-border)] bg-[var(--hud-accent-bg)] px-3 text-[var(--hud-accent-text)] md:inline-flex">
            Done {stats.completed}
          </Badge>
          <Badge className="hidden rounded-full border border-[color:var(--hud-border)] bg-[var(--hud-chip-neutral-bg)] px-3 text-[var(--hud-chip-neutral-text)] md:inline-flex">
            Open {stats.pending}
          </Badge>
          <RealtimePresenceBadge compact />
          <SettingsDrawerInner compact />
        </div>
      </div>

      <div className="pointer-events-none absolute left-3 top-3 z-20 md:left-5 md:top-5">
        <div className="pointer-events-auto flex items-center gap-2 rounded-[14px] border border-[color:var(--hud-border)] bg-[var(--hud-surface)] px-2 py-1.5 backdrop-blur-sm">
          <UndoRedoControls />
          <AddTaskDialog defaultAssignee={defaultAssignee} scheduleTasks={scheduleScopeTasks} />
          <BlockTaskButton defaultAssignee={defaultAssignee} scheduleTasks={scheduleScopeTasks} />
        </div>
      </div>

      <DailyPlanningPanel
        tasks={filteredTasks}
        scheduleTasks={scheduleScopeTasks}
        onEdit={setEditingTask}
      />
      <ConflictResolutionBanner />

      {inboxTasks.length > 0 && (
        <div className="px-3 md:px-5">
          <InboxPanel title="Inbox" tasks={inboxTasks} onEdit={setEditingTask} />
        </div>
      )}

      <div
        ref={boardScrollRef}
        className="board-scroll min-h-0 flex-1 overflow-x-auto overflow-y-auto"
      >
        <div className="min-w-max pb-24">
          <div
            ref={stickyHeaderRef}
            className="sticky top-0 z-10 flex border-b border-[color:var(--board-line)] bg-[var(--board-surface)]/92 backdrop-blur-sm"
          >
            <div className="w-[140px] flex-shrink-0 border-r border-[color:var(--board-line)] md:w-[196px]" />
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
                          className="pl-2 text-[11px] font-semibold md:text-xs"
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
                  className="text-[10px] font-semibold md:text-[11px]"
                  style={{ color: 'var(--hour-end-highlight)' }}
                >
                  {endLabel}
                </span>
              </div>
            </div>
          </div>

          {days.map((day) => (
            <div
              key={day.date}
              ref={day.isToday ? todayRowRef : undefined}
              data-day-row={day.date}
              data-day-kind={day.isToday ? 'today' : 'other'}
              className="flex min-h-[134px] border-b border-[color:var(--board-line)] md:min-h-[174px]"
            >
              <div className="w-[140px] flex-shrink-0 border-r border-[color:var(--board-line)] pl-3 pr-2 py-5 flex flex-col items-start justify-start text-left md:w-[196px] md:pl-4 md:pr-3 md:py-6">
                <p
                  className="text-[21px] leading-[1.02] font-bold tracking-[-0.03em] md:text-[34px]"
                  style={{ color: 'var(--board-text)' }}
                >
                  {day.label.title}
                </p>
                <p
                  className="mt-2 text-[11px] leading-none font-semibold uppercase tracking-[0.06em] md:text-[13px]"
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
                defaultAssignee={defaultAssignee}
                scheduleTasks={scheduleScopeTasks}
              />
            </div>
          ))}
        </div>
      </div>

      {showBackToToday && (
        <div className="pointer-events-none absolute bottom-24 right-3 z-20 md:right-5">
          <button
            type="button"
            onClick={() => scrollToToday('smooth')}
            className="ui-back-to-today pointer-events-auto h-9 rounded-[11px] px-3 text-[12px] font-semibold hover:brightness-105"
          >
            Back to Today
          </button>
        </div>
      )}

      <TaskQuickActionsHub task={activeHubTask} onClose={() => setActiveHubTaskId(null)} />

      {editingTask && (
        <AddTaskDialog
          editTask={editingTask}
          defaultAssignee={defaultAssignee}
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
