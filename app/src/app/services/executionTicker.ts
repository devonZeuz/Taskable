type TickerListener = () => void;

const listeners = new Set<TickerListener>();
let intervalId: number | null = null;

function ensureTickerStarted() {
  if (intervalId !== null || typeof window === 'undefined') return;
  intervalId = window.setInterval(() => {
    listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // ignore listener errors to keep ticker alive
      }
    });
  }, 1000);
}

function stopTickerIfIdle() {
  if (intervalId === null || listeners.size > 0 || typeof window === 'undefined') return;
  window.clearInterval(intervalId);
  intervalId = null;
}

export function subscribeExecutionTicker(listener: TickerListener) {
  listeners.add(listener);
  ensureTickerStarted();
  return () => {
    listeners.delete(listener);
    stopTickerIfIdle();
  };
}
