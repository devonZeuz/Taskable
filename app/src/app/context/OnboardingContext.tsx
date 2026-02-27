import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  AUTH_STORAGE_EVENT,
  clearCloudSessionStorage,
  notifyAuthStorageUpdated,
  readCloudTutorialCompleted,
  readCloudToken,
  readCloudUserId,
  readLocalTutorialCompleted,
  readPlannerMode,
  saveCloudSession,
  type PlannerMode,
  writeCloudTutorialCompleted,
  writeLocalTutorialCompleted,
  writePlannerMode,
} from '../services/authStorage';

interface OnboardingContextValue {
  mode: PlannerMode | null;
  cloudToken: string | null;
  cloudUserId: string | null;
  isCloudAuthenticated: boolean;
  hasCompletedTutorial: boolean;
  setMode: (mode: PlannerMode) => void;
  clearMode: () => void;
  setCloudSession: (session: {
    token: string;
    refreshToken?: string | null;
    orgId?: string | null;
    userId?: string | null;
  }) => void;
  clearCloudSession: () => void;
  markTutorialCompleted: (userId?: string | null) => void;
}

const OnboardingContext = createContext<OnboardingContextValue | undefined>(undefined);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<PlannerMode | null>(() => readPlannerMode());
  const [cloudToken, setCloudToken] = useState<string | null>(() => readCloudToken());
  const [cloudUserId, setCloudUserId] = useState<string | null>(() => readCloudUserId());
  const [hasCompletedTutorial, setHasCompletedTutorial] = useState<boolean>(() => {
    const initialMode = readPlannerMode();
    if (initialMode === 'local') {
      return readLocalTutorialCompleted();
    }
    if (initialMode === 'cloud') {
      return readCloudTutorialCompleted(readCloudUserId());
    }
    return false;
  });

  const syncFromStorage = useCallback(() => {
    const nextMode = readPlannerMode();
    const nextCloudUserId = readCloudUserId();
    setModeState(nextMode);
    setCloudToken(readCloudToken());
    setCloudUserId(nextCloudUserId);
    if (nextMode === 'local') {
      setHasCompletedTutorial(readLocalTutorialCompleted());
      return;
    }
    if (nextMode === 'cloud') {
      setHasCompletedTutorial(readCloudTutorialCompleted(nextCloudUserId));
      return;
    }
    setHasCompletedTutorial(false);
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea !== localStorage) return;
      syncFromStorage();
    };
    const handleLocalAuthStorage = () => {
      syncFromStorage();
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener(AUTH_STORAGE_EVENT, handleLocalAuthStorage);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(AUTH_STORAGE_EVENT, handleLocalAuthStorage);
    };
  }, [syncFromStorage]);

  const setMode = useCallback((nextMode: PlannerMode) => {
    writePlannerMode(nextMode);
    setModeState(nextMode);
    if (nextMode === 'local') {
      setHasCompletedTutorial(readLocalTutorialCompleted());
      return;
    }
    setHasCompletedTutorial(readCloudTutorialCompleted(readCloudUserId()));
  }, []);

  const clearMode = useCallback(() => {
    writePlannerMode(null);
    setModeState(null);
    setHasCompletedTutorial(false);
  }, []);

  const setCloudSession = useCallback(
    (session: {
      token: string;
      refreshToken?: string | null;
      orgId?: string | null;
      userId?: string | null;
    }) => {
      saveCloudSession(session);
      setCloudToken(session.token);
      if (typeof session.userId === 'string') {
        setCloudUserId(session.userId);
        setHasCompletedTutorial(readCloudTutorialCompleted(session.userId));
      } else {
        setHasCompletedTutorial(false);
      }
    },
    []
  );

  const clearCloudSession = useCallback(() => {
    clearCloudSessionStorage();
    setCloudToken(null);
    setCloudUserId(null);
    setHasCompletedTutorial(false);
  }, []);

  const markTutorialCompleted = useCallback(
    (userId?: string | null) => {
      if (mode === 'local') {
        writeLocalTutorialCompleted(true);
        setHasCompletedTutorial(true);
        return;
      }

      const targetUserId = userId ?? cloudUserId;
      if (mode === 'cloud' && targetUserId) {
        writeCloudTutorialCompleted(targetUserId, true);
        setHasCompletedTutorial(true);
      }
    },
    [cloudUserId, mode]
  );

  const value = useMemo<OnboardingContextValue>(
    () => ({
      mode,
      cloudToken,
      cloudUserId,
      isCloudAuthenticated: mode === 'cloud' && Boolean(cloudToken),
      hasCompletedTutorial,
      setMode,
      clearMode,
      setCloudSession,
      clearCloudSession,
      markTutorialCompleted,
    }),
    [
      clearCloudSession,
      clearMode,
      cloudToken,
      cloudUserId,
      hasCompletedTutorial,
      markTutorialCompleted,
      mode,
      setCloudSession,
      setMode,
    ]
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within OnboardingProvider');
  }
  return context;
}

export function usePlannerMode() {
  return useOnboarding().mode;
}

export function forceOnboardingStorageSync() {
  notifyAuthStorageUpdated();
}
