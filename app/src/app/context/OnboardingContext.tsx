import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  AUTH_STORAGE_EVENT,
  clearCloudSessionStorage,
  notifyAuthStorageUpdated,
  readCloudToken,
  readPlannerMode,
  saveCloudSession,
  type PlannerMode,
  writePlannerMode,
} from '../services/authStorage';

interface OnboardingContextValue {
  mode: PlannerMode | null;
  cloudToken: string | null;
  isCloudAuthenticated: boolean;
  setMode: (mode: PlannerMode) => void;
  clearMode: () => void;
  setCloudSession: (session: {
    token: string;
    refreshToken?: string | null;
    orgId?: string | null;
  }) => void;
  clearCloudSession: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | undefined>(undefined);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<PlannerMode | null>(() => readPlannerMode());
  const [cloudToken, setCloudToken] = useState<string | null>(() => readCloudToken());

  const syncFromStorage = useCallback(() => {
    setModeState(readPlannerMode());
    setCloudToken(readCloudToken());
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
  }, []);

  const clearMode = useCallback(() => {
    writePlannerMode(null);
    setModeState(null);
  }, []);

  const setCloudSession = useCallback(
    (session: { token: string; refreshToken?: string | null; orgId?: string | null }) => {
      saveCloudSession(session);
      setCloudToken(session.token);
    },
    []
  );

  const clearCloudSession = useCallback(() => {
    clearCloudSessionStorage();
    setCloudToken(null);
  }, []);

  const value = useMemo<OnboardingContextValue>(
    () => ({
      mode,
      cloudToken,
      isCloudAuthenticated: mode === 'cloud' && Boolean(cloudToken),
      setMode,
      clearMode,
      setCloudSession,
      clearCloudSession,
    }),
    [clearCloudSession, clearMode, cloudToken, mode, setCloudSession, setMode]
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
