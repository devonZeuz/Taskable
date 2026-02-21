import { createContext, useContext, useEffect, useState } from 'react';
import { DEFAULT_WORKDAY, type WorkdayHours } from '../services/scheduling';

interface WorkdayContextType {
  workday: WorkdayHours;
  setWorkday: (next: WorkdayHours) => void;
}

const WorkdayContext = createContext<WorkdayContextType | undefined>(undefined);
const STORAGE_KEY = 'taskable-workday';

function normalizeWorkday(input: WorkdayHours): WorkdayHours {
  const startHour = Math.min(23, Math.max(0, Math.floor(input.startHour)));
  let endHour = Math.min(23, Math.max(1, Math.floor(input.endHour)));
  if (endHour <= startHour) {
    endHour = Math.min(23, startHour + 1);
  }
  return { startHour, endHour };
}

function loadWorkday(): WorkdayHours {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return DEFAULT_WORKDAY;
  try {
    const parsed = JSON.parse(stored) as WorkdayHours;
    if (typeof parsed?.startHour !== 'number' || typeof parsed?.endHour !== 'number') {
      return DEFAULT_WORKDAY;
    }
    return normalizeWorkday(parsed);
  } catch {
    return DEFAULT_WORKDAY;
  }
}

export function WorkdayProvider({ children }: { children: React.ReactNode }) {
  const [workday, setWorkdayState] = useState<WorkdayHours>(() => loadWorkday());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workday));
  }, [workday]);

  const setWorkday = (next: WorkdayHours) => {
    setWorkdayState(normalizeWorkday(next));
  };

  return (
    <WorkdayContext.Provider value={{ workday, setWorkday }}>{children}</WorkdayContext.Provider>
  );
}

export function useWorkday() {
  const context = useContext(WorkdayContext);
  if (!context) {
    throw new Error('useWorkday must be used within WorkdayProvider');
  }
  return context;
}
