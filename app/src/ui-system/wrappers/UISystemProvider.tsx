import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { resolveUiSystemFlag, UI_SYSTEM_ROOT_CLASS, uiSystemV1 } from '../flags';
import { cn } from '../../app/components/ui/utils';

interface UiSystemContextValue {
  enabled: boolean;
}

const UiSystemContext = createContext<UiSystemContextValue>({ enabled: uiSystemV1 });

export function UISystemProvider({ children }: PropsWithChildren) {
  const [enabled, setEnabled] = useState<boolean>(() => resolveUiSystemFlag());

  useEffect(() => {
    setEnabled(resolveUiSystemFlag());
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.setAttribute('data-ui-system', enabled ? 'v1' : 'legacy');
    root.classList.toggle(UI_SYSTEM_ROOT_CLASS, enabled);
  }, [enabled]);

  const value = useMemo<UiSystemContextValue>(() => ({ enabled }), [enabled]);

  return (
    <UiSystemContext.Provider value={value}>
      <div
        data-ui-system={enabled ? 'v1' : 'legacy'}
        className={cn('ui-system-scope min-h-full', enabled && UI_SYSTEM_ROOT_CLASS)}
      >
        {children}
      </div>
    </UiSystemContext.Provider>
  );
}

export function useUiSystem() {
  return useContext(UiSystemContext);
}
