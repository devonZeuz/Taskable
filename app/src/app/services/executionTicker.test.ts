import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeExecutionTicker } from './executionTicker';

describe('executionTicker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ticks subscribers from a single global loop', () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();

    const unsubA = subscribeExecutionTicker(listenerA);
    const unsubB = subscribeExecutionTicker(listenerB);

    vi.advanceTimersByTime(3_000);

    expect(listenerA).toHaveBeenCalledTimes(3);
    expect(listenerB).toHaveBeenCalledTimes(3);

    unsubA();
    vi.advanceTimersByTime(2_000);
    expect(listenerA).toHaveBeenCalledTimes(3);
    expect(listenerB).toHaveBeenCalledTimes(5);

    unsubB();
    vi.advanceTimersByTime(2_000);
    expect(listenerB).toHaveBeenCalledTimes(5);
  });
});
