import {
  useCallback,
  createContext,
  useContext,
  ReactNode,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { getDateFromDayKey, hasConflict } from '../services/scheduling';
import { useUserPreferences } from './UserPreferencesContext';
import {
  accumulateIfRunning,
  getDurationToNow,
  normalizeTaskExecutionFields,
  type TaskExecutionStatus,
} from '../services/taskTimer';
import { subscribeExecutionTicker } from '../services/executionTicker';
import { recordTaskCompletionSample, recordTaskReschedule } from '../services/taskTelemetry';

export interface SubTask {
  id: string;
  title: string;
  completed: boolean;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  startDateTime?: string;
  durationMinutes: number;
  timeZone?: string;
  completed: boolean;
  color: string;
  subtasks: SubTask[];
  type: 'quick' | 'large' | 'block';
  assignedTo?: string;
  status?: 'scheduled' | 'inbox';
  focus?: boolean;
  version?: number;
  executionVersion?: number;
  executionUpdatedAt?: string;
  executionStatus?: TaskExecutionStatus;
  actualMinutes?: number;
  lastStartAt?: string;
  completedAt?: string;
  lastEndPromptAt?: string;
  // Legacy key kept for migration compatibility.
  lastPromptAt?: string;
}

interface ReplaceTaskOptions {
  clearHistory?: boolean;
}

interface TaskContextType {
  tasks: Task[];
  selectedTaskId: string | null;
  nowTimestamp: number;
  setSelectedTaskId: (taskId: string | null) => void;
  clearSelectedTask: () => void;
  loadDemoData: () => void;
  addTask: (task: Omit<Task, 'id'>) => Task;
  updateTask: (id: string, updates: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  moveTask: (id: string, startDateTime: string) => void;
  moveTasksAtomic: (moves: Array<{ id: string; startDateTime: string }>) => void;
  unscheduleTask: (id: string) => void;
  startTask: (id: string) => void;
  pauseTask: (id: string) => void;
  completeTask: (id: string) => void;
  reopenTask: (id: string) => void;
  extendTaskDuration: (id: string, additionalMinutes: number) => void;
  extendTaskToNow: (id: string, slotMinutes: number) => boolean;
  markTaskPrompted: (id: string, promptedAt?: string) => void;
  toggleTaskComplete: (id: string) => void;
  toggleSubtaskComplete: (taskId: string, subtaskId: string) => void;
  setTaskFocus: (id: string, focus: boolean) => void;
  replaceTasks: (tasks: Task[], options?: ReplaceTaskOptions) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  getConflicts: (
    dayKey: string,
    startTime: string,
    durationMinutes: number,
    excludeTaskId?: string
  ) => boolean;
}

const TaskContext = createContext<TaskContextType | undefined>(undefined);
const STORAGE_KEY = 'taskable-tasks';
const STORAGE_VERSION = 4;
const HISTORY_LIMIT = 120;
const TASK_SYNC_CHANNEL_KEY = 'taskable:tasks-sync';

interface LegacyTask {
  id: string;
  title: string;
  description?: string;
  day: string;
  startTime: string;
  estimatedHours: number;
  completed: boolean;
  color: string;
  subtasks: SubTask[];
  type: 'quick' | 'large' | 'block';
  assignedTo?: string;
}

interface StoredTasks {
  schemaVersion: number;
  tasks: Task[];
}

interface TaskState {
  tasks: Task[];
  undoStack: Task[][];
  redoStack: Task[][];
}

type TaskAction =
  | { type: 'commit'; updater: (tasks: Task[]) => Task[] }
  | { type: 'replace'; tasks: Task[]; clearHistory?: boolean }
  | { type: 'undo' }
  | { type: 'redo' };

function getLocalTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  } catch {
    return 'UTC';
  }
}

function playChime() {
  if (typeof window === 'undefined') return;
  try {
    const AudioContextCtor =
      window.AudioContext ||
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const now = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    gain.connect(context.destination);

    const osc1 = context.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, now);
    osc1.frequency.exponentialRampToValueAtTime(1320, now + 0.18);
    osc1.connect(gain);
    osc1.start(now);
    osc1.stop(now + 0.4);

    const osc2 = context.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(660, now + 0.08);
    osc2.frequency.exponentialRampToValueAtTime(990, now + 0.25);
    osc2.connect(gain);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.48);

    setTimeout(() => {
      context.close().catch(() => undefined);
    }, 700);
  } catch {
    // ignore audio failures
  }
}

function playReverseChime() {
  if (typeof window === 'undefined') return;
  try {
    const AudioContextCtor =
      window.AudioContext ||
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const now = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    gain.connect(context.destination);

    const osc1 = context.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(1320, now);
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.18);
    osc1.connect(gain);
    osc1.start(now);
    osc1.stop(now + 0.4);

    const osc2 = context.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(990, now + 0.08);
    osc2.frequency.exponentialRampToValueAtTime(660, now + 0.25);
    osc2.connect(gain);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.48);

    setTimeout(() => {
      context.close().catch(() => undefined);
    }, 700);
  } catch {
    // ignore audio failures
  }
}

function buildStartDateTime(baseDate: Date, time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const date = new Date(baseDate);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

function migrateLegacyTasks(legacyTasks: LegacyTask[]): Task[] {
  const localTimeZone = getLocalTimeZone();
  return legacyTasks.map((task) => ({
    id: task.id,
    title: task.title,
    description: task.description,
    startDateTime: buildStartDateTime(getLegacyDayDate(task.day), task.startTime),
    durationMinutes: Math.max(0, Math.round(task.estimatedHours * 60)),
    timeZone: localTimeZone,
    completed: task.completed,
    color: task.color,
    subtasks: task.subtasks,
    type: task.type,
    assignedTo: task.assignedTo,
    status: 'scheduled',
    focus: false,
    executionStatus: task.completed ? 'completed' : 'idle',
    actualMinutes: 0,
  }));
}

function getLegacyDayDate(dayValue: string): Date {
  if (!dayValue) {
    const fallback = new Date();
    fallback.setHours(0, 0, 0, 0);
    return fallback;
  }

  const match = dayValue.match(/\d{4}-\d{2}-\d{2}/);
  if (match) {
    return getDateFromDayKey(match[0]);
  }

  const parsed = new Date(dayValue);
  if (!Number.isNaN(parsed.getTime())) {
    parsed.setHours(0, 0, 0, 0);
    return parsed;
  }

  const fallback = new Date();
  fallback.setHours(0, 0, 0, 0);
  return fallback;
}

function normalizeTasks(tasks: Task[]): Task[] {
  return tasks.map((task) => {
    const hasStart = Boolean(task.startDateTime);
    const status = task.status ?? (hasStart ? 'scheduled' : 'inbox');
    const normalizedVersion =
      typeof task.version === 'number' && Number.isFinite(task.version) && task.version > 0
        ? Math.floor(task.version)
        : undefined;
    const normalizedExecutionVersion =
      typeof task.executionVersion === 'number' &&
      Number.isFinite(task.executionVersion) &&
      task.executionVersion > 0
        ? Math.floor(task.executionVersion)
        : undefined;

    let normalizedTask = normalizeTaskExecutionFields({
      ...task,
      status,
      startDateTime: status === 'scheduled' ? task.startDateTime : undefined,
      focus: Boolean(task.focus),
      version: normalizedVersion,
      executionVersion: normalizedExecutionVersion,
      executionUpdatedAt:
        typeof task.executionUpdatedAt === 'string' ? task.executionUpdatedAt : undefined,
    });

    if (normalizedTask.status === 'inbox' && normalizedTask.executionStatus === 'running') {
      normalizedTask = {
        ...normalizedTask,
        executionStatus: 'paused',
        lastStartAt: undefined,
      };
    }

    return normalizedTask;
  });
}

function cloneTasks(tasks: Task[]): Task[] {
  return tasks.map((task) => ({
    ...task,
    subtasks: task.subtasks.map((subtask) => ({ ...subtask })),
  }));
}

function applyTaskMove(task: Task, startDateTime: string, nowMs: number): Task {
  const nextExecutionStatus =
    task.executionStatus === 'running' ? ('paused' as TaskExecutionStatus) : task.executionStatus;
  return {
    ...task,
    startDateTime,
    status: 'scheduled',
    timeZone: task.timeZone ?? getLocalTimeZone(),
    executionStatus: nextExecutionStatus,
    actualMinutes: accumulateIfRunning(task, nowMs),
    lastStartAt: undefined,
  };
}

function areTaskListsEqual(a: Task[], b: Task[]): boolean {
  if (a.length !== b.length) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function loadTasks(): Task[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return [];

  try {
    const parsed = JSON.parse(stored) as StoredTasks | LegacyTask[];
    if (Array.isArray(parsed)) {
      if (parsed.length === 0 || 'startDateTime' in parsed[0]) {
        return normalizeTasks(parsed as unknown as Task[]);
      }
      return migrateLegacyTasks(parsed);
    }
    if (parsed.schemaVersion === STORAGE_VERSION && Array.isArray(parsed.tasks)) {
      return normalizeTasks(parsed.tasks);
    }
    if (Array.isArray(parsed.tasks)) {
      if (parsed.tasks.length === 0 || 'startDateTime' in parsed.tasks[0]) {
        return normalizeTasks(parsed.tasks as unknown as Task[]);
      }
      return migrateLegacyTasks(parsed.tasks as unknown as LegacyTask[]);
    }
  } catch {
    return [];
  }

  return [];
}

const generateInitialTasks = (): Task[] => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const localTimeZone = getLocalTimeZone();

  return [
    {
      id: '1',
      title: 'Germany Invoices',
      description: 'Process invoices for Germany office',
      startDateTime: buildStartDateTime(today, '08:00'),
      durationMinutes: 60,
      timeZone: localTimeZone,
      completed: true,
      color: '#c9ced8',
      subtasks: [],
      type: 'quick',
      assignedTo: 'user1',
      status: 'scheduled',
      focus: false,
      executionStatus: 'completed',
      actualMinutes: 58,
      completedAt: buildStartDateTime(today, '08:58'),
    },
    {
      id: '2',
      title: 'Swiss Invoices',
      description: 'Process invoices for Swiss office',
      startDateTime: buildStartDateTime(today, '09:00'),
      durationMinutes: 60,
      timeZone: localTimeZone,
      completed: true,
      color: '#8d929c',
      subtasks: [],
      type: 'quick',
      assignedTo: 'user1',
      status: 'scheduled',
      focus: false,
      executionStatus: 'completed',
      actualMinutes: 61,
      completedAt: buildStartDateTime(today, '10:01'),
    },
    {
      id: '3',
      title: 'Monthly Reports',
      description: 'Prepare monthly reports for all departments',
      startDateTime: buildStartDateTime(today, '10:00'),
      durationMinutes: 120,
      timeZone: localTimeZone,
      completed: false,
      color: '#2d2f33',
      subtasks: [
        { id: '3a', title: 'Report 1', completed: true },
        { id: '3b', title: 'Report 2', completed: false },
        { id: '3c', title: 'Report 3', completed: false },
      ],
      type: 'large',
      assignedTo: 'user1',
      status: 'scheduled',
      focus: true,
      executionStatus: 'idle',
      actualMinutes: 0,
    },
  ];
};

function pushHistory(stack: Task[][], snapshot: Task[]): Task[][] {
  const next = [...stack, cloneTasks(snapshot)];
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
}

function taskReducer(state: TaskState, action: TaskAction): TaskState {
  switch (action.type) {
    case 'commit': {
      const nextTasks = normalizeTasks(action.updater(state.tasks));
      if (areTaskListsEqual(nextTasks, state.tasks)) {
        return state;
      }
      return {
        tasks: nextTasks,
        undoStack: pushHistory(state.undoStack, state.tasks),
        redoStack: [],
      };
    }
    case 'replace': {
      const nextTasks = normalizeTasks(action.tasks);
      if (areTaskListsEqual(nextTasks, state.tasks)) {
        return state;
      }
      if (action.clearHistory) {
        return { tasks: nextTasks, undoStack: [], redoStack: [] };
      }
      return {
        tasks: nextTasks,
        undoStack: pushHistory(state.undoStack, state.tasks),
        redoStack: [],
      };
    }
    case 'undo': {
      if (state.undoStack.length === 0) return state;
      const previous = state.undoStack[state.undoStack.length - 1];
      return {
        tasks: cloneTasks(previous),
        undoStack: state.undoStack.slice(0, -1),
        redoStack: pushHistory(state.redoStack, state.tasks),
      };
    }
    case 'redo': {
      if (state.redoStack.length === 0) return state;
      const next = state.redoStack[state.redoStack.length - 1];
      return {
        tasks: cloneTasks(next),
        undoStack: pushHistory(state.undoStack, state.tasks),
        redoStack: state.redoStack.slice(0, -1),
      };
    }
    default:
      return state;
  }
}

export function TaskProvider({ children }: { children: ReactNode }) {
  const { preferences } = useUserPreferences();
  const [state, dispatch] = useReducer(taskReducer, undefined, () => ({
    tasks: loadTasks(),
    undoStack: [],
    redoStack: [],
  }));
  const [nowTimestamp, setNowTimestamp] = useState(() => Date.now());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const hadRunningTasksRef = useRef(false);
  const syncSessionIdRef = useRef(Math.random().toString(36).slice(2));
  const syncChannelRef = useRef<BroadcastChannel | null>(null);
  const suppressPersistenceRef = useRef(false);
  const tasksRef = useRef(state.tasks);

  const hasRunningTasks = useMemo(
    () => state.tasks.some((task) => task.executionStatus === 'running'),
    [state.tasks]
  );

  useEffect(() => {
    tasksRef.current = state.tasks;
  }, [state.tasks]);

  useEffect(() => {
    if (!selectedTaskId) return;
    const stillExists = state.tasks.some((task) => task.id === selectedTaskId);
    if (stillExists) return;
    setSelectedTaskId(null);
  }, [selectedTaskId, state.tasks]);

  useEffect(() => {
    if (suppressPersistenceRef.current) {
      suppressPersistenceRef.current = false;
      return;
    }

    const payload: StoredTasks = { schemaVersion: STORAGE_VERSION, tasks: state.tasks };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

    syncChannelRef.current?.postMessage({
      sourceId: syncSessionIdRef.current,
      tasks: payload.tasks,
    });
  }, [state.tasks]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const sessionId = syncSessionIdRef.current;
    const applyIncomingTasks = (incoming: Task[]) => {
      const normalizedIncoming = normalizeTasks(incoming);
      if (areTaskListsEqual(normalizedIncoming, tasksRef.current)) {
        return;
      }
      suppressPersistenceRef.current = true;
      dispatch({ type: 'replace', tasks: normalizedIncoming, clearHistory: true });
    };

    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(TASK_SYNC_CHANNEL_KEY);
      syncChannelRef.current = channel;
      channel.onmessage = (event: MessageEvent<unknown>) => {
        const payload = event.data as { sourceId?: string; tasks?: Task[] } | null;
        if (!payload || payload.sourceId === sessionId || !Array.isArray(payload.tasks)) {
          return;
        }
        applyIncomingTasks(payload.tasks);
      };
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue) as StoredTasks | Task[];
        const incomingTasks = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed.tasks)
            ? parsed.tasks
            : null;
        if (!incomingTasks) return;
        applyIncomingTasks(incomingTasks);
      } catch {
        // Ignore malformed storage payloads.
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
      if (syncChannelRef.current) {
        syncChannelRef.current.close();
        syncChannelRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!hasRunningTasks) {
      if (hadRunningTasksRef.current) {
        setNowTimestamp(Date.now());
      }
      hadRunningTasksRef.current = false;
      return;
    }

    hadRunningTasksRef.current = true;
    const unsubscribe = subscribeExecutionTicker(() => {
      setNowTimestamp(Date.now());
    });

    return () => {
      unsubscribe();
    };
  }, [hasRunningTasks]);

  const addTask = (task: Omit<Task, 'id'>): Task => {
    const isScheduled = Boolean(task.startDateTime) && task.status !== 'inbox';
    const newTask: Task = {
      ...task,
      status: isScheduled ? 'scheduled' : 'inbox',
      startDateTime: isScheduled ? task.startDateTime : undefined,
      timeZone: isScheduled ? (task.timeZone ?? getLocalTimeZone()) : task.timeZone,
      id: Math.random().toString(36).substring(2, 11),
      focus: task.focus ?? false,
      executionStatus: task.completed ? 'completed' : (task.executionStatus ?? 'idle'),
      actualMinutes: Math.max(0, task.actualMinutes ?? 0),
      executionVersion:
        typeof task.executionVersion === 'number' && task.executionVersion > 0
          ? Math.floor(task.executionVersion)
          : undefined,
      executionUpdatedAt:
        typeof task.executionUpdatedAt === 'string' ? task.executionUpdatedAt : undefined,
      lastStartAt: task.executionStatus === 'running' ? task.lastStartAt : undefined,
      completedAt: task.completed ? task.completedAt : undefined,
      lastEndPromptAt: task.lastEndPromptAt ?? task.lastPromptAt,
      lastPromptAt: task.lastEndPromptAt ?? task.lastPromptAt,
    };

    dispatch({ type: 'commit', updater: (prev) => [...prev, newTask] });
    return newTask;
  };

  const updateTask = (id: string, updates: Partial<Task>) => {
    const previousTask = state.tasks.find((task) => task.id === id);
    if (previousTask && typeof updates.startDateTime === 'string') {
      if (updates.startDateTime !== previousTask.startDateTime) {
        recordTaskReschedule({
          title: previousTask.title,
          type: previousTask.type,
        });
      }
    }

    dispatch({
      type: 'commit',
      updater: (prev) =>
        prev.map((task) => {
          if (task.id !== id) return task;
          const nowIso = new Date().toISOString();
          const next = { ...task, ...updates };

          if (next.status === 'inbox' || !next.startDateTime) {
            next.status = 'inbox';
            next.startDateTime = undefined;
            if (next.executionStatus === 'running') {
              next.executionStatus = 'paused';
              next.lastStartAt = undefined;
            }
          } else {
            next.status = 'scheduled';
          }

          if (updates.completed === true) {
            next.executionStatus = 'completed';
            next.completedAt = next.completedAt ?? nowIso;
            next.lastStartAt = undefined;
          }

          if (updates.completed === false) {
            if (next.executionStatus === 'completed') {
              next.executionStatus = next.startDateTime ? 'paused' : 'idle';
            }
            next.completedAt = undefined;
          }

          if (updates.executionStatus === 'running') {
            next.lastStartAt = updates.lastStartAt ?? nowIso;
            next.completed = false;
            next.completedAt = undefined;
          } else if (updates.executionStatus) {
            next.lastStartAt = undefined;
          }

          if (next.executionStatus === 'completed') {
            next.completed = true;
            next.lastStartAt = undefined;
            next.completedAt = next.completedAt ?? nowIso;
          }

          if (next.executionStatus !== 'completed' && next.completed) {
            next.executionStatus = next.startDateTime ? 'paused' : 'idle';
            next.completed = false;
            next.completedAt = undefined;
          }

          return next;
        }),
    });
  };

  const deleteTask = (id: string) => {
    dispatch({ type: 'commit', updater: (prev) => prev.filter((task) => task.id !== id) });
  };

  const moveTasksAtomic = (moves: Array<{ id: string; startDateTime: string }>) => {
    if (moves.length === 0) return;
    const dedupedMoves = new Map<string, string>();
    moves.forEach((move) => {
      if (!move.id || typeof move.startDateTime !== 'string') return;
      dedupedMoves.set(move.id, move.startDateTime);
    });
    if (dedupedMoves.size === 0) return;

    const nowMs = Date.now();
    dedupedMoves.forEach((startDateTime, id) => {
      const target = state.tasks.find((task) => task.id === id);
      if (target?.startDateTime && target.startDateTime !== startDateTime) {
        recordTaskReschedule({
          title: target.title,
          type: target.type,
        });
      }
    });

    dispatch({
      type: 'commit',
      updater: (prev) =>
        prev.map((task) => {
          const nextStartDateTime = dedupedMoves.get(task.id);
          if (!nextStartDateTime) return task;
          return applyTaskMove(task, nextStartDateTime, nowMs);
        }),
    });
  };

  const moveTask = (id: string, startDateTime: string) => {
    moveTasksAtomic([{ id, startDateTime }]);
  };

  const unscheduleTask = (id: string) => {
    const nowMs = Date.now();
    dispatch({
      type: 'commit',
      updater: (prev) =>
        prev.map((task) =>
          task.id === id
            ? {
                ...task,
                startDateTime: undefined,
                status: 'inbox',
                executionStatus:
                  task.executionStatus === 'running' ? 'paused' : task.executionStatus,
                actualMinutes: accumulateIfRunning(task, nowMs),
                lastStartAt: undefined,
              }
            : task
        ),
    });
  };

  const startTask = (id: string) => {
    const target = state.tasks.find((task) => task.id === id);
    if (!target || target.status === 'inbox' || !target.startDateTime) return;
    if (target.type === 'block') return;
    if (target.executionStatus === 'running') return;

    const startedAt = new Date().toISOString();

    dispatch({
      type: 'commit',
      updater: (prev) =>
        prev.map((task) =>
          task.id === id
            ? {
                ...task,
                executionStatus: 'running',
                lastStartAt: startedAt,
                completed: false,
                completedAt: undefined,
              }
            : task
        ),
    });
  };

  const pauseTask = (id: string) => {
    const target = state.tasks.find((task) => task.id === id);
    if (!target || target.executionStatus !== 'running') return;
    if (target.type === 'block') return;

    const nowMs = Date.now();
    const accumulated = accumulateIfRunning(target, nowMs);

    dispatch({
      type: 'commit',
      updater: (prev) =>
        prev.map((task) =>
          task.id === id
            ? {
                ...task,
                executionStatus: 'paused',
                actualMinutes: accumulated,
                lastStartAt: undefined,
              }
            : task
        ),
    });
  };

  const completeTask = (id: string) => {
    const target = state.tasks.find((task) => task.id === id);
    if (!target) return;
    if (target.type === 'block') return;
    if (target.executionStatus === 'completed') return;

    const now = new Date();
    const completedAt = now.toISOString();
    const accumulated = accumulateIfRunning(target, now.getTime());

    dispatch({
      type: 'commit',
      updater: (prev) =>
        prev.map((task) =>
          task.id === id
            ? {
                ...task,
                executionStatus: 'completed',
                completed: true,
                completedAt,
                actualMinutes: accumulated,
                lastStartAt: undefined,
                lastEndPromptAt: undefined,
                lastPromptAt: undefined,
              }
            : task
        ),
    });

    recordTaskCompletionSample({
      title: target.title,
      type: target.type,
      plannedMinutes: target.durationMinutes,
      actualMinutes: accumulated,
      startDateTime: target.startDateTime,
      completedAt,
    });

    if (preferences.soundEffectsEnabled) {
      playChime();
    }
  };

  const reopenTask = (id: string) => {
    const target = state.tasks.find((task) => task.id === id);
    if (!target || target.executionStatus !== 'completed') return;
    if (target.type === 'block') return;

    dispatch({
      type: 'commit',
      updater: (prev) =>
        prev.map((task) =>
          task.id === id
            ? {
                ...task,
                executionStatus: task.startDateTime ? 'paused' : 'idle',
                completed: false,
                completedAt: undefined,
                lastStartAt: undefined,
                lastEndPromptAt: undefined,
                lastPromptAt: undefined,
              }
            : task
        ),
    });

    if (preferences.soundEffectsEnabled) {
      playReverseChime();
    }
  };

  const extendTaskDuration = (id: string, additionalMinutes: number) => {
    if (!Number.isFinite(additionalMinutes) || additionalMinutes <= 0) return;

    dispatch({
      type: 'commit',
      updater: (prev) =>
        prev.map((task) =>
          task.id === id
            ? {
                ...task,
                durationMinutes: Math.max(1, Math.round(task.durationMinutes + additionalMinutes)),
                lastEndPromptAt: undefined,
                lastPromptAt: undefined,
              }
            : task
        ),
    });
  };

  const extendTaskToNow = (id: string, slotMinutes: number): boolean => {
    const target = state.tasks.find((task) => task.id === id);
    if (!target || !target.startDateTime) return false;

    const nextDuration = getDurationToNow(target, Date.now(), slotMinutes);
    if (nextDuration <= target.durationMinutes) {
      return false;
    }

    updateTask(id, {
      durationMinutes: nextDuration,
      lastEndPromptAt: undefined,
      lastPromptAt: undefined,
    });
    return true;
  };

  const markTaskPrompted = (id: string, promptedAt?: string) => {
    const promptTime = promptedAt ?? new Date().toISOString();
    dispatch({
      type: 'commit',
      updater: (prev) =>
        prev.map((task) =>
          task.id === id ? { ...task, lastEndPromptAt: promptTime, lastPromptAt: promptTime } : task
        ),
    });
  };

  const toggleTaskComplete = (id: string) => {
    const target = state.tasks.find((task) => task.id === id);
    if (!target) return;
    if (target.type === 'block') return;
    if (target.executionStatus === 'completed' || target.completed) {
      reopenTask(id);
      return;
    }
    completeTask(id);
  };

  const toggleSubtaskComplete = (taskId: string, subtaskId: string) => {
    const target = state.tasks.find((task) => task.id === taskId);
    const subtask = target?.subtasks.find((st) => st.id === subtaskId);
    const shouldPlayComplete = subtask ? !subtask.completed : false;
    const shouldPlayReopen = subtask ? subtask.completed : false;

    dispatch({
      type: 'commit',
      updater: (prev) =>
        prev.map((task) => {
          if (task.id !== taskId) return task;
          return {
            ...task,
            subtasks: task.subtasks.map((st) =>
              st.id === subtaskId ? { ...st, completed: !st.completed } : st
            ),
          };
        }),
    });

    if (preferences.soundEffectsEnabled && shouldPlayComplete) {
      playChime();
    } else if (preferences.soundEffectsEnabled && shouldPlayReopen) {
      playReverseChime();
    }
  };

  const setTaskFocus = (id: string, focus: boolean) => {
    dispatch({
      type: 'commit',
      updater: (prev) => prev.map((task) => (task.id === id ? { ...task, focus } : task)),
    });
  };

  const replaceTasks = (tasks: Task[], options?: ReplaceTaskOptions) => {
    dispatch({ type: 'replace', tasks, clearHistory: options?.clearHistory });
  };

  const undo = () => {
    if (state.undoStack.length === 0) return;
    dispatch({ type: 'undo' });
    if (preferences.soundEffectsEnabled) {
      playReverseChime();
    }
  };
  const redo = () => dispatch({ type: 'redo' });

  const getConflicts = (
    dayKey: string,
    startTime: string,
    durationMinutes: number,
    excludeTaskId?: string
  ): boolean => hasConflict(state.tasks, dayKey, startTime, durationMinutes, excludeTaskId);

  const clearSelectedTask = useCallback(() => {
    setSelectedTaskId(null);
  }, []);

  const loadDemoData = useCallback(() => {
    dispatch({ type: 'replace', tasks: generateInitialTasks(), clearHistory: true });
  }, []);

  return (
    <TaskContext.Provider
      value={{
        tasks: state.tasks,
        selectedTaskId,
        nowTimestamp,
        setSelectedTaskId,
        clearSelectedTask,
        loadDemoData,
        addTask,
        updateTask,
        deleteTask,
        moveTask,
        moveTasksAtomic,
        unscheduleTask,
        startTask,
        pauseTask,
        completeTask,
        reopenTask,
        extendTaskDuration,
        extendTaskToNow,
        markTaskPrompted,
        toggleTaskComplete,
        toggleSubtaskComplete,
        setTaskFocus,
        replaceTasks,
        undo,
        redo,
        canUndo: state.undoStack.length > 0,
        canRedo: state.redoStack.length > 0,
        getConflicts,
      }}
    >
      {children}
    </TaskContext.Provider>
  );
}

export function useTasks() {
  const context = useContext(TaskContext);
  if (!context) {
    throw new Error('useTasks must be used within TaskProvider');
  }
  return context;
}
