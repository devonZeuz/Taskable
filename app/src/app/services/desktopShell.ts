export interface DesktopShellState {
  isDesktop: boolean;
  compactVisible: boolean;
  compactAlwaysOnTop: boolean;
}

export interface DesktopShellBridge {
  isDesktop: boolean;
  getState: () => Promise<DesktopShellState>;
  toggleCompact: () => Promise<DesktopShellState>;
  openCompact: () => Promise<DesktopShellState>;
  closeCompact: () => Promise<DesktopShellState>;
  setAlwaysOnTop: (enabled: boolean) => Promise<DesktopShellState>;
  openFull: (payload?: { taskId?: string }) => Promise<DesktopShellState>;
  focusMain: () => Promise<DesktopShellState>;
  openTask: (taskId: string) => Promise<DesktopShellState>;
  onStateChange: (callback: (state: DesktopShellState) => void) => () => void;
}

declare global {
  interface Window {
    taskableDesktop?: DesktopShellBridge;
  }
}

function getBridge(): DesktopShellBridge | null {
  if (typeof window === 'undefined') return null;
  return window.taskableDesktop ?? null;
}

export function isDesktopShell(): boolean {
  return Boolean(getBridge()?.isDesktop);
}

export async function desktopGetState(): Promise<DesktopShellState | null> {
  const bridge = getBridge();
  if (!bridge) return null;
  return bridge.getState();
}

export async function desktopToggleCompact(): Promise<DesktopShellState | null> {
  const bridge = getBridge();
  if (!bridge) return null;
  return bridge.toggleCompact();
}

export async function desktopOpenCompact(): Promise<DesktopShellState | null> {
  const bridge = getBridge();
  if (!bridge) return null;
  return bridge.openCompact();
}

export async function desktopCloseCompact(): Promise<DesktopShellState | null> {
  const bridge = getBridge();
  if (!bridge) return null;
  return bridge.closeCompact();
}

export async function desktopSetAlwaysOnTop(enabled: boolean): Promise<DesktopShellState | null> {
  const bridge = getBridge();
  if (!bridge) return null;
  return bridge.setAlwaysOnTop(enabled);
}

export async function desktopOpenFull(payload?: {
  taskId?: string;
}): Promise<DesktopShellState | null> {
  const bridge = getBridge();
  if (!bridge) return null;
  return bridge.openFull(payload);
}

export async function desktopFocusMain(): Promise<DesktopShellState | null> {
  const bridge = getBridge();
  if (!bridge) return null;
  return bridge.focusMain();
}

export async function desktopOpenTask(taskId: string): Promise<DesktopShellState | null> {
  const bridge = getBridge();
  if (!bridge) return null;
  return bridge.openTask(taskId);
}

export function desktopOnStateChange(callback: (state: DesktopShellState) => void): () => void {
  const bridge = getBridge();
  if (!bridge) return () => undefined;
  return bridge.onStateChange(callback);
}
